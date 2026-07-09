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
import { ScopeFieldsSchema } from '../schemas/scope.js';

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
}).merge(ScopeFieldsSchema);
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
  /** Cross-step context (workspaceId, migrationId, …) written by tool results. */
  context: z.record(z.string(), z.unknown()).default({}),
  evidenceIds: z.array(z.string()).default([]),
  reportSummary: z.string().default(''),
  memoryIds: z.array(z.string()).default([]),
  nextAction: z.string().default(''),
  startedAt: IsoDate,
  completedAt: z.string().nullable().default(null),
  // Phase AF.4 — the grounded, LLM-composed reply is now produced in the
  // background (after the HTTP response already returned an immediate,
  // deterministic acknowledgement), so it needs somewhere to land once
  // ready. The client's existing session poll picks it up here instead of
  // waiting for it synchronously. Empty string = not composed yet (still
  // running, or this was never a route_to_planner turn).
  composedReply: z.string().default(''),
  composedLanguage: z.string().default(''),
  composedFollowUps: z.array(z.string()).default([]),
}).merge(ScopeFieldsSchema);
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
  { toolId: 'research_topic', name: 'Research topic', description: 'Live research on any topic via internet-research-service, awaited in this reply — Tavily web search when TAVILY_API_KEY is configured there, honest LLM-recall/curated fallback otherwise; sourceMode always reported, never fabricated URLs.', category: 'learning', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/.factory/task (internet-research-service)', executionPath: 'gateway_internal', input: { goal: 'string' }, examples: ['research current Fastify best practices', 'find current AI lighting design trends in Dubai luxury interiors'] },
  { toolId: 'analyze_history', name: 'Analyze system history', description: 'Learning pipeline over real history: reliability, patterns, recommendations.', category: 'learning', risk: 'low', serviceOwner: 'memory-agent', executionPath: 'kernel_task', examples: ['analyze history and recommend improvements'] },
  { toolId: 'run_security_check', name: 'Run security check', description: 'Production security check: env, secrets, tokens, session, safe mode.', category: 'security', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/security/check', executionPath: 'gateway_internal', evidenceRequired: true },
  { toolId: 'generate_report', name: 'Generate report', description: 'Human-readable report via the report pipeline.', category: 'report', risk: 'low', serviceOwner: 'report-agent', executionPath: 'kernel_task' },
  { toolId: 'recommend_improvements', name: 'Recommend improvements', description: 'System recommendations from the learning engine.', category: 'learning', risk: 'low', serviceOwner: 'memory-agent', endpoint: '/v1/system-recommendations', executionPath: 'gateway_internal' },

  /* ------------------------------- memory ------------------------------- */
  { toolId: 'read_relevant_memory', name: 'Read memory', description: 'Operator memories relevant to the current goal.', category: 'memory', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal' },
  { toolId: 'write_memory', name: 'Write memory', description: 'Persist a decision/workflow memory.', category: 'memory', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', input: { kind: 'string', content: 'string' } },
  { toolId: 'write_mistake_memory', name: 'Write mistake memory', description: 'Persist a mistake-avoidance memory after a failure.', category: 'memory', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', input: { content: 'string' } },
  { toolId: 'update_user_preference', name: 'Update user preference', description: 'Remember an operator preference.', category: 'memory', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', input: { content: 'string' } },

  /* ---------- Phase Y — staging workspace & service evolution ----------- */
  // Inside the isolated workspace: low risk, NO approval per step — isolation
  // is the safety boundary; limits are the guardrail.
  { toolId: 'create_workspace', name: 'Create workspace', description: 'Create an isolated staging workspace under .workspaces/ (disposable, repeatable).', category: 'code', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', input: { goal: 'string', mode: 'string', sourceServiceId: 'string?' }, output: { workspaceId: 'string' }, examples: ['improve the operator console UI'], availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'copy_service_to_workspace', name: 'Copy service to workspace', description: 'Copy an existing service into the workspace (source untouched, commit recorded).', category: 'code', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', input: { goal: 'string', sourceServiceId: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'create_new_service_workspace', name: 'Generate new service in workspace', description: 'Generate a complete real factory service (endpoints/manifest/env/README/Dokploy spec) with allocated id/port/subdomain.', category: 'service', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', input: { goal: 'string', newServiceName: 'string', description: 'string' }, output: { workspaceId: 'string', newService: 'object' }, examples: ['create a status-inspector service'], availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'inspect_workspace', name: 'Inspect workspace', description: 'List workspace structure and status.', category: 'code', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', input: { workspaceId: 'string', path: 'string?' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'edit_workspace', name: 'Edit workspace (multi-file)', description: 'Apply a batch of deep multi-file edits inside the isolated workspace (bounded by WORKSPACE_MAX_FILES_CHANGED).', category: 'code', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', input: { workspaceId: 'string', edits: 'array<{file,content|find+replace}>' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'run_workspace_typecheck', name: 'Workspace typecheck', description: 'tsc --noEmit for the workspace service.', category: 'test', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', timeoutMs: 180000, input: { workspaceId: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'run_workspace_build', name: 'Workspace build', description: 'Build the workspace service (tsc → dist, or next build for web).', category: 'test', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', timeoutMs: 420000, input: { workspaceId: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'run_workspace_tests', name: 'Workspace check-fix loop', description: 'Iterate the verification matrix with deterministic autofixes until green or the configured limits pause it.', category: 'test', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', timeoutMs: 600000, input: { workspaceId: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'start_workspace_service', name: 'Run workspace service', description: 'Boot the workspace service on a free temporary port and probe /health + .factory endpoints; logs captured; process stopped after.', category: 'test', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', timeoutMs: 120000, input: { workspaceId: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'verify_workspace_service', name: 'Verify workspace (matrix)', description: 'Run the full verification matrix: structure, deps, typecheck, build, boot, health/manifest/status/token-guard, env, docs, Dokploy spec.', category: 'test', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', timeoutMs: 600000, evidenceRequired: true, input: { workspaceId: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'create_migration_plan', name: 'Create migration plan', description: 'From a GREEN workspace: migration type, risk (protected core ⇒ critical/owner), changed files, staged Dokploy app, rollback plan. Approval always required before anything live.', category: 'service', risk: 'low', serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', input: { workspaceId: 'string' }, output: { migrationId: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  // Live-touching workspace tools: ALWAYS gated.
  { toolId: 'approve_migration', name: 'Approve migration', description: 'Human decision on a workspace migration plan.', category: 'approval', risk: 'medium', requiresApproval: true, serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', input: { migrationId: 'string', decision: 'string' } },
  { toolId: 'deploy_staged_workspace', name: 'Deploy staged app', description: 'Create the gated operation plan that deploys the workspace result as a STAGED Dokploy app (temporary subdomain) — verified before promotion.', category: 'deploy', risk: 'high', requiresApproval: true, serviceOwner: 'gateway-api', executionPath: 'operation_plan', rollbackAvailable: true, evidenceRequired: true, input: { appName: 'string', rootDirectory: 'string' } },
  { toolId: 'promote_workspace', name: 'Promote workspace', description: 'After approval: snapshot branch + copy the workspace service over services/<target> on that branch + commit. Default branch untouched; old version preserved. Protected core requires owner.', category: 'deploy', risk: 'high', requiresApproval: true, serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', rollbackAvailable: true, evidenceRequired: true, input: { workspaceId: 'string', migrationId: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },
  { toolId: 'rollback_workspace', name: 'Rollback workspace promotion', description: 'Restore the default branch; the promote branch is preserved for inspection.', category: 'repair', risk: 'high', requiresApproval: true, serviceOwner: 'code-operator-agent', executionPath: 'code_operator_agent', input: { workspaceId: 'string' }, availableWhen: (c) => c.codeWorkspaceConfigured ? { ok: true } : { ok: false, reason: 'CODE_WORKSPACE_ROOT not configured' } },

  /* -------- Phase AA — personal operating layer (user scope only) ------- */
  { toolId: 'get_my_context', name: 'Read my context', description: 'User-scoped profile, active goals, constraints and consent status. Never reads kernel data as personal data.', category: 'read', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/me/context', executionPath: 'gateway_internal', examples: ['plan my week'] },
  { toolId: 'generate_daily_briefing', name: 'Generate briefing', description: 'Honest user-scoped briefing from the data that actually exists (goals, memories); missing connectors are reported not_configured — never invented.', category: 'report', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', examples: ['plan my week', 'daily briefing'] },

  /* ---- Phase AB — Jarvis personal intelligence (user scope, honest) ---- */
  { toolId: 'build_reality_baseline', name: 'Build reality baseline', description: 'Assemble the personal intelligence graph from scoped records; list every missing data category with how to add it.', category: 'read', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/me/reality/profile', executionPath: 'gateway_internal', examples: ['build my personal reality baseline'] },
  { toolId: 'get_next_best_actions', name: 'Next best actions', description: 'Deterministic ranked actions from risks, approvals, goal-linked opportunities and data gaps — specific reasons, never generic.', category: 'read', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/me/reality/next-actions', executionPath: 'gateway_internal', examples: ['what should I do now?'] },
  { toolId: 'run_full_daily_briefing', name: 'Daily briefing (full)', description: 'Full briefing run: top-3 priorities, risks, income/growth/AOS actions, approvals, missing data — stored and scoped.', category: 'report', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/me/reality/review', executionPath: 'gateway_internal', evidenceRequired: true, examples: ['run my daily briefing'] },
  { toolId: 'run_weekly_strategy', name: 'Weekly strategy review', description: 'Goals vs actions vs opportunities; ranked weekly plan; what AOS should build; what needs approval.', category: 'report', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/me/reality/review', executionPath: 'gateway_internal', evidenceRequired: true, examples: ['weekly strategy review'] },
  { toolId: 'analyze_resume', name: 'Analyze resume', description: 'Only provided/scoped resume data; separates verified facts, user claims, inferences and suggestions — never invents credentials.', category: 'read', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', examples: ['analyze my resume'] },
  { toolId: 'find_opportunities', name: 'Rank opportunities', description: 'Score recorded opportunities (impact/effort/risk/goal-linkage) with source + confidence; when none are recorded, researches the goal live via internet-research-service instead of a static claim — sourceMode always reported honestly.', category: 'read', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/me/reality/opportunities', executionPath: 'gateway_internal', examples: ['find the best opportunities for me'] },
  { toolId: 'capture_personal_goal', name: 'Capture personal goal', description: 'Store one user-scoped active goal from the conversation and immediately re-rank actions.', category: 'service', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/me/goals', executionPath: 'gateway_internal', input: { title: 'string', horizon: 'string?', priority: 'string?', description: 'string?' }, examples: ['my goal is to earn 5k more this month'] },
  { toolId: 'capture_reality_profile', name: 'Capture reality profile', description: 'Store a minimal personal reality profile (headline/focus/current position) from the conversation.', category: 'service', risk: 'low', serviceOwner: 'gateway-api', endpoint: '/v1/me/reality/ingest', executionPath: 'gateway_internal', input: { headline: 'string', currentPosition: 'string?', focusArea: 'string?' }, examples: ['my current role is product engineer and my focus is automation'] },
  { toolId: 'propose_aos_build', name: 'Propose AOS build', description: 'Identify the highest-value missing AOS capability for the user; building it routes through GLOBAL workspace evolution with approval.', category: 'reason', risk: 'low', serviceOwner: 'gateway-api', executionPath: 'gateway_internal', examples: ['what should AOS build next for me?'] },

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

function extractGoalTitle(text: string): string {
  const trimmed = text.trim();
  const m =
    trimmed.match(/(?:^|\b)(?:my goal is|goal\s*:|i want to|i need to)\s+(.+)$/i) ??
    trimmed.match(/^(.+)$/);
  return (m?.[1] ?? '').trim().replace(/[.?!]+$/, '').slice(0, 160);
}

function extractProfileHints(text: string): { headline?: string; currentPosition?: string; focusArea?: string } {
  const t = text.trim();
  const out: { headline?: string; currentPosition?: string; focusArea?: string } = {};
  const role = t.match(/(?:my role is|i am|i'm)\s+([^.,;]+)/i)?.[1]?.trim();
  const focus = t.match(/(?:my focus is|focused on|focus on)\s+([^.,;]+)/i)?.[1]?.trim();
  if (role) out.currentPosition = role.slice(0, 120);
  if (focus) out.focusArea = focus.slice(0, 120);
  if (role || focus) out.headline = `${role ?? 'Builder'}${focus ? ` — focus: ${focus}` : ''}`.slice(0, 180);
  return out;
}

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

  // New service creation → Phase Y staging workspace: generate the complete
  // real service, verify it end-to-end (typecheck/build/boot/probes), then a
  // migration plan with a staged Dokploy app. (Checked BEFORE the generic
  // deploy branch: "create X and deploy it" is a creation goal.)
  if (/create .*(service|agent|app)/.test(t)) {
    const nameMatch = t.match(/create (?:a |an |new )*([a-z0-9][a-z0-9 -]{2,50}?)(?: service| agent| app| that| which|,|\.|$)/);
    const newServiceName = `${(nameMatch?.[1] ?? 'new').trim().split(/\s+/).slice(0, 3).join('-')}-service`.replace(/-service-service$/, '-service');
    return {
      kind: 'runtime_goal',
      narration: `Planning a new service “${newServiceName}” in an isolated workspace: generate → verify matrix (typecheck, build, boot on temp port, factory probes) → migration plan with staged deployment. Approval gates anything live.`,
      steps: [
        step('create_new_service_workspace', 'Generate the complete real service in an isolated workspace', { goal, mode: 'create_new_service', newServiceName, description: goal }),
        step('run_workspace_tests', 'Verify + AUTO-FIX loop: typecheck, build, temp-port boot, all six factory probes — repaired until GREEN or limits'),
        step('create_migration_plan', 'Migration + staged Dokploy app + rollback plan (approval required to proceed)'),
      ],
    };
  }

  // Existing-service evolution / repair / refactor / UI upgrade → Phase Y
  // isolated workspace copy. Deep edits happen freely INSIDE the workspace;
  // only migration/promotion is gated (owner for protected core).
  if (svc && /(improve|upgrade|evolve|redesign|refactor|repair|fix|modernize|rework)/.test(t)) {
    const core = isProtectedCore(svc);
    const mode = /repair|fix/.test(t) ? 'repair_service' : svc === 'dashboard-web' ? 'upgrade_ui' : 'evolve_existing_service';
    return {
      kind: 'runtime_goal',
      narration: `${core ? `${svc} is PROTECTED CORE — workspace edits are free, but the migration will be critical risk and owner-approved. ` : ''}Planning ${mode.replace(/_/g, ' ')} for ${svc} in an isolated workspace copy: the live service stays untouched; verify must be green before a migration plan.`,
      steps: [
        step('create_workspace', `Isolated copy of ${svc} (source commit recorded)`, { goal, mode, sourceServiceId: svc }),
        step('inspect_workspace', 'Map the copied structure'),
        step('run_workspace_tests', 'Check-fix loop: typecheck/build/boot/probes until green or limits'),
        step('create_migration_plan', `Migration + rollback plan${core ? ' (critical, owner approval)' : ''}`),
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

  // UI / console / self-improvement goals without an explicit service id →
  // Phase Y workspace copy of dashboard-web (the console lives there).
  if (/(fix|improve|upgrade|evolve|redesign|implement|clean up|find .*(wrong|bug|issue))/.test(t) && /\b(ui|console|dock|dashboard|interface|page|component)\b/.test(t)) {
    return {
      kind: 'runtime_goal',
      narration: 'Planning a UI evolution in an isolated workspace copy of dashboard-web: deep multi-file edits are free inside the workspace; typecheck + Next build must pass; replacing the live dashboard requires approval.',
      steps: [
        step('create_workspace', 'Isolated copy of dashboard-web (source untouched)', { goal, mode: 'upgrade_ui', sourceServiceId: 'dashboard-web' }),
        step('inspect_workspace', 'Map the console components'),
        step('run_workspace_tests', 'Verify + AUTO-FIX loop: typecheck + Next production build until GREEN or limits'),
        step('create_migration_plan', 'Changed files + risk + rollback; approval before replacing the live dashboard'),
      ],
    };
  }

  // Generic small code goals → dry-run inspect/propose path (Phase X tools).
  if (/(fix|improve|refactor|implement).*/.test(t) && /(code|file|function|schema)/.test(t)) {
    return {
      kind: 'runtime_goal',
      narration: 'Planning a targeted code change: inspect → propose (dry-run) → approve → apply on an isolated branch → typecheck.',
      steps: [
        step('inspect_repo', 'Understand the relevant area', { path: 'services' }),
        step('search_code', 'Locate the target', { pattern: goal.slice(0, 60), path: 'services' }),
        step('propose_code_change', 'Dry-run patch preview — nothing written'),
        step('edit_code', 'Apply the reviewed patch on an isolated branch (approval required)'),
        step('run_typecheck', 'Prove the change compiles', { package: 'services/dashboard-web' }),
      ],
    };
  }

  // Intelligence pipelines as single gated-lite tools.
  if (/(analy[sz]e|analysis).*(history|system)|recommend improvements/.test(t)) return { kind: 'single_tool', narration: 'Learning pipeline over real history.', steps: [step('analyze_history', 'Learning pipeline (never Dokploy)')] };
  if (/security (check|audit)|harden/.test(t)) return { kind: 'single_tool', narration: 'Production security check.', steps: [step('run_security_check', 'Security pipeline')] };
  // Broad enough to catch open research questions that don't literally say
  // "research" (e.g. "find current AI lighting trends in Dubai luxury
  // interiors") — checked before the narrower "opportunities for me" pattern
  // below so free-text topic questions reach live research, not a dead end.
  if (/research|best practices?|investigate|trends?\b|find (the )?(current|latest|out about)|what'?s (the latest|new|happening) (in|on|with)|latest (on|in)\b/.test(t)) {
    return { kind: 'single_tool', narration: 'Research pipeline — live web search when configured, honest fallback otherwise.', steps: [step('research_topic', 'Intelligence pipeline', { goal })] };
  }
  if (/\b(health|is .* up|reachable)\b/.test(t) || (/check/.test(t) && svc)) return { kind: 'single_tool', narration: `Read-only health check${svc ? ` on ${svc}` : ''}.`, steps: [step('check_service_health', 'Real /health + registry verification', { targetService: svc ?? '' })] };

  // Phase AB — Jarvis personal commands (all strictly user-scoped).
  if (/build my personal (reality )?baseline|review my current situation|personal growth plan/.test(t)) {
    return { kind: 'runtime_goal', narration: 'Building your personal reality baseline: profile, goals, projects, assets, risks, opportunities — and an honest list of every missing data category.', steps: [step('build_reality_baseline', 'Assemble the scoped intelligence graph + missing data'), step('get_next_best_actions', 'Rank what matters now from the baseline')] };
  }
  if (/(^|\b)(my goal is|goal\s*:|i want to|i need to)\b/.test(t)) {
    const title = extractGoalTitle(goal);
    return {
      kind: 'runtime_goal',
      narration: 'Captured. I will store this as your active goal, then re-rank your next actions from your updated personal context.',
      steps: [
        step('capture_personal_goal', 'Store the goal in your personal scope', { title, horizon: 'week', priority: 'high' }),
        step('get_next_best_actions', 'Re-rank actions after goal update'),
      ],
    };
  }
  if (/(my role is|i am|i'm).*(focus|focused on|focus on)|my focus is/.test(t)) {
    const hints = extractProfileHints(goal);
    return {
      kind: 'runtime_goal',
      narration: 'Captured. I will update your personal reality profile from this context and then re-rank your next actions.',
      steps: [
        step('capture_reality_profile', 'Store profile hints in your personal reality baseline', hints),
        step('get_next_best_actions', 'Re-rank actions after profile update'),
      ],
    };
  }
  if (/what should i do (now|next)|highest.value next action|next best action/.test(t)) {
    return { kind: 'runtime_goal', narration: 'Loading your scoped context, then giving one clear next step with a short summary. If key data is missing, I will ask one precise question and capture your answer.', steps: [step('get_my_context', 'Who is asking, goals, consents'), step('get_next_best_actions', 'Deterministic ranked actions with one clear best')] };
  }
  if (/(run |do )?my daily briefing/.test(t) || /^daily briefing/.test(t)) {
    return { kind: 'runtime_goal', narration: 'Running your daily briefing from real scoped data; unconnected sources are reported not_configured.', steps: [step('run_full_daily_briefing', 'Priorities, risks, income/growth/AOS actions, approvals, missing data')] };
  }
  if (/weekly (strategy|review)|strategy review/.test(t) && /\b(my|me)\b/.test(t) || /^weekly strategy/.test(t)) {
    return { kind: 'runtime_goal', narration: 'Weekly strategy review: goals vs actions vs opportunities → ranked plan, AOS build list, approvals needed.', steps: [step('run_weekly_strategy', 'Compare, rank, plan')] };
  }
  if (/analy[sz]e my (resume|cv)|my resume|improve my position/.test(t)) {
    return { kind: 'runtime_goal', narration: 'Resume intelligence on YOUR provided data only — facts, claims, inferences and suggestions kept strictly separate; nothing invented.', steps: [step('get_my_context', 'Goals give positioning direction'), step('analyze_resume', 'Separate facts/claims/inferences; concrete improvements')] };
  }
  if (/find .*opportunit.*(me|my)|best opportunities for me|increase my income|system to increase my income/.test(t)) {
    return { kind: 'runtime_goal', narration: 'Ranking opportunities against your goals and assets — every score carries source and confidence; no fake market claims. Live research fills in when nothing is recorded yet.', steps: [step('get_my_context', 'Goals + assets for linkage'), step('find_opportunities', 'Score and rank with recommended next actions; live research fallback when empty', { goal })] };
  }
  if (/what should aos build.*(me|my)|aos build next for me|build next to improve my/.test(t)) {
    return { kind: 'runtime_goal', narration: 'Finding the highest-value missing AOS capability for you. Analysis is user-scoped; actually BUILDING it is global workspace evolution and needs your approval before anything live.', steps: [step('get_my_context', 'Your goals and gaps'), step('propose_aos_build', 'Rank capability gaps by impact/effort/risk + build plan proposal')] };
  }

  // Phase AA — personal goals are USER-scoped: read only the user's own data,
  // never kernel state as personal data, and be honest about missing connectors.
  if (/\b(my|me)\b.*(week|day|goals?|schedule|briefing|priorit)|plan (my|the) (week|day)|daily briefing|weekly (review|strategy)/.test(t)) {
    return {
      kind: 'runtime_goal',
      narration: 'Personal goal — user scope only. I read your profile, goals and consents; connectors that are not configured are reported honestly, never invented.',
      steps: [
        step('get_my_context', 'Load user-scoped profile, goals, constraints and consent status'),
        step('generate_daily_briefing', 'Briefing from the data that actually exists (missing sources listed as not_configured)'),
      ],
    };
  }

  // Phase AD — generic task creation: hand the goal straight to the
  // orchestrator as a real kernel task. Bilingual (EN/FA): "create/make a
  // task that ..." / "یک تسک بساز که ...". Checked last so more specific
  // branches (service creation, personal goals, etc.) still win.
  if (/\b(create|make|open)\b.*\btask\b|\btask\b.*\b(to|that|for)\b/.test(t) || /(تسک|وظیفه)[^.!؟]*(بساز|ایجاد کن|ایجاد)/.test(goal) || /(بساز|ایجاد کن)[^.!؟]*(تسک|وظیفه)/.test(goal)) {
    return {
      kind: 'runtime_goal',
      narration: `Creating a kernel task and handing it to the orchestrator: “${goal.trim().slice(0, 120)}”.`,
      steps: [step('create_task', 'Hand the goal to the orchestrator pipeline', { goal })],
    };
  }

  return { kind: 'clarify', steps: [], narration: `I heard: “${goal.trim().slice(0, 80)}”. Give me a goal I can plan — a system check, a service operation, a code improvement, research, a new service, or a personal goal like “plan my week”.` };
}

/* ===================== session failure semantics ======================== */

/** Categories whose failures are informational — the session may continue.
 *  Failures in ANY other category (code/test/service/deploy/repair/git/
 *  dokploy/security) are critical-chain: the session stops and reports
 *  cause + next action. A session with failed critical steps is NEVER
 *  reported as completed — no fake success. */
export const OBSERVATIONAL_CATEGORIES: ReadonlySet<string> = new Set(['read', 'evidence', 'report', 'memory', 'reason', 'learning', 'approval']);

export function stopSessionOnFailure(category: string): boolean {
  return !OBSERVATIONAL_CATEGORIES.has(category);
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

/* ======================= recency ordering (Phase AG.3) =================== */

export interface SortableSession {
  runtimeSessionId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
}

/**
 * Phase AG.3 — deterministic "most recent operation" ordering, independent of
 * any database-level sort. `completedAt` was historically left null on some
 * early-exit failure paths in `runLoop` (fixed alongside this helper, see
 * decision-log), which could leave a genuinely older failed session sorting
 * ahead of a newer completed one under a naive `.sort({ completedAt: -1 })`.
 * This function always ranks by the session's most meaningful timestamp —
 * `completedAt` when set, `startedAt` otherwise — so every consumer
 * (OperatorConsole, ActiveOperationsPanel, LiveEvents) that renders
 * `recentSessions[0]` agrees on what "last operation" means, and a failed
 * session never stays pinned above a newer completed one.
 */
export function sortRecentSessions<T extends SortableSession>(sessions: T[]): T[] {
  const effectiveTime = (s: T): string => s.completedAt || s.startedAt;
  return [...sessions].sort((a, b) => {
    const byTime = effectiveTime(b).localeCompare(effectiveTime(a));
    if (byTime !== 0) return byTime;
    // Exact tie: a session with a real completedAt outranks one still open.
    if (a.completedAt && !b.completedAt) return -1;
    if (!a.completedAt && b.completedAt) return 1;
    return 0;
  });
}

/* ============================== narration =============================== */

/** Short, meaningful progress line for a completed step — operator voice. */
export function narrateStep(toolName: string, ok: boolean, observation: string): string {
  const obs = observation.trim();
  return ok ? (obs ? obs : `${toolName} completed.`) : `${toolName} failed. ${obs}`.trim();
}
