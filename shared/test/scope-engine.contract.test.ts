/**
 * K1.1 contract tests — the central authorization engine (shared/src/scope).
 * `canAccess` is THE isolation boundary for the whole platform. Every rule
 * asserted here is a tenant/user-isolation guarantee: if one of these tests
 * breaks, data isolation broke.
 */
import { describe, it, expect } from 'vitest';
import { canAccess, classifyGoalScope, legacyRoleToAuthContext, accessDecisionFilter, ESAN_TENANT_ID, ESAN_USER_ID, type AccessRequest } from '../src/scope/index.js';
import type { AuthContext } from '../src/schemas/scope.js';

/* ------------------------------ fixtures ------------------------------- */

const owner: AuthContext = legacyRoleToAuthContext('owner');

const member = (roles: string[], overrides: Partial<AuthContext> = {}): AuthContext => ({
  actorId: 'user_member',
  actorType: 'human_user',
  primaryUserId: 'user_member',
  activeTenantId: 'tenant_a',
  roles,
  permissions: [],
  scopes: ['tenant', 'user'],
  isOwner: false,
  ...overrides,
});

const agent: AuthContext = {
  actorId: 'service_agent',
  actorType: 'service_agent',
  roles: ['agent'],
  permissions: [],
  scopes: ['global'],
  isOwner: false,
};

const req = (partial: Partial<AccessRequest> & Pick<AccessRequest, 'actor' | 'action' | 'scope'>): AccessRequest => ({
  resource: 'test_resource',
  ...partial,
});

/* ------------------------------ fail closed ---------------------------- */

describe('fail-closed fundamentals', () => {
  it('denies any scoped operation with missing scope', () => {
    const v = canAccess(req({ actor: owner, action: 'read', scope: undefined }));
    expect(v.allowed).toBe(false);
    expect(v.decision).toBe('denied');
    expect(v.reason).toMatch(/fail closed/i);
  });

  it('denies user-scoped record without userId', () => {
    const v = canAccess(req({ actor: owner, action: 'read', scope: 'user', userId: null }));
    expect(v.decision).toBe('denied');
  });

  it('denies tenant-scoped record without tenantId', () => {
    const v = canAccess(req({ actor: owner, action: 'read', scope: 'tenant', tenantId: null }));
    expect(v.decision).toBe('denied');
  });

  it('denies project records missing tenantId or projectId', () => {
    expect(canAccess(req({ actor: owner, action: 'read', scope: 'project', tenantId: 't', projectId: null })).decision).toBe('denied');
    expect(canAccess(req({ actor: owner, action: 'read', scope: 'project', tenantId: null, projectId: 'p' })).decision).toBe('denied');
  });
});

/* ------------------------------ consent gate --------------------------- */

describe('connector consent gate (before all scope logic)', () => {
  it('denies connector-derived data without an ACTIVE grant — even for the owner on their own data', () => {
    for (const consentStatus of ['revoked', 'expired', 'missing', undefined] as const) {
      const v = canAccess(req({ actor: owner, action: 'read', scope: 'user', userId: ESAN_USER_ID, requiresConsent: true, consentStatus }));
      expect(v.decision).toBe('denied');
      expect(v.reason).toMatch(/consent/i);
    }
  });
  it('passes the gate with an active grant', () => {
    const v = canAccess(req({ actor: owner, action: 'read', scope: 'user', userId: ESAN_USER_ID, requiresConsent: true, consentStatus: 'active' }));
    expect(v.allowed).toBe(true);
  });
});

/* ------------------------------ agents --------------------------------- */

describe('agent restrictions', () => {
  it('service agents can NEVER approve — human approval required', () => {
    const v = canAccess(req({ actor: agent, action: 'approve', scope: 'global' }));
    expect(v.decision).toBe('denied');
    expect(v.reason).toMatch(/human approval/i);
  });
  it('agents can read global kernel state', () => {
    expect(canAccess(req({ actor: agent, action: 'read', scope: 'global' })).allowed).toBe(true);
  });
});

/* ------------------------------ user scope ----------------------------- */

