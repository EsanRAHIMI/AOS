'use client';
/**
 * HappeningLayer (D-208) — every happening gets a card, and a card that
 * belongs under an earlier one flies there.
 *
 * OWNER DIRECTIVE (2026-07-31), implemented literally:
 *   "For every happening there must be a card. If that new card belongs under
 *    earlier cards, then after being shown for a few seconds it must go under
 *    its parent card. All of it summarised, user-friendly, categorisable, and
 *    animated on this same stage."
 *
 * THE THREE PLACES A CARD CAN BE
 * ------------------------------
 *   1. FOCUS   — it just happened. Full size, centre of the stage, readable.
 *   2. FLIGHT  — its dwell expired. It animates from where it sits to its
 *                destination, shrinking as it goes.
 *   3. SETTLED — it lives under its parent (nested) or in its category pile.
 *
 * WHY THE FLIGHT IS MEASURED, NOT SCRIPTED
 * ----------------------------------------
 * The destination is read from the DOM with `getBoundingClientRect` at the
 * moment the flight starts, and the card is translated by the delta. A
 * hardcoded path would desynchronise the instant the rail reflows, the window
 * resizes, or a pile grows — and a card landing next to its pile instead of
 * in it reads as a bug, not a flourish. Measuring costs one layout read per
 * departure and is always right.
 *
 * DWELL IS PROPORTIONAL TO WEIGHT
 * -------------------------------
 * A memory read and a pending approval are not equally worth the owner's eye,
 * so they do not get equal time in focus. A pending approval (weight 1) never
 * departs on its own at all — it is the one card where the system is stopped,
 * waiting on a human, and animating it away would be the interface actively
 * hiding the thing it most needs to show.
 *
 * REDUCED MOTION
 * --------------
 * With `prefers-reduced-motion`, cards appear directly in their settled place.
 * No flight, no dwell timer — the same information, no movement.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useHappenings, CATEGORY_LABEL_FA, CATEGORY_ORDER,
  type Happening, type HappeningCategory, type HappeningGroup,
} from '@/lib/useHappenings';
import { bidiProps } from '@/lib/rtl';
import { readinessAction, type ReadinessGapView } from './actions';

/* ------------------------------- timing -------------------------------- */

/** Base seconds in focus, plus up to this much more for a heavy card. */
const DWELL_BASE_MS = 3200;
const DWELL_WEIGHT_MS = 5200;
/** Must match the CSS transition on `.hp-card--flying`. */
const FLIGHT_MS = 900;

function dwellFor(h: Happening): number {
  // Anything the system is blocked on stays until the owner deals with it.
  if (h.status === 'waiting') return Infinity;
  return DWELL_BASE_MS + DWELL_WEIGHT_MS * Math.min(1, Math.max(0, h.weight));
}

/* ------------------------------- labels -------------------------------- */

const KIND_LABEL_FA: Record<Happening['kind'], string> = {
  owner_said: 'شما گفتید',
  jarvis_replied: 'جارویس',
  tool_ran: 'انجام شد',
  tool_blocked: 'انجام نشد',
  approval: 'منتظر تأیید شما',
  noticed: 'جارویس متوجه شد',
  loop_cycle: 'چرخهٔ خودکار',
};

const STATUS_LABEL_FA: Record<Happening['status'], string> = {
  ok: 'انجام شد',
  failed: 'ناموفق',
  waiting: 'منتظر تأیید',
  denied: 'اجازه داده نشد',
  running: 'در حال انجام',
};

