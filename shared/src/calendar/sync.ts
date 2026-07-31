/**
 * Incremental sync with Google Calendar and Tasks (D-192).
 *
 * Implemented against the official "Synchronize resources efficiently" guide,
 * because the failure modes here are quiet ones — a mirror that drifts still
 * renders, it just shows the owner a meeting that moved yesterday.
 *
 * The rules that guide imposes, and why each is obeyed literally:
 *
 *  1. **Full sync once, then incremental forever.** Each incremental list
 *     passes the stored `syncToken` and stores the new `nextSyncToken`.
 *  2. **Deleted entries always come back in the results** (`status: cancelled`)
 *     precisely so clients can remove them. A sync that only upserts leaves
 *     cancelled meetings on the owner's screen — so cancellations are deleted
 *     from the mirror, not skipped.
 *  3. **Query parameters must be identical across every request in a sync
 *     series**, and `timeMin`/`timeMax`/`q`/`orderBy`/`updatedMin` are illegal
 *     with a sync token. The parameter set therefore lives in ONE constant used
 *     by both the full and incremental paths — the moment they diverge, Google
 *     starts returning 400 and the mirror silently stops updating.
 *  4. **410 GONE means the token is dead**: wipe this calendar's slice of the
 *     mirror and run a full sync. Not an error to log and move past.
 *  5. **Paginate with `pageToken`; `nextSyncToken` appears only on the LAST
 *     page.** Storing a token mid-pagination would skip everything after it.
 */
