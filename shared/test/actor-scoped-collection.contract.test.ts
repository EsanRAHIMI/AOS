import { describe, expect, it } from 'vitest';
import type { Collection, Document } from 'mongodb';
import { actorPartitionedCollection, actorScopedCollection, keyedScopedCollection } from '../src/db/actor-scoped.js';
import { COLLECTIONS } from '../src/constants/index.js';

interface Call { op: string; args: unknown[] }

function fakeCollection(): { calls: Call[]; col: Collection<Document> } {
  const calls: Call[] = [];
  const record = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
    return op === 'find' ? ({ toArray: async () => [] } as unknown) : Promise.resolve({ acknowledged: true });
  };
  return {
    calls,
    col: {
      find: record('find'), findOne: record('findOne'), countDocuments: record('countDocuments'),
      insertOne: record('insertOne'), updateOne: record('updateOne'), updateMany: record('updateMany'),
      deleteOne: record('deleteOne'), deleteMany: record('deleteMany'),
    } as unknown as Collection<Document>,
  };
}

describe('actor-scoped repository', () => {
  it('guards reads even when a hostile filter names another actor', () => {
    const { calls, col } = fakeCollection();
    actorScopedCollection(COLLECTIONS.CALENDAR_EVENTS, 'alice', col).find({ actorId: 'bob' });
    expect(calls[0]!.args[0]).toEqual({ $and: [{ actorId: 'alice' }, { actorId: 'bob' }] });
  });

  it('stamps inserts and rejects cross-actor ownership', async () => {
    const { calls, col } = fakeCollection();
    const repo = actorScopedCollection(COLLECTIONS.CALENDAR_EVENTS, 'alice', col);
    await repo.insertOne({ eventId: 'e1' });
    expect(calls[0]!.args[0]).toMatchObject({ eventId: 'e1', actorId: 'alice' });
    expect(() => repo.insertOne({ eventId: 'e2', actorId: 'bob' })).toThrow(/fail closed/);
  });

  it('makes an arbitrary legacy query without actorId impossible', () => {
    const { calls, col } = fakeCollection();
    const repo = actorPartitionedCollection(COLLECTIONS.LOOP_INBOX, col);
    expect(() => repo.find({ status: 'pending' })).toThrow(/explicit actorId/);
    expect(() => repo.updateOne({ inboxId: 'x' }, { $set: { status: 'done' } })).toThrow(/explicit actorId/);
    expect(calls).toHaveLength(0);
  });

  it('supports ownerId schemas without allowing the caller to widen the partition', () => {
    const { calls, col } = fakeCollection();
    keyedScopedCollection(COLLECTIONS.SYSTEM_SETTINGS, 'ownerId', 'alice', col).findOne({ ownerId: 'bob' });
    expect(calls[0]!.args[0]).toEqual({ $and: [{ ownerId: 'alice' }, { ownerId: 'bob' }] });
  });
});
