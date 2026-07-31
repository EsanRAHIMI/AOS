/**
 * Happenings — the owner-facing feed of everything the system actually did
 * (D-208).
 *
 * WHY THIS IS A PROJECTION AND NOT A NEW WRITE PATH
 * -------------------------------------------------
 * The obvious way to build a live "what is going on" feed is a new collection
 * that every subsystem writes to as it works. That design is wrong here for
 * one reason: it can drift. A feed written by a second code path will, sooner
 * or later, show a card for something the governed ledger never recorded — or
 * miss something it did. The owner would then be watching a story about the
 * system rather than the system.
 *
 * So a happening is a READ-SIDE PROJECTION of records the kernel already
 * writes under governance:
 *
 *   jarvis_session_turns        → what the owner said / what Jarvis answered
 *   tool_invocations            → every governed tool call, with its verdict
 *   agent_approval_checkpoints  → the ones that stopped and asked
 *   proactive_events            → what the heartbeat noticed unprompted
 *   loop_cycles                 → autonomous observe→reason→act cycles
 *
 * Nothing here writes. If a card exists, the underlying governed row exists;
 * if the row does not exist, no card can be invented. That is the whole point.
 *
 * PARENT LINKAGE (the owner's directive, 2026-07-31)
 * --------------------------------------------------
 * "Every happening gets a card, and a card that belongs under an earlier card
 * must, after a few seconds, move under its parent." The hierarchy is not
 * cosmetic — it already exists in the data:
 *
 *   turn ──┬── tool invocation      (invocation.runId → run.turnId)
 *          ├── tool invocation
 *          └── approval checkpoint  (checkpoint.runId → run.turnId)
 *
 *   loop cycle ── tool invocation   (invocations made by an autonomous cycle)
 *   proactive event                 (root — nobody asked for it)
 *
 * The projection resolves `runId → turnId` through `agent_loop_runs` in ONE
 * batched lookup, so a feed of 200 rows costs a constant number of queries.
 *
 * The UI consumes `parentId` directly: a child surfaces at the focus point,
 * dwells, then animates into its parent. See `HappeningLayer.tsx`.
 */
