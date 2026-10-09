import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from 'mongodb';
import {
  COLLECTIONS,
  EVENT_TYPES,
  INDEX_PLAN,
  MONITOR_RUN_TTL_INDEX_NAME,
  MONITOR_RUN_TTL_SECONDS,
  setTestDb,
} from '@factory/shared';
import { deleteExpiredMonitorRunEvents, runMonitorScan } from '../src/activation.js';

type Doc = Record<string, unknown>;

function matches(doc: Doc, filter: Doc | undefined): boolean {
  if (!filter) return true;
  for (const [key, cond] of Object.entries(filter)) {
    const value = doc[key];
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const ops = cond as Doc;
      if ('$lt' in ops) {
        if (!(String(value ?? '') < String(ops.$lt))) return false;
        continue;
      }
      if ('$ne' in ops) {
        if (value === ops.$ne) return false;
        continue;
      }
    }
    if (value !== cond) return false;
  }
  return true;
}

function createFakeDb() {
  const store = new Map<string, Doc[]>();
  const rows = (name: string) => {
    let list = store.get(name);
    if (!list) {
      list = [];
      store.set(name, list);
    }
    return list;
  };
  const db = {
    collection: (name: string) => ({
      insertOne: async (doc: Doc) => {
        rows(name).push(doc);
        return { acknowledged: true, insertedId: 'fake' };
      },
      findOne: async (filter?: Doc) => rows(name).find((doc) => matches(doc, filter)) ?? null,
      deleteMany: async (filter: Doc) => {
        const before = rows(name).length;
        store.set(name, rows(name).filter((doc) => !matches(doc, filter)));
        return { acknowledged: true, deletedCount: before - (store.get(name)?.length ?? 0) };
      },
    }),
  } as unknown as Db;
  return { db, dump: (name: string) => store.get(name) ?? [] };
}

const scanArgs = {
  internalToken: 'token',
  registryUrl: 'http://registry',
  publish: async () => true,
};

function registryResponse(services: Array<{ serviceId: string; domain: string }> = []) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: services }),
  };
}

describe('monitor retention', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('writes ttlAt as a BSON Date and leaves createdAt an ISO string', async () => {
    const fake = createFakeDb();
    setTestDb(fake.db);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/services')) return registryResponse([{ serviceId: 'gateway-api', domain: 'http://gateway' }]);
      return { ok: true, status: 200, json: async () => ({}) };
    }));

    const run = await runMonitorScan(scanArgs);
    const stored = fake.dump(COLLECTIONS.MONITOR_RUNS);

    expect(run).not.toBeNull();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.ttlAt).toBeInstanceOf(Date);
    expect(typeof stored[0]?.createdAt).toBe('string');
    expect(stored[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('configures a 24h TTL index on ttlAt and not on createdAt or events', () => {
    const ttl = INDEX_PLAN.filter((entry) => entry.options?.expireAfterSeconds !== undefined && entry.collection === COLLECTIONS.MONITOR_RUNS);
    expect(ttl).toHaveLength(1);
    expect(ttl[0]?.keys).toEqual({ ttlAt: 1 });
    expect(ttl[0]?.options).toMatchObject({
      name: MONITOR_RUN_TTL_INDEX_NAME,
      expireAfterSeconds: 86400,
    });
    expect(MONITOR_RUN_TTL_SECONDS).toBe(86400);
    expect(Object.keys(ttl[0]?.keys ?? {})).not.toContain('createdAt');

    const createdAtTtl = INDEX_PLAN.filter((entry) => {
      const keys = entry.keys as Record<string, unknown>;
      return entry.collection === COLLECTIONS.MONITOR_RUNS && 'createdAt' in keys && entry.options?.expireAfterSeconds !== undefined;
    });
    expect(createdAtTtl).toEqual([]);

    const eventTtl = INDEX_PLAN.filter((entry) => entry.collection === COLLECTIONS.EVENTS && entry.options?.expireAfterSeconds !== undefined);
    expect(eventTtl).toEqual([]);
  });

  it('does not start a second scan while the first is still running', async () => {
    const fake = createFakeDb();
    setTestDb(fake.db);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let registryCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/services')) {
        registryCalls += 1;
        if (registryCalls === 1) await gate;
        return registryResponse();
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }));

    const first = runMonitorScan(scanArgs);
    await vi.waitFor(() => {
      expect(registryCalls).toBe(1);
    });
    const second = await runMonitorScan(scanArgs);
    expect(second).toBeNull();
    expect(fake.dump(COLLECTIONS.MONITOR_RUNS)).toHaveLength(0);

    release();
    const finished = await first;
    expect(finished).not.toBeNull();
    expect(fake.dump(COLLECTIONS.MONITOR_RUNS)).toHaveLength(1);

    const third = await runMonitorScan(scanArgs);
    expect(third).not.toBeNull();
    expect(fake.dump(COLLECTIONS.MONITOR_RUNS)).toHaveLength(2);
  });

  it('deletes monitor.run events older than 24 hours and keeps every other type', async () => {
    const fake = createFakeDb();
    setTestDb(fake.db);
    const now = new Date('2026-10-09T12:00:00.000Z');
    const events = fake.db.collection(COLLECTIONS.EVENTS);
    await events.insertOne({ eventId: 'evt_old_monitor', type: EVENT_TYPES.MONITOR_RUN, createdAt: '2026-10-08T11:59:59.000Z' });
    await events.insertOne({ eventId: 'evt_fresh_monitor', type: EVENT_TYPES.MONITOR_RUN, createdAt: '2026-10-09T11:00:00.000Z' });
    await events.insertOne({ eventId: 'evt_old_task', type: 'task.created', createdAt: '2026-01-01T00:00:00.000Z' });
    await events.insertOne({ eventId: 'evt_old_incident', type: EVENT_TYPES.INCIDENT_CREATED, createdAt: '2026-01-01T00:00:00.000Z' });

    const deleted = await deleteExpiredMonitorRunEvents(now);
    const remaining = fake.dump(COLLECTIONS.EVENTS).map((doc) => doc.eventId);

    expect(deleted).toBe(1);
    expect(remaining).toEqual(['evt_fresh_monitor', 'evt_old_task', 'evt_old_incident']);
  });
});
