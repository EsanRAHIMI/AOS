/**
 * Policy Engine (Phase 7). Every sensitive action is checked here before it can
 * run. Output is allowed / approval_required / blocked, with a reason, the
 * required approval type, and a risk level. Deterministic and auditable; the
 * caller persists a PolicyDecision and must not run an action the policy blocks
 * or that requires approval until that approval exists.
 */
import type { PolicyAction, PolicyOutcome } from '../schemas/reasoning.js';

export interface PolicyResult {
  decision: PolicyOutcome;
  reason: string;
  requiredApprovalType: string | null;
  riskLevel: 'low' | 'medium' | 'high';
}

const RULES: Record<PolicyAction, PolicyResult> = {
  read_only: { decision: 'allowed', reason: 'Read-only action.', requiredApprovalType: null, riskLevel: 'low' },
  run_validation: { decision: 'allowed', reason: 'Validation is non-mutating and safe.', requiredApprovalType: null, riskLevel: 'low' },
  browser_action: { decision: 'allowed', reason: 'Browser action restricted to internal/owned targets by the agent allowlist.', requiredApprovalType: null, riskLevel: 'low' },
  code_change: { decision: 'approval_required', reason: 'Code changes require review.', requiredApprovalType: 'create_pr', riskLevel: 'medium' },
  github_action: { decision: 'approval_required', reason: 'GitHub branch/PR requires approval (feature branch only; never main).', requiredApprovalType: 'create_pr', riskLevel: 'medium' },
  deployment_action: { decision: 'approval_required', reason: 'Deployment/redeploy affects running services.', requiredApprovalType: 'redeploy', riskLevel: 'high' },
  environment_change: { decision: 'approval_required', reason: 'Environment changes can break or expose services.', requiredApprovalType: 'change_env', riskLevel: 'high' },
  external_api_call: { decision: 'approval_required', reason: 'External API calls can have real-world impact.', requiredApprovalType: 'external_action', riskLevel: 'high' },
  send_message: { decision: 'approval_required', reason: 'Sending external messages/emails is irreversible.', requiredApprovalType: 'send_message', riskLevel: 'high' },
  data_mutation: { decision: 'approval_required', reason: 'Mutating stored data requires approval.', requiredApprovalType: 'data_mutation', riskLevel: 'medium' },
  production_change: { decision: 'approval_required', reason: 'Production changes require explicit approval.', requiredApprovalType: 'production_change', riskLevel: 'high' },
  file_delete: { decision: 'blocked', reason: 'Destructive file deletion is blocked by default.', requiredApprovalType: 'destructive', riskLevel: 'high' },
  physical_action: { decision: 'blocked', reason: 'Physical/robot actions are blocked until explicitly enabled by policy.', requiredApprovalType: 'physical', riskLevel: 'high' },
};

export function evaluatePolicy(action: PolicyAction): PolicyResult {
  return RULES[action] ?? { decision: 'approval_required', reason: 'Unknown action — requires approval by default.', requiredApprovalType: 'manual', riskLevel: 'medium' };
}

/** Map a plan's required-approval token to a policy action category. */
export function approvalToAction(approval: string): PolicyAction {
  switch (approval) {
    case 'create_pr': return 'github_action';
    case 'redeploy': return 'deployment_action';
    case 'change_env': return 'environment_change';
    case 'send_message': return 'send_message';
    case 'external_action': return 'external_api_call';
    case 'data_mutation': return 'data_mutation';
    case 'production_change': return 'production_change';
    case 'delete': return 'file_delete';
    default: return 'code_change';
  }
}
