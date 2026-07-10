/**
 * K1 Consolidation Prep (D-168) — baseline characterization of this
 * service's CURRENT, pre-consolidation behavior. This is the equivalence
 * oracle: services/aos-agent-runtime's own test suite re-runs these exact
 * assertions against the consolidated build and must match.
 *
 * In-process only: app.inject() (no real port bound), a minimal fake Mongo
 * (insertOne/updateOne only — the only two operations this handler's call
 * chain uses), and forceFallback:true on every task request so the
 * deterministic (no real LLM call, no API keys needed) path is exercised —
 * reproducible, no network, no secrets required to run this suite.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Db } from 'mongodb';
import { setTestDb, EventPublisher } from '@factory/shared';
import { buildQaAgentService, manifest } from '../src/server.js';

const INTERNAL_TOKEN = 'test-internal-token';

/** Minimal fake Mongo: only insertOne + updateOne, matching what this handler's call chain actually uses. */
function createMinimalFakeDb() {
  const store = new Map<string, Record<string, unknown>[]>();
  const fakeCollection = (name: string) => ({
    insertOne: async (doc: Record<string, unknown>) => {
      const arr = store.get(name) ?? [];
      arr.push(doc);
      store.set(name, arr);
      return { acknowledged: true, insertedId: doc._id ?? 'fake-id' };
    },
    updateOne: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
      const arr = store.get(name) ?? [];
      const [key, val] = Object.entries(filter)[0] ?? [];
      const doc = arr.find((d) => key !== undefined && d[key] === val);
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { acknowledged: true, matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    },
  });
  const db = { collection: (name: string) => fakeCollection(name) } as unknown as Db;
  return { db, writes: (name: string) => store.get(name) ?? [] };
}

async function buildTestApp() {
  const { db, writes } = createMinimalFakeDb();
  setTestDb(db);
  const service = await buildQaAgentService({
    SERVICE_PORT: 0, // unused — app.inject() never binds a real port
    FACTORY_INTERNAL_TOKEN: INTERNAL_TOKEN,
    EVENT_BUS_URL: '', // no live event bus in tests — publish() short-circuits to false
  });
  return { app: service.app, writes };
}

describe('qa-agent baseline characterization', () => {
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
    expect(res.json()).toEqual({ status: 'ok', serviceId: 'qa-agent' });
  });

  it('GET /.factory/manifest returns this service\'s static manifest', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/.factory/manifest' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.serviceId).toBe('qa-agent');
    expect(body.data.domain).toContain('qa');
  });

  it('GET /.factory/status returns 200 with this serviceId', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/.factory/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.serviceId).toBe('qa-agent');
  });

  it('GET /.factory/capabilities returns this manifest\'s capability list', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/.factory/capabilities' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.capabilities).toEqual(manifest.capabilities);
  });

  it('POST /.factory/task with no token -> 401 error envelope', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/.factory/task', payload: { goal: 'verify acceptance' } });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('unauthorized');
  });

  it('POST /.factory/task with an invalid token -> 401 error envelope', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/.factory/task',
      headers: { 'x-factory-internal-token': 'wrong-token' },
      payload: { goal: 'verify acceptance' },
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

  it('POST /.factory/task (forceFallback) writes traces/cost/evidence/qa_reports/agent_runs and publishes QA_COMPLETED', async () => {
    const { app, writes } = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/.factory/task',
      headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
      payload: {
        taskId: 'task-1', goal: 'verify the retry logic',
        input: { goal: 'verify the retry logic', evidenceSummary: 'research evidence present, plan evidence present, review evidence present', forceFallback: true },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.accepted).toBe(true);
    expect(body.data.qa.mode).toBe('fallback');

    expect(writes('llm_traces')).toHaveLength(1);
    expect(writes('llm_cost_records')).toHaveLength(1);
    expect(writes('evidence_records')).toHaveLength(1);
    expect(writes('qa_reports')).toHaveLength(1);
    expect(writes('agent_runs')).toHaveLength(1);

    const publishedTypes = publishSpy.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(publishedTypes).toEqual(['agent.run.started', 'intel.qa.completed']);
  });
});
