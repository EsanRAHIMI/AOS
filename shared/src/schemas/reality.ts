import { z } from 'zod';
import { IsoDate } from './common.js';
import { ScopeFieldsSchema } from './scope.js';

/* ===========================================================================
 * Phase 4 — Reality Execution Layer schemas.
 * Proof that generated capabilities actually work: runtime validations, GitHub
 * delivery records, and evidence records (the kernel never claims success
 * without evidence).
 * ======================================================================== */

export const ValidationCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  detail: z.string().default(''),
});
export type ValidationCheck = z.infer<typeof ValidationCheckSchema>;

/** Result of validating a generated service against factory standards. */
export const RuntimeValidationSchema = z.object({
  validationId: z.string(),
  taskId: z.string().nullable().default(null),
  serviceName: z.string(),
  capabilityId: z.string(),
  validationType: z.enum(['static', 'build', 'runtime', 'full']).default('static'),
  checks: z.array(ValidationCheckSchema),
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  logs: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type RuntimeValidation = z.infer<typeof RuntimeValidationSchema>;

export const GitHubOpStatus = z.enum(['prepared', 'committed', 'pushed', 'pr_open', 'failed']);
export type GitHubOpStatus = z.infer<typeof GitHubOpStatus>;

/** A record of a GitHub delivery (real push or prepared instructions). */
export const GitHubOperationSchema = z.object({
  operationId: z.string(),
  taskId: z.string().nullable().default(null),
  proposalId: z.string().nullable().default(null),
  capabilityId: z.string().nullable().default(null),
  serviceName: z.string(),
  branchName: z.string(),
  baseBranch: z.string().default('main'),
  commitSha: z.string().nullable().default(null),
  pullRequestUrl: z.string().nullable().default(null),
  mode: z.enum(['github_api', 'prepared']),
  status: GitHubOpStatus.default('prepared'),
  filesChanged: z.array(z.string()).default([]),
  summary: z.string(),
  instructions: z.string().default(''),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type GitHubOperation = z.infer<typeof GitHubOperationSchema>;

export const EvidenceType = z.enum([
  'build_log',
  'typecheck_log',
  'health_check_result',
  'manifest_check_result',
  'screenshot',
  'test_report',
  'service_response',
  'deployment_check',
  'github_commit',
  'approval_decision',
  'validation_report',
  // Phase 6 — repair evidence
  'diagnosis_report',
  'repair_plan',
  'repair_attempt',
  'env_fix_instruction',
  'code_patch',
  'validation_after_repair',
  'activation_after_repair',
  'incident_closed',
  // Phase 13 — intelligence evidence
  'research_report',
  'review_report',
  'qa_report',
  'intelligence_report',
]);
export type EvidenceType = z.infer<typeof EvidenceType>;

/** A single piece of proof. Large blobs (screenshots/reports) go to S3. */
export const EvidenceRecordSchema = z.object({
  evidenceId: z.string(),
  taskId: z.string().nullable().default(null),
  capabilityId: z.string().nullable().default(null),
  serviceName: z.string().nullable().default(null),
  type: EvidenceType,
  summary: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
  s3ObjectId: z.string().nullable().default(null),
  createdAt: IsoDate,
}).merge(ScopeFieldsSchema);
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

/* -------------------- Browser testing contracts -------------------- */

export const BrowserCheckSchema = z.object({
  type: z.enum(['title_equals', 'title_contains', 'status_is', 'text_present', 'selector_present']),
  value: z.string(),
});
export type BrowserCheck = z.infer<typeof BrowserCheckSchema>;

/** A safe, permission-governed browser test request. */
export const BrowserTestPlanSchema = z.object({
  url: z.string(),
  checks: z.array(BrowserCheckSchema).default([]),
  screenshot: z.boolean().default(false),
});
export type BrowserTestPlan = z.infer<typeof BrowserTestPlanSchema>;

export const BrowserCheckResultSchema = BrowserCheckSchema.extend({
  passed: z.boolean(),
  actual: z.string().default(''),
});
export type BrowserCheckResult = z.infer<typeof BrowserCheckResultSchema>;

/** Structured result of a browser test. */
export const BrowserTestReportSchema = z.object({
  reportId: z.string(),
  url: z.string(),
  mode: z.enum(['playwright', 'http_fallback', 'blocked']),
  httpStatus: z.number().nullable().default(null),
  title: z.string().default(''),
  passed: z.boolean(),
  checks: z.array(BrowserCheckResultSchema).default([]),
  screenshotS3ObjectId: z.string().nullable().default(null),
  notes: z.string().default(''),
  createdAt: IsoDate,
});
export type BrowserTestReport = z.infer<typeof BrowserTestReportSchema>;