import { z } from 'zod';
import { actorScopedCollection, keyedScopedCollection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';
import { IsoDate } from '../schemas/common.js';

/* ========================================================================== *
 * Model
 * ========================================================================== */

/**
 * The owner's mental categories, not the kernel's module names.
 *
 * The board already groups SUBSYSTEMS by orbit (identity/value/execution/…).
 * This is the other axis: what a happening is ABOUT, in the words the owner
 * would use. `calendar` and `tasks` are separate here even though both are
 * "execution" on the board, because "my schedule changed" and "a task moved"
 * are different news to a human.
 */
export const HappeningCategory = z.enum([
  'calendar',   // تقویم و رویدادها
  'tasks',      // کارها و ماموریت‌ها
  'memory',     // یادداشت‌ها، تصمیم‌ها و افراد
  'personal',   // مالی، سلامت و یادگیری
  'knowledge',  // تحقیق و دانش
  'trust',      // هویت، اسناد و زنجیرهٔ اعتماد
  'system',     // سرویس‌ها، زیرساخت و خود سیستم
  'dialogue',   // گفت‌وگوی مستقیم با جارویس
]);
export type HappeningCategory = z.infer<typeof HappeningCategory>;

/** What kind of record this card projects. Drives the card's shape in the UI. */
export const HappeningKind = z.enum([
  'owner_said',     // the owner's own input — always a root card
  'jarvis_replied', // the answer that closed a turn
  'tool_ran',       // a governed tool executed
  'tool_blocked',   // policy denied it, or it failed
  'approval',       // it stopped and asked
  'noticed',        // the heartbeat found something unprompted
  'loop_cycle',     // an autonomous observe→reason→act cycle
]);
export type HappeningKind = z.infer<typeof HappeningKind>;

/** Honest outcome. `waiting` is not a failure — it is the governance working. */
export const HappeningStatus = z.enum(['ok', 'failed', 'waiting', 'denied', 'running']);
export type HappeningStatus = z.infer<typeof HappeningStatus>;

export const HappeningSchema = z.object({
  /** Stable and derived from the source row id — the same happening always
   *  has the same id, so a reconnecting client can dedupe without a cursor. */
  happeningId: z.string(),
  /** The card this one docks under, or null for a root card. */
  parentId: z.string().nullable().default(null),
  kind: HappeningKind,
  category: HappeningCategory,
  status: HappeningStatus,
  /** Who caused it — the owner, Jarvis reasoning, or the system on its own. */
  actor: z.enum(['owner', 'jarvis', 'system']),
  /** One short line, already in the owner's language where the source has it. */
  title: z.string(),
  /** One more line of grounding. Never prose the source did not contain. */
  detail: z.string().default(''),
  /** 0..1 — how much this deserves the owner's eye. Drives dwell + emphasis. */
  weight: z.number().min(0).max(1).default(0.4),
  /** Real record ids behind the card, for drill-down and audit. */
  refIds: z.array(z.string()).default([]),
  /** Deep link into the classic dashboard page that owns this record. */
  href: z.string().nullable().default(null),
  at: IsoDate,
});
export type Happening = z.infer<typeof HappeningSchema>;

export interface HappeningActor {
  actorId: string;
  tenantId?: string | null;
}

/* ========================================================================== *
 * Category + language mapping
 * ========================================================================== */

/**
 * Tool name → owner category.
 *
 * Prefix-matched, longest first, so `calendar_update_event` and a future
 * `calendar_x` both land on `calendar` without a table entry each. An unknown
 * tool falls to `system` rather than being dropped: a card the owner does not
 * recognise is a bug worth seeing, a silently missing card is not.
 */
const TOOL_PREFIX_CATEGORY: ReadonlyArray<readonly [string, HappeningCategory]> = [
  ['calendar_', 'calendar'],
  ['mission_', 'tasks'],
  ['task_', 'tasks'],
  ['memory_', 'memory'],
  ['session_pin', 'memory'],
  ['personal_', 'personal'],
  ['owner_preferences_', 'personal'],
  ['research_', 'knowledge'],
  ['cin_', 'trust'],
  ['system_', 'system'],
];

export function categoryForTool(toolName: string): HappeningCategory {
  for (const [prefix, category] of TOOL_PREFIX_CATEGORY) {
    if (toolName.startsWith(prefix)) return category;
  }
  return 'system';
}

/** Proactive-event kind → owner category. */
const PROACTIVE_CATEGORY: Record<string, HappeningCategory> = {
  mission_overdue: 'tasks',
  mission_stalled: 'tasks',
  mission_blocked: 'tasks',
  mission_review_due: 'tasks',
  watch_alert: 'knowledge',
  trust_chain_broken: 'trust',
  document_expiring: 'trust',
  document_expired: 'trust',
  system_notice: 'system',
};

/**
 * Persian labels for the verbs the owner sees most.
 *
 * Only the read/write ACTION is translated, never the record's own content —
 * event titles, mission names and memory text pass through untouched. A
 * translation table that also rewrote content would be a second source of
 * truth for what the system did, which is exactly what this module refuses to
 * be. Unknown tools show their raw name; that is honest and greppable.
 */
const TOOL_LABEL_FA: Record<string, string> = {
  calendar_agenda: 'خواندن برنامهٔ تقویم',
  calendar_next: 'بررسی رویداد بعدی',
  calendar_find_event: 'جست‌وجوی رویداد',
  calendar_create_event: 'ساخت رویداد',
  calendar_update_event: 'تغییر رویداد',
  calendar_delete_event: 'حذف رویداد',
  calendar_list_calendars: 'فهرست تقویم‌ها',
  memory_search: 'جست‌وجوی حافظه',
  memory_record: 'ثبت در حافظه',
  memory_correct: 'اصلاح حافظه',
  memory_delete: 'حذف از حافظه',
  memory_pin: 'سنجاق حافظه',
  mission_create: 'ساخت ماموریت',
  mission_update: 'به‌روزرسانی ماموریت',
  mission_list: 'مرور ماموریت‌ها',
  mission_tree: 'مرور درخت ماموریت',
  mission_health: 'سلامت ماموریت‌ها',
  research_web_search: 'جست‌وجوی وب',
  research_fetch_url: 'خواندن یک صفحه',
  research_fetch_feed: 'خواندن فید خبری',
  personal_state: 'خواندن وضعیت شخصی',
  personal_snapshot: 'خواندن وضعیت شخصی',
  owner_preferences_read: 'خواندن ترجیحات',
  owner_preferences_update: 'به‌روزرسانی ترجیحات',
  session_pin_fact: 'سنجاق یک نکته',
  system_service_health: 'بررسی سلامت سرویس‌ها',
  task_create: 'ساخت کار',
};

export function labelForTool(toolName: string): string {
  return TOOL_LABEL_FA[toolName] ?? toolName;
}

/** Category → the dashboard page that owns those records. */
const CATEGORY_HREF: Record<HappeningCategory, string | null> = {
  calendar: '/calendar',
  tasks: '/tasks',
  memory: '/memory',
  personal: '/me',
  knowledge: '/research',
  trust: '/cin',
  system: '/services',
  dialogue: '/jarvis',
};

/* ========================================================================== *
 * Projection
 * ========================================================================== */

/** Newest-first, capped. 200 is the ceiling for one page of live history. */
const MAX_LIMIT = 200;

function clampLimit(limit: number | undefined): number {
  const n = Number.isFinite(limit) ? Number(limit) : 60;
  return Math.max(1, Math.min(n, MAX_LIMIT));
}

/** Truncate for a card line without cutting mid-word where avoidable. */
function line(text: string, max = 160): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

type TurnRow = {
  turnId: string; sessionId: string; userText?: string; replyText?: string;
  status?: string; runId?: string | null; createdAt: string; finishedAt?: string | null;
  reasoningMode?: string; toolFacts?: string[];
};
type InvocationRow = {
  invocationId: string; runId: string; toolName: string; status: string;
  policyDecision: string; resultSummary?: string; createdAt: string; actorId: string;
};
type ApprovalRow = {
  approvalId: string; runId: string; toolName: string; summary?: string;
  status: string; riskLevel?: string; createdAt: string;
};
type RunRow = { runId: string; turnId?: string | null; sessionId?: string | null };
type ProactiveRow = {
  eventId: string; kind: string; priority?: string; title: string; detail?: string;
  refIds?: string[]; status?: string; createdAt: string;
};
type CycleRow = {
  cycleId: string; status?: string; triggerSummary?: string;
  decision?: { rationale?: string } | null;
  outcome?: { summary?: string } | null;
  createdAt: string;
};

/**
 * Owner-scoped filter.
 *
 * Every projected collection carries `actorId` (invocations, proactive events)
 * or is reachable only through an owner-scoped session. Filtering on
 * `actorId` where the field exists is the only isolation this module needs —
 * it never widens a query to "all rows", which is how a feed leaks.
 */
function actorFilter(actor: HappeningActor, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { actorId: actor.actorId, ...extra };
}

/**
 * Incremental cursor — deliberately INCLUSIVE (`$gte`).
 *
 * A turn and the first tool call it makes are routinely written in the same
 * millisecond. With an exclusive `$gt` cursor, whichever one sorted first
 * would advance the cursor past the other and the second card would never be
 * delivered — a missing card that no error reports. Re-delivering the
 * boundary row is the cheap failure; callers dedupe on `happeningId`, which
 * is stable precisely so they can.
 */
function afterFilter(afterIso: string | undefined, field = 'createdAt'): Record<string, unknown> {
  return afterIso ? { [field]: { $gte: afterIso } } : {};
}

/**
 * Build the feed.
 *
 * `afterIso` makes this incremental: the SSE fan-out passes its cursor and
 * gets only what is new, at the same cost as the first page. Callers that
 * want history pass `limit` alone.
 */
export async function listHappenings(
  actor: HappeningActor,
  opts: { afterIso?: string; limit?: number; categories?: HappeningCategory[] } = {},
): Promise<Happening[]> {
  const limit = clampLimit(opts.limit);
  const { afterIso } = opts;

  const [turns, invocations, approvals, proactive, cycles] = await Promise.all([
    keyedScopedCollection<TurnRow>(COLLECTIONS.JARVIS_SESSION_TURNS, 'createdBy', actor.actorId)
      .find({ ...afterFilter(afterIso) }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 }).limit(limit).toArray().catch(() => [] as TurnRow[]),
    actorScopedCollection<InvocationRow>(COLLECTIONS.TOOL_INVOCATIONS, actor.actorId)
      .find({ ...afterFilter(afterIso) }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 }).limit(limit).toArray().catch(() => [] as InvocationRow[]),
    keyedScopedCollection<ApprovalRow>(COLLECTIONS.AGENT_APPROVAL_CHECKPOINTS, 'createdBy', actor.actorId)
      .find({ ...afterFilter(afterIso) }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 }).limit(limit).toArray().catch(() => [] as ApprovalRow[]),
    actorScopedCollection<ProactiveRow>(COLLECTIONS.PROACTIVE_EVENTS, actor.actorId)
      .find(afterFilter(afterIso), { projection: { _id: 0 } })
      .sort({ createdAt: -1 }).limit(limit).toArray().catch(() => [] as ProactiveRow[]),
    actorScopedCollection<CycleRow>(COLLECTIONS.LOOP_CYCLES, actor.actorId)
      .find(afterFilter(afterIso), { projection: { _id: 0 } })
      .sort({ createdAt: -1 }).limit(Math.min(limit, 40)).toArray().catch(() => [] as CycleRow[]),
  ]);

  /* runId → turnId, in ONE lookup for the whole page. Without this a 200-row
   * feed would issue 200 queries just to learn which card is the parent. */
  const runIds = Array.from(new Set([
    ...invocations.map((i) => i.runId),
    ...approvals.map((a) => a.runId),
  ].filter(Boolean)));
  const runs = runIds.length
    ? await keyedScopedCollection<RunRow>(COLLECTIONS.AGENT_LOOP_RUNS, 'createdBy', actor.actorId)
      .find({ runId: { $in: runIds } }, { projection: { _id: 0, runId: 1, turnId: 1, sessionId: 1 } })
      .toArray().catch(() => [] as RunRow[])
    : [];
  const turnOfRun = new Map(runs.map((r) => [r.runId, r.turnId ?? null]));

  const out: Happening[] = [];

  /* ------------------------------- dialogue ------------------------------- */
  for (const t of turns) {
    const said = line(t.userText ?? '');
    if (said) {
      out.push(HappeningSchema.parse({
        happeningId: `hp_said_${t.turnId}`,
        parentId: null,
        kind: 'owner_said',
        category: 'dialogue',
        status: 'ok',
        actor: 'owner',
        title: said,
        detail: '',
        // The owner's own words always deserve the eye — they anchor the tree.
        weight: 0.9,
        refIds: [t.turnId, t.sessionId],
        href: '/jarvis',
        at: t.createdAt,
      }));
    }
    const replied = line(t.replyText ?? '');
    const running = t.status === 'running' || t.status === 'waiting_approval';
    if (replied || t.status === 'failed') {
      out.push(HappeningSchema.parse({
        happeningId: `hp_reply_${t.turnId}`,
        // Docks under what the owner asked — the reply is part of that card.
        parentId: `hp_said_${t.turnId}`,
        kind: 'jarvis_replied',
        category: 'dialogue',
        status: t.status === 'failed' ? 'failed' : running ? 'running' : 'ok',
        actor: 'jarvis',
        title: replied || 'پاسخ کامل نشد',
        // `reasoningMode:'none'` is degraded mode; saying so on the card is the
        // honesty rule — the owner must never mistake a composed answer for
        // a reasoned one.
        detail: t.reasoningMode === 'none' ? 'حالت محدود — بدون مدل واقعی' : '',
        weight: 0.7,
        refIds: [t.turnId],
        href: '/jarvis',
        at: t.finishedAt ?? t.createdAt,
      }));
    }
  }

  /* ------------------------------ tool calls ------------------------------ */
  for (const inv of invocations) {
    const turnId = turnOfRun.get(inv.runId) ?? null;
    const denied = inv.policyDecision.startsWith('denied');
    const failed = inv.status === 'failed' || inv.status === 'timed_out';
    const status: HappeningStatus = denied ? 'denied'
      : failed ? 'failed'
        : inv.status === 'awaiting_approval' ? 'waiting'
          : 'ok';
    out.push(HappeningSchema.parse({
      happeningId: `hp_tool_${inv.invocationId}`,
      // A tool call belongs to the turn that asked for it. With no turn it is
      // an autonomous action and stands as a root card — which is exactly the
      // thing the owner most wants to notice.
      parentId: turnId ? `hp_said_${turnId}` : null,
      kind: denied || failed ? 'tool_blocked' : 'tool_ran',
      category: categoryForTool(inv.toolName),
      status,
      actor: turnId ? 'jarvis' : 'system',
      title: labelForTool(inv.toolName),
      detail: line(inv.resultSummary ?? '', 200),
      // Writes and refusals outrank reads: a read is noise once seen, a write
      // changed the owner's world.
      weight: denied || failed ? 0.85 : status === 'waiting' ? 0.9 : 0.35,
      refIds: [inv.invocationId, inv.runId],
      href: CATEGORY_HREF[categoryForTool(inv.toolName)],
      at: inv.createdAt,
    }));
  }

  /* ------------------------------- approvals ------------------------------ */
  for (const a of approvals) {
    const turnId = turnOfRun.get(a.runId) ?? null;
    const status: HappeningStatus = a.status === 'pending' ? 'waiting'
      : a.status === 'approved' ? 'ok'
        : 'denied';
    out.push(HappeningSchema.parse({
      happeningId: `hp_appr_${a.approvalId}`,
      parentId: turnId ? `hp_said_${turnId}` : null,
      kind: 'approval',
      category: categoryForTool(a.toolName),
      status,
      actor: 'jarvis',
      title: `اجازه می‌خواهد: ${labelForTool(a.toolName)}`,
      detail: line(a.summary ?? '', 200),
      // A pending approval is the one card that must never be missed: the
      // system is stopped, waiting on a human.
      weight: a.status === 'pending' ? 1 : 0.5,
      refIds: [a.approvalId, a.runId],
      href: '/approvals',
      at: a.createdAt,
    }));
  }

  /* --------------------------- proactive notices -------------------------- */
  for (const e of proactive) {
    out.push(HappeningSchema.parse({
      happeningId: `hp_pro_${e.eventId}`,
      parentId: null,
      kind: 'noticed',
      category: PROACTIVE_CATEGORY[e.kind] ?? 'system',
      status: e.priority === 'critical' ? 'failed' : 'ok',
      actor: 'system',
      title: e.title,
      detail: line(e.detail ?? '', 200),
      weight: e.priority === 'critical' ? 0.95 : e.priority === 'attention' ? 0.75 : 0.4,
      refIds: [e.eventId, ...(e.refIds ?? [])],
      href: CATEGORY_HREF[PROACTIVE_CATEGORY[e.kind] ?? 'system'],
      at: e.createdAt,
    }));
  }

  /* ---------------------------- autonomous loop --------------------------- */
  for (const c of cycles) {
    if (!c.cycleId || !c.createdAt) continue;
    out.push(HappeningSchema.parse({
      happeningId: `hp_cyc_${c.cycleId}`,
      parentId: null,
      kind: 'loop_cycle',
      category: 'system',
      status: c.status === 'failed' ? 'failed' : c.status === 'running' ? 'running' : 'ok',
      actor: 'system',
      title: `چرخهٔ خودکار${c.triggerSummary ? ` — ${line(c.triggerSummary, 60)}` : ''}`,
      // The rationale is why it acted unprompted — the single most important
      // sentence on an autonomous card. Outcome is the fallback once done.
      detail: line(c.decision?.rationale ?? c.outcome?.summary ?? '', 200),
      weight: 0.5,
      refIds: [c.cycleId],
      href: '/loop',
      at: c.createdAt,
    }));
  }

  const filtered = opts.categories?.length
    ? out.filter((h) => opts.categories!.includes(h.category))
    : out;

  /* Newest first, and STABLE: two rows written in the same millisecond must
   * not swap order between two reads, or the client's dedupe cursor would
   * skip one.
   *
   * The tiebreak is two-level and both levels earn their place:
   *   1. A ROOT sorts ahead of a child at the same instant. A turn and its
   *      first tool call routinely share a millisecond, and the parent card
   *      must exist before the child looks for something to dock into —
   *      otherwise the child is briefly promoted to a root and then jumps.
   *   2. `happeningId` last, because it is unique and fixed, so the order is
   *      fully determined rather than left to the sort's stability.
   */
  filtered.sort((a, b) => (
    b.at.localeCompare(a.at)
    || (a.parentId === null ? 0 : 1) - (b.parentId === null ? 0 : 1)
    || b.happeningId.localeCompare(a.happeningId)
  ));
  return filtered.slice(0, limit);
}

