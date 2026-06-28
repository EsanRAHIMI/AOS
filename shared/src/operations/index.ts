/**
 * Phase 15 — Safe Real Operations engine (pure + testable).
 *
 * Classifies an operation's risk, detects protected core services, and builds
 * the operation plan, steps, verification + rollback plans, and snapshots. No
 * I/O, no fake data: callers persist the results and run real verification.
 */
import { genId, nowIso } from '../utils/index.js';
import type {
  OperationType, OperationRiskLevel, OperationPlan, OperationStep,
  DokployTarget, DeploymentSnapshot,
} from '../schemas/operations-plan.js';

/** Core services that must never be modified silently — owner approval required. */
export const PROTECTED_CORE_SERVICES = new Set<string>([
  'dashboard-web', 'gateway-api', 'orchestrator-agent', 'service-registry',
  'event-bus-service', 'monitor-agent', 'memory-agent', 'documentation-service', 'devops-agent',
]);

export function isProtectedCore(serviceId: string | undefined | null): boolean {
  return Boolean(serviceId) && PROTECTED_CORE_SERVICES.has(String(serviceId));
}

const BASE_RISK: Record<OperationType, OperationRiskLevel> = {
  health_check_only: 'low',
  new_app: 'medium',
  existing_app_update: 'high',
  existing_app_repair: 'high',
  existing_app_restart: 'high',
  existing_app_env_update: 'high',
  protected_core_update: 'critical',
};

export interface Classification {
  operationType: OperationType;
  riskLevel: OperationRiskLevel;
  protectedCore: boolean;
  requiredApprovals: string[];
  mutating: boolean;
}

/** Classify an operation. A mutation targeting a protected core service escalates to critical. */
export function classifyOperation(operationType: OperationType, targetServiceId?: string | null): Classification {
  const mutating = operationType !== 'health_check_only';
  const protectedCore = mutating && isProtectedCore(targetServiceId);
  const effectiveType: OperationType = protectedCore ? 'protected_core_update' : operationType;
  const riskLevel = protectedCore ? 'critical' : BASE_RISK[operationType];
  const requiredApprovals =
    !mutating ? []
    : riskLevel === 'critical' ? ['owner']
    : ['owner', 'operator'];
  return { operationType: effectiveType, riskLevel, protectedCore, requiredApprovals, mutating };
}

/** Canonical operation timeline (13 steps). Non-applicable steps are marked skipped. */
export function buildSteps(opType: OperationType): OperationStep[] {
  const now = nowIso();
  const mk = (key: string, label: string, status: OperationStep['status'] = 'pending', at: string | null = null): OperationStep => ({ key, label, status, actor: 'system', message: '', evidenceId: null, at });
  const isMutation = opType !== 'health_check_only';
  const existing = ['existing_app_update', 'existing_app_repair', 'existing_app_restart', 'existing_app_env_update', 'protected_core_update'].includes(opType);
  return [
    mk('goal', 'Goal received', 'done', now),
    mk('plan', 'Plan created', 'done', now),
    mk('target', 'Target selected', 'active'),
    mk('risk', 'Risk reviewed', 'pending'),
    mk('approval_request', 'Approval requested', isMutation ? 'pending' : 'skipped'),
    mk('approved', 'Approved', isMutation ? 'pending' : 'skipped'),
    mk('snapshot', 'Snapshot created', existing ? 'pending' : 'skipped'),
    mk('execute', 'Execution started', 'pending'),
    mk('run', opType === 'health_check_only' ? 'Health check running' : 'Deploy/restart/check running', 'pending'),
    mk('health', 'Health verification', 'pending'),
    mk('registry', 'Registry verification', 'pending'),
    mk('evidence', 'Evidence stored', 'pending'),
    mk('completed', 'Completed', 'pending'),
  ];
}

export function buildVerificationPlan(targetDomain: string): string[] {
  return [
    `Reach the app domain (${targetDomain || 'target domain'})`,
    'Call GET /health and confirm ok',
    'Confirm the service is registered with the service-registry',
    'Confirm GET /.factory/manifest responds with the internal token (must not be public)',
  ];
}

export function buildRollbackPlan(opType: OperationType): string[] {
  if (opType === 'new_app') return ['Delete the newly-created Dokploy app if verification fails', 'Remove its domain + registry entry'];
  return [
    'Restore the captured deployment snapshot (env, root dir, build/start commands)',
    'Redeploy the previous successful build in Dokploy',
    'Re-run health + registry verification',
  ];
}

export interface BuildOperationPlanArgs {
  goal: string;
  operationType: OperationType;
  taskId?: string | null;
  target?: Partial<Pick<OperationPlan, 'targetProject' | 'targetEnvironment' | 'targetApp' | 'targetService' | 'targetDomain' | 'targetPort' | 'rootDir' | 'envVarsRequired' | 'envVarsMissing'>>;
}

