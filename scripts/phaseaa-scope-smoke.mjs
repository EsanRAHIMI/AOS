#!/usr/bin/env node
/**
 * Phase AA smoke — scope, identity & multi-tenant isolation.
 * Drives the REAL shared authorization engine (canAccess), scope stamping,
 * seeds and goal-scope classification. Covers scenarios A–G at logic level.
 * Run from repo root after building shared: node scripts/phaseaa-scope-smoke.mjs
 */
import {
  canAccess, stampScope, scopeFilter, buildEsanSeed, legacyRoleToAuthContext,
  classifyGoalScope, buildAccessDecision, ESAN_TENANT_ID, ESAN_USER_ID,
  TenantSchema, UserProfileSchema, TenantMembershipSchema, ConsentGrantSchema,
  ConnectorAccountSchema, ScopedMemorySchema, UserGoalSchema, AccessDecisionSchema,
  PublicServiceCaseSchema, planForGoal,
} from '../shared/dist/index.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AA — scope & identity smoke\n');

const userA = { actorId: 'user_a', actorType: 'human_user', primaryUserId: 'user_a', activeTenantId: 'tenant_1', roles: ['tenant_operator'], permissions: [], scopes: [], isOwner: false };
const userB = { actorId: 'user_b', actorType: 'human_user', primaryUserId: 'user_b', activeTenantId: 'tenant_1', roles: ['tenant_operator'], permissions: [], scopes: [], isOwner: false };
const tenant2Op = { actorId: 'user_c', actorType: 'human_user', primaryUserId: 'user_c', activeTenantId: 'tenant_2', roles: ['tenant_operator'], permissions: [], scopes: [], isOwner: false };
const viewer = { actorId: 'user_v', actorType: 'human_user', primaryUserId: 'user_v', activeTenantId: 'tenant_1', roles: ['viewer'], permissions: [], scopes: [], isOwner: false };
const agent = { actorId: 'builder-agent', actorType: 'service_agent', roles: ['agent'], permissions: [], scopes: [], isOwner: false };
const owner = legacyRoleToAuthContext('owner');
const citizen1 = { actorId: 'cit_1', actorType: 'human_user', primaryUserId: 'cit_1', activeTenantId: 'gov_1', roles: ['citizen'], permissions: [], scopes: [], isOwner: false };
const citizen2 = { actorId: 'cit_2', actorType: 'human_user', primaryUserId: 'cit_2', activeTenantId: 'gov_1', roles: ['citizen'], permissions: [], scopes: [], isOwner: false };
const caseWorker = { actorId: 'cw_1', actorType: 'human_user', primaryUserId: 'cw_1', activeTenantId: 'gov_1', roles: ['case_worker'], permissions: [], scopes: [], isOwner: false };

console.log('— Scenario A: Esan owner bootstrap —');
const seed = buildEsanSeed();
check('Seed: Esan tenant/user/owner-membership build and validate', TenantSchema.safeParse(seed.tenant).success && UserProfileSchema.safeParse(seed.user).success && TenantMembershipSchema.safeParse(seed.membership).success && seed.membership.roles.includes('owner'));
check('Legacy owner login maps to user_esan in personal tenant', owner.primaryUserId === ESAN_USER_ID && owner.activeTenantId === ESAN_TENANT_ID && owner.isOwner);
check('Owner reads global kernel', canAccess({ actor: owner, action: 'read', resource: 'kernel', scope: 'global' }).allowed);
check('Owner governs global kernel (mutation allowed, audited)', (() => { const v = canAccess({ actor: owner, action: 'update', resource: 'kernel', scope: 'global' }); return v.allowed && v.auditRequired; })());
check('Owner reads their own user context', canAccess({ actor: owner, action: 'read', resource: 'me_context', scope: 'user', userId: ESAN_USER_ID }).allowed);

