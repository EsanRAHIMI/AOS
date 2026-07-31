/**
 * Readiness gaps (D-208) — what the system needs from the owner, in one line
 * each.
 *
 * THE REQUEST THIS ANSWERS
 * ------------------------
 * "If something is incomplete or missing, explain it to me simply and briefly
 * so I can add it, and let the system grow in a scalable way."
 *
 * WHY THIS IS NOT THE EXISTING /gaps PAGE
 * ---------------------------------------
 * `capability_gaps` records what the KERNEL lacked while doing its own work —
 * input for self-development. This is the other direction: what the OWNER has
 * not supplied yet, so the system is running blind in a way it can name. The
 * two never merge, because the audiences and the fixes are different: one is
 * fixed by writing code, this one by connecting an account or answering a
 * question.
 *
 * THE RULES EVERY CHECK FOLLOWS
 * -----------------------------
 * 1. GROUNDED. A gap is reported only from real stored state — an absent
 *    grant, an empty collection, an unset preference. There is no list of
 *    "things a good setup has" being diffed against reality; that would
 *    produce nagging about things the owner deliberately does not want.
 * 2. ONE SENTENCE OF CONSEQUENCE. Every gap says what the system cannot do
 *    while it exists. A gap with no consequence is not worth the owner's
 *    attention and should not be a check.
 * 3. ONE ACTION. Every gap names exactly one next step and where to do it.
 *    "Configure your environment" is not an action.
 * 4. SILENT WHEN SATISFIED. A satisfied check emits nothing. The healthy
 *    state of this module's output is an empty array.
 */
import { z } from 'zod';
import { getGrant, CALENDAR_ACTOR_ID } from '../calendar/tokens.js';
import { listCalendars } from '../calendar/sync.js';
import { listMissionNodes, type MissionActor } from '../missions/index.js';
import { listMemories, type MemoryActor } from '../memory2/index.js';
import { getPreferences, hasStoredPreferences } from '../settings/preferences.js';
import { modelRegistryFromEnv } from '../llm/toolcalling.js';
import { HappeningCategory } from './index.js';

export const ReadinessSeverity = z.enum([
  /** The system is materially blind or degraded until this is fixed. */
  'blocking',
  /** It works, but a whole capability is dark. */
  'limiting',
  /** Worth knowing; nothing is broken. */
  'info',
]);
export type ReadinessSeverity = z.infer<typeof ReadinessSeverity>;

export const ReadinessGapSchema = z.object({
  gapId: z.string(),
  severity: ReadinessSeverity,
  category: HappeningCategory,
  /** What is missing — plain, short, in the owner's language. */
  title: z.string(),
  /** What the system cannot do while this is missing. Exactly one sentence. */
  consequence: z.string(),
  /** The single next step. */
  action: z.string(),
  /** Where to take it. */
  href: z.string().nullable().default(null),
});
export type ReadinessGap = z.infer<typeof ReadinessGapSchema>;

export interface ReadinessActor {
  actorId: string;
  tenantId?: string | null;
  userId?: string | null;
}

/**
 * Evaluate every check against real state.
 *
 * Each check is independent and fail-soft: a check that throws (a collection
 * that does not exist yet on a fresh install, a decrypt failure on a grant)
 * reports nothing rather than taking the whole readiness report down. A
 * missing gap is recoverable on the next poll; a 500 on the owner's home
 * surface is not.
 */
