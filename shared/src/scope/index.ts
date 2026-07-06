/**
 * Phase AA — Scope & Identity core: the CENTRAL authorization engine.
 *
 * One engine, one place. Every scoped gateway route calls `canAccess`; there
 * is no duplicated or scattered authorization logic. Pure and deterministic
 * (same input ⇒ same decision) so every isolation rule is unit-testable.
 *
 * Enforced rules:
 *  - global kernel access only for platform roles (mutation: owner/admin/operator)
 *  - tenant data only for members of THAT tenant with sufficient role
 *  - user data only for the user themself (or owner via explicit, audited path)
 *  - project data only inside its tenant
 *  - case data strictest: assigned roles + the citizen who owns it, audited
 *  - connector-derived data requires an ACTIVE consent grant
 *  - agents can request but never approve sensitive actions (incl. their own)
 *  - viewers never mutate
 *  - missing scope ⇒ FAIL CLOSED
 *  - cross-tenant analytics ⇒ approval_required (owner), never silent
 */
import { genId, nowIso } from '../utils/index.js';
import {
  type AuthContext, type Scope, type ActorType,
} from '../schemas/scope.js';
import type { Tenant, UserProfile, TenantMembership, AccessDecision, ConsentGrant } from '../schemas/identity.js';

export type ScopedAction = 'read' | 'list' | 'create' | 'update' | 'delete' | 'approve' | 'execute' | 'analyze_cross_tenant';

export interface AccessRequest {
  actor: AuthContext;
  action: ScopedAction;
  resource: string;
  scope: Scope | undefined;
  tenantId?: string | null;
  userId?: string | null;
  projectId?: string | null;
  caseId?: string | null;
  /** For case resources: actors assigned to the case. */
  caseAssignees?: string[];
  /** For case resources: the citizen who owns the case. */
  caseCitizenUserId?: string | null;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  /** For connector-derived resources: the consent grant status, if loaded. */
  consentStatus?: 'active' | 'revoked' | 'expired' | 'missing';
  requiresConsent?: boolean;
}

export interface AccessVerdict {
  allowed: boolean;
  decision: 'allowed' | 'denied' | 'approval_required';
  reason: string;
  requiredApproval?: string;
  auditRequired: boolean;
  evidenceRequired: boolean;
}

const GLOBAL_MUTATE_ROLES = new Set(['owner', 'platform_admin', 'platform_operator']);
const GLOBAL_READ_ROLES = new Set(['owner', 'platform_admin', 'platform_operator', 'platform_viewer', 'agent']);
const TENANT_MUTATE_ROLES = new Set(['owner', 'tenant_admin', 'tenant_operator']);
const TENANT_READ_ROLES = new Set(['owner', 'tenant_admin', 'tenant_operator', 'reviewer', 'viewer', 'auditor']);
const CASE_STAFF_ROLES = new Set(['government_official', 'department_operator', 'case_worker', 'public_service_auditor']);
const MUTATING: ReadonlySet<ScopedAction> = new Set(['create', 'update', 'delete', 'approve', 'execute']);

const deny = (reason: string, audit = true): AccessVerdict => ({ allowed: false, decision: 'denied', reason, auditRequired: audit, evidenceRequired: false });
const allow = (reason: string, audit = false, evidence = false): AccessVerdict => ({ allowed: true, decision: 'allowed', reason, auditRequired: audit, evidenceRequired: evidence });
const needsApproval = (reason: string, requiredApproval: string): AccessVerdict => ({ allowed: false, decision: 'approval_required', reason, requiredApproval, auditRequired: true, evidenceRequired: true });

