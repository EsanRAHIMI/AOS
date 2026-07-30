'use server';
/**
 * Server actions for /calendar (D-192b). Thin pass-through to the gateway —
 * the browser never holds a Google token or an internal token.
 */
import { revalidatePath } from 'next/cache';
import { gateway } from '@/lib/gateway';

export async function calendarAuthUrlAction(): Promise<{ url: string } | { error: string }> {
  try {
    const r = await gateway.calendarAuthUrl();
    return r?.url ? { url: r.url } : { error: 'اتصال آماده نیست' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'خطا' };
  }
}

export async function syncCalendarAction(): Promise<{ ok: boolean; error: string; staged: boolean }> {
  try {
    /* Staged (D-194): when the gateway reports `staged`, what came back is the
     * four month windows and the full walk is still running behind it. The
     * button must say so — "همگام‌سازی شد" on a partial result is a lie the
     * owner only discovers when an old month turns up empty. */
    const res = (await gateway.calendarSync()) as { staged?: boolean } | null;
    revalidatePath('/calendar');
    return { ok: true, error: '', staged: Boolean(res?.staged) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'خطا', staged: false };
  }
}

export async function disconnectCalendarAction(): Promise<{ ok: boolean }> {
  try {
    await gateway.calendarDisconnect();
    revalidatePath('/calendar');
    return { ok: true };
  } catch { return { ok: false }; }
}

export async function createEventAction(body: Record<string, unknown>) {
  try {
    const r = await gateway.createCalendarEvent(body);
    revalidatePath('/calendar');
    return { ok: true, requiresApproval: Boolean(r?.requiresApproval), reason: r?.reason ?? '', error: '' };
  } catch (e) {
    return { ok: false, requiresApproval: false, reason: '', error: e instanceof Error ? e.message : 'خطا' };
  }
}

export async function createTaskAction(body: Record<string, unknown>) {
  try {
    await gateway.createCalendarTask(body);
    revalidatePath('/calendar');
    return { ok: true, error: '' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'خطا' };
  }
}

export async function toggleCalendarAction(calendarId: string, enabled: boolean) {
  try {
    await gateway.calendarToggle(calendarId, enabled);
    revalidatePath('/calendar');
    return { ok: true, error: '' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'خطا' };
  }
}
