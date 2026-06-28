/**
 * Reviewer Agent (Phase 13) — independent review of plans/code/architecture.
 *
 * Reasons through the LLM router (schema-validated) into a structured review and
 * is allowed to FAIL the output. Deterministic checklist fallback is clearly
 * marked. Never mutates the thing it reviews; produces evidence-backed reports.
 */
import {
  loadEnv, BaseEnvSchema, MongoEnvSchema, LlmEnvSchema, connectMongo, collection, COLLECTIONS, EVENT_TYPES,
  startAgentRun, finishAgentRun, llmRouterFromEnv, buildLlmCostRecord, buildEvidence, runReview,
  type LlmTrace, type ReviewReport, type LlmCostRecord, type EvidenceRecord,
} from '@factory/shared';
import { createFactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema));

const handleTask: TaskHandler = async (req, ctx) => {
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

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  const service = await createFactoryService({
    manifest, port: env.SERVICE_PORT, internalToken: env.FACTORY_INTERNAL_TOKEN, adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL, eventBusUrl: env.EVENT_BUS_URL, logLevel: env.LOG_LEVEL, taskHandler: handleTask,
  });
  await service.listen();
}

main().catch((err) => { console.error('fatal startup error', err); process.exit(1); });
