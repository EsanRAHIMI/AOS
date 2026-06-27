/**
 * Learning Governance (Phase 8). Closes the feedback loop: compare predicted
 * plan quality to actual outcome, recommend scoring-weight changes, and provide
 * the RBAC + audit primitives. Nothing here mutates decision behavior directly —
 * it produces proposals and records; activation requires approval + a new
 * versioned profile.
 */
import { genId, nowIso } from '../utils/index.js';
import type {
  ScoringWeights,
  ScoringProfile,
  OutcomeReview,
  WeightChange,
  Role,
  RoleName,
  Permission,
  RbacUser,
  AuditLog,
} from '../schemas/governance.js';

/** Canonical default scoring weights (also the seed for profile v1). */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  successProbability: 1.4,
  risk: 1.4,
  cost: 0.8,
  speed: 0.8,
  evidenceAvailability: 1.0,
  reversibility: 1.2,
  humanIntervention: 0.8,
  capabilityFit: 1.3,
  policyCompliance: 1.2,
  longTermValue: 1.1,
};

export function buildScoringProfile(version: number, weights: ScoringWeights, opts: { status?: ScoringProfile['status']; reason?: string; approvedBy?: string | null } = {}): ScoringProfile {
  const now = nowIso();
  return {
    profileId: genId('sprof'),
    version,
    weights,
    status: opts.status ?? 'active',
    reason: opts.reason ?? 'seed',
    approvedBy: opts.approvedBy ?? null,
    createdAt: now,
    activatedAt: opts.status === 'active' || opts.status === undefined ? now : null,
  };
}

export function applyWeightChanges(current: ScoringWeights, changes: WeightChange[]): ScoringWeights {
  const next = { ...current } as Record<string, number>;
  for (const c of changes) {
    if (c.dimension in next) next[c.dimension] = Math.max(0, Number((next[c.dimension]! + c.change).toFixed(3)));
  }
  return next as unknown as ScoringWeights;
}

export interface OutcomeSignals {
  validationPassed?: boolean;
  activationPassed?: boolean;
  incidentsCreated?: number;
  humanIntervention?: boolean;
  evidenceCount?: number;
}

export interface OutcomeReviewArgs {
  taskId: string;
  decisionId?: string | null;
  selectedPlanId: string;
  selectedPlanScore: number;
  actualEvaluationScore: number;
  signals?: OutcomeSignals;
}

/** Compare predicted plan score to actual evaluation and recommend weight changes. */
export function outcomeReview(args: OutcomeReviewArgs): OutcomeReview {
  const s = args.signals ?? {};
  const diff = Number((args.selectedPlanScore - args.actualEvaluationScore).toFixed(3));
  const predictedVsActual: OutcomeReview['predictedVsActual'] = diff > 0.05 ? 'overestimated' : diff < -0.05 ? 'underestimated' : 'accurate';

  const whatWorked: string[] = [];
  const whatFailed: string[] = [];
  if (s.validationPassed) whatWorked.push('Runtime validation passed.');
  else whatFailed.push('Runtime validation did not pass.');
  if (s.activationPassed === false) whatFailed.push('Validation passed but activation later failed.');
  if ((s.incidentsCreated ?? 0) > 0) whatFailed.push(`${s.incidentsCreated} incident(s) were created.`);
  if (s.humanIntervention) whatWorked.push('Human approval correctly gated sensitive steps.');

  const recommendedWeightChanges: WeightChange[] = [];
  if (predictedVsActual === 'overestimated') {
    recommendedWeightChanges.push({ dimension: 'evidenceAvailability', change: 0.1, reason: 'Evidence quality predicted real success better than the score implied.' });
    recommendedWeightChanges.push({ dimension: 'speed', change: -0.1, reason: 'Speed was over-weighted relative to reliability.' });
  } else if (predictedVsActual === 'underestimated') {
    recommendedWeightChanges.push({ dimension: 'successProbability', change: 0.1, reason: 'The plan outperformed its predicted confidence.' });
  }

  return {
    reviewId: genId('rev'),
    taskId: args.taskId,
    decisionId: args.decisionId ?? null,
    selectedPlanId: args.selectedPlanId,
    selectedPlanScore: args.selectedPlanScore,
    actualOutcome: predictedVsActual === 'overestimated' ? 'underperformed_vs_prediction' : predictedVsActual === 'underestimated' ? 'outperformed_vs_prediction' : 'as_predicted',
    actualEvaluationScore: args.actualEvaluationScore,
    predictedVsActual,
    whatWorked,
    whatFailed,
    lessons: [
      `Predicted ${args.selectedPlanScore} vs actual ${args.actualEvaluationScore} (${predictedVsActual}).`,
      recommendedWeightChanges.length ? 'Adjust scoring weights so future predictions track reality better.' : 'Scoring tracked reality; no change recommended.',
    ],
    recommendedWeightChanges,
    recommendedPolicyChanges: [],
    recommendedSkillUpdates: predictedVsActual === 'overestimated' ? ['Reinforce that evidence quality matters more than speed.'] : [],
    createdAt: nowIso(),
  };
}

/* -------------------- RBAC -------------------- */

export const PERMISSION_CATALOG = [
  'approve_expansion',
  'approve_repair',
  'approve_deployment',
  'approve_policy_change',
  'approve_scoring_change',
  'approve_recommendation',
  'run_activation',
  'run_repair',
  'view_dashboard',
  'view_evidence',
  'manage_secrets',
  // Phase 12 — additional sensitive dashboard actions
  'create_task',
  'decide_approval',
  'confirm_infrastructure',
  'run_learning_trigger',
  'github_delivery',
  'manage_security',
] as const;
export type PermissionId = (typeof PERMISSION_CATALOG)[number];

