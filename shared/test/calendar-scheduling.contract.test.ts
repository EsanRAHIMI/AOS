/**
 * D-203 — two failures from one session.
 *
 *   "extend it to 16:30"      → 15:30–16:30  ✓
 *   "move it past 16:00"      → 16:00–16:30  ✗  half an hour vanished
 *   "find آپدیت AOS"          → "no such event"  ✗  the owner was looking at it
 *
 * The first is scheduling logic that was left to the model. The second is
 * Persian orthography: the same word stored with different code points.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb, getDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { foldFa, findEvents, readEventById, mirrorCoverage } from '../src/calendar/sync.js';
import { storeGrant, CALENDAR_ACTOR_ID } from '../src/calendar/tokens.js';
import { jarvisSystemPrompt } from '../src/jarvis/turn-runner.js';

const ENV = { GOOGLE_TOKEN_ENC_KEY: '0'.repeat(64) } as unknown as NodeJS.ProcessEnv;
const ACCOUNT = 'o@e.com';
beforeEach(() => { setTestDb(createFakeDb().db); });

async function connect() {
  await storeGrant({
    actorId: CALENDAR_ACTOR_ID, accountEmail: ACCOUNT, refreshToken: 'r', accessToken: 'a',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scopes: [],
  }, ENV);
  await getDb().collection('calendars').insertOne({
    actorId: CALENDAR_ACTOR_ID, account: ACCOUNT, calendarId: 'aos', summary: 'AOS',
    description: '', timeZone: 'Asia/Dubai', accessRole: 'owner', primary: false,
    selected: true, enabled: true, isAosCalendar: true, backgroundColor: '',
    updatedAt: new Date().toISOString(),
  } as never);
}

async function seed(over: Record<string, unknown> = {}) {
  await getDb().collection('calendar_events').insertOne({
    actorId: CALENDAR_ACTOR_ID, account: ACCOUNT, calendarId: 'aos', eventId: 'ev1',
    summary: 'آپدیت AOS', description: '', location: '',
    start: '2026-07-20T09:00:00.000Z', end: '2026-07-20T10:00:00.000Z',
    allDay: false, status: 'confirmed', timeZone: 'Asia/Dubai', recurringEventId: '',
    eventType: 'default', hangoutLink: '', htmlLink: '', organizerEmail: '',
    attendees: [], etag: '', updated: '', createdByAos: true,
    syncedAt: new Date().toISOString(),
    ...over,
  } as never);
}

/* -------------------------------------------------------- Persian folding */

describe('foldFa', () => {
  it('treats Arabic and Persian yeh as the same letter', () => {
    // Google stores whatever the keyboard produced; the owner types whatever
    // theirs produces. Byte-exact comparison between the two finds nothing.
    expect(foldFa('آپديت')).toBe(foldFa('آپدیت'));
  });

  it('treats Arabic and Persian kaf as the same letter', () => {
    expect(foldFa('كار')).toBe(foldFa('کار'));
  });

  it('ignores ZWNJ inside compounds', () => {
    expect(foldFa('بیمه‌نامه')).toBe(foldFa('بیمه نامه').replace(' ', ''));
  });

  it('normalises Persian and Arabic digits to Latin', () => {
    expect(foldFa('جلسه ۱۲')).toBe('جلسه 12');
    expect(foldFa('جلسه ١٢')).toBe('جلسه 12');
  });

  it('is case-insensitive for the Latin parts', () => {
    expect(foldFa('AOS Update')).toBe(foldFa('aos update'));
  });
});

describe('findEvents', () => {
  it('finds an event typed with the other yeh', async () => {
    await connect(); await seed();
    expect(await findEvents(CALENDAR_ACTOR_ID, 'آپديت')).toHaveLength(1);
  });

  it('searches the description and location too, not only the title', async () => {
    await connect();
    await seed({ eventId: 'ev2', summary: 'جلسه', description: 'بررسی آپدیت AOS' });
    const found = await findEvents(CALENDAR_ACTOR_ID, 'آپدیت AOS');
    expect(found.map((e) => e.eventId)).toContain('ev2');
  });

  it('still returns nothing for something that truly is not there', async () => {
    await connect(); await seed();
    expect(await findEvents(CALENDAR_ACTOR_ID, 'قرارداد بانک')).toHaveLength(0);
  });

  it('ignores an empty query instead of returning the whole calendar', async () => {
    await connect(); await seed();
    expect(await findEvents(CALENDAR_ACTOR_ID, '   ')).toHaveLength(0);
  });
});

describe('mirrorCoverage', () => {
  it('turns "I found nothing" into a fact the owner can act on', async () => {
    await connect(); await seed();
    const cov = await mirrorCoverage(CALENDAR_ACTOR_ID);
    expect(cov.events).toBe(1);
    expect(cov.earliest.slice(0, 10)).toBe('2026-07-20');
    expect(cov.perCalendar[0]).toMatchObject({ summary: 'AOS', enabled: true, events: 1 });
  });

  it('reports a calendar that is switched off, which is a reason not a mystery', async () => {
    await connect();
    await getDb().collection('calendars').insertOne({
      actorId: CALENDAR_ACTOR_ID, account: ACCOUNT, calendarId: 'off', summary: 'کار',
      description: '', timeZone: 'Asia/Dubai', accessRole: 'owner', primary: false,
      selected: true, enabled: false, isAosCalendar: false, backgroundColor: '',
      updatedAt: new Date().toISOString(),
    } as never);
    const cov = await mirrorCoverage(CALENDAR_ACTOR_ID);
    expect(cov.perCalendar.find((c) => c.summary === 'کار')?.enabled).toBe(false);
  });
});

/* ------------------------------------------------------- moving vs resizing */

describe('a move keeps the duration', () => {
  it('reads back the current times, which is what makes the shift possible', async () => {
    await connect(); await seed();
    const ev = await readEventById(CALENDAR_ACTOR_ID, 'ev1');
    expect(ev?.start).toBe('2026-07-20T09:00:00.000Z');
    expect(ev?.end).toBe('2026-07-20T10:00:00.000Z');
  });

  it('computes the shifted end from the stored duration, not from a guess', async () => {
    await connect(); await seed();
    const ev = (await readEventById(CALENDAR_ACTOR_ID, 'ev1'))!;
    const durMs = new Date(ev.end).getTime() - new Date(ev.start).getTime();
    expect(durMs).toBe(3_600_000);

    // "move it to 16:00" — the hour must survive the move.
    const newStart = new Date('2026-07-31T16:00:00.000Z');
    const newEnd = new Date(newStart.getTime() + durMs);
    expect(newEnd.toISOString()).toBe('2026-07-31T17:00:00.000Z');
  });

  it('returns null for an unknown id rather than inventing a duration', async () => {
    await connect(); await seed();
    expect(await readEventById(CALENDAR_ACTOR_ID, 'nope')).toBeNull();
  });
});

describe('the scheduling rules in the prompt', () => {
  const prompt = jarvisSystemPrompt('fa', '');

  it('says a move sends only the start', () => {
    expect(prompt).toContain('send ONLY the new start');
  });

  it('separates resizing from moving', () => {
    expect(prompt).toContain('To RESIZE');
  });

  it('requires the resulting start AND end to be reported', () => {
    expect(prompt).toContain('state the resulting start AND end');
  });

  it('separates "I found nothing" from "it does not exist"', () => {
    expect(prompt).toContain('are different sentences');
  });
});
