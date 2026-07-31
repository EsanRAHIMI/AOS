/**
 * Briefing moments — when a considerate assistant chooses to speak (D-209).
 *
 * THE DIFFERENCE THIS MAKES
 * -------------------------
 * The heartbeat runs every five minutes. If everything it finds is announced
 * when it is found, the owner's day is punctuated by unrelated remarks at
 * arbitrary times — technically all true, cumulatively unbearable. The
 * attention gate already decides that most of them should be held; this
 * module decides what "later" means.
 *
 * "Later" is not a timer. It is one of three moments that exist in the
 * owner's day whether or not this system is running:
 *
 *   MORNING       — the first waking hour. Everything held overnight, at once.
 *   GAP           — a real opening between two calendar events, long enough to
 *                   absorb an interruption. The single most valuable moment,
 *                   because it is derived from the owner's actual day rather
 *                   than from a clock this system picked.
 *   EVENING       — the last waking hour. What happened, what is still open.
 *
 * A moment fires at most once each. That is the property that stops the
 * five-minute pulse from turning a morning briefing into twelve morning
 * briefings — see `alreadyDelivered`.
 *
 * WHY GAPS ARE NOT "EVERY FREE MINUTE"
 * ------------------------------------
 * A three-minute space between two meetings is not an opening; it is the walk
 * between them. `MIN_GAP_MINUTES` exists so that "you are free" means the
 * owner could actually act on what they are told.
 */
