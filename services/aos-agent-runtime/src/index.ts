/**
 * aos-agent-runtime — entry point (K1 Consolidation Prep, D-168/D-172).
 *
 * Hosts 7 of the eventual ~9 logical agent workers named in
 * docs/master-direction.md §C.1 as separate createFactoryService()
 * instances inside ONE process:
 *   - Batch 1 (D-168): architect, qa, reviewer, report.
 *   - Batch 2A (D-172): documentation-service, memory-agent,
 *     internet-research-service — full-source-read classified "safe to
 *     consolidate now" in D-170 (pure Mongo CRUD and/or LLM-router/
 *     read-only-web-search calls; no filesystem write, no write-capable
 *     external API, no spawned OS process, no background timer).
 * builder/devops/monitor/voice-operator/browser-testing are explicitly NOT
 * included — D-170 classified each as must-remain-separate (filesystem
 * writes, real GitHub API writes, live secret minting, or a spawned browser
 * process).
 *
 * Each worker still binds its OWN historical port/domain/serviceId
 * (architect-agent:4103, reviewer-agent:4106, qa-agent:4107,
 * memory-agent:4109, documentation-service:4110, report-agent:4114,
 * internet-research-service:4115), so orchestrator-agent's PeerClient, the
 * dashboard's static service catalog, and Dokploy's existing domain routing
 * all keep working completely unchanged — this is a compatibility-shim
 * consolidation, not a contract change.
 *
 * IMPORTANT — production topology has NOT changed by this file existing.
 * CODE-LEVEL CANDIDATE ONLY — PRODUCTION TOPOLOGY UNCHANGED. All 7 original
 * services remain the live production deployables until a human
 * deliberately repoints Dokploy at this one instead. The Batch-1 cutover
 * spec/status is BLOCKED_ON_MANUAL_DEPLOYMENT (D-169/D-171); Batch 2A has
 * no cutover spec at all yet — this pass is code-level only, per explicit
 * instruction not to touch Dokploy. See docs/deployment-plan.md and
 * decision-log D-168/D-169/D-170/D-171/D-172.
 */
import {
  loadEnv, BaseEnvSchema, MongoEnvSchema, LlmEnvSchema, ResearchEnvSchema, RedisEnvSchema, AgentQueueEnvSchema,
  connectMongo, collection, COLLECTIONS, createAgentTaskWorker, type AgentTaskWorkerHandle,
} from '@factory/shared';
import { buildArchitectWorker, handleTask as architectHandleTask, manifest as architectManifest } from './workers/architect-agent.js';
import { buildQaWorker, handleTask as qaHandleTask, manifest as qaManifest } from './workers/qa-agent.js';
import { buildReviewerWorker, handleTask as reviewerHandleTask, manifest as reviewerManifest } from './workers/reviewer-agent.js';
import { buildReportWorker, handleTask as reportHandleTask, manifest as reportManifest } from './workers/report-agent.js';
import { buildDocumentationServiceWorker, buildHandleTask as buildDocsHandleTask, manifest as docsManifest, type DocRecord } from './workers/documentation-service.js';
import { buildMemoryAgentWorker, handleTask as memoryHandleTask, manifest as memoryManifest } from './workers/memory-agent.js';
import { buildInternetResearchServiceWorker, handleTask as researchHandleTask, manifest as researchManifest } from './workers/internet-research-service.js';