console.log('— Scenario B: private user isolation —');
check('User A reads their own private memory', canAccess({ actor: userA, action: 'read', resource: 'scoped_memories', scope: 'user', userId: 'user_a' }).allowed);
const b1 = canAccess({ actor: userB, action: 'read', resource: 'scoped_memories', scope: 'user', userId: 'user_a' });
check('User B CANNOT read user A private memory (same tenant)', !b1.allowed && b1.decision === 'denied');
check('Denial builds an access_decision record', AccessDecisionSchema.safeParse(buildAccessDecision({ actor: userB, action: 'read', resource: 'scoped_memories', scope: 'user', userId: 'user_a' }, b1)).success);
const b2 = canAccess({ actor: owner, action: 'read', resource: 'scoped_memories', scope: 'user', userId: 'user_a' });
check('Even OWNER needs explicit audited approval for another user’s data', !b2.allowed && b2.decision === 'approval_required');

console.log('— Scenario C: tenant isolation —');
check('Tenant-1 operator reads tenant-1 data', canAccess({ actor: userA, action: 'read', resource: 'tasks', scope: 'tenant', tenantId: 'tenant_1' }).allowed);
check('Tenant-2 operator CANNOT read tenant-1 data', !canAccess({ actor: tenant2Op, action: 'read', resource: 'tasks', scope: 'tenant', tenantId: 'tenant_1' }).allowed);
check('Owner foreign-tenant access requires explicit approval, never silent', canAccess({ actor: owner, action: 'read', resource: 'reports', scope: 'tenant', tenantId: 'tenant_2' }).decision === 'approval_required');
check('Cross-tenant analytics is approval-gated for owner, denied otherwise', canAccess({ actor: owner, action: 'analyze_cross_tenant', resource: 'analytics', scope: 'global' }).decision === 'approval_required' && !canAccess({ actor: userA, action: 'analyze_cross_tenant', resource: 'analytics', scope: 'global' }).allowed);

console.log('— Roles & fail-closed —');
check('Viewer cannot mutate scoped data', !canAccess({ actor: viewer, action: 'update', resource: 'tasks', scope: 'tenant', tenantId: 'tenant_1' }).allowed);
check('Agent cannot approve its own sensitive action', !canAccess({ actor: agent, action: 'approve', resource: 'operation', scope: 'global' }).allowed);
check('Agent may read global kernel state', canAccess({ actor: agent, action: 'read', resource: 'registry', scope: 'global' }).allowed);
check('Missing scope fails closed', !canAccess({ actor: owner, action: 'read', resource: 'anything', scope: undefined }).allowed);
check('User scope without userId fails closed', !canAccess({ actor: userA, action: 'read', resource: 'memories', scope: 'user', userId: null }).allowed);
check('stampScope throws on missing ids (fail closed)', (() => { try { stampScope(agent, 'user'); return false; } catch { return true; } })());
check('scopeFilter(user) binds to the actor’s own userId only', JSON.stringify(scopeFilter(userA, 'user')) === JSON.stringify({ scope: 'user', userId: 'user_a' }));

