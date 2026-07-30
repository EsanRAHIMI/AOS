import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MonthGrid, WeekGrid, Agenda, DayPanel, CalendarNav } from '../src/app/calendar/views';
import type { CalEvent } from '../src/app/calendar/format';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const ev = (id: string, start: string, extra: Partial<CalEvent> = {}): CalEvent => ({
  eventId: id, calendarId: 'c1', summary: id, start, end: start, allDay: false,
  timeZone: 'Asia/Tehran', ...extra,
});

describe('calendar views render', () => {
  it('month grid shows 42 cells with Jalali day numbers', () => {
    const out = html(<MonthGrid anchor="2026-07-31" events={[ev('جلسه', '2026-07-31T09:00:00+03:30')]} selected="2026-07-31" view="month" />);
    expect((out.match(/calx-cell/g) ?? []).length).toBeGreaterThanOrEqual(42);
    expect(out).toContain('جلسه');
    expect(out).toContain('شنبه');
  });

  it('month cell caps the pills and says how many more', () => {
    const many = Array.from({ length: 6 }, (_, i) => ev(`e${i}`, '2026-07-31T0' + i + ':00:00+03:30'));
    const out = html(<MonthGrid anchor="2026-07-31" events={many} selected="2026-07-31" view="month" />);
    expect(out).toContain('+3 مورد دیگر');
  });

  it('week view lays out 24 hour lines per column', () => {
    const out = html(<WeekGrid anchor="2026-07-31" events={[ev('x', '2026-07-31T09:00:00+03:30')]} selected="2026-07-31" view="week" />);
    expect((out.match(/calx-hline/g) ?? []).length).toBe(24 * 7);
  });

  it('day panel shows a start–end range, not a bare time', () => {
    const out = html(<DayPanel dayKey="2026-07-31" events={[ev('x', '2026-07-31T09:00:00+03:30', { end: '2026-07-31T10:30:00+03:30' })]} />);
    expect(out).toContain('09:00');
    expect(out).toContain('10:30');
  });

  it('nav links carry view and day so every view is linkable', () => {
    const out = html(<CalendarNav view="month" anchor="2026-07-31" prev="2026-07-01" next="2026-08-23" selected="2026-07-31" title="مرداد" />);
    expect(out).toContain('view=month');
    expect(out).toContain('view=week');
    expect(out).toContain('amp;day=');
  });

  it('agenda says so plainly when the window is empty', () => {
    const out = html(<Agenda anchor="2026-07-31" events={[]} selected="2026-07-31" view="agenda" />);
    expect(out).toContain('رویدادی در این بازه نیست');
  });
});
