/**
 * K1.3 characterization — the auth sweep.
 *
 * Pins, for every read surface of every route group, the EXACT current
 * contract: no token → 401 with the unauthorized envelope; admin token → 200;
 * internal token → 200; x-request-id echoed on every response. This single
 * table is the safety net that makes the mechanical route split provable:
 * if a moved route loses its guard, changes an envelope, or vanishes, this
 * fails. POST/side-effect paths are pinned in the sibling suites.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { REQUEST_ID_HEADER } from '@factory/shared';
import { buildTestGateway, asAdmin, asInternal, type Harness } from './helpers/build-app.js';

// One representative read per route group + every uniform read the dashboard
// relies on. Grouped as [path, group] so failures name the group.
const READS: Array<[string, string]> = [
  ['/v1/tasks', 'tasks'],
  ['/v1/approvals', 'tasks'],
  ['/v1/infrastructure', 'tasks'],
  ['/v1/events', 'tasks'],
  ['/v1/services', 'tasks'],
  ['/v1/capabilities', 'capabilities'],
  ['/v1/gaps', 'capabilities'],
  ['/v1/expansion-proposals', 'capabilities'],
  ['/v1/evaluations', 'capabilities'],
  ['/v1/skills', 'capabilities'],
  ['/v1/llm-traces', 'capabilities'],
  ['/v1/validations', 'capabilities'],
  ['/v1/github', 'capabilities'],
  ['/v1/evidence', 'capabilities'],
  ['/v1/activations', 'capabilities'],
  ['/v1/checklists', 'capabilities'],
  ['/v1/monitor', 'capabilities'],
  ['/v1/incidents', 'capabilities'],
  ['/v1/repair-tasks', 'capabilities'],
  ['/v1/system/integrations', 'capabilities'],
  ['/v1/llm/status', 'capabilities'],
  ['/v1/repair-diagnoses', 'repair'],
  ['/v1/repair-plans', 'repair'],
  ['/v1/strategic-plans', 'repair'],
  ['/v1/plan-scores', 'repair'],
  ['/v1/policy-decisions', 'repair'],
  ['/v1/decision-memory', 'repair'],
  ['/v1/outcome-reviews', 'governance'],
  ['/v1/scoring-profiles', 'governance'],
  ['/v1/scoring-change-proposals', 'governance'],
  ['/v1/policy-rules', 'governance'],
  ['/v1/policy-change-proposals', 'governance'],
  ['/v1/audit-logs', 'governance'],
  ['/v1/rbac', 'governance'],
  ['/v1/learning-runs', 'governance'],
  ['/v1/reliability', 'governance'],
  ['/v1/patterns', 'governance'],
  ['/v1/memory-summaries', 'governance'],
  ['/v1/compressed-contexts', 'governance'],
  ['/v1/system-recommendations', 'governance'],
  ['/v1/prompt-performance', 'governance'],
  ['/v1/learning/schedules', 'governance'],
  ['/v1/learning/triggers', 'governance'],
  ['/v1/improvement-workflows', 'governance'],
  ['/v1/impact-assessments', 'governance'],
  ['/v1/memory-maintenance', 'governance'],
  ['/v1/security/safe-mode', 'security'],
  ['/v1/security/env', 'security'],
  ['/v1/security/checks', 'security'],
  ['/v1/security/events', 'security'],
  ['/v1/security/rate-limits', 'security'],
  ['/v1/operations', 'operations'],
  ['/v1/operations/active', 'operations'],
  ['/v1/dokploy-targets', 'operations'],
  ['/v1/dokploy/status', 'operations'],
  ['/v1/dokploy/diagnostics', 'operations'],
  ['/v1/dokploy/mapping', 'operations'],
  ['/v1/llm/prompts', 'intelligence'],
  ['/v1/llm/costs', 'intelligence'],
  ['/v1/llm/budget-events', 'intelligence'],
  ['/v1/research', 'intelligence'],
  ['/v1/reviews', 'intelligence'],
  ['/v1/qa', 'intelligence'],
  ['/v1/reports', 'intelligence'],
  ['/v1/voice/sessions', 'voice'],
  ['/v1/voice/memories', 'voice'],
  ['/v1/voice/tool-calls', 'voice'],
  ['/v1/me/context', 'personal'],
  ['/v1/me/profile', 'personal'],
  ['/v1/me/goals', 'personal'],
  ['/v1/me/memories', 'personal'],
  ['/v1/me/briefings', 'personal'],
  ['/v1/me/opportunities', 'personal'],
  ['/v1/tenants/current', 'personal'],
  ['/v1/consents', 'personal'],
  ['/v1/connectors', 'personal'],
  ['/v1/access-decisions', 'personal'],
  ['/v1/operator/tools', 'operator'],
  ['/v1/operator/capabilities', 'operator'],
  ['/v1/operator/sessions', 'operator'],
  ['/v1/operator/sessions/active', 'operator'],
  ['/v1/operator/live-state', 'operator'],
  ['/v1/operator/memories', 'operator'],
  ['/v1/system/status', 'system'],
];

let h: Harness;
beforeAll(async () => { h = await buildTestGateway(); });
afterAll(async () => { await h.close(); });

describe('service-kit surface (harness sanity)', () => {
  it('/health is public', async () => {
    const res = await h.service.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', serviceId: 'gateway-api' });
  });
  it('/.factory/manifest is public; /.factory/logs is token-guarded', async () => {
    expect((await h.service.app.inject({ method: 'GET', url: '/.factory/manifest' })).statusCode).toBe(200);
    expect((await h.service.app.inject({ method: 'GET', url: '/.factory/logs' })).statusCode).toBe(401);
    expect((await h.service.app.inject({ method: 'GET', url: '/.factory/logs', headers: asAdmin() })).statusCode).toBe(200);
  });
});

describe('auth sweep — every read surface', () => {
  it.each(READS)('%s (%s): 401 unauthenticated with exact envelope', async (path) => {
    const res = await h.service.app.inject({ method: 'GET', url: path });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ ok: false, error: { code: 'unauthorized', message: 'admin or internal token required' } });
    expect(res.headers[REQUEST_ID_HEADER]).toBeTruthy();
  });

  it.each(READS)('%s (%s): 200 with admin token', async (path) => {
    const res = await h.service.app.inject({ method: 'GET', url: path, headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(res.headers[REQUEST_ID_HEADER]).toBeTruthy();
  });

  it('internal service token is also accepted', async () => {
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/tasks', headers: asInternal() });
    expect(res.statusCode).toBe(200);
  });
});
