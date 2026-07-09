import { z } from 'zod';
import { IsoDate } from './common.js';

/* ===========================================================================
 * Phase 3 — Self-Expanding Capability Engine schemas.
 * The capability graph is a first-class model of what the kernel can do, what
 * supports each ability, where it's weak, and how it grows.
 * ======================================================================== */

/** Capability lifecycle (Phase 4): proposed → approved → generated → validated → active. */
export const CapabilityStatus = z.enum([
  'proposed',
  'approved',
  'generated',
  'validated',
  'active',
  'deprecated',
  'failed',
]);
export type CapabilityStatus = z.infer<typeof CapabilityStatus>;

export const MaturityLevel = z.enum(['concept', 'early', 'stable', 'mature']);
export type MaturityLevel = z.infer<typeof MaturityLevel>;

export const RiskLevel = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevel>;

/** A node in the capability graph. */
export const CapabilitySchema = z.object({
  capabilityId: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(), // e.g. self_expansion, orchestration, testing, integration
  supportedByServices: z.array(z.string()).default([]),
  supportedByAgents: z.array(z.string()).default([]),
  supportedByTools: z.array(z.string()).default([]),
  requiredEnv: z.array(z.string()).default([]),
  requiredPermissions: z.array(z.string()).default([]),
  relatedDocs: z.array(z.string()).default([]),
  relatedMemories: z.array(z.string()).default([]),
  status: CapabilityStatus.default('active'),
  maturityLevel: MaturityLevel.default('early'),
  riskLevel: RiskLevel.default('low'),
  evaluationScore: z.number().min(0).max(1).default(0),
  lastUsedAt: IsoDate.nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Capability = z.infer<typeof CapabilitySchema>;

/** A required capability the kernel does not yet have (or has only weakly). */
export const CapabilityGapSchema = z.object({
  gapId: z.string(),
  taskId: z.string(),
  requiredCapability: z.string(),
  reason: z.string(),
  recommendedExpansion: z.string(),
  severity: z.enum(['missing', 'weak']).default('missing'),
  riskLevel: RiskLevel.default('medium'),
  status: z.enum(['open', 'proposed', 'resolved', 'dismissed']).default('open'),
  createdAt: IsoDate,
});
export type CapabilityGap = z.infer<typeof CapabilityGapSchema>;

export const ExpansionStatus = z.enum([
  'draft',
  'waiting_approval',
  'approved',
  'rejected',
  'changes_requested',
  'building',
  'generated',
  'failed',
]);
export type ExpansionStatus = z.infer<typeof ExpansionStatus>;

/** A concrete plan to add a missing capability (new service/agent/tool). */
export const ExpansionProposalSchema = z.object({
  proposalId: z.string(),
  sourceTaskId: z.string(),
  gapId: z.string().nullable().default(null),
  missingCapability: z.string(),
  proposedServiceName: z.string(),
  proposedAgentName: z.string().nullable().default(null),
  proposedToolName: z.string().nullable().default(null),
  reason: z.string(),
  architecturePlan: z.string(),
  requiredEnv: z.array(z.string()).default([]),
  requiredPermissions: z.array(z.string()).default([]),
  riskLevel: RiskLevel.default('medium'),
  expectedImpact: z.string(),
  evaluationPlan: z.string(),
  status: ExpansionStatus.default('waiting_approval'),
  generatedServicePath: z.string().nullable().default(null),
  infrastructureRequestId: z.string().nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type ExpansionProposal = z.infer<typeof ExpansionProposalSchema>;

/** Multi-dimensional evaluation of a capability, service, agent, or task. */
export const EvaluationSchema = z.object({
  evaluationId: z.string(),
  targetType: z.enum(['capability', 'service', 'agent', 'task', 'expansion']),
  targetId: z.string(),
  taskId: z.string().nullable().default(null),
  score: z.number().min(0).max(1),
  dimensions: z
    .object({
      correctness: z.number().min(0).max(1),
      reliability: z.number().min(0).max(1),
      speed: z.number().min(0).max(1),
      cost: z.number().min(0).max(1),
      humanInterventionRequired: z.number().min(0).max(1),
      reusability: z.number().min(0).max(1),
      documentationQuality: z.number().min(0).max(1),
      memoryQuality: z.number().min(0).max(1),
      risk: z.number().min(0).max(1),
      productionReadiness: z.number().min(0).max(1),
    })
    .partial()
    .default({}),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

/** Structured output contract for goal → required-capability analysis (LLM or fallback). */
export const CapabilityAnalysisSchema = z.object({
  requiredCapabilities: z.array(z.string()).min(1),
  rationale: z.string().default('keyword analysis'),
});
export type CapabilityAnalysis = z.infer<typeof CapabilityAnalysisSchema>;

/** A persisted LLM interaction: prompt, completion, validation, cost. */
export const LlmTraceSchema = z.object({
  traceId: z.string(),
  agentId: z.string(),
  taskId: z.string().nullable().default(null),
  taskType: z.string(),
  promptVersion: z.string().default('v0'),
  provider: z.enum(['anthropic', 'openai', 'mock']),
  model: z.string(),
  system: z.string().default(''),
  prompt: z.string(),
  completion: z.string().default(''),
  valid: z.boolean(),
  usedFallback: z.boolean().default(false),
  /** Phase AG.3 — when usedFallback is true, the actual reason a real
   *  provider call didn't produce validated data (HTTP/network error, or a
   *  schema-validation mismatch on an otherwise-successful response). Never
   *  silently discarded — this is what previously made fallback reasons
   *  untraceable end-to-end. Null when usedFallback is false, or when no
   *  provider was configured at all (mock — there was nothing to fail). */
  errorDetail: z.string().nullable().default(null),
  attempts: z.number().default(1),
  tokensIn: z.number().default(0),
  tokensOut: z.number().default(0),
  costUsd: z.number().default(0),
  createdAt: IsoDate,
});
export type LlmTrace = z.infer<typeof LlmTraceSchema>;
