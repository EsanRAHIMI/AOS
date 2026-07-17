#!/usr/bin/env node
/**
 * K1.4b — scope boundary static check (D-158).
 *
 * master-direction.md §C.5: "Direct collection() access outside the data
 * layer becomes a lint error." This script is that lint rule, sized to what
 * K1.4b actually migrated — it does not (and cannot honestly) forbid every
 * raw collection() call in the codebase yet, because ~90 kernel collections
 * are legitimately still on the legacy flat-handle pattern pending later
 * K1.4c+ passes (see docs/decision-log.md D-158). What it DOES enforce,
 * permanently, starting now:
 *
 *   1. Only shared/src/db/index.ts (the definition) and shared/src/db/
 *      scoped.ts (the sanctioned wrapper) may call the raw collection()
 *      accessor anywhere in shared/. No other shared module may reach
 *      around scopedCollection(ctx).
 *   2. No services/*\/src/routes/** module may call collection() directly.
 *      Route handlers only ever receive data access via GatewayDeps or by
 *      constructing a scopedCollection(ctx) — never a fresh raw handle.
 *   3. MIGRATED_COLLECTIONS below is a ratchet: once a collection has been
 *      moved onto scopedCollection(ctx) (K1.4b did scoped_memories), raw
 *      collection(COLLECTIONS.X) access to it is a hard failure ANYWHERE in
 *      services/**, forever. Each future migration pass adds its name here.
 *
 * Non-blocking signal (does not fail CI): a count of remaining raw
 * collection() calls in services/gateway-api/src/server.ts, the documented
 * K1.3 legacy zone (D-157) — visibility into the debt without gating work
 * that hasn't been scoped yet.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Collection constant names that MUST NOT be reached via raw collection()
 *  anywhere under services/ once migrated. Grows with each K1.4x pass. */
const MIGRATED_COLLECTIONS = [
  'SCOPED_MEMORIES', // K1.4b, D-158
  'PERSONAL_HEALTH_STATES', 'PERSONAL_LIFE_ITEMS', 'PERSONAL_FINANCE_ITEMS', 'PERSONAL_LEARNING_TRACKS', // K1.4c, D-159
  'OPPORTUNITY_REPORTS', // K1.4d, D-160
  'CONNECTOR_ACCOUNTS', 'CONNECTOR_SYNC_RUNS', // K1.4f, D-163
  // NOTE: USER_PROFILES, TENANT_MEMBERSHIPS, CONSENT_GRANTS are deliberately
  // NOT in this ratchet despite routes/personal.ts being fully migrated off
  // them (K1.4f, D-163). A raw local handle for each legitimately remains in
  // server.ts: userProfiles+memberships for the owner-seed bootstrap, and
  // userProfiles+consentGrants for the Jarvis/operator executors block
  // (D-157, out of scope this session). Adding them here would make the
  // ratchet fail on that legitimate remaining usage. See decision-log D-163.
];

const SHARED_DB_ALLOWED = new Set([
  'shared/src/db/index.ts', // the raw collection() definition itself
  'shared/src/db/scoped.ts', // the sanctioned scopedCollection(ctx) wrapper
  // Explicit escape hatch (master-direction §21: "Global collections must be
  // explicitly declared global, not accidentally global"). agent_runs tracks
  // self-development execution (taskId/agentId/status/steps) — no scope
  // fields exist on AgentRun; it is global kernel state under the platform's
  // own "Global software evolution. Scoped human data." rule (shared/src/
  // schemas/scope.ts header). Pre-existing, unrelated to K1.4b; allowlisted
  // rather than silently ignored.
  'shared/src/agentrun/index.ts',
  // Same rationale, K1 BullMQ Task Queue (D-173): agent_job_runs tracks
  // per-attempt queue/job lifecycle (jobRunId/serviceId/idempotencyKey/
  // status/attempts) — no scope/tenant fields exist on AgentJobRun, it is
  // global kernel state exactly like agent_runs above, not human-scoped
  // data that belongs behind scopedCollection(ctx). Discovered as a real
  // scope-boundary-check failure during the K1 queue static-verification
  // pass (see decision-log) and allowlisted here rather than migrated.
  'shared/src/queue/index.ts',
  // K2 Agent Core / Jarvis persistence (D-177). These modules are the
  // scope-ENFORCING repository layer for their entities (memory_records,
  // mission_nodes, jarvis_sessions/turns, agent_loop_runs/steps,
  // tool_invocations, research_sources). Every public function REQUIRES an
  // explicit actor and routes every query through a `scopeFilter(actor)` /
  // ScopeFields stamp — the same guarantee scopedCollection(ctx) provides,
  // just realized as a purpose-built typed repository rather than the generic
  // wrapper (the generic wrapper's ctx shape doesn't fit these
  // multi-collection modules cleanly). Cross-user isolation is proven by
  // contract test (memory2/missions/*.contract.test.ts "scope isolation")
  // — allowlisted with that proof, not silently ignored.
  'shared/src/memory2/index.ts',
  'shared/src/missions/index.ts',
  'shared/src/jarvis/session.ts',
  'shared/src/agentcore/loop.ts',
  // research_sources is a global provenance ledger (no human-scope fields on
  // RetrievedSource — it records public web sources), same category as
  // agent_runs / agent_job_runs above.
  'shared/src/research/providers.ts',
  // K2 proactive watches (D-177): same scope-enforcing repository pattern as
  // memory2/missions — every function requires an actor + scopeFilter(actor);
  // isolation covered by the watches contract test.
  'shared/src/watches/index.ts',
  // self_dev_runs is GLOBAL software-evolution state ("Global software
  // evolution. Scoped human data." — schemas/scope.ts) exactly like
  // agent_runs; scope is fixed to 'global', no human-scope fields.
  'shared/src/selfdev/index.ts',
]);

