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
import { loadEnv, BaseEnvSchema, MongoEnvSchema, LlmEnvSchema, ResearchEnvSchema, connectMongo } from '@factory/shared';
import { buildArchitectWorker } from './workers/architect-agent.js';
import { buildQaWorker } from './workers/qa-agent.js';
import { buildReviewerWorker } from './workers/reviewer-agent.js';
import { buildReportWorker } from './workers/report-agent.js';
import { buildDocumentationServiceWorker } from './workers/documentation-service.js';
import { buildMemoryAgentWorker } from './workers/memory-agent.js';
import { buildInternetResearchServiceWorker } from './workers/internet-research-service.js';

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
const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema).merge(ResearchEnvSchema));

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

  // Single shared graceful shutdown. Each worker was built with
  // registerSignalHandlers:false specifically so this is the ONLY SIGINT/
  // SIGTERM handler in the process — awaiting every worker's close()
  // together, then exiting once. Without this, each worker's own default
  // handler would call process.exit(0) the moment its OWN close()
  // resolved, before the others finished. See @factory/service-kit.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      console.log(`aos-agent-runtime: received ${sig}, shutting down ${services.length} workers`);
      void Promise.all(services.map((s) => s.close())).finally(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
