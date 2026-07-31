import Link from 'next/link';
import { bidiProps } from '@/lib/rtl';
import {
  WEEKDAY_FA, buildMonthGrid, buildWeek, indexByDay, dateParts, toJalali, toGregorian, timeLabel,
  calendarHue, durationMinutes, minutesFromMidnight, todayKey,
  DEFAULT_CAL_SYSTEM,
  type CalEvent, type CalView, type CalSystem, type GridDay,
} from './format';

/**
 * The calendar surfaces (D-193).
 *
 * The first version was a flat 30-day list. With three daily recurring events
 * it became the same three lines repeated twenty-one times — technically the
 * owner's calendar, practically unreadable. A calendar needs a grid: density
 * you can scan, not a scroll you must read.
 *
 * Server components; navigation is URL state (`?view=&day=`), so every view is
 * linkable, back/forward works, and there is no client store to desynchronise.
 */

function href(view: CalView, day: string, selected?: string, system?: CalSystem): string {
  const p = new URLSearchParams({ view, day });
  if (selected) p.set('sel', selected);
  // Only in the URL when it is not the default — a clean link for the common case.
  if (system && system !== DEFAULT_CAL_SYSTEM) p.set('cal', system);
  return `/calendar?${p.toString()}`;
}

/** A colour per calendar so the same source looks the same in every view. */
function chip(e: CalEvent): React.CSSProperties {
  const h = calendarHue(e.calendarId);
  return {
    // Two channels of information in one mark: hue = which calendar,
    // solid vs outline = ours vs the owner's.
    background: `hsla(${h}, 70%, 60%, ${e.createdByAos ? 0.28 : 0.16})`,
    borderColor: `hsla(${h}, 75%, 65%, 0.55)`,
  };
}

/* ------------------------------------------------------------------ month */

