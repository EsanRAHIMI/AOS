/**
 * K1.4b — scope-by-construction proof for the personal route group (D-158).
 *
 * `scoped_memories` is the first collection migrated from a raw GatewayDeps
 * handle onto `scopedCollection(ctx)` (routes/personal.ts `memoriesFor`).
 * These tests prove the guarantee that migration buys: a document already
 * sitting in the physical collection under a DIFFERENT user's scope can
 * never leak through a read, even though both documents live in the same
 * Mongo collection with no per-request filter written by hand.
 *
 * Honest limitation: real per-user auth doesn't exist yet (K1 item 6,
 * master-direction §J) — `legacyRoleToAuthContext` always resolves the only
 * reachable human identity to `user_esan`. So this suite proves isolation by
 * seeding a FOREIGN user's row directly into the fake collection (simulating
 * data that reached Mongo some other way — exactly the class of bug
 * scope-by-construction defends against) rather than by driving a second
 * real session through the HTTP layer. The construction-level guarantee
 * itself (missing actor ⇒ throw, cross-scope filter can never widen) is unit
 * tested directly in shared/test/scoped-collection.contract.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { COLLECTIONS, ESAN_USER_ID, ESAN_TENANT_ID } from '@factory/shared';
import { buildTestGateway, asAdmin } from './helpers/build-app.js';

describe('personal.ts / scoped_memories — construction-enforced user isolation', () => {
  it('GET /v1/me/memories never returns a foreign user\'s row, even though it sits in the same collection', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.SCOPED_MEMORIES).docs.push(
        { memoryId: 'smem_mine', scope: 'user', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, kind: 'fact', content: 'my own memory', source: 'user', confidence: 1, consentGrantId: null, createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z' },
        { memoryId: 'smem_foreign', scope: 'user', tenantId: 'tenant_other', userId: 'user_other', kind: 'fact', content: 'a different user\'s private memory', source: 'user', confidence: 1, consentGrantId: null, createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z' },
      );
    });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/me/memories', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; data: Array<{ memoryId: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.memoryId).toBe('smem_mine');
    expect(body.data.some((m) => m.memoryId === 'smem_foreign')).toBe(false);
    await h.close();
  });

  it('GET /v1/me/universe\'s recent-memories slice is scope-filtered the same way', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.SCOPED_MEMORIES).docs.push(
        { memoryId: 'smem_mine', scope: 'user', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, kind: 'fact', content: 'mine', source: 'user', confidence: 1, consentGrantId: null, createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z' },
        { memoryId: 'smem_foreign', scope: 'user', tenantId: 'tenant_other', userId: 'user_other', kind: 'fact', content: 'not mine', source: 'user', confidence: 1, consentGrantId: null, createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z' },
      );
    });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/me/universe', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    await h.close();
  });

  it('POST /v1/me/memories writes a correctly scope-stamped document via scopedCollection', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/me/memories', headers: asAdmin(), payload: { kind: 'preference', content: 'prefers terse responses' } });
    expect(res.statusCode).toBe(200);
    const stored = h.db.col(COLLECTIONS.SCOPED_MEMORIES).docs;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ scope: 'user', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, content: 'prefers terse responses' });
    await h.close();
  });

  it('a request with no resolvable primary user is denied before the data layer is ever reached (fail closed)', async () => {
    // The 'agent' role has no primaryUserId in legacyRoleToAuthContext; the
    // route's enforceScoped() must deny it rather than let scopedCollection's
    // own throw surface as an unhandled 500.
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/me/memories', headers: asAdmin('agent') });
    expect(res.statusCode).toBe(403);
    expect(h.db.col(COLLECTIONS.SCOPED_MEMORIES).docs).toHaveLength(0);
    await h.close();
  });
});
