/**
 * D-198 — the horizontal day timeline.
 *
 * The two things that make a timeline useful are the two that fail silently: a
 * span that fits the day's actual events, and overlapping events that stack
 * rather than hide each other. Both are pure geometry, so both are pinned here.
 */
import { describe, it, expect } from 'vitest';
import { buildDayTimeline } from '@/app/calendar/format';
import type { CalEvent } from '@/app/calendar/format';

const DAY = '2026-08-03';
const ev = (id: string, from: string, to: string, over: Partial<CalEvent> = {}): CalEvent => ({
  eventId: id, calendarId: 'c1', summary: id,
  start: `${DAY}T${from}:00+00:00`, end: `${DAY}T${to}:00+00:00`,
  allDay: false, timeZone: 'UTC', description: '', location: '',
  attendees: [], hangoutLink: '', htmlLink: '', recurringEventId: '',
  createdByAos: false, status: 'confirmed',
  ...over,
} as CalEvent);

describe('buildDayTimeline', () => {
  it('keeps a working-hours span for an ordinary day', () => {
    const t = buildDayTimeline(DAY, [ev('a', '10:00', '11:00')], new Date(`${DAY}T09:00:00Z`));
    expect(t.fromHour).toBe(8);
    expect(t.toHour).toBe(20);
  });

  it('widens for an early or late event instead of clipping it', () => {
    // A 06:30 flight and a 22:00 call must both be on the track, not off it.
    const t = buildDayTimeline(DAY, [
      ev('early', '06:30', '07:15'), ev('late', '22:00', '23:30'),
    ], new Date(`${DAY}T09:00:00Z`));
    expect(t.fromHour).toBe(6);
    expect(t.toHour).toBe(24);
  });

  it('never narrows below the day it is given', () => {
    const t = buildDayTimeline(DAY, [ev('a', '13:00', '13:30')], new Date(`${DAY}T09:00:00Z`));
    expect(t.fromHour).toBeLessThanOrEqual(13);
    expect(t.toHour).toBeGreaterThanOrEqual(14);
  });

  it('positions a block proportionally inside the span', () => {
    const t = buildDayTimeline(DAY, [ev('noon', '14:00', '15:00')], new Date(`${DAY}T09:00:00Z`));
    // 08→20 is 12 hours; 14:00 is exactly half way.
    expect(Math.round(t.lanes[0].leftPct)).toBe(50);
    expect(Math.round(t.lanes[0].widthPct)).toBe(8);   // one hour of twelve
  });

  it('stacks overlapping events into separate lanes — a clash you cannot see is the bug', () => {
    const t = buildDayTimeline(DAY, [
      ev('a', '10:00', '11:00'), ev('b', '10:30', '11:30'), ev('c', '10:45', '11:15'),
    ], new Date(`${DAY}T09:00:00Z`));
    expect(t.laneCount).toBe(3);
    expect(t.lanes.map((l) => l.lane)).toEqual([0, 1, 2]);
  });

  it('reuses a lane once the previous event has ended', () => {
    const t = buildDayTimeline(DAY, [
      ev('a', '10:00', '11:00'), ev('b', '11:00', '12:00'),
    ], new Date(`${DAY}T09:00:00Z`));
    expect(t.laneCount).toBe(1);
    expect(t.lanes.every((l) => l.lane === 0)).toBe(true);
  });

  it('gives a zero-length event a visible width rather than an invisible sliver', () => {
    const t = buildDayTimeline(DAY, [ev('point', '10:00', '10:00')], new Date(`${DAY}T09:00:00Z`));
    expect(t.lanes[0].widthPct).toBeGreaterThan(1);
  });

  it('separates all-day events, which have no place on a clock', () => {
    const t = buildDayTimeline(DAY, [
      ev('trip', '00:00', '00:00', { allDay: true, start: DAY, end: DAY }),
      ev('call', '10:00', '10:30'),
    ], new Date(`${DAY}T09:00:00Z`));
    expect(t.allDay.map((e) => e.eventId)).toEqual(['trip']);
    expect(t.lanes.map((l) => l.event.eventId)).toEqual(['call']);
  });

  it('marks now only on the day being shown', () => {
    const withNow = buildDayTimeline(DAY, [ev('a', '10:00', '11:00')], new Date(`${DAY}T12:00:00`));
    expect(withNow.nowPct).toBeGreaterThan(0);
    const otherDay = buildDayTimeline('2026-08-04', [], new Date(`${DAY}T12:00:00`));
    expect(otherDay.nowPct).toBe(-1);
  });

  it('survives an empty day without dividing by zero', () => {
    const t = buildDayTimeline(DAY, [], new Date(`${DAY}T09:00:00Z`));
    expect(t.lanes).toEqual([]);
    expect(t.hours.length).toBeGreaterThan(1);
  });
});
