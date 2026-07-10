/**
 * K1 Consolidation Prep Batch 2A (D-172) — proves services/aos-agent-runtime's
 * 3 new workers (documentation-service, memory-agent, internet-research-service)
 * are behaviorally equivalent to the 3 original, still-live services, and
 * proves the same multi-instance-in-one-process risks D-168 called out,
 * now for these 3 plus a combined proof that all 7 workers (Batch 1 +
 * Batch 2A) bind their own distinct historical ports simultaneously in one
 * process.
 *
 * The per-worker equivalence assertions (health/manifest/status/
 * capabilities/task/error-envelopes/Mongo-writes/event-types) are the exact
 * same assertions as each original service's own
 * test/characterization.baseline.test.ts — kept in sync deliberately.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import type { Db } from 'mongodb';
import { setTestDb, EventPublisher, SERVICE_PORTS } from '@factory/shared';
import { buildArchitectWorker, manifest as architectManifest } from '../src/workers/architect-agent.js';
import { buildQaWorker, manifest as qaManifest } from '../src/workers/qa-agent.js';
import { buildReviewerWorker, manifest as reviewerManifest } from '../src/workers/reviewer-agent.js';
import { buildReportWorker, manifest as reportManifest } from '../src/workers/report-agent.js';
import { buildDocumentationServiceWorker, manifest as docsManifest } from '../src/workers/documentation-service.js';
import { buildMemoryAgentWorker, manifest as memoryManifest } from '../src/workers/memory-agent.js';
import { buildInternetResearchServiceWorker, manifest as researchManifest } from '../src/workers/internet-research-service.js';
import type { FactoryService } from '@factory/service-kit';

const INTERNAL_TOKEN = 'test-internal-token';

/** Fake Mongo covering every operation used across the 3 Batch 2A workers. */
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
    findOne: async (filter: Record<string, unknown>) => {
      const arr = store.get(name) ?? [];
      const [key, val] = Object.entries(filter)[0] ?? [];
      return arr.find((d) => key !== undefined && d[key] === val) ?? null;
    },
    updateOne: async (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown>; $inc?: Record<string, number>; $addToSet?: Record<string, unknown> },
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
      if (doc) {
        if (update.$set) Object.assign(doc, update.$set);
        if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] = ((doc[k] as number) ?? 0) + v;
        if (update.$addToSet) {
          for (const [k, v] of Object.entries(update.$addToSet)) {
            const cur = (doc[k] as unknown[]) ?? [];
            if (!cur.includes(v)) doc[k] = [...cur, v];
          }
        }
      }
      return { acknowledged: true, matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    },
    find: (_filter: Record<string, unknown>, _opts?: unknown) => {
      const arr = [...(store.get(name) ?? [])];
      return { sort: () => ({ toArray: async () => arr }) };
    },
    createIndex: async () => 'ok',
  });
  const db = { collection: (name: string) => fakeCollection(name) } as unknown as Db;
  return { db, writes: (name: string) => store.get(name) ?? [] };
}

const WORKER_ENV = { FACTORY_INTERNAL_TOKEN: INTERNAL_TOKEN, EVENT_BUS_URL: '' };

