'use client';
/**
 * The day as a horizontal timeline (D-198).
 *
 * A single day rendered as a narrow vertical column wastes the axis the screen
 * is actually wide in, and pushes every detail into a tooltip. Laid out
 * horizontally, a day reads the way people describe it — left to right, with
 * gaps you can see — and each block has room for the time, the duration, the
 * location and the notes without opening anything.
 *
 * Selecting a block reveals its detail panel below the track, which is where
 * notes are written. Notes are AOS's own layer (see `shared/src/calendar/notes.ts`);
 * they are never written into the Google event.
 */
import { useState } from 'react';
import { bidiProps } from '@/lib/rtl';
import { saveNoteAction, deleteNoteAction } from './notes-action';
import {
  buildDayTimeline, timeLabel, calendarHue, durationMinutes,
  type CalEvent,
} from './format';

export interface EventNoteView {
  noteId: string;
  eventId: string;
  body: string;
  author: string;
  createdAt: string;
}

function durationLabel(e: CalEvent): string {
  const m = durationMinutes(e);
  if (m <= 0) return '';
  if (m % 60 === 0) return `${m / 60} ساعت`;
  if (m < 60) return `${m} دقیقه`;
  return `${Math.floor(m / 60)} ساعت و ${m % 60} دقیقه`;
}

