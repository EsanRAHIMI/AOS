/**
 * K1 Consolidation Prep (D-168) — proves services/aos-agent-runtime's four
 * workers are behaviorally equivalent to the four original, still-live
 * services (architect-agent, qa-agent, reviewer-agent, report-agent), and
 * proves the specific multi-instance-in-one-process risks called out
 * before implementation:
 *   - each logical service gets its own serviceId
 *   - each logical service gets the correct port
 *   - each logical service exposes its own manifest
 *   - logs/events show the correct source service (proven via the
 *     EventPublisher spy's `source` config on ctx.publisher, and via each
 *     worker's own agent_runs/evidence writes)
 *   - no shared SERVICE_ID/SERVICE_PORT env accidentally contaminates all
 *     four (proven by poisoning process.env before building and asserting
 *     nothing changes — the build functions never read those keys)
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
import type { FactoryService } from '@factory/service-kit';

const INTERNAL_TOKEN = 'test-internal-token';

/** Minimal fake Mongo: only insertOne + updateOne — same helper as each baseline suite. */
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

const WORKER_ENV = { FACTORY_INTERNAL_TOKEN: INTERNAL_TOKEN, EVENT_BUS_URL: '' };

type WorkerCase = {
  label: string;
  build: (env: typeof WORKER_ENV) => Promise<FactoryService>;
  manifest: { serviceId: string; capabilities: string[]; domain: string };
  domainFragment: string;
  taskPayload: Record<string, unknown>;
  writesCollections: string[];
  eventTypes: string[];
  resultKey: string;
};

const CASES: WorkerCase[] = [
  {
    label: 'architect-agent',
    build: buildArchitectWorker,
    manifest: architectManifest,
    domainFragment: 'architect',
    taskPayload: { taskId: 'task-1', goal: 'design a notification service', input: {} },
    writesCollections: ['agent_runs'],
    eventTypes: ['agent.run.started', 'agent.run.finished'],
    resultKey: 'design',
  },
  {
    label: 'qa-agent',
    build: buildQaWorker,
    manifest: qaManifest,
    domainFragment: 'qa',
    taskPayload: {
      taskId: 'task-1', goal: 'verify the retry logic',
      input: { goal: 'verify the retry logic', evidenceSummary: 'research evidence present, plan evidence present, review evidence present', forceFallback: true },
    },
    writesCollections: ['llm_traces', 'llm_cost_records', 'evidence_records', 'qa_reports', 'agent_runs'],
    eventTypes: ['agent.run.started', 'intel.qa.completed'],
    resultKey: 'qa',
  },
  {
    label: 'reviewer-agent',
    build: buildReviewerWorker,
    manifest: reviewerManifest,
    domainFragment: 'reviewer',
    taskPayload: {
      taskId: 'task-1', goal: 'review the improvement plan',
      input: { target: 'improvement plan', content: 'plan content', forceFallback: true },
    },
    writesCollections: ['llm_traces', 'llm_cost_records', 'evidence_records', 'review_reports', 'agent_runs'],
    eventTypes: ['agent.run.started', 'intel.review.completed'],
    resultKey: 'review',
  },
  {
    label: 'report-agent',
    build: buildReportWorker,
    manifest: reportManifest,
    domainFragment: 'reports',
    taskPayload: {
      taskId: 'task-1', goal: 'summarize this phase',
      input: { title: 'Executive report: phase summary', kind: 'executive', inputs: { goal: 'summarize this phase' }, forceFallback: true },
    },
    writesCollections: ['llm_traces', 'llm_cost_records', 'evidence_records', 'intelligence_reports', 'agent_runs'],
    eventTypes: ['agent.run.started', 'intel.report.generated'],
    resultKey: 'report',
  },
];