// This env describes THIS PROCESS's own identity (SERVICE_ID=aos-agent-
// runtime, SERVICE_PORT=<its own value in .env.example>) for its own
// structured logs only. It is deliberately NEVER passed into any worker
// below — each worker carries its own hardcoded manifest.serviceId and
// SERVICE_PORTS[...]-derived port (see each workers/*.ts file). This is
// what prevents "one shared SERVICE_ID env contaminates all workers" —
// proven by services/aos-agent-runtime/test/characterization.consolidated*.test.ts.
// ResearchEnvSchema is merged so TAVILY_API_KEY validates the same way the
// original internet-research-service does, even though the worker itself
// reads it from raw process.env (see workers/internet-research-service.ts).
// RedisEnvSchema/AgentQueueEnvSchema (K1 BullMQ Task Queue, D-173): REDIS_URL
// unset (the default) means the 7 BullMQ Workers below simply don't start —
// this process runs exactly as it did before D-173, HTTP-only. Set REDIS_URL
// to additionally queue-enable all 7 workers; see decision-log D-173.
const env = loadEnv(
  BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema).merge(ResearchEnvSchema).merge(RedisEnvSchema).merge(AgentQueueEnvSchema),
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
    buildQaWorker(workerEnv),
    buildReviewerWorker(workerEnv),
    buildReportWorker(workerEnv),
    buildDocumentationServiceWorker(workerEnv),
    buildMemoryAgentWorker(workerEnv),
    buildInternetResearchServiceWorker(workerEnv),
  ]);

  await Promise.all(services.map((s) => s.listen()));
  console.log(
    `aos-agent-runtime: ${services.length} workers listening ` +
      '(architect-agent:4103, reviewer-agent:4106, qa-agent:4107, memory-agent:4109, ' +
      'documentation-service:4110, report-agent:4114, internet-research-service:4115)',
  );

  // --- K1 BullMQ Task Queue (D-173) — additive, HTTP untouched ------------
  // Each of the 7 workers' EXISTING handleTask (the exact same function the
  // HTTP /.factory/task route above already calls) is wired to its own
  // BullMQ Worker, one queue per serviceId. When REDIS_URL is unset,
  // createAgentTaskWorker returns {enabled:false} and starts nothing — see
  // decision-log D-173's "honest degraded behavior" requirement.
  // services[] index order matches the Promise.all build order above exactly:
  // [0]=architect [1]=qa [2]=reviewer [3]=report [4]=documentation-service
  // [5]=memory [6]=internet-research-service.
  const docsWorkerService = services[4];
  const queueHandles: AgentTaskWorkerHandle[] = [
    createAgentTaskWorker({ serviceId: architectManifest.serviceId, redisUrl: env.REDIS_URL, handler: architectHandleTask, ctx: services[0].ctx, concurrency: env.AGENT_QUEUE_CONCURRENCY, timeoutMs: env.AGENT_QUEUE_TIMEOUT_MS, publish: (e) => services[0].ctx.publisher.publish(e) }),
    createAgentTaskWorker({ serviceId: qaManifest.serviceId, redisUrl: env.REDIS_URL, handler: qaHandleTask, ctx: services[1].ctx, concurrency: env.AGENT_QUEUE_CONCURRENCY, timeoutMs: env.AGENT_QUEUE_TIMEOUT_MS, publish: (e) => services[1].ctx.publisher.publish(e) }),
    createAgentTaskWorker({ serviceId: reviewerManifest.serviceId, redisUrl: env.REDIS_URL, handler: reviewerHandleTask, ctx: services[2].ctx, concurrency: env.AGENT_QUEUE_CONCURRENCY, timeoutMs: env.AGENT_QUEUE_TIMEOUT_MS, publish: (e) => services[2].ctx.publisher.publish(e) }),
    createAgentTaskWorker({ serviceId: reportManifest.serviceId, redisUrl: env.REDIS_URL, handler: reportHandleTask, ctx: services[3].ctx, concurrency: env.AGENT_QUEUE_CONCURRENCY, timeoutMs: env.AGENT_QUEUE_TIMEOUT_MS, publish: (e) => services[3].ctx.publisher.publish(e) }),
    createAgentTaskWorker({
      serviceId: docsManifest.serviceId, redisUrl: env.REDIS_URL,
      handler: buildDocsHandleTask(collection<DocRecord>(COLLECTIONS.DOCUMENTS)),
      ctx: docsWorkerService.ctx, concurrency: env.AGENT_QUEUE_CONCURRENCY, timeoutMs: env.AGENT_QUEUE_TIMEOUT_MS,
      publish: (e) => docsWorkerService.ctx.publisher.publish(e),
    }),
    createAgentTaskWorker({ serviceId: memoryManifest.serviceId, redisUrl: env.REDIS_URL, handler: memoryHandleTask, ctx: services[5].ctx, concurrency: env.AGENT_QUEUE_CONCURRENCY, timeoutMs: env.AGENT_QUEUE_TIMEOUT_MS, publish: (e) => services[5].ctx.publisher.publish(e) }),
    createAgentTaskWorker({ serviceId: researchManifest.serviceId, redisUrl: env.REDIS_URL, handler: researchHandleTask, ctx: services[6].ctx, concurrency: env.AGENT_QUEUE_CONCURRENCY, timeoutMs: env.AGENT_QUEUE_TIMEOUT_MS, publish: (e) => services[6].ctx.publisher.publish(e) }),
  ];
  if (queueHandles[0]?.enabled) {
    console.log(`aos-agent-runtime: BullMQ queue workers ENABLED for all 7 services (REDIS_URL set) — HTTP /.factory/task remains fully functional in parallel`);
  } else {
    console.log('aos-agent-runtime: REDIS_URL not set — queue workers disabled, HTTP-only mode (unchanged from pre-D-173 behavior)');
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
