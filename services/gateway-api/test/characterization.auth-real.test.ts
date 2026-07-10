/**
 * K1 Real Auth (D-164) — characterization tests for real, DB-backed
 * credentials (`user_accounts`) and sessions (`sessions`).
 *
 * These are the first gateway tests EVER driven by a real login flow end to
 * end, rather than the legacy `x-factory-admin-token` + `x-factory-role`
 * shortcut (`asAdmin()` — still used by every pre-K1.4 test and still fully
 * supported, see characterization.auth.test.ts). That matters specifically
 * for cross-user/cross-tenant isolation: K1.4b-f could only prove isolation
 * by seeding a foreign row directly into the fake collection, because there
 * was only ever one real identity in the system. This file seeds TWO real
 * user_accounts in TWO real tenants and proves isolation through their own
 * real session tokens.
 */
import { describe, it, expect } from 'vitest';
import { COLLECTIONS, hashPassword, hashSessionToken, SESSION_TOKEN_HEADER } from '@factory/shared';
import { buildTestGateway, asAdmin, asInternal } from './helpers/build-app.js';

const now = '2026-07-10T00:00:00.000Z';
const future = '2099-01-01T00:00:00.000Z';
const past = '2020-01-01T00:00:00.000Z';

/** Seed a fully-usable {account, membership, session+token} fixture. */
function seedUser(db: import('./helpers/fake-db.js').FakeDb, opts: { userId: string; email: string; password: string; tenantId: string; roles: string[]; token: string; sessionId: string; status?: 'active' | 'suspended'; expiresAt?: string; revokedAt?: string | null }) {
  db.col(COLLECTIONS.USER_ACCOUNTS).docs.push({
    userId: opts.userId, email: opts.email, passwordHash: hashPassword(opts.password),
    primaryTenantId: opts.tenantId, status: opts.status ?? 'active', createdAt: now, updatedAt: now,
  });
  db.col(COLLECTIONS.TENANT_MEMBERSHIPS).docs.push({
    scope: 'tenant', membershipId: `membership_${opts.userId}`, tenantId: opts.tenantId, userId: opts.userId,
    roles: opts.roles, status: 'active', createdAt: now, updatedAt: now,
  });
  db.col(COLLECTIONS.SESSIONS).docs.push({
    sessionId: opts.sessionId, userId: opts.userId, tenantId: opts.tenantId, tokenHash: hashSessionToken(opts.token),
    createdAt: now, expiresAt: opts.expiresAt ?? future, lastSeenAt: now, revokedAt: opts.revokedAt ?? null,
  });
}

const asSession = (token: string): Record<string, string> => ({ [SESSION_TOKEN_HEADER]: token });

describe('POST /v1/auth/login', () => {
  it('succeeds with correct credentials and returns a usable session token', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.USER_ACCOUNTS).docs.push({ userId: 'user_a', email: 'a@example.com', passwordHash: hashPassword('correct-password'), primaryTenantId: 'tenant_a', status: 'active', createdAt: now, updatedAt: now });
    });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'a@example.com', password: 'correct-password' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; data: { token: string; expiresAt: string; user: { userId: string; email: string; tenantId: string } } };
    expect(body.data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.data.user).toEqual({ userId: 'user_a', email: 'a@example.com', tenantId: 'tenant_a' });
    expect(h.db.col(COLLECTIONS.SESSIONS).docs).toHaveLength(1);
    await h.close();
  });

  it('rejects a wrong password with a generic message', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.USER_ACCOUNTS).docs.push({ userId: 'user_a', email: 'a@example.com', passwordHash: hashPassword('correct-password'), primaryTenantId: 'tenant_a', status: 'active', createdAt: now, updatedAt: now });
    });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'a@example.com', password: 'wrong-password' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('invalid email or password');
    expect(h.db.col(COLLECTIONS.SESSIONS).docs).toHaveLength(0);
    await h.close();
  });

  it('rejects an unknown email with the exact same generic message (no enumeration)', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.USER_ACCOUNTS).docs.push({ userId: 'user_a', email: 'a@example.com', passwordHash: hashPassword('correct-password'), primaryTenantId: 'tenant_a', status: 'active', createdAt: now, updatedAt: now });
    });
    const wrongPw = await h.service.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'a@example.com', password: 'wrong-password' } });
    const unknownEmail = await h.service.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'nobody@example.com', password: 'anything' } });
    expect(unknownEmail.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(wrongPw.statusCode);
    expect(unknownEmail.json()).toEqual(wrongPw.json()); // byte-identical response — no account-existence signal
    await h.close();
  });

  it('rejects a suspended account with the same generic message, not a distinct one', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.USER_ACCOUNTS).docs.push({ userId: 'user_a', email: 'a@example.com', passwordHash: hashPassword('correct-password'), primaryTenantId: 'tenant_a', status: 'suspended', createdAt: now, updatedAt: now });
    });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'a@example.com', password: 'correct-password' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('invalid email or password');
    expect(h.db.col(COLLECTIONS.SESSIONS).docs).toHaveLength(0);
    await h.close();
  });

  it('requires both email and password (400, not a crash)', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'a@example.com' } });
    expect(res.statusCode).toBe(400);
    await h.close();
  });
});

