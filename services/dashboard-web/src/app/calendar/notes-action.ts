'use server';
/**
 * Server actions for event notes (D-198).
 *
 * Thin on purpose: the gateway owns the policy and the storage. These exist so
 * the timeline can save a note without a page navigation.
 */
import { revalidatePath } from 'next/cache';
import { gateway } from '@/lib/gateway';
import type { EventNoteView } from './day-timeline';

export async function saveNoteAction(args: {
  calendarId: string; eventId: string; body: string; noteId?: string;
}): Promise<{ note: EventNoteView | null; error: string }> {
  try {
    const res = await gateway.calendarSaveNote(args);
    revalidatePath('/calendar');
    return { note: (res?.note ?? null) as EventNoteView | null, error: '' };
  } catch (e) {
    return { note: null, error: e instanceof Error ? e.message : 'خطا' };
  }
}

export async function deleteNoteAction(noteId: string): Promise<{ ok: boolean }> {
  try {
    await gateway.calendarDeleteNote(noteId);
    revalidatePath('/calendar');
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
