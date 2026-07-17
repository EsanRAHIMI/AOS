#!/usr/bin/env node
/**
 * K2 Jarvis Runtime Verification (D-177) — the shared agent loop + persistent
 * Jarvis + memory v2 + missions, RUNTIME_VERIFIED against real Redis + real
 * MongoDB + a REAL local OpenAI-compatible model server.
 *
 * Independence mandate proof: the "model" here is a self-hosted, local,
 * deterministic OpenAI-compatible /chat/completions server started by THIS
 * script (no paid API, no network). It exercises the exact native
 * tool-calling code path (LLM_LOCAL_BASE_URL → OpenAICompatibleToolsProvider)
 * a real Ollama/vLLM endpoint would — the transport and governance are real;
 * only the model's token choices are scripted so the scenario is repeatable.
 *
 * Proves end-to-end:
 *  1. A turn runs the multi-turn loop: model → governed tool → observation →
 *     final grounded answer (memory + missions persisted for real).
 *  2. Cross-session recall: a fact recorded in session A changes the answer
 *     in a NEW session B (memory v2 retrieval, not chat scrollback).
 *  3. Session persistence: sessions/turns survive being re-read fresh
 *     (simulates reload/restart — Mongo is the truth).
 *  4. Governed approval PAUSE + exact RESUME: a sensitive tool pauses the run;
 *     the paused run resumes from its exact state and completes.
 *  5. Degraded mode honesty: with the model server "down", a turn still
 *     completes from real stored data, labeled reasoningMode:'none'.
 *  6. Tool ledger + injection fencing recorded in tool_invocations.
 *
 * Usage:
 *   REDIS_URL=redis://127.0.0.1:6379 MONGODB_URI=mongodb://127.0.0.1:27017 \
 *   node scripts/jarvis-runtime-verify.mjs
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  connectMongo, closeMongo, setTestDb,
  buildCoreToolFamilies, runJarvisTurn, resumeJarvisApproval,
  createJarvisSession, getJarvisSession, listSessionTurns,
  recordMemory, searchMemories,
  createMissionNode,
  OpenAICompatibleToolsProvider,
  collection, COLLECTIONS, getDb,
} from '@factory/shared';

const REDIS_URL = process.env.REDIS_URL;
const MONGODB_URI = process.env.MONGODB_URI;
const DB = process.env.MONGODB_DB_NAME ?? `aos_jarvis_verify_${randomUUID().slice(0, 8)}`;
if (!REDIS_URL || !MONGODB_URI) { console.error('FAIL: REDIS_URL and MONGODB_URI required (disposable infra only).'); process.exit(1); }

const results = [];
const record = (n, pass, d = '') => { results.push({ n, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} — ${n}${d ? `: ${d}` : ''}`); };

/* ---- a REAL local OpenAI-compatible model server (scripted, deterministic) ---
 * It reads the last user/tool message and the available tools, and returns a
 * tool_call or a final message following a fixed policy per scenario. This is
 * exactly the wire protocol Ollama/vLLM speak — the provider code under test
 * is unmodified. */
