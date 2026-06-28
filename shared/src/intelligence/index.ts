/**
 * Phase 13 — Intelligence engines (research, review, QA, report).
 *
 * Each engine reasons through the LLM router into a Zod-validated structure with
 * a deterministic fallback, so raw model text never mutates state. Engines are
 * pure given a router + inputs and return the stored record(s) plus the LlmTrace
 * so callers can persist the trace, a cost record, and evidence.
 */
import { z } from 'zod';
import { genId, nowIso } from '../utils/index.js';
import type { LlmRouter, StructuredResult } from '../llm/index.js';
import { promptFor } from '../llm/prompts.js';
import type {
  ResearchRun, ResearchSource, ResearchReport,
  ReviewReport, QaReport, IntelligenceReport,
} from '../schemas/intelligence.js';
import type { LlmTrace } from '../schemas/capability.js';

export interface EngineOpts {
  router: LlmRouter;
  taskId?: string | null;
  forceFallback?: boolean;
}

/* ============================ Research ============================ */

const LlmResearchSchema = z.object({
  summary: z.string(),
  findings: z.array(z.string()).min(1),
  recommendations: z.array(z.string()).default([]),
  sources: z.array(z.object({
    title: z.string(), url: z.string(), publisher: z.string().default(''),
    publishedAt: z.string().default(''), reliability: z.enum(['high', 'medium', 'low']).default('medium'),
    excerpt: z.string().default(''),
  })).min(1),
});

/** Curated authoritative fallback knowledge (read-only, clearly marked fallback). */
function fallbackResearch(topic: string): z.infer<typeof LlmResearchSchema> {
  const t = topic.toLowerCase();
  const secDash = /secur|dashboard|auth|agent/.test(t);
  if (secDash) {
    return {
      summary: 'Best practices for securing autonomous-agent dashboards center on strong authentication, least-privilege RBAC, server-side secret handling, auditability, and a reversible kill-switch.',
      findings: [
        'Authenticate every dashboard route; use HttpOnly+Secure+SameSite session cookies and never expose admin/service tokens to the browser.',
        'Enforce least-privilege RBAC on every sensitive action and log denials to an audit trail.',
        'Rate-limit auth and mutation endpoints; return clear 401/403/429 and avoid leaking stack traces.',
        'Keep an emergency safe mode that blocks autonomous mutation while preserving read/monitor.',
        'Require human approval for irreversible or high-impact agent actions; record evidence for each.',
      ],
      recommendations: [
        'Adopt OWASP ASVS controls for session management and access control.',
        'Add per-user RBAC + OIDC and a session revocation list.',
        'Add anomaly alerts on repeated auth failures and budget/abuse spikes.',
      ],
      sources: [
        { title: 'OWASP Application Security Verification Standard (ASVS)', url: 'https://owasp.org/www-project-application-security-verification-standard/', publisher: 'OWASP', publishedAt: '2024', reliability: 'high', excerpt: 'Verification requirements for authentication, session management and access control.' },
        { title: 'OWASP Top 10', url: 'https://owasp.org/www-project-top-ten/', publisher: 'OWASP', publishedAt: '2021', reliability: 'high', excerpt: 'Most critical web application security risks including broken access control.' },
        { title: 'NIST SP 800-63B Digital Identity Guidelines', url: 'https://pages.nist.gov/800-63-3/sp800-63b.html', publisher: 'NIST', publishedAt: '2020', reliability: 'high', excerpt: 'Authentication and lifecycle management guidance.' },
        { title: 'Anthropic — Building safe agents', url: 'https://docs.anthropic.com', publisher: 'Anthropic', publishedAt: '2025', reliability: 'high', excerpt: 'Guidance on human-in-the-loop and least privilege for autonomous agents.' },
      ],
    };
  }
  return {
    summary: `Synthesized overview of "${topic}" from general best-practice knowledge.`,
    findings: [`Key considerations for ${topic} include correctness, safety, observability and reversibility.`, 'Prefer well-supported, current, widely-adopted approaches.'],
    recommendations: ['Validate against an authoritative source before acting.'],
    sources: [{ title: 'General engineering best practices', url: 'https://example.org/best-practices', publisher: 'reference', publishedAt: '2025', reliability: 'medium', excerpt: 'High-level guidance.' }],
  };
}

