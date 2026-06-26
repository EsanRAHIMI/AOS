/**
 * Improvement Workflow engine (Phase 10). Converts an approved recommendation
 * into a structured, engine-routed workflow; measures before/after impact; and
 * maintains compressed memory. Pure + testable; the orchestrator executes the
 * steps against real engines and persists results. Approval converts; execution
 * runs after approval; impact is evidence-backed (never faked).
 */
import { genId, nowIso } from '../utils/index.js';
import type { SystemRecommendation } from '../schemas/learning.js';
import type { ImprovementWorkflow, WorkflowType, WorkflowStep, ImpactAssessment, MemoryMaintenanceRun, LearningSchedule } from '../schemas/workflows.js';
import type { MemorySummary } from '../schemas/learning.js';

/** Structured steps + target engine + required approvals per workflow type. */
const TEMPLATES: Record<WorkflowType, { steps: Array<{ name: string; engine: string }>; approvals: string[] }> = {
  create_skill: { steps: [{ name: 'Create/update the reusable skill', engine: 'skill-library' }, { name: 'Attach evidence and source patterns', engine: 'evidence' }, { name: 'Validate the skill is well-formed', engine: 'validation' }, { name: 'Add to compressed memory', engine: 'memory' }], approvals: [] },
  update_skill: { steps: [{ name: 'Update the skill', engine: 'skill-library' }, { name: 'Reinforce success rate', engine: 'skill-library' }, { name: 'Attach evidence', engine: 'evidence' }], approvals: [] },
  add_validation: { steps: [{ name: 'Define the validation enhancement', engine: 'builder-agent' }, { name: 'Run the validation engine on the target', engine: 'validation' }, { name: 'Record evidence', engine: 'evidence' }], approvals: [] },
  add_test: { steps: [{ name: 'Create a browser test plan', engine: 'browser-testing-agent' }, { name: 'Run a safe internal browser test', engine: 'browser-testing-agent' }, { name: 'Record evidence', engine: 'evidence' }], approvals: [] },
  add_monitor: { steps: [{ name: 'Add a monitoring scan for the target', engine: 'monitor-agent' }, { name: 'Run an initial scan', engine: 'monitor-agent' }, { name: 'Record evidence', engine: 'evidence' }], approvals: [] },
  improve_scoring: { steps: [{ name: 'Create a scoring change proposal', engine: 'scoring-engine' }, { name: 'Await approval', engine: 'governance' }, { name: 'Measure future plan quality', engine: 'learning' }], approvals: ['approve_scoring_change'] },
  improve_policy: { steps: [{ name: 'Create a policy change proposal', engine: 'policy-engine' }, { name: 'Await approval', engine: 'governance' }, { name: 'Activate the rule + audit', engine: 'policy-engine' }], approvals: ['approve_policy_change'] },
  create_capability: { steps: [{ name: 'Create an expansion proposal', engine: 'orchestrator' }, { name: 'Await approval', engine: 'governance' }, { name: 'Build + validate + register', engine: 'builder-agent' }], approvals: ['approve_expansion'] },
  improve_service: { steps: [{ name: 'Run the strategic planner for the service', engine: 'orchestrator' }, { name: 'Score plans + policy check', engine: 'scoring-engine' }, { name: 'Execute selected plan + validate', engine: 'builder-agent' }, { name: 'Create evidence', engine: 'evidence' }], approvals: ['redeploy'] },
  improve_prompt: { steps: [{ name: 'Analyze prompt performance', engine: 'learning' }, { name: 'Propose a prompt change', engine: 'governance' }, { name: 'Create new prompt version after approval', engine: 'llm-router' }, { name: 'Measure fallback/invalid rate', engine: 'learning' }], approvals: ['approve_policy_change'] },
  deprecate_capability: { steps: [{ name: 'Mark capability deprecated', engine: 'orchestrator' }, { name: 'Audit', engine: 'governance' }], approvals: ['approve_expansion'] },
};

