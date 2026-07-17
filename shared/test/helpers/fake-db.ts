/**
 * K2 D-177 contract-test harness — in-memory Mongo fake for shared modules.
 * Extends the gateway characterization fake (services/gateway-api/test/
 * helpers/fake-db.ts) with the operators the K2 modules use: $gt/$lt on ISO
 * strings, $addToSet, deleteMany, countDocuments. Injected through the
 * shared `setTestDb` seam — no network, no mongod. The REAL-infra proof for
 * these modules is scripts/jarvis-runtime-verify.mjs (real Mongo + Redis).
 */
import type { Db } from 'mongodb';

type Doc = Record<string, unknown>;

function matches(doc: Doc, filter: Doc | undefined): boolean {
  if (!filter) return true;
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or') { if (!(cond as Doc[]).some((b) => matches(doc, b))) return false; continue; }
    if (key === '$and') { if (!(cond as Doc[]).every((b) => matches(doc, b))) return false; continue; }
    const value = key.includes('.') ? key.split('.').reduce<unknown>((acc, k) => (acc as Doc | undefined)?.[k], doc) : doc[key];
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const ops = cond as Doc;
      const opKeys = Object.keys(ops);
      if (opKeys.length && opKeys.every((k) => k.startsWith('$'))) {
        for (const [op, arg] of Object.entries(ops)) {
          if (op === '$in') { if (!(arg as unknown[]).includes(value)) return false; }
          else if (op === '$nin') { if ((arg as unknown[]).includes(value)) return false; }
          else if (op === '$exists') { if ((value !== undefined) !== Boolean(arg)) return false; }
          else if (op === '$ne') { if (value === arg) return false; }
          else if (op === '$gt') { if (!(String(value ?? '') > String(arg))) return false; }
          else if (op === '$lt') { if (!(String(value ?? '') < String(arg))) return false; }
          else if (op === '$gte') { if (!(String(value ?? '') >= String(arg))) return false; }
          else if (op === '$lte') { if (!(String(value ?? '') <= String(arg))) return false; }
          else throw new Error(`fake-db: unsupported operator ${op} on ${key} — extend the fake`);
        }
        continue;
      }
    }
    if (JSON.stringify(value) !== JSON.stringify(cond)) return false;
  }
  return true;
}

function project(doc: Doc, projection?: Doc): Doc {
  const out = { ...doc };
  if (projection) for (const [k, v] of Object.entries(projection)) if (v === 0) delete out[k];
  delete out._id;
  return out;
}

function applyUpdate(doc: Doc, update: Doc): void {
  for (const [op, spec] of Object.entries(update)) {
    if (op === '$set') {
      for (const [k, v] of Object.entries(spec as Doc)) {
        if (k.includes('.')) {
          const parts = k.split('.');
          let cur: Doc = doc;
          for (const p of parts.slice(0, -1)) cur = (cur[p] = (cur[p] as Doc) ?? {}) as Doc;
          cur[parts[parts.length - 1] as string] = v;
        } else doc[k] = v;
      }
    } else if (op === '$unset') for (const k of Object.keys(spec as Doc)) delete doc[k];
    else if (op === '$inc') for (const [k, n] of Object.entries(spec as Doc)) doc[k] = ((doc[k] as number) ?? 0) + (n as number);
    else if (op === '$push') for (const [k, v] of Object.entries(spec as Doc)) { const arr = (doc[k] as unknown[]) ?? []; arr.push(v); doc[k] = arr; }
    else if (op === '$addToSet') for (const [k, v] of Object.entries(spec as Doc)) { const arr = (doc[k] as unknown[]) ?? []; if (!arr.some((x) => JSON.stringify(x) === JSON.stringify(v))) arr.push(v); doc[k] = arr; }
    else if (op === '$setOnInsert') { /* handled in upsert path */ }
    else throw new Error(`fake-db: unsupported update operator ${op} — extend the fake`);
  }
}

class FakeCursor {
  constructor(private rows: Doc[], private projection?: Doc) {}
  sort(spec: Doc): this {
    const entries = Object.entries(spec);
    this.rows = [...this.rows].sort((a, b) => {
      for (const [k, dir] of entries) {
        const av = a[k]; const bv = b[k];
        if (typeof av === 'number' && typeof bv === 'number') { if (av !== bv) return (av - bv) * (dir as number); }
        else { const as = String(av ?? ''); const bs = String(bv ?? ''); if (as !== bs) return as < bs ? -(dir as number) : (dir as number); }
      }
      return 0;
    });
    return this;
  }
  limit(n: number): this { this.rows = this.rows.slice(0, n); return this; }
  skip(n: number): this { this.rows = this.rows.slice(n); return this; }
  async toArray(): Promise<Doc[]> { return this.rows.map((r) => project(r, this.projection)); }
}

export function createFakeDb(): { db: Db; store: Map<string, Doc[]>; dump: (name: string) => Doc[] } {
  const store = new Map<string, Doc[]>();
  const coll = (name: string) => {
    const rows = () => { let a = store.get(name); if (!a) { a = []; store.set(name, a); } return a; };
    return {
      insertOne: async (doc: Doc) => { rows().push({ ...doc }); return { acknowledged: true, insertedId: 'fake' }; },
      findOne: async (filter?: Doc, opts?: { projection?: Doc }) => {
        const found = rows().find((d) => matches(d, filter));
        return found ? project(found, opts?.projection) : null;
      },
      find: (filter?: Doc, opts?: { projection?: Doc }) => new FakeCursor(rows().filter((d) => matches(d, filter)), opts?.projection),
      updateOne: async (filter: Doc, update: Doc, opts?: { upsert?: boolean }) => {
        const doc = rows().find((d) => matches(d, filter));
        if (doc) { applyUpdate(doc, update); return { acknowledged: true, matchedCount: 1, modifiedCount: 1 }; }
        if (opts?.upsert) {
          const fresh: Doc = {};
          for (const [k, v] of Object.entries(filter)) if (typeof v !== 'object' || v === null) fresh[k] = v;
          applyUpdate(fresh, update);
          if (update.$setOnInsert) Object.assign(fresh, update.$setOnInsert as Doc);
          rows().push(fresh);
          return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedId: 'fake' };
        }
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      },
      updateMany: async (filter: Doc, update: Doc) => {
        const targets = rows().filter((d) => matches(d, filter));
        for (const t of targets) applyUpdate(t, update);
        return { acknowledged: true, matchedCount: targets.length, modifiedCount: targets.length };
      },
      findOneAndUpdate: async (filter: Doc, update: Doc, _opts?: Doc) => {
        const doc = rows().find((d) => matches(d, filter));
        if (!doc) return null;
        applyUpdate(doc, update);
        return project(doc);
      },
      deleteMany: async (filter: Doc) => {
        const before = rows().length;
        store.set(name, rows().filter((d) => !matches(d, filter)));
        return { acknowledged: true, deletedCount: before - (store.get(name)?.length ?? 0) };
      },
      countDocuments: async (filter?: Doc) => rows().filter((d) => matches(d, filter)).length,
      createIndex: async () => 'fake-index',
    };
  };
  const db = { collection: (name: string) => coll(name) } as unknown as Db;
  return { db, store, dump: (name: string) => store.get(name) ?? [] };
}
