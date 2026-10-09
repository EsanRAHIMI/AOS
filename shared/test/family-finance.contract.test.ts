import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { COLLECTIONS } from '../src/constants/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import {
  connectFamilyFinance,
  disconnectFamilyFinance,
  readFamilyFinance,
  selectFamilyFinanceHousehold,
  setFamilyFinanceFetch,
} from '../src/finance/family.js';

const env = { FAMILY_FINANCE_TOKEN_ENC_KEY: 'a'.repeat(64), FAMILY_FINANCE_API_BASE: 'https://finance.test/api' };
const password = 'not-stored-ever';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let access = 'access-1';

beforeEach(() => {
  setTestDb(createFakeDb().db);
  access = 'access-1';
  setFamilyFinanceFetch(async (url, init) => {
    const path = String(url);
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (path.endsWith('/v1/auth/login')) {
      expect(body.password).toBe(password);
      return json(200, { accessToken: access, refreshToken: 'refresh-1', user: { id: 'u1', email: 'owner@family.test' } });
    }
    if (path.endsWith('/v1/auth/refresh')) return json(200, { accessToken: 'access-2', refreshToken: 'refresh-2' });
    if (path.endsWith('/v1/auth/logout')) return json(204, null);
    if (auth.includes('access-1') && path.includes('/dashboard')) {
      return json(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    }
    if (path.endsWith('/v1/families')) return json(200, [{ id: 'fam-1', name: 'Rahimi', timezone: 'Asia/Dubai', baseCurrency: 'AED' }]);
    if (path.includes('/dashboard')) return json(200, { currency: 'AED', incomeMinor: 100000, expenseMinor: 40000, sharedExpenseMinor: 25000, personalExpenseMinor: 15000, transferMinor: 0, netCashFlowMinor: 60000, byCategory: { food: 8000 } });
    if (path.includes('/transactions')) return json(200, [{ id: 'tx-1', type: 'expense', merchantName: 'Groceries', amountMinor: 8000, currency: 'AED', occurredOn: '2026-10-02', allocation: 'personal', categorySlug: 'food', payerMembershipId: 'm1' }]);
    if (path.includes('/bills')) return json(200, { bills: [{ id: 'bill-1', title: 'DEWA', expectedAmountMinor: 30000, currency: 'AED', dueDayOfMonth: 15, occurrence: { dueOn: '2026-10-15', status: 'open' } }] });
    if (path.includes('/goals')) return json(200, { goals: [{ name: 'Emergency', currency: 'AED', currentMinor: 100000, targetMinor: 500000, percentComplete: 20, status: 'active' }] });
    if (path.includes('/budgets')) return json(200, { budgets: [{ id: 'bud-1', categorySlug: 'food', currency: 'AED', spentMinor: 8000, amountMinor: 20000, remainingMinor: 12000, percentUsed: 40, exceeded: false }] });
    if (path.includes('/installment-plans')) return json(200, { plans: [{ id: 'plan-1', provider: 'Bank', merchantName: 'Car', status: 'active', currency: 'AED', totalMinor: 120000, paidMinor: 20000, remainingMinor: 100000, installmentCount: 6, schedule: [{ index: 2, dueOn: '2026-10-20', status: 'open', overdue: false, amountMinor: 20000, currency: 'AED' }] }] });
    if (path.includes('/settlement')) return json(200, { currency: 'AED', positions: [{ displayName: 'Ehsan', paidMinor: 25000, shareMinor: 12500, balanceMinor: 12500 }], transfers: [{ fromDisplayName: 'Other', toDisplayName: 'Ehsan', amountMinor: 12500, currency: 'AED' }] });
    if (path.includes('/categories')) return json(200, [{ slug: 'food', name: 'Food' }]);
    if (path.includes('/members')) return json(200, [{ id: 'm1', displayName: 'Ehsan' }]);
    return json(404, { error: { code: 'NOT_FOUND', message: path } });
  });
});

afterEach(() => setFamilyFinanceFetch(null));

describe('Family Finance read connection', () => {
  it('stores a session and never the password', async () => {
    const fake = createFakeDb();
    setTestDb(fake.db);
    const connected = await connectFamilyFinance({ identifier: 'owner@family.test', password, env });
    expect(connected.familyName).toBe('Rahimi');
    const stored = JSON.stringify(fake.dump(COLLECTIONS.FAMILY_FINANCE_GRANTS));
    expect(stored).not.toContain(password);
    expect(stored).toContain('owner@family.test');
    const read = await readFamilyFinance({ month: '2026-10', env });
    expect(read.cash.incomeMinor).toBe(100000);
    expect(read.cash.netCashFlowMinor).toBe(60000);
    expect(read.categories).toEqual([expect.objectContaining({ slug: 'food', name: 'Food', spentMinor: 8000 })]);
    expect(read.transactions).toEqual([expect.objectContaining({ title: 'Groceries', amountMinor: 8000, currency: 'AED', category: 'Food', payer: 'Ehsan' })]);
    expect(read.bills).toEqual([expect.objectContaining({ title: 'DEWA', amountMinor: 30000, dueOn: '2026-10-15', status: 'open' })]);
    expect(read.budgets).toEqual([expect.objectContaining({ label: 'Food', spentMinor: 8000, amountMinor: 20000 })]);
    expect(read.goals).toEqual([expect.objectContaining({ name: 'Emergency', currentMinor: 100000, targetMinor: 500000 })]);
    expect(read.plans).toEqual([expect.objectContaining({ title: 'Bank · Car', remainingMinor: 100000, nextDueOn: '2026-10-20' })]);
    expect(read.settlement).toEqual([expect.objectContaining({ name: 'Ehsan', balanceMinor: 12500 })]);
    expect(read.transfers).toEqual([expect.objectContaining({ from: 'Other', to: 'Ehsan', amountMinor: 12500 })]);
    expect(read.summary).toContain('Groceries');
    expect(read.summary).toContain('80.00 AED');
    expect(read.summary).toContain('DEWA');
    expect(read.summary).toContain('300.00 AED');
    expect(read.summary).toContain('Income: 1000.00 AED');
    expect(read.summary).not.toContain(password);
    await disconnectFamilyFinance('owner', env);
    expect(fake.dump(COLLECTIONS.FAMILY_FINANCE_GRANTS)).toHaveLength(0);
  });

  it('waits for a household when the account has more than one', async () => {
    setFamilyFinanceFetch(async (url, init) => {
      const path = String(url);
      if (path.endsWith('/v1/auth/login')) return json(200, { accessToken: 'a', refreshToken: 'r', user: { email: 'owner@family.test' } });
      if (path.endsWith('/v1/families')) return json(200, [{ id: 'a', name: 'Home' }, { id: 'b', name: 'Parents' }]);
      return json(404, { error: { code: 'NOT_FOUND', message: path } });
    });
    const connected = await connectFamilyFinance({ identifier: 'owner@family.test', password, env });
    expect(connected.familyId).toBe('');
    const selected = await selectFamilyFinanceHousehold('b', 'owner', env);
    expect(selected.name).toBe('Parents');
  });
});
