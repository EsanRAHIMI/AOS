import { z } from 'zod';
import { IsoDate } from './common.js';

/* ===========================================================================
 * Phase 15 — Safe Real Operations.
 * An operation plan is the single record that drives a guided, safety-gated
 * operation from goal → target → risk → approval → snapshot → execute → verify.
 * Dokploy targets and deployment snapshots are real config captures (never faked).
 * ======================================================================== */

export const OperationType = z.enum([
  'health_check_only',
  'new_app',
  'existing_app_update',
  'existing_app_repair',
  'existing_app_restart',
  'existing_app_env_update',
  'protected_core_update',
]);
export type OperationType = z.infer<typeof OperationType>;

export const OperationRiskLevel = z.enum(['low', 'medium', 'high', 'critical']);
export type OperationRiskLevel = z.infer<typeof OperationRiskLevel>;

export const OperationStatus = z.enum([
  'draft',
  'waiting_target_selection',
  'waiting_approval',
  'approved',
  'running',
  'verifying',
  'completed',
  'failed',
  'rolled_back',
  'cancelled',
]);
export type OperationStatus = z.infer<typeof OperationStatus>;

export const OperationStepSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(['pending', 'active', 'done', 'failed', 'skipped', 'waiting']),
  actor: z.string().default('system'),
  message: z.string().default(''),
  evidenceId: z.string().nullable().default(null),
  at: z.string().nullable().default(null),
});
export type OperationStep = z.infer<typeof OperationStepSchema>;

export const VerificationResultSchema = z.object({
  domainReachable: z.boolean().nullable().default(null),
  healthOk: z.boolean().nullable().default(null),
  registered: z.boolean().nullable().default(null),
  manifestAvailable: z.boolean().nullable().default(null),
  detail: z.string().default(''),
  checkedAt: z.string().nullable().default(null),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const OperationPlanSchema = z.object({
  operationPlanId: z.string(),
  taskId: z.string().nullable().default(null),
  goal: z.string(),
  operationType: OperationType,
  targetProject: z.string().default(''),
  targetEnvironment: z.string().default('production'),
  targetApp: z.string().default(''),
  targetService: z.string().default(''),
  targetDomain: z.string().default(''),
  targetPort: z.number().nullable().default(null),
  rootDir: z.string().default(''),
  envVarsRequired: z.array(z.string()).default([]),
  envVarsMissing: z.array(z.string()).default([]),
  riskLevel: OperationRiskLevel,
  protectedCore: z.boolean().default(false),
  requiredApprovals: z.array(z.string()).default([]),
  steps: z.array(OperationStepSchema).default([]),
  verificationPlan: z.array(z.string()).default([]),
  verification: VerificationResultSchema.nullable().default(null),
  rollbackPlan: z.array(z.string()).default([]),
  manualInstructions: z.array(z.string()).default([]),
  snapshotId: z.string().nullable().default(null),
  targetId: z.string().nullable().default(null),
  evidenceIds: z.array(z.string()).default([]),
  status: OperationStatus,
  nextAction: z.string().default(''),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type OperationPlan = z.infer<typeof OperationPlanSchema>;

export const DokployTargetSchema = z.object({
  targetId: z.string(),
  projectName: z.string(),
  environmentName: z.string().default('production'),
  appName: z.string(),
  serviceId: z.string().default(''),
  domain: z.string().default(''),
  port: z.number().nullable().default(null),
  rootDir: z.string().default(''),
  isCoreService: z.boolean().default(false),
  lastKnownStatus: z.string().default('unknown'),
  lastSyncedAt: z.string().nullable().default(null),
  source: z.enum(['dokploy_api', 'service_registry', 'manual_user_confirmed']),
  createdAt: IsoDate,
});
export type DokployTarget = z.infer<typeof DokployTargetSchema>;

export const DeploymentSnapshotSchema = z.object({
  snapshotId: z.string(),
  targetId: z.string().nullable().default(null),
  operationPlanId: z.string(),
  project: z.string().default(''),
  app: z.string().default(''),
  domain: z.string().default(''),
  port: z.number().nullable().default(null),
  envHash: z.string().default(''),
  rootDir: z.string().default(''),
  config: z.record(z.string(), z.unknown()).default({}),
  createdAt: IsoDate,
});
export type DeploymentSnapshot = z.infer<typeof DeploymentSnapshotSchema>;