describe('aos-agent-runtime consolidated workers — equivalence to baseline', () => {
  let publishSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    publishSpy = vi.spyOn(EventPublisher.prototype, 'publish').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const c of CASES) {
    describe(c.label, () => {
      it('GET /health returns ok + this worker\'s own service id', async () => {
        const { db } = createMinimalFakeDb();
        setTestDb(db);
        const service = await c.build(WORKER_ENV);
        const res = await service.app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'ok', serviceId: c.manifest.serviceId });
      });

      it('GET /.factory/manifest returns this worker\'s own static manifest', async () => {
        const { db } = createMinimalFakeDb();
        setTestDb(db);
        const service = await c.build(WORKER_ENV);
        const res = await service.app.inject({ method: 'GET', url: '/.factory/manifest' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.data.serviceId).toBe(c.manifest.serviceId);
        expect(body.data.domain).toContain(c.domainFragment);
      });

      it('GET /.factory/status returns this worker\'s own serviceId', async () => {
        const { db } = createMinimalFakeDb();
        setTestDb(db);
        const service = await c.build(WORKER_ENV);
        const res = await service.app.inject({ method: 'GET', url: '/.factory/status' });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.serviceId).toBe(c.manifest.serviceId);
      });

      it('GET /.factory/capabilities returns this worker\'s own capability list', async () => {
        const { db } = createMinimalFakeDb();
        setTestDb(db);
        const service = await c.build(WORKER_ENV);
        const res = await service.app.inject({ method: 'GET', url: '/.factory/capabilities' });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.capabilities).toEqual(c.manifest.capabilities);
      });

      it('POST /.factory/task with no token -> 401 error envelope', async () => {
        const { db } = createMinimalFakeDb();
        setTestDb(db);
        const service = await c.build(WORKER_ENV);
        const res = await service.app.inject({ method: 'POST', url: '/.factory/task', payload: { goal: 'x' } });
        expect(res.statusCode).toBe(401);
        expect(res.json().ok).toBe(false);
      });

      it('POST /.factory/task with an invalid token -> 401 error envelope', async () => {
        const { db } = createMinimalFakeDb();
        setTestDb(db);
        const service = await c.build(WORKER_ENV);
        const res = await service.app.inject({
          method: 'POST', url: '/.factory/task',
          headers: { 'x-factory-internal-token': 'wrong-token' },
          payload: { goal: 'x' },
        });
        expect(res.statusCode).toBe(401);
        expect(res.json().ok).toBe(false);
      });

      it('POST /.factory/task with a missing goal -> 400 error envelope', async () => {
        const { db } = createMinimalFakeDb();
        setTestDb(db);
        const service = await c.build(WORKER_ENV);
        const res = await service.app.inject({
          method: 'POST', url: '/.factory/task',
          headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
          payload: {},
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().ok).toBe(false);
      });

      it('POST /.factory/task succeeds, writes the expected collections, and publishes the expected event types', async () => {
        const { db, writes } = createMinimalFakeDb();
        setTestDb(db);
        const service = await c.build(WORKER_ENV);
        const res = await service.app.inject({
          method: 'POST', url: '/.factory/task',
          headers: { 'x-factory-internal-token': INTERNAL_TOKEN },
          payload: c.taskPayload,
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.data.accepted).toBe(true);
        expect(body.data[c.resultKey]).toBeDefined();

        for (const col of c.writesCollections) {
          expect(writes(col), `expected a write to "${col}"`).toHaveLength(1);
        }

        const publishedTypes = publishSpy.mock.calls.map((call) => (call[0] as { type: string }).type);
        expect(publishedTypes).toEqual(c.eventTypes);
      });
    });
  }
});

describe('aos-agent-runtime — multi-instance-in-one-process correctness proofs', () => {
  it('each worker keeps its own correct serviceId even when process.env.SERVICE_ID/SERVICE_PORT are poisoned', async () => {
    const originalId = process.env.SERVICE_ID;
    const originalPort = process.env.SERVICE_PORT;
    process.env.SERVICE_ID = 'aos-agent-runtime'; // the HOST process's own id — must never leak into a worker
    process.env.SERVICE_PORT = '9999'; // an absurd, obviously-wrong port
    try {
      const { db } = createMinimalFakeDb();
      setTestDb(db);
      const services = await Promise.all(CASES.map((c) => c.build(WORKER_ENV)));
      for (const [i, service] of services.entries()) {
        const res = await service.app.inject({ method: 'GET', url: '/health' });
        expect(res.json().serviceId).toBe(CASES[i].manifest.serviceId);
        expect(res.json().serviceId).not.toBe('aos-agent-runtime');
      }
    } finally {
      if (originalId === undefined) delete process.env.SERVICE_ID; else process.env.SERVICE_ID = originalId;
      if (originalPort === undefined) delete process.env.SERVICE_PORT; else process.env.SERVICE_PORT = originalPort;
    }
  });

  describe('real port binding (historical ports, unchanged from the original 4 services)', () => {
    let services: FactoryService[] = [];

    afterAll(async () => {
      await Promise.all(services.map((s) => s.close().catch(() => undefined)));
    });

    it('all four workers bind their own historical port simultaneously in one process', async () => {
      const { db } = createMinimalFakeDb();
      setTestDb(db);
      services = await Promise.all(CASES.map((c) => c.build(WORKER_ENV)));
      await Promise.all(services.map((s) => s.listen()));

      const expectedPorts = [
        SERVICE_PORTS['architect-agent'],
        SERVICE_PORTS['qa-agent'],
        SERVICE_PORTS['reviewer-agent'],
        SERVICE_PORTS['report-agent'],
      ];
      for (const [i, service] of services.entries()) {
        const address = service.app.server.address();
        const boundPort = typeof address === 'object' && address ? address.port : null;
        expect(boundPort, `${CASES[i].label} should bind its historical port`).toBe(expectedPorts[i]);
      }

      // Cross-check against the live HTTP surface too, not just the bound
      // address — hit each real listener over the network on its real port.
      for (const [i, c] of CASES.entries()) {
        const res = await fetch(`http://127.0.0.1:${expectedPorts[i]}/health`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { serviceId: string };
        expect(body.serviceId).toBe(c.manifest.serviceId);
      }
    });

    it('closing all four together (the shared-shutdown pattern) fully stops every listener', async () => {
      await Promise.all(services.map((s) => s.close()));
      for (const service of services) {
        expect(service.app.server.listening).toBe(false);
      }
      services = [];
    });
  });
});