describe('user scope isolation', () => {
  it('a user reads their own data', () => {
    const v = canAccess(req({ actor: member(['viewer']), action: 'read', scope: 'user', userId: 'user_member' }));
    expect(v.allowed).toBe(true);
  });
  it('a pure viewer cannot mutate even their own data', () => {
    const v = canAccess(req({ actor: member(['viewer']), action: 'update', scope: 'user', userId: 'user_member' }));
    expect(v.decision).toBe('denied');
  });
  it("another user's private data is denied", () => {
    const v = canAccess(req({ actor: member(['tenant_admin']), action: 'read', scope: 'user', userId: 'user_other' }));
    expect(v.decision).toBe('denied');
  });
  it("owner access to another user's data is NEVER silent — approval_required", () => {
    const v = canAccess(req({ actor: owner, action: 'read', scope: 'user', userId: 'user_other' }));
    expect(v.allowed).toBe(false);
    expect(v.decision).toBe('approval_required');
    expect(v.requiredApproval).toBe('owner_user_data_access');
    expect(v.auditRequired).toBe(true);
  });
});

/* ------------------------------ tenant scope --------------------------- */

describe('tenant scope isolation', () => {
  it('a tenant member with a read role reads tenant data', () => {
    const v = canAccess(req({ actor: member(['viewer']), action: 'read', scope: 'tenant', tenantId: 'tenant_a' }));
    expect(v.allowed).toBe(true);
  });
  it('tenant reads require a tenant role', () => {
    const v = canAccess(req({ actor: member(['citizen']), action: 'read', scope: 'tenant', tenantId: 'tenant_a' }));
    expect(v.decision).toBe('denied');
  });
  it('tenant mutations require tenant_admin/tenant_operator', () => {
    expect(canAccess(req({ actor: member(['viewer']), action: 'update', scope: 'tenant', tenantId: 'tenant_a' })).decision).toBe('denied');
    const v = canAccess(req({ actor: member(['tenant_operator']), action: 'update', scope: 'tenant', tenantId: 'tenant_a' }));
    expect(v.allowed).toBe(true);
    expect(v.auditRequired).toBe(true);
  });
  it('a non-owner NEVER crosses into a foreign tenant', () => {
    const v = canAccess(req({ actor: member(['tenant_admin']), action: 'read', scope: 'tenant', tenantId: 'tenant_b' }));
    expect(v.decision).toBe('denied');
  });
  it('even the owner needs explicit approval for a foreign tenant', () => {
    const v = canAccess(req({ actor: owner, action: 'read', scope: 'tenant', tenantId: 'tenant_foreign' }));
    expect(v.decision).toBe('approval_required');
    expect(v.requiredApproval).toBe('owner_foreign_tenant');
  });
});

/* ------------------------------ global scope --------------------------- */

describe('global kernel scope', () => {
  it('kernel reads require a platform role', () => {
    expect(canAccess(req({ actor: member(['viewer']), action: 'read', scope: 'global' })).decision).toBe('denied');
    expect(canAccess(req({ actor: member(['platform_viewer']), action: 'read', scope: 'global' })).allowed).toBe(true);
  });
  it('kernel mutations require a platform mutate role', () => {
    expect(canAccess(req({ actor: member(['platform_viewer']), action: 'update', scope: 'global' })).decision).toBe('denied');
    const v = canAccess(req({ actor: member(['platform_operator']), action: 'update', scope: 'global' }));
    expect(v.allowed).toBe(true);
    expect(v.auditRequired).toBe(true);
  });
  it('critical global changes are owner-gated even for platform admins', () => {
    const v = canAccess(req({ actor: member(['platform_admin']), action: 'update', scope: 'global', riskLevel: 'critical' }));
    expect(v.decision).toBe('approval_required');
    expect(v.requiredApproval).toBe('owner_critical_global');
  });
  it('high/critical global mutations by the owner require evidence', () => {
    const v = canAccess(req({ actor: owner, action: 'update', scope: 'global', riskLevel: 'critical' }));
    expect(v.allowed).toBe(true);
    expect(v.evidenceRequired).toBe(true);
  });
});

/* ------------------------- cross-tenant analytics ----------------------- */

describe('cross-tenant analytics', () => {
  it('is approval-gated for the owner and denied for everyone else', () => {
    expect(canAccess(req({ actor: owner, action: 'analyze_cross_tenant', scope: 'global' })).decision).toBe('approval_required');
    expect(canAccess(req({ actor: member(['tenant_admin']), action: 'analyze_cross_tenant', scope: 'global' })).decision).toBe('denied');
  });
});

/* ------------------------------ case scope ----------------------------- */

