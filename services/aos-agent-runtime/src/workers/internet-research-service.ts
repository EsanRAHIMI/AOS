/**
 * Internet Research Service worker (K1 Consolidation Prep Batch 2A, D-172).
 *
 * Deliberately duplicated from
 * services/internet-research-service/src/server.ts, not imported — every
 * service in this repo is independently deployable/buildable and none
 * imports another service's source (see docs/development-rules.md). This
 * copy and the original are kept behaviorally identical by
 * services/aos-agent-runtime/test/characterization.consolidated.batch2a.test.ts,
 * which re-runs internet-research-service's own baseline characterization
 * assertions against THIS build. If you change one, change both and re-run
 * both suites.
 *
 * serviceId and port are hardcoded here (not read from any shared/generic
 * env var) so this worker keeps its historical identity/domain/port no
 * matter what SERVICE_ID/SERVICE_PORT the hosting aos-agent-runtime process
 * itself was started with — see index.ts's top comment.
 *
 * Read-only outbound network dependency (D-170/D-172): this worker's
 * `runResearch()` call may perform a real, read-only Tavily web-search API
 * request when `TAVILY_API_KEY` is set — same risk class already accepted
 * for the LLM router calls in the 4 workers built in D-168. No filesystem
 * write, no write-capable external API, no spawned OS process.
 */
import {
  collection, COLLECTIONS, EVENT_TYPES, startAgentRun, finishAgentRun, llmRouterFromEnv, buildLlmCostRecord,
  buildEvidence, runResearch, webSearchProviderFromEnv,
  SERVICE_PORTS, SERVICE_SUBDOMAINS, SERVICE_VERSION,
  type LlmTrace, type ResearchRun, type ResearchSource, type ResearchReport, type LlmCostRecord, type EvidenceRecord,
  type ServiceManifest,
} from '@factory/shared';
import { createFactoryService, type FactoryService, type TaskHandler } from '@factory/service-kit';

export const manifest: ServiceManifest = {
  serviceId: 'internet-research-service',
  serviceName: 'Internet Research Service',
  serviceType: 'integration',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['internet-research-service']}`,
  healthEndpoint: '/health',
  capabilities: ['web_research', 'source_extraction', 'citation_capture', 'freshness_check', 'reliability_scoring', 'summary_generation'],
  dependencies: ['gateway-api', 'event-bus-service', 'service-registry'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
};

// Built once at module load (stateless, holds only the API key) — unchanged
// from the original single-file version's exact quirk of reading
// TAVILY_API_KEY from raw process.env, not a typed env merge.
const searchProvider = webSearchProviderFromEnv(process.env);

export const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? null;
  const input = (req.input ?? {}) as { topic?: string; forceFallback?: boolean };
  const topic = (input.topic ?? req.goal ?? '').trim();
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId: taskId ?? 'adhoc' });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: `Researching: ${topic} (read-only)${searchProvider ? ' — live web search' : ''}` } });

  const router = llmRouterFromEnv();
  const { run, sources, report, trace } = await runResearch(topic, { router, taskId, forceFallback: input.forceFallback, searchProvider });

  await collection<LlmTrace>(COLLECTIONS.LLM_TRACES).insertOne(trace);
  await collection<LlmCostRecord>(COLLECTIONS.LLM_COST_RECORDS).insertOne(buildLlmCostRecord(trace));

  const evidence: EvidenceRecord = buildEvidence({
    type: 'research_report', taskId,
    summary: `Research "${topic}" — ${report.mode}, ${sources.length} sources, ${report.findings.length} findings`,
    data: { reportId: report.reportId, runId: run.runId, sourceCount: sources.length, mode: report.mode },
  });
  report.evidenceId = evidence.evidenceId;

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

export interface WorkerEnv {
  FACTORY_INTERNAL_TOKEN: string;
  FACTORY_ADMIN_TOKEN?: string;
  SERVICE_REGISTRY_URL?: string;
  EVENT_BUS_URL?: string;
  LOG_LEVEL?: string;
}

export async function buildInternetResearchServiceWorker(env: WorkerEnv): Promise<FactoryService> {
  return createFactoryService({
    manifest, port: SERVICE_PORTS['internet-research-service'], internalToken: env.FACTORY_INTERNAL_TOKEN, adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL, eventBusUrl: env.EVENT_BUS_URL, logLevel: env.LOG_LEVEL, taskHandler: handleTask,
    registerSignalHandlers: false,
  });
}
