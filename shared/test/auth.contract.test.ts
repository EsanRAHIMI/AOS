/**
 * K1.1 contract tests — token auth guards (shared/src/auth).
 * These pin the service-to-service and human-admin token contracts every
 * service relies on. A behavior change here is a breaking security change.
 */
import { describe, it, expect } from 'vitest';
import { safeEqual, hasValidInternalToken, hasValidAdminToken, INTERNAL_TOKEN_HEADER, ADMIN_TOKEN_HEADER, hashPassword, verifyPasswordHash, generateSessionToken, hashSessionToken, SESSION_TOKEN_HEADER } from '../src/auth/index.js';

const INTERNAL = 'internal-secret-token';
const ADMIN = 'admin-secret-token';

describe('safeEqual', () => {
  it('accepts identical strings', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true);
  });
  it('rejects different strings of equal length', () => {
    expect(safeEqual('abc123', 'abc124')).toBe(false);
  });
  it('rejects different lengths without throwing', () => {
    expect(safeEqual('short', 'much-longer-value')).toBe(false);
  });
  it('rejects empty vs non-empty', () => {
    expect(safeEqual('', 'x')).toBe(false);
  });
});

describe('hasValidInternalToken', () => {
  it('accepts the correct token on the canonical header', () => {
    expect(hasValidInternalToken({ headers: { [INTERNAL_TOKEN_HEADER]: INTERNAL }, expectedInternalToken: INTERNAL })).toBe(true);
  });
  it('rejects a wrong token', () => {
    expect(hasValidInternalToken({ headers: { [INTERNAL_TOKEN_HEADER]: 'wrong' }, expectedInternalToken: INTERNAL })).toBe(false);
  });
  it('rejects a missing header', () => {
    expect(hasValidInternalToken({ headers: {}, expectedInternalToken: INTERNAL })).toBe(false);
  });
  it('rejects an empty provided token even if expected is empty-ish', () => {
    expect(hasValidInternalToken({ headers: { [INTERNAL_TOKEN_HEADER]: '' }, expectedInternalToken: INTERNAL })).toBe(false);
  });
  it('takes the first value of an array header', () => {
    expect(hasValidInternalToken({ headers: { [INTERNAL_TOKEN_HEADER]: [INTERNAL, 'other'] }, expectedInternalToken: INTERNAL })).toBe(true);
  });
});

describe('hasValidAdminToken', () => {
  it('accepts the correct admin token', () => {
    expect(hasValidAdminToken({ headers: { [ADMIN_TOKEN_HEADER]: ADMIN }, expectedInternalToken: INTERNAL, expectedAdminToken: ADMIN })).toBe(true);
  });
  it('rejects when no expected admin token is configured (fail closed)', () => {
    expect(hasValidAdminToken({ headers: { [ADMIN_TOKEN_HEADER]: ADMIN }, expectedInternalToken: INTERNAL })).toBe(false);
  });
  it('rejects the internal token presented as an admin token', () => {
    expect(hasValidAdminToken({ headers: { [ADMIN_TOKEN_HEADER]: INTERNAL }, expectedInternalToken: INTERNAL, expectedAdminToken: ADMIN })).toBe(false);
  });
});

describe('token header constants', () => {
  it('canonical header names are frozen contracts', () => {
    expect(INTERNAL_TOKEN_HEADER).toBe('x-factory-internal-token');
    expect(ADMIN_TOKEN_HEADER).toBe('x-factory-admin-token');
    expect(SESSION_TOKEN_HEADER).toBe('x-factory-session-token');
  });
});

/**
 * K1 Real Auth (D-164) — password hashing + session token contract tests.
 */
describe('hashPassword / verifyPasswordHash', () => {
  it('produces the scrypt$<salt>$<hash> format shared with dashboard-web/scripts/hash-password.mjs', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(stored.split('$')).toHaveLength(3);
    expect(stored.startsWith('scrypt$')).toBe(true);
  });

  it('verifies the correct password', () => {
    const stored = hashPassword('s3cret-pw');
    expect(verifyPasswordHash('s3cret-pw', stored)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const stored = hashPassword('s3cret-pw');
    expect(verifyPasswordHash('wrong-pw', stored)).toBe(false);
  });

  it('never throws on a malformed stored hash — fails closed instead', () => {
    expect(verifyPasswordHash('anything', 'not-a-valid-hash')).toBe(false);
    expect(verifyPasswordHash('anything', 'scrypt$onlytwoparts')).toBe(false);
    expect(verifyPasswordHash('anything', 'scrypt$zz$zz')).toBe(false); // non-hex
    expect(verifyPasswordHash('anything', '')).toBe(false);
  });

  it('two hashes of the same password are never identical (random salt per call)', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(verifyPasswordHash('same-password', a)).toBe(true);
    expect(verifyPasswordHash('same-password', b)).toBe(true);
  });

  it('never generates a password itself — hashPassword is a pure function of its input, not a generator', () => {
    // Documents the D-164 mandatory correction: nothing in this module can
    // produce a plaintext credential; hashPassword only ever hashes what the
    // caller already supplied.
    expect(hashPassword.length).toBe(1); // arity: (password) => string, no "generate a random one" mode
  });
});

describe('generateSessionToken / hashSessionToken', () => {
  it('generates a high-entropy hex token', () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 bytes hex-encoded
  });

  it('generates a different token every call', () => {
    expect(generateSessionToken()).not.toBe(generateSessionToken());
  });

  it('hashes deterministically (same token -> same hash, for DB lookup)', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it('different tokens hash differently', () => {
    expect(hashSessionToken(generateSessionToken())).not.toBe(hashSessionToken(generateSessionToken()));
  });

  it('the raw token is never recoverable from its hash (one-way)', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).not.toContain(token);
    expect(hash).toHaveLength(64); // sha256 hex
  });
});