/** Recommendation Conversion Router: rec.type → structured workflow. */
export function recommendationToWorkflow(rec: SystemRecommendation): ImprovementWorkflow {
  const type = rec.type as WorkflowType;
  const tmpl = TEMPLATES[type] ?? { steps: [{ name: 'Investigate and apply', engine: 'orchestrator' }], approvals: [] };
  const now = nowIso();
  const steps: WorkflowStep[] = tmpl.steps.map((s) => ({ name: s.name, engine: s.engine, status: 'pending', detail: '' }));
  return {
    workflowId: genId('wf'),
    sourceRecommendationId: rec.recommendationId,
    taskId: null,
    type,
    title: `Workflow: ${rec.title}`,
    status: 'approved',
    steps,
    currentStep: 0,
    requiredApprovals: tmpl.approvals,
    evidenceIds: [...rec.evidence],
    result: '',
    beforeMetrics: {},
    afterMetrics: {},
    impactAssessmentId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export interface ImpactInput {
  workflowId: string;
  sourceRecommendationId: string | null;
  targetType: string;
  targetId: string;
  beforeMetrics: Record<string, number>;
  afterMetrics: Record<string, number>;
  evidenceIds?: string[];
}

/** Compare before/after; never fake improvement — say so if not measurable. */
export function buildImpactAssessment(input: ImpactInput): ImpactAssessment {
  const b = input.beforeMetrics;
  const a = input.afterMetrics;
  const drel = (a.reliability ?? 0) - (b.reliability ?? 0);
  const dinc = (a.incidentRate ?? 0) - (b.incidentRate ?? 0);
  const dval = (a.validationScore ?? 0) - (b.validationScore ?? 0);
  const dskill = (a.skillCount ?? 0) - (b.skillCount ?? 0);

  let impact = 'no measurable improvement yet';
  let confidence = 0.4;
  if (drel > 0.02) { impact = 'reliability improved'; confidence = 0.7; }
  else if (dinc < -0.02) { impact = 'incident rate reduced'; confidence = 0.65; }
  else if (dval > 0.02) { impact = 'validation score increased'; confidence = 0.65; }
  else if (dskill > 0) { impact = 'skill library expanded; no reliability change measurable yet'; confidence = 0.55; }

  return {
    impactAssessmentId: genId('impact'),
    workflowId: input.workflowId,
    sourceRecommendationId: input.sourceRecommendationId,
    targetType: input.targetType,
    targetId: input.targetId,
    beforeMetrics: b,
    afterMetrics: a,
    impact,
    confidence,
    evidenceIds: input.evidenceIds ?? [],
    recommendation: impact === 'no measurable improvement yet' ? 'Re-measure after more history accrues; keep the workflow result for the next learning run.' : 'Reinforce this improvement pattern in future planning.',
    createdAt: nowIso(),
  };
}

/** Plan a memory-maintenance pass: keep the latest summary per scope, deprecate the rest. */
export function buildMemoryMaintenanceRun(summaries: MemorySummary[]): { run: MemoryMaintenanceRun; deprecateIds: string[] } {
  const byScope = new Map<string, MemorySummary[]>();
  for (const s of summaries) {
    const key = `${s.scope}:${s.scopeId ?? ''}`;
    if (!byScope.has(key)) byScope.set(key, []);
    byScope.get(key)!.push(s);
  }
  const deprecateIds: string[] = [];
  for (const group of byScope.values()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const old of sorted.slice(1)) deprecateIds.push(old.summaryId);
  }
  const tokenBudgetSaved = deprecateIds.reduce((acc, id) => acc + (summaries.find((s) => s.summaryId === id)?.tokenBudget ?? 0), 0);
  const run: MemoryMaintenanceRun = {
    maintenanceRunId: genId('mm'),
    summariesReviewed: summaries.length,
    summariesUpdated: byScope.size,
    summariesDeprecated: deprecateIds.length,
    compressedContextsUpdated: 1,
    tokenBudgetSaved,
    notes: deprecateIds.length ? [`Deprecated ${deprecateIds.length} superseded summaries; kept the latest per scope.`] : ['No superseded summaries; memory is current.'],
    createdAt: nowIso(),
  };
  return { run, deprecateIds };
}

/** Default daily learning schedule (manual trigger supported; continuous-ready). */
export function seedLearningSchedule(): LearningSchedule {
  const now = nowIso();
  return {
    scheduleId: genId('sched'),
    name: 'Daily operational learning',
    cadence: 'daily',
    triggerType: 'time_based',
    enabled: true,
    minNewRecords: 20,
    scope: 'all',
    lastRunAt: null,
    nextRunAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
