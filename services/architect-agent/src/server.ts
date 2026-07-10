/**
 * Architect Agent — service construction (K1 Consolidation Prep, D-168).
 *
 * Split out from index.ts, same pattern as gateway-api's server.ts/index.ts
 * split: this file builds the exact service (manifest, task handler,
 * standard endpoints) without listening on a real port or requiring a real
 * Mongo connection, so characterization tests can exercise it in-process via
 * app.inject() + an injected test Db. This is the baseline-behavior oracle
 * for the planned aos-agent-runtime consolidation — no behavior change from
 * the original single-file version.
 */
import {
  collection, COLLECTIONS, EVENT_TYPES,
  startAgentRun, finishAgentRun, llmRouterFromEnv, buildLlmCostRecord, buildEvidence, runArchitecturePlan,
  type LlmTrace, type LlmCostRecord, type EvidenceRecord,
} from '@factory/shared';
import { createFactoryService, type FactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

export { manifest };

/** Derive a clean, boring service slug from a free-text goal. */
function slugify(goal: string): string {
  const base = goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return base ? `${base}-service` : 'new-service';
}

export const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? 'unknown';
  const input = (req.input ?? {}) as { action?: string; phase?: string; research?: { findings?: string[]; sources?: string[]; reportId?: string }; forceFallback?: boolean };
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: 'Architect working' } });

  // Phase 13 — evidence-grounded improvement plan.
  if (input.action === 'improvement_plan' || input.research) {
    const router = llmRouterFromEnv();
    const { plan, content, trace } = await runArchitecturePlan({
      router, taskId, goal: req.goal,
      findings: input.research?.findings ?? [], sources: input.research?.sources ?? [], forceFallback: input.forceFallback,
    });
    await collection<LlmTrace>(COLLECTIONS.LLM_TRACES).insertOne(trace);
    await collection<LlmCostRecord>(COLLECTIONS.LLM_COST_RECORDS).insertOne(buildLlmCostRecord(trace));
    const mode = trace.usedFallback ? 'fallback' : 'real';
    const evidence: EvidenceRecord = buildEvidence({ type: 'review_report', taskId, summary: `Improvement plan for "${req.goal}" (${plan.steps.length} steps, ${mode})`, data: { objective: plan.objective, mode, basedOn: input.research?.reportId ?? null } });
    await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertOne(evidence);
    await finishAgentRun(runId, { status: 'succeeded', summary: `Improvement plan ready (${mode}).` });
    await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_FINISHED, taskId, payload: { agentRunId: runId, message: `Architect improvement plan ready (${mode})`, planSteps: plan.steps.length } });
    return { taskId, accepted: true, agentRunId: runId, plan: { planId: evidence.evidenceId, objective: plan.objective, steps: plan.steps, risks: plan.risks, summary: plan.summary, content, evidenceId: evidence.evidenceId, mode, traceId: trace.traceId } };
  }

  // Phase 2 — service design (unchanged).
  const serviceName = slugify(req.goal);
  const design = {
    serviceName, serviceType: 'agent',
    capabilities: ['receive_task', 'execute_goal', 'report_result'],
    collections: ['tasks', 'agent_runs', 'events'],
    summary: `Design for "${req.goal}": one independent service (${serviceName}) following the standard factory surface, HTTP + internal-token comms, MongoDB-backed state.`,
  };
  await finishAgentRun(runId, { status: 'succeeded', summary: design.summary });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_FINISHED, taskId, payload: { agentRunId: runId, message: 'Architect plan ready', design } });
  return { taskId, accepted: true, agentRunId: runId, design };
};

export interface ArchitectAgentEnv {
  SERVICE_PORT: number;
  FACTORY_INTERNAL_TOKEN: string;
  FACTORY_ADMIN_TOKEN?: string;
  SERVICE_REGISTRY_URL?: string;
  EVENT_BUS_URL?: string;
  LOG_LEVEL?: string;
}

export async function buildArchitectAgentService(env: ArchitectAgentEnv): Promise<FactoryService> {
  return createFactoryService({
    manifest, port: env.SERVICE_PORT, internalToken: env.FACTORY_INTERNAL_TOKEN, adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL, eventBusUrl: env.EVENT_BUS_URL, logLevel: env.LOG_LEVEL, taskHandler: handleTask,
  });
}
