/**
 * D-195 — Jarvis can finally see the week.
 *
 * The engine, the routes and the page all existed; the agent had no tools, so
 * asked "what's tomorrow?" it answered from nothing. These tests execute the
 * real registered tools against a seeded mirror, because a tool that is merely
 * *registered* is exactly the failure mode this is fixing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { buildCoreToolFamilies } from '../src/agentcore/families.js';
import { storeGrant, CALENDAR_ACTOR_ID } from '../src/calendar/tokens.js';
import { getDb } from '../src/db/index.js';

/**
 * Run a write and report how far it got.
 *
 * Past the policy, the executor calls Google — unconfigured here, so it comes
 * back as `FAILED —`. That is the PASS signal: it means nothing REFUSED the
 * write, which is what distinguishes "the gate opened" from "the gate never
 * existed". Since D-196 the executor catches its own errors, so a thrown
 * exception here is itself a regression.
 */
async function attemptWrite(args: Record<string, unknown>): Promise<string> {
  const res = await buildCoreToolFamilies().get('calendar_create_event')!.executor(args, ctx);
  return res.summary.includes('FAILED') ? `REACHED_GOOGLE: ${res.summary}` : res.summary;
}

const KEY = '0'.repeat(64);
const ENV = { GOOGLE_TOKEN_ENC_KEY: KEY } as unknown as NodeJS.ProcessEnv;
/* The loop hands tools a REAL user id — not the fixed key the calendar grant
 * is stored under. That mismatch is the D-195b bug, so the fixture keeps it. */
const ctx = {
  actorId: 'esan', role: 'owner' as const, isOwner: true, scope: 'user' as const,
  tenantId: null, userId: 'esan', runId: 'run_1', sessionId: 's1',
  taskId: null, workingSet: new Map<string, unknown>(),
};

const ACCOUNT = 'owner@example.com';
const GRANT_ACTOR = CALENDAR_ACTOR_ID;   // 'owner' — NOT ctx.actorId

beforeEach(() => { setTestDb(createFakeDb().db); });

async function connect() {
  await storeGrant({
    actorId: GRANT_ACTOR, accountEmail: ACCOUNT, refreshToken: 'r', accessToken: 'a',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scopes: [],
  }, ENV);
}

async function seedEvent(over: Record<string, unknown> = {}) {
  await getDb().collection('calendar_events').insertOne({
    actorId: GRANT_ACTOR, account: ACCOUNT, calendarId: 'primary', eventId: 'ev1',
    summary: 'جلسهٔ طراحی', description: 'بررسی نسخهٔ جدید', location: 'دفتر',
    start: new Date(Date.now() + 30 * 60_000).toISOString(),
    end: new Date(Date.now() + 90 * 60_000).toISOString(),
    allDay: false, status: 'confirmed', timeZone: 'Asia/Tehran',
    attendees: [{ email: 'a@b.c', responseStatus: '' }], hangoutLink: '', htmlLink: '',
    recurringEventId: '', createdByAos: false, etag: '', updated: '',
    eventType: 'default', organizerEmail: '', syncedAt: new Date().toISOString(),
    ...over,
  } as never);
  await getDb().collection('calendars').insertOne({
    actorId: GRANT_ACTOR, account: ACCOUNT, calendarId: 'primary', summary: 'تقویم اصلی',
    description: '', timeZone: 'Asia/Tehran', accessRole: 'owner', primary: true,
    selected: true, enabled: true, isAosCalendar: false, backgroundColor: '',
    updatedAt: new Date().toISOString(),
  } as never);
}

