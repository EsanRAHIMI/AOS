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
import type { WebSearchProvider, WebSearchResult } from '../research/index.js';
import { estimateReliability } from '../research/index.js';
import type {
  ResearchRun, ResearchSource, ResearchReport, ResearchSourceMode, ResearchSynthesisMode,
  ReviewReport, QaReport, IntelligenceReport,
} from '../schemas/intelligence.js';
import type { LlmTrace } from '../schemas/capability.js';

export interface EngineOpts {
  router: LlmRouter;
  taskId?: string | null;
  forceFallback?: boolean;
}

/* ============================ Research ============================ */

// Phase AG.5 — a short, honest default for a genuinely-optional narrative
// field the model failed to fill in. Never invented content — a plain
// statement that the evidence didn't cover this angle.
const NOT_ENOUGH_EVIDENCE = 'Not enough evidence in retrieved sources.';

// Phase AG.5 — findings/opportunities are structured objects (title/detail/
// why-it-matters, and title/action/rationale respectively), not flat
// strings. This matches what the Phase AG.3 v2 prompt already ASKS the
// model to reason toward (an executive summary, findings that explain why
// they matter, opportunity/next-action recommendations) — the schema had
// fallen out of sync with the prompt's own language, which is the root
// cause of "expected string, received undefined": the model's real output
// naturally nested into a richer shape than the flat `findings: string[]`
// the schema still demanded, and unfilled narrative sub-fields came back
// undefined. `title`/`detail`/`action` are always-required core content
// (never defaulted — a finding/opportunity with no title or detail is not
// valid output); `whyItMatters`/`rationale`/`confidence`/`sourceIndexes`
// are genuinely optional and get a safe, honest default instead of
// rejecting an otherwise-good response.
const LlmFindingSchema = z.object({
  title: z.string(),
  detail: z.string(),
  whyItMatters: z.string().default(NOT_ENOUGH_EVIDENCE),
  confidence: z.enum(['low', 'medium', 'high']).default('medium'),
  /** Indexes into the retrieved search results this finding is grounded in
   *  (0-based). Purely a citation hint for the summary text — never used to
   *  construct `ResearchSource[]`, which is always rebuilt structurally
   *  from the raw Tavily results regardless of what the model claims here. */
  sourceIndexes: z.array(z.number().int().min(0)).default([]),
});

const LlmOpportunitySchema = z.object({
  title: z.string(),
  action: z.string(),
  rationale: z.string().default(NOT_ENOUGH_EVIDENCE),
  sourceIndexes: z.array(z.number().int().min(0)).default([]),
});

const LlmResearchSchema = z.object({
  summary: z.string(),
  findings: z.array(LlmFindingSchema).min(1),
  opportunities: z.array(LlmOpportunitySchema).default([]),
  nextActions: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([]),
  sources: z.array(z.object({
    title: z.string(), url: z.string(), publisher: z.string().default(''),
    publishedAt: z.string().default(''), reliability: z.enum(['high', 'medium', 'low']).default('medium'),
    excerpt: z.string().default(''),
  })).min(1),
});
type LlmResearchOutput = z.infer<typeof LlmResearchSchema>;

/** Phase AG.5 — flatten the structured findings/opportunities/nextActions
 *  into the flat `string[]` shape `ResearchReport.findings`/`.recommendations`
 *  have always used, so the STORED/PUBLIC contract (and every downstream
 *  consumer: gateway's Jarvis summary text, ResearchTaskPayload, the AG.2-
 *  AG.4 smoke tests) is completely unaffected by this schema change. */
function flattenFindings(findings: LlmResearchOutput['findings']): string[] {
  return findings.map((f) => `${f.title}: ${f.detail}${f.whyItMatters && f.whyItMatters !== NOT_ENOUGH_EVIDENCE ? ` (Why it matters: ${f.whyItMatters})` : ''}`);
}
function flattenRecommendations(data: Pick<LlmResearchOutput, 'opportunities' | 'nextActions'>): string[] {
  const fromOpportunities = data.opportunities.map((o) => `${o.title}: ${o.action}${o.rationale && o.rationale !== NOT_ENOUGH_EVIDENCE ? ` (${o.rationale})` : ''}`);
  return [...fromOpportunities, ...data.nextActions];
}

