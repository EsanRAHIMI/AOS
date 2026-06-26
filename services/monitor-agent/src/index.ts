/**
 * Monitor Agent — entry point (Phase 5).
 *
 * Runs live activation checks and periodic health scans. Wires the testable
 * activation/repair logic in ./activation.ts to the standard factory task
 * surface plus a background scan loop.
 */
import {
  loadEnv,
  BaseEnvSchema,
  MongoEnvSchema,
  connectMongo,
  collection,
  COLLECTIONS,
  peerUrl,
  genId,
  startAgentRun,
  finishAgentRun,
  type ServiceActivation,
  type Incident,
  type RepairTask,
  type MonitorRun,
  type EvidenceRecord,
} from '@factory/shared';
import { createFactoryService, type TaskHandler, type ServiceContext } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';
import { runServiceActivation, runMonitorScan } from './activation.js';
import { diagnoseIncident, planRepair, executeRepair } from './repair.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema));
const INTERVAL = Number(process.env.MONITOR_INTERVAL_MS ?? 60000);

const handleTask: TaskHandler = async (req, ctx: ServiceContext) => {
  const taskId = req.taskId ?? genId('task');
  const input = (req.input ?? {}) as Record<string, unknown>;
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId });
  const publish = (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => ctx.publisher.publish(e);

  if (input.action === 'activate_service') {
    const serviceName = String(input.serviceName);
    const capabilityId = String(input.capability ?? 'unknown');
    const resolved = await ctx.registry.resolve(serviceName).catch(() => null);
    const baseUrl = String(input.baseUrl ?? resolved?.domain ?? peerUrl(serviceName));
    const registered = input.registered !== undefined ? Boolean(input.registered) : Boolean(resolved);

    const outcome = await runServiceActivation({ taskId, serviceName, capabilityId, baseUrl, registered, internalToken: env.FACTORY_INTERNAL_TOKEN, publish });
    await finishAgentRun(runId, { status: 'succeeded', summary: `Activation ${outcome.activation.passed ? 'passed' : 'failed'} for ${serviceName}` });
    return {
      taskId, accepted: true, agentRunId: runId,
      activation: { activationId: outcome.activation.activationId, passed: outcome.activation.passed, promotedToActive: outcome.activation.promotedToActive },
      incidentId: outcome.incidentId ?? null, repairTaskId: outcome.repairTaskId ?? null,
    };
  }

  if (input.action === 'diagnose_incident') {
    const dx = await diagnoseIncident({ incidentId: String(input.incidentId), publish });
    await finishAgentRun(runId, { status: dx ? 'succeeded' : 'failed', summary: dx ? `Diagnosed ${dx.serviceName}` : 'incident not found' });
    return { taskId, accepted: Boolean(dx), agentRunId: runId, diagnosis: dx ? { diagnosisId: dx.diagnosisId, confidence: dx.confidence, topCause: dx.suspectedCauses[0]?.cause } : null };
  }
  if (input.action === 'plan_repair') {
    const plan = await planRepair({ diagnosisId: String(input.diagnosisId), publish });
    await finishAgentRun(runId, { status: plan ? 'succeeded' : 'failed', summary: plan ? `Planned ${plan.planType}` : 'diagnosis not found' });
    return { taskId, accepted: Boolean(plan), agentRunId: runId, plan: plan ? { repairPlanId: plan.repairPlanId, planType: plan.planType, requiresHumanAction: plan.requiresHumanAction } : null };
  }
  if (input.action === 'execute_repair') {
    const out = await executeRepair({ repairPlanId: String(input.repairPlanId), baseUrl: input.baseUrl ? String(input.baseUrl) : undefined, registered: input.registered === undefined ? undefined : Boolean(input.registered), internalToken: env.FACTORY_INTERNAL_TOKEN, publish });
    await finishAgentRun(runId, { status: out ? 'succeeded' : 'failed', summary: out ? `Repair ${out.resolved ? 'resolved' : 'still failing'}` : 'plan not found' });
    return { taskId, accepted: Boolean(out), agentRunId: runId, repair: out };
  }

  // Default / monitor_scan
  const run = await runMonitorScan({ internalToken: env.FACTORY_INTERNAL_TOKEN, registryUrl: env.SERVICE_REGISTRY_URL, publish });
  await finishAgentRun(runId, { status: 'succeeded', summary: `Scan: ${run.healthyCount} healthy / ${run.unhealthyCount} unhealthy` });
  return { taskId, accepted: true, agentRunId: runId, monitorRunId: run.monitorRunId, healthy: run.healthyCount, unhealthy: run.unhealthyCount };
};

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  await collection<ServiceActivation>(COLLECTIONS.SERVICE_ACTIVATIONS).createIndex({ activationId: 1 }, { unique: true });
  await collection<Incident>(COLLECTIONS.INCIDENTS).createIndex({ incidentId: 1 }, { unique: true });
  await collection<RepairTask>(COLLECTIONS.REPAIR_TASKS).createIndex({ repairTaskId: 1 }, { unique: true });
  await collection<MonitorRun>(COLLECTIONS.MONITOR_RUNS).createIndex({ createdAt: -1 });
  await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).createIndex({ evidenceId: 1 }, { unique: true });
  await collection(COLLECTIONS.REPAIR_DIAGNOSES).createIndex({ diagnosisId: 1 }, { unique: true });
  await collection(COLLECTIONS.REPAIR_PLANS).createIndex({ repairPlanId: 1 }, { unique: true });

  const service = await createFactoryService({
    manifest,
    port: env.SERVICE_PORT,
    internalToken: env.FACTORY_INTERNAL_TOKEN,
    adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL,
    eventBusUrl: env.EVENT_BUS_URL,
    logLevel: env.LOG_LEVEL,
    taskHandler: handleTask,
  });
  await service.listen();

  // Background health scan loop (disabled when MONITOR_INTERVAL_MS=0).
  if (INTERVAL > 0 && env.SERVICE_REGISTRY_URL) {
    setInterval(() => {
      void runMonitorScan({ internalToken: env.FACTORY_INTERNAL_TOKEN, registryUrl: env.SERVICE_REGISTRY_URL, publish: (e) => service.ctx.publisher.publish(e) }).catch((err) =>
        service.ctx.log.warn({ err }, 'monitor scan failed'),
      );
    }, INTERVAL).unref();
  }
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