/**
 * Group a flat feed into parent → children, preserving order.
 *
 * The client could do this itself, but then the rule would live in two places
 * and drift. An orphan child (its parent fell off the end of the page) is
 * promoted to a root rather than dropped — losing a card because its parent
 * scrolled out of history would be a lie of omission.
 */
export function groupHappenings(
  items: Happening[],
): Array<{ root: Happening; children: Happening[] }> {
  const byId = new Map(items.map((h) => [h.happeningId, h]));
  const children = new Map<string, Happening[]>();
  const roots: Happening[] = [];

  for (const h of items) {
    if (h.parentId && byId.has(h.parentId)) {
      const list = children.get(h.parentId) ?? [];
      list.push(h);
      children.set(h.parentId, list);
    } else {
      roots.push(h);
    }
  }

  return roots.map((root) => ({
    root,
    // Children read oldest → newest: inside one turn, the order the work
    // actually happened is the useful order.
    children: (children.get(root.happeningId) ?? []).slice().reverse(),
  }));
}

/** Category → Persian label, for the stage's filter chips. */
export const CATEGORY_LABEL_FA: Record<HappeningCategory, string> = {
  calendar: 'تقویم',
  tasks: 'کارها و ماموریت‌ها',
  memory: 'حافظه و تصمیم‌ها',
  personal: 'شخصی',
  knowledge: 'دانش و تحقیق',
  trust: 'اعتماد و اسناد',
  system: 'سیستم',
  dialogue: 'گفت‌وگو',
};
