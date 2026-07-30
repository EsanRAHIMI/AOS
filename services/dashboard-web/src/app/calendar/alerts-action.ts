'use server';
/**
 * The one server call the live alert loop makes (D-195).
 *
 * Reads the local mirror through the gateway — no Google request per poll, so
 * leaving alerts on all day costs nothing in quota. A two-hour horizon is
 * plenty for a ten-minute warning and keeps the payload small.
 */
import { gateway } from '@/lib/gateway';
import type { AlertEvent } from '@/lib/eventAlerts';

export async function upcomingForAlertsAction(): Promise<{ events: AlertEvent[]; connected: boolean }> {
  try {
    const status = await gateway.calendarStatus();
    if (!status?.connected) return { events: [], connected: false };
    const now = new Date();
    const res = await gateway.calendarAgenda(
      now.toISOString(),
      new Date(now.getTime() + 2 * 3_600_000).toISOString(),
    );
    return { events: (res?.events ?? []) as unknown as AlertEvent[], connected: true };
  } catch {
    // A failed poll is not worth surfacing — the next one is 60 seconds away.
    return { events: [], connected: false };
  }
}
