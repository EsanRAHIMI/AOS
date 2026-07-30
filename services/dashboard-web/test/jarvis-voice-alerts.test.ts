/**
 * D-195 — speech shaping and pre-event alerts.
 *
 * Both of these fail in ways nobody reports as a bug. Bad speech is heard as
 * "the assistant sounds robotic" and bad alert logic is heard as "it nags" or
 * "it stayed quiet" — neither points at a line of code. So the rules are
 * pinned here.
 */
import { describe, it, expect } from 'vitest';
import { pickVoice, speechText, chunkForSpeech, alertSentence } from '@/lib/speech';
import { dueAlerts, pruneFired, type AlertEvent } from '@/lib/eventAlerts';

/* ------------------------------------------------------------ voice pick */

describe('pickVoice', () => {
  const voices = [
    { name: 'Samantha', lang: 'en-US', default: true },
    { name: 'Google فارسی', lang: 'fa-IR' },
    { name: 'Dariush (Compact)', lang: 'fa-IR' },
  ];

  it('never hands a Persian sentence to an English voice', () => {
    expect(pickVoice(voices, 'fa-IR')?.lang).toBe('fa-IR');
  });

  it('stays silent rather than speaking gibberish when no Persian voice exists', () => {
    expect(pickVoice([{ name: 'Samantha', lang: 'en-US' }], 'fa-IR')).toBeNull();
  });

  it('prefers the natural-sounding voice over the compact one', () => {
    expect(pickVoice(voices, 'fa-IR')?.name).toBe('Google فارسی');
  });

  it('accepts a regional variant of the same language', () => {
    expect(pickVoice([{ name: 'X', lang: 'fa_IR' }], 'fa-IR')?.name).toBe('X');
  });
});

/* ------------------------------------------------------------ normalising */

describe('speechText', () => {
  it('speaks a time as a time, not as digits and a colon', () => {
    expect(speechText('جلسه ساعت 14:30 است')).toContain('ساعت 14 و 30 دقیقه');
  });

  it('drops the minutes when they are zero', () => {
    expect(speechText('09:00')).toBe('ساعت 9');
  });

  it('does not read markdown punctuation aloud', () => {
    const out = speechText('## عنوان\n\n- **مهم**: یک نکته\n- [لینک](https://x.com)');
    expect(out).not.toMatch(/[#*\[\]()]/);
    expect(out).toContain('مهم');
    expect(out).toContain('لینک');
  });

  it('summarises code instead of spelling it out', () => {
    const out = speechText('این را ببینید:\n```ts\nconst a = 1;\n```');
    expect(out).toContain('بلوک کد');
    expect(out).not.toContain('const');
  });

  it('turns blank lines into a full stop so sentences do not run together', () => {
    expect(speechText('یک\n\nدو')).toBe('یک. دو');
  });

  it('removes emoji rather than naming them', () => {
    expect(speechText('سلام 🎉 دنیا')).toBe('سلام دنیا');
  });
});

/* ---------------------------------------------------------------- chunking */

describe('chunkForSpeech', () => {
  it('splits long text so the engine does not truncate mid-answer', () => {
    const long = Array.from({ length: 12 }, (_, i) => `این جملهٔ شمارهٔ ${i} است.`).join(' ');
    const chunks = chunkForSpeech(long, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
  });

  it('never breaks a word in half', () => {
    const chunks = chunkForSpeech('یک'.repeat(3) + ' ' + 'کلمهطولانیفارسی '.repeat(20), 60);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toContain('کلمهطولانیفارسی');
  });

  it('keeps a short answer as one utterance', () => {
    expect(chunkForSpeech('بله، انجام شد.')).toEqual(['بله، انجام شد.']);
  });

  it('returns nothing for nothing', () => {
    expect(chunkForSpeech('')).toEqual([]);
  });
});

/* ---------------------------------------------------------------- sentence */

describe('alertSentence', () => {
  const ev = {
    summary: 'جلسهٔ طراحی',
    start: '2026-08-01T10:00:00.000Z',
    end: '2026-08-01T10:45:00.000Z',
    location: 'دفتر',
    attendees: [{}, {}],
    hangoutLink: 'https://meet.google.com/x',
  };

  it('leads with what and when, then the detail that changes a decision', () => {
    const s = alertSentence(ev, 10);
    expect(s).toContain('جلسهٔ طراحی');
    expect(s).toContain('10 دقیقهٔ دیگر');
    expect(s).toContain('45 دقیقه طول می‌کشد');
    expect(s).toContain('دفتر');
    expect(s).toContain('2 مهمان');
    expect(s).toContain('لینک میت');
  });

  it('says "now" instead of "0 minutes"', () => {
    expect(alertSentence(ev, 0)).toContain('همین الان');
  });

  it('uses the singular for one minute', () => {
    expect(alertSentence(ev, 1)).toContain('یک دقیقهٔ دیگر');
  });
});

/* ------------------------------------------------------------ alert timing */

const at = (isoMinutesFromNow: number, id = 'e1'): AlertEvent => ({
  eventId: id,
  summary: 'رویداد',
  start: new Date(Date.now() + isoMinutesFromNow * 60_000).toISOString(),
  end: new Date(Date.now() + (isoMinutesFromNow + 30) * 60_000).toISOString(),
});

describe('dueAlerts', () => {
  const now = Date.now();

  it('fires inside the lead window', () => {
    expect(dueAlerts([at(8)], now, 10, new Set())).toHaveLength(1);
  });

  it('stays quiet outside it', () => {
    expect(dueAlerts([at(40)], now, 10, new Set())).toHaveLength(0);
  });

  it('never announces the same event twice — the nagging failure', () => {
    const e = at(5, 'x');
    expect(dueAlerts([e], now, 10, new Set(['x']))).toHaveLength(0);
  });

  it('does not interrupt an event that already started', () => {
    expect(dueAlerts([at(-3)], now, 10, new Set())).toHaveLength(0);
  });

  it('ignores all-day events, which have no moment to count down to', () => {
    const allDay: AlertEvent = { eventId: 'a', allDay: true, start: new Date().toISOString() };
    expect(dueAlerts([allDay], now, 10, new Set())).toHaveLength(0);
  });

  it('announces the most imminent first', () => {
    const out = dueAlerts([at(9, 'late'), at(2, 'soon')], now, 10, new Set());
    expect(out.map((d) => d.event.eventId)).toEqual(['soon', 'late']);
  });

  it('still fires late if the window was slept through, while it has not started', () => {
    // Lead is 10 but the event is 1 minute away: the poll was missed, and
    // silence would be worse than a late warning.
    expect(dueAlerts([at(1)], now, 10, new Set())).toHaveLength(1);
  });

  it('survives an unparseable start rather than throwing mid-poll', () => {
    expect(dueAlerts([{ eventId: 'bad', start: 'not-a-date' }], now, 10, new Set())).toHaveLength(0);
  });
});

describe('pruneFired', () => {
  it('forgets events that have started, so the set cannot grow forever', () => {
    const now = Date.now();
    const kept = pruneFired(new Set(['past', 'future']), [
      { eventId: 'past', start: new Date(now - 60_000).toISOString() },
      { eventId: 'future', start: new Date(now + 60_000).toISOString() },
    ], now);
    expect([...kept]).toEqual(['future']);
  });

  it('keeps a future event remembered, so it is not announced again', () => {
    const now = Date.now();
    const kept = pruneFired(new Set(['soon']), [{ eventId: 'soon', start: new Date(now + 300_000).toISOString() }], now);
    expect(kept.has('soon')).toBe(true);
  });
});
