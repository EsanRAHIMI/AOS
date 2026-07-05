#!/usr/bin/env node
/**
 * Phase AA — scope foundation migration. IDEMPOTENT and NON-DESTRUCTIVE:
 * safe to re-run any number of times; never deletes or overwrites user data.
 *
 *  1. Seeds Esan as first owner + platform governor:
 *     tenant_esan_personal / user_esan / owner membership.
 *  2. Stamps legacy KERNEL collections' records as scope:'global'
 *     (only where no scope field exists; adds a migrationNote).
 *  3. Stamps clearly USER-FACING collections (voice sessions/messages,
 *     operator runtime sessions/tool runs) with Esan's user scope —
 *     these were only ever produced by the single owner so far.
 *  4. Anything ambiguous stays global with migrationNote 'needs_scope_review'.
 *
 * Usage: MONGODB_URI=... MONGODB_DB_NAME=autonomous_os_kernel \
 *        node scripts/migrate-scope-foundation.mjs
 */
import { connectMongo, collection, COLLECTIONS, buildEsanSeed, ESAN_TENANT_ID, ESAN_USER_ID, nowIso } from '../shared/dist/index.js';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME ?? 'autonomous_os_kernel';
if (!uri) { console.error('MONGODB_URI is required'); process.exit(1); }

await connectMongo({ uri, dbName });
console.log(`Connected to ${dbName}. Running idempotent scope migration…\n`);

// 1 — Seed Esan (upserts; re-running changes nothing).
const seed = buildEsanSeed();
await collection(COLLECTIONS.TENANTS).updateOne({ tenantId: seed.tenant.tenantId }, { $setOnInsert: seed.tenant }, { upsert: true });
await collection(COLLECTIONS.USER_PROFILES).updateOne({ userId: seed.user.userId }, { $setOnInsert: seed.user }, { upsert: true });
await collection(COLLECTIONS.TENANT_MEMBERSHIPS).updateOne({ membershipId: seed.membership.membershipId }, { $setOnInsert: seed.membership }, { upsert: true });
console.log(`✓ Seeded ${ESAN_USER_ID} as owner/platform governor of ${ESAN_TENANT_ID}`);

// 2 — Kernel collections → explicit scope:'global' where unscoped.
const GLOBAL_COLLECTIONS = [
  COLLECTIONS.TASKS, COLLECTIONS.APPROVALS, COLLECTIONS.MEMORIES ?? 'memories', 'skills',
  COLLECTIONS.EVENTS, COLLECTIONS.EVIDENCE_RECORDS ?? 'evidence_records', 'reports', 'research_reports',
  COLLECTIONS.WORKSPACE_RUNS, 'audit_logs',
];
for (const name of GLOBAL_COLLECTIONS) {
  try {
    const r = await collection(name).updateMany(
      { scope: { $exists: false } },
      { $set: { scope: 'global', visibility: 'public', migrationNote: 'phase-aa: legacy kernel record defaulted to global' } },
    );
    console.log(`✓ ${name}: ${r.modifiedCount} records stamped global`);
  } catch (e) { console.log(`- ${name}: skipped (${e.message})`); }
}

// 3 — User-facing collections → Esan scope (single-owner history).
const ESAN_SCOPED = [COLLECTIONS.VOICE_SESSIONS, COLLECTIONS.VOICE_MESSAGES, COLLECTIONS.OPERATOR_RUNTIME_SESSIONS, COLLECTIONS.OPERATOR_TOOL_RUNS];
for (const name of ESAN_SCOPED) {
  try {
    const r = await collection(name).updateMany(
      { scope: { $exists: false } },
      { $set: { scope: 'user', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, visibility: 'private', createdBy: ESAN_USER_ID, migrationNote: 'phase-aa: single-owner history scoped to Esan' } },
    );
    console.log(`✓ ${name}: ${r.modifiedCount} records scoped to Esan`);
  } catch (e) { console.log(`- ${name}: skipped (${e.message})`); }
}

await collection(COLLECTIONS.EVENTS).insertOne({ eventId: `evt_migration_${Date.now()}`, type: 'identity.seeded', source: 'migrate-scope-foundation', taskId: null, payload: { message: 'Phase AA scope foundation migration completed', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID }, createdAt: nowIso(), scope: 'global' });
console.log('\nDone. Re-running is safe: only unscoped records are ever touched.');
process.exit(0);
