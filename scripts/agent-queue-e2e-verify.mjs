#!/usr/bin/env node
/**
 * K1 BullMQ Queue — SERVICE-TIER end-to-end verification (D-173/D-174).
 *
 * `scripts/agent-queue-verify.mjs` proves the queue PRIMITIVES against real
 * Redis + real Mongo (producer, worker, retry, DLQ, replay, dispatch-helper
 * branching) with in-process workers. This script is the next tier up: it
 * boots the REAL services (gateway-api, orchestrator-agent, architect-agent)
 * as separate node processes from their built `dist/`, then proves the
 * queue-backed dispatch path through real HTTP + real BullMQ + real Mongo:
 *
 *   A. POST /v1/tasks → gateway enqueues to agent-tasks.orchestrator-agent →
 *      orchestrator's BullMQ Worker consumes it → pipeline runs (LLM keys
 *      deliberately empty → deterministic fallback; this verifies QUEUE
 *      transport, not LLM reasoning) → orchestrator AgentJobRun `succeeded`,
 *      task timeline contains the agent.job.* lifecycle events.
 *   B. DLQ ops surface over HTTP: cancel a still-queued AgentJobRun via
 *      POST /v1/agent-jobs/:id/cancel and see status `cancelled`.
 *   C. Runtime Redis outage: Redis is killed mid-run (SHUTDOWN NOSAVE over a
 *      raw socket), another task is POSTed, and the gateway must still
 *      answer within the SLA and degrade to HTTP (AGENT_DISPATCH_DEGRADED
 *      event recorded, orchestrator reached over HTTP instead) — never a
 *      hang, never a silent drop.
 *
 * Hermetic by construction: it generates its own FACTORY_* tokens, points at
 * a dedicated MONGODB_DB_NAME (default `aos_e2e_verify`, dropped on exit),
 * leaves LLM keys empty, and disables registry/event-bus URLs (both are
 * fail-soft by contract). Requires only a reachable Redis and Mongo — same
 * contract as agent-queue-verify.mjs, meant for a human/CI with disposable
 * infra, never production.
 *
 * Usage:
 *   REDIS_URL=redis://127.0.0.1:6379 \
 *   MONGODB_URI=mongodb://127.0.0.1:27017 \
 *   node scripts/agent-queue-e2e-verify.mjs
 */
import { spawn } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectMongo, closeMongo, getDb } from '@factory/shared';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REDIS_URL = process.env.REDIS_URL;
const MONGODB_URI = process.env.MONGODB_URI;
// Unique DB per run: a previous run's pipeline can still be mid-write when
// its dropDatabase fires (services are killed AFTER cleanup), and those late
// writes would repopulate a shared DB with e.g. a 'proposed'
// cap_task_orchestration row — which seedCapabilities' $setOnInsert then
// respects, silently flipping the NEXT run into the capability-gap branch.
// Cross-run isolation makes that class of contamination impossible.
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ?? `aos_e2e_verify_${randomUUID().slice(0, 8)}`;

if (!REDIS_URL || !MONGODB_URI) {
  console.error('FAIL: REDIS_URL and MONGODB_URI are required (disposable infra only — never production).');
  process.exit(1);
}

const INTERNAL_TOKEN = `e2e-internal-${randomUUID().slice(0, 8)}`;
const ADMIN_TOKEN = `e2e-admin-${randomUUID().slice(0, 8)}`;
const GATEWAY = 'http://127.0.0.1:4101';

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Shared env all three services boot with — hermetic, no real secrets. */
function serviceEnv(id, name, port) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    FACTORY_ENV: 'local',
    FACTORY_INTERNAL_TOKEN: INTERNAL_TOKEN,
    FACTORY_ADMIN_TOKEN: ADMIN_TOKEN,
    MONGODB_URI,
    MONGODB_DB_NAME,
    REDIS_URL,
    AGENT_DISPATCH_MODE: 'queue_with_http_fallback',
    // Keep the queue-wait window short so orchestrator→architect (architect
    // runs no BullMQ worker standalone — consolidation is aos-agent-runtime's
    // concern, see D-168) degrades to HTTP quickly instead of stalling the
    // pipeline for the default 30s.
    AGENT_QUEUE_TIMEOUT_MS: '1500',
    // The pipeline's own execution budget — must dwarf the per-peer wait
    // above (see AGENT_JOB_TIMEOUT_MS in AgentQueueEnvSchema).
    AGENT_JOB_TIMEOUT_MS: '60000',
    AGENT_QUEUE_BACKOFF_MS: '200',
    // Empty LLM keys → llmRouterFromEnv's deterministic schema-validated
    // fallback. This script proves queue transport, not model reasoning.
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    SERVICE_REGISTRY_URL: '',
    // Event persistence is event-bus-service's job (EventPublisher no-ops
    // without it) — it must run for timeline/degraded-event assertions.
    EVENT_BUS_URL: 'http://127.0.0.1:4111',
    ORCHESTRATOR_AGENT_URL: 'http://127.0.0.1:4102',
    ARCHITECT_AGENT_URL: 'http://127.0.0.1:4103',
    LOG_LEVEL: 'warn',
    SERVICE_ID: id,
    SERVICE_NAME: name,
    SERVICE_DOMAIN: `http://127.0.0.1:${port}`,
    SERVICE_PORT: String(port),
  };
}

