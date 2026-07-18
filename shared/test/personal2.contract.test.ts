/**
 * K2 Product Activation (D-178) — personal operating state over Memory v2 +
 * missions. Deterministic onboarding turns explicit owner answers into
 * structured, confirmed, provenance-tagged records (nothing fabricated);
 * the snapshot aggregates real owner-scoped state; scope isolation holds.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { applyOnboardingAnswers, buildPersonalStateSnapshot, buildPersonalContext } from '../src/personal2/index.js';
import { listMemories } from '../src/memory2/index.js';
import { listMissionNodes } from '../src/missions/index.js';

const actor = { actorId: 'esan', scope: 'user' as const, tenantId: null };

describe('personal onboarding — deterministic, no fabrication', () => {
  beforeEach(() => { setTestDb(createFakeDb().db); });

  it('persists only the answers the owner actually gave, as confirmed records + a seed vision', async () => {
    const res = await applyOnboardingAnswers(actor, {
      primary_goal: 'راه‌اندازی نسخهٔ قابل‌استفادهٔ AOS تا پایان تابستان',
      active_project: 'K2 product activation',
      open_commitment: '', // left blank — must NOT be stored
      reply_language: 'Persian',
    }, 'sess1');
    expect(res.created.length).toBe(3); // goal + project + preference, NOT the blank commitment
    expect(res.visionId).toBeTruthy();

    const mems = await listMemories(actor);
    expect(mems.every((m) => m.status === 'confirmed' && m.provenance.sourceType === 'user_stated')).toBe(true);
    expect(mems.find((m) => m.kind === 'commitment')).toBeUndefined(); // never fabricated
    const visions = await listMissionNodes(actor, { nodeTypes: ['vision'] });
    expect(visions).toHaveLength(1);
    expect(visions[0]!.title).toContain('AOS');
  });

  it('re-running onboarding updates, never duplicates (idempotent per subject)', async () => {
    await applyOnboardingAnswers(actor, { primary_goal: 'goal one' }, 'sess1');
    await applyOnboardingAnswers(actor, { primary_goal: 'goal one refined' }, 'sess2');
    const goals = (await listMemories(actor, { kinds: ['goal'] })).filter((m) => !m.supersededBy);
    expect(goals).toHaveLength(1);
    expect(goals[0]!.content).toContain('refined');
  });
});

describe('personal snapshot + context', () => {
  beforeEach(() => { setTestDb(createFakeDb().db); });

  it('aggregates real owner state and is honestly empty when nothing exists', async () => {
    const empty = await buildPersonalStateSnapshot(actor);
    expect(empty.empty).toBe(true);
    await applyOnboardingAnswers(actor, { primary_goal: 'ship AOS', key_person: 'Sara — cofounder' }, 'sess1');
    const snap = await buildPersonalStateSnapshot(actor);
    expect(snap.empty).toBe(false);
    expect(snap.counts.goal).toBe(1);
    expect(snap.counts.person).toBe(1);
    const ctx = await buildPersonalContext(actor);
    expect(ctx.text).toMatch(/PERSON|GOAL/);
  });

  it('scope isolation: another user sees none of this owner\'s personal state', async () => {
    await applyOnboardingAnswers(actor, { primary_goal: 'private goal' }, 'sess1');
    const other = { actorId: 'someone-else', scope: 'user' as const, tenantId: null };
    const snap = await buildPersonalStateSnapshot(other);
    expect(snap.empty).toBe(true);
  });
});
