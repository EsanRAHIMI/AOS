'use server';
/**
 * The one server call the live alert loop makes (D-195).
 *
 * Reads the local mirror through the gateway — no Google request per poll, so
 * leaving alerts on all day costs nothing in quota. A two-hour horizon is
 * plenty for a ten-minute warning and keeps the payload small.
 *
 * ONE call, not two (D-198b). It used to check `calendarStatus()` first and
 * then fetch the agenda: two sequential round-trips, ~2.8s of server time
 * every 60 seconds, to learn something the agenda already tells us. An agenda
 * with no events is indistinguishable from a disconnected calendar for this
 * purpose — both mean "nothing to announce".
 */
import { gateway } from '@/lib/gateway';
import type { AlertEvent } from '@/lib/eventAlerts';

export async function upcomingForAlertsAction(): Promise<{ events: AlertEvent[]; connected: boolean }> {
  try {
    const now = new Date();
    const res = await gateway.calendarAgenda(
      now.toISOString(),
      new Date(now.getTime() + 2 * 3_600_000).toISOString(),
    );
    const events = (res?.events ?? []) as unknown as AlertEvent[];
    return { events, connected: true };
  } catch {
    // A failed poll is not worth surfacing — the next one is 60 seconds away.
    return { events: [], connected: false };
  }
}
