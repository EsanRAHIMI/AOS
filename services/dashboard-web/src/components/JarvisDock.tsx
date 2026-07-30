'use client';
/**
 * JarvisDock — the way you REACH Jarvis from anywhere (D-190).
 *
 * Previously this file also *was* a conversation: its own message list, its own
 * streaming loop, its own approval bar, all duplicated against
 * `JarvisWorkspace`. Two copies drifted — history loading existed only here,
 * the structured renderer landed here first, the approval UI differed. That is
 * now `JarvisConversation`, used identically by this overlay and by the
 * `/jarvis` stage, so there is one behaviour and one history everywhere.
 *
 * What is left here is the SHELL: the trigger, the today's-priority preview,
 * and a centred floating surface. Centred rather than a bottom-right corner
 * panel because this is the primary way the owner drives the system, not a
 * support widget — and it opens over whatever page they are on, keeping the
 * page as context rather than replacing it.
 *
 * Implemented with a native `<dialog>` + `showModal()`: the top layer escapes
 * every ancestor's overflow and stacking context, and Esc, focus trapping and
 * the backdrop come from the platform.
 *
 * Mounted once in `app/layout.tsx`, so its state survives route changes.
 * Hidden on `/jarvis`, where the stage hosts the same component inline — the
 * one place two inputs would be wrong.
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getBriefingAction, type JarvisBriefingView } from '@/app/jarvis/actions';
import { JarvisConversation, type ConversationState } from '@/components/JarvisConversation';
import { bidiProps } from '@/lib/rtl';

const BRIEFING_REFRESH_MS = 120_000;

const stateLabel: Record<ConversationState, string> = {
  idle: 'آمادهٔ کار',
  thinking: 'در حال تحلیل',
  acting: 'در حال اجرا',
  waiting_approval: 'منتظر تأیید شما',
  error: 'خطا',
};

export function JarvisDock({ role }: { role: string }) {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const [briefing, setBriefing] = useState<JarvisBriefingView | null>(null);
  const [state, setState] = useState<ConversationState>('idle');
  const ref = useRef<HTMLDialogElement>(null);

  /** `/jarvis` hosts this same conversation full-screen — never two inputs. */
  const hidden = pathname === '/jarvis' || pathname.startsWith('/jarvis/') || pathname.startsWith('/login');

  /* ------------------------------- briefing ------------------------------ */
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

  /* ------------------------- keyboard: ⌘K / Ctrl+K ----------------------- */
  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hidden]);

  /* --------------------------- dialog open/close ------------------------- */
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  if (hidden) return null;

  // The one thing worth surfacing on the closed trigger: today's priority.
  const priority = briefing?.primaryPriority || briefing?.recommendedNextActions?.[0] || '';

  return (
    <>
      <button type="button" className="jdock-pill" onClick={() => setOpen(true)} title="جارویس (⌘K)">
        <span className={`jdock-dot jdock-dot--${state}`} />
        <span className="jdock-pill-text" {...bidiProps(priority || 'جارویس')}>
          {priority || 'جارویس — بپرسید یا دستور بدهید'}
        </span>
        <kbd className="jdock-kbd" dir="ltr">⌘K</kbd>
      </button>

      <dialog
        ref={ref}
        className="jdock-modal"
        aria-label="جارویس"
        onCancel={(e) => { e.preventDefault(); setOpen(false); }}
        onClick={(e) => { if (e.target === ref.current) setOpen(false); }}
      >
        <div className="jdock-surface" onClick={(e) => e.stopPropagation()}>
          <header className="jdock-head">
            <span className={`jdock-dot jdock-dot--${state}`} />
            <strong>جارویس</strong>
            <span className="jdock-state">{stateLabel[state]}</span>
            <a className="jdock-link" href="/jarvis" title="نمای کامل">تمام‌صفحه</a>
            <button type="button" className="jdock-x" onClick={() => setOpen(false)} aria-label="بستن">×</button>
          </header>

          {open && (
            <JarvisConversation
              variant="overlay"
              autoFocus
              onState={setState}
              /* The page the owner is on is real context: "این را باز کن" means
               * something different on /finance than on /loop. */
              contextNote={`current page: ${pathname}`}
              placeholder={`دستور یا پرسش… (${pathname})`}
              emptyHint={priority
                ? `اولویت امروز: ${priority}`
                : 'هرچه لازم دارید بپرسید — به همهٔ سرویس‌ها، حافظه، مأموریت‌ها، هویت و حلقهٔ زنده دسترسی دارم.'}
            />
          )}

          <footer className="jdock-role">نقش: {role}</footer>
        </div>
      </dialog>
    </>
  );
}
