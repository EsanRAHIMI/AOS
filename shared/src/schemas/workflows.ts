import { z } from 'zod';
import { IsoDate } from './common.js';

/* ===========================================================================
 * Phase 10 — Continuous Learning & Autonomous Improvement schemas.
 * Approved recommendations convert into structured, evidence-backed improvement
 * workflows that run through the existing engines; impact is measured after.
 * Nothing executes without approval; nothing claims impact without evidence.
 * ======================================================================== */

export const TriggerType = z.enum([
  'time_based',
  'new_incident_threshold',
  'new_task_threshold',
  'new_evidence_threshold',
  'low_reliability_detected',
  'prompt_fallback_threshold',
  'manual',
]);
export type TriggerType = z.infer<typeof TriggerType>;

/** A schedule/trigger for automatic learning runs. */
export const LearningScheduleSchema = z.object({
  scheduleId: z.string(),
  name: z.string(),
  cadence: z.string().default('daily'),
  triggerType: TriggerType.default('time_based'),
  enabled: z.boolean().default(true),
  minNewRecords: z.number().default(20),
  scope: z.string().default('all'),
  lastRunAt: IsoDate.nullable().default(null),
  nextRunAt: IsoDate.nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type LearningSchedule = z.infer<typeof LearningScheduleSchema>;

/** A fired trigger that asked for a learning run. */
export const LearningTriggerSchema = z.object({
  triggerId: z.string(),
  scheduleId: z.string().nullable().default(null),
  type: TriggerType,
  reason: z.string(),
  newRecords: z.number().default(0),
  dispatchedTaskId: z.string().nullable().default(null),
  createdAt: IsoDate,
});
export type LearningTrigger = z.infer<typeof LearningTriggerSchema>;

export const WorkflowType = z.enum([
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
export type WorkflowType = z.infer<typeof WorkflowType>;

export const WorkflowStatus = z.enum(['proposed', 'waiting_approval', 'approved', 'running', 'validating', 'completed', 'failed', 'cancelled']);
export type WorkflowStatus = z.infer<typeof WorkflowStatus>;

export const WorkflowStepSchema = z.object({
  name: z.string(),
  engine: z.string(),
  status: z.enum(['pending', 'running', 'done', 'skipped', 'failed']).default('pending'),
  detail: z.string().default(''),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

/** A structured improvement workflow converted from an approved recommendation. */
export const ImprovementWorkflowSchema = z.object({
  workflowId: z.string(),
  sourceRecommendationId: z.string(),
  taskId: z.string().nullable().default(null),
  type: WorkflowType,
  title: z.string(),
  status: WorkflowStatus.default('proposed'),
  steps: z.array(WorkflowStepSchema),
  currentStep: z.number().default(0),
  requiredApprovals: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  result: z.string().default(''),
  beforeMetrics: z.record(z.string(), z.number()).default({}),
  afterMetrics: z.record(z.string(), z.number()).default({}),
  impactAssessmentId: z.string().nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type ImprovementWorkflow = z.infer<typeof ImprovementWorkflowSchema>;

/** Measured before/after impact of a completed workflow. */
export const ImpactAssessmentSchema = z.object({
  impactAssessmentId: z.string(),
  workflowId: z.string(),
  sourceRecommendationId: z.string().nullable().default(null),
  targetType: z.string(),
  targetId: z.string(),
  beforeMetrics: z.record(z.string(), z.number()).default({}),
  afterMetrics: z.record(z.string(), z.number()).default({}),
  impact: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
  evidenceIds: z.array(z.string()).default([]),
  recommendation: z.string().default(''),
  createdAt: IsoDate,
});
export type ImpactAssessment = z.infer<typeof ImpactAssessmentSchema>;

/** A continuous-memory maintenance pass. */
export const MemoryMaintenanceRunSchema = z.object({
  maintenanceRunId: z.string(),
  summariesReviewed: z.number(),
  summariesUpdated: z.number(),
  summariesDeprecated: z.number(),
  compressedContextsUpdated: z.number(),
  tokenBudgetSaved: z.number(),
  notes: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type MemoryMaintenanceRun = z.infer<typeof MemoryMaintenanceRunSchema>;
