#!/usr/bin/env node
/**
 * K1 Real Auth operational provisioning (D-164/D-165/D-166).
 *
 * Thin HTTP client over the gateway's own owner-only `POST /v1/auth/users`.
 * Deliberately does NOT touch Mongo directly and does NOT reimplement any of
 * that route's validation/audit/event-publish logic — one tested code path,
 * not two. This is how operator/viewer (and additional owner) accounts get
 * a real gateway session, closing the gap the owner-only boot-time seed
 * (scripts/migrate-scope-foundation.mjs) deliberately leaves open.
 *
 * Never prints a plaintext password: if --password is given, it is sent
 * once, directly to the gateway over the network (exactly like a real login
 * call — the endpoint hashes it immediately and never logs/stores/returns
 * it), never echoed to this script's own stdout/stderr. Prefer
 * --password-hash (from `node scripts/hash-password.mjs '<password>'`) to
 * avoid typing the plaintext into this process at all.
 *
 * Usage:
 *   FACTORY_API_URL=https://api.example.com FACTORY_ADMIN_TOKEN=<token> \
 *     node scripts/provision-gateway-user.mjs \
 *       --email operator@company.com --role operator \
 *       --password-hash "$(node scripts/hash-password.mjs '<password>')"
 *
 * Auth to call the endpoint itself (some owner identity is required):
 *   --session-token <token>   preferred once a real owner session exists —
 *                             stops relying on the legacy path entirely.
 *   (default, if omitted)     falls back to FACTORY_ADMIN_TOKEN + the legacy
 *                             x-factory-role: owner header — a deliberate,
 *                             documented, temporary bootstrap use of the
 *                             K1-compat fallback (decision-log D-166). This
 *                             is exactly the "CI/internal/dev" carve-out
 *                             D-164 always intended: there is no real owner
 *                             session yet the very first time this runs.
 *
 * Flags:
 *   --email <email>            required
 *   --role owner|operator|viewer   default: viewer (least privilege)
 *   --password-hash <hash>     preferred — see scripts/hash-password.mjs
 *   --password <plaintext>     alternative — hashed server-side, never here
 *   --tenant-id <id>           default: the primary/owner tenant
 *   --new-tenant               provision into a brand-new tenant instead
 *   --display-name <name>
 *   --session-token <token>
 */
import { ESAN_TENANT_ID } from '../shared/dist/index.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const email = arg('email');
const role = arg('role', 'viewer');
const password = arg('password');
const passwordHash = arg('password-hash');
const tenantId = arg('tenant-id', ESAN_TENANT_ID);
const newTenant = has('new-tenant');
const displayName = arg('display-name');
const sessionToken = arg('session-token');

const API = process.env.FACTORY_API_URL ?? 'http://localhost:4101';
const ADMIN_TOKEN = process.env.FACTORY_ADMIN_TOKEN ?? '';

const USAGE =
  'usage: node scripts/provision-gateway-user.mjs --email <email> --role <owner|operator|viewer> ' +
  '[--password-hash <hash> | --password <plaintext>] [--tenant-id <id> | --new-tenant] ' +
  '[--display-name <name>] [--session-token <token>]';

if (!email) {
  console.error(USAGE);
  process.exit(1);
}
if (!password && !passwordHash) {
  console.error('One of --password-hash (preferred) or --password is required. This script never invents or prints a default password.');
  console.error(USAGE);
  process.exit(1);
}
const ROLE_MAP = { owner: ['owner'], operator: ['tenant_operator'], viewer: ['viewer'] };
if (!ROLE_MAP[role]) {
  console.error(`--role must be one of owner|operator|viewer (got "${role}")`);
  process.exit(1);
}
if (!sessionToken && !ADMIN_TOKEN) {
  console.error('Either --session-token or FACTORY_ADMIN_TOKEN is required to call the owner-only provisioning endpoint.');
  process.exit(1);
}

const headers = { 'content-type': 'application/json' };
if (sessionToken) {
  headers['x-factory-session-token'] = sessionToken;
} else {
  headers['x-factory-admin-token'] = ADMIN_TOKEN;
  headers['x-factory-role'] = 'owner';
  console.error(
    '[provision-gateway-user] using the legacy admin-token + role:owner path to bootstrap this ' +
      'account (decision-log D-166) — expected the first time this runs, before any real owner ' +
      'session exists. Prefer --session-token on subsequent runs once the owner has one.',
  );
}

const body = { email, roles: ROLE_MAP[role], displayName };
if (!newTenant) body.tenantId = tenantId;
if (passwordHash) body.passwordHash = passwordHash;
else body.password = password;

const res = await fetch(`${API}/v1/auth/users`, { method: 'POST', headers, body: JSON.stringify(body) });
const json = await res.json().catch(() => ({}));

if (!res.ok || !json.ok) {
  console.error(`Provisioning failed (${res.status}): ${json.error?.message ?? res.statusText}`);
  process.exit(1);
}
console.log(`✓ Provisioned ${json.data.email} as ${role} in tenant ${json.data.tenantId} (userId ${json.data.userId})`);
console.log(
  'Reminder: for the dashboard-web bridge (D-165) to activate for this user, the SAME hash must ' +
    'also be set as the matching DASHBOARD_ADMIN|OPERATOR|VIEWER_PASSWORD_HASH env var.',
);
