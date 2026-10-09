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
  timezone: z.string().default(''),
  baseCurrency: z.string().default(''),
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
  timezone: string;
  baseCurrency: string;
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
    return [{ id, name: String(r.name ?? r.title ?? id), timezone: String(r.timezone ?? ''), baseCurrency: String(r.baseCurrency ?? '') }];
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
    timezone: patch.timezone ?? existing?.timezone ?? '',
    baseCurrency: patch.baseCurrency ?? existing?.baseCurrency ?? '',
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
    timezone: only?.timezone ?? '',
    baseCurrency: only?.baseCurrency ?? '',
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
    { $set: { familyId: found.id, familyName: found.name, timezone: found.timezone, baseCurrency: found.baseCurrency, updatedAt: nowIso(), lastError: '' } },
  );
  return found;
}

const refreshInFlight = new Map<string, Promise<string>>();

function sessionExpired(err: unknown): boolean {
  return err instanceof FamilyFinanceError && (err.code === 'UNAUTHENTICATED' || err.code === 'TOKEN_EXPIRED');
}

async function refreshAccess(actorId: string, env: NodeJS.ProcessEnv): Promise<string> {
  const existing = refreshInFlight.get(actorId);
  if (existing) return existing;
  const job = (async () => {
    const grant = await loadGrant(actorId);
    if (!grant?.refreshTokenEnc) throw new Error('not_connected');
    const next = tokensOf(await request('/v1/auth/refresh', {
      method: 'POST',
      json: { refreshToken: decrypt(grant.refreshTokenEnc, env) },
      env,
    }));
    await saveGrant(actorId, {
      refreshToken: next.refreshToken,
      accessToken: next.accessToken,
      accountLabel: grant.accountLabel,
      familyId: grant.familyId,
      familyName: grant.familyName,
      timezone: grant.timezone,
      baseCurrency: grant.baseCurrency,
    }, env);
    return next.accessToken;
  })().finally(() => refreshInFlight.delete(actorId));
  refreshInFlight.set(actorId, job);
  return job;
}

async function authorized<T>(actorId: string, env: NodeJS.ProcessEnv, fn: (accessToken: string) => Promise<T>): Promise<T> {
  const grant = await loadGrant(actorId);
  if (!grant || grant.revokedAt || !grant.refreshTokenEnc) throw new Error('not_connected');
  const access = grant.accessTokenEnc ? decrypt(grant.accessTokenEnc, env) : '';
  try {
    if (!access) throw new FamilyFinanceError('UNAUTHENTICATED', 'no access token');
    return await fn(access);
  } catch (err) {
    if (!sessionExpired(err)) throw err;
    return fn(await refreshAccess(actorId, env));
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

const MINOR_EXPONENT: Record<string, number> = {
  AED: 2, USD: 2, EUR: 2, GBP: 2, SAR: 2, QAR: 2, OMR: 3, BHD: 3, KWD: 3,
  IRR: 0, INR: 2, PKR: 2, TRY: 2, CHF: 2, JPY: 0, CNY: 2, CAD: 2, AUD: 2,
};

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export function formatFamilyMoney(minor: number, currency: string): string {
  if (!currency) return '';
  const exp = MINOR_EXPONENT[currency] ?? 2;
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(minor));
  if (exp === 0) return `${sign}${abs} ${currency}`;
  const scale = 10 ** exp;
  return `${sign}${Math.floor(abs / scale)}.${String(abs % scale).padStart(exp, '0')} ${currency}`;
}

function money(minor: unknown, currency: unknown): string {
  return formatFamilyMoney(num(minor), String(currency || ''));
}

function monthInTimeZone(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'Asia/Dubai', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    if (year && month) return `${year}-${month}`;
  } catch { /* invalid zone falls through */ }
  return new Date().toISOString().slice(0, 7);
}

export interface FamilyFinanceCash {
  currency: string;
  incomeMinor: number;
  expenseMinor: number;
  sharedExpenseMinor: number;
  personalExpenseMinor: number;
  transferMinor: number;
  netCashFlowMinor: number;
}

export interface FamilyFinanceCategorySpend {
  slug: string;
  name: string;
  spentMinor: number;
  currency: string;
}

export interface FamilyFinanceBillRow {
  id: string;
  title: string;
  category: string;
  allocation: string;
  amountMinor: number;
  currency: string;
  dueOn: string;
  status: string;
  overdue: boolean;
}

export interface FamilyFinancePlanRow {
  id: string;
  title: string;
  status: string;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  remainingMinor: number;
  installmentCount: number;
  openCount: number;
  overdueCount: number;
  nextDueOn: string;
  nextAmountMinor: number;
}

export interface FamilyFinanceBudgetRow {
  id: string;
  label: string;
  currency: string;
  amountMinor: number;
  spentMinor: number;
  remainingMinor: number;
  percentUsed: number;
  exceeded: boolean;
}

