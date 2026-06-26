import { z } from 'zod';
import { IsoDate } from './common.js';

/* ===========================================================================
 * Phase 7 — Strategic Reasoning & Policy-Governed Execution schemas.
 * The kernel considers multiple plans, scores them, checks policy, chooses with
 * justification, and remembers the decision. LLM output is schema-validated;
 * nothing unvalidated mutates state.
 * ======================================================================== */

export const PlanLabel = z.enum(['safe_plan', 'fast_plan', 'ambitious_plan']);
export type PlanLabel = z.infer<typeof PlanLabel>;
/** Local risk enum (RiskLevel is also exported from capability.ts). */
const RiskLevel = z.enum(['low', 'medium', 'high']);

/** What the LLM (or fallback) returns for one candidate plan. */
export const CandidatePlanSchema = z.object({
  label: PlanLabel,
  title: z.string(),
  steps: z.array(z.string()).min(1),
  requiredCapabilities: z.array(z.string()).default([]),
  servicesInvolved: z.array(z.string()).default([]),
  toolsInvolved: z.array(z.string()).default([]),
  requiredApprovals: z.array(z.string()).default([]),
  expectedCostUsd: z.number().default(0),
  expectedTimeMinutes: z.number().default(10),
  riskLevel: RiskLevel.default('medium'),
  reversibility: z.number().min(0).max(1).default(0.8),
  confidence: z.number().min(0).max(1).default(0.6),
  expectedImpact: z.string().default(''),
  failureModes: z.array(z.string()).default([]),
  validationPlan: z.string().default('Re-run runtime validation and the live activation check.'),
});
export type CandidatePlan = z.infer<typeof CandidatePlanSchema>;

/** The structured-output contract for the strategic planner (≥3 plans). */
export const CandidatePlansSchema = z.object({
  plans: z.array(CandidatePlanSchema).min(3),
  rationale: z.string().default('deterministic strategy templates'),
});
export type CandidatePlans = z.infer<typeof CandidatePlansSchema>;

/** A persisted candidate plan (candidate + ids). */
export const StrategicPlanSchema = CandidatePlanSchema.extend({
  planId: z.string(),
  taskId: z.string(),
  goal: z.string(),
  selected: z.boolean().default(false),
  createdAt: IsoDate,
});
export type StrategicPlan = z.infer<typeof StrategicPlanSchema>;

/** Multi-dimensional score for one plan. */
export const PlanScoreSchema = z.object({
  scoreId: z.string(),
  planId: z.string(),
  taskId: z.string(),
  label: PlanLabel,
  dimensions: z.object({
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
  }),
  total: z.number(),
  selected: z.boolean().default(false),
  selectionReason: z.string().nullable().default(null),
  createdAt: IsoDate,
});
export type PlanScore = z.infer<typeof PlanScoreSchema>;

export const PolicyAction = z.enum([
  'code_change',
  'github_action',
  'deployment_action',
  'environment_change',
  'external_api_call',
  'send_message',
  'browser_action',
  'file_delete',
  'data_mutation',
  'production_change',
  'physical_action',
  'run_validation',
  'read_only',
]);
export type PolicyAction = z.infer<typeof PolicyAction>;

export const PolicyOutcome = z.enum(['allowed', 'blocked', 'approval_required']);
export type PolicyOutcome = z.infer<typeof PolicyOutcome>;

/** The result of checking an action against policy. No sensitive action runs without one. */
export const PolicyDecisionSchema = z.object({
  policyDecisionId: z.string(),
  taskId: z.string().nullable().default(null),
  planId: z.string().nullable().default(null),
  action: PolicyAction,
  decision: PolicyOutcome,
  reason: z.string(),
  requiredApprovalType: z.string().nullable().default(null),
  riskLevel: RiskLevel.default('medium'),
  createdAt: IsoDate,
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

/** Structured memory of a decision: options, choice, justification, outcome, lessons. */
export const DecisionMemorySchema = z.object({
  decisionId: z.string(),
  taskId: z.string(),
  goal: z.string(),
  selectedPlanId: z.string(),
  selectedReason: z.string(),
  alternatives: z.array(z.object({ planId: z.string(), label: z.string(), reason: z.string() })).default([]),
  outcome: z.string().default('pending'),
  evidenceIds: z.array(z.string()).default([]),
  evaluationId: z.string().nullable().default(null),
  lessons: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type DecisionMemory = z.infer<typeof DecisionMemorySchema>;
