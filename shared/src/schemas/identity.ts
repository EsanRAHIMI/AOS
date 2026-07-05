import { z } from 'zod';
import { IsoDate } from './common.js';
import { Scope, Visibility, RequiredScopeSchema, ActorType } from './scope.js';

/* ===========================================================================
 * Phase AA — Identity, tenancy, consent and personal-operating-layer schemas.
 * Esan is the first owner and platform governor; the platform is built to
 * serve future users, tenants, organizations, government roles and citizens
 * WITHOUT fragmenting the global software kernel.
 * ======================================================================== */

export const TenantSchema = z.object({
  tenantId: z.string(),
  name: z.string(),
  kind: z.enum(['personal', 'team', 'company', 'government_unit', 'department', 'institution']).default('personal'),
  status: z.enum(['active', 'suspended', 'archived']).default('active'),
  settings: z.record(z.string(), z.unknown()).default({}),
  createdBy: z.string(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Tenant = z.infer<typeof TenantSchema>;

export const UserProfileSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  email: z.string().default(''),
  actorType: ActorType.default('human_user'),
  defaultTenantId: z.string(),
  locale: z.string().default('en'),
  timezone: z.string().default('UTC'),
  preferences: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(['active', 'suspended', 'archived']).default('active'),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const TenantMembershipSchema = z.object({
  membershipId: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  roles: z.array(z.string()),
  status: z.enum(['active', 'invited', 'revoked']).default('active'),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type TenantMembership = z.infer<typeof TenantMembershipSchema>;

export const UserRoleSchema = z.object({
  userRoleId: z.string(),
  userId: z.string(),
  role: z.string(),
  scope: Scope,
  tenantId: z.string().nullable().default(null),
  grantedBy: z.string(),
  createdAt: IsoDate,
});
export type UserRole = z.infer<typeof UserRoleSchema>;

export const ScopePolicySchema = z.object({
  policyId: z.string(),
  name: z.string(),
  description: z.string().default(''),
  scope: Scope,
  action: z.string(),
  allowedRoles: z.array(z.string()),
  requiresApproval: z.boolean().default(false),
  ownerOnly: z.boolean().default(false),
  createdAt: IsoDate,
});
export type ScopePolicy = z.infer<typeof ScopePolicySchema>;

/* ------------------------------ consent -------------------------------- */

export const ConsentGrantSchema = z.object({
  grantId: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  connectorType: z.string(),
  scopesAllowed: z.array(z.string()).default([]),
  accessMode: z.enum(['read_only', 'draft_only', 'write_with_approval']).default('read_only'),
  status: z.enum(['active', 'revoked', 'expired']).default('active'),
  grantedAt: IsoDate,
  expiresAt: z.string().nullable().default(null),
  revokedAt: z.string().nullable().default(null),
  createdBy: z.string(),
  auditContext: z.record(z.string(), z.unknown()).default({}),
});
export type ConsentGrant = z.infer<typeof ConsentGrantSchema>;

export const ConnectorAccountSchema = z.object({
  connectorAccountId: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  connectorType: z.string(),
  provider: z.string(),
  status: z.enum(['pending', 'connected', 'blocked', 'disconnected', 'error']).default('pending'),
  scopes: z.array(z.string()).default([]),
  consentGrantId: z.string(),
  lastSyncAt: z.string().nullable().default(null),
  error: z.string().default(''),
  /** Provider account METADATA only — never secrets/tokens in Mongo. */
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type ConnectorAccount = z.infer<typeof ConnectorAccountSchema>;

export const ConnectorSyncRunSchema = z.object({
  syncRunId: z.string(),
  connectorAccountId: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  status: z.enum(['succeeded', 'failed', 'blocked_no_consent', 'not_configured']),
  itemsRead: z.number().default(0),
  detail: z.string().default(''),
  startedAt: IsoDate,
  finishedAt: z.string().nullable().default(null),
});
export type ConnectorSyncRun = z.infer<typeof ConnectorSyncRunSchema>;

/* ------------------------- personal operating layer --------------------- */

export const ScopedMemorySchema = RequiredScopeSchema.extend({
  memoryId: z.string(),
  kind: z.enum(['preference', 'fact', 'decision', 'workflow', 'mistake_avoidance', 'inference']),
  content: z.string(),
  source: z.string().default('user'),
  confidence: z.number().default(1),
  consentGrantId: z.string().nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type ScopedMemory = z.infer<typeof ScopedMemorySchema>;

export const UserGoalSchema = RequiredScopeSchema.extend({
  goalId: z.string(),
  title: z.string(),
  description: z.string().default(''),
  horizon: z.enum(['day', 'week', 'month', 'quarter', 'year', 'life']).default('week'),
  status: z.enum(['active', 'paused', 'done', 'dropped']).default('active'),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type UserGoal = z.infer<typeof UserGoalSchema>;

export const UserConstraintSchema = RequiredScopeSchema.extend({
  constraintId: z.string(),
  content: z.string(),
  kind: z.enum(['time', 'budget', 'health', 'policy', 'other']).default('other'),
  createdAt: IsoDate,
});
export type UserConstraint = z.infer<typeof UserConstraintSchema>;

export const DailyBriefingSchema = RequiredScopeSchema.extend({
  briefingId: z.string(),
  date: z.string(),
  summary: z.string(),
  sourcesUsed: z.array(z.string()).default([]),
  missingSources: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type DailyBriefing = z.infer<typeof DailyBriefingSchema>;

export const WeeklyStrategyReviewSchema = RequiredScopeSchema.extend({
  reviewId: z.string(),
  weekOf: z.string(),
  summary: z.string(),
  sourcesUsed: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type WeeklyStrategyReview = z.infer<typeof WeeklyStrategyReviewSchema>;

export const OpportunityReportSchema = RequiredScopeSchema.extend({
  opportunityReportId: z.string(),
  title: z.string(),
  summary: z.string(),
  sourcesUsed: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type OpportunityReport = z.infer<typeof OpportunityReportSchema>;

/* --------------------------- public service ----------------------------- */

export const PublicServiceCaseSchema = z.object({
  caseId: z.string(),
  tenantId: z.string(),
  title: z.string(),
  citizenUserId: z.string(),
  assignedTo: z.array(z.string()).default([]),
  status: z.enum(['open', 'in_review', 'waiting_citizen', 'resolved', 'closed']).default('open'),
  scope: Scope.default('case'),
  visibility: Visibility.default('restricted'),
  createdBy: z.string(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type PublicServiceCase = z.infer<typeof PublicServiceCaseSchema>;

/* --------------------------- access decisions --------------------------- */

export const AccessDecisionSchema = z.object({
  decisionId: z.string(),
  actorId: z.string(),
  actorType: ActorType,
  action: z.string(),
  resource: z.string(),
  scope: Scope,
  tenantId: z.string().nullable().default(null),
  targetUserId: z.string().nullable().default(null),
  caseId: z.string().nullable().default(null),
  decision: z.enum(['allowed', 'denied', 'approval_required']),
  reason: z.string(),
  createdAt: IsoDate,
});
export type AccessDecision = z.infer<typeof AccessDecisionSchema>;
