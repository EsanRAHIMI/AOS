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

  return (
    <>
      {/* A click-catcher rather than a modal backdrop: the page below stays
        * readable and interactive-looking, because it is still your context. */}
      {open && <div className="jrud-scrim" onClick={() => setOpen(false)} aria-hidden />}

      <div className={`jrud${open ? ' jrud--open' : ''}`} dir="rtl">
        <div className="jrud-glass" ref={panelRef}>
          {open && (
            <header className="jrud-head">
              <span className={`jrud-dot jrud-dot--${state}`} />
              <strong>جارویس</strong>
              <span className="jrud-state">{STATE_LABEL[state]}</span>
              <span className="jrud-role">{role}</span>
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
              <span className="jrud-bar-text" {...bidiProps(priority || 'جارویس')}>
                {priority || 'جارویس — بپرسید، بگویید یا دستور بدهید'}
              </span>
              <kbd className="jrud-kbd" dir="ltr">⌘K</kbd>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
