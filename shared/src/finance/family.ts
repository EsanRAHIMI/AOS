/**
 * Read-only Family Finance session (finance.smartcontractsco.com).
 * The password is exchanged once for a refresh token and never stored.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { actorScopedCollection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';
import { nowIso } from '../utils/index.js';

export const FAMILY_FINANCE_ACTOR_ID = 'owner';

const ALG = 'aes-256-gcm';
const DEFAULT_BASE = 'https://finance.smartcontractsco.com/api';

const GrantSchema = z.object({
  actorId: z.string(),
  provider: z.literal('family_finance'),
  accountLabel: z.string().default(''),
  familyId: z.string().default(''),
  familyName: z.string().default(''),
  refreshTokenEnc: z.string(),
  accessTokenEnc: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
  revokedAt: z.string().nullable().default(null),
  lastError: z.string().default(''),
});
type Grant = z.infer<typeof GrantSchema>;

export interface FamilyFinanceHousehold {
  id: string;
  name: string;
}

export interface FamilyFinanceConnectResult {
  connected: true;
  accountLabel: string;
  familyId: string;
  familyName: string;
  families: FamilyFinanceHousehold[];
}

export interface FamilyFinanceStatus {
  vaultConfigured: boolean;
  vaultReason: string;
  connected: boolean;
  accountLabel: string;
  familyId: string;
  familyName: string;
  families: FamilyFinanceHousehold[];
  lastError: string;
}

const col = (actorId: string) => actorScopedCollection<Grant>(COLLECTIONS.FAMILY_FINANCE_GRANTS, actorId);

function keyFrom(env: NodeJS.ProcessEnv): Buffer | null {
  const raw = env.FAMILY_FINANCE_TOKEN_ENC_KEY || env.GOOGLE_TOKEN_ENC_KEY || '';
  if (!raw) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : null;
}

export function familyFinanceVaultAvailability(env: NodeJS.ProcessEnv = process.env): { configured: boolean; reason: string } {
  if (!env.FAMILY_FINANCE_TOKEN_ENC_KEY && !env.GOOGLE_TOKEN_ENC_KEY) {
    return { configured: false, reason: 'FAMILY_FINANCE_TOKEN_ENC_KEY or GOOGLE_TOKEN_ENC_KEY is not set (32 bytes, hex or base64)' };
  }
  if (!keyFrom(env)) return { configured: false, reason: 'the token encryption key must decode to exactly 32 bytes' };
  return { configured: true, reason: '' };
}

function encrypt(plain: string, env: NodeJS.ProcessEnv): string {
  const key = keyFrom(env);
  if (!key) throw new Error(familyFinanceVaultAvailability(env).reason);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

function decrypt(payload: string, env: NodeJS.ProcessEnv): string {
  const key = keyFrom(env);
  if (!key) throw new Error(familyFinanceVaultAvailability(env).reason);
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('family finance token record is malformed');
  const decipher = createDecipheriv(ALG, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

export function familyFinanceApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return (env.FAMILY_FINANCE_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
}

export class FamilyFinanceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

type FetchImpl = typeof fetch;
let fetchImpl: FetchImpl = globalThis.fetch.bind(globalThis);

export function setFamilyFinanceFetch(fn: FetchImpl | null): void {
  fetchImpl = fn ?? globalThis.fetch.bind(globalThis);
}

async function request(path: string, init: { method?: string; json?: unknown; accessToken?: string; env?: NodeJS.ProcessEnv }): Promise<unknown> {
  const headers = new Headers();
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (init.accessToken) headers.set('authorization', `Bearer ${init.accessToken}`);
  const res = await fetchImpl(`${familyFinanceApiBase(init.env)}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    throw new FamilyFinanceError(body?.error?.code ?? 'DEPENDENCY_UNAVAILABLE', body?.error?.message ?? `Family Finance request failed (${res.status})`);
  }
  return body;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function householdsFrom(body: unknown): FamilyFinanceHousehold[] {
  const root = asRecord(body);
  const list = Array.isArray(body) ? body : (root.families ?? root.items ?? root.data);
  if (!Array.isArray(list)) return [];
  return list.flatMap((row) => {
    const r = asRecord(row);
    const id = String(r.id ?? r.familyId ?? '');
    if (!id) return [];
    return [{ id, name: String(r.name ?? r.title ?? id) }];
  });
}

async function loadGrant(actorId: string): Promise<Grant | null> {
  const doc = await col(actorId).findOne({ provider: 'family_finance' });
  return doc ? GrantSchema.parse(doc) : null;
}

async function saveGrant(actorId: string, patch: Partial<Grant> & { refreshToken: string; accessToken: string }, env: NodeJS.ProcessEnv): Promise<Grant> {
  const existing = await loadGrant(actorId);
  const now = nowIso();
  const record = GrantSchema.parse({
    actorId,
    provider: 'family_finance',
    accountLabel: patch.accountLabel ?? existing?.accountLabel ?? '',
    familyId: patch.familyId ?? existing?.familyId ?? '',
    familyName: patch.familyName ?? existing?.familyName ?? '',
    refreshTokenEnc: encrypt(patch.refreshToken, env),
    accessTokenEnc: encrypt(patch.accessToken, env),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revokedAt: null,
    lastError: '',
  });
  await col(actorId).updateOne({ provider: 'family_finance' }, { $set: record }, { upsert: true });
  return record;
}

function tokensOf(body: unknown): { accessToken: string; refreshToken: string; user: Record<string, unknown> } {
  const r = asRecord(body);
  const nested = asRecord(r.tokens);
  const accessToken = String(r.accessToken ?? nested.accessToken ?? '');
  const refreshToken = String(r.refreshToken ?? nested.refreshToken ?? '');
  if (!accessToken || !refreshToken) throw new FamilyFinanceError('AUTH_FAILED', 'Family Finance did not return a session');
  return { accessToken, refreshToken, user: asRecord(r.user) };
}

export async function connectFamilyFinance(input: {
  identifier: string;
  password: string;
  actorId?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FamilyFinanceConnectResult> {
  const env = input.env ?? process.env;
  const vault = familyFinanceVaultAvailability(env);
  if (!vault.configured) throw new Error(vault.reason);
  const identifier = input.identifier.trim();
  if (!identifier || !input.password) throw new Error('email or phone, and password, are required');
  const actorId = input.actorId ?? FAMILY_FINANCE_ACTOR_ID;
  const logged = tokensOf(await request('/v1/auth/login', { method: 'POST', json: { email: identifier, password: input.password }, env }));
  const families = householdsFrom(await request('/v1/families', { accessToken: logged.accessToken, env }));
  const only = families.length === 1 ? families[0] : undefined;
  const label = String(logged.user.email ?? logged.user.phoneNumber ?? identifier);
  await saveGrant(actorId, {
    refreshToken: logged.refreshToken,
    accessToken: logged.accessToken,
    accountLabel: label,
    familyId: only?.id ?? '',
    familyName: only?.name ?? '',
  }, env);
  return { connected: true, accountLabel: label, familyId: only?.id ?? '', familyName: only?.name ?? '', families };
}

export async function selectFamilyFinanceHousehold(familyId: string, actorId = FAMILY_FINANCE_ACTOR_ID, env: NodeJS.ProcessEnv = process.env): Promise<FamilyFinanceHousehold> {
  const families = await listFamilyFinanceHouseholds(actorId, env);
  const found = families.find((f) => f.id === familyId);
  if (!found) throw new Error('that household is not on this Family Finance account');
  const grant = await loadGrant(actorId);
  if (!grant?.refreshTokenEnc) throw new Error('not_connected');
  await col(actorId).updateOne(
    { provider: 'family_finance' },
    { $set: { familyId: found.id, familyName: found.name, updatedAt: nowIso(), lastError: '' } },
  );
  return found;
}

async function authorized<T>(actorId: string, env: NodeJS.ProcessEnv, fn: (accessToken: string) => Promise<T>): Promise<T> {
  const grant = await loadGrant(actorId);
  if (!grant || grant.revokedAt || !grant.refreshTokenEnc) throw new Error('not_connected');
  const access = grant.accessTokenEnc ? decrypt(grant.accessTokenEnc, env) : '';
  const refreshToken = decrypt(grant.refreshTokenEnc, env);
  const run = async (token: string) => fn(token);
  try {
    if (!access) throw new FamilyFinanceError('TOKEN_EXPIRED', 'no access token');
    return await run(access);
  } catch (err) {
    if (!(err instanceof FamilyFinanceError) || err.code !== 'TOKEN_EXPIRED') throw err;
    const next = tokensOf(await request('/v1/auth/refresh', { method: 'POST', json: { refreshToken }, env }));
    await saveGrant(actorId, {
      refreshToken: next.refreshToken,
      accessToken: next.accessToken,
      accountLabel: grant.accountLabel,
      familyId: grant.familyId,
      familyName: grant.familyName,
    }, env);
    return run(next.accessToken);
  }
}

export async function listFamilyFinanceHouseholds(actorId = FAMILY_FINANCE_ACTOR_ID, env: NodeJS.ProcessEnv = process.env): Promise<FamilyFinanceHousehold[]> {
  return authorized(actorId, env, async (accessToken) => householdsFrom(await request('/v1/families', { accessToken, env })));
}

export async function familyFinanceStatus(actorId = FAMILY_FINANCE_ACTOR_ID, env: NodeJS.ProcessEnv = process.env): Promise<FamilyFinanceStatus> {
  const vault = familyFinanceVaultAvailability(env);
  const grant = vault.configured ? await loadGrant(actorId) : null;
  const connected = Boolean(grant && !grant.revokedAt && grant.refreshTokenEnc);
  let families: FamilyFinanceHousehold[] = [];
  let lastError = grant?.lastError ?? '';
  if (connected) {
    try {
      families = await listFamilyFinanceHouseholds(actorId, env);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    vaultConfigured: vault.configured,
    vaultReason: vault.reason,
    connected,
    accountLabel: grant?.accountLabel ?? '',
    familyId: grant?.familyId ?? '',
    familyName: grant?.familyName ?? '',
    families,
    lastError,
  };
}

export async function disconnectFamilyFinance(actorId = FAMILY_FINANCE_ACTOR_ID, env: NodeJS.ProcessEnv = process.env): Promise<{ removed: boolean }> {
  const grant = await loadGrant(actorId);
  if (grant?.refreshTokenEnc) {
    try {
      await request('/v1/auth/logout', { method: 'POST', json: { refreshToken: decrypt(grant.refreshTokenEnc, env) }, env });
    } catch {
      /* local disconnect still completes */
    }
  }
  const res = await col(actorId).deleteOne({ provider: 'family_finance' });
  return { removed: (res.deletedCount ?? 0) > 0 };
}

