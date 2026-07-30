'use client';
/**
 * Live pre-event alerts (D-195).
 *
 * While the owner is in the app, Jarvis watches the mirrored calendar and
 * speaks up before something starts — "جلسهٔ طراحی ۱۰ دقیقهٔ دیگر شروع
 * می‌شود، ۴۵ دقیقه طول می‌کشد، لینک میت دارد".
 *
 * Three decisions worth naming:
 *
 * - It polls a LOCAL mirror, not Google. Sixty-second polling costs zero API
 *   quota, so this can stay on all day without consequence.
 * - It is off until switched on, and the switch is remembered. An assistant
 *   that starts talking unprompted the first time you open a page is a
 *   liability, not a feature.
 * - It never re-announces. `dueAlerts` owns that rule and is tested; this hook
 *   only supplies the clock and the voice.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { upcomingForAlertsAction } from '@/app/calendar/alerts-action';
import { dueAlerts, pruneFired, type AlertEvent } from './eventAlerts';
import { alertSentence } from './speech';

const POLL_MS = 60_000;
const STORAGE_KEY = 'aos.jarvis.eventAlerts';
const LEAD_KEY = 'aos.jarvis.eventAlertsLead';

export interface LiveAlert {
  eventId: string;
  minutes: number;
  title: string;
  sentence: string;
  start: string;
  at: number;
}

export interface UseEventAlerts {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  leadMinutes: number;
  setLeadMinutes: (m: number) => void;
  /** The most recent announcement, for the on-screen card. */
  alert: LiveAlert | null;
  dismiss: () => void;
  /** Next timed event regardless of the lead window — shown on the bar. */
  next: AlertEvent | null;
}

export function useEventAlerts(speak: (text: string) => void): UseEventAlerts {
  const [enabled, setEnabledState] = useState(false);
  const [leadMinutes, setLeadState] = useState(10);
  const [alert, setAlert] = useState<LiveAlert | null>(null);
  const [next, setNext] = useState<AlertEvent | null>(null);

  const firedRef = useRef<Set<string>>(new Set());
  const speakRef = useRef(speak);
  speakRef.current = speak;
  const leadRef = useRef(leadMinutes);
  leadRef.current = leadMinutes;

  // Restore the owner's choice. Reading in an effect, not during render, so
  // server and client agree on the first paint.
  useEffect(() => {
    try {
      setEnabledState(window.localStorage.getItem(STORAGE_KEY) === '1');
      const lead = Number(window.localStorage.getItem(LEAD_KEY));
      if (Number.isFinite(lead) && lead >= 1 && lead <= 60) setLeadState(lead);
    } catch { /* private mode — defaults are fine */ }
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    try { window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    if (!on) setAlert(null);
  }, []);

  const setLeadMinutes = useCallback((m: number) => {
    setLeadState(m);
    leadRef.current = m;
    try { window.localStorage.setItem(LEAD_KEY, String(m)); } catch { /* ignore */ }
    // A changed lead time is a changed question: an event skipped at 5 minutes
    // should be eligible again at 30.
    firedRef.current = new Set();
  }, []);

  useEffect(() => {
    if (!enabled) { setNext(null); return; }
    let stopped = false;

    const tick = async () => {
      const { events } = await upcomingForAlertsAction();
      if (stopped) return;

      const now = Date.now();
      const timed = events.filter((e) => !e.allDay && e.start);
      setNext(timed.slice().sort((a, b) => String(a.start).localeCompare(String(b.start)))[0] ?? null);

      firedRef.current = pruneFired(firedRef.current, events, now);
      const due = dueAlerts(events, now, leadRef.current, firedRef.current);
      if (due.length === 0) return;

      // Announce the imminent one only. Two voices over each other is worse
      // than one missed reminder, and the rest are still coming.
      const first = due[0];
      firedRef.current.add(first.event.eventId);
      const sentence = alertSentence(first.event, first.minutes);
      setAlert({
        eventId: first.event.eventId,
        minutes: first.minutes,
        title: first.event.summary || 'رویداد',
        sentence,
        start: String(first.event.start ?? ''),
        at: now,
      });
      speakRef.current(sentence);
    };

    void tick();
    const id = setInterval(() => { void tick(); }, POLL_MS);
    /* A laptop that slept through the window wakes up with a stale clock and a
     * stale poll. Re-check the moment the tab becomes visible again. */
    const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  const dismiss = useCallback(() => setAlert(null), []);

  return { enabled, setEnabled, leadMinutes, setLeadMinutes, alert, dismiss, next };
}
