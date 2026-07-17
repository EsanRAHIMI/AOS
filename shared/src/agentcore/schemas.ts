/**
 * Agent Core — shared multi-turn agent runtime schemas (K2, D-177).
 *
 * These are the durable entities of the ONE shared agent loop that Jarvis,
 * the orchestrator and specialist roles all converge on (master-direction
 * C.2, mandate §A). Every model turn, tool request, policy decision,
 * approval pause and resume is persisted — a run interrupted by a restart or
 * an approval wait resumes from its exact persisted state, never restarts.
 *
 * Invariant carried over from Phase X and never weakened: raw model output
 * NEVER mutates state. The loop's only mutation path is a governed tool
 * executor behind the unified registry (./registry.ts), and every invocation
 * leaves a ToolInvocation row (request → policy decision → result →
 * evidence). Model text is only ever text.
 */
import { z } from 'zod';
import { IsoDate } from '../schemas/common.js';
import { ScopeFieldsSchema } from '../schemas/scope.js';

/* ------------------------------ tool registry --------------------------- */

export const ToolRiskLevel = z.enum(['low', 'medium', 'high', 'critical']);
export type ToolRiskLevel = z.infer<typeof ToolRiskLevel>;

/** Governance category — drives the default approval policy per mandate §5. */
export const ToolPolicyCategory = z.enum([
  'read_only',          // auto-executes within scope
  'internal_reversible',// may auto-execute per policy (safe mode blocks)
  'internal_sensitive', // requires approval (memory deletion, config change)
  'external_action',    // requires approval (emails, external APIs)
  'destructive',        // always requires approval
  'financial',          // always requires approval
  'production',         // always requires approval
  'protected_core',     // owner-only approval
]);
export type ToolPolicyCategory = z.infer<typeof ToolPolicyCategory>;

/** How much the OUTPUT of this tool can be trusted when fed back to a model.
 *  `untrusted_external` output (web pages, search results) is fenced as data
 *  and must never be interpreted as instructions — the loop enforces the
 *  fencing; this field declares the need. */
export const ToolOutputTrust = z.enum(['trusted_internal', 'untrusted_external']);
export type ToolOutputTrust = z.infer<typeof ToolOutputTrust>;

export const ToolSideEffect = z.enum(['none', 'internal_write', 'external_write', 'code_change', 'infrastructure']);
export type ToolSideEffect = z.infer<typeof ToolSideEffect>;

/**
 * The unified, authoritative tool definition (mandate §B). The zod
 * input/output schemas live on the in-code definition (AgentToolBinding);
 * this serializable record is what gets listed, audited and shown in the UI.
 */
export const AgentToolDefinitionSchema = z.object({
  name: z.string().min(1),                     // stable snake_case id, e.g. 'memory_search'
  version: z.string().default('1.0.0'),
  purpose: z.string().min(1),
  family: z.string().min(1),                   // e.g. 'memory' | 'missions' | 'research' | 'code' | 'system'
  ownerModule: z.string().min(1),              // module path that owns the executor
  /** Serializable field→description map derived from the zod schema. */
  inputFields: z.record(z.string(), z.string()).default({}),
  outputFields: z.record(z.string(), z.string()).default({}),
  requiredActorScope: z.enum(['user', 'tenant', 'global']).default('user'),
  permission: z.string().default(''),          // RBAC permission id, '' = none beyond scope
  riskLevel: ToolRiskLevel,
  policyCategory: ToolPolicyCategory,
  requiresApproval: z.boolean(),
  ownerOnly: z.boolean().default(false),
  timeoutMs: z.number().int().positive().default(20000),
  maxRetries: z.number().int().min(0).default(0),
  /** True when calling twice with identical args is safe. */
  idempotent: z.boolean().default(false),
  sideEffect: ToolSideEffect.default('none'),
  evidenceRequired: z.boolean().default(false),
  rollbackAvailable: z.boolean().default(false),
  outputTrust: ToolOutputTrust.default('trusted_internal'),
  /** Availability is TRUTH, not aspiration: false + reason when unconfigured. */
  available: z.boolean().default(true),
  unavailableReason: z.string().default(''),
});
export type AgentToolDefinition = z.infer<typeof AgentToolDefinitionSchema>;

/* ------------------------------ loop entities --------------------------- */

export const AgentLoopStopReason = z.enum([
  'completed',        // model produced a final answer
  'max_steps',
  'timeout',
  'budget_tokens',
  'budget_cost',
  'cancelled',
  'waiting_approval', // paused, resumable — not terminal
  'model_error',
  'no_model',         // no provider configured AND task needs reasoning
]);
export type AgentLoopStopReason = z.infer<typeof AgentLoopStopReason>;

export const AgentLoopRunStatus = z.enum([
  'running', 'waiting_approval', 'completed', 'failed', 'cancelled',
]);
export type AgentLoopRunStatus = z.infer<typeof AgentLoopRunStatus>;

/** One message in the persisted model conversation. Tool results are fenced
 *  when untrusted (see loop.ts fenceUntrusted). */
export const LoopMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  /** For assistant messages that requested tool calls. */
  toolCalls: z.array(z.object({
    callId: z.string(),
    toolName: z.string(),
    args: z.record(z.string(), z.unknown()),
  })).default([]),
  /** For role='tool': which call this answers. */
  toolCallId: z.string().default(''),
  toolName: z.string().default(''),
});
export type LoopMessage = z.infer<typeof LoopMessageSchema>;