export function DayTimeline({
  dayKey, events, calendars, notes: initialNotes,
}: {
  dayKey: string;
  events: CalEvent[];
  calendars: Record<string, string>;
  notes: Record<string, EventNoteView[]>;
}) {
  const t = buildDayTimeline(dayKey, events);
  const [selected, setSelected] = useState<string>(t.lanes[0]?.event.eventId ?? '');
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const current = t.lanes.find((l) => l.event.eventId === selected)?.event
    ?? t.allDay.find((e) => e.eventId === selected)
    ?? null;

  const addNote = async () => {
    if (!current || !draft.trim()) return;
    setBusy(true);
    const res = await saveNoteAction({
      calendarId: current.calendarId, eventId: current.eventId, body: draft,
    });
    setBusy(false);
    if (!res.note) return;
    // Optimistic in the sense that the server already answered — this just
    // avoids a full page round-trip for a two-line note.
    setNotes((n) => ({ ...n, [current.eventId]: [...(n[current.eventId] ?? []), res.note!] }));
    setDraft('');
  };

  const removeNote = async (noteId: string, eventId: string) => {
    setBusy(true);
    await deleteNoteAction(noteId);
    setBusy(false);
    setNotes((n) => ({ ...n, [eventId]: (n[eventId] ?? []).filter((x) => x.noteId !== noteId) }));
  };

  if (t.lanes.length === 0 && t.allDay.length === 0) {
    return <p className="calx-empty">این روز خالی است.</p>;
  }

  return (
    <div className="daytl">
      {t.allDay.length > 0 && (
        <div className="daytl-allday">
          <span className="daytl-allday-l">تمام‌روز</span>
          {t.allDay.map((e) => (
            <button key={e.eventId} type="button"
              className={`daytl-chip${selected === e.eventId ? ' on' : ''}`}
              style={{ borderColor: `hsla(${calendarHue(e.calendarId)},75%,65%,.55)` }}
              onClick={() => setSelected(e.eventId)}
              {...bidiProps(e.summary)}>{e.summary || '(بدون عنوان)'}</button>
          ))}
        </div>
      )}

      {/* The track. `dir="ltr"` because time runs left→right regardless of the
        * page's direction — an RTL clock would put 20:00 before 08:00. */}
      <div className="daytl-track" dir="ltr">
        <div className="daytl-hours">
          {t.hours.map((h, i) => (
            <span key={h} className="daytl-hour"
              style={{ left: `${(i / (t.hours.length - 1)) * 100}%` }}>
              <b>{String(h).padStart(2, '0')}</b>
            </span>
          ))}
        </div>

        <div className="daytl-lanes" style={{ height: `${t.laneCount * 52 + 8}px` }}>
          {t.hours.map((h, i) => (
            <span key={h} className="daytl-gridline"
              style={{ left: `${(i / (t.hours.length - 1)) * 100}%` }} />
          ))}

          {/* Where you are in the day — the one thing a timeline must show. */}
          {t.nowPct >= 0 && (
            <span className="daytl-now" style={{ left: `${t.nowPct}%` }}>
              <i />
            </span>
          )}

          {t.lanes.map(({ event: e, leftPct, widthPct, lane }) => {
            const hue = calendarHue(e.calendarId);
            const noteCount = (notes[e.eventId] ?? []).length;
            return (
              <button
                key={e.eventId}
                type="button"
                className={`daytl-block${selected === e.eventId ? ' on' : ''}`}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  top: `${lane * 52 + 4}px`,
                  background: `linear-gradient(180deg, hsla(${hue},70%,60%,.26), hsla(${hue},70%,55%,.14))`,
                  borderColor: `hsla(${hue},75%,65%,.55)`,
                }}
                onClick={() => setSelected(e.eventId)}
              >
                <span className="daytl-block-t">
                  {timeLabel(e.start, e.timeZone)}–{timeLabel(e.end, e.timeZone)}
                </span>
                <span className="daytl-block-s" {...bidiProps(e.summary)}>
                  {e.summary || '(بدون عنوان)'}
                </span>
                {noteCount > 0 && <span className="daytl-block-n">{noteCount}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------- detail */}
      {current && (
        <section className="daytl-detail">
          <header>
            <h3 {...bidiProps(current.summary)}>{current.summary || '(بدون عنوان)'}</h3>
            <span className="daytl-detail-when" dir="ltr">
              {current.allDay
                ? 'تمام‌روز'
                : `${timeLabel(current.start, current.timeZone)} – ${timeLabel(current.end, current.timeZone)}`}
            </span>
            {!current.allDay && <span className="daytl-detail-dur">{durationLabel(current)}</span>}
          </header>

          <dl className="daytl-facts">
            <div><dt>تقویم</dt><dd {...bidiProps(calendars[current.calendarId] ?? '')}>{calendars[current.calendarId] ?? current.calendarId}</dd></div>
            {current.location && <div><dt>مکان</dt><dd {...bidiProps(current.location)}>{current.location}</dd></div>}
            {(current.attendees?.length ?? 0) > 0 && <div><dt>مهمان</dt><dd>{current.attendees!.length} نفر</dd></div>}
            {current.recurringEventId && <div><dt>تکرار</dt><dd>بخشی از یک سری</dd></div>}
          </dl>

          {current.description && (
            <p className="daytl-desc" {...bidiProps(current.description)}>{current.description}</p>
          )}

          <div className="daytl-links">
            {current.hangoutLink && <a href={current.hangoutLink} target="_blank" rel="noopener noreferrer">Meet</a>}
            {current.htmlLink && <a href={current.htmlLink} target="_blank" rel="noopener noreferrer">در گوگل</a>}
          </div>

          {/* ------------------------------------------------------ notes */}
          <div className="daytl-notes">
            <h4>یادداشت‌ها</h4>
            {(notes[current.eventId] ?? []).length === 0 && (
              <p className="daytl-note-empty">هنوز یادداشتی ندارد.</p>
            )}
            <ul>
              {(notes[current.eventId] ?? []).map((n) => (
                <li key={n.noteId}>
                  <p {...bidiProps(n.body)}>{n.body}</p>
                  <span className="daytl-note-m">
                    <time dir="ltr">{n.createdAt.slice(0, 16).replace('T', ' ')}</time>
                    {n.author !== 'owner' && <em>{n.author}</em>}
                    <button type="button" onClick={() => void removeNote(n.noteId, current.eventId)}
                      disabled={busy} aria-label="حذف">×</button>
                  </span>
                </li>
              ))}
            </ul>

            <div className="daytl-note-new">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="یادداشتی برای این رویداد بنویسید…"
                rows={2}
                onKeyDown={(e) => {
                  // ⌘/Ctrl+Enter saves — a note is a sentence, not a form.
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void addNote();
                }}
              />
              <button type="button" className="btn" disabled={busy || !draft.trim()} onClick={() => void addNote()}>
                {busy ? '…' : 'ثبت'}
              </button>
            </div>
            <p className="daytl-note-note">
              یادداشت‌ها در AOS ذخیره می‌شوند و به رویداد گوگل اضافه نمی‌شوند — پس روی گوشی و برای مهمان‌ها دیده نمی‌شوند.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
