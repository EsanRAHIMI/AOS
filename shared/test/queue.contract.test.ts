/**
 * K1 BullMQ Task Queue (D-173) — pure Mongo state-machine transitions.
 *
 * No BullMQ, no Redis: `enqueueJobRun`/`claimJobRun`/`markRunning`/
 * `markSucceeded`/`markFailed`/`markCancelled` are independently testable
 * against a fake db, proving the state machine and the idempotency/
 * double-claim guards work correctly in isolation from the delivery
 * mechanism. See `queue.bullmq-integration.contract.test.ts` (gated on a
 * real REDIS_URL) for the full BullMQ-backed proof.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Db } from 'mongodb';
import { setTestDb } from '../src/db/index.js';
import {
  enqueueJobRun,
  claimJobRun,
  markRunning,
  markSucceeded,
  markFailed,
  markCancelled,
  getJobRun,
  listDeadLetters,
  defaultIdempotencyKey,
  agentQueueName,
  type AgentJobRun,
} from '../src/queue/index.js';

/** Fake Mongo: insertOne/findOne/findOneAndUpdate/updateOne/find — everything the queue state machine uses. */
function createFakeDb() {
  const store = new Map<string, Record<string, unknown>[]>();
  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>): boolean =>
    Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$in' in (v as Record<string, unknown>)) {
        return ((v as { $in: unknown[] }).$in).includes(doc[k]);
      }
      if (v && typeof v === 'object' && '$nin' in (v as Record<string, unknown>)) {
        return !((v as { $nin: unknown[] }).$nin).includes(doc[k]);
      }
      return doc[k] === v;
    });

  const fakeCollection = (name: string) => ({
    insertOne: async (doc: Record<string, unknown>) => {
      const arr = store.get(name) ?? [];
      arr.push(doc);
      store.set(name, arr);
      return { acknowledged: true, insertedId: 'fake-id' };
    },
    findOne: async (filter: Record<string, unknown>) => {
      const arr = store.get(name) ?? [];
      return arr.find((d) => matches(d, filter)) ?? null;
    },
    findOneAndUpdate: async (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown>; $inc?: Record<string, number> },
    ) => {
      const arr = store.get(name) ?? [];
      const doc = arr.find((d) => matches(d, filter));
      if (!doc) return null;
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] = ((doc[k] as number) ?? 0) + v;
      return { ...doc };
    },
    updateOne: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
      const arr = store.get(name) ?? [];
      const doc = arr.find((d) => matches(d, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { acknowledged: true, matchedCount: doc ? 1 : 0 };
    },
    find: (filter: Record<string, unknown>) => {
      const arr = (store.get(name) ?? []).filter((d) => matches(d, filter));
      return { sort: () => ({ toArray: async () => arr }) };
    },
  });
  const db = { collection: (name: string) => fakeCollection(name) } as unknown as Db;
  return { db, all: (name: string) => (store.get(name) ?? []) as unknown as AgentJobRun[] };
}

describe('agentQueueName / defaultIdempotencyKey', () => {
  it('names one queue per serviceId (no ":" — BullMQ v5 rejects it as its own key separator)', () => {
    expect(agentQueueName('architect-agent')).toBe('agent-tasks.architect-agent');
    expect(agentQueueName('architect-agent')).not.toContain(':');
  });
  it('derives a stable default idempotency key from serviceId+taskId', () => {
    expect(defaultIdempotencyKey('architect-agent', 'task-1')).toBe('architect-agent:task-1');
  });
});

describe('enqueueJobRun', () => {
  it('inserts a new queued AgentJobRun and publishes AGENT_JOB_QUEUED', async () => {
    const { db, all } = createFakeDb();
    setTestDb(db);
    const publish = vi.fn().mockResolvedValue(true);
    const out = await enqueueJobRun({ serviceId: 'memory-agent', taskRequest: { taskId: 'task-1', goal: 'remember', input: {}, priority: 'normal' } }, publish);
    expect(out.duplicate).toBe(false);
    expect(all('agent_job_runs')).toHaveLength(1);
    expect(all('agent_job_runs')[0].status).toBe('queued');
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.job.queued' }));
  });

  it('is idempotent: a second enqueue with the same idempotencyKey while the first is still in flight returns the existing jobRunId, no new row', async () => {
    const { db, all } = createFakeDb();
    setTestDb(db);
    const first = await enqueueJobRun({ serviceId: 'memory-agent', taskRequest: { taskId: 'task-1', goal: 'remember', input: {}, priority: 'normal' }, idempotencyKey: 'fixed-key' });
    const second = await enqueueJobRun({ serviceId: 'memory-agent', taskRequest: { taskId: 'task-1', goal: 'remember', input: {}, priority: 'normal' }, idempotencyKey: 'fixed-key' });
    expect(second.duplicate).toBe(true);
    expect(second.jobRunId).toBe(first.jobRunId);
    expect(all('agent_job_runs')).toHaveLength(1);
  });

  it('a NEW enqueue with the same key after the prior run failed/cancelled is allowed (not treated as duplicate)', async () => {
    const { db } = createFakeDb();
    setTestDb(db);
    const first = await enqueueJobRun({ serviceId: 'memory-agent', taskRequest: { taskId: 'task-1', goal: 'x', input: {}, priority: 'normal' }, idempotencyKey: 'k' });
    await markCancelled(first.jobRunId);
    const second = await enqueueJobRun({ serviceId: 'memory-agent', taskRequest: { taskId: 'task-1', goal: 'x', input: {}, priority: 'normal' }, idempotencyKey: 'k' });
    expect(second.duplicate).toBe(false);
    expect(second.jobRunId).not.toBe(first.jobRunId);
  });
});

