/**
 * K1 BullMQ Producer Adoption (D-174) — `dispatchViaQueueOrHttp` contract.
 *
 * No real Redis/BullMQ here: the queue-`enabled` paths fake
 * `AgentTaskQueueClient.enqueue()` directly (the only genuinely
 * un-fakeable-without-real-infra boundary is the BullMQ transport itself —
 * see `queue.bullmq-integration.contract.test.ts` for that proof against a
 * real Redis). Everything downstream of enqueue() — `waitForJobRun`'s Mongo
 * polling, the `degradeToHttp` branch, the AGENT_DISPATCH_DEGRADED publish —
 * runs for real against a fake Mongo, so this is a genuine integration test
 * of the dispatch/index.ts + queue/index.ts boundary, not just a mock check.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Db } from 'mongodb';
import { setTestDb } from '../src/db/index.js';
import { dispatchViaQueueOrHttp } from '../src/dispatch/index.js';
import { AgentTaskQueueClient, type AgentJobRun, type EnqueueResult } from '../src/queue/index.js';
import type { PeerDispatchResult } from '../src/discovery/index.js';

/** Same minimal fake Mongo shape used by queue.contract.test.ts. */
function createFakeDb() {
  const store = new Map<string, Record<string, unknown>[]>();
  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>): boolean =>
    Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$in' in (v as Record<string, unknown>)) return ((v as { $in: unknown[] }).$in).includes(doc[k]);
      if (v && typeof v === 'object' && '$nin' in (v as Record<string, unknown>)) return !((v as { $nin: unknown[] }).$nin).includes(doc[k]);
      return doc[k] === v;
    });
  const fakeCollection = (name: string) => ({
    insertOne: async (doc: Record<string, unknown>) => { const a = store.get(name) ?? []; a.push(doc); store.set(name, a); return { acknowledged: true }; },
    findOne: async (filter: Record<string, unknown>) => (store.get(name) ?? []).find((d) => matches(d, filter)) ?? null,
    findOneAndUpdate: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
      const doc = (store.get(name) ?? []).find((d) => matches(d, filter));
      if (!doc) return null;
      if (update.$set) Object.assign(doc, update.$set);
      return { ...doc };
    },
    updateOne: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
      const doc = (store.get(name) ?? []).find((d) => matches(d, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { acknowledged: true };
    },
    find: (filter: Record<string, unknown>) => ({ sort: () => ({ toArray: async () => (store.get(name) ?? []).filter((d) => matches(d, filter)) }) }),
  });
  return { db: { collection: (name: string) => fakeCollection(name) } as unknown as Db, store };
}

/** Fake AgentTaskQueueClient — only `.enabled`/`.enqueue()` are ever touched
 *  by dispatchViaQueueOrHttp, so this stands in without needing a real Redis
 *  connection. Cast through `unknown` because the real class has private
 *  fields (connection/queues/etc.) that make it nominally, not structurally,
 *  typed — a deliberate, narrow test-only cast. */
function fakeQueueClient(enqueueImpl: (serviceId: string, body: unknown) => Promise<EnqueueResult>): AgentTaskQueueClient {
  return { enabled: true, enqueue: vi.fn(enqueueImpl) } as unknown as AgentTaskQueueClient;
}

const body = { taskId: 'task-1', goal: 'do the thing', input: {}, priority: 'normal' as const };
const httpOk: PeerDispatchResult = { ok: true, status: 200, data: { via: 'http' } };

describe('dispatchViaQueueOrHttp — mode=http (the default, byte-identical to pre-D-174)', () => {
  it('always calls httpDispatch and never touches queueClient, even if one is provided', async () => {
    const httpDispatch = vi.fn().mockResolvedValue(httpOk);
    const queueClient = fakeQueueClient(async () => ({ enqueued: true, duplicate: false, jobRunId: 'jr_1', bullJobId: 'b1' }));
    const out = await dispatchViaQueueOrHttp({ serviceId: 'architect-agent', body, mode: 'http', queueClient, httpDispatch });
    expect(out).toEqual({ ...httpOk, dispatchMode: 'http' });
    expect(httpDispatch).toHaveBeenCalledTimes(1);
    expect(queueClient.enqueue).not.toHaveBeenCalled();
  });
});

