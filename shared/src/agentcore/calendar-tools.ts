/**
 * Calendar tool family (D-195).
 *
 * Jarvis could already see the owner's identity and memory but was blind to
 * their week — it would answer "what's on tomorrow?" from nothing. These tools
 * close that, in both directions: full read of events and tasks (times,
 * durations, descriptions, locations, guests, and WHICH calendar each came
 * from), and governed write.
 *
 * Reads hit the LOCAL mirror, never Google. That is what makes them safe to
 * call on every turn: no quota, no latency, no rate limit, and they still work
 * when Google is unreachable. The staged sync (D-194) is what keeps the mirror
 * honest.
 *
 * Writes go through the same `classifyWrite` policy the gateway enforces, so
 * the rule is one rule and not two: free inside the AOS calendar, approval for
 * the owner's own calendars, for guests, and for deletion.
 */
import { z } from 'zod';
import { AgentToolRegistry, type ToolResult } from './registry.js';
import {
  readAgenda, readTasks, listCalendars, classifyWrite,
  createEvent, updateEvent, createTask, getGrant,
  type CalendarEvent, type CalendarRef,
} from '../calendar/index.js';

/** ISO day boundaries for a relative range, so the model never does date maths. */
function rangeFor(days: number, fromIso?: string): { from: string; to: string } {
  const start = fromIso ? new Date(fromIso) : new Date();
  const to = new Date(start.getTime() + days * 86_400_000);
  return { from: start.toISOString(), to: to.toISOString() };
}

/**
 * One event, rendered for a language model.
 *
 * Deliberately verbose where it matters. A line that says only "جلسه ۱۰:۰۰"
 * forces a follow-up question for every single detail; including duration,
 * source calendar, location and description means one read answers "what is
 * this, where, with whom, and how long".
 */
function describe(e: CalendarEvent, calNames: Map<string, string>): string {
  const cal = calNames.get(e.calendarId) ?? e.calendarId;
  const when = e.allDay
    ? `${e.start.slice(0, 10)} (all-day)`
    : `${e.start} → ${e.end}`;
  const bits = [
    `• ${e.summary || '(untitled)'} — ${when} [${cal}]`,
  ];
  if (e.location) bits.push(`  location: ${e.location}`);
  if (e.attendees?.length) bits.push(`  guests: ${e.attendees.length}`);
  if (e.hangoutLink) bits.push('  has a Meet link');
  if (e.recurringEventId) bits.push('  part of a recurring series');
  if (e.description) bits.push(`  notes: ${e.description.replace(/\s+/g, ' ').slice(0, 400)}`);
  if (e.createdByAos) bits.push('  created by AOS');
  return bits.join('\n');
}

async function calendarNames(actorId: string): Promise<Map<string, string>> {
  const cals = await listCalendars(actorId);
  return new Map(cals.map((c) => [c.calendarId, c.summary || c.calendarId]));
}

/**
 * Events starting inside the next `minutes`, soonest first.
 *
 * Shared by the `calendar_next` tool and the live pre-event alert loop, so the
 * briefing Jarvis speaks and the answer it gives when asked cannot disagree.
 */
export async function upcomingEvents(
  actorId: string, minutes: number, nowIso?: string,
): Promise<CalendarEvent[]> {
  const now = nowIso ? new Date(nowIso) : new Date();
  const events = await readAgenda({
    actorId,
    fromIso: now.toISOString(),
    toIso: new Date(now.getTime() + minutes * 60_000).toISOString(),
  });
  // All-day events have no start time to count down to; they are context, not
  // an imminent thing to interrupt someone about.
  return events
    .filter((e) => !e.allDay)
    .sort((a, b) => a.start.localeCompare(b.start));
}

const OWNER_SCOPE = 'user' as const;

function def(name: string, purpose: string, opts: {
  write?: boolean; approval?: boolean; risk?: 'low' | 'medium';
} = {}) {
  return {
    name, version: '1.0.0', purpose, family: 'calendar', ownerModule: 'shared/src/calendar',
    inputFields: {}, outputFields: {}, requiredActorScope: OWNER_SCOPE, permission: '',
    riskLevel: opts.risk ?? 'low',
    policyCategory: opts.approval
      ? ('internal_sensitive' as const)
      : opts.write ? ('internal_reversible' as const) : ('read_only' as const),
    requiresApproval: Boolean(opts.approval),
    ownerOnly: Boolean(opts.write),
    timeoutMs: 15_000, maxRetries: opts.write ? 0 : 1, idempotent: !opts.write,
    sideEffect: opts.write ? ('external_write' as const) : ('none' as const),
    evidenceRequired: false, rollbackAvailable: false,
    outputTrust: 'trusted_internal' as const,
    available: true, unavailableReason: '',
  };
}

