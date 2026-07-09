/**
 * K1.4a contract tests — scopedCollection: scope-by-construction data access.
 * These are isolation GUARANTEES: a caller of this API structurally cannot
 * read, write, update or delete across a scope boundary. Uses an injected
 * fake collection — no database required.
 */
import { describe, it, expect } from 'vitest';
import type { Collection, Document } from 'mongodb';
import { scopedCollection, type ScopedContext } from '../src/db/scoped.js';
import { legacyRoleToAuthContext, ESAN_TENANT_ID, ESAN_USER_ID } from '../src/scope/index.js';
import type { AuthContext } from '../src/schemas/scope.js';
import { COLLECTIONS } from '../src/constants/index.js';

/* ------------------------------ fake driver ----------------------------- */

interface Call { op: string; args: unknown[] }

function fakeCollection(): { calls: Call[]; col: Collection<Document> } {
  const calls: Call[] = [];
  const record = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
    // Return shapes are irrelevant to these contracts.
    return op === 'find' ? ({ toArray: async () => [] } as unknown) : Promise.resolve({ acknowledged: true });
  };
  const col = {
    find: record('find'),
    findOne: record('findOne'),
    countDocuments: record('countDocuments'),
    insertOne: record('insertOne'),
    updateOne: record('updateOne'),
    updateMany: record('updateMany'),
    deleteOne: record('deleteOne'),
    deleteMany: record('deleteMany'),
  } as unknown as Collection<Document>;
  return { calls, col };
}

const owner: AuthContext = legacyRoleToAuthContext('owner');
const userCtx: ScopedContext = { actor: owner, scope: 'user' };
const tenantCtx: ScopedContext = { actor: owner, scope: 'tenant' };

/* ------------------------------ fail closed ----------------------------- */

describe('fail-closed construction', () => {
  it('rejects a missing actor context', () => {
    expect(() => scopedCollection(COLLECTIONS.TASKS, { actor: undefined as unknown as AuthContext, scope: 'user' })).toThrow(/fail closed/);
  });
  it('rejects a missing scope', () => {
    expect(() => scopedCollection(COLLECTIONS.TASKS, { actor: owner, scope: undefined as unknown as ScopedContext['scope'] })).toThrow(/fail closed/);
  });
  it('rejects an actor lacking the identifiers the scope requires', () => {
    const bare: AuthContext = { actorId: 'x', actorType: 'human_user', roles: [], permissions: [], scopes: [], isOwner: false };
    expect(() => scopedCollection(COLLECTIONS.TASKS, { actor: bare, scope: 'user' })).toThrow(/fail closed/);
    expect(() => scopedCollection(COLLECTIONS.TASKS, { actor: bare, scope: 'tenant' })).toThrow(/fail closed/);
    // project/case require explicit target ids even for the owner
    expect(() => scopedCollection(COLLECTIONS.TASKS, { actor: owner, scope: 'project' })).toThrow(/fail closed/);
    expect(() => scopedCollection(COLLECTIONS.TASKS, { actor: owner, scope: 'case' })).toThrow(/fail closed/);
  });
});

/* -------------------------------- reads --------------------------------- */

describe('reads are always scope-guarded', () => {
  it('an empty find is bound to the actor scope', () => {
    const { calls, col } = fakeCollection();
    scopedCollection(COLLECTIONS.MEMORIES, userCtx, col).find();
    expect(calls[0]!.args[0]).toEqual({ scope: 'user', userId: ESAN_USER_ID });
  });

  it('a caller filter CANNOT widen the scope — it is $and-merged under the guard', () => {
    const { calls, col } = fakeCollection();
    // Hostile filter: tries to read another user's records explicitly.
    scopedCollection(COLLECTIONS.MEMORIES, userCtx, col).find({ userId: 'user_victim' });
    expect(calls[0]!.args[0]).toEqual({
      $and: [{ scope: 'user', userId: ESAN_USER_ID }, { userId: 'user_victim' }],
    }); // both must hold ⇒ cross-user read returns nothing
  });

  it('tenant reads bind to the active tenant', () => {
    const { calls, col } = fakeCollection();
    scopedCollection(COLLECTIONS.TASKS, tenantCtx, col).findOne({ status: 'running' });
    expect(calls[0]!.args[0]).toEqual({
      $and: [{ scope: 'tenant', tenantId: ESAN_TENANT_ID }, { status: 'running' }],
    });
  });

  it('countDocuments is guarded like any read', () => {
    const { calls, col } = fakeCollection();
    void scopedCollection(COLLECTIONS.TASKS, tenantCtx, col).countDocuments();
    expect(calls[0]!.args[0]).toEqual({ scope: 'tenant', tenantId: ESAN_TENANT_ID });
  });
});

