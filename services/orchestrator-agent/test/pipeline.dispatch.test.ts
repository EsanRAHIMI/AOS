/**
 * K1 BullMQ Producer Adoption (D-174) — dispatchPeerTask (pipeline.ts).
 *
 * Proves the WIRING between orchestrator-agent's PipelineArgs and the shared
 * dispatchViaQueueOrHttp helper: that agentQueueClient/dispatchMode/
 * dispatchWaitMs/peer/ctx flow through correctly when called the exact way
 * every migrated pipeline.ts call site calls it (`dispatchPeerTask(args,
 * serviceId, body)`). The branching logic itself (http/queue_with_http_
 * fallback/queue_only, degrade-on-failure, wait-for-completion) is already
 * proven exhaustively in shared/test/dispatch.contract.test.ts — this suite
 * deliberately does not re-prove that, only that orchestrator-agent invokes
 * it correctly.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Db } from 'mongodb';
import { setTestDb, AgentTaskQueueClient, type EnqueueResult, type PeerClient } from '@factory/shared';
import type { ServiceContext } from '@factory/service-kit';
import { dispatchPeerTask, type PipelineArgs } from '../src/pipeline.js';

function createFakeDb(): Db {
  const store = new Map<string, Record<string, unknown>[]>();
  const fakeCollection = (name: string) => ({
    insertOne: async (doc: Record<string, unknown>) => { const a = store.get(name) ?? []; a.push(doc); store.set(name, a); return { acknowledged: true }; },
    findOne: async (filter: Record<string, unknown>) => (store.get(name) ?? []).find((d) => Object.entries(filter).every(([k, v]) => d[k] === v)) ?? null,
    findOneAndUpdate: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
      const doc = (store.get(name) ?? []).find((d) => Object.entries(filter).every(([k, v]) => d[k] === v));
      if (!doc) return null;
      if (update.$set) Object.assign(doc, update.$set);
      return { ...doc };
    },
    updateOne: async () => ({ acknowledged: true }),
    find: () => ({ sort: () => ({ toArray: async () => [] }) }),
  });
  return { collection: (name: string) => fakeCollection(name) } as unknown as Db;
}

function fakePeer(dispatchTaskImpl: (serviceId: string, body: unknown) => Promise<{ ok: boolean; status: number; data?: unknown; error?: string }>): PeerClient {
  return { dispatchTask: vi.fn(dispatchTaskImpl), url: () => 'http://localhost:0' } as unknown as PeerClient;
}

function fakeQueueClient(enqueueImpl: (serviceId: string, body: unknown) => Promise<EnqueueResult>): AgentTaskQueueClient {
  return { enabled: true, enqueue: vi.fn(enqueueImpl) } as unknown as AgentTaskQueueClient;
}

const fakeCtx = { publisher: { publish: vi.fn().mockResolvedValue(true) } } as unknown as ServiceContext;
const body = { taskId: 'task-1', goal: 'design it', input: {}, priority: 'normal' as const };

function baseArgs(overrides: Partial<PipelineArgs> = {}): PipelineArgs {
  return {
    taskId: 'task-1',
    goal: 'design it',
    ctx: fakeCtx,
    peer: fakePeer(async () => ({ ok: true, status: 200, data: { via: 'http' } })),
    agentQueueClient: null,
    dispatchMode: 'http',
    dispatchWaitMs: 5000,
    ...overrides,
  };
}

describe('dispatchPeerTask — AGENT_DISPATCH_MODE=http (default, zero behavior change)', () => {
  it('calls peer.dispatchTask directly, never touches agentQueueClient', async () => {
    const queueClient = fakeQueueClient(async () => ({ enqueued: true, duplicate: false, jobRunId: 'jr_1', bullJobId: 'b1' }));
    const args = baseArgs({ agentQueueClient: queueClient, dispatchMode: 'http' });
    const out = await dispatchPeerTask(args, 'architect-agent', body);
    expect(out.ok).toBe(true);
    expect(out.data).toEqual({ via: 'http' });
    expect(args.peer.dispatchTask).toHaveBeenCalledWith('architect-agent', body);
    expect(queueClient.enqueue).not.toHaveBeenCalled();
  });
});

describe('dispatchPeerTask — AGENT_DISPATCH_MODE=queue_with_http_fallback, queue enabled', () => {
  it('enqueues via agentQueueClient and waits for the job run to reach a terminal state (Mongo-backed)', async () => {
    setTestDb(createFakeDb());
    const jobRunId = 'jr_arch_1';
    const queueClient = fakeQueueClient(async () => ({ enqueued: true, duplicate: false, jobRunId, bullJobId: 'b1' }));
    const args = baseArgs({ agentQueueClient: queueClient, dispatchMode: 'queue_with_http_fallback', dispatchWaitMs: 2000 });

    // Seed the AgentJobRun row dispatchPeerTask's internal waitForJobRun will poll.
    const db = createFakeDb();
    setTestDb(db);
    await db.collection('agent_job_runs').insertOne({ jobRunId, taskId: 'task-1', serviceId: 'architect-agent', status: 'succeeded', result: { plan: { planId: 'p1' } } } as never);

    const out = await dispatchPeerTask<{ plan?: { planId: string } }>(args, 'architect-agent', body);
    expect(out.ok).toBe(true);
    expect(out.data?.plan?.planId).toBe('p1');
    expect(args.peer.dispatchTask).not.toHaveBeenCalled();
  });

  it('degrades to args.peer.dispatchTask (the orchestrator HTTP fallback) when the queue client is disabled', async () => {
    setTestDb(createFakeDb());
    const disabledClient = new AgentTaskQueueClient({ redisUrl: '' });
    const peer = fakePeer(async () => ({ ok: true, status: 200, data: { via: 'http-fallback' } }));
    const args = baseArgs({ agentQueueClient: disabledClient, dispatchMode: 'queue_with_http_fallback', peer });

    const out = await dispatchPeerTask(args, 'memory-agent', body);
    expect(out.ok).toBe(true);
    expect(out.data).toEqual({ via: 'http-fallback' });
    expect(peer.dispatchTask).toHaveBeenCalledWith('memory-agent', body);
    expect(fakeCtx.publisher.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.dispatch.degraded' }));
  });
});
