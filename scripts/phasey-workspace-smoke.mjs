#!/usr/bin/env node
/**
 * Phase Y smoke — Autonomous Staging Workspace & Service Evolution Runtime.
 * Drives the real shared workspace module AND performs a REAL generation test:
 * a complete service is generated from the template into .workspaces/ and
 * typechecked with tsc. Run from repo root after building shared:
 *   node scripts/phasey-workspace-smoke.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  WorkspaceSchema, WorkspaceMigrationSchema, VERIFICATION_MATRIX, matrixFor, matrixGreen,
  allocateNewService, generateServiceFiles, buildMigrationPlan, loadWorkspaceLimits,
  buildOperatorToolRegistry, planForGoal,
} from '../shared/dist/index.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};
const genId = (p) => `${p}_test${Math.random().toString(36).slice(2, 8)}`;
const nowIso = () => new Date().toISOString();

console.log('Phase Y — workspace evolution smoke\n');

console.log('— Verification matrix —');
check('Matrix has 15+ checks', VERIFICATION_MATRIX.length >= 15, `got ${VERIFICATION_MATRIX.length}`);
const fast = matrixFor('fastify_service');
const web = matrixFor('next_web');
check('Fastify matrix includes boot/health/manifest/status/token-guard', ['boot', 'health', 'manifest', 'status', 'task_endpoint'].every((id) => fast.some((c) => c.checkId === id)));
check('Web matrix includes next_build, excludes fastify boot probes', web.some((c) => c.checkId === 'next_build') && !web.some((c) => c.checkId === 'boot'));
const greenRes = fast.filter((c) => c.required).map((c) => ({ checkId: c.checkId, status: 'passed' }));
check('matrixGreen: all required passed ⇒ green', matrixGreen('fastify_service', greenRes).green);
check('matrixGreen: missing health ⇒ not green, names it', (() => { const r = matrixGreen('fastify_service', greenRes.filter((x) => x.checkId !== 'health')); return !r.green && r.missing.includes('health'); })());

console.log('— Limits —');
const defaults = loadWorkspaceLimits({});
check('Defaults: 10 iterations / 45 min / 80 files / approval required', defaults.maxIterations === 10 && defaults.maxMinutes === 45 && defaults.maxFilesChanged === 80 && defaults.requireApprovalBeforeMigration === true);
const custom = loadWorkspaceLimits({ WORKSPACE_MAX_ITERATIONS: '3', WORKSPACE_ALLOW_NEW_SERVICE: 'false' });
check('Env overrides apply', custom.maxIterations === 3 && custom.allowNewService === false);

console.log('— New-service allocation —');
const spec = allocateNewService('status-inspector-service', 'Checks all registered services and reports anomalies.', ['service_status_inspection']);
check('Allocates id/package/port/subdomain', spec.serviceId === 'status-inspector-service' && spec.packageName === '@factory/status-inspector-service' && spec.port > 4122 && spec.subdomain.includes('.'));
check('Rejects an already-registered service id', (() => { try { allocateNewService('gateway-api', '', []); return false; } catch { return true; } })());
check('Avoids extra reserved ports', allocateNewService('another-svc', '', [], [spec.port]).port !== spec.port);

console.log('— Real generation test (files → tsc) —');
const files = generateServiceFiles(spec, 'Create a status-inspector service that checks all registered services.');
check('Generates the full required file set', ['package.json', 'tsconfig.json', 'src/index.ts', 'src/factory/manifest.ts', '.env.example', 'README.md', 'deployment.dokploy.md'].every((f) => files[f]));
check('Service has standard factory wiring (service-kit + manifest + task handler)', files['src/index.ts'].includes('createFactoryService') && files['src/index.ts'].includes('TaskHandler') && files['src/factory/manifest.ts'].includes(`serviceId: '${spec.serviceId}'`));
check('Env example carries allocated port', files['.env.example'].includes(`SERVICE_PORT=${spec.port}`));
check('Dokploy spec includes staged domain', files['deployment.dokploy.md'].includes('-staging.'));

const genDir = join(process.cwd(), '.workspaces', 'smoke-gen', spec.serviceId);
try {
  rmSync(join(process.cwd(), '.workspaces', 'smoke-gen'), { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(genDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    // Same depth fix the runtime applies for .workspaces/<ws>/<svc>/ locations.
    const adjusted = rel === 'tsconfig.json' ? content.replace('"../../tsconfig.base.json"', '"../../../tsconfig.base.json"') : content;
    writeFileSync(abs, adjusted, 'utf8');
  }
  const donor = join(process.cwd(), 'services', 'voice-operator-agent', 'node_modules');
  if (existsSync(donor)) symlinkSync(donor, join(genDir, 'node_modules'), 'dir');
  execFileSync('npx', ['tsc', '-p', 'tsconfig.json', '--noEmit'], { cwd: genDir, timeout: 120000, stdio: 'pipe' });
  check('GENERATED SERVICE TYPECHECKS (real tsc, no fake)', true);
} catch (e) {
  check('GENERATED SERVICE TYPECHECKS (real tsc, no fake)', false, (e.stdout?.toString() ?? e.message ?? '').slice(0, 300));
} finally {
  rmSync(join(process.cwd(), '.workspaces', 'smoke-gen'), { recursive: true, force: true });
}

console.log('— Migration & rollback —');
const migNew = buildMigrationPlan({ workspaceId: 'ws_1', mode: 'create_new_service', sourceServiceId: null, targetServiceId: spec.serviceId, changedFiles: Object.keys(files), verificationSummary: '✓ all', branchName: 'ws/ws_1', sourceCommit: 'abc123', proposedPort: spec.port }, genId, nowIso);
check('New service ⇒ create_new_service migration, staged app named', migNew.migration.migrationType === 'create_new_service' && migNew.migration.stagedApp.appName === `${spec.serviceId}-staging`);
check('Migration always requires approval', migNew.migration.approvalRequired === true && migNew.migration.status === 'waiting_approval');
const migCore = buildMigrationPlan({ workspaceId: 'ws_2', mode: 'evolve_existing_service', sourceServiceId: 'gateway-api', targetServiceId: 'gateway-api', changedFiles: ['src/index.ts'], verificationSummary: '✓', branchName: 'ws/ws_2', sourceCommit: 'abc', proposedPort: 0 }, genId, nowIso);
check('Protected core ⇒ critical + ownerOnly + open_pr_only', migCore.migration.riskLevel === 'critical' && migCore.migration.ownerOnly && migCore.migration.migrationType === 'open_pr_only');
const migSvc = buildMigrationPlan({ workspaceId: 'ws_3', mode: 'evolve_existing_service', sourceServiceId: 'qa-agent', targetServiceId: 'qa-agent', changedFiles: ['a.ts'], verificationSummary: '✓', branchName: 'ws/ws_3', sourceCommit: 'abc', proposedPort: 0 }, genId, nowIso);
check('Non-core evolution ⇒ deploy_staged_service, high risk', migSvc.migration.migrationType === 'deploy_staged_service' && migSvc.migration.riskLevel === 'high');
check('Rollback preserves old version (no deletion language, snapshot named)', /preserved/i.test(migCore.rollback.instructions) && !/delete the old/i.test(migCore.rollback.instructions));
check('Schemas parse', WorkspaceSchema.safeParse({ workspaceId: 'w', goal: 'g', mode: 'repair_service', workspacePath: '.workspaces/w', createdAt: nowIso(), updatedAt: nowIso() }).success && WorkspaceMigrationSchema.safeParse(migNew.migration).success);

console.log('— Operator tools & gating —');
const tools = buildOperatorToolRegistry({ dokployConfigured: true, codeWorkspaceConfigured: true, githubConfigured: true, voiceConfigured: true });
const wsToolIds = ['create_workspace', 'copy_service_to_workspace', 'create_new_service_workspace', 'inspect_workspace', 'edit_workspace', 'run_workspace_typecheck', 'run_workspace_build', 'run_workspace_tests', 'start_workspace_service', 'verify_workspace_service', 'create_migration_plan', 'approve_migration', 'deploy_staged_workspace', 'promote_workspace', 'rollback_workspace'];
check('All 15 workspace lifecycle tools registered', wsToolIds.every((id) => tools.some((t) => t.toolId === id)));
const inWorkspace = ['create_workspace', 'inspect_workspace', 'edit_workspace', 'run_workspace_typecheck', 'run_workspace_build', 'run_workspace_tests', 'start_workspace_service', 'verify_workspace_service', 'create_migration_plan'];
check('Inside-workspace tools: NO approval per step (isolation is the boundary)', inWorkspace.every((id) => { const t = tools.find((x) => x.toolId === id); return t.riskLevel === 'low' && !t.requiresApproval; }));
check('Live-touching tools gated: approve/deploy/promote/rollback', ['approve_migration', 'deploy_staged_workspace', 'promote_workspace', 'rollback_workspace'].every((id) => tools.find((x) => x.toolId === id).requiresApproval));
const bare = buildOperatorToolRegistry({ dokployConfigured: false, codeWorkspaceConfigured: false, githubConfigured: false, voiceConfigured: false });
check('Workspace tools unavailable (with reason) without CODE_WORKSPACE_ROOT', bare.filter((t) => ['create_workspace', 'edit_workspace', 'promote_workspace'].includes(t.toolId)).every((t) => !t.available && t.unavailableReason));

console.log('— Planner scenarios —');
const a = planForGoal('Improve the Operator Console UI into a more powerful mission-grade interface.', { safeMode: false, role: 'owner' });
check('A (evolve console): workspace copy of dashboard-web → auto-fix loop → migration plan', a.kind === 'runtime_goal' && a.steps[0].toolId === 'create_workspace' && a.steps[0].args.sourceServiceId === 'dashboard-web' && a.steps.some((s) => s.toolId === 'run_workspace_tests') && a.steps[a.steps.length - 1].toolId === 'create_migration_plan');
const b = planForGoal('Create a new status-inspector service that checks all registered services and reports anomalies.', { safeMode: false, role: 'owner' });
check('B (new service): generate → auto-fix loop → migration plan', b.kind === 'runtime_goal' && b.steps[0].toolId === 'create_new_service_workspace' && b.steps[1].toolId === 'run_workspace_tests' && b.steps[2].toolId === 'create_migration_plan');
check('B: allocates a concrete service name', String(b.steps[0].args.newServiceName ?? '').includes('status-inspector'));
const c = planForGoal('Repair browser-testing-agent in a workspace and prove it passes health checks.', { safeMode: false, role: 'operator' });
check('C (repair): workspace copy of browser-testing-agent + check-fix loop', c.kind === 'runtime_goal' && c.steps[0].args.sourceServiceId === 'browser-testing-agent' && String(c.steps[0].args.mode) === 'repair_service' && c.steps.some((s) => s.toolId === 'run_workspace_tests'));
const d = planForGoal('Upgrade gateway-api routing.', { safeMode: false, role: 'owner' });
check('D (protected core): workspace edits allowed, narration names critical/owner migration', d.kind === 'runtime_goal' && d.steps[0].args.sourceServiceId === 'gateway-api' && /PROTECTED CORE/i.test(d.narration) && /owner/i.test(d.narration));
check('D: no direct execute/promote step in the plan', !d.steps.some((s) => ['promote_workspace', 'execute_operation', 'deploy_staged_workspace'].includes(s.toolId)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
