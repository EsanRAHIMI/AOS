#!/usr/bin/env node
/**
 * D-186 — apply the MongoDB Atlas index plan.
 *
 * The gateway also runs this on boot, but an explicit script matters for ops:
 * it lets you apply the plan to a fresh Atlas cluster, a restored backup, or a
 * migration target BEFORE any service points at it, and it prints exactly what
 * changed. Idempotent — run it as often as you like.
 *
 * Usage:
 *   MONGODB_URI=... [MONGODB_DB_NAME=autonomous_os_kernel] node scripts/ensure-indexes.mjs
 *   ... --plan     # print the plan and exit without touching the database
 */
import { connectMongo, closeMongo, ensureIndexes, describeIndexPlan, INDEX_PLAN } from '@factory/shared';

if (process.argv.includes('--plan')) {
  console.log(describeIndexPlan());
  console.log(`\n${INDEX_PLAN.length} indexes planned.`);
  process.exit(0);
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('FAIL: MONGODB_URI required'); process.exit(1); }
const DB = process.env.MONGODB_DB_NAME ?? 'autonomous_os_kernel';

async function main() {
  await connectMongo({ uri: MONGODB_URI, dbName: DB });
  console.log(`Applying ${INDEX_PLAN.length} indexes to ${DB}…\n`);

  const res = await ensureIndexes();

  for (const c of res.created) console.log(`CREATED  ${c}`);
  console.log(`\nalready present: ${res.existing}`);

  if (res.failed.length) {
    console.error('\nFAILED:');
    for (const f of res.failed) console.error(`  ${f.index}\n    ${f.error}`);
    console.error(`
A failed UNIQUE index is not a cosmetic problem: it means the collection
already contains rows that violate an invariant the code assumes. Resolve the
duplicates before relying on that guarantee — e.g. two ACTIVE signing keys for
one entity, or two inbox rows with the same eventKey.`);
    await closeMongo();
    process.exit(1);
  }

  console.log('\nINDEX PLAN APPLIED');
  await closeMongo();
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
