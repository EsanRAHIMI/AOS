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

/** Build the user list from env. In non-production, seed demo users if none set. */
function configuredUsers(): ConfiguredUser[] {
  const users: ConfiguredUser[] = [];
  const add = (email: string | undefined, hash: string | undefined, pw: string | undefined, role: SessionRole) => {
    if (email && email.trim()) users.push({ email: email.trim().toLowerCase(), passwordHash: hash || undefined, password: pw || undefined, role });
  };
  add(process.env.DASHBOARD_ADMIN_EMAIL, process.env.DASHBOARD_ADMIN_PASSWORD_HASH, process.env.DASHBOARD_ADMIN_PASSWORD, 'owner');
  add(process.env.DASHBOARD_OPERATOR_EMAIL, process.env.DASHBOARD_OPERATOR_PASSWORD_HASH, process.env.DASHBOARD_OPERATOR_PASSWORD, 'operator');
  add(process.env.DASHBOARD_VIEWER_EMAIL, process.env.DASHBOARD_VIEWER_PASSWORD_HASH, process.env.DASHBOARD_VIEWER_PASSWORD, 'viewer');
  if (users.length === 0 && process.env.NODE_ENV !== 'production') {
    // Local-dev convenience: three demo logins so the RBAC demo runs out of the box.
    users.push({ email: 'owner@local', password: 'owner', role: 'owner' });
    users.push({ email: 'operator@local', password: 'operator', role: 'operator' });
    users.push({ email: 'viewer@local', password: 'viewer', role: 'viewer' });
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

export async function createSessionCookie(email: string, role: SessionRole): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = await signSession({ email, role, iat: now, exp: now + SESSION_TTL_SECONDS }, sessionSecret());
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
