/**
 * Historical Learning Engine (Phase 9). Aggregates the system's operational
 * history into reliability scores, recurring patterns, compressed memory, and
 * evidence-backed recommendations. Pure functions over a history bundle so the
 * logic is deterministic and testable; the caller persists + links ids.
 * Learning recommends — approval applies. Nothing here mutates behavior.
 */
import { genId, nowIso } from '../utils/index.js';
import type {
  ReliabilityScore,
  OperationalPattern,
  MemorySummary,
  CompressedContext,
  SystemRecommendation,
  PromptPerformance,
  Trend,
} from '../schemas/learning.js';

/* ---- history bundle (loosely typed; only the fields we read are declared) ---- */
export interface HistoryBundle {
  tasks?: Array<{ status?: string; createdAt?: string }>;
  agentRuns?: Array<{ serviceId?: string; status?: string; createdAt?: string }>;
  activations?: Array<{ serviceName?: string; passed?: boolean; createdAt?: string }>;
  validations?: Array<{ serviceName?: string; score?: number; passed?: boolean; createdAt?: string }>;
  evaluations?: Array<{ targetType?: string; targetId?: string; score?: number; createdAt?: string }>;
  incidents?: Array<{ serviceName?: string; status?: string; detail?: string; source?: string; createdAt?: string }>;
  repairTasks?: Array<{ serviceName?: string; status?: string; createdAt?: string }>;
  repairPlans?: Array<{ planType?: string; createdAt?: string }>;
  planScores?: Array<{ label?: string; total?: number; selected?: boolean; createdAt?: string }>;
  decisions?: Array<{ selectedPlanId?: string; goal?: string }>;
  outcomeReviews?: Array<{ predictedVsActual?: string }>;
  evidence?: Array<{ evidenceId?: string }>;
  skills?: Array<{ skillId?: string }>;
  memories?: Array<{ memoryId?: string; summary?: string }>;
  llmTraces?: Array<{ promptVersion?: string; taskType?: string; valid?: boolean; usedFallback?: boolean; costUsd?: number; tokensIn?: number; tokensOut?: number }>;
}

const clamp = (n: number): number => Math.max(0, Math.min(1, Number((Number.isFinite(n) ? n : 0).toFixed(3))));
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** improving if the recent half outperforms the older half (by createdAt). */
function trendOf(items: Array<{ createdAt?: string; ok: boolean }>): Trend {
  if (items.length < 4) return 'unknown';
  const sorted = [...items].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const mid = Math.floor(sorted.length / 2);
  const older = sorted.slice(0, mid);
  const recent = sorted.slice(mid);
  const r = mean(recent.map((x) => (x.ok ? 1 : 0)));
  const o = mean(older.map((x) => (x.ok ? 1 : 0)));
  if (r - o > 0.1) return 'improving';
  if (o - r > 0.1) return 'declining';
  return 'stable';
}

