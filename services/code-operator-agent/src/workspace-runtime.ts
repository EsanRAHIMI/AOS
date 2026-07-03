/**
 * Phase Y — Autonomous Staging Workspace runtime (execution layer).
 *
 * Confined to `<CODE_WORKSPACE_ROOT>/.workspaces/<workspaceId>/…`. Copies or
 * generates services there, applies deep multi-file edits WITHOUT per-step
 * approval (isolation is the safety boundary), runs install/typecheck/build,
 * boots the service on a temporary port, probes the standard factory
 * endpoints, records the verification matrix, and produces migration plans.
 * The live tree is only ever touched by `ws_promote` — on a dedicated git
 * branch, after upstream approval, with the source commit recorded for
 * rollback. Old versions are never deleted.
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, relative, join, dirname } from 'node:path';
import {
  collection, COLLECTIONS, genId, nowIso,
  WorkspaceSchema, matrixGreen, allocateNewService, generateServiceFiles,
  buildMigrationPlan, loadWorkspaceLimits,
  type Workspace, type WorkspaceRun, type WorkspaceChange, type WorkspaceTest,
  type WorkspaceArtifact, type WorkspaceService, type WorkspaceMigration,
  type WorkspaceRollback, type WorkspaceMode, type ServiceKind, type NewServiceSpec,
} from '@factory/shared';

const exec = promisify(execFile);
const ROOT = process.env.CODE_WORKSPACE_ROOT ?? '';
const LIMITS = loadWorkspaceLimits(process.env);

export interface WsResult { ok: boolean; summary: string; data?: unknown }

/** Live progress stream — wired to the event bus by the service entrypoint so
 *  every phase transition and check result is visible in real time. */
export type WsProgress = (event: string, message: string, level?: string) => void;
let progress: WsProgress = () => undefined;
export function setWorkspaceProgressPublisher(p: WsProgress): void { progress = p; }

const wsCol = () => collection<Workspace>(COLLECTIONS.WORKSPACES);
const runCol = () => collection<WorkspaceRun>(COLLECTIONS.WORKSPACE_RUNS);
const svcCol = () => collection<WorkspaceService>(COLLECTIONS.WORKSPACE_SERVICES);
const changeCol = () => collection<WorkspaceChange>(COLLECTIONS.WORKSPACE_CHANGES);
const testCol = () => collection<WorkspaceTest>(COLLECTIONS.WORKSPACE_TESTS);
const artifactCol = () => collection<WorkspaceArtifact>(COLLECTIONS.WORKSPACE_ARTIFACTS);
const migCol = () => collection<WorkspaceMigration>(COLLECTIONS.WORKSPACE_MIGRATIONS);
const rbkCol = () => collection<WorkspaceRollback>(COLLECTIONS.WORKSPACE_ROLLBACKS);

function insideRoot(p: string): string {
  const abs = resolve(ROOT, p);
  if (relative(ROOT, abs).startsWith('..')) throw new Error('path escapes the workspace root');
  return abs;
}

async function recordRun(ws: Workspace, action: string, ok: boolean, summary: string, startedAt: number): Promise<void> {
  await runCol().insertOne({ runId: genId('wrun'), workspaceId: ws.workspaceId, iteration: ws.iterations, action, ok, summary: summary.slice(0, 500), durationMs: Date.now() - startedAt, createdAt: nowIso() });
}

async function saveWs(ws: Workspace): Promise<Workspace> {
  ws.updatedAt = nowIso();
  await wsCol().updateOne({ workspaceId: ws.workspaceId }, { $set: ws }, { upsert: true });
  return ws;
}

async function setPhase(ws: Workspace, status: Workspace['status'], message: string): Promise<void> {
  ws.status = status;
  await saveWs(ws);
  progress('workspace.iteration', `[${ws.workspaceId}] ${status}: ${message}`.slice(0, 200));
}

async function getWs(workspaceId: string): Promise<Workspace> {
  const ws = await wsCol().findOne({ workspaceId }, { projection: { _id: 0 } });
  if (!ws) throw new Error(`workspace ${workspaceId} not found`);
  return ws;
}

async function recordTest(workspaceId: string, checkId: string, label: string, status: WorkspaceTest['status'], detail: string, durationMs: number): Promise<void> {
  await testCol().insertOne({ testId: genId('wtest'), workspaceId, checkId, label, status, detail: detail.slice(0, 600), durationMs, createdAt: nowIso() });
}

async function recordArtifact(workspaceId: string, kind: WorkspaceArtifact['kind'], label: string, content: string): Promise<void> {
  await artifactCol().insertOne({ artifactId: genId('wart'), workspaceId, kind, label, content: content.slice(0, 8000), createdAt: nowIso() });
}

const svcDirOf = (ws: Workspace): string => insideRoot(join('.workspaces', ws.workspaceId, ws.serviceDirName));

async function gitAt(args: string[], timeoutMs = 20000): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await exec('git', args, { cwd: ROOT, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, out: `${stdout}\n${stderr}`.trim().slice(0, 4000) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, out: (err.stderr || err.stdout || err.message || 'git failed').slice(0, 4000) };
  }
}

