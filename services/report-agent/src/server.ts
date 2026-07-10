/**
 * Report Agent — service construction (K1 Consolidation Prep, D-168).
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
  startAgentRun, finishAgentRun, llmRouterFromEnv, buildLlmCostRecord, buildEvidence, runReport,
  type LlmTrace, type IntelligenceReport, type LlmCostRecord, type EvidenceRecord,
} from '@factory/shared';
import { createFactoryService, type FactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

export { manifest };

export const handleTask: TaskHandler = async (req, ctx) => {
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

export interface ReportAgentEnv {
  SERVICE_PORT: number;
  FACTORY_INTERNAL_TOKEN: string;
  FACTORY_ADMIN_TOKEN?: string;
  SERVICE_REGISTRY_URL?: string;
  EVENT_BUS_URL?: string;
  LOG_LEVEL?: string;
}

export async function buildReportAgentService(env: ReportAgentEnv): Promise<FactoryService> {
  return createFactoryService({
    manifest, port: env.SERVICE_PORT, internalToken: env.FACTORY_INTERNAL_TOKEN, adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL, eventBusUrl: env.EVENT_BUS_URL, logLevel: env.LOG_LEVEL, taskHandler: handleTask,
  });
}
