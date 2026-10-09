/**
 * Persist the intelligence engines. runResearch/runReview/runQa/runReport stay
 * pure; this module is the single write path (traces, cost, evidence, reports, events).
 */
import type { Collection } from 'mongodb';
import { globalCollection } from '../db/index.js';
import { COLLECTIONS, EVENT_TYPES } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import { startAgentRun, finishAgentRun } from '../agentrun/index.js';
import { buildLlmCostRecord, llmRouterFromEnv } from '../llm/index.js';
import { buildEvidence } from '../evidence/index.js';
import { webSearchProviderFromEnv, type WebSearchProvider } from '../research/index.js';
import type { EventPublisher } from '../events/index.js';
import type { LlmTrace } from '../schemas/capability.js';
import type { IntelligenceReport, LlmCostRecord, QaReport, ResearchReport, ResearchRun, ResearchSource, ReviewReport } from '../schemas/intelligence.js';
import type { EvidenceRecord } from '../schemas/reality.js';
import { runQa, runReport, runResearch, runReview } from './index.js';

type Publish = EventPublisher['publish'];

async function persistTrace(trace: LlmTrace): Promise<void> {
  await globalCollection<LlmTrace>(COLLECTIONS.LLM_TRACES).insertOne(trace);
  await globalCollection<LlmCostRecord>(COLLECTIONS.LLM_COST_RECORDS).insertOne(buildLlmCostRecord(trace));
}

export async function executeResearch(args: {
  topic: string;
  taskId?: string | null;
  forceFallback?: boolean;
  searchProvider?: WebSearchProvider | null;
  publish: Publish;
}): Promise<{
  taskId: string;
  accepted: true;
  agentRunId: string;
  research: {
    reportId: string;
    runId: string;
    mode: string;
    sourceMode: string;
    synthesisMode: string;
    synthesisFailureReason: string | null;
    sourceCount: number;
    evidenceId: string;
    summary: string;
    findings: string[];
    recommendations: string[];
    sources: Array<{ title: string; url: string; reliability: string; sourceMode: string }>;
  };
}> {
  const taskId = args.taskId ?? null;
  const topic = args.topic.trim();
  const agentId = 'internet-research-service';
  const searchProvider = args.searchProvider === undefined ? webSearchProviderFromEnv(process.env) : args.searchProvider;
  const runId = await startAgentRun({ agentId, serviceId: agentId, taskId: taskId ?? 'adhoc' });
  await args.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: `Researching: ${topic} (read-only)${searchProvider ? ' — live web search' : ''}` } });

  const { run, sources, report, trace } = await runResearch(topic, {
    router: llmRouterFromEnv(),
    taskId,
    forceFallback: args.forceFallback,
    searchProvider,
  });
  await persistTrace(trace);

  const evidence: EvidenceRecord = buildEvidence({
    type: 'research_report',
    taskId,
    summary: `Research "${topic}" — ${report.mode}, ${sources.length} sources, ${report.findings.length} findings`,
    data: { reportId: report.reportId, runId: run.runId, sourceCount: sources.length, mode: report.mode },
  });
  report.evidenceId = evidence.evidenceId;

  await globalCollection<ResearchRun>(COLLECTIONS.RESEARCH_RUNS).insertOne(run);
  if (sources.length) await globalCollection<ResearchSource>(COLLECTIONS.RESEARCH_SOURCES).insertMany(sources);
  await globalCollection<ResearchReport>(COLLECTIONS.RESEARCH_REPORTS).insertOne(report);
  await globalCollection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertOne(evidence);

  await finishAgentRun(runId, { status: 'succeeded', summary: `Research complete (${report.mode}, sources: ${report.sourceMode}, synthesis: ${report.synthesisMode}); ${sources.length} sources.` });
  await args.publish({
    type: EVENT_TYPES.RESEARCH_COMPLETED_V2,
    taskId,
    payload: { reportId: report.reportId, sourceCount: sources.length, mode: report.mode, sourceMode: report.sourceMode, synthesisMode: report.synthesisMode, message: `Research report ready (${report.mode}, sources: ${report.sourceMode}, synthesis: ${report.synthesisMode})` },
  });

  return {
    taskId: taskId ?? 'adhoc',
    accepted: true,
    agentRunId: runId,
    research: {
      reportId: report.reportId,
      runId: run.runId,
      mode: report.mode,
      sourceMode: report.sourceMode,
      synthesisMode: report.synthesisMode,
      synthesisFailureReason: report.synthesisFailureReason,
      sourceCount: sources.length,
      evidenceId: evidence.evidenceId,
      summary: report.summary,
      findings: report.findings,
      recommendations: report.recommendations,
      sources: sources.map((s) => ({ title: s.title, url: s.url, reliability: s.reliability, sourceMode: s.sourceMode })),
    },
  };
}

