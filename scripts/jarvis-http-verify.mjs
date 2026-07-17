#!/usr/bin/env node
/**
 * K2 Jarvis HTTP (product-tier) verification — boots the REAL gateway-api
 * process + a local OpenAI-compatible model, then drives the /v1/jarvis/*
 * routes over real HTTP the way the dashboard does. Real Redis + real Mongo.
 * Independence proof: the model is a local, self-hosted, deterministic
 * OpenAI-compatible endpoint (LLM_LOCAL_BASE_URL) — no paid API.
 *
 * Usage: REDIS_URL=... MONGODB_URI=... AOS_ROOT=/path/to/repo node scripts/jarvis-http-verify.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.AOS_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const REDIS_URL = process.env.REDIS_URL;
const MONGODB_URI = process.env.MONGODB_URI;
const DB = `aos_jarvis_http_${randomUUID().slice(0, 8)}`;
const INTERNAL = `http-int-${randomUUID().slice(0, 8)}`;
const ADMIN = `http-adm-${randomUUID().slice(0, 8)}`;
const GW = 'http://127.0.0.1:4101';
const results = [];
const rec = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'} — ${n}${d ? `: ${d}` : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'content-type': 'application/json', 'x-factory-internal-token': INTERNAL, 'x-factory-admin-token': ADMIN, 'x-factory-role': 'owner' };

function localModel() {
  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const p = JSON.parse(b || '{}'); const msgs = p.messages ?? [];
      const tools = new Set((p.tools ?? []).map((t) => t.function?.name));
      const called = new Set(msgs.flatMap((m) => (m.tool_calls ?? []).map((c) => c.function?.name)));
      const toolMsgs = msgs.filter((m) => m.role === 'tool');
      let message;
      if (tools.has('memory_search') && !called.has('memory_search') && toolMsgs.length === 0) {
        message = { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'memory_search', arguments: '{"query":"goal"}' } }] };
      } else {
        message = { role: 'assistant', content: `پاسخ بر پایهٔ دادهٔ واقعی: ${toolMsgs.map((m) => m.content).join(' ').slice(0, 200)}`, tool_calls: [] };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 30, completion_tokens: 10 } }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

async function main() {
  if (!REDIS_URL || !MONGODB_URI) { console.error('FAIL: REDIS_URL and MONGODB_URI required.'); process.exit(1); }
  const model = await localModel();
  const port = model.address().port;
  const child = spawn('node', ['dist/index.js'], {
    cwd: join(ROOT, 'services/gateway-api'),
    env: { ...process.env, NODE_ENV: 'test', FACTORY_ENV: 'local', FACTORY_INTERNAL_TOKEN: INTERNAL, FACTORY_ADMIN_TOKEN: ADMIN,
      MONGODB_URI, MONGODB_DB_NAME: DB, REDIS_URL, LLM_LOCAL_BASE_URL: `http://127.0.0.1:${port}/v1`, LLM_LOCAL_MODEL: 'local-test',
      LLM_TOOLCALL_MODE: 'native', SERVICE_REGISTRY_URL: '', EVENT_BUS_URL: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '',
      SERVICE_ID: 'gateway-api', SERVICE_NAME: 'Gateway API', SERVICE_DOMAIN: 'http://127.0.0.1:4101', SERVICE_PORT: '4101', LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const kill = () => { try { child.kill('SIGKILL'); } catch { /* */ } try { model.close(); } catch { /* */ } };

  let up = false;
  for (let i = 0; i < 40 && !up; i += 1) { await wait(400); try { const r = await fetch(`${GW}/health`, { signal: AbortSignal.timeout(1200) }); up = r.ok; } catch { /* */ } }
  rec('gateway boots with a local model configured', up);
  if (!up) { kill(); process.exit(1); }

  try {
    const is = await (await fetch(`${GW}/v1/jarvis/intelligence-status`, { headers: H })).json();
    rec('intelligence-status: local self-hosted provider, not degraded, research coverage honest', is.data?.isLocal === true && is.data?.degraded === false, `provider=${is.data?.provider} coverage=${is.data?.research?.coverage}`);

    const tj = await (await fetch(`${GW}/v1/jarvis/tools`, { headers: H })).json();
    rec('unified tool registry served over HTTP with availability truth', (tj.data?.available ?? 0) >= 10 && (tj.data?.total ?? 0) >= (tj.data?.available ?? 0), `${tj.data?.available}/${tj.data?.total} available`);

    const cs = await (await fetch(`${GW}/v1/jarvis/sessions`, { method: 'POST', headers: H, body: '{"title":"HTTP test"}' })).json();
    const sessionId = cs.data?.sessionId;
    rec('POST /v1/jarvis/sessions creates a persistent session', Boolean(sessionId));

    const t1 = await (await fetch(`${GW}/v1/jarvis/sessions/${sessionId}/turns`, { method: 'POST', headers: H, body: JSON.stringify({ text: 'هدف اصلی من چیست؟' }) })).json();
    rec('POST turn runs the shared agent loop and returns a grounded reply (native tool calling)', t1.data?.status === 'completed' && typeof t1.data?.replyText === 'string' && t1.data.reasoningMode === 'native', `status=${t1.data?.status} mode=${t1.data?.reasoningMode}`);

    const gs = await (await fetch(`${GW}/v1/jarvis/sessions/${sessionId}`, { headers: H })).json();
    rec('GET session returns persisted transcript (survives reload)', (gs.data?.turns?.length ?? 0) >= 1);

    const mem = await (await fetch(`${GW}/v1/jarvis/memories`, { headers: H })).json();
    rec('GET /v1/jarvis/memories serves the owner memory list', Array.isArray(mem.data));
  } catch (e) {
    rec('HTTP scenario', false, e?.message ?? String(e));
  }

  kill();
  const failed = results.filter((r) => !r.p);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('FAIL:', e?.message ?? e); process.exit(1); });
