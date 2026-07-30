/**
 * D-193 — calendar maths.
 *
 * Every bug here is one the owner reads as fact: a meeting on the wrong day,
 * an hour off, a Jalali date that disagrees with their phone. So the grid, the
 * timezone handling and the Persian calendar are pinned.
 */
import { describe, it, expect } from 'vitest';
import {
  toJalali, timeLabel, dayKeyOf, addDays, buildMonthGrid, buildWeek, shiftMonth,
  indexByDay, saturdayIndex, durationMinutes, minutesFromMidnight, WEEKDAY_FA,
} from '../src/app/calendar/format';

describe('jalali dates', () => {
  it('matches known Gregorian↔Jalali pairs', () => {
    // Nowruz 1405 = 21 March 2026.
    expect(toJalali('2026-03-21')).toMatchObject({ year: 1405, month: 1, day: 1 });
    // The owner's screenshot day.
    expect(toJalali('2026-07-31')).toMatchObject({ year: 1405, month: 5, day: 9 });
  });

  it('names the month in Persian', () => {
    expect(toJalali('2026-03-21').monthName).toContain('فروردین');
  });
});

describe('week alignment', () => {
  it('treats Saturday as the first column', () => {
    // 2026-08-01 is a Saturday.
    expect(saturdayIndex(new Date('2026-08-01T12:00:00Z'))).toBe(0);
    expect(saturdayIndex(new Date('2026-08-07T12:00:00Z'))).toBe(6);   // Friday
    expect(WEEKDAY_FA[0]).toBe('شنبه');
    expect(WEEKDAY_FA[6]).toBe('جمعه');
  });
});

describe('time and day resolution', () => {
  it('formats from the real instant in the event zone, not by slicing the string', () => {
    // Tehran is UTC+03:30 all year (Iran abolished DST in 2022), so 22:30Z is
    // 02:00 the NEXT day. The naive `.slice(11,16)` reads "22:30" — wrong day
    // and wrong hour. This is exactly the bug the function exists to prevent.
    expect(timeLabel('2026-07-31T22:30:00Z', 'Asia/Tehran')).toBe('02:00');
    expect(timeLabel('2026-07-31T05:30:00+03:30', 'Asia/Tehran')).toBe('05:30');
  });

  it('survives an unknown timezone instead of blanking the agenda', () => {
    expect(timeLabel('2026-07-31T10:00:00Z', 'Not/AZone')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('puts a late-night UTC instant on the correct LOCAL day', () => {
    // 23:30 UTC on the 30th is 03:00 on the 31st in Tehran (+03:30).
    expect(dayKeyOf('2026-07-30T23:30:00Z', 'Asia/Tehran')).toBe('2026-07-31');
  });

  it('passes an all-day date through untouched', () => {
    expect(dayKeyOf('2026-07-31')).toBe('2026-07-31');
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-08-01', -1)).toBe('2026-07-31');
  });
});

describe('month grid', () => {
  const grid = buildMonthGrid('2026-07-31');

  it('is always six weeks, so paging months never resizes the page', () => {
    expect(grid).toHaveLength(42);
  });

  it('starts on a Saturday', () => {
    expect(saturdayIndex(new Date(`${grid[0].key}T12:00:00Z`))).toBe(0);
  });

  it('contains the anchor day and marks it in-month', () => {
    const cell = grid.find((d) => d.key === '2026-07-31');
    expect(cell?.inMonth).toBe(true);
  });

  it('marks leading/trailing days as out of month', () => {
    expect(grid.some((d) => !d.inMonth)).toBe(true);
  });

  it('flags Fridays for the weekend column', () => {
    const fridays = grid.filter((d) => d.isFriday);
    expect(fridays).toHaveLength(6);
  });

  it('every in-month cell belongs to the same Jalali month', () => {
    const months = new Set(grid.filter((d) => d.inMonth).map((d) => d.jalali.month));
    expect(months.size).toBe(1);
  });
});

describe('week view', () => {
  it('returns exactly seven days starting Saturday', () => {
    const week = buildWeek('2026-08-04');
    expect(week).toHaveLength(7);
    expect(saturdayIndex(new Date(`${week[0].key}T12:00:00Z`))).toBe(0);
    expect(week.some((d) => d.key === '2026-08-04')).toBe(true);
  });
});

describe('month navigation', () => {
  it('moves a whole Jalali month and lands on day 1', () => {
    const next = shiftMonth('2026-07-31', 1);
    expect(toJalali(next).day).toBe(1);
    expect(toJalali(next).month).toBe(6);

    const prev = shiftMonth('2026-07-31', -1);
    expect(toJalali(prev).day).toBe(1);
    expect(toJalali(prev).month).toBe(4);
  });
});

describe('event indexing', () => {
  const ev = (id: string, start: string, allDay = false) => ({
    eventId: id, calendarId: 'c', summary: id, start, end: start, allDay, timeZone: 'Asia/Tehran',
  });

  it('groups by local day and sorts all-day first, then by time', () => {
    const map = indexByDay([
      ev('late', '2026-07-31T18:00:00+03:30'),
      ev('early', '2026-07-31T09:00:00+03:30'),
      ev('allday', '2026-07-31', true),
    ]);
    expect(map.get('2026-07-31')?.map((e) => e.eventId)).toEqual(['allday', 'early', 'late']);
  });

  it('drops cancelled events — they must not linger on the grid', () => {
    const map = indexByDay([{ ...ev('gone', '2026-07-31T09:00:00Z'), status: 'cancelled' }]);
    expect(map.size).toBe(0);
  });
});

describe('week-view geometry', () => {
  it('measures duration and offset in minutes', () => {
    const e = {
      eventId: 'x', calendarId: 'c', summary: 'x', allDay: false, timeZone: 'Asia/Tehran',
      start: '2026-07-31T09:00:00+03:30', end: '2026-07-31T10:30:00+03:30',
    };
    expect(durationMinutes(e)).toBe(90);
    expect(minutesFromMidnight(e.start, 'Asia/Tehran')).toBe(9 * 60);
  });

  it('gives a zero-length event a usable minimum height', () => {
    const e = {
      eventId: 'x', calendarId: 'c', summary: 'x', allDay: false,
      start: '2026-07-31T09:00:00Z', end: '2026-07-31T09:00:00Z',
    };
    expect(durationMinutes(e)).toBe(30);
  });
});
