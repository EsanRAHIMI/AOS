/**
 * Writing to Google Calendar and Tasks (D-192).
 *
 * The owner's rule: **Jarvis writes freely into the dedicated AOS calendar, and
 * anything touching the owner's real calendars pauses for approval.** That is
 * enforced here, in the module, not only in the tool definitions — a policy
 * that lives only in a tool's metadata is one refactor away from being lost.
 *
 * `classifyWrite` returns the sensitivity of an operation so the caller (the
 * agent tool layer, the gateway) can pause consistently. Deleting and inviting
 * guests are sensitive EVERYWHERE, including in the AOS calendar: a delete is
 * irreversible from our side, and an invitation sends real mail to real people
 * in the owner's name.
 */
import { googleCall, CALENDAR_API, TASKS_API } from './google.js';
import {
  ensureAosCalendar, listCalendars, mirrorWrittenEvent, forgetMirroredEvent,
  mirrorWrittenTask, type CalendarRef,
} from './sync.js';

export type WriteSensitivity = 'free' | 'approval' | 'blocked';

export interface WriteClassification {
  sensitivity: WriteSensitivity;
  reason: string;
}

/**
 * Decide whether an operation may proceed unattended (rewritten, D-195d).
 *
 * The first version asked permission for any write outside the AOS calendar.
 * In practice that meant: the owner says "یک رویداد از ۱۲:۳۰ تا ۱۳ در تقویم من
 * ثبت کن", and the system answers "اجازه می‌دهید در تقویم شما ثبت کنم؟" —
 * asking permission for the exact thing just requested, in the same breath.
 * With no AOS calendar created yet it was worse: the target resolved to null,
 * the reason became "تقویم مقصد شناسایی نشد", and the owner could confirm
 * forever without anything happening.
 *
 * The mistake was treating "which calendar" as the risk axis. It is not.
 * A plain event in a calendar the owner can write to is reversible, private,
 * and exactly what they asked for. What is actually irreversible or escapes
 * the system is:
 *
 *   - guests        → real invitation emails, sent as the owner, cannot unsend
 *   - deletion      → no undo
 *   - a calendar the owner cannot write to → the write will fail or belongs
 *                     to someone else
 *
 * Those three need a yes. Nothing else does. Governance is for consequences
 * that outlive the conversation, not for every keystroke.
 */
export function classifyWrite(input: {
  op: 'create' | 'update' | 'delete';
  calendar: CalendarRef | null;
  hasAttendees?: boolean;
}): WriteClassification {
  if (input.op === 'delete') {
    return { sensitivity: 'approval', reason: 'حذف رویداد برگشت‌پذیر نیست' };
  }
  if (input.hasAttendees) {
    return { sensitivity: 'approval', reason: 'دعوت مهمان یعنی ارسال ایمیل واقعی از طرف شما' };
  }
  if (!input.calendar) {
    // Not a permission question — the caller failed to resolve a target and
    // should say so plainly instead of asking the owner to approve a mystery.
    return { sensitivity: 'blocked', reason: 'تقویم مقصد پیدا نشد' };
  }
  if (!WRITABLE_ROLES.has(input.calendar.accessRole)) {
    return { sensitivity: 'blocked', reason: `در «${input.calendar.summary || input.calendar.calendarId}» اجازهٔ نوشتن ندارید` };
  }
  return { sensitivity: 'free', reason: '' };
}

/** Roles Google actually lets us write events into. */
const WRITABLE_ROLES = new Set(['owner', 'writer']);

export interface CreateEventInput {
  actorId: string;
  /** Omit to use the AOS calendar, which is the unattended-write target. */
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  /** RFC3339 with offset for timed events, or YYYY-MM-DD for all-day. */
  start: string;
  end: string;
  timeZone?: string;
  attendees?: string[];
  /** Google Meet link. Per Google's Feb-2026 guidance, always a NEW conference. */
  withMeet?: boolean;
  /** Minutes before the start for a popup reminder. */
  reminderMinutes?: number[];
}

function timePart(value: string, timeZone?: string): Record<string, string> {
  // A date-only value is how Google represents an all-day event; a timed one
  // needs dateTime. Guessing wrong silently shifts the event by hours.
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? { date: value }
    : { dateTime: value, ...(timeZone ? { timeZone } : {}) };
}