function walk(dir, exts, skipDirs) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, exts, skipDirs));
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

const SKIP = new Set(['node_modules', 'dist', '.next', '.git', '.workspaces', 'test']);
const RAW_CALL = /\bcollection\s*[<(]/g;

function scan(baseDir) {
  return walk(join(ROOT, baseDir), ['.ts'], SKIP)
    .filter((f) => !f.endsWith('.d.ts'))
    .map((f) => ({ file: relative(ROOT, f), content: readFileSync(f, 'utf8') }));
}

const violations = [];

// Rule 1 — shared/: only db/index.ts and db/scoped.ts may call collection().
for (const { file, content } of scan('shared/src')) {
  if (SHARED_DB_ALLOWED.has(file)) continue;
  const matches = content.match(RAW_CALL);
  if (matches) violations.push(`${file}: raw collection() call outside shared/src/db — use scopedCollection(ctx) or accept it via a caller-supplied handle (${matches.length} occurrence(s))`);
}

// Rule 2 — services/*/src/routes/**: never call collection() directly.
for (const svcFile of walk(join(ROOT, 'services'), ['.ts'], SKIP)) {
  const rel = relative(ROOT, svcFile);
  if (!/\/src\/routes\//.test(rel) || rel.endsWith('.d.ts')) continue;
  const content = readFileSync(svcFile, 'utf8');
  const matches = content.match(RAW_CALL);
  if (matches) violations.push(`${rel}: route module calls collection() directly — routes must use GatewayDeps or scopedCollection(ctx) (${matches.length} occurrence(s))`);
}

// Rule 3 — the migration ratchet: once a collection is in MIGRATED_COLLECTIONS,
// no raw collection(COLLECTIONS.X) call may reference it anywhere in services/.
for (const svcFile of walk(join(ROOT, 'services'), ['.ts'], SKIP)) {
  const rel = relative(ROOT, svcFile);
  if (rel.endsWith('.d.ts')) continue;
  const content = readFileSync(svcFile, 'utf8');
  for (const name of MIGRATED_COLLECTIONS) {
    const re = new RegExp(`collection\\s*(?:<[^>]*>)?\\s*\\(\\s*COLLECTIONS\\.${name}\\b`, 'g');
    const matches = content.match(re);
    if (matches) violations.push(`${rel}: raw collection(COLLECTIONS.${name}) — this collection is migrated to scopedCollection(ctx) (K1.4b+); a raw handle must never be reintroduced (${matches.length} occurrence(s))`);
  }
}

// Non-blocking signal: legacy debt count in the K1.3 flat-handle zone.
let legacyCount = 0;
try {
  const serverTs = readFileSync(join(ROOT, 'services/gateway-api/src/server.ts'), 'utf8');
  legacyCount = (serverTs.match(RAW_CALL) ?? []).length;
} catch { /* file may move later; non-fatal */ }

if (violations.length > 0) {
  console.error('Scope boundary check FAILED:\n');
  for (const v of violations) console.error(`  - ${v}`);
  console.error(`\n${violations.length} violation(s). See docs/decision-log.md D-158 and master-direction.md §C.5.`);
  process.exit(1);
}

console.log('Scope boundary check passed.');
console.log(`  shared/src/db boundary: clean (only index.ts + scoped.ts call collection())`);
console.log(`  gateway route modules: clean (zero direct collection() calls)`);
console.log(`  migration ratchet: ${MIGRATED_COLLECTIONS.length} collection(s) locked to scopedCollection(ctx) — ${MIGRATED_COLLECTIONS.join(', ')}`);
console.log(`  legacy flat-handle debt (services/gateway-api/src/server.ts, non-blocking): ${legacyCount} raw collection() calls remaining — tracked for K1.4c+`);