import { z } from 'zod';
import { collection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';
import { nowIso } from '../utils/index.js';
import { googleCall, GoogleApiError, CALENDAR_API, TASKS_API } from './google.js';
import { getGrant } from './tokens.js';
import { purgeEventNotes } from './notes.js';

/* ------------------------------------------------------------------ models */

export const CalendarRefSchema = z.object({
  actorId: z.string(),
  /** The Google account this row came from. See `purgeMirror` for why. */
  account: z.string().default(''),
  calendarId: z.string(),
  summary: z.string().default(''),
  description: z.string().default(''),
  timeZone: z.string().default(''),
  /** owner | writer | reader | freeBusyReader | writerWithoutPrivateAccess */
  accessRole: z.string().default(''),
  primary: z.boolean().default(false),
  selected: z.boolean().default(true),
  backgroundColor: z.string().default(''),
  /** True for the calendar this system creates and may write to freely. */
  isAosCalendar: z.boolean().default(false),
  /**
   * Whether THIS system syncs and shows it. Deliberately separate from
   * Google's `selected`: that flag reflects what is ticked in Google's own UI,
   * which is a different decision from what the owner wants their assistant
   * working with. Defaults to calendars they own — a calendar shared with you
   * is someone else's, and pulling it in unasked is how this system ended up
   * displaying another person's schedule.
   */
  enabled: z.boolean().default(false),
  updatedAt: z.string(),
});
export type CalendarRef = z.infer<typeof CalendarRefSchema>;

export const CalendarEventSchema = z.object({
  actorId: z.string(),
  account: z.string().default(''),
  calendarId: z.string(),
  eventId: z.string(),
  status: z.string().default('confirmed'),
  summary: z.string().default(''),
  description: z.string().default(''),
  location: z.string().default(''),
  /** RFC3339 for timed events; YYYY-MM-DD for all-day. Both kept verbatim. */
  start: z.string().default(''),
  end: z.string().default(''),
  allDay: z.boolean().default(false),
  timeZone: z.string().default(''),
  recurringEventId: z.string().default(''),
  eventType: z.string().default('default'),
  hangoutLink: z.string().default(''),
  htmlLink: z.string().default(''),
  organizerEmail: z.string().default(''),
  attendees: z.array(z.object({ email: z.string(), responseStatus: z.string().default('') })).default([]),
  /**
   * The event's OWN notification settings, as configured in Google (D-197).
   *
   * `useDefault` means "whatever the calendar's defaults are"; otherwise
   * `overrides` is the exact list the owner set on this event. Alerts are
   * driven from this and nothing else — a reminder the owner did not ask for
   * is an interruption, and one they did ask for arriving at the wrong time is
   * worse than none.
   */
  reminders: z.object({
    useDefault: z.boolean().default(true),
    overrides: z.array(z.object({
      method: z.string().default('popup'),
      minutes: z.number().int().default(10),
    })).default([]),
  }).default({ useDefault: true, overrides: [] }),
  /** Google's own change token — lets us skip rewrites that changed nothing. */
  etag: z.string().default(''),
  updated: z.string().default(''),
  /** Set when this system created the event, so it can be recognised later. */
  createdByAos: z.boolean().default(false),
  syncedAt: z.string(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const CalendarTaskSchema = z.object({
  actorId: z.string(),
  account: z.string().default(''),
  taskListId: z.string(),
  taskId: z.string(),
  title: z.string().default(''),
  notes: z.string().default(''),
  status: z.string().default('needsAction'),
  /** Google Tasks stores due as a date-only RFC3339 timestamp. */
  due: z.string().default(''),
  completed: z.string().default(''),
  parent: z.string().default(''),
  position: z.string().default(''),
  updated: z.string().default(''),
  createdByAos: z.boolean().default(false),
  syncedAt: z.string(),
});
export type CalendarTask = z.infer<typeof CalendarTaskSchema>;

export const SyncStateSchema = z.object({
  actorId: z.string(),
  /** calendarId, or `tasks:<taskListId>`. */
  resourceId: z.string(),
  kind: z.enum(['events', 'tasks']),
  syncToken: z.string().default(''),
  lastFullSyncAt: z.string().default(''),
  lastSyncAt: z.string().default(''),
  lastError: z.string().default(''),
  /** How many times a 410 forced a full resync — a spike means something is wrong. */
  fullResyncCount: z.number().int().default(0),
  updatedAt: z.string(),
});
export type SyncState = z.infer<typeof SyncStateSchema>;

const calendarsCol = () => collection<CalendarRef>(COLLECTIONS.CALENDARS);
const eventsCol = () => collection<CalendarEvent>(COLLECTIONS.CALENDAR_EVENTS);
const tasksCol = () => collection<CalendarTask>(COLLECTIONS.CALENDAR_TASKS);
const stateCol = () => collection<SyncState>(COLLECTIONS.CALENDAR_SYNC_STATE);

/* --------------------------------------------------------------- constants */

/* Short on purpose (D-196): this string is a calendar name in the owner's
 * Google Calendar sidebar, next to names like "کار" and "خانواده". */
export const AOS_CALENDAR_SUMMARY = 'AOS';
/** Names this system has used for its own calendar, so older ones are still recognised. */
const AOS_CALENDAR_ALIASES = new Set([AOS_CALENDAR_SUMMARY, 'AOS · Autonomous OS']);

/**
 * Priming windows, in the order the owner actually looks at them (D-194):
 * this month first, then next, then last, then the month after next.
 *
 * A first sync used to be one unbounded walk of every calendar across all
 * time, which is why connecting took minutes before anything appeared. These
 * windows are read in viewing order so the current month is on screen while
 * the rest is still arriving.
 */
export const PRIME_WINDOWS: ReadonlyArray<{ label: string; fromMonth: number; toMonth: number }> = [
  { label: 'current', fromMonth: 0, toMonth: 1 },
  { label: 'next', fromMonth: 1, toMonth: 2 },
  { label: 'previous', fromMonth: -1, toMonth: 0 },
  { label: 'next+1', fromMonth: 2, toMonth: 3 },
];

/** Month boundary N months from now, as an RFC3339 instant. */
export function monthBoundary(offset: number, now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return d.toISOString();
}

/* ------------------------------------------------------------------ helpers */

async function readState(actorId: string, resourceId: string, kind: 'events' | 'tasks'): Promise<SyncState | null> {
  const doc = await stateCol().findOne({ actorId, resourceId }, { projection: { _id: 0 } as never });
  return doc ? SyncStateSchema.parse({ ...doc, kind }) : null;
}

async function writeState(state: SyncState): Promise<void> {
  await stateCol().updateOne(
    { actorId: state.actorId, resourceId: state.resourceId },
    { $set: { ...state, updatedAt: nowIso() } },
    { upsert: true },
  );
}

/**
 * Google descriptions are HTML fragments, not text (D-197).
 *
 * Unescaped, they reach the UI as literal `<br>` and `&nbsp;` and the speech
 * engine reads the angle brackets out loud. Converting at the sync boundary
 * means every consumer — grid, alert card, Jarvis, TTS — gets text, and none
 * of them has to remember to sanitise.
 */
export function plainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    /* A list item is often wrapped: `<li><p>text</p></li>`. Unwrapping the
     * inner block first means one bullet on one line, instead of a bullet
     * followed by two blank lines. */
    .replace(/<\s*li[^>]*>\s*<\s*p[^>]*>/gi, '<li>')
    .replace(/<\/\s*p\s*>\s*<\/\s*li\s*>/gi, '</li>')
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toEvent(actorId: string, calendarId: string, raw: Record<string, unknown>, account: string): CalendarEvent {
  const start = raw.start as { dateTime?: string; date?: string; timeZone?: string } | undefined;
  const end = raw.end as { dateTime?: string; date?: string } | undefined;
  const allDay = Boolean(start?.date);
  const props = (raw.extendedProperties as { private?: Record<string, string> } | undefined)?.private ?? {};
  return CalendarEventSchema.parse({
    actorId,
    account,
    calendarId,
    eventId: String(raw.id ?? ''),
    status: String(raw.status ?? 'confirmed'),
    summary: String(raw.summary ?? ''),
    // Google stores descriptions as HTML. Mirroring the markup verbatim is how
    // "<br>" and "<a href=…>" ended up read aloud and printed in the alert card.
    description: plainText(String(raw.description ?? '')),
    location: String(raw.location ?? ''),
    start: start?.dateTime ?? start?.date ?? '',
    end: end?.dateTime ?? end?.date ?? '',
    allDay,
    timeZone: start?.timeZone ?? '',
    recurringEventId: String(raw.recurringEventId ?? ''),
    eventType: String(raw.eventType ?? 'default'),
    hangoutLink: String(raw.hangoutLink ?? ''),
    htmlLink: String(raw.htmlLink ?? ''),
    organizerEmail: String((raw.organizer as { email?: string } | undefined)?.email ?? ''),
    attendees: Array.isArray(raw.attendees)
      ? (raw.attendees as Array<{ email?: string; responseStatus?: string }>)
        .map((a) => ({ email: String(a.email ?? ''), responseStatus: String(a.responseStatus ?? '') }))
      : [],
    reminders: {
      useDefault: (raw.reminders as { useDefault?: boolean } | undefined)?.useDefault !== false,
      overrides: Array.isArray((raw.reminders as { overrides?: unknown[] } | undefined)?.overrides)
        ? ((raw.reminders as { overrides: Array<{ method?: string; minutes?: number }> }).overrides)
          .map((o) => ({ method: String(o.method ?? 'popup'), minutes: Number(o.minutes ?? 10) }))
        : [],
    },
    etag: String(raw.etag ?? ''),
    updated: String(raw.updated ?? ''),
    createdByAos: props.aos === '1',
    syncedAt: nowIso(),
  });
}

/**
 * Erase the entire local mirror for an owner (D-193b).
 *
 * The mirror was keyed by `actorId` alone, and this system runs single-operator
 * so that is always `'owner'`. Connect account A, sync, then connect account B
 * and A's events stay in the mirror forever — the page reports B as connected
 * while showing A's calendar. That is the worst failure this feature has: not
 * missing data, but confidently wrong data belonging to someone else.
 *
 * Called whenever the connected Google account changes, and on disconnect.
 */
export async function purgeMirror(actorId: string): Promise<{ events: number; tasks: number; calendars: number }> {
  const [events, tasks, calendars] = await Promise.all([
    eventsCol().deleteMany({ actorId }),
    tasksCol().deleteMany({ actorId }),
    calendarsCol().deleteMany({ actorId }),
  ]);
  await stateCol().deleteMany({ actorId });   // sync state belonged to the old account
  // Notes are ours, but they point at events that are about to stop existing.
  await purgeEventNotes(actorId);
  return {
    events: events.deletedCount ?? 0,
    tasks: tasks.deletedCount ?? 0,
    calendars: calendars.deletedCount ?? 0,
  };
}

/* ------------------------------------------------------------ calendar list */

export async function syncCalendarList(actorId: string, env: NodeJS.ProcessEnv = process.env): Promise<CalendarRef[]> {
  const account = (await getGrant(actorId))?.accountEmail ?? '';
  const res = await googleCall<{ items?: Array<Record<string, unknown>> }>(
    actorId, CALENDAR_API, '/users/me/calendarList', // showHidden: the owner must see every calendar they have, not just
    // the ones currently ticked in Google's own UI.
    { query: { maxResults: 250, showHidden: true }, env },
  );
  const now = nowIso();
  const refs: CalendarRef[] = (res.items ?? []).map((c) => CalendarRefSchema.parse({
    actorId,
    account,
    calendarId: String(c.id ?? ''),
    summary: String(c.summary ?? ''),
    description: String(c.description ?? ''),
    timeZone: String(c.timeZone ?? ''),
    accessRole: String(c.accessRole ?? ''),
    primary: Boolean(c.primary),
    selected: c.selected !== false,
    backgroundColor: String(c.backgroundColor ?? ''),
    isAosCalendar: AOS_CALENDAR_ALIASES.has(String(c.summary ?? '')),
    enabled: false,      // replaced below by the owner's stored choice
    updatedAt: now,
  }));

  /* Preserve the owner's choice across syncs. A refresh of the calendar list
   * must never silently re-enable something they turned off, nor disable
   * something they turned on. */
  const existing = new Map(
    (await calendarsCol().find({ actorId }, { projection: { _id: 0 } as never }).toArray())
      .map((c) => [c.calendarId, c.enabled]),
  );

  for (const ref of refs) {
    const prior = existing.get(ref.calendarId);
    ref.enabled = prior !== undefined
      ? prior
      // First time we see it: on if the owner owns it, off if it is someone
      // else's calendar shared with them.
      : ref.accessRole === 'owner' || ref.isAosCalendar;
    await calendarsCol().updateOne({ actorId, calendarId: ref.calendarId }, { $set: ref }, { upsert: true });
  }
  return refs;
}

/**
 * Turn a calendar on or off for this system. Disabling drops its mirrored
 * events immediately — leaving them would show a calendar the owner just said
 * they did not want.
 */
export async function setCalendarEnabled(
  actorId: string, calendarId: string, enabled: boolean,
): Promise<{ calendarId: string; enabled: boolean; removed: number }> {
  await calendarsCol().updateOne({ actorId, calendarId }, { $set: { enabled, updatedAt: nowIso() } });
  if (enabled) return { calendarId, enabled, removed: 0 };

  const res = await eventsCol().deleteMany({ actorId, calendarId });
  // Its sync token described a mirror that no longer exists.
  await stateCol().deleteMany({ actorId, resourceId: calendarId });
  return { calendarId, enabled, removed: res.deletedCount ?? 0 };
}

export async function listCalendars(actorId: string): Promise<CalendarRef[]> {
  const account = (await getGrant(actorId))?.accountEmail ?? '';
  const docs = await calendarsCol().find({ actorId, account }, { projection: { _id: 0 } as never }).toArray();
  return docs.map((d) => CalendarRefSchema.parse(d));
}

/**
 * The calendar this system may write to without asking.
 *
 * Owner's decision (D-192): Jarvis writes freely HERE and needs approval to
 * touch anything else. A separate calendar also means the owner can hide or
 * delete everything the system ever created with one toggle in Google Calendar
 * — an undo that no amount of careful coding on our side can match.
 */
export async function ensureAosCalendar(actorId: string, env: NodeJS.ProcessEnv = process.env): Promise<CalendarRef> {
  const existing = (await listCalendars(actorId)).find((c) => c.isAosCalendar);
  if (existing) return existing;

  const created = await googleCall<Record<string, unknown>>(actorId, CALENDAR_API, '/calendars', {
    method: 'POST',
    body: { summary: AOS_CALENDAR_SUMMARY, description: 'Events created by the Autonomous OS kernel.' },
    env,
  });
  await syncCalendarList(actorId, env);
  const refreshed = (await listCalendars(actorId)).find((c) => c.calendarId === String(created.id));
  if (!refreshed) throw new Error('AOS calendar was created but did not appear in the calendar list');
  return refreshed;
}

/**
 * Upsert one event, refusing to go backwards in time.
 *
 * Google stamps every event with `updated`. A slow page of a priming read can
 * land AFTER a newer change has already been mirrored — from an edit the owner
 * or Jarvis just made — and a blind upsert would resurrect the old version on
 * screen. Comparing `updated` makes that impossible: the mirror only ever
 * moves forward. This is what keeps staged loading from fighting live edits.
 */
async function upsertEvent(ev: CalendarEvent): Promise<boolean> {
  const existing = await eventsCol().findOne(
    { actorId: ev.actorId, calendarId: ev.calendarId, eventId: ev.eventId },
    { projection: { updated: 1 } as never },
  );
  if (existing?.updated && ev.updated && existing.updated > ev.updated) return false;
  await eventsCol().updateOne(
    { actorId: ev.actorId, calendarId: ev.calendarId, eventId: ev.eventId },
    { $set: ev },
    { upsert: true },
  );
  return true;
}

/**
 * Mirror an event the system just wrote, using Google's own response (D-194).
 *
 * Without this, a new event is invisible until the next sync — so the owner
 * (or Jarvis) writes something, looks at the grid, and sees nothing. The
 * response body is not a guess: it is the authoritative representation Google
 * stored, `updated` stamp included, so the `updated` guard in `upsertEvent`
 * orders it correctly against any sync page still in flight.
 */
export async function mirrorWrittenEvent(
  actorId: string, calendarId: string, raw: Record<string, unknown>,
): Promise<void> {
  const account = (await getGrant(actorId))?.accountEmail ?? '';
  const ev = toEvent(actorId, calendarId, raw, account);
  if (!ev.eventId) return;
  if (ev.status === 'cancelled') {
    await eventsCol().deleteOne({ actorId, calendarId, eventId: ev.eventId });
    return;
  }
  await upsertEvent(ev);
}

/** Forget an event the system just deleted, without waiting for a sync. */
export async function forgetMirroredEvent(
  actorId: string, calendarId: string, eventId: string,
): Promise<void> {
  await eventsCol().deleteOne({ actorId, calendarId, eventId });
}

export interface PrimeResult {
  calendarId: string;
  window: string;
  upserted: number;
  error: string;
}

/**
 * Fetch ONE bounded window for one calendar. Fast, cheap, and independent —
 * the caller runs them in the owner's viewing order so the current month is on
 * screen while the rest is still arriving.
 */
export async function primeWindow(
  actorId: string, calendarId: string, fromIso: string, toIso: string, label: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PrimeResult> {
  const account = (await getGrant(actorId))?.accountEmail ?? '';
  let upserted = 0;
  try {
    let pageToken = '';
    for (;;) {
      const res = await googleCall<{ items?: Array<Record<string, unknown>>; nextPageToken?: string }>(
        actorId, CALENDAR_API, `/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          query: {
            maxResults: 250,
            singleEvents: true,
            orderBy: 'startTime',
            timeMin: fromIso,
            timeMax: toIso,
            pageToken: pageToken || undefined,
          },
          env,
        },
      );
      for (const raw of res.items ?? []) {
        const ev = toEvent(actorId, calendarId, raw, account);
        if (!ev.eventId || ev.status === 'cancelled') continue;
        if (await upsertEvent(ev)) upserted += 1;
      }
      if (!res.nextPageToken) break;
      pageToken = res.nextPageToken;
    }
  } catch (err) {
    return { calendarId, window: label, upserted, error: err instanceof Error ? err.message : String(err) };
  }
  return { calendarId, window: label, upserted, error: '' };
}

/* ------------------------------------------------------------- event sync */

export interface SyncResult {
  resourceId: string;
  upserted: number;
  deleted: number;
  fullSync: boolean;
  pages: number;
  error: string;
}

/**
 * Event sync — bounded windows with an incremental refresh (rewritten D-196).
 *
 * The previous design used Google's `syncToken` series. It was correct by the
 * letter of the sync guide and wrong for this system, for a reason the guide
 * states plainly: a sync token is incompatible with `timeMin`/`timeMax`, so a
 * tokenised series must walk the calendar's ENTIRE history — and with
 * `singleEvents: true` that means every instance of every recurrence since the
 * calendar was created. On a real calendar that is thousands of pages. In
 * development it never finished: the dev server restarted, no token was ever
 * stored, and the next sync started the same endless walk again. The owner
 * pressed "همگام‌سازی" repeatedly and events legitimately in their Google
 * Calendar never appeared. That is the bug.
 *
 * The fix is to stop trying to mirror all of history. Nobody looks at 2019.
 * Sync becomes:
 *
 *   window  = the months actually on screen (`PRIME_WINDOWS`, extendable)
 *   refresh = the same window plus `updatedMin`, which returns ONLY what
 *             changed since the last pass, plus `showDeleted` so cancellations
 *             are seen
 *
 * `updatedMin` is incompatible with a sync token but perfectly legal with time
 * bounds, so this is one mechanism instead of two, always bounded, and cheap
 * on every pass after the first. Deleting a stale row is handled by
 * `showDeleted`; an event dragged into the window from outside still arrives,
 * because moving it updates it.
 */
export interface SyncResult {
  resourceId: string;
  upserted: number;
  deleted: number;
  fullSync: boolean;
  pages: number;
  error: string;
}

/** Every request in the window series shares these — see D-194/D-196. */
const WINDOW_PARAMS = { maxResults: 250, singleEvents: true, showDeleted: true } as const;

/**
 * Sync one calendar over one time window.
 *
 * `updatedMin` turns the second and every later pass into a delta. It is
 * deliberately backdated by a minute: Google's `updated` stamps and our clock
 * are not the same clock, and losing an event is far worse than re-reading one.
 */
export async function syncEventWindow(
  actorId: string, calendarId: string, fromIso: string, toIso: string,
  updatedMin: string, env: NodeJS.ProcessEnv = process.env,
): Promise<{ upserted: number; deleted: number; pages: number; error: string }> {
  const account = (await getGrant(actorId))?.accountEmail ?? '';
  let upserted = 0;
  let deleted = 0;
  let pages = 0;

  try {
    let pageToken = '';
    for (;;) {
      const res = await googleCall<{ items?: Array<Record<string, unknown>>; nextPageToken?: string }>(
        actorId, CALENDAR_API, `/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          query: {
            ...WINDOW_PARAMS,
            timeMin: fromIso,
            timeMax: toIso,
            updatedMin: updatedMin || undefined,
            pageToken: pageToken || undefined,
          },
          env,
        },
      );
      pages += 1;

      for (const raw of res.items ?? []) {
        const ev = toEvent(actorId, calendarId, raw, account);
        if (!ev.eventId) continue;
        // A cancellation is a result, not an absence — it must leave the mirror.
        if (ev.status === 'cancelled') {
          const r = await eventsCol().deleteOne({ actorId, calendarId, eventId: ev.eventId });
          deleted += r.deletedCount ?? 0;
        } else if (await upsertEvent(ev)) {
          upserted += 1;
        }
      }

      if (!res.nextPageToken) break;
      pageToken = res.nextPageToken;
    }
  } catch (err) {
    return { upserted, deleted, pages, error: err instanceof Error ? err.message : String(err) };
  }
  return { upserted, deleted, pages, error: '' };
}

/** How far the mirror reaches: one month back, three forward. */
export function standardWindow(now: Date = new Date()): { from: string; to: string } {
  return { from: monthBoundary(-1, now), to: monthBoundary(3, now) };
}

/**
 * Sync one calendar across the standard window.
 *
 * First pass reads the window in full; later passes read only what changed.
 * `lastSyncAt` is stored per calendar and is the whole of the state — no
 * tokens, no 410 recovery, nothing that can wedge.
 */
export async function syncEvents(
  actorId: string, calendarId: string, env: NodeJS.ProcessEnv = process.env,
): Promise<SyncResult> {
  const prior = await readState(actorId, calendarId, 'events');
  /* Migration (D-196). A row left by the token design carries a `lastSyncAt`
   * from a walk that never completed, so trusting it as a watermark would
   * fetch only changes and freeze an incomplete mirror permanently. The
   * leftover token is the marker: if one is present, this calendar has never
   * had a trustworthy full pass and gets one now. */
  const staleTokenEra = Boolean(prior?.syncToken);
  const first = !prior?.lastSyncAt || staleTokenEra;
  const { from, to } = standardWindow();
  // Back off a minute: two clocks, and a missed event is worse than a re-read.
  const updatedMin = first ? '' : new Date(new Date(prior!.lastSyncAt).getTime() - 60_000).toISOString();

  const res = await syncEventWindow(actorId, calendarId, from, to, updatedMin, env);

  await writeState(SyncStateSchema.parse({
    actorId, resourceId: calendarId, kind: 'events',
    syncToken: '',                                   // retired: see the note above
    lastFullSyncAt: first ? nowIso() : (prior?.lastFullSyncAt ?? ''),
    // Only advance the watermark on success, or a failed pass would silently
    // skip everything that changed during it.
    lastSyncAt: res.error ? (prior?.lastSyncAt ?? '') : nowIso(),
    lastError: res.error,
    fullResyncCount: prior?.fullResyncCount ?? 0, updatedAt: nowIso(),
  }));

  return {
    resourceId: calendarId, upserted: res.upserted, deleted: res.deleted,
    fullSync: first, pages: res.pages, error: res.error,
  };
}

/* --------------------------------------------------------------- task sync */

/**
 * Google Tasks — what the owner calls "reminders".
 *
 * Reminders stopped being a separate product: Calendar and Assistant reminders
 * migrated to Tasks in 2023, Keep reminders in 2025, and there is no public
 * Reminders API. A "reminder" in this system is therefore a Task with a due
 * date, which is exactly what Google itself now shows on the calendar grid.
 *
 * The Tasks API has no sync token, so this pulls the list with `showDeleted`
 * and `updatedMin` where possible and reconciles.
 */
export async function syncTasks(
  actorId: string, taskListId = '@default', env: NodeJS.ProcessEnv = process.env,
): Promise<SyncResult> {
  const resourceId = `tasks:${taskListId}`;
  const account = (await getGrant(actorId))?.accountEmail ?? '';
  const prior = await readState(actorId, resourceId, 'tasks');
  let upserted = 0;
  let deleted = 0;
  let pages = 0;

  try {
    let pageToken = '';
    for (;;) {
      const res = await googleCall<{ items?: Array<Record<string, unknown>>; nextPageToken?: string }>(
        actorId, TASKS_API, `/lists/${encodeURIComponent(taskListId)}/tasks`, {
          query: {
            maxResults: 100,
            showCompleted: true,
            showHidden: true,
            showDeleted: true,
            pageToken: pageToken || undefined,
          },
          env,
        },
      );
      pages += 1;

      for (const raw of res.items ?? []) {
        const taskId = String(raw.id ?? '');
        if (!taskId) continue;
        if (raw.deleted === true) {
          const r = await tasksCol().deleteOne({ actorId, taskListId, taskId });
          deleted += r.deletedCount ?? 0;
          continue;
        }
        const notes = String(raw.notes ?? '');
        const task = CalendarTaskSchema.parse({
          actorId, account, taskListId, taskId,
          title: String(raw.title ?? ''),
          notes,
          status: String(raw.status ?? 'needsAction'),
          due: String(raw.due ?? ''),
          completed: String(raw.completed ?? ''),
          parent: String(raw.parent ?? ''),
          position: String(raw.position ?? ''),
          updated: String(raw.updated ?? ''),
          // Tasks has no extendedProperties, so provenance rides in the notes.
          createdByAos: notes.includes('[aos]'),
          syncedAt: nowIso(),
        });
        await tasksCol().updateOne({ actorId, taskListId, taskId }, { $set: task }, { upsert: true });
        upserted += 1;
      }

      if (!res.nextPageToken) break;
      pageToken = res.nextPageToken;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeState(SyncStateSchema.parse({
      actorId, resourceId, kind: 'tasks', syncToken: '',
      lastFullSyncAt: prior?.lastFullSyncAt ?? '', lastSyncAt: nowIso(), lastError: message,
      fullResyncCount: prior?.fullResyncCount ?? 0, updatedAt: nowIso(),
    }));
    return { resourceId, upserted, deleted, fullSync: true, pages, error: message };
  }

  await writeState(SyncStateSchema.parse({
    actorId, resourceId, kind: 'tasks', syncToken: '',
    lastFullSyncAt: nowIso(), lastSyncAt: nowIso(), lastError: '',
    fullResyncCount: prior?.fullResyncCount ?? 0, updatedAt: nowIso(),
  }));
  return { resourceId, upserted, deleted, fullSync: true, pages, error: '' };
}

/* ------------------------------------------------------------------ reads */

export interface AgendaQuery {
  actorId: string;
  fromIso: string;
  toIso: string;
  calendarIds?: string[];
  limit?: number;
}

/** The mirror read that the page and the heartbeat both use. */
export async function readAgenda(q: AgendaQuery): Promise<CalendarEvent[]> {
  /* Filter by the CURRENTLY connected account, not just the actor. The purge on
   * account change is the primary defence; this is the second one, because
   * showing another person's calendar must fail closed even if a purge did
   * not complete. Rows written before accounts were stamped have account:''
   * and are excluded — they belong to an unknown grant. */
  const account = (await getGrant(q.actorId))?.accountEmail ?? '';
  const filter: Record<string, unknown> = {
    actorId: q.actorId,
    account,
    status: { $ne: 'cancelled' },
    start: { $gte: q.fromIso, $lte: q.toIso },
  };
  if (q.calendarIds?.length) {
    filter.calendarId = { $in: q.calendarIds };
  } else {
    /* Only enabled calendars. Belt-and-braces with the delete-on-disable
     * above: a row that outlived its calendar must still never render. */
    const enabled = (await calendarsCol()
      .find({ actorId: q.actorId, account, enabled: true }, { projection: { _id: 0 } as never }).toArray())
      .map((c) => c.calendarId);
    filter.calendarId = { $in: enabled };
  }
  const docs = await eventsCol()
    .find(filter as never, { projection: { _id: 0 } as never })
    .sort({ start: 1 })
    .limit(Math.min(q.limit ?? 250, 500))
    .toArray();
  /* Sanitise on READ as well as on write (D-199).
   *
   * `toEvent` has stripped HTML since D-197, but rows mirrored before that
   * still hold `<ul><li><p>…` verbatim — and the incremental sync only
   * re-fetches events whose `updated` stamp moved, so an unchanged event keeps
   * its stale description forever. Cleaning here heals every old row on the
   * next page load, with no migration and no re-sync. `plainText` is
   * idempotent, so doing it twice costs nothing. */
  return docs.map((d) => {
    const ev = CalendarEventSchema.parse(d);
    return { ...ev, description: plainText(ev.description), location: plainText(ev.location) };
  });
}

export async function readTasks(actorId: string, opts: { includeCompleted?: boolean; limit?: number } = {}): Promise<CalendarTask[]> {
  const account = (await getGrant(actorId))?.accountEmail ?? '';
  const filter: Record<string, unknown> = { actorId, account };
  if (!opts.includeCompleted) filter.status = { $ne: 'completed' };
  const docs = await tasksCol()
    .find(filter as never, { projection: { _id: 0 } as never })
    .sort({ due: 1 })
    .limit(Math.min(opts.limit ?? 200, 500))
    .toArray();
  // Same healing as events: Google Tasks notes can carry markup too.
  return docs.map((d) => {
    const t = CalendarTaskSchema.parse(d);
    return { ...t, notes: plainText(t.notes) };
  });
}

/**
 * Find mirrored events by title, ignoring the date range and the enabled flag.
 *
 * Every other read is deliberately narrow — a month view has no business
 * pulling a year. This one is deliberately wide, because it exists to answer
 * "where did it go?", and each of those filters is a place an event can hide.
 */
/**
 * Normalise Persian/Arabic text before comparing it (D-203).
 *
 * The same word is routinely stored with different code points: Arabic yeh
 * (ي U+064A) vs Persian yeh (ی U+06CC), Arabic kaf (ك) vs Persian kaf (ک),
 * Arabic-Indic vs Persian digits, and optional ZWNJ inside compounds. Google
 * stores whatever the keyboard produced; the owner types whatever theirs
 * produces. A byte-exact search between the two finds nothing and reports
 * "does not exist", which is how the assistant came to deny an event the owner
 * was looking at.
 */
export function foldFa(input: string): string {
  return input
    .replace(/[\u064A\u0649]/g, '\u06CC')          // ي ى → ی
    .replace(/\u0643/g, '\u06A9')                  // ك → ک
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u200C\u200F\u200E\u064B-\u0652]/g, '')  // ZWNJ, marks, harakat
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export async function findEvents(
  actorId: string, q: string, limit = 20,
): Promise<CalendarEvent[]> {
  const account = (await getGrant(actorId))?.accountEmail ?? '';
  const needle = foldFa(q);
  if (!needle) return [];

  /* Filtering in Mongo cannot fold Persian orthography, so the scan happens
   * here. The mirror is a bounded four-month window — a few hundred rows —
   * which is cheap, and correctness matters far more than the microseconds. */
  const docs = (await eventsCol()
    .find({ actorId, account } as never, { projection: { _id: 0 } as never })
    .sort({ start: 1 })
    .limit(2000)
    .toArray())
    .filter((d) => {
      const row = d as unknown as { summary?: string; description?: string; location?: string };
      const hay = foldFa(`${row.summary ?? ''} ${row.description ?? ''} ${row.location ?? ''}`);
      return hay.includes(needle);
    })
    .slice(0, Math.min(limit, 50));
  return docs.map((d) => {
    const ev = CalendarEventSchema.parse(d);
    return { ...ev, description: plainText(ev.description), location: plainText(ev.location) };
  });
}

/**
 * What the mirror actually holds, for answering "why can't you see it?".
 *
 * A search that returns nothing is ambiguous: never created, wrong calendar,
 * or outside the synced window. This turns that into a fact.
 */
/** One mirrored event by id — the current times, for a duration-preserving move. */
export async function readEventById(
  actorId: string, eventId: string,
): Promise<CalendarEvent | null> {
  const account = (await getGrant(actorId))?.accountEmail ?? '';
  const doc = await eventsCol().findOne(
    { actorId, account, eventId } as never,
    { projection: { _id: 0 } as never },
  );
  return doc ? CalendarEventSchema.parse(doc) : null;
}

export async function mirrorCoverage(actorId: string): Promise<{
  events: number; earliest: string; latest: string;
  perCalendar: Array<{ calendarId: string; summary: string; enabled: boolean; events: number }>;
}> {
  const account = (await getGrant(actorId))?.accountEmail ?? '';
  const docs = await eventsCol()
    .find({ actorId, account } as never, { projection: { _id: 0 } as never })
    .sort({ start: 1 })
    .limit(5000)
    .toArray();
  const rows = docs as unknown as Array<{ calendarId: string; start: string }>;
  const cals = await listCalendars(actorId);

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.calendarId, (counts.get(r.calendarId) ?? 0) + 1);

  return {
    events: rows.length,
    earliest: rows[0]?.start ?? '',
    latest: rows[rows.length - 1]?.start ?? '',
    perCalendar: cals.map((c) => ({
      calendarId: c.calendarId, summary: c.summary || c.calendarId,
      enabled: c.enabled, events: counts.get(c.calendarId) ?? 0,
    })),
  };
}

/**
 * Ask Google directly what it holds for a date range, and diff it against the
 * mirror (D-204).
 *
 * Every previous answer to "why can't you see it?" was a guess, mine included:
 * wrong calendar, disabled calendar, outside the window, never created. Four
 * plausible stories and no way to tell them apart, so the owner got a
 * different theory each time.
 *
 * This asks the only authority. It reads Google live for the range — bypassing
 * the mirror, the enabled flags and the sync watermark entirely — and reports
 * the three sets that matter: what Google has, what we mirrored, and what is
 * in one but not the other. A difference has exactly one cause, and this names
 * which.
 */
export async function diagnoseRange(
  actorId: string, fromIso: string, toIso: string, env: NodeJS.ProcessEnv = process.env,
): Promise<{
  account: string;
  calendars: Array<{
    calendarId: string; summary: string; enabled: boolean;
    google: number; mirrored: number; missing: string[]; error: string;
  }>;
}> {
  const account = (await getGrant(actorId))?.accountEmail ?? '';
  const cals = await listCalendars(actorId);
  const out: Awaited<ReturnType<typeof diagnoseRange>>['calendars'] = [];

  for (const cal of cals) {
    let googleIds: Array<{ id: string; summary: string; start: string }> = [];
    let error = '';
    try {
      /* Deliberately NOT filtered by `enabled`: the whole point is to see
       * events in calendars we are not syncing, which is one of the four
       * explanations and indistinguishable from the others until now. */
      const res = await googleCall<{ items?: Array<Record<string, unknown>> }>(
        actorId, CALENDAR_API, `/calendars/${encodeURIComponent(cal.calendarId)}/events`,
        { query: { maxResults: 250, singleEvents: true, timeMin: fromIso, timeMax: toIso, orderBy: 'startTime' }, env },
      );
      googleIds = (res.items ?? [])
        .filter((r) => String(r.status ?? '') !== 'cancelled')
        .map((r) => ({
          id: String(r.id ?? ''),
          summary: String(r.summary ?? '(untitled)'),
          start: String((r.start as { dateTime?: string; date?: string } | undefined)?.dateTime
            ?? (r.start as { date?: string } | undefined)?.date ?? ''),
        }));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const mirrored = await eventsCol()
      .find({ actorId, account, calendarId: cal.calendarId, start: { $gte: fromIso, $lte: toIso } } as never,
        { projection: { _id: 0 } as never })
      .limit(500)
      .toArray();
    const haveIds = new Set((mirrored as unknown as Array<{ eventId: string }>).map((m) => m.eventId));

    out.push({
      calendarId: cal.calendarId,
      summary: cal.summary || cal.calendarId,
      enabled: cal.enabled,
      google: googleIds.length,
      mirrored: mirrored.length,
      missing: googleIds.filter((g) => !haveIds.has(g.id)).map((g) => `${g.summary} @ ${g.start}`).slice(0, 10),
      error,
    });
  }
  return { account, calendars: out };
}

/**
 * Pull one date range from Google into the mirror, ignoring the watermark.
 *
 * The repair for whatever `diagnoseRange` finds. `syncEvents` is incremental
 * by design and will not re-fetch an event whose `updated` stamp has not
 * moved, which is correct and also means it can never heal a gap.
 */
export async function backfillRange(
  actorId: string, fromIso: string, toIso: string, env: NodeJS.ProcessEnv = process.env,
): Promise<{ calendarId: string; upserted: number; error: string }[]> {
  const cals = await listCalendars(actorId);
  const results: { calendarId: string; upserted: number; error: string }[] = [];
  for (const cal of cals.filter((c) => c.enabled)) {
    const r = await syncEventWindow(actorId, cal.calendarId, fromIso, toIso, '', env);
    results.push({ calendarId: cal.calendarId, upserted: r.upserted, error: r.error });
  }
  return results;
}

export async function syncStates(actorId: string): Promise<SyncState[]> {
  const docs = await stateCol().find({ actorId }, { projection: { _id: 0 } as never }).toArray();
  return docs.map((d) => SyncStateSchema.parse(d));
}

/** Sync every selected calendar plus the default task list. */
/**
 * Staged sync, phase one (D-194): make the screen useful.
 *
 * Only calendars that have never been synced are primed. A calendar that
 * already holds a sync token has a cheaper route — one incremental call
 * instead of four windowed reads — so priming it again would spend the
 * owner's Google quota to learn nothing.
 *
 * Awaited by the caller, and deliberately short: four bounded reads per cold
 * calendar, current month first.
 */
export async function syncFirstPaint(
  actorId: string,
  onWindow?: (r: PrimeResult) => void,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PrimeResult[]> {
  const calendars = await syncCalendarList(actorId, env);
  /* Coldness is now "never synced", not "has no sync token" — tokens were
   * retired in D-196 and a token check here would prime every calendar on
   * every run, spending quota to re-read what is already mirrored. */
  const synced = new Map(
    (await syncStates(actorId)).filter((st) => st.kind === 'events').map((st) => [st.resourceId, st.lastSyncAt]),
  );
  const cold = calendars.filter((c) => c.enabled && !synced.get(c.calendarId));
  if (cold.length === 0) return [];

  const out: PrimeResult[] = [];
  // Window-major: the current month of EVERY calendar before next month of any.
  for (const w of PRIME_WINDOWS) {
    const from = monthBoundary(w.fromMonth);
    const to = monthBoundary(w.toMonth);
    for (const cal of cold) {
      const r = await primeWindow(actorId, cal.calendarId, from, to, w.label, env);
      out.push(r);
      onWindow?.(r);
    }
  }
  return out;
}

/**
 * Staged sync, phase two: make the mirror complete and cheap to keep current.
 *
 * This is the unbounded, tokenised series. First run per calendar walks
 * everything (slow, once); every run after is a delta (fast, forever). Meant to
 * run in the BACKGROUND behind `syncFirstPaint`, which is why nothing here
 * needs to finish before the owner sees their month.
 */
export async function syncAll(actorId: string, env: NodeJS.ProcessEnv = process.env): Promise<SyncResult[]> {
  const calendars = await syncCalendarList(actorId, env);
  const results: SyncResult[] = [];
  for (const cal of calendars.filter((c) => c.enabled)) {
    results.push(await syncEvents(actorId, cal.calendarId, env));
  }
  results.push(await syncTasks(actorId, '@default', env));
  return results;
}
