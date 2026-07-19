#!/usr/bin/env node
/**
 * CIN-2b (D-181) — Living Loop runtime verification against REAL MongoDB.
 * Automates acceptance gates G3–G9 + G11 (docs/cin-v2/living-loop.md) and
 * prints the live-demo checklist for G1/G2/G10.
 *
 * Usage: MONGODB_URI=... [MONGODB_DB_NAME=aos_loop_verify] node scripts/living-loop-verify.mjs
 * Uses a throwaway db name by default — safe to run anywhere.
 */
import {
  connectMongo, closeMongo,
  createMissionNode,
  ingestLoopEvent, replayInboxEvent, requeueDeadEvent,
  startCycleForEvent, decideLoopApproval, listLoopCycles, listLoopInbox,
  loopLatencyStats, resumeOpenCycles, runLoopTick, runHeartbeatOnce, verifyChain,
} from '@factory/shared';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('FAIL: MONGODB_URI required'); process.exit(1); }
const DB = process.env.MONGODB_DB_NAME ?? `aos_loop_verify_${Math.random().toString(16).slice(2, 8)}`;

const actor = { actorId: 'esan_verify', tenantId: null };
const missionActor = { actorId: 'esan_verify', scope: 'user', tenantId: null };
const results = [];
const rec = (gate, name, pass, detail = '') => {
  results.push({ gate, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${gate}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const okDeps = {
  toolPolicy: () => ({ requiresApproval: false, riskLevel: 'low' }),
  executeTool: async (t) => ({ ok: true, summary: `${t} executed` }),
  requestApproval: async () => 'appr_verify',
};
const approvalDeps = {
  ...okDeps,
  toolPolicy: (t) => t === 'cin_claim_issue' ? { requiresApproval: true, riskLevel: 'medium' } : { requiresApproval: false, riskLevel: 'low' },
  reason: async () => ({ rationale: 'critical incident (verify run)', priority: 'critical' }),
};

async function main() {
  await connectMongo({ uri: MONGODB_URI, dbName: DB });
  console.log(`Living Loop verify — db ${DB}\n`);

  // Seed a critical overdue mission so significance triggers.
  const v = await createMissionNode(missionActor, { nodeType: 'vision', title: 'verify vision' });
  const o = await createMissionNode(missionActor, { nodeType: 'strategic_objective', title: 'verify obj', parentId: v.node.nodeId });
  const p = await createMissionNode(missionActor, { nodeType: 'program', title: 'verify prog', parentId: o.node.nodeId });
  await createMissionNode(missionActor, { nodeType: 'mission', title: 'verify overdue', parentId: p.node.nodeId, priority: 'critical', dueAt: '2020-01-01T00:00:00.000Z' });

  // G4 — idempotency.
  const a = await ingestLoopEvent(actor, { eventKey: 'vk1', type: 'external.signal' });
  const b = await ingestLoopEvent(actor, { eventKey: 'vk1', type: 'external.signal' });
  rec('G4', 'duplicate eventKey deduped', !a.duplicate && b.duplicate && a.event.inboxId === b.event.inboxId);

  // Full cycle + G3 latency + G11 updates.
  const cycle = await startCycleForEvent(actor, a.event, okDeps);
  rec('G11', 'cycle completed with memory + ledger anchor',
    cycle.status === 'completed' && cycle.outcome?.memoryIds.length === 1 && cycle.outcome?.ledgerSeq !== null,
    cycle.outcome?.summary ?? cycle.stopReason);
  const chain = await verifyChain();
  rec('G11', 'trust chain still verifies after anchor', chain.ok, `len ${chain.length}`);
  const inbox1 = await listLoopInbox(actor);
  const lat = loopLatencyStats(inbox1);
  rec('G3', 'latency recorded', inbox1[0]?.latencyMs !== null, `p50=${lat.p50}ms p95=${lat.p95}ms`);

  // G5 — replay.
  const replayed = await replayInboxEvent(actor, a.event.inboxId);
  await runLoopTick(actor, okDeps);
  const cycles = await listLoopCycles(actor);
  rec('G5', 'replay creates a second, marked cycle', cycles.some((c) => c.replayOf === a.event.inboxId));

  // G8 — approval pause / approve resume / reject no-mutation.
  const e8 = await ingestLoopEvent(actor, { eventKey: 'vk8', type: 'external.signal' });
  const parked = await startCycleForEvent(actor, e8.event, approvalDeps);
  rec('G8', 'sensitive step parked for approval', parked.status === 'awaiting_approval');
  const resumed = await decideLoopApproval(actor, parked.cycleId, 'approve', approvalDeps);
  rec('G8', 'approve resumed exactly and completed',
    resumed.status === 'completed' && resumed.plan.find((s) => s.toolName === 'cin_claim_issue')?.status === 'done');
  const e8b = await ingestLoopEvent(actor, { eventKey: 'vk8b', type: 'external.signal' });
  const parked2 = await startCycleForEvent(actor, e8b.event, approvalDeps);
  const rejected = await decideLoopApproval(actor, parked2.cycleId, 'reject', approvalDeps);
  rec('G8', 'reject → no mutation, cycle still completes',
    rejected.status === 'completed' && rejected.plan.find((s) => s.toolName === 'cin_claim_issue')?.status === 'rejected');

  // G7 — model failure fallback + budget accounting.
  const e7 = await ingestLoopEvent(actor, { eventKey: 'vk7', type: 'external.signal' });
  const c7 = await startCycleForEvent(actor, e7.event, { ...okDeps, reason: async () => { throw new Error('model down'); } });
  rec('G7', 'model failure → deterministic fallback, budget counted',
    c7.status === 'completed' && c7.decision?.usedFallback === true && c7.budget.usedModelCalls === 1);

  // G6 — DLQ after maxAttempts, then requeue.
  const e6 = await ingestLoopEvent(actor, { eventKey: 'vk6', type: 'external.signal' });
  const poison = { ...okDeps, executeTool: async () => { throw new Error('poisoned'); } };
  for (let i = 0; i < 3; i += 1) {
    const pending = (await listLoopInbox(actor, { status: 'pending' })).find((x) => x.eventKey === 'vk6');
    if (!pending) break;
    await startCycleForEvent(actor, pending, poison);
  }
  const dead = (await listLoopInbox(actor, { status: 'dead' })).find((x) => x.eventKey === 'vk6');
  rec('G6', 'poisoned event reached DLQ after 3 attempts', Boolean(dead) && dead.attempts === 3);
  rec('G6', 'DLQ requeue revives the event', dead ? await requeueDeadEvent(actor, dead.inboxId) : false);

  // G9 — restart resume (stale running cycle adopted and finished).
  const e9 = await ingestLoopEvent(actor, { eventKey: 'vk9', type: 'external.signal' });
  const c9 = await startCycleForEvent(actor, e9.event, okDeps);
  const { collection } = await import('@factory/shared');
  await collection('loop_cycles').updateOne({ cycleId: c9.cycleId }, {
    $set: { status: 'running', nextStage: 'review', outcome: null, updatedAt: '2020-01-01T00:00:00.000Z' },
  });
  const resumedCount = await resumeOpenCycles(actor, okDeps, { staleAfterMs: 60_000 });
  const after9 = (await listLoopCycles(actor)).find((c) => c.cycleId === c9.cycleId);
  rec('G9', 'stale mid-flight cycle resumed to completion', resumedCount >= 1 && after9?.status === 'completed');

  // Heartbeat→loop bridge (idempotent).
  await runHeartbeatOnce({ actorId: actor.actorId, scope: 'user', tenantId: null });
  const t1 = await runLoopTick(actor, okDeps);
  const t2 = await runLoopTick(actor, okDeps);
  rec('G4', 'heartbeat bridge ingests exactly once', t1.ingested > 0 && t2.ingested === 0);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} automated gate checks passed.`);
  console.log(`\nLIVE-DEMO CHECKLIST (owner machine, real model + Atlas + Redis):
  [ ] G1  — ≥24h uninterrupted, ≥10 cycles, zero initial user messages
  [ ] G2  — ≥1 cycle with usedModel:true (real rationale, not fallback)
  [ ] G10 — /loop shows saw→mattered→decided→did→result live for every cycle
  Start: pnpm --filter @factory/gateway-api dev  (LIVING_LOOP_INTERVAL_MS=60000)
  Watch: http://localhost:3000/loop`);
  await closeMongo();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