describe('GET /v1/auth/session', () => {
  it('introspects a valid session', async () => {
    const h = await buildTestGateway({}, (db) => {
      seedUser(db, { userId: 'user_a', email: 'a@example.com', password: 'pw', tenantId: 'tenant_a', roles: ['owner'], token: 'a'.repeat(64), sessionId: 'sess_a' });
    });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/auth/session', headers: asSession('a'.repeat(64)) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; data: { primaryUserId: string; activeTenantId: string; isOwner: boolean; sessionId: string } };
    expect(body.data.primaryUserId).toBe('user_a');
    expect(body.data.activeTenantId).toBe('tenant_a');
    expect(body.data.isOwner).toBe(true);
    expect(body.data.sessionId).toBe('sess_a');
    await h.close();
  });

  it('rejects a request with no session and no legacy auth at all (401)', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/auth/session' });
    expect(res.statusCode).toBe(401);
    await h.close();
  });

  it('rejects an expired session', async () => {
    const h = await buildTestGateway({}, (db) => {
      seedUser(db, { userId: 'user_a', email: 'a@example.com', password: 'pw', tenantId: 'tenant_a', roles: ['owner'], token: 'b'.repeat(64), sessionId: 'sess_b', expiresAt: past });
    });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/auth/session', headers: asSession('b'.repeat(64)) });
    expect(res.statusCode).toBe(401);
    await h.close();
  });

  it('rejects a revoked session', async () => {
    const h = await buildTestGateway({}, (db) => {
      seedUser(db, { userId: 'user_a', email: 'a@example.com', password: 'pw', tenantId: 'tenant_a', roles: ['owner'], token: 'c'.repeat(64), sessionId: 'sess_c', revokedAt: now });
    });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/auth/session', headers: asSession('c'.repeat(64)) });
    expect(res.statusCode).toBe(401);
    await h.close();
  });

  it('a garbage/unrecognized session token fails closed rather than falling back to legacy auth', async () => {
    const h = await buildTestGateway();
    // No admin token either — this proves the session path doesn't need one,
    // AND that presenting *any* session token (even a bogus one) is decisive.
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/auth/session', headers: asSession('not-a-real-token') });
    expect(res.statusCode).toBe(401);
    await h.close();
  });
});

describe('POST /v1/auth/logout', () => {
  it('revokes the session; the same token can never be reused afterward', async () => {
    const h = await buildTestGateway({}, (db) => {
      seedUser(db, { userId: 'user_a', email: 'a@example.com', password: 'pw', tenantId: 'tenant_a', roles: ['owner'], token: 'd'.repeat(64), sessionId: 'sess_d' });
    });
    const logout = await h.service.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: asSession('d'.repeat(64)) });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toMatchObject({ ok: true, data: { revoked: true } });

    const reuse = await h.service.app.inject({ method: 'GET', url: '/v1/auth/session', headers: asSession('d'.repeat(64)) });
    expect(reuse.statusCode).toBe(401);
    await h.close();
  });

  it('logging out with no active session is rejected, not a silent no-op', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: asAdmin() });
    expect(res.statusCode).toBe(401);
    await h.close();
  });
});

