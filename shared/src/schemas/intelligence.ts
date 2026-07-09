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

/**
 * Phase AG — `sourceMode` is orthogonal to `mode` below: `mode` says whether
 * the LLM call was real or fallback; `sourceMode` says whether the *source
 * URLs themselves* came from a real web search API, from the LLM's own
 * recall (no search configured), or from hand-curated fallback knowledge
 * (no search AND no LLM). A run can have a real LLM (`mode: 'real'`) with
 * `sourceMode: 'llm_only'` — the summary is genuinely reasoned, but the
 * source URLs were never independently verified to exist. Only
 * `sourceMode: 'search_api'` means the URLs were returned by an actual
 * search engine call this run.
 */
export const ResearchSourceModeSchema = z.enum(['search_api', 'llm_only', 'curated_fallback']);
export type ResearchSourceMode = z.infer<typeof ResearchSourceModeSchema>;

/**
 * Phase AG.3 — `synthesisMode` is orthogonal to both `mode` and `sourceMode`
 * above. `sourceMode` says where the *source URLs* came from; `synthesisMode`
 * says whether the *prose* (summary/findings/recommendations) was actually
 * reasoned over the retrieved content by an LLM, or is the deterministic
 * title/snippet restatement used when no LLM call produced valid output.
 * A run can have `sourceMode: 'search_api'` (real Tavily URLs) together with
 * `synthesisMode: 'deterministic_fallback'` (LLM synthesis failed) — that
 * combination must never be reported as "complete research."
 */
export const ResearchSynthesisModeSchema = z.enum(['llm_synthesized', 'deterministic_fallback']);
export type ResearchSynthesisMode = z.infer<typeof ResearchSynthesisModeSchema>;

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
  sourceMode: ResearchSourceModeSchema.default('llm_only'),
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
  sourceMode: ResearchSourceModeSchema.default('llm_only'),
  synthesisMode: ResearchSynthesisModeSchema.default('deterministic_fallback'),
  /** Phase AG.3 — set only when synthesisMode is 'deterministic_fallback' and
   *  a real LLM call was attempted; carries the actual reason (from
   *  LlmTrace.errorDetail) instead of a silent, unexplained downgrade. */
  synthesisFailureReason: z.string().nullable().default(null),
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
  sourceMode: ResearchSourceModeSchema.default('llm_only'),
  synthesisMode: ResearchSynthesisModeSchema.default('deterministic_fallback'),
  synthesisFailureReason: z.string().nullable().default(null),
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
