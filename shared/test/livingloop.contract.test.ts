/**
 * CIN-2b (D-181) — Autonomous Living Loop proofs, mapped to the acceptance
 * gates in docs/cin-v2/living-loop.md:
 * G4 idempotency · G5 replay · G6 DLQ · G7 budget/fallback honesty ·
 * G8 approval pause + exact resume + reject-no-mutation · G9 restart resume ·
 * G3 latency recorded · G11 memory + ledger updates.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { COLLECTIONS } from '../src/constants/index.js';
import { createMissionNode, type MissionActor } from '../src/missions/index.js';
import { verifyChain } from '../src/cin/index.js';
import {
  ingestLoopEvent, replayInboxEvent, requeueDeadEvent, runLoopTick,
  startCycleForEvent, decideLoopApproval, listLoopCycles, listLoopInbox,
  loopLatencyStats, resumeOpenCycles,
  type LoopActor, type LoopDeps,
} from '../src/livingloop/index.js';

const actor: LoopActor = { actorId: 'esan', tenantId: null };
const missionActor: MissionActor = { actorId: 'esan', scope: 'user', tenantId: null };

let fake: ReturnType<typeof createFakeDb>;
beforeEach(() => { fake = createFakeDb(); setTestDb(fake.db); });

/** Deps with a working executor and no model (deterministic path, no approvals). */
function fakeDeps(overrides: Partial<LoopDeps> = {}): LoopDeps {
  return {
    toolPolicy: () => ({ requiresApproval: false, riskLevel: 'low' }),
    executeTool: async (toolName) => ({ ok: true, summary: `${toolName} executed` }),
    requestApproval: async () => 'appr_test_1',
    ...overrides,
  };
}

/** Approval-gated policy for the G8 tests (sensitive claim step pauses). */
const approvalPolicy: LoopDeps['toolPolicy'] = (tool) => tool === 'cin_claim_issue'
  ? { requiresApproval: true, riskLevel: 'medium' }
  : { requiresApproval: false, riskLevel: 'low' };

async function seedOverdueCritical() {
  const vision = await createMissionNode(missionActor, { nodeType: 'vision', title: 'V' });
  const obj = await createMissionNode(missionActor, { nodeType: 'strategic_objective', title: 'O', parentId: vision.node.nodeId });
  const prog = await createMissionNode(missionActor, { nodeType: 'program', title: 'P', parentId: obj.node.nodeId });
  await createMissionNode(missionActor, { nodeType: 'mission', title: 'M-overdue', parentId: prog.node.nodeId, priority: 'critical', dueAt: '2020-01-01T00:00:00.000Z' });
}

describe('living loop — intake', () => {
  it('G4: duplicate eventKey never creates a second event or cycle', async () => {
    const a = await ingestLoopEvent(actor, { eventKey: 'k1', type: 'external.signal' });
    const b = await ingestLoopEvent(actor, { eventKey: 'k1', type: 'external.signal' });
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.event.inboxId).toBe(a.event.inboxId);
    await runLoopTick(actor, fakeDeps());
    expect((await listLoopCycles(actor)).length).toBe(1);
  });

  it('G5: replay creates a NEW cycle explicitly marked replayOf', async () => {
    const { event } = await ingestLoopEvent(actor, { eventKey: 'k2', type: 'external.signal' });
    await runLoopTick(actor, fakeDeps());
    const replayed = await replayInboxEvent(actor, event.inboxId);
    expect(replayed.replayOf).toBe(event.inboxId);
    await runLoopTick(actor, fakeDeps());
    const cycles = await listLoopCycles(actor);
    expect(cycles.length).toBe(2);
    expect(cycles.some((c) => c.replayOf === event.inboxId)).toBe(true);
  });
});