export const AgentLoopRunSchema = z.object({
  runId: z.string(),
  /** The prompted role driving this run (mandate §J): 'jarvis', 'researcher', ... */
  role: z.string(),
  goal: z.string(),
  status: AgentLoopRunStatus,
  stopReason: AgentLoopStopReason.nullable().default(null),
  /** Full persisted conversation — THE resume state. */
  messages: z.array(LoopMessageSchema).default([]),
  /** Pending tool call awaiting approval (exact-resume anchor). */
  pendingToolCall: z.object({
    callId: z.string(),
    toolName: z.string(),
    args: z.record(z.string(), z.unknown()),
    approvalId: z.string(),
  }).nullable().default(null),
  steps: z.number().int().default(0),
  maxSteps: z.number().int().default(8),
  startedAt: IsoDate,
  finishedAt: z.string().nullable().default(null),
  deadlineAt: IsoDate,
  tokensIn: z.number().default(0),
  tokensOut: z.number().default(0),
  costUsd: z.number().default(0),
  maxCostUsd: z.number().default(0.5),
  maxTokens: z.number().default(120000),
  provider: z.string().default(''),
  model: z.string().default(''),
  /** 'native' tool calling, 'structured' compat fallback, 'none' (degraded). */
  reasoningMode: z.enum(['native', 'structured', 'none']).default('none'),
  finalText: z.string().default(''),
  /** Correlation to the surface that started it. */
  sessionId: z.string().nullable().default(null),
  turnId: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  cancelRequested: z.boolean().default(false),
  error: z.string().default(''),
  createdAt: IsoDate,
  updatedAt: IsoDate,
}).merge(ScopeFieldsSchema);
export type AgentLoopRun = z.infer<typeof AgentLoopRunSchema>;

export const AgentLoopStepKind = z.enum(['model_turn', 'tool_execution', 'approval_pause', 'approval_resume', 'reflection']);
export type AgentLoopStepKind = z.infer<typeof AgentLoopStepKind>;

export const AgentLoopStepSchema = z.object({
  stepId: z.string(),
  runId: z.string(),
  index: z.number().int(),
  kind: AgentLoopStepKind,
  summary: z.string().default(''),
  toolName: z.string().default(''),
  toolInvocationId: z.string().default(''),
  tokensIn: z.number().default(0),
  tokensOut: z.number().default(0),
  costUsd: z.number().default(0),
  ok: z.boolean().default(true),
  detail: z.string().default(''),
  createdAt: IsoDate,
});
export type AgentLoopStep = z.infer<typeof AgentLoopStepSchema>;

/** One ledger for every tool call across Jarvis/agents (mandate §B, G.2). */
export const ToolInvocationSchema = z.object({
  invocationId: z.string(),
  runId: z.string(),
  sessionId: z.string().nullable().default(null),
  toolName: z.string(),
  toolVersion: z.string().default('1.0.0'),
  args: z.record(z.string(), z.unknown()).default({}),
  policyDecision: z.enum(['auto_allowed', 'approval_required', 'denied_scope', 'denied_unavailable', 'denied_safe_mode', 'denied_owner_only']),
  approvalId: z.string().nullable().default(null),
  status: z.enum(['executed', 'failed', 'denied', 'awaiting_approval', 'rejected', 'timed_out']),
  resultSummary: z.string().default(''),
  outputTrust: ToolOutputTrust.default('trusted_internal'),
  evidenceIds: z.array(z.string()).default([]),
  durationMs: z.number().default(0),
  actorId: z.string(),
  createdAt: IsoDate,
  finishedAt: z.string().nullable().default(null),
}).merge(ScopeFieldsSchema);
export type ToolInvocation = z.infer<typeof ToolInvocationSchema>;

/** In-conversation approval card (mandate §5): pauses the exact run. */
export const ApprovalCheckpointSchema = z.object({
  approvalId: z.string(),
  runId: z.string(),
  sessionId: z.string().nullable().default(null),
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  summary: z.string(),
  riskLevel: ToolRiskLevel,
  policyCategory: ToolPolicyCategory,
  ownerOnly: z.boolean().default(false),
  status: z.enum(['pending', 'approved', 'rejected', 'expired']).default('pending'),
  decidedBy: z.string().nullable().default(null),
  decisionReason: z.string().nullable().default(null),
  createdAt: IsoDate,
  decidedAt: z.string().nullable().default(null),
}).merge(ScopeFieldsSchema);
export type ApprovalCheckpoint = z.infer<typeof ApprovalCheckpointSchema>;

/** Post-run structured lesson (mandate §A reflection). */
export const ReflectionLessonSchema = z.object({
  lessonId: z.string(),
  runId: z.string(),
  role: z.string(),
  goal: z.string(),
  whatWorked: z.string().default(''),
  whatFailed: z.string().default(''),
  lesson: z.string().default(''),
  reusable: z.boolean().default(false),
  createdAt: IsoDate,
}).merge(ScopeFieldsSchema);
export type ReflectionLesson = z.infer<typeof ReflectionLessonSchema>;
