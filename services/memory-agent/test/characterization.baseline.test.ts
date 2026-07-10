/**
 * K1 Consolidation Prep Batch 2A (D-172) — baseline characterization of
 * this service's CURRENT, pre-consolidation behavior. This is the
 * equivalence oracle: services/aos-agent-runtime's own test suite re-runs
 * these exact assertions against the consolidated build and must match.
 *
 * In-process only: app.inject() (no real port bound), a fake Mongo
 * supporting insertOne/findOne/updateOne (the only operations this
 * service's call chain uses), forceFallback not needed (no LLM call in
 * this handler), no network, no secrets required to run this suite.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Db } from 'mongodb';
import { setTestDb, EventPublisher } from '@factory/shared';
import { buildMemoryAgentService, manifest } from '../src/server.js';

const INTERNAL_TOKEN = 'test-internal-token';

/** Fake Mongo: insertOne/findOne/updateOne($set/$inc/$addToSet) — what this handler's call chain uses. */
function createFakeDb() {
  const store = new Map<string, Record<string, unknown>[]>();
  const fakeCollection = (name: string) => ({
    insertOne: async (doc: Record<string, unknown>) => {
      const arr = store.get(name) ?? [];
      arr.push(doc);
      store.set(name, arr);
      return { acknowledged: true, insertedId: doc._id ?? 'fake-id' };
    },
    findOne: async (filter: Record<string, unknown>) => {
      const arr = store.get(name) ?? [];
      const [key, val] = Object.entries(filter)[0] ?? [];
      return arr.find((d) => key !== undefined && d[key] === val) ?? null;
    },
    updateOne: async (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown>; $inc?: Record<string, number>; $addToSet?: Record<string, unknown> },
    ) => {
      const arr = store.get(name) ?? [];
      const [key, val] = Object.entries(filter)[0] ?? [];
      const doc = arr.find((d) => key !== undefined && d[key] === val);
      if (doc) {
        if (update.$set) Object.assign(doc, update.$set);
        if (update.$inc) {
          for (const [k, v] of Object.entries(update.$inc)) doc[k] = ((doc[k] as number) ?? 0) + v;
        }
        if (update.$addToSet) {
          for (const [k, v] of Object.entries(update.$addToSet)) {
            const cur = (doc[k] as unknown[]) ?? [];
            if (!cur.includes(v)) doc[k] = [...cur, v];
          }
        }
      }
      return { acknowledged: true, matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    },
    createIndex: async () => 'ok',
  });
  const db = { collection: (name: string) => fakeCollection(name) } as unknown as Db;
  return { db, writes: (name: string) => store.get(name) ?? [] };
}

async function buildTestApp() {
  const { db, writes } = createFakeDb();
  setTestDb(db);
  const service = await buildMemoryAgentService({
    SERVICE_PORT: 0,
    FACTORY_INTERNAL_TOKEN: INTERNAL_TOKEN,
    EVENT_BUS_URL: '',
  });
  return { app: service.app, writes };
}

describe('memory-agent baseline characterization', () => {
  let publishSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    publishSpy = vi.spyOn(EventPublisher.prototype, 'publish').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /health returns ok + this service id', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', serviceId: 'memory-agent' });
  });

  it('GET /.factory/manifest returns this service\'s static manifest', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/.factory/manifest' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.serviceId).toBe('memory-agent');
    expect(body.data.domain).toContain('memory');
  });

  it('GET /.factory/status returns 200 with this serviceId', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/.factory/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.serviceId).toBe('memory-agent');
  });

  it('GET /.factory/capabilities returns this manifest\'s capability list', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/.factory/capabilities' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.capabilities).toEqual(manifest.capabilities);
  });

  it('POST /.factory/task with no token -> 401 error envelope', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/.factory/task', payload: { goal: 'remember a thing' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().ok).toBe(false);
  });

  it('POST /.factory/task with an invalid token -> 401 error envelope', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/.factory/task',
      headers: { 'x-factory-internal-token': 'wrong-token' },
      payload: { goal: 'remember a thing' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().ok).toBe(false);
  });

  it('POST /.factory/task with a missing goal -> 400 error envelope', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/.factory/task',
      headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
  });

  it('POST /.factory/task without a skill key writes only a memory, no skill; publishes started/written/finished', async () => {
    const { app, writes } = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/.factory/task',
      headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
      payload: { taskId: 'task-1', goal: 'summarize this task', input: {} },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.accepted).toBe(true);
    expect(body.data.memoryId).toMatch(/^mem_/);
    expect(body.data.skillId).toBeNull();

    expect(writes('memories')).toHaveLength(1);
    expect(writes('skills')).toHaveLength(0);
    expect(writes('agent_runs')).toHaveLength(1);

    const publishedTypes = publishSpy.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(publishedTypes).toEqual(['agent.run.started', 'memory.written', 'agent.run.finished']);
  });

  it('POST /.factory/task with a new skill key inserts a Skill and publishes skill.created', async () => {
    const { app, writes } = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/.factory/task',
      headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
      payload: { taskId: 'task-2', goal: 'build a new capability', input: { skill: 'new_capability' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.skillId).toBe('skill_new_capability');

    expect(writes('skills')).toHaveLength(1);
    expect(writes('skills')[0].usageCount).toBe(1);

    const publishedTypes = publishSpy.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(publishedTypes).toEqual(['agent.run.started', 'memory.written', 'skill.created', 'agent.run.finished']);
  });

  it('POST /.factory/task with an EXISTING skill key reinforces it ($inc usageCount, $addToSet relatedMemories) and publishes skill.updated', async () => {
    const { app, writes } = await buildTestApp();
    await app.inject({
      method: 'POST', url: '/.factory/task',
      headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
      payload: { taskId: 'task-3', goal: 'build a new capability', input: { skill: 'repeat_capability' } },
    });
    const res = await app.inject({
      method: 'POST', url: '/.factory/task',
      headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
      payload: { taskId: 'task-4', goal: 'build the same capability again', input: { skill: 'repeat_capability' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.skillId).toBe('skill_repeat_capability');

    expect(writes('skills')).toHaveLength(1);
    expect(writes('skills')[0].usageCount).toBe(2);
    expect((writes('skills')[0].relatedMemories as string[]).length).toBe(2);

    // Both requests ran against the same spy (first creates the skill, second
    // reinforces it) — assert the full 8-event sequence across both.
    const publishedTypes = publishSpy.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(publishedTypes).toEqual([
      'agent.run.started', 'memory.written', 'skill.created', 'agent.run.finished',
      'agent.run.started', 'memory.written', 'skill.updated', 'agent.run.finished',
    ]);
  });
});
