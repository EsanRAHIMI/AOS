import { z } from 'zod';
import { IsoDate } from './common.js';

/* ===========================================================================
 * Phase 8 — Learning Governance & Adaptive Intelligence schemas.
 * The kernel learns how to decide better from outcomes — but never silently:
 * every adaptive change is proposed, approved (RBAC), versioned, and audited.
 * ======================================================================== */

/** The 10 scoring weights the Plan Scoring Engine uses. */
export const ScoringWeightsSchema = z.object({
  successProbability: z.number(),
  risk: z.number(),
  cost: z.number(),
  speed: z.number(),
  evidenceAvailability: z.number(),
  reversibility: z.number(),
  humanIntervention: z.number(),
  capabilityFit: z.number(),
  policyCompliance: z.number(),
  longTermValue: z.number(),
});
export type ScoringWeights = z.infer<typeof ScoringWeightsSchema>;

export const ProfileStatus = z.enum(['active', 'archived', 'proposed']);

/** A versioned, auditable set of scoring weights. Only one is active. */
export const ScoringProfileSchema = z.object({
  profileId: z.string(),
  version: z.number(),
  weights: ScoringWeightsSchema,
  status: ProfileStatus.default('active'),
  reason: z.string().default('seed'),
  approvedBy: z.string().nullable().default(null),
  createdAt: IsoDate,
  activatedAt: IsoDate.nullable().default(null),
});
export type ScoringProfile = z.infer<typeof ScoringProfileSchema>;

export const WeightChangeSchema = z.object({
  dimension: z.string(),
  change: z.number(), // delta applied to the weight
  reason: z.string(),
});
export type WeightChange = z.infer<typeof WeightChangeSchema>;

/** Compares a plan's predicted score to the actual measured outcome. */
export const OutcomeReviewSchema = z.object({
  reviewId: z.string(),
  taskId: z.string(),
  decisionId: z.string().nullable().default(null),
  selectedPlanId: z.string(),
  selectedPlanScore: z.number(),
  actualOutcome: z.string(),
  actualEvaluationScore: z.number(),
  predictedVsActual: z.enum(['overestimated', 'underestimated', 'accurate']),
  whatWorked: z.array(z.string()).default([]),
  whatFailed: z.array(z.string()).default([]),
  lessons: z.array(z.string()).default([]),
  recommendedWeightChanges: z.array(WeightChangeSchema).default([]),
  recommendedPolicyChanges: z.array(z.string()).default([]),
  recommendedSkillUpdates: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type OutcomeReview = z.infer<typeof OutcomeReviewSchema>;

export const ProposalStatus = z.enum(['waiting_approval', 'approved', 'rejected', 'changes_requested']);

/** A proposed change to scoring weights — never applied without approval. */
export const ScoringChangeProposalSchema = z.object({
  proposalId: z.string(),
  basedOnReviews: z.array(z.string()).default([]),
  currentWeights: ScoringWeightsSchema,
  proposedWeights: ScoringWeightsSchema,
  changes: z.array(WeightChangeSchema).default([]),
  reason: z.string(),
  expectedImpact: z.string().default(''),
  riskLevel: z.enum(['low', 'medium', 'high']).default('low'),
  status: ProposalStatus.default('waiting_approval'),
  approvedBy: z.string().nullable().default(null),
  resultingProfileVersion: z.number().nullable().default(null),
  createdAt: IsoDate,
  decidedAt: IsoDate.nullable().default(null),
});
export type ScoringChangeProposal = z.infer<typeof ScoringChangeProposalSchema>;

/* -------------------- Configurable policy -------------------- */

export const PolicyScopeSchema = z.object({
  serviceName: z.string().optional(),
  capabilityId: z.string().optional(),
  environment: z.string().optional(),
});

export const PolicyRuleSchema = z.object({
  ruleId: z.string(),
  action: z.string(),
  decision: z.enum(['allowed', 'blocked', 'approval_required']),
  reason: z.string(),
  requiredApprovalType: z.string().nullable().default(null),
  riskLevel: z.enum(['low', 'medium', 'high']).default('medium'),
  scope: PolicyScopeSchema.default({}),
  status: z.enum(['active', 'disabled']).default('active'),
  createdAt: IsoDate,
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const PolicyChangeProposalSchema = z.object({
  proposalId: z.string(),
  rule: PolicyRuleSchema,
  reason: z.string(),
  status: ProposalStatus.default('waiting_approval'),
  approvedBy: z.string().nullable().default(null),
  createdAt: IsoDate,
  decidedAt: IsoDate.nullable().default(null),
});
export type PolicyChangeProposal = z.infer<typeof PolicyChangeProposalSchema>;

export const PolicyProfileSchema = z.object({
  profileId: z.string(),
  version: z.number(),
  ruleIds: z.array(z.string()).default([]),
  status: ProfileStatus.default('active'),
  createdAt: IsoDate,
  activatedAt: IsoDate.nullable().default(null),
});
export type PolicyProfile = z.infer<typeof PolicyProfileSchema>;

/* -------------------- RBAC + audit -------------------- */

export const RoleName = z.enum(['owner', 'operator', 'viewer', 'agent']);
export type RoleName = z.infer<typeof RoleName>;

export const RoleSchema = z.object({
  roleId: RoleName,
  description: z.string(),
  permissions: z.array(z.string()),
  createdAt: IsoDate,
});
export type Role = z.infer<typeof RoleSchema>;

export const PermissionSchema = z.object({
  permissionId: z.string(),
  description: z.string(),
});
export type Permission = z.infer<typeof PermissionSchema>;

export const RbacUserSchema = z.object({
  userId: z.string(),
  name: z.string(),
  role: RoleName,
  createdAt: IsoDate,
});
export type RbacUser = z.infer<typeof RbacUserSchema>;

/** Every sensitive governance action writes one of these. */
export const AuditLogSchema = z.object({
  auditId: z.string(),
  actorType: z.enum(['human', 'agent', 'system']),
  actorId: z.string(),
  role: RoleName.nullable().default(null),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  reason: z.string().default(''),
  createdAt: IsoDate,
});
export type AuditLog = z.infer<typeof AuditLogSchema>;
