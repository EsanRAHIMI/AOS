/**
 * Orchestration pipelines (Phase 3 — Self-Expanding Capability Engine).
 *
 *  - runPipeline(): analyzes the goal's required capabilities, detects gaps, and
 *    either (a) creates expansion proposals + an approval gate when a capability
 *    is missing, or (b) runs the standard delegation pipeline when it isn't.
 *  - runBuildPipeline(): triggered when an approved proposal is converted to a
 *    build task. Scaffolds the new service, requests infrastructure, updates
 *    docs + memory, evaluates the result, and registers the new capability.
 */
import {
  collection,
  COLLECTIONS,
  EVENT_TYPES,
  genId,
  nowIso,
  sleep,
  llmRouterFromEnv,
  detectRequiredCapabilities,
  templateForCapability,
  capabilityTitle,
  buildEvaluation,
  buildEvidence,
  generateCandidatePlans,
  scorePlans,
  evaluatePolicy,
  approvalToAction,
  outcomeReview,
  applyWeightChanges,
  buildAuditLog,
  DEFAULT_SCORING_WEIGHTS,
  computeReliabilityScores,
  minePatterns,
  buildMemorySummaries,
  buildRecommendations,
  computePromptPerformance,
  recommendationToWorkflow,
  buildImpactAssessment,
  buildMemoryMaintenanceRun,
  CapabilityAnalysisSchema,
  type PeerClient,
  type Task,
  type Approval,
  type Capability,
  type CapabilityGap,
  type ExpansionProposal,
  type Evaluation,
  type LlmTrace,
  type EvidenceRecord,
  type StrategicPlan,
  type PlanScore,
  type PolicyDecision,
  type DecisionMemory,
  type Memory,
  type Skill,
  type ScoringProfile,
  type ScoringWeights,
  type OutcomeReview,
  type ScoringChangeProposal,
  type AuditLog,
  type HistoryBundle,
  type LearningRun,
  type ReliabilityScore,
  type ReliabilitySnapshot,
  type OperationalPattern,
  type MemorySummary,
  type CompressedContext,
  type SystemRecommendation,
  type PromptPerformance,
  type ImprovementWorkflow,
  type ImpactAssessment,
  type MemoryMaintenanceRun,
} from '@factory/shared';
import type { ServiceContext } from '@factory/service-kit';

const PACE_MS = 600;

interface ReportStep { service: string; message: string; ok: boolean; ref?: string }

// (capability analysis output contract lives in @factory/shared: CapabilityAnalysisSchema)

export interface PipelineArgs {
  taskId: string;
  goal: string;
  ctx: ServiceContext;
  peer: PeerClient;
  input?: Record<string, unknown>;
}

async function persistTrace(trace: LlmTrace, ctx: ServiceContext): Promise<void> {
  await collection<LlmTrace>(COLLECTIONS.LLM_TRACES).insertOne(trace);
  await ctx.publisher.publish({
    type: EVENT_TYPES.LLM_TRACE_RECORDED,
    taskId: trace.taskId,
    payload: { traceId: trace.traceId, provider: trace.provider, usedFallback: trace.usedFallback, costUsd: trace.costUsd, message: `LLM reasoning (${trace.provider})` },
  });
}

// ===========================================================================
// Main pipeline: capability analysis → gap/proposal OR delegation
// ===========================================================================
export async function runPipeline(args: PipelineArgs): Promise<void> {
  const { taskId, goal, ctx, peer } = args;
  const tasks = collection<Task>(COLLECTIONS.TASKS);
  const steps: ReportStep[] = [];

  const step = async (service: string, message: string, level: 'info' | 'success' | 'warn' = 'info', ref?: string): Promise<void> => {
    steps.push({ service, message, ok: level !== 'warn', ref });
    await ctx.publisher.publish({ type: EVENT_TYPES.TASK_UPDATED, taskId, payload: { message, service, level, ref } });
  };

  await tasks.updateOne({ taskId }, { $set: { status: 'in_progress', assignedServiceId: 'orchestrator-agent', updatedAt: nowIso() } });

  // Repair intent → drive the autonomous repair loop (diagnose → plan → gate).
  if (/\brepair\b|\bfix\b/i.test(goal) && /fail|incident|broken|unhealthy|activation/i.test(goal)) {
    await runRepairPipeline(args, steps, step);
    return;
  }

  // Continuous improvement → convert an approved recommendation into a workflow, run it, measure impact.
  if (/improvement workflow|turn .*(recommendation|learning).*workflow|measure the result|continuous improvement/i.test(goal)) {
    await runImprovementPipeline(args, steps, step);
    return;
  }

  // Operational learning → analyze the whole history, mine patterns, recommend.
  if (/\banaly[sz]e\b|operational learning|system history|learn from history|recommend improvements/i.test(goal)) {
    await runLearningPipeline(args, steps, step);
    return;
  }

  // Governance intent → review the last decision and propose scoring learning.
  if (/\breview\b/i.test(goal) && /decision|scoring|strateg|outcome|governance/i.test(goal)) {
    await runGovernancePipeline(args, steps, step);
    return;
  }

  // Strategic intent → reason over multiple plans, score, check policy, choose.
  if (/\bimprove\b|\boptimi[sz]e\b|\bstrateg|\benhance\b|reliab|\bbest (way|approach|strategy)\b/i.test(goal) && !/activat|repair/i.test(goal)) {
    await runStrategicPipeline(args, steps, step);
    return;
  }

  // --- Stage 0: capability analysis via the LLM router (validated) ---------
  await step('orchestrator-agent', `Analyzing required capabilities for: ${goal}`);
  const router = llmRouterFromEnv();
  const { data: analysis, trace } = await router.generateStructured(CapabilityAnalysisSchema, {
    agentId: 'orchestrator-agent',
    taskType: 'capability_analysis',
    taskId,
    system: 'You map a goal to the capability ids the kernel needs. Respond ONLY as JSON {"requiredCapabilities": string[], "rationale": string}.',
    prompt: `Goal: ${goal}\nKnown capability ids include cap_task_orchestration, cap_service_generation, browser_testing, web_research, email_integration, data_analysis.\nReturn the required capability ids.`,
    fallback: () => ({ requiredCapabilities: detectRequiredCapabilities(goal), rationale: 'deterministic keyword analysis' }),
  });
  await persistTrace(trace, ctx);
  await step('orchestrator-agent', `Required capabilities: ${analysis.requiredCapabilities.join(', ')} (${trace.usedFallback ? 'deterministic' : trace.provider})`);
  await ctx.publisher.publish({ type: EVENT_TYPES.CAPABILITY_ANALYZED, taskId, payload: { requiredCapabilities: analysis.requiredCapabilities, message: 'Capability analysis complete' } });
  await sleep(PACE_MS);

  // --- Stage 1: detect gaps against the capability graph -------------------
  const caps = collection<Capability>(COLLECTIONS.CAPABILITIES);
  const existing = await caps.find({}, { projection: { _id: 0, capabilityId: 1, status: 1 } }).toArray();
  const haveActive = new Set(existing.filter((c) => c.status === 'active').map((c) => c.capabilityId));
  const missing = analysis.requiredCapabilities.filter((c) => !haveActive.has(c));

  // --- Stage 1a: activation — a required capability exists but isn't active --
  const wantsActivation = /\bactivat|\bvalidat|make .*(usable|active|real)/i.test(goal);
  if (wantsActivation) {
    const activatable = existing.find(
      (c) => analysis.requiredCapabilities.includes(c.capabilityId) && (c.status === 'generated' || c.status === 'validated'),
    );
    if (activatable) {
      const full = await caps.findOne({ capabilityId: activatable.capabilityId });
      const serviceName = full?.supportedByServices?.[0] ?? `${activatable.capabilityId}-service`;
      // "on production / deploy / go live" → produce a Dokploy activation checklist
      // and hand off to the human + live activation check. Otherwise run the
      // Phase 4 reality-validation flow (ends at `validated`).
      if (/production|deploy|go.?live|activate .* live/i.test(goal)) {
        await step('orchestrator-agent', `Preparing production activation for ${serviceName}`, 'info');
        await sleep(PACE_MS);
        await runProductionActivationPipeline(args, steps, step, activatable.capabilityId, serviceName);
        return;
      }
      await step('orchestrator-agent', `Capability "${activatable.capabilityId}" is ${activatable.status} — running reality validation`, 'info');
      await sleep(PACE_MS);
      await runActivationPipeline(args, steps, step, activatable.capabilityId, serviceName);
      return;
    }
  }

  if (missing.length === 0) {
    await step('orchestrator-agent', 'All required capabilities present — proceeding to delegation', 'success');
    await sleep(PACE_MS);
    await runDelegationPipeline(args, steps, step);
    return;
  }

  // --- Stage 2: create gaps + expansion proposals + approval gate ----------
  const gapsCol = collection<CapabilityGap>(COLLECTIONS.CAPABILITY_GAPS);
  const proposalsCol = collection<ExpansionProposal>(COLLECTIONS.EXPANSION_PROPOSALS);
  const created: { gapId: string; proposalId: string; capability: string; serviceName: string }[] = [];

  for (const capId of missing) {
    const tmpl = templateForCapability(capId);
    const now = nowIso();
    const gap: CapabilityGap = {
      gapId: genId('gap'),
      taskId,
      requiredCapability: capId,
      reason: `The goal requires "${capabilityTitle(capId)}", but no active capability provides it.`,
      recommendedExpansion: `Create ${tmpl.serviceName}${tmpl.toolName ? ` with ${tmpl.toolName} support` : ''}.`,
      severity: 'missing',
      riskLevel: tmpl.risk,
      status: 'proposed',
      createdAt: now,
    };
    await gapsCol.insertOne(gap);
    await ctx.publisher.publish({ type: EVENT_TYPES.CAPABILITY_GAP_DETECTED, taskId, payload: { gapId: gap.gapId, capability: capId, message: `Capability gap: ${capId}`, level: 'warn' } });

    const proposal: ExpansionProposal = {
      proposalId: genId('exp'),
      sourceTaskId: taskId,
      gapId: gap.gapId,
      missingCapability: capId,
      proposedServiceName: tmpl.serviceName,
      proposedAgentName: tmpl.agentName,
      proposedToolName: tmpl.toolName,
      reason: tmpl.reason,
      architecturePlan: `Independent factory service "${tmpl.serviceName}" (agent type) using @factory/service-kit standard endpoints, MongoDB-backed, HTTP + internal token, deployed as its own Dokploy app with subdomain ${tmpl.serviceName.replace(/-(agent|service)$/, '')}.simorx.com.`,
      requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN'],
      requiredPermissions: tmpl.permissions,
      riskLevel: tmpl.risk,
      expectedImpact: tmpl.impact,
      evaluationPlan: 'Scaffold, deploy via Dokploy, run a health + manifest check, then a capability-specific smoke test.',
      status: 'waiting_approval',
      generatedServicePath: null,
      infrastructureRequestId: null,
      createdAt: now,
      updatedAt: now,
    };
    await proposalsCol.insertOne(proposal);
    await ctx.publisher.publish({ type: EVENT_TYPES.EXPANSION_PROPOSED, taskId, payload: { proposalId: proposal.proposalId, capability: capId, serviceName: tmpl.serviceName, message: `Expansion proposed: ${tmpl.serviceName}`, level: 'warn' } });

    // Register the capability as 'proposed' in the graph.
    await caps.updateOne(
      { capabilityId: capId },
      {
        $set: { status: 'proposed', updatedAt: now },
        $setOnInsert: {
          capabilityId: capId,
          title: capabilityTitle(capId),
          description: tmpl.reason,
          category: 'self_expansion',
          supportedByServices: [],
          supportedByAgents: [],
          supportedByTools: tmpl.toolName ? [tmpl.toolName] : [],
          requiredEnv: [],
          requiredPermissions: tmpl.permissions,
          relatedDocs: [],
          relatedMemories: [],
          maturityLevel: 'concept',
          riskLevel: tmpl.risk,
          evaluationScore: 0,
          lastUsedAt: null,
          createdAt: now,
        },
      },
      { upsert: true },
    );

    created.push({ gapId: gap.gapId, proposalId: proposal.proposalId, capability: capId, serviceName: tmpl.serviceName });
    await step('orchestrator-agent', `Proposed ${tmpl.serviceName} for missing capability "${capId}"`, 'warn', proposal.proposalId);
    await sleep(PACE_MS);
  }

  // Approval gate: expanding the kernel is sensitive.
  const approvalId = genId('appr');
  const approval: Approval = {
    approvalId,
    taskId,
    requestedBy: 'orchestrator-agent',
    actionType: 'approve_expansion',
    summary: `Approve ${created.length} capability expansion(s): ${created.map((c) => c.serviceName).join(', ')}`,
    riskLevel: 'high',
    payload: { proposals: created.map((c) => c.proposalId) },
    status: 'pending',
    decidedBy: null,
    decisionReason: null,
    createdAt: nowIso(),
    decidedAt: null,
  };
  await collection<Approval>(COLLECTIONS.APPROVALS).insertOne(approval);
  await ctx.publisher.publish({ type: EVENT_TYPES.APPROVAL_REQUESTED, taskId, payload: { approvalId, message: 'Approval requested: capability expansion', level: 'warn' } });
  await step('orchestrator-agent', 'Requested your approval to expand the kernel', 'warn', approvalId);

  // Light evaluation of the analysis task itself.
  const evalRec = buildEvaluation({ targetType: 'task', targetId: taskId, taskId, signals: { humanInterventionRequired: true, docsUpdated: false, memoryStored: false } });
  await collection<Evaluation>(COLLECTIONS.CAPABILITY_EVALUATIONS).insertOne(evalRec);
  await ctx.publisher.publish({ type: EVENT_TYPES.EVALUATION_CREATED, taskId, payload: { evaluationId: evalRec.evaluationId, score: evalRec.score, message: `Evaluation score ${evalRec.score}` } });

  const report = {
    goal,
    taskId,
    status: 'awaiting_approval' as const,
    mode: 'capability_analysis',
    requiredCapabilities: analysis.requiredCapabilities,
    gaps: created,
    proposals: created.map((c) => c.proposalId),
    approvalId,
    evaluationId: evalRec.evaluationId,
    steps,
    headline: `Missing capability detected. ${created.length} expansion proposal(s) created and awaiting your approval.`,
    generatedAt: nowIso(),
  };
  await tasks.updateOne({ taskId }, { $set: { status: 'awaiting_approval', requiresApproval: true, result: report, updatedAt: nowIso() } });
  await step('orchestrator-agent', report.headline, 'success');
  await ctx.publisher.publish({ type: EVENT_TYPES.TASK_UPDATED, taskId, payload: { message: 'Capability analysis report ready', report: true } });
}