export function canAccess(req: AccessRequest): AccessVerdict {
  const { actor, action } = req;
  const roles = new Set(actor.roles);
  const mutating = MUTATING.has(action);

  // Consent gate for connector-derived data — before any scope logic.
  if (req.requiresConsent) {
    if (req.consentStatus !== 'active') return deny(`connector data requires an ACTIVE consent grant (status: ${req.consentStatus ?? 'missing'})`);
  }

  // Agents never approve — not even actions they requested themselves.
  if (action === 'approve' && actor.actorType === 'service_agent') {
    return deny('service agents cannot approve sensitive actions — human approval required');
  }

  // Missing scope on a scoped operation ⇒ fail closed.
  if (!req.scope) return deny('missing scope — scoped operations fail closed');

  // Cross-tenant analytics is never silent.
  if (action === 'analyze_cross_tenant') {
    if (actor.isOwner) return needsApproval('cross-tenant analytics requires explicit approval + anonymization', 'owner_cross_tenant_analytics');
    return deny('cross-tenant analytics is owner-gated');
  }

  switch (req.scope) {
    case 'global': {
      if (mutating) {
        if (![...roles].some((r) => GLOBAL_MUTATE_ROLES.has(r))) return deny('global kernel mutations require a platform role');
        if (req.riskLevel === 'critical' && !actor.isOwner) return needsApproval('critical global kernel change requires OWNER approval', 'owner_critical_global');
        return allow('platform role may govern the global kernel', true, req.riskLevel === 'high' || req.riskLevel === 'critical');
      }
      if (![...roles].some((r) => GLOBAL_READ_ROLES.has(r))) return deny('global kernel access requires a platform role');
      return allow('platform role reads global kernel state');
    }

    case 'user': {
      if (!req.userId) return deny('user-scoped record without userId — fail closed');
      if (actor.primaryUserId && actor.primaryUserId === req.userId) {
        if (mutating && roles.has('viewer') && roles.size === 1) return deny('viewer role cannot mutate');
        return allow('user accesses their own data');
      }
      // Explicit, audited owner support path — never silent.
      if (actor.isOwner) return needsApproval('accessing another user’s private data requires an explicit, audited support approval', 'owner_user_data_access');
      return deny(`private user data belongs to ${req.userId} — access denied`);
    }

    case 'tenant': {
      if (!req.tenantId) return deny('tenant-scoped record without tenantId — fail closed');
      if (actor.activeTenantId !== req.tenantId && !actor.isOwner) return deny('actor is not operating in this tenant');
      if (actor.activeTenantId !== req.tenantId && actor.isOwner) return needsApproval('owner access to a foreign tenant requires explicit approval', 'owner_foreign_tenant');
      if (mutating) {
        if (![...roles].some((r) => TENANT_MUTATE_ROLES.has(r))) return deny('tenant mutations require tenant_admin/tenant_operator');
        return allow('tenant member mutates tenant data', true);
      }
      if (![...roles].some((r) => TENANT_READ_ROLES.has(r))) return deny('tenant reads require tenant membership with a role');
      return allow('tenant member reads tenant data');
    }

    case 'project': {
      if (!req.tenantId || !req.projectId) return deny('project records require tenantId + projectId — fail closed');
      // Project access rides on tenant access.
      return canAccess({ ...req, scope: 'tenant' });
    }

    case 'case': {
      if (!req.tenantId || !req.caseId) return deny('case records require tenantId + caseId — fail closed');
      const isCitizenOwner = Boolean(actor.primaryUserId && req.caseCitizenUserId && actor.primaryUserId === req.caseCitizenUserId);
      const isAssigned = Boolean(actor.primaryUserId && (req.caseAssignees ?? []).includes(actor.primaryUserId));
      const isCaseStaff = [...roles].some((r) => CASE_STAFF_ROLES.has(r));
      if (roles.has('citizen')) {
        if (!isCitizenOwner) return deny('citizens can only access their own cases');
        if (mutating && action !== 'update') return deny('citizens may only update their own case submissions');
        return allow('citizen accesses their own case', true);
      }
      if (isCaseStaff && actor.activeTenantId === req.tenantId && (isAssigned || roles.has('public_service_auditor') || roles.has('government_official'))) {
        return allow('authorized case role in tenant', true, mutating);
      }
      if (actor.isOwner) return needsApproval('owner access to citizen case data requires explicit audited approval', 'owner_case_access');
      return deny('case data is restricted to assigned case roles and the citizen');
    }
  }
}

/* -------------------------- scope stamping/filters ----------------------- */

export interface ScopeStamp { scope: Scope; tenantId: string | null; userId: string | null; projectId: string | null; caseId: string | null; visibility: 'private' | 'tenant' | 'role' | 'public' | 'restricted'; createdBy: string; updatedBy: string | null }

/** Build the stamp for a NEW scoped write. Throws (fail closed) when the
 *  required ids for the scope are missing. */
export function stampScope(actor: AuthContext, scope: Scope, opts: { tenantId?: string | null; userId?: string | null; projectId?: string | null; caseId?: string | null; visibility?: ScopeStamp['visibility'] } = {}): ScopeStamp {
  const tenantId = opts.tenantId ?? actor.activeTenantId ?? null;
  const userId = opts.userId ?? actor.primaryUserId ?? null;
  if (scope === 'user' && !userId) throw new Error('fail closed: user scope requires userId');
  if ((scope === 'tenant' || scope === 'project' || scope === 'case') && !tenantId) throw new Error(`fail closed: ${scope} scope requires tenantId`);
  if (scope === 'project' && !opts.projectId) throw new Error('fail closed: project scope requires projectId');
  if (scope === 'case' && !opts.caseId) throw new Error('fail closed: case scope requires caseId');
  return {
    scope,
    tenantId: scope === 'global' ? null : tenantId,
    userId: scope === 'user' || scope === 'case' ? userId : null,
    projectId: opts.projectId ?? null,
    caseId: opts.caseId ?? null,
    visibility: opts.visibility ?? (scope === 'user' ? 'private' : scope === 'case' ? 'restricted' : scope === 'global' ? 'public' : 'tenant'),
    createdBy: actor.actorId,
    updatedBy: null,
  };
}

