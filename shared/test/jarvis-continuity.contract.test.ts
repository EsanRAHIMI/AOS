/**
 * D-200 — the amnesia the owner reported.
 *
 * Transcript, verbatim:
 *
 *   Owner:  "find an event called آپدیت AOS"
 *   Jarvis: found it — 2026-07-20 09:00, calendar "AOS"
 *   Owner:  "which calendar and when was it saved?"
 *   Jarvis: "no event, mission or plan exists in any calendar"
 *
 * One question apart. Four independent defects produced it, and each alone was
 * sufficient, so all four are pinned here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb, collection } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import {
  createJarvisSession, beginTurn, completeTurn, buildTranscriptContext,
} from '../src/jarvis/session.js';
import { jarvisSystemPrompt } from '../src/jarvis/turn-runner.js';
import { COLLECTIONS } from '../src/constants/index.js';
import type { CalendarRef } from '../src/calendar/sync.js';

const actor = { actorId: 'owner', scope: 'user' as const, tenantId: null };
beforeEach(() => { setTestDb(createFakeDb().db); });

async function putCalendar(patch: Partial<CalendarRef> & { calendarId: string; summary: string; enabled: boolean }) {
  await collection<CalendarRef>(COLLECTIONS.CALENDARS).insertOne({
    actorId: 'owner', account: '', description: '', timeZone: '', accessRole: 'owner',
    primary: false, selected: true, backgroundColor: '', isAosCalendar: false,
    updatedAt: new Date().toISOString(), ...patch,
  } as CalendarRef);
}

async function say(sessionId: string, userText: string, replyText: string, toolFacts: string[] = []) {
  const t = await beginTurn(actor, sessionId, userText);
  await completeTurn(t.turnId, { replyText, status: 'completed', toolFacts });
  return t;
}

describe('the transcript the model actually receives', () => {
  it('carries the previous exchange, which is the whole of "continuing a conversation"', async () => {
    const s = await createJarvisSession(actor);
    await say(s.sessionId, 'رویدادی به اسم آپدیت AOS پیدا کن', 'یک رویداد پیدا شد.');
    const { text, usedTurns } = await buildTranscriptContext(actor, s.sessionId);
    expect(usedTurns).toBe(1);
    expect(text).toContain('آپدیت AOS');
  });

  it('keeps the tool result, not only the prose about it', async () => {
    // "In which calendar?" is answered from the record, and prose is a lossy
    // retelling of a record.
    const s = await createJarvisSession(actor);
    await say(s.sessionId, 'پیدا کن', 'یک رویداد پیدا شد.', [
      'calendar_find_event: • آپدیت AOS — 2026-07-20T09:00:00Z → 2026-07-20T09:30:00Z [AOS]',
    ]);
    const { text } = await buildTranscriptContext(actor, s.sessionId);
    expect(text).toContain('calendar_find_event');
    expect(text).toContain('[AOS]');
    expect(text).toContain('2026-07-20T09:00:00Z');
  });

  it('does not spend budget on the turn currently being answered', async () => {
    // `beginTurn` runs before the context is assembled, so the newest "turn"
    // is the question itself, with an empty reply.
    const s = await createJarvisSession(actor);
    await say(s.sessionId, 'سؤال قبلی', 'پاسخ قبلی');
    const inProgress = await beginTurn(actor, s.sessionId, 'سؤال جدید');
    const { text, usedTurns } = await buildTranscriptContext(actor, s.sessionId, { excludeTurnId: inProgress.turnId });
    expect(usedTurns).toBe(1);
    expect(text).toContain('پاسخ قبلی');
    expect(text).not.toContain('سؤال جدید');
  });

  it('omits a turn that is still running even without being told its id', async () => {
    const s = await createJarvisSession(actor);
    await say(s.sessionId, 'قبلی', 'پاسخ');
    await beginTurn(actor, s.sessionId, 'در حال اجرا');
    const { usedTurns } = await buildTranscriptContext(actor, s.sessionId);
    expect(usedTurns).toBe(1);
  });

  it('does not truncate away the detail a follow-up asks about', async () => {
    // The old limit was 400 characters — shorter than a structured reply, so
    // the calendar name and the exact time were exactly what got cut.
    const s = await createJarvisSession(actor);
    const long = `${'مقدمهٔ طولانی. '.repeat(40)}تقویم: AOS · زمان: 09:00`;
    await say(s.sessionId, 'کجا ثبت شد؟', long);
    const { text } = await buildTranscriptContext(actor, s.sessionId);
    expect(text).toContain('تقویم: AOS');
    expect(text).toContain('09:00');
  });

  it('never drops the most recent exchange, however tight the budget', async () => {
    // Forgetting the turn immediately before the question is the failure that
    // reads as amnesia rather than as forgetting.
    const s = await createJarvisSession(actor);
    await say(s.sessionId, 'قدیمی', 'پاسخ قدیمی');
    await say(s.sessionId, 'کجا ثبت شد؟', 'در تقویم AOS ساعت ۹');
    const { text, usedTurns } = await buildTranscriptContext(actor, s.sessionId, { tokenBudget: 1 });
    expect(usedTurns).toBe(1);
    expect(text).toContain('در تقویم AOS');
  });

  it('tells the model these turns are one conversation, not a list', async () => {
    const s = await createJarvisSession(actor);
    await say(s.sessionId, 'الف', 'ب');
    const { text } = await buildTranscriptContext(actor, s.sessionId);
    expect(text).toContain('SAME conversation');
    expect(text).toContain('must not contradict');
  });

  it('orders oldest first, so "then" and "after that" mean what they say', async () => {
    const s = await createJarvisSession(actor);
    await say(s.sessionId, 'اول', 'یک');
    await say(s.sessionId, 'دوم', 'دو');
    const { text } = await buildTranscriptContext(actor, s.sessionId);
    expect(text.indexOf('اول')).toBeLessThan(text.indexOf('دوم'));
  });
});

describe('the continuity rules in the prompt', () => {
  const prompt = jarvisSystemPrompt('fa', '');

  it('forbids silently reversing an earlier answer', () => {
    expect(prompt).toContain('Never contradict something you said earlier');
  });

  it('separates "my search found nothing" from "it does not exist"', () => {
    expect(prompt).toContain('does NOT mean the thing does not exist');
  });

  it('stops it declaring a capability missing that it just used', () => {
    // "تقویم گوگل شما متصل نیست" — said one turn after reading that calendar.
    expect(prompt).toContain('check the transcript');
  });
});

/**
 * D-206 — the D-205 fix, undone by the owner's own history.
 *
 * Verbatim: the owner asked (again, after D-205 shipped) whether Jarvis could
 * see the AOS calendar's content, and got back "احتمالاً در تقویمی با
 * همگام‌سازی غیرفعال (مانند «75 days Hard Challenge») ثبت شده است" — the exact
 * disabled calendar D-205 said must never be named. The tool itself was
 * already fixed; an EARLIER turn in the SAME session still had the name in
 * its `toolFacts` or `replyText` from before the fix, and CONTINUITY told the
 * model to trust what it said earlier rather than drop it. Redacting at read
 * time closes that gap regardless of when or why the name got in.
 */