export const ROLE_PERMISSIONS: Record<RoleName, PermissionId[]> = {
  owner: [...PERMISSION_CATALOG],
  operator: [
    'run_activation',
    'run_repair',
    'approve_repair',
    'approve_deployment',
    'confirm_infrastructure',
    'create_task',
    'decide_approval',
    'run_learning_trigger',
    'view_dashboard',
    'view_evidence',
  ],
  viewer: ['view_dashboard', 'view_evidence'],
  agent: [],
};

export function hasPermission(role: RoleName, permission: string): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission as PermissionId);
}

/**
 * Single source of truth mapping every sensitive dashboard action to the
 * permission it requires. Both the dashboard server actions and the gateway
 * use this so enforcement is identical on both sides.
 */
export const DASHBOARD_ACTION_PERMISSIONS: Record<string, PermissionId> = {
  createTask: 'create_task',
  decideApproval: 'decide_approval',
  decideScoringProposal: 'approve_scoring_change',
  decidePolicyProposal: 'approve_policy_change',
  decideRecommendation: 'approve_recommendation',
  decideExpansion: 'approve_expansion',
  confirmInfra: 'confirm_infrastructure',
  confirmChecklist: 'approve_deployment',
  runActivation: 'run_activation',
  decideRepairPlan: 'run_repair',
  revalidateIncident: 'run_repair',
  triggerLearning: 'run_learning_trigger',
  githubDelivery: 'github_delivery',
  runSecurityCheck: 'manage_security',
  setSafeMode: 'manage_security',
};

/** True when `role` may perform the named sensitive dashboard action. */
export function canRolePerformAction(role: RoleName, action: string): boolean {
  const perm = DASHBOARD_ACTION_PERMISSIONS[action];
  if (!perm) return true; // not a gated action
  return hasPermission(role, perm);
}

/**
 * Mutating actions blocked when the kernel is in safe mode. Safe mode allows
 * only read/monitor/report/recommendation surfacing — never execution.
 */
export const SAFE_MODE_BLOCKED_ACTIONS = new Set<string>(Object.keys(DASHBOARD_ACTION_PERMISSIONS).filter((a) => a !== 'runSecurityCheck' && a !== 'setSafeMode'));

export function isActionBlockedInSafeMode(action: string): boolean {
  return SAFE_MODE_BLOCKED_ACTIONS.has(action);
}

export function buildSeedRoles(): Role[] {
  const now = nowIso();
  const desc: Record<RoleName, string> = {
    owner: 'Full control; can approve all governance, scoring, policy, and deployment actions.',
    operator: 'Can run activation/repair checks and approve repairs; cannot change policy/scoring.',
    viewer: 'Read-only access to the dashboard and evidence.',
    agent: 'Services/agents: can request actions but cannot approve sensitive ones.',
  };
  return (Object.keys(ROLE_PERMISSIONS) as RoleName[]).map((r) => ({ roleId: r, description: desc[r], permissions: ROLE_PERMISSIONS[r], createdAt: now }));
}

export function buildSeedPermissions(): Permission[] {
  const map: Record<string, string> = {
    approve_expansion: 'Approve a capability expansion proposal.',
    approve_repair: 'Approve a repair plan.',
    approve_deployment: 'Approve a deployment/activation action.',
    approve_policy_change: 'Approve a policy change proposal.',
    approve_scoring_change: 'Approve a scoring change proposal.',
    run_activation: 'Trigger a live activation check.',
    run_repair: 'Trigger repair execution.',
    view_dashboard: 'View the dashboard.',
    view_evidence: 'View evidence records.',
    manage_secrets: 'Manage secret material.',
    create_task: 'Create a new task / goal.',
    decide_approval: 'Approve or reject a pending approval.',
    confirm_infrastructure: 'Confirm infrastructure / deployment creation.',
    run_learning_trigger: 'Trigger a learning run.',
    github_delivery: 'Deliver code to GitHub.',
    manage_security: 'Run security checks and toggle safe mode.',
  };
  return PERMISSION_CATALOG.map((p) => ({ permissionId: p, description: map[p] ?? p }));
}

export function buildSeedUsers(): RbacUser[] {
  const now = nowIso();
  return [
    { userId: 'user_owner', name: 'Owner', role: 'owner', createdAt: now },
    { userId: 'user_operator', name: 'Operator', role: 'operator', createdAt: now },
    { userId: 'user_viewer', name: 'Viewer', role: 'viewer', createdAt: now },
    { userId: 'svc_agent', name: 'Internal agent', role: 'agent', createdAt: now },
  ];
}

/** Map an auth context (admin token = owner, internal token = agent) to a role. */
export function roleForAuth(isAdmin: boolean): RoleName {
  return isAdmin ? 'owner' : 'agent';
}

export interface AuditArgs {
  actorType: AuditLog['actorType'];
  actorId: string;
  role?: RoleName | null;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

export function buildAuditLog(args: AuditArgs): AuditLog {
  return {
    auditId: genId('audit'),
    actorType: args.actorType,
    actorId: args.actorId,
    role: args.role ?? null,
    action: args.action,
    targetType: args.targetType,
    targetId: args.targetId,
    before: args.before,
    after: args.after,
    reason: args.reason ?? '',
    createdAt: nowIso(),
  };
}
