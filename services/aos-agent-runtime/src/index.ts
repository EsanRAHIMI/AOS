/**
 * aos-agent-runtime hosts architect-agent and memory-agent in one process.
 * Research, review, QA, report, and documentation run in-process in
 * orchestrator-agent and gateway-api. voice-operator-agent stays separate.
 */
import {
  loadEnv, BaseEnvSchema, MongoEnvSchema, LlmEnvSchema, RedisEnvSchema, AgentQueueEnvSchema,
  connectMongo, createAgentTaskWorker, type AgentTaskWorkerHandle,
} from '@factory/shared';
import { buildArchitectWorker, handleTask as architectHandleTask, manifest as architectManifest } from './workers/architect-agent.js';
import { buildMemoryAgentWorker, handleTask as memoryHandleTask, manifest as memoryManifest } from './workers/memory-agent.js';

// This env describes THIS PROCESS's own identity (SERVICE_ID=aos-agent-
// runtime, SERVICE_PORT=<its own value in .env.example>) for its own
// structured logs only. It is deliberately NEVER passed into any worker
// below — each worker carries its own hardcoded manifest.serviceId and
// SERVICE_PORTS[...]-derived port (see each workers/*.ts file). This is
// what prevents "one shared SERVICE_ID env contaminates all workers" —
// proven by services/aos-agent-runtime/test/characterization.consolidated*.test.ts.
// RedisEnvSchema/AgentQueueEnvSchema: REDIS_URL unset means the queue workers
// below do not start. Set REDIS_URL to queue-enable architect-agent and memory-agent.
const env = loadEnv(
  BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema).merge(RedisEnvSchema).merge(AgentQueueEnvSchema),
);

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });

  const workerEnv = {
    FACTORY_INTERNAL_TOKEN: env.FACTORY_INTERNAL_TOKEN,
    FACTORY_ADMIN_TOKEN: env.FACTORY_ADMIN_TOKEN,
    SERVICE_REGISTRY_URL: env.SERVICE_REGISTRY_URL,
    EVENT_BUS_URL: env.EVENT_BUS_URL,
    LOG_LEVEL: env.LOG_LEVEL,
  };

  const services = await Promise.all([
    buildArchitectWorker(workerEnv),
    buildMemoryAgentWorker(workerEnv),
  ]);

  await Promise.all(services.map((s) => s.listen()));
  console.log('aos-agent-runtime: 2 workers listening (architect-agent:4103, memory-agent:4109)');

  const queueHandles: AgentTaskWorkerHandle[] = [
    createAgentTaskWorker({ serviceId: architectManifest.serviceId, redisUrl: env.REDIS_URL, handler: architectHandleTask, ctx: services[0].ctx, concurrency: env.AGENT_QUEUE_CONCURRENCY, timeoutMs: env.AGENT_QUEUE_TIMEOUT_MS, publish: (e) => services[0].ctx.publisher.publish(e) }),
    createAgentTaskWorker({ serviceId: memoryManifest.serviceId, redisUrl: env.REDIS_URL, handler: memoryHandleTask, ctx: services[1].ctx, concurrency: env.AGENT_QUEUE_CONCURRENCY, timeoutMs: env.AGENT_QUEUE_TIMEOUT_MS, publish: (e) => services[1].ctx.publisher.publish(e) }),
  ];
  if (queueHandles[0]?.enabled) {
    console.log('aos-agent-runtime: BullMQ queue workers ENABLED for architect-agent and memory-agent (REDIS_URL set)');
  } else {
    console.log('aos-agent-runtime: REDIS_URL not set — queue workers disabled, HTTP-only mode');
  }

  // Single shared graceful shutdown. Each worker was built with
  // registerSignalHandlers:false specifically so this is the ONLY SIGINT/
  // SIGTERM handler in the process — awaiting every worker's close()
  // together, then exiting once. Without this, each worker's own default
  // handler would call process.exit(0) the moment its OWN close()
  // resolved, before the others finished. See @factory/service-kit.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      console.log(`aos-agent-runtime: received ${sig}, shutting down ${services.length} HTTP + ${queueHandles.length} queue workers`);
      void Promise.all([...services.map((s) => s.close()), ...queueHandles.map((q) => q.close())]).finally(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
