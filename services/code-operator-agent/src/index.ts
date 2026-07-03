/**
 * Code Operator Agent (Phase X) — the operator runtime's hands on the codebase.
 *
 * Executes workspace-scoped code tools: inspect, search, dry-run patch preview,
 * isolated-branch edits, typecheck/build/smoke runs, git branch/commit, PR.
 *
 * Safety model:
 *  - Everything is confined to CODE_WORKSPACE_ROOT (path traversal rejected).
 *  - Without CODE_WORKSPACE_ROOT the agent reports not_configured — never fakes.
 *  - Edits are refused on the default branch: an isolated work branch is required.
 *  - Protected-core paths (gateway-api, dashboard-web, shared contracts) are
 *    flagged on preview and REFUSED on edit unless `approvedForProtectedCore`
 *    is set by the gateway after an explicit owner approval.
 *  - The gateway gates every mutating tool behind approval before calling here.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import {
  loadEnv, BaseEnvSchema, MongoEnvSchema, connectMongo, EVENT_TYPES,
  startAgentRun, finishAgentRun, PROTECTED_CORE_SERVICES,
} from '@factory/shared';
import { createFactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';
import { handleWorkspaceAction } from './workspace-runtime.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema));
const exec = promisify(execFile);

const WORKSPACE = process.env.CODE_WORKSPACE_ROOT ?? '';
const DEFAULT_BRANCH = process.env.GITHUB_DEFAULT_BRANCH ?? 'main';
const MAX_OUTPUT = 4000;

/** Paths whose modification is critical: core services + shared contracts. */
const PROTECTED_PATH_PREFIXES = [...[...PROTECTED_CORE_SERVICES].map((s) => `services/${s}/`), 'shared/src/'];
export const isProtectedCodePath = (rel: string): boolean => PROTECTED_PATH_PREFIXES.some((p) => rel.startsWith(p));

interface ToolResult { ok: boolean; summary: string; data?: unknown }
const notConfigured: ToolResult = { ok: false, summary: 'not_configured: CODE_WORKSPACE_ROOT is not set on code-operator-agent' };

/** Resolve a repo-relative path inside the workspace or throw (no traversal). */
function safePath(rel: string): string {
  const abs = resolve(WORKSPACE, rel);
  const r = relative(WORKSPACE, abs);
  if (r.startsWith('..') || abs === WORKSPACE && rel !== '' && rel !== '.') {
    if (r.startsWith('..')) throw new Error('path escapes the workspace');
  }
  return abs;
}

async function git(args: string[], timeoutMs = 15000): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await exec('git', args, { cwd: WORKSPACE, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, out: `${stdout}\n${stderr}`.trim().slice(0, MAX_OUTPUT) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, out: (err.stderr || err.stdout || err.message || 'git failed').slice(0, MAX_OUTPUT) };
  }
}

async function currentBranch(): Promise<string> {
  const r = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.ok ? r.out.trim() : '';
}

/* ------------------------------- tools --------------------------------- */

async function inspectRepo(path: string): Promise<ToolResult> {
  const abs = safePath(path || '.');
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const listing = entries
    .filter((e) => !['node_modules', '.next', 'dist', '.git'].includes(e.name))
    .slice(0, 80)
    .map((e) => `${e.isDirectory() ? 'dir ' : 'file'} ${join(path || '.', e.name)}`);
  return { ok: true, summary: `${listing.length} entries under ${path || 'repo root'}.`, data: listing };
}

