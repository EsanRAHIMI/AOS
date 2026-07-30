/**
 * Calendar formatting and grid maths (D-193).
 *
 * Pure, deterministic, and unit-tested, because every bug here is a bug the
 * owner reads as fact: a meeting on the wrong day, an hour off, a Jalali date
 * that does not match their phone.
 *
 * Two decisions worth stating:
 *
 *  - **Jalali comes from `Intl`, not a conversion library.** The runtime ships
 *    a maintained implementation of the Persian calendar
 *    (`fa-IR-u-ca-persian`); a hand-rolled or vendored converter is one more
 *    thing to get leap years wrong in, forever.
 *  - **Times are formatted from the real instant in a real zone**, never by
 *    slicing the RFC3339 string. `…T05:30:00+04:30`.slice(11,16) happens to
 *    read right and `…T05:30:00Z` reads an hour or more wrong — the first
 *    version did exactly that.
 */

export type CalView = 'month' | 'week' | 'agenda';

export interface CalEvent {
  eventId: string;
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  /** RFC3339 instant, or YYYY-MM-DD for all-day. */
  start: string;
  end: string;
  allDay: boolean;
  timeZone?: string;
  status?: string;
  hangoutLink?: string;
  htmlLink?: string;
  createdByAos?: boolean;
  recurringEventId?: string;
  attendees?: Array<{ email: string; responseStatus?: string }>;
}

/* --------------------------------------------------------------- calendars */

/** Persian weeks start on Saturday. */
export const WEEKDAY_FA = ['شنبه', 'یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

/** JS `getDay()` is 0=Sunday; this maps it to a Saturday-first column index. */
export function saturdayIndex(date: Date): number {
  return (date.getDay() + 1) % 7;
}

const jalaliParts = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', {
  year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC',
});
const jalaliMonthName = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'long', timeZone: 'UTC' });

export interface JalaliDate { year: number; month: number; day: number; monthName: string }

/** Jalali parts for a YYYY-MM-DD day key, via the runtime's own calendar. */
export function toJalali(dayKey: string): JalaliDate {
  const d = new Date(`${dayKey}T12:00:00Z`);
  const parts = Object.fromEntries(
    jalaliParts.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    monthName: jalaliMonthName.format(d),
  };
}

/* ------------------------------------------------------------------- time */

/**
 * Wall-clock time of an instant, in the zone the event belongs to.
 * Falls back to the viewer's zone when the event carries none.
 */
export function timeLabel(iso: string, timeZone?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false,
      ...(timeZone ? { timeZone } : {}),
    }).format(d);
  } catch {
    // An unknown IANA zone must not blank the whole agenda.
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  }
}

/** The local day an event falls on — the key every view groups by. */
export function dayKeyOf(iso: string, timeZone?: string): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;      // all-day: already a key
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    // en-CA renders as YYYY-MM-DD, which is exactly the key format.
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function todayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(dayKey: string, n: number): string {
  const d = new Date(`${dayKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------- month grid */

export interface GridDay {
  key: string;
  /** Gregorian day-of-month. */
  gDay: number;
  jalali: JalaliDate;
  inMonth: boolean;
  isToday: boolean;
  isFriday: boolean;
}

/**
 * Six weeks of days covering the Jalali month that contains `anchor`.
 *
 * Six rows always, never five-or-six: a grid that changes height as you page
 * through months makes the whole page jump, which reads as broken.
 */
export function buildMonthGrid(anchorKey: string, now: Date = new Date()): GridDay[] {
  const anchor = toJalali(anchorKey);

  // Walk back to day 1 of this Jalali month.
  let first = anchorKey;
  for (let i = 0; i < 40 && toJalali(first).day !== 1; i += 1) first = addDays(first, -1);

  // Then back to the Saturday that starts that week.
  let cursor = first;
  for (let i = 0; i < 7 && saturdayIndex(new Date(`${cursor}T12:00:00Z`)) !== 0; i += 1) {
    cursor = addDays(cursor, -1);
  }

  const today = todayKey(now);
  const out: GridDay[] = [];
  for (let i = 0; i < 42; i += 1) {
    const key = addDays(cursor, i);
    const j = toJalali(key);
    const d = new Date(`${key}T12:00:00Z`);
    out.push({
      key,
      gDay: d.getUTCDate(),
      jalali: j,
      inMonth: j.month === anchor.month && j.year === anchor.year,
      isToday: key === today,
      isFriday: saturdayIndex(d) === 6,
    });
  }
  return out;
}

/** The Saturday-based week containing `anchorKey`. */
export function buildWeek(anchorKey: string, now: Date = new Date()): GridDay[] {
  let cursor = anchorKey;
  for (let i = 0; i < 7 && saturdayIndex(new Date(`${cursor}T12:00:00Z`)) !== 0; i += 1) {
    cursor = addDays(cursor, -1);
  }
  const today = todayKey(now);
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDays(cursor, i);
    const d = new Date(`${key}T12:00:00Z`);
    return {
      key,
      gDay: d.getUTCDate(),
      jalali: toJalali(key),
      inMonth: true,
      isToday: key === today,
      isFriday: saturdayIndex(d) === 6,
    };
  });
}

/** Shift by whole Jalali months, landing on day 1. */
export function shiftMonth(anchorKey: string, delta: number): string {
  let key = anchorKey;
  const dir = delta >= 0 ? 1 : -1;
  for (let step = 0; step < Math.abs(delta); step += 1) {
    const start = toJalali(key);
    // Walk day by day until the month index changes, then to that month's day 1.
    let guard = 0;
    while (guard < 45) {
      key = addDays(key, dir);
      const j = toJalali(key);
      if (j.month !== start.month) break;
      guard += 1;
    }
    while (toJalali(key).day !== 1) key = addDays(key, dir >= 0 ? -1 : -1);
  }
  return key;
}

/* ------------------------------------------------------------- event index */

export type EventsByDay = Map<string, CalEvent[]>;

/**
 * Group events by the day they occur on, sorted within each day: all-day
 * first (they frame the day), then by start time.
 */
export function indexByDay(events: CalEvent[]): EventsByDay {
  const map: EventsByDay = new Map();
  for (const e of events) {
    if (e.status === 'cancelled') continue;
    const key = dayKeyOf(e.start, e.timeZone);
    if (!key) continue;
    map.set(key, [...(map.get(key) ?? []), e]);
  }
  for (const [key, list] of map) {
    map.set(key, list.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a.start.localeCompare(b.start);
    }));
  }
  return map;
}

/**
 * A stable colour per calendar, so the same calendar looks the same on every
 * view without the owner configuring anything.
 */
export function calendarHue(calendarId: string): number {
  let h = 0;
  for (let i = 0; i < calendarId.length; i += 1) h = (h * 31 + calendarId.charCodeAt(i)) % 360;
  return h;
}

/** Duration in minutes — used to size blocks in the week view. */
export function durationMinutes(e: CalEvent): number {
  if (e.allDay) return 24 * 60;
  const s = new Date(e.start).getTime();
  const t = new Date(e.end).getTime();
  if (Number.isNaN(s) || Number.isNaN(t) || t <= s) return 30;
  return Math.round((t - s) / 60000);
}

/** Minutes from midnight, in the event's own zone — the week view's y-axis. */
export function minutesFromMidnight(iso: string, timeZone?: string): number {
  const label = timeLabel(iso, timeZone);
  const [h, m] = label.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
}
