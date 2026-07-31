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
  createEvent, updateEvent, createTask, getGrant, ensureAosCalendar, findEvents,
  mirrorCoverage, readEventById, diagnoseRange, backfillRange, CALENDAR_ACTOR_ID,
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
  /* The ids are printed, not merely returned in `data` (D-201).
   *
   * Asked to move an event it had just found, Jarvis answered that it "was not
   * stored with an id that allows editing" — because the summary it had read
   * showed a title, a time and a calendar name, and `calendar_update_event`
   * needs `calendarId` + `eventId`. The tool could not be called with what the
   * previous tool had shown. Every read now carries the handle for the write. */
  const bits = [
    `• ${e.summary || '(untitled)'} — ${when} [${cal}]`,
    `  eventId: ${e.eventId}  calendarId: ${e.calendarId}   ← use these to update or move it`,
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

/**
 * Where the approval gate lives, and why it is not `requiresApproval` (D-195c).
 *
 * `requiresApproval: true` does two things: the loop pauses if the tool is
 * called, and the tool's description gains "(requires owner approval before it
 * runs)". The second one is what broke. Asked to add an event, the model read
 * that sentence, decided permission was needed, and answered "در حال ثبت
 * رویداد هستم؛ پس از ثبت اطلاع می‌دهم" — a promise, no call, no event, no
 * approval prompt either. The gate did not fire because nothing reached it.
 *
 * The deeper problem is that a static flag cannot express this policy at all.
 * Whether a calendar write needs approval depends on the TARGET chosen at call
 * time: the owner already decided that writes to the AOS calendar are free and
 * everything else is not. That is `classifyWrite`, and it can only run once
 * the arguments exist.
 *
 * So the tool is auto-allowed to *attempt*, and the executor is the real gate:
 * it runs `classifyWrite` and refuses anything sensitive unless the owner said
 * yes in this conversation (`confirm: true`). `sideEffect` stays
 * `external_write`, so safe mode still blocks every one of these, and
 * `ownerOnly` still keeps other actors out.
 */
function def(name: string, purpose: string, opts: {
  write?: boolean; risk?: 'low' | 'medium';
} = {}) {
  return {
    name, version: '1.0.0', purpose, family: 'calendar', ownerModule: 'shared/src/calendar',
    inputFields: {}, outputFields: {}, requiredActorScope: OWNER_SCOPE, permission: '',
    riskLevel: opts.risk ?? 'low',
    policyCategory: opts.write ? ('internal_reversible' as const) : ('read_only' as const),
    requiresApproval: false,
    ownerOnly: Boolean(opts.write),
    timeoutMs: 15_000, maxRetries: opts.write ? 0 : 1, idempotent: !opts.write,
    sideEffect: opts.write ? ('external_write' as const) : ('none' as const),
    evidenceRequired: false, rollbackAvailable: false,
    outputTrust: 'trusted_internal' as const,
    available: true, unavailableReason: '',
  };
}

/**
 * The refusal a sensitive write gets when the owner has not said yes yet.
 *
 * Phrased as an instruction to the model, not an error: it must ask the owner
 * the question in `reason` and call again with `confirm: true`. Anything
 * vaguer and the model reverts to promising.
 */
function needsConfirm(reason: string): ToolResult {
  return {
    ok: false,
    summary: `APPROVAL REQUIRED — ${reason}. Ask the owner this exact question in your reply, and if they agree, call this tool again with the SAME arguments plus confirm: true. Do NOT claim the event was created.`,
  };
}

/**
 * Resolve where an event should go (D-195d).
 *
 * Never returns null for the ordinary case, which is what made the old flow
 * unusable: with no AOS calendar created yet, the target resolved to nothing,
 * that became "تقویم مقصد شناسایی نشد", and the owner was asked to approve a
 * calendar the system had simply failed to look up.
 *
 * - `'primary'`, `'me'`, `'my'` or a name → the owner's own calendar. They
 *   asked for their calendar; give them their calendar.
 * - omitted → the AOS calendar, CREATED on demand. Lazily creating it here is
 *   what makes "just add it" work on a fresh install.
 */
async function resolveTarget(calendarId?: string): Promise<CalendarRef | null> {
  const all = await listCalendars(CALENDAR_ACTOR_ID);
  if (!calendarId) {
    return all.find((c) => c.isAosCalendar) ?? await ensureAosCalendar(CALENDAR_ACTOR_ID);
  }
  const key = calendarId.trim().toLowerCase();
  if (key === 'primary' || key === 'me' || key === 'my' || key === 'default') {
    return all.find((c) => c.primary) ?? all.find((c) => c.accessRole === 'owner') ?? null;
  }
  return all.find((c) => c.calendarId === calendarId)
    ?? all.find((c) => (c.summary || '').toLowerCase() === key)
    ?? null;
}

/** A hard stop, distinct from "ask the owner" — repeating the question is useless. */
function cannotWrite(reason: string): ToolResult {
  return { ok: false, summary: `CANNOT WRITE — ${reason}. Tell the owner this plainly; do not ask for approval, approval will not fix it.` };
}

/**
 * Gate every calendar tool: right caller, live grant.
 *
 * The owner check is not ceremony. Because the grant is keyed on a fixed
 * `CALENDAR_ACTOR_ID` rather than the caller, a tool that skipped this would
 * hand any actor in the loop the owner's entire schedule. The fixed key buys
 * correctness on one axis and must not cost it on the other.
 */
async function blockedReason(ctx: { isOwner: boolean }): Promise<string> {
  if (!ctx.isOwner) return 'تقویم فقط برای مالک سیستم در دسترس است.';
  const grant = await getGrant(CALENDAR_ACTOR_ID);
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
      const blocked = await blockedReason(ctx);
      if (blocked) return { ok: false, summary: blocked };
      const { from, to } = rangeFor(Number(args.days ?? 7), args.fromIso as string | undefined);
      const events = await readAgenda({
        actorId: CALENDAR_ACTOR_ID, fromIso: from, toIso: to,
        calendarIds: args.calendarIds as string[] | undefined,
      });
      if (!events.length) return { ok: true, summary: `No events between ${from.slice(0, 10)} and ${to.slice(0, 10)}.` };
      const names = await calendarNames(CALENDAR_ACTOR_ID);
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
      const blocked = await blockedReason(ctx);
      if (blocked) return { ok: false, summary: blocked };
      const minutes = Number(args.withinMinutes ?? 240);
      const events = await upcomingEvents(CALENDAR_ACTOR_ID, minutes);
      if (!events.length) return { ok: true, summary: `Nothing scheduled in the next ${minutes} minutes.` };
      const names = await calendarNames(CALENDAR_ACTOR_ID);
      const now = Date.now();
      const lines = events.map((e) => {
        const mins = Math.round((new Date(e.start).getTime() - now) / 60_000);
        return `${describe(e, names)}\n  starts in ${mins} minute(s)`;
      });
      return { ok: true, summary: lines.join('\n'), data: events };
    },
  });

  /**
   * Find an event by name, anywhere in the mirror (D-199b).
   *
   * Written because the owner asked "what happened to the event I told you to
   * add, and why can't I see it?" and neither of us could answer: reads were
   * scoped to a date range, so an event on the wrong day, in a calendar that
   * is switched off, or in a month outside the sync window was simply
   * invisible. A search that ignores all three answers the question directly —
   * including the useful negative, "it is not there".
   */
  registry.register({
    definition: def('calendar_find_event',
      'Search ALL mirrored events by title, ignoring date range and whether the calendar is enabled. Use when the owner asks where an event went or whether one was really created.'),
    inputSchema: z.object({
      q: z.string().min(1).describe('part of the title, case-insensitive'),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const blocked = await blockedReason(ctx);
      if (blocked) return { ok: false, summary: blocked };
      const found = await findEvents(CALENDAR_ACTOR_ID, String(args.q), Number(args.limit ?? 20));
      if (!found.length) {
        /* An empty result is ambiguous — never created, wrong calendar, or
         * outside the window — and the owner deserves the difference. */
        const cov = await mirrorCoverage(CALENDAR_ACTOR_ID);
        const cals = cov.perCalendar
          .map((c) => `${c.summary}${c.enabled ? '' : ' [OFF]'}=${c.events}`)
          .join(', ');
        return {
          ok: true,
          summary: `No mirrored event matches "${args.q}".\nMirror right now: ${cov.events} events, ${cov.earliest.slice(0, 10) || '—'} → ${cov.latest.slice(0, 10) || '—'}; per calendar: ${cals || 'none'}.\nTell the owner these numbers. If the date they are looking at is outside that span, or its calendar shows [OFF], THAT is the reason — not that the event is missing. Do not claim it does not exist.`,
        };
      }
      const names = await calendarNames(CALENDAR_ACTOR_ID);
      return {
        ok: true,
        summary: `${found.length} match(es):\n${found.map((e) => describe(e, names)).join('\n')}`,
        data: found,
      };
    },
  });

  /**
   * Why an event is not visible — answered with evidence (D-204).
   *
   * Every previous answer to this question was a guess: wrong calendar,
   * disabled calendar, outside the window, never created. Four plausible
   * stories and no way to tell them apart, so the owner got a different
   * theory each time. This asks Google directly for the range and diffs it
   * against the mirror, which leaves exactly one explanation standing.
   */
  registry.register({
    definition: def('calendar_diagnose',
      'Ask Google DIRECTLY what exists in a date range and compare it to the local mirror, per calendar. Use whenever the owner says they can see an event that you cannot. Reports what Google has, what is mirrored, and exactly which events are missing.'),
    inputSchema: z.object({
      from: z.string().describe('ISO date, e.g. 2026-07-20'),
      to: z.string().describe('ISO date, exclusive, e.g. 2026-07-21'),
      includeDisabled: z.boolean().optional()
        .describe('Only if the ACTIVE calendars explain nothing. Default false: a calendar the owner switched off is a decision, not a gap.'),
    }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const blocked = await blockedReason(ctx);
      if (blocked) return { ok: false, summary: blocked };

      const from = new Date(`${String(args.from).slice(0, 10)}T00:00:00.000Z`).toISOString();
      const to = new Date(`${String(args.to).slice(0, 10)}T00:00:00.000Z`).toISOString();
      const d = await diagnoseRange(CALENDAR_ACTOR_ID, from, to, {
        includeDisabled: args.includeDisabled === true,
      });

      const lines = d.calendars.map((c) => {
        const bits = [`• ${c.summary}: google=${c.google} mirrored=${c.mirrored}`];
        if (c.error) bits.push(`  error: ${c.error}`);
        for (const m of c.missing) bits.push(`  NOT MIRRORED: ${m}`);
        return bits.join('\n');
      });

      const anyMissing = d.calendars.some((c) => c.missing.length > 0);
      const verdict = anyMissing
        ? 'CAUSE: these events are in Google but were never mirrored — the incremental sync only re-fetches events whose timestamp moved, so a gap never heals itself. Call calendar_backfill for this range, then search again.'
        : d.calendars.every((c) => c.google === 0)
          ? 'CAUSE: Google has nothing in this range in the owner\'s ACTIVE calendars. Check the date with them.'
          : 'Your active calendars and Google agree for this range — nothing is missing.';

      /* One line, at the end, and only as a count (D-205). The owner turned
       * these off; listing their contents answers a question nobody asked and
       * buries the answer to the one they did. */
      const footnote = d.skippedDisabled > 0 && !args.includeDisabled
        ? `\n(${d.skippedDisabled} calendar(s) are switched off and were not checked — that is the owner's setting. Do NOT list them, do NOT report their events, and do NOT suggest enabling them unless the owner asks.)`
        : '';

      return {
        ok: true,
        summary: `Account: ${d.account || '(none)'}\nActive calendars only:\n${lines.join('\n')}\n${verdict}${footnote}`,
        data: d,
      };
    },
  });

  registry.register({
    definition: def('calendar_backfill',
      'Re-read a date range from Google into the local mirror, ignoring the incremental watermark. The repair for a gap that calendar_diagnose found.',
      { write: false }),
    inputSchema: z.object({
      from: z.string().describe('ISO date'),
      to: z.string().describe('ISO date, exclusive'),
    }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const blocked = await blockedReason(ctx);
      if (blocked) return { ok: false, summary: blocked };
      const from = new Date(`${String(args.from).slice(0, 10)}T00:00:00.000Z`).toISOString();
      const to = new Date(`${String(args.to).slice(0, 10)}T00:00:00.000Z`).toISOString();
      const res = await backfillRange(CALENDAR_ACTOR_ID, from, to);
      const total = res.reduce((n, r) => n + r.upserted, 0);
      const errs = res.filter((r) => r.error).map((r) => `${r.calendarId}: ${r.error}`);
      return {
        ok: errs.length === 0,
        summary: `Backfilled ${from.slice(0, 10)} → ${to.slice(0, 10)}: ${total} event(s) pulled in.${errs.length ? ` Errors: ${errs.join('; ')}` : ''} Now search again.`,
        data: res,
      };
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
      const blocked = await blockedReason(ctx);
      if (blocked) return { ok: false, summary: blocked };
      const tasks = await readTasks(CALENDAR_ACTOR_ID, {
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
      const blocked = await blockedReason(ctx);
      if (blocked) return { ok: false, summary: blocked };
      const cals = await listCalendars(CALENDAR_ACTOR_ID);
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
      { write: true, risk: 'medium' }),
    inputSchema: z.object({
      summary: z.string().min(1),
      start: z.string().describe('ISO datetime, or YYYY-MM-DD for all-day'),
      end: z.string().describe('ISO datetime, or YYYY-MM-DD for all-day'),
      description: z.string().optional(),
      location: z.string().optional(),
      timeZone: z.string().optional().describe('IANA zone, e.g. Asia/Tehran'),
      calendarId: z.string().optional().describe("'primary' for the owner's own calendar, a calendar id or name, or omit for the AOS calendar"),
      attendees: z.array(z.string().email()).optional().describe('sends real invitation emails'),
      withMeet: z.boolean().optional(),
      confirm: z.boolean().optional().describe('set true ONLY after the owner explicitly approved a write that needs approval'),
    }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const blocked = await blockedReason(ctx);
      if (blocked) return { ok: false, summary: blocked };
      const target = await resolveTarget(args.calendarId as string | undefined);
      const cls = classifyWrite({
        op: 'create',
        calendar: target,
        hasAttendees: Boolean((args.attendees as string[] | undefined)?.length),
      });
      if (cls.sensitivity === 'blocked') return cannotWrite(cls.reason);
      /* Only real consequences stop here: guests mean irreversible emails.
       * A plain event in the owner's own calendar is what they just asked
       * for — asking permission for it is friction, not governance. */
      if (cls.sensitivity === 'approval' && args.confirm !== true) return needsConfirm(cls.reason);

      let created: Record<string, unknown>;
      try {
        created = await createEvent({
        actorId: CALENDAR_ACTOR_ID,
        calendarId: target?.calendarId,
        summary: String(args.summary),
        description: args.description as string | undefined,
        location: args.location as string | undefined,
        start: String(args.start),
        end: String(args.end),
        timeZone: args.timeZone as string | undefined,
        attendees: args.attendees as string[] | undefined,
        withMeet: Boolean(args.withMeet),
        });
      } catch (err) {
        /* A thrown Google call used to escape the executor and reach the model
         * as an unlabelled failure, which it then narrated as success. Catch it
         * and say what happened, in words the reply can repeat. */
        return { ok: false, summary: `FAILED — رویداد ساخته نشد: ${err instanceof Error ? err.message : String(err)}. Tell the owner it did NOT happen and why.` };
      }

      /* Verification (D-196). The owner was told "با موفقیت ثبت شد" for an
       * event that did not exist. A write is not done because a call returned
       * — it is done when the thing is there. Google echoes the stored event,
       * so an id is proof; no id means no event, whatever the status code. */
      const eventId = String(created.id ?? '');
      if (!eventId) {
        return { ok: false, summary: 'FAILED — گوگل شناسه‌ای برنگرداند، پس رویداد ثبت نشده. Tell the owner it did NOT happen.' };
      }

      return {
        ok: true,
        summary: `DONE — "${args.summary}" ثبت شد در «${target?.summary || target?.calendarId}»، ${String(args.start)} → ${String(args.end)}. id=${eventId}${created.htmlLink ? ` link=${String(created.htmlLink)}` : ''}. Confirm to the owner and name the calendar.`,
        data: created,
      };
    },
  });

  registry.register({
    definition: def('calendar_update_event',
      'Move or change an existing event: title, start/end, location, description. This is how you reschedule — find the event first (calendar_find_event or calendar_agenda), take the eventId and calendarId it prints, and pass them here. Patch semantics: omitted fields are left alone.',
      { write: true, risk: 'medium' }),
    inputSchema: z.object({
      calendarId: z.string().describe("calendar id, a name, or 'primary'"),
      eventId: z.string(),
      summary: z.string().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      timeZone: z.string().optional(),
      confirm: z.boolean().optional().describe('set true ONLY after the owner explicitly approved a write that needs approval'),
    }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const blocked = await blockedReason(ctx);
      if (blocked) return { ok: false, summary: blocked };
      const target = await resolveTarget(args.calendarId as string | undefined);
      const cls = classifyWrite({ op: 'update', calendar: target });
      if (cls.sensitivity === 'blocked') return cannotWrite(cls.reason);
      if (cls.sensitivity === 'approval' && args.confirm !== true) return needsConfirm(cls.reason);

      /* Moving is not resizing (D-203).
       *
       * The owner extended an event to an hour, then said "move it past 16:00"
       * — and it came back as 16:00–16:30, half an hour shorter. The model had
       * sent a new `start` and guessed an `end`, because nothing stopped it
       * from guessing. Every calendar application in existence keeps the
       * duration when you drag an event; that is what "move" means, and it
       * belongs in the tool rather than in a model's arithmetic.
       *
       * So: `start` without `end` shifts the end by the same amount. An
       * explicit `end` still wins — resizing is a real operation, it just has
       * to be asked for. */
      let end = args.end as string | undefined;
      let preserved = '';
      if (args.start && !end) {
        const existing = await readEventById(CALENDAR_ACTOR_ID, String(args.eventId));
        if (existing?.start && existing?.end) {
          const durMs = new Date(existing.end).getTime() - new Date(existing.start).getTime();
          if (durMs > 0) {
            end = new Date(new Date(String(args.start)).getTime() + durMs).toISOString();
            preserved = ` Duration preserved: ${Math.round(durMs / 60_000)} minutes (a move keeps the length; say "make it N minutes" to resize).`;
          }
        }
      }

      let updated: Record<string, unknown>;
      try {
        updated = await updateEvent({
          actorId: CALENDAR_ACTOR_ID,
          /* D-207 — the write went to `args.calendarId` verbatim, the raw
           * argument the model supplied, while `target` (resolved two lines
           * above, from the same argument) is what `classifyWrite` had already
           * approved. The two only agree when the model happens to pass the
           * exact Google calendar id. A name, "primary", or any other alias
           * `resolveTarget` understands resolves correctly for the PERMISSION
           * check and then goes to Google unresolved — a PATCH to a calendar
           * path that does not exist, which fails in a way that never reaches
           * the owner as a failure. `target` is guaranteed non-null here: any
           * `calendar: null` case already returned via `cannotWrite` above. */
          calendarId: target!.calendarId,
          eventId: String(args.eventId),
          patch: {
            summary: args.summary as string | undefined,
            description: args.description as string | undefined,
            location: args.location as string | undefined,
            start: args.start as string | undefined,
            end,
            timeZone: args.timeZone as string | undefined,
          },
        });
      } catch (err) {
        /* Same discipline as calendar_create_event (D-196): a thrown Google
         * call must not let the model narrate a success it never confirmed. */
        return { ok: false, summary: `FAILED — رویداد ویرایش نشد: ${err instanceof Error ? err.message : String(err)}. Tell the owner it did NOT change and why.` };
      }

      /* Proof of write, not just an unthrown call (D-207, mirrors D-196's rule
       * for create): Google echoes the stored event back, id included. No id
       * means no confirmed change, whatever the status code said. */
      if (!updated.id) {
        return { ok: false, summary: 'FAILED — گوگل رویداد به‌روزشده را تأیید نکرد، پس تغییر ثبت نشد. Tell the owner it did NOT change.' };
      }

      return {
        ok: true,
        summary: `DONE — event ${args.eventId} updated.${preserved} Report the new start AND end to the owner so a wrong one is visible immediately.`,
        data: updated,
      };
    },
  });

  registry.register({
    definition: def('calendar_create_task',
      'Add a task to Google Tasks with an optional due date and notes.',
      { write: true, risk: 'low' }),
    inputSchema: z.object({
      title: z.string().min(1),
      due: z.string().optional().describe('ISO date or datetime'),
      notes: z.string().optional(),
    }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const blocked = await blockedReason(ctx);
      if (blocked) return { ok: false, summary: blocked };
      const task = await createTask({
        actorId: CALENDAR_ACTOR_ID,
        title: String(args.title),
        due: args.due as string | undefined,
        notes: args.notes as string | undefined,
      });
      return { ok: true, summary: `Task "${args.title}" created.`, data: task };
    },
  });

  return registry;
}