function timeFa(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/* -------------------------------- card --------------------------------- */

function CardBody({ h, compact }: { h: Happening; compact?: boolean }) {
  return (
    <>
      <div className="hp-card-head">
        <span className={`hp-dot hp-dot--${h.status}`} aria-hidden />
        <span className="hp-kind">{KIND_LABEL_FA[h.kind]}</span>
        <span className="hp-time" dir="ltr">{timeFa(h.at)}</span>
      </div>
      <div className="hp-title" {...bidiProps(h.title)}>{h.title}</div>
      {!compact && h.detail ? (
        <div className="hp-detail" {...bidiProps(h.detail)}>{h.detail}</div>
      ) : null}
      {!compact ? (
        <div className="hp-foot">
          <span className={`hp-badge hp-badge--${h.status}`}>{STATUS_LABEL_FA[h.status]}</span>
          <span className="hp-cat">{CATEGORY_LABEL_FA[h.category]}</span>
          {h.href ? <a className="hp-link" href={h.href}>باز کردن</a> : null}
        </div>
      ) : null}
    </>
  );
}

/* ----------------------------- readiness ------------------------------- */

const SEVERITY_LABEL_FA: Record<ReadinessGapView['severity'], string> = {
  blocking: 'مانع',
  limiting: 'محدودکننده',
  info: 'اطلاع',
};

/**
 * The gaps panel — "what is missing, and the one thing to do about it".
 *
 * Deliberately NOT a happening card: a happening is something that occurred at
 * a point in time and scrolls away. A gap is a standing condition that stays
 * until the owner fixes it, so it gets a fixed place on the stage and
 * disappears only when the underlying check passes. Mixing the two would mean
 * either gaps scrolling out of sight, or the history filling with the same
 * card once per poll.
 */
function ReadinessPanel() {
  const [gaps, setGaps] = useState<ReadinessGapView[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => { void readinessAction().then((g) => { if (alive) setGaps(g); }).catch(() => { /* keep last known */ }); };
    const boot = setTimeout(load, 2000);
    const t = setInterval(load, 120_000);
    return () => { alive = false; clearTimeout(boot); clearInterval(t); };
  }, []);

  if (!gaps.length) return null;
  const blocking = gaps.filter((g) => g.severity === 'blocking').length;

  return (
    <section className={`hp-gaps ${open ? 'is-open' : ''}`} aria-label="چیزهایی که سیستم لازم دارد">
      <button type="button" className="hp-gaps-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={`hp-dot ${blocking ? 'hp-dot--failed' : 'hp-dot--waiting'}`} aria-hidden />
        <span className="hp-gaps-title">
          {blocking ? `${blocking} مورد جلوی کار را گرفته` : `${gaps.length} مورد ناقص`}
        </span>
        <span className="hp-gaps-chevron" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <ul className="hp-gaps-list">
          {gaps.map((g) => (
            <li key={g.gapId} className={`hp-gap hp-gap--${g.severity}`}>
              <div className="hp-gap-top">
                <span className={`hp-badge hp-badge--${g.severity === 'blocking' ? 'failed' : g.severity === 'limiting' ? 'waiting' : 'ok'}`}>
                  {SEVERITY_LABEL_FA[g.severity]}
                </span>
                <span className="hp-gap-title" {...bidiProps(g.title)}>{g.title}</span>
              </div>
              <p className="hp-gap-why" {...bidiProps(g.consequence)}>{g.consequence}</p>
              <p className="hp-gap-do" {...bidiProps(g.action)}>{g.action}</p>
              {g.href ? <a className="hp-link" href={g.href}>رفتن به محل اصلاح</a> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* ------------------------------ the layer ------------------------------ */

type Phase = 'focus' | 'flying';

interface FlightStyle { transform: string; opacity: number }

export default function HappeningLayer() {
  const { groups, items, fresh, live, loaded, settle } = useHappenings();
  const [reducedMotion, setReducedMotion] = useState(false);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [openCategory, setOpenCategory] = useState<HappeningCategory | null>(null);
  const [phases, setPhases] = useState<Record<string, Phase>>({});
  const [flights, setFlights] = useState<Record<string, FlightStyle>>({});

  const focusRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const targetRefs = useRef<Map<string, HTMLElement>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const byId = useMemo(() => new Map(items.map((h) => [h.happeningId, h])), [items]);

  /**
   * Where a card lands.
   *
   * Its parent card if that parent is on screen; otherwise its category pile.
   * A child whose parent has aged out is NOT dropped — it lands in its
   * category, which is where the owner would go looking for it anyway.
   */
  const destinationKey = useCallback((h: Happening): string => {
    if (h.parentId && byId.has(h.parentId)) return `group:${h.parentId}`;
    return `cat:${h.category}`;
  }, [byId]);

  /* Focus cards: live arrivals that have not settled yet, newest first. */
  const focusCards = useMemo(
    () => fresh.map((id) => byId.get(id)).filter((h): h is Happening => Boolean(h)),
    [fresh, byId],
  );

  /**
   * Launch the flight for one card: measure now, translate, then settle.
   *
   * Measuring inside the timeout (not when the timer was scheduled) is the
   * point — by the time a card departs, the rail may have reflowed under it.
   */
  const launch = useCallback((id: string) => {
    const h = byId.get(id);
    const el = focusRefs.current.get(id);
    if (!h || !el) { settle(id); return; }

    const target = targetRefs.current.get(destinationKey(h));
    if (!target) { settle(id); return; }

    const from = el.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
    const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
    // Shrink toward the destination's width, floored so it never inverts on a
    // narrow rail.
    const scale = Math.max(0.18, Math.min(1, to.width / Math.max(1, from.width)));

    setFlights((prev) => ({ ...prev, [id]: { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.05 } }));
    setPhases((prev) => ({ ...prev, [id]: 'flying' }));

    const done = setTimeout(() => {
      settle(id);
      setPhases((prev) => { const next = { ...prev }; delete next[id]; return next; });
      setFlights((prev) => { const next = { ...prev }; delete next[id]; return next; });
      timers.current.delete(`${id}:flight`);
    }, FLIGHT_MS);
    timers.current.set(`${id}:flight`, done);
  }, [byId, destinationKey, settle]);

  /* Schedule each fresh card's departure exactly once. */
  useEffect(() => {
    if (reducedMotion) {
      // No flight: settle immediately so the card renders in its final place.
      for (const h of focusCards) settle(h.happeningId);
      return;
    }
    for (const h of focusCards) {
      const key = `${h.happeningId}:dwell`;
      if (timers.current.has(key)) continue;
      const ms = dwellFor(h);
      if (!Number.isFinite(ms)) continue; // waits for the owner, not a clock
      const t = setTimeout(() => { timers.current.delete(key); launch(h.happeningId); }, ms);
      timers.current.set(key, t);
    }
  }, [focusCards, launch, reducedMotion, settle]);

  /* One place clears every pending timer — a stage that unmounts mid-flight
   * must not leave a setTimeout holding a stale closure over removed nodes. */
  useEffect(() => {
    const map = timers.current;
    return () => { for (const t of map.values()) clearTimeout(t); map.clear(); };
  }, []);

  /* Piles: every category with something in it, in owner-proximity order. */
  const piles = useMemo(() => {
    const counts = new Map<HappeningCategory, number>();
    for (const h of items) counts.set(h.category, (counts.get(h.category) ?? 0) + 1);
    return CATEGORY_ORDER
      .filter((c) => counts.has(c))
      .map((c) => ({ category: c, count: counts.get(c) ?? 0 }));
  }, [items]);

  /** Groups shown in the settled column, filtered by the open category. */
  const settledGroups = useMemo<HappeningGroup[]>(() => {
    const visible = openCategory
      ? groups.filter((g) => g.root.category === openCategory
        || g.children.some((c) => c.category === openCategory))
      : groups;
    return visible.slice(0, 40);
  }, [groups, openCategory]);

  const flyingIds = new Set(Object.keys(phases));
  // A card in flight is still drawn in focus (it is the thing moving), so the
  // settled column must not draw a second copy of it at the same time.
  const inFlightOrFocus = new Set([...focusCards.map((h) => h.happeningId), ...flyingIds]);

  return (
    <div className="hp-layer" dir="rtl">
      {/* ------------------------- category rail ------------------------- */}
      <aside className="hp-rail" aria-label="دسته‌بندی اتفاق‌ها">
        <div className="hp-rail-head">
          <span className={`hp-live-dot ${live ? 'is-live' : ''}`} aria-hidden />
          <span className="hp-rail-title">{live ? 'زنده' : 'قطع'}</span>
        </div>
        <button
          type="button"
          className={`hp-pile hp-pile--all ${openCategory === null ? 'is-open' : ''}`}
          onClick={() => setOpenCategory(null)}
        >
          <span className="hp-pile-label">همه</span>
          <span className="hp-pile-count" dir="ltr">{items.length}</span>
        </button>
        {piles.map((p) => (
          <button
            key={p.category}
            type="button"
            ref={(el) => { if (el) targetRefs.current.set(`cat:${p.category}`, el); }}
            className={`hp-pile hp-pile--${p.category} ${openCategory === p.category ? 'is-open' : ''}`}
            onClick={() => setOpenCategory((cur) => (cur === p.category ? null : p.category))}
          >
            <span className="hp-pile-label">{CATEGORY_LABEL_FA[p.category]}</span>
            <span className="hp-pile-count" dir="ltr">{p.count}</span>
          </button>
        ))}
      </aside>

      {/* --------------------------- focus zone --------------------------- */}
      <div className="hp-focus" aria-live="polite" aria-label="اتفاق‌های تازه">
        {focusCards.map((h) => (
          <div
            key={h.happeningId}
            ref={(el) => { if (el) focusRefs.current.set(h.happeningId, el); else focusRefs.current.delete(h.happeningId); }}
            className={`hp-card hp-card--focus hp-card--${h.category} ${phases[h.happeningId] === 'flying' ? 'hp-card--flying' : ''}`}
            style={flights[h.happeningId]}
            data-weight={h.weight >= 0.8 ? 'high' : undefined}
          >
            <CardBody h={h} />
          </div>
        ))}
      </div>

      {/* -------------------------- settled column ------------------------ */}
      <section className="hp-settled" aria-label="تاریخچهٔ اتفاق‌ها">
        {/* Standing conditions sit ABOVE the scrolling history: a gap that
            scrolled away with old cards would be a gap nobody ever fixes. */}
        <ReadinessPanel />
        {!loaded ? (
          <p className="hp-empty">در حال اتصال به جریان زنده…</p>
        ) : settledGroups.length === 0 ? (
          <p className="hp-empty">
            هنوز اتفاقی ثبت نشده. هر کاری که انجام بدهید یا به جارویس بگویید، همین‌جا به‌صورت کارت زنده ظاهر می‌شود.
          </p>
        ) : (
          settledGroups.map((g) => {
            const open = openGroupId === g.root.happeningId;
            const hidden = inFlightOrFocus.has(g.root.happeningId);
            return (
              <div
                key={g.root.happeningId}
                ref={(el) => { if (el) targetRefs.current.set(`group:${g.root.happeningId}`, el); }}
                className={`hp-group ${open ? 'is-open' : ''} ${hidden ? 'is-placeholder' : ''}`}
              >
                <div className={`hp-card hp-card--root hp-card--${g.root.category}`}>
                  <CardBody h={g.root} />
                  {g.children.length ? (
                    <button
                      type="button"
                      className="hp-nest-toggle"
                      aria-expanded={open}
                      onClick={() => setOpenGroupId(open ? null : g.root.happeningId)}
                    >
                      <span className="hp-nest-count" dir="ltr">{g.children.length}</span>
                      <span>{open ? 'بستن' : 'کارهای زیرمجموعه'}</span>
                    </button>
                  ) : null}
                </div>
                {open && g.children.length ? (
                  <div className="hp-children">
                    {g.children.map((c) => (
                      <div key={c.happeningId} className={`hp-card hp-card--child hp-card--${c.category}`}>
                        <CardBody h={c} compact={false} />
                      </div>
                    ))}
                  </div>
                ) : null}
                {/* Collapsed nest: a stacked edge, so a parent LOOKS like it is
                    carrying its children even before it is expanded. */}
                {!open && g.children.length ? (
                  <div className="hp-stack" aria-hidden>
                    {g.children.slice(0, 3).map((c) => (
                      <span key={c.happeningId} className={`hp-stack-slab hp-stack-slab--${c.category}`} />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
