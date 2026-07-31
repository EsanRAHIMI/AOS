/**
 * Attention — deciding whether Jarvis is allowed to speak right now (D-209).
 *
 * THE PROBLEM THIS EXISTS TO SOLVE
 * --------------------------------
 * Every assistant that gains a voice and an autonomous loop at the same time
 * becomes a thing that talks over you, and is switched off within a day. The
 * capability to speak is not the hard part — the heartbeat has been finding
 * real, grounded things to say since D-180. The hard part is that *having
 * something true to say* is not the same as *this being the moment to say
 * it*, and nothing in the system had ever drawn that distinction.
 *
 * So this module is a gate in front of every unprompted utterance. It answers
 * one question — "may I interrupt, and if not, then what?" — and it answers
 * it with a REASON, always recorded.
 *
 * WHY THE REASON IS RECORDED
 * --------------------------
 * Because the owner will eventually ask two questions, and both must be
 * answerable from data rather than from a guess:
 *
 *   "why did you interrupt me during that meeting?"
 *   "why did you NOT tell me about that?"
 *
 * The second one is the dangerous one. A system that silently suppresses is
 * indistinguishable from a system that never noticed — unless every
 * suppression is a record. `attention_decisions` is that record, and
 * `suppress` is deliberately the rarest verdict: almost everything the gate
 * declines to *say* is still shown as a card or held for the next briefing.
 * Silence is a decision about DELIVERY, never about whether the owner gets to
 * know.
 *
 * WHAT IT IS NOT
 * --------------
 * Not a priority score, and not a rate limiter. Both of those answer "how
 * important is this?" in isolation. The question here is relational: how
 * important is this *compared to what the owner is doing right now*. A
 * mission going overdue is worth a lot at 9am on a free morning and worth
 * nothing at all in the middle of a meeting — the item did not change, the
 * moment did.
 */