describe('dispatchViaQueueOrHttp — queueClient is null (Redis not configured for this process at all)', () => {
  it('falls back to HTTP silently — no AGENT_DISPATCH_DEGRADED, this is not a failure', async () => {
    const httpDispatch = vi.fn().mockResolvedValue(httpOk);
    const publish = vi.fn().mockResolvedValue(true);
    const out = await dispatchViaQueueOrHttp({ serviceId: 'architect-agent', body, mode: 'queue_with_http_fallback', queueClient: null, httpDispatch, publish });
    expect(out.dispatchMode).toBe('http');
    expect(publish).not.toHaveBeenCalled();
  });

  it('queue_only with no client fails loudly instead of silently acting like http', async () => {
    const httpDispatch = vi.fn().mockResolvedValue(httpOk);
    const out = await dispatchViaQueueOrHttp({ serviceId: 'architect-agent', body, mode: 'queue_only', queueClient: null, httpDispatch });
    expect(out.ok).toBe(false);
    expect(httpDispatch).not.toHaveBeenCalled();
  });
});

describe('dispatchViaQueueOrHttp — queueClient exists but disabled (REDIS_URL unset)', () => {
  it('queue_with_http_fallback degrades to HTTP AND publishes AGENT_DISPATCH_DEGRADED', async () => {
    const httpDispatch = vi.fn().mockResolvedValue(httpOk);
    const publish = vi.fn().mockResolvedValue(true);
    const disabledClient = new AgentTaskQueueClient({ redisUrl: '' });
    expect(disabledClient.enabled).toBe(false);
    const out = await dispatchViaQueueOrHttp({ serviceId: 'architect-agent', body, mode: 'queue_with_http_fallback', queueClient: disabledClient, httpDispatch, publish });
    expect(out).toEqual({ ...httpOk, dispatchMode: 'http_fallback' });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.dispatch.degraded', payload: expect.objectContaining({ reason: 'redis_disabled' }) }));
  });

  it('queue_only fails without ever calling httpDispatch', async () => {
    const httpDispatch = vi.fn().mockResolvedValue(httpOk);
    const disabledClient = new AgentTaskQueueClient({ redisUrl: '' });
    const out = await dispatchViaQueueOrHttp({ serviceId: 'architect-agent', body, mode: 'queue_only', queueClient: disabledClient, httpDispatch });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('redis_disabled');
    expect(httpDispatch).not.toHaveBeenCalled();
  });
});

describe('dispatchViaQueueOrHttp — queue enabled, fire-and-forget (no waitForCompletion)', () => {
  it('returns 202/accepted immediately once enqueued, never calls httpDispatch', async () => {
    setTestDb(createFakeDb().db);
    const httpDispatch = vi.fn().mockResolvedValue(httpOk);
    const queueClient = fakeQueueClient(async () => ({ enqueued: true, duplicate: false, jobRunId: 'jr_ff', bullJobId: 'b_ff' }));
    const out = await dispatchViaQueueOrHttp({ serviceId: 'orchestrator-agent', body, mode: 'queue_with_http_fallback', queueClient, httpDispatch });
    expect(out.ok).toBe(true);
    expect(out.dispatchMode).toBe('queue');
    expect(out.jobRunId).toBe('jr_ff');
    expect(httpDispatch).not.toHaveBeenCalled();
  });

  it('a duplicate (idempotent) enqueue is reported as ok:true, not an error', async () => {
    setTestDb(createFakeDb().db);
    const queueClient = fakeQueueClient(async () => ({ enqueued: false, duplicate: true, jobRunId: 'jr_dup', bullJobId: null }));
    const out = await dispatchViaQueueOrHttp({ serviceId: 'orchestrator-agent', body, mode: 'queue_with_http_fallback', queueClient, httpDispatch: vi.fn() });
    expect(out.ok).toBe(true);
    expect((out.data as { duplicate: boolean }).duplicate).toBe(true);
  });

  it('an enqueue failure (e.g. transient Redis error surfaced by the client) degrades to HTTP + publishes', async () => {
    setTestDb(createFakeDb().db);
    const publish = vi.fn().mockResolvedValue(true);
    const httpDispatch = vi.fn().mockResolvedValue(httpOk);
    const queueClient = fakeQueueClient(async () => ({ enqueued: false, duplicate: false, jobRunId: null, bullJobId: null, reason: 'redis_add_failed' }));
    const out = await dispatchViaQueueOrHttp({ serviceId: 'orchestrator-agent', body, mode: 'queue_with_http_fallback', queueClient, httpDispatch, publish });
    expect(out.dispatchMode).toBe('http_fallback');
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ reason: 'redis_add_failed' }) }));
  });

  it('an exception thrown by enqueue() degrades to HTTP rather than propagating', async () => {
    setTestDb(createFakeDb().db);
    const httpDispatch = vi.fn().mockResolvedValue(httpOk);
    const queueClient = fakeQueueClient(async () => { throw new Error('connection reset'); });
    const out = await dispatchViaQueueOrHttp({ serviceId: 'orchestrator-agent', body, mode: 'queue_with_http_fallback', queueClient, httpDispatch });
    expect(out.dispatchMode).toBe('http_fallback');
    expect(httpDispatch).toHaveBeenCalledTimes(1);
  });
});

