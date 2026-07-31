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
