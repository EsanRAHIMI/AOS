/**
 * Phase Y — Autonomous Staging Workspace & Service Evolution Runtime (shared core).
 *
 * Deterministic, dependency-free logic for the self-development engine:
 *  - schemas for the 8 workspace collections
 *  - the verification matrix (per service kind)
 *  - migration-plan + rollback builders (protected core ⇒ critical/owner)
 *  - new-service allocation (id / port / subdomain / package) and the FULL
 *    file template generator that produces a real, standards-compliant
 *    factory service (health + .factory endpoints, manifest, README, env,
 *    Dokploy spec) — no fake services.
 *  - resource-limit configuration
 *
 * Execution (copying, editing, building, running, probing) happens in the
 * code-operator-agent, which confines everything to `.workspaces/` inside its
 * checkout. Live services are NEVER edited in place; promotion goes through a
 * git branch + staged Dokploy app, always approval-gated upstream.
 */
import { z } from 'zod';
import { IsoDate } from '../schemas/common.js';
import { SERVICE_PORTS, ROOT_DOMAIN } from '../constants/index.js';
import { isProtectedCore } from '../operations/index.js';

/* ================================ schemas =============================== */

export const WorkspaceMode = z.enum([
  'evolve_existing_service', 'create_new_service', 'repair_service', 'refactor_service',
  'upgrade_ui', 'upgrade_backend', 'add_capability',
]);
export type WorkspaceMode = z.infer<typeof WorkspaceMode>;

export const WorkspaceStatus = z.enum([
  'created', 'copying', 'planning', 'generating', 'editing', 'installing', 'building', 'testing',
  'booting', 'probing', 'fixing', 'running', 'verifying', 'ready_for_review', 'ready_for_migration',
  'waiting_approval', 'migrating', 'completed', 'failed', 'cancelled',
]);
export type WorkspaceStatus = z.infer<typeof WorkspaceStatus>;

