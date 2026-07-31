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
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import {
  createJarvisSession, beginTurn, completeTurn, buildTranscriptContext,
} from '../src/jarvis/session.js';
import { jarvisSystemPrompt } from '../src/jarvis/turn-runner.js';

const actor = { actorId: 'owner', scope: 'user' as const, tenantId: null };
beforeEach(() => { setTestDb(createFakeDb().db); });

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
