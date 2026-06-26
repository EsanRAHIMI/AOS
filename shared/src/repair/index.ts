/**
 * Repair diagnosis + planning engines (Phase 6).
 *
 * `diagnose()` turns failed activation/health checks into ranked suspected
 * causes with confidence and evidence. `buildRepairPlan()` turns the top cause
 * into a structured, executable plan (env_fix / domain_fix / code_patch / …).
 * Both are deterministic and pure; the monitor-agent persists the results and
 * drives execution. Sensitive steps are flagged for approval.
 */
import { genId, nowIso } from '../utils/index.js';
import type { RepairDiagnosis, RepairPlan, PlanType, SuspectedCause } from '../schemas/operations.js';
import type { ValidationCheck } from '../schemas/reality.js';

interface CauseRule {
  cause: string;
  confidence: number;
  evidence: string;
  planType: PlanType;
  human: boolean;
}

/** Map a failed check (by name) to a suspected cause. */
function ruleFor(check: ValidationCheck): CauseRule | null {
  const detail = check.detail ?? '';
  switch (check.name) {
    case 'domain_reachable':
      return { cause: 'Service unreachable: Dokploy app not deployed or domain not routed', confidence: 0.8, evidence: `domain unreachable (${detail})`, planType: 'domain_fix', human: true };
    case 'health_ok':
      return { cause: 'Service reachable but unhealthy: likely missing env (MONGODB_URI / FACTORY_INTERNAL_TOKEN) or crash on boot', confidence: 0.7, evidence: `/health not ok (${detail})`, planType: 'env_fix', human: true };
    case 'manifest_valid':
      return detail.includes('401')
        ? { cause: 'FACTORY_INTERNAL_TOKEN missing or mismatched with the gateway', confidence: 0.82, evidence: 'manifest endpoint returned 401', planType: 'env_fix', human: true }
        : { cause: 'Manifest endpoint invalid (service code or startup issue)', confidence: 0.6, evidence: `manifest invalid (${detail})`, planType: 'code_patch', human: true };
    case 'registered_in_registry':
      return { cause: 'Service not registered: wrong SERVICE_REGISTRY_URL or the service failed to start', confidence: 0.6, evidence: 'not present in service-registry', planType: 'registry_fix', human: true };
    case 'capability_linked':
      return { cause: 'Manifest capabilities do not include the expected capability id', confidence: 0.7, evidence: 'capability not in manifest', planType: 'code_patch', human: true };
    case 'task_endpoint_accepts':
      return { cause: 'Task endpoint errors (handler bug)', confidence: 0.6, evidence: `POST /.factory/task failed (${detail})`, planType: 'code_patch', human: true };
    case 'capabilities_present':
      return { cause: 'No capabilities returned by the service', confidence: 0.5, evidence: 'empty capabilities', planType: 'code_patch', human: true };
    case 'logs_available':
      return { cause: 'Logs endpoint unavailable (token mismatch or crash)', confidence: 0.5, evidence: 'logs endpoint failed', planType: 'env_fix', human: true };
    default:
      return null;
  }
}

export interface DiagnoseArgs {
  incidentId: string;
  repairTaskId?: string | null;
  serviceName: string;
  capabilityId?: string | null;
  checks: ValidationCheck[];
  evidenceIds?: string[];
}

export function diagnose(args: DiagnoseArgs): RepairDiagnosis {
  const failed = args.checks.filter((c) => !c.passed);
  const rules = failed.map(ruleFor).filter((r): r is CauseRule => r !== null);
  // Highest-confidence cause first.
  rules.sort((a, b) => b.confidence - a.confidence);

  const suspectedCauses: SuspectedCause[] = rules.map((r) => ({ cause: r.cause, confidence: r.confidence, evidence: [r.evidence] }));
  if (suspectedCauses.length === 0) {
    suspectedCauses.push({ cause: 'Unknown failure (no specific failing check matched a rule)', confidence: 0.4, evidence: ['no rule matched'] });
  }

  const recommendedFixes = [...new Set(rules.map((r) => planTypeFix(r.planType)))];
  const confidence = suspectedCauses[0]!.confidence;
  const requiresHumanAction = rules.some((r) => r.human) || rules.length === 0;
  const riskLevel: RepairDiagnosis['riskLevel'] = confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low';

  return {
    diagnosisId: genId('dx'),
    incidentId: args.incidentId,
    repairTaskId: args.repairTaskId ?? null,
    serviceName: args.serviceName,
    capabilityId: args.capabilityId ?? null,
    suspectedCauses,
    confidence,
    evidenceIds: args.evidenceIds ?? [],
    recommendedFixes,
    requiresHumanAction,
    riskLevel,
    createdAt: nowIso(),
  };
}

