/**
 * Report Agent (Phase 13) — executive/system intelligence reports.
 *
 * Synthesizes provided inputs (research, plan, review, QA, costs, system state)
 * into a structured intelligence report (schema-validated LLM reasoning +
 * deterministic fallback). Grounded only in supplied data — never invents
 * metrics or exposes secrets. Produces evidence-backed reports.
 */
import {
  loadEnv, BaseEnvSchema, MongoEnvSchema, LlmEnvSchema, connectMongo, collection, COLLECTIONS, EVENT_TYPES,
  startAgentRun, finishAgentRun, llmRouterFromEnv, buildLlmCostRecord, buildEvidence, runReport,
  type LlmTrace, type IntelligenceReport, type LlmCostRecord, type EvidenceRecord,
} from '@factory/shared';
import { createFactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema));

const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? null;
  const input = (req.input ?? {}) as { title?: string; kind?: IntelligenceReport['kind']; inputs?: Record<string, unknown>; evidenceIds?: string[]; forceFallback?: boolean };
  const title = input.title ?? `Report: ${req.goal ?? 'system'}`;
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId: taskId ?? 'adhoc' });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: `Writing report: ${title}` } });

  const router = llmRouterFromEnv();
  const { report, trace } = await runReport({ router, taskId, title, kind: input.kind, inputs: input.inputs ?? { goal: req.goal }, evidenceIds: input.evidenceIds, forceFallback: input.forceFallback });

  await collection<LlmTrace>(COLLECTIONS.LLM_TRACES).insertOne(trace);
  await collection<LlmCostRecord>(COLLECTIONS.LLM_COST_RECORDS).insertOne(buildLlmCostRecord(trace));

  const evidence: EvidenceRecord = buildEvidence({
    type: 'intelligence_report', taskId,
    summary: `Intelligence report "${title}" (${report.sections.length} sections, ${report.mode})`,
    data: { reportId: report.reportId, mode: report.mode },
  });
  report.evidenceIds = [...report.evidenceIds, evidence.evidenceId];

  await collection<IntelligenceReport>(COLLECTIONS.INTELLIGENCE_REPORTS).insertOne(report);
  await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertOne(evidence);

  await finishAgentRun(runId, { status: 'succeeded', summary: `Report ready (${report.mode}).` });
  await ctx.publisher.publish({ type: EVENT_TYPES.REPORT_GENERATED, taskId, payload: { reportId: report.reportId, mode: report.mode, message: `Intelligence report generated (${report.mode})` } });

  return { taskId: taskId ?? 'adhoc', accepted: true, agentRunId: runId, report: { reportId: report.reportId, title: report.title, headline: report.headline, mode: report.mode, sections: report.sections, highlights: report.highlights, evidenceId: evidence.evidenceId } };
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
