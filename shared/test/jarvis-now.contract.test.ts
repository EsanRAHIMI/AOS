/**
 * D-201 — the model has no clock, and could not act on what it had just read.
 *
 * Two failures from one conversation:
 *
 *   "set it for today 14:00"  → created on 2026-07-20, eleven days early
 *   "move the one you found"  → "not stored with an id that allows editing"
 *
 * Neither is a reasoning failure. The first is a missing input: nothing in the
 * context said what day it was, so the model supplied a plausible date from
 * training. The second is a missing output: reads printed a title and a time
 * but not the ids that the update tool requires.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb, getDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { nowContext, jarvisSystemPrompt } from '../src/jarvis/turn-runner.js';
import { DEFAULT_PREFERENCES } from '../src/settings/preferences.js';
import { buildCoreToolFamilies } from '../src/agentcore/families.js';
import { storeGrant, CALENDAR_ACTOR_ID } from '../src/calendar/tokens.js';

const ENV = { GOOGLE_TOKEN_ENC_KEY: '0'.repeat(64) } as unknown as NodeJS.ProcessEnv;

/* Preferences, not env (D-202): the timezone became a stored record the owner
 * can change from the settings page and Jarvis can change on request. */
const PREFS = { ...DEFAULT_PREFERENCES, timezone: 'Asia/Tehran' };
beforeEach(() => { setTestDb(createFakeDb().db); });

describe('nowContext', () => {
  // 2026-07-31 10:05 UTC is 13:35 the same day in Tehran (UTC+03:30).
  const now = new Date('2026-07-31T10:05:00.000Z');

  it('states today as an absolute date, which is the input that was missing', () => {
    expect(nowContext(now, PREFS)).toContain('today, local: 2026-07-31');
  });

  it('gives the exact instant, so nothing has to be inferred', () => {
    expect(nowContext(now, PREFS)).toContain('2026-07-31T10:05:00.000Z');
  });

  it('names the timezone — a time without one is a different meeting elsewhere', () => {
    const out = nowContext(now, PREFS);
    expect(out).toContain("owner's timezone: Asia/Tehran");
    expect(out).toContain('timeZone Asia/Tehran');
  });

  it('resolves the local clock in the owner\'s zone, not in UTC', () => {
    // Iran is UTC+03:30 all year — DST was abolished in 2022.
    expect(nowContext(now, PREFS)).toContain('local time now: 13:35');
  });

  it('spells out today, tomorrow and yesterday so no arithmetic is guessed', () => {
    const out = nowContext(now, PREFS);
    expect(out).toContain('"today" = 2026-07-31');
    expect(out).toContain('"tomorrow" = 2026-08-01');
    expect(out).toContain('"yesterday" = 2026-07-30');
  });

  it('gives the Jalali date too, since the owner schedules in both', () => {
    expect(nowContext(now, PREFS)).toMatch(/مرداد|امرداد/);
  });

  it('forbids taking the date from anywhere else', () => {
    expect(nowContext(now, PREFS)).toContain('Never guess a date');
  });

  it('rolls over midnight in the local zone, not UTC', () => {
    // 20:45 UTC is already 00:15 the NEXT day in Tehran.
    expect(nowContext(new Date('2026-07-31T20:45:00.000Z'), PREFS)).toContain('today, local: 2026-08-01');
  });
});

describe('the date rules in the prompt', () => {
  const prompt = jarvisSystemPrompt('fa', '');

  it('tells the model it has no clock of its own', () => {
    expect(prompt).toContain('you have no clock of your own');
  });

  it('requires relative dates to be resolved before the tool call', () => {
    expect(prompt).toContain('Resolve "today", "tomorrow"');
  });

  it('requires the timezone to travel with the time', () => {
    expect(prompt).toContain("Always send the owner's timezone");
  });
});

describe('reads carry the handle a write needs', () => {
  it('prints eventId and calendarId, so an event that was found can be moved', async () => {
    await storeGrant({
      actorId: CALENDAR_ACTOR_ID, accountEmail: 'o@e.com', refreshToken: 'r', accessToken: 'a',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scopes: [],
    }, ENV);
    await getDb().collection('calendars').insertOne({
      actorId: CALENDAR_ACTOR_ID, account: 'o@e.com', calendarId: 'aos', summary: 'AOS',
      description: '', timeZone: 'Asia/Tehran', accessRole: 'owner', primary: false,
      selected: true, enabled: true, isAosCalendar: true, backgroundColor: '',
      updatedAt: new Date().toISOString(),
    } as never);
    await getDb().collection('calendar_events').insertOne({
      actorId: CALENDAR_ACTOR_ID, account: 'o@e.com', calendarId: 'aos', eventId: 'ev_move_me',
      summary: 'آپدیت AOS', description: '', location: '',
      start: '2026-07-20T09:00:00.000Z', end: '2026-07-20T09:30:00.000Z',
      allDay: false, status: 'confirmed', timeZone: 'Asia/Tehran', recurringEventId: '',
      eventType: 'default', hangoutLink: '', htmlLink: '', organizerEmail: '',
      attendees: [], etag: '', updated: '', createdByAos: true,
      syncedAt: new Date().toISOString(),
    } as never);

    const ctx = {
      actorId: 'esan', role: 'owner' as const, isOwner: true, scope: 'user' as const,
      tenantId: null, userId: 'esan', runId: 'r', sessionId: 's', taskId: null,
      workingSet: new Map<string, unknown>(),
    };
    const res = await buildCoreToolFamilies().get('calendar_find_event')!.executor({ q: 'آپدیت' }, ctx);

    // Without these two lines the model can read the event and still be unable
    // to call calendar_update_event — which is exactly what it reported.
    expect(res.summary).toContain('eventId: ev_move_me');
    expect(res.summary).toContain('calendarId: aos');
    expect(res.summary).toContain('use these to update or move it');
  });

  it('points the update tool at the read tools that produce those ids', () => {
    const def = buildCoreToolFamilies().get('calendar_update_event')!.definition;
    expect(def.purpose).toContain('This is how you reschedule');
    expect(def.purpose).toContain('calendar_find_event');
  });
});
