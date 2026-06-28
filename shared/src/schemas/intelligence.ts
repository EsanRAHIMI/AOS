import { z } from 'zod';
import { IsoDate } from './common.js';

/* ===========================================================================
 * Phase 13 — Real Intelligence Integration schemas.
 * Cost/budget tracking, governed web research, code/plan review, QA acceptance,
 * and executive intelligence reports. Every AI output is schema-validated; raw
 * model text never mutates state.
 * ======================================================================== */

/* -------------------- LLM cost + budget -------------------- */

export const LlmCostRecordSchema = z.object({
  recordId: z.string(),
  taskId: z.string().nullable().default(null),
  agentId: z.string(),
  taskType: z.string(),
  provider: z.enum(['anthropic', 'openai', 'mock']),
  model: z.string(),
  tokensIn: z.number().default(0),
  tokensOut: z.number().default(0),
  costUsd: z.number().default(0),
  usedFallback: z.boolean().default(false),
  traceId: z.string().nullable().default(null),
  createdAt: IsoDate,
});
export type LlmCostRecord = z.infer<typeof LlmCostRecordSchema>;

export const LlmBudgetEventSchema = z.object({
  budgetEventId: z.string(),
  scope: z.enum(['task', 'agent', 'daily']),
  limitUsd: z.number(),
  spentUsd: z.number(),
  action: z.enum(['fallback_forced', 'blocked', 'warned']),
  taskId: z.string().nullable().default(null),
  agentId: z.string().nullable().default(null),
  detail: z.string().default(''),
  createdAt: IsoDate,
});
export type LlmBudgetEvent = z.infer<typeof LlmBudgetEventSchema>;

/* -------------------- Internet research -------------------- */

export const ResearchSourceSchema = z.object({
  sourceId: z.string(),
  runId: z.string(),
  title: z.string(),
  url: z.string(),
  publisher: z.string().default(''),
  publishedAt: z.string().default(''),
  freshnessDays: z.number().nullable().default(null),
  reliability: z.enum(['high', 'medium', 'low']).default('medium'),
  excerpt: z.string().default(''),
  createdAt: IsoDate,
});
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

export const ResearchReportSchema = z.object({
  reportId: z.string(),
  runId: z.string(),
  taskId: z.string().nullable().default(null),
  topic: z.string(),
  summary: z.string(),
  findings: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
  sourceIds: z.array(z.string()).default([]),
  evidenceId: z.string().nullable().default(null),
  mode: z.enum(['real', 'fallback']).default('fallback'),
  createdAt: IsoDate,
});
export type ResearchReport = z.infer<typeof ResearchReportSchema>;

export const ResearchRunSchema = z.object({
  runId: z.string(),
  taskId: z.string().nullable().default(null),
  topic: z.string(),
  status: z.enum(['completed', 'failed']).default('completed'),
  sourceCount: z.number().default(0),
  mode: z.enum(['real', 'fallback']).default('fallback'),
  traceId: z.string().nullable().default(null),
  createdAt: IsoDate,
});
export type ResearchRun = z.infer<typeof ResearchRunSchema>;

/* -------------------- Reviewer -------------------- */

export const ReviewIssueSchema = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  area: z.string(),
  detail: z.string(),
});
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;

export const ReviewReportSchema = z.object({
  reviewId: z.string(),
  taskId: z.string().nullable().default(null),
  target: z.string(), // what was reviewed (e.g. 'architecture plan')
  passed: z.boolean(),
  issues: z.array(ReviewIssueSchema).default([]),
  risks: z.array(z.string()).default([]),
  requiredFixes: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  mode: z.enum(['real', 'fallback']).default('fallback'),
  traceId: z.string().nullable().default(null),
  createdAt: IsoDate,
});
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

/* -------------------- QA -------------------- */

export const QaCriterionSchema = z.object({
  criterion: z.string(),
  met: z.boolean(),
  evidence: z.string().default(''),
});
export type QaCriterion = z.infer<typeof QaCriterionSchema>;

export const QaReportSchema = z.object({
  qaId: z.string(),
  taskId: z.string().nullable().default(null),
  goal: z.string(),
  passed: z.boolean(),
  criteria: z.array(QaCriterionSchema).default([]),
  gaps: z.array(z.string()).default([]),
  verdict: z.string(),
  evidenceIds: z.array(z.string()).default([]),
  mode: z.enum(['real', 'fallback']).default('fallback'),
  traceId: z.string().nullable().default(null),
  createdAt: IsoDate,
});
export type QaReport = z.infer<typeof QaReportSchema>;

/* -------------------- Intelligence reports -------------------- */

export const IntelligenceReportSchema = z.object({
  reportId: z.string(),
  taskId: z.string().nullable().default(null),
  kind: z.enum(['task', 'daily', 'weekly', 'executive']).default('task'),
  title: z.string(),
  headline: z.string(),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })).default([]),
  highlights: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  mode: z.enum(['real', 'fallback']).default('fallback'),
  traceId: z.string().nullable().default(null),
  createdAt: IsoDate,
});
export type IntelligenceReport = z.infer<typeof IntelligenceReportSchema>;
