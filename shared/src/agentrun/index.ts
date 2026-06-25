/**
 * Helpers for recording agent runs — every specialist agent persists a
 * traceable run for memory, debugging, and future training datasets.
 */
import { collection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import type { AgentRun } from '../schemas/agent-run.js';

export async function startAgentRun(opts: {
  agentId: string;
  serviceId: string;
  taskId: string;
}): Promise<string> {
  const agentRunId = genId('arun');
  const run: AgentRun = {
    agentRunId,
    agentId: opts.agentId,
    serviceId: opts.serviceId,
    taskId: opts.taskId,
    status: 'running',
    steps: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    startedAt: nowIso(),
    finishedAt: null,
    error: null,
  };
  await collection<AgentRun>(COLLECTIONS.AGENT_RUNS).insertOne(run);
  return agentRunId;
}

export async function finishAgentRun(
  agentRunId: string,
  patch: { status: AgentRun['status']; summary?: string; error?: string; steps?: number },
): Promise<void> {
  await collection<AgentRun>(COLLECTIONS.AGENT_RUNS).updateOne(
    { agentRunId },
    {
      $set: {
        status: patch.status,
        finishedAt: nowIso(),
        steps: patch.steps ?? 1,
        ...(patch.summary ? { summary: patch.summary } : {}),
        ...(patch.error ? { error: patch.error } : {}),
      },
    },
  );
}
