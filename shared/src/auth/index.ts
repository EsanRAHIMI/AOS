import { timingSafeEqual } from 'node:crypto';
import { INTERNAL_TOKEN_HEADER, ADMIN_TOKEN_HEADER } from '../constants/index.js';

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

export { INTERNAL_TOKEN_HEADER, ADMIN_TOKEN_HEADER };
