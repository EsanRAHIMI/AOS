/**
 * K1 Consolidation Prep Batch 2A (D-172) — baseline characterization of
 * this service's CURRENT, pre-consolidation behavior. This is the
 * equivalence oracle: services/aos-agent-runtime's own test suite re-runs
 * these exact assertions against the consolidated build and must match.
 *
 * In-process only: app.inject() (no real port bound), a fake Mongo
 * supporting findOne/updateOne(upsert)/find (the only operations this
 * service's call chain uses), no real network, no secrets required to run
 * this suite.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Db } from 'mongodb';
import { setTestDb, EventPublisher } from '@factory/shared';
import { buildDocumentationServiceService, manifest, type DocRecord } from '../src/server.js';

const INTERNAL_TOKEN = 'test-internal-token';

/** Fake Mongo: findOne/updateOne(upsert)/find(sort+toArray) — what this service's call chain uses. */
function createFakeDb() {
  const store = new Map<string, Record<string, unknown>[]>();
  const fakeCollection = (name: string) => ({
    findOne: async (filter: Record<string, unknown>) => {
      const arr = store.get(name) ?? [];
      const [key, val] = Object.entries(filter)[0] ?? [];
      return arr.find((d) => key !== undefined && d[key] === val) ?? null;
    },
    updateOne: async (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
      opts?: { upsert?: boolean },
    ) => {
      const arr = store.get(name) ?? [];
      const [key, val] = Object.entries(filter)[0] ?? [];
      let doc = arr.find((d) => key !== undefined && d[key] === val);
      if (!doc && opts?.upsert) {
        doc = { ...(update.$setOnInsert ?? {}) };
        arr.push(doc);
        store.set(name, arr);
      }
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { acknowledged: true, matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    },
    find: (_filter: Record<string, unknown>, _opts?: unknown) => {
      const arr = [...(store.get(name) ?? [])];
      return {
        sort: () => ({
          toArray: async () => arr,
        }),
      };
    },
    createIndex: async () => 'ok',
  });
  const db = { collection: (name: string) => fakeCollection(name) } as unknown as Db;
  return { db, all: (name: string) => (store.get(name) ?? []) as unknown as DocRecord[] };
}

async function buildTestApp() {
  const { db, all } = createFakeDb();
  setTestDb(db);
  const service = await buildDocumentationServiceService({
    SERVICE_PORT: 0,
    FACTORY_INTERNAL_TOKEN: INTERNAL_TOKEN,
    EVENT_BUS_URL: '',
  });
  return { app: service.app, all };
}

describe('documentation-service baseline characterization', () => {
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
    expect(res.json()).toEqual({ status: 'ok', serviceId: 'documentation-service' });
  });

  it('GET /.factory/manifest returns this service\'s static manifest', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/.factory/manifest' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.serviceId).toBe('documentation-service');
    expect(body.data.domain).toContain('docs');
  });

  it('GET /.factory/status returns 200 with this serviceId', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/.factory/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.serviceId).toBe('documentation-service');
  });

  it('GET /.factory/capabilities returns this manifest\'s capability list', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/.factory/capabilities' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.capabilities).toEqual(manifest.capabilities);
  });

  it('POST /.factory/task with no token -> 401 error envelope', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/.factory/task', payload: { goal: 'document a thing' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().ok).toBe(false);
  });

  it('POST /.factory/task with an invalid token -> 401 error envelope', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/.factory/task',
      headers: { 'x-factory-internal-token': 'wrong-token' },
      payload: { goal: 'document a thing' },
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

  it('POST /.factory/task upserts phase-log, decision-log, and a per-task doc; publishes DOC_UPDATED x3', async () => {
    const { app, all } = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/.factory/task',
      headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
      payload: { taskId: 'task-1', goal: 'document the pipeline', input: { summary: 'pipeline documented' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.accepted).toBe(true);
    expect(body.data.updated).toEqual(['phase-log', 'decision-log', 'task-task-1']);
    expect(body.data.versions).toEqual([1, 1, 1]);

    const slugs = all('documents').map((d) => d.slug);
    expect(slugs).toEqual(expect.arrayContaining(['phase-log', 'decision-log', 'task-task-1']));

    const publishedTypes = publishSpy.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(publishedTypes).toEqual(['doc.updated', 'doc.updated', 'doc.updated']);
  });

  it('POST /docs with no token -> 401', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/docs', payload: { slug: 'x', title: 'X', category: 'general', body: 'body' } });
    expect(res.statusCode).toBe(401);
  });

  it('POST /docs with missing required fields -> 400', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/docs',
      headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
      payload: { slug: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /docs then GET /docs/:slug round-trips the document with version 1', async () => {
    const { app } = await buildTestApp();
    const post = await app.inject({
      method: 'POST', url: '/docs',
      headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
      payload: { slug: 'my-doc', title: 'My Doc', category: 'general', body: 'hello' },
    });
    expect(post.statusCode).toBe(200);
    expect(post.json().data).toEqual({ slug: 'my-doc', version: 1 });

    const get = await app.inject({
      method: 'GET', url: '/docs/my-doc',
      headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.slug).toBe('my-doc');
    expect(get.json().data.version).toBe(1);
  });

  it('GET /docs/:slug for an unknown slug -> 404', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: 'GET', url: '/docs/does-not-exist',
      headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /docs lists documents (no token -> 401, with token -> array)', async () => {
    const { app } = await buildTestApp();
    const unauth = await app.inject({ method: 'GET', url: '/docs' });
    expect(unauth.statusCode).toBe(401);

    await app.inject({
      method: 'POST', url: '/docs',
      headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
      payload: { slug: 'listed-doc', title: 'Listed', category: 'general', body: 'hi' },
    });
    const res = await app.inject({ method: 'GET', url: '/docs', headers: { 'x-factory-internal-token': INTERNAL_TOKEN } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
    expect(res.json().data.some((d: { slug: string }) => d.slug === 'listed-doc')).toBe(true);
  });
});