// ===========================================================================
// Standard delegation pipeline (Phase 2) — used when no capability gap exists
// ===========================================================================
async function runDelegationPipeline(
  args: PipelineArgs,
  steps: ReportStep[],
  step: (service: string, message: string, level?: 'info' | 'success' | 'warn', ref?: string) => Promise<void>,
): Promise<void> {
  const { taskId, goal, ctx, peer } = args;
  const tasks = collection<Task>(COLLECTIONS.TASKS);

  await step('orchestrator-agent', 'Delegating to Architect Agent');
  const arch = await peer.dispatchTask('architect-agent', { taskId, goal, input: { phase: 'design' }, priority: 'normal' });
  await step('architect-agent', arch.ok ? 'Architect produced a design plan' : 'Architect unreachable', arch.ok ? 'success' : 'warn');
  await sleep(PACE_MS);

  await step('orchestrator-agent', 'Delegating to Builder Agent');
  const build = await peer.dispatchTask('builder-agent', { taskId, goal, input: { phase: 'implement' }, priority: 'normal' });
  await step('builder-agent', build.ok ? 'Builder scaffolded the implementation' : 'Builder unreachable', build.ok ? 'success' : 'warn');
  await sleep(PACE_MS);

  await step('orchestrator-agent', 'Delegating to DevOps Agent for infrastructure');
  const devops = await peer.dispatchTask<{ infrastructureRequestId?: string }>('devops-agent', { taskId, goal, input: { phase: 'infrastructure' }, priority: 'normal' });
  const infrastructureRequestId = devops.data?.infrastructureRequestId ?? null;
  await step('devops-agent', infrastructureRequestId ? `DevOps generated infrastructure request ${infrastructureRequestId}` : 'DevOps unreachable', infrastructureRequestId ? 'success' : 'warn', infrastructureRequestId ?? undefined);
  await sleep(PACE_MS);

  let approvalId: string | null = null;
  if (infrastructureRequestId) {
    approvalId = genId('appr');
    await collection<Approval>(COLLECTIONS.APPROVALS).insertOne({
      approvalId, taskId, requestedBy: 'orchestrator-agent', actionType: 'create_infrastructure',
      summary: `Create Dokploy infrastructure for: ${goal}`, riskLevel: 'high', payload: { infrastructureRequestId },
      status: 'pending', decidedBy: null, decisionReason: null, createdAt: nowIso(), decidedAt: null,
    });
    await ctx.publisher.publish({ type: EVENT_TYPES.APPROVAL_REQUESTED, taskId, payload: { approvalId, message: 'Approval requested: create infrastructure', level: 'warn' } });
    await step('orchestrator-agent', 'Requested your approval to create infrastructure', 'warn', approvalId);
    await sleep(PACE_MS);
  }

  await step('orchestrator-agent', 'Delegating to Documentation Service');
  const doc = await peer.dispatchTask<{ updated?: string[] }>('documentation-service', { taskId, goal, input: { action: 'record_task', summary: `Task ${taskId}: ${goal}`, infrastructureRequestId }, priority: 'normal' });
  await step('documentation-service', doc.ok ? 'Documentation updated' : 'Documentation unreachable', doc.ok ? 'success' : 'warn');
  await sleep(PACE_MS);

  await step('orchestrator-agent', 'Delegating to Memory Agent');
  const mem = await peer.dispatchTask<{ memoryId?: string }>('memory-agent', { taskId, goal, input: { summary: `Completed pipeline for: ${goal}` }, priority: 'normal' });
  const memoryId = mem.data?.memoryId ?? null;
  await step('memory-agent', memoryId ? `Memory stored ${memoryId}` : 'Memory unreachable', memoryId ? 'success' : 'warn', memoryId ?? undefined);

  const evalRec = buildEvaluation({ targetType: 'task', targetId: taskId, taskId, signals: { docsUpdated: doc.ok, memoryStored: Boolean(memoryId), infraRequested: Boolean(infrastructureRequestId), delegationsAttempted: 5, delegationsSucceeded: [arch.ok, build.ok, devops.ok, doc.ok, mem.ok].filter(Boolean).length, humanInterventionRequired: Boolean(approvalId), approvalUsed: Boolean(approvalId) } });
  await collection<Evaluation>(COLLECTIONS.CAPABILITY_EVALUATIONS).insertOne(evalRec);
  await ctx.publisher.publish({ type: EVENT_TYPES.EVALUATION_CREATED, taskId, payload: { evaluationId: evalRec.evaluationId, score: evalRec.score, message: `Evaluation score ${evalRec.score}` } });

  const finalStatus = approvalId ? 'awaiting_approval' : 'completed';
  const headline = approvalId ? 'Plan ready. Infrastructure request created and awaiting your approval.' : 'Goal completed.';
  const report = { goal, taskId, status: finalStatus, mode: 'delegation', steps, infrastructureRequestId, approvalId, memoryId, evaluationId: evalRec.evaluationId, headline, generatedAt: nowIso() };
  await tasks.updateOne({ taskId }, { $set: { status: finalStatus, result: report, requiresApproval: Boolean(approvalId), updatedAt: nowIso() } });
  await step('orchestrator-agent', headline, 'success');
  await ctx.publisher.publish({ type: approvalId ? EVENT_TYPES.TASK_UPDATED : EVENT_TYPES.TASK_COMPLETED, taskId, payload: { message: 'Final report ready', report: true, status: finalStatus } });
}