describe('calendar tool family', () => {
  it('registers the read tools the assistant needs', () => {
    const r = buildCoreToolFamilies();
    for (const name of ['calendar_agenda', 'calendar_next', 'calendar_tasks', 'calendar_list']) {
      expect(r.get(name), `${name} must be registered`).toBeTruthy();
    }
  });

  it('resolves the grant by the owner key, not by the caller id (D-195b)', async () => {
    // The regression: a connected, fully synced calendar reported
    // "تقویم وصل نیست" because the tool looked it up under the loop's user id.
    await connect();
    await seedEvent();
    const res = await buildCoreToolFamilies().get('calendar_agenda')!.executor({ days: 2 }, ctx);
    expect(res.ok, res.summary).toBe(true);
    expect(res.summary).not.toContain('وصل نیست');
  });

  it('refuses a non-owner caller — the fixed key must not become a back door', async () => {
    await connect();
    await seedEvent();
    const res = await buildCoreToolFamilies().get('calendar_agenda')!
      .executor({ days: 2 }, { ...ctx, isOwner: false, role: 'agent' as never });
    expect(res.ok).toBe(false);
    expect(res.summary).toContain('مالک');
  });

  it('says plainly that the calendar is not connected instead of returning nothing', async () => {
    const res = await buildCoreToolFamilies().get('calendar_agenda')!.executor({}, ctx);
    expect(res.ok).toBe(false);
    expect(res.summary).toContain('وصل نیست');
  });

  it('reads real events with the detail that avoids a follow-up question', async () => {
    await connect();
    await seedEvent();
    const res = await buildCoreToolFamilies().get('calendar_agenda')!.executor({ days: 2 }, ctx);
    expect(res.ok).toBe(true);
    expect(res.summary).toContain('جلسهٔ طراحی');
    expect(res.summary).toContain('دفتر');              // location
    expect(res.summary).toContain('بررسی نسخهٔ جدید');   // description
    expect(res.summary).toContain('تقویم اصلی');         // which calendar
    expect(res.summary).toContain('guests: 1');
  });

  it('counts down to what is next, and stays quiet when nothing is close', async () => {
    await connect();
    await seedEvent();
    const tool = buildCoreToolFamilies().get('calendar_next')!;

    const soon = await tool.executor({ withinMinutes: 60 }, ctx);
    expect(soon.summary).toMatch(/starts in \d+ minute/);

    const narrow = await tool.executor({ withinMinutes: 5 }, ctx);
    expect(narrow.summary).toContain('Nothing scheduled');
  });

  it('leaves all-day events out of "what is next" — there is no time to count to', async () => {
    await connect();
    await seedEvent({ eventId: 'ev2', allDay: true });
    const res = await buildCoreToolFamilies().get('calendar_next')!.executor({ withinMinutes: 240 }, ctx);
    expect(res.summary).not.toContain('ev2');
  });

  it('marks an overdue task rather than listing it like any other', async () => {
    await connect();
    await getDb().collection('calendar_tasks').insertOne({
      actorId: GRANT_ACTOR, account: ACCOUNT, taskListId: '@default', taskId: 't1',
      title: 'ارسال گزارش', notes: '', status: 'needsAction',
      due: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      completed: '', parent: '', position: '', createdByAos: false, updated: '',
      syncedAt: new Date().toISOString(),
    } as never);
    const res = await buildCoreToolFamilies().get('calendar_tasks')!.executor({}, ctx);
    expect(res.summary).toContain('ارسال گزارش');
    expect(res.summary).toContain('OVERDUE');
  });

  it('keeps reads ungated — an assistant that asks permission to look is useless', () => {
    const r = buildCoreToolFamilies();
    for (const name of ['calendar_agenda', 'calendar_next', 'calendar_tasks']) {
      expect(r.get(name)!.definition.requiresApproval).toBe(false);
      expect(r.get(name)!.definition.sideEffect).toBe('none');
    }
  });
});

/**
 * D-195c — the write that never happened.
 *
 * Asked to add an event, Jarvis replied "در حال ثبت رویداد هستم" and did
 * nothing. `requiresApproval: true` appends "(requires owner approval before
 * it runs)" to the tool description; the model read it, decided it lacked
 * permission, and never called the tool — so the loop's approval gate never
 * fired either. A promise with no call is the worst possible output: it looks
 * like success.
 */