export async function executeReview(args: {
  target: string;
  content: string;
  taskId?: string | null;
  evidenceIds?: string[];
  forceFallback?: boolean;
  publish: Publish;
}): Promise<{
  taskId: string;
  accepted: true;
  agentRunId: string;
  review: { reviewId: string; passed: boolean; mode: string; issues: ReviewReport['issues']; risks: string[]; requiredFixes: string[]; recommendations: string[]; evidenceId: string };
}> {
  const taskId = args.taskId ?? null;
  const agentId = 'reviewer-agent';
  const runId = await startAgentRun({ agentId, serviceId: agentId, taskId: taskId ?? 'adhoc' });
  await args.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: `Reviewing ${args.target}` } });

  const { report, trace } = await runReview({
    router: llmRouterFromEnv(),
    taskId,
    target: args.target,
    content: args.content,
    evidenceIds: args.evidenceIds,
    forceFallback: args.forceFallback,
  });
  await persistTrace(trace);

  const evidence: EvidenceRecord = buildEvidence({
    type: 'review_report',
    taskId,
    summary: `Review of ${args.target}: ${report.passed ? 'PASSED' : 'FAILED'} (${report.issues.length} issues, ${report.mode})`,
    data: { reviewId: report.reviewId, passed: report.passed, issueCount: report.issues.length, mode: report.mode },
  });
  report.evidenceIds = [...report.evidenceIds, evidence.evidenceId];
  await globalCollection<ReviewReport>(COLLECTIONS.REVIEW_REPORTS).insertOne(report);
  await globalCollection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertOne(evidence);

  await finishAgentRun(runId, { status: 'succeeded', summary: `Review ${report.passed ? 'passed' : 'failed'} (${report.mode}).` });
  await args.publish({
    type: EVENT_TYPES.REVIEW_COMPLETED,
    taskId,
    payload: { reviewId: report.reviewId, passed: report.passed, mode: report.mode, level: report.passed ? 'success' : 'warn', message: `Review ${report.passed ? 'passed' : 'found issues'}` },
  });

  return {
    taskId: taskId ?? 'adhoc',
    accepted: true,
    agentRunId: runId,
    review: {
      reviewId: report.reviewId,
      passed: report.passed,
      mode: report.mode,
      issues: report.issues,
      risks: report.risks,
      requiredFixes: report.requiredFixes,
      recommendations: report.recommendations,
      evidenceId: evidence.evidenceId,
    },
  };
}

export async function executeQa(args: {
  goal: string;
  evidenceSummary: string;
  taskId?: string | null;
  evidenceIds?: string[];
  forceFallback?: boolean;
  publish: Publish;
}): Promise<{
  taskId: string;
  accepted: true;
  agentRunId: string;
  qa: { qaId: string; passed: boolean; mode: string; criteria: QaReport['criteria']; gaps: string[]; verdict: string; evidenceId: string };
}> {
  const taskId = args.taskId ?? null;
  const agentId = 'qa-agent';
  const runId = await startAgentRun({ agentId, serviceId: agentId, taskId: taskId ?? 'adhoc' });
  await args.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: 'QA verifying acceptance criteria' } });

  const { report, trace } = await runQa({
    router: llmRouterFromEnv(),
    taskId,
    goal: args.goal,
    evidenceSummary: args.evidenceSummary,
    evidenceIds: args.evidenceIds,
    forceFallback: args.forceFallback,
  });
  await persistTrace(trace);

  const evidence: EvidenceRecord = buildEvidence({
    type: 'qa_report',
    taskId,
    summary: `QA ${report.passed ? 'PASSED' : 'FAILED'}: ${report.criteria.filter((c) => c.met).length}/${report.criteria.length} criteria (${report.mode})`,
    data: { qaId: report.qaId, passed: report.passed, mode: report.mode },
  });
  report.evidenceIds = [...report.evidenceIds, evidence.evidenceId];
  await globalCollection<QaReport>(COLLECTIONS.QA_REPORTS).insertOne(report);
  await globalCollection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertOne(evidence);

  await finishAgentRun(runId, { status: 'succeeded', summary: `QA ${report.passed ? 'passed' : 'failed'} (${report.mode}).` });
  await args.publish({
    type: EVENT_TYPES.QA_COMPLETED,
    taskId,
    payload: { qaId: report.qaId, passed: report.passed, mode: report.mode, level: report.passed ? 'success' : 'warn', message: `QA ${report.passed ? 'passed' : 'failed'}` },
  });

  return {
    taskId: taskId ?? 'adhoc',
    accepted: true,
    agentRunId: runId,
    qa: {
      qaId: report.qaId,
      passed: report.passed,
      mode: report.mode,
      criteria: report.criteria,
      gaps: report.gaps,
      verdict: report.verdict,
      evidenceId: evidence.evidenceId,
    },
  };
}

