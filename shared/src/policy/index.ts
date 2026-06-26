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

/**
 * Hardcoded safety blocks that ALWAYS override configurable policy. Dangerous
 * actions can never be allowed by a config overlay.
 */
export const HARDCODED_BLOCKS: PolicyAction[] = ['file_delete', 'physical_action'];

export interface ConfigurablePolicyRule {
  action: string;
  decision: PolicyOutcome;
  reason: string;
  requiredApprovalType: string | null;
  riskLevel: 'low' | 'medium' | 'high';
  scope?: { serviceName?: string; capabilityId?: string; environment?: string };
  status?: 'active' | 'disabled';
}

export interface PolicyContext {
  serviceName?: string;
  capabilityId?: string;
  environment?: string;
}

function scopeMatches(scope: ConfigurablePolicyRule['scope'], ctx: PolicyContext): boolean {
  if (!scope) return true;
  if (scope.serviceName && scope.serviceName !== ctx.serviceName) return false;
  if (scope.capabilityId && scope.capabilityId !== ctx.capabilityId) return false;
  if (scope.environment && scope.environment !== ctx.environment) return false;
  return true;
}

const scopeSpecificity = (scope: ConfigurablePolicyRule['scope']): number =>
  (scope?.serviceName ? 1 : 0) + (scope?.capabilityId ? 1 : 0) + (scope?.environment ? 1 : 0);

/**
 * Resolve policy with configurable overlays:
 *   1. hardcoded safety blocks always win,
 *   2. else the most-specific active matching configured rule,
 *   3. else the hardcoded default.
 */
export function resolvePolicy(action: PolicyAction, ctx: PolicyContext, rules: ConfigurablePolicyRule[] = []): PolicyResult & { source: 'hardcoded_block' | 'config_rule' | 'default' } {
  if (HARDCODED_BLOCKS.includes(action)) {
    return { ...evaluatePolicy(action), decision: 'blocked', source: 'hardcoded_block' };
  }
  const matches = rules
    .filter((r) => (r.status ?? 'active') === 'active' && r.action === action && scopeMatches(r.scope, ctx))
    .sort((a, b) => scopeSpecificity(b.scope) - scopeSpecificity(a.scope));
  const rule = matches[0];
  if (rule) {
    return { decision: rule.decision, reason: rule.reason, requiredApprovalType: rule.requiredApprovalType, riskLevel: rule.riskLevel, source: 'config_rule' };
  }
  return { ...evaluatePolicy(action), source: 'default' };
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