import { z } from 'zod';
import { collection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import { IsoDate } from '../schemas/common.js';
import { getPreferences, type OwnerPreferences } from '../settings/preferences.js';
import { readAgenda } from '../calendar/sync.js';
import { getGrant, CALENDAR_ACTOR_ID } from '../calendar/tokens.js';

/* ========================================================================== *
 * Model
 * ========================================================================== */

export const InterruptDecision = z.enum([
  /** Say it out loud, now. */
  'speak_now',
  /** Show it on the stage; do not use the voice. */
  'card_only',
  /** Hold it for the next natural briefing moment, then say it. */
  'hold_for_briefing',
  /** Do not deliver at all. Rare, and always for a stated reason. */
  'suppress',
]);
export type InterruptDecision = z.infer<typeof InterruptDecision>;

/** Why the owner might not want to be spoken to at this instant. */
export const AttentionState = z.enum([
  'free',        // nothing on the calendar, inside waking hours
  'in_meeting',  // a timed event is happening right now
  'quiet_hours', // outside the owner's stated waking hours
  'focused',     // actively typing to Jarvis — do not talk over them
  'unknown',     // calendar unreachable; assume nothing
]);
export type AttentionState = z.infer<typeof AttentionState>;

export const AttentionDecisionSchema = z.object({
  decisionId: z.string(),
  actorId: z.string(),
  /** The thing that wanted to be said. */
  subjectId: z.string(),
  subjectKind: z.string(),
  headline: z.string().default(''),
  /** 0..1, from the happening feed's weight or the event's priority. */
  weight: z.number().min(0).max(1),
  /** True when delay itself destroys the value ("starts in 10 minutes"). */
  timeCritical: z.boolean().default(false),
  state: AttentionState,
  decision: InterruptDecision,
  /** One sentence, readable by the owner, not a code. */
  reason: z.string(),
  /** For `hold_for_briefing` — when it will be delivered. */
  notBefore: z.string().nullable().default(null),
  createdAt: IsoDate,
  /** Set once the held item has actually been delivered. */
  deliveredAt: z.string().nullable().default(null),
});
export type AttentionDecision = z.infer<typeof AttentionDecisionSchema>;

export interface AttentionActor {
  actorId: string;
  tenantId?: string | null;
}

/** What wants to be said. */
export interface InterruptCandidate {
  subjectId: string;
  subjectKind: string;
  headline: string;
  /** 0..1. The happening feed already computes this; reuse it, don't re-derive. */
  weight: number;
  /**
   * Delay destroys the value. "Your meeting starts in 10 minutes" is
   * time-critical; "a mission went overdue" is not, even though it may be
   * more important in the abstract.
   */
  timeCritical?: boolean;
}

/* ========================================================================== *
 * Waking hours
 * ========================================================================== */

/**
 * Quiet hours, derived rather than configured.
 *
 * Deliberately NOT a new preference field. Another setting is another thing
 * the owner has to get right before the system behaves, and the failure mode
 * of a wrong quiet-hours setting is that the assistant wakes you up. 07:00 →
 * 23:00 local is a defensible default for every owner, and the timezone it is
 * evaluated in is already a stored, owner-confirmed preference (D-202).
 *
 * Exported so a future preference can override it without moving the logic.
 */
export const WAKING_HOURS = { startHour: 7, endHour: 23 } as const;

/** Local hour in the owner's own timezone — never the server's. */
export function localHour(at: Date, prefs: Pick<OwnerPreferences, 'timezone'>): number {
  try {
    const s = new Intl.DateTimeFormat('en-US', {
      timeZone: prefs.timezone, hour: '2-digit', hour12: false,
    }).format(at);
    const h = Number(s);
    return Number.isFinite(h) ? h % 24 : at.getUTCHours();
  } catch {
    // An invalid stored timezone must not make the assistant silent forever.
    return at.getUTCHours();
  }
}

export function isQuietHour(at: Date, prefs: Pick<OwnerPreferences, 'timezone'>): boolean {
  const h = localHour(at, prefs);
  return h < WAKING_HOURS.startHour || h >= WAKING_HOURS.endHour;
}

/* ========================================================================== *
 * Reading the moment
 * ========================================================================== */

export interface AttentionContext {
  state: AttentionState;
  /** The event the owner is currently inside, if any. */
  busyUntil: string | null;
  /** When Jarvis last spoke unprompted — drives the cooldown. */
  lastSpokeAt: string | null;
  at: string;
}

/**
 * Cooldown between unprompted utterances.
 *
 * Not a rate limit on information — held items still accumulate and are
 * delivered together. This only stops the assistant from speaking twice in
 * quick succession, which is what makes a presence feel frantic rather than
 * calm. Time-critical items bypass it; that is the entire point of the flag.
 */
export const SPEAK_COOLDOWN_MS = 8 * 60_000;

const decisionsCol = () => collection<AttentionDecision>(COLLECTIONS.ATTENTION_DECISIONS);

/**
 * What is the owner doing right now?
 *
 * Fail-soft and fail-QUIET-ward: if the calendar cannot be read, the state is
 * `unknown`, not `free`. Assuming the owner is free because we failed to look
 * is how an assistant ends up talking during a funeral.
 */
export async function readAttentionContext(
  actor: AttentionActor,
  opts: { at?: Date; focused?: boolean } = {},
): Promise<AttentionContext> {
  const at = opts.at ?? new Date();
  const prefs = await getPreferences().catch(() => null);

  const lastSpokeAt = await decisionsCol()
    .find({ actorId: actor.actorId, decision: 'speak_now' })
    .sort({ createdAt: -1 }).limit(1).toArray()
    .then((d) => d[0]?.createdAt ?? null)
    .catch(() => null);

  // The owner typing at Jarvis outranks everything: they are present AND
  // engaged, and an unprompted announcement mid-sentence is the single most
  // jarring thing this system could do.
  if (opts.focused) {
    return { state: 'focused', busyUntil: null, lastSpokeAt, at: at.toISOString() };
  }

  if (prefs && isQuietHour(at, prefs)) {
    return { state: 'quiet_hours', busyUntil: null, lastSpokeAt, at: at.toISOString() };
  }

  const grant = await getGrant(CALENDAR_ACTOR_ID).catch(() => null);
  if (!grant || grant.revokedAt) {
    // No calendar is not the same as an empty calendar. We genuinely do not
    // know what the owner is doing, and the gate treats that conservatively.
    return { state: 'unknown', busyUntil: null, lastSpokeAt, at: at.toISOString() };
  }

  try {
    const events = await readAgenda({
      actorId: CALENDAR_ACTOR_ID,
      fromIso: new Date(at.getTime() - 4 * 60 * 60_000).toISOString(),
      toIso: new Date(at.getTime() + 60_000).toISOString(),
    });
    const now = at.getTime();
    const current = events.find((e) => {
      // All-day events are context, not occupancy — someone marked "on leave"
      // for a week is not in a meeting for a week.
      if (e.allDay) return false;
      const s = Date.parse(e.start);
      const en = Date.parse(e.end);
      return Number.isFinite(s) && Number.isFinite(en) && s <= now && now < en;
    });
    return {
      state: current ? 'in_meeting' : 'free',
      busyUntil: current?.end ?? null,
      lastSpokeAt,
      at: at.toISOString(),
    };
  } catch {
    return { state: 'unknown', busyUntil: null, lastSpokeAt, at: at.toISOString() };
  }
}

/* ========================================================================== *
 * The gate
 * ========================================================================== */

/**
 * Weight at or above which an item is worth breaking into a meeting for.
 *
 * Set high on purpose. In practice only a pending approval (weight 1, the
 * system is stopped on a human) and a critical alert clear it.
 */
const INTERRUPT_MEETING_WEIGHT = 0.95;
/** Below this, an item is never worth the voice at all — the stage suffices. */
const VOICE_FLOOR_WEIGHT = 0.5;

/**
 * Decide, and say why.
 *
 * Pure: takes the moment, returns a verdict. Persistence is a separate call
 * so the decision can be tested exhaustively without a database, and so a
 * caller that only wants to *ask* does not litter the audit log.
 */
export function decideInterrupt(
  candidate: InterruptCandidate,
  ctx: AttentionContext,
): { decision: InterruptDecision; reason: string; notBefore: string | null } {
  const weight = Math.min(1, Math.max(0, candidate.weight));
  const critical = Boolean(candidate.timeCritical);

  /* --- quiet hours ----------------------------------------------------- */
  if (ctx.state === 'quiet_hours') {
    // Even here, nothing is discarded: it waits for the morning. The one
    // exception is a time-critical item, which by definition is worthless by
    // then — if it is worth waking someone for, it is worth saying now.
    if (critical && weight >= INTERRUPT_MEETING_WEIGHT) {
      return { decision: 'speak_now', reason: 'خارج از ساعات بیداری، اما این مورد فوری و حیاتی بود.', notBefore: null };
    }
    return {
      decision: 'hold_for_briefing',
      reason: 'خارج از ساعات بیداری شماست؛ برای گزارش صبح نگه داشته شد.',
      notBefore: null,
    };
  }

  /* --- the owner is typing to Jarvis ------------------------------------ */
  if (ctx.state === 'focused') {
    return {
      decision: 'card_only',
      reason: 'شما در حال نوشتن بودید؛ روی صحنه نشان داده شد تا حرفتان قطع نشود.',
      notBefore: null,
    };
  }

  /* --- in a meeting ------------------------------------------------------ */
  if (ctx.state === 'in_meeting') {
    if (critical && weight >= INTERRUPT_MEETING_WEIGHT) {
      return { decision: 'speak_now', reason: 'در جلسه بودید، اما این مورد فوری بود و تأخیر بی‌اثرش می‌کرد.', notBefore: null };
    }
    if (critical) {
      // Time-critical but not critical enough to speak over a meeting: the
      // card is immediate and silent, which preserves the timing without the
      // interruption.
      return { decision: 'card_only', reason: 'در جلسه هستید؛ چون زمان‌حساس بود بی‌صدا روی صحنه آمد.', notBefore: null };
    }
    return {
      decision: 'hold_for_briefing',
      reason: 'در جلسه هستید؛ برای بعد از جلسه نگه داشته شد.',
      notBefore: ctx.busyUntil,
    };
  }

  /* --- calendar unknown -------------------------------------------------- */
  if (ctx.state === 'unknown') {
    // We do not know whether this is a good moment. Show it, do not say it —
    // the conservative choice that still delivers the information.
    if (critical && weight >= INTERRUPT_MEETING_WEIGHT) {
      return { decision: 'speak_now', reason: 'وضعیت شما نامعلوم بود، اما این مورد فوری و حیاتی بود.', notBefore: null };
    }
    return { decision: 'card_only', reason: 'تقویم در دسترس نبود، پس نمی‌دانم الان وقت مناسبی هست یا نه.', notBefore: null };
  }

  /* --- free -------------------------------------------------------------- */
  if (weight < VOICE_FLOOR_WEIGHT) {
    return { decision: 'card_only', reason: 'مهم بود اما نه به اندازه‌ای که گفته شود؛ روی صحنه هست.', notBefore: null };
  }

  const sinceSpoke = ctx.lastSpokeAt ? Date.parse(ctx.at) - Date.parse(ctx.lastSpokeAt) : Infinity;
  if (Number.isFinite(sinceSpoke) && sinceSpoke < SPEAK_COOLDOWN_MS && !critical) {
    return {
      decision: 'hold_for_briefing',
      reason: 'همین چند دقیقه پیش صحبت کردم؛ این مورد با بعدی‌ها یک‌جا گفته می‌شود.',
      notBefore: new Date(Date.parse(ctx.lastSpokeAt!) + SPEAK_COOLDOWN_MS).toISOString(),
    };
  }

  return { decision: 'speak_now', reason: 'وقت مناسبی بود و این مورد ارزش گفتن داشت.', notBefore: null };
}

/**
 * Decide AND record.
 *
 * The record is the whole point of the module — see the header. A decision
 * that could not be written is still returned, because failing to speak
 * because the audit log is down would be a worse failure than an unlogged
 * utterance.
 */
export async function judgeInterrupt(
  actor: AttentionActor,
  candidate: InterruptCandidate,
  ctx: AttentionContext,
): Promise<AttentionDecision> {
  const verdict = decideInterrupt(candidate, ctx);
  const record = AttentionDecisionSchema.parse({
    decisionId: genId('att'),
    actorId: actor.actorId,
    subjectId: candidate.subjectId,
    subjectKind: candidate.subjectKind,
    headline: candidate.headline,
    weight: Math.min(1, Math.max(0, candidate.weight)),
    timeCritical: Boolean(candidate.timeCritical),
    state: ctx.state,
    decision: verdict.decision,
    reason: verdict.reason,
    notBefore: verdict.notBefore,
    createdAt: nowIso(),
    deliveredAt: verdict.decision === 'speak_now' ? nowIso() : null,
  });
  await decisionsCol().insertOne(record as never).catch(() => { /* never block on the log */ });
  return record;
}

/**
 * Items held for a briefing that are now due.
 *
 * `notBefore` is honoured when set (post-meeting, post-cooldown); an item held
 * for quiet hours has none and becomes due as soon as waking hours resume,
 * which the caller establishes by only asking when the state is not
 * `quiet_hours`.
 */
export async function dueHeldItems(
  actor: AttentionActor,
  at: Date = new Date(),
): Promise<AttentionDecision[]> {
  const iso = at.toISOString();
  const docs = await decisionsCol()
    .find({ actorId: actor.actorId, decision: 'hold_for_briefing', deliveredAt: null })
    .sort({ createdAt: 1 }).limit(50).toArray()
    .catch(() => [] as AttentionDecision[]);
  return docs
    .map((d) => AttentionDecisionSchema.parse(d))
    .filter((d) => !d.notBefore || d.notBefore <= iso);
}

/** Mark held items delivered, so a briefing never repeats itself. */
export async function markDelivered(actor: AttentionActor, decisionIds: string[]): Promise<number> {
  if (!decisionIds.length) return 0;
  const res = await decisionsCol().updateMany(
    { actorId: actor.actorId, decisionId: { $in: decisionIds } },
    { $set: { deliveredAt: nowIso() } },
  ).catch(() => null);
  return res?.modifiedCount ?? 0;
}

/** Recent decisions, newest first — the answer to "why did/didn't you tell me". */
export async function listAttentionDecisions(
  actor: AttentionActor,
  opts: { limit?: number } = {},
): Promise<AttentionDecision[]> {
  const docs = await decisionsCol()
    .find({ actorId: actor.actorId })
    .sort({ createdAt: -1 }).limit(Math.min(opts.limit ?? 40, 200)).toArray()
    .catch(() => [] as AttentionDecision[]);
  return docs.map((d) => AttentionDecisionSchema.parse(d));
}