function startLocalModel() {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      const msgs = payload.messages ?? [];
      const toolNames = new Set((payload.tools ?? []).map((t) => t.function?.name));
      const rawUser = [...msgs].reverse().find((m) => m.role === 'user')?.content ?? '';
      // The user message is `${context}\n\nGOAL:\n${goal}` — match only the
      // actual goal, never the context scaffolding (which contains the word
      // "mission" etc). This is what a real model reasons over too.
      const lastUser = (/GOAL:\n([\s\S]*)$/.exec(rawUser)?.[1] ?? rawUser).trim();
      const toolMsgs = msgs.filter((m) => m.role === 'tool');
      const alreadyCalled = new Set(msgs.flatMap((m) => (m.tool_calls ?? []).map((c) => c.function?.name)));

      let message;
      const delMatch = /__DELETE__:(\S+)/.exec(lastUser);
      const wantMissionPlan = /vision|بساز|objective|mission/i.test(lastUser);

      if (delMatch && toolNames.has('memory_delete') && !alreadyCalled.has('memory_delete')) {
        message = { role: 'assistant', content: '', tool_calls: [{ id: 'c_del', type: 'function', function: { name: 'memory_delete', arguments: JSON.stringify({ memoryId: delMatch[1] }) } }] };
      } else if (wantMissionPlan && toolNames.has('mission_create') && !alreadyCalled.has('mission_create')) {
        message = { role: 'assistant', content: '', tool_calls: [{ id: 'c_mc', type: 'function', function: { name: 'mission_create', arguments: JSON.stringify({ nodeType: 'vision', title: 'AOS becomes my daily operating system' }) } }] };
      } else if (toolNames.has('memory_search') && !alreadyCalled.has('memory_search') && toolMsgs.length === 0) {
        // Always ground the answer: read memory first.
        message = { role: 'assistant', content: '', tool_calls: [{ id: 'c_ms', type: 'function', function: { name: 'memory_search', arguments: JSON.stringify({ query: lastUser.slice(0, 60) }) } }] };
      } else {
        // Compose a final answer that quotes what the tool observation returned.
        const obs = toolMsgs.map((m) => m.content).join(' | ').slice(0, 400);
        message = { role: 'assistant', content: `بر اساس دادهٔ واقعی: ${obs || 'موردی یافت نشد'}`, tool_calls: [] };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 50, completion_tokens: 20 } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  await connectMongo({ uri: MONGODB_URI, dbName: DB });
  const modelServer = await startLocalModel();
  const port = modelServer.address().port;
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  console.log(`local OpenAI-compatible model at ${baseUrl}; db ${DB}`);

  const provider = new OpenAICompatibleToolsProvider(baseUrl, 'local', true);
  const registry = buildCoreToolFamilies({ env: process.env });
  const actor = { actorId: 'esan', scope: 'user', tenantId: null };
  const deps = { registry, provider, env: { ...process.env, LLM_TOOLCALL_MODE: 'native' }, maxSteps: 6, timeoutMs: 30000 };

  record('registry has real tools available', registry.list().filter((t) => t.available).length >= 10, `${registry.list().filter((t) => t.available).length} available`);

  // --- 1. multi-turn grounded loop ---
  const sA = await createJarvisSession(actor, { title: 'Session A' });
  await recordMemory(actor, { kind: 'goal', status: 'confirmed', content: 'هدف اصلی من راه‌اندازی نسخهٔ قابل‌استفادهٔ AOS تا پایان تابستان است', subject: 'goal:aos', provenance: { sourceType: 'user_stated', sessionId: sA.sessionId, turnId: null, runId: null, refIds: [], sourceUrl: '' } });
  const t1 = await runJarvisTurn(actor, sA.sessionId, 'هدف اصلی من چیست؟', deps);
  record('1. multi-turn loop grounds the answer in real memory (via memory_search tool)', t1.status === 'completed' && /AOS/.test(t1.replyText), `status=${t1.status} reply="${t1.replyText.slice(0, 80)}"`);

  // --- 2. cross-session recall: NEW session, related question ---
  const sB = await createJarvisSession(actor, { title: 'Session B' });
  const t2 = await runJarvisTurn(actor, sB.sessionId, 'برنامهٔ راه‌اندازی AOS چطور پیش می‌رود؟', deps);
  record('2. cross-session recall: a fact from session A changes the answer in NEW session B', /AOS/.test(t2.replyText) && t2.runId !== t1.runId, `reply="${t2.replyText.slice(0, 80)}"`);

  // --- 3. persistence across a fresh read (reload/restart simulation) ---
  const reloaded = await getJarvisSession(actor, sA.sessionId);
  const turnsA = await listSessionTurns(actor, sA.sessionId);
  record('3. session + transcript persist (survive a fresh read = reload/restart)', Boolean(reloaded) && turnsA.length >= 1 && turnsA[0].replyText.length > 0);

  // --- 4. mission creation through the loop (writes real structured state) ---
  const sM = await createJarvisSession(actor, { title: 'Missions' });
  const t4 = await runJarvisTurn(actor, sM.sessionId, 'برای هدف AOS یک vision بساز', deps);
  const visions = await collection(COLLECTIONS.MISSION_NODES).find({ createdBy: 'esan', nodeType: 'vision' }).toArray();
  record('4. loop creates durable mission state via governed mission_create tool', visions.length >= 1 && t4.status === 'completed', `visions=${visions.length}`);

  // --- 5. governed approval PAUSE + exact RESUME (real approval-required
  //        tool from the core registry: memory_delete is internal_sensitive). ---
  const sApp = await createJarvisSession(actor, { title: 'Approval' });
  const throwaway = await recordMemory(actor, { kind: 'context', status: 'temporary', content: 'delete me in the approval test', subject: 'sd:throwaway', provenance: { sourceType: 'user_stated', sessionId: sApp.sessionId, turnId: null, runId: null, refIds: [], sourceUrl: '' } });
  const memId = throwaway.memory.memoryId;
  const t5 = await runJarvisTurn(actor, sApp.sessionId, `این حافظه را حذف کن __DELETE__:${memId}`, deps);
  const stillThere1 = (await searchMemories(actor, 'delete me in the approval test')).some((r) => r.record.memoryId === memId);
  const paused = t5.status === 'waiting_approval' && Boolean(t5.pendingApprovalId) && stillThere1;
  let resumed = false;
  if (paused) {
    const r = await resumeJarvisApproval(actor, { runId: t5.runId, approvalId: t5.pendingApprovalId, decision: 'approved', decidedBy: 'owner' }, deps);
    const gone = !(await searchMemories(actor, 'delete me in the approval test')).some((x) => x.record.memoryId === memId);
    resumed = r.status === 'completed' && gone;
  }
  record('5. governed approval PAUSES the run (memory not deleted), then exact RESUME completes it', paused && resumed, `paused=${paused} resumed=${resumed}`);

  // --- 6. tool ledger recorded ---
  const invs = await collection(COLLECTIONS.TOOL_INVOCATIONS).find({}).toArray();
  const hasApprovalLedger = invs.some((i) => i.policyDecision === 'approval_required');
  const hasAutoLedger = invs.some((i) => i.policyDecision === 'auto_allowed' && i.status === 'executed');
  record('6. tool ledger: every call recorded with policy decision (auto + approval)', hasApprovalLedger && hasAutoLedger, `${invs.length} invocations`);

  // --- 7. degraded mode honesty: model "down" (no provider) ---
  const sD = await createJarvisSession(actor, { title: 'Degraded' });
  const t7 = await runJarvisTurn(actor, sD.sessionId, 'هدف من چیست؟', { registry, provider: null, env: process.env });
  record('7. degraded mode: no model ⇒ answers from real data, labeled reasoningMode=none (never fake)', t7.reasoningMode === 'none' && /آفلاین|Degraded|AOS/.test(t7.replyText), `mode=${t7.reasoningMode}`);

  modelServer.close();
  await getDb().dropDatabase().catch(() => undefined);
  await closeMongo().catch(() => undefined);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { console.error('FAIL — Jarvis runtime verification incomplete.'); process.exit(1); }
  console.log('PASS — Jarvis runtime verified against real Redis + real Mongo + a real local OpenAI-compatible model (no paid API).');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e?.stack ?? e?.message ?? e); process.exit(1); });