/* -------------------------------- writes -------------------------------- */

describe('writes are stamped and cross-scope writes are rejected', () => {
  it('insertOne stamps the full scope identity from the ACTOR, not the caller', async () => {
    const { calls, col } = fakeCollection();
    await scopedCollection(COLLECTIONS.MEMORIES, userCtx, col).insertOne({ note: 'hello' });
    const doc = calls[0]!.args[0] as Record<string, unknown>;
    expect(doc).toMatchObject({
      note: 'hello', scope: 'user', userId: ESAN_USER_ID,
      visibility: 'private', createdBy: ESAN_USER_ID,
    });
  });

  it('a document smuggling a foreign tenantId/userId is REJECTED, not corrected', () => {
    const { calls, col } = fakeCollection();
    const scoped = scopedCollection(COLLECTIONS.MEMORIES, userCtx, col);
    // The guard throws synchronously — the driver is never reached.
    expect(() => scoped.insertOne({ note: 'x', userId: 'user_victim' } as never)).toThrow(/fail closed/);
    const tenantScoped = scopedCollection(COLLECTIONS.TASKS, tenantCtx, col);
    expect(() => tenantScoped.insertOne({ title: 'x', tenantId: 'tenant_victim' } as never)).toThrow(/fail closed/);
    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------- updates -------------------------------- */

describe('updates and deletes cannot cross or migrate scopes', () => {
  it('updates are scope-filtered', async () => {
    const { calls, col } = fakeCollection();
    await scopedCollection(COLLECTIONS.TASKS, tenantCtx, col).updateOne({ taskId: 't1' }, { $set: { status: 'done' } });
    expect(calls[0]!.args[0]).toEqual({
      $and: [{ scope: 'tenant', tenantId: ESAN_TENANT_ID }, { taskId: 't1' }],
    });
  });

  it('scope identity fields are IMMUTABLE via update ($set and dotted paths)', () => {
    const { calls, col } = fakeCollection();
    const scoped = scopedCollection(COLLECTIONS.TASKS, tenantCtx, col);
    // The guard throws synchronously — the driver is never reached.
    expect(() => scoped.updateOne({ taskId: 't1' }, { $set: { tenantId: 'tenant_other' } } as never)).toThrow(/immutable/);
    expect(() => scoped.updateMany({}, { $unset: { scope: '' } } as never)).toThrow(/immutable/);
    expect(() => scoped.updateOne({ taskId: 't1' }, { $set: { 'userId.sub': 'x' } } as never)).toThrow(/immutable/);
    expect(calls).toHaveLength(0);
  });

  it('deletes are scope-filtered — a hostile deleteMany({}) only touches the actor scope', async () => {
    const { calls, col } = fakeCollection();
    await scopedCollection(COLLECTIONS.MEMORIES, userCtx, col).deleteMany({});
    expect(calls[0]!.args[0]).toEqual({ scope: 'user', userId: ESAN_USER_ID });
  });
});

/* ---------------------------- project & case ---------------------------- */

describe('project/case scopes bind explicit target ids', () => {
  it('project context guards on tenant + project', () => {
    const { calls, col } = fakeCollection();
    scopedCollection(COLLECTIONS.TASKS, { actor: owner, scope: 'project', projectId: 'proj_1' }, col).find();
    expect(calls[0]!.args[0]).toEqual({ scope: 'project', tenantId: ESAN_TENANT_ID, projectId: 'proj_1' });
  });
  it('case context guards on tenant + case', () => {
    const { calls, col } = fakeCollection();
    scopedCollection(COLLECTIONS.TASKS, { actor: owner, scope: 'case', caseId: 'case_9' }, col).find();
    expect(calls[0]!.args[0]).toEqual({ scope: 'case', tenantId: ESAN_TENANT_ID, caseId: 'case_9' });
  });
});
