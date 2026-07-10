/**
 * K1.3 characterization — security group: safe mode, RBAC enforcement,
 * rate limiting, security checks. These are the behaviors that MUST NOT
 * drift during the split.
 */
import { describe, it, expect } from 'vitest';
import { COLLECTIONS } from '@factory/shared';
import { buildTestGateway, asAdmin } from './helpers/build-app.js';

describe('safe mode', () => {
  it('boot seeds safe_mode=false from env default; GET reflects it', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/security/safe-mode', headers: asAdmin() });
    expect(res.json()).toEqual({ ok: true, data: { enabled: false } });
    await h.close();
  });

  it('a pre-existing safe_mode=true setting survives boot (no reseed) and blocks mutations with 403 safe_mode_blocked', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.SYSTEM_SETTINGS).docs.push({ settingId: 'safe_mode', value: true, updatedAt: 'x' });
    });
    const get = await h.service.app.inject({ method: 'GET', url: '/v1/security/safe-mode', headers: asAdmin() });
    expect(get.json().data.enabled).toBe(true);
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/tasks', headers: asAdmin(), payload: { goal: 'blocked in safe mode' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('safe_mode_blocked');
    // The block itself is audited + a security event is written.
    expect(h.db.col(COLLECTIONS.AUDIT_LOGS).docs.some((a) => a.action === 'createTask_blocked_safe_mode')).toBe(true);
    expect(h.db.col(COLLECTIONS.SECURITY_EVENTS).docs.length).toBeGreaterThan(0);
    await h.close();
  });

  it('POST safe-mode toggles the runtime setting and audits it; setSafeMode itself is NOT safe-mode-blocked (the off switch works)', async () => {
    const h = await buildTestGateway({}, (db) => {
      db.col(COLLECTIONS.SYSTEM_SETTINGS).docs.push({ settingId: 'safe_mode', value: true, updatedAt: 'x' });
    });
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/security/safe-mode', headers: asAdmin(), payload: { enabled: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ enabled: false });
    const setting = h.db.col(COLLECTIONS.SYSTEM_SETTINGS).docs.find((d) => d.settingId === 'safe_mode');
    expect(setting?.value).toBe(false);
    expect(h.db.col(COLLECTIONS.AUDIT_LOGS).docs.some((a) => a.action === 'safe_mode_disabled')).toBe(true);
    await h.close();
  });

  it('a viewer cannot toggle safe mode (403 forbidden)', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/security/safe-mode', headers: asAdmin('viewer'), payload: { enabled: true } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
    await h.close();
  });
});

describe('security check', () => {
  it('POST /v1/security/check persists a check record and returns it', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/security/check', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.checkId).toMatch(/^\w+/);
    expect(h.db.col(COLLECTIONS.SECURITY_CHECKS).docs.length).toBe(1);
    expect(h.db.col(COLLECTIONS.AUDIT_LOGS).docs.some((a) => a.action === 'security_check_run')).toBe(true);
    await h.close();
  });
});

describe('rate limiting (60/min per bucket:role:ip)', () => {
  it('the 61st task mutation in a window is rejected with 429 rate_limited + a security event', async () => {
    const h = await buildTestGateway();
    let last = 0;
    for (let i = 0; i < 61; i++) {
      // Invalid body on purpose: rate check runs BEFORE validation, so these
      // consume budget without touching the orchestrator forward path.
      const res = await h.service.app.inject({ method: 'POST', url: '/v1/tasks', headers: asAdmin(), payload: {} });
      last = res.statusCode;
      if (i < 60) expect(res.statusCode).toBe(400);
    }
    expect(last).toBe(429);
    const res = await h.service.app.inject({ method: 'POST', url: '/v1/tasks', headers: asAdmin(), payload: {} });
    expect(res.json().error.code).toBe('rate_limited');
    expect(h.db.col(COLLECTIONS.SECURITY_EVENTS).docs.some((e) => e.detail === 'rate limit exceeded')).toBe(true);
    await h.close();
  }, 20_000);
});

describe('rbac surface', () => {
  it('GET /v1/rbac returns the {roles, permissions, users} shape', async () => {
    const h = await buildTestGateway();
    const res = await h.service.app.inject({ method: 'GET', url: '/v1/rbac', headers: asAdmin() });
    expect(res.json().data).toEqual({ roles: [], permissions: [], users: [] });
    await h.close();
  });
});