/** Curated authoritative fallback knowledge (read-only, clearly marked fallback). */
function fallbackResearch(topic: string): LlmResearchOutput {
  const t = topic.toLowerCase();
  const secDash = /secur|dashboard|auth|agent/.test(t);
  if (secDash) {
    return {
      summary: 'Best practices for securing autonomous-agent dashboards center on strong authentication, least-privilege RBAC, server-side secret handling, auditability, and a reversible kill-switch.',
      findings: [
        { title: 'Authenticate every dashboard route', detail: 'Use HttpOnly+Secure+SameSite session cookies and never expose admin/service tokens to the browser.', whyItMatters: 'Session/token leaks are the most common path to full account takeover.', confidence: 'high', sourceIndexes: [] },
        { title: 'Enforce least-privilege RBAC', detail: 'Gate every sensitive action behind role checks and log denials to an audit trail.', whyItMatters: 'Limits blast radius when a single credential or session is compromised.', confidence: 'high', sourceIndexes: [] },
        { title: 'Rate-limit auth and mutation endpoints', detail: 'Return clear 401/403/429 responses and avoid leaking stack traces.', whyItMatters: 'Slows credential-stuffing and abuse without degrading legitimate use.', confidence: 'medium', sourceIndexes: [] },
        { title: 'Keep an emergency safe mode', detail: 'Block autonomous mutation while preserving read/monitor access.', whyItMatters: 'Gives a human a fast, reversible kill-switch during an incident.', confidence: 'high', sourceIndexes: [] },
        { title: 'Require human approval for irreversible actions', detail: 'Gate high-impact or irreversible agent actions behind explicit approval, with evidence recorded for each.', whyItMatters: 'Keeps autonomy observable and auditable rather than blindly trusted.', confidence: 'high', sourceIndexes: [] },
      ],
      opportunities: [
        { title: 'Adopt OWASP ASVS controls', action: 'Apply ASVS session-management and access-control requirements.', rationale: 'Industry-standard verification checklist reduces the chance of missing a control.', sourceIndexes: [] },
        { title: 'Add per-user RBAC + OIDC', action: 'Introduce a session revocation list alongside role-based access.', rationale: 'Enables fast, targeted access revocation without a full credential rotation.', sourceIndexes: [] },
      ],
      nextActions: ['Add anomaly alerts on repeated auth failures and budget/abuse spikes.'],
      limitations: ['This is curated fallback knowledge, not a live search result — no source freshness has been verified.'],
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
    findings: [
      { title: `Key considerations for ${topic}`, detail: 'Correctness, safety, observability and reversibility.', whyItMatters: NOT_ENOUGH_EVIDENCE, confidence: 'low', sourceIndexes: [] },
      { title: 'Prefer proven approaches', detail: 'Well-supported, current, widely-adopted approaches reduce risk versus novel/unverified ones.', whyItMatters: NOT_ENOUGH_EVIDENCE, confidence: 'low', sourceIndexes: [] },
    ],
    opportunities: [],
    nextActions: ['Validate against an authoritative source before acting.'],
    limitations: ['No live search was performed for this topic — this is general knowledge, not current evidence.'],
    sources: [{ title: 'General engineering best practices', url: 'https://example.org/best-practices', publisher: 'reference', publishedAt: '2025', reliability: 'medium', excerpt: 'High-level guidance.' }],
  };
}

export interface ResearchResult {
  run: ResearchRun;
  sources: ResearchSource[];
  report: ResearchReport;
  trace: LlmTrace;
}

/** Phase AG — deterministic fallback that still uses REAL search results
 *  when a provider is configured but the LLM is not (or is fallback-forced).
 *  Configuring search should never degrade to canned text when live results
 *  actually exist — it degrades only to "no synthesis," which is honest. */
function fallbackFromSearchResults(topic: string, results: WebSearchResult[]): LlmResearchOutput {
  return {
    summary: `Retrieved ${results.length} real web result(s) for "${topic}" from a live search provider. No LLM synthesis was performed this run (deterministic fallback), so findings below are the raw retrieved titles/snippets, not a summary.`,
    findings: results.slice(0, 6).map((r, i) => ({ title: r.title, detail: r.snippet.slice(0, 180), whyItMatters: NOT_ENOUGH_EVIDENCE, confidence: 'low', sourceIndexes: [i] })),
    opportunities: [],
    nextActions: ['Review the cited sources directly — configure an LLM provider for synthesized findings and recommendations.'],
    limitations: ['LLM synthesis did not run — these are raw retrieved titles/snippets, not a reasoned summary.'],
    sources: results.map((r) => ({ title: r.title, url: r.url, publisher: r.publisher, publishedAt: r.publishedAt, reliability: estimateReliability(r.url), excerpt: r.snippet })),
  };
}

export async function runResearch(topic: string, opts: EngineOpts & { searchProvider?: WebSearchProvider | null }): Promise<ResearchResult> {
  const prompt = promptFor('internet-research-service:research');

  // Phase AG — fetch REAL search results first, if a provider is configured.
  // A search failure (bad key, network, rate limit) is caught and treated
  // exactly like "no provider configured" — never surfaced as an uncaught
  // error, never silently retried into a fake success.
  let searchResults: WebSearchResult[] = [];
  let searchError: string | null = null;
  if (opts.searchProvider) {
    try {
      searchResults = await opts.searchProvider.search(topic, { maxResults: 6 });
    } catch (e) {
      searchError = e instanceof Error ? e.message : 'web search failed';
    }
  }
  const grounded = searchResults.length > 0;

  // Phase AG.5 — an explicit JSON shape example, with EXACT field names,
  // colocated with the Zod schema it must match (rather than in the
  // versioned system prompt, which stays focused on role/policy and would
  // silently drift out of sync with schema changes over time). The prior
  // prompt described the desired CONTENT ("a summary, findings, and
  // recommendations") but never the literal output shape — the model
  // reasonably inferred a richer structure than the flat `findings:
  // string[]` schema still demanded, and any narrative sub-field it left
  // out came back `undefined`, which is what produced "expected string,
  // received undefined" on a real provider call. Required fields are
  // marked so the model fills them with a short honest string (e.g.
  // "Not enough evidence in retrieved sources.") instead of omitting them
  // when genuinely unsure, rather than leaving the key out of the JSON.
  const SHAPE_EXAMPLE = `Respond with EXACTLY this JSON shape (fill every field — for any narrative field you're unsure of, write a short honest string like "Not enough evidence in retrieved sources." rather than omitting the key):
{
  "summary": "string — a short executive summary",
  "findings": [
    { "title": "string", "detail": "string", "whyItMatters": "string", "confidence": "low|medium|high", "sourceIndexes": [0] }
  ],
  "opportunities": [
    { "title": "string", "action": "string", "rationale": "string", "sourceIndexes": [0] }
  ],
  "nextActions": ["string"],
  "limitations": ["string"],
  "sources": [
    { "title": "string", "url": "string", "publisher": "string", "publishedAt": "string", "reliability": "low|medium|high", "excerpt": "string" }
  ]
}
Provide 5-7 "findings" entries. "sourceIndexes" are 0-based indexes into the numbered search results below (or into "sources" if none were supplied) — they are citation hints only.`;

  const out: StructuredResult<LlmResearchOutput> = await opts.router.generateStructured(LlmResearchSchema, {
    agentId: 'internet-research-service', taskType: 'web_research', taskId: opts.taskId ?? null,
    system: prompt.system, promptVersion: prompt.version, forceFallback: opts.forceFallback,
    // Phase AG.3 — research completions must echo back metadata for up to 6
    // sources plus a real summary/findings/recommendations; the historical
    // 1024-token default silently truncated this into invalid JSON, which
    // looked identical to "no LLM configured" from the outside.
    maxTokens: 3072,
    prompt: grounded
      ? `Topic: ${topic}\nHere are real, freshly retrieved web search results — base your summary, findings, and opportunities ONLY on these; do not invent or add other sources; echo these exact titles/URLs back in your sources array:\n\n${searchResults.map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n${r.snippet}`).join('\n\n')}\n\n${SHAPE_EXAMPLE}`
      : `Topic: ${topic}\n${SHAPE_EXAMPLE}`,
    fallback: () => (grounded ? fallbackFromSearchResults(topic, searchResults) : fallbackResearch(topic)),
  });

  const runId = genId('rresearch');
  const now = nowIso();
  const mode: 'real' | 'fallback' = out.trace.usedFallback ? 'fallback' : 'real';

  // Phase AG.3 — synthesisMode/synthesisFailureReason are reported alongside
  // (never instead of) sourceMode: a run can have real Tavily URLs
  // (sourceMode: 'search_api') while the LLM synthesis step itself failed
  // (synthesisMode: 'deterministic_fallback') — that combination must always
  // say exactly why, never silently present raw snippets as "research."
  const synthesisMode: ResearchSynthesisMode = out.trace.usedFallback ? 'deterministic_fallback' : 'llm_synthesized';
  const synthesisFailureReason: string | null = out.trace.usedFallback
    ? (out.trace.errorDetail
        ?? (out.trace.provider === 'mock'
          ? 'No LLM provider is configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY) — this run used retrieval-only deterministic output, not LLM synthesis.'
          : 'LLM synthesis was not attempted this run (forced fallback mode).'))
    : null;

  // Phase AG — the critical integrity rule: when grounded, source URLs are
  // ALWAYS rebuilt directly from the real search results, never taken from
  // the LLM's echoed `sources` field. An LLM can typo, truncate, or subtly
  // alter a URL even when asked to "echo it back exactly" — rebuilding from
  // the original real data makes that class of error structurally
  // impossible rather than trusting the model to be faithful.
  const sourceMode: ResearchSourceMode = grounded ? 'search_api' : (out.trace.usedFallback ? 'curated_fallback' : 'llm_only');
  const sourceData = grounded
    ? searchResults.map((r) => ({ title: r.title, url: r.url, publisher: r.publisher, publishedAt: r.publishedAt, reliability: estimateReliability(r.url), excerpt: r.snippet }))
    : out.data.sources;

  const sources: ResearchSource[] = sourceData.map((s) => ({
    sourceId: genId('rsrc'), runId, title: s.title, url: s.url, publisher: s.publisher,
    publishedAt: s.publishedAt, freshnessDays: null, reliability: s.reliability, excerpt: s.excerpt, sourceMode, createdAt: now,
  }));
  const run: ResearchRun = {
    runId, taskId: opts.taskId ?? null, topic, status: 'completed', sourceCount: sources.length,
    mode, sourceMode, synthesisMode, synthesisFailureReason, traceId: out.trace.traceId, createdAt: now,
  };

  // Phase AG.3 — the summary text itself must never claim "complete research"
  // when synthesis fell back. Build an explicit, honest summary rather than
  // relying on fallbackFromSearchResults()'s generic canned phrase, since that
  // function has no access to the *specific* failure reason (it runs before
  // the trace exists).
  let summary: string;
  if (searchError && opts.searchProvider) {
    summary = `[web search unavailable: ${searchError} — falling back to LLM/curated knowledge] ${out.data.summary}`;
  } else if (synthesisMode === 'deterministic_fallback' && grounded) {
    summary = `Retrieved ${searchResults.length} real web result(s) for "${topic}" from a live search provider (sourceMode: search_api). LLM synthesis did NOT run this call — ${synthesisFailureReason} The findings below are the raw retrieved titles/snippets, not a synthesized research answer.`;
  } else {
    summary = out.data.summary;
  }

  // Phase AG.5 — flatten the richer structured findings/opportunities/
  // nextActions down to the flat string[] shape ResearchReport.findings/
  // .recommendations have always used, so nothing downstream (Jarvis
  // summary text, ResearchTaskPayload, dashboard, AG.2-AG.4 tests) needs to
  // change. `limitations` is appended to findings when present — it's real,
  // model-produced content that would otherwise be silently dropped.
  const flatFindings = [...flattenFindings(out.data.findings), ...out.data.limitations.map((l) => `Limitation: ${l}`)];
  const flatRecommendations = flattenRecommendations(out.data);

  const report: ResearchReport = {
    reportId: genId('rrep'), runId, taskId: opts.taskId ?? null, topic,
    summary, findings: flatFindings, recommendations: flatRecommendations,
    sourceIds: sources.map((s) => s.sourceId), evidenceId: null, mode, sourceMode,
    synthesisMode, synthesisFailureReason, createdAt: now,
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
