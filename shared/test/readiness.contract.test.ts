/**
 * D-208 — readiness gaps: what the OWNER has not supplied yet.
 *
 * The failure mode this guards against is nagging. A readiness report that
 * lists things a "good setup" has, rather than things this setup actually
 * lacks, trains the owner to ignore it — and then the one gap that mattered
 * is ignored with the rest. So every test here asserts one of two properties:
 *
 *   SILENT WHEN SATISFIED  — a satisfied check emits nothing at all.
 *   GROUNDED WHEN NOT      — a reported gap corresponds to real absent state,
 *                            and names one concrete action.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb, collection } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { COLLECTIONS } from '../src/constants/index.js';
import { assessReadiness } from '../src/happenings/readiness.js';
import { storeGrant, CALENDAR_ACTOR_ID } from '../src/calendar/tokens.js';

const ACTOR = { actorId: 'user_owner', tenantId: null };
const KEY = { GOOGLE_TOKEN_ENC_KEY: '0'.repeat(64) } as unknown as NodeJS.ProcessEnv;
/** A fully-configured environment: no model gap should be reported from it. */
const ENV_WITH_MODEL = { ...KEY, ANTHROPIC_API_KEY: 'sk-test' } as unknown as NodeJS.ProcessEnv;

beforeEach(() => { setTestDb(createFakeDb().db); });

async function connectCalendar(): Promise<void> {
  await storeGrant({
    actorId: CALENDAR_ACTOR_ID, accountEmail: 'owner@example.com',
    accessToken: 'a', refreshToken: 'r',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scopes: [],
  }, KEY);
}

async function seedCalendar(enabled: boolean): Promise<void> {
  await connectCalendar();
  await collection(COLLECTIONS.CALENDARS).insertOne({
    actorId: CALENDAR_ACTOR_ID, account: 'owner@example.com',
    calendarId: 'primary', summary: 'Owner', primary: true,
    accessRole: 'owner', enabled, isAosCalendar: false,
    updatedAt: '2026-07-31T09:00:00.000Z',
  } as never);
}

describe('grounding — a gap means real absent state', () => {
  it('reports a bare install honestly: no model, no calendar, no goals, no memory', async () => {
    const gaps = await assessReadiness(ACTOR, KEY);
    const ids = gaps.map((g) => g.gapId);
    expect(ids).toContain('model_provider');
    expect(ids).toContain('calendar_not_connected');
    expect(ids).toContain('no_missions');
    expect(ids).toContain('empty_memory');
  });

  it('puts what BLOCKS first — the owner reads top-down', async () => {
    const gaps = await assessReadiness(ACTOR, KEY);
    const severities = gaps.map((g) => g.severity);
    const firstLimiting = severities.indexOf('limiting');
    const lastBlocking = severities.lastIndexOf('blocking');
    if (firstLimiting >= 0 && lastBlocking >= 0) expect(lastBlocking).toBeLessThan(firstLimiting);
  });

  it('gives every gap a consequence AND exactly one action — never a bare complaint', async () => {
    const gaps = await assessReadiness(ACTOR, KEY);
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) {
      expect(g.consequence.length).toBeGreaterThan(10);
      expect(g.action.length).toBeGreaterThan(10);
    }
  });
});

describe('silence — a satisfied check says nothing', () => {
  it('stops reporting the model gap once a provider is configured', async () => {
    const gaps = await assessReadiness(ACTOR, ENV_WITH_MODEL);
    expect(gaps.map((g) => g.gapId)).not.toContain('model_provider');
  });

  it('stops reporting the calendar gap once connected AND synced AND enabled', async () => {
    await seedCalendar(true);
    const ids = (await assessReadiness(ACTOR, ENV_WITH_MODEL)).map((g) => g.gapId);
    expect(ids).not.toContain('calendar_not_connected');
    expect(ids).not.toContain('calendar_not_synced');
    expect(ids).not.toContain('calendar_all_disabled');
  });
});

describe('the three calendar states are distinguished, because the fixes differ', () => {
  it('connected but never synced is NOT "not connected"', async () => {
    await connectCalendar();
    const ids = (await assessReadiness(ACTOR, ENV_WITH_MODEL)).map((g) => g.gapId);
    expect(ids).toContain('calendar_not_synced');
    expect(ids).not.toContain('calendar_not_connected');
  });

  it('every calendar switched off is a DECISION, reported as its own gap', async () => {
    // The owner turned these off deliberately (D-205). Telling them the
    // calendar is "not connected" would send them to reconnect an account
    // that is already connected and working.
    await seedCalendar(false);
    const ids = (await assessReadiness(ACTOR, ENV_WITH_MODEL)).map((g) => g.gapId);
    expect(ids).toContain('calendar_all_disabled');
    expect(ids).not.toContain('calendar_not_connected');
    expect(ids).not.toContain('calendar_not_synced');
  });
});

describe('preferences — "chose this" vs "never looked"', () => {
  it('flags defaults the owner never confirmed, and names the timezone at risk', async () => {
    const gap = (await assessReadiness(ACTOR, ENV_WITH_MODEL)).find((g) => g.gapId === 'preferences_unconfirmed');
    expect(gap).toBeDefined();
    // The shipped default must appear in the title: a wrong zone is invisible
    // until someone reads it back to the owner.
    expect(gap!.title).toContain('Asia/Dubai');
  });

  it('goes quiet once preferences are actually stored', async () => {
    await collection(COLLECTIONS.SYSTEM_SETTINGS).insertOne({
      key: 'owner_preferences', ownerId: 'owner', timezone: 'Asia/Tehran',
      language: 'fa-IR', currency: 'IRR', calendarSystem: 'jalali',
      weekStartsOn: 6, hourCycle: 'h23', numerals: 'latn',
      updatedAt: '2026-07-31T09:00:00.000Z',
    } as never);
    const ids = (await assessReadiness(ACTOR, ENV_WITH_MODEL)).map((g) => g.gapId);
    expect(ids).not.toContain('preferences_unconfirmed');
  });
});

describe('resilience — a broken check must not take the report down', () => {
  it('still returns the other gaps when a store is unreachable', async () => {
    // No DB at all: every DB-backed check fails. The env-backed model check
    // does not, and must still be reported.
    setTestDb(null as never);
    const gaps = await assessReadiness(ACTOR, KEY);
    expect(gaps.map((g) => g.gapId)).toContain('model_provider');
  });
});
