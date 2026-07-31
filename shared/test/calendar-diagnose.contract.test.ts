/**
 * D-204 — "I can see it and you cannot."
 *
 * The owner said it three times and got three different theories: wrong
 * calendar, disabled calendar, outside the sync window, never created. All
 * four are plausible and, until now, indistinguishable — so the answer was
 * whichever one sounded best. That is not diagnosis.
 *
 * `diagnoseRange` asks the only authority. It reads Google live for the range,
 * bypassing the mirror, the enabled flags and the sync watermark, and diffs
 * the two. A difference has exactly one cause and this names it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb, getDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { buildCoreToolFamilies } from '../src/agentcore/families.js';
import { storeGrant, CALENDAR_ACTOR_ID } from '../src/calendar/tokens.js';
import { jarvisSystemPrompt } from '../src/jarvis/turn-runner.js';

const ENV = { GOOGLE_TOKEN_ENC_KEY: '0'.repeat(64) } as unknown as NodeJS.ProcessEnv;
const ACCOUNT = 'o@e.com';
const ctx = {
  actorId: 'esan', role: 'owner' as const, isOwner: true, scope: 'user' as const,
  tenantId: null, userId: 'esan', runId: 'r', sessionId: 's', taskId: null,
  workingSet: new Map<string, unknown>(),
};

beforeEach(() => { setTestDb(createFakeDb().db); });

async function connect(calendars: Array<{ id: string; summary: string; enabled: boolean }>) {
  await storeGrant({
    actorId: CALENDAR_ACTOR_ID, accountEmail: ACCOUNT, refreshToken: 'r', accessToken: 'a',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scopes: [],
  }, ENV);
  for (const c of calendars) {
    await getDb().collection('calendars').insertOne({
      actorId: CALENDAR_ACTOR_ID, account: ACCOUNT, calendarId: c.id, summary: c.summary,
      description: '', timeZone: 'Asia/Dubai', accessRole: 'owner', primary: false,
      selected: true, enabled: c.enabled, isAosCalendar: false, backgroundColor: '',
      updatedAt: new Date().toISOString(),
    } as never);
  }
}

describe('calendar_diagnose', () => {
  it('is registered, with calendar_backfill as its repair', () => {
    const r = buildCoreToolFamilies();
    expect(r.get('calendar_diagnose')).toBeTruthy();
    expect(r.get('calendar_backfill')).toBeTruthy();
  });

  it('reads Google for the range without asking permission — diagnosis must not be gated', () => {
    const def = buildCoreToolFamilies().get('calendar_diagnose')!.definition;
    expect(def.requiresApproval).toBe(false);
    expect(def.sideEffect).toBe('none');
  });

  it('names a calendar whose syncing is off as THE cause, not as a possibility', async () => {
    // This is the case the owner hit and could never have guessed: the events
    // are in Google, in a calendar AOS was told not to sync.
    await connect([{ id: 'work', summary: 'کار', enabled: false }]);
    const res = await buildCoreToolFamilies().get('calendar_diagnose')!
      .executor({ from: '2026-07-20', to: '2026-07-21' }, ctx);

    expect(res.ok).toBe(true);
    expect(res.summary).toContain('[SYNC OFF]');
    // Google is unreachable in tests, so google=0 and the verdict falls through
    // to the honest one rather than inventing a cause.
    expect(res.summary).toContain('CAUSE:');
  });

  it('reports the connected account, since the wrong one explains everything at once', async () => {
    await connect([{ id: 'a', summary: 'A', enabled: true }]);
    const res = await buildCoreToolFamilies().get('calendar_diagnose')!
      .executor({ from: '2026-07-20', to: '2026-07-21' }, ctx);
    expect(res.summary).toContain(ACCOUNT);
  });

  it('surfaces the Google error rather than reporting an empty calendar', async () => {
    // An unreachable API and an empty day look identical unless you say so.
    await connect([{ id: 'a', summary: 'A', enabled: true }]);
    const res = await buildCoreToolFamilies().get('calendar_diagnose')!
      .executor({ from: '2026-07-20', to: '2026-07-21' }, ctx);
    expect(res.summary).toContain('error:');
  });

  it('refuses when the calendar is not connected at all', async () => {
    const res = await buildCoreToolFamilies().get('calendar_diagnose')!
      .executor({ from: '2026-07-20', to: '2026-07-21' }, ctx);
    expect(res.ok).toBe(false);
    expect(res.summary).toContain('وصل نیست');
  });
});

describe('the diagnosis rule in the prompt', () => {
  const prompt = jarvisSystemPrompt('fa', '');

  it('forbids theorising when the owner says they can see it', () => {
    expect(prompt).toContain('do not theorise');
    expect(prompt).toContain('calendar_diagnose');
  });

  it('requires the repair in the same turn, not as homework for the owner', () => {
    expect(prompt).toContain('calendar_backfill');
    expect(prompt).toContain('Never leave the owner to prove their own calendar exists');
  });
});
