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
  gitHubDeliveryFromEnv,
  buildEvidence,
  buildDeploymentChecklist,
  type InfrastructureRequest,
  type GitHubOperation,
  type EvidenceRecord,
  type DeploymentChecklist,
} from '@factory/shared';
import { join } from 'node:path';
import { createFactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema));

const REPO_SERVICES_ROOT = process.env.REPO_SERVICES_ROOT ?? join(process.cwd(), '..');
const STANDARD_FILES = ['package.json', 'tsconfig.json', 'README.md', '.env.example', 'src/index.ts', 'src/factory/manifest.ts'];

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
  const input = (req.input ?? {}) as Record<string, unknown>;
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId });

  // --- GitHub delivery: branch + commit (+PR) for a generated/validated service ---
  if (input.action === 'github_deliver') {
    const serviceName = String(input.serviceName);
    const capabilityId = input.capability ? String(input.capability) : null;
    const servicePath = input.servicePath ? String(input.servicePath) : join(REPO_SERVICES_ROOT, serviceName);
    await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: `GitHub delivery for ${serviceName}` } });

    const delivery = gitHubDeliveryFromEnv();
    const operation = await delivery.deliver({
      serviceName,
      servicePath,
      files: STANDARD_FILES,
      commitMessage: `feat(${serviceName}): add generated service for capability ${capabilityId ?? 'n/a'}`,
      taskId,
      proposalId: input.proposalId ? String(input.proposalId) : null,
      capabilityId,
    });
    await collection<GitHubOperation>(COLLECTIONS.GITHUB_OPERATIONS).insertOne(operation);
    const ev = buildEvidence({ type: 'github_commit', summary: `GitHub ${operation.mode}: branch ${operation.branchName} (${operation.status})`, taskId, capabilityId, serviceName, data: { branchName: operation.branchName, status: operation.status, mode: operation.mode, pullRequestUrl: operation.pullRequestUrl, filesChanged: operation.filesChanged } });
    await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertOne(ev);
    await ctx.publisher.publish({ type: EVENT_TYPES.GITHUB_OPERATION, taskId, payload: { operationId: operation.operationId, branchName: operation.branchName, status: operation.status, mode: operation.mode, message: `GitHub ${operation.mode}: ${operation.branchName}` } });
    await ctx.publisher.publish({ type: EVENT_TYPES.EVIDENCE_RECORDED, taskId, payload: { evidenceId: ev.evidenceId, evidenceType: ev.type, message: ev.summary } });

    await finishAgentRun(runId, { status: 'succeeded', summary: `GitHub delivery ${operation.status} (${operation.branchName})` });
    return { taskId, accepted: true, agentRunId: runId, operation: { operationId: operation.operationId, branchName: operation.branchName, status: operation.status, mode: operation.mode, pullRequestUrl: operation.pullRequestUrl } };
  }

  // --- Dokploy activation checklist for a validated service ---
  if (input.action === 'activation_checklist') {
    const serviceName = String(input.serviceName);
    const capabilityId = input.capability ? String(input.capability) : null;
    await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: `Building activation checklist for ${serviceName}` } });
    const checklist = buildDeploymentChecklist({
      serviceName,
      capabilityId,
      taskId,
      extraSecrets: serviceName === 'browser-testing-agent' ? ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_S3_BUCKET'] : [],
    });
    await collection<DeploymentChecklist>(COLLECTIONS.DEPLOYMENT_CHECKLISTS).insertOne(checklist);
    const ev = buildEvidence({ type: 'deployment_check', summary: `Activation checklist created for ${serviceName} (${checklist.subdomain}:${checklist.port})`, taskId, capabilityId, serviceName, data: { checklistId: checklist.checklistId } });
    await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertOne(ev);
    await ctx.publisher.publish({ type: EVENT_TYPES.CHECKLIST_CREATED, taskId, payload: { checklistId: checklist.checklistId, serviceName, message: `Deployment checklist ready for ${serviceName}` } });
    await ctx.publisher.publish({ type: EVENT_TYPES.EVIDENCE_RECORDED, taskId, payload: { evidenceId: ev.evidenceId, evidenceType: ev.type, message: ev.summary } });
    await finishAgentRun(runId, { status: 'succeeded', summary: `Checklist ${checklist.checklistId} for ${serviceName}` });
    return { taskId, accepted: true, agentRunId: runId, checklistId: checklist.checklistId, subdomain: checklist.subdomain, port: checklist.port };
  }

  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: 'DevOps preparing infrastructure request' } });

  // Prefer an explicit serviceName (build-from-proposal path); else derive from goal.
  const explicit = (req.input as Record<string, unknown> | undefined)?.serviceName;
  const slug = explicit ? String(explicit) : slugify(req.goal);
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
      domain: `${slug.replace(/-(agent|service)$/, '')}.${ROOT_DOMAIN}`,
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
  await collection<GitHubOperation>(COLLECTIONS.GITHUB_OPERATIONS).createIndex({ operationId: 1 }, { unique: true });
  await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).createIndex({ evidenceId: 1 }, { unique: true });
  await collection<DeploymentChecklist>(COLLECTIONS.DEPLOYMENT_CHECKLISTS).createIndex({ checklistId: 1 }, { unique: true });
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