export interface FamilyFinanceGoalRow {
  id: string;
  name: string;
  currency: string;
  currentMinor: number;
  targetMinor: number;
  remainingMinor: number;
  percentComplete: number;
  status: string;
  targetOn: string;
}

export interface FamilyFinanceSettlementRow {
  name: string;
  paidMinor: number;
  shareMinor: number;
  balanceMinor: number;
  currency: string;
  removed: boolean;
}

export interface FamilyFinanceTransferRow {
  from: string;
  to: string;
  amountMinor: number;
  currency: string;
}

export interface FamilyFinanceTxRow {
  id: string;
  type: string;
  title: string;
  category: string;
  allocation: string;
  payer: string;
  amountMinor: number;
  currency: string;
  occurredOn: string;
  status: string;
  reversal: boolean;
}

export interface FamilyFinanceSnapshot {
  month: string;
  familyId: string;
  familyName: string;
  accountLabel: string;
  currency: string;
  cash: FamilyFinanceCash;
  categories: FamilyFinanceCategorySpend[];
  bills: FamilyFinanceBillRow[];
  plans: FamilyFinancePlanRow[];
  budgets: FamilyFinanceBudgetRow[];
  goals: FamilyFinanceGoalRow[];
  settlement: FamilyFinanceSettlementRow[];
  transfers: FamilyFinanceTransferRow[];
  transactions: FamilyFinanceTxRow[];
  warnings: string[];
  summary: string;
}

function rowsOf(body: unknown, key?: string): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.map(asRecord);
  if (!key) return [];
  const list = asRecord(body)[key];
  return Array.isArray(list) ? list.map(asRecord) : [];
}

function namedMap(body: unknown, idKey: string, labelKey: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rowsOf(body)) {
    const id = String(row[idKey] ?? '');
    if (id) map.set(id, String(row[labelKey] ?? id));
  }
  return map;
}

function cashOf(body: unknown, fallbackCurrency: string): FamilyFinanceCash {
  const r = asRecord(body);
  const currency = String(r.currency || fallbackCurrency || '');
  const expenseMinor = num(r.expenseMinor);
  const sharedExpenseMinor = num(r.sharedExpenseMinor);
  return {
    currency,
    incomeMinor: num(r.incomeMinor),
    expenseMinor,
    sharedExpenseMinor,
    personalExpenseMinor: r.personalExpenseMinor == null ? Math.max(expenseMinor - sharedExpenseMinor, 0) : num(r.personalExpenseMinor),
    transferMinor: num(r.transferMinor),
    netCashFlowMinor: num(r.netCashFlowMinor),
  };
}

function categoriesOf(dashboard: unknown, names: Map<string, string>, currency: string): FamilyFinanceCategorySpend[] {
  return Object.entries(asRecord(asRecord(dashboard).byCategory))
    .map(([slug, spent]) => ({ slug, name: names.get(slug) || slug, spentMinor: num(spent), currency }))
    .filter((row) => row.spentMinor !== 0)
    .sort((a, b) => b.spentMinor - a.spentMinor);
}

function billsOf(body: unknown, names: Map<string, string>): FamilyFinanceBillRow[] {
  return rowsOf(body, 'bills').flatMap((row) => {
    const id = String(row.id ?? '');
    if (!id) return [];
    const occurrence = asRecord(row.occurrence);
    const slug = String(row.categorySlug ?? '');
    return [{
      id,
      title: String(row.title ?? ''),
      category: names.get(slug) || slug,
      allocation: String(row.allocation ?? ''),
      amountMinor: occurrence.amountMinor == null ? num(row.expectedAmountMinor) : num(occurrence.amountMinor),
      currency: String(occurrence.currency || row.currency || ''),
      dueOn: String(occurrence.dueOn ?? ''),
      status: String(occurrence.status ?? 'open'),
      overdue: occurrence.overdue === true,
    }];
  });
}

function plansOf(body: unknown): FamilyFinancePlanRow[] {
  return rowsOf(body, 'plans').flatMap((row) => {
    const id = String(row.id ?? '');
    if (!id) return [];
    const schedule = rowsOf(row.schedule);
    const open = schedule.filter((item) => String(item.status ?? '') === 'open');
    const next = [...open].sort((a, b) => String(a.dueOn ?? '').localeCompare(String(b.dueOn ?? '')))[0];
    const merchant = String(row.merchantName ?? '').trim();
    const provider = String(row.provider ?? '').trim();
    return [{
      id,
      title: [provider, merchant].filter(Boolean).join(' · ') || merchant || provider || 'installment',
      status: String(row.status ?? ''),
      currency: String(row.currency ?? ''),
      totalMinor: num(row.totalMinor),
      paidMinor: num(row.paidMinor),
      remainingMinor: num(row.remainingMinor),
      installmentCount: num(row.installmentCount) || schedule.length,
      openCount: open.length,
      overdueCount: schedule.filter((item) => item.overdue === true).length,
      nextDueOn: next ? String(next.dueOn ?? '') : '',
      nextAmountMinor: next ? num(next.amountMinor) : 0,
    }];
  });
}

