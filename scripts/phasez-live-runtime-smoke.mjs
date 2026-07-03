#!/usr/bin/env node
/**
 * Phase Z smoke — live runtime & GREEN-verification proof.
 *
 * The flagship test BOOTS A REAL FACTORY SERVICE in-process (the exact same
 * surface every generated/evolved service uses via service-kit) and runs the
 * exact probe suite the workspace runtime uses:
 *   /health, /.factory/manifest, /.factory/status, /.factory/capabilities
 *   (public), /.factory/logs (guarded, answers with token),
 *   POST /.factory/task (rejects without token, accepts with token).
 * Plus: matrix/limits/planner/failure-semantics logic. No fake success.
 * Run from repo root after build:deps: node scripts/phasez-live-runtime-smoke.mjs
 */
import { createServer } from 'node:net';
import { createFactoryService } from '../packages/service-kit/dist/index.js';
import {
  matrixFor, matrixGreen, loadWorkspaceLimits, WorkspaceStatus,
  planForGoal, stopSessionOnFailure, OBSERVATIONAL_CATEGORIES,
} from '../shared/dist/index.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase Z — live runtime smoke\n');

/* ------------------- REAL service boot + full probe suite ------------------- */
console.log('— Real factory service boot + all six probes —');
const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  s.on('error', rej);
});
const port = await freePort();
const TOKEN = 'smoke-internal-token';
const service = await createFactoryService({
  manifest: {
    serviceId: 'status-inspector-service', serviceName: 'Status Inspector Service', serviceType: 'agent',
    version: '0.1.0', domain: 'https://status-inspector.simorx.com', healthEndpoint: '/health',
    capabilities: ['service_status_inspection'], dependencies: [], requiredEnv: [],
  },
  port, internalToken: TOKEN, logLevel: 'silent',
  taskHandler: async (req) => ({ taskId: req.taskId ?? 't1', accepted: true, result: { ok: true } }),
});
await service.listen();

const probe = async (path, opts = {}) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: opts.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...(opts.token ? { 'x-factory-internal-token': TOKEN } : {}) },
      body: opts.body,
      signal: AbortSignal.timeout(4000),
    });
    return { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 400) };
  } catch (e) { return { ok: false, status: 0, body: String(e) }; }
};

const health = await probe('/health');
const manifest = await probe('/.factory/manifest');
const status = await probe('/.factory/status');
const capabilities = await probe('/.factory/capabilities');
const logsNoToken = await probe('/.factory/logs');
const logsToken = await probe('/.factory/logs', { token: true });
const taskNoToken = await probe('/.factory/task', { method: 'POST', body: '{"goal":"x"}' });
const taskToken = await probe('/.factory/task', { method: 'POST', token: true, body: '{"goal":"probe task"}' });
await service.close();

check('GET /health → 200', health.ok, `status ${health.status}`);
check('GET /.factory/manifest → 200 public with serviceId', manifest.ok && manifest.body.includes('status-inspector-service'), `status ${manifest.status}`);
check('GET /.factory/status → 200 public', status.ok, `status ${status.status}`);
check('GET /.factory/capabilities → 200 public with capability list', capabilities.ok && capabilities.body.includes('service_status_inspection'), `status ${capabilities.status}`);
check('GET /.factory/logs without token → 401 (guarded)', logsNoToken.status === 401, `status ${logsNoToken.status}`);
check('GET /.factory/logs with token → 200 with lines', logsToken.ok && logsToken.body.includes('lines'), `status ${logsToken.status}`);
check('POST /.factory/task without token → 401 (guarded)', taskNoToken.status === 401, `status ${taskNoToken.status}`);
check('POST /.factory/task with token → accepted', taskToken.ok && taskToken.body.includes('accepted'), `status ${taskToken.status}`);
const allProbesGreen = [health.ok, manifest.ok, status.ok, capabilities.ok, logsToken.ok, logsNoToken.status === 401, taskNoToken.status === 401, taskToken.ok].every(Boolean);
check('FULL PROBE SUITE GREEN — the exact suite ws_run uses', allProbesGreen);

/* ----------------------------- matrix & states ----------------------------- */
console.log('— Matrix, states, limits —');
const fastChecks = matrixFor('fastify_service');
check('Matrix now requires capabilities + logs_endpoint checks', ['capabilities', 'logs_endpoint'].every((id) => fastChecks.some((c) => c.checkId === id && c.required)));
const probeResults = ['file_structure', 'dependency_resolution', 'typecheck', 'build', 'boot', 'health', 'manifest', 'status', 'capabilities', 'task_endpoint', 'logs_endpoint', 'env_example', 'docs', 'dokploy_spec'].map((id) => ({ checkId: id, status: 'passed' }));
check('All required checks passed ⇒ GREEN', matrixGreen('fastify_service', probeResults).green);
check('Missing capabilities probe ⇒ NOT green, named', (() => { const r = matrixGreen('fastify_service', probeResults.filter((x) => x.checkId !== 'capabilities')); return !r.green && r.missing.includes('capabilities'); })());
check('Live state machine includes generating/booting/probing/fixing/ready_for_migration', ['generating', 'booting', 'probing', 'fixing', 'ready_for_migration'].every((s) => WorkspaceStatus.options.includes(s)));
const limits = loadWorkspaceLimits({ WORKSPACE_MAX_LOG_BYTES: '4000' });
check('Limits include maxLogBytes (configurable) + maxCostUsd', limits.maxLogBytes === 4000 && typeof limits.maxCostUsd === 'number');

/* --------------------- honest session outcome semantics -------------------- */
console.log('— Honest outcomes (no fake success) —');
check('Failures in test/code/service/deploy categories STOP the session', ['test', 'code', 'service', 'deploy', 'repair', 'git', 'dokploy'].every((c) => stopSessionOnFailure(c)));
check('Observational failures (read/report/memory) do not kill the session', ['read', 'report', 'memory', 'evidence', 'reason', 'learning'].every((c) => !stopSessionOnFailure(c)) && OBSERVATIONAL_CATEGORIES.has('read'));

/* ------------------------- required scenario plan -------------------------- */
console.log('— Required scenario plan —');
const b = planForGoal('Create a new status-inspector service that checks all registered services and reports anomalies.', { safeMode: false, role: 'owner' });
check('Plan: generate → AUTO-FIX loop (run_workspace_tests) → migration plan', b.kind === 'runtime_goal' && b.steps[0].toolId === 'create_new_service_workspace' && b.steps[1].toolId === 'run_workspace_tests' && b.steps[2].toolId === 'create_migration_plan');
check('Fix loop step is explicit about repairing until GREEN', /AUTO-FIX|until GREEN/i.test(b.steps[1].reason));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
