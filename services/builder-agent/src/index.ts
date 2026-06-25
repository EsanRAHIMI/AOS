/**
 * Builder Agent — entry point (Phase 2).
 *
 * Acknowledges the architect's plan and reports a scaffold result. Real code
 * generation/tooling is layered in later phases; the run + events are real now.
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

const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? 'unknown';
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: 'Builder scaffolding implementation' } });

  const result = {
    scaffolded: ['src/index.ts', 'src/factory/manifest.ts', 'package.json', 'README.md'],
    summary: `Scaffolded a standard service skeleton for "${req.goal}" from the architect plan.`,
  };

  await finishAgentRun(runId, { status: 'succeeded', summary: result.summary });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_FINISHED, taskId, payload: { agentRunId: runId, message: 'Builder scaffold complete', files: result.scaffolded.length } });

  return { taskId, accepted: true, agentRunId: runId, ...result };
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
