/**
 * D-209 — the wake-word gate.
 *
 * This is the privacy boundary of ambient listening, not a convenience. In
 * continuous mode the browser transcribes everything it hears; `afterWakeWord`
 * is the single function deciding which part of that stream is allowed to
 * become a command and reach the kernel. Everything it returns `null` for is
 * discarded in the browser.
 *
 * So a bug here is not "the wake word is fussy" — it is either the owner
 * being ignored, or a private conversation being sent to a model. Both are
 * tested below.
 */
import { describe, it, expect } from 'vitest';
import { afterWakeWord, WAKE_WORDS } from '../src/lib/useAmbientVoice';

describe('nothing without the wake word', () => {
  it('discards ordinary speech', () => {
    expect(afterWakeWord('فردا باید برم دکتر')).toBeNull();
    expect(afterWakeWord('hey can you pass me that')).toBeNull();
  });

  it('discards silence and noise', () => {
    expect(afterWakeWord('')).toBeNull();
    expect(afterWakeWord('   ')).toBeNull();
  });

  it('is not fooled by a near-miss', () => {
    // "جاروب" (broom) is one letter from the wake word and must not trigger.
    expect(afterWakeWord('جاروب رو بردار')).toBeNull();
  });
});

describe('the command is what FOLLOWS the wake word', () => {
  it('takes the rest of the same sentence — no second round trip', () => {
    expect(afterWakeWord('جارویس فردا ساعت ۱۰ جلسه بگذار')).toBe('فردا ساعت ۱۰ جلسه بگذار');
  });

  it('strips the punctuation people naturally put after a name', () => {
    expect(afterWakeWord('جارویس، برنامهٔ امروز چیه؟')).toBe('برنامهٔ امروز چیه؟');
    expect(afterWakeWord('جارویس: بعدی چیه')).toBe('بعدی چیه');
  });

  it('drops what was said BEFORE it — that part was never addressed to Jarvis', () => {
    // The whole point: the private half of the sentence must not travel.
    const out = afterWakeWord('به سارا بگو نمیام، جارویس جلسهٔ ۳ رو کنسل کن');
    expect(out).toBe('جلسهٔ ۳ رو کنسل کن');
    expect(out).not.toContain('سارا');
  });

  it('returns an empty command when the wake word is said alone', () => {
    // Empty, not null: the owner DID address Jarvis. The caller waits for the
    // rest of the sentence rather than discarding the wake-up.
    expect(afterWakeWord('جارویس')).toBe('');
  });
});

describe('a restarted sentence uses the LAST attempt', () => {
  it('takes the second address, because the first was abandoned', () => {
    const out = afterWakeWord('جارویس فردا رو… نه، جارویس پس‌فردا رو خالی کن');
    expect(out).toBe('پس‌فردا رو خالی کن');
  });
});

describe('spelling variants — Persian STT is not consistent', () => {
  it('accepts every listed variant', () => {
    for (const w of WAKE_WORDS) {
      expect(afterWakeWord(`${w} سلام`)).toBe('سلام');
    }
  });

  it('normalises Arabic yeh/kaf, which Persian STT emits interchangeably', () => {
    // 'جارويس' with Arabic yeh (U+064A) is the same word to a listener and a
    // different string to a computer.
    expect(afterWakeWord('جارويس چه خبر')).toBe('چه خبر');
  });

  it('ignores the zero-width non-joiner and stray harakat', () => {
    expect(afterWakeWord('جارویس‌ برنامه')).toBe('برنامه');
  });

  it('is case-insensitive for the latin form', () => {
    expect(afterWakeWord('Jarvis what is next')).toBe('what is next');
    expect(afterWakeWord('JARVIS what is next')).toBe('what is next');
  });
});

/* ========================================================================== *
 * D-210 — the utterance rebuild
 * ========================================================================== */

import { utteranceFrom, type SpeechResults } from '../src/lib/useAmbientVoice';

/** Build a fake results list the way the browser delivers one. */
function results(items: Array<{ text: string; final?: boolean }>): SpeechResults {
  return items.map((i) => ({ isFinal: Boolean(i.final), 0: { transcript: i.text } })) as unknown as SpeechResults;
}

describe('one sentence stays one sentence', () => {
  /**
   * The reported bug, reproduced exactly.
   *
   * The owner said ONE sentence and it arrived as every prefix of itself
   * concatenated: "باید باید یک باید یک تقویم …". That is what appending each
   * interim event to a buffer produces, because the SAME result index is
   * re-delivered with a longer transcript on every event.
   */
  it('is idempotent across the interim revisions of one result', () => {
    const revisions = ['باید', 'باید یک', 'باید یک تقویم', 'باید یک تقویم جدید'];
    const seen = revisions.map((text) => utteranceFrom(results([{ text }])));
    // Each rebuild equals that revision — never the concatenation of all of them.
    expect(seen).toEqual(revisions);
    expect(seen[seen.length - 1]).toBe('باید یک تقویم جدید');
    expect(seen[seen.length - 1]).not.toContain('باید باید');
  });

  it('joins genuinely separate results without repeating them', () => {
    const r = results([
      { text: 'جارویس', final: true },
      { text: 'یک رویداد برای امشب بگذار' },
    ]);
    expect(utteranceFrom(r)).toBe('جارویس یک رویداد برای امشب بگذار');
  });

  it('never accumulates, however many times the same list is read', () => {
    const r = results([{ text: 'جارویس فردا رو خالی کن', final: true }]);
    expect(utteranceFrom(r)).toBe(utteranceFrom(r));
    expect(utteranceFrom(r)).toBe('جارویس فردا رو خالی کن');
  });
});

describe('a submitted command does not leak into the next one', () => {
  it('skips results consumed by an earlier command via `base`', () => {
    // The browser does NOT clear `results` when we submit; `base` is what
    // stops the previous sentence becoming a prefix of the next one.
    const r = results([
      { text: 'جارویس فردا رو خالی کن', final: true },
      { text: 'جارویس برنامهٔ امروز چیه', final: true },
    ]);
    expect(utteranceFrom(r, 1)).toBe('جارویس برنامهٔ امروز چیه');
    expect(utteranceFrom(r, 1)).not.toContain('خالی کن');
  });

  it('returns empty once everything has been consumed', () => {
    const r = results([{ text: 'جارویس سلام', final: true }]);
    expect(utteranceFrom(r, 1)).toBe('');
  });
});

describe('the rebuild and the wake-word gate compose', () => {
  it('yields the command once, not once per interim revision', () => {
    // End to end: the revisions of one utterance, each passed through both
    // functions, must all produce the SAME command.
    const revisions = [
      'جارویس یک',
      'جارویس یک رویداد',
      'جارویس یک رویداد برای امشب',
    ];
    const commands = revisions.map((text) => afterWakeWord(utteranceFrom(results([{ text }]))));
    expect(commands).toEqual(['یک', 'یک رویداد', 'یک رویداد برای امشب']);
    // The final value is the whole command, with no duplicated fragments.
    expect(commands[commands.length - 1]).toBe('یک رویداد برای امشب');
  });
});