function budgetsOf(body: unknown, names: Map<string, string>): FamilyFinanceBudgetRow[] {
  return rowsOf(body, 'budgets').flatMap((row) => {
    const id = String(row.id ?? row.scopeKey ?? row.categorySlug ?? 'household');
    if (!id) return [];
    const slug = row.categorySlug == null ? '' : String(row.categorySlug);
    return [{
      id,
      label: slug ? (names.get(slug) || slug) : 'household',
      currency: String(row.currency ?? ''),
      amountMinor: num(row.amountMinor),
      spentMinor: num(row.spentMinor),
      remainingMinor: num(row.remainingMinor),
      percentUsed: num(row.percentUsed),
      exceeded: row.exceeded === true,
    }];
  });
}

function goalsOf(body: unknown): FamilyFinanceGoalRow[] {
  return rowsOf(body, 'goals').flatMap((row) => {
    const id = String(row.id ?? row.name ?? '');
    if (!id) return [];
    return [{
      id,
      name: String(row.name ?? ''),
      currency: String(row.currency ?? ''),
      currentMinor: num(row.currentMinor),
      targetMinor: num(row.targetMinor),
      remainingMinor: num(row.remainingMinor),
      percentComplete: num(row.percentComplete),
      status: String(row.status ?? ''),
      targetOn: String(row.targetOn ?? ''),
    }];
  });
}

function settlementOf(body: unknown, currency: string): { positions: FamilyFinanceSettlementRow[]; transfers: FamilyFinanceTransferRow[] } {
  const root = asRecord(body);
  const code = String(root.currency || currency);
  const mapRow = (row: Record<string, unknown>, removed: boolean): FamilyFinanceSettlementRow | null => {
    const name = String(row.displayName ?? row.membershipId ?? '');
    if (!name) return null;
    return {
      name,
      paidMinor: num(row.paidMinor),
      shareMinor: num(row.shareMinor),
      balanceMinor: num(row.balanceMinor),
      currency: String(row.currency || code),
      removed,
    };
  };
  return {
    positions: [
      ...rowsOf(root.positions).flatMap((row) => { const mapped = mapRow(row, false); return mapped ? [mapped] : []; }),
      ...rowsOf(root.removedPositions).flatMap((row) => { const mapped = mapRow(row, true); return mapped ? [mapped] : []; }),
    ],
    transfers: rowsOf(root.transfers).flatMap((row) => {
      const from = String(row.fromDisplayName ?? row.fromMembershipId ?? '');
      const to = String(row.toDisplayName ?? row.toMembershipId ?? '');
      if (!from && !to) return [];
      return [{ from, to, amountMinor: num(row.amountMinor), currency: String(row.currency || code) }];
    }),
  };
}

function transactionsOf(body: unknown, categories: Map<string, string>, members: Map<string, string>): FamilyFinanceTxRow[] {
  return rowsOf(body).flatMap((row) => {
    const id = String(row.id ?? '');
    if (!id) return [];
    const slug = String(row.categorySlug ?? '');
    const payerId = String(row.payerMembershipId ?? '');
    const merchant = String(row.merchantName ?? '').trim();
    const notes = String(row.notes ?? '').trim();
    return [{
      id,
      type: String(row.type ?? ''),
      title: merchant || notes || categories.get(slug) || slug || String(row.type ?? ''),
      category: categories.get(slug) || slug,
      allocation: String(row.allocation ?? ''),
      payer: members.get(payerId) || '',
      amountMinor: num(row.amountMinor),
      currency: String(row.currency ?? ''),
      occurredOn: String(row.occurredOn ?? ''),
      status: String(row.status ?? ''),
      reversal: row.isReversal === true,
    }];
  });
}