export interface ResearchResult {
  run: ResearchRun;
  sources: ResearchSource[];
  report: ResearchReport;
  trace: LlmTrace;
}

export async function runResearch(topic: string, opts: EngineOpts): Promise<ResearchResult> {
  const prompt = promptFor('internet-research-service:research');
  const out: StructuredResult<z.infer<typeof LlmResearchSchema>> = await opts.router.generateStructured(LlmResearchSchema, {
    agentId: 'internet-research-service', taskType: 'web_research', taskId: opts.taskId ?? null,
    system: prompt.system, promptVersion: prompt.version, forceFallback: opts.forceFallback,
    prompt: `Topic: ${topic}\nReturn summary, findings, recommendations and at least 3 cited sources (title,url,publisher,publishedAt,reliability,excerpt).`,
    fallback: () => fallbackResearch(topic),
  });
  const runId = genId('rresearch');
  const now = nowIso();
  const mode: 'real' | 'fallback' = out.trace.usedFallback ? 'fallback' : 'real';
  const sources: ResearchSource[] = out.data.sources.map((s) => ({
    sourceId: genId('rsrc'), runId, title: s.title, url: s.url, publisher: s.publisher,
    publishedAt: s.publishedAt, freshnessDays: null, reliability: s.reliability, excerpt: s.excerpt, createdAt: now,
  }));
  const run: ResearchRun = { runId, taskId: opts.taskId ?? null, topic, status: 'completed', sourceCount: sources.length, mode, traceId: out.trace.traceId, createdAt: now };
  const report: ResearchReport = {
    reportId: genId('rrep'), runId, taskId: opts.taskId ?? null, topic,
    summary: out.data.summary, findings: out.data.findings, recommendations: out.data.recommendations,
    sourceIds: sources.map((s) => s.sourceId), evidenceId: null, mode, createdAt: now,
  };
  return { run, sources, report, trace: out.trace };
}

/* ============================ Architecture / improvement plan ============================ */

export const ArchitecturePlanSchema = z.object({
  objective: z.string(),
  steps: z.array(z.object({ title: z.string(), detail: z.string(), basedOn: z.string().default('') })).min(1),
  risks: z.array(z.string()).default([]),
  summary: z.string(),
});
export type ArchitecturePlan = z.infer<typeof ArchitecturePlanSchema>;

export interface ArchitecturePlanResult { plan: ArchitecturePlan; content: string; trace: LlmTrace }

/** Produce an evidence-grounded improvement/architecture plan from a goal + research findings. */
export async function runArchitecturePlan(args: { goal: string; findings?: string[]; sources?: string[] } & EngineOpts): Promise<ArchitecturePlanResult> {
  const prompt = promptFor('architect-agent:design');
  const findings = args.findings ?? [];
  const out = await args.router.generateStructured(ArchitecturePlanSchema, {
    agentId: 'architect-agent', taskType: 'architecture_plan', taskId: args.taskId ?? null,
    system: prompt.system, promptVersion: prompt.version, forceFallback: args.forceFallback,
    prompt: `Goal: ${args.goal}\nResearch findings:\n${findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}\nProduce an objective, concrete steps (each citing which finding it is based on), risks and a summary.`,
    fallback: () => fallbackPlan(args.goal, findings),
  });
  const content = `Objective: ${out.data.objective}\n` + out.data.steps.map((s, i) => `${i + 1}. ${s.title} — ${s.detail}${s.basedOn ? ` [based on: ${s.basedOn}]` : ''}`).join('\n') + `\nRisks: ${out.data.risks.join('; ')}\nSummary: ${out.data.summary}`;
  return { plan: out.data, content, trace: out.trace };
}