describe('dispatchViaQueueOrHttp — waitForCompletion (synchronous-style dispatch, e.g. orchestrator→architect-agent)', () => {
  it('polls Mongo until the job run succeeds and returns its result as `data`', async () => {
    const { db, store } = createFakeDb();
    setTestDb(db);
    const jobRunId = 'jr_wait_ok';
    const queueClient = fakeQueueClient(async () => ({ enqueued: true, duplicate: false, jobRunId, bullJobId: 'b1' }));
    const rows = store.get('agent_job_runs') ?? [];
    rows.push({ jobRunId, taskId: 'task-1', serviceId: 'architect-agent', status: 'queued', result: null } as unknown as AgentJobRun);
    store.set('agent_job_runs', rows);
    // Flip to succeeded shortly after — proves this is real polling, not a first-read shortcut.
    setTimeout(() => { (rows[0] as Record<string, unknown>).status = 'succeeded'; (rows[0] as Record<string, unknown>).result = { plan: { planId: 'p1' } }; }, 30);

    const out = await dispatchViaQueueOrHttp<{ plan?: { planId: string } }>({
      serviceId: 'architect-agent', body, mode: 'queue_with_http_fallback', queueClient,
      httpDispatch: vi.fn(), waitForCompletion: { timeoutMs: 2000, pollMs: 10 },
    });
    expect(out.ok).toBe(true);
    expect(out.dispatchMode).toBe('queue');
    expect(out.data?.plan?.planId).toBe('p1');
  });

  it('a dead-lettered job run is reported as ok:false with the last error, not degraded to HTTP', async () => {
    const { db, store } = createFakeDb();
    setTestDb(db);
    const jobRunId = 'jr_wait_dlq';
    const queueClient = fakeQueueClient(async () => ({ enqueued: true, duplicate: false, jobRunId, bullJobId: 'b1' }));
    store.set('agent_job_runs', [{ jobRunId, taskId: 'task-1', serviceId: 'architect-agent', status: 'dead_lettered', lastError: 'boom', result: null } as unknown as AgentJobRun]);

    const httpDispatch = vi.fn();
    const out = await dispatchViaQueueOrHttp({
      serviceId: 'architect-agent', body, mode: 'queue_with_http_fallback', queueClient,
      httpDispatch, waitForCompletion: { timeoutMs: 500, pollMs: 10 },
    });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('boom');
    expect(out.dispatchMode).toBe('queue');
    expect(httpDispatch).not.toHaveBeenCalled(); // a real job outcome, not a queue-path failure — no HTTP fallback
  });

  it('a job that never reaches a terminal state before the timeout degrades to HTTP', async () => {
    const { db, store } = createFakeDb();
    setTestDb(db);
    const jobRunId = 'jr_wait_timeout';
    const queueClient = fakeQueueClient(async () => ({ enqueued: true, duplicate: false, jobRunId, bullJobId: 'b1' }));
    store.set('agent_job_runs', [{ jobRunId, taskId: 'task-1', serviceId: 'architect-agent', status: 'running', result: null } as unknown as AgentJobRun]);

    const publish = vi.fn().mockResolvedValue(true);
    const httpDispatch = vi.fn().mockResolvedValue(httpOk);
    const out = await dispatchViaQueueOrHttp({
      serviceId: 'architect-agent', body, mode: 'queue_with_http_fallback', queueClient,
      httpDispatch, publish, waitForCompletion: { timeoutMs: 60, pollMs: 15 },
    });
    expect(out.dispatchMode).toBe('http_fallback');
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ reason: 'job_run_wait_timeout' }) }));
  }, 2000);
});