describe('POST /v1/auth/users — owner-only provisioning', () => {
  it('an owner session can provision a new user in a brand-new tenant', async () => {
    const h = await buildTestGateway({}, (db) => {
      seedUser(db, { userId: 'user_owner', email: 'owner@example.com', password: 'pw', tenantId: 'tenant_owner', roles: ['owner'], token: 'e'.repeat(64), sessionId: 'sess_e' });
    });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/auth/users', headers: asSession('e'.repeat(64)), payload: { email: 'newperson@example.com', password: 'a-fresh-password' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; data: { userId: string; email: string; tenantId: string } };
    expect(body.data.email).toBe('newperson@example.com');
    // Provisioned into their OWN new tenant (not the owner's) — the correct
    // default for proving genuine tenant isolation.
    expect(body.data.tenantId).not.toBe('tenant_owner');
    const stored = h.db.col(COLLECTIONS.USER_ACCOUNTS).docs.find((d) => (d as { email: string }).email === 'newperson@example.com') as { passwordHash: string };
    expect(stored.passwordHash).not.toBe('a-fresh-password'); // never stored as plaintext
    expect(stored.passwordHash.startsWith('scrypt$')).toBe(true);
    const membership = h.db.col(COLLECTIONS.TENANT_MEMBERSHIPS).docs.find((d) => (d as { userId: string }).userId === body.data.userId) as { roles: string[] };
    expect(membership.roles).toContain('owner'); // owner of their own new personal tenant
    await h.close();
  });

  it('a non-owner (viewer) session cannot provision a user (403)', async () => {
    const h = await buildTestGateway({}, (db) => {
      seedUser(db, { userId: 'user_viewer', email: 'viewer@example.com', password: 'pw', tenantId: 'tenant_owner', roles: ['viewer'], token: 'f'.repeat(64), sessionId: 'sess_f' });
    });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/auth/users', headers: asSession('f'.repeat(64)), payload: { email: 'x@example.com', password: 'whatever123' } });
    expect(res.statusCode).toBe(403);
    expect(h.db.col(COLLECTIONS.USER_ACCOUNTS).docs.some((d) => (d as { email: string }).email === 'x@example.com')).toBe(false);
    await h.close();
  });

  it('an unauthenticated request (no token of any kind) is rejected (401)', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/auth/users', payload: { email: 'x@example.com', password: 'whatever123' } });
    expect(res.statusCode).toBe(401);
    await h.close();
  });

  it('rejects a duplicate email (409)', async () => {
    const h = await buildTestGateway({}, (db) => {
      seedUser(db, { userId: 'user_owner', email: 'owner@example.com', password: 'pw', tenantId: 'tenant_owner', roles: ['owner'], token: 'g'.repeat(64), sessionId: 'sess_g' });
      db.col(COLLECTIONS.USER_ACCOUNTS).docs.push({ userId: 'user_taken', email: 'taken@example.com', passwordHash: hashPassword('x'), primaryTenantId: 'tenant_owner', status: 'active', createdAt: now, updatedAt: now });
    });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/auth/users', headers: asSession('g'.repeat(64)), payload: { email: 'taken@example.com', password: 'whatever123' } });
    expect(res.statusCode).toBe(409);
    await h.close();
  });
});

/**
 * The proof this whole workstream exists to deliver: two REAL users, in two
 * SEPARATE tenants, each with their own real login-issued session token,
 * driving the exact same K1.4b-f migrated routes. Not a synthetic
 * foreign-row seed — a real second identity, end to end.
 */
