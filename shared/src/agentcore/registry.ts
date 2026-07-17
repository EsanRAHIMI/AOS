/**
 * Agent Core — unified governed tool registry (K2, D-177; mandate §B).
 *
 * ONE authoritative registry for every tool Jarvis and agent roles can use.
 * A tool here is: a serializable governed definition (schemas.ts) + a zod
 * input schema + a REAL executor. A tool marked available MUST have a real
 * executor; an unconfigured integration registers `available:false` with the
 * exact reason — never a fake capability.
 *
 * Relationship to the older `shared/src/operator` registry: that registry
 * described gateway-executed plan-step tools for the deterministic planner.
 * This registry is the superset surface the shared agent loop uses. Gateway
 * binds its existing executors into this registry at boot (no logic is
 * duplicated); the operator planner keeps working during migration and is
 * deprecated once the loop path is proven (mandate §A "no second Jarvis").
 */
import { z, type ZodType } from 'zod';
import {
  AgentToolDefinitionSchema,
  type AgentToolDefinition,
  type ToolOutputTrust,
} from './schemas.js';

export interface ToolExecutionContext {
  actorId: string;
  role: string;               // declared role: 'owner' | 'admin' | 'agent' | ...
  isOwner: boolean;
  scope: 'global' | 'user';
  tenantId?: string | null;
  userId?: string | null;
  runId: string;
  sessionId?: string | null;
  taskId?: string | null;
  /** Loop-local scratch shared between tool calls in one run. */
  workingSet: Map<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  /** Compact human/model-readable summary — what goes into the transcript. */
  summary: string;
  /** Structured payload for the caller/UI (never fed raw to the model unless summarized). */
  data?: unknown;
  evidenceIds?: string[];
  /** Override the definition's declared trust for this specific output. */
  outputTrust?: ToolOutputTrust;
}

export type ToolExecutor = (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult>;

export interface AgentToolBinding {
  definition: AgentToolDefinition;
  inputSchema: ZodType<Record<string, unknown>>;
  executor: ToolExecutor;
  /** Live availability probe (config presence etc). Definition.available is
   *  the cached result; probe refreshes it. */
  availabilityCheck?: () => { available: boolean; reason: string };
}

/** Serializable projection of the zod schema for definition.inputFields. */
export function describeSchemaFields(schema: ZodType): Record<string, string> {
  const out: Record<string, string> = {};
  const def = (schema as { def?: { shape?: Record<string, ZodType> } }).def;
  const shape = def?.shape ?? (schema as unknown as { shape?: Record<string, ZodType> }).shape;
  if (shape && typeof shape === 'object') {
    for (const [k, v] of Object.entries(shape)) {
      const d = (v as { description?: string }).description ?? '';
      const typeName = (v as { def?: { type?: string } }).def?.type ?? 'unknown';
      out[k] = d || typeName;
    }
  }
  return out;
}

export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentToolBinding>();

  register(binding: AgentToolBinding): void {
    const def = AgentToolDefinitionSchema.parse(binding.definition);
    if (this.tools.has(def.name)) {
      throw new Error(`duplicate tool registration: ${def.name} (merge definitions instead — one registry, one truth)`);
    }
    if (def.available && typeof binding.executor !== 'function') {
      throw new Error(`tool ${def.name} marked available without a real executor`);
    }
    // Derive serializable input fields from the zod schema when not provided.
    if (Object.keys(def.inputFields).length === 0) {
      def.inputFields = describeSchemaFields(binding.inputSchema);
    }
    this.tools.set(def.name, { ...binding, definition: def });
  }

  get(name: string): AgentToolBinding | null {
    return this.tools.get(name) ?? null;
  }

  /** Refresh availability from live probes; returns the current definitions. */
  list(): AgentToolDefinition[] {
    const out: AgentToolDefinition[] = [];
    for (const b of this.tools.values()) {
      if (b.availabilityCheck) {
        const { available, reason } = b.availabilityCheck();
        b.definition.available = available;
        b.definition.unavailableReason = available ? '' : reason;
      }
      out.push({ ...b.definition });
    }
    return out;
  }

  /** Definitions the MODEL sees for a given role grant list ('*' = all). */
  grantsFor(grantedNames: string[] | '*'): AgentToolBinding[] {
    const all = [...this.tools.values()];
    const granted = grantedNames === '*' ? all : all.filter((b) => grantedNames.includes(b.definition.name));
    return granted.filter((b) => {
      if (b.availabilityCheck) {
        const { available, reason } = b.availabilityCheck();
        b.definition.available = available;
        b.definition.unavailableReason = available ? '' : reason;
      }
      return b.definition.available;
    });
  }

  size(): number {
    return this.tools.size;
  }
}

/* ------------------------- policy evaluation ---------------------------- */

export interface PolicyInput {
  binding: AgentToolBinding;
  ctx: ToolExecutionContext;
  safeMode: boolean;
}

export type ToolPolicyDecision =
  | { decision: 'auto_allowed' }
  | { decision: 'approval_required' }
  | { decision: 'denied_scope'; reason: string }
  | { decision: 'denied_unavailable'; reason: string }
  | { decision: 'denied_safe_mode'; reason: string }
  | { decision: 'denied_owner_only'; reason: string };

/**
 * Central, deterministic policy gate (mandate §5): read-only auto-executes,
 * internal reversible per policy, everything sensitive pauses for approval.
 * Safe mode blocks all mutations. Never weakened by model output.
 */
export function evaluateToolRequest(input: PolicyInput): ToolPolicyDecision {
  const { binding, ctx, safeMode } = input;
  const def = binding.definition;

  if (!def.available) {
    return { decision: 'denied_unavailable', reason: def.unavailableReason || 'not configured' };
  }
  if (def.ownerOnly && !ctx.isOwner) {
    return { decision: 'denied_owner_only', reason: `tool ${def.name} is owner-only` };
  }
  if (def.requiredActorScope === 'global' && ctx.scope !== 'global') {
    return { decision: 'denied_scope', reason: `tool ${def.name} requires global scope` };
  }
  const mutates = def.sideEffect !== 'none';
  if (safeMode && mutates) {
    return { decision: 'denied_safe_mode', reason: 'safe mode is active — mutation tools are disabled' };
  }
  if (def.requiresApproval) return { decision: 'approval_required' };
  switch (def.policyCategory) {
    case 'read_only':
    case 'internal_reversible':
      return { decision: 'auto_allowed' };
    default:
      // Any sensitive category without an explicit requiresApproval=true is a
      // registration mistake — fail CLOSED, not open.
      return { decision: 'approval_required' };
  }
}

/** Zod helper used by many tool input schemas. */
export const ToolArgs = {
  string: (desc: string) => z.string().describe(desc),
  optionalString: (desc: string) => z.string().optional().describe(desc),
  number: (desc: string) => z.number().describe(desc),
  boolean: (desc: string) => z.boolean().describe(desc),
};
