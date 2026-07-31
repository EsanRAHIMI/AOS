/**
 * D-209 — when a considerate assistant chooses to speak.
 *
 * The bug this module is written against is arithmetic, not logic: the
 * heartbeat pulses every five minutes, so ANY "is it time?" check that is not
 * idempotent fires twelve times an hour. A morning briefing delivered twelve
 * times is not a slightly worse morning briefing; it is the reason someone
 * turns the assistant off.
 *
 * So the tests here are mostly about firing ONCE, and about a gap meaning a
 * real opening in the owner's day rather than any moment nothing is scheduled.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb, collection } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { COLLECTIONS } from '../src/constants/index.js';
import { storeGrant, CALENDAR_ACTOR_ID } from '../src/calendar/tokens.js';
import {
  currentBriefingMoment, currentGap, deliverBriefingIfDue, alreadyDelivered,
  localDayKey, MIN_GAP_MINUTES,
} from '../src/presence/briefing-moments.js';
import { judgeInterrupt, dueHeldItems } from '../src/presence/attention.js';

const ACTOR = { actorId: 'user_owner', tenantId: null };
const ENV = { GOOGLE_TOKEN_ENC_KEY: '0'.repeat(64) } as unknown as NodeJS.ProcessEnv;
const ACCOUNT = 'owner@example.com';

/** Tehran is UTC+03:30 year-round — DST was abolished in 2022. */
const TEHRAN = 'Asia/Tehran';

beforeEach(() => { setTestDb(createFakeDb().db); });

async function setTimezone(tz: string): Promise<void> {
  await collection(COLLECTIONS.SYSTEM_SETTINGS).insertOne({
    key: 'owner_preferences', ownerId: 'owner', timezone: tz,
    language: 'fa-IR', currency: 'IRR', calendarSystem: 'jalali',
    weekStartsOn: 6, hourCycle: 'h23', numerals: 'latn',
    updatedAt: '2026-07-31T00:00:00.000Z',
  } as never);
}

async function connectCalendar(): Promise<void> {
  await storeGrant({
    actorId: CALENDAR_ACTOR_ID, accountEmail: ACCOUNT,
    accessToken: 'a', refreshToken: 'r',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scopes: [],
  }, ENV);
  /* `readAgenda` only returns events from ENABLED calendars (D-193e/D-205) —
   * a grant alone reads nothing. Seeding this is not test scaffolding; it is
   * the same precondition the owner has to satisfy in the UI. */
  await collection(COLLECTIONS.CALENDARS).insertOne({
    actorId: CALENDAR_ACTOR_ID, account: ACCOUNT, calendarId: 'primary',
    summary: 'Owner', primary: true, accessRole: 'owner',
    enabled: true, isAosCalendar: false, updatedAt: '2026-07-31T00:00:00.000Z',
  } as never);
}

async function seedEvent(startIso: string, endIso: string): Promise<void> {
  await collection(COLLECTIONS.CALENDAR_EVENTS).insertOne({
    actorId: CALENDAR_ACTOR_ID, account: ACCOUNT, calendarId: 'primary',
    eventId: `ev_${startIso}`, status: 'confirmed', summary: 'جلسه',
    start: startIso, end: endIso, allDay: false,
    updated: '2026-07-31T00:00:00.000Z', syncedAt: '2026-07-31T00:00:00.000Z',
  } as never);
}

describe('the three moments', () => {
  beforeEach(async () => { await setTimezone(TEHRAN); });

  it('finds the morning at the first waking hour, in the owner\'s zone', async () => {
    // 03:30 UTC = 07:00 Tehran.
    const m = await currentBriefingMoment({ at: new Date('2026-07-31T03:30:00.000Z') });
    expect(m?.kind).toBe('morning');
  });

  it('finds the evening at the last waking hour', async () => {
    // 18:30 UTC = 22:00 Tehran.
    const m = await currentBriefingMoment({ at: new Date('2026-07-31T18:30:00.000Z') });
    expect(m?.kind).toBe('evening');
  });

  it('finds NO moment in the middle of the night — held items stay held', async () => {
    // 00:30 UTC = 04:00 Tehran.
    expect(await currentBriefingMoment({ at: new Date('2026-07-31T00:30:00.000Z') })).toBeNull();
  });

  it('keys a moment on the owner\'s local day, so it does not roll over at UTC midnight', async () => {
    const prefs = { timezone: TEHRAN };
    // 21:00 UTC on the 30th is already the 31st in Tehran (00:30).
    expect(localDayKey(new Date('2026-07-30T21:00:00.000Z'), prefs)).toBe('2026-07-31');
  });
});