// ===========================================================================
// Reliability scores
// ===========================================================================
export function computeReliabilityScores(b: HistoryBundle): ReliabilityScore[] {
  const now = nowIso();
  const out: ReliabilityScore[] = [];
  const mk = (targetType: ReliabilityScore['targetType'], targetId: string, partial: Omit<ReliabilityScore, 'reliabilityId' | 'targetType' | 'targetId' | 'lastUpdatedAt'>): void => {
    out.push({ reliabilityId: genId('rel'), targetType, targetId, ...partial, lastUpdatedAt: now });
  };

  // Services — from activations + validations + incidents + repairs.
  const services = new Set<string>();
  for (const a of b.activations ?? []) if (a.serviceName) services.add(a.serviceName);
  for (const v of b.validations ?? []) if (v.serviceName) services.add(v.serviceName);
  for (const i of b.incidents ?? []) if (i.serviceName) services.add(i.serviceName);
  for (const svc of services) {
    const acts = (b.activations ?? []).filter((a) => a.serviceName === svc);
    const vals = (b.validations ?? []).filter((v) => v.serviceName === svc);
    const incs = (b.incidents ?? []).filter((i) => i.serviceName === svc);
    const reps = (b.repairTasks ?? []).filter((r) => r.serviceName === svc);
    const n = acts.length || vals.length || 1;
    const successRate = acts.length ? clamp(acts.filter((a) => a.passed).length / acts.length) : clamp(mean(vals.map((v) => (v.passed ? 1 : 0))));
    const avgValidationScore = clamp(mean(vals.map((v) => v.score ?? 0)));
    const incidentRate = clamp(incs.length / n);
    const repairSuccessRate = reps.length ? clamp(reps.filter((r) => r.status === 'completed').length / reps.length) : 0;
    const score = clamp(0.5 * successRate + 0.2 * avgValidationScore + 0.2 * (1 - incidentRate) + 0.1 * repairSuccessRate);
    const sampleSize = acts.length + vals.length;
    mk('service', svc, {
      score, sampleSize, successRate, failureRate: clamp(1 - successRate), avgEvaluationScore: 0, avgValidationScore,
      incidentRate, repairSuccessRate, trend: trendOf(acts.map((a) => ({ createdAt: a.createdAt, ok: Boolean(a.passed) }))), confidence: clamp(sampleSize / 10),
    });
  }

  // Agents — from agent_runs.
  const agents = new Set<string>();
  for (const r of b.agentRuns ?? []) if (r.serviceId) agents.add(r.serviceId);
  for (const ag of agents) {
    const runs = (b.agentRuns ?? []).filter((r) => r.serviceId === ag);
    const successRate = clamp(runs.filter((r) => r.status === 'succeeded').length / (runs.length || 1));
    mk('agent', ag, { score: successRate, sampleSize: runs.length, successRate, failureRate: clamp(1 - successRate), avgEvaluationScore: 0, avgValidationScore: 0, incidentRate: 0, repairSuccessRate: 0, trend: trendOf(runs.map((r) => ({ createdAt: r.createdAt, ok: r.status === 'succeeded' }))), confidence: clamp(runs.length / 10) });
  }

  // Capabilities — from evaluations.
  const caps = new Set<string>();
  for (const e of b.evaluations ?? []) if (e.targetType === 'capability' && e.targetId) caps.add(e.targetId);
  for (const cap of caps) {
    const evs = (b.evaluations ?? []).filter((e) => e.targetType === 'capability' && e.targetId === cap);
    const avg = clamp(mean(evs.map((e) => e.score ?? 0)));
    mk('capability', cap, { score: avg, sampleSize: evs.length, successRate: avg, failureRate: clamp(1 - avg), avgEvaluationScore: avg, avgValidationScore: 0, incidentRate: 0, repairSuccessRate: 0, trend: trendOf(evs.map((e) => ({ createdAt: e.createdAt, ok: (e.score ?? 0) >= 0.7 }))), confidence: clamp(evs.length / 10) });
  }

  // Plan types — from plan_scores grouped by label.
  const labels = new Set<string>();
  for (const p of b.planScores ?? []) if (p.label) labels.add(p.label);
  for (const label of labels) {
    const ps = (b.planScores ?? []).filter((p) => p.label === label);
    const avg = clamp(mean(ps.map((p) => p.total ?? 0)));
    mk('plan_type', label, { score: avg, sampleSize: ps.length, successRate: avg, failureRate: clamp(1 - avg), avgEvaluationScore: avg, avgValidationScore: 0, incidentRate: 0, repairSuccessRate: 0, trend: 'unknown', confidence: clamp(ps.length / 10) });
  }

  // Repair types — from repair_plans grouped by planType.
  const rtypes = new Set<string>();
  for (const p of b.repairPlans ?? []) if (p.planType) rtypes.add(p.planType);
  const resolvedIncidents = (b.incidents ?? []).filter((i) => i.status === 'resolved').length;
  const totalIncidents = (b.incidents ?? []).length || 1;
  for (const rt of rtypes) {
    const ps = (b.repairPlans ?? []).filter((p) => p.planType === rt);
    const rate = clamp(resolvedIncidents / totalIncidents);
    mk('repair_type', rt, { score: rate, sampleSize: ps.length, successRate: rate, failureRate: clamp(1 - rate), avgEvaluationScore: 0, avgValidationScore: 0, incidentRate: 0, repairSuccessRate: rate, trend: 'unknown', confidence: clamp(ps.length / 5) });
  }

  return out;
}

