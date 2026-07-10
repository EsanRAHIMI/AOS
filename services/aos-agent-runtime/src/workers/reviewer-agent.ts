/**
 * Reviewer Agent worker (K1 Consolidation Prep, D-168).
 *
 * Deliberately duplicated from services/reviewer-agent/src/server.ts, not
 * imported — see the top comment in ./architect-agent.ts for why, and how
 * this copy is kept behaviorally identical to the original.
 */
import {
  collection, COLLECTIONS, EVENT_TYPES,
  startAgentRun, finishAgentRun, llmRouterFromEnv, buildLlmCostRecord, buildEvidence, runReview,
  SERVICE_PORTS, SERVICE_SUBDOMAINS, SERVICE_VERSION,
  type LlmTrace, type ReviewReport, type LlmCostRecord, type EvidenceRecord, type ServiceManifest,
} from '@factory/shared';
import { createFactoryService, type FactoryService, type TaskHandler } from '@factory/service-kit';

export const manifest: ServiceManifest = {
  serviceId: 'reviewer-agent',
  serviceName: 'Reviewer Agent',
  serviceType: 'agent',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['reviewer-agent']}`,
  healthEndpoint: '/health',
  capabilities: ['review_code', 'review_architecture', 'review_security', 'review_policy_compliance', 'review_acceptance'],
  dependencies: ['gateway-api', 'event-bus-service', 'service-registry'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
};

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

export interface WorkerEnv {
  FACTORY_INTERNAL_TOKEN: string;
  FACTORY_ADMIN_TOKEN?: string;
  SERVICE_REGISTRY_URL?: string;
  EVENT_BUS_URL?: string;
  LOG_LEVEL?: string;
}

export async function buildReviewerWorker(env: WorkerEnv): Promise<FactoryService> {
  return createFactoryService({
    manifest, port: SERVICE_PORTS['reviewer-agent'], internalToken: env.FACTORY_INTERNAL_TOKEN, adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL, eventBusUrl: env.EVENT_BUS_URL, logLevel: env.LOG_LEVEL, taskHandler: handleTask,
    registerSignalHandlers: false,
  });
}