describe('living loop — cycle', () => {
  it('completes end-to-end: stages logged, latency recorded, memory + ledger updated (G3/G11)', async () => {
    await seedOverdueCritical();
    const { event } = await ingestLoopEvent(actor, { eventKey: 'k3', type: 'external.signal' });
    const cycle = await startCycleForEvent(actor, event, fakeDeps());
    expect(cycle.status).toBe('completed');
    expect(cycle.stages.map((s) => s.stage)).toEqual(['observe', 'snapshot', 'assess', 'reason', 'plan', 'execute', 'review', 'update']);
    expect(cycle.decision?.usedFallback).toBe(true); // honest: no model bound
    expect(cycle.outcome?.memoryIds.length).toBe(1);
    expect(cycle.outcome?.ledgerSeq).not.toBeNull();
    expect((await verifyChain()).ok).toBe(true); // anchor did not break the chain
    const inbox = await listLoopInbox(actor);
    expect(inbox[0]!.latencyMs).not.toBeNull();
    expect(loopLatencyStats(inbox).count).toBe(1);
  });

  it('not-significant events complete honestly with no action', async () => {
    const { event } = await ingestLoopEvent(actor, { eventKey: 'k4', type: 'noise' });
    const cycle = await startCycleForEvent(actor, event, fakeDeps());
    expect(cycle.status).toBe('completed');
    expect(cycle.outcome?.summary).toContain('not significant');
    expect(cycle.plan).toHaveLength(0);
  });

  it('G8: sensitive step pauses; approve resumes EXACTLY; done steps never re-run', async () => {
    await seedOverdueCritical();
    const calls: string[] = [];
    const deps = fakeDeps({
      toolPolicy: approvalPolicy,
      executeTool: async (toolName) => { calls.push(toolName); return { ok: true, summary: `${toolName} ok` }; },
    });
    const { event } = await ingestLoopEvent(actor, { eventKey: 'k5', type: 'external.signal' });
    // Force critical priority so the plan includes the sensitive claim step.
    const withReason = { ...deps, reason: async () => ({ rationale: 'critical incident — attest and notify', priority: 'critical' as const }) };
    const parked = await startCycleForEvent(actor, event, withReason);
    expect(parked.status).toBe('awaiting_approval');
    expect(parked.pendingApprovalId).toBe('appr_test_1');
    const callsBeforeResume = calls.length;

    const resumed = await decideLoopApproval(actor, parked.cycleId, 'approve', withReason);
    expect(resumed.status).toBe('completed');
    const sensitive = resumed.plan.find((s) => s.toolName === 'cin_claim_issue');
    expect(sensitive?.status).toBe('done');
    // Exactly ONE new execution happened after resume (the approved step);
    // earlier done steps were not re-executed.
    expect(calls.length).toBe(callsBeforeResume + 1);
  });

  it('G8: reject leaves the sensitive step unexecuted and cycle still completes', async () => {
    await seedOverdueCritical();
    const executed: string[] = [];
    const deps = fakeDeps({
      toolPolicy: approvalPolicy,
      executeTool: async (toolName) => { executed.push(toolName); return { ok: true, summary: 'ok' }; },
      reason: async () => ({ rationale: 'critical incident', priority: 'critical' as const }),
    });
    const { event } = await ingestLoopEvent(actor, { eventKey: 'k6', type: 'external.signal' });
    const parked = await startCycleForEvent(actor, event, deps);
    const rejected = await decideLoopApproval(actor, parked.cycleId, 'reject', deps);
    expect(rejected.status).toBe('completed');
    expect(rejected.plan.find((s) => s.toolName === 'cin_claim_issue')?.status).toBe('rejected');
    expect(executed).not.toContain('cin_claim_issue'); // no mutation on reject
  });

  it('G7: model error falls back deterministically — the loop never stops', async () => {
    await seedOverdueCritical();
    const deps = fakeDeps({ reason: async () => { throw new Error('model exploded'); } });
    const { event } = await ingestLoopEvent(actor, { eventKey: 'k7', type: 'external.signal' });
    const cycle = await startCycleForEvent(actor, event, deps);
    expect(cycle.status).toBe('completed');
    expect(cycle.decision?.usedFallback).toBe(true);
    expect(cycle.budget.usedModelCalls).toBe(1); // the attempt was budgeted
  });

  it('G6: repeated stage failure sends the event to the DLQ, requeue revives it', async () => {
    await seedOverdueCritical();
    const deps = fakeDeps({
      executeTool: async () => { throw new Error('poisoned tool'); },
    });
    // executeTool throwing inside withStageBudget → cycle fails → attempts++.
    const { event } = await ingestLoopEvent(actor, { eventKey: 'k8', type: 'external.signal' });
    for (let i = 0; i < 3; i += 1) {
      const pending = (await listLoopInbox(actor, { status: 'pending' }))[0];
      if (!pending) break;
      await startCycleForEvent(actor, pending, deps);
    }
    const dead = await listLoopInbox(actor, { status: 'dead' });
    expect(dead).toHaveLength(1);
    expect(dead[0]!.attempts).toBe(3);
    expect(dead[0]!.lastError).toContain('poisoned');
    expect(await requeueDeadEvent(actor, dead[0]!.inboxId)).toBe(true);
    expect((await listLoopInbox(actor, { status: 'pending' }))).toHaveLength(1);
  });

  it('G9: a cycle abandoned mid-flight (process death) is resumed, not redone', async () => {
    await seedOverdueCritical();
    const { event } = await ingestLoopEvent(actor, { eventKey: 'k9', type: 'external.signal' });
    const cycle = await startCycleForEvent(actor, event, fakeDeps());
    expect(cycle.status).toBe('completed');
    // Simulate a crash mid-cycle: rewind the durable checkpoint to 'review'
    // with a stale updatedAt, as if the process died after 'execute' persisted.
    const stagesBefore = cycle.stages.filter((s) => ['observe', 'snapshot', 'assess', 'reason', 'plan', 'execute'].includes(s.stage)).length;
    await fake.db.collection(COLLECTIONS.LOOP_CYCLES).updateOne({ cycleId: cycle.cycleId }, {
      $set: {
        status: 'running', nextStage: 'review', outcome: null,
        updatedAt: '2020-01-01T00:00:00.000Z',
        stages: cycle.stages.slice(0, stagesBefore),
      },
    });
    const resumed = await resumeOpenCycles(actor, fakeDeps(), { staleAfterMs: 60000 });
    expect(resumed).toBe(1);
    const after = (await listLoopCycles(actor)).find((c) => c.cycleId === cycle.cycleId)!;
    expect(after.status).toBe('completed');
    // Early stages were NOT re-executed: exactly one observe stage in the log.
    expect(after.stages.filter((s) => s.stage === 'observe')).toHaveLength(1);
    expect(after.stages.filter((s) => s.stage === 'review')).toHaveLength(1);
  });

  it('heartbeat bridge: tick ingests open proactive events exactly once', async () => {
    await seedOverdueCritical();
    const { runHeartbeatOnce } = await import('../src/heartbeat/index.js');
    await runHeartbeatOnce({ actorId: 'esan', scope: 'user', tenantId: null });
    const t1 = await runLoopTick(actor, fakeDeps());
    expect(t1.ingested).toBeGreaterThan(0);
    const t2 = await runLoopTick(actor, fakeDeps());
    expect(t2.ingested).toBe(0); // idempotent bridge
  });
});