const children = [];
function startService(dir, id, name, port) {
  const child = spawn('node', ['dist/index.js'], {
    cwd: join(ROOT, 'services', dir),
    env: serviceEnv(id, name, port),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(child);
  return child;
}

async function waitForHealth(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await wait(300);
  }
  return false;
}

const authHeaders = {
  'content-type': 'application/json',
  'x-factory-internal-token': INTERNAL_TOKEN,
  'x-factory-admin-token': ADMIN_TOKEN,
  'x-factory-role': 'owner',
};

/** Kill Redis without needing redis-cli on PATH: inline RESP over a socket. */
function redisShutdown(url) {
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const sock = netConnect({ host: hostname, port: Number(port || 6379) }, () => {
      sock.write('SHUTDOWN NOSAVE\r\n');
      // Redis closes the connection instead of replying — that's success.
      setTimeout(() => { sock.destroy(); resolve(true); }, 500);
    });
    sock.on('error', () => resolve(false));
  });
}

async function main() {
  await connectMongo({ uri: MONGODB_URI, dbName: MONGODB_DB_NAME });
  const db = getDb();

  console.log(`booting event-bus(4111), gateway-api(4101), orchestrator-agent(4102), architect-agent(4103) against ${MONGODB_DB_NAME}...`);
  startService('event-bus-service', 'event-bus-service', 'Event Bus Service', 4111);
  startService('gateway-api', 'gateway-api', 'Gateway API', 4101);
  startService('orchestrator-agent', 'orchestrator-agent', 'Orchestrator Agent', 4102);
  startService('architect-agent', 'architect-agent', 'Architect Agent', 4103);

  const healthy = (await Promise.all([waitForHealth(4111), waitForHealth(4101), waitForHealth(4102), waitForHealth(4103)])).every(Boolean);
  record('E2E.0 all four services boot and report /health ok', healthy);
  if (!healthy) throw new Error('services failed to boot — see logs above');

  // --- A. queue-backed dispatch: gateway → BullMQ → orchestrator worker ----
  // Goal wording is deliberately capability-keyword-NEUTRAL (see
  // CAPABILITY_KEYWORDS in shared/src/capability): only the always-present
  // cap_task_orchestration is detected, which seedCapabilities() marks
  // active, so the pipeline takes the standard DELEGATION branch (the one
  // that queue-dispatches architect-agent) instead of the capability-gap
  // branch. 'verification'/'e2e' in the earlier wording matched
  // browser_testing and silently routed to Stage 2 — keep it neutral.
  const goal = `Coordinate a routine operational roundup ${randomUUID().slice(0, 8)}`;
  const createRes = await fetch(`${GATEWAY}/v1/tasks`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ goal, input: {}, priority: 'normal' }),
    signal: AbortSignal.timeout(10000),
  });
  const createBody = await createRes.json();
  const taskId = createBody?.data?.taskId;
  record('E2E.1 POST /v1/tasks accepted and persisted the task', createRes.ok && Boolean(taskId), `status=${createRes.status} taskId=${taskId}`);

  // The orchestrator's AgentJobRun must reach `succeeded` via the QUEUE path.
  let orchRun = null;
  for (let i = 0; i < 120 && orchRun?.status !== 'succeeded'; i += 1) {
    await wait(500);
    orchRun = await db.collection('agent_job_runs').findOne({ taskId, serviceId: 'orchestrator-agent' });
  }
  record(
    'E2E.2 orchestrator consumed the task from BullMQ (AgentJobRun succeeded, worker recorded)',
    orchRun?.status === 'succeeded' && Boolean(orchRun?.workerInstanceId),
    `status=${orchRun?.status} worker=${orchRun?.workerInstanceId}`,
  );

  const timelineRes = await fetch(`${GATEWAY}/v1/tasks/${taskId}/timeline`, { headers: authHeaders, signal: AbortSignal.timeout(5000) });
  const timeline = (await timelineRes.json())?.data ?? [];
  const types = new Set(timeline.map((e) => e.type));
  // 'agent.job.queued' is deliberately absent here: the gateway's queue
  // client is constructed before ctx exists and publishes no events — a
  // documented gap (see server.ts's agentQueueClient comment). The WORKER
  // lifecycle (claimed → started → succeeded) is what proves queue delivery.
  record(
    'E2E.3 task timeline shows the queue lifecycle (claimed → started → succeeded)',
    ['agent.job.claimed', 'agent.job.started', 'agent.job.succeeded'].every((t) => types.has(t)),
    `events=${[...types].filter((t) => t.startsWith('agent.job')).join(',')}`,
  );

  // --- B. DLQ ops surface over HTTP: cancel a still-queued job run ---------
  // The pipeline enqueued architect-agent work; standalone architect-agent
  // runs no BullMQ worker (D-168), so that run stays `queued` — exactly the
  // state the cancel route exists for. NOTE: the orchestrator's own job run
  // succeeds as soon as handleTask ACCEPTS the goal — the pipeline continues
  // in the background — so the architect enqueue happens seconds AFTER
  // E2E.2's success. Poll for it rather than sampling once.
  let architectRun = null;
  for (let i = 0; i < 50 && !architectRun; i += 1) {
    await wait(500);
    architectRun = await db.collection('agent_job_runs').findOne({ taskId, serviceId: 'architect-agent' });
  }
  let cancelOk = false;
  let cancelDetail = 'no architect job run found (pipeline may not have delegated)';
  if (architectRun) {
    const cancelRes = await fetch(`${GATEWAY}/v1/agent-jobs/${architectRun.jobRunId}/cancel`, {
      method: 'POST',
      headers: authHeaders,
      body: '{}', // content-type is json — Fastify 400s an empty body
      signal: AbortSignal.timeout(5000),
    });
    const after = await db.collection('agent_job_runs').findOne({ jobRunId: architectRun.jobRunId });
    cancelOk = cancelRes.ok && after?.status === 'cancelled';
    cancelDetail = `cancelStatus=${cancelRes.status} finalStatus=${after?.status}`;
  }
  record('E2E.4 DLQ ops surface: POST /v1/agent-jobs/:id/cancel cancels a queued run', cancelOk, cancelDetail);

  // --- C. runtime Redis outage → bounded degrade to HTTP, never a hang -----
  // E2E_SKIP_OUTAGE=1 lets constrained environments (e.g. a sandbox with a
  // hard per-invocation wall clock) split A/B and C into two runs — C is
  // destructive to Redis, so it must always come last regardless.
  if (process.env.E2E_SKIP_OUTAGE === '1') {
    console.log('skipping Redis-outage scenario (E2E_SKIP_OUTAGE=1)');
  } else {
  const down = await redisShutdown(REDIS_URL);
  record('E2E.5 Redis killed mid-run (SHUTDOWN NOSAVE)', down);
  await wait(500);

  const goal2 = `Coordinate a routine continuity drill ${randomUUID().slice(0, 8)}`;
  let outageOk = false;
  let outageDetail = '';
  const t0 = Date.now();
  try {
    const res2 = await fetch(`${GATEWAY}/v1/tasks`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ goal: goal2, input: {}, priority: 'normal' }),
      // The whole point: with Redis DOWN the gateway must still answer fast.
      signal: AbortSignal.timeout(15000),
    });
    const body2 = await res2.json();
    const taskId2 = body2?.data?.taskId;
    // Orchestrator must have been reached over HTTP (its own handleTask ran).
    let orchReached = false;
    for (let i = 0; i < 20 && !orchReached; i += 1) {
      await wait(500);
      orchReached = Boolean(await db.collection('agent_runs').findOne({ taskId: taskId2 }));
    }
    const degraded = await db.collection('events').findOne({ taskId: taskId2, type: 'agent.dispatch.degraded' });
    outageOk = res2.ok && orchReached && Boolean(degraded);
    outageDetail = `answered in ${Date.now() - t0}ms, orchestratorReachedViaHttp=${orchReached}, degradedEventRecorded=${Boolean(degraded)}`;
  } catch (e) {
    outageDetail = `gateway did not answer within 15s of Redis dying (${e?.name ?? e}) — enqueue must be time-bounded`;
  }
  record('E2E.6 with Redis down, dispatch degrades to HTTP within the SLA (no hang, degraded event recorded)', outageOk, outageDetail);
  }

  // --- summary + cleanup ----------------------------------------------------
  // Stop the services FIRST and give their in-flight pipeline writes a
  // moment to settle, so dropDatabase() below is final, not raced.
  for (const c of children) c.kill('SIGTERM');
  await wait(1500);
  // E2E_KEEP_DB=1 preserves the disposable DB for post-mortem inspection.
  if (process.env.E2E_KEEP_DB !== '1') await db.dropDatabase().catch(() => undefined);
  await closeMongo().catch(() => undefined);

  const failed = results.filter((r) => !r.pass);
  console.log('');
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.error('FAIL — one or more E2E checks did not pass.');
    process.exitCode = 1;
  } else {
    console.log('PASS — service-tier E2E verification of the K1 queue dispatch path completed successfully.');
    process.exitCode = 0;
  }
}

main()
  .catch((err) => {
    console.error('FAIL:', err?.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const c of children) c.kill('SIGTERM');
    // Give SIGTERM a moment, then make sure nothing lingers.
    setTimeout(() => {
      for (const c of children) c.kill('SIGKILL');
      process.exit(process.exitCode ?? 0);
    }, 1500).unref();
  });
