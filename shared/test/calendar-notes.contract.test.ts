/**
 * D-198 — notes attached to events.
 *
 * The tempting implementation is to append to the Google event's description.
 * These tests pin why we did not: a note must survive a sync that rewrites the
 * event, must work on a calendar the owner cannot write to, and must leave the
 * owner's calendar untouched when deleted.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb, getDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { saveEventNote, readEventNotes, deleteEventNote, purgeEventNotes } from '../src/calendar/notes.js';

beforeEach(() => { setTestDb(createFakeDb().db); });

const base = { actorId: 'owner', calendarId: 'primary', eventId: 'ev1' };

describe('event notes', () => {
  it('stores a note and reads it back grouped by event', async () => {
    await saveEventNote({ ...base, body: 'قبلش گزارش را بفرست' });
    const notes = await readEventNotes('owner', ['ev1']);
    expect(notes.ev1).toHaveLength(1);
    expect(notes.ev1[0].body).toBe('قبلش گزارش را بفرست');
    expect(notes.ev1[0].author).toBe('owner');
  });

  it('keeps several notes on one event, oldest first', async () => {
    await saveEventNote({ ...base, body: 'اول' });
    await saveEventNote({ ...base, body: 'دوم' });
    const notes = await readEventNotes('owner', ['ev1']);
    expect(notes.ev1.map((n) => n.body)).toEqual(['اول', 'دوم']);
  });

  it('treats an empty note as a delete, not as a blank row nobody can remove', async () => {
    const created = await saveEventNote({ ...base, body: 'موقت' });
    expect(created).not.toBeNull();
    const gone = await saveEventNote({ ...base, body: '   ', noteId: created!.noteId });
    expect(gone).toBeNull();
    expect((await readEventNotes('owner', ['ev1'])).ev1 ?? []).toHaveLength(0);
  });

  it('edits in place rather than accumulating versions', async () => {
    const created = await saveEventNote({ ...base, body: 'نسخهٔ اول' });
    await saveEventNote({ ...base, body: 'نسخهٔ دوم', noteId: created!.noteId });
    const notes = await readEventNotes('owner', ['ev1']);
    expect(notes.ev1).toHaveLength(1);
    expect(notes.ev1[0].body).toBe('نسخهٔ دوم');
  });

  it('lives outside the mirrored event, so a sync rewrite cannot erase it', async () => {
    await saveEventNote({ ...base, body: 'می‌ماند' });
    // Simulate what a sync does: replace the event row wholesale.
    await getDb().collection('calendar_events').updateOne(
      { actorId: 'owner', calendarId: 'primary', eventId: 'ev1' },
      { $set: { actorId: 'owner', calendarId: 'primary', eventId: 'ev1', summary: 'rewritten' } },
      { upsert: true },
    );
    expect((await readEventNotes('owner', ['ev1'])).ev1).toHaveLength(1);
  });

  it('records who wrote it, so a note from Jarvis is not mistaken for the owner\'s', async () => {
    await saveEventNote({ ...base, body: 'از طرف جارویس', author: 'jarvis' });
    expect((await readEventNotes('owner', ['ev1'])).ev1[0].author).toBe('jarvis');
  });

  it('reads many events in one query and omits events with no notes', async () => {
    await saveEventNote({ ...base, body: 'x' });
    const notes = await readEventNotes('owner', ['ev1', 'ev2']);
    expect(Object.keys(notes)).toEqual(['ev1']);
  });

  it('returns nothing for no ids rather than every note in the database', async () => {
    await saveEventNote({ ...base, body: 'x' });
    expect(await readEventNotes('owner', [])).toEqual({});
  });

  it('deletes one note without touching the others', async () => {
    const a = await saveEventNote({ ...base, body: 'الف' });
    await saveEventNote({ ...base, body: 'ب' });
    expect(await deleteEventNote('owner', a!.noteId)).toBe(true);
    expect((await readEventNotes('owner', ['ev1'])).ev1.map((n) => n.body)).toEqual(['ب']);
  });

  it('purges with the mirror — notes must not outlive the account they describe', async () => {
    await saveEventNote({ ...base, body: 'x' });
    expect(await purgeEventNotes('owner')).toBe(1);
    expect((await readEventNotes('owner', ['ev1'])).ev1 ?? []).toHaveLength(0);
  });
});
