/**
 * Internet Research Service (Phase 13) — governed, read-only research.
 *
 * Produces an evidence-backed research report with cited, reliability-scored
 * sources. Reasons through the LLM router (schema-validated) with a curated
 * deterministic fallback that is clearly marked. No mutation actions; external
 * browsing intent is logged via the agent run + event.
 */
import {
  loadEnv, BaseEnvSchema, MongoEnvSchema, LlmEnvSchema, connectMongo, collection, COLLECTIONS, EVENT_TYPES,
  startAgentRun, finishAgentRun, llmRouterFromEnv, buildLlmCostRecord, buildEvidence, runResearch,
  type LlmTrace, type ResearchRun, type ResearchSource, type ResearchReport, type LlmCostRecord, type EvidenceRecord,
} from '@factory/shared';
import { createFactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema));

const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? null;
  const input = (req.input ?? {}) as { topic?: string; forceFallback?: boolean };
  const topic = (input.topic ?? req.goal ?? '').trim();
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId: taskId ?? 'adhoc' });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: `Researching: ${topic} (read-only)` } });

  const router = llmRouterFromEnv();
  const { run, sources, report, trace } = await runResearch(topic, { router, taskId, forceFallback: input.forceFallback });

  // Persist trace + cost (real or fallback — always tracked).
  await collection<LlmTrace>(COLLECTIONS.LLM_TRACES).insertOne(trace);
  await collection<LlmCostRecord>(COLLECTIONS.LLM_COST_RECORDS).insertOne(buildLlmCostRecord(trace));

  // Evidence: the research is itself proof; sources are cited.
  const evidence: EvidenceRecord = buildEvidence({
    type: 'research_report', taskId,
    summary: `Research "${topic}" — ${report.mode}, ${sources.length} sources, ${report.findings.length} findings`,
    data: { reportId: report.reportId, runId: run.runId, sourceCount: sources.length, mode: report.mode },
  });
  report.evidenceId = evidence.evidenceId;

  // Store run, sources, report, evidence.
  await collection<ResearchRun>(COLLECTIONS.RESEARCH_RUNS).insertOne(run);
  if (sources.length) await collection<ResearchSource>(COLLECTIONS.RESEARCH_SOURCES).insertMany(sources);
  await collection<ResearchReport>(COLLECTIONS.RESEARCH_REPORTS).insertOne(report);
  await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertOne(evidence);

  await finishAgentRun(runId, { status: 'succeeded', summary: `Research complete (${report.mode}); ${sources.length} sources.` });
  await ctx.publisher.publish({ type: EVENT_TYPES.RESEARCH_COMPLETED_V2, taskId, payload: { reportId: report.reportId, sourceCount: sources.length, mode: report.mode, message: `Research report ready (${report.mode})` } });

  return { taskId: taskId ?? 'adhoc', accepted: true, agentRunId: runId, research: { reportId: report.reportId, runId: run.runId, mode: report.mode, sourceCount: sources.length, evidenceId: evidence.evidenceId, summary: report.summary, findings: report.findings, recommendations: report.recommendations, sources: sources.map((s) => ({ title: s.title, url: s.url, reliability: s.reliability })) } };
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