export async function executeReport(args: {
  title: string;
  goal?: string;
  kind?: IntelligenceReport['kind'];
  inputs?: Record<string, unknown>;
  taskId?: string | null;
  evidenceIds?: string[];
  forceFallback?: boolean;
  publish: Publish;
}): Promise<{
  taskId: string;
  accepted: true;
  agentRunId: string;
  report: { reportId: string; title: string; headline: string; mode: string; sections: IntelligenceReport['sections']; highlights: string[]; evidenceId: string };
}> {
  const taskId = args.taskId ?? null;
  const agentId = 'report-agent';
  const runId = await startAgentRun({ agentId, serviceId: agentId, taskId: taskId ?? 'adhoc' });
  await args.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: `Writing report: ${args.title}` } });

  const { report, trace } = await runReport({
    router: llmRouterFromEnv(),
    taskId,
    title: args.title,
    kind: args.kind,
    inputs: args.inputs ?? { goal: args.goal },
    evidenceIds: args.evidenceIds,
    forceFallback: args.forceFallback,
  });
  await persistTrace(trace);

  const evidence: EvidenceRecord = buildEvidence({
    type: 'intelligence_report',
    taskId,
    summary: `Intelligence report "${args.title}" (${report.sections.length} sections, ${report.mode})`,
    data: { reportId: report.reportId, mode: report.mode },
  });
  report.evidenceIds = [...report.evidenceIds, evidence.evidenceId];
  await globalCollection<IntelligenceReport>(COLLECTIONS.INTELLIGENCE_REPORTS).insertOne(report);
  await globalCollection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertOne(evidence);

  await finishAgentRun(runId, { status: 'succeeded', summary: `Report ready (${report.mode}).` });
  await args.publish({
    type: EVENT_TYPES.REPORT_GENERATED,
    taskId,
    payload: { reportId: report.reportId, mode: report.mode, message: `Intelligence report generated (${report.mode})` },
  });

  return {
    taskId: taskId ?? 'adhoc',
    accepted: true,
    agentRunId: runId,
    report: {
      reportId: report.reportId,
      title: report.title,
      headline: report.headline,
      mode: report.mode,
      sections: report.sections,
      highlights: report.highlights,
      evidenceId: evidence.evidenceId,
    },
  };
}

export type TaskDoc = {
  documentId: string;
  slug: string;
  title: string;
  category: string;
  body: string;
  summary: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export async function recordTaskDocumentation(args: {
  taskId: string;
  goal: string;
  summary: string;
  infrastructureRequestId?: unknown;
  docs?: Collection<TaskDoc>;
  publish: Publish;
}): Promise<{ taskId: string; accepted: true; updated: string[]; versions: number[] }> {
  const docs = args.docs ?? globalCollection<TaskDoc>(COLLECTIONS.DOCUMENTS);
  const v1 = await appendLog(docs, 'phase-log', 'Phase Log', `Task ${args.taskId}: ${args.summary}`);
  const v2 = await appendLog(
    docs,
    'decision-log',
    'Decision Log',
    `Task ${args.taskId} ran the standard pipeline${args.infrastructureRequestId ? `; infra request ${String(args.infrastructureRequestId)} created (awaiting approval)` : ''}.`,
  );
  const serviceSlug = `task-${args.taskId}`;
  const v3 = await upsertTaskDoc(docs, {
    slug: serviceSlug,
    title: `Task ${args.taskId}`,
    category: 'task',
    body: `# Task ${args.taskId}\n\nGoal: ${args.goal}\n\nOutcome: pipeline executed (architect, builder, devops, documentation, memory).`,
    summary: args.goal,
  });
  for (const slug of ['phase-log', 'decision-log', serviceSlug]) {
    await args.publish({ type: EVENT_TYPES.DOC_UPDATED, taskId: args.taskId, payload: { slug, message: `Documentation updated: ${slug}` } });
  }
  return { taskId: args.taskId, accepted: true, updated: ['phase-log', 'decision-log', serviceSlug], versions: [v1, v2, v3] };
}

async function upsertTaskDoc(
  docs: Collection<TaskDoc>,
  d: { slug: string; title: string; category: string; body: string; summary?: string },
): Promise<number> {
  const now = nowIso();
  const existing = await docs.findOne({ slug: d.slug });
  const version = (existing?.version ?? 0) + 1;
  await docs.updateOne(
    { slug: d.slug },
    {
      $set: { title: d.title, category: d.category, body: d.body, summary: d.summary ?? '', version, updatedAt: now },
      $setOnInsert: { documentId: genId('doc'), slug: d.slug, createdAt: now },
    },
    { upsert: true },
  );
  return version;
}

async function appendLog(docs: Collection<TaskDoc>, slug: string, title: string, entry: string): Promise<number> {
  const existing = await docs.findOne({ slug });
  const body = `${existing?.body ?? `# ${title}\n`}\n- ${nowIso()} — ${entry}`;
  return upsertTaskDoc(docs, { slug, title, category: 'log', body, summary: `Most recent: ${entry}` });
}