describe('case scope (strictest)', () => {
  const citizen = member(['citizen'], { actorId: 'user_citizen', primaryUserId: 'user_citizen' });
  const caseBase = { scope: 'case' as const, tenantId: 'tenant_gov', caseId: 'case_1', caseCitizenUserId: 'user_citizen' };

  it('a citizen reads their own case', () => {
    const v = canAccess(req({ actor: citizen, action: 'read', ...caseBase }));
    expect(v.allowed).toBe(true);
    expect(v.auditRequired).toBe(true);
  });
  it("a citizen cannot read someone else's case", () => {
    const v = canAccess(req({ actor: citizen, action: 'read', ...caseBase, caseCitizenUserId: 'user_someone_else' }));
    expect(v.decision).toBe('denied');
  });
  it('a citizen may update but never delete their own case', () => {
    expect(canAccess(req({ actor: citizen, action: 'update', ...caseBase })).allowed).toBe(true);
    expect(canAccess(req({ actor: citizen, action: 'delete', ...caseBase })).decision).toBe('denied');
  });
  it('assigned case staff in the tenant get access; unassigned staff do not', () => {
    const worker = member(['case_worker'], { actorId: 'user_worker', primaryUserId: 'user_worker', activeTenantId: 'tenant_gov' });
    expect(canAccess(req({ actor: worker, action: 'read', ...caseBase, caseAssignees: ['user_worker'] })).allowed).toBe(true);
    expect(canAccess(req({ actor: worker, action: 'read', ...caseBase, caseAssignees: [] })).decision).toBe('denied');
  });
  it('owner access to citizen case data is approval-gated, never silent', () => {
    const v = canAccess(req({ actor: owner, action: 'read', ...caseBase }));
    expect(v.decision).toBe('approval_required');
    expect(v.requiredApproval).toBe('owner_case_access');
  });
});

/* ------------------------- legacy auth mapping -------------------------- */

describe('legacyRoleToAuthContext', () => {
  it('maps owner onto the seeded personal identity', () => {
    expect(owner.actorId).toBe(ESAN_USER_ID);
    expect(owner.activeTenantId).toBe(ESAN_TENANT_ID);
    expect(owner.isOwner).toBe(true);
  });
  it('maps agent onto a non-owner service identity', () => {
    const a = legacyRoleToAuthContext('agent');
    expect(a.actorType).toBe('service_agent');
    expect(a.isOwner).toBe(false);
  });
  it('viewer mapping cannot mutate global kernel', () => {
    const viewer = legacyRoleToAuthContext('viewer');
    expect(canAccess(req({ actor: viewer, action: 'update', scope: 'global' })).decision).toBe('denied');
  });
});

/* ------------------------- goal scope classifier ------------------------ */

describe('classifyGoalScope', () => {
  it('personal goals are user-scoped', () => {
    expect(classifyGoalScope('plan my week').scope).toBe('user');
    expect(classifyGoalScope('what should i do next').scope).toBe('user');
  });
  it('tenant operations are tenant-scoped', () => {
    expect(classifyGoalScope('prepare our team quarterly summary').scope).toBe('tenant');
  });
  it('citizen/case work is case-scoped', () => {
    expect(classifyGoalScope('review the citizen submission').scope).toBe('case');
  });
  it('kernel work defaults to global', () => {
    expect(classifyGoalScope('refactor the gateway routes').scope).toBe('global');
  });
});

/* ------------------------- accessDecisionFilter (K1.4f, D-163) ---------- */
//
// GET /v1/access-decisions (routes/personal.ts) used to build this filter
// inline; extracted to a pure function so the policy — "owners and platform
// admins see the whole access log, everyone else sees only their own
// decisions" — is unit-testable independent of the HTTP layer.

describe('accessDecisionFilter', () => {
  it('an owner sees the whole platform access log (empty filter)', () => {
    expect(accessDecisionFilter(owner)).toEqual({});
  });

  it('a platform_admin sees the whole platform access log (empty filter), even if not owner', () => {
    const admin = member(['platform_admin']);
    expect(accessDecisionFilter(admin)).toEqual({});
  });

  it('a non-owner, non-platform_admin actor is filtered to only their own decisions', () => {
    const viewer = member(['platform_viewer', 'viewer']);
    expect(accessDecisionFilter(viewer)).toEqual({ actorId: 'user_member' });
  });

  it('the agent role (no ownership, no platform_admin) is filtered to its own actorId', () => {
    expect(accessDecisionFilter(agent)).toEqual({ actorId: 'service_agent' });
  });
});