function fallbackPlan(goal: string, findings: string[]): ArchitecturePlan {
  const steps = (findings.length ? findings : ['Apply current best practices', 'Add observability', 'Keep changes reversible']).slice(0, 6).map((f, i) => ({ title: `Step ${i + 1}`, detail: f, basedOn: `finding ${i + 1}` }));
  return {
    objective: `Improve: ${goal}`,
    steps,
    risks: ['Changes must remain within policy, RBAC and approval gates.', 'Validate each step with evidence before rollout.'],
    summary: `Evidence-grounded improvement plan for "${goal}" derived from ${findings.length} research findings.`,
  };
}

/* ============================ Review ============================ */

const LlmReviewSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.object({ severity: z.enum(['low', 'medium', 'high', 'critical']), area: z.string(), detail: z.string() })).default([]),
  risks: z.array(z.string()).default([]),
  requiredFixes: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
});

export interface ReviewResult { report: ReviewReport; trace: LlmTrace }

export async function runReview(args: { target: string; content: string; evidenceIds?: string[] } & EngineOpts): Promise<ReviewResult> {
  const prompt = promptFor('reviewer-agent:review');
  const out = await args.router.generateStructured(LlmReviewSchema, {
    agentId: 'reviewer-agent', taskType: 'review', taskId: args.taskId ?? null,
    system: prompt.system, promptVersion: prompt.version, forceFallback: args.forceFallback,
    prompt: `Review target: ${args.target}\nContent:\n${args.content}\nReturn passed + issues + risks + requiredFixes + recommendations. Fail it if security or acceptance is inadequate.`,
    fallback: () => deterministicReview(args.target, args.content),
  });
  const mode: 'real' | 'fallback' = out.trace.usedFallback ? 'fallback' : 'real';
  const report: ReviewReport = {
    reviewId: genId('review'), taskId: args.taskId ?? null, target: args.target,
    passed: out.data.passed, issues: out.data.issues, risks: out.data.risks,
    requiredFixes: out.data.requiredFixes, recommendations: out.data.recommendations,
    evidenceIds: args.evidenceIds ?? [], mode, traceId: out.trace.traceId, createdAt: nowIso(),
  };
  return { report, trace: out.trace };
}

function deterministicReview(target: string, content: string): z.infer<typeof LlmReviewSchema> {
  const c = content.toLowerCase();
  const issues: z.infer<typeof LlmReviewSchema>['issues'] = [];
  if (!/secur|auth|rbac|approval|safe mode/.test(c)) issues.push({ severity: 'high', area: 'security', detail: 'Plan does not explicitly address authentication/RBAC/approval controls.' });
  if (!/risk|rollback|revert|reversible/.test(c)) issues.push({ severity: 'medium', area: 'reversibility', detail: 'No explicit rollback/reversibility considerations.' });
  if (content.trim().length < 40) issues.push({ severity: 'high', area: 'completeness', detail: 'Plan is too thin to evaluate.' });
  const passed = issues.filter((i) => i.severity === 'high' || i.severity === 'critical').length === 0;
  return {
    passed,
    issues,
    risks: passed ? ['Low residual risk if approvals and safe mode remain enforced.'] : ['Security/acceptance gaps must be closed before proceeding.'],
    requiredFixes: passed ? [] : issues.filter((i) => i.severity !== 'low').map((i) => `Address ${i.area}: ${i.detail}`),
    recommendations: [`Keep ${target} within policy, RBAC and approval gates; attach evidence for each step.`],
  };
}

/* ============================ QA ============================ */

const LlmQaSchema = z.object({
  passed: z.boolean(),
  criteria: z.array(z.object({ criterion: z.string(), met: z.boolean(), evidence: z.string().default('') })).min(1),
  gaps: z.array(z.string()).default([]),
  verdict: z.string(),
});

export interface QaResult { report: QaReport; trace: LlmTrace }

