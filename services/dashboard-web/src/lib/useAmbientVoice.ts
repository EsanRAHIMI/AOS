'use client';
/**
 * Ambient voice — Jarvis without a button (D-209).
 *
 * WHY THIS IS A SEPARATE HOOK
 * ---------------------------
 * `useVoice` is push-to-talk and works. Ambient listening is a different
 * machine with different failure modes — it restarts itself, it must discard
 * almost everything it hears, and it can talk over the owner. Folding it into
 * the working hook would put the reliable path at risk of the experimental
 * one's bugs. They share nothing but the browser API.
 *
 * THE PRIVACY PROPERTY, STATED PLAINLY
 * ------------------------------------
 * The browser's SpeechRecognition is NOT local in Chrome — audio goes to
 * Google's servers for transcription. "Always listening" therefore means
 * "always uploading" while the microphone is on, and no amount of client-side
 * filtering changes that. This hook cannot fix it, so it does two things
 * instead:
 *
 *   1. Ambient mode is OFF by default and must be turned on explicitly, every
 *      session. It is never remembered — a setting that silently persists an
 *      open microphone across restarts is not a setting the owner can
 *      meaningfully consent to.
 *   2. Everything heard before the wake word is DISCARDED in the browser and
 *      never sent to the kernel. The transcript is not stored, not logged and
 *      not put in a React state that renders it.
 *
 * `disclosure` carries this text so the UI cannot show ambient mode without
 * showing what it costs.
 *
 * THE WAKE WORD IS A GATE, NOT A TRIGGER
 * --------------------------------------
 * Recognition runs continuously; the wake word decides which part of the
 * stream becomes a command. That is what makes "جارویس، فردا ساعت ۱۰ جلسه
 * بگذار" work as one sentence — the words after the wake word in the SAME
 * utterance are the command, with no second round trip and no beep to wait
 * for.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type SpeechRec = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void;
  onend: () => void; onerror: (e?: unknown) => void; onstart?: () => void;
  start: () => void; stop: () => void; abort: () => void;
};

function speechCtor(): (new () => SpeechRec) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { webkitSpeechRecognition?: new () => SpeechRec; SpeechRecognition?: new () => SpeechRec };
  return w.webkitSpeechRecognition ?? w.SpeechRecognition ?? null;
}

/**
 * Accepted wake words.
 *
 * Several spellings on purpose: Persian STT returns "جارویس", "جاروس" and
 * "جرویس" for the same sound depending on the surrounding words, and a gate
 * that only accepts the dictionary spelling fails exactly when the owner is
 * speaking naturally. Latin forms are here because a bilingual speaker
 * switches mid-sentence and the engine follows.
 */
export const WAKE_WORDS = ['جارویس', 'جاروس', 'جرویس', 'جارویز', 'jarvis', 'jarvez'] as const;

/** Silence after the wake word before the command is considered finished. */
const COMMAND_SILENCE_MS = 1200;
/**
 * Recognition ends itself on silence even in continuous mode; this is the
 * delay before restarting. Immediate restart in a tight loop is how browsers
 * end up throwing `InvalidStateError` and the microphone dies for the session.
 */
const RESTART_DELAY_MS = 350;
/** Consecutive failed restarts before ambient mode gives up and says so. */
const MAX_RESTART_FAILURES = 5;
/**
 * Window in which an identical command is treated as a duplicate delivery
 * rather than a repetition. Long enough to absorb a restart or a late event,
 * short enough that an owner saying the same thing twice on purpose is heard
 * twice — which they do, when the first attempt appeared to do nothing.
 */
const DUPLICATE_WINDOW_MS = 4000;

/** Characters that mean the same sound but are different bytes. 1:1 only. */
const FOLD: Record<string, string> = {
  'ي': 'ی', 'ى': 'ی',   // Arabic yeh / alef maqsura → Persian yeh
  'ك': 'ک',              // Arabic kaf → Persian kaf
  '‌': ' ',              // ZWNJ reads as a word break for matching
};
/** Marks that carry no consonant and are dropped entirely. */
const STRIP = /[ً-ْٰ]/;

/**
 * Fold for MATCHING while keeping a map back to the original.
 *
 * The map is the point. An earlier version returned the folded string as the
 * command, which quietly rewrote the owner's words on the way to the model:
 * "پس‌فردا" (day after tomorrow, one word) arrived as "پس فردا" (two words).
 * The wake word has to be found in a forgiving form; the COMMAND must be the
 * bytes the owner actually said. `index[i]` is the position in the original
 * of the i-th folded character, so the split point survives the fold.
 */
function fold(s: string): { text: string; index: number[] } {
  let text = '';
  const index: number[] = [];
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (STRIP.test(ch)) continue;
    text += (FOLD[ch] ?? ch).toLowerCase();
    index.push(i);
  }
  return { text, index };
}

/**
 * Split a heard phrase at the wake word.
 *
 * Returns what follows it VERBATIM, or null when the wake word is absent. The
 * LAST occurrence wins: "جارویس... نه، جارویس فردا رو کنسل کن" means the owner
 * restarted their sentence, and the second attempt is the one they meant.
 */