/** Mongo filter that can never leak across a scope boundary. */
export function scopeFilter(actor: AuthContext, scope: Scope): Record<string, unknown> {
  switch (scope) {
    case 'user':
      if (!actor.primaryUserId) throw new Error('fail closed: no primary user for user-scoped query');
      return { scope: 'user', userId: actor.primaryUserId };
    case 'tenant':
      if (!actor.activeTenantId) throw new Error('fail closed: no active tenant for tenant-scoped query');
      return { scope: 'tenant', tenantId: actor.activeTenantId };
    case 'project':
      if (!actor.activeTenantId || !actor.activeProjectId) throw new Error('fail closed: project scope requires tenant + project');
      return { scope: 'project', tenantId: actor.activeTenantId, projectId: actor.activeProjectId };
    case 'case':
      if (!actor.activeTenantId || !actor.activeCaseId) throw new Error('fail closed: case scope requires tenant + case');
      return { scope: 'case', tenantId: actor.activeTenantId, caseId: actor.activeCaseId };
    case 'global':
      // Legacy kernel records may not carry a scope field yet — both forms are global.
      return { $or: [{ scope: 'global' }, { scope: { $exists: false } }] };
  }
}

export function buildAccessDecision(req: AccessRequest, verdict: AccessVerdict): AccessDecision {
  return {
    decisionId: genId('acc'),
    actorId: req.actor.actorId,
    actorType: req.actor.actorType,
    action: req.action,
    resource: req.resource,
    scope: req.scope ?? 'global',
    tenantId: req.tenantId ?? null,
    targetUserId: req.userId ?? null,
    caseId: req.caseId ?? null,
    decision: verdict.decision,
    reason: verdict.reason,
    createdAt: nowIso(),
  };
}

/* ------------------------------ Esan seed ------------------------------- */

export const ESAN_TENANT_ID = 'tenant_esan_personal';
export const ESAN_USER_ID = 'user_esan';

/** Idempotent seed records: Esan is the first owner and platform governor.
 *  The existing env-based owner login maps onto user_esan (backward compat). */
export function buildEsanSeed(): { tenant: Tenant; user: UserProfile; membership: TenantMembership } {
  const now = nowIso();
  return {
    tenant: { tenantId: ESAN_TENANT_ID, name: 'Esan — Personal', kind: 'personal', status: 'active', settings: {}, createdBy: ESAN_USER_ID, createdAt: now, updatedAt: now },
    user: { userId: ESAN_USER_ID, displayName: 'Esan', email: '', actorType: 'human_user', defaultTenantId: ESAN_TENANT_ID, locale: 'en', timezone: 'UTC', preferences: {}, status: 'active', createdAt: now, updatedAt: now },
    membership: { membershipId: 'membership_esan_owner', tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, roles: ['owner', 'tenant_admin'], status: 'active', createdAt: now, updatedAt: now },
  };
}

/** Map the legacy env-based dashboard role onto a full AuthContext.
 *  Owner/operator/viewer keep working exactly as before — they now resolve to
 *  user_esan in the personal tenant. Service agents get service identity. */
export function legacyRoleToAuthContext(role: string, sessionId?: string): AuthContext {
  if (role === 'agent') {
    return { actorId: 'service_agent', actorType: 'service_agent', roles: ['agent'], permissions: [], scopes: ['global'], isOwner: false, sessionId };
  }
  const mapped = role === 'owner' ? ['owner', 'tenant_admin'] : role === 'operator' ? ['platform_operator', 'tenant_operator'] : ['platform_viewer', 'viewer'];
  return {
    actorId: ESAN_USER_ID,
    actorType: 'human_user',
    primaryUserId: ESAN_USER_ID,
    activeTenantId: ESAN_TENANT_ID,
    roles: mapped,
    permissions: [],
    scopes: ['global', 'tenant', 'user'],
    isOwner: role === 'owner',
    sessionId,
  };
}

/* --------------------- operator goal scope classification ---------------- */

export type GoalScopeClass = { scope: Scope; mode: 'global_kernel' | 'personal' | 'tenant_operation' | 'case_operation'; reason: string };

/** Deterministic: is a goal global software evolution or scoped human work?
 *  The operator must never mix scopes. */
export function classifyGoalScope(goal: string): GoalScopeClass {
  const t = goal.toLowerCase();
  if (/\b(my|me|mine)\b.*(week|day|goals?|schedule|briefing|plan|priorit|calendar|email|task list)|plan (my|the) (week|day)|daily briefing|weekly (review|strategy)|what should i do (now|next)|next best action|my goal is|i want to|i need to/.test(t)) {
    return { scope: 'user', mode: 'personal', reason: 'personal goal — user-scoped data only, never kernel data as personal data' };
  }
  if (/\b(citizen|case #|public service case|case [a-z0-9_-]+)\b/.test(t)) {
    return { scope: 'case', mode: 'case_operation', reason: 'public-service case — strict case scope, role authorization and audit' };
  }
  if (/\b(tenant|organization|department|our (team|company))\b/.test(t)) {
    return { scope: 'tenant', mode: 'tenant_operation', reason: 'tenant operation — tenant-scoped data only' };
  }
  return { scope: 'global', mode: 'global_kernel', reason: 'global software evolution / kernel operation — no private user data read by default' };
}