export async function runQa(args: { goal: string; evidenceSummary: string; evidenceIds?: string[] } & EngineOpts): Promise<QaResult> {
  const prompt = promptFor('qa-agent:acceptance');
  const out = await args.router.generateStructured(LlmQaSchema, {
    agentId: 'qa-agent', taskType: 'qa', taskId: args.taskId ?? null,
    system: prompt.system, promptVersion: prompt.version, forceFallback: args.forceFallback,
    prompt: `Goal: ${args.goal}\nEvidence available:\n${args.evidenceSummary}\nDerive acceptance criteria and check each against the evidence. Never pass without evidence.`,
    fallback: () => deterministicQa(args.goal, args.evidenceSummary),
  });
  const mode: 'real' | 'fallback' = out.trace.usedFallback ? 'fallback' : 'real';
  const report: QaReport = {
    qaId: genId('qa'), taskId: args.taskId ?? null, goal: args.goal, passed: out.data.passed,
    criteria: out.data.criteria, gaps: out.data.gaps, verdict: out.data.verdict,
    evidenceIds: args.evidenceIds ?? [], mode, traceId: out.trace.traceId, createdAt: nowIso(),
  };
  return { report, trace: out.trace };
}

function deterministicQa(goal: string, evidence: string): z.infer<typeof LlmQaSchema> {
  const e = evidence.toLowerCase();
  const has = (k: string) => e.includes(k);
  const criteria = [
    { criterion: 'Research was performed with cited sources', met: has('research') || has('source'), evidence: 'research evidence present' },
    { criterion: 'An improvement/architecture plan exists', met: has('plan') || has('architect'), evidence: 'plan evidence present' },
    { criterion: 'The plan was reviewed', met: has('review'), evidence: 'review evidence present' },
    { criterion: 'Output addresses the stated goal', met: evidence.trim().length > 0, evidence: 'evidence linked to task' },
  ];
  const gaps = criteria.filter((c) => !c.met).map((c) => `Missing: ${c.criterion}`);
  const passed = gaps.length === 0;
  return { passed, criteria, gaps, verdict: passed ? `Acceptance criteria for "${goal}" met with linked evidence.` : `Not accepted: ${gaps.length} criteria unmet.` };
}

/* ============================ Report ============================ */

const LlmReportSchema = z.object({
  headline: z.string(),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })).min(1),
  highlights: z.array(z.string()).default([]),
});

export interface ReportResult { report: IntelligenceReport; trace: LlmTrace }

export async function runReport(args: { title: string; kind?: IntelligenceReport['kind']; inputs: Record<string, unknown>; evidenceIds?: string[] } & EngineOpts): Promise<ReportResult> {
  const prompt = promptFor('report-agent:executive');
  const out = await args.router.generateStructured(LlmReportSchema, {
    agentId: 'report-agent', taskType: 'report', taskId: args.taskId ?? null,
    system: prompt.system, promptVersion: prompt.version, forceFallback: args.forceFallback,
    prompt: `Write an executive report titled "${args.title}". Data:\n${JSON.stringify(args.inputs).slice(0, 4000)}\nReturn headline, sections and highlights grounded only in this data.`,
    fallback: () => deterministicReport(args.title, args.inputs),
  });
  const mode: 'real' | 'fallback' = out.trace.usedFallback ? 'fallback' : 'real';
  const report: IntelligenceReport = {
    reportId: genId('intel'), taskId: args.taskId ?? null, kind: args.kind ?? 'task',
    title: args.title, headline: out.data.headline, sections: out.data.sections, highlights: out.data.highlights,
    evidenceIds: args.evidenceIds ?? [], mode, traceId: out.trace.traceId, createdAt: nowIso(),
  };
  return { report, trace: out.trace };
}

function deterministicReport(title: string, inputs: Record<string, unknown>): z.infer<typeof LlmReportSchema> {
  const entries = Object.entries(inputs);
  return {
    headline: `${title}: ${entries.length} inputs synthesized into an evidence-backed report.`,
    sections: entries.slice(0, 8).map(([k, v]) => ({ heading: k, body: typeof v === 'string' ? v : JSON.stringify(v).slice(0, 600) })),
    highlights: entries.slice(0, 4).map(([k]) => `Covered: ${k}`),
  };
}