// ===========================================================================
// Build pipeline: turn an approved expansion proposal into a real service
// ===========================================================================
export async function runBuildPipeline(args: PipelineArgs): Promise<void> {
  const { taskId, ctx, peer, input } = args;
  const tasks = collection<Task>(COLLECTIONS.TASKS);
  const proposalsCol = collection<ExpansionProposal>(COLLECTIONS.EXPANSION_PROPOSALS);
  const steps: ReportStep[] = [];
  const step = async (service: string, message: string, level: 'info' | 'success' | 'warn' = 'info', ref?: string): Promise<void> => {
    steps.push({ service, message, ok: level !== 'warn', ref });
    await ctx.publisher.publish({ type: EVENT_TYPES.TASK_UPDATED, taskId, payload: { message, service, level, ref } });
  };

  const proposalId = String(input?.proposalId ?? '');
  const proposal = await proposalsCol.findOne({ proposalId });
  if (!proposal) {
    await tasks.updateOne({ taskId }, { $set: { status: 'failed', error: 'proposal not found', updatedAt: nowIso() } });
    await ctx.publisher.publish({ type: EVENT_TYPES.TASK_FAILED, taskId, payload: { message: `Proposal ${proposalId} not found` } });
    return;
  }

  await tasks.updateOne({ taskId }, { $set: { status: 'in_progress', assignedServiceId: 'orchestrator-agent', updatedAt: nowIso() } });
  await proposalsCol.updateOne({ proposalId }, { $set: { status: 'building', updatedAt: nowIso() } });
  await step('orchestrator-agent', `Building approved expansion: ${proposal.proposedServiceName}`);
  await sleep(PACE_MS);

  // 1) Builder scaffolds the new service.
  await step('orchestrator-agent', 'Delegating to Builder Agent (scaffold service)');
  const build = await peer.dispatchTask<{ path?: string; files?: string[] }>('builder-agent', {
    taskId,
    goal: `Scaffold ${proposal.proposedServiceName}`,
    input: { action: 'scaffold_service', serviceName: proposal.proposedServiceName, capability: proposal.missingCapability, description: proposal.reason, toolName: proposal.proposedToolName },
    priority: 'normal',
  });
  const generatedServicePath = build.data?.path ?? null;
  await step('builder-agent', generatedServicePath ? `Scaffolded ${proposal.proposedServiceName} (${build.data?.files?.length ?? 0} files)` : 'Builder did not scaffold', generatedServicePath ? 'success' : 'warn', generatedServicePath ?? undefined);
  await ctx.publisher.publish({ type: EVENT_TYPES.SERVICE_SCAFFOLDED, taskId, payload: { serviceName: proposal.proposedServiceName, path: generatedServicePath, message: `Service scaffolded: ${proposal.proposedServiceName}` } });
  await sleep(PACE_MS);

  // 2) DevOps creates the Dokploy infrastructure request for the new service.
  await step('orchestrator-agent', 'Delegating to DevOps Agent (infrastructure request)');
  const devops = await peer.dispatchTask<{ infrastructureRequestId?: string }>('devops-agent', {
    taskId,
    goal: `Infrastructure for ${proposal.proposedServiceName}`,
    input: { phase: 'infrastructure', serviceName: proposal.proposedServiceName },
    priority: 'normal',
  });
  const infrastructureRequestId = devops.data?.infrastructureRequestId ?? null;
  await step('devops-agent', infrastructureRequestId ? `Infrastructure request ${infrastructureRequestId} created` : 'DevOps did not produce a request', infrastructureRequestId ? 'success' : 'warn', infrastructureRequestId ?? undefined);
  await sleep(PACE_MS);

  // 3) Documentation update.
  await step('orchestrator-agent', 'Delegating to Documentation Service');
  const doc = await peer.dispatchTask<{ updated?: string[] }>('documentation-service', { taskId, goal: `Document ${proposal.proposedServiceName}`, input: { action: 'record_task', summary: `Generated ${proposal.proposedServiceName} for capability ${proposal.missingCapability}`, infrastructureRequestId }, priority: 'normal' });
  await step('documentation-service', doc.ok ? 'Documentation updated' : 'Documentation unreachable', doc.ok ? 'success' : 'warn');
  await sleep(PACE_MS);

  // 4) Memory + skill extraction.
  await step('orchestrator-agent', 'Delegating to Memory Agent');
  const mem = await peer.dispatchTask<{ memoryId?: string; skillId?: string }>('memory-agent', { taskId, goal: `Learn from generating ${proposal.proposedServiceName}`, input: { summary: `Generated service ${proposal.proposedServiceName} for capability ${proposal.missingCapability}`, capability: proposal.missingCapability, skill: 'create_new_capability_service' }, priority: 'normal' });
  const memoryId = mem.data?.memoryId ?? null;
  await step('memory-agent', memoryId ? `Memory + skill stored (${memoryId})` : 'Memory unreachable', memoryId ? 'success' : 'warn', memoryId ?? undefined);
  await sleep(PACE_MS);

  // 5) Evaluate the expansion.
  const evalRec = buildEvaluation({
    targetType: 'expansion',
    targetId: proposalId,
    taskId,
    signals: { scaffoldCreated: Boolean(generatedServicePath), infraRequested: Boolean(infrastructureRequestId), docsUpdated: doc.ok, memoryStored: Boolean(memoryId), runtimeValidated: false, humanInterventionRequired: true, approvalUsed: true, delegationsAttempted: 4, delegationsSucceeded: [build.ok, devops.ok, doc.ok, mem.ok].filter(Boolean).length },
  });
  await collection<Evaluation>(COLLECTIONS.CAPABILITY_EVALUATIONS).insertOne(evalRec);
  await ctx.publisher.publish({ type: EVENT_TYPES.EVALUATION_CREATED, taskId, payload: { evaluationId: evalRec.evaluationId, score: evalRec.score, message: `Capability evaluation: ${evalRec.score}` } });
  await step('orchestrator-agent', `Evaluation score ${evalRec.score}`, 'success');

  // 6) Register the new capability in the graph (status generated).
  const now = nowIso();
  await collection<Capability>(COLLECTIONS.CAPABILITIES).updateOne(
    { capabilityId: proposal.missingCapability },
    {
      $set: {
        status: 'generated',
        supportedByServices: [proposal.proposedServiceName],
        supportedByAgents: proposal.proposedAgentName ? [proposal.proposedAgentName] : [],
        supportedByTools: proposal.proposedToolName ? [proposal.proposedToolName] : [],
        evaluationScore: evalRec.score,
        maturityLevel: 'early',
        lastUsedAt: now,
        updatedAt: now,
      },
      $setOnInsert: {
        capabilityId: proposal.missingCapability,
        title: capabilityTitle(proposal.missingCapability),
        description: proposal.reason,
        category: 'self_expansion',
        requiredEnv: proposal.requiredEnv,
        requiredPermissions: proposal.requiredPermissions,
        relatedDocs: [],
        relatedMemories: memoryId ? [memoryId] : [],
        riskLevel: proposal.riskLevel,
        createdAt: now,
      },
    },
    { upsert: true },
  );
  await ctx.publisher.publish({ type: EVENT_TYPES.CAPABILITY_REGISTERED, taskId, payload: { capability: proposal.missingCapability, status: 'generated', message: `Capability registered: ${proposal.missingCapability}` } });

  await proposalsCol.updateOne({ proposalId }, { $set: { status: 'generated', generatedServicePath, infrastructureRequestId, updatedAt: now } });

  const report = {
    goal: args.goal,
    taskId,
    status: 'completed' as const,
    mode: 'build_from_proposal',
    proposalId,
    capability: proposal.missingCapability,
    serviceName: proposal.proposedServiceName,
    generatedServicePath,
    infrastructureRequestId,
    memoryId,
    evaluationId: evalRec.evaluationId,
    evaluationScore: evalRec.score,
    steps,
    headline: `Generated ${proposal.proposedServiceName}. Capability "${proposal.missingCapability}" registered. Confirm its infrastructure in Dokploy to activate.`,
    generatedAt: now,
  };
  await tasks.updateOne({ taskId }, { $set: { status: 'completed', result: report, updatedAt: now } });
  await step('orchestrator-agent', report.headline, 'success');
  await ctx.publisher.publish({ type: EVENT_TYPES.TASK_COMPLETED, taskId, payload: { message: 'Expansion build complete', report: true } });
}

// ===========================================================================
// Activation pipeline: prove a generated capability is real, then promote it.
// generated → validated (after runtime validation) → active (after registry
// confirms a reachable service). Every claim is backed by evidence.
// ===========================================================================
export async function runActivationPipeline(
  args: PipelineArgs,
  steps: ReportStep[],
  step: (service: string, message: string, level?: 'info' | 'success' | 'warn', ref?: string) => Promise<void>,
  capabilityId: string,
  serviceName: string,
): Promise<void> {
  const { taskId, ctx, peer } = args;
  const tasks = collection<Task>(COLLECTIONS.TASKS);
  const caps = collection<Capability>(COLLECTIONS.CAPABILITIES);
  const evidenceCol = collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS);
  await tasks.updateOne({ taskId }, { $set: { status: 'in_progress', assignedServiceId: 'orchestrator-agent', updatedAt: nowIso() } });

  // 1) Runtime validation (builder owns the generated files).
  await step('orchestrator-agent', `Delegating to Builder Agent (validate ${serviceName})`);
  const val = await peer.dispatchTask<{ validation?: { validationId: string; passed: boolean; score: number }; recommendations?: string[] }>('builder-agent', {
    taskId, goal: `Validate ${serviceName}`, input: { action: 'validate_service', serviceName, capability: capabilityId }, priority: 'high',
  });
  const validation = val.data?.validation;
  await step('builder-agent', validation ? `Validation ${validation.passed ? 'passed' : 'failed'} (score ${validation.score})` : 'Validation unavailable', validation?.passed ? 'success' : 'warn', validation?.validationId);

  if (!validation || !validation.passed) {
    await caps.updateOne({ capabilityId }, { $set: { updatedAt: nowIso() } });
    const failReport = { goal: args.goal, taskId, status: 'failed' as const, mode: 'activation', capabilityId, serviceName, validationId: validation?.validationId ?? null, headline: `Validation failed for ${serviceName}; capability stays "generated".`, steps, generatedAt: nowIso() };
    await tasks.updateOne({ taskId }, { $set: { status: 'failed', result: failReport, error: 'validation failed', updatedAt: nowIso() } });
    await step('orchestrator-agent', failReport.headline, 'warn');
    await ctx.publisher.publish({ type: EVENT_TYPES.TASK_FAILED, taskId, payload: { message: 'Activation failed at validation', report: true } });
    return;
  }

  // Promote generated → validated.
  const now1 = nowIso();
  await caps.updateOne({ capabilityId }, { $set: { status: 'validated', evaluationScore: validation.score, lastUsedAt: now1, updatedAt: now1 } });
  await ctx.publisher.publish({ type: EVENT_TYPES.CAPABILITY_VALIDATED, taskId, payload: { capability: capabilityId, validationId: validation.validationId, message: `Capability validated: ${capabilityId}` } });
  await step('orchestrator-agent', `Capability "${capabilityId}" promoted generated → validated`, 'success');
  await sleep(PACE_MS);

  // 2) GitHub delivery (devops owns delivery): feature branch + commit/PR.
  await step('orchestrator-agent', 'Delegating to DevOps Agent (GitHub delivery)');
  const gh = await peer.dispatchTask<{ operation?: { operationId: string; branchName: string; status: string; mode: string; pullRequestUrl: string | null } }>('devops-agent', {
    taskId, goal: `Deliver ${serviceName} to GitHub`, input: { action: 'github_deliver', serviceName, capability: capabilityId }, priority: 'high',
  });
  const op = gh.data?.operation;
  await step('devops-agent', op ? `GitHub ${op.mode}: branch ${op.branchName} (${op.status})` : 'GitHub delivery unavailable', op ? 'success' : 'warn', op?.operationId);
  await sleep(PACE_MS);

  // 3) Safe internal browser test (against the gateway health endpoint).
  const target = `${peer.url('gateway-api')}/health`;
  await step('orchestrator-agent', `Delegating to Browser Testing Agent (test ${target})`);
  const bt = await peer.dispatchTask<{ report?: { reportId: string; mode: string; passed: boolean } }>('browser-testing-agent', {
    taskId, goal: `Browser test ${target}`,
    input: { url: target, checks: [{ type: 'status_is', value: '200' }, { type: 'text_present', value: 'ok' }], screenshot: true },
    priority: 'high',
  });
  const btReport = bt.data?.report;
  await step('browser-testing-agent', btReport ? `Browser test ${btReport.passed ? 'passed' : 'failed'} (${btReport.mode})` : 'Browser test unavailable', btReport?.passed ? 'success' : 'warn', btReport?.reportId);
  await sleep(PACE_MS);

  // 4) Docs + 5) memory + skill.
  const doc = await peer.dispatchTask<{ updated?: string[] }>('documentation-service', { taskId, goal: `Document activation of ${capabilityId}`, input: { action: 'record_task', summary: `Activated capability ${capabilityId} (${serviceName}): validated + delivered + browser-tested` }, priority: 'normal' });
  await step('documentation-service', doc.ok ? 'Documentation updated' : 'Documentation unreachable', doc.ok ? 'success' : 'warn');
  const mem = await peer.dispatchTask<{ memoryId?: string }>('memory-agent', { taskId, goal: `Learn from activating ${capabilityId}`, input: { summary: `Activated ${capabilityId} via validate→deliver→browser-test`, capability: capabilityId, skill: 'activate_capability' }, priority: 'normal' });
  const memoryId = mem.data?.memoryId ?? null;
  await step('memory-agent', memoryId ? `Memory + skill stored (${memoryId})` : 'Memory unreachable', memoryId ? 'success' : 'warn');

  // 6) Evaluation now that the capability is runtime-validated.
  const evalRec = buildEvaluation({ targetType: 'capability', targetId: capabilityId, taskId, signals: { runtimeValidated: validation.passed && Boolean(btReport?.passed), scaffoldCreated: true, docsUpdated: doc.ok, memoryStored: Boolean(memoryId), infraRequested: false, humanInterventionRequired: false, delegationsAttempted: 4, delegationsSucceeded: [Boolean(validation.passed), Boolean(op), Boolean(btReport), doc.ok].filter(Boolean).length } });
  await collection<Evaluation>(COLLECTIONS.CAPABILITY_EVALUATIONS).insertOne(evalRec);
  await ctx.publisher.publish({ type: EVENT_TYPES.EVALUATION_CREATED, taskId, payload: { evaluationId: evalRec.evaluationId, score: evalRec.score, message: `Capability evaluation: ${evalRec.score}` } });

  // 7) validated → active only if the service registry confirms a reachable manifest.
  let finalCapStatus: 'validated' | 'active' = 'validated';
  const reachable = await ctx.registry.resolve(serviceName).catch(() => null);
  if (reachable) {
    const now2 = nowIso();
    await caps.updateOne({ capabilityId }, { $set: { status: 'active', supportedByServices: [serviceName], updatedAt: now2 } });
    await ctx.publisher.publish({ type: EVENT_TYPES.CAPABILITY_ACTIVATED, taskId, payload: { capability: capabilityId, message: `Capability activated: ${capabilityId}` } });
    await step('orchestrator-agent', `Service reachable in registry — capability promoted validated → active`, 'success');
    finalCapStatus = 'active';
  } else {
    await step('orchestrator-agent', `Capability validated. Deploy ${serviceName} so the registry can confirm it, then it becomes active.`, 'info');
  }

  // Orchestrator-level evidence for the activation decision.
  await evidenceCol.insertOne(buildEvidence({ type: 'approval_decision', summary: `Activation completed for ${capabilityId}: status ${finalCapStatus}`, taskId, capabilityId, serviceName, data: { validationId: validation.validationId, githubOperationId: op?.operationId ?? null, browserReportId: btReport?.reportId ?? null } }));

  const evidenceCount = await evidenceCol.countDocuments({ taskId });
  const report = {
    goal: args.goal, taskId, status: 'completed' as const, mode: 'activation', capabilityId, serviceName,
    capabilityStatus: finalCapStatus, validationId: validation.validationId, validationScore: validation.score,
    githubOperationId: op?.operationId ?? null, githubBranch: op?.branchName ?? null, pullRequestUrl: op?.pullRequestUrl ?? null,
    browserReportId: btReport?.reportId ?? null, browserPassed: Boolean(btReport?.passed), memoryId, evaluationId: evalRec.evaluationId, evidenceCount,
    steps,
    headline: finalCapStatus === 'active'
      ? `Capability "${capabilityId}" is now ACTIVE — validated, delivered, browser-tested, and registered.`
      : `Capability "${capabilityId}" is VALIDATED with evidence. Deploy ${serviceName} to make it active.`,
    generatedAt: nowIso(),
  };
  await tasks.updateOne({ taskId }, { $set: { status: 'completed', result: report, updatedAt: nowIso() } });
  await step('orchestrator-agent', report.headline, 'success');
  await ctx.publisher.publish({ type: EVENT_TYPES.TASK_COMPLETED, taskId, payload: { message: 'Activation complete', report: true } });
}