describe('a gap is a real opening, not merely unscheduled time', () => {
  beforeEach(async () => {
    await setTimezone(TEHRAN);
    await connectCalendar();
  });

  it('is not reported while the owner is inside an event', async () => {
    const at = new Date('2026-07-31T09:00:00.000Z'); // 12:30 Tehran
    await seedEvent('2026-07-31T08:30:00.000Z', '2026-07-31T09:30:00.000Z');
    expect(await currentGap(at)).toBeNull();
  });

  it('is not reported for the walk between two back-to-back meetings', async () => {
    const at = new Date('2026-07-31T09:00:00.000Z');
    await seedEvent('2026-07-31T08:00:00.000Z', '2026-07-31T08:55:00.000Z');
    await seedEvent('2026-07-31T09:10:00.000Z', '2026-07-31T10:00:00.000Z');
    // Ten minutes is a transition, not an opening.
    expect(await currentGap(at)).toBeNull();
  });

  it('is reported when the opening is long enough to act on', async () => {
    const at = new Date('2026-07-31T09:00:00.000Z');
    await seedEvent('2026-07-31T08:00:00.000Z', '2026-07-31T08:30:00.000Z');
    await seedEvent('2026-07-31T11:00:00.000Z', '2026-07-31T12:00:00.000Z');
    const gap = await currentGap(at);
    expect(gap).not.toBeNull();
    expect(gap!.minutes).toBeGreaterThanOrEqual(MIN_GAP_MINUTES);
    expect(gap!.minutes).toBe(120);
  });

  it('reports nothing when the calendar is not connected — not a false opening', async () => {
    setTestDb(createFakeDb().db); // wipe the grant
    await setTimezone(TEHRAN);
    expect(await currentGap(new Date('2026-07-31T09:00:00.000Z'))).toBeNull();
  });
});

describe('delivery fires once', () => {
  beforeEach(async () => { await setTimezone(TEHRAN); });

  it('delivers held items at the morning moment, then never again that morning', async () => {
    // Something was held overnight.
    await judgeInterrupt(ACTOR, {
      subjectId: 'held_overnight', subjectKind: 'test', headline: 'x', weight: 0.8,
    }, { state: 'quiet_hours', busyUntil: null, lastSpokeAt: null, at: '2026-07-31T00:30:00.000Z' });

    const morning = new Date('2026-07-31T03:30:00.000Z'); // 07:00 Tehran
    const first = await deliverBriefingIfDue(ACTOR, { at: morning });
    expect(first).not.toBeNull();
    expect(first!.moment.kind).toBe('morning');
    expect(first!.items.map((i) => i.subjectId)).toContain('held_overnight');

    // The pulse asks again five minutes later. Nothing must happen.
    const second = await deliverBriefingIfDue(ACTOR, { at: new Date('2026-07-31T03:35:00.000Z') });
    expect(second).toBeNull();
  });

  it('records the moment in the same ledger as every other decision', async () => {
    await judgeInterrupt(ACTOR, {
      subjectId: 'held2', subjectKind: 'test', headline: 'x', weight: 0.8,
    }, { state: 'quiet_hours', busyUntil: null, lastSpokeAt: null, at: '2026-07-31T00:30:00.000Z' });

    const at = new Date('2026-07-31T03:30:00.000Z');
    const d = await deliverBriefingIfDue(ACTOR, { at });
    expect(await alreadyDelivered(ACTOR, d!.moment.momentKey)).toBe(true);
  });

  it('marks the items delivered, so a later moment does not repeat them', async () => {
    await judgeInterrupt(ACTOR, {
      subjectId: 'held3', subjectKind: 'test', headline: 'x', weight: 0.8,
    }, { state: 'quiet_hours', busyUntil: null, lastSpokeAt: null, at: '2026-07-31T00:30:00.000Z' });

    await deliverBriefingIfDue(ACTOR, { at: new Date('2026-07-31T03:30:00.000Z') });
    expect((await dueHeldItems(ACTOR)).map((i) => i.subjectId)).not.toContain('held3');
  });

  it('says NOTHING at a real moment with nothing held — silence beats an empty briefing', async () => {
    const d = await deliverBriefingIfDue(ACTOR, { at: new Date('2026-07-31T03:30:00.000Z') });
    expect(d).toBeNull();
  });

  it('does not deliver outside a moment, however much is held', async () => {
    await judgeInterrupt(ACTOR, {
      subjectId: 'held4', subjectKind: 'test', headline: 'x', weight: 0.9,
    }, { state: 'quiet_hours', busyUntil: null, lastSpokeAt: null, at: '2026-07-31T00:30:00.000Z' });
    // 01:00 UTC = 04:30 Tehran — the middle of the night.
    expect(await deliverBriefingIfDue(ACTOR, { at: new Date('2026-07-31T01:00:00.000Z') })).toBeNull();
  });
});