export function afterWakeWord(heard: string): string | null {
  const { text, index } = fold(heard);
  let best = -1;
  let bestLen = 0;
  for (const w of WAKE_WORDS) {
    const needle = fold(w).text;
    const idx = text.lastIndexOf(needle);
    if (idx > best) { best = idx; bestLen = needle.length; }
  }
  if (best < 0) return null;

  const foldedEnd = best + bestLen;
  // Past the end of the folded string ⇒ the wake word was the last thing said.
  const origStart = foldedEnd < index.length ? index[foldedEnd]! : heard.length;
  // ZWNJ is in the class because it is not \s: a joiner left dangling where
  // the name was removed is punctuation, not the first letter of the command.
  return heard.slice(origStart).replace(/^[\s‌,،.:؛…]+/, '').trim();
}

/** The shape of the browser's live results list, narrowed to what we read. */
export type SpeechResults = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;

/**
 * Rebuild the current utterance from the recogniser's live results list.
 *
 * This is the fix for the bug that made one spoken sentence arrive as every
 * prefix of itself concatenated (D-210). With `interimResults`, the SAME
 * result index is re-delivered on every event with a longer transcript:
 *
 *   event 1  results[0] = "باید"            (interim)
 *   event 2  results[0] = "باید یک"          (interim)
 *   event 3  results[0] = "باید یک تقویم"     (interim)
 *
 * Appending each event's text to a buffer therefore produces
 * "باید باید یک باید یک تقویم …". Reading the whole list fresh each time
 * cannot: the list IS the utterance, so the result is idempotent no matter
 * how many events arrive.
 *
 * `base` skips results already submitted as an earlier command — the list is
 * not cleared when a command is sent, only when the recogniser is replaced.
 */
export function utteranceFrom(results: SpeechResults, base = 0): string {
  let out = '';
  for (let i = Math.max(0, base); i < results.length; i += 1) {
    out += `${results[i]?.[0]?.transcript ?? ''} `;
  }
  return out.replace(/\s+/g, ' ').trim();
}

export interface UseAmbientVoice {
  /** The browser can do continuous recognition at all. */
  supported: boolean;
  /** Ambient mode is on right now. Never persisted — see the header. */
  ambient: boolean;
  /** The microphone is actually open (ambient on AND recognition running). */
  hearing: boolean;
  /** The wake word has been heard; the words after it are being captured. */
  awake: boolean;
  /** What is being captured AFTER the wake word. Never the ambient stream. */
  command: string;
  /** Non-empty when ambient mode stopped for a reason the owner should see. */
  error: string;
  setAmbient: (on: boolean) => void;
  /** What the owner is agreeing to. Show this wherever ambient is offered. */
  disclosure: string;
}