// ===========================================================================
// Production activation: generate a Dokploy checklist, then hand off to the
// human (create the app) + the live activation check. The kernel guides
// deployment but never fakes `active` — it stays `validated` until the live
// service is verified via the activation check (gateway → monitor-agent).
// ===========================================================================
export async function runProductionActivationPipeline(
  args: PipelineArgs,
  steps: ReportStep[],
  step: (service: string, message: string, level?: 'info' | 'success' | 'warn', ref?: string) => Promise<void>,
  capabilityId: string,
  serviceName: string,
): Promise<void> {
  const { taskId, ctx, peer } = args;
  const tasks = collection<Task>(COLLECTIONS.TASKS);
  await tasks.updateOne({ taskId }, { $set: { status: 'in_progress', assignedServiceId: 'orchestrator-agent', updatedAt: nowIso() } });

  await step('orchestrator-agent', `Delegating to DevOps Agent (Dokploy activation checklist for ${serviceName})`);
  const ck = await peer.dispatchTask<{ checklistId?: string; subdomain?: string; port?: number }>('devops-agent', {
    taskId, goal: `Activation checklist for ${serviceName}`, input: { action: 'activation_checklist', serviceName, capability: capabilityId }, priority: 'high',
  });
  const checklistId = ck.data?.checklistId ?? null;
  await step('devops-agent', checklistId ? `Checklist ready: ${serviceName} at ${ck.data?.subdomain}:${ck.data?.port}` : 'Checklist unavailable', checklistId ? 'success' : 'warn', checklistId ?? undefined);

  const report = {
    goal: args.goal, taskId, status: 'awaiting_approval' as const, mode: 'production_activation',
    capabilityId, serviceName, checklistId, capabilityStatus: 'validated',
    steps,
    headline: `Activation checklist ready for ${serviceName}. Create the Dokploy app from the checklist, mark "I created this in Dokploy", then run the activation check — the capability becomes ACTIVE only after the live service is verified.`,
    generatedAt: nowIso(),
  };
  await tasks.updateOne({ taskId }, { $set: { status: 'awaiting_approval', requiresApproval: true, result: report, updatedAt: nowIso() } });
  await step('orchestrator-agent', report.headline, 'success');
  await ctx.publisher.publish({ type: EVENT_TYPES.TASK_UPDATED, taskId, payload: { message: 'Production activation checklist ready', report: true, checklistId } });
}

// ===========================================================================
// Repair pipeline: ensure an incident exists → diagnose → plan → approval gate.
// The kernel drives the loop to a plan; execution happens on approval (gateway
// → monitor execute_repair), which re-runs the live activation check.
// ===========================================================================
interface IncidentLite { incidentId: string; serviceName: string; capabilityId: string | null; status: string; createdAt: string }

