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

/**
 * The ONE parameter set for event syncs.
 *
 * Rule 3 above: these must be byte-identical between the initial full sync and
 * every incremental one. Anything time-bounded (`timeMin`, `timeMax`) is
 * deliberately absent — it is illegal alongside a sync token, and a mirror
 * bounded by a moving window would quietly lose events as the window slides.
 */
const EVENT_SYNC_PARAMS = {
  maxResults: 250,
  singleEvents: true,       // expand recurrences into instances we can render
  showDeleted: true,        // required: this is how deletions reach us
} as const;

export const AOS_CALENDAR_SUMMARY = 'AOS · Autonomous OS';

/**
 * Priming windows, in the order the owner actually looks at them (D-194):
 * this month first, then next, then last, then the month after next.
 *
 * These are BOUNDED reads (`timeMin`/`timeMax`) and deliberately carry NO sync
 * token — the official sync guide forbids combining the two, and a request that
 * mixes them is rejected. So the two mechanisms serve different jobs and are
 * never mixed in one series:
 *
 *   priming  → bounded, throwaway, makes the grid usable in seconds
 *   series   → unbounded, tokenised, makes every later update cheap
 *
 * A first sync used to be one unbounded walk of every calendar across all time,
 * which is why connecting took so long before anything appeared.
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
    description: String(raw.description ?? ''),
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
  await stateCol().deleteMany({ actorId });   // sync tokens belonged to the old account
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
    isAosCalendar: String(c.summary ?? '') === AOS_CALENDAR_SUMMARY,
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

export async function syncEvents(
  actorId: string, calendarId: string, env: NodeJS.ProcessEnv = process.env,
): Promise<SyncResult> {
  const account = (await getGrant(actorId))?.accountEmail ?? '';
  const prior = await readState(actorId, calendarId, 'events');
  let syncToken = prior?.syncToken ?? '';
  let fullSync = !syncToken;
  let upserted = 0;
  let deleted = 0;
  let pages = 0;

  const runPass = async (token: string): Promise<string> => {
    let pageToken = '';
    let nextSync = '';
    for (;;) {
      const res = await googleCall<{
        items?: Array<Record<string, unknown>>; nextPageToken?: string; nextSyncToken?: string;
      }>(actorId, CALENDAR_API, `/calendars/${encodeURIComponent(calendarId)}/events`, {
        query: { ...EVENT_SYNC_PARAMS, syncToken: token || undefined, pageToken: pageToken || undefined },
        env,
      });
      pages += 1;

      for (const raw of res.items ?? []) {
        const ev = toEvent(actorId, calendarId, raw, account);
        if (!ev.eventId) continue;
        // Rule 2: cancellations arrive as items and must leave the mirror.
        if (ev.status === 'cancelled') {
          const r = await eventsCol().deleteOne({ actorId, calendarId, eventId: ev.eventId });
          deleted += r.deletedCount ?? 0;
        } else {
          if (await upsertEvent(ev)) upserted += 1;
        }
      }

      // Rule 5: the sync token only appears on the final page.
      if (res.nextPageToken) { pageToken = res.nextPageToken; continue; }
      nextSync = res.nextSyncToken ?? '';
      break;
    }
    return nextSync;
  };

  let nextToken = '';
  try {
    nextToken = await runPass(syncToken);
  } catch (err) {
    if (err instanceof GoogleApiError && err.isSyncTokenGone) {
      // Rule 4: the mirror for this calendar is now untrustworthy. Drop it and
      // rebuild rather than merging old rows with a fresh full sync.
      await eventsCol().deleteMany({ actorId, calendarId });
      syncToken = '';
      fullSync = true;
      upserted = 0;
      deleted = 0;
      nextToken = await runPass('');
      await writeState(SyncStateSchema.parse({
        actorId, resourceId: calendarId, kind: 'events', syncToken: nextToken,
        lastFullSyncAt: nowIso(), lastSyncAt: nowIso(), lastError: '',
        fullResyncCount: (prior?.fullResyncCount ?? 0) + 1, updatedAt: nowIso(),
      }));
      return { resourceId: calendarId, upserted, deleted, fullSync, pages, error: '' };
    }
    const message = err instanceof Error ? err.message : String(err);
    await writeState(SyncStateSchema.parse({
      actorId, resourceId: calendarId, kind: 'events', syncToken: prior?.syncToken ?? '',
      lastFullSyncAt: prior?.lastFullSyncAt ?? '', lastSyncAt: nowIso(), lastError: message,
      fullResyncCount: prior?.fullResyncCount ?? 0, updatedAt: nowIso(),
    }));
    return { resourceId: calendarId, upserted, deleted, fullSync, pages, error: message };
  }

  await writeState(SyncStateSchema.parse({
    actorId, resourceId: calendarId, kind: 'events', syncToken: nextToken,
    lastFullSyncAt: fullSync ? nowIso() : (prior?.lastFullSyncAt ?? ''),
    lastSyncAt: nowIso(), lastError: '',
    fullResyncCount: prior?.fullResyncCount ?? 0, updatedAt: nowIso(),
  }));
  return { resourceId: calendarId, upserted, deleted, fullSync, pages, error: '' };
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
  return docs.map((d) => CalendarEventSchema.parse(d));
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
  return docs.map((d) => CalendarTaskSchema.parse(d));
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
  const tokens = new Map(
    (await syncStates(actorId)).filter((s) => s.kind === 'events').map((s) => [s.resourceId, s.syncToken]),
  );
  const cold = calendars.filter((c) => c.enabled && !tokens.get(c.calendarId));
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
