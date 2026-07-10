/**
 * QA Agent worker (K1 Consolidation Prep, D-168).
 *
 * Deliberately duplicated from services/qa-agent/src/server.ts, not
 * imported — see the top comment in ./architect-agent.ts for why, and how
 * this copy is kept behaviorally identical to the original.
 */
import {
  collection, COLLECTIONS, EVENT_TYPES,
  startAgentRun, finishAgentRun, llmRouterFromEnv, buildLlmCostRecord, buildEvidence, runQa,
  SERVICE_PORTS, SERVICE_SUBDOMAINS, SERVICE_VERSION,
  type LlmTrace, type QaReport, type LlmCostRecord, type EvidenceRecord, type ServiceManifest,
} from '@factory/shared';
import { createFactoryService, type FactoryService, type TaskHandler } from '@factory/service-kit';

export const manifest: ServiceManifest = {
  serviceId: 'qa-agent',
  serviceName: 'QA Agent',
  serviceType: 'agent',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['qa-agent']}`,
  healthEndpoint: '/health',
  capabilities: ['verify_acceptance_criteria', 'check_evidence', 'compare_to_goal', 'qa_pass_fail'],
  dependencies: ['gateway-api', 'event-bus-service', 'service-registry'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
};

export const handleTask: TaskHandler = async (req, ctx) => {
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

export interface WorkerEnv {
  FACTORY_INTERNAL_TOKEN: string;
  FACTORY_ADMIN_TOKEN?: string;
  SERVICE_REGISTRY_URL?: string;
  EVENT_BUS_URL?: string;
  LOG_LEVEL?: string;
}

export async function buildQaWorker(env: WorkerEnv): Promise<FactoryService> {
  return createFactoryService({
    manifest, port: SERVICE_PORTS['qa-agent'], internalToken: env.FACTORY_INTERNAL_TOKEN, adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL, eventBusUrl: env.EVENT_BUS_URL, logLevel: env.LOG_LEVEL, taskHandler: handleTask,
    registerSignalHandlers: false,
  });
}
