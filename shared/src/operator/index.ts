/**
 * Phase X — Autonomous Operator Runtime (Jarvis-class control layer).
 *
 * This module is the deterministic core of the operator runtime:
 *  - schemas for the 7 operator collections
 *  - the LIVE tool registry: every tool maps to a REAL code path (gateway
 *    internal, kernel task pipeline, operation-plan engine, or the
 *    code-operator-agent). Tools whose backing integration is not configured
 *    are registered with available=false and a reason — never faked.
 *  - the goal planner: goal → typed plan of tool steps
 *  - the dynamic capability answer ("what can you do?") built from the registry
 *  - failure classification → cause, next action, and mistake memory
 *
 * The runtime loop itself executes in the gateway (it owns DB + RBAC + safe
 * mode + approvals). Raw model output NEVER executes a tool: only planner
 * output and explicit human confirmations do.
 */
import { z } from 'zod';
import { IsoDate } from '../schemas/common.js';
import { isProtectedCore } from '../operations/index.js';
import { detectService } from '../voice/index.js';
import { genId, nowIso } from '../utils/index.js';

/* ============================== schemas ================================ */

export const OperatorToolCategory = z.enum([
  'read', 'reason', 'code', 'git', 'dokploy', 'service', 'test', 'security',
  'learning', 'memory', 'evidence', 'report', 'approval', 'repair', 'deploy',
]);
export type OperatorToolCategory = z.infer<typeof OperatorToolCategory>;

export const OperatorRisk = z.enum(['low', 'medium', 'high', 'critical']);
export type OperatorRisk = z.infer<typeof OperatorRisk>;

/** How a tool is actually executed — every value is a real code path. */
export const ToolExecutionPath = z.enum([
  'gateway_internal',    // implemented directly in the gateway
  'kernel_task',         // creates a real kernel task handled by agent pipelines
  'operation_plan',      // goes through the Phase 15/16 safe-operation engine
  'code_operator_agent', // executed by the code-operator-agent service
  'manual_required',     // real capability, but requires a documented manual step
]);
export type ToolExecutionPath = z.infer<typeof ToolExecutionPath>;

