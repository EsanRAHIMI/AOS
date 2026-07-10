/**
 * Gateway routes — auth group (K1 Real Auth, D-164).
 *
 * Real, DB-backed credentials (`user_accounts`) + sessions (`sessions`).
 * Distinct from two other things this codebase already has:
 *  - FACTORY_INTERNAL_TOKEN service-to-service auth — completely untouched.
 *  - The legacy `x-factory-admin-token` + `x-factory-role` self-declared-role
 *    path — still available (see server.ts guard/declaredRole and
 *    FACTORY_ALLOW_LEGACY_ROLE_AUTH), explicitly temporary K1 compatibility
 *    scaffolding, not replaced by this file. See decision-log D-164.
 */
import { ERROR_CODES, EVENT_TYPES, failure, genId, generateSessionToken, hashPassword, hashSessionToken, nowIso, success, verifyPasswordHash } from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps } from './deps.js';

const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h — matches dashboard-web's existing session TTL.

// Defense against email enumeration: when no account matches, still run a
// verifyPasswordHash against this fixed dummy hash so a "wrong password" and
// an "unknown email" response take a comparable amount of time and return
// the exact same generic message.
const DUMMY_HASH = hashPassword('no-such-account-placeholder');

export function registerAuthRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { ctx, guard, deny, declaredRole, resolveAuth, writeAudit, writeSecEvent, rateLimited, clientIp, userAgent, userAccounts, sessionsCol, provisionUser } = deps;

  app.post<{ Body: { email?: string; password?: string } }>('/v1/auth/login', async (req, reply) => {
    if (await rateLimited(req, reply, 'auth_login')) return reply;
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const genericDenied = async (actorId: string, detail: string) => {
      await writeSecEvent({ eventType: EVENT_TYPES.LOGIN_FAILED, actorId, role: 'unknown', ip: clientIp(req), userAgent: userAgent(req), target: 'gateway_login', result: 'failure', riskLevel: 'medium', detail });
      return reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'invalid email or password'));
    };
    if (!email || !password) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'email and password are required'));

    const account = await userAccounts.findOne({ email });
    // Always run verifyPasswordHash, even with no account, against a fixed
    // dummy hash — keeps unknown-email and wrong-password response timing
    // comparable (no account-existence oracle).
    const passwordOk = verifyPasswordHash(password, account?.passwordHash ?? DUMMY_HASH);
    if (!account || !passwordOk) return genericDenied(account?.userId ?? email, 'invalid credentials');
    if (account.status !== 'active') return genericDenied(account.userId, `account status: ${account.status}`); // same generic message — a suspended account must not be distinguishable from a wrong password

    const token = generateSessionToken();
    const now = nowIso();
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
    const sessionId = genId('session');
    await sessionsCol.insertOne({ sessionId, userId: account.userId, tenantId: account.primaryTenantId, tokenHash: hashSessionToken(token), createdAt: now, expiresAt, lastSeenAt: now, revokedAt: null });
    await writeSecEvent({ eventType: EVENT_TYPES.LOGIN_SUCCEEDED, actorId: account.userId, role: 'authenticated_user', ip: clientIp(req), userAgent: userAgent(req), target: 'gateway_login', result: 'success', riskLevel: 'low', detail: `session ${sessionId} issued` });
    return success({ token, expiresAt, user: { userId: account.userId, email: account.email, tenantId: account.primaryTenantId } });
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const actor = resolveAuth(req);
    if (!actor.sessionId) return reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'no active session to log out'));
    await sessionsCol.updateOne({ sessionId: actor.sessionId }, { $set: { revokedAt: nowIso() } });
    await writeSecEvent({ eventType: EVENT_TYPES.LOGOUT, actorId: actor.actorId, role: declaredRole(req), ip: clientIp(req), userAgent: userAgent(req), target: 'gateway_login', result: 'info', riskLevel: 'low', detail: `session ${actor.sessionId} revoked` });
    return success({ revoked: true });
  });

  app.get('/v1/auth/session', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const actor = resolveAuth(req);
    if (!actor.primaryUserId || !actor.sessionId) return reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'no active session'));
    return success({ actorId: actor.actorId, primaryUserId: actor.primaryUserId, activeTenantId: actor.activeTenantId, roles: actor.roles, isOwner: actor.isOwner, sessionId: actor.sessionId });
  });

  // Owner-only. No self-serve signup — provisioning is a deliberate,
  // audited, owner-gated action (see GatewayDeps.provisionUser in server.ts).
  app.post<{ Body: { email?: string; password?: string; passwordHash?: string; tenantId?: string; tenantName?: string; roles?: string[]; displayName?: string } }>('/v1/auth/users', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const actor = resolveAuth(req);
    if (!actor.isOwner) {
      await writeSecEvent({ eventType: EVENT_TYPES.RBAC_DENIED, actorId: actor.actorId, role: declaredRole(req), ip: clientIp(req), userAgent: userAgent(req), target: 'user_provisioning', result: 'denied', riskLevel: 'medium', detail: 'owner role required' });
      return reply.code(403).send(failure(ERROR_CODES.FORBIDDEN, 'owner role required to provision a user'));
    }
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!email) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'email is required'));
    if (await userAccounts.findOne({ email })) return reply.code(409).send(failure(ERROR_CODES.VALIDATION, 'a user with this email already exists'));

    // A human-submitted plaintext password in an authenticated, owner-only
    // request body is hashed immediately and never stored/logged/returned —
    // not the same risk class as the seed/migration correction (D-164),
    // which is specifically about a MACHINE inventing and printing a secret
    // unprompted. passwordHash (pre-hashed) is also accepted for scripted
    // provisioning.
    let passwordHash = req.body?.passwordHash?.trim();
    if (!passwordHash && req.body?.password) passwordHash = hashPassword(req.body.password);
    if (!passwordHash) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'password or passwordHash is required'));

    const account = await provisionUser({ email, passwordHash, tenantId: req.body?.tenantId, tenantName: req.body?.tenantName, roles: req.body?.roles, displayName: req.body?.displayName });
    await writeAudit({ actorType: 'human', actorId: actor.actorId, role: 'owner', action: 'user_provisioned', targetType: 'user_account', targetId: account.userId, after: { email: account.email, tenantId: account.primaryTenantId } });
    await ctx.publisher.publish({ type: EVENT_TYPES.IDENTITY_SEEDED, taskId: null, payload: { tenantId: account.primaryTenantId, userId: account.userId, message: `New user provisioned: ${account.email}` } });
    return success({ userId: account.userId, email: account.email, tenantId: account.primaryTenantId });
  });
}