// ===========================================================================
// Pattern miner
// ===========================================================================
export function minePatterns(b: HistoryBundle, scores: ReliabilityScore[]): OperationalPattern[] {
  const now = nowIso();
  const out: OperationalPattern[] = [];
  const mk = (patternType: OperationalPattern['patternType'], title: string, description: string, confidence: number, supportCount: number, recommendedAction: string, relatedRecords: string[] = []): void => {
    out.push({ patternId: genId('pat'), patternType, title, description, confidence: clamp(confidence), supportCount, relatedRecords, recommendedAction, status: 'observed', createdAt: now, updatedAt: now });
  };

  // Success: best plan type by avg score.
  const planScores = scores.filter((s) => s.targetType === 'plan_type');
  if (planScores.length) {
    const best = [...planScores].sort((a, b2) => b2.score - a.score)[0]!;
    mk('success', `${best.targetId} performs best`, `Across ${best.sampleSize} scored plans, ${best.targetId} has the highest average score (${best.score}).`, 0.6 + 0.3 * Math.min(1, best.sampleSize / 5), best.sampleSize, `Prefer ${best.targetId} for similar goals; consider a scoring nudge.`);
  }

  // Success: validation-before-deploy prevents incidents.
  const passedVals = (b.validations ?? []).filter((v) => v.passed).length;
  if (passedVals > 0) {
    mk('success', 'Runtime validation before deployment prevents incidents', `${passedVals} validations passed before activation; services validated first show fewer incidents.`, 0.7, passedVals, 'Keep validation mandatory before activation (add_validation).');
  }

  // Success: a repair type resolves most failures.
  const repairTypes = scores.filter((s) => s.targetType === 'repair_type');
  const bestRepair = [...repairTypes].sort((a, b2) => b2.successRate - a.successRate)[0];
  if (bestRepair && bestRepair.successRate > 0.5) {
    mk('success', `${bestRepair.targetId} resolves most activation failures`, `Repair type ${bestRepair.targetId} resolved the majority of incidents (rate ${bestRepair.successRate}).`, bestRepair.successRate, bestRepair.sampleSize, `Codify ${bestRepair.targetId} as a reusable repair skill.`);
  }

  // Failure: domain/unreachable is the most common activation failure.
  const domainIncs = (b.incidents ?? []).filter((i) => /unreachable|domain|not deployed/i.test(i.detail ?? ''));
  if (domainIncs.length > 0) {
    mk('failure', 'Domain unreachability is the most common activation failure', `${domainIncs.length} incident(s) cite unreachable domain / not deployed after checklist confirmation.`, 0.6 + 0.3 * Math.min(1, domainIncs.length / 3), domainIncs.length, 'Add pre-deployment DNS/domain verification (add_validation / create_skill).');
  }

  // Weak point: overestimating plans.
  const over = (b.outcomeReviews ?? []).filter((o) => o.predictedVsActual === 'overestimated').length;
  if (over > 0) {
    mk('weak_point', 'Plans overestimate success vs actual outcomes', `${over} outcome review(s) found the predicted score exceeded the actual evaluation.`, 0.55, over, 'Increase evidenceAvailability weight (improve_scoring).');
  }

  // Weak point: low-reliability services.
  for (const s of scores.filter((x) => x.targetType === 'service' && x.score < 0.6 && x.sampleSize > 0)) {
    mk('weak_point', `${s.targetId} reliability is low`, `${s.targetId} scored ${s.score} over ${s.sampleSize} samples (success ${s.successRate}, incidents ${s.incidentRate}).`, clamp(1 - s.score), s.sampleSize, `Improve ${s.targetId} (improve_service / add_monitor).`);
  }

  return out;
}

// ===========================================================================
// Recommendations
// ===========================================================================
export function buildRecommendations(patterns: OperationalPattern[], scores: ReliabilityScore[]): SystemRecommendation[] {
  const now = nowIso();
  const out: SystemRecommendation[] = [];
  const mk = (type: SystemRecommendation['type'], title: string, reason: string, p: OperationalPattern, expectedImpact: string, riskLevel: SystemRecommendation['riskLevel'] = 'low'): void => {
    // Every recommendation is evidence-backed: the source pattern + its support count + related records.
    const evidence = [`pattern:${p.patternId}`, `support_count:${p.supportCount}`, `confidence:${p.confidence}`, ...p.relatedRecords];
    out.push({ recommendationId: genId('rec'), learningRunId: null, type, title, reason, evidence, relatedPatternIds: [p.patternId], expectedImpact, riskLevel, requiredApproval: true, status: 'waiting_approval', convertedTo: null, convertedId: null, createdAt: now, updatedAt: now });
  };

  for (const p of patterns) {
    if (p.patternType === 'failure' && /domain/i.test(p.title)) {
      mk('create_skill', 'Add pre-deployment domain/DNS verification', `${p.description} A reusable pre-deploy check would prevent the most common activation failure.`, p, 'Fewer activation failures and incidents.', 'low');
    }
    if (p.patternType === 'weak_point' && /overestimate/i.test(p.title)) {
      mk('improve_scoring', 'Increase evidenceAvailability weight', `${p.description} Scoring should weight evidence over speed.`, p, 'Predictions track real outcomes more closely.', 'low');
    }
    if (p.patternType === 'weak_point' && /reliability is low/i.test(p.title)) {
      mk('improve_service', `Improve ${p.title.replace(' reliability is low', '')}`, p.description, p, 'Higher service reliability.', 'medium');
    }
    if (p.patternType === 'success' && /performs best/i.test(p.title)) {
      mk('update_skill', 'Reinforce the best-performing plan strategy', p.description, p, 'Faster convergence on high-value plans.', 'low');
    }
  }
  return out;
}

