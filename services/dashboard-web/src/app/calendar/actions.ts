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

export async function syncCalendarAction(): Promise<{ ok: boolean; error: string }> {
  try {
    await gateway.calendarSync();
    revalidatePath('/calendar');
    return { ok: true, error: '' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'خطا' };
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
