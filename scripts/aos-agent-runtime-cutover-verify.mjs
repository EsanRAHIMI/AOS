#!/usr/bin/env node
/**
 * K1 Consolidation Prep — aos-agent-runtime cutover verification
 * (decision-log D-168/D-169).
 *
 * Human-run, owner-executed script. Not run by me in this session — I have
 * no network path to a real Dokploy-deployed host from this sandbox (see
 * decision-log D-169 for the honest reachability check). This is the exact
 * verification the operational-completion definition requires before
 * stopping any of the 4 original services, and again after each domain
 * repoint.
 *
 * For each of the 4 workers, checks:
 *   - GET  /health                 -> 200, correct serviceId
 *   - GET  /.factory/manifest      -> 200, correct serviceId, correct domain
 *   - GET  /.factory/status        -> 200, correct serviceId
 *   - GET  /.factory/capabilities  -> 200, non-empty capability list
 *   - POST /.factory/task          -> 200, accepted:true, forceFallback so
 *                                    no LLM keys are required to verify
 *
 * Usage — pre-repoint (hit the new app directly, before any domain change):
 *   ARCHITECT_AGENT_URL=http://<new-host>:4103 \
 *   REVIEWER_AGENT_URL=http://<new-host>:4106 \
 *   QA_AGENT_URL=http://<new-host>:4107 \
 *   REPORT_AGENT_URL=http://<new-host>:4114 \
 *   FACTORY_INTERNAL_TOKEN=<token> node scripts/aos-agent-runtime-cutover-verify.mjs
 *
 * Usage — post-repoint (hit the real public domains, default when the four
 * *_AGENT_URL env vars above are unset — same env var names and precedence
 * @factory/shared's peerUrl() uses elsewhere in this codebase):
 *   FACTORY_INTERNAL_TOKEN=<token> node scripts/aos-agent-runtime-cutover-verify.mjs
 *
 * Optional — also exercise a real orchestrator dispatch through the new
 * runtime (orchestrator-agent's own /.factory/task, which runs the same
 * pipeline that calls all 4 target agents):
 *   --orchestrator-url https://orchestrator.simorx.com
 *
 * Exits 0 and prints "ALL CHECKS PASSED" only if every check for every
 * worker passes. Exits 1 with a per-worker, per-check breakdown otherwise —
 * treat any failure as a rollback trigger per
 * deployment/dokploy/aos-agent-runtime.md.
 */
const INTERNAL_TOKEN = process.env.FACTORY_INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) {
  console.error('FAIL: FACTORY_INTERNAL_TOKEN is not set.');
  process.exit(1);
}

const args = process.argv.slice(2);
const orchestratorUrlFlagIndex = args.indexOf('--orchestrator-url');
const orchestratorUrl = orchestratorUrlFlagIndex >= 0 ? args[orchestratorUrlFlagIndex + 1] : null;

const WORKERS = [
  { serviceId: 'architect-agent', envKey: 'ARCHITECT_AGENT_URL', defaultUrl: 'https://architect.simorx.com', domainFragment: 'architect' },
  { serviceId: 'reviewer-agent', envKey: 'REVIEWER_AGENT_URL', defaultUrl: 'https://reviewer.simorx.com', domainFragment: 'reviewer' },
  { serviceId: 'qa-agent', envKey: 'QA_AGENT_URL', defaultUrl: 'https://qa.simorx.com', domainFragment: 'qa' },
  { serviceId: 'report-agent', envKey: 'REPORT_AGENT_URL', defaultUrl: 'https://reports.simorx.com', domainFragment: 'reports' },
];

