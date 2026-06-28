/**
 * Dashboard-side RBAC mirror of @factory/shared's governance model. Duplicated
 * deliberately so the dashboard bundle stays decoupled from backend code; the
 * gateway enforces the same rules server-side as defense in depth.
 */
export type Role = 'owner' | 'operator' | 'viewer' | 'agent';

const ALL = [
  'approve_expansion', 'approve_repair', 'approve_deployment', 'approve_policy_change',
  'approve_scoring_change', 'approve_recommendation', 'run_activation', 'run_repair',
  'view_dashboard', 'view_evidence', 'manage_secrets', 'create_task', 'decide_approval',
  'confirm_infrastructure', 'run_learning_trigger', 'github_delivery', 'manage_security',
];

const ROLE_PERMISSIONS: Record<Role, string[]> = {
  owner: ALL,
  operator: ['run_activation', 'run_repair', 'approve_repair', 'approve_deployment', 'confirm_infrastructure', 'create_task', 'decide_approval', 'run_learning_trigger', 'view_dashboard', 'view_evidence'],
  viewer: ['view_dashboard', 'view_evidence'],
  agent: [],
};

/** Sensitive dashboard action → required permission. Keep in sync with the gateway. */
export const ACTION_PERMISSION: Record<string, string> = {
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
  runSecurityCheck: 'manage_security',
  setSafeMode: 'manage_security',
  createOperation: 'create_task',
  confirmOperationTarget: 'create_task',
  decideOperation: 'approve_deployment',
};

export function canRolePerformAction(role: Role, action: string): boolean {
  const perm = ACTION_PERMISSION[action];
  if (!perm) return true;
  return (ROLE_PERMISSIONS[role] ?? []).includes(perm);
}

/** Mutating actions blocked while safe mode is active (everything except the security controls). */
export const SAFE_MODE_BLOCKED = new Set(Object.keys(ACTION_PERMISSION).filter((a) => a !== 'runSecurityCheck' && a !== 'setSafeMode'));

export const ACTION_LABEL: Record<string, string> = {
  createTask: 'create a task',
  decideApproval: 'decide an approval',
  decideScoringProposal: 'approve a scoring change',
  decidePolicyProposal: 'approve a policy change',
  decideRecommendation: 'approve a recommendation',
  decideExpansion: 'approve an expansion',
  confirmInfra: 'confirm infrastructure',
  confirmChecklist: 'confirm a deployment',
  runActivation: 'run an activation check',
  decideRepairPlan: 'decide a repair plan',
  revalidateIncident: 'revalidate an incident',
  triggerLearning: 'trigger a learning run',
  runSecurityCheck: 'run a security check',
  setSafeMode: 'change safe mode',
};
