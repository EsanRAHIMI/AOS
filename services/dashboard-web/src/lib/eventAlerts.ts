/**
 * Pre-event alerts — the pure decision logic (D-195).
 *
 * "Tell me ten minutes before something starts" sounds trivial and is not.
 * Get it wrong and the assistant either nags — repeating the same meeting
 * every poll — or stays quiet through the one event that mattered because the
 * poll landed a second late.
 *
 * So the rule is stated once, here, and tested: an event fires at most once,
 * it fires when it is inside the lead window, and an event whose window was
 * missed entirely (laptop asleep, tab closed) still fires late rather than
 * silently — but only while it has not yet started.
 */

export interface AlertEvent {
  eventId: string;
  calendarId?: string;
  summary?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  description?: string;
  hangoutLink?: string;
  attendees?: unknown[];
}

export interface AlertDecision {
  event: AlertEvent;
  /** Whole minutes until it starts; 0 means "now", negative never fires. */
  minutes: number;
}

/**
 * Which events deserve to be announced right now.
 *
 * @param leadMinutes how far ahead to warn
 * @param fired       ids already announced — mutated by the caller, read here
 */
export function dueAlerts(
  events: AlertEvent[],
  nowMs: number,
  leadMinutes: number,
  fired: ReadonlySet<string>,
): AlertDecision[] {
  const out: AlertDecision[] = [];
  for (const e of events) {
    // All-day events have no moment to count down to. Announcing one at a
    // random poll tick would be noise, not a reminder.
    if (e.allDay || !e.start || !e.eventId) continue;
    if (fired.has(e.eventId)) continue;

    const startMs = new Date(e.start).getTime();
    if (!Number.isFinite(startMs)) continue;

    const minutes = Math.round((startMs - nowMs) / 60_000);
    // Already started: too late to be a warning, and announcing it would
    // interrupt the thing it is announcing.
    if (minutes < 0) continue;
    if (minutes > leadMinutes) continue;

    out.push({ event: e, minutes });
  }
  return out.sort((a, b) => a.minutes - b.minutes);
}

/**
 * Ids worth forgetting.
 *
 * The fired-set must not grow forever, but pruning it too eagerly re-announces
 * an event. Safe boundary: once an event has started, it can never fire again,
 * so its id is dead weight.
 */
export function pruneFired(
  fired: ReadonlySet<string>, events: AlertEvent[], nowMs: number,
): Set<string> {
  const live = new Set<string>();
  for (const e of events) {
    if (!e.eventId || !e.start) continue;
    if (new Date(e.start).getTime() >= nowMs) live.add(e.eventId);
  }
  // Keep only ids that still correspond to a future event.
  return new Set([...fired].filter((id) => live.has(id)));
}
