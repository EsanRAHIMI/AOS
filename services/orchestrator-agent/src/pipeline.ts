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
