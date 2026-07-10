/**
 * Stateless signed session tokens (HMAC-SHA256 via Web Crypto). Edge-safe so
 * the same verify path runs in middleware and in server actions/components.
 * No secrets ever reach the browser — the token is opaque and HttpOnly.
 */
export const SESSION_COOKIE = 'factory_session';
export type SessionRole = 'owner' | 'operator' | 'viewer';

export interface SessionPayload {
  email: string;
  role: SessionRole;
  iat: number;
  exp: number;
  /**
   * K1 Real Auth bridge (D-165): the real gateway bearer session token
   * (`x-factory-session-token`), obtained via `POST /v1/auth/login` with the
   * same credentials at sign-in time. Present only when the dashboard's
   * email+password also matched a real gateway `user_accounts` row — absent
   * for dev-only demo logins and any operator not yet provisioned in the
   * gateway. Safe to hold here: this payload only ever lives inside the
   * existing httpOnly/secure/sameSite cookie, never reaches the browser's JS.
   * Never falls back to guessing or re-deriving this value client-side.
   */
  gatewaySessionToken?: string;
}

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str: string): Uint8Array {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Copy a view's bytes into a standalone ArrayBuffer (a valid BufferSource). */
function buf(u: Uint8Array): ArrayBuffer {
  return u.slice().buffer as ArrayBuffer;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', buf(encoder.encode(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Dev fallback when DASHBOARD_SESSION_SECRET is unset (local only). */
const DEV_SESSION_FALLBACK = 'dev-insecure-session-secret-change-me';

export function sessionSecret(): string {
  return process.env.DASHBOARD_SESSION_SECRET?.trim() || DEV_SESSION_FALLBACK;
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf(encoder.encode(body))));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify('HMAC', key, buf(fromB64url(sig)), buf(encoder.encode(body)));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