export function useAmbientVoice(opts: {
  lang?: string;
  /** Fired with the command text once the owner stops speaking. */
  onCommand: (text: string) => void;
  /**
   * Called the moment ANY speech is detected while Jarvis is talking, so the
   * caller can cut the assistant off. Barge-in is what separates a
   * conversation from a monologue with a queue.
   */
  onBargeIn?: () => void;
  /** True while Jarvis is speaking — enables barge-in detection. */
  speaking?: boolean;
}): UseAmbientVoice {
  const { lang = 'fa-IR', onCommand, onBargeIn, speaking = false } = opts;

  const [supported, setSupported] = useState(false);
  const [ambient, setAmbientState] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [awake, setAwake] = useState(false);
  const [command, setCommand] = useState('');
  const [error, setError] = useState('');

  const recRef = useRef<SpeechRec | null>(null);
  const restartRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failuresRef = useRef(0);
  /** Command text lives in a ref: it must survive a re-render mid-utterance. */
  const bufRef = useRef('');
  /** Last submission — deliberately a ref that OUTLIVES an effect run, so a
   *  StrictMode remount cannot resubmit what the previous run already sent. */
  const lastSubmitRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  const onCommandRef = useRef(onCommand);
  const onBargeInRef = useRef(onBargeIn);
  const speakingRef = useRef(speaking);
  useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);
  useEffect(() => { onBargeInRef.current = onBargeIn; }, [onBargeIn]);
  useEffect(() => { speakingRef.current = speaking; }, [speaking]);

  useEffect(() => { setSupported(Boolean(speechCtor())); }, []);

  const setAmbient = useCallback((on: boolean) => {
    setError('');
    failuresRef.current = 0;
    setAmbientState(on);
  }, []);

  useEffect(() => {
    if (!ambient) return;
    const Ctor = speechCtor();
    if (!Ctor) { setError('این مرورگر تشخیص گفتار پیوسته ندارد.'); setAmbientState(false); return; }

    /**
     * Stop flag, LOCAL to this effect run (D-210).
     *
     * It used to be a ref shared across runs, and that was a real bug: React
     * StrictMode mounts effects twice in development. Cleanup set the shared
     * ref true, the second run immediately set it back to false, and the first
     * recogniser's pending `onend` then saw `false` and scheduled a restart —
     * leaving TWO recognisers listening to one microphone. Both heard the same
     * sentence and both submitted it, which is why one spoken command arrived
     * as two identical turns. A closure variable cannot be reached by a dead
     * run's callbacks.
     */
    let stopped = false;

    /**
     * Index into `e.results` where the CURRENT utterance begins.
     *
     * The Web Speech API's `results` is a growing, live list for the lifetime
     * of one recogniser. After a command is submitted, its results are still
     * in that list — so the next rebuild must start after them or the previous
     * command is spoken again as a prefix of the next one.
     */
    let base = 0;

    const finish = () => {
      const cmd = bufRef.current.trim();
      bufRef.current = '';
      setAwake(false);
      setCommand('');
      if (!cmd) return;

      /* Dedupe (D-210). Two paths can deliver the same utterance: a late
       * `onresult` re-firing the silence timer, and a recogniser restarting
       * mid-sentence. Neither is worth a second identical turn, and "say it
       * again" is a real thing owners do — so the guard is a short window,
       * not a permanent blocklist. */
      const now = Date.now();
      if (cmd === lastSubmitRef.current.text && now - lastSubmitRef.current.at < DUPLICATE_WINDOW_MS) return;
      lastSubmitRef.current = { text: cmd, at: now };

      onCommandRef.current(cmd);
    };

    const start = () => {
      if (stopped) return;
      const rec = new Ctor();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;
      // A fresh recogniser has a fresh, empty results list.
      base = 0;

      rec.onstart = () => { setHearing(true); failuresRef.current = 0; };

      rec.onresult = (e) => {
        // Barge-in: the owner's voice always outranks the assistant's.
        if (speakingRef.current) onBargeInRef.current?.();

        /* REBUILD, never append (D-210).
         *
         * With `interimResults`, the same result index is re-delivered on
         * every event with a longer transcript: "باید" → "باید یک" → "باید یک
         * تقویم". The previous version appended each of those to a buffer, so
         * one sentence arrived as every prefix of itself concatenated. The
         * results list is the whole truth about the utterance, so the command
         * is derived from it fresh each time and cannot accumulate. */
        const whole = utteranceFrom(e.results, base);
        if (!whole) return;

        /* The command is always "everything after the LAST wake word in this
         * utterance" — recomputed, not accumulated. Null means the owner has
         * not addressed Jarvis, and the text is discarded here in the browser:
         * that is the privacy contract, and it now also holds for every
         * interim revision rather than only the first. */
        const after = afterWakeWord(whole);
        if (after === null) return;

        setAwake(true);
        bufRef.current = after;
        setCommand(after);

        if (silenceRef.current) clearTimeout(silenceRef.current);
        silenceRef.current = setTimeout(() => {
          // Everything heard so far belongs to the command being submitted.
          base = e.results.length;
          finish();
        }, COMMAND_SILENCE_MS);
      };

      rec.onerror = (ev) => {
        const code = (ev as { error?: string } | undefined)?.error ?? '';
        setHearing(false);
        // Permission is terminal: retrying it produces a browser prompt loop.
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          stopped = true;
          setError('اجازهٔ میکروفون داده نشد.');
          setAmbientState(false);
          return;
        }
        // `no-speech` is normal in ambient mode — silence is the usual state.
        failuresRef.current += code === 'no-speech' ? 0 : 1;
      };

      rec.onend = () => {
        setHearing(false);
        if (stopped) return;
        if (failuresRef.current >= MAX_RESTART_FAILURES) {
          setError('تشخیص گفتار مدام قطع شد؛ حالت شنیدن دائمی خاموش شد.');
          setAmbientState(false);
          return;
        }
        // Continuous recognition still ends on long silence. Restarting is the
        // whole trick — with a delay, or the browser throws and the mic dies.
        restartRef.current = setTimeout(start, RESTART_DELAY_MS);
      };

      recRef.current = rec;
      try { rec.start(); } catch { failuresRef.current += 1; restartRef.current = setTimeout(start, RESTART_DELAY_MS); }
    };

    start();

    return () => {
      stopped = true;
      if (restartRef.current) clearTimeout(restartRef.current);
      if (silenceRef.current) clearTimeout(silenceRef.current);
      try { recRef.current?.abort(); } catch { /* already gone */ }
      recRef.current = null;
      bufRef.current = '';
      setHearing(false);
      setAwake(false);
      setCommand('');
    };
  }, [ambient, lang]);

  return {
    supported,
    ambient,
    hearing,
    awake,
    command,
    error,
    setAmbient,
    disclosure:
      'در این حالت میکروفون باز می‌ماند و مرورگر صدا را برای تبدیل به متن به سرویس گوگل می‌فرستد. '
      + 'هرچه پیش از گفتن «جارویس» شنیده شود در همین مرورگر دور ریخته می‌شود و به سیستم نمی‌رسد. '
      + 'این حالت ذخیره نمی‌شود و با هر بار باز کردن صفحه باید دوباره روشن شود.',
  };
}
