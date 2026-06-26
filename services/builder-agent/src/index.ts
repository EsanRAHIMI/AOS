/**
 * Builder Agent — entry point (Phase 3).
 *
 * Two modes:
 *  - scaffold_service: generates a real, standard, independently-deployable
 *    service from an approved expansion proposal using the shared generator.
 *  - default: acknowledges the architect plan (standard delegation pipeline).
 */
import { join } from 'node:path';
import {
  loadEnv,
  BaseEnvSchema,
  MongoEnvSchema,
  LlmEnvSchema,
  connectMongo,
  collection,
  COLLECTIONS,
  EVENT_TYPES,
  ROOT_DOMAIN,
  startAgentRun,
  finishAgentRun,
  scaffoldService,
  validateService,
  buildEvidence,
  type RuntimeValidation,
  type EvidenceRecord,
} from '@factory/shared';
import { createFactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema));

/** Where generated services are written. Defaults to a sandbox dir, overridable. */
const SERVICES_ROOT = process.env.SERVICES_ROOT ?? join(process.cwd(), 'generated-services');
/** Where existing repo services live (for validating in-repo services). */
const REPO_SERVICES_ROOT = process.env.REPO_SERVICES_ROOT ?? join(process.cwd(), '..');

function derivePort(slug: string): number {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) % 1000;
  return 4200 + h;
}

const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? 'unknown';
  const input = (req.input ?? {}) as Record<string, unknown>;
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId });

  if (input.action === 'scaffold_service') {
    const serviceName = String(input.serviceName);
    const capabilityId = String(input.capability ?? 'unknown_capability');
    const subdomain = `${serviceName.replace(/-(agent|service)$/, '')}.${ROOT_DOMAIN}`;
    await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: `Builder scaffolding ${serviceName}` } });

    const result = await scaffoldService({
      serviceName,
      capabilityId,
      description: String(input.description ?? `Provides capability ${capabilityId}.`),
      port: derivePort(serviceName),
      subdomain,
      toolName: (input.toolName as string | null) ?? null,
      servicesRoot: SERVICES_ROOT,
    });

    const summary = `Scaffolded ${serviceName} at ${result.path} (${result.files.length} files).`;
    await finishAgentRun(runId, { status: 'succeeded', summary });
    await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_FINISHED, taskId, payload: { agentRunId: runId, message: summary } });
    return { taskId, accepted: true, agentRunId: runId, path: result.path, files: result.files };
  }

  if (input.action === 'validate_service') {
    const serviceName = String(input.serviceName);
    const capabilityId = String(input.capability ?? 'unknown_capability');
    const servicePath = input.servicePath ? String(input.servicePath) : join(REPO_SERVICES_ROOT, serviceName);
    await ctx.publisher.publish({ type: EVENT_TYPES.VALIDATION_STARTED, taskId, payload: { agentRunId: runId, serviceName, message: `Validating ${serviceName}` } });

    const { validation, evidence: drafts } = await validateService({
      servicePath,
      serviceName,
      capabilityId,
      taskId,
      allowBuild: process.env.ALLOW_BUILD_VALIDATION === 'true',
      workspaceRoot: process.env.WORKSPACE_ROOT,
    });
    await collection<RuntimeValidation>(COLLECTIONS.RUNTIME_VALIDATIONS).insertOne(validation);

    const evidence = drafts.map((d) => buildEvidence({ ...d, taskId, capabilityId, serviceName }));
    if (evidence.length) await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertMany(evidence);
    for (const e of evidence) await ctx.publisher.publish({ type: EVENT_TYPES.EVIDENCE_RECORDED, taskId, payload: { evidenceId: e.evidenceId, evidenceType: e.type, message: e.summary } });
    await ctx.publisher.publish({ type: EVENT_TYPES.VALIDATION_COMPLETED, taskId, payload: { validationId: validation.validationId, passed: validation.passed, score: validation.score, message: `Validation ${validation.passed ? 'passed' : 'failed'} (${validation.score})` } });

    await finishAgentRun(runId, { status: 'succeeded', summary: `Validated ${serviceName}: ${validation.passed} (${validation.score})` });
    return { taskId, accepted: true, agentRunId: runId, validation: { validationId: validation.validationId, passed: validation.passed, score: validation.score }, evidenceIds: evidence.map((e) => e.evidenceId), recommendations: validation.recommendations };
  }

  // Default: standard delegation acknowledgement.
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: 'Builder scaffolding implementation' } });
  const result = { scaffolded: ['src/index.ts', 'src/factory/manifest.ts', 'package.json', 'README.md'], summary: `Scaffolded a standard service skeleton for "${req.goal}".` };
  await finishAgentRun(runId, { status: 'succeeded', summary: result.summary });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_FINISHED, taskId, payload: { agentRunId: runId, message: 'Builder scaffold complete' } });
  return { taskId, accepted: true, agentRunId: runId, ...result };
};

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  await collection<RuntimeValidation>(COLLECTIONS.RUNTIME_VALIDATIONS).createIndex({ validationId: 1 }, { unique: true });
  await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).createIndex({ evidenceId: 1 }, { unique: true });
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
