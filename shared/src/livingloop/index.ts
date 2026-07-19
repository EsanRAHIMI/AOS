/**
 * Autonomous Living Loop (CIN-2b, D-181) — the durable observe→reason→act
 * cycle that makes Jarvis act with NO initial user message.
 *
 * Spec + acceptance gates: docs/cin-v2/living-loop.md. Design rules:
 * - ONE durable state machine per cycle (`loop_cycles`): every stage persists
 *   BEFORE the next starts, so restart = resume, never redo (gate G9).
 * - Idempotent intake (`loop_inbox`, unique eventKey — gate G4), attempts +
 *   DLQ (G6), replay (G5), per-cycle budgets (G7), approval pause with exact
 *   resume (G8), latency recorded on every event (G3).
 * - Deterministic core; the model enriches the reason stage through an
 *   injected hook with an honest `usedFallback` flag — a dead model NEVER
 *   stops the loop.
 */
import { z } from 'zod';
import { collection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import { assessMissionHealth, listMissionNodes, type MissionActor } from '../missions/index.js';
import { listProactiveEvents, type HeartbeatActor } from '../heartbeat/index.js';
import { canonicalJson, sha256Hex, appendLedger, listLedger } from '../cin/ledger.js';
import { recordMemory } from '../memory2/index.js';

/* ============================== schemas ================================ */

export const LoopInboxStatus = z.enum(['pending', 'processing', 'done', 'failed', 'dead']);

export const LoopInboxEventSchema = z.object({
  inboxId: z.string(),
  /** Idempotency key — unique per logical event (gate G4). */
  eventKey: z.string().min(1),
  source: z.string().default('unknown'),        // heartbeat | kernel_event | api | replay
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  actorId: z.string(),
  status: LoopInboxStatus.default('pending'),
  attempts: z.number().int().nonnegative().default(0),
  maxAttempts: z.number().int().positive().default(3),
  lastError: z.string().default(''),
  processedCycleId: z.string().nullable().default(null),
  replayOf: z.string().nullable().default(null),
  receivedAt: z.string(),
  completedAt: z.string().nullable().default(null),
  /** received → cycle completed (gate G3). */
  latencyMs: z.number().int().nullable().default(null),
});
export type LoopInboxEvent = z.infer<typeof LoopInboxEventSchema>;

export const OwnerStateSnapshotSchema = z.object({
  snapshotId: z.string(),
  actorId: z.string(),
  at: z.string(),
  state: z.record(z.string(), z.unknown()),
  hash: z.string(),
  changedKeys: z.array(z.string()).default([]),
});
export type OwnerStateSnapshot = z.infer<typeof OwnerStateSnapshotSchema>;

export const LoopStage = z.enum(['observe', 'snapshot', 'assess', 'reason', 'plan', 'execute', 'review', 'update', 'done']);
export type LoopStage = z.infer<typeof LoopStage>;

export const LoopCycleStatus = z.enum(['running', 'awaiting_approval', 'completed', 'failed']);

export const LoopPlanStepSchema = z.object({
  stepId: z.string(),
  title: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  riskLevel: z.enum(['low', 'medium', 'high']).default('low'),
  requiresApproval: z.boolean().default(false),
  status: z.enum(['pending', 'awaiting_approval', 'done', 'failed', 'rejected', 'skipped']).default('pending'),
  resultSummary: z.string().default(''),
});
export type LoopPlanStep = z.infer<typeof LoopPlanStepSchema>;

export const LoopCycleSchema = z.object({
  cycleId: z.string(),
  actorId: z.string(),
  tenantId: z.string().nullish(),
  triggerInboxId: z.string(),
  triggerSummary: z.string().default(''),
  status: LoopCycleStatus.default('running'),
  /** The durable checkpoint: the NEXT stage to run. Restart-safe by design. */
  nextStage: LoopStage.default('observe'),
  stages: z.array(z.object({
    stage: LoopStage,
    at: z.string(),
    durationMs: z.number().int().nonnegative(),
    ok: z.boolean(),
    summary: z.string(),
  })).default([]),
  snapshotId: z.string().nullable().default(null),
  significance: z.object({
    significant: z.boolean(),
    score: z.number().min(0).max(1),
    reasons: z.array(z.string()),
  }).nullable().default(null),
  decision: z.object({
    rationale: z.string(),
    priority: z.enum(['low', 'normal', 'high', 'critical']),
    usedModel: z.boolean(),
    usedFallback: z.boolean(),
  }).nullable().default(null),
  plan: z.array(LoopPlanStepSchema).default([]),
  pendingApprovalId: z.string().nullable().default(null),
  pendingStepId: z.string().nullable().default(null),
  budget: z.object({
    maxStageMs: z.number().int().positive().default(30000),
    maxModelCalls: z.number().int().nonnegative().default(2),
    usedModelCalls: z.number().int().nonnegative().default(0),
  }),
  stopReason: z.string().default(''),
  outcome: z.object({
    ok: z.boolean(),
    summary: z.string(),
    memoryIds: z.array(z.string()),
    ledgerSeq: z.number().int().nullable(),
  }).nullable().default(null),
  replayOf: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LoopCycle = z.infer<typeof LoopCycleSchema>;

const inboxCol = () => collection<LoopInboxEvent>(COLLECTIONS.LOOP_INBOX);
const cyclesCol = () => collection<LoopCycle>(COLLECTIONS.LOOP_CYCLES);
const snapshotsCol = () => collection<OwnerStateSnapshot>(COLLECTIONS.OWNER_STATE_SNAPSHOTS);

export interface LoopActor { actorId: string; tenantId?: string | null }

type Publish = (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => Promise<boolean> | boolean;

/** Injected by the hosting process (gateway). Everything optional — the
 *  deterministic core runs with none of them (honest degradation). */
export interface LoopDeps {
  publish?: Publish;
  /** Real-model reasoning hook. Return null on failure — the loop falls back. */
  reason?: (input: { triggerSummary: string; significanceReasons: string[]; snapshotState: Record<string, unknown> }) =>
    Promise<{ rationale: string; priority: 'low' | 'normal' | 'high' | 'critical' } | null>;
  /** Governed tool execution (gateway binds the agentcore registry). */
  executeTool?: (toolName: string, args: Record<string, unknown>, ctx: { actorId: string; cycleId: string }) =>
    Promise<{ ok: boolean; summary: string }>;
  /** Tool policy lookup (from the registry definitions). */
  toolPolicy?: (toolName: string) => { requiresApproval: boolean; riskLevel: 'low' | 'medium' | 'high' } | null;
  /** Create an approval record; returns approvalId. */
  requestApproval?: (cycle: LoopCycle, step: LoopPlanStep) => Promise<string>;
}

/* ============================== intake ================================= */

export async function ingestLoopEvent(
  actor: LoopActor,
  input: { eventKey: string; type: string; source?: string; payload?: Record<string, unknown>; replayOf?: string | null },
): Promise<{ event: LoopInboxEvent; duplicate: boolean }> {
  const existing = await inboxCol().findOne({ eventKey: input.eventKey, actorId: actor.actorId });
  if (existing) return { event: LoopInboxEventSchema.parse(existing), duplicate: true };
  const event: LoopInboxEvent = LoopInboxEventSchema.parse({
    inboxId: genId('lin'), eventKey: input.eventKey, source: input.source ?? 'api',
    type: input.type, payload: input.payload ?? {}, actorId: actor.actorId,
    replayOf: input.replayOf ?? null, receivedAt: nowIso(),
  });
  await inboxCol().insertOne(event as never);
  return { event, duplicate: false };
}

/** Replay (gate G5): clone as a NEW pending event, explicitly marked. */
export async function replayInboxEvent(actor: LoopActor, inboxId: string): Promise<LoopInboxEvent> {
  const doc = await inboxCol().findOne({ inboxId, actorId: actor.actorId });
  if (!doc) throw new Error(`inbox event ${inboxId} not found`);
  const src = LoopInboxEventSchema.parse(doc);
  const { event } = await ingestLoopEvent(actor, {
    eventKey: `${src.eventKey}:replay:${Date.now()}`, type: src.type,
    source: 'replay', payload: src.payload, replayOf: src.inboxId,
  });
  return event;
}

/** Requeue a dead-letter event (gate G6). */
export async function requeueDeadEvent(actor: LoopActor, inboxId: string): Promise<boolean> {
  const res = await inboxCol().updateOne(
    { inboxId, actorId: actor.actorId, status: 'dead' },
    { $set: { status: 'pending', attempts: 0, lastError: '' } },
  );
  return res.matchedCount > 0;
}

/* ============================ snapshotting ============================= */

export async function buildOwnerSnapshot(actor: LoopActor): Promise<OwnerStateSnapshot> {
  const missionActor: MissionActor = { actorId: actor.actorId, scope: 'user', tenantId: actor.tenantId ?? null };
  const hbActor: HeartbeatActor = { actorId: actor.actorId, scope: 'user', tenantId: actor.tenantId ?? null };
  const [health, activeNodes, openEvents, ledgerTail] = await Promise.all([
    assessMissionHealth(missionActor),
    listMissionNodes(missionActor, { statuses: ['active', 'blocked', 'stalled'], limit: 200 }),
    listProactiveEvents(hbActor, { limit: 100 }),
    listLedger({ limit: 1000 }),
  ]);
  const head = ledgerTail[ledgerTail.length - 1];
  const state: Record<string, unknown> = {
    missionsActive: activeNodes.length,
    missionsOverdue: health.overdue.map((n) => n.nodeId).sort(),
    missionsStalled: health.stalled.map((n) => n.nodeId).sort(),
    missionsBlocked: health.blocked.map((n) => n.nodeId).sort(),
    openProactive: openEvents.length,
    openCritical: openEvents.filter((e) => e.priority === 'critical').map((e) => e.eventId).sort(),
    ledgerSeq: head?.seq ?? -1,
    ledgerHead: head?.hash ?? 'empty',
  };
  const hash = sha256Hex(canonicalJson(state));
  const prevDocs = await snapshotsCol().find({ actorId: actor.actorId }).sort({ at: -1 }).limit(1).toArray();
  const prev = prevDocs[0] ? OwnerStateSnapshotSchema.parse(prevDocs[0]) : null;
  const changedKeys = prev
    ? Object.keys(state).filter((k) => canonicalJson(state[k]) !== canonicalJson(prev.state[k]))
    : Object.keys(state);
  const snapshot: OwnerStateSnapshot = OwnerStateSnapshotSchema.parse({
    snapshotId: genId('osnap'), actorId: actor.actorId, at: nowIso(), state, hash, changedKeys,
  });
  // Persist only when something changed (or first ever) — history stays meaningful.
  if (!prev || prev.hash !== hash) await snapshotsCol().insertOne(snapshot as never);
  return snapshot;
}

/* ============================ significance ============================= */

export function detectSignificance(
  snapshot: OwnerStateSnapshot,
  trigger: LoopInboxEvent,
): { significant: boolean; score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const st = snapshot.state as Record<string, unknown>;
  if (trigger.type === 'trust_chain_broken' || (Array.isArray(st.openCritical) && (st.openCritical as string[]).length > 0)) {
    reasons.push('critical proactive events open'); score += 0.6;
  }
  if (snapshot.changedKeys.includes('missionsOverdue') && (st.missionsOverdue as string[]).length > 0) {
    reasons.push(`overdue missions: ${(st.missionsOverdue as string[]).length}`); score += 0.4;
  }
  if (snapshot.changedKeys.includes('missionsStalled') && (st.missionsStalled as string[]).length > 0) {
    reasons.push(`stalled missions: ${(st.missionsStalled as string[]).length}`); score += 0.25;
  }
  if (trigger.source === 'replay') { reasons.push('explicit replay'); score += 0.3; }
  if (trigger.type.startsWith('owner.') || trigger.type === 'external.signal') {
    reasons.push(`external signal: ${trigger.type}`); score += 0.35;
  }
  score = Math.min(1, score);
  return { significant: score >= 0.25, score, reasons };
}

/* ============================== planning =============================== */

function buildPlan(cycle: LoopCycle, deps: LoopDeps): LoopPlanStep[] {
  const steps: LoopPlanStep[] = [];
  const policy = (tool: string) => deps.toolPolicy?.(tool) ?? { requiresApproval: false, riskLevel: 'low' as const };
  const add = (title: string, toolName: string, args: Record<string, unknown>) => {
    const p = policy(toolName);
    steps.push(LoopPlanStepSchema.parse({
      stepId: genId('lstep'), title, toolName, args,
      riskLevel: p.riskLevel, requiresApproval: p.requiresApproval,
    }));
  };
  const reasons = cycle.significance?.reasons ?? [];
  // Always: persist what was learned (low-risk, auto).
  add('Record the finding in owner memory', 'memory_record', {
    kind: 'fact', status: 'inferred',
    content: `[loop] ${cycle.triggerSummary}: ${cycle.decision?.rationale ?? reasons.join('; ')}`,
    subject: `loop:${cycle.triggerInboxId}`,
  });
  // Overdue/stalled → verify the ledger is intact before advising (read-only).
  if (reasons.some((r) => r.includes('critical'))) add('Verify the trust chain', 'cin_ledger_verify', {});
  // Critical priority → an attested claim about the incident (SENSITIVE — approval path, gate G8).
  if (cycle.decision?.priority === 'critical') {
    add('Issue an incident attestation claim', 'cin_claim_issue', {
      issuerEntityId: 'kernel', subjectEntityId: 'owner',
      claimType: 'loop.incident.attested',
      payload: { cycleId: cycle.cycleId, reasons },
    });
  }
  return steps;
}

/* ========================== the state machine ========================== */

async function persist(cycle: LoopCycle): Promise<void> {
  cycle.updatedAt = nowIso();
  await cyclesCol().updateOne({ cycleId: cycle.cycleId }, { $set: cycle }, { upsert: true });
}

function logStage(cycle: LoopCycle, stage: LoopStage, startedMs: number, ok: boolean, summary: string): void {
  cycle.stages.push({ stage, at: nowIso(), durationMs: Math.max(0, Date.now() - startedMs), ok, summary });
}

async function withStageBudget<T>(cycle: LoopCycle, fn: () => Promise<T>): Promise<T> {
  return await Promise.race([
    fn(),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('stage timeout (budget)')), cycle.budget.maxStageMs)),
  ]);
}

async function finishInbox(inboxId: string, ok: boolean, cycle: LoopCycle, error = ''): Promise<void> {
  const doc = await inboxCol().findOne({ inboxId });
  if (!doc) return;
  const ev = LoopInboxEventSchema.parse(doc);
  if (ok) {
    await inboxCol().updateOne({ inboxId }, {
      $set: {
        status: 'done', completedAt: nowIso(), processedCycleId: cycle.cycleId,
        latencyMs: Math.max(0, Date.now() - Date.parse(ev.receivedAt)),
      },
    });
  } else {
    const attempts = ev.attempts + 1;
    const dead = attempts >= ev.maxAttempts;
    await inboxCol().updateOne({ inboxId }, {
      $set: { status: dead ? 'dead' : 'pending', attempts, lastError: error, processedCycleId: cycle.cycleId },
    });
  }
}

/**
 * Drive a cycle forward from its durable `nextStage` checkpoint until it
 * completes, fails, or parks for approval. Safe to call again after restart.
 */
export async function processCycle(actor: LoopActor, cycle: LoopCycle, deps: LoopDeps = {}): Promise<LoopCycle> {
  const emit = (stage: string, summary: string) =>
    deps.publish?.({ type: 'loop.stage', taskId: null, payload: { cycleId: cycle.cycleId, stage, summary } });

  try {
    while (cycle.status === 'running' && cycle.nextStage !== 'done') {
      const started = Date.now();
      switch (cycle.nextStage) {
        case 'observe': {
          logStage(cycle, 'observe', started, true, cycle.triggerSummary || 'event received');
          cycle.nextStage = 'snapshot';
          break;
        }
        case 'snapshot': {
          const snap = await withStageBudget(cycle, () => buildOwnerSnapshot(actor));
          cycle.snapshotId = snap.snapshotId;
          logStage(cycle, 'snapshot', started, true, `state hash ${snap.hash.slice(0, 12)}…, changed: ${snap.changedKeys.join(',') || 'nothing'}`);
          cycle.nextStage = 'assess';
          break;
        }
        case 'assess': {
          const snapDoc = await snapshotsCol().findOne({ snapshotId: cycle.snapshotId ?? '' });
          const inboxDoc = await inboxCol().findOne({ inboxId: cycle.triggerInboxId });
          const snap = snapDoc ? OwnerStateSnapshotSchema.parse(snapDoc) : await buildOwnerSnapshot(actor);
          const trigger = LoopInboxEventSchema.parse(inboxDoc);
          cycle.significance = detectSignificance(snap, trigger);
          logStage(cycle, 'assess', started, true, cycle.significance.significant
            ? `SIGNIFICANT (${cycle.significance.score.toFixed(2)}): ${cycle.significance.reasons.join('; ')}`
            : 'not significant — no action needed');
          if (!cycle.significance.significant) {
            cycle.status = 'completed';
            cycle.outcome = { ok: true, summary: 'observed, judged not significant', memoryIds: [], ledgerSeq: null };
            cycle.nextStage = 'done';
          } else {
            cycle.nextStage = 'reason';
          }
          break;
        }
        case 'reason': {
          let usedModel = false;
          let result: { rationale: string; priority: 'low' | 'normal' | 'high' | 'critical' } | null = null;
          if (deps.reason && cycle.budget.usedModelCalls < cycle.budget.maxModelCalls) {
            cycle.budget.usedModelCalls += 1;
            result = await withStageBudget(cycle, () => deps.reason!({
              triggerSummary: cycle.triggerSummary,
              significanceReasons: cycle.significance?.reasons ?? [],
              snapshotState: {},
            })).catch(() => null);
            usedModel = result !== null;
          }
          if (!result) {
            // Deterministic fallback (honest): priority from significance score.
            const score = cycle.significance?.score ?? 0;
            result = {
              rationale: `deterministic: ${cycle.significance?.reasons.join('; ') ?? 'signal received'}`,
              priority: score >= 0.6 ? 'critical' : score >= 0.4 ? 'high' : 'normal',
            };
          }
          cycle.decision = { rationale: result.rationale, priority: result.priority, usedModel, usedFallback: !usedModel };
          logStage(cycle, 'reason', started, true, `[${result.priority}] ${result.rationale.slice(0, 160)} (model=${usedModel})`);
          cycle.nextStage = 'plan';
          break;
        }
        case 'plan': {
          cycle.plan = buildPlan(cycle, deps);
          logStage(cycle, 'plan', started, true, `${cycle.plan.length} step(s): ${cycle.plan.map((s) => s.title).join(' → ')}`);
          cycle.nextStage = 'execute';
          break;
        }
        case 'execute': {
          let parked = false;
          for (const step of cycle.plan) {
            if (step.status !== 'pending') continue; // resume never re-executes (G8/G9)
            if (step.requiresApproval) {
              const approvalId = deps.requestApproval ? await deps.requestApproval(cycle, step) : genId('appr');
              step.status = 'awaiting_approval';
              cycle.pendingApprovalId = approvalId;
              cycle.pendingStepId = step.stepId;
              cycle.status = 'awaiting_approval';
              parked = true;
              logStage(cycle, 'execute', started, true, `paused for approval: ${step.title} (${approvalId})`);
              break;
            }
            const res = deps.executeTool
              ? await withStageBudget(cycle, () => deps.executeTool!(step.toolName, step.args, { actorId: actor.actorId, cycleId: cycle.cycleId }))
              : { ok: false, summary: 'no tool executor bound' };
            step.status = res.ok ? 'done' : 'failed';
            step.resultSummary = res.summary.slice(0, 300);
            await persist(cycle); // per-step durability
          }
          if (!parked) {
            logStage(cycle, 'execute', started, true, `executed ${cycle.plan.filter((s) => s.status === 'done').length}/${cycle.plan.length}`);
            cycle.nextStage = 'review';
          }
          break;
        }
        case 'review': {
          const done = cycle.plan.filter((s) => s.status === 'done').length;
          const failed = cycle.plan.filter((s) => s.status === 'failed').length;
          const ok = failed === 0;
          logStage(cycle, 'review', started, ok, `steps done=${done} failed=${failed} rejected=${cycle.plan.filter((s) => s.status === 'rejected').length}`);
          cycle.nextStage = 'update';
          break;
        }
        case 'update': {
          // Memory + ledger anchor (gate G11). Memory written directly (deterministic).
          const mem = await recordMemory(
            { actorId: actor.actorId, scope: 'user', tenantId: actor.tenantId ?? null, userId: actor.actorId },
            {
              kind: 'lesson', status: 'inferred',
              content: `[loop ${cycle.cycleId}] ${cycle.decision?.rationale ?? ''} → ${cycle.plan.map((s) => `${s.title}:${s.status}`).join(', ')}`,
              subject: `loop-cycle:${cycle.cycleId}`, importance: 0.4, tags: ['living-loop'],
              provenance: { sourceType: 'jarvis_inferred', sessionId: null, turnId: null, runId: cycle.cycleId, refIds: [cycle.triggerInboxId], sourceUrl: '' },
            }, deps.publish,
          ).catch(() => null);
          const ledger = await appendLedger({
            recordType: 'cycle.completed', refId: cycle.cycleId, actorEntityId: actor.actorId,
            summary: `loop cycle: ${cycle.triggerSummary.slice(0, 80)}`,
            data: { priority: cycle.decision?.priority, steps: cycle.plan.length, usedModel: cycle.decision?.usedModel ?? false },
          });
          const failedSteps = cycle.plan.filter((s) => s.status === 'failed').length;
          cycle.outcome = {
            ok: failedSteps === 0,
            summary: `${cycle.plan.filter((s) => s.status === 'done').length}/${cycle.plan.length} steps done; anchored at ledger seq ${ledger.seq}`,
            memoryIds: mem ? [mem.memory.memoryId] : [],
            ledgerSeq: ledger.seq,
          };
          logStage(cycle, 'update', started, true, cycle.outcome.summary);
          cycle.status = 'completed';
          cycle.nextStage = 'done';
          break;
        }
        default:
          cycle.nextStage = 'done';
      }
      await persist(cycle);
      emit(cycle.nextStage, cycle.stages[cycle.stages.length - 1]?.summary ?? '');
    }
    if (cycle.status === 'completed') await finishInbox(cycle.triggerInboxId, true, cycle);
    return cycle;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'cycle failed';
    cycle.status = 'failed';
    cycle.stopReason = message;
    logStage(cycle, cycle.nextStage, Date.now(), false, message);
    await persist(cycle);
    await finishInbox(cycle.triggerInboxId, false, cycle, message);
    return cycle;
  }
}

export async function startCycleForEvent(actor: LoopActor, event: LoopInboxEvent, deps: LoopDeps = {}): Promise<LoopCycle> {
  await inboxCol().updateOne({ inboxId: event.inboxId }, { $set: { status: 'processing' } });
  const now = nowIso();
  const cycle: LoopCycle = LoopCycleSchema.parse({
    cycleId: genId('cyc'), actorId: actor.actorId, tenantId: actor.tenantId ?? null,
    triggerInboxId: event.inboxId,
    triggerSummary: `${event.source}/${event.type}`,
    budget: { maxStageMs: 30000, maxModelCalls: 2, usedModelCalls: 0 },
    replayOf: event.replayOf, createdAt: now, updatedAt: now,
  });
  await persist(cycle);
  return processCycle(actor, cycle, deps);
}

/** Approval decision (gate G8): resume EXACTLY where the cycle parked. */
export async function decideLoopApproval(
  actor: LoopActor, cycleId: string, action: 'approve' | 'reject', deps: LoopDeps = {},
): Promise<LoopCycle> {
  const doc = await cyclesCol().findOne({ cycleId, actorId: actor.actorId });
  if (!doc) throw new Error(`cycle ${cycleId} not found`);
  const cycle = LoopCycleSchema.parse(doc);
  if (cycle.status !== 'awaiting_approval' || !cycle.pendingStepId) throw new Error(`cycle ${cycleId} is not awaiting approval`);
  const step = cycle.plan.find((s) => s.stepId === cycle.pendingStepId);
  if (!step) throw new Error('pending step not found');
  if (action === 'approve') {
    const res = deps.executeTool
      ? await deps.executeTool(step.toolName, step.args, { actorId: actor.actorId, cycleId: cycle.cycleId })
      : { ok: false, summary: 'no tool executor bound' };
    step.status = res.ok ? 'done' : 'failed';
    step.resultSummary = res.summary.slice(0, 300);
  } else {
    step.status = 'rejected';
    step.resultSummary = 'rejected by owner — no mutation';
  }
  cycle.pendingApprovalId = null;
  cycle.pendingStepId = null;
  cycle.status = 'running';
  cycle.nextStage = 'execute'; // remaining pending steps continue; done steps never re-run
  await persist(cycle);
  return processCycle(actor, cycle, deps);
}

/* ============================ tick + resume ============================ */

/** Restart safety (gate G9): adopt cycles stuck in `running` whose heartbeat
 *  went silent (process died mid-stage) and drive them forward again. */
export async function resumeOpenCycles(actor: LoopActor, deps: LoopDeps = {}, opts: { staleAfterMs?: number } = {}): Promise<number> {
  const staleBefore = new Date(Date.now() - (opts.staleAfterMs ?? 120_000)).toISOString();
  const docs = await cyclesCol().find({ actorId: actor.actorId, status: 'running', updatedAt: { $lt: staleBefore } }).limit(10).toArray();
  let resumed = 0;
  for (const doc of docs) {
    const cycle = LoopCycleSchema.parse(doc);
    resumed += 1;
    await processCycle(actor, cycle, deps);
  }
  return resumed;
}

/**
 * One tick: resume stale cycles, feed open proactive events into the inbox
 * (the heartbeat → loop bridge), then process pending inbox events (oldest
 * first). Everything Mongo-durable — Redis absence only affects cadence.
 */
export async function runLoopTick(actor: LoopActor, deps: LoopDeps = {}, opts: { batch?: number } = {}): Promise<{ resumed: number; ingested: number; processed: number }> {
  const resumed = await resumeOpenCycles(actor, deps);

  // Bridge: open proactive events become loop events (idempotent by eventId).
  const hbActor: HeartbeatActor = { actorId: actor.actorId, scope: 'user', tenantId: actor.tenantId ?? null };
  const open = await listProactiveEvents(hbActor, { statuses: ['new'], limit: 20 });
  let ingested = 0;
  for (const ev of open) {
    const { duplicate } = await ingestLoopEvent(actor, {
      eventKey: `proactive:${ev.eventId}`, type: ev.kind, source: 'heartbeat',
      payload: { title: ev.title, priority: ev.priority, refIds: ev.refIds },
    });
    if (!duplicate) ingested += 1;
  }

  const pending = await inboxCol()
    .find({ actorId: actor.actorId, status: 'pending' })
    .sort({ receivedAt: 1 }).limit(Math.min(opts.batch ?? 5, 20)).toArray();
  let processed = 0;
  for (const doc of pending) {
    const event = LoopInboxEventSchema.parse(doc);
    await startCycleForEvent(actor, event, deps);
    processed += 1;
  }
  return { resumed, ingested, processed };
}

/* ============================== queries ================================ */

export async function listLoopCycles(actor: LoopActor, opts: { limit?: number; status?: string } = {}): Promise<LoopCycle[]> {
  const filter: Record<string, unknown> = { actorId: actor.actorId };
  if (opts.status) filter.status = opts.status;
  const docs = await cyclesCol().find(filter).sort({ createdAt: -1 }).limit(Math.min(opts.limit ?? 30, 100)).toArray();
  return docs.map((d) => LoopCycleSchema.parse(d));
}

export async function getLoopCycle(actor: LoopActor, cycleId: string): Promise<LoopCycle | null> {
  const doc = await cyclesCol().findOne({ cycleId, actorId: actor.actorId });
  return doc ? LoopCycleSchema.parse(doc) : null;
}

export async function listLoopInbox(actor: LoopActor, opts: { status?: string; limit?: number } = {}): Promise<LoopInboxEvent[]> {
  const filter: Record<string, unknown> = { actorId: actor.actorId };
  if (opts.status) filter.status = opts.status;
  const docs = await inboxCol().find(filter).sort({ receivedAt: -1 }).limit(Math.min(opts.limit ?? 50, 200)).toArray();
  return docs.map((d) => LoopInboxEventSchema.parse(d));
}

/* ---------------- API body contracts (gateway convention: schemas live in
 * shared; services never import zod directly) ---------------- */

export const LoopIngestBody = z.object({
  eventKey: z.string().min(1),
  type: z.string().min(1),
  source: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type LoopIngestBody = z.infer<typeof LoopIngestBody>;

export const LoopDecisionBody = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().optional(),
});
export type LoopDecisionBody = z.infer<typeof LoopDecisionBody>;

/** Output contract for the model reasoning hook (used by the gateway wiring). */
export const LoopReasonOutput = z.object({
  rationale: z.string().min(10),
  priority: z.enum(['low', 'normal', 'high', 'critical']),
});
export type LoopReasonOutput = z.infer<typeof LoopReasonOutput>;

export function loopLatencyStats(events: LoopInboxEvent[]): { count: number; p50: number | null; p95: number | null } {
  const ls = events.map((e) => e.latencyMs).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
  const pick = (p: number) => (ls.length ? ls[Math.min(ls.length - 1, Math.floor((p / 100) * ls.length))]! : null);
  return { count: ls.length, p50: pick(50), p95: pick(95) };
}
