/**
 * Notes attached to calendar events (D-198).
 *
 * The obvious implementation is to append to the event's Google description.
 * It is also wrong: it edits the owner's event, it shows up for every guest,
 * it fights the sync mirror, and a note on someone else's shared event would
 * be impossible. Notes are OUR layer over Google's data — a separate
 * collection keyed by (actor, calendar, event), so:
 *
 *   - a sync that rewrites the mirrored event never touches the note
 *   - a note survives an event being edited in Google
 *   - notes exist for events on read-only calendars too
 *   - deleting our note leaves the owner's calendar exactly as it was
 *
 * The one consequence to be honest about: these live only in AOS. They are not
 * in Google Calendar and will not appear on the owner's phone.
 */
import { z } from 'zod';
import { collection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';
import { genId } from '../utils/index.js';

export const EventNoteSchema = z.object({
  noteId: z.string(),
  actorId: z.string(),
  calendarId: z.string(),
  eventId: z.string(),
  /** Plain text. Rendering markup here would reintroduce the D-197 problem. */
  body: z.string().default(''),
  /** 'owner' or an agent id — a note Jarvis wrote must be distinguishable. */
  author: z.string().default('owner'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EventNote = z.infer<typeof EventNoteSchema>;

const notesCol = () => collection<EventNote>(COLLECTIONS.CALENDAR_NOTES);
const nowIso = () => new Date().toISOString();

/** Add a note, or replace one by id when `noteId` is supplied. */
export async function saveEventNote(args: {
  actorId: string; calendarId: string; eventId: string;
  body: string; author?: string; noteId?: string;
}): Promise<EventNote | null> {
  const body = args.body.trim();
  // An empty note is a delete request expressed differently; storing it would
  // leave a blank row the owner cannot see to remove.
  if (!body) {
    if (args.noteId) await deleteEventNote(args.actorId, args.noteId);
    return null;
  }

  if (args.noteId) {
    const existing = await notesCol().findOne({ actorId: args.actorId, noteId: args.noteId });
    if (existing) {
      const updated: EventNote = { ...EventNoteSchema.parse(existing), body, updatedAt: nowIso() };
      await notesCol().updateOne(
        { actorId: args.actorId, noteId: args.noteId },
        { $set: { body, updatedAt: updated.updatedAt } },
      );
      return updated;
    }
  }

  const note = EventNoteSchema.parse({
    noteId: genId('note'),
    actorId: args.actorId,
    calendarId: args.calendarId,
    eventId: args.eventId,
    body,
    author: args.author ?? 'owner',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  await notesCol().insertOne(note);
  return note;
}

/** Notes for a set of events, grouped by event id — one query, not N. */
export async function readEventNotes(
  actorId: string, eventIds: string[],
): Promise<Record<string, EventNote[]>> {
  if (eventIds.length === 0) return {};
  const docs = await notesCol()
    .find({ actorId, eventId: { $in: eventIds } } as never, { projection: { _id: 0 } as never })
    .sort({ createdAt: 1 })
    .toArray();

  const out: Record<string, EventNote[]> = {};
  for (const d of docs) {
    const note = EventNoteSchema.parse(d);
    (out[note.eventId] ??= []).push(note);
  }
  return out;
}

export async function deleteEventNote(actorId: string, noteId: string): Promise<boolean> {
  const res = await notesCol().deleteOne({ actorId, noteId });
  return (res.deletedCount ?? 0) > 0;
}

/** Called when the mirror is purged, so notes never outlive their account. */
export async function purgeEventNotes(actorId: string): Promise<number> {
  const res = await notesCol().deleteMany({ actorId });
  return res.deletedCount ?? 0;
}
