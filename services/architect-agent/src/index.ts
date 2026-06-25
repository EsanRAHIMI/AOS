/**
 * Architect Agent — entry point (Phase 2).
 *
 * Produces a concrete service design plan for a goal: a proposed service name,
 * type, capabilities, collections, and a one-line architecture summary. Records
 * a traceable agent run and emits lifecycle events.
 */
import {
  loadEnv,
  BaseEnvSchema,
  MongoEnvSchema,
  LlmEnvSchema,
  connectMongo,
  EVENT_TYPES,
  startAgentRun,
  finishAgentRun,
} from '@factory/shared';
import { createFactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema));

/** Derive a clean, boring service slug from a free-text goal. */
function slugify(goal: string): string {
  const base = goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return base ? `${base}-service` : 'new-service';
}

const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? 'unknown';
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: 'Architect designing service' } });

  const serviceName = slugify(req.goal);
  const design = {
    serviceName,
    serviceType: 'agent',
    capabilities: ['receive_task', 'execute_goal', 'report_result'],
    collections: ['tasks', 'agent_runs', 'events'],
    summary: `Design for "${req.goal}": one independent service (${serviceName}) following the standard factory surface, HTTP + internal-token comms, MongoDB-backed state.`,
  };

  const summary = design.summary;
  await finishAgentRun(runId, { status: 'succeeded', summary });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_FINISHED, taskId, payload: { agentRunId: runId, message: 'Architect plan ready', design } });

  return { taskId, accepted: true, agentRunId: runId, design };
};

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  const service = await createFactoryService({
    manifest,
    port: env.SERVICE_PORT,
    internalToken: env.FACTORY_INTERNAL_TOKEN,
    adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL,
    eventBusUrl: env.EVENT_BUS_URL,
    logLevel: env.LOG_LEVEL,
    taskHandler: handleTask,
  });
  await service.listen();
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
