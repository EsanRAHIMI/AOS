import { timingSafeEqual, randomBytes, scryptSync, createHash } from 'node:crypto';
import { INTERNAL_TOKEN_HEADER, ADMIN_TOKEN_HEADER, SESSION_TOKEN_HEADER } from '../constants/index.js';

/** Constant-time string comparison to avoid timing attacks on token checks. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface TokenCheckInput {
  headers: Record<string, string | string[] | undefined>;
  expectedInternalToken: string;
  expectedAdminToken?: string;
}

function headerValue(h: TokenCheckInput['headers'], name: string): string {
  const v = h[name] ?? h[name.toLowerCase()];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

/** True when the request carries a valid internal service token. */
export function hasValidInternalToken(input: TokenCheckInput): boolean {
  const provided = headerValue(input.headers, INTERNAL_TOKEN_HEADER);
  return provided.length > 0 && safeEqual(provided, input.expectedInternalToken);
}

/** True when the request carries a valid admin token (human/dashboard). */
export function hasValidAdminToken(input: TokenCheckInput): boolean {
  if (!input.expectedAdminToken) return false;
  const provided = headerValue(input.headers, ADMIN_TOKEN_HEADER);
  return provided.length > 0 && safeEqual(provided, input.expectedAdminToken);
}

export { INTERNAL_TOKEN_HEADER, ADMIN_TOKEN_HEADER, SESSION_TOKEN_HEADER };

/* ===========================================================================
 * K1 Real Auth (D-164) — password hashing + session token helpers.
 *
 * Password format `scrypt$<saltHex>$<hashHex>` is IDENTICAL to the format
 * dashboard-web's src/lib/auth.ts and scripts/hash-password.mjs already use,
 * deliberately — an existing DASHBOARD_ADMIN_PASSWORD_HASH value can be
 * reused verbatim as a UserAccount.passwordHash with zero conversion.
 *
 * Security note (mandatory correction from decision-log D-164): these
 * functions never generate, log, or return a plaintext password. Callers
 * that need to provision a credential must already possess one (a pre-hashed
 * value from config, or a plaintext the CALLER collected out-of-band, e.g. a
 * login form field) — nothing in this module invents one.
 * ======================================================================== */

/** Hash a caller-supplied plaintext password. Never call this with a
 *  generated/random password — see the module note above. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time verification against a stored `scrypt$<salt>$<hash>` value.
 *  Returns false (never throws) for any malformed hash. */
export function verifyPasswordHash(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex || !/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return false;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const derived = scryptSync(password, salt, expected.length);
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** A fresh opaque bearer session token. Returned to the caller exactly once
 *  (at login) — only its hash (see below) is ever persisted. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/** sha256 is sufficient here (unlike passwords, a session token is already
 *  256 bits of high-entropy random data — there is nothing for scrypt's
 *  deliberate slowness to defend against, and a fast hash keeps every
 *  authenticated request cheap). */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
