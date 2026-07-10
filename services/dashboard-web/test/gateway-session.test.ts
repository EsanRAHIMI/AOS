/**
 * K1 Real Auth dashboard bridge (D-165) — first test suite in dashboard-web.
 *
 * Covers the two things this pass changes: (1) does the dashboard forward a
 * real bridged gateway session token when it has one, and only fall back to
 * the legacy admin-token + role-header pair when it doesn't; (2) do
 * gatewayLogin/gatewayLogout call the right gateway endpoints with the right
 * shape, and never throw regardless of what the gateway returns.
 *
 * `fetch` is mocked — this is a network-free unit suite, not an integration
 * test against a live gateway. End-to-end proof that a real session token
 * resolves to a real actor on the gateway side is already covered by
 * services/gateway-api/test/characterization.auth-real.test.ts (24 tests) —
 * this suite only needs to prove the dashboard constructs the right request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAuthHeaders, gatewayLogin, gatewayLogout, SESSION_TOKEN_HEADER } from '../src/lib/gateway-session';

describe('buildAuthHeaders', () => {
  it('with no session: sends only the admin token', () => {
    const headers = buildAuthHeaders('admin-tok', null);
    expect(headers).toEqual({ 'x-factory-admin-token': 'admin-tok' });
  });

  it('with a local-only session (no bridged gateway token): legacy admin+role pair, no session header', () => {
    const headers = buildAuthHeaders('admin-tok', { role: 'owner' });
    expect(headers).toEqual({ 'x-factory-admin-token': 'admin-tok', 'x-factory-role': 'owner' });
    expect(headers[SESSION_TOKEN_HEADER]).toBeUndefined();
  });

  it('with a bridged real gateway session: forwards the session token header', () => {
    const headers = buildAuthHeaders('admin-tok', { role: 'owner', gatewaySessionToken: 'a'.repeat(64) });
    expect(headers[SESSION_TOKEN_HEADER]).toBe('a'.repeat(64));
    // Legacy role header still present too (harmless — gateway ignores it
    // once a session token is declared; see gateway-session.ts doc comment).
    expect(headers['x-factory-role']).toBe('owner');
    expect(headers['x-factory-admin-token']).toBe('admin-tok');
  });

  it('SESSION_TOKEN_HEADER matches the gateway constant', () => {
    expect(SESSION_TOKEN_HEADER).toBe('x-factory-session-token');
  });
});

describe('gatewayLogin', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts email/password to /v1/auth/login and returns the token on success', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { token: 'tok123', expiresAt: '2099-01-01T00:00:00.000Z' } }),
    });
    const result = await gatewayLogin('a@example.com', 'secret');
    expect(result).toEqual({ token: 'tok123', expiresAt: '2099-01-01T00:00:00.000Z' });

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toMatch(/\/v1\/auth\/login$/);
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ email: 'a@example.com', password: 'secret' });
  });

  it('returns null (never throws) on a 401 — expected for dev demo users / unprovisioned operators', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({ ok: false }) });
    const result = await gatewayLogin('demo@local', 'demo');
    expect(result).toBeNull();
  });

  it('returns null (never throws) on a network error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await gatewayLogin('a@example.com', 'secret');
    expect(result).toBeNull();
  });

  it('returns null on a malformed success envelope (missing token)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: {} }) });
    const result = await gatewayLogin('a@example.com', 'secret');
    expect(result).toBeNull();
  });
});

describe('gatewayLogout', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts to /v1/auth/logout with the session token header', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await gatewayLogout('tok123');
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toMatch(/\/v1\/auth\/logout$/);
    expect(call[1].method).toBe('POST');
    expect(call[1].headers[SESSION_TOKEN_HEADER]).toBe('tok123');
  });

  it('never throws even if the gateway call fails — sign-out must never be blocked', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(gatewayLogout('tok123')).resolves.toBeUndefined();
  });
});
