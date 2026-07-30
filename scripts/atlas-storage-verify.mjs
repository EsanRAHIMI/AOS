#!/usr/bin/env node
/**
 * D-186 — storage-layer verification against a REAL MongoDB.
 *
 * The in-memory fake used by the contract suites cannot prove any of this: it
 * has no indexes, no unique constraints and no query planner. These checks
 * therefore run against a real server and assert the three things that decide
 * whether this system scales on Atlas:
 *
 *   1. every planned index actually exists after ensureIndexes(),
 *   2. the UNIQUE constraints really reject duplicates (idempotency and chain
 *      linearity are guarantees, not hopes),
 *   3. the hot queries are INDEX SCANS, not collection scans — asserted via
 *      explain(), because "it feels fast on 10 rows" proves nothing.
 *
 * Usage: MONGODB_URI=... [MONGODB_DB_NAME=aos_idx_verify] node --import tsx scripts/atlas-storage-verify.mjs
 */
import {
  connectMongo, closeMongo, getDb, ensureIndexes, INDEX_PLAN, COLLECTIONS,
  createEntity, createDocument, ingestLoopEvent, appendLedger, verifyChain, ledgerHead,
} from '@factory/shared';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('FAIL: MONGODB_URI required'); process.exit(1); }
const DB = process.env.MONGODB_DB_NAME ?? `aos_idx_verify_${Math.random().toString(16).slice(2, 8)}`;

const results = [];
const rec = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`);
};

/** True when the winning plan uses an index rather than scanning the collection. */
function usesIndex(explain) {
  const stages = JSON.stringify(explain?.queryPlanner?.winningPlan ?? {});
  return stages.includes('IXSCAN') && !stages.includes('COLLSCAN');
}

async function main() {
  await connectMongo({ uri: MONGODB_URI, dbName: DB });
  const db = getDb();
  console.log(`Storage verification — db ${DB}\n`);

  /* 1 — the plan applies cleanly */
  const applied = await ensureIndexes();
  rec('ensureIndexes applies with no failures', applied.failed.length === 0,
    applied.failed.length ? JSON.stringify(applied.failed) : `${applied.created.length} created`);

  let missing = 0;
  for (const entry of INDEX_PLAN) {
    const idx = await db.collection(entry.collection).indexes();
    if (!idx.some((i) => i.name === entry.options?.name)) { missing += 1; console.log(`   missing: ${entry.collection}.${entry.options?.name}`); }
  }
  rec('every planned index exists on the server', missing === 0, `${INDEX_PLAN.length - missing}/${INDEX_PLAN.length}`);

  /* 2 — unique constraints are real */
  const actor = { actorId: 'verify', tenantId: null };
  await ingestLoopEvent(actor, { eventKey: 'dup-key', type: 'external.signal' });
  const second = await ingestLoopEvent(actor, { eventKey: 'dup-key', type: 'external.signal' });
  rec('loop_inbox idempotency survives a duplicate insert', second.duplicate === true);

  // Bypass the application layer entirely: the DATABASE must reject this.
  let rejected = false;
  try {
    await db.collection(COLLECTIONS.LOOP_INBOX).insertOne({
      inboxId: 'lin_raw', eventKey: 'dup-key', actorId: 'verify', type: 'x',
      payload: {}, status: 'pending', attempts: 0, maxAttempts: 3, lastError: '',
      processedCycleId: null, replayOf: null, receivedAt: new Date().toISOString(),
      completedAt: null, latencyMs: null, source: 'raw',
    });
  } catch (err) {
    rejected = err?.code === 11000;
  }
  rec('database itself rejects a duplicate eventKey (not just app code)', rejected);

  let seqRejected = false;
  await appendLedger({ recordType: 'entity.created', refId: 'v1', summary: 'one' });
  const head = await ledgerHead();
  try {
    await db.collection(COLLECTIONS.CIN_LEDGER).insertOne({
      ledgerId: 'ledg_raw', chainId: 'main', seq: head.seq, recordType: 'entity.created',
      refId: 'collide', actorEntityId: 'x', summary: '', data: {}, alg: 'sha256',
      prevHash: 'x', hash: 'y', at: new Date().toISOString(),
    });
  } catch (err) {
    seqRejected = err?.code === 11000;
  }
  rec('database enforces one record per ledger sequence number', seqRejected);

  /* 3 — the hot paths are index scans */
  const entity = (await createEntity({ actorId: 'verify', scope: 'user', tenantId: null }, { entityType: 'person', name: 'Verify Owner', tags: ['owner'] })).entity;
  await createDocument(actor, { ownerEntityId: entity.entityId, title: 'passport', docType: 'identity', expiresAt: new Date(Date.now() + 10 * 86400000).toISOString() });

  const hot = [
    ['owner document lookup', COLLECTIONS.CIN_DOCUMENTS, { ownerEntityId: entity.entityId }],
    ['pending inbox drain', COLLECTIONS.LOOP_INBOX, { actorId: 'verify', status: 'pending' }],
    ['claims about me', COLLECTIONS.CIN_CLAIMS, { subjectEntityId: entity.entityId }],
    ['entity by id', COLLECTIONS.CIN_ENTITIES, { entityId: entity.entityId }],
    ['ledger head', COLLECTIONS.CIN_LEDGER, { chainId: 'main' }],
  ];
  for (const [label, col, filter] of hot) {
    const explain = await db.collection(col).find(filter).explain('queryPlanner');
    rec(`index scan (not COLLSCAN): ${label}`, usesIndex(explain));
  }

  /* 4 — verification still works and stays streaming */
  const chain = await verifyChain();
  rec('chain verifies after real writes', chain.ok, `length ${chain.length}`);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} storage checks passed.`);
  await closeMongo();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
