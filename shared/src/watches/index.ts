/**
 * Proactive Watches + Owner Briefing v2 (K2, D-177; mandate §H + §7).
 *
 * Durable, dedup-aware watch definitions and firings, plus a briefing built
 * from REAL stored state (missions, memory, tasks, approvals) — not a generic
 * news digest. Proactive work may read/analyze/prepare, never silently
 * mutate; every firing links to a real watch and is deduped so the owner is
 * not re-alerted about the same unchanged issue.
 */
import { z } from 'zod';
import { collection } from '../db/index.js';
import { COLLECTIONS, EVENT_TYPES } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import { IsoDate } from '../schemas/common.js';
import { ScopeFieldsSchema } from '../schemas/scope.js';
import { sha256 } from '../research/providers.js';
import { assessMissionHealth, buildMissionContext, type MissionActor } from '../missions/index.js';

export const WatchKind = z.enum([
  'daily_briefing', 'mission_review', 'overdue_commitments', 'stale_goals',
  'research_topic', 'opportunity', 'risk', 'system_health', 'memory_consolidation', 'reflection',
]);
export type WatchKind = z.infer<typeof WatchKind>;

export const WatchSchema = z.object({
  watchId: z.string(),
  kind: WatchKind,
  title: z.string(),
  enabled: z.boolean().default(true),
  /** cron-ish cadence hint (executed by an external scheduler/queue). */
  cadence: z.string().default('daily'),
  config: z.record(z.string(), z.unknown()).default({}),
  lastFiredAt: z.string().nullable().default(null),
  lastDedupKey: z.string().default(''),
  createdAt: IsoDate,
  updatedAt: IsoDate,
}).merge(ScopeFieldsSchema);
export type Watch = z.infer<typeof WatchSchema>;

export const WatchFiringSchema = z.object({
  firingId: z.string(),
  watchId: z.string(),
  kind: WatchKind,
  headline: z.string(),
  detail: z.string().default(''),
  dedupKey: z.string(),
  linkedSessionId: z.string().nullable().default(null),
  actionable: z.boolean().default(true),
  createdAt: IsoDate,
}).merge(ScopeFieldsSchema);
export type WatchFiring = z.infer<typeof WatchFiringSchema>;

const watches = () => collection<Watch>(COLLECTIONS.WATCHES);
const firings = () => collection<WatchFiring>(COLLECTIONS.WATCH_FIRINGS);

