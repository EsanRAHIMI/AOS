/**
 * Jarvis Heartbeat — the pulse that takes Jarvis out of chatbot mode
 * (CIN-2 first slice, D-180).
 *
 * A deterministic background pulse that runs BETWEEN conversations: it
 * reviews real state (mission health, watch firings, trust-chain integrity)
 * and turns findings into durable PROACTIVE EVENTS the owner sees live on
 * the persistent owner stream — Jarvis acts without being spoken to.
 *
 * Design rules (kernel ethos):
 * - Deterministic core, no LLM required: every event is grounded in a real
 *   record (missionId, firingId, chain report). Model-driven proactive
 *   reasoning plugs in LATER as an escalation, never as the foundation.
 * - Dedup by construction: (kind + dedupKey) is unique per OPEN event, so
 *   repeated pulses never spam the owner with duplicates.
 * - Multi-instance safe: Mongo is the truth; the stream layer polls/broadcasts.
 */
import { z } from 'zod';
import { collection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import { assessMissionHealth, type MissionActor } from '../missions/index.js';
import { listRecentFirings } from '../watches/index.js';
import { verifyChain } from '../cin/ledger.js';

export const ProactiveEventKind = z.enum([
  'mission_overdue', 'mission_stalled', 'mission_blocked', 'mission_review_due',
  'watch_alert', 'trust_chain_broken', 'system_notice',
]);
export type ProactiveEventKind = z.infer<typeof ProactiveEventKind>;

export const ProactiveEventStatus = z.enum(['new', 'seen', 'acked', 'dismissed']);

export const ProactiveEventSchema = z.object({
  eventId: z.string(),
  kind: ProactiveEventKind,
  priority: z.enum(['info', 'attention', 'critical']).default('attention'),
  title: z.string().min(1),
  detail: z.string().default(''),
  /** Grounding — the real records this event is about. Never empty prose. */
  refIds: z.array(z.string()).default([]),
  /** Uniqueness key while the event is open (new/seen). */
  dedupKey: z.string(),
  status: ProactiveEventStatus.default('new'),
  actorId: z.string(),
  tenantId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProactiveEvent = z.infer<typeof ProactiveEventSchema>;

export const HeartbeatRunSchema = z.object({
  heartbeatId: z.string(),
  actorId: z.string(),
  at: z.string(),
  durationMs: z.number().int().nonnegative(),
  checks: z.array(z.string()),
  created: z.number().int().nonnegative(),
  deduped: z.number().int().nonnegative(),
  notes: z.string().default(''),
});
export type HeartbeatRun = z.infer<typeof HeartbeatRunSchema>;

const eventsCol = () => collection<ProactiveEvent>(COLLECTIONS.PROACTIVE_EVENTS);
const runsCol = () => collection<HeartbeatRun>(COLLECTIONS.HEARTBEAT_RUNS);

export interface HeartbeatActor { actorId: string; scope: 'global' | 'user'; tenantId?: string | null }

type Publish = (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => Promise<boolean> | boolean;

interface Candidate {
  kind: ProactiveEventKind;
  priority: 'info' | 'attention' | 'critical';
  title: string;
  detail: string;
  refIds: string[];
  dedupKey: string;
}

/** Insert candidates that don't already exist as OPEN events. Returns created records. */
async function upsertCandidates(actor: HeartbeatActor, candidates: Candidate[], publish?: Publish): Promise<{ created: ProactiveEvent[]; deduped: number }> {
  const created: ProactiveEvent[] = [];
  let deduped = 0;
  for (const c of candidates) {
    const open = await eventsCol().findOne({ actorId: actor.actorId, kind: c.kind, dedupKey: c.dedupKey, status: { $in: ['new', 'seen'] } });
    if (open) { deduped += 1; continue; }
    const now = nowIso();
    const event: ProactiveEvent = ProactiveEventSchema.parse({
      eventId: genId('pev'), kind: c.kind, priority: c.priority, title: c.title, detail: c.detail,
      refIds: c.refIds, dedupKey: c.dedupKey, status: 'new',
      actorId: actor.actorId, tenantId: actor.tenantId ?? null, createdAt: now, updatedAt: now,
    });
    await eventsCol().insertOne(event as never);
    created.push(event);
    if (publish) await publish({ type: 'jarvis.proactive', taskId: null, payload: { eventId: event.eventId, kind: event.kind, priority: event.priority, title: event.title } });
  }
  return { created, deduped };
}

export interface HeartbeatResult {
  run: HeartbeatRun;
  created: ProactiveEvent[];
}

/**
 * One heartbeat pulse. Cheap by design (a few indexed queries + optional
 * chain verify); safe to run every few minutes via BullMQ repeatable job or
 * an in-process interval.
 */
export async function runHeartbeatOnce(
  actor: HeartbeatActor,
  opts: { verifyTrustChain?: boolean; stalledAfterDays?: number; publish?: Publish } = {},
): Promise<HeartbeatResult> {
  const started = Date.now();
  const checks: string[] = [];
  const candidates: Candidate[] = [];

  // 1) Mission health — overdue / stalled / blocked / review-due, grounded in nodeIds.
  const missionActor: MissionActor = { actorId: actor.actorId, scope: actor.scope === 'global' ? 'global' : 'user', tenantId: actor.tenantId ?? null };
  const health = await assessMissionHealth(missionActor, { stalledAfterDays: opts.stalledAfterDays });
  checks.push('missions');
  for (const n of health.overdue) candidates.push({ kind: 'mission_overdue', priority: n.priority === 'critical' ? 'critical' : 'attention', title: `Overdue: ${n.title}`, detail: `[${n.nodeType}] due ${n.dueAt?.slice(0, 10) ?? ''}`, refIds: [n.nodeId], dedupKey: n.nodeId });
  for (const n of health.stalled) candidates.push({ kind: 'mission_stalled', priority: 'attention', title: `Stalled: ${n.title}`, detail: `[${n.nodeType}] no movement since ${n.updatedAt.slice(0, 10)}`, refIds: [n.nodeId], dedupKey: n.nodeId });
  for (const n of health.blocked) candidates.push({ kind: 'mission_blocked', priority: 'attention', title: `Blocked: ${n.title}`, detail: `[${n.nodeType}]`, refIds: [n.nodeId], dedupKey: n.nodeId });
  for (const n of health.reviewDue) candidates.push({ kind: 'mission_review_due', priority: 'info', title: `Review due: ${n.title}`, detail: `[${n.nodeType}] next review was ${n.nextReviewAt?.slice(0, 10) ?? ''}`, refIds: [n.nodeId], dedupKey: `review:${n.nodeId}` });

  // 2) Actionable watch firings from the last day surface as alerts.
  const firings = await listRecentFirings({ actorId: actor.actorId, scope: actor.scope, tenantId: actor.tenantId ?? null }, 20);
  checks.push('watches');
  for (const f of firings.filter((f) => f.actionable)) {
    candidates.push({ kind: 'watch_alert', priority: 'attention', title: f.headline, detail: f.detail ?? '', refIds: [f.firingId], dedupKey: f.dedupKey });
  }

  // 3) Trust-chain integrity (CIN ledger) — a broken chain is a critical event.
  if (opts.verifyTrustChain !== false) {
    const chain = await verifyChain();
    checks.push('trust_chain');
    if (!chain.ok) {
      candidates.push({
        kind: 'trust_chain_broken', priority: 'critical',
        title: 'CIN trust chain verification FAILED',
        detail: `broken at seq ${chain.brokenAtSeq}: ${chain.reason}`,
        refIds: [], dedupKey: `chain:${chain.chainId}:${chain.brokenAtSeq}`,
      });
    }
  }

  const { created, deduped } = await upsertCandidates(actor, candidates, opts.publish);
  const run: HeartbeatRun = HeartbeatRunSchema.parse({
    heartbeatId: genId('hb'), actorId: actor.actorId, at: nowIso(),
    durationMs: Date.now() - started, checks, created: created.length, deduped, notes: '',
  });
  await runsCol().insertOne(run as never);
  return { run, created };
}

export async function listProactiveEvents(actor: HeartbeatActor, opts: { statuses?: Array<z.infer<typeof ProactiveEventStatus>>; limit?: number; afterIso?: string } = {}): Promise<ProactiveEvent[]> {
  const filter: Record<string, unknown> = { actorId: actor.actorId };
  filter.status = { $in: opts.statuses ?? ['new', 'seen'] };
  if (opts.afterIso) filter.createdAt = { $gt: opts.afterIso };
  const docs = await eventsCol().find(filter).sort({ createdAt: -1 }).limit(Math.min(opts.limit ?? 50, 200)).toArray();
  return docs.map((d) => ProactiveEventSchema.parse(d));
}

export async function setProactiveEventStatus(actor: HeartbeatActor, eventId: string, status: z.infer<typeof ProactiveEventStatus>): Promise<boolean> {
  const res = await eventsCol().updateOne({ eventId, actorId: actor.actorId }, { $set: { status, updatedAt: nowIso() } });
  return res.matchedCount > 0;
}

export async function lastHeartbeat(actor: HeartbeatActor): Promise<HeartbeatRun | null> {
  const docs = await runsCol().find({ actorId: actor.actorId }).sort({ at: -1 }).limit(1).toArray();
  return docs[0] ? HeartbeatRunSchema.parse(docs[0]) : null;
}
