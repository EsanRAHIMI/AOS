/**
 * Owner preferences — one source of truth for locale, money and time (D-202).
 *
 * The owner moved to Dubai and the system did not notice, because there was
 * nothing to notice with: the timezone lived in an environment variable, the
 * calendar system was a URL parameter, the language was hard-coded Persian in
 * a dozen strings, and currency did not exist at all. Three different places
 * to change, one of them requiring a restart, and Jarvis could not see any of
 * them.
 *
 * So this is a record, not configuration. It is stored, it is editable at
 * runtime, and everything that formats a date, a time, a number or a price
 * reads it: the dashboard, the calendar grid, the alert sentences, and the
 * RIGHT NOW block Jarvis reasons from. Changing it once changes all of them.
 *
 * Deliberately NOT here: anything Google owns. An event's own timezone still
 * comes from the event — a meeting booked in Tehran does not move because the
 * owner is in Dubai this week. This record says how to *display* and how to
 * interpret "today" and "2pm", not what already happened.
 */
import { z } from 'zod';
import { keyedScopedCollection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';

/** Everything that changes when you cross a border. */
export const OwnerPreferencesSchema = z.object({
  /** Fixed key: this system is single-owner (see CALENDAR_ACTOR_ID). */
  ownerId: z.string().default('owner'),

  /** IANA zone. The one setting that silently corrupts data when wrong. */
  timezone: z.string().default('Asia/Dubai'),
  /** BCP-47. Drives interface language AND number/date formatting. */
  language: z.string().default('fa-IR'),
  /** ISO 4217. */
  currency: z.string().default('AED'),
  /** Which calendar the month grid is cut on. */
  calendarSystem: z.enum(['gregorian', 'jalali', 'islamic']).default('gregorian'),
  /** 0=Sunday … 6=Saturday. Iran starts Saturday; the UAE, Monday. */
  weekStartsOn: z.number().int().min(0).max(6).default(6),
  /** 24h is the default because ambiguity in a calendar is expensive. */
  hourCycle: z.enum(['h23', 'h12']).default('h23'),
  /** Latin digits by default — they survive copy-paste into other systems. */
  numerals: z.enum(['latn', 'arabext']).default('latn'),

  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type OwnerPreferences = z.infer<typeof OwnerPreferencesSchema>;

export const DEFAULT_PREFERENCES: OwnerPreferences = OwnerPreferencesSchema.parse({});

const col = () => keyedScopedCollection<OwnerPreferences & { key: string }>(COLLECTIONS.SYSTEM_SETTINGS, 'ownerId', 'owner');
const KEY = 'owner_preferences';

/**
 * Read the owner's preferences, falling back to defaults.
 *
 * Never throws and never returns null: a formatting call site cannot
 * meaningfully handle "preferences unavailable", and a date rendered in the
 * wrong zone is better than a page that fails to render.
 */
/**
 * Has the owner ever SAVED preferences, as opposed to running on the shipped
 * defaults? (D-208)
 *
 * `getPreferences` deliberately cannot answer this — it returns defaults for
 * both cases, which is right for every formatting call site and useless for
 * readiness. The distinction matters exactly once: an owner in Tehran running
 * on the default `Asia/Dubai` gets every time wrong by an hour, silently, and
 * the only signal that anything is off is that they never confirmed it.
 */
export async function hasStoredPreferences(): Promise<boolean> {
  try {
    return Boolean(await col().findOne({ key: KEY } as never, { projection: { _id: 1 } as never }));
  } catch {
    // Unreachable settings store is not evidence of an unconfigured owner.
    return true;
  }
}

export async function getPreferences(): Promise<OwnerPreferences> {
  try {
    const doc = await col().findOne({ key: KEY } as never, { projection: { _id: 0 } as never });
    if (!doc) return DEFAULT_PREFERENCES;
    return OwnerPreferencesSchema.parse(doc);
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** Fields the owner (or Jarvis, on their instruction) may change. */
export const PreferencesPatchSchema = OwnerPreferencesSchema
  .omit({ ownerId: true, updatedAt: true })
  .partial();
export type PreferencesPatch = z.infer<typeof PreferencesPatchSchema>;

/**
 * Update preferences, validating the parts that can be wrong in ways that
 * only show up much later.
 */
export async function setPreferences(patch: PreferencesPatch): Promise<OwnerPreferences> {
  const clean = PreferencesPatchSchema.parse(patch);

  /* A bad IANA zone does not fail loudly — `Intl` throws deep inside a
   * formatter, on some other page, hours later. Reject it here, where the
   * owner is still looking at the field they typed. */
  if (clean.timezone !== undefined && !isValidTimezone(clean.timezone)) {
    throw new Error(`unknown timezone: ${clean.timezone}`);
  }
  if (clean.currency !== undefined && !/^[A-Z]{3}$/.test(clean.currency)) {
    throw new Error(`currency must be a 3-letter ISO 4217 code, got: ${clean.currency}`);
  }
  if (clean.language !== undefined && !isValidLocale(clean.language)) {
    throw new Error(`unknown language tag: ${clean.language}`);
  }

  const current = await getPreferences();
  const next = OwnerPreferencesSchema.parse({
    ...current, ...clean, updatedAt: new Date().toISOString(),
  });
  await col().updateOne({ key: KEY } as never, { $set: { ...next, key: KEY } }, { upsert: true });
  return next;
}

export function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

export function isValidLocale(tag: string): boolean {
  try { return Intl.getCanonicalLocales(tag).length > 0; } catch { return false; }
}

/* ------------------------------------------------------------ formatting */

/** The `Intl` locale string implied by the preferences, numerals included. */
export function intlLocale(p: OwnerPreferences): string {
  const cal = p.calendarSystem === 'jalali' ? 'persian' : p.calendarSystem === 'islamic' ? 'islamic' : 'gregory';
  return `${p.language}-u-ca-${cal}-nu-${p.numerals}-hc-${p.hourCycle}`;
}

/** Money, in the owner's currency and locale. */
export function formatMoney(amount: number, p: OwnerPreferences): string {
  try {
    return new Intl.NumberFormat(intlLocale(p), { style: 'currency', currency: p.currency }).format(amount);
  } catch {
    return `${amount} ${p.currency}`;
  }
}

/** A date, in the owner's zone and calendar. */
export function formatDate(iso: string, p: OwnerPreferences, opts: Intl.DateTimeFormatOptions = {}): string {
  try {
    return new Intl.DateTimeFormat(intlLocale(p), {
      timeZone: p.timezone, dateStyle: 'medium', ...opts,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Offset from UTC in minutes, for a given instant.
 *
 * Computed per instant, not stored: Dubai is +04:00 all year but most zones
 * are not, and a cached offset is a bug that appears twice a year.
 */
export function offsetMinutes(p: OwnerPreferences, at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: p.timezone, timeZoneName: 'longOffset',
    }).formatToParts(at);
    const name = parts.find((x) => x.type === 'timeZoneName')?.value ?? 'GMT+00:00';
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  } catch {
    return 0;
  }
}