function monthNow(): string {
  return new Date().toISOString().slice(0, 7);
}

function section(label: string, body: unknown, limit: number): string {
  const rows = Array.isArray(body) ? body : asRecord(body).items ?? asRecord(body).transactions ?? asRecord(body).bills ?? asRecord(body).goals ?? asRecord(body).budgets ?? asRecord(body).data;
  if (!Array.isArray(rows)) {
    const text = JSON.stringify(body ?? null);
    return `${label}: ${text.length > 1600 ? `${text.slice(0, 1600)}…` : text}`;
  }
  const lines = rows.slice(0, limit).map((row) => {
    const r = asRecord(row);
    const title = r.title ?? r.name ?? r.merchant ?? r.description ?? r.category ?? r.categoryName ?? '';
    const amount = r.amount ?? r.total ?? r.balance ?? r.spent ?? '';
    const currency = r.currency ?? '';
    const when = r.date ?? r.occurredAt ?? r.dueDate ?? r.month ?? '';
    return `- ${[title, amount, currency, when].filter((v) => v !== '' && v != null).join(' · ')}`;
  });
  const more = rows.length > limit ? `\n… ${rows.length - limit} more` : '';
  return `${label} (${rows.length}):\n${lines.join('\n') || '- none'}${more}`;
}

export async function readFamilyFinance(input: { month?: string; actorId?: string; env?: NodeJS.ProcessEnv } = {}): Promise<{ month: string; familyId: string; familyName: string; summary: string }> {
  const env = input.env ?? process.env;
  const actorId = input.actorId ?? FAMILY_FINANCE_ACTOR_ID;
  const month = input.month ?? monthNow();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month must be YYYY-MM');
  const grant = await loadGrant(actorId);
  if (!grant?.familyId) throw new Error(grant ? 'family_not_selected' : 'not_connected');
  const familyId = grant.familyId;
  const q = `month=${encodeURIComponent(month)}`;
  const [dashboard, transactions, bills, goals, budgets] = await authorized(actorId, env, async (accessToken) => Promise.all([
    request(`/v1/families/${familyId}/dashboard?${q}`, { accessToken, env }),
    request(`/v1/families/${familyId}/transactions?${q}`, { accessToken, env }),
    request(`/v1/families/${familyId}/bills?${q}`, { accessToken, env }),
    request(`/v1/families/${familyId}/goals`, { accessToken, env }),
    request(`/v1/families/${familyId}/budgets?${q}`, { accessToken, env }),
  ]));
  const summary = [
    `Household: ${grant.familyName || familyId} (${familyId})`,
    `Month: ${month}`,
    `Account: ${grant.accountLabel}`,
    section('Dashboard', dashboard, 12),
    section('Transactions', transactions, 40),
    section('Bills', bills, 20),
    section('Goals', goals, 10),
    section('Budgets', budgets, 15),
  ].join('\n\n');
  return { month, familyId, familyName: grant.familyName, summary };
}
