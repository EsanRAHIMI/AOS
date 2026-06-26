/**
 * Monitor activation + repair logic (kept out of index.ts so it is unit-testable
 * without booting the service). Runs the live activation engine, promotes the
 * capability on success, and opens an incident + proposes a repair on failure.
 */
import {
  collection,
  COLLECTIONS,
  EVENT_TYPES,
  INTERNAL_TOKEN_HEADER,
  checkLiveService,
  buildEvidence,
  genId,
  nowIso,
  type Capability,
  type ServiceActivation,
  type Incident,
  type RepairTask,
  type MonitorRun,
  type ServiceHealth,
  type EvidenceRecord,
} from '@factory/shared';

type Publish = (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => Promise<boolean>;

export interface RepairLoopArgs {
  serviceName: string;
  capabilityId: string | null;
  taskId: string | null;
  title: string;
  detail: string;
  source: 'activation' | 'monitor';
  evidenceIds?: string[];
  publish: Publish;
}

/** Open an incident and propose a repair task (the repair loop). */
export async function createRepairLoop(args: RepairLoopArgs): Promise<{ incidentId: string; repairTaskId: string }> {
  const now = nowIso();
  const incident: Incident = {
    incidentId: genId('inc'),
    serviceName: args.serviceName,
    capabilityId: args.capabilityId,
    taskId: args.taskId,
    title: args.title,
    detail: args.detail,
    severity: 'high',
    status: 'repair_proposed',
    source: args.source,
    evidenceIds: args.evidenceIds ?? [],
    repairTaskId: null,
    createdAt: now,
    updatedAt: now,
  };
  await collection<Incident>(COLLECTIONS.INCIDENTS).insertOne(incident);
  await args.publish({ type: EVENT_TYPES.INCIDENT_CREATED, taskId: args.taskId, payload: { incidentId: incident.incidentId, serviceName: args.serviceName, message: `Incident: ${args.title}`, level: 'warn' } });

  const repair: RepairTask = {
    repairTaskId: genId('rep'),
    incidentId: incident.incidentId,
    serviceName: args.serviceName,
    capabilityId: args.capabilityId,
    diagnosis: args.detail,
    proposedFix: `Verify the Dokploy app for ${args.serviceName} is deployed, reachable, and its env (MONGODB_URI, FACTORY_INTERNAL_TOKEN) is set, then re-run the activation check.`,
    recommendedAction: 'redeploy',
    diagnosisId: null,
    repairPlanId: null,
    attempts: 0,
    requiresApproval: true,
    status: 'proposed',
    createdAt: now,
    updatedAt: now,
  };
  await collection<RepairTask>(COLLECTIONS.REPAIR_TASKS).insertOne(repair);
  await collection<Incident>(COLLECTIONS.INCIDENTS).updateOne({ incidentId: incident.incidentId }, { $set: { repairTaskId: repair.repairTaskId, updatedAt: nowIso() } });
  await args.publish({ type: EVENT_TYPES.REPAIR_TASK_CREATED, taskId: args.taskId, payload: { repairTaskId: repair.repairTaskId, incidentId: incident.incidentId, message: `Repair proposed for ${args.serviceName}` } });

  return { incidentId: incident.incidentId, repairTaskId: repair.repairTaskId };
}

export interface ActivationArgs {
  taskId: string | null;
  serviceName: string;
  capabilityId: string;
  baseUrl: string;
  registered: boolean;
  internalToken: string;
  publish: Publish;
}

export interface ActivationOutcome {
  activation: ServiceActivation;
  promoted: boolean;
  incidentId?: string;
  repairTaskId?: string;
}

/** Run the live activation engine and apply promotion / repair logic. */
export async function runServiceActivation(args: ActivationArgs): Promise<ActivationOutcome> {
  await args.publish({ type: EVENT_TYPES.ACTIVATION_STARTED, taskId: args.taskId, payload: { serviceName: args.serviceName, baseUrl: args.baseUrl, message: `Activation check: ${args.serviceName}` } });

  const { activation, evidence } = await checkLiveService({
    baseUrl: args.baseUrl,
    serviceName: args.serviceName,
    capabilityId: args.capabilityId,
    expectedCapability: args.capabilityId,
    internalToken: args.internalToken,
    registered: args.registered,
    taskId: args.taskId,
  });

  const records = evidence.map((d) => buildEvidence({ ...d, taskId: args.taskId, capabilityId: args.capabilityId, serviceName: args.serviceName }));
  if (records.length) await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertMany(records);
  for (const e of records) await args.publish({ type: EVENT_TYPES.EVIDENCE_RECORDED, taskId: args.taskId, payload: { evidenceId: e.evidenceId, evidenceType: e.type, message: e.summary } });
  activation.evidenceIds = records.map((e) => e.evidenceId);

  if (activation.passed) {
    const now = nowIso();
    await collection<Capability>(COLLECTIONS.CAPABILITIES).updateOne(
      { capabilityId: args.capabilityId },
      { $set: { status: 'active', supportedByServices: [args.serviceName], lastUsedAt: now, updatedAt: now } },
    );
    activation.promotedToActive = true;
    activation.status = 'passed';
    await collection<ServiceActivation>(COLLECTIONS.SERVICE_ACTIVATIONS).insertOne(activation);
    await args.publish({ type: EVENT_TYPES.CAPABILITY_ACTIVATED, taskId: args.taskId, payload: { capability: args.capabilityId, serviceName: args.serviceName, message: `Capability ACTIVE: ${args.capabilityId}` } });
    await args.publish({ type: EVENT_TYPES.ACTIVATION_COMPLETED, taskId: args.taskId, payload: { activationId: activation.activationId, passed: true, message: `Activation passed — ${args.serviceName} is live` } });
    return { activation, promoted: true };
  }

  // Failure → incident + repair, capability stays validated.
  const failingChecks = activation.checks.filter((c) => !c.passed).map((c) => c.name).join(', ');
  const { incidentId, repairTaskId } = await createRepairLoop({
    serviceName: args.serviceName,
    capabilityId: args.capabilityId,
    taskId: args.taskId,
    title: `${args.serviceName} not live`,
    detail: `Activation failed: ${failingChecks}. Target ${args.baseUrl}.`,
    source: 'activation',
    evidenceIds: activation.evidenceIds,
    publish: args.publish,
  });
  activation.incidentId = incidentId;
  await collection<ServiceActivation>(COLLECTIONS.SERVICE_ACTIVATIONS).insertOne(activation);
  await args.publish({ type: EVENT_TYPES.ACTIVATION_COMPLETED, taskId: args.taskId, payload: { activationId: activation.activationId, passed: false, incidentId, message: `Activation failed — incident opened for ${args.serviceName}`, level: 'warn' } });
  return { activation, promoted: false, incidentId, repairTaskId };
}

export interface ScanArgs {
  internalToken: string;
  registryUrl: string;
  publish: Publish;
}

/** One health scan across all registered services. */
export async function runMonitorScan(args: ScanArgs): Promise<MonitorRun> {
  let services: Array<{ serviceId: string; domain: string }> = [];
  try {
    const res = await fetch(`${args.registryUrl}/services`, { headers: { [INTERNAL_TOKEN_HEADER]: args.internalToken } });
    const body = (await res.json()) as { data?: Array<{ serviceId: string; domain: string }> };
    services = body.data ?? [];
  } catch {
    services = [];
  }

  const healths: ServiceHealth[] = [];
  for (const s of services) {
    const start = Date.now();
    let healthy = false;
    let httpStatus: number | null = null;
    let error: string | null = null;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 6000);
      const r = await fetch(`${s.domain}/health`, { signal: controller.signal });
      clearTimeout(t);
      httpStatus = r.status;
      healthy = r.ok;
    } catch (e) {
      error = e instanceof Error ? e.message : 'unreachable';
    }
    healths.push({ serviceName: s.serviceId, domain: s.domain, healthy, httpStatus, latencyMs: Date.now() - start, error });
  }

  const incidentIds: string[] = [];
  for (const h of healths.filter((x) => !x.healthy)) {
    const open = await collection<Incident>(COLLECTIONS.INCIDENTS).findOne({ serviceName: h.serviceName, status: { $ne: 'resolved' } as never });
    if (!open) {
      const { incidentId } = await createRepairLoop({ serviceName: h.serviceName, capabilityId: null, taskId: null, title: `${h.serviceName} unhealthy`, detail: `Health check failed (${h.error ?? h.httpStatus}).`, source: 'monitor', publish: args.publish });
      incidentIds.push(incidentId);
    }
  }

  const run: MonitorRun = {
    monitorRunId: genId('mon'),
    scope: 'all',
    services: healths,
    healthyCount: healths.filter((h) => h.healthy).length,
    unhealthyCount: healths.filter((h) => !h.healthy).length,
    incidentIds,
    createdAt: nowIso(),
  };
  await collection<MonitorRun>(COLLECTIONS.MONITOR_RUNS).insertOne(run);
  await args.publish({ type: EVENT_TYPES.MONITOR_RUN, taskId: null, payload: { monitorRunId: run.monitorRunId, healthy: run.healthyCount, unhealthy: run.unhealthyCount, message: `Monitor scan: ${run.healthyCount} healthy, ${run.unhealthyCount} unhealthy` } });
  return run;
}