function planTypeFix(t: PlanType): string {
  switch (t) {
    case 'domain_fix': return 'Verify the Dokploy app is deployed and the domain is routed.';
    case 'env_fix': return 'Set/verify env variables (MONGODB_URI, FACTORY_INTERNAL_TOKEN) and redeploy.';
    case 'registry_fix': return 'Verify SERVICE_REGISTRY_URL and that the service self-registers on boot.';
    case 'code_patch': return 'Patch the service code (manifest/handler) and open a GitHub PR.';
    case 'redeploy': return 'Redeploy the Dokploy app.';
    case 'dependency_fix': return 'Fix the failing external dependency.';
    default: return 'Manual investigation required.';
  }
}

/** Build a structured, executable repair plan from a diagnosis. */
export function buildRepairPlan(diagnosis: RepairDiagnosis): RepairPlan {
  // Choose the plan type from the top suspected cause's rule.
  const top = diagnosis.suspectedCauses[0]?.cause ?? '';
  const planType: PlanType =
    /unreachable|not deployed|domain/i.test(top) ? 'domain_fix'
      : /TOKEN|env|MONGODB|unhealthy/i.test(top) ? 'env_fix'
      : /not registered|registry/i.test(top) ? 'registry_fix'
      : /capabilit|manifest|handler|code/i.test(top) ? 'code_patch'
      : 'manual_action';

  const now = nowIso();
  const base = {
    repairPlanId: genId('plan'),
    diagnosisId: diagnosis.diagnosisId,
    repairTaskId: diagnosis.repairTaskId,
    incidentId: diagnosis.incidentId,
    serviceName: diagnosis.serviceName,
    capabilityId: diagnosis.capabilityId,
    planType,
    requiresHumanAction: true,
    status: 'waiting_approval' as const,
    validationAfterRepair: 'Re-run the live activation check against the deployed service.',
    createdAt: now,
    updatedAt: now,
  };

  switch (planType) {
    case 'domain_fix':
      return { ...base, steps: [`Confirm the Dokploy app "${diagnosis.serviceName}" exists and is deployed.`, 'Check the domain is mapped and DNS resolves.', 'Redeploy if the app is stopped.', 'Re-run the activation check.'], requiredApprovals: ['redeploy'], requiredEnvChanges: [], requiredCodeChanges: [], requiredDokployActions: ['Verify app + domain routing', 'Redeploy if needed'] };
    case 'env_fix':
      return { ...base, steps: ['Set MONGODB_URI to the Atlas connection string.', 'Set FACTORY_INTERNAL_TOKEN to match the gateway/internal token.', 'Save env and redeploy.', 'Re-run the activation check.'], requiredApprovals: ['change_env'], requiredEnvChanges: ['MONGODB_URI', 'FACTORY_INTERNAL_TOKEN'], requiredCodeChanges: [], requiredDokployActions: ['Update env variables', 'Redeploy'] };
    case 'registry_fix':
      return { ...base, steps: ['Verify SERVICE_REGISTRY_URL points at the registry.', 'Restart the service so it self-registers.', 'Re-run the activation check.'], requiredApprovals: ['redeploy'], requiredEnvChanges: ['SERVICE_REGISTRY_URL'], requiredCodeChanges: [], requiredDokployActions: ['Fix env + restart'] };
    case 'code_patch':
      return { ...base, steps: [`Patch ${diagnosis.serviceName} (manifest capabilities / task handler).`, 'Open a GitHub feature branch + PR with the fix.', 'After merge, redeploy.', 'Re-run validation, then the activation check.'], requiredApprovals: ['create_pr'], requiredEnvChanges: [], requiredCodeChanges: ['src/factory/manifest.ts', 'src/index.ts'], requiredDokployActions: ['Redeploy after merge'] };
    default:
      return { ...base, steps: ['Investigate the failure manually using the evidence.', 'Apply the appropriate fix.', 'Re-run the activation check.'], requiredApprovals: ['manual'], requiredEnvChanges: [], requiredCodeChanges: [], requiredDokployActions: [] };
  }
}