console.log('— Scenario D: consent foundation —');
const grant = ConsentGrantSchema.parse({ grantId: 'g1', tenantId: 'tenant_1', userId: 'user_a', connectorType: 'calendar', accessMode: 'read_only', status: 'active', grantedAt: new Date().toISOString(), createdBy: 'user_a' });
check('Consent grant schema validates (read_only default)', grant.accessMode === 'read_only');
check('Connector account requires consentGrantId', !ConnectorAccountSchema.safeParse({ connectorAccountId: 'c1', tenantId: 'tenant_1', userId: 'user_a', connectorType: 'calendar', provider: 'x', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).success);
check('Active consent allows connector data access', canAccess({ actor: userA, action: 'read', resource: 'connector_data', scope: 'user', userId: 'user_a', requiresConsent: true, consentStatus: 'active' }).allowed);
check('Revoked consent BLOCKS connector data access', !canAccess({ actor: userA, action: 'read', resource: 'connector_data', scope: 'user', userId: 'user_a', requiresConsent: true, consentStatus: 'revoked' }).allowed);
check('Missing consent blocks too', !canAccess({ actor: userA, action: 'read', resource: 'connector_data', scope: 'user', userId: 'user_a', requiresConsent: true }).allowed);

console.log('— Scenario E/F: operator scope awareness —');
const e1 = classifyGoalScope('Plan my week.');
check('“Plan my week” → user scope, personal mode', e1.scope === 'user' && e1.mode === 'personal');
const planE = planForGoal('Plan my week.', { safeMode: false, role: 'owner' });
check('Personal plan uses ONLY user-scoped tools (get_my_context, generate_daily_briefing)', planE.kind === 'runtime_goal' && planE.steps.every((s) => ['get_my_context', 'generate_daily_briefing'].includes(s.toolId)));
check('Personal plan narration promises honest not_configured sources', /honest|not.*invented|not_configured/i.test(planE.narration));
const f1 = classifyGoalScope('Create a new status-inspector service that checks all registered services.');
check('“Create a service” → global kernel evolution (no private data)', f1.scope === 'global' && f1.mode === 'global_kernel');
check('“Improve gateway routing” → global kernel', classifyGoalScope('Improve gateway routing').scope === 'global');
check('Tenant goal → tenant scope', classifyGoalScope('Analyze our team opportunities for the department').scope === 'tenant');

console.log('— Scenario G: public-service safety —');
const kase = PublicServiceCaseSchema.parse({ caseId: 'case_1', tenantId: 'gov_1', title: 'Permit', citizenUserId: 'cit_1', assignedTo: ['cw_1'], createdBy: 'cw_1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
check('Citizen 1 reads their own case', canAccess({ actor: citizen1, action: 'read', resource: 'case', scope: 'case', tenantId: 'gov_1', caseId: 'case_1', caseCitizenUserId: kase.citizenUserId, caseAssignees: kase.assignedTo }).allowed);
check('Citizen 2 CANNOT read citizen 1 case', !canAccess({ actor: citizen2, action: 'read', resource: 'case', scope: 'case', tenantId: 'gov_1', caseId: 'case_1', caseCitizenUserId: kase.citizenUserId, caseAssignees: kase.assignedTo }).allowed);
check('Assigned case worker reads case (audited)', (() => { const v = canAccess({ actor: caseWorker, action: 'read', resource: 'case', scope: 'case', tenantId: 'gov_1', caseId: 'case_1', caseCitizenUserId: kase.citizenUserId, caseAssignees: kase.assignedTo }); return v.allowed && v.auditRequired; })());
check('Case worker from another tenant denied', !canAccess({ actor: { ...caseWorker, activeTenantId: 'gov_2' }, action: 'read', resource: 'case', scope: 'case', tenantId: 'gov_1', caseId: 'case_1', caseCitizenUserId: 'cit_1', caseAssignees: ['cw_1'] }).allowed);
check('Missing case scope fails closed', !canAccess({ actor: caseWorker, action: 'read', resource: 'case', scope: 'case', tenantId: 'gov_1', caseId: null }).allowed);
check('Owner case access requires explicit audited approval', canAccess({ actor: owner, action: 'read', resource: 'case', scope: 'case', tenantId: 'gov_1', caseId: 'case_1', caseCitizenUserId: 'cit_1' }).decision === 'approval_required');

console.log('— Scoped models validate —');
const stamp = stampScope(userA, 'user');
check('ScopedMemory + UserGoal parse with a real stamp', ScopedMemorySchema.safeParse({ ...stamp, memoryId: 'm1', kind: 'fact', content: 'x', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).success && UserGoalSchema.safeParse({ ...stamp, goalId: 'g1', title: 'Ship Phase AA', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).success);
check('User-scope stamp is private by default', stamp.visibility === 'private' && stamp.scope === 'user' && stamp.userId === 'user_a');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
