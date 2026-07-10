/**
 * K1 Real Auth dashboard bridge (D-165). Pure fetch wrappers around the
 * gateway's real session endpoints, plus the auth-header builder they feed.
 * Deliberately has NO `server-only` import (unlike lib/gateway.ts) so this
 * module stays unit-testable in isolation; in practice it is only ever
 * imported from server-only callers (`app/login/actions.ts`, `lib/gateway.ts`).
 *
 * Every function here is best-effort and never throws: a missing or
 * mismatched gateway `user_accounts` row must degrade to the legacy
 * admin-token + role-header path (see decision-log D-164), not break login.
 */
const API = process.env.FACTORY_API_URL ?? 'http://localhost:4101';

/** Must match SESSION_TOKEN_HEADER in shared/src/constants/index.ts. Not
 * imported directly — dashboard-web deliberately stays decoupled from
 * @factory/shared (see lib/rbac.ts for the same pattern). */
export const SESSION_TOKEN_HEADER = 'x-factory-session-token';

export interface GatewaySession {
  token: string;
  expiresAt: string;
}

interface LoginEnvelope {
  ok: boolean;
  data?: { token?: string; expiresAt?: string };
}

/**
 * Attempt a real gateway login with the same credentials the dashboard just
 * verified locally. Returns null (never throws) if the gateway has no
 * matching, active `user_accounts` row — expected for dev-only demo logins
 * and any operator not yet provisioned via `POST /v1/auth/users`.
 */
export async function gatewayLogin(email: string, password: string): Promise<GatewaySession | null> {
  try {
    const res = await fetch(`${API}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as LoginEnvelope;
    if (!body.ok || !body.data?.token || !body.data.expiresAt) return null;
    return { token: body.data.token, expiresAt: body.data.expiresAt };
  } catch {
    return null;
  }
}

/**
 * Revoke a real gateway session at dashboard logout. Best-effort — a failure
 * here must never block the dashboard's own sign-out; an unrevoked token
 * still naturally expires at its TTL.
 */
export async function gatewayLogout(token: string): Promise<void> {
  try {
    await fetch(`${API}/v1/auth/logout`, {
      method: 'POST',
      headers: { [SESSION_TOKEN_HEADER]: token },
      cache: 'no-store',
    });
  } catch {
    // best-effort, see above.
  }
}

export interface AuthHeaderSession {
  role?: string;
  gatewaySessionToken?: string;
}

/**
 * Build the auth headers for a gateway request.
 *
 * The admin token is always included — it is what satisfies `guard()` on
 * the gateway for service/dev reachability regardless of session state (see
 * D-164), and is never the sole signal of *who* is acting.
 *
 * When a real bridged gateway session token is present, it is forwarded and
 * takes strict priority on the gateway side: once `x-factory-session-token`
 * is declared, the gateway resolves the actor from the session ONLY (never
 * falling back to the role header, fail-closed if the token is invalid or
 * expired — see decision-log D-164). Sending the legacy role header
 * alongside it is therefore harmless, not a fallback path.
 *
 * When no bridged token exists (dev-only demo logins, or an operator not
 * yet provisioned in the gateway's `user_accounts`), the role header is the
 * dashboard's only way to declare who is signed in — the temporary,
 * K1-compatibility legacy path, gated gateway-side by
 * `FACTORY_ALLOW_LEGACY_ROLE_AUTH`.
 */
export function buildAuthHeaders(adminToken: string, session: AuthHeaderSession | null): Record<string, string> {
  const headers: Record<string, string> = { 'x-factory-admin-token': adminToken };
  if (session?.role) headers['x-factory-role'] = session.role;
  if (session?.gatewaySessionToken) headers[SESSION_TOKEN_HEADER] = session.gatewaySessionToken;
  return headers;
}
