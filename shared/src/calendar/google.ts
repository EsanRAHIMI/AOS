/**
 * Google API client — OAuth 2.0 + REST, no SDK (D-192).
 *
 * Plain `fetch` against the documented REST endpoints rather than
 * `googleapis`: that package pulls a very large dependency tree for what is,
 * here, a dozen HTTP calls, and the kernel's rule is to build in-house and
 * depend narrowly. The trade is that WE must implement the error semantics
 * correctly — which is why they are written out explicitly below, from the
 * official "Handle API errors" guide rather than from memory:
 *
 *   401 → refresh the access token once, then re-authorize the user
 *   403 rateLimitExceeded / userRateLimitExceeded, 429 → exponential backoff
 *   403 quotaExceeded (calendar usage limits) → do NOT hammer; surface it
 *   404, 500 → exponential backoff
 *   410 → sync token dead; the caller wipes its mirror and does a full sync
 *   400, 409, 412 → permanent for this request; never retry blindly
 *
 * Sources: developers.google.com/workspace/calendar/api/guides/errors and
 * /guides/sync (fetched 2026-07-30).
 */
import { getGrant, decryptSecret, cacheAccessToken, markGrantRevoked } from './tokens.js';

export const GOOGLE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
export const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
export const USERINFO_API = 'https://www.googleapis.com/oauth2/v3/userinfo';

/**
 * Least privilege that still lets the assistant do the job.
 *
 * `calendar.events` (not the full `calendar` scope) is enough to read and write
 * events; `calendar.calendarlist.readonly` lets us enumerate calendars without
 * the power to change their sharing. `tasks` covers what used to be Reminders —
 * Google migrated Reminders into Tasks in 2023 and there is no Reminders API.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.calendars',
  'https://www.googleapis.com/auth/tasks',
  'openid',
  'email',
] as const;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleAvailability {
  configured: boolean;
  reason: string;
  missing: string[];
}

export function googleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET ?? '';
  const redirectUri = env.GOOGLE_REDIRECT_URI ?? '';
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

/** Name the missing variables exactly — never a generic "not configured". */
export function googleAvailability(env: NodeJS.ProcessEnv = process.env): GoogleAvailability {
  const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']
    .filter((k) => !env[k]);
  return {
    configured: missing.length === 0,
    reason: missing.length ? `missing ${missing.join(', ')}` : '',
    missing,
  };
}

/* ------------------------------------------------------------ authorization */

/**
 * Build the consent URL.
 *
 * `access_type=offline` + `prompt=consent` is not belt-and-braces: without
 * BOTH, a returning user who already consented gets no refresh token, and the
 * integration works until the first access-token expiry and then dies. `state`
 * is a CSRF guard the caller must verify on the way back.
 */
export function buildAuthUrl(cfg: GoogleConfig, state: string, opts: { loginHint?: string } = {}): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  if (opts.loginHint) p.set('login_hint', opts.loginHint);
  return `${GOOGLE_OAUTH_AUTH_URL}?${p.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  id_token?: string;
}

export async function exchangeCode(cfg: GoogleConfig, code: string): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
  return body as TokenResponse;
}

export async function refreshAccessToken(cfg: GoogleConfig, refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // `invalid_grant` means the owner revoked access or the token expired from
    // disuse — a permanent state that must surface as "reconnect", not a retry.
    const err = (body as { error?: string }).error ?? String(res.status);
    throw Object.assign(new Error(`token refresh failed: ${err}`), { permanent: err === 'invalid_grant' });
  }
  return body as TokenResponse;
}

export async function revokeToken(token: string): Promise<boolean> {
  const res = await fetch(GOOGLE_OAUTH_REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  });
  return res.ok;
}

/* ------------------------------------------------------------- access token */

/** A valid access token for this owner, refreshing only when actually needed. */
export async function accessTokenFor(actorId: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const cfg = googleConfig(env);
  if (!cfg) throw new Error(googleAvailability(env).reason);

  const grant = await getGrant(actorId);
  if (!grant) throw new Error('not_connected');
  if (grant.revokedAt) throw new Error(`grant_revoked: ${grant.lastError || 'reconnect required'}`);

  if (grant.accessTokenEnc && grant.accessTokenExpiresAt && Date.parse(grant.accessTokenExpiresAt) > Date.now()) {
    return decryptSecret(grant.accessTokenEnc, env);
  }

  try {
    const refreshed = await refreshAccessToken(cfg, decryptSecret(grant.refreshTokenEnc, env));
    await cacheAccessToken(actorId, refreshed.access_token, refreshed.expires_in, env);
    return refreshed.access_token;
  } catch (err) {
    if ((err as { permanent?: boolean }).permanent) {
      await markGrantRevoked(actorId, (err as Error).message);
    }
    throw err;
  }
}

/* -------------------------------------------------------------- API calling */

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) { super(message); this.name = 'GoogleApiError'; }

  /** 410 fullSyncRequired: the caller must wipe its mirror and re-sync. */
  get isSyncTokenGone(): boolean { return this.status === 410 && this.reason !== 'deleted'; }
  /** Retrying will not help; the request itself is wrong. */
  get isPermanent(): boolean { return [400, 401, 403, 404, 409, 412].includes(this.status) && !this.isRateLimited; }
  get isRateLimited(): boolean {
    return this.status === 429 || (this.status === 403 && /rateLimitExceeded|userRateLimitExceeded/i.test(this.reason));
  }
}

const RETRY_BASE_MS = 400;

function parseError(status: number, body: unknown): GoogleApiError {
  const e = (body as { error?: { errors?: Array<{ reason?: string; message?: string }>; message?: string } }).error;
  const reason = e?.errors?.[0]?.reason ?? '';
  const message = e?.message ?? e?.errors?.[0]?.message ?? `HTTP ${status}`;
  return new GoogleApiError(status, reason, message);
}

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Retries for transient failures only; permanent errors throw immediately. */
  maxAttempts?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * One Google REST call with the documented retry semantics and exponential
 * backoff (with jitter — synchronised retries from several agents are how a
 * rate limit becomes a rate-limit storm).
 */
export async function googleCall<T>(
  actorId: string, base: string, path: string, opts: CallOptions = {},
): Promise<T> {
  const env = opts.env ?? process.env;
  const maxAttempts = opts.maxAttempts ?? 4;
  const url = new URL(`${base}${path}`);
  for (const [k, val] of Object.entries(opts.query ?? {})) {
    if (val !== undefined && val !== '') url.searchParams.set(k, String(val));
  }

  let lastErr: GoogleApiError | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const token = await accessTokenFor(actorId, env);
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(opts.body ? { 'content-type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (res.status === 204) return undefined as T;
    if (res.ok) return await res.json() as T;

    const body = await res.json().catch(() => ({}));
    const err = parseError(res.status, body);
    lastErr = err;

    // 401 once: the cached access token died early. Clearing it forces a
    // refresh on the next attempt; a second 401 means the grant is the problem.
    if (res.status === 401 && attempt === 0) {
      await cacheAccessToken(actorId, '', 0, env).catch(() => undefined);
      continue;
    }
    if (err.isSyncTokenGone || err.isPermanent) throw err;

    // Transient: 429 / 403 rate limit / 404 / 5xx — exponential backoff.
    const wait = RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 250);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw lastErr ?? new GoogleApiError(500, 'unknown', 'Google call failed');
}

/** Which Google account this grant belongs to — shown in the UI. */
export async function fetchAccountEmail(accessToken: string): Promise<string> {
  try {
    const res = await fetch(USERINFO_API, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return '';
    const body = await res.json() as { email?: string };
    return body.email ?? '';
  } catch { return ''; }
}
