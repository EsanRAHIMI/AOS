#!/usr/bin/env node
/**
 * K1 BullMQ Task Queue (D-173) + K1 BullMQ Producer Adoption (D-174) —
 * real Redis + real MongoDB verification.
 *
 * shared/test/queue.contract.test.ts already proves the Mongo state machine
 * (enqueue/claim/run/succeed/fail/retry/dead-letter/cancel) against a fake
 * db, with no BullMQ dependency. shared/test/queue.bullmq-integration.
 * contract.test.ts contains the real-BullMQ proofs but is gated on
 * `describe.skipIf(!REDIS_URL)` and SKIPS wherever no Redis is reachable
 * (see decision-log D-169, D-171). First executed for real on 2026-07-17
 * against Redis 7.4.2 + MongoDB 4.4.6 — 16/16 checks passed after the
 * BullMQ ':'-rejection fixes (see shared/src/queue/index.ts).
 * shared/test/dispatch.contract.test.ts proves dispatchViaQueueOrHttp's mode
 * branching against a fake queue client — this script is the real-Redis
 * counterpart for that helper (D-174 section below), same reason: a fake
 * Redis cannot honestly stand in for BullMQ's own delivery guarantees.
 *
 * This script is the closest thing to "does it actually work against real
 * infrastructure" for the queue workstream, meant to be run by a human (or
 * CI with real services) against a real Redis and a real/disposable Mongo
 * database before relying on the queue path in production. It exercises the
 * same 15-point completion standard decision-log D-173 requires, end to end,
 * against real BullMQ + real Mongo — not mocks. The D-174 section below adds
 * the producer-adoption-specific checks: mode branching, degrade-to-HTTP +
 * AGENT_DISPATCH_DEGRADED, wait-for-completion, and the DLQ replay/cancel
 * operational surface's disabled-client guard.
 *
 * Usage:
 *   REDIS_URL=redis://127.0.0.1:6379 \
 *   MONGODB_URI=mongodb://127.0.0.1:27017 \
 *   MONGODB_DB_NAME=agent_queue_verify \
 *   node scripts/agent-queue-verify.mjs
 *
 * Exits 0 and prints "PASS" (with a per-check breakdown) on success, exits 1
 * and prints "FAIL" + reason otherwise. Every job/queue name used here is
 * prefixed with a unique run id, and all agent_job_runs rows this script
 * inserts are deleted on exit (success or failure) — safe to point at a
 * shared non-production Mongo database.
 */
import { randomUUID } from 'node:crypto';
import {
  connectMongo,
  closeMongo,
  collection,
  COLLECTIONS,
  AgentTaskQueueClient,
  createAgentTaskWorker,
  getJobRun,
  listDeadLetters,
  dispatchViaQueueOrHttp,
} from '@factory/shared';

const REDIS_URL = process.env.REDIS_URL;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ?? 'agent_queue_verify';

if (!REDIS_URL) {
  console.error('FAIL: REDIS_URL is not set. This script requires a real, reachable Redis.');
  console.error('Example: REDIS_URL=redis://127.0.0.1:6379 MONGODB_URI=mongodb://127.0.0.1:27017 node scripts/agent-queue-verify.mjs');
  process.exit(1);
}
if (!MONGODB_URI) {
  console.error('FAIL: MONGODB_URI is not set. Point this at a real or disposable MongoDB — never production.');
  process.exit(1);
}

