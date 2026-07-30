'use client';
/**
 * Voice for the assistant — dictation in, speech out (D-191).
 *
 * This lived inside `JarvisCoreHUD`, which is why voice existed on `/jarvis`
 * and nowhere else. It is a capability of the CONVERSATION, not of one page,
 * so it moved here and is used by the single shared conversation component.
 *
 * Honest capability reporting: `supported` is false when the browser has no
 * SpeechRecognition, and the UI hides the control rather than offering a
 * button that silently does nothing. Speech synthesis is checked separately —
 * a browser can have one without the other.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type SpeechRec = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void;
  onend: () => void; onerror: () => void; start: () => void; stop: () => void; abort: () => void;
};

function speechCtor(): (new () => SpeechRec) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { webkitSpeechRecognition?: new () => SpeechRec; SpeechRecognition?: new () => SpeechRec };
  return w.webkitSpeechRecognition ?? w.SpeechRecognition ?? null;
}

/** Pause after the last final word before the utterance is considered done. */
const SILENCE_MS = 1100;

export interface UseVoice {
  /** The browser can dictate. */
  supported: boolean;
  /** The browser can read replies aloud. */
  canSpeak: boolean;
  listening: boolean;
  speaking: boolean;
  /** Live transcript while dictating — shown so the owner sees it being heard. */
  interim: string;
  toggleListening: () => void;
  /** Read a reply aloud. No-op when synthesis is unavailable. */
  speak: (text: string) => void;
  /** Stop any speech immediately (the owner starting to type, or closing). */
  stopSpeaking: () => void;
}

export function useVoice(opts: { lang?: string; onFinal: (text: string) => void }): UseVoice {
  const { lang = 'fa-IR', onFinal } = opts;

  const [supported, setSupported] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState('');

  const recRef = useRef<SpeechRec | null>(null);
  const finalRef = useRef('');
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFinalRef = useRef(onFinal);
  useEffect(() => { onFinalRef.current = onFinal; }, [onFinal]);

  useEffect(() => {
    setSupported(Boolean(speechCtor()));
    setCanSpeak(typeof window !== 'undefined' && 'speechSynthesis' in window);
  }, []);

  const stopListening = useCallback(() => {
    if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null; }
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    recRef.current = null;
    setListening(false);
    setInterim('');
  }, []);

  const stopSpeaking = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    setSpeaking(false);
  }, []);

  // Never leave a microphone open or a voice talking after unmount.
  useEffect(() => () => { stopListening(); stopSpeaking(); }, [stopListening, stopSpeaking]);

  const toggleListening = useCallback(() => {
    if (listening) { stopListening(); return; }
    const Ctor = speechCtor();
    if (!Ctor) return;
    stopSpeaking();   // the owner talking always wins over the assistant talking

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    finalRef.current = '';

    rec.onresult = (e) => {
      let live = '';
      for (let i = 0; i < e.results.length; i += 1) {
        const r = e.results[i];
        const txt = r[0]?.transcript ?? '';
        if (r.isFinal) {
          if (i >= e.resultIndex || !finalRef.current.includes(txt.trim())) {
            finalRef.current = `${finalRef.current} ${txt}`.trim();
          }
        } else live += txt;
      }
      setInterim((live || finalRef.current).trim());

      // Submit after a pause, not on the first final chunk — people breathe
      // mid-sentence, and cutting them off there is how dictation feels broken.
      if (finalRef.current) {
        if (silenceRef.current) clearTimeout(silenceRef.current);
        silenceRef.current = setTimeout(() => {
          const cmd = finalRef.current;
          finalRef.current = '';
          stopListening();
          if (cmd.trim()) onFinalRef.current(cmd.trim());
        }, SILENCE_MS);
      }
    };
    rec.onend = () => { setListening(false); setInterim(''); };
    rec.onerror = () => { setListening(false); setInterim(''); };

    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setListening(false); }
  }, [lang, listening, stopListening, stopSpeaking]);

  const speak = useCallback((text: string) => {
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      // Cap the utterance: reading a long structured answer aloud in full is
      // punishing, and the text is on screen anyway.
      const u = new SpeechSynthesisUtterance(text.slice(0, 600));
      u.lang = lang;
      u.rate = 1.02;
      u.onstart = () => setSpeaking(true);
      const done = () => setSpeaking(false);
      u.onend = done;
      u.onerror = done;
      window.speechSynthesis.speak(u);
    } catch { setSpeaking(false); }
  }, [lang]);

  return { supported, canSpeak, listening, speaking, interim, toggleListening, speak, stopSpeaking };
}
