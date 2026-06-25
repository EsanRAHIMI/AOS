/**
 * Orchestration pipeline. Runs the autonomous loop for a single goal, emitting
 * a human-readable live timeline and producing real artifacts (infrastructure
 * request, documentation updates, memory summary, approval gate, final report).
 */
import {
  collection,
  COLLECTIONS,
  EVENT_TYPES,
  genId,
  nowIso,
  sleep,
  type PeerClient,
  type Task,
  type Approval,
} from '@factory/shared';
import type { ServiceContext } from '@factory/service-kit';

/** A single timeline step the dashboard renders for the task. */
interface ReportStep {
  service: string;
  message: string;
  ok: boolean;
  ref?: string;
}

/** The final human-readable report stored on the task. */
export interface TaskReport {
  goal: string;
  taskId: string;
  status: 'awaiting_approval' | 'completed';
  steps: ReportStep[];
  infrastructureRequestId: string | null;
  approvalId: string | null;
  memoryId: string | null;
  documents: string[];
  headline: string;
  generatedAt: string;
}

export interface PipelineArgs {
  taskId: string;
  goal: string;
  ctx: ServiceContext;
  peer: PeerClient;
}

const PACE_MS = 700; // visible pacing so the live timeline reads as progress

export async function runPipeline(args: PipelineArgs): Promise<void> {
  const { taskId, goal, ctx, peer } = args;
  const tasks = collection<Task>(COLLECTIONS.TASKS);
  const approvals = collection<Approval>(COLLECTIONS.APPROVALS);
  const steps: ReportStep[] = [];

  // Emit a descriptive timeline event (task.updated carries a human message).
  const step = async (
    service: string,
    message: string,
    level: 'info' | 'success' | 'warn' = 'info',
    ref?: string,
  ): Promise<void> => {
    steps.push({ service, message, ok: level !== 'warn', ref });
    await ctx.publisher.publish({
      type: EVENT_TYPES.TASK_UPDATED,
      taskId,
      payload: { message, service, level, ref },
    });
  };

  await tasks.updateOne(
    { taskId },
    { $set: { status: 'in_progress', assignedServiceId: 'orchestrator-agent', updatedAt: nowIso() } },
  );
  await step('orchestrator-agent', `Planning goal: ${goal}`, 'info');
  await sleep(PACE_MS);

  // 1) Architect — design.
  await step('orchestrator-agent', 'Delegating to Architect Agent');
  const arch = await peer.dispatchTask('architect-agent', { taskId, goal, input: { phase: 'design' }, priority: 'normal' });
  await step('architect-agent', arch.ok ? 'Architect produced a service design plan' : 'Architect Agent unreachable', arch.ok ? 'success' : 'warn');
  await sleep(PACE_MS);

  // 2) Builder — implement.
  await step('orchestrator-agent', 'Delegating to Builder Agent');
  const build = await peer.dispatchTask('builder-agent', { taskId, goal, input: { phase: 'implement' }, priority: 'normal' });
  await step('builder-agent', build.ok ? 'Builder scaffolded the implementation' : 'Builder Agent unreachable', build.ok ? 'success' : 'warn');
  await sleep(PACE_MS);

  // 3) DevOps — produce a real infrastructure request.
  await step('orchestrator-agent', 'Delegating to DevOps Agent for infrastructure');
  const devops = await peer.dispatchTask<{ infrastructureRequestId?: string }>('devops-agent', {
    taskId,
    goal,
    input: { phase: 'infrastructure' },
    priority: 'normal',
  });
  const infrastructureRequestId = devops.data?.infrastructureRequestId ?? null;
  await step(
    'devops-agent',
    infrastructureRequestId ? `DevOps generated infrastructure request ${infrastructureRequestId}` : 'DevOps Agent unreachable',
    infrastructureRequestId ? 'success' : 'warn',
    infrastructureRequestId ?? undefined,
  );
  await sleep(PACE_MS);

  // Approval gate — creating infrastructure is a sensitive action.
  let approvalId: string | null = null;
  if (infrastructureRequestId) {
    approvalId = genId('appr');
    const approval: Approval = {
      approvalId,
      taskId,
      requestedBy: 'orchestrator-agent',
      actionType: 'create_infrastructure',
      summary: `Create Dokploy infrastructure for: ${goal}`,
      riskLevel: 'high',
      payload: { infrastructureRequestId },
      status: 'pending',
      decidedBy: null,
      decisionReason: null,
      createdAt: nowIso(),
      decidedAt: null,
    };
    await approvals.insertOne(approval);
    await ctx.publisher.publish({
      type: EVENT_TYPES.APPROVAL_REQUESTED,
      taskId,
      payload: { approvalId, infrastructureRequestId, message: 'Approval requested: create infrastructure', level: 'warn' },
    });
    await step('orchestrator-agent', 'Requested your approval to create infrastructure', 'warn', approvalId);
    await sleep(PACE_MS);
  }

  // 4) Documentation — update phase-log / decision-log / service doc.
  await step('orchestrator-agent', 'Delegating to Documentation Service');
  const doc = await peer.dispatchTask<{ updated?: string[] }>('documentation-service', {
    taskId,
    goal,
    input: { action: 'record_task', summary: `Task ${taskId}: ${goal}`, infrastructureRequestId },
    priority: 'normal',
  });
  const documents = doc.data?.updated ?? [];
  await step('documentation-service', doc.ok ? `Documentation updated (${documents.join(', ') || 'phase-log, decision-log'})` : 'Documentation Service unreachable', doc.ok ? 'success' : 'warn');
  await sleep(PACE_MS);

  // 5) Memory — store a compact reusable summary.
  await step('orchestrator-agent', 'Delegating to Memory Agent');
  const mem = await peer.dispatchTask<{ memoryId?: string }>('memory-agent', {
    taskId,
    goal,
    input: { summary: `Completed orchestration pipeline for: ${goal}` },
    priority: 'normal',
  });
  const memoryId = mem.data?.memoryId ?? null;
  await step('memory-agent', memoryId ? `Memory stored compact summary ${memoryId}` : 'Memory Agent unreachable', memoryId ? 'success' : 'warn', memoryId ?? undefined);
  await sleep(PACE_MS);

  // Compile final report.
  const finalStatus: TaskReport['status'] = approvalId ? 'awaiting_approval' : 'completed';
  const headline = approvalId
    ? 'Plan ready. Infrastructure request created and awaiting your approval to deploy.'
    : 'Goal completed.';
  const report: TaskReport = {
    goal,
    taskId,
    status: finalStatus,
    steps,
    infrastructureRequestId,
    approvalId,
    memoryId,
    documents,
    headline,
    generatedAt: nowIso(),
  };

  await tasks.updateOne(
    { taskId },
    { $set: { status: finalStatus, result: report, requiresApproval: Boolean(approvalId), updatedAt: nowIso() } },
  );

  await step('orchestrator-agent', headline, 'success');
  await ctx.publisher.publish({
    type: approvalId ? EVENT_TYPES.TASK_UPDATED : EVENT_TYPES.TASK_COMPLETED,
    taskId,
    payload: { message: 'Final report ready', report: true, status: finalStatus },
  });
}