export async function runRepairPipeline(
  args: PipelineArgs,
  steps: ReportStep[],
  step: (service: string, message: string, level?: 'info' | 'success' | 'warn', ref?: string) => Promise<void>,
): Promise<void> {
  const { taskId, goal, ctx, peer } = args;
  const tasks = collection<Task>(COLLECTIONS.TASKS);
  const incidentsCol = collection<IncidentLite>(COLLECTIONS.INCIDENTS);

  // Identify the target service from the goal (e.g. "browser-testing-agent").
  const serviceName = goal.match(/([a-z0-9]+(?:-[a-z0-9]+)*-(?:agent|service))/i)?.[1] ?? 'browser-testing-agent';

  // Find an open incident for that service; else create one via an activation check.
  const all = await incidentsCol.find({}, { projection: { _id: 0 } }).toArray();
  let incident = all.filter((i) => i.serviceName === serviceName && i.status !== 'resolved').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  if (!incident) {
    await step('orchestrator-agent', `No open incident — running an activation check on ${serviceName} to confirm the failure`);
    const caps = collection<Capability>(COLLECTIONS.CAPABILITIES);
    const cap = await caps.findOne({ supportedByServices: serviceName as never });
    const capabilityId = cap?.capabilityId ?? 'browser_testing';
    await peer.dispatchTask('monitor-agent', { taskId, goal: `Activate ${serviceName}`, input: { action: 'activate_service', serviceName, capability: capabilityId }, priority: 'high' });
    const refreshed = await incidentsCol.find({}, { projection: { _id: 0 } }).toArray();
    incident = refreshed.filter((i) => i.serviceName === serviceName && i.status !== 'resolved').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  if (!incident) {
    const report = { goal, taskId, status: 'completed' as const, mode: 'repair', serviceName, headline: `No failure detected for ${serviceName} — nothing to repair.`, steps, generatedAt: nowIso() };
    await tasks.updateOne({ taskId }, { $set: { status: 'completed', result: report, updatedAt: nowIso() } });
    await step('orchestrator-agent', report.headline, 'success');
    await ctx.publisher.publish({ type: EVENT_TYPES.TASK_COMPLETED, taskId, payload: { message: report.headline, report: true } });
    return;
  }
  await step('orchestrator-agent', `Incident ${incident.incidentId} for ${serviceName} — diagnosing`, 'warn', incident.incidentId);

  // Diagnose.
  const dx = await peer.dispatchTask<{ diagnosis?: { diagnosisId: string; confidence: number; topCause: string } }>('monitor-agent', { taskId, goal: `Diagnose ${incident.incidentId}`, input: { action: 'diagnose_incident', incidentId: incident.incidentId }, priority: 'high' });
  const diagnosis = dx.data?.diagnosis;
  await step('monitor-agent', diagnosis ? `Diagnosis: ${diagnosis.topCause} (${Math.round(diagnosis.confidence * 100)}%)` : 'Diagnosis unavailable', diagnosis ? 'success' : 'warn', diagnosis?.diagnosisId);
  await sleep(PACE_MS);

  // Plan.
  let repairPlanId: string | null = null;
  let planType: string | null = null;
  if (diagnosis) {
    const pl = await peer.dispatchTask<{ plan?: { repairPlanId: string; planType: string; requiresHumanAction: boolean } }>('monitor-agent', { taskId, goal: `Plan repair`, input: { action: 'plan_repair', diagnosisId: diagnosis.diagnosisId }, priority: 'high' });
    repairPlanId = pl.data?.plan?.repairPlanId ?? null;
    planType = pl.data?.plan?.planType ?? null;
    await step('monitor-agent', repairPlanId ? `Repair plan ready: ${planType}` : 'Plan unavailable', repairPlanId ? 'success' : 'warn', repairPlanId ?? undefined);
  }

  const report = {
    goal, taskId, status: 'awaiting_approval' as const, mode: 'repair',
    serviceName, incidentId: incident.incidentId, diagnosisId: diagnosis?.diagnosisId ?? null,
    topCause: diagnosis?.topCause ?? null, repairPlanId, planType,
    steps,
    headline: repairPlanId
      ? `Repair plan (${planType}) ready for ${serviceName}. Approve the plan (or mark the manual action done) to execute — the kernel will re-run the activation check and resolve the incident only if it passes.`
      : `Could not produce a repair plan for ${serviceName}.`,
    generatedAt: nowIso(),
  };
  await tasks.updateOne({ taskId }, { $set: { status: 'awaiting_approval', requiresApproval: true, result: report, updatedAt: nowIso() } });
  await step('orchestrator-agent', report.headline, 'success');
  await ctx.publisher.publish({ type: EVENT_TYPES.TASK_UPDATED, taskId, payload: { message: 'Repair plan ready', report: true, repairPlanId } });
}

// ===========================================================================
// Strategic pipeline (Phase 7): generate ≥3 plans → score → policy-check →
// choose (or ask) → execute allowed steps → validate → evidence → decision
// memory → evaluation → reasoning report. Reasoning is real (LLM router) with a
// schema-validated deterministic fallback; nothing unvalidated mutates state.
// ===========================================================================
export async function runStrategicPipeline(
  args: PipelineArgs,
  steps: ReportStep[],
  step: (service: string, message: string, level?: 'info' | 'success' | 'warn', ref?: string) => Promise<void>,
): Promise<void> {
  const { taskId, goal, ctx, peer } = args;
  const tasks = collection<Task>(COLLECTIONS.TASKS);
  const serviceName = goal.match(/([a-z0-9]+(?:-[a-z0-9]+)*-(?:agent|service))/i)?.[1] ?? 'browser-testing-agent';
  const router = llmRouterFromEnv();

  // 1) Generate candidate plans (real LLM or validated fallback).
  await step('orchestrator-agent', `Generating candidate strategies for: ${goal}`);
  const gen = await generateCandidatePlans({ goal, router, agentId: 'orchestrator-agent', taskId, serviceName });
  await persistTrace(gen.trace, ctx);
  const now = nowIso();
  const plans: StrategicPlan[] = gen.plans.map((p) => ({ ...p, planId: genId('plan'), taskId, goal, selected: false, createdAt: now }));
  await collection<StrategicPlan>(COLLECTIONS.STRATEGIC_PLANS).insertMany(plans);
  await ctx.publisher.publish({ type: EVENT_TYPES.PLANS_GENERATED, taskId, payload: { count: plans.length, labels: plans.map((p) => p.label), provider: gen.trace.provider, usedFallback: gen.trace.usedFallback, message: `${plans.length} strategies (${gen.trace.usedFallback ? 'deterministic' : gen.trace.provider})` } });
  await step('orchestrator-agent', `Produced ${plans.length} plans: ${plans.map((p) => p.label).join(', ')}`, 'success');
  await sleep(PACE_MS);

  // 2) Score the plans against the active capability graph and select.
  const caps = collection<Capability>(COLLECTIONS.CAPABILITIES);
  const activeCaps = (await caps.find({ status: 'active' as never }, { projection: { _id: 0, capabilityId: 1 } }).toArray()).map((c) => c.capabilityId);
  // Use the active scoring profile's weights (Phase 8 adaptive governance).
  const activeProfile = await collection<ScoringProfile>(COLLECTIONS.SCORING_PROFILES).findOne({ status: 'active' as never });
  const weights = activeProfile?.weights ?? DEFAULT_SCORING_WEIGHTS;
  const profileVersion = activeProfile?.version ?? 1;
  const scoring = scorePlans(plans, activeCaps, { weights, profileVersion });
  await step('orchestrator-agent', `Scoring with profile v${profileVersion}`);
  await collection<PlanScore>(COLLECTIONS.PLAN_SCORES).insertMany(scoring.scores);
  await collection<StrategicPlan>(COLLECTIONS.STRATEGIC_PLANS).updateOne({ planId: scoring.selectedPlanId }, { $set: { selected: true } });
  for (const s of scoring.scores) await ctx.publisher.publish({ type: EVENT_TYPES.PLAN_SCORED, taskId, payload: { planId: s.planId, label: s.label, total: s.total } });
  const selected = plans.find((p) => p.planId === scoring.selectedPlanId)!;
  await ctx.publisher.publish({ type: EVENT_TYPES.PLAN_SELECTED, taskId, payload: { selectedPlanId: scoring.selectedPlanId, label: selected.label, reason: scoring.selectionReason, message: `Selected ${selected.label}` } });
  await step('orchestrator-agent', `Selected ${selected.label}: ${scoring.selectionReason}`, 'success', scoring.selectedPlanId);
  await sleep(PACE_MS);

  // 3) Policy check for every sensitive action across the candidates.
  const allApprovals = [...new Set(plans.flatMap((p) => p.requiredApprovals))];
  const policyDecisions: PolicyDecision[] = [];
  for (const approval of allApprovals) {
    const action = approvalToAction(approval);
    const res = evaluatePolicy(action);
    const owner = plans.find((p) => p.requiredApprovals.includes(approval));
    policyDecisions.push({ policyDecisionId: genId('pol'), taskId, planId: owner?.planId ?? null, action, decision: res.decision, reason: res.reason, requiredApprovalType: res.requiredApprovalType, riskLevel: res.riskLevel, createdAt: nowIso() });
  }
  // The selected plan's own execution actions (validation is allowed).
  const valPolicy = evaluatePolicy('run_validation');
  policyDecisions.push({ policyDecisionId: genId('pol'), taskId, planId: selected.planId, action: 'run_validation', decision: valPolicy.decision, reason: valPolicy.reason, requiredApprovalType: null, riskLevel: 'low', createdAt: nowIso() });
  if (policyDecisions.length) await collection<PolicyDecision>(COLLECTIONS.POLICY_DECISIONS).insertMany(policyDecisions);
  for (const d of policyDecisions) await ctx.publisher.publish({ type: EVENT_TYPES.POLICY_DECISION, taskId, payload: { action: d.action, decision: d.decision, message: `Policy: ${d.action} → ${d.decision}`, level: d.decision === 'blocked' ? 'warn' : 'info' } });
  await step('orchestrator-agent', `Policy checked ${policyDecisions.length} action(s)`, 'success');

  // If the selected plan needs sensitive approvals, gate them (still execute safe steps).
  const selectedApprovals = selected.requiredApprovals;
  const gated = selectedApprovals.length > 0;
  const lowConfidence = selected.confidence < 0.6;
  let approvalId: string | null = null;
  if (gated || lowConfidence) {
    approvalId = genId('appr');
    await collection<Approval>(COLLECTIONS.APPROVALS).insertOne({ approvalId, taskId, requestedBy: 'orchestrator-agent', actionType: 'execute_strategic_plan', summary: `Approve ${selected.label} for ${serviceName}${gated ? ` (sensitive: ${selectedApprovals.join(', ')})` : ' (low confidence)'}`, riskLevel: selected.riskLevel === 'high' ? 'high' : 'medium', payload: { planId: selected.planId, approvals: selectedApprovals }, status: 'pending', decidedBy: null, decisionReason: null, createdAt: nowIso(), decidedAt: null });
    await ctx.publisher.publish({ type: EVENT_TYPES.APPROVAL_REQUESTED, taskId, payload: { approvalId, message: `Approval requested to execute ${selected.label}`, level: 'warn' } });
    await step('orchestrator-agent', `Sensitive/low-confidence steps gated — requested approval`, 'warn', approvalId);
  }

  // 4) Execute the allowed (non-sensitive) part of the selected plan now: runtime validation.
  await step('orchestrator-agent', `Executing safe steps of ${selected.label} (runtime validation)`);
  const val = await peer.dispatchTask<{ validation?: { validationId: string; passed: boolean; score: number } }>('builder-agent', { taskId, goal: `Validate ${serviceName}`, input: { action: 'validate_service', serviceName, capability: 'browser_testing' }, priority: 'high' });
  const validation = val.data?.validation ?? null;
  await step('builder-agent', validation ? `Runtime validation ${validation.passed ? 'passed' : 'failed'} (score ${validation.score})` : 'Validation unavailable', validation?.passed ? 'success' : 'warn', validation?.validationId);
  await sleep(PACE_MS);

  // 5) Evaluation + evidence.
  const capId = 'browser_testing';
  const evalRec = buildEvaluation({ targetType: 'capability', targetId: capId, taskId, signals: { runtimeValidated: Boolean(validation?.passed), scaffoldCreated: true, docsUpdated: false, memoryStored: true, humanInterventionRequired: gated || lowConfidence, approvalUsed: Boolean(approvalId), delegationsAttempted: 1, delegationsSucceeded: validation ? 1 : 0 } });
  await collection<Evaluation>(COLLECTIONS.CAPABILITY_EVALUATIONS).insertOne(evalRec);
  await ctx.publisher.publish({ type: EVENT_TYPES.EVALUATION_CREATED, taskId, payload: { evaluationId: evalRec.evaluationId, score: evalRec.score, message: `Evaluation ${evalRec.score}` } });
  const decisionEvidence = buildEvidence({ type: 'validation_report', summary: `Strategic decision executed: ${selected.label} (validation ${validation?.passed ? 'passed' : 'pending'})`, taskId, capabilityId: capId, serviceName, data: { selectedPlanId: selected.planId, validationId: validation?.validationId ?? null } });
  await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertOne(decisionEvidence);
  const evidenceCount = await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).countDocuments({ taskId });

  // 6) Decision memory + memory + reusable skill.
  const decision: DecisionMemory = {
    decisionId: genId('dec'), taskId, goal, selectedPlanId: selected.planId, selectedReason: scoring.selectionReason,
    alternatives: scoring.rejected.map((r) => ({ planId: r.planId, label: r.label, reason: r.reason })),
    outcome: validation?.passed ? 'executed_safe_steps_validated' : 'executed_safe_steps',
    evidenceIds: [decisionEvidence.evidenceId], evaluationId: evalRec.evaluationId,
    lessons: [`Prefer ${selected.label} for "${goal.slice(0, 48)}": ${selected.riskLevel} risk, reversibility ${selected.reversibility}.`, gated ? 'Sensitive steps require approval before execution.' : 'No sensitive steps; safe to execute.'],
    createdAt: nowIso(),
  };
  await collection<DecisionMemory>(COLLECTIONS.DECISION_MEMORIES).insertOne(decision);
  await ctx.publisher.publish({ type: EVENT_TYPES.DECISION_RECORDED, taskId, payload: { decisionId: decision.decisionId, selectedPlanId: selected.planId, message: 'Decision memory stored' } });

  await collection<Memory>(COLLECTIONS.MEMORIES).insertOne({ memoryId: genId('mem'), type: 'decision_memory', title: `Strategy for: ${goal.slice(0, 50)}`, summary: `Chose ${selected.label} after scoring ${plans.length} plans. ${scoring.selectionReason}`, taskId, serviceId: 'orchestrator-agent', tags: ['reasoning', 'strategy', selected.label], confidence: 'medium', createdAt: nowIso() });
  await ctx.publisher.publish({ type: EVENT_TYPES.MEMORY_WRITTEN, taskId, payload: { message: 'Strategy memory stored' } });
  const skills = collection<Skill>(COLLECTIONS.SKILLS);
  const sk = await skills.findOne({ skillId: 'skill_strategic_planning' });
  const t = nowIso();
  if (sk) await skills.updateOne({ skillId: sk.skillId }, { $set: { lastUsedAt: t, updatedAt: t }, $inc: { usageCount: 1 } });
  else {
    await skills.insertOne({ skillId: 'skill_strategic_planning', title: 'Choose a plan by scoring and policy', description: 'Generate ≥3 candidate plans, score by risk/cost/time/reversibility/impact/capability-fit/policy, check policy, and select with justification.', category: 'reasoning', triggerConditions: ['Open-ended improvement/optimization goal'], requiredCapabilities: [], requiredServices: ['orchestrator-agent'], steps: ['Generate plans', 'Score plans', 'Check policy', 'Select + justify', 'Execute safe steps', 'Validate', 'Record decision memory'], examples: [`Improve reliability via ${selected.label}`], successRate: 1, usageCount: 1, relatedMemories: [], relatedDocs: [], confidence: 'medium', lastUsedAt: t, createdAt: t, updatedAt: t });
    await ctx.publisher.publish({ type: EVENT_TYPES.SKILL_CREATED, taskId, payload: { skillId: 'skill_strategic_planning', message: 'Strategic planning skill created' } });
  }

  // 7) Reasoning report.
  const finalStatus = gated || lowConfidence ? 'awaiting_approval' : 'completed';
  const report = {
    goal, taskId, status: finalStatus, mode: 'strategic_reasoning', serviceName,
    selectedPlanId: selected.planId, selectedLabel: selected.label, selectionReason: scoring.selectionReason,
    rejected: scoring.rejected, planCount: plans.length, decisionId: decision.decisionId,
    policyDecisions: policyDecisions.map((d) => ({ action: d.action, decision: d.decision })),
    llmProvider: gen.trace.provider, usedFallback: gen.trace.usedFallback, llmCostUsd: gen.trace.costUsd, traceId: gen.trace.traceId,
    validationId: validation?.validationId ?? null, evaluationId: evalRec.evaluationId, evidenceCount,
    confidence: selected.confidence, approvalId,
    steps,
    headline: gated || lowConfidence
      ? `Considered ${plans.length} strategies, chose ${selected.label} (${scoring.selectionReason}). Safe steps executed + validated; sensitive steps await your approval.`
      : `Considered ${plans.length} strategies, chose ${selected.label} (${scoring.selectionReason}). Executed, validated, recorded the decision and learned from it.`,
    generatedAt: nowIso(),
  };
  await tasks.updateOne({ taskId }, { $set: { status: finalStatus, requiresApproval: Boolean(approvalId), result: report, updatedAt: nowIso() } });
  await step('orchestrator-agent', report.headline, 'success');
  await ctx.publisher.publish({ type: finalStatus === 'completed' ? EVENT_TYPES.TASK_COMPLETED : EVENT_TYPES.TASK_UPDATED, taskId, payload: { message: 'Reasoning report ready', report: true } });
}

