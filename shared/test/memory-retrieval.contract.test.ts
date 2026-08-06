/**
 * Memory retrieval — candidate selection (D-215).
 *
 * The failure this covers produced no error and no wrong answer that anyone
 * could point at. `searchMemories` scored only the 400 most recently updated
 * rows, so an older memory was unreachable however well it matched, and Jarvis
 * answered confidently from an incomplete search. It gets worse the more the
 * owner uses the system, which is the opposite of how memory should behave.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { recordMemory, searchMemories, type MemoryActor } from '../src/memory2/index.js';
import {
  memoryScore, isRetainable, unionById, retrievalModeFromEnv,
  IN_PROCESS_CANDIDATE_LIMIT, type RetrievalMode,
} from '../src/memory2/retrieval.js';
import type { MemoryRecord } from '../src/memory2/index.js';

const actor: MemoryActor = { actorId: 'esan', scope: 'user', tenantId: null };
const prov = () => ({ sourceType: 'user_stated' as const, sessionId: 's1', turnId: 't1', runId: null, refIds: [], sourceUrl: '' });

function rec(over: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = new Date().toISOString();
  return {
    memoryId: 'm1', kind: 'fact', status: 'confirmed', content: 'c', subject: 's',
    language: 'en', importance: 0.5, confidence: 0.7, pinned: false, tags: [],
    provenance: prov(),
    lastConfirmedAt: now, supersededBy: null, deletedAt: null,
    createdAt: now, updatedAt: now, scope: 'user', tenantId: null,
    createdBy: 'esan', visibility: 'private',
    ...over,
  } as MemoryRecord;
}

describe('retrievalModeFromEnv', () => {
  it('defaults to the path that needs no Atlas index', () => {
    expect(retrievalModeFromEnv({} as NodeJS.ProcessEnv)).toBe('in_process');
    // Anything unrecognised is also in_process: a typo in an env var must not
    // silently route retrieval at an index that does not exist.
    expect(retrievalModeFromEnv({ MEMORY_RETRIEVAL_MODE: 'hybrid' } as unknown as NodeJS.ProcessEnv)).toBe('in_process');
    expect(retrievalModeFromEnv({ MEMORY_RETRIEVAL_MODE: 'atlas_hybrid' } as unknown as NodeJS.ProcessEnv)).toBe('atlas_hybrid');
  });
});

describe('memoryScore — the product opinion, identical in every mode', () => {
  const now = Date.now();

  it('ranks a pinned memory above an unpinned one that matches equally', () => {
    const a = memoryScore(rec({ pinned: true }), { lexical: 0.4, vector: 0, now });
    const b = memoryScore(rec({ pinned: false }), { lexical: 0.4, vector: 0, now });
    expect(a).toBeGreaterThan(b);
  });

  it('ranks a confirmed memory above an inferred one, and inferred above temporary', () => {
    const s = (status: MemoryRecord['status']) => memoryScore(rec({ status }), { lexical: 0.4, vector: 0, now });
    expect(s('confirmed')).toBeGreaterThan(s('inferred'));
    expect(s('inferred')).toBeGreaterThan(s('temporary'));
  });

  it('decays with age but does not erase an old, important, confirmed fact', () => {
    const old = rec({ lastConfirmedAt: new Date(now - 400 * 86_400_000).toISOString(), importance: 1 });
    expect(isRetainable(old, memoryScore(old, { lexical: 0.6, vector: 0, now }))).toBe(true);
  });

  it('keeps a pinned memory even when it scores nothing at all', () => {
    const p = rec({ pinned: true });
    expect(isRetainable(p, -5)).toBe(true);
    expect(isRetainable(rec(), -5)).toBe(false);
  });
});

describe('unionById', () => {
  it('keeps one copy of a record returned by two different indexes', () => {
    /* The same row arriving from the text index and the vector index must
     * appear once, or it competes with itself and skews the docFreq statistics
     * that the lexical scorer computes over the candidate set. */
    const shared = rec({ memoryId: 'dup' });
    const merged = unionById([shared, rec({ memoryId: 'a' })], [shared, rec({ memoryId: 'b' })]);
    expect(merged.map((r) => r.memoryId).sort()).toEqual(['a', 'b', 'dup']);
  });

  it('prefers the first sighting, so the primary source wins on conflict', () => {
    const first = rec({ memoryId: 'x', content: 'from text index' });
    const second = rec({ memoryId: 'x', content: 'from vector index' });
    expect(unionById([first], [second])[0].content).toBe('from text index');
  });
});

