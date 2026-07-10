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

/**
 * K1.4f — identity/connector cluster (D-163): user_profiles, consent_grants,
 * connector_accounts, connector_sync_runs (all scope:'user'), and
 * tenant_memberships (scope:'tenant'). D-162 first added the `scope` field
 * to all five schemas; D-163 migrated every routes/personal.ts call site
 * onto scopedCollection(ctx) (userProfileFor / consentGrantsFor /
 * connectorAccountsFor / connectorSyncRunsFor / membershipsFor). Unlike
 * scoped_memories/opportunity_reports, userProfiles and consentGrants keep a
 * raw LOCAL handle in server.ts for the owner-seed bootstrap and the
 * Jarvis/operator executors block (D-157, out of scope) — that raw handle is
 * not reachable from any route, which is exactly what these tests pin.
 */
describe('personal.ts / identity+connector cluster — construction-enforced isolation', () => {
  const now = '2026-07-10T00:00:00.000Z';

  it('GET /v1/me/profile never returns a foreign user\'s profile', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.USER_PROFILES).docs.push(
        { scope: 'user', userId: ESAN_USER_ID, displayName: 'Esan', email: '', actorType: 'human_user', defaultTenantId: ESAN_TENANT_ID, locale: 'en', timezone: 'UTC', preferences: {}, status: 'active', createdAt: now, updatedAt: now },
        { scope: 'user', userId: 'user_other', displayName: 'Not Esan', email: '', actorType: 'human_user', defaultTenantId: 'tenant_other', locale: 'en', timezone: 'UTC', preferences: {}, status: 'active', createdAt: now, updatedAt: now },
      );
    });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/me/profile', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; data: { userId: string; displayName: string } };
    expect(body.data.userId).toBe(ESAN_USER_ID);
    expect(body.data.displayName).toBe('Esan');
    await h.close();
  });

  it('PATCH /v1/me/profile only ever updates the actor\'s own profile document', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.USER_PROFILES).docs.push(
        { scope: 'user', userId: ESAN_USER_ID, displayName: 'Esan', email: '', actorType: 'human_user', defaultTenantId: ESAN_TENANT_ID, locale: 'en', timezone: 'UTC', preferences: {}, status: 'active', createdAt: now, updatedAt: now },
        { scope: 'user', userId: 'user_other', displayName: 'Not Esan', email: '', actorType: 'human_user', defaultTenantId: 'tenant_other', locale: 'en', timezone: 'UTC', preferences: {}, status: 'active', createdAt: now, updatedAt: now },
      );
    });
    const res = await h.service.app.inject({ method: 'PATCH', url: '/v1/me/profile', headers: asAdmin(), payload: { displayName: 'Esan Updated' } });
    expect(res.statusCode).toBe(200);
    const docs = h.db.col(COLLECTIONS.USER_PROFILES).docs as Array<{ userId: string; displayName: string }>;
    expect(docs.find((d) => d.userId === ESAN_USER_ID)?.displayName).toBe('Esan Updated');
    expect(docs.find((d) => d.userId === 'user_other')?.displayName).toBe('Not Esan');
    await h.close();
  });

  it('GET /v1/tenants/current never lists a foreign tenant\'s membership', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.TENANT_MEMBERSHIPS).docs.push(
        { scope: 'tenant', membershipId: 'membership_mine', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, roles: ['owner'], status: 'active', createdAt: now, updatedAt: now },
        { scope: 'tenant', membershipId: 'membership_foreign', tenantId: 'tenant_other', userId: 'user_other', roles: ['owner'], status: 'active', createdAt: now, updatedAt: now },
      );
    });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/tenants/current', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; data: { members: Array<{ membershipId: string }> } };
    expect(body.data.members.map((m) => m.membershipId)).toEqual(['membership_mine']);
    await h.close();
  });

  it('GET /v1/consents never returns a foreign user\'s consent grant', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.CONSENT_GRANTS).docs.push(
        { scope: 'user', grantId: 'consent_mine', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, connectorType: 'calendar', scopesAllowed: [], accessMode: 'read_only', status: 'active', grantedAt: now, expiresAt: null, revokedAt: null, createdBy: ESAN_USER_ID, auditContext: {} },
        { scope: 'user', grantId: 'consent_foreign', tenantId: 'tenant_other', userId: 'user_other', connectorType: 'calendar', scopesAllowed: [], accessMode: 'read_only', status: 'active', grantedAt: now, expiresAt: null, revokedAt: null, createdBy: 'user_other', auditContext: {} },
      );
    });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/consents', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; data: Array<{ grantId: string }> };
    expect(body.data.map((g) => g.grantId)).toEqual(['consent_mine']);
    await h.close();
  });

  it('POST /v1/consents writes a correctly scope-stamped grant', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/consents', headers: asAdmin(), payload: { connectorType: 'email' } });
    expect(res.statusCode).toBe(200);
    const stored = h.db.col(COLLECTIONS.CONSENT_GRANTS).docs;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ scope: 'user', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, connectorType: 'email' });
    await h.close();
  });

  it('POST /v1/consents/:id/revoke cannot find or revoke a foreign user\'s grant (404, not leaked)', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.CONSENT_GRANTS).docs.push(
        { scope: 'user', grantId: 'consent_foreign', tenantId: 'tenant_other', userId: 'user_other', connectorType: 'calendar', scopesAllowed: [], accessMode: 'read_only', status: 'active', grantedAt: now, expiresAt: null, revokedAt: null, createdBy: 'user_other', auditContext: {} },
      );
    });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/consents/consent_foreign/revoke', headers: asAdmin() });
    expect(res.statusCode).toBe(404);
    const foreign = h.db.col(COLLECTIONS.CONSENT_GRANTS).docs.find((d) => (d as { grantId: string }).grantId === 'consent_foreign') as { status: string };
    expect(foreign.status).toBe('active'); // untouched
    await h.close();
  });

  it('GET /v1/connectors never returns a foreign user\'s connector account', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.CONNECTOR_ACCOUNTS).docs.push(
        { scope: 'user', connectorAccountId: 'conn_mine', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, connectorType: 'calendar', provider: 'google', status: 'connected', scopes: [], consentGrantId: 'consent_mine', lastSyncAt: null, error: '', metadata: {}, createdAt: now, updatedAt: now },
        { scope: 'user', connectorAccountId: 'conn_foreign', tenantId: 'tenant_other', userId: 'user_other', connectorType: 'calendar', provider: 'google', status: 'connected', scopes: [], consentGrantId: 'consent_foreign', lastSyncAt: null, error: '', metadata: {}, createdAt: now, updatedAt: now },
      );
    });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/connectors', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; data: Array<{ connectorAccountId: string }> };
    expect(body.data.map((c) => c.connectorAccountId)).toEqual(['conn_mine']);
    await h.close();
  });

  it('POST /v1/connectors writes a correctly scope-stamped connector account, gated on the actor\'s own active consent', async () => {
    const h = await buildTestGateway();
    const consentRes = await h.service.app.inject({ method: 'POST', url: '/v1/consents', headers: asAdmin(), payload: { connectorType: 'calendar' } });
    const { data: grant } = consentRes.json() as { data: { grantId: string } };
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/connectors', headers: asAdmin(), payload: { connectorType: 'calendar', provider: 'google', consentGrantId: grant.grantId } });
    expect(res.statusCode).toBe(200);
    const stored = h.db.col(COLLECTIONS.CONNECTOR_ACCOUNTS).docs;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ scope: 'user', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, consentGrantId: grant.grantId });
    await h.close();
  });

  it('POST /v1/connectors/:id/sync cannot find or sync a foreign user\'s connector account (404, not leaked)', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.CONNECTOR_ACCOUNTS).docs.push(
        { scope: 'user', connectorAccountId: 'conn_foreign', tenantId: 'tenant_other', userId: 'user_other', connectorType: 'calendar', provider: 'google', status: 'connected', scopes: [], consentGrantId: 'consent_foreign', lastSyncAt: null, error: '', metadata: {}, createdAt: now, updatedAt: now },
      );
    });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/connectors/conn_foreign/sync', headers: asAdmin() });
    expect(res.statusCode).toBe(404);
    expect(h.db.col(COLLECTIONS.CONNECTOR_SYNC_RUNS).docs).toHaveLength(0);
    await h.close();
  });

  it('GET /v1/me/universe\'s connectors slice is scope-filtered the same way', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.CONNECTOR_ACCOUNTS).docs.push(
        { scope: 'user', connectorAccountId: 'conn_mine', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, connectorType: 'calendar', provider: 'google', status: 'connected', scopes: [], consentGrantId: 'consent_mine', lastSyncAt: null, error: '', metadata: {}, createdAt: now, updatedAt: now },
        { scope: 'user', connectorAccountId: 'conn_foreign', tenantId: 'tenant_other', userId: 'user_other', connectorType: 'calendar', provider: 'google', status: 'connected', scopes: [], consentGrantId: 'consent_foreign', lastSyncAt: null, error: '', metadata: {}, createdAt: now, updatedAt: now },
      );
    });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/me/universe', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    await h.close();
  });

  it('GET /v1/access-decisions: an owner sees the whole log, a non-owner sees only their own decisions', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.ACCESS_DECISIONS).docs.push(
        { decisionId: 'dec_mine', actorId: ESAN_USER_ID, actorType: 'human_user', action: 'read', resource: 'x', scope: 'user', tenantId: null, targetUserId: null, caseId: null, decision: 'allowed', reason: 'ok', createdAt: now },
        { decisionId: 'dec_foreign', actorId: 'user_other', actorType: 'human_user', action: 'read', resource: 'x', scope: 'user', tenantId: null, targetUserId: null, caseId: null, decision: 'denied', reason: 'no', createdAt: now },
      );
    });
    const ownerRes = await h.service.app.inject({ method: 'GET', url: '/v1/access-decisions', headers: asAdmin('owner') });
    expect(ownerRes.statusCode).toBe(200);
    const ownerBody = ownerRes.json() as { ok: true; data: Array<{ decisionId: string }> };
    expect(ownerBody.data.map((d) => d.decisionId).sort()).toEqual(['dec_foreign', 'dec_mine']);

    const viewerRes = await h.service.app.inject({ method: 'GET', url: '/v1/access-decisions', headers: asAdmin('viewer') });
    expect(viewerRes.statusCode).toBe(200);
    const viewerBody = viewerRes.json() as { ok: true; data: Array<{ decisionId: string }> };
    expect(viewerBody.data.map((d) => d.decisionId)).toEqual(['dec_mine']);
    await h.close();
  });

  it('a request with no resolvable primary user is denied before the data layer is reached (fail closed)', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.USER_PROFILES).docs.push(
        { scope: 'user', userId: ESAN_USER_ID, displayName: 'Esan', email: '', actorType: 'human_user', defaultTenantId: ESAN_TENANT_ID, locale: 'en', timezone: 'UTC', preferences: {}, status: 'active', createdAt: now, updatedAt: now },
      );
    });
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/me/profile', headers: asAdmin('agent') });
    expect(res.statusCode).toBe(403);
    await h.close();
  });
});
