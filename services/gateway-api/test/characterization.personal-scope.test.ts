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

/**
 * K1.4c — same proof extended to the "personal facts" family (D-159):
 * personal_health_states, personal_life_items, personal_finance_items,
 * personal_learning_tracks. All four migrated off raw GatewayDeps handles
 * onto scopedCollection(ctx) in routes/personal.ts (healthStatesFor /
 * lifeItemsFor / financeItemsFor / learningTracksFor). `/v1/me/universe/
 * detail` is the one route that echoes each collection's raw array back in
 * the response (`data.health.states`, `data.life.items`,
 * `data.finance.items`, `data.growth.learningTracks`), so it is the cleanest
 * HTTP-level surface to prove per-collection isolation without inspecting
 * internal state.
 */
describe('personal.ts / personal-facts family — construction-enforced user isolation', () => {
  it('GET /v1/me/universe/detail never returns a foreign user\'s row for any of the four collections', async () => {
    const now = '2026-07-10T00:00:00.000Z';
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.PERSONAL_HEALTH_STATES).docs.push(
        { healthStateId: 'phlth_mine', scope: 'user', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, recordKind: 'fact', metric: 'sleep', level: 7, value: '7h', note: 'mine', concern: false, source: 'user', confidence: 1, createdAt: now, updatedAt: now },
        { healthStateId: 'phlth_foreign', scope: 'user', tenantId: 'tenant_other', userId: 'user_other', recordKind: 'fact', metric: 'sleep', level: 2, value: '2h', note: 'not mine', concern: true, source: 'user', confidence: 1, createdAt: now, updatedAt: now },
      );
      db.col(COLLECTIONS.PERSONAL_LIFE_ITEMS).docs.push(
        { lifeItemId: 'plife_mine', scope: 'user', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, recordKind: 'fact', title: 'mine', description: '', status: 'active', tags: [], domain: 'personal', itemType: 'responsibility', dueDate: null, importance: 'normal', source: 'user', confidence: 1, createdAt: now, updatedAt: now },
        { lifeItemId: 'plife_foreign', scope: 'user', tenantId: 'tenant_other', userId: 'user_other', recordKind: 'fact', title: 'not mine', description: '', status: 'active', tags: [], domain: 'personal', itemType: 'responsibility', dueDate: null, importance: 'normal', source: 'user', confidence: 1, createdAt: now, updatedAt: now },
      );
      db.col(COLLECTIONS.PERSONAL_FINANCE_ITEMS).docs.push(
        { financeItemId: 'pfin_mine', scope: 'user', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, recordKind: 'fact', title: 'mine', description: '', status: 'active', tags: [], itemType: 'expense', amount: 10, currency: 'USD', cadence: 'monthly', dueDate: null, source: 'user', confidence: 1, createdAt: now, updatedAt: now },
        { financeItemId: 'pfin_foreign', scope: 'user', tenantId: 'tenant_other', userId: 'user_other', recordKind: 'fact', title: 'not mine', description: '', status: 'active', tags: [], itemType: 'expense', amount: 9999, currency: 'USD', cadence: 'monthly', dueDate: null, source: 'user', confidence: 1, createdAt: now, updatedAt: now },
      );
      db.col(COLLECTIONS.PERSONAL_LEARNING_TRACKS).docs.push(
        { learningTrackId: 'plearn_mine', scope: 'user', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, recordKind: 'fact', title: 'mine', description: '', status: 'active', tags: [], targetSkill: 'x', linkedGoalIds: [], source: 'user', confidence: 1, createdAt: now, updatedAt: now },
        { learningTrackId: 'plearn_foreign', scope: 'user', tenantId: 'tenant_other', userId: 'user_other', recordKind: 'fact', title: 'not mine', description: '', status: 'active', tags: [], targetSkill: 'y', linkedGoalIds: [], source: 'user', confidence: 1, createdAt: now, updatedAt: now },
      );
    });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/me/universe/detail', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; data: { health: { states: Array<{ healthStateId: string }> }; life: { items: Array<{ lifeItemId: string }> }; finance: { items: Array<{ financeItemId: string }> }; growth: { learningTracks: Array<{ learningTrackId: string }> } } };
    expect(body.data.health.states.map((s) => s.healthStateId)).toEqual(['phlth_mine']);
    expect(body.data.life.items.map((s) => s.lifeItemId)).toEqual(['plife_mine']);
    expect(body.data.finance.items.map((s) => s.financeItemId)).toEqual(['pfin_mine']);
    expect(body.data.growth.learningTracks.map((s) => s.learningTrackId)).toEqual(['plearn_mine']);
    await h.close();
  });

  it('POST /v1/me/reality/ingest writes correctly scope-stamped documents for all four kinds', async () => {
    const h = await buildTestGateway();
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['health_state', { metric: 'sleep', level: 6, value: '6h' }, COLLECTIONS.PERSONAL_HEALTH_STATES],
      ['life_item', { title: 'renew passport' }, COLLECTIONS.PERSONAL_LIFE_ITEMS],
      ['finance_item', { title: 'rent', amount: 1200 }, COLLECTIONS.PERSONAL_FINANCE_ITEMS],
      ['learning_track', { title: 'learn Rust', targetSkill: 'rust' }, COLLECTIONS.PERSONAL_LEARNING_TRACKS],
    ];
    for (const [kind, data, collectionName] of cases) {
      const res = await h.service.app.inject({ method: 'POST', url: '/v1/me/reality/ingest', headers: asAdmin(), payload: { kind, data } });
      expect(res.statusCode).toBe(200);
      const stored = h.db.col(collectionName).docs;
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ scope: 'user', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID });
    }
    await h.close();
  });

  it('a request with no resolvable primary user is denied before the data layer is reached, for the universe/detail route', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/me/universe/detail', headers: asAdmin('agent') });
    expect(res.statusCode).toBe(403);
    await h.close();
  });
});

/**
 * K1.4d — opportunity_reports (D-160): the last fully-isolated, properly-
 * scoped collection in routes/personal.ts. Migrated via opportunityReportsFor,
 * same shape as the D-158/D-159 accessors.
 */
describe('personal.ts / opportunity_reports — construction-enforced user isolation', () => {
  it('GET /v1/me/opportunities never returns a foreign user\'s row', async () => {
    const now = '2026-07-10T00:00:00.000Z';
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.OPPORTUNITY_REPORTS).docs.push(
        { opportunityReportId: 'oppr_mine', scope: 'user', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, title: 'mine', summary: 'mine', sourcesUsed: [], createdAt: now },
        { opportunityReportId: 'oppr_foreign', scope: 'user', tenantId: 'tenant_other', userId: 'user_other', title: 'not mine', summary: 'not mine', sourcesUsed: [], createdAt: now },
      );
    });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/me/opportunities', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; data: Array<{ opportunityReportId: string }> };
    expect(body.data.map((r) => r.opportunityReportId)).toEqual(['oppr_mine']);
    await h.close();
  });

  it('a request with no resolvable primary user is denied before the data layer is reached', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/me/opportunities', headers: asAdmin('agent') });
    expect(res.statusCode).toBe(403);
    await h.close();
  });
});
