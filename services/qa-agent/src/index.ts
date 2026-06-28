/**
 * QA Agent (Phase 13) — acceptance verification.
 *
 * Derives acceptance criteria from the goal and checks each against the produced
 * evidence (schema-validated LLM reasoning + deterministic fallback). Never
 * rubber-stamps: no pass without supporting evidence. Produces evidence-backed
 * QA reports and is allowed to fail.
 */
import {
  loadEnv, BaseEnvSchema, MongoEnvSchema, LlmEnvSchema, connectMongo, collection, COLLECTIONS, EVENT_TYPES,
  startAgentRun, finishAgentRun, llmRouterFromEnv, buildLlmCostRecord, buildEvidence, runQa,
  type LlmTrace, type QaReport, type LlmCostRecord, type EvidenceRecord,
} from '@factory/shared';
import { createFactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema));

const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? null;
  const input = (req.input ?? {}) as { goal?: string; evidenceSummary?: string; evidenceIds?: string[]; forceFallback?: boolean };
  const goal = input.goal ?? req.goal ?? '';
  const evidenceSummary = input.evidenceSummary ?? '';
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId: taskId ?? 'adhoc' });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: 'QA verifying acceptance criteria' } });

  const router = llmRouterFromEnv();
  const { report, trace } = await runQa({ router, taskId, goal, evidenceSummary, evidenceIds: input.evidenceIds, forceFallback: input.forceFallback });

  await collection<LlmTrace>(COLLECTIONS.LLM_TRACES).insertOne(trace);
  await collection<LlmCostRecord>(COLLECTIONS.LLM_COST_RECORDS).insertOne(buildLlmCostRecord(trace));

  const evidence: EvidenceRecord = buildEvidence({
    type: 'qa_report', taskId,
    summary: `QA ${report.passed ? 'PASSED' : 'FAILED'}: ${report.criteria.filter((c) => c.met).length}/${report.criteria.length} criteria (${report.mode})`,
    data: { qaId: report.qaId, passed: report.passed, mode: report.mode },
  });
  report.evidenceIds = [...report.evidenceIds, evidence.evidenceId];

  await collection<QaReport>(COLLECTIONS.QA_REPORTS).insertOne(report);
  await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertOne(evidence);

  await finishAgentRun(runId, { status: 'succeeded', summary: `QA ${report.passed ? 'passed' : 'failed'} (${report.mode}).` });
  await ctx.publisher.publish({ type: EVENT_TYPES.QA_COMPLETED, taskId, payload: { qaId: report.qaId, passed: report.passed, mode: report.mode, level: report.passed ? 'success' : 'warn', message: `QA ${report.passed ? 'passed' : 'failed'}` } });

  return { taskId: taskId ?? 'adhoc', accepted: true, agentRunId: runId, qa: { qaId: report.qaId, passed: report.passed, mode: report.mode, criteria: report.criteria, gaps: report.gaps, verdict: report.verdict, evidenceId: evidence.evidenceId } };
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
