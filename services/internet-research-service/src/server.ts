/**
 * Internet Research Service — service construction (K1 Consolidation Prep
 * Batch 2A, D-172).
 *
 * Split out from index.ts, same pattern as architect-agent's server.ts/
 * index.ts split (D-168): builds the exact service (manifest, task handler,
 * standard endpoints) without listening on a real port or requiring a real
 * Mongo connection, so characterization tests can exercise it in-process via
 * app.inject() + an injected test Db. No behavior change from the original
 * single-file version — including the original's exact quirk of reading
 * `TAVILY_API_KEY` from raw `process.env` (not the typed `ResearchEnvSchema`
 * merge) via `webSearchProviderFromEnv(process.env)` at module load time.
 */
import {
  collection, COLLECTIONS, EVENT_TYPES,
  startAgentRun, finishAgentRun, llmRouterFromEnv, buildLlmCostRecord, buildEvidence, runResearch, webSearchProviderFromEnv,
  type LlmTrace, type ResearchRun, type ResearchSource, type ResearchReport, type LlmCostRecord, type EvidenceRecord,
} from '@factory/shared';
import { createFactoryService, type FactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

export { manifest };

// Phase AG — real web search, when TAVILY_API_KEY is configured. Built once
// at module load (stateless, holds only the API key) and reused across
// requests — unchanged from the original single-file version.
const searchProvider = webSearchProviderFromEnv(process.env);

export const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? null;
  const input = (req.input ?? {}) as { topic?: string; forceFallback?: boolean };
  const topic = (input.topic ?? req.goal ?? '').trim();
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId: taskId ?? 'adhoc' });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: `Researching: ${topic} (read-only)${searchProvider ? ' — live web search' : ''}` } });

  const router = llmRouterFromEnv();
  const { run, sources, report, trace } = await runResearch(topic, { router, taskId, forceFallback: input.forceFallback, searchProvider });

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

  await finishAgentRun(runId, { status: 'succeeded', summary: `Research complete (${report.mode}, sources: ${report.sourceMode}, synthesis: ${report.synthesisMode}); ${sources.length} sources.` });
  await ctx.publisher.publish({ type: EVENT_TYPES.RESEARCH_COMPLETED_V2, taskId, payload: { reportId: report.reportId, sourceCount: sources.length, mode: report.mode, sourceMode: report.sourceMode, synthesisMode: report.synthesisMode, message: `Research report ready (${report.mode}, sources: ${report.sourceMode}, synthesis: ${report.synthesisMode})` } });

  return {
    taskId: taskId ?? 'adhoc', accepted: true, agentRunId: runId,
    research: {
      reportId: report.reportId, runId: run.runId, mode: report.mode, sourceMode: report.sourceMode,
      synthesisMode: report.synthesisMode, synthesisFailureReason: report.synthesisFailureReason,
      sourceCount: sources.length, evidenceId: evidence.evidenceId, summary: report.summary,
      findings: report.findings, recommendations: report.recommendations,
      sources: sources.map((s) => ({ title: s.title, url: s.url, reliability: s.reliability, sourceMode: s.sourceMode })),
    },
  };
};

export interface InternetResearchServiceEnv {
  SERVICE_PORT: number;
  FACTORY_INTERNAL_TOKEN: string;
  FACTORY_ADMIN_TOKEN?: string;
  SERVICE_REGISTRY_URL?: string;
  EVENT_BUS_URL?: string;
  LOG_LEVEL?: string;
}

export async function buildInternetResearchServiceService(env: InternetResearchServiceEnv): Promise<FactoryService> {
  return createFactoryService({
    manifest, port: env.SERVICE_PORT, internalToken: env.FACTORY_INTERNAL_TOKEN, adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL, eventBusUrl: env.EVENT_BUS_URL, logLevel: env.LOG_LEVEL, taskHandler: handleTask,
  });
}