export const OperatorToolSchema = z.object({
  toolId: z.string(),
  name: z.string(),
  description: z.string(),
  category: OperatorToolCategory,
  /** Serializable field→type map (the zod schema lives in the code registry). */
  inputSchema: z.record(z.string(), z.string()).default({}),
  outputSchema: z.record(z.string(), z.string()).default({}),
  riskLevel: OperatorRisk,
  requiresApproval: z.boolean(),
  ownerOnly: z.boolean().default(false),
  serviceOwner: z.string(),
  endpoint: z.string().default(''),
  executionPath: ToolExecutionPath,
  timeoutMs: z.number().default(15000),
  rollbackAvailable: z.boolean().default(false),
  evidenceRequired: z.boolean().default(false),
  /** False when the backing integration is not configured (with reason). */
  available: z.boolean().default(true),
  unavailableReason: z.string().default(''),
  examples: z.array(z.string()).default([]),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type OperatorTool = z.infer<typeof OperatorToolSchema>;

export const OperatorToolRunSchema = z.object({
  toolRunId: z.string(),
  runtimeSessionId: z.string(),
  stepId: z.string().nullable().default(null),
  toolId: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(['running', 'succeeded', 'failed', 'blocked', 'awaiting_approval', 'manual_required']),
  resultSummary: z.string().default(''),
  failureCause: z.string().default(''),
  evidenceIds: z.array(z.string()).default([]),
  startedAt: IsoDate,
  finishedAt: z.string().nullable().default(null),
});
export type OperatorToolRun = z.infer<typeof OperatorToolRunSchema>;

export const OperatorToolPermissionSchema = z.object({
  permissionId: z.string(),
  runtimeSessionId: z.string(),
  stepId: z.string(),
  toolId: z.string(),
  prompt: z.string(),
  riskLevel: OperatorRisk,
  ownerOnly: z.boolean().default(false),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  decidedBy: z.string().nullable().default(null),
  createdAt: IsoDate,
  decidedAt: z.string().nullable().default(null),
});
export type OperatorToolPermission = z.infer<typeof OperatorToolPermissionSchema>;

export const RuntimeSessionStatus = z.enum([
  'planning', 'running', 'waiting_approval', 'waiting_user_input', 'verifying', 'completed', 'failed', 'cancelled',
]);
export type RuntimeSessionStatus = z.infer<typeof RuntimeSessionStatus>;

export const PlanStepSchema = z.object({
  stepId: z.string(),
  toolId: z.string(),
  reason: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(['pending', 'running', 'done', 'failed', 'skipped', 'awaiting_approval', 'manual_required']).default('pending'),
  observation: z.string().default(''),
  toolRunId: z.string().nullable().default(null),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const OperatorRuntimeSessionSchema = z.object({
  runtimeSessionId: z.string(),
  userId: z.string(),
  goal: z.string(),
  status: RuntimeSessionStatus,
  currentStep: z.number().default(0),
  plan: z.array(PlanStepSchema).default([]),
  toolRunIds: z.array(z.string()).default([]),
  approvalIds: z.array(z.string()).default([]),
  observations: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  reportSummary: z.string().default(''),
  memoryIds: z.array(z.string()).default([]),
  nextAction: z.string().default(''),
  startedAt: IsoDate,
  completedAt: z.string().nullable().default(null),
});
export type OperatorRuntimeSession = z.infer<typeof OperatorRuntimeSessionSchema>;

export const OperatorRuntimeStepSchema = z.object({
  stepRecordId: z.string(),
  runtimeSessionId: z.string(),
  stepId: z.string(),
  toolId: z.string(),
  narration: z.string(),
  observation: z.string().default(''),
  status: z.string(),
  createdAt: IsoDate,
});
export type OperatorRuntimeStep = z.infer<typeof OperatorRuntimeStepSchema>;

export const OperatorRuntimeMemorySchema = z.object({
  memoryId: z.string(),
  userId: z.string(),
  kind: z.enum(['mistake_avoidance', 'preference', 'mapping', 'workflow', 'decision']),
  content: z.string(),
  sourceSessionId: z.string().nullable().default(null),
  sourceToolId: z.string().nullable().default(null),
  createdAt: IsoDate,
});
export type OperatorRuntimeMemory = z.infer<typeof OperatorRuntimeMemorySchema>;

export const OperatorCapabilityIndexSchema = z.object({
  indexId: z.string(),
  category: OperatorToolCategory,
  toolCount: z.number(),
  availableCount: z.number(),
  summary: z.string(),
  updatedAt: IsoDate,
});
export type OperatorCapabilityIndex = z.infer<typeof OperatorCapabilityIndexSchema>;

/* ============================ tool registry ============================= */

export interface RegistryContext {
  dokployConfigured: boolean;
  codeWorkspaceConfigured: boolean;
  githubConfigured: boolean;
  voiceConfigured: boolean;
}

interface ToolSpec {
  toolId: string;
  name: string;
  description: string;
  category: OperatorToolCategory;
  risk: OperatorRisk;
  requiresApproval?: boolean;
  ownerOnly?: boolean;
  serviceOwner: string;
  endpoint?: string;
  executionPath: ToolExecutionPath;
  timeoutMs?: number;
  rollbackAvailable?: boolean;
  evidenceRequired?: boolean;
  input?: Record<string, string>;
  output?: Record<string, string>;
  examples?: string[];
  availableWhen?: (ctx: RegistryContext) => { ok: boolean; reason?: string };
}

const specs: ToolSpec[] = [
  /* -------- system / read (gateway internal, execute immediately) -------- */
  { toolId: 'get_system_status', name: 'Get system status', description: 'Live counts: tasks, approvals, environment.', category: 'read', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/system/status', executionPath: 'gateway_internal', output: { taskCount: 'number', pendingApprovals: 'number' }, examples: ['what is happening?'] },
  { toolId: 'get_readiness', name: 'Get readiness', description: 'Safe mode, Dokploy connection, active operation, open incidents.', category: 'read', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/operator (internal)', executionPath: 'gateway_internal', output: { safeMode: 'boolean', dokploy: 'string', openIncidents: 'number' } },
  { toolId: 'get_service_registry', name: 'List registered services', description: 'All services from the live service registry.', category: 'read', risk: 'low', serviceOwner: 'service-registry', endpoint: '/services', executionPath: 'gateway_internal', output: { services: 'array' }, examples: ['how many services are live?'] },
  { toolId: 'get_recent_events', name: 'Recent events', description: 'Latest kernel events.', category: 'read', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/events', executionPath: 'gateway_internal' },
  { toolId: 'get_recent_errors', name: 'Recent errors & incidents', description: 'Open incidents and recent error-level events.', category: 'read', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/incidents', executionPath: 'gateway_internal' },
  { toolId: 'get_pending_approvals', name: 'Pending approvals', description: 'Approvals waiting for a decision.', category: 'read', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/approvals', executionPath: 'gateway_internal' },
  { toolId: 'get_active_operations', name: 'Active operations', description: 'Operation plans currently in flight.', category: 'read', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/operations/active', executionPath: 'gateway_internal' },
  { toolId: 'check_service_health', name: 'Check service health', description: 'Real /health + registry verification for one service; evidence stored.', category: 'read', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', evidenceRequired: true, input: { targetService: 'string' }, examples: ['check gateway health'] },
  { toolId: 'run_system_status_check', name: 'Whole-system check', description: 'Read-only aggregation: services, tasks, approvals, incidents, safe mode, Dokploy sync. Evidence stored.', category: 'read', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', evidenceRequired: true, examples: ['check the whole system'] },
  { toolId: 'show_evidence', name: 'Show evidence', description: 'Most recent evidence records.', category: 'evidence', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/evidence', executionPath: 'gateway_internal' },
  { toolId: 'get_latest_report', name: 'Latest report', description: 'Most recent intelligence report.', category: 'report', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/reports', executionPath: 'gateway_internal' },

  /* ------------------------------ tasks --------------------------------- */
  { toolId: 'create_task', name: 'Create kernel task', description: 'Create a task and hand it to the orchestrator pipeline.', category: 'service', risk: 'medium', requiresApproval: true, serviceOwner: 'orchestrator-agent', endpoint: '/v1/tasks', executionPath: 'kernel_task', input: { goal: 'string' } },
  { toolId: 'get_task', name: 'Get task', description: 'Task detail + timeline.', category: 'read', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/tasks/:id', executionPath: 'gateway_internal', input: { taskId: 'string' } },
  { toolId: 'summarize_task', name: 'Summarize task', description: 'Compact status summary of a task.', category: 'read', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', input: { taskId: 'string' } },

  /* --------------------------- operations ------------------------------- */
  { toolId: 'classify_operation_risk', name: 'Classify operation risk', description: 'Deterministic risk classification incl. protected-core detection.', category: 'reason', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', input: { targetService: 'string', operationType: 'string' }, output: { riskLevel: 'string', protectedCore: 'boolean' } },
  { toolId: 'create_operation_plan', name: 'Create operation plan', description: 'Plan a service operation (restart/update/repair) through the safe-operation engine.', category: 'service', risk: 'high', requiresApproval: true, serviceOwner: 'gateway-api', endpoint: '/v1/operations', executionPath: 'operation_plan', rollbackAvailable: true, evidenceRequired: true, input: { goal: 'string', operationType: 'string', targetService: 'string' } },
  { toolId: 'verify_operation', name: 'Verify operation', description: 'Run real verification (health/registry) for an operation plan.', category: 'read', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', evidenceRequired: true, input: { operationPlanId: 'string' } },
  { toolId: 'approve_operation', name: 'Approve operation', description: 'Owner-visible approval on the Overview — never silent.', category: 'approval', risk: 'critical', requiresApproval: true, ownerOnly: true, serviceOwner: 'gateway-api', endpoint: '/v1/operations/:id/decision', executionPath: 'gateway_internal' },
  { toolId: 'execute_operation', name: 'Execute operation', description: 'Execute an APPROVED operation via Dokploy API or guided manual steps.', category: 'deploy', risk: 'high', requiresApproval: true, serviceOwner: 'gateway-api', endpoint: '/v1/operations/:id/executed', executionPath: 'operation_plan', rollbackAvailable: true, evidenceRequired: true },
  { toolId: 'rollback_operation', name: 'Rollback operation', description: 'Roll back an executed operation from its snapshot.', category: 'repair', risk: 'high', requiresApproval: true, ownerOnly: true, serviceOwner: 'gateway-api', endpoint: '/v1/operations/:id/rollback', executionPath: 'operation_plan', rollbackAvailable: false, evidenceRequired: true },

  /* ------------------------------ dokploy ------------------------------- */
  { toolId: 'test_dokploy_connection', name: 'Test Dokploy connection', description: 'Live Dokploy API connectivity check.', category: 'dokploy', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/dokploy/status', executionPath: 'gateway_internal', availableWhen: (c) => c.dokployConfigured ? { ok: true } : { ok: false, reason: 'DOKPLOY_API_TOKEN not configured' } },
  { toolId: 'sync_dokploy_targets', name: 'Sync Dokploy targets', description: 'Read-only discovery of Dokploy projects/apps into targets.', category: 'dokploy', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/dokploy/sync', executionPath: 'gateway_internal', availableWhen: (c) => c.dokployConfigured ? { ok: true } : { ok: false, reason: 'Dokploy API not configured — manual target confirmation available' } },
  { toolId: 'list_dokploy_targets', name: 'List Dokploy targets', description: 'Synced Dokploy targets and AOS mapping.', category: 'dokploy', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/dokploy-targets', executionPath: 'gateway_internal' },
  { toolId: 'run_dokploy_diagnostics', name: 'Dokploy API diagnostics', description: 'Read-only endpoint probes, secrets redacted.', category: 'dokploy', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/dokploy/diagnostics', executionPath: 'gateway_internal', availableWhen: (c) => c.dokployConfigured ? { ok: true } : { ok: false, reason: 'Dokploy API not configured' } },
  { toolId: 'restart_dokploy_app', name: 'Restart Dokploy app', description: 'Restart a NON-CORE app through the safe-operation engine (approval + snapshot + verify).', category: 'deploy', risk: 'high', requiresApproval: true, serviceOwner: 'gateway-api', executionPath: 'operation_plan', rollbackAvailable: true, evidenceRequired: true, input: { targetService: 'string' } },
  { toolId: 'deploy_dokploy_app', name: 'Deploy Dokploy app', description: 'Deploy/update a NON-CORE app through the safe-operation engine.', category: 'deploy', risk: 'high', requiresApproval: true, serviceOwner: 'gateway-api', executionPath: 'operation_plan', rollbackAvailable: true, evidenceRequired: true, input: { targetService: 'string' } },
  { toolId: 'read_dokploy_logs', name: 'Read Dokploy logs', description: 'Container logs via the Dokploy UI — the read endpoint is not calibrated on this instance yet.', category: 'dokploy', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'manual_required' },

  /* -------------------------------- code -------------------------------- */
  { toolId: 'inspect_repo', name: 'Inspect repository', description: 'List the project structure inside the code workspace.', category: 'code', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', input: { path: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured on code-operator-agent' } },
  { toolId: 'search_code', name: 'Search code', description: 'Search the workspace for a pattern.', category: 'code', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', input: { pattern: 'string', path: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'propose_code_change', name: 'Propose code change', description: 'Dry-run patch preview (find/replace per file) — nothing is written.', category: 'code', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', input: { file: 'string', find: 'string', replace: 'string' }, output: { preview: 'string', protectedCore: 'boolean' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'edit_code', name: 'Apply code change', description: 'Apply a reviewed patch in an isolated branch. Protected-core paths require owner approval.', category: 'code', risk: 'medium', requiresApproval: true, serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', evidenceRequired: true, input: { file: 'string', find: 'string', replace: 'string', branch: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'run_typecheck', name: 'Run typecheck', description: 'tsc --noEmit for a package in the workspace.', category: 'test', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', timeoutMs: 120000, input: { package: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'build_package', name: 'Build package', description: 'Build one package in the workspace.', category: 'test', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', timeoutMs: 300000, input: { package: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'run_smoke_tests', name: 'Run smoke tests', description: 'Execute a repo smoke script (scripts/*.mjs) and capture the result.', category: 'test', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', timeoutMs: 120000, input: { script: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'create_git_branch', name: 'Create git branch', description: 'Create an isolated work branch in the workspace.', category: 'git', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', input: { branch: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'commit_changes', name: 'Commit changes', description: 'Commit staged workspace changes on the work branch.', category: 'git', risk: 'medium', requiresApproval: true, serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', evidenceRequired: true, input: { message: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'create_pr', name: 'Create pull request', description: 'Open a PR on GitHub for the work branch.', category: 'git', risk: 'medium', requiresApproval: true, serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', availableWhen: (c) => c.githubConfigured && c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'GITHUB_TOKEN and/or CODE_WORKSPACE_ROOT not configured' } },

  /* ------------------------------ services ------------------------------ */
  { toolId: 'create_new_service', name: 'Create new service', description: 'Kick off the real service-creation pipeline (architect → builder → validation).', category: 'service', risk: 'medium', requiresApproval: true, serviceOwner: 'orchestrator-agent', executionPath: 'kernel_task', input: { goal: 'string' }, examples: ['create a small status-check service'] },
  { toolId: 'validate_service', name: 'Validate service', description: 'Run the activation checklist validation for a service.', category: 'test', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/checklists', executionPath: 'gateway_internal', input: { serviceId: 'string' } },
  { toolId: 'activate_service', name: 'Activate service', description: 'Run live activation checks against a deployed service.', category: 'deploy', risk: 'medium', requiresApproval: true, serviceOwner: 'gateway-api', endpoint: '/v1/checklists/:id/activate', executionPath: 'gateway_internal', evidenceRequired: true },
  { toolId: 'repair_service', name: 'Repair service', description: 'Diagnose → repair-plan → approval flow for a failing service.', category: 'repair', risk: 'high', requiresApproval: true, serviceOwner: 'gateway-api', endpoint: '/v1/repair-plans/:id/decision', executionPath: 'operation_plan', rollbackAvailable: true, evidenceRequired: true, input: { serviceId: 'string' } },

  /* ---------------------------- intelligence ---------------------------- */
  { toolId: 'research_topic', name: 'Research topic', description: 'Research → plan → review → QA → report pipeline.', category: 'learning', risk: 'low', serviceOwner: 'internet-research-service', executionPath: 'kernel_task', input: { goal: 'string' }, examples: ['research current Fastify best practices'] },
  { toolId: 'analyze_history', name: 'Analyze system history', description: 'Learning pipeline over real history: reliability, patterns, recommendations.', category: 'learning', risk: 'low', serviceOwner: 'memory-agent', executionPath: 'kernel_task', examples: ['analyze history and recommend improvements'] },
  { toolId: 'run_security_check', name: 'Run security check', description: 'Production security check: env, secrets, tokens, session, safe mode.', category: 'security', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/security/check', executionPath: 'gateway_internal', evidenceRequired: true },
  { toolId: 'generate_report', name: 'Generate report', description: 'Human-readable report via the report pipeline.', category: 'report', risk: 'low', serviceOwner: 'report-agent', executionPath: 'kernel_task' },
  { toolId: 'recommend_improvements', name: 'Recommend improvements', description: 'System recommendations from the learning engine.', category: 'learning', risk: 'low', serviceOwner: 'memory-agent', endpoint: '/v1/system-recommendations', executionPath: 'gateway_internal' },

  /* ------------------------------- memory ------------------------------- */
  { toolId: 'read_relevant_memory', name: 'Read memory', description: 'Operator memories relevant to the current goal.', category: 'memory', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal' },
  { toolId: 'write_memory', name: 'Write memory', description: 'Persist a decision/workflow memory.', category: 'memory', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', input: { kind: 'string', content: 'string' } },
  { toolId: 'write_mistake_memory', name: 'Write mistake memory', description: 'Persist a mistake-avoidance memory after a failure.', category: 'memory', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', input: { content: 'string' } },
  { toolId: 'update_user_preference', name: 'Update user preference', description: 'Remember an operator preference.', category: 'memory', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', input: { content: 'string' } },

  /* ------------------------------ approval ------------------------------ */
  { toolId: 'request_approval', name: 'Request approval', description: 'Create an approval card (dock + Overview) for a gated step.', category: 'approval', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', input: { prompt: 'string', riskLevel: 'string' } },
  { toolId: 'explain_risk', name: 'Explain risk', description: 'Deterministic risk explanation for a proposed action.', category: 'reason', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', input: { targetService: 'string', operationType: 'string' } },
  { toolId: 'record_decision', name: 'Record decision', description: 'Audit-log a human decision with reason.', category: 'approval', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', input: { decision: 'string', reason: 'string' } },
];

/** Build the live registry. Availability is computed from the real context — never faked. */
export function buildOperatorToolRegistry(ctx: RegistryContext): OperatorTool[] {
  const now = nowIso();
  return specs.map((s) => {
    const avail = s.availableWhen ? s.availableWhen(ctx) : { ok: true };
    return OperatorToolSchema.parse({
      toolId: s.toolId, name: s.name, description: s.description, category: s.category,
      inputSchema: s.input ?? {}, outputSchema: s.output ?? {},
      riskLevel: s.risk, requiresApproval: s.requiresApproval ?? false, ownerOnly: s.ownerOnly ?? false,
      serviceOwner: s.serviceOwner, endpoint: s.endpoint ?? '', executionPath: s.executionPath,
      timeoutMs: s.timeoutMs ?? 15000, rollbackAvailable: s.rollbackAvailable ?? false,
      evidenceRequired: s.evidenceRequired ?? false,
      available: avail.ok, unavailableReason: avail.ok ? '' : (avail.reason ?? 'not configured'),
      examples: s.examples ?? [], createdAt: now, updatedAt: now,
    });
  });
}

/* ======================= dynamic capability answer ====================== */

const CATEGORY_LABELS: Partial<Record<OperatorToolCategory, string>> = {
  read: 'Inspect', code: 'Code', git: 'Git', dokploy: 'Dokploy', service: 'Services', test: 'Test & build',
  security: 'Security', learning: 'Learning & research', memory: 'Memory', evidence: 'Evidence',
  report: 'Reports', approval: 'Approvals', repair: 'Repair', deploy: 'Deploy', reason: 'Reasoning',
};

/** Build the "what can you do?" answer from the LIVE registry — grouped,
 *  with examples, risk labels and approval requirements. Never hardcoded. */
export function buildCapabilityAnswer(tools: OperatorTool[]): { spoken: string; groups: Array<{ category: string; label: string; tools: Array<{ toolId: string; name: string; riskLevel: string; requiresApproval: boolean; available: boolean; unavailableReason: string; example: string }> }> } {
  const byCat = new Map<string, OperatorTool[]>();
  for (const t of tools) {
    if (!byCat.has(t.category)) byCat.set(t.category, []);
    (byCat.get(t.category) as OperatorTool[]).push(t);
  }
  const groups = [...byCat.entries()].map(([category, list]) => ({
    category,
    label: CATEGORY_LABELS[category as OperatorToolCategory] ?? category,
    tools: list.map((t) => ({ toolId: t.toolId, name: t.name, riskLevel: t.riskLevel, requiresApproval: t.requiresApproval, available: t.available, unavailableReason: t.unavailableReason, example: t.examples[0] ?? '' })),
  }));
  const available = tools.filter((t) => t.available);
  const immediate = available.filter((t) => !t.requiresApproval && t.riskLevel === 'low').length;
  const gated = available.filter((t) => t.requiresApproval).length;
  const catList = groups.filter((g) => g.tools.some((t) => t.available)).map((g) => g.label.toLowerCase());
  const spoken = `I run ${available.length} live tools across ${catList.length} areas: ${catList.join(', ')}. ` +
    `${immediate} read/low-risk tools execute immediately; ${gated} mutating tools require approval. ` +
    `Protected core changes always need owner approval on the Overview. ` +
    `Examples: “check the whole system”, “check gateway health”, “analyze history”, “research a topic”, “propose a code change”, “create a status-check service”.`;
  return { spoken, groups };
}

/* ============================== planner ================================ */

export type CommandKind = 'capability_question' | 'runtime_goal' | 'single_tool' | 'clarify';

export interface PlannedCommand {
  kind: CommandKind;
  /** For runtime_goal: ordered plan; for single_tool: exactly one step. */
  steps: PlanStep[];
  narration: string;
}

const step = (toolId: string, reason: string, args: Record<string, unknown> = {}): PlanStep =>
  PlanStepSchema.parse({ stepId: genId('step'), toolId, reason, args });

export function isCapabilityQuestion(text: string): boolean {
  return /(what can you do|what are you able|your (capabilities|tools)|list (your )?tools|^help$|what do you know how)/i.test(text.trim());
}

/** Deterministic goal → plan. Same goal + context ⇒ same plan. */
export function planForGoal(goal: string, ctx: { safeMode: boolean; role: string }): PlannedCommand {
  const t = goal.trim().toLowerCase();
  const svc = detectService(goal);

  if (isCapabilityQuestion(goal)) {
    return { kind: 'capability_question', steps: [], narration: 'Answering from the live tool registry.' };
  }

  // Whole-system check → read-only multi-step plan.
  if (/(check|inspect|verify).*(whole system|entire system|all services|everything|the system)|system (check|status|health)/.test(t)) {
    return {
      kind: 'runtime_goal',
      narration: 'Planning a read-only whole-system check.',
      steps: [
        step('get_system_status', 'Baseline counts'),
        step('get_service_registry', 'Live services'),
        step('get_recent_errors', 'Open incidents and errors'),
        step('get_pending_approvals', 'Anything waiting on you'),
        step('get_active_operations', 'Operations in flight'),
        step('run_system_status_check', 'Aggregate + store evidence'),
      ],
    };
  }

  // New service creation → real pipeline + gated deploy (checked BEFORE the
  // generic deploy branch: "create X and deploy it" is a creation goal).
  if (/create .*(service|agent|app)/.test(t)) {
    return {
      kind: 'runtime_goal',
      narration: 'Planning service creation through the real pipeline, then a gated non-core deployment.',
      steps: [
        step('create_new_service', 'Architect → builder → validation pipeline (approval required)', { goal }),
        step('create_operation_plan', 'Gated Dokploy deployment for the new non-core app', { goal: `Deploy new service: ${goal}`, operationType: 'new_app_deploy', targetService: '' }),
        step('check_service_health', 'Verify the deployed service answers /health'),
      ],
    };
  }

  // Service mutation → risk classification then the safe-operation engine.
  if (/\b(restart|redeploy|deploy|reload)\b/.test(t)) {
    const target = svc ?? '';
    const protectedCore = isProtectedCore(target);
    return {
      kind: 'runtime_goal',
      narration: protectedCore
        ? `${target} is protected core — this is a critical operation requiring owner approval on the Overview.`
        : `Planning a gated ${/deploy/.test(t) ? 'deploy' : 'restart'} of ${target || 'the target service'} through the safe-operation engine.`,
      steps: [
        step('classify_operation_risk', 'Deterministic risk + protected-core detection', { targetService: target, operationType: /deploy|redeploy/.test(t) ? 'existing_app_update' : 'existing_app_restart' }),
        step('create_operation_plan', 'Snapshot + approval + verify path', { goal, operationType: /deploy|redeploy/.test(t) ? 'existing_app_update' : 'existing_app_restart', targetService: target }),
      ],
    };
  }

  // Self-improvement / code goals → inspect → propose → (approval) apply → verify.
  if (/(fix|improve|refactor|implement|clean up|find .*(wrong|bug|issue)).*/.test(t) && /(code|ui|console|dock|page|component|service|operator|file)/.test(t)) {
    return {
      kind: 'runtime_goal',
      narration: 'Planning a code improvement in an isolated branch: inspect → propose → approve → apply → typecheck.',
      steps: [
        step('inspect_repo', 'Understand the relevant area', { path: 'services/dashboard-web/src' }),
        step('search_code', 'Locate the target', { pattern: goal.slice(0, 60), path: 'services/dashboard-web/src' }),
        step('propose_code_change', 'Dry-run patch preview — nothing written'),
        step('edit_code', 'Apply the reviewed patch on an isolated branch (approval required)'),
        step('run_typecheck', 'Prove the change compiles', { package: 'services/dashboard-web' }),
      ],
    };
  }

  // Intelligence pipelines as single gated-lite tools.
  if (/(analy[sz]e|analysis).*(history|system)|recommend improvements/.test(t)) return { kind: 'single_tool', narration: 'Learning pipeline over real history.', steps: [step('analyze_history', 'Learning pipeline (never Dokploy)')] };
  if (/security (check|audit)|harden/.test(t)) return { kind: 'single_tool', narration: 'Production security check.', steps: [step('run_security_check', 'Security pipeline')] };
  if (/research|best practices?|investigate/.test(t)) return { kind: 'single_tool', narration: 'Research pipeline.', steps: [step('research_topic', 'Intelligence pipeline', { goal })] };
  if (/\b(health|is .* up|reachable)\b/.test(t) || (/check/.test(t) && svc)) return { kind: 'single_tool', narration: `Read-only health check${svc ? ` on ${svc}` : ''}.`, steps: [step('check_service_health', 'Real /health + registry verification', { targetService: svc ?? '' })] };

  return { kind: 'clarify', steps: [], narration: `I heard: “${goal.trim().slice(0, 80)}”. Give me a goal I can plan — a system check, a service operation, a code improvement, research, or a new service.` };
}

/* ========================= failure classification ======================= */

export interface FailureAnalysis {
  cause: string;
  nextAction: string;
  mistakeMemory: string | null;
}

/** Every failure must say what failed, why it likely failed, and what's next. */
export function classifyToolFailure(toolId: string, error: string): FailureAnalysis {
  const e = error.toLowerCase();
  if (/not configured|not_configured/.test(e)) {
    return { cause: `${toolId} needs an integration that is not configured.`, nextAction: 'Set the required environment variables on the owning service, or use the documented manual path.', mistakeMemory: `Tool ${toolId} unavailable without configuration — check availability before planning it.` };
  }
  if (/timeout|abort|econnrefused|unreachable|fetch failed/.test(e)) {
    return { cause: `${toolId} could not reach its backing service.`, nextAction: 'Run a health check on the owning service; if it is down, plan a gated repair operation.', mistakeMemory: null };
  }
  if (/403|forbidden|rbac|owner/.test(e)) {
    return { cause: `${toolId} was denied by RBAC/ownership rules.`, nextAction: 'This action needs a higher role or owner approval on the Overview.', mistakeMemory: `Tool ${toolId} requires elevated approval — request it up front.` };
  }
  if (/safe mode/.test(e)) {
    return { cause: 'Safe mode is ON, so mutations are blocked.', nextAction: 'Disable safe mode from Security (owner) or keep to read-only tools.', mistakeMemory: null };
  }
  if (/protected core/.test(e)) {
    return { cause: 'The target is a protected core service.', nextAction: 'Owner-visible approval on the Overview is the only path — or run a read-only health check instead.', mistakeMemory: 'Never route protected-core mutations through auto-execution.' };
  }
  return { cause: `${toolId} failed: ${error.slice(0, 160)}`, nextAction: 'Inspect recent events and evidence; retry once the cause is fixed.', mistakeMemory: null };
}

/* ============================== narration =============================== */

/** Short, meaningful progress line for a completed step — operator voice. */
export function narrateStep(toolName: string, ok: boolean, observation: string): string {
  const obs = observation.trim();
  return ok ? (obs ? obs : `${toolName} completed.`) : `${toolName} failed. ${obs}`.trim();
}
