/**
 * K1.1 contract tests — token auth guards (shared/src/auth).
 * These pin the service-to-service and human-admin token contracts every
 * service relies on. A behavior change here is a breaking security change.
 */
import { describe, it, expect } from 'vitest';
import { safeEqual, hasValidInternalToken, hasValidAdminToken, INTERNAL_TOKEN_HEADER, ADMIN_TOKEN_HEADER } from '../src/auth/index.js';

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
  });
});