import { z } from 'zod';
import { readAgenda } from '../calendar/sync.js';
import { getGrant, CALENDAR_ACTOR_ID } from '../calendar/tokens.js';
import { getPreferences, type OwnerPreferences } from '../settings/preferences.js';
import {
  localHour, WAKING_HOURS, dueHeldItems, markDelivered, judgeInterrupt,
  readAttentionContext, type AttentionActor, type AttentionDecision,
} from './attention.js';
import { collection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';

export const BriefingMomentKind = z.enum(['morning', 'gap', 'evening']);
export type BriefingMomentKind = z.infer<typeof BriefingMomentKind>;

export interface BriefingMoment {
  kind: BriefingMomentKind;
  /** Stable per day (and per gap), so a moment fires once and only once. */
  momentKey: string;
  /** Why this is a good time — shown to the owner, not just logged. */
  reason: string;
  /** For a gap: how long the opening is. */
  minutes: number | null;
}

/** Shorter than this is a transition, not an opening. */
export const MIN_GAP_MINUTES = 25;

/** The owner's local calendar day — the key everything is deduped on. */
export function localDayKey(at: Date, prefs: Pick<OwnerPreferences, 'timezone'>): string {
  try {
    // en-CA yields YYYY-MM-DD, which sorts and compares correctly as a string.
    return new Intl.DateTimeFormat('en-CA', { timeZone: prefs.timezone }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/**
 * Is this a moment to speak?
 *
 * Returns the FIRST matching moment, or null. Order matters: morning and
 * evening are anchored to the owner's waking hours and take precedence over a
 * gap, because a gap inside the first waking hour is the morning briefing —
 * announcing both would be the same information twice in ten minutes.
 */
export async function currentBriefingMoment(
  opts: { at?: Date } = {},
): Promise<BriefingMoment | null> {
  const at = opts.at ?? new Date();
  const prefs = await getPreferences().catch(() => null);
  if (!prefs) return null;

  const hour = localHour(at, prefs);
  const day = localDayKey(at, prefs);

  if (hour === WAKING_HOURS.startHour) {
    return {
      kind: 'morning',
      momentKey: `morning:${day}`,
      reason: 'شروع روز — هرچه شب جمع شده بود.',
      minutes: null,
    };
  }
  if (hour === WAKING_HOURS.endHour - 1) {
    return {
      kind: 'evening',
      momentKey: `evening:${day}`,
      reason: 'پایان روز — چه شد و چه باز مانده.',
      minutes: null,
    };
  }
  // Outside waking hours there is no moment at all; held items stay held.
  if (hour < WAKING_HOURS.startHour || hour >= WAKING_HOURS.endHour) return null;

  const gap = await currentGap(at);
  if (gap) {
    return {
      kind: 'gap',
      // Keyed on the gap's own start, so two openings in one day are two
      // moments while one opening polled twelve times is one.
      momentKey: `gap:${day}:${gap.startIso}`,
      reason: `${gap.minutes} دقیقه فاصله تا برنامهٔ بعدی.`,
      minutes: gap.minutes,
    };
  }
  return null;
}

/**
 * The opening the owner is currently inside, if it is long enough to matter.
 *
 * Derived from the mirror, and honest about the two ends: an opening with no
 * next event is open-ended (reported as the lookahead window), and an owner
 * currently inside an event is in no gap at all.
 */
export async function currentGap(
  at: Date = new Date(),
): Promise<{ startIso: string; minutes: number } | null> {
  const grant = await getGrant(CALENDAR_ACTOR_ID).catch(() => null);
  if (!grant || grant.revokedAt) return null;

  const LOOKAHEAD_MIN = 240;
  let events;
  try {
    events = await readAgenda({
      actorId: CALENDAR_ACTOR_ID,
      fromIso: new Date(at.getTime() - 6 * 60 * 60_000).toISOString(),
      toIso: new Date(at.getTime() + LOOKAHEAD_MIN * 60_000).toISOString(),
    });
  } catch {
    return null;
  }

  const now = at.getTime();
  const timed = events
    .filter((e) => !e.allDay)
    .map((e) => ({ start: Date.parse(e.start), end: Date.parse(e.end) }))
    .filter((e) => Number.isFinite(e.start) && Number.isFinite(e.end))
    .sort((a, b) => a.start - b.start);

  // Inside an event ⇒ not a gap.
  if (timed.some((e) => e.start <= now && now < e.end)) return null;

  // The gap runs from the end of the last finished event (or now, if the day
  // has not started) to the start of the next one.
  const prevEnd = timed.filter((e) => e.end <= now).reduce((m, e) => Math.max(m, e.end), 0);
  const next = timed.find((e) => e.start > now);
  const startMs = prevEnd || now;
  const endMs = next ? next.start : now + LOOKAHEAD_MIN * 60_000;
  const minutes = Math.round((endMs - now) / 60_000);
  if (minutes < MIN_GAP_MINUTES) return null;

  return { startIso: new Date(startMs).toISOString(), minutes };
}

/* ========================================================================== *
 * Delivery
 * ========================================================================== */

/**
 * Has this exact moment already been delivered?
 *
 * The dedupe lives in the SAME ledger as every other attention decision
 * (`attention_decisions`, subjectKind `briefing_moment`) rather than in a
 * table of its own. One ledger means one answer to "what did you say and
 * when", and it means delivering a briefing correctly resets the speak
 * cooldown — because delivering a briefing IS speaking, and a second
 * announcement thirty seconds later would undo the whole point of batching.
 */
export async function alreadyDelivered(actor: AttentionActor, momentKey: string): Promise<boolean> {
  const hit = await collection(COLLECTIONS.ATTENTION_DECISIONS)
    .findOne({ actorId: actor.actorId, subjectKind: 'briefing_moment', subjectId: momentKey } as never)
    .catch(() => null);
  return Boolean(hit);
}

export interface BriefingDelivery {
  moment: BriefingMoment;
  items: AttentionDecision[];
}

/**
 * Deliver the briefing if one is due, or return null.
 *
 * Safe to call on every heartbeat pulse — that is the design. Three
 * independent conditions must all hold, and each one exists because of a way
 * this could otherwise misfire:
 *
 *   1. a moment is current      — or there is nothing to fire
 *   2. it has not been delivered — or a five-minute pulse fires the morning
 *                                  briefing twelve times
 *   3. something is actually held — or the owner is greeted with an
 *                                  announcement that has no content, which is
 *                                  worse than silence
 *
 * The moment is recorded BEFORE the items are marked delivered. If the
 * process dies between the two writes, the worst case is that a held item
 * survives to the next moment and is said twice — recoverable. The reverse
 * order risks marking items delivered for a briefing that was never spoken,
 * which loses information silently, and this system does not trade a
 * recoverable failure for a silent one.
 */
export async function deliverBriefingIfDue(
  actor: AttentionActor,
  opts: { at?: Date } = {},
): Promise<BriefingDelivery | null> {
  const at = opts.at ?? new Date();
  const moment = await currentBriefingMoment({ at });
  if (!moment) return null;
  if (await alreadyDelivered(actor, moment.momentKey)) return null;

  const items = await dueHeldItems(actor, at);
  if (!items.length) return null;

  const ctx = await readAttentionContext(actor, { at });
  await judgeInterrupt(actor, {
    subjectId: moment.momentKey,
    subjectKind: 'briefing_moment',
    headline: moment.reason,
    // A briefing that reached this point is by definition the right moment;
    // weight 1 + timeCritical keeps the gate from second-guessing a decision
    // its own held items are the reason for.
    weight: 1,
    timeCritical: true,
  }, ctx);

  await markDelivered(actor, items.map((i) => i.decisionId));
  return { moment, items };
}
