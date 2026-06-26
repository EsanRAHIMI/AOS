import { z } from 'zod';
import { IsoDate } from './common.js';
import { ValidationCheckSchema } from './reality.js';

/* ===========================================================================
 * Phase 5 — Live Activation & Runtime Autonomy schemas.
 * `validated` means the code is valid; `active` means the service is deployed,
 * reachable, registered, and usable. These records prove the difference.
 * ======================================================================== */

export const ActivationStatus = z.enum(['running', 'passed', 'failed']);
export type ActivationStatus = z.infer<typeof ActivationStatus>;

/** Result of probing whether a validated service is actually live. */
export const ServiceActivationSchema = z.object({
  activationId: z.string(),
  taskId: z.string().nullable().default(null),
  serviceName: z.string(),
  capabilityId: z.string(),
  domain: z.string(),
  checks: z.array(ValidationCheckSchema),
  passed: z.boolean(),
  status: ActivationStatus.default('running'),
  evidenceIds: z.array(z.string()).default([]),
  promotedToActive: z.boolean().default(false),
  incidentId: z.string().nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type ServiceActivation = z.infer<typeof ServiceActivationSchema>;

export const ChecklistStatus = z.enum(['awaiting_deployment', 'deployed', 'activated', 'failed']);
export type ChecklistStatus = z.infer<typeof ChecklistStatus>;

/** A precise, copyable Dokploy activation checklist for a validated service. */
export const DeploymentChecklistSchema = z.object({
  checklistId: z.string(),
  taskId: z.string().nullable().default(null),
  serviceName: z.string(),
  capabilityId: z.string().nullable().default(null),
  appName: z.string(),
  repository: z.string(),
  rootDirectory: z.string(),
  buildCommand: z.string(),
  startCommand: z.string(),
  port: z.number(),
  subdomain: z.string(),
  healthCheckPath: z.string().default('/health'),
  env: z.array(z.object({ key: z.string(), value: z.string(), secret: z.boolean().default(false) })),
  notes: z.array(z.string()).default([]),
  verificationSteps: z.array(z.string()).default([]),
  status: ChecklistStatus.default('awaiting_deployment'),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type DeploymentChecklist = z.infer<typeof DeploymentChecklistSchema>;

/** One health/latency probe of a single service. */
export const ServiceHealthSchema = z.object({
  serviceName: z.string(),
  domain: z.string(),
  healthy: z.boolean(),
  httpStatus: z.number().nullable().default(null),
  latencyMs: z.number().nullable().default(null),
  error: z.string().nullable().default(null),
});
export type ServiceHealth = z.infer<typeof ServiceHealthSchema>;

/** A monitor scan across all registered services. */
export const MonitorRunSchema = z.object({
  monitorRunId: z.string(),
  scope: z.enum(['all', 'service']).default('all'),
  services: z.array(ServiceHealthSchema),
  healthyCount: z.number(),
  unhealthyCount: z.number(),
  incidentIds: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type MonitorRun = z.infer<typeof MonitorRunSchema>;

export const IncidentSeverity = z.enum(['low', 'medium', 'high', 'critical']);
export const IncidentStatus = z.enum([
  'open',
  'diagnosing',
  'repair_proposed',
  'repair_planned',
  'waiting_approval',
  'repairing',
  'waiting_manual_action',
  'validating',
  'resolved',
  'failed',
  'dismissed',
]);

/** A detected failure that needs attention. */
export const IncidentSchema = z.object({
  incidentId: z.string(),
  serviceName: z.string(),
  capabilityId: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  title: z.string(),
  detail: z.string(),
  severity: IncidentSeverity.default('high'),
  status: IncidentStatus.default('open'),
  source: z.enum(['activation', 'monitor']).default('activation'),
  evidenceIds: z.array(z.string()).default([]),
  repairTaskId: z.string().nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Incident = z.infer<typeof IncidentSchema>;

export const RepairStatus = z.enum([
  'proposed',
  'diagnosing',
  'planned',
  'waiting_approval',
  'approved',
  'executing',
  'waiting_manual_action',
  'validating',
  'completed',
  'failed',
  'cancelled',
]);

/** A proposed fix for an incident (the repair loop). */
export const RepairTaskSchema = z.object({
  repairTaskId: z.string(),
  incidentId: z.string(),
  serviceName: z.string(),
  capabilityId: z.string().nullable().default(null),
  diagnosis: z.string(),
  proposedFix: z.string(),
  recommendedAction: z.enum(['redeploy', 'fix_env', 'rebuild', 'rescaffold', 'manual']).default('manual'),
  diagnosisId: z.string().nullable().default(null),
  repairPlanId: z.string().nullable().default(null),
  attempts: z.number().default(0),
  requiresApproval: z.boolean().default(true),
  status: RepairStatus.default('proposed'),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type RepairTask = z.infer<typeof RepairTaskSchema>;

/* -------------------- Phase 6: diagnosis + plan -------------------- */

export const SuspectedCauseSchema = z.object({
  cause: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).default([]),
});
export type SuspectedCause = z.infer<typeof SuspectedCauseSchema>;

/** Analysis of why a service failed activation/health. */
export const RepairDiagnosisSchema = z.object({
  diagnosisId: z.string(),
  incidentId: z.string(),
  repairTaskId: z.string().nullable().default(null),
  serviceName: z.string(),
  capabilityId: z.string().nullable().default(null),
  suspectedCauses: z.array(SuspectedCauseSchema),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string()).default([]),
  recommendedFixes: z.array(z.string()).default([]),
  requiresHumanAction: z.boolean().default(true),
  riskLevel: z.enum(['low', 'medium', 'high']).default('medium'),
  createdAt: IsoDate,
});
export type RepairDiagnosis = z.infer<typeof RepairDiagnosisSchema>;

export const PlanType = z.enum([
  'env_fix',
  'redeploy',
  'domain_fix',
  'code_patch',
  'dependency_fix',
  'registry_fix',
  'manual_action',
  'unknown',
]);
export type PlanType = z.infer<typeof PlanType>;

export const RepairPlanStatus = z.enum(['draft', 'waiting_approval', 'approved', 'rejected', 'changes_requested', 'executed', 'failed']);

/** A structured, executable repair plan. */
export const RepairPlanSchema = z.object({
  repairPlanId: z.string(),
  diagnosisId: z.string(),
  repairTaskId: z.string().nullable().default(null),
  incidentId: z.string(),
  serviceName: z.string(),
  capabilityId: z.string().nullable().default(null),
  planType: PlanType,
  steps: z.array(z.string()),
  requiredApprovals: z.array(z.string()).default([]),
  requiredEnvChanges: z.array(z.string()).default([]),
  requiredCodeChanges: z.array(z.string()).default([]),
  requiredDokployActions: z.array(z.string()).default([]),
  validationAfterRepair: z.string().default('Re-run the live activation check.'),
  requiresHumanAction: z.boolean().default(true),
  status: RepairPlanStatus.default('waiting_approval'),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type RepairPlan = z.infer<typeof RepairPlanSchema>;