export const WorkspaceSchema = z.object({
  workspaceId: z.string(),
  goal: z.string(),
  mode: WorkspaceMode,
  sourceServiceId: z.string().nullable().default(null),
  sourcePath: z.string().default(''),
  workspacePath: z.string(),
  serviceDirName: z.string().default(''),
  status: WorkspaceStatus.default('created'),
  branchName: z.string().default(''),
  sourceCommit: z.string().default(''),
  tempPort: z.number().nullable().default(null),
  iterations: z.number().default(0),
  filesChanged: z.number().default(0),
  lastError: z.string().default(''),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceRunSchema = z.object({
  runId: z.string(),
  workspaceId: z.string(),
  iteration: z.number(),
  action: z.string(),
  ok: z.boolean(),
  summary: z.string().default(''),
  durationMs: z.number().default(0),
  createdAt: IsoDate,
});
export type WorkspaceRun = z.infer<typeof WorkspaceRunSchema>;

export const WorkspaceServiceSchema = z.object({
  workspaceServiceId: z.string(),
  workspaceId: z.string(),
  serviceId: z.string(),
  packageName: z.string(),
  proposedPort: z.number(),
  proposedSubdomain: z.string(),
  capabilities: z.array(z.string()).default([]),
  requiredEnv: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type WorkspaceService = z.infer<typeof WorkspaceServiceSchema>;

export const WorkspaceChangeSchema = z.object({
  changeId: z.string(),
  workspaceId: z.string(),
  file: z.string(),
  changeType: z.enum(['create', 'edit', 'delete']),
  summary: z.string().default(''),
  bytes: z.number().default(0),
  createdAt: IsoDate,
});
export type WorkspaceChange = z.infer<typeof WorkspaceChangeSchema>;

export const WorkspaceTestSchema = z.object({
  testId: z.string(),
  workspaceId: z.string(),
  checkId: z.string(),
  label: z.string(),
  status: z.enum(['passed', 'failed', 'skipped', 'not_applicable']),
  detail: z.string().default(''),
  durationMs: z.number().default(0),
  createdAt: IsoDate,
});
export type WorkspaceTest = z.infer<typeof WorkspaceTestSchema>;

export const WorkspaceArtifactSchema = z.object({
  artifactId: z.string(),
  workspaceId: z.string(),
  kind: z.enum(['log', 'diff', 'probe_result', 'build_output', 'report']),
  label: z.string(),
  content: z.string().default(''),
  createdAt: IsoDate,
});
export type WorkspaceArtifact = z.infer<typeof WorkspaceArtifactSchema>;

export const MigrationType = z.enum([
  'replace_existing_service', 'create_new_service', 'deploy_staged_service', 'open_pr_only', 'manual_review_only',
]);
export type MigrationType = z.infer<typeof MigrationType>;

export const WorkspaceMigrationSchema = z.object({
  migrationId: z.string(),
  workspaceId: z.string(),
  sourceServiceId: z.string().nullable().default(null),
  targetServiceId: z.string(),
  migrationType: MigrationType,
  changedFiles: z.array(z.string()).default([]),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  ownerOnly: z.boolean().default(false),
  verificationSummary: z.string().default(''),
  evidenceIds: z.array(z.string()).default([]),
  rollbackPlan: z.string().default(''),
  stagedApp: z.object({ appName: z.string(), subdomain: z.string(), rootDirectory: z.string(), port: z.number() }).nullable().default(null),
  approvalRequired: z.boolean().default(true),
  status: z.enum(['proposed', 'waiting_approval', 'approved', 'rejected', 'executed', 'rolled_back']).default('proposed'),
  createdAt: IsoDate,
});
export type WorkspaceMigration = z.infer<typeof WorkspaceMigrationSchema>;

export const WorkspaceRollbackSchema = z.object({
  rollbackId: z.string(),
  workspaceId: z.string(),
  migrationId: z.string().nullable().default(null),
  instructions: z.string(),
  branchName: z.string().default(''),
  sourceCommit: z.string().default(''),
  executed: z.boolean().default(false),
  createdAt: IsoDate,
});
export type WorkspaceRollback = z.infer<typeof WorkspaceRollbackSchema>;

/* ============================ resource limits =========================== */

export interface WorkspaceLimits {
  maxIterations: number;
  maxMinutes: number;
  maxFilesChanged: number;
  /** Cap on stored log/artifact bytes per artifact. */
  maxLogBytes: number;
  /** 0 = no cost tracking source configured (reported, never guessed). */
  maxCostUsd: number;
  requireApprovalBeforeMigration: boolean;
  allowAutofix: boolean;
  allowNewService: boolean;
  allowExistingServiceEvolution: boolean;
}

export function loadWorkspaceLimits(env: Record<string, string | undefined>): WorkspaceLimits {
  const num = (v: string | undefined, d: number): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  const flag = (v: string | undefined, d: boolean): boolean => (v === undefined ? d : v !== 'false');
  return {
    maxIterations: num(env.WORKSPACE_MAX_ITERATIONS, 10),
    maxMinutes: num(env.WORKSPACE_MAX_MINUTES, 45),
    maxFilesChanged: num(env.WORKSPACE_MAX_FILES_CHANGED, 80),
    maxLogBytes: num(env.WORKSPACE_MAX_LOG_BYTES, 8000),
    maxCostUsd: num(env.WORKSPACE_MAX_COST_USD, 0),
    requireApprovalBeforeMigration: flag(env.WORKSPACE_REQUIRE_APPROVAL_BEFORE_MIGRATION, true),
    allowAutofix: flag(env.WORKSPACE_ALLOW_AUTOFIX, true),
    allowNewService: flag(env.WORKSPACE_ALLOW_NEW_SERVICE, true),
    allowExistingServiceEvolution: flag(env.WORKSPACE_ALLOW_EXISTING_SERVICE_EVOLUTION, true),
  };
}

/* ========================== verification matrix ========================= */

export type ServiceKind = 'fastify_service' | 'next_web';

export interface VerificationCheck { checkId: string; label: string; appliesTo: ServiceKind | 'both'; required: boolean }

export const VERIFICATION_MATRIX: VerificationCheck[] = [
  { checkId: 'file_structure', label: 'File structure (package.json, tsconfig, src/index.ts, README, .env.example)', appliesTo: 'both', required: true },
  { checkId: 'dependency_resolution', label: 'Workspace dependency resolution (@factory/shared, @factory/service-kit)', appliesTo: 'both', required: true },
  { checkId: 'typecheck', label: 'TypeScript typecheck (tsc --noEmit)', appliesTo: 'both', required: true },
  { checkId: 'build', label: 'Build (tsc → dist / next build)', appliesTo: 'both', required: true },
  { checkId: 'unit_tests', label: 'Unit tests when present', appliesTo: 'both', required: false },
  { checkId: 'smoke', label: 'Repo smoke scripts when relevant', appliesTo: 'both', required: false },
  { checkId: 'boot', label: 'Service boots on a temporary port', appliesTo: 'fastify_service', required: true },
  { checkId: 'health', label: 'GET /health answers ok', appliesTo: 'fastify_service', required: true },
  { checkId: 'manifest', label: 'GET /.factory/manifest is valid + capabilities present', appliesTo: 'fastify_service', required: true },
  { checkId: 'status', label: 'GET /.factory/status answers', appliesTo: 'fastify_service', required: true },
  { checkId: 'task_endpoint', label: 'POST /.factory/task guarded by internal token', appliesTo: 'fastify_service', required: true },
  { checkId: 'capabilities', label: 'GET /.factory/capabilities answers with the capability list', appliesTo: 'fastify_service', required: true },
  { checkId: 'logs_endpoint', label: 'GET /.factory/logs guarded + answers with internal token', appliesTo: 'fastify_service', required: true },
  { checkId: 'next_build', label: 'Next.js production build compiles all routes', appliesTo: 'next_web', required: true },
  { checkId: 'env_example', label: '.env.example covers required env', appliesTo: 'both', required: true },
  { checkId: 'docs', label: 'README with purpose/endpoints/env/deployment', appliesTo: 'both', required: true },
  { checkId: 'dokploy_spec', label: 'Dokploy deployment spec present', appliesTo: 'both', required: true },
];

export function matrixFor(kind: ServiceKind): VerificationCheck[] {
  return VERIFICATION_MATRIX.filter((c) => c.appliesTo === 'both' || c.appliesTo === kind);
}

/** Green = every required applicable check passed (skipped optionals allowed). */
export function matrixGreen(kind: ServiceKind, results: Array<{ checkId: string; status: string }>): { green: boolean; missing: string[] } {
  const required = matrixFor(kind).filter((c) => c.required).map((c) => c.checkId);
  const passed = new Set(results.filter((r) => r.status === 'passed').map((r) => r.checkId));
  const missing = required.filter((id) => !passed.has(id));
  return { green: missing.length === 0, missing };
}

/* ====================== new-service allocation + files ================== */

export interface NewServiceSpec {
  serviceId: string;
  packageName: string;
  port: number;
  subdomain: string;
  description: string;
  capabilities: string[];
}

const RESERVED_MAX_PORT = Math.max(...Object.values(SERVICE_PORTS));

/** Deterministic allocation: next port after all known services, kebab-case id. */
export function allocateNewService(name: string, description: string, capabilities: string[], extraReservedPorts: number[] = []): NewServiceSpec {
  const serviceId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!serviceId || (SERVICE_PORTS as Record<string, number>)[serviceId] !== undefined) {
    throw new Error(`invalid or already-registered service name: ${name}`);
  }
  const reserved = new Set([...Object.values(SERVICE_PORTS), ...extraReservedPorts]);
  let port = RESERVED_MAX_PORT + 1;
  while (reserved.has(port)) port++;
  return {
    serviceId,
    packageName: `@factory/${serviceId}`,
    port,
    subdomain: `${serviceId.replace(/-service$|-agent$/, '') || serviceId}.${ROOT_DOMAIN}`,
    description,
    capabilities: capabilities.length ? capabilities : ['factory_task_handling'],
  };
}

/** Generate the COMPLETE file set for a real factory service. Keys are paths
 *  relative to the service folder. Follows the exact patterns used by the
 *  existing 19 services (service-kit + shared, standard endpoints). */
export function generateServiceFiles(spec: NewServiceSpec, goal: string): Record<string, string> {
  const { serviceId, packageName, port, subdomain, description, capabilities } = spec;
  const caps = JSON.stringify(capabilities);
  return {
    'package.json': `{
  "name": "${packageName}",
  "version": "0.1.0",
  "description": ${JSON.stringify(description)},
  "type": "module",
  "private": true,
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "dev": "node --env-file=.env --watch --import tsx src/index.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "@factory/shared": "workspace:*", "@factory/service-kit": "workspace:*" },
  "devDependencies": { "typescript": "^5.9.2", "tsx": "^4.19.2", "@types/node": "^22.15.0" }
}
`,
    'tsconfig.json': `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "rootDir": "src", "outDir": "dist" }, "include": ["src/**/*.ts"] }
`,
    'src/factory/manifest.ts': `import { SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

export const manifest: ServiceManifest = {
  serviceId: '${serviceId}',
  serviceName: '${serviceId.split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ')}',
  serviceType: 'agent',
  version: SERVICE_VERSION,
  domain: 'https://${subdomain}',
  healthEndpoint: '/health',
  capabilities: ${caps},
  dependencies: ['gateway-api', 'event-bus-service', 'service-registry'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN'],
};
`,
    'src/index.ts': `/**
 * ${serviceId} — generated by the Autonomous Staging Workspace runtime.
 * Goal: ${goal.replace(/\n/g, ' ').slice(0, 160)}
 * Standard factory service: /health, /.factory/manifest, /.factory/status,
 * token-guarded /.factory/task. Extend handleTask with real capability logic.
 */
import {
  loadEnv, BaseEnvSchema, MongoEnvSchema, connectMongo, EVENT_TYPES,
  startAgentRun, finishAgentRun,
} from '@factory/shared';
import { createFactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema));

const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? '${serviceId}-task';
  const input = (req.input ?? {}) as { action?: string };
  const action = input.action ?? 'status';
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId });

  // Default capability: report status. Real capabilities are added per goal.
  await finishAgentRun(runId, { status: 'succeeded', summary: \`\${action} handled\` });
  await ctx.publisher.publish({ type: EVENT_TYPES.TASK_UPDATED, taskId, payload: { serviceId: manifest.serviceId, action, message: \`\${manifest.serviceId} handled \${action}\` } });
  return { taskId, accepted: true, agentRunId: runId, result: { ok: true, action } };
};

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  const service = await createFactoryService({
    manifest, port: env.SERVICE_PORT, internalToken: env.FACTORY_INTERNAL_TOKEN, adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL, eventBusUrl: env.EVENT_BUS_URL, logLevel: env.LOG_LEVEL, taskHandler: handleTask,
  });
  await service.listen();
}

main().catch((err) => { console.error('fatal startup error', err); process.exit(1); });
`,
    '.env.example': `NODE_ENV=development
FACTORY_ENV=local
FACTORY_INTERNAL_TOKEN=change-me-internal
FACTORY_ADMIN_TOKEN=

SERVICE_ID=${serviceId}
SERVICE_NAME=${serviceId}
SERVICE_DOMAIN=https://${subdomain}
SERVICE_PORT=${port}

SERVICE_REGISTRY_URL=http://localhost:4108
EVENT_BUS_URL=http://localhost:4111

MONGODB_URI=
MONGODB_DB_NAME=autonomous_os_kernel

LOG_LEVEL=info
`,
    'README.md': `# ${serviceId}

${description}

Generated by the Autonomous Staging Workspace runtime (goal: ${goal.replace(/\n/g, ' ').slice(0, 160)}).

## Purpose
${description}

## Endpoints
Standard factory surface: \`GET /health\`, \`GET /.factory/manifest\`,
\`GET /.factory/status\`, token-guarded \`POST /.factory/task\`.

## Capabilities
${capabilities.map((c) => `- ${c}`).join('\n')}

## Environment variables
See \`.env.example\` (port ${port}, subdomain ${subdomain}).

## Deployment
Independent Dokploy app — see \`deployment.dokploy.md\` in this folder.

## Current status
Generated in an isolated workspace; pending verification + migration approval.
`,
    'deployment.dokploy.md': `# Dokploy — ${serviceId}

| Setting | Value |
|---|---|
| App name | ${serviceId} |
| Domain | https://${subdomain} |
| Staged domain | https://${serviceId}-staging.${ROOT_DOMAIN} |
| Repository | github.com/<owner>/autonomous-os-kernel |
| Root directory | services/${serviceId} |
| Build command | pnpm install --frozen-lockfile && pnpm --filter ${packageName}... build |
| Start command | node services/${serviceId}/dist/index.js |
| Health check | /health |
| Internal port | ${port} |

Required env: NODE_ENV, FACTORY_ENV, FACTORY_INTERNAL_TOKEN, MONGODB_URI,
MONGODB_DB_NAME, SERVICE_ID, SERVICE_NAME, SERVICE_PORT, SERVICE_REGISTRY_URL,
EVENT_BUS_URL, LOG_LEVEL.
`,
  };
}

/* =========================== migration builder ========================== */

export interface MigrationInput {
  workspaceId: string;
  mode: WorkspaceMode;
  sourceServiceId: string | null;
  targetServiceId: string;
  changedFiles: string[];
  verificationSummary: string;
  branchName: string;
  sourceCommit: string;
  evidenceIds?: string[];
  proposedPort?: number;
}

export function buildMigrationPlan(input: MigrationInput, genId: (p: string) => string, nowIso: () => string): { migration: WorkspaceMigration; rollback: WorkspaceRollback } {
  const replacing = input.mode !== 'create_new_service' && Boolean(input.sourceServiceId);
  const core = isProtectedCore(input.sourceServiceId ?? '') || isProtectedCore(input.targetServiceId);
  const migrationType: MigrationType = !replacing ? 'create_new_service' : core ? 'open_pr_only' : 'deploy_staged_service';
  const riskLevel = core ? 'critical' : replacing ? 'high' : 'medium';
  const stagedApp = {
    appName: `${input.targetServiceId}-staging`,
    subdomain: `${input.targetServiceId}-staging.${ROOT_DOMAIN}`,
    rootDirectory: replacing ? `services/${input.targetServiceId}` : `services/${input.targetServiceId}`,
    port: input.proposedPort ?? 0,
  };
  const rollbackInstructions = [
    `Previous version is preserved: branch “${input.branchName || 'main'}” at commit ${input.sourceCommit || '(record at promote time)'} — the live folder is never overwritten before a snapshot branch exists.`,
    replacing ? `To roll back after promotion: redeploy the previous commit in Dokploy (same app), or git revert the migration merge on the default branch.` : `To roll back a new service: remove the staged Dokploy app; no live service was touched.`,
    core ? 'PROTECTED CORE: rollback and promotion are owner-only, via the visible Overview flow.' : '',
  ].filter(Boolean).join(' ');
  const migration = WorkspaceMigrationSchema.parse({
    migrationId: genId('mig'),
    workspaceId: input.workspaceId,
    sourceServiceId: input.sourceServiceId,
    targetServiceId: input.targetServiceId,
    migrationType,
    changedFiles: input.changedFiles.slice(0, 200),
    riskLevel,
    ownerOnly: core,
    verificationSummary: input.verificationSummary,
    evidenceIds: input.evidenceIds ?? [],
    rollbackPlan: rollbackInstructions,
    stagedApp,
    approvalRequired: true,
    status: 'waiting_approval',
    createdAt: nowIso(),
  });
  const rollback = WorkspaceRollbackSchema.parse({
    rollbackId: genId('rbk'),
    workspaceId: input.workspaceId,
    migrationId: migration.migrationId,
    instructions: rollbackInstructions,
    branchName: input.branchName,
    sourceCommit: input.sourceCommit,
    executed: false,
    createdAt: nowIso(),
  });
  return { migration, rollback };
}