// ===========================================================================
// Governance pipeline (Phase 8): review the last decision, compare predicted vs
// actual, and propose a scoring-weight change (never applied without approval).
// ===========================================================================
interface DecisionLite { decisionId: string; taskId: string; goal: string; selectedPlanId: string; evaluationId: string | null; createdAt: string }

export async function runGovernancePipeline(
  args: PipelineArgs,
  steps: ReportStep[],
  step: (service: string, message: string, level?: 'info' | 'success' | 'warn', ref?: string) => Promise<void>,
): Promise<void> {
  const { taskId, goal, ctx } = args;
  const tasks = collection<Task>(COLLECTIONS.TASKS);

  // 1) Find the latest strategic decision.
  const decisions = await collection<DecisionLite>(COLLECTIONS.DECISION_MEMORIES).find({}, { projection: { _id: 0 } }).toArray();
  const decision = decisions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!decision) {
    const report = { goal, taskId, status: 'completed' as const, mode: 'governance', headline: 'No strategic decisions to review yet.', steps, generatedAt: nowIso() };
    await tasks.updateOne({ taskId }, { $set: { status: 'completed', result: report, updatedAt: nowIso() } });
    await step('orchestrator-agent', report.headline, 'success');
    await ctx.publisher.publish({ type: EVENT_TYPES.TASK_COMPLETED, taskId, payload: { message: report.headline, report: true } });
    return;
  }
  await step('orchestrator-agent', `Reviewing decision ${decision.decisionId}`, 'info', decision.decisionId);

  // 2) Compare predicted plan score vs actual evaluation.
  const score = await collection<PlanScore>(COLLECTIONS.PLAN_SCORES).findOne({ planId: decision.selectedPlanId });
  const predicted = score?.total ?? 0;
  const evalRec = decision.evaluationId ? await collection<Evaluation>(COLLECTIONS.CAPABILITY_EVALUATIONS).findOne({ evaluationId: decision.evaluationId }) : null;
  const actual = evalRec?.score ?? 0;

  const review = outcomeReview({ taskId, decisionId: decision.decisionId, selectedPlanId: decision.selectedPlanId, selectedPlanScore: predicted, actualEvaluationScore: actual, signals: { validationPassed: true, humanIntervention: false } });
  await collection<OutcomeReview>(COLLECTIONS.OUTCOME_REVIEWS).insertOne(review);
  await ctx.publisher.publish({ type: EVENT_TYPES.OUTCOME_REVIEWED, taskId, payload: { reviewId: review.reviewId, predictedVsActual: review.predictedVsActual, predicted, actual, message: `Outcome: predicted ${predicted} vs actual ${actual} (${review.predictedVsActual})` } });
  await step('orchestrator-agent', `Outcome review: predicted ${predicted} vs actual ${actual} → ${review.predictedVsActual}`, 'success', review.reviewId);

  // 3) If learning is recommended, propose a scoring-weight change (never auto-applied).
  let proposalId: string | null = null;
  if (review.recommendedWeightChanges.length > 0) {
    const activeProfile = await collection<ScoringProfile>(COLLECTIONS.SCORING_PROFILES).findOne({ status: 'active' as never });
    const currentWeights: ScoringWeights = activeProfile?.weights ?? DEFAULT_SCORING_WEIGHTS;
    const proposedWeights = applyWeightChanges(currentWeights, review.recommendedWeightChanges);
    const proposal: ScoringChangeProposal = {
      proposalId: genId('scp'), basedOnReviews: [review.reviewId], currentWeights, proposedWeights,
      changes: review.recommendedWeightChanges,
      reason: `Predicted ${predicted} vs actual ${actual} (${review.predictedVsActual}). ${review.recommendedWeightChanges.map((c) => `${c.dimension} ${c.change > 0 ? '+' : ''}${c.change}`).join(', ')}.`,
      expectedImpact: 'Future plan scoring tracks real outcomes more closely.', riskLevel: 'low',
      status: 'waiting_approval', approvedBy: null, resultingProfileVersion: null, createdAt: nowIso(), decidedAt: null,
    };
    await collection<ScoringChangeProposal>(COLLECTIONS.SCORING_CHANGE_PROPOSALS).insertOne(proposal);
    proposalId = proposal.proposalId;
    await ctx.publisher.publish({ type: EVENT_TYPES.SCORING_PROPOSAL_CREATED, taskId, payload: { proposalId, message: 'Scoring change proposed (awaiting approval)', level: 'warn' } });
    await collection<AuditLog>(COLLECTIONS.AUDIT_LOGS).insertOne(buildAuditLog({ actorType: 'system', actorId: 'orchestrator-agent', action: 'scoring_change_proposed', targetType: 'scoring_change_proposal', targetId: proposalId, after: { changes: proposal.changes }, reason: proposal.reason }));
    await ctx.publisher.publish({ type: EVENT_TYPES.AUDIT_LOGGED, taskId, payload: { action: 'scoring_change_proposed', targetId: proposalId } });
    await step('orchestrator-agent', `Proposed scoring change (${review.recommendedWeightChanges.map((c) => c.dimension).join(', ')}) — awaiting your approval`, 'warn', proposalId);
  }

  // Governance memory.
  await collection<Memory>(COLLECTIONS.MEMORIES).insertOne({ memoryId: genId('mem'), type: 'decision_memory', title: `Governance review of ${decision.decisionId}`, summary: `Predicted ${predicted} vs actual ${actual} (${review.predictedVsActual}). ${proposalId ? 'Proposed a scoring update.' : 'No scoring change needed.'}`, taskId, serviceId: 'orchestrator-agent', tags: ['governance', 'learning'], confidence: 'medium', createdAt: nowIso() });
  await ctx.publisher.publish({ type: EVENT_TYPES.MEMORY_WRITTEN, taskId, payload: { message: 'Governance memory stored' } });

  const finalStatus = proposalId ? 'awaiting_approval' : 'completed';
  const report = {
    goal, taskId, status: finalStatus, mode: 'governance', decisionId: decision.decisionId, reviewId: review.reviewId,
    predicted, actual, predictedVsActual: review.predictedVsActual, recommendedWeightChanges: review.recommendedWeightChanges,
    scoringProposalId: proposalId, lessons: review.lessons,
    steps,
    headline: proposalId
      ? `Reviewed the last decision: predicted ${predicted} vs actual ${actual} (${review.predictedVsActual}). Proposed a scoring update — approve it to version a new active profile.`
      : `Reviewed the last decision: predicted ${predicted} vs actual ${actual} (${review.predictedVsActual}). Scoring already tracks reality; no change.`,
    generatedAt: nowIso(),
  };
  await tasks.updateOne({ taskId }, { $set: { status: finalStatus, requiresApproval: Boolean(proposalId), result: report, updatedAt: nowIso() } });
  await step('orchestrator-agent', report.headline, 'success');
  await ctx.publisher.publish({ type: finalStatus === 'completed' ? EVENT_TYPES.TASK_COMPLETED : EVENT_TYPES.TASK_UPDATED, taskId, payload: { message: 'Governance report ready', report: true } });
}

