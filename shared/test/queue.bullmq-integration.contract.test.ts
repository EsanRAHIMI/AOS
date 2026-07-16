/**
 * K1 BullMQ Task Queue (D-173) — real BullMQ/Redis integration proofs.
 *
 * Gated on a real `REDIS_URL` (via `describe.skipIf`): these tests construct
 * REAL `bullmq` `Queue`/`Worker` instances against a real Redis, because the
 * exact guarantee being proven (Redis-lock-based exactly-once delivery
 * across worker instances, real retry/backoff timing, real timeout
 * behavior) is BullMQ's own mechanism — a fake/mock Redis cannot honestly
 * stand in for it. `ioredis-mock` does not reliably implement the Lua
 * scripts BullMQ depends on internally, so faking this tier would produce
 * false confidence, not real proof.
 *
 * Honesty note (see decision-log D-173, D-169, D-171): without a reachable
 * Redis this file SKIPS, not passes. First executed for real on 2026-07-17
 * against Redis 7.4.2 (K1 queue verification session): the run immediately
 * exposed two bugs the fake-db tier could never see — BullMQ v5 rejects
 * queue names AND custom job ids containing ':' — both fixed in
 * shared/src/queue/index.ts (agentQueueName now joins with '.',
 * toBullJobId() sanitizes at the BullMQ boundary). Run with a real
 * `REDIS_URL` set (locally or in CI with a Redis service container) to get
 * the proof `scripts/agent-queue-verify.mjs` also performs at the process
 * level.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Queue } from 'bullmq';
import type { Db } from 'mongodb';
import { setTestDb } from '../src/db/index.js';
import {
  AgentTaskQueueClient,
  createAgentTaskWorker,
  getJobRun,
  agentQueueName,
  type AgentJobRun,
} from '../src/queue/index.js';
import type { TaskRequest } from '../src/schemas/task.js';

const REDIS_URL = process.env.REDIS_URL ?? '';

/** Minimal fake Mongo (job-run tracking only — this suite targets Redis/BullMQ, not Mongo). */
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
    findOneAndUpdate: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown>; $inc?: Record<string, number> }) => {
      const doc = (store.get(name) ?? []).find((d) => matches(d, filter));
      if (!doc) return null;
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] = ((doc[k] as number) ?? 0) + v;
      return { ...doc };
    },
    updateOne: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
      const doc = (store.get(name) ?? []).find((d) => matches(d, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { acknowledged: true };
    },
    find: (filter: Record<string, unknown>) => ({ sort: () => ({ toArray: async () => (store.get(name) ?? []).filter((d) => matches(d, filter)) }) }),
  });
  return { collection: (name: string) => fakeCollection(name) } as unknown as Db;
}

describe.skipIf(!REDIS_URL)('BullMQ integration (real Redis) — D-173', () => {
  let client: AgentTaskQueueClient;

  beforeAll(() => {
    setTestDb(createFakeDb());
    client = new AgentTaskQueueClient({ redisUrl: REDIS_URL, maxAttempts: 3, backoffMs: 100 });
  });

  afterAll(async () => {
    await client.close();
  });

  it('two worker instances processing the same queue never both execute the same job', async () => {
    const executions = new Map<string, number>();
    const handler = async (req: TaskRequest) => {
      const key = req.taskId ?? 'x';
      executions.set(key, (executions.get(key) ?? 0) + 1);
      return { taskId: key, accepted: true };
    };

    const workerA = createAgentTaskWorker({ serviceId: 'test-dup-guard', redisUrl: REDIS_URL, handler, ctx: {}, workerInstanceId: 'A' });
    const workerB = createAgentTaskWorker({ serviceId: 'test-dup-guard', redisUrl: REDIS_URL, handler, ctx: {}, workerInstanceId: 'B' });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => client.enqueue('test-dup-guard', { taskId: `dup-${i}`, goal: 'g', input: {}, priority: 'normal' })),
    );
    expect(results.every((r) => r.enqueued)).toBe(true);

    await new Promise((r) => setTimeout(r, 2000)); // let both workers drain the queue

    for (const [, count] of executions) expect(count).toBe(1); // never double-executed
    expect(executions.size).toBe(10);

    await workerA.close();
    await workerB.close();
  }, 15000);

  it('a handler that fails once then succeeds ends up succeeded, not dead-lettered', async () => {
    let calls = 0;
    const handler = async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
      return { taskId: 'retry-1', accepted: true };
    };
    const worker = createAgentTaskWorker({ serviceId: 'test-retry', redisUrl: REDIS_URL, handler, ctx: {} });
    const { jobRunId } = await client.enqueue('test-retry', { taskId: 'retry-1', goal: 'g', input: {}, priority: 'normal' });
    await new Promise((r) => setTimeout(r, 2000));
    const run = await getJobRun(jobRunId!);
    expect(run?.status).toBe('succeeded');
    expect(calls).toBe(2);
    await worker.close();
  }, 15000);

  it('a handler that always fails is dead-lettered after exhausting attempts', async () => {
    const handler = async () => { throw new Error('always fails'); };
    const worker = createAgentTaskWorker({ serviceId: 'test-dlq', redisUrl: REDIS_URL, handler, ctx: {} });
    const { jobRunId } = await client.enqueue('test-dlq', { taskId: 'dlq-1', goal: 'g', input: {}, priority: 'normal' });
    await new Promise((r) => setTimeout(r, 3000));
    const run = await getJobRun(jobRunId!);
    expect(run?.status).toBe('dead_lettered');
    expect(run?.attempts).toBe(3);
    await worker.close();

    const replay = await client.replayDeadLetter('test-dlq', jobRunId!);
    expect(replay.enqueued).toBe(true);
  }, 15000);

  it('a handler slower than the configured timeout is treated as a failure', async () => {
    const handler = async () => { await new Promise((r) => setTimeout(r, 5000)); return { taskId: 'slow-1', accepted: true }; };
    const worker = createAgentTaskWorker({ serviceId: 'test-timeout', redisUrl: REDIS_URL, handler, ctx: {}, timeoutMs: 300 });
    const { jobRunId } = await client.enqueue('test-timeout', { taskId: 'slow-1', goal: 'g', input: {}, priority: 'normal' });
    await new Promise((r) => setTimeout(r, 4000));
    const run = await getJobRun(jobRunId!);
    expect(['retrying', 'dead_lettered']).toContain(run?.status);
    await worker.close();
  }, 15000);

  it('enqueue with the same idempotencyKey while the first job is still in the queue is a no-op', async () => {
    const first = await client.enqueue('test-idempotency', { taskId: 'idem-1', goal: 'g', input: {}, priority: 'normal' }, { idempotencyKey: 'fixed' });
    const second = await client.enqueue('test-idempotency', { taskId: 'idem-1', goal: 'g', input: {}, priority: 'normal' }, { idempotencyKey: 'fixed' });
    expect(first.enqueued).toBe(true);
    expect(second.enqueued).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.jobRunId).toBe(first.jobRunId);

    // Also confirm the queue itself only has one job for this key.
    const q = new Queue(agentQueueName('test-idempotency'), { connection: { url: REDIS_URL } as never });
    const job = await q.getJob('fixed');
    expect(job).toBeTruthy();
    await q.close();
  }, 15000);
});
