/**
 * aos-agent-runtime — entry point (K1 Consolidation Prep, D-168).
 *
 * Hosts 4 of the eventual ~9 logical agent workers named in
 * docs/master-direction.md §C.1 (architect, qa, reviewer, report — the
 * confirmed-thin shells; builder/devops/memory/monitor/research are
 * explicitly NOT included in this pass) as separate createFactoryService()
 * instances inside ONE process. Each worker still binds its OWN historical
 * port/domain/serviceId (architect-agent:4103, reviewer-agent:4106,
 * qa-agent:4107, report-agent:4114), so orchestrator-agent's PeerClient,
 * the dashboard's static service catalog, and Dokploy's existing domain
 * routing all keep working completely unchanged — this is a compatibility-
 * shim consolidation, not a contract change.
 *
 * IMPORTANT — production topology has NOT changed by this file existing.
 * The four original services (services/architect-agent, qa-agent,
 * reviewer-agent, report-agent) remain the live production deployables
 * until a human deliberately repoints Dokploy at this one instead. See
 * docs/deployment-plan.md → "aos-agent-runtime cutover (transitional)" and
 * decision-log D-168.
 */
import { loadEnv, BaseEnvSchema, MongoEnvSchema, LlmEnvSchema, connectMongo } from '@factory/shared';
import { buildArchitectWorker } from './workers/architect-agent.js';
import { buildQaWorker } from './workers/qa-agent.js';
import { buildReviewerWorker } from './workers/reviewer-agent.js';
import { buildReportWorker } from './workers/report-agent.js';

// This env describes THIS PROCESS's own identity (SERVICE_ID=aos-agent-
// runtime, SERVICE_PORT=<its own value in .env.example>) for its own
// structured logs only. It is deliberately NEVER passed into any of the 4
// workers below — each worker carries its own hardcoded manifest.serviceId
// and SERVICE_PORTS[...]-derived port (see each workers/*.ts file). This is
// what prevents "one shared SERVICE_ID env contaminates all four" — proven
// by services/aos-agent-runtime/test/characterization.consolidated.test.ts.
const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema));

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
  ]);

  await Promise.all(services.map((s) => s.listen()));
  console.log(
    `aos-agent-runtime: ${services.length} workers listening ` +
      '(architect-agent:4103, reviewer-agent:4106, qa-agent:4107, report-agent:4114)',
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