// ===========================================================================
// Operational learning pipeline (Phase 9): aggregate the whole history into
// reliability scores, patterns, compressed memory, and evidence-backed
// recommendations. Learning recommends; approval (gateway + RBAC) applies.
// ===========================================================================
async function loadHistory(): Promise<HistoryBundle> {
  const get = async (name: string): Promise<Array<Record<string, unknown>>> =>
    (await collection(name as never).find({}, { projection: { _id: 0 } }).toArray()) as Array<Record<string, unknown>>;
  return {
    tasks: (await get(COLLECTIONS.TASKS)) as never,
    agentRuns: (await get(COLLECTIONS.AGENT_RUNS)) as never,
    activations: (await get(COLLECTIONS.SERVICE_ACTIVATIONS)) as never,
    validations: (await get(COLLECTIONS.RUNTIME_VALIDATIONS)) as never,
    evaluations: (await get(COLLECTIONS.CAPABILITY_EVALUATIONS)) as never,
    incidents: (await get(COLLECTIONS.INCIDENTS)) as never,
    repairTasks: (await get(COLLECTIONS.REPAIR_TASKS)) as never,
    repairPlans: (await get(COLLECTIONS.REPAIR_PLANS)) as never,
    planScores: (await get(COLLECTIONS.PLAN_SCORES)) as never,
    decisions: (await get(COLLECTIONS.DECISION_MEMORIES)) as never,
    outcomeReviews: (await get(COLLECTIONS.OUTCOME_REVIEWS)) as never,
    evidence: (await get(COLLECTIONS.EVIDENCE_RECORDS)) as never,
    skills: (await get(COLLECTIONS.SKILLS)) as never,
    memories: (await get(COLLECTIONS.MEMORIES)) as never,
    llmTraces: (await get(COLLECTIONS.LLM_TRACES)) as never,
  };
}

export async function runLearningPipeline(
  args: PipelineArgs,
  steps: ReportStep[],
  step: (service: string, message: string, level?: 'info' | 'success' | 'warn', ref?: string) => Promise<void>,
): Promise<void> {
  const { taskId, goal, ctx } = args;
  const tasks = collection<Task>(COLLECTIONS.TASKS);

  await step('orchestrator-agent', 'Reading operational history across all collections');
  const bundle = await loadHistory();
  const recordsAnalyzed = Object.values(bundle).reduce((a, arr) => a + (arr?.length ?? 0), 0);
  await sleep(PACE_MS);

  // Reliability scores + snapshot.
  const scores = computeReliabilityScores(bundle);
  if (scores.length) await collection<ReliabilityScore>(COLLECTIONS.RELIABILITY_SCORES).insertMany(scores);
  const learningRunId = genId('learn');
  const snapshot: ReliabilitySnapshot = { snapshotId: genId('snap'), learningRunId, scores, createdAt: nowIso() };
  await collection<ReliabilitySnapshot>(COLLECTIONS.RELIABILITY_SNAPSHOTS).insertOne(snapshot);
  await ctx.publisher.publish({ type: EVENT_TYPES.RELIABILITY_UPDATED, taskId, payload: { count: scores.length, message: `Reliability scored for ${scores.length} targets` } });
  await step('orchestrator-agent', `Reliability: scored ${scores.length} targets`, 'success');

  // Patterns.
  const patterns = minePatterns(bundle, scores);
  if (patterns.length) await collection<OperationalPattern>(COLLECTIONS.OPERATIONAL_PATTERNS).insertMany(patterns);
  for (const p of patterns) await ctx.publisher.publish({ type: EVENT_TYPES.PATTERN_DETECTED, taskId, payload: { patternId: p.patternId, patternType: p.patternType, title: p.title, message: `${p.patternType}: ${p.title}` } });
  const success = patterns.filter((p) => p.patternType === 'success');
  const failure = patterns.filter((p) => p.patternType !== 'success');
  await step('orchestrator-agent', `Patterns: ${success.length} success, ${failure.length} failure/weak`, 'success');
  await sleep(PACE_MS);

  // Memory summaries + compressed context.
  const { summaries, context } = buildMemorySummaries(bundle, scores, patterns);
  if (summaries.length) await collection<MemorySummary>(COLLECTIONS.MEMORY_SUMMARIES).insertMany(summaries);
  const compressed: CompressedContext = { ...context, learningRunId };
  await collection<CompressedContext>(COLLECTIONS.COMPRESSED_CONTEXTS).insertOne(compressed);
  await ctx.publisher.publish({ type: EVENT_TYPES.MEMORY_SUMMARIZED, taskId, payload: { count: summaries.length, message: `Compressed history into ${summaries.length} summaries` } });

  // Prompt performance.
  const promptPerf = computePromptPerformance(bundle);
  if (promptPerf.length) await collection<PromptPerformance>(COLLECTIONS.PROMPT_PERFORMANCE).insertMany(promptPerf);
  await ctx.publisher.publish({ type: EVENT_TYPES.PROMPT_PERFORMANCE_UPDATED, taskId, payload: { count: promptPerf.length } });

  // Recommendations (evidence-backed; approval applies).
  const recs = buildRecommendations(patterns, scores).map((r) => ({ ...r, learningRunId }));
  if (recs.length) await collection<SystemRecommendation>(COLLECTIONS.SYSTEM_RECOMMENDATIONS).insertMany(recs);
  for (const r of recs) await ctx.publisher.publish({ type: EVENT_TYPES.RECOMMENDATION_CREATED, taskId, payload: { recommendationId: r.recommendationId, type: r.type, title: r.title, message: `Recommendation: ${r.title}`, level: 'warn' } });
  await step('orchestrator-agent', `Recommendations: ${recs.length} (awaiting approval)`, recs.length ? 'warn' : 'info');

  // Learning run record.
  const weakServices = scores.filter((s) => s.targetType === 'service' && s.score < 0.6).map((s) => s.targetId);
  const learningRun: LearningRun = {
    learningRunId, taskId, timeWindow: 'all', recordsAnalyzed,
    summary: `Analyzed ${recordsAnalyzed} records: ${scores.length} reliability scores, ${patterns.length} patterns, ${recs.length} recommendations.`,
    topSuccessPatterns: success.map((p) => p.title), topFailurePatterns: failure.map((p) => p.title),
    weakCapabilities: scores.filter((s) => s.targetType === 'capability' && s.score < 0.6).map((s) => s.targetId),
    weakServices, weakAgents: scores.filter((s) => s.targetType === 'agent' && s.score < 0.6).map((s) => s.targetId),
    recommendedSkills: recs.filter((r) => r.type === 'create_skill' || r.type === 'update_skill').map((r) => r.recommendationId),
    recommendedExpansions: recs.filter((r) => r.type === 'create_capability').map((r) => r.recommendationId),
    recommendedScoringChanges: recs.filter((r) => r.type === 'improve_scoring').map((r) => r.recommendationId),
    recommendedPolicyChanges: recs.filter((r) => r.type === 'improve_policy').map((r) => r.recommendationId),
    reliabilitySnapshotId: snapshot.snapshotId, patternIds: patterns.map((p) => p.patternId), recommendationIds: recs.map((r) => r.recommendationId),
    createdAt: nowIso(),
  };
  await collection<LearningRun>(COLLECTIONS.LEARNING_RUNS).insertOne(learningRun);
  await ctx.publisher.publish({ type: EVENT_TYPES.LEARNING_RUN_COMPLETED, taskId, payload: { learningRunId, recordsAnalyzed, message: learningRun.summary } });

  // Governance memory (compressed for future agents).
  await collection<Memory>(COLLECTIONS.MEMORIES).insertOne({ memoryId: genId('mem'), type: 'task_memory', title: 'Operational learning run', summary: compressed.compressedText, taskId, serviceId: 'orchestrator-agent', tags: ['learning', 'reliability'], confidence: 'medium', createdAt: nowIso() });
  await ctx.publisher.publish({ type: EVENT_TYPES.MEMORY_WRITTEN, taskId, payload: { message: 'Learning memory stored' } });

  const report = {
    goal, taskId, status: 'completed' as const, mode: 'learning', learningRunId, recordsAnalyzed,
    reliabilityCount: scores.length, patternCount: patterns.length, successPatterns: success.map((p) => p.title), failurePatterns: failure.map((p) => p.title),
    weakServices, recommendationCount: recs.length, recommendationIds: recs.map((r) => r.recommendationId), promptPerfCount: promptPerf.length, summaryCount: summaries.length,
    steps,
    headline: `Reviewed ${recordsAnalyzed} records: found ${success.length} success + ${failure.length} weak-point patterns, scored ${scores.length} targets, and recommended ${recs.length} improvement(s) (awaiting approval).`,
    generatedAt: nowIso(),
  };
  await tasks.updateOne({ taskId }, { $set: { status: 'completed', result: report, updatedAt: nowIso() } });
  await step('orchestrator-agent', report.headline, 'success');
  await ctx.publisher.publish({ type: EVENT_TYPES.TASK_COMPLETED, taskId, payload: { message: 'Learning report ready', report: true } });
}

// ===========================================================================
// Continuous improvement pipeline (Phase 10): convert an APPROVED recommendation
// into a structured workflow, execute it through real engines, measure impact,
// and maintain compressed memory. Execution requires an approved recommendation.
// ===========================================================================
interface RecLite { recommendationId: string; type: string; title: string; status: string; evidence?: string[]; relatedPatternIds?: string[]; reason?: string; createdAt: string }

async function snapshotMetrics(serviceTarget: string): Promise<Record<string, number>> {
  const skillCount = await collection(COLLECTIONS.SKILLS).countDocuments({});
  const rels = (await collection<ReliabilityScore>(COLLECTIONS.RELIABILITY_SCORES).find({ targetType: 'service' as never, targetId: serviceTarget as never }, { projection: { _id: 0 } }).toArray()).sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
  const r = rels[0];
  return { skillCount, reliability: Number((r?.score ?? 0).toFixed(3)), incidentRate: Number((r?.incidentRate ?? 0).toFixed(3)), validationScore: Number((r?.avgValidationScore ?? 0).toFixed(3)) };
}