async function searchCode(pattern: string, path: string): Promise<ToolResult> {
  if (!pattern) return { ok: false, summary: 'pattern is required' };
  try {
    const { stdout } = await exec('grep', ['-rn', '--include=*.ts', '--include=*.tsx', '--include=*.md', '-l', pattern, path || '.'], { cwd: WORKSPACE, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    const files = stdout.trim().split('\n').filter(Boolean).slice(0, 20);
    return { ok: true, summary: `${files.length} files match.`, data: files };
  } catch {
    return { ok: true, summary: 'No matches.', data: [] };
  }
}

async function proposeChange(file: string, find: string, replace: string): Promise<ToolResult> {
  const abs = safePath(file);
  const content = await fs.readFile(abs, 'utf8');
  const count = content.split(find).length - 1;
  if (!find || count === 0) return { ok: false, summary: `The target text was not found in ${file} — nothing to change.` };
  const idx = content.indexOf(find);
  const before = content.slice(Math.max(0, idx - 120), idx + find.length + 120);
  const after = before.replace(find, replace);
  const protectedCore = isProtectedCodePath(file);
  return {
    ok: true,
    summary: `Dry-run preview for ${file}: ${count} occurrence(s)${protectedCore ? ' — PROTECTED CORE PATH, owner approval required to apply' : ''}. Nothing written.`,
    data: { file, occurrences: count, protectedCore, preview: { before: before.slice(0, 600), after: after.slice(0, 600) } },
  };
}

async function editCode(file: string, find: string, replace: string, branch: string, approvedForProtectedCore: boolean): Promise<ToolResult> {
  const abs = safePath(file);
  if (!branch || branch === DEFAULT_BRANCH) return { ok: false, summary: `Edits require an isolated work branch (not ${DEFAULT_BRANCH}).` };
  if (isProtectedCodePath(file) && !approvedForProtectedCore) {
    return { ok: false, summary: `protected core: ${file} — owner approval required before applying this change.` };
  }
  const cur = await currentBranch();
  if (cur !== branch) {
    const co = await git(['checkout', '-B', branch]);
    if (!co.ok) return { ok: false, summary: `Could not switch to branch ${branch}: ${co.out}` };
  }
  const content = await fs.readFile(abs, 'utf8');
  if (!find || !content.includes(find)) return { ok: false, summary: `Target text not found in ${file}; refusing a blind write.` };
  await fs.writeFile(abs, content.replace(find, replace), 'utf8');
  const diff = await git(['diff', '--stat']);
  return { ok: true, summary: `Applied change to ${file} on branch ${branch}. ${diff.out.split('\n').pop() ?? ''}`.trim(), data: { file, branch, diffstat: diff.out } };
}

async function runPackageCommand(pkg: string, kind: 'typecheck' | 'build'): Promise<ToolResult> {
  const abs = safePath(pkg);
  const args = kind === 'typecheck' ? ['tsc', '-p', 'tsconfig.json', '--noEmit'] : ['run', 'build'];
  const bin = kind === 'typecheck' ? 'npx' : 'npm';
  try {
    await exec(bin, args, { cwd: abs, timeout: kind === 'typecheck' ? 120000 : 300000, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, summary: `${kind} passed for ${pkg}.` };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    const out = `${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim();
    const firstErrors = out.split('\n').filter((l) => /error/i.test(l)).slice(0, 5).join(' | ');
    return { ok: false, summary: `${kind} FAILED for ${pkg}: ${firstErrors || out.slice(0, 300)}` };
  }
}

async function runSmoke(script: string): Promise<ToolResult> {
  if (!/^scripts\/[\w.-]+\.mjs$/.test(script)) return { ok: false, summary: 'Only scripts/*.mjs smoke scripts are allowed.' };
  try {
    const { stdout } = await exec('node', [script], { cwd: WORKSPACE, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    const last = stdout.trim().split('\n').pop() ?? '';
    return { ok: true, summary: `Smoke ${script}: ${last}` };
  } catch (e) {
    const err = e as { stdout?: string; message?: string };
    return { ok: false, summary: `Smoke ${script} failed: ${(err.stdout ?? err.message ?? '').slice(0, 300)}` };
  }
}

async function createPr(title: string, branch: string): Promise<ToolResult> {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  if (!token || !owner || !repo) return { ok: false, summary: 'not_configured: GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO required for PR creation.' };
  const push = await git(['push', '-u', 'origin', branch], 60000);
  if (!push.ok) return { ok: false, summary: `Push failed: ${push.out.slice(0, 200)}` };
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/vnd.github+json' },
      body: JSON.stringify({ title, head: branch, base: DEFAULT_BRANCH, body: 'Opened by the operator runtime (code-operator-agent) after approval.' }),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await r.json()) as { html_url?: string; message?: string };
    return r.ok ? { ok: true, summary: `PR opened: ${body.html_url}`, data: { url: body.html_url } } : { ok: false, summary: `GitHub rejected the PR: ${body.message ?? r.status}` };
  } catch (e) {
    return { ok: false, summary: `PR creation failed: ${e instanceof Error ? e.message : 'error'}` };
  }
}

/* ------------------------------ task loop ------------------------------- */

const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? 'code-op';
  const input = (req.input ?? {}) as Record<string, unknown> & { action?: string };
  const action = input.action ?? 'status';
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId });
  const configured = Boolean(WORKSPACE);

  let result: ToolResult;
  try {
    if (action === 'status') {
      result = { ok: true, summary: configured ? `workspace: ${WORKSPACE}` : 'workspace not configured', data: { workspaceConfigured: configured, defaultBranch: DEFAULT_BRANCH, protectedPathPrefixes: PROTECTED_PATH_PREFIXES, githubConfigured: Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_OWNER && process.env.GITHUB_REPO) } };
    } else if (!configured) {
      result = notConfigured;
    } else if (action.startsWith('ws_')) {
      // Phase Y — Autonomous Staging Workspace runtime (isolated deep work).
      result = await handleWorkspaceAction(action, input);
    } else {
      switch (action) {
        case 'inspect_repo': result = await inspectRepo(String(input.path ?? '.')); break;
        case 'search_code': result = await searchCode(String(input.pattern ?? ''), String(input.path ?? '.')); break;
        case 'propose_code_change': result = await proposeChange(String(input.file ?? ''), String(input.find ?? ''), String(input.replace ?? '')); break;
        case 'edit_code': result = await editCode(String(input.file ?? ''), String(input.find ?? ''), String(input.replace ?? ''), String(input.branch ?? ''), Boolean(input.approvedForProtectedCore)); break;
        case 'run_typecheck': result = await runPackageCommand(String(input.package ?? '.'), 'typecheck'); break;
        case 'build_package': result = await runPackageCommand(String(input.package ?? '.'), 'build'); break;
        case 'run_smoke_tests': result = await runSmoke(String(input.script ?? '')); break;
        case 'create_git_branch': { const r = await git(['checkout', '-B', String(input.branch ?? '')]); result = { ok: r.ok, summary: r.ok ? `On branch ${String(input.branch)}.` : r.out }; break; }
        case 'commit_changes': { const a = await git(['add', '-A']); const c = a.ok ? await git(['commit', '-m', String(input.message ?? 'operator change')]) : a; result = { ok: c.ok, summary: c.ok ? `Committed: ${c.out.split('\n')[0]}` : `Commit failed: ${c.out.slice(0, 200)}` }; break; }
        case 'create_pr': result = await createPr(String(input.title ?? 'Operator change'), String(input.branch ?? await currentBranch())); break;
        default: result = { ok: false, summary: `unknown action: ${action}` };
      }
    }
  } catch (e) {
    result = { ok: false, summary: e instanceof Error ? e.message : 'tool crashed' };
  }

  await finishAgentRun(runId, { status: result.ok ? 'succeeded' : 'failed', summary: `${action}: ${result.summary.slice(0, 200)}` });
  if (action !== 'status') {
    await ctx.publisher.publish({ type: result.ok ? EVENT_TYPES.OPERATOR_TOOL_EXECUTED : EVENT_TYPES.OPERATOR_TOOL_FAILED, taskId: null, payload: { toolId: action, serviceId: manifest.serviceId, message: result.summary.slice(0, 160), level: result.ok ? 'success' : 'error' } });
  }
  return { taskId, accepted: true, agentRunId: runId, result };
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
