/**
 * K2 D-177 — Memory v2 proofs. The load-bearing one: information recorded in
 * an EARLIER interaction changes a LATER answer's context correctly
 * (mandate §F: "a stored record alone is not memory"). Bilingual (FA/EN)
 * lexical retrieval, contradiction/supersede, correction, pin, delete
 * propagation, temporary-fact decay — all against the fake db, no embeddings.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import {
  recordMemory, correctMemory, pinMemory, deleteMemory, decayStaleMemories,
  searchMemories, buildMemoryContext, listMemories, tokenize, contentTokens, lexicalScores,
  type MemoryActor,
} from '../src/memory2/index.js';

const actor: MemoryActor = { actorId: 'esan', scope: 'user', tenantId: null };
const prov = (t: 'user_stated' | 'jarvis_inferred' | 'user_corrected' = 'user_stated') => ({ sourceType: t, sessionId: 's1', turnId: 't1', runId: null, refIds: [], sourceUrl: '' });

describe('bilingual tokenization', () => {
  it('normalizes Persian ي/ك variants and strips ZWNJ so FA queries match FA content', () => {
    const a = contentTokens('برنامه‌ی هوش مصنوعی'); // ی + ZWNJ
    const b = contentTokens('برنامه هوش مصنوعي');    // arabic ي
    expect(a).toContain('هوش');
    expect(b).toContain('هوش');
    expect(tokenize('AI Agent Operating System')).toEqual(['ai', 'agent', 'operating', 'system']);
  });

  it('lexical scoring ranks the topically-overlapping record higher', () => {
    const docs = [
      { memoryId: 'm1', subject: '', content: 'launch the AOS product in Q4', tags: [] },
      { memoryId: 'm2', subject: '', content: 'buy groceries tomorrow', tags: [] },
    ] as never;
    const scores = lexicalScores('when do we launch AOS', docs);
    expect(scores.get('m1')!).toBeGreaterThan(scores.get('m2')!);
  });
});

describe('cross-session recall — the load-bearing proof', () => {
  beforeEach(() => { setTestDb(createFakeDb().db); });

  it('a fact recorded in session 1 appears in the context packet retrieved for a related session-2 query', async () => {
    // Session 1: owner states a goal (Persian).
    await recordMemory(actor, { kind: 'goal', status: 'confirmed', content: 'هدف اصلی من راه‌اندازی نسخه‌ی قابل‌استفاده‌ی AOS تا پایان تابستان است', subject: 'goal:launch-aos', provenance: prov() });
    // Unrelated noise so retrieval must actually rank, not just return all.
    await recordMemory(actor, { kind: 'fact', status: 'confirmed', content: 'قهوه را تلخ دوست دارم', subject: 'pref:coffee', provenance: prov() });

    // Session 2 (later): a related question. buildMemoryContext is exactly
    // what Jarvis reads — the goal must surface, the coffee note must not lead.
    const ctx = await buildMemoryContext(actor, 'برنامه‌ی راه‌اندازی AOS چیست؟', { tokenBudget: 500 });
    expect(ctx.text).toContain('AOS');
    expect(ctx.text).toContain('CONFIRMED');
    expect(ctx.usedMemoryIds.length).toBeGreaterThan(0);
    // The goal outranks the coffee preference for this query.
    const top = (await searchMemories(actor, 'راه‌اندازی AOS'))[0];
    expect(top?.record.subject).toBe('goal:launch-aos');
  });

  it('English query retrieves an English confirmed fact over an unrelated one', async () => {
    await recordMemory(actor, { kind: 'decision', status: 'confirmed', content: 'We decided to self-host search with SearXNG, no paid APIs', subject: 'decision:search', provenance: prov() });
    await recordMemory(actor, { kind: 'fact', status: 'inferred', content: 'The weather was cloudy', subject: 'misc:weather', provenance: prov('jarvis_inferred') });
    const results = await searchMemories(actor, 'how are we doing search?');
    expect(results[0]?.record.subject).toBe('decision:search');
  });
});

describe('contradiction / supersede', () => {
  beforeEach(() => { setTestDb(createFakeDb().db); });

  it('a new CONFIRMED fact on the same subject supersedes the old one; only the new is returned by default', async () => {
    await recordMemory(actor, { kind: 'preference', status: 'confirmed', content: 'reply in English', subject: 'pref:language', provenance: prov() });
    const second = await recordMemory(actor, { kind: 'preference', status: 'confirmed', content: 'reply in Persian', subject: 'pref:language', provenance: prov() });
    expect(second.action).toBe('superseded_previous');
    const active = await listMemories(actor, { kinds: ['preference'] });
    const live = active.filter((m) => m.subject === 'pref:language' && !m.supersededBy);
    expect(live).toHaveLength(1);
    expect(live[0]!.content).toBe('reply in Persian');
  });

  it('an identical fact refreshes (no duplicate) rather than superseding', async () => {
    await recordMemory(actor, { kind: 'goal', status: 'confirmed', content: 'ship AOS', subject: 'goal:x', provenance: prov() });
    const again = await recordMemory(actor, { kind: 'goal', status: 'confirmed', content: 'ship AOS', subject: 'goal:x', provenance: prov() });
    expect(again.action).toBe('refreshed');
    expect((await listMemories(actor, { kinds: ['goal'] })).length).toBe(1);
  });

  it('a new INFERRED fact does NOT override an existing CONFIRMED fact (confirmed wins)', async () => {
    await recordMemory(actor, { kind: 'fact', status: 'confirmed', content: 'lives in Tehran', subject: 'person:home', provenance: prov() });
    await recordMemory(actor, { kind: 'fact', status: 'inferred', content: 'maybe lives in Shiraz', subject: 'person:home', provenance: prov('jarvis_inferred') });
    const live = (await listMemories(actor)).filter((m) => m.subject === 'person:home' && !m.supersededBy);
    expect(live).toHaveLength(1);
    expect(live[0]!.content).toContain('Tehran');
  });
});

describe('owner control: correct / pin / delete', () => {
  beforeEach(() => { setTestDb(createFakeDb().db); });

  it('correction replaces content, marks confirmed, and the corrected content is what later retrieval returns', async () => {
    const { memory } = await recordMemory(actor, { kind: 'fact', status: 'inferred', content: 'budget is 5000', subject: 'fin:budget', provenance: prov('jarvis_inferred') });
    await correctMemory(actor, memory.memoryId, 'budget is 12000 confirmed');
    const got = (await searchMemories(actor, 'budget'))[0];
    expect(got?.record.content).toContain('12000');
    expect(got?.record.status).toBe('confirmed');
  });

  it('pinned memories always appear in context even with a weak lexical match', async () => {
    const { memory } = await recordMemory(actor, { kind: 'preference', status: 'confirmed', content: 'always keep answers short', subject: 'pref:brevity', provenance: prov() });
    await pinMemory(actor, memory.memoryId, true);
    const ctx = await buildMemoryContext(actor, 'completely unrelated quantum topic', { tokenBudget: 500 });
    expect(ctx.text).toContain('always keep answers short');
  });

  it('delete tombstones the record and removes it from retrieval', async () => {
    const { memory } = await recordMemory(actor, { kind: 'fact', status: 'confirmed', content: 'secret note', subject: 'x', provenance: prov() });
    expect(await deleteMemory(actor, memory.memoryId)).toBe(true);
    const results = await searchMemories(actor, 'secret note');
    expect(results.find((r) => r.record.memoryId === memory.memoryId)).toBeUndefined();
  });
});

describe('scope isolation + decay', () => {
  beforeEach(() => { setTestDb(createFakeDb().db); });

  it('another user cannot retrieve this user\'s memories', async () => {
    await recordMemory(actor, { kind: 'fact', status: 'confirmed', content: 'private to esan', subject: 'p', provenance: prov() });
    const other: MemoryActor = { actorId: 'someone-else', scope: 'user', tenantId: null };
    expect(await searchMemories(other, 'private to esan')).toHaveLength(0);
  });

  it('temporary memories past their TTL are expired by decay', async () => {
    const { memory } = await recordMemory(actor, { kind: 'context', status: 'temporary', content: 'ephemeral chatter', subject: '', provenance: prov('jarvis_inferred') });
    // Backdate lastConfirmedAt beyond the TTL by rewriting via correct-less path:
    const { collection } = await import('../src/db/index.js');
    const { COLLECTIONS } = await import('../src/constants/index.js');
    await collection(COLLECTIONS.MEMORY_RECORDS).updateOne({ memoryId: memory.memoryId }, { $set: { lastConfirmedAt: new Date(Date.now() - 1000 * 3600 * 100).toISOString() } });
    const res = await decayStaleMemories(actor, { temporaryTtlHours: 48 });
    expect(res.expiredTemporary).toBe(1);
    expect(await searchMemories(actor, 'ephemeral chatter')).toHaveLength(0);
  });
});
