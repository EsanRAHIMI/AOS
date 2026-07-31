/**
 * D-210 — "tonight" is an answer, not a question.
 *
 * The owner said: "a new event for tonight, to go to the gym." Jarvis replied
 * with a form asking for the exact start and end time. Every input needed to
 * answer that was already in the system — what tonight means, what is already
 * on the calendar, and that an hour is a reasonable default. Asking was not
 * caution; it was declining to do the part of the job that required looking
 * something up, and it turned a five-second instruction into a conversation.
 *
 * `calendar_find_free_slot` is the tool that makes deciding cheaper than
 * asking. These tests pin the behaviours that keep it that way — above all,
 * that it always returns something the model can ACT on, including when the
 * window is full.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb, getDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { buildCoreToolFamilies } from '../src/agentcore/families.js';
import { storeGrant, CALENDAR_ACTOR_ID } from '../src/calendar/tokens.js';

const ENV = { GOOGLE_TOKEN_ENC_KEY: '0'.repeat(64) } as unknown as NodeJS.ProcessEnv;
const ACCOUNT = 'owner@example.com';
const ctx = {
  actorId: 'esan', role: 'owner' as const, isOwner: true, scope: 'user' as const,
  tenantId: null, userId: 'esan', runId: 'run_1', sessionId: 's1',
  taskId: null, workingSet: new Map<string, unknown>(),
};

/** Tonight, in absolute terms, for a fixed test day. */
const EVENING_FROM = '2026-07-31T18:00:00.000Z';
const EVENING_TO = '2026-07-31T22:00:00.000Z';

beforeEach(() => { setTestDb(createFakeDb().db); });

async function connect() {
  await storeGrant({
    actorId: CALENDAR_ACTOR_ID, accountEmail: ACCOUNT, refreshToken: 'r', accessToken: 'a',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scopes: [],
  }, ENV);
  await getDb().collection('calendars').insertOne({
    actorId: CALENDAR_ACTOR_ID, account: ACCOUNT, calendarId: 'primary', summary: 'تقویم اصلی',
    description: '', timeZone: 'Asia/Tehran', accessRole: 'owner', primary: true,
    selected: true, enabled: true, isAosCalendar: false, backgroundColor: '',
    updatedAt: new Date().toISOString(),
  } as never);
}

async function seedEvent(eventId: string, start: string, end: string, over: Record<string, unknown> = {}) {
  await getDb().collection('calendar_events').insertOne({
    actorId: CALENDAR_ACTOR_ID, account: ACCOUNT, calendarId: 'primary', eventId,
    summary: 'جلسه', description: '', location: '', start, end,
    allDay: false, status: 'confirmed', timeZone: 'Asia/Tehran',
    attendees: [], hangoutLink: '', htmlLink: '', recurringEventId: '',
    createdByAos: false, etag: '', updated: '', eventType: 'default',
    organizerEmail: '', syncedAt: new Date().toISOString(),
    ...over,
  } as never);
}

const run = (args: Record<string, unknown>) =>
  buildCoreToolFamilies().get('calendar_find_free_slot')!.executor(args, ctx);

describe('the tool exists and is reachable', () => {
  it('is registered and available', () => {
    const def = buildCoreToolFamilies().get('calendar_find_free_slot');
    expect(def).toBeDefined();
    // Reading the calendar is not a write; it must never pause for approval.
    expect(def!.definition.policyCategory).toBe('read_only');
  });

  it('refuses honestly when the calendar is not connected', async () => {
    const res = await run({ fromIso: EVENING_FROM, toIso: EVENING_TO });
    expect(res.ok).toBe(false);
    expect(res.summary).toContain('تقویم');
  });
});

describe('an empty evening', () => {
  beforeEach(connect);

  it('returns the start of the window as the first slot', async () => {
    const res = await run({ fromIso: EVENING_FROM, toIso: EVENING_TO, durationMinutes: 60 });
    const slots = (res.data as { slots: Array<{ start: string; end: string }> }).slots;
    expect(slots[0]?.start).toBe(EVENING_FROM);
    expect(slots[0]?.end).toBe('2026-07-31T19:00:00.000Z');
  });

  it('tells the model to ACT on the first slot rather than report options', async () => {
    // The summary is the instruction the model actually follows. If it reads
    // like a menu, the model hands the owner a menu.
    const res = await run({ fromIso: EVENING_FROM, toIso: EVENING_TO });
    expect(res.summary).toContain('create the event now');
    expect(res.summary).toContain('FIRST');
  });
});

