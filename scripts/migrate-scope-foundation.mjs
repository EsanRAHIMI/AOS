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

// 3b — K1.4e (D-162): identity/connector collections whose schema gained an
// explicit `scope` field. Unlike step 3, these records ALREADY carry correct
// tenantId/userId (their schemas always required them) — only `scope` is
// added, so existing values are never overwritten. user_profiles and
// tenant_memberships get 'user'/'tenant' respectively; the three connector
// collections are always user-scoped by design.
const SCOPE_FIELD_ADD = [
  [COLLECTIONS.USER_PROFILES, 'user'],
  [COLLECTIONS.TENANT_MEMBERSHIPS, 'tenant'],
  [COLLECTIONS.CONSENT_GRANTS, 'user'],
  [COLLECTIONS.CONNECTOR_ACCOUNTS, 'user'],
  [COLLECTIONS.CONNECTOR_SYNC_RUNS, 'user'],
];
for (const [name, scopeValue] of SCOPE_FIELD_ADD) {
  try {
    const r = await collection(name).updateMany(
      { scope: { $exists: false } },
      { $set: { scope: scopeValue, migrationNote: 'K1.4e (D-162): scope field added, existing tenantId/userId preserved' } },
    );
    console.log(`✓ ${name}: ${r.modifiedCount} records stamped scope:'${scopeValue}'`);
  } catch (e) { console.log(`- ${name}: skipped (${e.message})`); }
}

// 4 — K1 Real Auth (D-164): the owner's login credential. Mirrors the same
// idempotent, no-plaintext logic server.ts's own boot-time bootstrap runs —
// duplicated here (not merely relied upon) so this script remains the single
// authoritative seed entry point per master-direction §D.4. NEVER generates
// or prints a plaintext password: if FACTORY_OWNER_PASSWORD_HASH isn't set,
// this step is skipped with a clear message, not a silently-invented secret.
try {
  const userAccounts = collection(COLLECTIONS.USER_ACCOUNTS);
  const existing = await userAccounts.findOne({ userId: ESAN_USER_ID });
  if (existing) {
    console.log(`- ${COLLECTIONS.USER_ACCOUNTS}: owner already has a credential — untouched`);
  } else {
    const configuredHash = (process.env.FACTORY_OWNER_PASSWORD_HASH ?? '').trim();
    if (/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/i.test(configuredHash)) {
      const now = nowIso();
      await userAccounts.insertOne({ userId: ESAN_USER_ID, email: (process.env.FACTORY_OWNER_EMAIL ?? 'owner@local').trim().toLowerCase(), passwordHash: configuredHash, primaryTenantId: ESAN_TENANT_ID, status: 'active', createdAt: now, updatedAt: now });
      console.log(`✓ ${COLLECTIONS.USER_ACCOUNTS}: owner credential seeded from FACTORY_OWNER_PASSWORD_HASH`);
    } else {
      console.log(
        `- ${COLLECTIONS.USER_ACCOUNTS}: FACTORY_OWNER_PASSWORD_HASH not set — owner credential NOT seeded (never generating ` +
        "one). Run node scripts/hash-password.mjs '<your-password>' and set FACTORY_OWNER_PASSWORD_HASH, then re-run.",
      );
    }
  }
} catch (e) { console.log(`- ${COLLECTIONS.USER_ACCOUNTS}: skipped (${e.message})`); }

await collection(COLLECTIONS.EVENTS).insertOne({ eventId: `evt_migration_${Date.now()}`, type: 'identity.seeded', source: 'migrate-scope-foundation', taskId: null, payload: { message: 'Phase AA scope foundation migration completed', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID }, createdAt: nowIso(), scope: 'global' });
console.log('\nDone. Re-running is safe: only unscoped records are ever touched.');
process.exit(0);
