'use client';
/**
 * JarvisRudder — the one assistant surface, on every page (D-191).
 *
 * Named for what it is: the control you steer the system with. It sits at the
 * bottom of the viewport as a glass bar and grows upward into the full
 * conversation when engaged, so the page you are on stays visible above it
 * instead of being replaced.
 *
 * History: there were THREE chat implementations. `JarvisDock` (other pages),
 * `JarvisWorkspace` (dead — nothing rendered it) and `JarvisCoreHUD` (`/jarvis`,
 * and the only one with voice). That is why the surfaces disagreed about
 * history, structure and voice: they were different programs. D-190 unified two
 * of them; this unifies the third and deletes the dead one, so `JarvisConversation`
 * is now the only conversation anywhere — including the one place that used to
 * be special.
 *
 * Rendered once in `app/layout.tsx`, above every route including `/jarvis`,
 * which keeps its living canvas as a backdrop rather than its own chat.
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getBriefingAction, type JarvisBriefingView } from '@/app/jarvis/actions';
import { JarvisConversation, type ConversationState } from '@/components/JarvisConversation';
import { bidiProps } from '@/lib/rtl';
import { useVoice } from '@/lib/useVoice';
import { useEventAlerts } from '@/lib/useEventAlerts';
import { archiveAlertAction } from '@/app/calendar/announce-action';

const BRIEFING_REFRESH_MS = 120_000;

const STATE_LABEL: Record<ConversationState, string> = {
  idle: 'آمادهٔ کار',
  thinking: 'در حال تحلیل',
  acting: 'در حال اجرا',
  waiting_approval: 'منتظر تأیید شما',
  error: 'خطا',
};

export function JarvisRudder({ role }: { role: string }) {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const [briefing, setBriefing] = useState<JarvisBriefingView | null>(null);
  const [state, setState] = useState<ConversationState>('idle');
  const panelRef = useRef<HTMLDivElement>(null);

  /** Login is the only place with no assistant: there is no owner yet. */
  const hidden = pathname.startsWith('/login');

  useEffect(() => {
    if (hidden) return;
    let alive = true;
    const pull = async () => {
      try {
        const b = await getBriefingAction();
        if (alive) setBriefing(b);
      } catch { /* keep the last good briefing */ }
    };
    void pull();
    const id = setInterval(pull, BRIEFING_REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, [hidden]);

  /* ⌘K opens it from anywhere; Esc closes without losing the conversation. */
  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hidden]);

  if (hidden) return null;

  const priority = briefing?.primaryPriority || briefing?.recommendedNextActions?.[0] || '';

  /* Live calendar watch (D-195). The rudder owns it rather than the
   * conversation, because it must keep working while the panel is closed —
   * that is the entire point of a reminder. */
  const voice = useVoice({ lang: 'fa-IR', onFinal: () => undefined });
  const alerts = useEventAlerts(voice.speak, (a) => {
    // Archive it as a turn so "نیم ساعت عقب بنداز" has something to refer to.
    void archiveAlertAction({ text: a.sentence, eventId: a.eventId, calendarId: a.calendarId, title: a.title });
  });

  const nextLabel = (() => {
    if (!alerts.enabled || !alerts.next?.start) return '';
    const mins = Math.round((new Date(alerts.next.start).getTime() - Date.now()) / 60_000);
    if (mins < 0 || mins > 180) return '';
    return `${alerts.next.summary || 'رویداد'} — ${mins} دقیقهٔ دیگر`;
  })();

  return (
    <>
      {/* A click-catcher rather than a modal backdrop: the page below stays
        * readable and interactive-looking, because it is still your context. */}
      {open && <div className="jrud-scrim" onClick={() => setOpen(false)} aria-hidden />}

      {/* The announcement itself. Deliberately outside the panel: a reminder
        * that only appears when you have the assistant open is not a reminder. */}
      {alerts.alert && (
        <div className="jrud-alert" dir="rtl" role="status">
          <span className="jrud-alert-dot" aria-hidden />
          <div className="jrud-alert-body">
            <strong {...bidiProps(alerts.alert.title)}>{alerts.alert.title}</strong>
            <span className="jrud-alert-when">
              {alerts.alert.minutes <= 0 ? 'همین حالا شروع می‌شود' : `${alerts.alert.minutes} دقیقهٔ دیگر`}
              {alerts.alert.start && ` · ${new Date(alerts.alert.start).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}`}
            </span>
            {/* The spoken sentence carries the detail; showing it verbatim
              * keeps screen and voice identical. It is plain text — Google's
              * HTML descriptions are stripped at the sync boundary now. */}
            <p {...bidiProps(alerts.alert.sentence)}>{alerts.alert.sentence}</p>
            <button type="button" className="jrud-alert-ask" onClick={() => setOpen(true)}>
              دربارهٔ این رویداد صحبت کنیم
            </button>
          </div>
          <button type="button" className="jrud-alert-x" onClick={alerts.dismiss} aria-label="بستن">×</button>
        </div>
      )}

      <div className={`jrud${open ? ' jrud--open' : ''}`} dir="rtl">
        <div className="jrud-glass" ref={panelRef}>
          {open && (
            <header className="jrud-head">
              <span className={`jrud-dot jrud-dot--${state}`} />
              <strong>جارویس</strong>
              <span className="jrud-state">{STATE_LABEL[state]}</span>
              <span className="jrud-role">{role}</span>
              <EventAlertToggle alerts={alerts} />
              <button type="button" className="jrud-x" onClick={() => setOpen(false)} aria-label="بستن">×</button>
            </header>
          )}

          {open ? (
            <JarvisConversation
              variant="rudder"
              autoFocus
              onState={setState}
              /* The page is real context: "این را باز کن" means something
               * different on /finance than on /loop. */
              contextNote={`current page: ${pathname}`}
              emptyHint={priority
                ? `اولویت امروز: ${priority}`
                : 'بپرسید یا دستور بدهید — به همهٔ سرویس‌ها، حافظه، مأموریت‌ها، هویت و حلقهٔ زنده دسترسی دارم.'}
            />
          ) : (
            <button type="button" className="jrud-bar" onClick={() => setOpen(true)} title="جارویس (⌘K)">
              <span className={`jrud-dot jrud-dot--${state}`} />
              <span className="jrud-bar-text" {...bidiProps(nextLabel || priority || 'جارویس')}>
                {nextLabel || priority || 'جارویس — بپرسید، بگویید یا دستور بدهید'}
              </span>
              {alerts.enabled && <span className="jrud-watch" title="مراقب تقویم" aria-hidden />}
              <kbd className="jrud-kbd" dir="ltr">⌘K</kbd>
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * The switch, and the only setting it needs.
 *
 * Minimal on purpose: one toggle, one number. The lead time is the single
 * thing people actually disagree about — five minutes if you are already at
 * your desk, thirty if you have to travel.
 */
function EventAlertToggle({ alerts }: { alerts: ReturnType<typeof useEventAlerts> }) {
  return (
    <span className="jrud-watchbox">
      <button
        type="button"
        className={`jrud-watchbtn${alerts.enabled ? ' on' : ''}`}
        onClick={() => alerts.setEnabled(!alerts.enabled)}
        aria-pressed={alerts.enabled}
        title={alerts.enabled ? 'مراقبت از تقویم روشن است' : 'مراقبت از تقویم خاموش است'}
      >
        <span className="jrud-watchdot" aria-hidden />
        مراقب تقویم
      </button>
      {alerts.enabled && (
        <select
          className="jrud-watchlead"
          value={alerts.leadMinutes}
          onChange={(e) => alerts.setLeadMinutes(Number(e.target.value))}
          aria-label="چند دقیقه قبل اطلاع بده"
        >
          {[5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} دقیقه قبل</option>)}
        </select>
      )}
    </span>
  );
}
