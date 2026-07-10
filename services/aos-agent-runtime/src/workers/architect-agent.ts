/**
 * Architect Agent worker (K1 Consolidation Prep, D-168).
 *
 * Deliberately duplicated from services/architect-agent/src/server.ts, not
 * imported — every service in this repo is independently deployable/
 * buildable and none imports another service's source (see
 * docs/development-rules.md). This copy and the original are kept
 * behaviorally identical by
 * services/aos-agent-runtime/test/characterization.consolidated.test.ts,
 * which re-runs architect-agent's own baseline characterization assertions
 * against THIS build. If you change one, change both and re-run both
 * suites.
 *
 * serviceId and port are hardcoded here (not read from any shared/generic
 * env var) so this worker keeps its historical identity/domain/port no
 * matter what SERVICE_ID/SERVICE_PORT the hosting aos-agent-runtime
 * process itself was started with — see index.ts's top comment.
 */
import {
  collection, COLLECTIONS, EVENT_TYPES,
  startAgentRun, finishAgentRun, llmRouterFromEnv, buildLlmCostRecord, buildEvidence, runArchitecturePlan,
  SERVICE_PORTS, SERVICE_SUBDOMAINS, SERVICE_VERSION,
  type LlmTrace, type LlmCostRecord, type EvidenceRecord, type ServiceManifest,
} from '@factory/shared';
import { createFactoryService, type FactoryService, type TaskHandler } from '@factory/service-kit';

export const manifest: ServiceManifest = {
  serviceId: 'architect-agent',
  serviceName: 'Architect Agent',
  serviceType: 'agent',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['architect-agent']}`,
  healthEndpoint: '/health',
  capabilities: [
    'design_service_architecture',
    'define_service_boundaries',
    'generate_api_contracts',
    'define_database_schema',
    'define_event_flows',
    'define_env_vars',
    'create_deployment_requirements',
  ],
  dependencies: ['gateway-api', 'memory-agent', 'documentation-service', 'event-bus-service', 'service-registry'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
};

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

export interface WorkerEnv {
  FACTORY_INTERNAL_TOKEN: string;
  FACTORY_ADMIN_TOKEN?: string;
  SERVICE_REGISTRY_URL?: string;
  EVENT_BUS_URL?: string;
  LOG_LEVEL?: string;
}

export async function buildArchitectWorker(env: WorkerEnv): Promise<FactoryService> {
  return createFactoryService({
    manifest, port: SERVICE_PORTS['architect-agent'], internalToken: env.FACTORY_INTERNAL_TOKEN, adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL, eventBusUrl: env.EVENT_BUS_URL, logLevel: env.LOG_LEVEL, taskHandler: handleTask,
    // K1 Consolidation Prep (D-168): this instance shares a process with 3
    // siblings — the entrypoint (index.ts) owns ONE shared shutdown handler
    // instead. See @factory/service-kit's registerSignalHandlers doc.
    registerSignalHandlers: false,
  });
}
