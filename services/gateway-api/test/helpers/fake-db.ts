/**
 * K1.3 characterization harness — minimal in-memory Mongo fake.
 *
 * Implements exactly the driver surface the gateway uses (verified by grep):
 * find(+sort/limit/toArray), findOne, insertOne, updateOne, updateMany,
 * findOneAndUpdate({returnDocument:'after'}), countDocuments, createIndex.
 * Filter matcher: equality, $in, $nin, $exists, $or. Projection: key:0 strips.
 * Injected through the shared `setTestDb` seam — no network, no mongod.
 */
import type { Db } from 'mongodb';

type Doc = Record<string, unknown>;

function matches(doc: Doc, filter: Doc | undefined): boolean {
  if (!filter) return true;
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or') {
      const branches = cond as Doc[];
      if (!branches.some((b) => matches(doc, b))) return false;
      continue;
    }
    if (key === '$and') {
      const branches = cond as Doc[];
      if (!branches.every((b) => matches(doc, b))) return false;
      continue;
    }
    const value = doc[key];
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const ops = cond as Doc;
      for (const [op, arg] of Object.entries(ops)) {
        if (op === '$in') { if (!(arg as unknown[]).includes(value)) return false; }
        else if (op === '$nin') { if ((arg as unknown[]).includes(value)) return false; }
        else if (op === '$exists') { if ((key in doc) !== Boolean(arg)) return false; }
        else if (op === '$ne') { if (value === arg) return false; }
        else if (op === '$gte') { if (!(String(value) >= String(arg))) return false; }
        else if (op === '$lte') { if (!(String(value) <= String(arg))) return false; }
        else { throw new Error(`fake-db: unsupported operator ${op} on ${key} — extend the fake`); }
      }
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

function project(doc: Doc, projection?: Doc): Doc {
  const out = { ...doc };
  if (projection) {
    for (const [k, v] of Object.entries(projection)) if (v === 0) delete out[k];
  }
  delete out._id; // the fake never fabricates _id, so it is never returned either
  return out;
}

function applyUpdate(doc: Doc, update: Doc): void {
  for (const [op, spec] of Object.entries(update)) {
    if (op === '$set') Object.assign(doc, spec as Doc);
    else if (op === '$unset') for (const k of Object.keys(spec as Doc)) delete doc[k];
    else if (op === '$inc') for (const [k, n] of Object.entries(spec as Doc)) doc[k] = ((doc[k] as number) ?? 0) + (n as number);
    else if (op === '$push') for (const [k, v] of Object.entries(spec as Doc)) (doc[k] = (doc[k] as unknown[]) ?? []) && (doc[k] as unknown[]).push(v);
    else throw new Error(`fake-db: unsupported update operator ${op} — extend the fake`);
  }
}

class FakeCursor {
  constructor(private rows: Doc[], private projection?: Doc) {}
  sort(spec: Doc): this {
    const entries = Object.entries(spec);
    this.rows = [...this.rows].sort((a, b) => {
      for (const [k, dir] of entries) {
        const av = String(a[k] ?? ''); const bv = String(b[k] ?? '');
        if (av !== bv) return av < bv ? -(dir as number) : (dir as number);
      }
      return 0;
    });
    return this;
  }
  limit(n: number): this { this.rows = this.rows.slice(0, n); return this; }
  skip(n: number): this { this.rows = this.rows.slice(n); return this; }
  async toArray(): Promise<Doc[]> { return this.rows.map((r) => project(r, this.projection)); }
}

export class FakeCollection {
  docs: Doc[] = [];
  constructor(readonly name: string) {}
  find(filter?: Doc, opts?: { projection?: Doc }): FakeCursor {
    return new FakeCursor(this.docs.filter((d) => matches(d, filter)), opts?.projection);
  }
  async findOne(filter?: Doc, opts?: { projection?: Doc }): Promise<Doc | null> {
    const hit = this.docs.find((d) => matches(d, filter));
    return hit ? project(hit, opts?.projection) : null;
  }
  async insertOne(doc: Doc): Promise<{ acknowledged: true; insertedId: string }> {
    this.docs.push({ ...doc });
    return { acknowledged: true, insertedId: `fake_${this.docs.length}` };
  }
  async updateOne(filter: Doc, update: Doc): Promise<{ matchedCount: number; modifiedCount: number }> {
    const hit = this.docs.find((d) => matches(d, filter));
    if (!hit) return { matchedCount: 0, modifiedCount: 0 };
    applyUpdate(hit, update);
    return { matchedCount: 1, modifiedCount: 1 };
  }
  async updateMany(filter: Doc, update: Doc): Promise<{ matchedCount: number; modifiedCount: number }> {
    const hits = this.docs.filter((d) => matches(d, filter));
    for (const h of hits) applyUpdate(h, update);
    return { matchedCount: hits.length, modifiedCount: hits.length };
  }
  async findOneAndUpdate(filter: Doc, update: Doc, opts?: { returnDocument?: string; projection?: Doc }): Promise<Doc | null> {
    const hit = this.docs.find((d) => matches(d, filter));
    if (!hit) return null;
    const before = { ...hit };
    applyUpdate(hit, update);
    return project(opts?.returnDocument === 'after' ? hit : before, opts?.projection);
  }
  async deleteOne(filter: Doc): Promise<{ deletedCount: number }> {
    const i = this.docs.findIndex((d) => matches(d, filter));
    if (i === -1) return { deletedCount: 0 };
    this.docs.splice(i, 1);
    return { deletedCount: 1 };
  }
  async countDocuments(filter?: Doc): Promise<number> {
    return this.docs.filter((d) => matches(d, filter)).length;
  }
  async createIndex(): Promise<string> { return 'fake_index'; }
  async aggregate(): Promise<never> { throw new Error('fake-db: aggregate not supported — extend the fake'); }
}

export class FakeDb {
  readonly collections = new Map<string, FakeCollection>();
  collection(name: string): FakeCollection {
    let c = this.collections.get(name);
    if (!c) { c = new FakeCollection(name); this.collections.set(name, c); }
    return c;
  }
  async command(): Promise<{ ok: 1 }> { return { ok: 1 }; }
  /** Direct access for seeding/asserting in tests. */
  col(name: string): FakeCollection { return this.collection(name); }
  asDb(): Db { return this as unknown as Db; }
}