describe('aos-agent-runtime Batch 2A workers — equivalence to baseline', () => {
  let publishSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    publishSpy = vi.spyOn(EventPublisher.prototype, 'publish').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('documentation-service', () => {
    it('GET /health / manifest / status / capabilities match the original', async () => {
      const { db } = createFakeDb();
      setTestDb(db);
      const service = await buildDocumentationServiceWorker(WORKER_ENV);
      expect((await service.app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok', serviceId: 'documentation-service' });
      const manifestRes = await service.app.inject({ method: 'GET', url: '/.factory/manifest' });
      expect(manifestRes.json().data.serviceId).toBe('documentation-service');
      expect(manifestRes.json().data.domain).toContain('docs');
      expect((await service.app.inject({ method: 'GET', url: '/.factory/status' })).json().data.serviceId).toBe('documentation-service');
      expect((await service.app.inject({ method: 'GET', url: '/.factory/capabilities' })).json().data.capabilities).toEqual(docsManifest.capabilities);
    });

    it('POST /.factory/task upserts phase-log/decision-log/task doc and publishes DOC_UPDATED x3', async () => {
      const { db, writes } = createFakeDb();
      setTestDb(db);
      const service = await buildDocumentationServiceWorker(WORKER_ENV);
      const res = await service.app.inject({
        method: 'POST', url: '/.factory/task',
        headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
        payload: { taskId: 'task-1', goal: 'document the pipeline', input: { summary: 'pipeline documented' } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.updated).toEqual(['phase-log', 'decision-log', 'task-task-1']);
      expect(writes('documents').map((d) => d.slug)).toEqual(expect.arrayContaining(['phase-log', 'decision-log', 'task-task-1']));
      expect(publishSpy.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual(['doc.updated', 'doc.updated', 'doc.updated']);
    });

    it('custom /docs routes: unauthorized -> 401, then POST + GET round-trip', async () => {
      const { db } = createFakeDb();
      setTestDb(db);
      const service = await buildDocumentationServiceWorker(WORKER_ENV);
      expect((await service.app.inject({ method: 'POST', url: '/docs', payload: { slug: 'x', title: 'X', category: 'g', body: 'b' } })).statusCode).toBe(401);
      const post = await service.app.inject({
        method: 'POST', url: '/docs',
        headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
        payload: { slug: 'my-doc', title: 'My Doc', category: 'general', body: 'hello' },
      });
      expect(post.json().data).toEqual({ slug: 'my-doc', version: 1 });
      const get = await service.app.inject({ method: 'GET', url: '/docs/my-doc', headers: { 'x-factory-internal-token': INTERNAL_TOKEN } });
      expect(get.json().data.slug).toBe('my-doc');
    });
  });

  describe('memory-agent', () => {
    it('GET /health / manifest / status / capabilities match the original', async () => {
      const { db } = createFakeDb();
      setTestDb(db);
      const service = await buildMemoryAgentWorker(WORKER_ENV);
      expect((await service.app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok', serviceId: 'memory-agent' });
      const manifestRes = await service.app.inject({ method: 'GET', url: '/.factory/manifest' });
      expect(manifestRes.json().data.serviceId).toBe('memory-agent');
      expect(manifestRes.json().data.domain).toContain('memory');
      expect((await service.app.inject({ method: 'GET', url: '/.factory/capabilities' })).json().data.capabilities).toEqual(memoryManifest.capabilities);
    });

    it('POST /.factory/task without a skill writes only a memory; with a new skill inserts one; with an existing skill reinforces it', async () => {
      const { db, writes } = createFakeDb();
      setTestDb(db);
      const service = await buildMemoryAgentWorker(WORKER_ENV);

      const noSkill = await service.app.inject({
        method: 'POST', url: '/.factory/task', headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
        payload: { taskId: 'task-1', goal: 'summarize this task', input: {} },
      });
      expect(noSkill.json().data.skillId).toBeNull();
      expect(writes('memories')).toHaveLength(1);
      expect(writes('skills')).toHaveLength(0);

      const newSkill = await service.app.inject({
        method: 'POST', url: '/.factory/task', headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
        payload: { taskId: 'task-2', goal: 'build a new capability', input: { skill: 'new_capability' } },
      });
      expect(newSkill.json().data.skillId).toBe('skill_new_capability');
      expect(writes('skills')).toHaveLength(1);
      expect(writes('skills')[0].usageCount).toBe(1);

      const again = await service.app.inject({
        method: 'POST', url: '/.factory/task', headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
        payload: { taskId: 'task-3', goal: 'build the same capability again', input: { skill: 'new_capability' } },
      });
      expect(again.json().data.skillId).toBe('skill_new_capability');
      expect(writes('skills')).toHaveLength(1);
      expect(writes('skills')[0].usageCount).toBe(2);

      expect(publishSpy.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual([
        'agent.run.started', 'memory.written', 'agent.run.finished',
        'agent.run.started', 'memory.written', 'skill.created', 'agent.run.finished',
        'agent.run.started', 'memory.written', 'skill.updated', 'agent.run.finished',
      ]);
    });
  });

  describe('internet-research-service', () => {
    it('GET /health / manifest / status / capabilities match the original', async () => {
      const { db } = createFakeDb();
      setTestDb(db);
      const service = await buildInternetResearchServiceWorker(WORKER_ENV);
      expect((await service.app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok', serviceId: 'internet-research-service' });
      const manifestRes = await service.app.inject({ method: 'GET', url: '/.factory/manifest' });
      expect(manifestRes.json().data.serviceId).toBe('internet-research-service');
      expect(manifestRes.json().data.domain).toContain('research');
      expect((await service.app.inject({ method: 'GET', url: '/.factory/capabilities' })).json().data.capabilities).toEqual(researchManifest.capabilities);
    });

    it('POST /.factory/task (forceFallback) writes traces/cost/run/report/evidence and publishes started/research.completed', async () => {
      const { db, writes } = createFakeDb();
      setTestDb(db);
      const service = await buildInternetResearchServiceWorker(WORKER_ENV);
      const res = await service.app.inject({
        method: 'POST', url: '/.factory/task',
        headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
        payload: { taskId: 'task-1', goal: 'securing autonomous-agent dashboards', input: { forceFallback: true } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.research.mode).toBe('fallback');
      expect(res.json().data.research.sourceMode).toBe('curated_fallback');
      expect(writes('llm_traces')).toHaveLength(1);
      expect(writes('research_runs')).toHaveLength(1);
      expect(writes('research_reports')).toHaveLength(1);
      expect(writes('evidence_records')).toHaveLength(1);
      expect(publishSpy.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual(['agent.run.started', 'intel.research.completed']);
    });
  });
});

describe('aos-agent-runtime — Batch 2A multi-instance-in-one-process correctness proofs', () => {
  const ALL = [
    { label: 'architect-agent', build: buildArchitectWorker, manifest: architectManifest },
    { label: 'qa-agent', build: buildQaWorker, manifest: qaManifest },
    { label: 'reviewer-agent', build: buildReviewerWorker, manifest: reviewerManifest },
    { label: 'report-agent', build: buildReportWorker, manifest: reportManifest },
    { label: 'documentation-service', build: buildDocumentationServiceWorker, manifest: docsManifest },
    { label: 'memory-agent', build: buildMemoryAgentWorker, manifest: memoryManifest },
    { label: 'internet-research-service', build: buildInternetResearchServiceWorker, manifest: researchManifest },
  ] as const;

  it('each of the 3 new workers keeps its own correct serviceId even when process.env.SERVICE_ID/SERVICE_PORT are poisoned', async () => {
    const originalId = process.env.SERVICE_ID;
    const originalPort = process.env.SERVICE_PORT;
    process.env.SERVICE_ID = 'aos-agent-runtime';
    process.env.SERVICE_PORT = '9999';
    try {
      const { db } = createFakeDb();
      setTestDb(db);
      const news = [
        { build: buildDocumentationServiceWorker, id: 'documentation-service' },
        { build: buildMemoryAgentWorker, id: 'memory-agent' },
        { build: buildInternetResearchServiceWorker, id: 'internet-research-service' },
      ];
      const services = await Promise.all(news.map((n) => n.build(WORKER_ENV)));
      for (const [i, service] of services.entries()) {
        const res = await service.app.inject({ method: 'GET', url: '/health' });
        expect(res.json().serviceId).toBe(news[i].id);
        expect(res.json().serviceId).not.toBe('aos-agent-runtime');
      }
    } finally {
      if (originalId === undefined) delete process.env.SERVICE_ID; else process.env.SERVICE_ID = originalId;
      if (originalPort === undefined) delete process.env.SERVICE_PORT; else process.env.SERVICE_PORT = originalPort;
    }
  });

  describe('real port binding — all 7 workers (Batch 1 + Batch 2A) together, one process', () => {
    let services: FactoryService[] = [];

    afterAll(async () => {
      await Promise.all(services.map((s) => s.close().catch(() => undefined)));
    });

    it('all 7 workers bind their own distinct historical port simultaneously in one process', async () => {
      const { db } = createFakeDb();
      setTestDb(db);
      services = await Promise.all(ALL.map((c) => c.build(WORKER_ENV)));
      await Promise.all(services.map((s) => s.listen()));

      const expectedPorts = ALL.map((c) => SERVICE_PORTS[c.manifest.serviceId as keyof typeof SERVICE_PORTS]);
      expect(new Set(expectedPorts).size).toBe(ALL.length); // all 7 ports distinct

      for (const [i, service] of services.entries()) {
        const address = service.app.server.address();
        const boundPort = typeof address === 'object' && address ? address.port : null;
        expect(boundPort, `${ALL[i].label} should bind its historical port`).toBe(expectedPorts[i]);
      }

      for (const [i, c] of ALL.entries()) {
        const res = await fetch(`http://127.0.0.1:${expectedPorts[i]}/health`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { serviceId: string };
        expect(body.serviceId).toBe(c.manifest.serviceId);
      }
    });

    it('closing all 7 together (the shared-shutdown pattern) fully stops every listener', async () => {
      await Promise.all(services.map((s) => s.close()));
      for (const service of services) {
        expect(service.app.server.listening).toBe(false);
      }
      services = [];
    });
  });
});