/** Build a draft operation plan awaiting target selection. */
export function buildOperationPlan(args: BuildOperationPlanArgs): OperationPlan {
  const now = nowIso();
  const cls = classifyOperation(args.operationType, args.target?.targetService);
  const domain = args.target?.targetDomain ?? '';
  return {
    operationPlanId: genId('op'),
    taskId: args.taskId ?? null,
    goal: args.goal,
    operationType: cls.operationType,
    targetProject: args.target?.targetProject ?? '',
    targetEnvironment: args.target?.targetEnvironment ?? 'production',
    targetApp: args.target?.targetApp ?? '',
    targetService: args.target?.targetService ?? '',
    targetDomain: domain,
    targetPort: args.target?.targetPort ?? null,
    rootDir: args.target?.rootDir ?? '',
    envVarsRequired: args.target?.envVarsRequired ?? [],
    envVarsMissing: args.target?.envVarsMissing ?? [],
    riskLevel: cls.riskLevel,
    protectedCore: cls.protectedCore,
    requiredApprovals: cls.requiredApprovals,
    steps: buildSteps(cls.operationType),
    verificationPlan: buildVerificationPlan(domain),
    verification: null,
    rollbackPlan: buildRollbackPlan(cls.operationType),
    manualInstructions: [],
    snapshotId: null,
    targetId: null,
    evidenceIds: [],
    status: 'waiting_target_selection',
    nextAction: 'Select or confirm the Dokploy target (project / app / domain), or confirm a new app.',
    createdAt: now,
    updatedAt: now,
  };
}

export function buildSnapshot(plan: OperationPlan): DeploymentSnapshot {
  return {
    snapshotId: genId('snap'),
    targetId: plan.targetId,
    operationPlanId: plan.operationPlanId,
    project: plan.targetProject,
    app: plan.targetApp,
    domain: plan.targetDomain,
    port: plan.targetPort,
    envHash: hashList(plan.envVarsRequired),
    rootDir: plan.rootDir,
    config: { operationType: plan.operationType, capturedAt: nowIso() },
    createdAt: nowIso(),
  };
}

/** Build the exact manual Dokploy steps for when the API is not configured. */
export function buildManualInstructions(plan: OperationPlan): string[] {
  const where = `Dokploy → project "${plan.targetProject || '<project>'}" → app "${plan.targetApp || plan.targetService || '<app>'}"`;
  if (plan.operationType === 'new_app') {
    return [
      `In Dokploy, create a new application named "${plan.targetApp || plan.targetService}".`,
      `Set the domain to ${plan.targetDomain || '<domain>'} and the internal port to ${plan.targetPort ?? '<port>'}.`,
      `Set the root directory to ${plan.rootDir || '<root dir>'} and the build/start commands.`,
      `Add the required env vars: ${plan.envVarsRequired.join(', ') || '<none>'}.`,
      'Deploy, then return here and confirm — verification will run automatically.',
    ];
  }
  if (plan.operationType === 'existing_app_env_update' || plan.operationType === 'protected_core_update') {
    return [
      `In ${where}, open Environment.`,
      `Update the required env vars: ${plan.envVarsRequired.join(', ') || '<none>'} (do not paste secrets into this dashboard).`,
      'Redeploy the app.',
      'Return here and confirm — verification will run automatically.',
    ];
  }
  if (plan.operationType === 'existing_app_restart') {
    return [`In ${where}, click Restart.`, 'Return here and confirm — verification will run automatically.'];
  }
  return [
    `In ${where}, redeploy the latest build (or apply the repair).`,
    'Confirm the snapshot was captured here before changing anything (rollback uses it).',
    'Return here and confirm — verification will run automatically.',
  ];
}

function hashList(items: string[]): string {
  // Small non-crypto fingerprint for change detection (not security).
  let h = 0;
  const s = items.join('|');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `env_${(h >>> 0).toString(16)}`;
}

/** Convenience: mark a step done/active by key, stamping time + message. */
export function setStep(steps: OperationStep[], key: string, status: OperationStep['status'], message = '', actor = 'system', evidenceId: string | null = null): OperationStep[] {
  return steps.map((s) => (s.key === key ? { ...s, status, message: message || s.message, actor, evidenceId: evidenceId ?? s.evidenceId, at: nowIso() } : s));
}

export function nextActionFor(plan: Pick<OperationPlan, 'status' | 'operationType' | 'protectedCore' | 'riskLevel' | 'manualInstructions'>): string {
  switch (plan.status) {
    case 'waiting_target_selection': return 'Select or confirm the Dokploy target (project / app / domain), or confirm a new app.';
    case 'waiting_approval': return plan.protectedCore ? 'Protected core service — review the risk and obtain OWNER approval.' : 'Review the risk and approve (or reject / request changes).';
    case 'approved': return 'Approved — execution will start.';
    case 'running': return plan.manualInstructions.length ? 'Follow the exact Dokploy steps shown, then click "I did this in Dokploy".' : 'Execution in progress — watch the timeline.';
    case 'verifying': return 'Verifying — checking domain, /health, and registry.';
    case 'completed': return 'Operation complete — review the verification result and evidence.';
    case 'failed': return 'Operation failed — review the logs, then rollback or create a follow-up repair task.';
    case 'rolled_back': return 'Rolled back to the previous snapshot — review what went wrong.';
    case 'cancelled': return 'Cancelled.';
    default: return 'Review the operation.';
  }
}