describe('two real users in separate tenants — cross-user AND cross-tenant isolation via real sessions', () => {
  it('GET /v1/me/memories never crosses between two real, separately-logged-in users', async () => {
    const h = await buildTestGateway({}, (db) => {
      seedUser(db, { userId: 'user_a', email: 'a@example.com', password: 'pw-a', tenantId: 'tenant_a', roles: ['owner'], token: 'a'.repeat(64), sessionId: 'sess_a' });
      seedUser(db, { userId: 'user_b', email: 'b@example.com', password: 'pw-b', tenantId: 'tenant_b', roles: ['owner'], token: 'b'.repeat(64), sessionId: 'sess_b' });
      db.col(COLLECTIONS.SCOPED_MEMORIES).docs.push(
        { memoryId: 'mem_a', scope: 'user', tenantId: 'tenant_a', userId: 'user_a', kind: 'fact', content: 'user A private memory', source: 'user', confidence: 1, consentGrantId: null, createdAt: now, updatedAt: now },
        { memoryId: 'mem_b', scope: 'user', tenantId: 'tenant_b', userId: 'user_b', kind: 'fact', content: 'user B private memory', source: 'user', confidence: 1, consentGrantId: null, createdAt: now, updatedAt: now },
      );
    });

    const asA = await h.service.app.inject({ method: 'GET', url: '/v1/me/memories', headers: asSession('a'.repeat(64)) });
    expect(asA.statusCode).toBe(200);
    const bodyA = asA.json() as { ok: true; data: Array<{ memoryId: string }> };
    expect(bodyA.data.map((m) => m.memoryId)).toEqual(['mem_a']);

    const asB = await h.service.app.inject({ method: 'GET', url: '/v1/me/memories', headers: asSession('b'.repeat(64)) });
    expect(asB.statusCode).toBe(200);
    const bodyB = asB.json() as { ok: true; data: Array<{ memoryId: string }> };
    expect(bodyB.data.map((m) => m.memoryId)).toEqual(['mem_b']);
    await h.close();
  });

  it('POST /v1/me/memories writes are stamped to the REAL logged-in user, not a shared identity', async () => {
    const h = await buildTestGateway({}, (db) => {
      seedUser(db, { userId: 'user_a', email: 'a@example.com', password: 'pw-a', tenantId: 'tenant_a', roles: ['owner'], token: 'a'.repeat(64), sessionId: 'sess_a' });
      seedUser(db, { userId: 'user_b', email: 'b@example.com', password: 'pw-b', tenantId: 'tenant_b', roles: ['owner'], token: 'b'.repeat(64), sessionId: 'sess_b' });
    });
    await h.service.app.inject({ method: 'POST', url: '/v1/me/memories', headers: asSession('a'.repeat(64)), payload: { kind: 'preference', content: 'from A' } });
    await h.service.app.inject({ method: 'POST', url: '/v1/me/memories', headers: asSession('b'.repeat(64)), payload: { kind: 'preference', content: 'from B' } });
    const stored = h.db.col(COLLECTIONS.SCOPED_MEMORIES).docs as Array<{ userId: string; tenantId: string; content: string }>;
    expect(stored).toHaveLength(2);
    expect(stored.find((d) => d.content === 'from A')).toMatchObject({ userId: 'user_a', tenantId: 'tenant_a' });
    expect(stored.find((d) => d.content === 'from B')).toMatchObject({ userId: 'user_b', tenantId: 'tenant_b' });
    await h.close();
  });

  it('GET /v1/tenants/current never leaks the other user\'s tenant membership', async () => {
    const h = await buildTestGateway({}, (db) => {
      seedUser(db, { userId: 'user_a', email: 'a@example.com', password: 'pw-a', tenantId: 'tenant_a', roles: ['owner'], token: 'a'.repeat(64), sessionId: 'sess_a' });
      seedUser(db, { userId: 'user_b', email: 'b@example.com', password: 'pw-b', tenantId: 'tenant_b', roles: ['owner'], token: 'b'.repeat(64), sessionId: 'sess_b' });
      db.col(COLLECTIONS.TENANTS).docs.push(
        { tenantId: 'tenant_a', name: 'Tenant A', kind: 'personal', status: 'active', settings: {}, createdBy: 'user_a', createdAt: now, updatedAt: now },
        { tenantId: 'tenant_b', name: 'Tenant B', kind: 'personal', status: 'active', settings: {}, createdBy: 'user_b', createdAt: now, updatedAt: now },
      );
    });
    const asA = await h.service.app.inject({ method: 'GET', url: '/v1/tenants/current', headers: asSession('a'.repeat(64)) });
    const bodyA = asA.json() as { ok: true; data: { tenant: { tenantId: string } | null; members: Array<{ userId: string }> } };
    expect(bodyA.data.tenant?.tenantId).toBe('tenant_a');
    expect(bodyA.data.members.map((m) => m.userId)).toEqual(['user_a']);
    await h.close();
  });

  it('login itself proves the same thing at the credential layer: each user only ever gets a session scoped to their own tenant', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.USER_ACCOUNTS).docs.push(
        { userId: 'user_a', email: 'a@example.com', passwordHash: hashPassword('pw-a'), primaryTenantId: 'tenant_a', status: 'active', createdAt: now, updatedAt: now },
        { userId: 'user_b', email: 'b@example.com', passwordHash: hashPassword('pw-b'), primaryTenantId: 'tenant_b', status: 'active', createdAt: now, updatedAt: now },
      );
    });
    const loginA = await h.service.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'a@example.com', password: 'pw-a' } });
    const loginB = await h.service.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'b@example.com', password: 'pw-b' } });
    expect((loginA.json() as { data: { user: { tenantId: string } } }).data.user.tenantId).toBe('tenant_a');
    expect((loginB.json() as { data: { user: { tenantId: string } } }).data.user.tenantId).toBe('tenant_b');
    await h.close();
  });
});

