/**
 * Reviewer Agent — service construction (K1 Consolidation Prep, D-168).
 *
 * Split out from index.ts, same pattern as gateway-api's server.ts/index.ts
 * split: this file builds the exact service (manifest, task handler,
 * standard endpoints) without listening on a real port or requiring a real
 * Mongo connection, so characterization tests can exercise it in-process via
 * app.inject() + an injected test Db. This is the baseline-behavior oracle
 * for the planned aos-agent-runtime consolidation — no behavior change from
 * the original single-file version.
 */
import {
  collection, COLLECTIONS, EVENT_TYPES,
  startAgentRun, finishAgentRun, llmRouterFromEnv, buildLlmCostRecord, buildEvidence, runReview,
  type LlmTrace, type ReviewReport, type LlmCostRecord, type EvidenceRecord,
} from '@factory/shared';
import { createFactoryService, type FactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

export { manifest };

export const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? null;
  const input = (req.input ?? {}) as { target?: string; content?: string; evidenceIds?: string[]; forceFallback?: boolean };
  const target = input.target ?? 'plan';
  const content = input.content ?? req.goal ?? '';
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId: taskId ?? 'adhoc' });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: `Reviewing ${target}` } });

  const router = llmRouterFromEnv();
  const { report, trace } = await runReview({ router, taskId, target, content, evidenceIds: input.evidenceIds, forceFallback: input.forceFallback });

  await collection<LlmTrace>(COLLECTIONS.LLM_TRACES).insertOne(trace);
  await collection<LlmCostRecord>(COLLECTIONS.LLM_COST_RECORDS).insertOne(buildLlmCostRecord(trace));

  const evidence: EvidenceRecord = buildEvidence({
    type: 'review_report', taskId,
    summary: `Review of ${target}: ${report.passed ? 'PASSED' : 'FAILED'} (${report.issues.length} issues, ${report.mode})`,
    data: { reviewId: report.reviewId, passed: report.passed, issueCount: report.issues.length, mode: report.mode },
  });
  report.evidenceIds = [...report.evidenceIds, evidence.evidenceId];

  await collection<ReviewReport>(COLLECTIONS.REVIEW_REPORTS).insertOne(report);
  await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertOne(evidence);

  await finishAgentRun(runId, { status: 'succeeded', summary: `Review ${report.passed ? 'passed' : 'failed'} (${report.mode}).` });
  await ctx.publisher.publish({ type: EVENT_TYPES.REVIEW_COMPLETED, taskId, payload: { reviewId: report.reviewId, passed: report.passed, mode: report.mode, level: report.passed ? 'success' : 'warn', message: `Review ${report.passed ? 'passed' : 'found issues'}` } });

  return { taskId: taskId ?? 'adhoc', accepted: true, agentRunId: runId, review: { reviewId: report.reviewId, passed: report.passed, mode: report.mode, issues: report.issues, risks: report.risks, requiredFixes: report.requiredFixes, recommendations: report.recommendations, evidenceId: evidence.evidenceId } };
};

export interface ReviewerAgentEnv {
  SERVICE_PORT: number;
  FACTORY_INTERNAL_TOKEN: string;
  FACTORY_ADMIN_TOKEN?: string;
  SERVICE_REGISTRY_URL?: string;
  EVENT_BUS_URL?: string;
  LOG_LEVEL?: string;
}

export async function buildReviewerAgentService(env: ReviewerAgentEnv): Promise<FactoryService> {
  return createFactoryService({
    manifest, port: env.SERVICE_PORT, internalToken: env.FACTORY_INTERNAL_TOKEN, adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL, eventBusUrl: env.EVENT_BUS_URL, logLevel: env.LOG_LEVEL, taskHandler: handleTask,
  });
}
