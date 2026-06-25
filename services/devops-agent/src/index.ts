/**
 * DevOps Agent — entry point (Phase 2).
 *
 * Generates a real, persisted Dokploy infrastructure request for the goal: an
 * exact app spec (root dir, domain, port, build/start commands, health check)
 * plus the required env list. The orchestrator then opens an approval gate
 * around it. The system never assumes host control — it asks the human to
 * create the infra in Dokploy and confirm.
 */
import {
  loadEnv,
  BaseEnvSchema,
  MongoEnvSchema,
  connectMongo,
  collection,
  COLLECTIONS,
  EVENT_TYPES,
  ROOT_DOMAIN,
  genId,
  nowIso,
  startAgentRun,
  finishAgentRun,
  type InfrastructureRequest,
} from '@factory/shared';
import { createFactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema));

function slugify(goal: string): string {
  const base = goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return base ? `${base}-service` : 'new-service';
}

/** Next free port above the reserved range, derived deterministically from the slug. */
function derivePort(slug: string): number {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) % 1000;
  return 4200 + h; // outside the 4100-4115 reserved core range
}

const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? 'unknown';
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: 'DevOps preparing infrastructure request' } });

  const slug = slugify(req.goal);
  const port = derivePort(slug);
  const requestId = genId('infra');
  const now = nowIso();

  const request: InfrastructureRequest = {
    requestId,
    serviceName: slug,
    serviceType: 'agent-service',
    reason: `Required to fulfill goal: ${req.goal}`,
    dokploy: {
      appName: slug,
      domain: `${slug.replace(/-service$/, '')}.${ROOT_DOMAIN}`,
      port,
      repository: 'github.com/<owner>/autonomous-os-kernel',
      rootDirectory: `services/${slug}`,
      buildCommand: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/${slug}... run build`,
      startCommand: `pnpm --filter @factory/${slug} run start`,
      healthCheck: '/health',
    },
    env: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN', 'SERVICE_REGISTRY_URL', 'EVENT_BUS_URL'],
    status: 'waiting_user_creation',
    createdAt: now,
    updatedAt: now,
  };

  await collection<InfrastructureRequest>(COLLECTIONS.INFRASTRUCTURE_REQUESTS).insertOne(request);
  await ctx.publisher.publish({
    type: EVENT_TYPES.INFRA_REQUEST_CREATED,
    taskId,
    payload: { infrastructureRequestId: requestId, serviceName: slug, domain: request.dokploy.domain, port, message: `Infrastructure request ${requestId} created` },
  });

  const summary = `Generated Dokploy infrastructure request for ${slug} (${request.dokploy.domain}:${port}).`;
  await finishAgentRun(runId, { status: 'succeeded', summary });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_FINISHED, taskId, payload: { agentRunId: runId, message: summary } });

  return { taskId, accepted: true, agentRunId: runId, infrastructureRequestId: requestId, dokploy: request.dokploy };
};

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  await collection<InfrastructureRequest>(COLLECTIONS.INFRASTRUCTURE_REQUESTS).createIndex({ requestId: 1 }, { unique: true });
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
