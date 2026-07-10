/**
 * Server-only authentication. Verifies credentials (scrypt hash or, in dev,
 * a plain env password) and manages the secure session cookie. The admin/internal
 * tokens never appear here — only the dashboard's own login.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { SESSION_COOKIE, signSession, verifySession, sessionSecret, type SessionPayload, type SessionRole } from './session';

interface ConfiguredUser {
  email: string;
  role: SessionRole;
  passwordHash?: string; // format: scrypt$<saltHex>$<hashHex>
  password?: string; // dev-only plaintext fallback
}

const HEX = /^[0-9a-f]+$/i;

/** Dynamic lookup so Next.js does not inline empty env at compile time. */
function env(key: string): string | undefined {
  return process.env[key];
}

function validScryptHash(hash: string | undefined): string | undefined {
  const h = hash?.trim();
  if (!h || !h.startsWith('scrypt$')) return undefined;
  const [, saltHex, hashHex] = h.split('$');
  if (!saltHex || !hashHex || !HEX.test(saltHex) || !HEX.test(hashHex)) return undefined;
  return h;
}

/** Build the user list from env. In non-production, seed demo users if none set. */
function configuredUsers(): ConfiguredUser[] {
  const users: ConfiguredUser[] = [];
  const add = (email: string | undefined, hash: string | undefined, pw: string | undefined, role: SessionRole) => {
    const e = email?.trim();
    if (!e) return;
    const passwordHash = validScryptHash(hash);
    const password = passwordHash ? undefined : pw?.trim() || undefined;
    // Skip half-configured users (email only) so they don't disable dev demo logins.
    if (!passwordHash && !password) return;
    users.push({ email: e.toLowerCase(), passwordHash, password, role });
  };
  add(env('DASHBOARD_ADMIN_EMAIL'), env('DASHBOARD_ADMIN_PASSWORD_HASH'), env('DASHBOARD_ADMIN_PASSWORD'), 'owner');
  add(env('DASHBOARD_OPERATOR_EMAIL'), env('DASHBOARD_OPERATOR_PASSWORD_HASH'), env('DASHBOARD_OPERATOR_PASSWORD'), 'operator');
  add(env('DASHBOARD_VIEWER_EMAIL'), env('DASHBOARD_VIEWER_PASSWORD_HASH'), env('DASHBOARD_VIEWER_PASSWORD'), 'viewer');
  if (env('NODE_ENV') !== 'production') {
    // Dev: always seed demo logins (even when a custom admin is configured).
    const demos: ConfiguredUser[] = [
      { email: 'owner@local', password: 'owner', role: 'owner' },
      { email: 'operator@local', password: 'operator', role: 'operator' },
      { email: 'viewer@local', password: 'viewer', role: 'viewer' },
    ];
    for (const d of demos) {
      if (!users.some((u) => u.email === d.email)) users.push(d);
    }
  }
  return users;
}

function verifyPassword(input: string, user: ConfiguredUser): boolean {
  if (user.passwordHash) {
    const [scheme, saltHex, hashHex] = user.passwordHash.split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    try {
      const expected = Buffer.from(hashHex, 'hex');
      const derived = scryptSync(input, Buffer.from(saltHex, 'hex'), expected.length);
      return derived.length === expected.length && timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }
  if (user.password) {
    const a = Buffer.from(input);
    const b = Buffer.from(user.password);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  return false;
}

/** Returns the authenticated user (role) or null. Constant-time password checks. */
export function authenticate(email: string, password: string): { email: string; role: SessionRole } | null {
  const target = email.trim().toLowerCase();
  const user = configuredUsers().find((u) => u.email === target);
  if (!user) return null;
  if (!verifyPassword(password, user)) return null;
  return { email: user.email, role: user.role };
}

const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

/**
 * `gatewaySessionToken` (K1 Real Auth bridge, D-165): the real gateway
 * bearer session token, when the same credentials also matched a gateway
 * `user_accounts` row. Stored inside this same signed, httpOnly cookie —
 * not a new exposure surface, same protection tier as the rest of the
 * payload. Optional and absent for dev-only demo logins.
 */
export async function createSessionCookie(email: string, role: SessionRole, gatewaySessionToken?: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { email, role, iat: now, exp: now + SESSION_TTL_SECONDS };
  if (gatewaySessionToken) payload.gatewaySessionToken = gatewaySessionToken;
  const token = await signSession(payload, sessionSecret());
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token, sessionSecret());
}