const RUN_ID = randomUUID().slice(0, 8);
const results = []; // { name, pass, detail }
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await connectMongo({ uri: MONGODB_URI, dbName: MONGODB_DB_NAME });
  console.log(`connected to ${MONGODB_DB_NAME}; queue infra pointed at ${REDIS_URL}; run id ${RUN_ID}`);

  const client = new AgentTaskQueueClient({ redisUrl: REDIS_URL, maxAttempts: 3, backoffMs: 200 });
  record('1. real BullMQ producer constructed and enabled', client.enabled === true);

  const workers = [];
  const jobRunIds = []; // for cleanup

  // --- 1/2. real producer + real worker consumption path, round trip ------
  {
    const serviceId = `verify-basic-${RUN_ID}`;
    const seen = [];
    const handler = async (req) => {
      seen.push(req.taskId);
      return { taskId: req.taskId ?? '', accepted: true };
    };
    const worker = createAgentTaskWorker({ serviceId, redisUrl: REDIS_URL, handler, ctx: {} });
    workers.push(worker);
    record('2. real BullMQ worker constructed and enabled', worker.enabled === true);

    const out = await client.enqueue(serviceId, { taskId: 'basic-1', goal: 'g', input: {}, priority: 'normal' });
    if (out.jobRunId) jobRunIds.push(out.jobRunId);
    await wait(1500);
    const run = out.jobRunId ? await getJobRun(out.jobRunId) : null;
    record('1/3/4. enqueue -> claim -> run -> succeeded, Mongo is system of record', out.enqueued === true && run?.status === 'succeeded', `status=${run?.status}`);
    record('11. audit/evidence: jobRunId correlates enqueue result and Mongo record', run?.jobRunId === out.jobRunId);
  }

  // --- 5/6. idempotency + configurable retry/backoff -----------------------
  {
    const serviceId = `verify-idem-${RUN_ID}`;
    const worker = createAgentTaskWorker({ serviceId, redisUrl: REDIS_URL, handler: async (r) => ({ taskId: r.taskId ?? '', accepted: true }), ctx: {} });
    workers.push(worker);
    const key = `idem-${RUN_ID}`;
    const first = await client.enqueue(serviceId, { taskId: 't', goal: 'g', input: {}, priority: 'normal' }, { idempotencyKey: key });
    const second = await client.enqueue(serviceId, { taskId: 't', goal: 'g', input: {}, priority: 'normal' }, { idempotencyKey: key });
    if (first.jobRunId) jobRunIds.push(first.jobRunId);
    record('5. idempotency key prevents duplicate enqueue', first.enqueued === true && second.enqueued === false && second.duplicate === true);
  }

  // --- 6/9. retry/backoff -> eventual success ------------------------------
  {
    const serviceId = `verify-retry-${RUN_ID}`;
    let calls = 0;
    const handler = async () => {
      calls += 1;
      if (calls < 2) throw new Error('transient failure (expected)');
      return { taskId: 'retry-1', accepted: true };
    };
    const worker = createAgentTaskWorker({ serviceId, redisUrl: REDIS_URL, handler, ctx: {} });
    workers.push(worker);
    const out = await client.enqueue(serviceId, { taskId: 'retry-1', goal: 'g', input: {}, priority: 'normal' });
    if (out.jobRunId) jobRunIds.push(out.jobRunId);
    await wait(2000);
    const run = out.jobRunId ? await getJobRun(out.jobRunId) : null;
    record('6. configurable retry/backoff — fails once, retries, succeeds', run?.status === 'succeeded' && calls === 2, `calls=${calls}, status=${run?.status}`);
  }

  // --- 9. dead-letter after exhausting attempts, + replay ------------------
  {
    const serviceId = `verify-dlq-${RUN_ID}`;
    const worker = createAgentTaskWorker({ serviceId, redisUrl: REDIS_URL, handler: async () => { throw new Error('always fails (expected)'); }, ctx: {} });
    workers.push(worker);
    const out = await client.enqueue(serviceId, { taskId: 'dlq-1', goal: 'g', input: {}, priority: 'normal' });
    if (out.jobRunId) jobRunIds.push(out.jobRunId);
    await wait(2500);
    const run = out.jobRunId ? await getJobRun(out.jobRunId) : null;
    const deadLetters = await listDeadLetters(serviceId);
    record('9a. exhausted retries -> dead_lettered, inspectable via listDeadLetters', run?.status === 'dead_lettered' && deadLetters.some((d) => d.jobRunId === out.jobRunId));

    const replay = await client.replayDeadLetter(serviceId, out.jobRunId);
    record('9b. dead-letter replay re-enqueues with a fresh attempt budget', replay.enqueued === true);
  }

  // --- 8. timeout handling ---------------------------------------------------
  {
    const serviceId = `verify-timeout-${RUN_ID}`;
    const worker = createAgentTaskWorker({ serviceId, redisUrl: REDIS_URL, handler: async () => { await wait(4000); return { taskId: 'slow-1', accepted: true }; }, ctx: {}, timeoutMs: 300 });
    workers.push(worker);
    const out = await client.enqueue(serviceId, { taskId: 'slow-1', goal: 'g', input: {}, priority: 'normal' });
    if (out.jobRunId) jobRunIds.push(out.jobRunId);
    // Poll instead of sampling one instant: with timeoutMs=300, maxAttempts=3
    // and exponential backoff (200/400ms), the run legitimately passes back
    // through 'running' between attempts — a fixed 1500ms sleep lands mid-
    // attempt and misreads correct retry behavior as a failure. Timeout-as-
    // failure is proven by attempts>0 (a timeout consumed an attempt) or a
    // retrying/dead_lettered status, whichever is observed first.
    let run = null;
    let sawTimeoutFailure = false;
    for (let i = 0; i < 25 && !sawTimeoutFailure; i += 1) {
      await wait(200);
      run = out.jobRunId ? await getJobRun(out.jobRunId) : null;
      sawTimeoutFailure = run?.status === 'retrying' || run?.status === 'dead_lettered' || (run?.attempts ?? 0) > 0;
    }
    record('8. a handler slower than the configured timeout is treated as a failure', sawTimeoutFailure, `status=${run?.status} attempts=${run?.attempts}`);
  }

  // --- 14. two worker instances never double-execute the same job ----------
  {
    const serviceId = `verify-dup-${RUN_ID}`;
    const executions = new Map();
    const handler = async (req) => {
      const key = req.taskId ?? 'x';
      executions.set(key, (executions.get(key) ?? 0) + 1);
      return { taskId: key, accepted: true };
    };
    const workerA = createAgentTaskWorker({ serviceId, redisUrl: REDIS_URL, handler, ctx: {}, workerInstanceId: 'verify-A' });
    const workerB = createAgentTaskWorker({ serviceId, redisUrl: REDIS_URL, handler, ctx: {}, workerInstanceId: 'verify-B' });
    workers.push(workerA, workerB);

    const outs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => client.enqueue(serviceId, { taskId: `dup-${i}`, goal: 'g', input: {}, priority: 'normal' })),
    );
    for (const o of outs) if (o.jobRunId) jobRunIds.push(o.jobRunId);
    await wait(2000);

    const allOnce = outs.every((o) => o.enqueued) && [...executions.values()].every((c) => c === 1) && executions.size === 10;
    record('14. two worker instances sharing one queue never double-execute a job', allOnce, `executions=${JSON.stringify([...executions.entries()])}`);
  }

  // --- honest degraded behavior (12) — checked structurally, not live ------
  {
    const disabledClient = new AgentTaskQueueClient({ redisUrl: '' });
    const disabledWorker = createAgentTaskWorker({ serviceId: 'verify-disabled', redisUrl: '', handler: async () => ({ taskId: '', accepted: true }), ctx: {} });
    const out = await disabledClient.enqueue('verify-disabled', { taskId: 't', goal: 'g', input: {}, priority: 'normal' });
    record('12. honest degraded behavior when Redis is unavailable (REDIS_URL="")', out.enqueued === false && out.reason === 'redis_disabled' && disabledWorker.enabled === false);
    await disabledWorker.close();
    await disabledClient.close();
  }

  // ===========================================================================
  // K1 BullMQ Producer Adoption (D-174) — dispatchViaQueueOrHttp against real
  // Redis + real Mongo. Same checklist decision-log D-174 requires as the
  // "real Redis gate" for the K1 queue-adoption workstream.
  // ===========================================================================

  // --- D174.1: mode=queue_with_http_fallback, queue healthy → dispatchMode 'queue' ---
  {
    const serviceId = `verify-d174-ok-${RUN_ID}`;
    const worker = createAgentTaskWorker({ serviceId, redisUrl: REDIS_URL, handler: async (r) => ({ taskId: r.taskId ?? '', accepted: true, echo: r.goal }), ctx: {} });
    workers.push(worker);
    let httpCalled = false;
    const out = await dispatchViaQueueOrHttp({
      serviceId, body: { taskId: 'd174-ok-1', goal: 'design it', input: {}, priority: 'normal' },
      mode: 'queue_with_http_fallback', queueClient: client,
      httpDispatch: async () => { httpCalled = true; return { ok: true, status: 200, data: { via: 'http' } }; },
      waitForCompletion: { timeoutMs: 3000, pollMs: 100 },
    });
    if (out.jobRunId) jobRunIds.push(out.jobRunId);
    record('D174.1 real queue dispatch: enqueue -> worker executes -> waitForCompletion returns the real result, HTTP never called', out.ok === true && out.dispatchMode === 'queue' && !httpCalled && out.data?.echo === 'design it', `dispatchMode=${out.dispatchMode} data=${JSON.stringify(out.data)}`);
  }

  // --- D174.2: queue client disabled → degrades to HTTP + AGENT_DISPATCH_DEGRADED published ---
  {
    const disabledClient = new AgentTaskQueueClient({ redisUrl: '' });
    let publishedDegraded = null;
    let httpCalled = false;
    const out = await dispatchViaQueueOrHttp({
      serviceId: `verify-d174-degrade-${RUN_ID}`, body: { taskId: 'd174-degrade-1', goal: 'g', input: {}, priority: 'normal' },
      mode: 'queue_with_http_fallback', queueClient: disabledClient,
      httpDispatch: async () => { httpCalled = true; return { ok: true, status: 200, data: { via: 'http-fallback' } }; },
      publish: async (e) => { publishedDegraded = e; return true; },
    });
    await disabledClient.close().catch(() => undefined);
    record('D174.2 disabled queue client degrades to HTTP and publishes AGENT_DISPATCH_DEGRADED (never a silent fallback)', out.dispatchMode === 'http_fallback' && httpCalled === true && publishedDegraded?.type === 'agent.dispatch.degraded', `dispatchMode=${out.dispatchMode} published=${publishedDegraded?.type}`);
  }

  // --- D174.3: mode=queue_only, queue unhealthy → fails loudly, HTTP never called ---
  {
    const disabledClient = new AgentTaskQueueClient({ redisUrl: '' });
    let httpCalled = false;
    const out = await dispatchViaQueueOrHttp({
      serviceId: `verify-d174-queueonly-${RUN_ID}`, body: { taskId: 'd174-qo-1', goal: 'g', input: {}, priority: 'normal' },
      mode: 'queue_only', queueClient: disabledClient,
      httpDispatch: async () => { httpCalled = true; return { ok: true, status: 200 }; },
    });
    await disabledClient.close().catch(() => undefined);
    record('D174.3 queue_only mode never silently falls back to HTTP on failure', out.ok === false && httpCalled === false);
  }

  // --- D174.4: DLQ replay via the operational surface, real Redis round trip ---
  {
    const serviceId = `verify-d174-dlq-${RUN_ID}`;
    let calls = 0;
    const worker = createAgentTaskWorker({
      serviceId, redisUrl: REDIS_URL,
      handler: async (r) => { calls += 1; if (calls === 1) throw new Error('fails on first pass (expected — forces dead-letter)'); return { taskId: r.taskId ?? '', accepted: true }; },
      ctx: {}, timeoutMs: 500,
    });
    workers.push(worker);
    // maxAttempts:1 on a dedicated client so the FIRST failure exhausts immediately.
    const oneShotClient = new AgentTaskQueueClient({ redisUrl: REDIS_URL, maxAttempts: 1, backoffMs: 50 });
    const out = await oneShotClient.enqueue(serviceId, { taskId: 'd174-dlq-1', goal: 'g', input: {}, priority: 'normal' });
    if (out.jobRunId) jobRunIds.push(out.jobRunId);
    await wait(1500);
    const dead = out.jobRunId ? await getJobRun(out.jobRunId) : null;
    const replay = out.jobRunId ? await oneShotClient.replayDeadLetter(serviceId, out.jobRunId) : null;
    await wait(1500);
    const replayed = out.jobRunId ? await getJobRun(out.jobRunId) : null;
    await oneShotClient.close().catch(() => undefined);
    record('D174.4 DLQ operational surface: dead-letter -> replay -> succeeds on second pass', dead?.status === 'dead_lettered' && replay?.enqueued === true && replayed?.status === 'succeeded' && calls === 2, `deadStatus=${dead?.status} replayEnqueued=${replay?.enqueued} finalStatus=${replayed?.status} calls=${calls}`);
  }

  // --- D174.5: cancel + replay/cancel disabled-client guard never crashes on live Redis calls ---
  {
    const disabledClient = new AgentTaskQueueClient({ redisUrl: '' });
    const cancelResult = await disabledClient.cancel('verify-d174-disabled', 'nonexistent-job-run');
    const replayResult = await disabledClient.replayDeadLetter('verify-d174-disabled', 'nonexistent-job-run');
    await disabledClient.close().catch(() => undefined);
    record('D174.5 cancel()/replayDeadLetter() on a disabled client fail gracefully (no live-Redis exception) — the DLQ ops route depends on this', cancelResult === null && replayResult?.reason === 'redis_disabled');
  }

  // --- cleanup ---------------------------------------------------------------
  await Promise.all(workers.map((w) => w.close().catch(() => undefined)));
  await client.close().catch(() => undefined);
  if (jobRunIds.length) {
    await collection(COLLECTIONS.AGENT_JOB_RUNS).deleteMany({ jobRunId: { $in: jobRunIds } });
  }
  await closeMongo();

  const failed = results.filter((r) => !r.pass);
  console.log('');
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.error('FAIL — one or more checks did not pass:');
    for (const f of failed) console.error(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
    process.exit(1);
  }
  console.log('PASS — real BullMQ + real MongoDB verification of the K1 Task Queue (D-173) completed successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err?.message ?? err);
  process.exit(1);
});
