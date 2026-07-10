/**
 * K1 Consolidation Prep Batch 2A (D-172) — baseline characterization of
 * this service's CURRENT, pre-consolidation behavior. This is the
 * equivalence oracle: services/aos-agent-runtime's own test suite re-runs
 * these exact assertions against the consolidated build and must match.
 *
 * In-process only: app.inject() (no real port bound), a fake Mongo
 * supporting insertOne/insertMany (the only operations this handler's call
 * chain uses), and forceFallback:true on every task request so the
 * deterministic (no real LLM call, no API keys, no TAVILY_API_KEY) path is
 * exercised — reproducible, no network, no secrets required to run this
 * suite.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Db } from 'mongodb';
import { setTestDb, EventPublisher } from '@factory/shared';
import { buildInternetResearchServiceService, manifest } from '../src/server.js';

const INTERNAL_TOKEN = 'test-internal-token';

/** Fake Mongo: insertOne + insertMany + updateOne (startAgentRun/finishAgentRun use insertOne then updateOne on agent_runs). */
function createFakeDb() {
  const store = new Map<string, Record<string, unknown>[]>();
  const fakeCollection = (name: string) => ({
    insertOne: async (doc: Record<string, unknown>) => {
      const arr = store.get(name) ?? [];
      arr.push(doc);
      store.set(name, arr);
      return { acknowledged: true, insertedId: doc._id ?? 'fake-id' };
    },
    insertMany: async (docs: Record<string, unknown>[]) => {
      const arr = store.get(name) ?? [];
      arr.push(...docs);
      store.set(name, arr);
      return { acknowledged: true, insertedCount: docs.length };
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
  const { db, writes } = createFakeDb();
  setTestDb(db);
  const service = await buildInternetResearchServiceService({
    SERVICE_PORT: 0,
    FACTORY_INTERNAL_TOKEN: INTERNAL_TOKEN,
    EVENT_BUS_URL: '',
  });
  return { app: service.app, writes };
}

describe('internet-research-service baseline characterization', () => {
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
    expect(res.json()).toEqual({ status: 'ok', serviceId: 'internet-research-service' });
  });

  it('GET /.factory/manifest returns this service\'s static manifest', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/.factory/manifest' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.serviceId).toBe('internet-research-service');
    expect(body.data.domain).toContain('research');
  });

  it('GET /.factory/status returns 200 with this serviceId', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/.factory/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.serviceId).toBe('internet-research-service');
  });

  it('GET /.factory/capabilities returns this manifest\'s capability list', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/.factory/capabilities' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.capabilities).toEqual(manifest.capabilities);
  });

  it('POST /.factory/task with no token -> 401 error envelope', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/.factory/task', payload: { goal: 'research a thing' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().ok).toBe(false);
  });

  it('POST /.factory/task with an invalid token -> 401 error envelope', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/.factory/task',
      headers: { 'x-factory-internal-token': 'wrong-token' },
      payload: { goal: 'research a thing' },
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

  it('POST /.factory/task (forceFallback) writes traces/cost/run/report/evidence and publishes started/research.completed', async () => {
    const { app, writes } = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/.factory/task',
      headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
      payload: { taskId: 'task-1', goal: 'securing autonomous-agent dashboards', input: { forceFallback: true } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.accepted).toBe(true);
    expect(body.data.research.mode).toBe('fallback');
    expect(body.data.research.sourceMode).toBe('curated_fallback');

    expect(writes('llm_traces')).toHaveLength(1);
    expect(writes('llm_cost_records')).toHaveLength(1);
    expect(writes('research_runs')).toHaveLength(1);
    expect(writes('research_reports')).toHaveLength(1);
    expect(writes('evidence_records')).toHaveLength(1);
    // research_sources is only written when sources.length > 0 — self-consistent
    // with the reported sourceCount either way (0 or curated-topic sources).
    expect(writes('research_sources')).toHaveLength(body.data.research.sourceCount);

    const publishedTypes = publishSpy.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(publishedTypes).toEqual(['agent.run.started', 'intel.research.completed']);
  });
});