describe('an evening with something already in it', () => {
  beforeEach(connect);

  it('finds the opening BEFORE the existing event when it is long enough', async () => {
    await seedEvent('ev_dinner', '2026-07-31T19:30:00.000Z', '2026-07-31T21:00:00.000Z');
    const res = await run({ fromIso: EVENING_FROM, toIso: EVENING_TO, durationMinutes: 60 });
    const slots = (res.data as { slots: Array<{ start: string }> }).slots;
    expect(slots[0]?.start).toBe(EVENING_FROM);
  });

  it('skips past an event that starts immediately and takes the gap after it', async () => {
    await seedEvent('ev_early', '2026-07-31T18:00:00.000Z', '2026-07-31T19:00:00.000Z');
    const res = await run({ fromIso: EVENING_FROM, toIso: EVENING_TO, durationMinutes: 60 });
    const slots = (res.data as { slots: Array<{ start: string }> }).slots;
    expect(slots[0]?.start).toBe('2026-07-31T19:00:00.000Z');
  });

  it('does not offer a gap shorter than the event needs', async () => {
    // 18:00–18:40 is free, which is not enough for a 60-minute session.
    await seedEvent('ev_a', '2026-07-31T18:40:00.000Z', '2026-07-31T19:00:00.000Z');
    const res = await run({ fromIso: EVENING_FROM, toIso: EVENING_TO, durationMinutes: 60 });
    const slots = (res.data as { slots: Array<{ start: string }> }).slots;
    expect(slots[0]?.start).toBe('2026-07-31T19:00:00.000Z');
  });

  it('ignores all-day events — "on leave" does not occupy an evening', async () => {
    // Treating an all-day row as a 24-hour block would report every evening as
    // busy, and send the model straight back to asking for a time.
    await seedEvent('ev_leave', '2026-07-31', '2026-08-01', { allDay: true });
    const res = await run({ fromIso: EVENING_FROM, toIso: EVENING_TO, durationMinutes: 60 });
    const slots = (res.data as { slots: unknown[] }).slots;
    expect(slots.length).toBeGreaterThan(0);
  });
});

describe('a full evening still produces an answer, not a question', () => {
  beforeEach(connect);

  it('reports the clash and forbids bouncing the question back', async () => {
    await seedEvent('ev_all', '2026-07-31T18:00:00.000Z', '2026-07-31T22:00:00.000Z');
    const res = await run({ fromIso: EVENING_FROM, toIso: EVENING_TO, durationMinutes: 60 });
    expect(res.ok).toBe(true);
    expect((res.data as { slots: unknown[] }).slots).toHaveLength(0);
    expect(res.summary).toContain('No free');
    // The negative carries its cause AND the next move.
    expect(res.summary).toContain('do not ask them to pick a time');
  });
});

describe('bad input fails loudly rather than guessing', () => {
  beforeEach(connect);

  it('rejects a window that ends before it starts', async () => {
    const res = await run({ fromIso: EVENING_TO, toIso: EVENING_FROM });
    expect(res.ok).toBe(false);
  });
});

describe('the prompt tells the model to decide', () => {
  it('carries the vague-time rule, and a version bump so caches miss', async () => {
    const { jarvisSystemPrompt, JARVIS_ROLE_PROMPT_VERSION } = await import('../src/jarvis/turn-runner.js');
    const p = jarvisSystemPrompt('fa', '');
    expect(p).toContain('VAGUE TIMES');
    expect(p).toContain('calendar_find_free_slot');
    // A changed prompt with an unchanged version is invisible to anything
    // keyed on the version.
    expect(JARVIS_ROLE_PROMPT_VERSION).toBe('jarvis-role-v10');
  });
});