export interface WatchActor { actorId: string; scope: 'global' | 'user'; tenantId?: string | null }
function scopeFilter(a: WatchActor): Record<string, unknown> {
  return a.scope === 'user' ? { scope: 'user', createdBy: a.actorId } : { scope: 'global' };
}
type Publish = (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => Promise<boolean> | boolean;

export async function createWatch(actor: WatchActor, args: { kind: WatchKind; title: string; cadence?: string; config?: Record<string, unknown> }): Promise<Watch> {
  const now = nowIso();
  const w = WatchSchema.parse({
    watchId: genId('watch'), kind: args.kind, title: args.title, cadence: args.cadence ?? 'daily', config: args.config ?? {},
    createdAt: now, updatedAt: now, scope: actor.scope, ...(actor.tenantId ? { tenantId: actor.tenantId } : {}),
    createdBy: actor.actorId, visibility: actor.scope === 'user' ? 'private' : 'public',
  });
  await watches().insertOne(w);
  return w;
}

export async function listWatches(actor: WatchActor): Promise<Watch[]> {
  return watches().find(scopeFilter(actor) as never, { projection: { _id: 0 } as never }).sort({ updatedAt: -1 }).toArray();
}

/** Record a firing only when its dedupKey differs from the watch's last —
 *  so the owner is never re-alerted about the same unchanged issue. */
export async function fireWatch(actor: WatchActor, watch: Watch, firing: { headline: string; detail?: string; dedupKey: string; actionable?: boolean }, publish?: Publish): Promise<WatchFiring | null> {
  if (watch.lastDedupKey === firing.dedupKey) return null; // unchanged — suppress
  const now = nowIso();
  const row = WatchFiringSchema.parse({
    firingId: genId('wfire'), watchId: watch.watchId, kind: watch.kind, headline: firing.headline, detail: firing.detail ?? '',
    dedupKey: firing.dedupKey, actionable: firing.actionable ?? true, createdAt: now,
    scope: actor.scope, ...(actor.tenantId ? { tenantId: actor.tenantId } : {}), createdBy: actor.actorId,
    visibility: actor.scope === 'user' ? 'private' : 'public',
  });
  await firings().insertOne(row);
  await watches().updateOne({ watchId: watch.watchId }, { $set: { lastFiredAt: now, lastDedupKey: firing.dedupKey, updatedAt: now } });
  await publish?.({ type: EVENT_TYPES.WATCH_FIRED, taskId: null, payload: { watchId: watch.watchId, kind: watch.kind, headline: firing.headline.slice(0, 200), message: `Watch fired: ${firing.headline.slice(0, 120)}` } });
  return row;
}

export async function listRecentFirings(actor: WatchActor, limit = 30): Promise<WatchFiring[]> {
  return firings().find(scopeFilter(actor) as never, { projection: { _id: 0 } as never }).sort({ createdAt: -1 }).limit(limit).toArray();
}

/* ------------------------------ briefing v2 ------------------------------ */

export interface OwnerBriefingInput {
  /** Real stored counts/lines — supplied by the gateway from scoped repos. */
  overdueTasks: string[];
  pendingApprovals: string[];
  openDecisions: string[];
  recentResearch: string[];
  selfDevProposals: string[];
}

export interface OwnerBriefing {
  generatedAt: string;
  headline: string;
  priorities: string[];
  overdue: string[];
  activeMissions: string[];
  decisionsNeeded: string[];
  risks: string[];
  opportunities: string[];
  recentResearch: string[];
  selfDevProposals: string[];
  language: 'fa' | 'en';
  /** True when EVERY section is empty — honestly "nothing to report" instead
   *  of manufacturing content. */
  empty: boolean;
}

/**
 * Build a briefing from real mission health + supplied real state. Pure
 * assembly (no fabrication): if there is nothing stored, the briefing says
 * so. The gateway can optionally pass this through the agent loop for
 * natural-language phrasing, but the STRUCTURE is grounded here.
 */
export async function buildOwnerBriefing(missionActor: MissionActor, input: OwnerBriefingInput, language: 'fa' | 'en' = 'fa'): Promise<OwnerBriefing> {
  const health = await assessMissionHealth(missionActor);
  const missionCtx = await buildMissionContext(missionActor, { limit: 8 });
  const priorities = missionCtx.lines.slice(0, 5);
  const overdue = [...input.overdueTasks, ...health.overdue.map((n) => `${n.title} (due ${n.dueAt?.slice(0, 10) ?? '?'})`)];
  const risks = health.blocked.map((n) => `Blocked: ${n.title}${n.blockedReason ? ` — ${n.blockedReason}` : ''}`);
  const decisionsNeeded = [...input.openDecisions, ...health.reviewDue.map((n) => `Review due: ${n.title}`)];
  const empty = !priorities.length && !overdue.length && !input.pendingApprovals.length && !decisionsNeeded.length && !risks.length && !input.recentResearch.length && !input.selfDevProposals.length;
  const headline = empty
    ? (language === 'fa' ? 'امروز موردی برای گزارش نیست — هیچ کار عقب‌افتاده، تصمیم باز یا مأموریت فعالی ثبت نشده.' : 'Nothing to report today — no overdue work, open decisions or active missions recorded.')
    : (language === 'fa' ? `اولویت‌های امروز شما (${priorities.length}) و ${overdue.length} مورد عقب‌افتاده.` : `Your ${priorities.length} priorities today, ${overdue.length} overdue.`);
  return {
    generatedAt: nowIso(), headline, priorities, overdue,
    activeMissions: missionCtx.lines, decisionsNeeded: [...decisionsNeeded, ...input.pendingApprovals.map((a) => `Approval pending: ${a}`)],
    risks, opportunities: [], recentResearch: input.recentResearch, selfDevProposals: input.selfDevProposals, language, empty,
  };
}

/** Stable dedup key for a mission-review/overdue briefing so re-running the
 *  same day with no change does not re-alert. */
export function briefingDedupKey(b: OwnerBriefing): string {
  return sha256(JSON.stringify({ p: b.priorities, o: b.overdue, d: b.decisionsNeeded, r: b.risks }));
}
