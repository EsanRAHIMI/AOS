/**
 * Autonomous repair loop (Phase 6). Diagnoses an incident, plans the fix,
 * executes the safe/approved actions, re-runs the live activation check, and
 * resolves the incident only when real HTTP evidence proves the service healthy.
 * Sensitive actions are flagged; nothing is faked; incidents never close
 * without evidence.
 */
import { join } from 'node:path';
import {
  collection,
  COLLECTIONS,
  EVENT_TYPES,
  checkLiveService,
  diagnose,
  buildRepairPlan,
  buildEvidence,
  gitHubDeliveryFromEnv,
  genId,
  nowIso,
  type Capability,
  type Incident,
  type RepairTask,
  type RepairDiagnosis,
  type RepairPlan,
  type ServiceActivation,
  type EvidenceRecord,
  type Memory,
  type Skill,
} from '@factory/shared';

type Publish = (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => Promise<boolean>;
const REPO_SERVICES_ROOT = process.env.REPO_SERVICES_ROOT ?? join(process.cwd(), '..');
const STANDARD_FILES = ['package.json', 'src/index.ts', 'src/factory/manifest.ts'];

async function addEvidence(rec: EvidenceRecord, publish: Publish, taskId: string | null): Promise<string> {
  await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertOne(rec);
  await publish({ type: EVENT_TYPES.EVIDENCE_RECORDED, taskId, payload: { evidenceId: rec.evidenceId, evidenceType: rec.type, message: rec.summary } });
  return rec.evidenceId;
}

interface DocRecord { documentId: string; slug: string; title: string; category: string; body: string; summary: string; version: number; createdAt: string; updatedAt: string }

/** On a successful repair, persist memory + a reusable skill + a repair-log doc. */
async function recordRepairLearning(plan: RepairPlan, taskId: string | null, publish: Publish): Promise<void> {
  const now = nowIso();
  const memoryId = genId('mem');
  const memory: Memory = {
    memoryId, type: 'solution_memory',
    title: `Repaired ${plan.serviceName} (${plan.planType})`,
    summary: `Incident ${plan.incidentId} on ${plan.serviceName} resolved with a ${plan.planType} repair; re-activation passed and the capability became active.`,
    taskId, serviceId: 'monitor-agent', tags: ['repair', plan.planType, plan.serviceName], confidence: 'medium', createdAt: now,
  };
  await collection<Memory>(COLLECTIONS.MEMORIES).insertOne(memory);
  await publish({ type: EVENT_TYPES.MEMORY_WRITTEN, taskId, payload: { memoryId, message: `Repair memory stored` } });

  // Reusable skill: extract/reinforce "repair_service_activation".
  const skills = collection<Skill>(COLLECTIONS.SKILLS);
  const existing = await skills.findOne({ skillId: 'skill_repair_service_activation' });
  if (existing) {
    await skills.updateOne({ skillId: existing.skillId }, { $set: { lastUsedAt: now, updatedAt: now, successRate: Math.min(1, (existing.successRate + 1) / 2) }, $inc: { usageCount: 1 }, $push: { relatedMemories: memoryId } as never });
    await publish({ type: EVENT_TYPES.SKILL_UPDATED, taskId, payload: { skillId: existing.skillId, message: 'Repair skill reinforced' } });
  } else {
    const skill: Skill = {
      skillId: 'skill_repair_service_activation', title: 'Repair a failed service activation',
      description: 'Diagnose a failed activation, plan the fix (env/domain/code/registry), get approval, re-run the live activation check, and resolve only with evidence.',
      category: 'operations', triggerConditions: ['Service activation failed', 'Incident opened'],
      requiredCapabilities: ['health_monitoring', 'service_activation'], requiredServices: ['monitor-agent'],
      steps: ['Diagnose suspected causes', 'Build a repair plan', 'Get approval', 'Execute safe actions', 'Re-run activation', 'Resolve incident with evidence'],
      examples: [`Repaired ${plan.serviceName} via ${plan.planType}`], successRate: 1, usageCount: 1,
      relatedMemories: [memoryId], relatedDocs: ['repair-log'], confidence: 'medium', lastUsedAt: now, createdAt: now, updatedAt: now,
    };
    await skills.insertOne(skill);
    await publish({ type: EVENT_TYPES.SKILL_CREATED, taskId, payload: { skillId: skill.skillId, message: 'Repair skill created' } });
  }

  // Append to the repair-log document (automatic docs update).
  const docs = collection<DocRecord>(COLLECTIONS.DOCUMENTS);
  const existingDoc = await docs.findOne({ slug: 'repair-log' });
  const entry = `- ${now} — Resolved incident ${plan.incidentId} on ${plan.serviceName} via ${plan.planType}.`;
  const body = `${existingDoc?.body ?? '# Repair Log\n'}\n${entry}`;
  await docs.updateOne(
    { slug: 'repair-log' },
    { $set: { title: 'Repair Log', category: 'log', body, summary: `Most recent: repaired ${plan.serviceName}`, version: (existingDoc?.version ?? 0) + 1, updatedAt: now }, $setOnInsert: { documentId: genId('doc'), slug: 'repair-log', createdAt: now } },
    { upsert: true },
  );
  await publish({ type: EVENT_TYPES.DOC_UPDATED, taskId, payload: { slug: 'repair-log', message: 'Repair log updated' } });
}

/** Step 1 — analyze the failure into ranked suspected causes. */
export async function diagnoseIncident(args: { incidentId: string; publish: Publish }): Promise<RepairDiagnosis | null> {
  const incident = await collection<Incident>(COLLECTIONS.INCIDENTS).findOne({ incidentId: args.incidentId });
  if (!incident) return null;
  await collection<Incident>(COLLECTIONS.INCIDENTS).updateOne({ incidentId: incident.incidentId }, { $set: { status: 'diagnosing', updatedAt: nowIso() } });

  const repair = await collection<RepairTask>(COLLECTIONS.REPAIR_TASKS).findOne({ incidentId: incident.incidentId });
  // Use the most recent failed activation's checks as the diagnostic signal.
  const activations = await collection<ServiceActivation>(COLLECTIONS.SERVICE_ACTIVATIONS).find({ serviceName: incident.serviceName }).toArray();
  const latest = activations.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const checks = latest?.checks ?? [{ name: 'domain_reachable', passed: false, detail: 'no activation record' }];

  const dx = diagnose({ incidentId: incident.incidentId, repairTaskId: repair?.repairTaskId ?? null, serviceName: incident.serviceName, capabilityId: incident.capabilityId, checks, evidenceIds: incident.evidenceIds });
  await collection<RepairDiagnosis>(COLLECTIONS.REPAIR_DIAGNOSES).insertOne(dx);

  const ev = await addEvidence(buildEvidence({ type: 'diagnosis_report', summary: `Diagnosis: ${dx.suspectedCauses[0]?.cause} (${Math.round(dx.confidence * 100)}%)`, taskId: incident.taskId, capabilityId: incident.capabilityId, serviceName: incident.serviceName, data: { suspectedCauses: dx.suspectedCauses, recommendedFixes: dx.recommendedFixes } }), args.publish, incident.taskId);
  await collection<RepairDiagnosis>(COLLECTIONS.REPAIR_DIAGNOSES).updateOne({ diagnosisId: dx.diagnosisId }, { $set: { evidenceIds: [...dx.evidenceIds, ev] } });
  if (repair) await collection<RepairTask>(COLLECTIONS.REPAIR_TASKS).updateOne({ repairTaskId: repair.repairTaskId }, { $set: { status: 'diagnosing', diagnosisId: dx.diagnosisId, updatedAt: nowIso() } });

  await args.publish({ type: EVENT_TYPES.DIAGNOSIS_CREATED, taskId: incident.taskId, payload: { diagnosisId: dx.diagnosisId, incidentId: incident.incidentId, topCause: dx.suspectedCauses[0]?.cause, confidence: dx.confidence, message: `Diagnosis ready for ${incident.serviceName}` } });
  return dx;
}

/** Step 2 — turn the diagnosis into a structured, approval-gated plan. */
export async function planRepair(args: { diagnosisId: string; publish: Publish }): Promise<RepairPlan | null> {
  const dx = await collection<RepairDiagnosis>(COLLECTIONS.REPAIR_DIAGNOSES).findOne({ diagnosisId: args.diagnosisId });
  if (!dx) return null;
  const plan = buildRepairPlan(dx);
  await collection<RepairPlan>(COLLECTIONS.REPAIR_PLANS).insertOne(plan);

  await addEvidence(buildEvidence({ type: 'repair_plan', summary: `Repair plan (${plan.planType}) for ${plan.serviceName}`, capabilityId: plan.capabilityId, serviceName: plan.serviceName, data: { steps: plan.steps, requiredApprovals: plan.requiredApprovals } }), args.publish, null);

  await collection<Incident>(COLLECTIONS.INCIDENTS).updateOne({ incidentId: plan.incidentId }, { $set: { status: 'waiting_approval', updatedAt: nowIso() } });
  if (plan.repairTaskId) await collection<RepairTask>(COLLECTIONS.REPAIR_TASKS).updateOne({ repairTaskId: plan.repairTaskId }, { $set: { status: 'waiting_approval', repairPlanId: plan.repairPlanId, updatedAt: nowIso() } });
  await args.publish({ type: EVENT_TYPES.REPAIR_PLAN_CREATED, taskId: null, payload: { repairPlanId: plan.repairPlanId, planType: plan.planType, serviceName: plan.serviceName, message: `Repair plan ready: ${plan.planType}` } });
  return plan;
}

export interface ExecuteOutcome {
  resolved: boolean;
  activationPassed: boolean;
  repairPlanId: string;
  incidentId: string;
  nextRecommendation?: string;
}

/** Step 3 — execute the approved plan: safe actions, re-activate, resolve or keep open. */
export async function executeRepair(args: { repairPlanId: string; baseUrl?: string; registered?: boolean; internalToken: string; publish: Publish }): Promise<ExecuteOutcome | null> {
  const plan = await collection<RepairPlan>(COLLECTIONS.REPAIR_PLANS).findOne({ repairPlanId: args.repairPlanId });
  if (!plan) return null;
  const incident = await collection<Incident>(COLLECTIONS.INCIDENTS).findOne({ incidentId: plan.incidentId });
  const taskId = incident?.taskId ?? null;

  await collection<Incident>(COLLECTIONS.INCIDENTS).updateOne({ incidentId: plan.incidentId }, { $set: { status: 'repairing', updatedAt: nowIso() } });
  if (plan.repairTaskId) await collection<RepairTask>(COLLECTIONS.REPAIR_TASKS).updateOne({ repairTaskId: plan.repairTaskId }, { $set: { status: 'executing', updatedAt: nowIso() }, $inc: { attempts: 1 } });

  await addEvidence(buildEvidence({ type: 'repair_attempt', summary: `Executing repair plan ${plan.planType} for ${plan.serviceName}`, taskId, capabilityId: plan.capabilityId, serviceName: plan.serviceName, data: { steps: plan.steps } }), args.publish, taskId);

  // Safe, allowed actions per plan type (no destructive / direct prod changes).
  if (plan.planType === 'env_fix' || plan.planType === 'registry_fix') {
    await addEvidence(buildEvidence({ type: 'env_fix_instruction', summary: `Corrected env instructions for ${plan.serviceName}`, taskId, serviceName: plan.serviceName, data: { requiredEnvChanges: plan.requiredEnvChanges, instructions: plan.steps } }), args.publish, taskId);
  } else if (plan.planType === 'code_patch') {
    const op = await gitHubDeliveryFromEnv().deliver({ serviceName: plan.serviceName, servicePath: join(REPO_SERVICES_ROOT, plan.serviceName), files: STANDARD_FILES, commitMessage: `fix(${plan.serviceName}): repair ${plan.incidentId}`, capabilityId: plan.capabilityId });
    await collection(COLLECTIONS.GITHUB_OPERATIONS).insertOne(op as never);
    await addEvidence(buildEvidence({ type: 'code_patch', summary: `Patch branch ${op.branchName} (${op.mode}/${op.status}) for ${plan.serviceName}`, taskId, serviceName: plan.serviceName, data: { branchName: op.branchName, status: op.status } }), args.publish, taskId);
  } else if (plan.planType === 'domain_fix' || plan.planType === 'redeploy') {
    await addEvidence(buildEvidence({ type: 'env_fix_instruction', summary: `Dokploy actions for ${plan.serviceName}`, taskId, serviceName: plan.serviceName, data: { requiredDokployActions: plan.requiredDokployActions } }), args.publish, taskId);
  }

  // Re-run the live activation check (the corrected URL, if provided).
  await collection<Incident>(COLLECTIONS.INCIDENTS).updateOne({ incidentId: plan.incidentId }, { $set: { status: 'validating', updatedAt: nowIso() } });
  const baseUrl = args.baseUrl ?? incident?.detail?.match(/https?:\/\/[^\s]+/)?.[0] ?? `https://${plan.serviceName.replace(/-(agent|service)$/, '')}.simorx.com`;
  const { activation, evidence } = await checkLiveService({ baseUrl, serviceName: plan.serviceName, capabilityId: plan.capabilityId ?? 'unknown', expectedCapability: plan.capabilityId ?? undefined, internalToken: args.internalToken, registered: args.registered ?? true });
  const evIds: string[] = [];
  for (const d of evidence) evIds.push(await addEvidence(buildEvidence({ ...d, taskId, capabilityId: plan.capabilityId, serviceName: plan.serviceName }), args.publish, taskId));
  const reEv = await addEvidence(buildEvidence({ type: 'activation_after_repair', summary: `Re-activation ${activation.passed ? 'passed' : 'failed'} for ${plan.serviceName}`, taskId, capabilityId: plan.capabilityId, serviceName: plan.serviceName, data: { passed: activation.passed, checks: activation.checks } }), args.publish, taskId);
  activation.evidenceIds = [...evIds, reEv];
  await collection<ServiceActivation>(COLLECTIONS.SERVICE_ACTIVATIONS).insertOne(activation);

  if (activation.passed) {
    const now = nowIso();
    if (plan.capabilityId) {
      await collection<Capability>(COLLECTIONS.CAPABILITIES).updateOne({ capabilityId: plan.capabilityId }, { $set: { status: 'active', supportedByServices: [plan.serviceName], lastUsedAt: now, updatedAt: now } });
      await args.publish({ type: EVENT_TYPES.CAPABILITY_ACTIVATED, taskId, payload: { capability: plan.capabilityId, message: `Capability ACTIVE after repair: ${plan.capabilityId}` } });
    }
    const closeEv = await addEvidence(buildEvidence({ type: 'incident_closed', summary: `Incident ${plan.incidentId} resolved — ${plan.serviceName} healthy after repair`, taskId, capabilityId: plan.capabilityId, serviceName: plan.serviceName }), args.publish, taskId);
    await collection<Incident>(COLLECTIONS.INCIDENTS).updateOne({ incidentId: plan.incidentId }, { $set: { status: 'resolved', updatedAt: now }, $push: { evidenceIds: closeEv } as never });
    if (plan.repairTaskId) await collection<RepairTask>(COLLECTIONS.REPAIR_TASKS).updateOne({ repairTaskId: plan.repairTaskId }, { $set: { status: 'completed', updatedAt: now } });
    await collection<RepairPlan>(COLLECTIONS.REPAIR_PLANS).updateOne({ repairPlanId: plan.repairPlanId }, { $set: { status: 'executed', updatedAt: now } });
    await args.publish({ type: EVENT_TYPES.INCIDENT_RESOLVED, taskId, payload: { incidentId: plan.incidentId, serviceName: plan.serviceName, message: `Incident resolved: ${plan.serviceName}` } });
    await args.publish({ type: EVENT_TYPES.REPAIR_EXECUTED, taskId, payload: { repairPlanId: plan.repairPlanId, resolved: true, message: `Repair succeeded for ${plan.serviceName}` } });
    await recordRepairLearning(plan, taskId, args.publish);
    return { resolved: true, activationPassed: true, repairPlanId: plan.repairPlanId, incidentId: plan.incidentId };
  }

  // Still failing: keep incident open, store attempt, generate next recommendation.
  const failing = activation.checks.filter((c) => !c.passed).map((c) => c.name).join(', ');
  const next = `Still failing (${failing}). Next: re-check env/domain and re-run the activation check with the correct deployed URL.`;
  await collection<Incident>(COLLECTIONS.INCIDENTS).updateOne({ incidentId: plan.incidentId }, { $set: { status: 'open', detail: next, updatedAt: nowIso() } });
  if (plan.repairTaskId) await collection<RepairTask>(COLLECTIONS.REPAIR_TASKS).updateOne({ repairTaskId: plan.repairTaskId }, { $set: { status: 'failed', updatedAt: nowIso() } });
  await collection<RepairPlan>(COLLECTIONS.REPAIR_PLANS).updateOne({ repairPlanId: plan.repairPlanId }, { $set: { status: 'failed', updatedAt: nowIso() } });
  await args.publish({ type: EVENT_TYPES.REPAIR_EXECUTED, taskId, payload: { repairPlanId: plan.repairPlanId, resolved: false, message: next, level: 'warn' } });
  return { resolved: false, activationPassed: false, repairPlanId: plan.repairPlanId, incidentId: plan.incidentId, nextRecommendation: next };
}