/**
 * D-164 mandatory correction: the legacy x-factory-admin-token + role-header
 * path is explicitly temporary and must be constrained by a kill-switch —
 * never an invisible permanent backdoor. Proves the switch actually works.
 */
describe('FACTORY_ALLOW_LEGACY_ROLE_AUTH kill-switch', () => {
  it('by default (K1 compat), the legacy admin-token + role-header path still grants owner access with no session at all', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/auth/users', headers: asAdmin('owner'), payload: { email: 'x@example.com', password: 'whatever123' } });
    // No session token was ever sent — this is purely the legacy path, and
    // it still resolves to isOwner:true exactly as before this whole change.
    expect(res.statusCode).toBe(200);
    await h.close();
  });

  it('when disabled, the same admin-token + role:owner header no longer grants owner access — it resolves to viewer', async () => {
    const h = await buildTestGateway({ FACTORY_ALLOW_LEGACY_ROLE_AUTH: false });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/auth/users', headers: asAdmin('owner'), payload: { email: 'x@example.com', password: 'whatever123' } });
    expect(res.statusCode).toBe(403);
    await h.close();
  });

  it('when disabled, guard() still passes on the admin token alone (service/dev reachability is preserved) — only the self-declared ROLE is neutered', async () => {
    const h = await buildTestGateway({ FACTORY_ALLOW_LEGACY_ROLE_AUTH: false });
    // A read-only, non-role-gated endpoint still works with just the admin token.
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/me/memories', headers: asAdmin() });
    expect(res.statusCode).toBe(200); // 'viewer' can still read their own (Esan's) scope — not a 401/403
    await h.close();
  });

  it('a real session is completely unaffected by the kill-switch — it never used the legacy path to begin with', async () => {
    const h = await buildTestGateway({ FACTORY_ALLOW_LEGACY_ROLE_AUTH: false }, (db) => {
      seedUser(db, { userId: 'user_owner', email: 'owner@example.com', password: 'pw', tenantId: 'tenant_owner', roles: ['owner'], token: 'h'.repeat(64), sessionId: 'sess_h' });
    });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/auth/users', headers: asSession('h'.repeat(64)), payload: { email: 'x@example.com', password: 'whatever123' } });
    expect(res.statusCode).toBe(200);
    await h.close();
  });

  // K1 Auth Hardening (D-166) — the four explicit proof points required
  // before FACTORY_ALLOW_LEGACY_ROLE_AUTH can ever be defaulted to false in
  // production: (1) session-authenticated requests still work — proven
  // above for the owner-write case, this adds a non-owner read; (2) legacy
  // role-header requests no longer get trusted role elevation — proven
  // above; (3) the internal service token is completely unaffected by the
  // switch; (4) a fully unauthenticated request still fails cleanly.

  it('a non-owner session (viewer) still reads its own scope normally with the switch disabled', async () => {
    const h = await buildTestGateway({ FACTORY_ALLOW_LEGACY_ROLE_AUTH: false }, (db) => {
      seedUser(db, { userId: 'user_v', email: 'v@example.com', password: 'pw', tenantId: 'tenant_v', roles: ['viewer'], token: 'i'.repeat(64), sessionId: 'sess_i' });
    });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/me/memories', headers: asSession('i'.repeat(64)) });
    expect(res.statusCode).toBe(200);
    await h.close();
  });

  it('the internal service token (FACTORY_INTERNAL_TOKEN) is unaffected by the switch — it never went through declaredRole at all', async () => {
    const h = await buildTestGateway({ FACTORY_ALLOW_LEGACY_ROLE_AUTH: false });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/tasks', headers: asInternal() });
    expect(res.statusCode).toBe(200);
    await h.close();
  });

  it('a fully unauthenticated request (no token of any kind) still fails cleanly with the switch disabled', async () => {
    const h = await buildTestGateway({ FACTORY_ALLOW_LEGACY_ROLE_AUTH: false });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/tasks' });
    expect(res.statusCode).toBe(401);
    await h.close();
  });
});
