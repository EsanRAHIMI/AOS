/**
 * Google OAuth token vault (D-192).
 *
 * A Google refresh token is a long-lived key to the owner's calendar, mail
 * scope-permitting and identity. Storing it as plaintext in Mongo would mean a
 * database dump — a backup file, a misconfigured Atlas IP list, a screenshot of
 * a collection — hands over the owner's calendar permanently. So it is
 * encrypted at rest with AES-256-GCM under a key that lives only in the
 * environment, never in the database.
 *
 * GCM rather than CBC deliberately: it authenticates the ciphertext, so a
 * tampered record fails to decrypt instead of silently producing garbage that
 * we would then send to Google as a token.
 *
 * The key is `GOOGLE_TOKEN_ENC_KEY` (32 bytes, hex or base64). Without it the
 * vault refuses to store anything and says exactly why — the kernel's honesty
 * rule applied to secrets: never pretend to have secured something.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { collection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';
import { nowIso } from '../utils/index.js';

const ALG = 'aes-256-gcm';
const IV_BYTES = 12;      // 96-bit nonce, the GCM-recommended size

export const GoogleTokenSchema = z.object({
  /** One record per owner+provider; the owner is the actor id. */
  actorId: z.string(),
  provider: z.literal('google'),
  /** Google account this grant belongs to — shown in the UI so the owner
   *  can see WHICH account is connected, not just that one is. */
  accountEmail: z.string().default(''),
  /** Encrypted refresh token: iv:tag:ciphertext, all base64. */
  refreshTokenEnc: z.string(),
  /** Access tokens are short-lived; kept only to avoid a refresh per call. */
  accessTokenEnc: z.string().default(''),
  accessTokenExpiresAt: z.string().default(''),
  /** Exactly what Google granted — may be less than what we asked for. */
  scopes: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Set when a refresh fails permanently (revoked grant, deleted account). */
  revokedAt: z.string().nullable().default(null),
  lastError: z.string().default(''),
});
export type GoogleToken = z.infer<typeof GoogleTokenSchema>;

const col = () => collection<GoogleToken>(COLLECTIONS.GOOGLE_TOKENS);

/* ------------------------------------------------------------------ crypto */

export interface VaultAvailability {
  configured: boolean;
  /** Exact reason, for the UI to show instead of a generic failure. */
  reason: string;
}

function keyFrom(env: NodeJS.ProcessEnv): Buffer | null {
  const raw = env.GOOGLE_TOKEN_ENC_KEY ?? '';
  if (!raw) return null;
  // Accept hex or base64; anything else is a configuration mistake worth
  // failing loudly on rather than silently deriving a weak key from.
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : null;
}

export function vaultAvailability(env: NodeJS.ProcessEnv = process.env): VaultAvailability {
  if (!env.GOOGLE_TOKEN_ENC_KEY) {
    return { configured: false, reason: 'GOOGLE_TOKEN_ENC_KEY is not set (needs 32 bytes, hex or base64)' };
  }
  if (!keyFrom(env)) {
    return { configured: false, reason: 'GOOGLE_TOKEN_ENC_KEY must decode to exactly 32 bytes' };
  }
  return { configured: true, reason: '' };
}

export function encryptSecret(plain: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = keyFrom(env);
  if (!key) throw new Error(vaultAvailability(env).reason);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(payload: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = keyFrom(env);
  if (!key) throw new Error(vaultAvailability(env).reason);
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('token record is malformed');
  const decipher = createDecipheriv(ALG, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Stable, non-reversible id for logs: proves which grant without exposing it. */
export function tokenFingerprint(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex').slice(0, 12);
}

/* ------------------------------------------------------------------ store */

export interface StoreGrantInput {
  actorId: string;
  refreshToken: string;
  accessToken?: string;
  expiresInSec?: number;
  scopes?: string[];
  accountEmail?: string;
}

/**
 * Save (or replace) the owner's grant. Google only returns a refresh token on
 * the FIRST consent unless `prompt=consent` is forced, so a re-connect that
 * omits it must not wipe the working one.
 */
export async function storeGrant(input: StoreGrantInput, env: NodeJS.ProcessEnv = process.env): Promise<GoogleToken> {
  const now = nowIso();
  const existing = await col().findOne({ actorId: input.actorId, provider: 'google' });

  const refreshEnc = input.refreshToken
    ? encryptSecret(input.refreshToken, env)
    : existing?.refreshTokenEnc ?? '';
  if (!refreshEnc) {
    throw new Error('Google returned no refresh token and none is stored — re-authorize with prompt=consent&access_type=offline');
  }

  const record: GoogleToken = GoogleTokenSchema.parse({
    actorId: input.actorId,
    provider: 'google',
    accountEmail: input.accountEmail ?? existing?.accountEmail ?? '',
    refreshTokenEnc: refreshEnc,
    accessTokenEnc: input.accessToken ? encryptSecret(input.accessToken, env) : '',
    accessTokenExpiresAt: input.accessToken && input.expiresInSec
      ? new Date(Date.now() + input.expiresInSec * 1000).toISOString()
      : '',
    scopes: input.scopes ?? existing?.scopes ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revokedAt: null,
    lastError: '',
  });

  await col().updateOne(
    { actorId: input.actorId, provider: 'google' },
    { $set: record },
    { upsert: true },
  );
  return record;
}

export async function getGrant(actorId: string): Promise<GoogleToken | null> {
  const doc = await col().findOne({ actorId, provider: 'google' }, { projection: { _id: 0 } as never });
  return doc ? GoogleTokenSchema.parse(doc) : null;
}

/** Cache a freshly minted access token so the next call skips the refresh. */
export async function cacheAccessToken(
  actorId: string, accessToken: string, expiresInSec: number, env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await col().updateOne(
    { actorId, provider: 'google' },
    {
      $set: {
        accessTokenEnc: encryptSecret(accessToken, env),
        // Expire our copy a minute early: a token that dies mid-request costs
        // a retry, and a minute of reuse costs nothing.
        accessTokenExpiresAt: new Date(Date.now() + (expiresInSec - 60) * 1000).toISOString(),
        updatedAt: nowIso(),
      },
    },
  );
}

/** Mark a grant dead so the UI can say "reconnect" instead of failing forever. */
export async function markGrantRevoked(actorId: string, reason: string): Promise<void> {
  await col().updateOne(
    { actorId, provider: 'google' },
    { $set: { revokedAt: nowIso(), lastError: reason.slice(0, 300), accessTokenEnc: '', accessTokenExpiresAt: '', updatedAt: nowIso() } },
  );
}

export async function deleteGrant(actorId: string): Promise<boolean> {
  const res = await col().deleteOne({ actorId, provider: 'google' });
  return res.deletedCount > 0;
}