export async function assessReadiness(
  actor: ReadinessActor,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReadinessGap[]> {
  const missionActor = { actorId: actor.actorId, scope: 'user', tenantId: actor.tenantId ?? null } as unknown as MissionActor;
  const memoryActor = { actorId: actor.actorId, scope: 'user', tenantId: actor.tenantId ?? null } as unknown as MemoryActor;

  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); } catch { return fallback; }
  };

  const [grant, calendars, missions, memories, prefs, prefsStored] = await Promise.all([
    safe(() => getGrant(CALENDAR_ACTOR_ID), null),
    safe(() => listCalendars(CALENDAR_ACTOR_ID), []),
    safe(() => listMissionNodes(missionActor, { limit: 5 }), []),
    safe(() => listMemories(memoryActor, { limit: 5 }), []),
    safe(() => getPreferences(), null),
    safe(() => hasStoredPreferences(), true),
  ]);

  const gaps: ReadinessGap[] = [];
  const add = (g: ReadinessGap) => gaps.push(ReadinessGapSchema.parse(g));

  /* ------------------------------- the model ------------------------------ */
  // Checked first because it is the only gap that changes the MEANING of every
  // other answer the system gives: without a provider, replies are composed
  // from stored data, not reasoned.
  const reg = modelRegistryFromEnv(env);
  if (reg.provider === 'none') {
    add({
      gapId: 'model_provider',
      severity: 'blocking',
      category: 'system',
      title: 'هیچ مدل هوشمندی وصل نیست',
      consequence: 'جارویس فقط می‌تواند از داده‌های ذخیره‌شده پاسخ بسازد و نمی‌تواند واقعاً استدلال یا برنامه‌ریزی کند.',
      action: 'یکی از این‌ها را تنظیم کنید: LLM_LOCAL_BASE_URL برای مدل روی سرور خودتان، یا ANTHROPIC_API_KEY یا OPENAI_API_KEY.',
      href: '/llm',
    });
  }

  /* ------------------------------- calendar ------------------------------- */
  if (!grant || grant.revokedAt) {
    add({
      gapId: 'calendar_not_connected',
      severity: 'blocking',
      category: 'calendar',
      title: 'تقویم گوگل وصل نیست',
      consequence: 'جارویس برنامهٔ شما را نمی‌بیند، پس نه می‌تواند یادآوری بدهد و نه رویدادی بسازد یا جابه‌جا کند.',
      action: 'از صفحهٔ تقویم، حساب گوگل خود را وصل کنید.',
      href: '/calendar',
    });
  } else if (calendars.length === 0) {
    // A live grant with no mirrored calendars means the first sync has not
    // completed — a different problem from "not connected", and a different fix.
    add({
      gapId: 'calendar_not_synced',
      severity: 'limiting',
      category: 'calendar',
      title: 'تقویم وصل است اما هنوز هیچ رویدادی همگام‌سازی نشده',
      consequence: 'تا پایان اولین همگام‌سازی، پاسخ‌های مربوط به برنامهٔ شما خالی خواهند بود.',
      action: 'در صفحهٔ تقویم یک همگام‌سازی دستی اجرا کنید.',
      href: '/calendar',
    });
  } else if (!calendars.some((c) => c.enabled === true)) {
    add({
      gapId: 'calendar_all_disabled',
      severity: 'limiting',
      category: 'calendar',
      title: 'همهٔ تقویم‌ها خاموش هستند',
      consequence: 'جارویس عمداً هیچ رویدادی را نمی‌خواند، چون شما همهٔ تقویم‌ها را غیرفعال کرده‌اید.',
      action: 'در صفحهٔ تقویم دست‌کم یک تقویم را روشن کنید.',
      href: '/calendar',
    });
  }

  /* ------------------------------- missions ------------------------------- */
  if (missions.length === 0) {
    add({
      gapId: 'no_missions',
      severity: 'limiting',
      category: 'tasks',
      title: 'هیچ هدف یا ماموریتی ثبت نشده',
      consequence: 'جارویس معیاری برای اولویت‌بندی ندارد، پس نمی‌تواند بگوید کدام کار مهم‌تر است.',
      action: 'یک هدف بلندمدت بگویید تا جارویس آن را به ماموریت و کار بشکند.',
      href: '/tasks',
    });
  }

  /* -------------------------------- memory -------------------------------- */
  if (memories.length === 0) {
    add({
      gapId: 'empty_memory',
      severity: 'limiting',
      category: 'memory',
      title: 'جارویس هنوز چیزی دربارهٔ شما نمی‌داند',
      consequence: 'هر گفت‌وگو از صفر شروع می‌شود و هیچ ترجیح یا تصمیمی بین جلسه‌ها منتقل نمی‌شود.',
      action: 'چند جملهٔ ساده دربارهٔ کار، اولویت‌ها و ترجیح‌هایتان بگویید؛ جارویس آن‌ها را ثبت می‌کند.',
      href: '/memory',
    });
  }

  /* ------------------------------ preferences ----------------------------- */
  // A default timezone is not a bug — but an owner in Tehran running on the
  // shipped `Asia/Dubai` default gets every single time wrong by an hour,
  // silently. `hasStoredPreferences` is what separates "chose this" from
  // "never looked"; `getPreferences` alone cannot tell them apart.
  if (prefs && !prefsStored) {
    add({
      gapId: 'preferences_unconfirmed',
      severity: 'info',
      category: 'personal',
      title: `ترجیحات پایه تأیید نشده (منطقهٔ زمانی: ${prefs.timezone})`,
      consequence: 'اگر این منطقهٔ زمانی درست نباشد، هر ساعتی که جارویس می‌گوید یا ثبت می‌کند اشتباه خواهد بود.',
      action: 'در تنظیمات، منطقهٔ زمانی و زبان را یک بار تأیید کنید.',
      href: '/settings',
    });
  }

  /* Order: what blocks first. Within a severity, insertion order stands —
   * the checks are already written from most to least consequential. */
  const rank: Record<ReadinessSeverity, number> = { blocking: 0, limiting: 1, info: 2 };
  return gaps.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
