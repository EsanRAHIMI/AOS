#!/usr/bin/env node
/**
 * CIN-2b (D-182) — first-cycle bootstrap for an empty/quiet Atlas.
 *
 * The Living Loop is significance-gated by design: an idle stack (no overdue
 * missions, no heartbeat findings) correctly produces tick 0/0/0 and an
 * empty /loop — autonomy, not absence. This seed removes the "is it broken
 * or just idle?" ambiguity on fresh databases by creating REAL conditions
 * the loop should act on:
 *
 *   1. a critical mission chain with an overdue mission (heartbeat +
 *      significance both trigger on it),
 *   2. one `external.signal` inbox event (proceeds past the assess gate).
 *
 * Idempotent: skips anything that already exists. Then either wait for the
 * background tick or force one: POST /v1/loop/tick (or the /loop button).
 *
 * Usage: MONGODB_URI=... [MONGODB_DB_NAME=autonomous_os_kernel]
 *        [LOOP_DEMO_ACTOR_ID=user_esan] node --import tsx scripts/loop-demo-seed.mjs
 */
import {
  connectMongo, closeMongo, ESAN_USER_ID,
  createMissionNode, listMissionNodes,
  ingestLoopEvent, runHeartbeatOnce,
} from '@factory/shared';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('FAIL: MONGODB_URI required'); process.exit(1); }
const DB = process.env.MONGODB_DB_NAME ?? 'autonomous_os_kernel';
const ACTOR_ID = process.env.LOOP_DEMO_ACTOR_ID || ESAN_USER_ID;

const missionActor = { actorId: ACTOR_ID, scope: 'user', tenantId: null };
const loopActor = { actorId: ACTOR_ID, tenantId: null };

async function ensureNode(nodeType, title, extra = {}) {
  const existing = (await listMissionNodes(missionActor, { limit: 300 })).find((n) => n.nodeType === nodeType && n.title === title);
  if (existing) { console.log(`SKIP  ${nodeType} "${title}" exists (${existing.nodeId})`); return existing; }
  const { node } = await createMissionNode(missionActor, { nodeType, title, ...extra });
  console.log(`SEED  ${nodeType} "${title}" → ${node.nodeId}`);
  return node;
}

async function main() {
  await connectMongo({ uri: MONGODB_URI, dbName: DB });
  console.log(`Loop demo seed — db ${DB}, actor ${ACTOR_ID}\n`);

  // 1) Overdue critical mission under a real chain (not throwaway noise —
  //    keeping the CIN-2b gates honest is a genuine mission of the system).
  const vision = await ensureNode('vision', 'AOS runs my life autonomously');
  const obj = await ensureNode('strategic_objective', 'Prove the Living Loop end-to-end (G1/G2/G10)', { parentId: vision.nodeId, priority: 'high', timeHorizon: '30d' });
  const prog = await ensureNode('program', 'CIN-2b acceptance', { parentId: obj.nodeId });
  await ensureNode('mission', 'Complete the 24h autonomous soak (G1)', {
    parentId: prog.nodeId, priority: 'critical',
    dueAt: new Date(Date.now() - 86_400_000).toISOString(), // overdue by 1 day
    successCriteria: ['>=24h uninterrupted', '>=10 unprompted cycles', 'latency recorded'],
  });

  // 2) Heartbeat pulse turns the overdue mission into a proactive finding now.
  const hb = await runHeartbeatOnce({ actorId: ACTOR_ID, scope: 'user', tenantId: null });
  console.log(`PULSE created=${hb.created.length} deduped=${hb.run.deduped} checks=${hb.run.checks.join(',')}`);

  // 3) One explicit external signal (passes the significance gate directly).
  const { event, duplicate } = await ingestLoopEvent(loopActor, {
    eventKey: 'demo:first-signal', type: 'external.signal', source: 'demo-seed',
    payload: { note: 'Living Loop demo bootstrap — first significant cycle' },
  });
  console.log(`${duplicate ? 'SKIP ' : 'SEED '} inbox external.signal (${event.inboxId})`);

  console.log(`\nDone. Next: wait for the background tick (LIVING_LOOP_INTERVAL_MS)
or force one:  curl -X POST http://localhost:4101/v1/loop/tick -H "x-factory-admin-token: $FACTORY_ADMIN_TOKEN"
Watch:         http://localhost:4100/loop`);
  await closeMongo();
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
