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

/* ------------------------------------------------------------------ models */

export const CalendarRefSchema = z.object({
  actorId: z.string(),
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
  updatedAt: z.string(),
});
export type CalendarRef = z.infer<typeof CalendarRefSchema>;

export const CalendarEventSchema = z.object({
  actorId: z.string(),
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

function toEvent(actorId: string, calendarId: string, raw: Record<string, unknown>): CalendarEvent {
  const start = raw.start as { dateTime?: string; date?: string; timeZone?: string } | undefined;
  const end = raw.end as { dateTime?: string; date?: string } | undefined;
  const allDay = Boolean(start?.date);
  const props = (raw.extendedProperties as { private?: Record<string, string> } | undefined)?.private ?? {};
  return CalendarEventSchema.parse({
    actorId,
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

/* ------------------------------------------------------------ calendar list */

export async function syncCalendarList(actorId: string, env: NodeJS.ProcessEnv = process.env): Promise<CalendarRef[]> {
  const res = await googleCall<{ items?: Array<Record<string, unknown>> }>(
    actorId, CALENDAR_API, '/users/me/calendarList', { query: { maxResults: 250, showHidden: false }, env },
  );
  const now = nowIso();
  const refs: CalendarRef[] = (res.items ?? []).map((c) => CalendarRefSchema.parse({
    actorId,
    calendarId: String(c.id ?? ''),
    summary: String(c.summary ?? ''),
    description: String(c.description ?? ''),
    timeZone: String(c.timeZone ?? ''),
    accessRole: String(c.accessRole ?? ''),
    primary: Boolean(c.primary),
    selected: c.selected !== false,
    backgroundColor: String(c.backgroundColor ?? ''),
    isAosCalendar: String(c.summary ?? '') === AOS_CALENDAR_SUMMARY,
    updatedAt: now,
  }));

  for (const ref of refs) {
    await calendarsCol().updateOne({ actorId, calendarId: ref.calendarId }, { $set: ref }, { upsert: true });
  }
  return refs;
}

export async function listCalendars(actorId: string): Promise<CalendarRef[]> {
  const docs = await calendarsCol().find({ actorId }, { projection: { _id: 0 } as never }).toArray();
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
        const ev = toEvent(actorId, calendarId, raw);
        if (!ev.eventId) continue;
        // Rule 2: cancellations arrive as items and must leave the mirror.
        if (ev.status === 'cancelled') {
          const r = await eventsCol().deleteOne({ actorId, calendarId, eventId: ev.eventId });
          deleted += r.deletedCount ?? 0;
        } else {
          await eventsCol().updateOne({ actorId, calendarId, eventId: ev.eventId }, { $set: ev }, { upsert: true });
          upserted += 1;
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
          actorId, taskListId, taskId,
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
  const filter: Record<string, unknown> = {
    actorId: q.actorId,
    status: { $ne: 'cancelled' },
    start: { $gte: q.fromIso, $lte: q.toIso },
  };
  if (q.calendarIds?.length) filter.calendarId = { $in: q.calendarIds };
  const docs = await eventsCol()
    .find(filter as never, { projection: { _id: 0 } as never })
    .sort({ start: 1 })
    .limit(Math.min(q.limit ?? 250, 500))
    .toArray();
  return docs.map((d) => CalendarEventSchema.parse(d));
}

export async function readTasks(actorId: string, opts: { includeCompleted?: boolean; limit?: number } = {}): Promise<CalendarTask[]> {
  const filter: Record<string, unknown> = { actorId };
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
export async function syncAll(actorId: string, env: NodeJS.ProcessEnv = process.env): Promise<SyncResult[]> {
  const calendars = await syncCalendarList(actorId, env);
  const results: SyncResult[] = [];
  for (const cal of calendars.filter((c) => c.selected)) {
    results.push(await syncEvents(actorId, cal.calendarId, env));
  }
  results.push(await syncTasks(actorId, '@default', env));
  return results;
}
