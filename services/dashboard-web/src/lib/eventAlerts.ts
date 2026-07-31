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

export interface EventReminders {
  useDefault?: boolean;
  overrides?: Array<{ method?: string; minutes?: number }>;
}

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
  reminders?: EventReminders;
}

export interface AlertDecision {
  event: AlertEvent;
  /** Whole minutes until it starts; 0 means "now", negative never fires. */
  minutes: number;
  /** The reminder that fired, in minutes-before. Part of the dedupe identity. */
  lead: number;
}

/**
 * The reminder times this event actually asks for (D-197).
 *
 * Google models this exactly: an event either uses its calendar's defaults or
 * carries its own `overrides`. Honouring that instead of a single global lead
 * is the difference between a reminder and an interruption — and it means an
 * event the owner set to warn them an hour ahead warns them an hour ahead.
 *
 * `email` overrides are Google's job, not ours; announcing them here would
 * duplicate a mail the owner already received.
 */
export function reminderLeads(e: AlertEvent, calendarDefault: number): number[] {
  const r = e.reminders;
  if (!r || r.useDefault !== false) return [calendarDefault];
  const leads = (r.overrides ?? [])
    .filter((o) => (o.method ?? 'popup') !== 'email')
    .map((o) => Number(o.minutes ?? 0))
    .filter((m) => Number.isFinite(m) && m >= 0);
  // An empty override list is a deliberate "no reminder", not a missing value.
  return [...new Set(leads)].sort((a, b) => b - a);
}

/** Dedupe identity: one event can legitimately fire at 60 and again at 10. */
export function alertKey(eventId: string, lead: number): string {
  return `${eventId}@${lead}`;
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
  calendarDefault: number,
  fired: ReadonlySet<string>,
): AlertDecision[] {
  const out: AlertDecision[] = [];
  for (const e of events) {
    // All-day events have no moment to count down to. Announcing one at a
    // random poll tick would be noise, not a reminder.
    if (e.allDay || !e.start || !e.eventId) continue;

    const startMs = new Date(e.start).getTime();
    if (!Number.isFinite(startMs)) continue;

    const minutes = Math.round((startMs - nowMs) / 60_000);
    // Already started: too late to be a warning, and announcing it would
    // interrupt the thing it is announcing.
    if (minutes < 0) continue;

    for (const lead of reminderLeads(e, calendarDefault)) {
      if (minutes > lead) continue;
      if (fired.has(alertKey(e.eventId, lead))) continue;
      out.push({ event: e, minutes, lead });
      break;   // the nearest unfired reminder; the others are already past
    }
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
  // Keys are `eventId@lead`; keep only those whose event is still ahead.
  return new Set([...fired].filter((k) => live.has(k.slice(0, k.lastIndexOf('@')))));
}