function snapshotSummary(snapshot: Omit<FamilyFinanceSnapshot, 'summary'>): string {
  const c = snapshot.cash;
  const line = (parts: Array<string | number>) => parts.filter((part) => part !== '').join(' ');
  const block = (title: string, rows: string[]) => `${title} (${rows.length}):\n${rows.join('\n') || '- none'}`;
  return [
    `Household: ${snapshot.familyName || snapshot.familyId} (${snapshot.familyId})`,
    `Month: ${snapshot.month}`,
    `Account: ${snapshot.accountLabel}`,
    [
      'Dashboard:',
      `Income: ${money(c.incomeMinor, c.currency)}`,
      `Expense: ${money(c.expenseMinor, c.currency)}`,
      `Shared expense: ${money(c.sharedExpenseMinor, c.currency)}`,
      `Personal expense: ${money(c.personalExpenseMinor, c.currency)}`,
      `Transfer: ${money(c.transferMinor, c.currency)}`,
      `Net: ${money(c.netCashFlowMinor, c.currency)}`,
    ].join('\n'),
    block('Categories', snapshot.categories.map((row) => line(['-', row.name, money(row.spentMinor, row.currency)]))),
    block('Bills', snapshot.bills.map((row) => line(['-', row.title, money(row.amountMinor, row.currency), 'due', row.dueOn, row.overdue ? 'overdue' : row.status]))),
    block('Installments', snapshot.plans.map((row) => line(['-', row.title, money(row.remainingMinor, row.currency), 'left of', money(row.totalMinor, row.currency), row.status, row.nextDueOn ? `next ${row.nextDueOn}` : '']))),
    block('Budgets', snapshot.budgets.map((row) => line(['-', row.label, 'spent', money(row.spentMinor, row.currency), 'of', money(row.amountMinor, row.currency), `${row.percentUsed}%`]))),
    block('Goals', snapshot.goals.map((row) => line(['-', row.name, money(row.currentMinor, row.currency), '/', money(row.targetMinor, row.currency), `${row.percentComplete}%`, row.status]))),
    block('Settlement', snapshot.settlement.map((row) => line(['-', row.removed ? `${row.name} (removed)` : row.name, 'paid', money(row.paidMinor, row.currency), 'share', money(row.shareMinor, row.currency), 'balance', money(row.balanceMinor, row.currency)]))),
    block('Transfers', snapshot.transfers.map((row) => line(['-', row.from, '->', row.to, money(row.amountMinor, row.currency)]))),
    block('Transactions', snapshot.transactions.map((row) => line(['-', row.type, row.title, money(row.amountMinor, row.currency), row.occurredOn, row.allocation, row.payer, row.reversal ? 'reversal' : row.status]))),
    snapshot.warnings.length ? `Warnings:\n${snapshot.warnings.map((warning) => `- ${warning}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export async function readFamilyFinance(input: { month?: string; actorId?: string; env?: NodeJS.ProcessEnv } = {}): Promise<FamilyFinanceSnapshot> {
  const env = input.env ?? process.env;
  const actorId = input.actorId ?? FAMILY_FINANCE_ACTOR_ID;
  const grant = await loadGrant(actorId);
  if (!grant?.familyId) throw new Error(grant ? 'family_not_selected' : 'not_connected');
  const month = input.month ?? monthInTimeZone(grant.timezone || 'Asia/Dubai');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month must be YYYY-MM');
  const familyId = grant.familyId;
  const q = `month=${encodeURIComponent(month)}`;
  const base = `/v1/families/${familyId}`;
  const pulled = await authorized(actorId, env, async (accessToken) => {
    const warnings: string[] = [];
    const grab = async (label: string, path: string): Promise<unknown> => {
      try {
        return await request(path, { accessToken, env });
      } catch (err) {
        if (sessionExpired(err)) throw err;
        warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    };
    const [dashboard, transactions, bills, plans, goals, budgets, settlement, categories, members] = await Promise.all([
      grab('dashboard', `${base}/dashboard?${q}`),
      grab('transactions', `${base}/transactions?${q}`),
      grab('bills', `${base}/bills?${q}`),
      grab('installments', `${base}/installment-plans`),
      grab('goals', `${base}/goals`),
      grab('budgets', `${base}/budgets?${q}`),
      grab('settlement', `${base}/settlement?${q}`),
      grab('categories', `${base}/categories`),
      grab('members', `${base}/members`),
    ]);
    return { dashboard, transactions, bills, plans, goals, budgets, settlement, categories, members, warnings };
  });
  const names = namedMap(pulled.categories, 'slug', 'name');
  const people = namedMap(pulled.members, 'id', 'displayName');
  const cash = cashOf(pulled.dashboard, grant.baseCurrency);
  const books = settlementOf(pulled.settlement, cash.currency);
  const snapshot: Omit<FamilyFinanceSnapshot, 'summary'> = {
    month,
    familyId,
    familyName: grant.familyName,
    accountLabel: grant.accountLabel,
    currency: cash.currency || grant.baseCurrency,
    cash,
    categories: categoriesOf(pulled.dashboard, names, cash.currency || grant.baseCurrency),
    bills: billsOf(pulled.bills, names),
    plans: plansOf(pulled.plans),
    budgets: budgetsOf(pulled.budgets, names),
    goals: goalsOf(pulled.goals),
    settlement: books.positions,
    transfers: books.transfers,
    transactions: transactionsOf(pulled.transactions, names, people),
    warnings: pulled.warnings,
  };
  return { ...snapshot, summary: snapshotSummary(snapshot) };
}