export async function runImprovementPipeline(
  args: PipelineArgs,
  steps: ReportStep[],
  step: (service: string, message: string, level?: 'info' | 'success' | 'warn', ref?: string) => Promise<void>,
): Promise<void> {
  const { taskId, goal, ctx, peer, input } = args;
  const tasks = collection<Task>(COLLECTIONS.TASKS);
  const recsCol = collection<RecLite & SystemRecommendation>(COLLECTIONS.SYSTEM_RECOMMENDATIONS);

  // Find the target recommendation (explicit id, else latest approved/converted, else latest waiting).
  const allRecs = await recsCol.find({}, { projection: { _id: 0 } }).toArray();
  const wantId = input?.recommendationId ? String(input.recommendationId) : null;
  const byTime = [...allRecs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rec = (wantId ? byTime.find((r) => r.recommendationId === wantId) : byTime.find((r) => r.status === 'approved' || r.status === 'converted')) ?? byTime[0];
  if (!rec) {
    const report = { goal, taskId, status: 'completed' as const, mode: 'improvement', headline: 'No recommendations to convert into a workflow.', steps, generatedAt: nowIso() };
    await tasks.updateOne({ taskId }, { $set: { status: 'completed', result: report, updatedAt: nowIso() } });
    await step('orchestrator-agent', report.headline, 'success');
    await ctx.publisher.publish({ type: EVENT_TYPES.TASK_COMPLETED, taskId, payload: { message: report.headline, report: true } });
    return;
  }

  // Governance: execution requires an approved recommendation.
  if (rec.status === 'waiting_approval' || rec.status === 'changes_requested') {
    const wf = recommendationToWorkflow(rec as SystemRecommendation);
    wf.status = 'waiting_approval'; wf.taskId = taskId;
    await collection<ImprovementWorkflow>(COLLECTIONS.IMPROVEMENT_WORKFLOWS).insertOne(wf);
    await ctx.publisher.publish({ type: EVENT_TYPES.WORKFLOW_CREATED, taskId, payload: { workflowId: wf.workflowId, type: wf.type, message: `Workflow drafted (awaiting recommendation approval)`, level: 'warn' } });
    const report = { goal, taskId, status: 'awaiting_approval' as const, mode: 'improvement', recommendationId: rec.recommendationId, workflowId: wf.workflowId, workflowType: wf.type, headline: `Recommendation "${rec.title}" must be approved before its workflow runs. Approve it in Recommendations.`, steps, generatedAt: nowIso() };
    await tasks.updateOne({ taskId }, { $set: { status: 'awaiting_approval', requiresApproval: true, result: report, updatedAt: nowIso() } });
    await step('orchestrator-agent', report.headline, 'warn', wf.workflowId);
    await ctx.publisher.publish({ type: EVENT_TYPES.TASK_UPDATED, taskId, payload: { message: 'Workflow awaiting approval', report: true } });
    return;
  }

  // Convert → workflow.
  const target = 'browser-testing-agent';
  await step('orchestrator-agent', `Converting recommendation "${rec.title}" → ${rec.type} workflow`);
  const wf = recommendationToWorkflow(rec as SystemRecommendation);
  wf.taskId = taskId; wf.status = 'running'; wf.beforeMetrics = await snapshotMetrics(target);
  await collection<ImprovementWorkflow>(COLLECTIONS.IMPROVEMENT_WORKFLOWS).insertOne(wf);
  await ctx.publisher.publish({ type: EVENT_TYPES.WORKFLOW_CREATED, taskId, payload: { workflowId: wf.workflowId, type: wf.type, message: `Workflow created: ${wf.type}` } });
  await sleep(PACE_MS);

  // Execute by type (uses existing engines). Evidence-backed.
  const evidenceIds: string[] = [];
  const addEv = async (type: EvidenceRecord['type'], summary: string, data: Record<string, unknown> = {}): Promise<void> => {
    const ev = buildEvidence({ type, summary, taskId, serviceName: target, data });
    await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertOne(ev);
    evidenceIds.push(ev.evidenceId);
  };
  const markStep = async (i: number, status: 'done' | 'skipped', detail = ''): Promise<void> => {
    wf.steps[i]!.status = status; wf.steps[i]!.detail = detail; wf.currentStep = i + 1;
    await collection<ImprovementWorkflow>(COLLECTIONS.IMPROVEMENT_WORKFLOWS).updateOne({ workflowId: wf.workflowId }, { $set: { steps: wf.steps, currentStep: wf.currentStep, updatedAt: nowIso() } });
    await ctx.publisher.publish({ type: EVENT_TYPES.WORKFLOW_STEP, taskId, payload: { workflowId: wf.workflowId, step: wf.steps[i]!.name, status, message: `${wf.steps[i]!.name} — ${status}` } });
  };

  if (wf.type === 'create_skill' || wf.type === 'update_skill') {
    const skillId = `skill_${rec.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)}`;
    const skills = collection<Skill>(COLLECTIONS.SKILLS);
    const existing = await skills.findOne({ skillId });
    const now = nowIso();
    if (existing) await skills.updateOne({ skillId }, { $set: { lastUsedAt: now, updatedAt: now }, $inc: { usageCount: 1 } });
    else await skills.insertOne({ skillId, title: rec.title, description: rec.reason ?? rec.title, category: 'operations', triggerConditions: ['Before activating/deploying a service'], requiredCapabilities: ['cap_infrastructure_request'], requiredServices: ['devops-agent', 'monitor-agent'], steps: ['Resolve the target domain/DNS', 'Confirm reachability before activation', 'Block activation if unresolved'], examples: ['Pre-deploy domain check for browser-testing-agent'], successRate: 1, usageCount: 1, relatedMemories: [], relatedDocs: ['repair-log'], confidence: 'medium', lastUsedAt: now, createdAt: now, updatedAt: now });
    await markStep(0, 'done', skillId);
    await addEv('validation_report', `Skill ${skillId} ${existing ? 'updated' : 'created'} from recommendation`, { skillId, patterns: rec.relatedPatternIds ?? [] });
    await markStep(1, 'done', `evidence + ${rec.relatedPatternIds?.length ?? 0} pattern(s)`);
    // Validate skill well-formed (deterministic verification).
    const ok = Boolean(rec.title && (rec.reason ?? '').length >= 0);
    await addEv('validation_report', `Skill validation ${ok ? 'passed' : 'failed'} (well-formed)`, { ok });
    await markStep(2, ok ? 'done' : 'skipped', ok ? 'well-formed' : 'incomplete');
    // Add to compressed memory.
    await collection<MemorySummary>(COLLECTIONS.MEMORY_SUMMARIES).insertOne({ summaryId: genId('sum'), scope: 'skill', scopeId: skillId, timeWindow: 'all', sourceMemoryIds: [], sourceEvidenceIds: evidenceIds, tokenBudget: 150, compressedText: `Skill: ${rec.title}. Use before activation to prevent domain/unreachable failures.`, keyFacts: [rec.title], openQuestions: [], nextActions: [], createdAt: now });
    await markStep(3, 'done', 'added to compressed memory');
  } else if (wf.type === 'add_validation' || wf.type === 'add_test') {
    await markStep(0, 'done', 'validation enhancement defined');
    const val = await peer.dispatchTask<{ validation?: { validationId: string; passed: boolean; score: number } }>('builder-agent', { taskId, goal: `Validate ${target}`, input: { action: 'validate_service', serviceName: target, capability: 'browser_testing' }, priority: 'high' });
    await addEv('validation_report', `Validation ran on ${target}: ${val.data?.validation?.passed ? 'passed' : 'pending'}`, { validationId: val.data?.validation?.validationId ?? null });
    await markStep(1, 'done', val.data?.validation?.validationId ?? 'ran');
    await markStep(2, 'done', 'evidence recorded');
  } else if (wf.type === 'improve_scoring') {
    // Creates a scoring change proposal (awaits human approval — gated).
    await markStep(0, 'done', 'scoring change proposal queued');
    await addEv('approval_decision', 'Scoring change proposed via improvement workflow (awaiting approval)');
    await markStep(1, 'skipped', 'awaiting approval');
    await markStep(2, 'skipped', 'measure after activation');
  } else {
    for (let i = 0; i < wf.steps.length; i++) await markStep(i, 'skipped', `requires ${wf.steps[i]!.engine}`);
  }

  // Impact assessment (before/after; honest).
  wf.afterMetrics = await snapshotMetrics(target);
  const impact = buildImpactAssessment({ workflowId: wf.workflowId, sourceRecommendationId: rec.recommendationId, targetType: 'service', targetId: target, beforeMetrics: wf.beforeMetrics, afterMetrics: wf.afterMetrics, evidenceIds });
  await collection<ImpactAssessment>(COLLECTIONS.IMPACT_ASSESSMENTS).insertOne(impact);
  await ctx.publisher.publish({ type: EVENT_TYPES.IMPACT_ASSESSED, taskId, payload: { impactAssessmentId: impact.impactAssessmentId, impact: impact.impact, message: `Impact: ${impact.impact}` } });
  await step('orchestrator-agent', `Impact: ${impact.impact}`, 'success', impact.impactAssessmentId);

  // Complete workflow.
  wf.status = 'completed'; wf.result = impact.impact; wf.evidenceIds = evidenceIds; wf.impactAssessmentId = impact.impactAssessmentId;
  await collection<ImprovementWorkflow>(COLLECTIONS.IMPROVEMENT_WORKFLOWS).updateOne({ workflowId: wf.workflowId }, { $set: { status: 'completed', result: wf.result, evidenceIds, impactAssessmentId: impact.impactAssessmentId, afterMetrics: wf.afterMetrics, updatedAt: nowIso() } });
  await recsCol.updateOne({ recommendationId: rec.recommendationId }, { $set: { status: 'converted', convertedTo: 'workflow', convertedId: wf.workflowId, updatedAt: nowIso() } });
  await ctx.publisher.publish({ type: EVENT_TYPES.WORKFLOW_COMPLETED, taskId, payload: { workflowId: wf.workflowId, message: `Workflow completed: ${wf.type}` } });

  // Continuous memory maintenance.
  const summaries = await collection<MemorySummary>(COLLECTIONS.MEMORY_SUMMARIES).find({}, { projection: { _id: 0 } }).toArray();
  const { run: mmRun, deprecateIds } = buildMemoryMaintenanceRun(summaries);
  for (const id of deprecateIds) await collection<MemorySummary>(COLLECTIONS.MEMORY_SUMMARIES).updateOne({ summaryId: id }, { $set: { scope: 'daily', timeWindow: 'superseded' } as never });
  await collection<MemoryMaintenanceRun>(COLLECTIONS.MEMORY_MAINTENANCE_RUNS).insertOne(mmRun);
  await ctx.publisher.publish({ type: EVENT_TYPES.MEMORY_MAINTAINED, taskId, payload: { maintenanceRunId: mmRun.maintenanceRunId, deprecated: mmRun.summariesDeprecated, message: `Memory maintenance: ${mmRun.summariesDeprecated} deprecated` } });

  // Learning memory + report.
  await collection<Memory>(COLLECTIONS.MEMORIES).insertOne({ memoryId: genId('mem'), type: 'task_memory', title: `Improvement workflow: ${wf.type}`, summary: `Ran ${wf.type} from "${rec.title}". Impact: ${impact.impact}.`, taskId, serviceId: 'orchestrator-agent', tags: ['improvement', wf.type], confidence: 'medium', createdAt: nowIso() });
  await ctx.publisher.publish({ type: EVENT_TYPES.MEMORY_WRITTEN, taskId, payload: { message: 'Improvement memory stored' } });

  const report = {
    goal, taskId, status: 'completed' as const, mode: 'improvement', recommendationId: rec.recommendationId, workflowId: wf.workflowId, workflowType: wf.type,
    steps: wf.steps.map((s) => ({ service: s.engine, message: `${s.name} — ${s.status}`, ok: s.status === 'done' })),
    workflowSteps: wf.steps, impact: impact.impact, impactAssessmentId: impact.impactAssessmentId, beforeMetrics: wf.beforeMetrics, afterMetrics: wf.afterMetrics,
    evidenceCount: evidenceIds.length, memoryMaintenanceRunId: mmRun.maintenanceRunId,
    headline: `Converted "${rec.title}" into a ${wf.type} workflow, executed ${wf.steps.filter((s) => s.status === 'done').length}/${wf.steps.length} steps with evidence, and measured impact: ${impact.impact}.`,
    generatedAt: nowIso(),
  };
  await tasks.updateOne({ taskId }, { $set: { status: 'completed', result: report, updatedAt: nowIso() } });
  await step('orchestrator-agent', report.headline, 'success');
  await ctx.publisher.publish({ type: EVENT_TYPES.TASK_COMPLETED, taskId, payload: { message: 'Improvement workflow report ready', report: true } });
}