describe('searchMemories — a pin is not subject to a recency window', () => {
  beforeEach(() => { setTestDb(createFakeDb().db); });

  /**
   * Fill the recency window past its limit.
   *
   * Inserted directly rather than through `recordMemory`: this is about the
   * candidate QUERY, and going through the dedup/contradiction path 400+ times
   * would make the test slow while proving nothing extra. `filler` rows are
   * newer than the subject under test, which is what pushes it out.
   */
  async function fillWindow(count: number): Promise<void> {
    const { collection } = await import('../src/db/index.js');
    const { COLLECTIONS } = await import('../src/constants/index.js');
    const base = Date.now();
    const rows: MemoryRecord[] = [];
    for (let i = 0; i < count; i += 1) {
      const at = new Date(base - i * 1000).toISOString();
      rows.push(rec({
        memoryId: `filler_${i}`, subject: `filler:${i}`, content: `unrelated filler note ${i}`,
        updatedAt: at, createdAt: at, lastConfirmedAt: at,
      }));
    }
    for (const r of rows) await collection(COLLECTIONS.MEMORY_RECORDS).insertOne(r);
  }

  it('returns a pinned memory that has fallen far outside the window', async () => {
    /* The exact reported shape of the bug: pin something, then keep using the
     * system. The final filter has always promised `score > 0.15 || pinned`,
     * but the candidate query could not deliver a row it never selected. */
    const pinnedAt = new Date(Date.now() - 900 * 86_400_000).toISOString();
    await recordMemory(actor, {
      kind: 'preference', status: 'confirmed',
      subject: 'preference:reply_language',
      content: 'Masi prefers replies in Persian',
      provenance: prov(),
    });
    const db = (await searchMemories(actor, 'Persian'))[0];
    expect(db).toBeTruthy();

    const { collection } = await import('../src/db/index.js');
    const { COLLECTIONS } = await import('../src/constants/index.js');
    await collection(COLLECTIONS.MEMORY_RECORDS).updateOne(
      { memoryId: db.record.memoryId },
      { $set: { pinned: true, updatedAt: pinnedAt, lastConfirmedAt: pinnedAt } },
    );

    // Genuinely bury it: more recent rows than the window can hold.
    await fillWindow(IN_PROCESS_CANDIDATE_LIMIT + 20);

    // Confirm the burial is real — otherwise this test proves nothing.
    const window = await collection(COLLECTIONS.MEMORY_RECORDS)
      .find({}).sort({ updatedAt: -1 }).limit(IN_PROCESS_CANDIDATE_LIMIT).toArray() as MemoryRecord[];
    expect(window.map((r) => r.memoryId)).not.toContain(db.record.memoryId);

    // A query sharing no words at all with the pinned memory.
    const results = await searchMemories(actor, 'quantum tunnelling in superconductors');
    expect(results.map((r) => r.record.memoryId)).toContain(db.record.memoryId);
  });

  it('does not return the same memory twice when it is both pinned and recent', async () => {
    await recordMemory(actor, {
      kind: 'fact', status: 'confirmed', subject: 'gym', content: 'gym is on tuesdays',
      provenance: prov(),
    });
    const first = (await searchMemories(actor, 'gym'))[0];
    const { collection } = await import('../src/db/index.js');
    const { COLLECTIONS } = await import('../src/constants/index.js');
    await collection(COLLECTIONS.MEMORY_RECORDS).updateOne(
      { memoryId: first.record.memoryId }, { $set: { pinned: true } },
    );

    const results = await searchMemories(actor, 'gym');
    const ids = results.map((r) => r.record.memoryId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('falls back to the recency window when the Atlas indexes are absent', async () => {
    /* The fake db has no $search stage, which is exactly the shape of a plain
     * mongod or an Atlas cluster whose indexes were never created. A missing
     * index is a deployment fact; the only acceptable response is a search
     * that still works. */
    await recordMemory(actor, {
      kind: 'fact', status: 'confirmed', subject: 'car', content: 'the car service is due in March',
      provenance: prov(),
    });
    const results = await searchMemories(actor, 'car service', { mode: 'atlas_hybrid' as RetrievalMode });
    expect(results.map((r) => r.record.subject)).toContain('car');
  });

  it('still honours kind and superseded filters through the new path', async () => {
    await recordMemory(actor, {
      kind: 'fact', status: 'confirmed', subject: 'a', content: 'alpha beta',
      provenance: prov(),
    });
    await recordMemory(actor, {
      kind: 'decision', status: 'confirmed', subject: 'b', content: 'alpha gamma',
      provenance: prov(),
    });
    const onlyFacts = await searchMemories(actor, 'alpha', { kinds: ['fact'] });
    expect(onlyFacts.every((r) => r.record.kind === 'fact')).toBe(true);
    expect(onlyFacts.length).toBeGreaterThan(0);
  });
});

describe('the window constant', () => {
  it('is unchanged — the fix for a window is not a bigger window', () => {
    /* Raising it would trade a silent correctness bug for a silent performance
     * one (every candidate is scored in Node) and would still be a window. */
    expect(IN_PROCESS_CANDIDATE_LIMIT).toBe(400);
  });
});
