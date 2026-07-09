/**
 * K1.1 contract tests — scope stamping and query filters (shared/src/scope).
 * `stampScope` and `scopeFilter` are the write-side and read-side halves of
 * data isolation. Both must fail closed when required identifiers are absent.
 */
import { describe, it, expect } from 'vitest';
import { stampScope, scopeFilter, buildAccessDecision, canAccess, legacyRoleToAuthContext, ESAN_TENANT_ID, ESAN_USER_ID } from '../src/scope/index.js';
import { RequiredScopeSchema } from '../src/schemas/scope.js';
import type { AuthContext } from '../src/schemas/scope.js';

const owner: AuthContext = legacyRoleToAuthContext('owner');
const bare: AuthContext = { actorId: 'x', actorType: 'human_user', roles: [], permissions: [], scopes: [], isOwner: false };

describe('stampScope (write side)', () => {
  it('stamps user scope from the actor context', () => {
    const s = stampScope(owner, 'user');
    expect(s).toMatchObject({ scope: 'user', userId: ESAN_USER_ID, visibility: 'private', createdBy: ESAN_USER_ID });
  });
  it('global stamps carry NO tenant/user binding', () => {
    const s = stampScope(owner, 'global');
    expect(s.tenantId).toBeNull();
    expect(s.userId).toBeNull();
    expect(s.visibility).toBe('public');
  });
  it('tenant stamp defaults to the active tenant with tenant visibility', () => {
    const s = stampScope(owner, 'tenant');
    expect(s.tenantId).toBe(ESAN_TENANT_ID);
    expect(s.visibility).toBe('tenant');
  });
  it('fails closed on missing identifiers', () => {
    expect(() => stampScope(bare, 'user')).toThrow(/fail closed/);
    expect(() => stampScope(bare, 'tenant')).toThrow(/fail closed/);
    expect(() => stampScope(owner, 'project')).toThrow(/fail closed/); // no projectId
    expect(() => stampScope(owner, 'case')).toThrow(/fail closed/);    // no caseId
  });
  it('case records are restricted by default', () => {
    const s = stampScope(owner, 'case', { caseId: 'case_1' });
    expect(s.visibility).toBe('restricted');
    expect(s.caseId).toBe('case_1');
  });
});

describe('scopeFilter (read side)', () => {
  it('user filter binds to the actor primary user', () => {
    expect(scopeFilter(owner, 'user')).toEqual({ scope: 'user', userId: ESAN_USER_ID });
  });
  it('tenant filter binds to the active tenant', () => {
    expect(scopeFilter(owner, 'tenant')).toEqual({ scope: 'tenant', tenantId: ESAN_TENANT_ID });
  });
  it('global filter also matches legacy records with no scope field', () => {
    expect(scopeFilter(owner, 'global')).toEqual({ $or: [{ scope: 'global' }, { scope: { $exists: false } }] });
  });
  it('fails closed without the required actor identifiers', () => {
    expect(() => scopeFilter(bare, 'user')).toThrow(/fail closed/);
    expect(() => scopeFilter(bare, 'tenant')).toThrow(/fail closed/);
    expect(() => scopeFilter(owner, 'project')).toThrow(/fail closed/); // no activeProjectId
    expect(() => scopeFilter(owner, 'case')).toThrow(/fail closed/);    // no activeCaseId
  });
});

describe('RequiredScopeSchema', () => {
  it('rejects a record without an explicit scope', () => {
    expect(RequiredScopeSchema.safeParse({}).success).toBe(false);
  });
  it('applies safe defaults around an explicit scope', () => {
    const parsed = RequiredScopeSchema.parse({ scope: 'user', createdBy: 'user_x' });
    expect(parsed.visibility).toBe('private');
    expect(parsed.tenantId).toBeNull();
  });
});

describe('buildAccessDecision (audit record)', () => {
  it('records the verdict verbatim with a prefixed decision id', () => {
    const request = { actor: owner, action: 'read' as const, resource: 'memories', scope: 'user' as const, userId: 'user_other' };
    const verdict = canAccess(request);
    const decision = buildAccessDecision(request, verdict);
    expect(decision.decisionId).toMatch(/^acc_[0-9a-f]{12}$/);
    expect(decision.decision).toBe('approval_required');
    expect(decision.actorId).toBe(ESAN_USER_ID);
    expect(decision.targetUserId).toBe('user_other');
    expect(decision.reason).toBe(verdict.reason);
  });
});
