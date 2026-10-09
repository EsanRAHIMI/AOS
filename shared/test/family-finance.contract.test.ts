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
      return json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } });
    }
    if (path.endsWith('/v1/families')) return json(200, [{ id: 'fam-1', name: 'Rahimi' }]);
    if (path.includes('/dashboard')) return json(200, { income: 1000, spent: 400, currency: 'AED' });
    if (path.includes('/transactions')) return json(200, [{ title: 'Groceries', amount: 80, currency: 'AED', date: '2026-10-02' }]);
    if (path.includes('/bills')) return json(200, [{ title: 'DEWA', amount: 300, currency: 'AED' }]);
    if (path.includes('/goals')) return json(200, [{ name: 'Emergency', amount: 5000 }]);
    if (path.includes('/budgets')) return json(200, [{ category: 'Food', spent: 80 }]);
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
    expect(read.summary).toContain('Groceries');
    expect(read.summary).toContain('DEWA');
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