export async function createEvent(input: CreateEventInput, env: NodeJS.ProcessEnv = process.env) {
  const calendar = input.calendarId
    ? (await listCalendars(input.actorId)).find((c) => c.calendarId === input.calendarId) ?? null
    : await ensureAosCalendar(input.actorId, env);
  const calendarId = input.calendarId ?? calendar?.calendarId;
  if (!calendarId) throw new Error('no target calendar');

  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description ?? '',
    location: input.location ?? '',
    start: timePart(input.start, input.timeZone),
    end: timePart(input.end, input.timeZone),
    // Provenance: lets the mirror and the owner tell system-made events apart.
    extendedProperties: { private: { aos: '1' } },
  };
  if (input.attendees?.length) body.attendees = input.attendees.map((email) => ({ email }));
  if (input.reminderMinutes?.length) {
    body.reminders = { useDefault: false, overrides: input.reminderMinutes.map((m) => ({ method: 'popup', minutes: m })) };
  }
  if (input.withMeet) {
    // Google's Feb-2026 guidance: never reuse a Meet code across events —
    // request a fresh conference each time, and declare conferenceDataVersion.
    body.conferenceData = {
      createRequest: {
        requestId: `aos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  const created = await googleCall<Record<string, unknown>>(
    input.actorId, CALENDAR_API, `/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      body,
      query: {
        conferenceDataVersion: input.withMeet ? 1 : undefined,
        // Never mail anyone unless the owner explicitly invited them.
        sendUpdates: input.attendees?.length ? 'all' : 'none',
      },
      env,
    },
  );
  // Show it now. Mirroring is best-effort — a failure here must not turn a
  // successful write into a reported error.
  await mirrorWrittenEvent(input.actorId, calendarId, created).catch(() => undefined);
  return created;
}

export interface UpdateEventInput {
  actorId: string;
  calendarId: string;
  eventId: string;
  patch: Partial<Pick<CreateEventInput, 'summary' | 'description' | 'location' | 'start' | 'end' | 'timeZone'>>;
}

export async function updateEvent(input: UpdateEventInput, env: NodeJS.ProcessEnv = process.env) {
  const body: Record<string, unknown> = {};
  if (input.patch.summary !== undefined) body.summary = input.patch.summary;
  if (input.patch.description !== undefined) body.description = input.patch.description;
  if (input.patch.location !== undefined) body.location = input.patch.location;
  if (input.patch.start) body.start = timePart(input.patch.start, input.patch.timeZone);
  if (input.patch.end) body.end = timePart(input.patch.end, input.patch.timeZone);

  /* PATCH, not UPDATE: per the official error guide, a full update with no
   * shared properties is equivalent to resetting them to defaults, which fails
   * with forbiddenForNonOrganizer on events the owner does not organise. */
  const patched = await googleCall<Record<string, unknown>>(
    input.actorId, CALENDAR_API,
    `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
    { method: 'PATCH', body, query: { sendUpdates: 'none' }, env },
  );
  await mirrorWrittenEvent(input.actorId, input.calendarId, patched).catch(() => undefined);
  return patched;
}

export async function deleteEvent(
  actorId: string, calendarId: string, eventId: string, env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await googleCall<void>(
    actorId, CALENDAR_API,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', query: { sendUpdates: 'none' }, env },
  );
  await forgetMirroredEvent(actorId, calendarId, eventId).catch(() => undefined);
}

/* ------------------------------------------------------------------ tasks */

export interface CreateTaskInput {
  actorId: string;
  title: string;
  notes?: string;
  /** Date-only RFC3339; Google Tasks ignores the time component. */
  due?: string;
  taskListId?: string;
}

export async function createTask(input: CreateTaskInput, env: NodeJS.ProcessEnv = process.env) {
  const listId = input.taskListId ?? '@default';
  // Tasks has no extendedProperties, so provenance is a marker in the notes —
  // visible to the owner, which is the honest place for it.
  const notes = `${input.notes ?? ''}${input.notes ? '\n\n' : ''}[aos]`;
  const created = await googleCall<Record<string, unknown>>(
    input.actorId, TASKS_API, `/lists/${encodeURIComponent(listId)}/tasks`,
    {
      method: 'POST',
      body: {
        title: input.title,
        notes,
        ...(input.due ? { due: /^\d{4}-\d{2}-\d{2}$/.test(input.due) ? `${input.due}T00:00:00.000Z` : input.due } : {}),
      },
      env,
    },
  );
  await mirrorWrittenTask(input.actorId, listId, created).catch(() => undefined);
  return created;
}

export async function completeTask(
  actorId: string, taskId: string, taskListId = '@default', env: NodeJS.ProcessEnv = process.env,
) {
  const completed = await googleCall<Record<string, unknown>>(
    actorId, TASKS_API, `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: 'PATCH', body: { status: 'completed' }, env },
  );
  await mirrorWrittenTask(actorId, taskListId, completed).catch(() => undefined);
  return completed;
}