describe('claimJobRun — the double-execution guard', () => {
  it('the first claim succeeds and transitions queued -> claimed', async () => {
    const { db } = createFakeDb();
    setTestDb(db);
    const { jobRunId } = await enqueueJobRun({ serviceId: 'memory-agent', taskRequest: { taskId: 't', goal: 'g', input: {}, priority: 'normal' } });
    const claimed = await claimJobRun(jobRunId, 'worker-A');
    expect(claimed?.status).toBe('claimed');
    expect(claimed?.workerInstanceId).toBe('worker-A');
  });

  it('a second claim attempt against the same jobRunId (simulating two worker instances) fails — proves no double execution', async () => {
    const { db } = createFakeDb();
    setTestDb(db);
    const { jobRunId } = await enqueueJobRun({ serviceId: 'memory-agent', taskRequest: { taskId: 't', goal: 'g', input: {}, priority: 'normal' } });
    const claimA = await claimJobRun(jobRunId, 'worker-A');
    const claimB = await claimJobRun(jobRunId, 'worker-B');
    expect(claimA?.workerInstanceId).toBe('worker-A');
    expect(claimB).toBeNull(); // worker-B's attempt is a no-op — it must not re-run the handler
  });

  it('a retrying job CAN be re-claimed (that is the retry path, not a duplicate)', async () => {
    const { db } = createFakeDb();
    setTestDb(db);
    const { jobRunId } = await enqueueJobRun({ serviceId: 'memory-agent', taskRequest: { taskId: 't', goal: 'g', input: {}, priority: 'normal' }, maxAttempts: 3 });
    await claimJobRun(jobRunId, 'worker-A');
    await markFailed(jobRunId, 'transient error', false);
    const reclaim = await claimJobRun(jobRunId, 'worker-B');
    expect(reclaim?.status).toBe('claimed');
  });
});

describe('markRunning / markSucceeded', () => {
  it('running -> succeeded stores the result and publishes AGENT_JOB_SUCCEEDED', async () => {
    const { db } = createFakeDb();
    setTestDb(db);
    const publish = vi.fn().mockResolvedValue(true);
    const { jobRunId } = await enqueueJobRun({ serviceId: 'memory-agent', taskRequest: { taskId: 't', goal: 'g', input: {}, priority: 'normal' } }, publish);
    await claimJobRun(jobRunId, 'worker-A');
    await markRunning(jobRunId, publish);
    await markSucceeded(jobRunId, { memoryId: 'mem_1' }, publish);
    const run = await getJobRun(jobRunId);
    expect(run?.status).toBe('succeeded');
    expect(run?.result).toEqual({ memoryId: 'mem_1' });
    const types = publish.mock.calls.map((c) => c[0].type);
    expect(types).toEqual(['agent.job.queued', 'agent.job.started', 'agent.job.succeeded']);
  });
});

describe('markFailed — retry vs dead-letter', () => {
  it('exhausted:false increments attempts and transitions to retrying', async () => {
    const { db } = createFakeDb();
    setTestDb(db);
    const publish = vi.fn().mockResolvedValue(true);
    const { jobRunId } = await enqueueJobRun({ serviceId: 'memory-agent', taskRequest: { taskId: 't', goal: 'g', input: {}, priority: 'normal' } });
    const out = await markFailed(jobRunId, 'boom', false, publish);
    expect(out.status).toBe('retrying');
    expect(out.attempts).toBe(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.job.retrying' }));
  });

  it('exhausted:true transitions to dead_lettered and is listed by listDeadLetters', async () => {
    const { db } = createFakeDb();
    setTestDb(db);
    const publish = vi.fn().mockResolvedValue(true);
    const { jobRunId } = await enqueueJobRun({ serviceId: 'memory-agent', taskRequest: { taskId: 't', goal: 'g', input: {}, priority: 'normal' } });
    await markFailed(jobRunId, 'attempt 1 failed', false);
    await markFailed(jobRunId, 'attempt 2 failed', false);
    const out = await markFailed(jobRunId, 'final attempt failed', true, publish);
    expect(out.status).toBe('dead_lettered');
    expect(out.attempts).toBe(3);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.job.dead_lettered' }));

    const dead = await listDeadLetters('memory-agent');
    expect(dead).toHaveLength(1);
    expect(dead[0].jobRunId).toBe(jobRunId);
    expect(dead[0].lastError).toBe('final attempt failed');
  });
});

describe('markCancelled', () => {
  it('cancels a queued job and publishes AGENT_JOB_CANCELLED', async () => {
    const { db } = createFakeDb();
    setTestDb(db);
    const publish = vi.fn().mockResolvedValue(true);
    const { jobRunId } = await enqueueJobRun({ serviceId: 'memory-agent', taskRequest: { taskId: 't', goal: 'g', input: {}, priority: 'normal' } });
    const cancelled = await markCancelled(jobRunId, publish);
    expect(cancelled?.status).toBe('cancelled');
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.job.cancelled' }));
  });

  it('does not re-cancel an already-succeeded job', async () => {
    const { db } = createFakeDb();
    setTestDb(db);
    const { jobRunId } = await enqueueJobRun({ serviceId: 'memory-agent', taskRequest: { taskId: 't', goal: 'g', input: {}, priority: 'normal' } });
    await markSucceeded(jobRunId, {});
    const cancelled = await markCancelled(jobRunId);
    expect(cancelled).toBeNull();
    const run = await getJobRun(jobRunId);
    expect(run?.status).toBe('succeeded'); // unchanged
  });
});