describe('a disabled calendar cannot resurface from session history', () => {
  it('redacts the name out of an old replyText', async () => {
    await putCalendar({ calendarId: 'cal_off', summary: '75 days Hard Challenge', enabled: false });
    const s = await createJarvisSession(actor);
    await say(s.sessionId, 'قبلا این رو دیدی؟', 'احتمالاً در تقویمی مانند «75 days Hard Challenge» ثبت شده است.');
    const { text } = await buildTranscriptContext(actor, s.sessionId);
    expect(text).not.toContain('75 days Hard Challenge');
  });

  it('redacts the name out of old toolFacts, not just prose', async () => {
    await putCalendar({ calendarId: 'cal_off', summary: '75 days Hard Challenge', enabled: false });
    const s = await createJarvisSession(actor);
    await say(s.sessionId, 'تشخیص بده', 'یافته‌ها را دیدم.', [
      'calendar_diagnose: • 75 days Hard Challenge: google=21 mirrored=0',
    ]);
    const { text } = await buildTranscriptContext(actor, s.sessionId);
    expect(text).not.toContain('75 days Hard Challenge');
  });

  it('leaves an ACTIVE calendar\'s name alone', async () => {
    await putCalendar({ calendarId: 'cal_aos', summary: 'AOS', enabled: true, isAosCalendar: true });
    const s = await createJarvisSession(actor);
    await say(s.sessionId, 'پیدا کن', 'در تقویم AOS پیدا شد.');
    const { text } = await buildTranscriptContext(actor, s.sessionId);
    expect(text).toContain('AOS');
  });

  it('stops naming it in the rolling summary too', async () => {
    await putCalendar({ calendarId: 'cal_off', summary: '75 days Hard Challenge', enabled: false });
    const s = await createJarvisSession(actor);
    await collection(COLLECTIONS.JARVIS_SESSIONS).updateOne(
      { sessionId: s.sessionId } as never,
      { $set: { rollingSummary: 'قبلاً دربارهٔ 75 days Hard Challenge صحبت شد.' } } as never,
    );
    const { text } = await buildTranscriptContext(actor, s.sessionId);
    expect(text).not.toContain('75 days Hard Challenge');
  });

  it('never breaks the transcript when calendars cannot be read', async () => {
    // No calendars collection data at all — must degrade to "redact nothing",
    // not throw and lose the whole transcript.
    const s = await createJarvisSession(actor);
    await say(s.sessionId, 'سلام', 'سلام، چطور می‌توانم کمک کنم؟');
    const { text, usedTurns } = await buildTranscriptContext(actor, s.sessionId);
    expect(usedTurns).toBe(1);
    expect(text).toContain('چطور می‌توانم کمک کنم');
  });

  it('re-enabling the calendar lets its name appear again', async () => {
    await putCalendar({ calendarId: 'cal_off', summary: '75 days Hard Challenge', enabled: false });
    const s = await createJarvisSession(actor);
    await say(s.sessionId, 'قبلا این رو دیدی؟', 'در «75 days Hard Challenge» بود.');
    await collection<CalendarRef>(COLLECTIONS.CALENDARS).updateOne(
      { calendarId: 'cal_off' } as never, { $set: { enabled: true } } as never,
    );
    const { text } = await buildTranscriptContext(actor, s.sessionId);
    expect(text).toContain('75 days Hard Challenge');
  });
});

describe('the off-means-off rule outranks continuity in the prompt', () => {
  const prompt = jarvisSystemPrompt('fa', '');

  it('says explicitly that this rule wins over CONTINUITY', () => {
    expect(prompt).toContain('outranks CONTINUITY');
  });

  it("tells the model its own past mention does not make the name settled fact", () => {
    expect(prompt).toContain('do not treat your own past mention');
  });
});