// ===========================================================================
// Prompt performance
// ===========================================================================
export function computePromptPerformance(b: HistoryBundle): PromptPerformance[] {
  const now = nowIso();
  const groups = new Map<string, NonNullable<HistoryBundle['llmTraces']>>();
  for (const t of b.llmTraces ?? []) {
    const key = `${t.promptVersion ?? 'v0'}::${t.taskType ?? 'unknown'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const out: PromptPerformance[] = [];
  for (const [key, traces] of groups) {
    const [promptVersion, taskType] = key.split('::');
    const n = traces.length;
    const validRate = clamp(traces.filter((t) => t.valid).length / n);
    const fallbackRate = clamp(traces.filter((t) => t.usedFallback).length / n);
    const invalidRate = clamp(traces.filter((t) => !t.valid).length / n);
    const avgCostUsd = Number(mean(traces.map((t) => t.costUsd ?? 0)).toFixed(5));
    const avgTokens = Math.round(mean(traces.map((t) => (t.tokensIn ?? 0) + (t.tokensOut ?? 0))));
    const recommendImprovement = fallbackRate > 0.5 || invalidRate > 0.2 || avgCostUsd > 0.05;
    const reason = fallbackRate > 0.5 ? 'High fallback rate — configure a real provider for genuine reasoning.' : invalidRate > 0.2 ? 'High invalid-output rate — tighten the prompt/schema.' : avgCostUsd > 0.05 ? 'High average cost — consider a cheaper model or shorter prompt.' : 'Healthy.';
    out.push({ promptPerfId: genId('pp'), promptKey: taskType ?? 'unknown', promptVersion: promptVersion ?? 'v0', taskType: taskType ?? 'unknown', sampleSize: n, validRate, fallbackRate, invalidRate, avgCostUsd, avgTokens, recommendImprovement, reason, lastUpdatedAt: now });
  }
  return out;
}

// ===========================================================================
// Memory compression
// ===========================================================================
export function buildMemorySummaries(b: HistoryBundle, scores: ReliabilityScore[], patterns: OperationalPattern[]): { summaries: MemorySummary[]; context: Omit<CompressedContext, 'learningRunId'> } {
  const now = nowIso();
  const memIds = (b.memories ?? []).map((m) => m.memoryId).filter(Boolean) as string[];
  const evIds = (b.evidence ?? []).map((e) => e.evidenceId).filter(Boolean) as string[];

  const topServices = scores.filter((s) => s.targetType === 'service').sort((a, b2) => b2.score - a.score);
  const keyFacts = [
    ...topServices.slice(0, 3).map((s) => `${s.targetId} reliability ${s.score} (${s.trend}, n=${s.sampleSize})`),
    ...patterns.filter((p) => p.patternType === 'success').slice(0, 2).map((p) => `Success: ${p.title}`),
    ...patterns.filter((p) => p.patternType !== 'success').slice(0, 2).map((p) => `Watch: ${p.title}`),
  ];

  const systemSummary: MemorySummary = {
    summaryId: genId('sum'), scope: 'system', scopeId: null, timeWindow: 'all',
    sourceMemoryIds: memIds, sourceEvidenceIds: evIds, tokenBudget: 400,
    compressedText: `System learned from ${memIds.length} memories and ${(b.activations ?? []).length} activations. ${patterns.length} pattern(s) found. ${keyFacts.slice(0, 4).join('; ')}.`,
    keyFacts,
    openQuestions: patterns.some((p) => p.patternType === 'weak_point') ? ['Address the weakest service before scaling.'] : [],
    nextActions: patterns.filter((p) => p.recommendedAction).slice(0, 3).map((p) => p.recommendedAction),
    createdAt: now,
  };

  const summaries: MemorySummary[] = [systemSummary];
  for (const s of topServices.filter((x) => x.score < 0.6).slice(0, 2)) {
    summaries.push({ summaryId: genId('sum'), scope: 'service', scopeId: s.targetId, timeWindow: 'all', sourceMemoryIds: [], sourceEvidenceIds: [], tokenBudget: 200, compressedText: `${s.targetId}: reliability ${s.score} (${s.trend}); success ${s.successRate}, incidents ${s.incidentRate}.`, keyFacts: [`needs attention: ${s.targetId}`], openQuestions: [], nextActions: [`Improve ${s.targetId}`], createdAt: now });
  }

  const context: Omit<CompressedContext, 'learningRunId'> = { contextId: genId('ctx'), tokenBudget: 800, compressedText: systemSummary.compressedText, keyFacts, createdAt: now };
  return { summaries, context };
}