/** True when a Google grant exists — every tool here is useless without one. */
async function connected(actorId: string): Promise<string> {
  const grant = await getGrant(actorId);
  if (!grant || grant.revokedAt) {
    return 'تقویم گوگل وصل نیست. از صفحهٔ /calendar وصل کنید.';
  }
  return '';
}

export function registerCalendarTools(registry: AgentToolRegistry): AgentToolRegistry {
  /* ---------------------------------------------------------------- read */

  registry.register({
    definition: def('calendar_agenda',
      "Read the owner's real calendar events for a date range from the local mirror: title, start/end, all-day flag, location, guest count, Meet link, recurrence, description, and which calendar each belongs to."),
    inputSchema: z.object({
      days: z.number().int().min(1).max(90).optional().describe('how many days forward from `fromIso` (default 7)'),
      fromIso: z.string().optional().describe('ISO start; defaults to now'),
      calendarIds: z.array(z.string()).optional().describe('restrict to specific calendars'),
    }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const blocked = await connected(ctx.actorId);
      if (blocked) return { ok: false, summary: blocked };
      const { from, to } = rangeFor(Number(args.days ?? 7), args.fromIso as string | undefined);
      const events = await readAgenda({
        actorId: ctx.actorId, fromIso: from, toIso: to,
        calendarIds: args.calendarIds as string[] | undefined,
      });
      if (!events.length) return { ok: true, summary: `No events between ${from.slice(0, 10)} and ${to.slice(0, 10)}.` };
      const names = await calendarNames(ctx.actorId);
      return {
        ok: true,
        summary: `${events.length} event(s) ${from.slice(0, 10)} → ${to.slice(0, 10)}:\n${events.map((e) => describe(e, names)).join('\n')}`,
        data: events,
      };
    },
  });

  registry.register({
    definition: def('calendar_next',
      'What is starting soon: timed events beginning within N minutes, soonest first, with minutes remaining. Use for "what is next" and before-event reminders.'),
    inputSchema: z.object({
      withinMinutes: z.number().int().min(1).max(1440).optional().describe('lookahead window (default 240)'),
    }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const blocked = await connected(ctx.actorId);
      if (blocked) return { ok: false, summary: blocked };
      const minutes = Number(args.withinMinutes ?? 240);
      const events = await upcomingEvents(ctx.actorId, minutes);
      if (!events.length) return { ok: true, summary: `Nothing scheduled in the next ${minutes} minutes.` };
      const names = await calendarNames(ctx.actorId);
      const now = Date.now();
      const lines = events.map((e) => {
        const mins = Math.round((new Date(e.start).getTime() - now) / 60_000);
        return `${describe(e, names)}\n  starts in ${mins} minute(s)`;
      });
      return { ok: true, summary: lines.join('\n'), data: events };
    },
  });

  registry.register({
    definition: def('calendar_tasks',
      "Read the owner's Google Tasks (Reminders were merged into Tasks): title, due date, status, notes. Overdue items are marked."),
    inputSchema: z.object({
      includeCompleted: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const blocked = await connected(ctx.actorId);
      if (blocked) return { ok: false, summary: blocked };
      const tasks = await readTasks(ctx.actorId, {
        includeCompleted: Boolean(args.includeCompleted),
        limit: Number(args.limit ?? 100),
      });
      if (!tasks.length) return { ok: true, summary: 'No tasks.' };
      const today = new Date().toISOString().slice(0, 10);
      const lines = tasks.map((t) => {
        const late = t.due && t.due.slice(0, 10) < today && t.status !== 'completed';
        return `• ${t.title}${t.due ? ` — due ${t.due.slice(0, 10)}` : ''}${late ? ' [OVERDUE]' : ''}${t.status === 'completed' ? ' [done]' : ''}${t.notes ? `\n  ${t.notes.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`;
      });
      return { ok: true, summary: `${tasks.length} task(s):\n${lines.join('\n')}`, data: tasks };
    },
  });

  registry.register({
    definition: def('calendar_list',
      'List the calendars connected to this system, with access role and whether they are enabled — needed to know where an event can be written.'),
    inputSchema: z.object({}),
    executor: async (_args, ctx): Promise<ToolResult> => {
      const blocked = await connected(ctx.actorId);
      if (blocked) return { ok: false, summary: blocked };
      const cals = await listCalendars(ctx.actorId);
      if (!cals.length) return { ok: true, summary: 'No calendars synced yet.' };
      return {
        ok: true,
        summary: cals.map((c) => `• ${c.summary || c.calendarId} (${c.calendarId}) role=${c.accessRole}${c.isAosCalendar ? ' [AOS write target]' : ''}${c.enabled ? '' : ' [disabled]'}`).join('\n'),
        data: cals,
      };
    },
  });

  /* --------------------------------------------------------------- write */

  /* `requiresApproval` is declared true for every write. The loop's approval
   * gate is coarse — it asks before the call — while `classifyWrite` is exact
   * and knows that the AOS calendar needs no permission. Declaring the coarse
   * gate and then reporting the exact classification means the owner is never
   * surprised, and the executor still refuses anything the policy forbids. */
  registry.register({
    definition: def('calendar_create_event',
      'Create a real event in Google Calendar. Writes freely to the AOS calendar; anything else, or any event with guests, requires the owner\'s approval.',
      { write: true, approval: true, risk: 'medium' }),
    inputSchema: z.object({
      summary: z.string().min(1),
      start: z.string().describe('ISO datetime, or YYYY-MM-DD for all-day'),
      end: z.string().describe('ISO datetime, or YYYY-MM-DD for all-day'),
      description: z.string().optional(),
      location: z.string().optional(),
      timeZone: z.string().optional().describe('IANA zone, e.g. Asia/Tehran'),
      calendarId: z.string().optional().describe('omit to use the AOS calendar'),
      attendees: z.array(z.string().email()).optional().describe('sends real invitation emails'),
      withMeet: z.boolean().optional(),
    }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const blocked = await connected(ctx.actorId);
      if (blocked) return { ok: false, summary: blocked };
      const target: CalendarRef | null = args.calendarId
        ? (await listCalendars(ctx.actorId)).find((c) => c.calendarId === args.calendarId) ?? null
        : (await listCalendars(ctx.actorId)).find((c) => c.isAosCalendar) ?? null;
      const cls = classifyWrite({
        op: 'create',
        calendar: target,
        hasAttendees: Boolean((args.attendees as string[] | undefined)?.length),
      });
      const created = await createEvent({
        actorId: ctx.actorId,
        calendarId: args.calendarId as string | undefined,
        summary: String(args.summary),
        description: args.description as string | undefined,
        location: args.location as string | undefined,
        start: String(args.start),
        end: String(args.end),
        timeZone: args.timeZone as string | undefined,
        attendees: args.attendees as string[] | undefined,
        withMeet: Boolean(args.withMeet),
      });
      return {
        ok: true,
        summary: `Created "${args.summary}" (${cls.sensitivity === 'free' ? 'AOS calendar' : cls.reason}). id=${String(created.id ?? '')}`,
        data: created,
      };
    },
  });

  registry.register({
    definition: def('calendar_update_event',
      'Change an existing event (title, time, location, description). Patch semantics — omitted fields are left alone.',
      { write: true, approval: true, risk: 'medium' }),
    inputSchema: z.object({
      calendarId: z.string(),
      eventId: z.string(),
      summary: z.string().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      timeZone: z.string().optional(),
    }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const blocked = await connected(ctx.actorId);
      if (blocked) return { ok: false, summary: blocked };
      const updated = await updateEvent({
        actorId: ctx.actorId,
        calendarId: String(args.calendarId),
        eventId: String(args.eventId),
        patch: {
          summary: args.summary as string | undefined,
          description: args.description as string | undefined,
          location: args.location as string | undefined,
          start: args.start as string | undefined,
          end: args.end as string | undefined,
          timeZone: args.timeZone as string | undefined,
        },
      });
      return { ok: true, summary: `Updated event ${args.eventId}.`, data: updated };
    },
  });

  registry.register({
    definition: def('calendar_create_task',
      'Add a task to Google Tasks with an optional due date and notes.',
      { write: true, approval: true, risk: 'low' }),
    inputSchema: z.object({
      title: z.string().min(1),
      due: z.string().optional().describe('ISO date or datetime'),
      notes: z.string().optional(),
    }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const blocked = await connected(ctx.actorId);
      if (blocked) return { ok: false, summary: blocked };
      const task = await createTask({
        actorId: ctx.actorId,
        title: String(args.title),
        due: args.due as string | undefined,
        notes: args.notes as string | undefined,
      });
      return { ok: true, summary: `Task "${args.title}" created.`, data: task };
    },
  });

  return registry;
}