async function checkWorker(worker) {
  const base = (process.env[worker.envKey] || worker.defaultUrl).replace(/\/+$/, '');
  const results = [];
  const headers = { 'x-factory-internal-token': INTERNAL_TOKEN };

  async function get(path, needsAuth = false) {
    const res = await fetch(`${base}${path}`, { headers: needsAuth ? headers : {} });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON, leave null */ }
    return { status: res.status, body };
  }

  // /health
  try {
    const { status, body } = await get('/health');
    const ok = status === 200 && body?.serviceId === worker.serviceId;
    results.push({ check: 'GET /health', ok, detail: ok ? 'ok' : `status=${status} serviceId=${body?.serviceId}` });
  } catch (e) {
    results.push({ check: 'GET /health', ok: false, detail: e?.message ?? String(e) });
  }

  // /.factory/manifest
  try {
    const { status, body } = await get('/.factory/manifest');
    const ok = status === 200 && body?.data?.serviceId === worker.serviceId && String(body?.data?.domain ?? '').includes(worker.domainFragment);
    results.push({ check: 'GET /.factory/manifest', ok, detail: ok ? 'ok' : `status=${status} body=${JSON.stringify(body).slice(0, 200)}` });
  } catch (e) {
    results.push({ check: 'GET /.factory/manifest', ok: false, detail: e?.message ?? String(e) });
  }

  // /.factory/status
  try {
    const { status, body } = await get('/.factory/status');
    const ok = status === 200 && body?.data?.serviceId === worker.serviceId;
    results.push({ check: 'GET /.factory/status', ok, detail: ok ? 'ok' : `status=${status}` });
  } catch (e) {
    results.push({ check: 'GET /.factory/status', ok: false, detail: e?.message ?? String(e) });
  }

  // /.factory/capabilities
  try {
    const { status, body } = await get('/.factory/capabilities');
    const ok = status === 200 && Array.isArray(body?.data?.capabilities) && body.data.capabilities.length > 0;
    results.push({ check: 'GET /.factory/capabilities', ok, detail: ok ? 'ok' : `status=${status}` });
  } catch (e) {
    results.push({ check: 'GET /.factory/capabilities', ok: false, detail: e?.message ?? String(e) });
  }

  // POST /.factory/task — forceFallback so no LLM keys required to verify
  try {
    const res = await fetch(`${base}/.factory/task`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        goal: `cutover-verify ${new Date().toISOString()}`,
        input: { forceFallback: true, evidenceSummary: 'cutover verification', target: 'cutover verification', title: 'cutover verification' },
      }),
    });
    const body = await res.json().catch(() => ({}));
    const ok = res.status === 200 && body?.data?.accepted === true;
    results.push({ check: 'POST /.factory/task', ok, detail: ok ? 'ok' : `status=${res.status} body=${JSON.stringify(body).slice(0, 200)}` });
  } catch (e) {
    results.push({ check: 'POST /.factory/task', ok: false, detail: e?.message ?? String(e) });
  }

  return { worker: worker.serviceId, base, results };
}

async function checkOrchestratorDispatch() {
  if (!orchestratorUrl) return null;
  try {
    const res = await fetch(`${orchestratorUrl.replace(/\/+$/, '')}/.factory/task`, {
      method: 'POST',
      headers: { 'x-factory-internal-token': INTERNAL_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ goal: `cutover-verify orchestrator dispatch ${new Date().toISOString()}` }),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.status === 200 && body?.data?.accepted === true, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

async function main() {
  const allResults = await Promise.all(WORKERS.map(checkWorker));
  let allOk = true;

  for (const { worker, base, results } of allResults) {
    console.log(`\n${worker}  (${base})`);
    for (const r of results) {
      const mark = r.ok ? 'PASS' : 'FAIL';
      if (!r.ok) allOk = false;
      console.log(`  [${mark}] ${r.check}${r.ok ? '' : ' — ' + r.detail}`);
    }
  }

  if (orchestratorUrl) {
    console.log(`\norchestrator dispatch check (${orchestratorUrl})`);
    const result = await checkOrchestratorDispatch();
    if (result.ok) {
      console.log('  [PASS] POST /.factory/task accepted');
    } else {
      allOk = false;
      console.log(`  [FAIL] ${JSON.stringify(result).slice(0, 300)}`);
    }
  } else {
    console.log('\n(orchestrator dispatch check skipped — pass --orchestrator-url to enable)');
  }

  console.log('');
  if (allOk) {
    console.log('ALL CHECKS PASSED');
    process.exit(0);
  } else {
    console.log('SOME CHECKS FAILED — treat as a rollback trigger per deployment/dokploy/aos-agent-runtime.md');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FAIL:', err?.message ?? err);
  process.exit(1);
});