describe('calendar writes are callable, and gated where it actually matters', () => {
  it('does not tell the model it needs permission before it has even chosen a calendar', () => {
    const r = buildCoreToolFamilies();
    for (const name of ['calendar_create_event', 'calendar_update_event', 'calendar_create_task']) {
      expect(r.get(name)!.definition.requiresApproval, `${name} must be callable`).toBe(false);
    }
  });

  it('keeps writes owner-only and safe-mode-blockable — loosening the gate is not removing it', () => {
    const r = buildCoreToolFamilies();
    for (const name of ['calendar_create_event', 'calendar_update_event']) {
      expect(r.get(name)!.definition.ownerOnly).toBe(true);
      expect(r.get(name)!.definition.sideEffect).toBe('external_write');
    }
  });

  /**
   * D-195d — the friction that made this unusable.
   *
   * The owner said "یک رویداد از ۱۲:۳۰ تا ۱۳ در تقویم من ثبت کن" and was asked
   * "اجازه می‌دهید در تقویم شما ثبت کنم؟" — permission for the exact thing
   * just requested. Then, with no AOS calendar created yet, the target
   * resolved to null and the reason became "تقویم مقصد شناسایی نشد", so
   * confirming did nothing, forever.
   */
  it('just writes to the owner\'s own calendar — asking permission for it is friction, not governance', async () => {
    await connect();
    await seedEvent();                       // seeds 'primary', accessRole owner
    const out = await attemptWrite({
      summary: 'آپدیت پروژه', start: '2026-07-31T12:00:00+03:30', end: '2026-07-31T13:00:00+03:30',
      calendarId: 'primary',
    });
    expect(out).not.toContain('APPROVAL REQUIRED');
    expect(out).toContain('REACHED_GOOGLE');
  });

  it('resolves "primary" to the owner\'s calendar rather than failing to identify a target', async () => {
    await connect();
    await seedEvent();
    const out = await attemptWrite({
      summary: 'x', start: '2026-07-31T12:00:00Z', end: '2026-07-31T13:00:00Z', calendarId: 'primary',
    });
    expect(out).not.toContain('شناسایی نشد');
    expect(out).not.toContain('پیدا نشد');
  });

  it('says plainly that a read-only calendar cannot be written to, instead of asking for an approval that cannot help', async () => {
    await connect();
    await seedEvent();
    await getDb().collection('calendars').insertOne({
      actorId: GRANT_ACTOR, account: ACCOUNT, calendarId: 'shared@x.com', summary: 'تقویم همکار',
      description: '', timeZone: 'Asia/Tehran', accessRole: 'reader', primary: false,
      selected: true, enabled: true, isAosCalendar: false, backgroundColor: '',
      updatedAt: new Date().toISOString(),
    } as never);
    const res = await buildCoreToolFamilies().get('calendar_create_event')!.executor({
      summary: 'x', start: '2026-07-31T12:00:00Z', end: '2026-07-31T13:00:00Z', calendarId: 'shared@x.com',
    }, ctx);
    expect(res.ok).toBe(false);
    expect(res.summary).toContain('CANNOT WRITE');
    expect(res.summary).toContain('اجازهٔ نوشتن ندارید');
    expect(res.summary).not.toContain('APPROVAL REQUIRED');
  });

  it('treats guests as needing approval even in the AOS calendar — those are real emails', async () => {
    await connect();
    await seedEvent({ eventId: 'aos1', calendarId: 'aoscal' });
    await getDb().collection('calendars').insertOne({
      actorId: GRANT_ACTOR, account: ACCOUNT, calendarId: 'aoscal', summary: 'AOS · Autonomous OS',
      description: '', timeZone: 'Asia/Tehran', accessRole: 'owner', primary: false,
      selected: true, enabled: true, isAosCalendar: true, backgroundColor: '',
      updatedAt: new Date().toISOString(),
    } as never);
    const res = await buildCoreToolFamilies().get('calendar_create_event')!.executor({
      summary: 'x', start: '2026-07-31T12:00:00Z', end: '2026-07-31T13:00:00Z',
      attendees: ['someone@example.com'], calendarId: 'primary',
    }, ctx);
    expect(res.ok).toBe(false);
    expect(res.summary).toContain('مهمان');
    // And the refusal must be actionable in ONE more turn, not a loop.
    expect(res.summary).toContain('SAME arguments plus confirm: true');
  });

  it('goes ahead once the owner has confirmed — a confirmation the system ignores is worse than none', async () => {
    await connect();
    await seedEvent();
    const out = await attemptWrite({
      summary: 'x', start: '2026-07-31T12:00:00Z', end: '2026-07-31T13:00:00Z',
      attendees: ['someone@example.com'], calendarId: 'primary', confirm: true,
    });
    expect(out).not.toContain('APPROVAL REQUIRED');
    expect(out).toContain('REACHED_GOOGLE');
  });
});

/**
 * D-199b — "what happened to the event I asked for?"
 *
 * Neither of us could answer, because every read was scoped to a date range
 * and to enabled calendars. An event on the wrong day, in a calendar switched
 * off, or outside the synced window was simply invisible — indistinguishable
 * from never having been created. This search removes all three filters, so
 * the answer is evidence instead of a guess, including the useful negative.
 */
describe('calendar_find_event', () => {
  it('finds an event outside the date range every other read is scoped to', async () => {
    await connect();
    await seedEvent({ eventId: 'far', summary: 'آپدیت AOS', start: '2027-01-05T09:00:00.000Z', end: '2027-01-05T10:00:00.000Z' });
    const res = await buildCoreToolFamilies().get('calendar_find_event')!.executor({ q: 'آپدیت' }, ctx);
    expect(res.ok).toBe(true);
    expect(res.summary).toContain('آپدیت AOS');
  });

  it('matches case-insensitively on part of the title', async () => {
    await connect();
    await seedEvent({ eventId: 'x', summary: 'Weekly AOS Review' });
    const res = await buildCoreToolFamilies().get('calendar_find_event')!.executor({ q: 'aos rev' }, ctx);
    expect(res.summary).toContain('Weekly AOS Review');
  });

  it('says plainly that nothing matched, and names the three places it could be hiding', async () => {
    await connect();
    await seedEvent();
    const res = await buildCoreToolFamilies().get('calendar_find_event')!.executor({ q: 'چیزی که وجود ندارد' }, ctx);
    expect(res.summary).toContain('No mirrored event matches');
    expect(res.summary).toContain('not synced');
    expect(res.summary).toContain('do not guess');
  });

  it('treats a title with regex characters as text, not as a pattern', async () => {
    await connect();
    await seedEvent({ eventId: 'r', summary: 'Review (Q3) [draft]' });
    const res = await buildCoreToolFamilies().get('calendar_find_event')!.executor({ q: '(Q3)' }, ctx);
    expect(res.ok).toBe(true);
    expect(res.summary).toContain('Review (Q3)');
  });
});