/* ------------------------------ lifecycle ------------------------------ */

export async function wsCreate(input: { goal: string; mode: string; sourceServiceId?: string; newServiceName?: string; description?: string; capabilities?: string[] }): Promise<WsResult> {
  if (!ROOT) return { ok: false, summary: 'not_configured: CODE_WORKSPACE_ROOT is not set' };
  const mode = input.mode as WorkspaceMode;
  if (mode === 'create_new_service' && !LIMITS.allowNewService) return { ok: false, summary: 'New-service workspaces are disabled (WORKSPACE_ALLOW_NEW_SERVICE=false).' };
  if (mode !== 'create_new_service' && !LIMITS.allowExistingServiceEvolution) return { ok: false, summary: 'Existing-service evolution is disabled (WORKSPACE_ALLOW_EXISTING_SERVICE_EVOLUTION=false).' };

  const workspaceId = genId('ws');
  const head = await gitAt(['rev-parse', 'HEAD']);
  let serviceDirName = '';
  let sourcePath = '';
  let newService: NewServiceSpec | null = null;

  if (mode === 'create_new_service') {
    const extra = (await svcCol().find({}, { projection: { _id: 0 } }).toArray()).map((s) => s.proposedPort);
    newService = allocateNewService(input.newServiceName ?? 'new-service', input.description ?? input.goal, input.capabilities ?? [], extra);
    serviceDirName = newService.serviceId;
  } else {
    const src = String(input.sourceServiceId ?? '');
    sourcePath = `services/${src}`;
    try { await fs.access(insideRoot(sourcePath)); } catch { return { ok: false, summary: `source service not found: ${sourcePath}` }; }
    serviceDirName = `${src}-evolved`;
  }

  const ws = WorkspaceSchema.parse({
    workspaceId, goal: input.goal, mode, sourceServiceId: input.sourceServiceId ?? null, sourcePath,
    workspacePath: join('.workspaces', workspaceId), serviceDirName, status: 'created',
    branchName: `ws/${workspaceId}`, sourceCommit: head.ok ? head.out.split('\n')[0] : '', tempPort: null,
    iterations: 0, filesChanged: 0, lastError: '', createdAt: nowIso(), updatedAt: nowIso(),
  });
  const wsDir = insideRoot(ws.workspacePath);
  await fs.mkdir(join(wsDir, serviceDirName), { recursive: true });

  if (mode === 'create_new_service' && newService) {
    ws.status = 'generating';
    progress('workspace.created', `[${workspaceId}] generating ${newService.serviceId} (port ${newService.port}, ${newService.subdomain})`);
    // Generate the complete real service (standard factory endpoints, manifest,
    // README, env example, Dokploy spec) into the workspace.
    const files = generateServiceFiles(newService, input.goal);
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(wsDir, serviceDirName, rel);
      await fs.mkdir(dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf8');
      await changeCol().insertOne({ changeId: genId('wchg'), workspaceId, file: join(serviceDirName, rel), changeType: 'create', summary: 'generated', bytes: content.length, createdAt: nowIso() });
    }
    ws.filesChanged = Object.keys(files).length;
    await svcCol().insertOne({ workspaceServiceId: genId('wsvc'), workspaceId, serviceId: newService.serviceId, packageName: newService.packageName, proposedPort: newService.port, proposedSubdomain: newService.subdomain, capabilities: newService.capabilities, requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN'], createdAt: nowIso() });
    // Donor node_modules so tsc/node resolve @factory deps without an install.
    await linkNodeModules(join(wsDir, serviceDirName), insideRoot('services/voice-operator-agent/node_modules'));
    await fixTsconfigDepth(join(wsDir, serviceDirName), 'into_workspace');
  } else {
    ws.status = 'copying';
    const srcAbs = insideRoot(sourcePath);
    const dstAbs = join(wsDir, serviceDirName);
    await exec('rsync', ['-a', '--exclude', 'node_modules', '--exclude', 'dist', '--exclude', '.next', `${srcAbs}/`, `${dstAbs}/`], { timeout: 60000 });
    await linkNodeModules(dstAbs, join(srcAbs, 'node_modules'));
    await fixTsconfigDepth(dstAbs, 'into_workspace');
  }
  ws.status = 'planning';
  await saveWs(ws);
  await recordRun(ws, 'ws_create', true, `workspace ${workspaceId} (${mode}) at ${ws.workspacePath}/${serviceDirName}`, Date.now());
  return { ok: true, summary: `Workspace ${workspaceId} ready (${mode}) at ${ws.workspacePath}/${serviceDirName}${newService ? ` — proposed ${newService.serviceId} on port ${newService.port}, ${newService.subdomain}` : ''}. Source untouched.`, data: { workspaceId, serviceDirName, newService } };
}

/** Workspace services live one level deeper than services/<x>, so the
 *  tsconfig `extends` path gains one `../`. Reversed again on promote. */
async function fixTsconfigDepth(serviceDir: string, direction: 'into_workspace' | 'into_services'): Promise<void> {
  const p = join(serviceDir, 'tsconfig.json');
  try {
    const cur = await fs.readFile(p, 'utf8');
    const next = direction === 'into_workspace'
      ? cur.replace('"../../tsconfig.base.json"', '"../../../tsconfig.base.json"')
      : cur.replace('"../../../tsconfig.base.json"', '"../../tsconfig.base.json"');
    if (next !== cur) await fs.writeFile(p, next, 'utf8');
  } catch { /* no tsconfig — structure check will report it */ }
}

async function linkNodeModules(serviceDir: string, donor: string): Promise<void> {
  try {
    await fs.access(donor);
    await fs.symlink(donor, join(serviceDir, 'node_modules'), 'dir');
  } catch { /* no donor node_modules — dependency_resolution check will report it */ }
}

export async function wsInspect(input: { workspaceId: string; path?: string }): Promise<WsResult> {
  const ws = await getWs(String(input.workspaceId));
  const base = svcDirOf(ws);
  const target = resolve(base, String(input.path ?? '.'));
  if (relative(base, target).startsWith('..')) return { ok: false, summary: 'path escapes the workspace' };
  const entries = await fs.readdir(target, { withFileTypes: true });
  const listing = entries.filter((e) => !['node_modules', '.next', 'dist'].includes(e.name)).slice(0, 100).map((e) => `${e.isDirectory() ? 'dir ' : 'file'} ${e.name}`);
  return { ok: true, summary: `${listing.length} entries in ${ws.serviceDirName}/${input.path ?? ''}`, data: { workspace: ws, listing } };
}

/** Deep multi-file edit: apply a batch of create/edit operations in one call.
 *  No approval inside the isolated workspace — limits are the guardrail. */
export async function wsEdit(input: { workspaceId: string; edits: Array<{ file: string; content?: string; find?: string; replace?: string; summary?: string }> }): Promise<WsResult> {
  const ws = await getWs(String(input.workspaceId));
  const base = svcDirOf(ws);
  const edits = input.edits ?? [];
  if (!edits.length) return { ok: false, summary: 'no edits given' };
  if (ws.filesChanged + edits.length > LIMITS.maxFilesChanged) {
    return { ok: false, summary: `File-change limit reached (${ws.filesChanged}+${edits.length} > ${LIMITS.maxFilesChanged}). Summarize progress and ask to continue with a raised limit.` };
  }
  const applied: string[] = [];
  for (const e of edits) {
    const abs = resolve(base, e.file);
    if (relative(base, abs).startsWith('..')) return { ok: false, summary: `path escapes the workspace: ${e.file}` };
    if (typeof e.content === 'string') {
      await fs.mkdir(dirname(abs), { recursive: true });
      await fs.writeFile(abs, e.content, 'utf8');
      await changeCol().insertOne({ changeId: genId('wchg'), workspaceId: ws.workspaceId, file: e.file, changeType: 'create', summary: e.summary ?? 'write', bytes: e.content.length, createdAt: nowIso() });
    } else if (typeof e.find === 'string' && typeof e.replace === 'string') {
      const cur = await fs.readFile(abs, 'utf8');
      if (!cur.includes(e.find)) return { ok: false, summary: `target text not found in ${e.file}; refusing a blind write (applied ${applied.length}/${edits.length} first)` };
      await fs.writeFile(abs, cur.replace(e.find, e.replace), 'utf8');
      await changeCol().insertOne({ changeId: genId('wchg'), workspaceId: ws.workspaceId, file: e.file, changeType: 'edit', summary: e.summary ?? 'edit', bytes: e.replace.length, createdAt: nowIso() });
    } else return { ok: false, summary: `edit for ${e.file} needs either content or find+replace` };
    applied.push(e.file);
  }
  ws.filesChanged += applied.length;
  ws.status = 'editing';
  await saveWs(ws);
  await recordRun(ws, 'ws_edit', true, `${applied.length} files: ${applied.slice(0, 8).join(', ')}`, Date.now());
  return { ok: true, summary: `Applied ${applied.length} edits (total ${ws.filesChanged}/${LIMITS.maxFilesChanged}).`, data: { applied } };
}

/* ------------------------------- checks -------------------------------- */

async function runCheck(ws: Workspace, checkId: string, label: string, fn: () => Promise<{ ok: boolean; detail: string }>): Promise<{ ok: boolean; detail: string }> {
  const t0 = Date.now();
  try {
    const r = await fn();
    await recordTest(ws.workspaceId, checkId, label, r.ok ? 'passed' : 'failed', r.detail, Date.now() - t0);
    return r;
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'check crashed';
    await recordTest(ws.workspaceId, checkId, label, 'failed', detail, Date.now() - t0);
    return { ok: false, detail };
  }
}

export async function wsTypecheck(input: { workspaceId: string }): Promise<WsResult> {
  const ws = await getWs(String(input.workspaceId));
  ws.status = 'building'; await saveWs(ws);
  const r = await runCheck(ws, 'typecheck', 'tsc --noEmit', async () => {
    try {
      await exec('npx', ['tsc', '-p', 'tsconfig.json', '--noEmit'], { cwd: svcDirOf(ws), timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
      return { ok: true, detail: 'typecheck passed' };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      const out = `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
      const errors = out.split('\n').filter((l) => /error TS/.test(l));
      await recordArtifact(ws.workspaceId, 'build_output', 'typecheck errors', errors.slice(0, 40).join('\n'));
      return { ok: false, detail: `${errors.length} type errors; first: ${errors[0] ?? out.slice(0, 200)}` };
    }
  });
  await recordRun(ws, 'ws_typecheck', r.ok, r.detail, Date.now());
  return { ok: r.ok, summary: r.detail };
}

export async function wsBuild(input: { workspaceId: string }): Promise<WsResult> {
  const ws = await getWs(String(input.workspaceId));
  const kind: ServiceKind = ws.sourceServiceId === 'dashboard-web' ? 'next_web' : 'fastify_service';
  ws.status = 'building'; await saveWs(ws);
  const r = await runCheck(ws, kind === 'next_web' ? 'next_build' : 'build', kind === 'next_web' ? 'next build' : 'tsc build', async () => {
    try {
      if (kind === 'next_web') await exec('npx', ['next', 'build'], { cwd: svcDirOf(ws), timeout: 420000, maxBuffer: 16 * 1024 * 1024 });
      else await exec('npx', ['tsc', '-p', 'tsconfig.json'], { cwd: svcDirOf(ws), timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
      return { ok: true, detail: `${kind === 'next_web' ? 'next build' : 'build'} passed` };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      const out = `${err.stdout ?? ''}\n${err.stderr ?? ''}`.slice(0, 2000);
      await recordArtifact(ws.workspaceId, 'build_output', 'build failure', out);
      const firstError = out.split('\n').find((l) => /error/i.test(l)) ?? out.slice(0, 200);
      return { ok: false, detail: `build failed: ${firstError}` };
    }
  });
  await recordRun(ws, 'ws_build', r.ok, r.detail, Date.now());
  return { ok: r.ok, summary: r.detail };
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? res(port) : rej(new Error('no free port'))));
    });
    srv.on('error', rej);
  });
}

/** Boot the workspace service on a temporary port and probe the standard
 *  factory endpoints. Logs captured; process always stopped afterwards. */
export async function wsRun(input: { workspaceId: string }): Promise<WsResult> {
  const ws = await getWs(String(input.workspaceId));
  const dir = svcDirOf(ws);
  const port = await freePort();
  ws.tempPort = port;
  await setPhase(ws, 'booting', `starting on temp port ${port}`);

  const logs: string[] = [];
  const child = spawn('node', ['dist/index.js'], {
    cwd: dir,
    env: {
      ...process.env,
      SERVICE_PORT: String(port),
      SERVICE_ID: ws.serviceDirName,
      SERVICE_NAME: ws.serviceDirName,
      // Isolation: temp runs never register with the live registry/event bus.
      SERVICE_REGISTRY_URL: '',
      EVENT_BUS_URL: '',
      NODE_ENV: 'development',
    },
  });
  child.stdout?.on('data', (d: Buffer) => { logs.push(d.toString()); if (logs.length > 400) logs.shift(); });
  child.stderr?.on('data', (d: Buffer) => { logs.push(d.toString()); if (logs.length > 400) logs.shift(); });

  const internalToken = process.env.FACTORY_INTERNAL_TOKEN ?? '';
  const probe = async (path: string, opts?: { token?: boolean; method?: string; body?: string }): Promise<{ ok: boolean; body: string; status: number }> => {
    try {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: opts?.method ?? 'GET',
        headers: { 'content-type': 'application/json', ...(opts?.token ? { 'x-factory-internal-token': internalToken } : {}) },
        body: opts?.body,
        signal: AbortSignal.timeout(4000),
      });
      return { ok: r.ok, body: (await r.text()).slice(0, 500), status: r.status };
    } catch { return { ok: false, body: '', status: 0 }; }
  };

  try {
    // Wait for readiness (max 20s).
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await new Promise((r) => setTimeout(r, 500));
      up = (await probe('/health')).ok;
      if (child.exitCode !== null) break;
    }
    await runCheck(ws, 'boot', 'service boots on temp port', async () => ({ ok: up, detail: up ? `listening on ${port}` : `did not become healthy on ${port} (exit=${child.exitCode})` }));
    if (!up) {
      await recordArtifact(ws.workspaceId, 'log', 'boot logs', logs.join('').slice(-LIMITS.maxLogBytes));
      return { ok: false, summary: `Service did not become healthy on temp port ${port}. Boot logs stored — inspect and fix.`, data: { port, logTail: logs.join('').slice(-1200) } };
    }
    await setPhase(ws, 'probing', `probing all factory endpoints on :${port}`);
    // The full standard surface. Metadata endpoints are public by design;
    // /.factory/logs must answer WITH the internal token and /.factory/task
    // must REJECT without it.
    const health = await probe('/health');
    const manifest = await probe('/.factory/manifest');
    const status = await probe('/.factory/status');
    const capabilities = await probe('/.factory/capabilities');
    const logsAuthed = await probe('/.factory/logs', { token: true });
    const logsUnauthed = await probe('/.factory/logs');
    const taskUnauthed = await probe('/.factory/task', { method: 'POST', body: '{}' });
    const capsOk = capabilities.ok && /capabilities/.test(capabilities.body);
    const manifestOk = manifest.ok && /serviceId/.test(manifest.body);
    const taskGuard = taskUnauthed.status === 401 || taskUnauthed.status === 403;
    const logsOk = logsAuthed.ok && (logsUnauthed.status === 401 || logsUnauthed.status === 403);
    const checks: Array<[string, string, boolean, string]> = [
      ['health', 'GET /health', health.ok, `status ${health.status}`],
      ['manifest', 'GET /.factory/manifest', manifestOk, manifest.ok ? (manifestOk ? 'valid manifest' : 'manifest malformed') : `status ${manifest.status}`],
      ['status', 'GET /.factory/status', status.ok, `status ${status.status}`],
      ['capabilities', 'GET /.factory/capabilities', capsOk, capabilities.ok ? (capsOk ? 'capability list present' : 'no capabilities in body') : `status ${capabilities.status}`],
      ['task_endpoint', 'POST /.factory/task rejects without internal token', taskGuard, taskGuard ? 'unauthenticated task rejected' : `NOT guarded (status ${taskUnauthed.status})`],
      ['logs_endpoint', 'GET /.factory/logs guarded + answers with token', logsOk, logsOk ? 'guarded and readable with token' : `authed ${logsAuthed.status} / unauthed ${logsUnauthed.status}`],
    ];
    for (const [id, label, ok, detail] of checks) {
      await runCheck(ws, id, label, async () => ({ ok, detail }));
      progress('workspace.check.completed', `[${ws.workspaceId}] ${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`, ok ? 'success' : 'error');
    }
    await recordArtifact(ws.workspaceId, 'probe_result', 'factory probes', JSON.stringify({ port, health: health.status, manifest: manifest.status, status: status.status, capabilities: capabilities.status, logsAuthed: logsAuthed.status, logsUnauthed: logsUnauthed.status, taskUnauthed: taskUnauthed.status }));
    await recordArtifact(ws.workspaceId, 'log', 'run logs', logs.join('').slice(-LIMITS.maxLogBytes));
    const allOk = checks.every(([, , ok]) => ok);
    await recordRun(ws, 'ws_run', allOk, checks.map(([id, , ok]) => `${ok ? '✓' : '✕'}${id}`).join(' '), Date.now());
    return { ok: allOk, summary: `Booted on :${port} — ${checks.map(([id, , ok]) => `${id} ${ok ? 'ok' : 'FAIL'}`).join(', ')}.`, data: { port, failing: checks.filter(([, , ok]) => !ok).map(([id]) => id) } };
  } finally {
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 3000).unref();
    ws.tempPort = null; await saveWs(ws);
  }
}

/* --------------------------- verification ------------------------------ */

export async function wsVerify(input: { workspaceId: string; skipRun?: boolean }): Promise<WsResult> {
  const ws = await getWs(String(input.workspaceId));
  const kind: ServiceKind = ws.sourceServiceId === 'dashboard-web' ? 'next_web' : 'fastify_service';
  const dir = svcDirOf(ws);
  ws.status = 'verifying'; await saveWs(ws);

  await runCheck(ws, 'file_structure', 'required files present', async () => {
    const required = kind === 'next_web' ? ['package.json', 'tsconfig.json'] : ['package.json', 'tsconfig.json', 'src/index.ts'];
    const missing: string[] = [];
    for (const f of required) { try { await fs.access(join(dir, f)); } catch { missing.push(f); } }
    return { ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : 'structure ok' };
  });
  await runCheck(ws, 'dependency_resolution', '@factory deps resolvable', async () => {
    try { await fs.access(join(dir, 'node_modules')); return { ok: true, detail: 'node_modules linked' }; }
    catch { return { ok: false, detail: 'node_modules missing — donor link failed; run install in the checkout' }; }
  });
  const tc = await wsTypecheck({ workspaceId: ws.workspaceId });
  const build = tc.ok ? await wsBuild({ workspaceId: ws.workspaceId }) : { ok: false, summary: 'skipped (typecheck failed)' };
  if (kind === 'fastify_service' && build.ok && !input.skipRun) await wsRun({ workspaceId: ws.workspaceId });
  await runCheck(ws, 'env_example', '.env.example present', async () => {
    try { await fs.access(join(dir, '.env.example')); return { ok: true, detail: 'present' }; } catch { return { ok: kind === 'next_web', detail: kind === 'next_web' ? 'not required for web copy' : 'missing .env.example' }; }
  });
  await runCheck(ws, 'docs', 'README present', async () => {
    try { await fs.access(join(dir, 'README.md')); return { ok: true, detail: 'present' }; } catch { return { ok: false, detail: 'missing README.md' }; }
  });
  await runCheck(ws, 'dokploy_spec', 'Dokploy spec present', async () => {
    for (const f of ['deployment.dokploy.md']) { try { await fs.access(join(dir, f)); return { ok: true, detail: f }; } catch { /* next */ } }
    try { await fs.access(insideRoot(join('deployment/dokploy', `${ws.sourceServiceId ?? ws.serviceDirName}.md`))); return { ok: true, detail: 'repo-level dokploy doc' }; } catch { return { ok: false, detail: 'no Dokploy spec found' }; }
  });

  const results = await testCol().find({ workspaceId: ws.workspaceId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
  // Latest result per checkId wins.
  const latest = new Map<string, WorkspaceTest>();
  for (const r of results) if (!latest.has(r.checkId)) latest.set(r.checkId, r);
  const summary = [...latest.values()].map((r) => `${r.status === 'passed' ? '✓' : '✕'} ${r.checkId}`).join('  ');
  const { green, missing } = matrixGreen(kind, [...latest.values()]);
  ws.status = green ? 'ready_for_migration' : 'failed';
  ws.lastError = green ? '' : `required checks failing: ${missing.join(', ')}`;
  await saveWs(ws);
  progress('workspace.verified', `[${ws.workspaceId}] verification ${green ? 'GREEN' : `INCOMPLETE (${missing.join(', ')})`}`, green ? 'success' : 'warn');
  await recordRun(ws, 'ws_verify', green, summary, Date.now());
  return { ok: green, summary: green ? `Verification GREEN (${kind}): ${summary}` : `Verification INCOMPLETE — failing: ${missing.join(', ')}. ${summary}`, data: { kind, matrix: [...latest.values()], missing } };
}

/** The AUTO-FIX loop: verify → diagnose failing checks → apply deterministic
 *  repairs (regenerate missing files, rebuild, reboot, retry flaky boots) →
 *  re-verify. Runs WITHOUT approval inside the isolated workspace until GREEN
 *  or a configured limit pauses it with a precise cause. Every iteration and
 *  every fix is recorded and streamed — it never fabricates green. */
export async function wsIterate(input: { workspaceId: string }): Promise<WsResult> {
  const ws0 = await getWs(String(input.workspaceId));
  if (!LIMITS.allowAutofix) return wsVerify({ workspaceId: ws0.workspaceId });
  const startedAt = Date.now();
  let last: WsResult = { ok: false, summary: 'not run' };
  let lastFailing: string[] = [];
  for (let i = 0; i < LIMITS.maxIterations; i++) {
    const ws = await getWs(ws0.workspaceId);
    if (Date.now() - startedAt > LIMITS.maxMinutes * 60000) {
      progress('workspace.failed', `[${ws.workspaceId}] time limit ${LIMITS.maxMinutes}m reached at iteration ${i}`, 'warn');
      return { ok: false, summary: `Time limit reached (${LIMITS.maxMinutes}m) after ${i} iterations. Progress: ${last.summary}. Ask to continue with a raised limit.` };
    }
    ws.iterations = i + 1; await saveWs(ws);
    progress('workspace.iteration', `[${ws.workspaceId}] iteration ${i + 1}/${LIMITS.maxIterations} — verifying`);
    last = await wsVerify({ workspaceId: ws.workspaceId });
    if (last.ok) {
      progress('workspace.verified', `[${ws.workspaceId}] GREEN after ${i + 1} iteration(s)`, 'success');
      return { ok: true, summary: `Green after ${i + 1} iteration(s). ${last.summary}` };
    }
    const failing = (last.data as { missing?: string[] } | undefined)?.missing ?? [];
    const wsFix = await getWs(ws0.workspaceId);
    await setPhase(wsFix, 'fixing', `iteration ${i + 1}: repairing ${failing.join(', ')}`);
    const dir = svcDirOf(wsFix);
    let fixedSomething = false;

    // Fix class 1 — missing docs/env/dokploy spec: regenerate minimal files.
    const docFixes: Array<{ file: string; content: string }> = [];
    if (failing.includes('docs')) docFixes.push({ file: 'README.md', content: `# ${wsFix.serviceDirName}\n\nEvolved in workspace ${wsFix.workspaceId} — goal: ${wsFix.goal}\n` });
    if (failing.includes('env_example')) docFixes.push({ file: '.env.example', content: 'SERVICE_PORT=\nMONGODB_URI=\nMONGODB_DB_NAME=autonomous_os_kernel\nFACTORY_INTERNAL_TOKEN=\nLOG_LEVEL=info\n' });
    if (failing.includes('dokploy_spec')) docFixes.push({ file: 'deployment.dokploy.md', content: `# Dokploy — ${wsFix.serviceDirName}\nStaged app: ${wsFix.serviceDirName}-staging\nHealth check: /health\n` });
    for (const f of docFixes) {
      await fs.writeFile(join(dir, f.file), f.content, 'utf8');
      await changeCol().insertOne({ changeId: genId('wchg'), workspaceId: wsFix.workspaceId, file: f.file, changeType: 'create', summary: `autofix iteration ${i + 1}`, bytes: f.content.length, createdAt: nowIso() });
      fixedSomething = true;
    }

    // Fix class 2 — stale build behind fresh sources: rebuild before reprobing.
    if (failing.some((f) => ['boot', 'health', 'manifest', 'status', 'capabilities', 'task_endpoint', 'logs_endpoint'].includes(f))) {
      progress('workspace.iteration', `[${wsFix.workspaceId}] rebuilding + rebooting to retry probes`);
      const rebuilt = await wsBuild({ workspaceId: wsFix.workspaceId });
      if (rebuilt.ok) fixedSomething = true; // reboot happens in the next verify pass
    }

    // Same failures twice with nothing fixable → stop with a precise cause.
    if (!fixedSomething && failing.join(',') === lastFailing.join(',')) {
      progress('workspace.failed', `[${wsFix.workspaceId}] not deterministically fixable: ${failing.join(', ')}`, 'error');
      return { ok: false, summary: `Stopped after iteration ${i + 1}: ${last.summary} — these checks need targeted edits (ws_edit): ${failing.join(', ')}. Then re-run the loop.`, data: last.data };
    }
    lastFailing = failing;
  }
  progress('workspace.failed', `[${ws0.workspaceId}] iteration limit ${LIMITS.maxIterations} reached`, 'warn');
  return { ok: false, summary: `Iteration limit reached (${LIMITS.maxIterations}). Last: ${last.summary}. Ask to continue with a raised limit.` };
}

/* ------------------------- migration & rollback ------------------------ */

export async function wsMigrationPlan(input: { workspaceId: string }): Promise<WsResult> {
  const ws = await getWs(String(input.workspaceId));
  if (ws.status !== 'ready_for_migration' && ws.status !== 'ready_for_review') return { ok: false, summary: `Workspace is ${ws.status} — verification must be GREEN before a migration plan (run the fix loop until green).` };
  progress('workspace.migration.proposed', `[${ws.workspaceId}] building migration plan`, 'warn');
  const changes = await changeCol().find({ workspaceId: ws.workspaceId }, { projection: { _id: 0 } }).toArray();
  const tests = await testCol().find({ workspaceId: ws.workspaceId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(30).toArray();
  const newSvc = await svcCol().findOne({ workspaceId: ws.workspaceId }, { projection: { _id: 0 } });
  const targetServiceId = newSvc?.serviceId ?? ws.sourceServiceId ?? ws.serviceDirName;
  const verificationSummary = tests.slice(0, 16).map((t) => `${t.status === 'passed' ? '✓' : '✕'} ${t.checkId}`).join(' ');
  const { migration, rollback } = buildMigrationPlan({
    workspaceId: ws.workspaceId, mode: ws.mode, sourceServiceId: ws.sourceServiceId, targetServiceId,
    changedFiles: [...new Set(changes.map((c) => c.file))], verificationSummary,
    branchName: ws.branchName, sourceCommit: ws.sourceCommit, proposedPort: newSvc?.proposedPort,
  }, genId, nowIso);
  await migCol().insertOne(migration);
  await rbkCol().insertOne(rollback);
  ws.status = 'waiting_approval'; await saveWs(ws);
  return { ok: true, summary: `Migration plan ${migration.migrationId}: ${migration.migrationType}, risk ${migration.riskLevel}${migration.ownerOnly ? ' (OWNER approval required)' : ''}, ${migration.changedFiles.length} files. Staged app: ${migration.stagedApp?.appName}. Approval required before anything touches the live tree.`, data: { migration, rollback } };
}

/** Promote AFTER upstream approval: snapshot branch + copy into services/<target>
 *  on that branch + commit. Never the default branch, never a deletion. */
export async function wsPromote(input: { workspaceId: string; migrationId: string; approvedForProtectedCore?: boolean }): Promise<WsResult> {
  const ws = await getWs(String(input.workspaceId));
  const mig = await migCol().findOne({ migrationId: String(input.migrationId) }, { projection: { _id: 0 } });
  if (!mig) return { ok: false, summary: 'migration plan not found' };
  if (mig.status !== 'approved') return { ok: false, summary: `Migration is ${mig.status} — it must be approved upstream first. No promotion without approval.` };
  if (mig.ownerOnly && !input.approvedForProtectedCore) return { ok: false, summary: 'PROTECTED CORE migration — requires the explicit owner-approval flag from the gateway.' };
  const branch = `${ws.branchName}-promote`;
  const head = await gitAt(['rev-parse', 'HEAD']);
  const co = await gitAt(['checkout', '-B', branch]);
  if (!co.ok) return { ok: false, summary: `Could not create promote branch: ${co.out}` };
  const src = svcDirOf(ws);
  const dst = insideRoot(join('services', mig.targetServiceId));
  await fs.mkdir(dst, { recursive: true });
  await exec('rsync', ['-a', '--exclude', 'node_modules', '--exclude', 'dist', '--exclude', '.next', `${src}/`, `${dst}/`], { timeout: 60000 });
  await fixTsconfigDepth(dst, 'into_services');
  const add = await gitAt(['add', '-A']);
  const commit = add.ok ? await gitAt(['commit', '-m', `ws(${ws.workspaceId}): promote ${mig.targetServiceId} — ${ws.goal.slice(0, 80)}`]) : add;
  if (!commit.ok) return { ok: false, summary: `Commit failed on ${branch}: ${commit.out.slice(0, 200)}` };
  await migCol().updateOne({ migrationId: mig.migrationId }, { $set: { status: 'executed' } });
  ws.status = 'migrating'; await saveWs(ws);
  await recordRun(ws, 'ws_promote', true, `promoted to branch ${branch} (previous HEAD ${head.out.split('\n')[0]?.slice(0, 10)})`, Date.now());
  return { ok: true, summary: `Promoted ${mig.targetServiceId} onto branch “${branch}” (default branch untouched, previous version preserved at ${ws.sourceCommit.slice(0, 10) || 'HEAD'}). Next: review/merge the branch, then deploy the staged Dokploy app “${mig.stagedApp?.appName}” and verify /health before final promotion.`, data: { branch, previousHead: head.out.split('\n')[0] } };
}

export async function wsRollback(input: { workspaceId: string; migrationId?: string }): Promise<WsResult> {
  const ws = await getWs(String(input.workspaceId));
  const rbk = await rbkCol().findOne({ workspaceId: ws.workspaceId }, { projection: { _id: 0 } });
  const back = await gitAt(['checkout', process.env.GITHUB_DEFAULT_BRANCH ?? 'main']);
  await rbkCol().updateOne({ rollbackId: rbk?.rollbackId ?? '' }, { $set: { executed: true } });
  if (input.migrationId) await migCol().updateOne({ migrationId: String(input.migrationId) }, { $set: { status: 'rolled_back' } });
  ws.status = 'cancelled'; await saveWs(ws);
  return { ok: back.ok, summary: back.ok ? `Rolled back: default branch restored; promote branch preserved for inspection. ${rbk?.instructions ?? ''}`.slice(0, 400) : `Rollback checkout failed: ${back.out.slice(0, 200)}` };
}

export async function wsStatus(input: { workspaceId?: string }): Promise<WsResult> {
  if (input.workspaceId) {
    const ws = await getWs(String(input.workspaceId));
    const tests = await testCol().find({ workspaceId: ws.workspaceId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(40).toArray();
    // Latest result per check → the live verification matrix for the console.
    const latest = new Map<string, WorkspaceTest>();
    for (const t of tests) if (!latest.has(t.checkId)) latest.set(t.checkId, t);
    const lastLog = await artifactCol().find({ workspaceId: ws.workspaceId, kind: 'log' }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(1).toArray();
    return {
      ok: true,
      summary: `${ws.workspaceId}: ${ws.status}, iteration ${ws.iterations}/${LIMITS.maxIterations}, ${ws.filesChanged} files changed${ws.lastError ? `, last error: ${ws.lastError}` : ''}.`,
      data: { workspace: ws, matrix: [...latest.values()].map((t) => ({ checkId: t.checkId, status: t.status, detail: t.detail })), logsTail: (lastLog[0]?.content ?? '').slice(-900), limits: LIMITS },
    };
  }
  const list = await wsCol().find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(20).toArray();
  return { ok: true, summary: `${list.length} workspaces.`, data: { workspaces: list, limits: LIMITS } };
}

/* ------------------------------ dispatcher ----------------------------- */

export async function handleWorkspaceAction(action: string, input: Record<string, unknown>): Promise<WsResult> {
  if (!ROOT) return { ok: false, summary: 'not_configured: CODE_WORKSPACE_ROOT is not set on code-operator-agent' };
  switch (action) {
    case 'ws_create': return wsCreate(input as never);
    case 'ws_inspect': return wsInspect(input as never);
    case 'ws_edit': return wsEdit(input as never);
    case 'ws_typecheck': return wsTypecheck(input as never);
    case 'ws_build': return wsBuild(input as never);
    case 'ws_run': return wsRun(input as never);
    case 'ws_verify': return wsVerify(input as never);
    case 'ws_iterate': return wsIterate(input as never);
    case 'ws_migration_plan': return wsMigrationPlan(input as never);
    case 'ws_approve_migration': {
      const mig = await migCol().findOne({ migrationId: String(input.migrationId) }, { projection: { _id: 0 } });
      if (!mig) return { ok: false, summary: 'migration plan not found' };
      await migCol().updateOne({ migrationId: mig.migrationId }, { $set: { status: String(input.decision) === 'approve' ? 'approved' : 'rejected' } });
      return { ok: true, summary: `Migration ${mig.migrationId} ${String(input.decision) === 'approve' ? 'approved' : 'rejected'}.` };
    }
    case 'ws_promote': return wsPromote(input as never);
    case 'ws_rollback': return wsRollback(input as never);
    case 'ws_status': return wsStatus(input as never);
    default: return { ok: false, summary: `unknown workspace action: ${action}` };
  }
}
