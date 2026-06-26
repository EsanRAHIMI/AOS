import { z } from 'zod';
import { IsoDate } from './common.js';

/* ===========================================================================
 * Phase 9 — Operational Learning & Memory Intelligence schemas.
 * The kernel learns from its whole history: reliability over time, recurring
 * patterns, compressed memory, and evidence-backed recommendations. Learning
 * recommends; approval applies (nothing adaptive changes silently).
 * ======================================================================== */

export const Trend = z.enum(['improving', 'declining', 'stable', 'unknown']);
export type Trend = z.infer<typeof Trend>;

/** Persistent reliability for a target (service/agent/capability/plan/repair type). */
export const ReliabilityScoreSchema = z.object({
  reliabilityId: z.string(),
  targetType: z.enum(['service', 'agent', 'capability', 'plan_type', 'repair_type', 'policy_rule']),
  targetId: z.string(),
  score: z.number().min(0).max(1),
  sampleSize: z.number(),
  successRate: z.number().min(0).max(1),
  failureRate: z.number().min(0).max(1),
  avgEvaluationScore: z.number().default(0),
  avgValidationScore: z.number().default(0),
  incidentRate: z.number().default(0),
  repairSuccessRate: z.number().default(0),
  trend: Trend.default('unknown'),
  confidence: z.number().min(0).max(1),
  lastUpdatedAt: IsoDate,
});
export type ReliabilityScore = z.infer<typeof ReliabilityScoreSchema>;

export const ReliabilitySnapshotSchema = z.object({
  snapshotId: z.string(),
  learningRunId: z.string(),
  scores: z.array(ReliabilityScoreSchema),
  createdAt: IsoDate,
});
export type ReliabilitySnapshot = z.infer<typeof ReliabilitySnapshotSchema>;

/** A recurring success or failure/weak-point pattern mined from history. */
export const OperationalPatternSchema = z.object({
  patternId: z.string(),
  patternType: z.enum(['success', 'failure', 'weak_point']),
  title: z.string(),
  description: z.string(),
  confidence: z.number().min(0).max(1),
  supportCount: z.number(),
  relatedRecords: z.array(z.string()).default([]),
  recommendedAction: z.string().default(''),
  status: z.enum(['observed', 'acted_on', 'dismissed']).default('observed'),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type OperationalPattern = z.infer<typeof OperationalPatternSchema>;

/** A compressed memory summary so future agents read context cheaply. */
export const MemorySummarySchema = z.object({
  summaryId: z.string(),
  scope: z.enum(['system', 'service', 'capability', 'decision', 'repair', 'failure', 'skill', 'daily', 'weekly']),
  scopeId: z.string().nullable().default(null),
  timeWindow: z.string().default('all'),
  sourceMemoryIds: z.array(z.string()).default([]),
  sourceEvidenceIds: z.array(z.string()).default([]),
  tokenBudget: z.number().default(400),
  compressedText: z.string(),
  keyFacts: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  nextActions: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type MemorySummary = z.infer<typeof MemorySummarySchema>;

export const CompressedContextSchema = z.object({
  contextId: z.string(),
  learningRunId: z.string(),
  tokenBudget: z.number().default(800),
  compressedText: z.string(),
  keyFacts: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type CompressedContext = z.infer<typeof CompressedContextSchema>;

export const RecommendationType = z.enum([
  'create_skill',
  'update_skill',
  'create_capability',
  'improve_service',
  'improve_policy',
  'improve_scoring',
  'improve_prompt',
  'deprecate_capability',
  'add_monitor',
  'add_validation',
  'add_test',
]);
export type RecommendationType = z.infer<typeof RecommendationType>;

export const RecommendationStatus = z.enum(['waiting_approval', 'approved', 'rejected', 'changes_requested', 'converted']);

/** An evidence-backed improvement the system recommends from learning. */
export const SystemRecommendationSchema = z.object({
  recommendationId: z.string(),
  learningRunId: z.string().nullable().default(null),
  type: RecommendationType,
  title: z.string(),
  reason: z.string(),
  evidence: z.array(z.string()).default([]),
  relatedPatternIds: z.array(z.string()).default([]),
  expectedImpact: z.string().default(''),
  riskLevel: z.enum(['low', 'medium', 'high']).default('low'),
  requiredApproval: z.boolean().default(true),
  status: RecommendationStatus.default('waiting_approval'),
  convertedTo: z.string().nullable().default(null),
  convertedId: z.string().nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type SystemRecommendation = z.infer<typeof SystemRecommendationSchema>;

/** Aggregated performance of a prompt version, from traces + outcomes. */
export const PromptPerformanceSchema = z.object({
  promptPerfId: z.string(),
  promptKey: z.string(),
  promptVersion: z.string(),
  taskType: z.string(),
  sampleSize: z.number(),
  validRate: z.number().min(0).max(1),
  fallbackRate: z.number().min(0).max(1),
  invalidRate: z.number().min(0).max(1),
  avgCostUsd: z.number().default(0),
  avgTokens: z.number().default(0),
  recommendImprovement: z.boolean().default(false),
  reason: z.string().default(''),
  lastUpdatedAt: IsoDate,
});
export type PromptPerformance = z.infer<typeof PromptPerformanceSchema>;

/** A single historical-learning aggregation pass. */
export const LearningRunSchema = z.object({
  learningRunId: z.string(),
  taskId: z.string().nullable().default(null),
  timeWindow: z.string().default('all'),
  recordsAnalyzed: z.number(),
  summary: z.string(),
  topSuccessPatterns: z.array(z.string()).default([]),
  topFailurePatterns: z.array(z.string()).default([]),
  weakCapabilities: z.array(z.string()).default([]),
  weakServices: z.array(z.string()).default([]),
  weakAgents: z.array(z.string()).default([]),
  recommendedSkills: z.array(z.string()).default([]),
  recommendedExpansions: z.array(z.string()).default([]),
  recommendedScoringChanges: z.array(z.string()).default([]),
  recommendedPolicyChanges: z.array(z.string()).default([]),
  reliabilitySnapshotId: z.string().nullable().default(null),
  patternIds: z.array(z.string()).default([]),
  recommendationIds: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type LearningRun = z.infer<typeof LearningRunSchema>;
