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
import { storeGrant } from '../src/calendar/tokens.js';
import { getDb } from '../src/db/index.js';

const KEY = '0'.repeat(64);
const ENV = { GOOGLE_TOKEN_ENC_KEY: KEY } as unknown as NodeJS.ProcessEnv;
const ctx = {
  actorId: 'esan', role: 'owner' as const, isOwner: true, scope: 'user' as const,
  tenantId: null, userId: 'esan', runId: 'run_1', sessionId: 's1',
  taskId: null, workingSet: new Map<string, unknown>(),
};

const ACCOUNT = 'owner@example.com';

beforeEach(() => { setTestDb(createFakeDb().db); });

async function connect() {
  await storeGrant({
    actorId: 'esan', accountEmail: ACCOUNT, refreshToken: 'r', accessToken: 'a',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scopes: [],
  }, ENV);
}

async function seedEvent(over: Record<string, unknown> = {}) {
  await getDb().collection('calendar_events').insertOne({
    actorId: 'esan', account: ACCOUNT, calendarId: 'primary', eventId: 'ev1',
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
    actorId: 'esan', account: ACCOUNT, calendarId: 'primary', summary: 'تقویم اصلی',
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
      actorId: 'esan', account: ACCOUNT, taskListId: '@default', taskId: 't1',
      title: 'ارسال گزارش', notes: '', status: 'needsAction',
      due: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      completed: '', parent: '', position: '', createdByAos: false, updated: '',
      syncedAt: new Date().toISOString(),
    } as never);
    const res = await buildCoreToolFamilies().get('calendar_tasks')!.executor({}, ctx);
    expect(res.summary).toContain('ارسال گزارش');
    expect(res.summary).toContain('OVERDUE');
  });

  it('declares every write as needing approval, so the loop always asks first', () => {
    const r = buildCoreToolFamilies();
    for (const name of ['calendar_create_event', 'calendar_update_event', 'calendar_create_task']) {
      expect(r.get(name)!.definition.requiresApproval, `${name} must be gated`).toBe(true);
    }
  });

  it('keeps reads ungated — an assistant that asks permission to look is useless', () => {
    const r = buildCoreToolFamilies();
    for (const name of ['calendar_agenda', 'calendar_next', 'calendar_tasks']) {
      expect(r.get(name)!.definition.requiresApproval).toBe(false);
      expect(r.get(name)!.definition.sideEffect).toBe('none');
    }
  });
});
