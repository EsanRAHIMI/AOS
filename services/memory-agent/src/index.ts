/**
 * Memory Agent — entry point (Phase 2).
 *
 * Stores a compact, reusable task memory after the orchestration pipeline runs:
 * a token-efficient summary future agents can read instead of re-deriving
 * context. Emits memory.written.
 */
import {
  loadEnv,
  BaseEnvSchema,
  MongoEnvSchema,
  LlmEnvSchema,
  connectMongo,
  collection,
  COLLECTIONS,
  EVENT_TYPES,
  genId,
  nowIso,
  startAgentRun,
  finishAgentRun,
  type Memory,
} from '@factory/shared';
import { createFactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema));

const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? 'unknown';
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: 'Memory writing task summary' } });

  const memoryId = genId('mem');
  const memory: Memory = {
    memoryId,
    type: 'task_memory',
    title: `Task summary: ${req.goal.slice(0, 60)}`,
    summary:
      `Goal: ${req.goal}. Orchestrated standard pipeline architect→builder→devops→documentation→memory. ` +
      `A Dokploy infrastructure request and an approval gate were created. ` +
      `Reusable pattern: "new independent service" — design, scaffold, infra request, doc update, memory write.`,
    taskId,
    serviceId: manifest.serviceId,
    tags: ['pipeline', 'phase2', 'new-service'],
    confidence: 'medium',
    createdAt: nowIso(),
  };

  await collection<Memory>(COLLECTIONS.MEMORIES).insertOne(memory);
  await ctx.publisher.publish({ type: EVENT_TYPES.MEMORY_WRITTEN, taskId, payload: { memoryId, message: `Memory ${memoryId} stored` } });

  await finishAgentRun(runId, { status: 'succeeded', summary: memory.summary });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_FINISHED, taskId, payload: { agentRunId: runId, message: 'Memory write complete' } });

  return { taskId, accepted: true, agentRunId: runId, memoryId };
};

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  await collection<Memory>(COLLECTIONS.MEMORIES).createIndex({ memoryId: 1 }, { unique: true });
  await collection<Memory>(COLLECTIONS.MEMORIES).createIndex({ taskId: 1 });
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