export function MonthGrid({
  anchor, events, selected, view, system = DEFAULT_CAL_SYSTEM,
}: {
  anchor: string; events: CalEvent[]; selected: string; view: CalView; system?: CalSystem;
}) {
  const grid = buildMonthGrid(anchor, system);
  const byDay = indexByDay(events);

  return (
    <div className="calx-month">
      <div className="calx-weekhead">
        {WEEKDAY_FA.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="calx-grid">
        {grid.map((d) => {
          const list = byDay.get(d.key) ?? [];
          return (
            <Link
              key={d.key}
              href={href(view, anchor, d.key, system)}
              className={[
                'calx-cell',
                d.inMonth ? '' : 'out',
                d.isToday ? 'today' : '',
                d.isFriday ? 'fri' : '',
                d.key === selected ? 'sel' : '',
              ].filter(Boolean).join(' ')}
            >
              <span className="calx-cell-h">
                <span className="calx-j">{d.jalali.day}</span>
                {/* The other calendar, quietly. Iranian working life runs on
                  * both, and converting in your head is a tax. */}
                <span className="calx-g" dir="ltr">{d.alt?.day ?? d.gDay}</span>
              </span>
              <span className="calx-cell-body">
                {list.slice(0, 3).map((e) => (
                  <span key={e.eventId} className="calx-pill" style={chip(e)} {...bidiProps(e.summary)}>
                    {!e.allDay && <b dir="ltr">{timeLabel(e.start, e.timeZone)}</b>}
                    {e.summary || '(بدون عنوان)'}
                  </span>
                ))}
                {list.length > 3 && <span className="calx-more">+{list.length - 3} مورد دیگر</span>}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- week */

const HOUR_PX = 44;

export function WeekGrid({
  anchor, events, selected, view, system = DEFAULT_CAL_SYSTEM, days,
}: {
  anchor: string; events: CalEvent[]; selected: string; view: CalView;
  system?: CalSystem; days?: GridDay[];
}) {
  const week = days ?? buildWeek(anchor, system);
  const byDay = indexByDay(events);

  return (
    <div className="calx-week">
      <div className="calx-week-head">
        <span className="calx-gutter" />
        {week.map((d) => (
          <Link key={d.key} href={href(view, anchor, d.key, system)}
            className={`calx-week-day${d.isToday ? ' today' : ''}${d.key === selected ? ' sel' : ''}`}>
            <b>{WEEKDAY_FA[(new Date(`${d.key}T12:00:00Z`).getDay() + 1) % 7]}</b>
            <span>{d.jalali.day} {d.jalali.monthName}</span>
          </Link>
        ))}
      </div>

      <div className="calx-week-body" style={{ ['--hour' as string]: `${HOUR_PX}px` }}>
        <div className="calx-gutter calx-hours">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} dir="ltr">{String(h).padStart(2, '0')}</span>
          ))}
        </div>
        {week.map((d) => {
          const list = byDay.get(d.key) ?? [];
          return (
            <div key={d.key} className={`calx-col${d.isFriday ? ' fri' : ''}`}>
              {Array.from({ length: 24 }, (_, h) => <span key={h} className="calx-hline" />)}
              {list.filter((e) => !e.allDay).map((e) => {
                const top = (minutesFromMidnight(e.start, e.timeZone) / 60) * HOUR_PX;
                const height = Math.max(18, (durationMinutes(e) / 60) * HOUR_PX);
                return (
                  <span key={e.eventId} className="calx-block" style={{ ...chip(e), top, height }}
                    {...bidiProps(e.summary)}>
                    <b dir="ltr">{timeLabel(e.start, e.timeZone)}</b> {e.summary}
                  </span>
                );
              })}
              {list.filter((e) => e.allDay).map((e) => (
                <span key={e.eventId} className="calx-allday" style={chip(e)} {...bidiProps(e.summary)}>{e.summary}</span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- agenda */

export function Agenda({ events, selected, anchor, view, system = DEFAULT_CAL_SYSTEM }: {
  events: CalEvent[]; selected: string; anchor: string; view: CalView; system?: CalSystem;
}) {
  const byDay = indexByDay(events);
  const days = [...byDay.keys()].sort();
  const today = todayKey();

  if (days.length === 0) {
    return <p className="calx-empty">رویدادی در این بازه نیست.</p>;
  }

  return (
    <div className="calx-agenda">
      {days.map((key) => {
        const j = dateParts(key, system);
        return (
          <div key={key} className={`calx-aday${key === today ? ' today' : ''}`}>
            <Link href={href(view, anchor, key, system)} className="calx-aday-h">
              <b>{j.day} {j.monthName}</b>
              <span dir="ltr">{key}</span>
            </Link>
            <ul>
              {(byDay.get(key) ?? []).map((e) => (
                <li key={e.eventId} style={{ borderInlineStartColor: `hsla(${calendarHue(e.calendarId)},75%,65%,.7)` }}>
                  <span className="calx-atime" dir="ltr">
                    {e.allDay ? '—' : timeLabel(e.start, e.timeZone)}
                  </span>
                  <span className="calx-atitle" {...bidiProps(e.summary)}>{e.summary || '(بدون عنوان)'}</span>
                  {e.createdByAos && <span className="calx-aos">AOS</span>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- day panel */

export function DayPanel({ dayKey, events, calendars, system = DEFAULT_CAL_SYSTEM }: {
  dayKey: string; events: CalEvent[]; calendars?: Record<string, string>; system?: CalSystem;
}) {
  const j = dateParts(dayKey, system);
  const alt = system === 'jalali' ? toGregorian(dayKey) : toJalali(dayKey);
  const list = (indexByDay(events).get(dayKey) ?? []);
  const weekday = WEEKDAY_FA[(new Date(`${dayKey}T12:00:00Z`).getDay() + 1) % 7];

  return (
    <section className="cal-glass calx-day">
      <header className="calx-day-h">
        <h2>{weekday} {j.day} {j.monthName} {j.year}</h2>
        <span className="calx-alt">{alt.day} {alt.monthName} {alt.year}</span>
      </header>

      {list.length === 0 ? (
        <p className="calx-empty">این روز خالی است.</p>
      ) : (
        <ul className="calx-day-list">
          {list.map((e) => (
            <li key={e.eventId} style={{ borderInlineStartColor: `hsla(${calendarHue(e.calendarId)},75%,65%,.75)` }}>
              <div className="calx-day-t">
                <span className="calx-day-time" dir="ltr">
                  {e.allDay ? 'تمام‌روز' : `${timeLabel(e.start, e.timeZone)} – ${timeLabel(e.end, e.timeZone)}`}
                </span>
                {e.createdByAos && <span className="calx-aos">AOS</span>}
              </div>
              <div className="calx-day-s" {...bidiProps(e.summary)}>{e.summary || '(بدون عنوان)'}</div>
              {/* Which calendar this came from — with several enabled, an
                * event without a source is an event you cannot act on. */}
              {calendars?.[e.calendarId] && (
                <div className="calx-day-src" {...bidiProps(calendars[e.calendarId])}>{calendars[e.calendarId]}</div>
              )}
              {e.location && <div className="calx-day-m" {...bidiProps(e.location)}>{e.location}</div>}
              {(e.attendees?.length ?? 0) > 0 && (
                <div className="calx-day-m">{e.attendees!.length} مهمان</div>
              )}
              <div className="calx-day-links">
                {e.hangoutLink && <a href={e.hangoutLink} target="_blank" rel="noopener noreferrer">Meet</a>}
                {e.htmlLink && <a href={e.htmlLink} target="_blank" rel="noopener noreferrer">در گوگل</a>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- navigation */

export function CalendarNav({
  view, anchor, prev, next, selected, title, system = DEFAULT_CAL_SYSTEM,
}: {
  view: CalView; anchor: string; prev: string; next: string; selected: string; title: string;
  system?: CalSystem;
}) {
  return (
    <div className="calx-nav">
      <div className="calx-nav-when">
        {/* Stepping a day must move the selection too, or the arrows change
          * the header while the content stays put (D-199b). */}
        <Link href={href(view, prev, view === 'day' ? prev : selected, system)}
          className="calx-arrow" aria-label="قبلی">‹</Link>
        <strong>{title}</strong>
        <Link href={href(view, next, view === 'day' ? next : selected, system)}
          className="calx-arrow" aria-label="بعدی">›</Link>
        <Link href={href(view, todayKey(), todayKey(), system)} className="calx-today">امروز</Link>
      </div>

      <div className="calx-views" role="tablist">
        {([['month', 'ماه'], ['week', 'هفته'], ['day', 'روز'], ['agenda', 'فهرست']] as Array<[CalView, string]>).map(([v, label]) => (
          <Link key={v} href={href(v, anchor, selected, system)} className={`calx-view${v === view ? ' on' : ''}`}
            aria-selected={v === view} role="tab">{label}</Link>
        ))}
      </div>

      {/* Calendar system. Two links, not a dropdown: it is a binary choice and
        * the current one should be readable without opening anything. */}
      <div className="calx-sys" role="tablist" aria-label="تقویم">
        <Link href={href(view, anchor, selected, 'gregorian')}
          className={`calx-view${system === 'gregorian' ? ' on' : ''}`} role="tab"
          aria-selected={system === 'gregorian'}>میلادی</Link>
        <Link href={href(view, anchor, selected, 'jalali')}
          className={`calx-view${system === 'jalali' ? ' on' : ''}`} role="tab"
          aria-selected={system === 'jalali'}>شمسی</Link>
      </div>
    </div>
  );
}

export type { GridDay };
