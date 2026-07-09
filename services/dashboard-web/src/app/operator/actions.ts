'use server';
/**
 * Phase X — server actions for the Operator Console. They proxy to the gateway
 * operator runtime; the admin token stays server-side. The console (voice or
 * text) is only the human interface — the runtime is authoritative.
 */
import { gateway } from '@/lib/gateway';

export interface RuntimePlanStep {
  stepId: string;
  toolId: string;
  reason: string;
  status: string;
  observation: string;
}

export interface WorkspaceTelemetry {
  workspaceId: string;
  status: string;
  iterations: number;
  maxIterations: number;
  filesChanged: number;
  maxFilesChanged: number;
  tempPort: number | null;
  serviceDirName: string;
  lastError: string;
  matrix: Array<{ checkId: string; status: string; detail: string }>;
  logsTail: string;
}

export interface RuntimeSessionView {
  runtimeSessionId: string;
  goal: string;
  status: string;
  currentStep: number;
  plan: RuntimePlanStep[];
  observations: string[];
  nextAction: string;
  reportSummary: string;
  evidenceCount: number;
  pendingPermission: { permissionId: string; prompt: string; riskLevel: string; ownerOnly: boolean } | null;
  workspace: WorkspaceTelemetry | null;
  /** Phase AF.4 — populated once the backgrounded LLM composition for this
   *  session finishes; empty until then. Preferred over `reportSummary` for
   *  the spoken/shown completion narration when present. */
  composedReply: string;
  /** Phase AF.4.3 — needed to order/timestamp session cards in the Live
   *  Activity operation feed; not previously mapped through even though the
   *  backend record always has them. */
  startedAt: string;
  completedAt: string | null;
}

function toWorkspaceTelemetry(raw: unknown): WorkspaceTelemetry | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as { workspace?: Record<string, unknown>; matrix?: Array<{ checkId: string; status: string; detail: string }>; logsTail?: string; limits?: { maxIterations?: number; maxFilesChanged?: number } };
  const w = d.workspace;
  if (!w) return null;
  return {
    workspaceId: String(w.workspaceId ?? ''),
    status: String(w.status ?? ''),
    iterations: Number(w.iterations ?? 0),
    maxIterations: Number(d.limits?.maxIterations ?? 10),
    filesChanged: Number(w.filesChanged ?? 0),
    maxFilesChanged: Number(d.limits?.maxFilesChanged ?? 80),
    tempPort: w.tempPort === null || w.tempPort === undefined ? null : Number(w.tempPort),
    serviceDirName: String(w.serviceDirName ?? ''),
    lastError: String(w.lastError ?? ''),
    matrix: (d.matrix ?? []).map((m) => ({ checkId: String(m.checkId), status: String(m.status), detail: String(m.detail ?? '') })),
    logsTail: String(d.logsTail ?? ''),
  };
}

function toView(sessionRaw: Record<string, unknown> | null | undefined, permissions: Array<Record<string, unknown>> = [], workspaceRaw: unknown = null): RuntimeSessionView | null {
  if (!sessionRaw) return null;
  const s = sessionRaw as Record<string, unknown> & { plan?: RuntimePlanStep[]; observations?: string[]; evidenceIds?: string[] };
  const pending = permissions.find((p) => p.status === 'pending') ?? null;
  return {
    workspace: toWorkspaceTelemetry(workspaceRaw),
    runtimeSessionId: String(s.runtimeSessionId ?? ''),
    goal: String(s.goal ?? ''),
    status: String(s.status ?? ''),
    currentStep: Number(s.currentStep ?? 0),
    plan: (s.plan ?? []).map((p) => ({ stepId: p.stepId, toolId: p.toolId, reason: p.reason, status: p.status, observation: p.observation })),
    observations: s.observations ?? [],
    nextAction: String(s.nextAction ?? ''),
    reportSummary: String(s.reportSummary ?? ''),
    evidenceCount: (s.evidenceIds ?? []).length,
    pendingPermission: pending ? { permissionId: String(pending.permissionId), prompt: String(pending.prompt), riskLevel: String(pending.riskLevel), ownerOnly: Boolean(pending.ownerOnly) } : null,
    composedReply: String(s.composedReply ?? ''),
    startedAt: String(s.startedAt ?? ''),
    completedAt: s.completedAt ? String(s.completedAt) : null,
  };
}

export interface ScopeContextView { actor: string; scope: string; mode: string; tenant: string | null; reason: string }

export interface OperatorCommandResult {
  kind: 'capabilities' | 'session' | 'answer' | 'clarify' | 'ignored' | 'error';
  reply: string;
  spoken: string;
  groups: Array<{ label: string; tools: Array<{ name: string; riskLevel: string; requiresApproval: boolean; available: boolean; example: string }> }>;
  session: RuntimeSessionView | null;
  scopeContext: ScopeContextView | null;
  /** Phase AD — Jarvis Intelligence Core: present on 'session' and 'answer'. */
  language: string;
  suggestedFollowUps: string[];
  intentCategory: string;
}

export async function operatorCommandAction(text: string): Promise<OperatorCommandResult> {
  const empty: Pick<OperatorCommandResult, 'session' | 'scopeContext' | 'language' | 'suggestedFollowUps' | 'intentCategory'> = { session: null, scopeContext: null, language: '', suggestedFollowUps: [], intentCategory: '' };
  const r = await gateway.operatorCommand(text);
  if (!r) return { kind: 'error', reply: 'The kernel is unreachable.', spoken: '', groups: [], ...empty };
  const kind = String(r.kind ?? 'error');
  if (kind === 'capabilities') {
    const groups = (r.groups as OperatorCommandResult['groups'] | undefined) ?? [];
    return { kind: 'capabilities', reply: String(r.spoken ?? ''), spoken: String(r.spoken ?? ''), groups, ...empty };
  }
  if (kind === 'answer') {
    return {
      kind: 'answer', reply: String(r.reply ?? ''), spoken: String(r.reply ?? ''), groups: [],
      session: null, scopeContext: (r.scopeContext as ScopeContextView | undefined) ?? null,
      language: String(r.language ?? ''), suggestedFollowUps: (r.suggestedFollowUps as string[] | undefined) ?? [], intentCategory: String(r.intentCategory ?? ''),
    };
  }
  if (kind === 'session') {
    const view = toView(r.session as Record<string, unknown>);
    // Pull permissions + live workspace telemetry from the detail endpoint.
    const full = view ? await gateway.operatorSession(view.runtimeSessionId) : null;
    const withPerm = full ? toView(full.session, full.permissions, (full as Record<string, unknown>).workspace) : view;
    // Phase AD — prefer the grounded composed reply; fall back to the
    // mechanical narration if composition somehow produced nothing.
    const reply = String(r.reply ?? r.narration ?? '');
    return {
      kind: 'session', reply, spoken: reply, groups: [], session: withPerm,
      scopeContext: (r.scopeContext as ScopeContextView | undefined) ?? null,
      // Phase AF.3 — the gateway now sends a real intentCategory on session
      // replies too (previously hardcoded '' here, the actual cause of
      // domain links never appearing on tool-routed replies).
      language: String(r.language ?? ''), suggestedFollowUps: (r.suggestedFollowUps as string[] | undefined) ?? [], intentCategory: String(r.intentCategory ?? ''),
    };
  }
  if (kind === 'clarify') return { kind: 'clarify', reply: String(r.reply ?? ''), spoken: String(r.reply ?? ''), groups: [], ...empty };
  return { kind: 'ignored', reply: '', spoken: '', groups: [], ...empty };
}

export async function getRuntimeSessionAction(id: string): Promise<RuntimeSessionView | null> {
  const r = await gateway.operatorSession(id);
  return r ? toView(r.session, r.permissions, (r as Record<string, unknown>).workspace) : null;
}

export async function decideRuntimePermissionAction(id: string, action: 'approve' | 'reject'): Promise<RuntimeSessionView | null> {
  const r = await gateway.decideOperatorPermission(id, action);
  if (!r?.session) return null;
  const sid = String((r.session as Record<string, unknown>).runtimeSessionId ?? '');
  return getRuntimeSessionAction(sid);
}

/* ------------------------- Phase AF.4.1 — live state ------------------------- */

export interface PendingApprovalView { permissionId: string; runtimeSessionId: string; prompt: string; riskLevel: string; ownerOnly: boolean; createdAt: string }
export interface RecentTaskView { taskId: string; goal: string; status: string; createdAt: string; updatedAt: string }
export interface LiveEventView { type: string; message: string; createdAt: string; runtimeSessionId: string | null; taskId: string | null; permissionId: string | null }
export interface RecentJarvisTurnView { turnId: string; text: string; reply: string; createdAt: string }

export interface LiveStateView {
  activeSessions: RuntimeSessionView[];
  recentSessions: RuntimeSessionView[];
  pendingApprovals: PendingApprovalView[];
  recentTasks: RecentTaskView[];
  recentEvents: LiveEventView[];
  recentJarvisTurns: RecentJarvisTurnView[];
  activeOperationSummary: string | null;
  generatedAt: string;
}

const EMPTY_LIVE_STATE: LiveStateView = { activeSessions: [], recentSessions: [], pendingApprovals: [], recentTasks: [], recentEvents: [], recentJarvisTurns: [], activeOperationSummary: null, generatedAt: '' };

/**
 * Phase AF.4.1 — the one real read behind both the homepage Active
 * Operations panel and `OperatorConsole`'s on-mount reload. Real, persisted
 * data only (see `GET /v1/operator/live-state`'s header comment in
 * gateway-api) — no field here is fabricated for a "not yet happened" case;
 * arrays are simply empty when there's genuinely nothing to show.
 */
export async function getLiveStateAction(): Promise<LiveStateView> {
  const r = await gateway.operatorLiveState();
  if (!r) return EMPTY_LIVE_STATE;
  return {
    activeSessions: r.activeSessions.map((s) => toView(s)).filter((s): s is RuntimeSessionView => s !== null),
    recentSessions: r.recentSessions.map((s) => toView(s)).filter((s): s is RuntimeSessionView => s !== null),
    pendingApprovals: r.pendingApprovals.map((p) => ({
      permissionId: String(p.permissionId ?? ''), runtimeSessionId: String(p.runtimeSessionId ?? ''),
      prompt: String(p.prompt ?? ''), riskLevel: String(p.riskLevel ?? ''), ownerOnly: Boolean(p.ownerOnly), createdAt: String(p.createdAt ?? ''),
    })),
    recentTasks: r.recentTasks.map((t) => ({ taskId: String(t.taskId ?? ''), goal: String(t.goal ?? ''), status: String(t.status ?? ''), createdAt: String(t.createdAt ?? ''), updatedAt: String(t.updatedAt ?? t.createdAt ?? '') })),
    recentEvents: r.recentEvents.map((e) => {
      const payload = (e.payload ?? {}) as Record<string, unknown>;
      return {
        type: String(e.type ?? ''), message: String(payload.message ?? ''), createdAt: String(e.createdAt ?? ''),
        runtimeSessionId: payload.runtimeSessionId ? String(payload.runtimeSessionId) : null,
        taskId: e.taskId ? String(e.taskId) : null,
        permissionId: payload.permissionId ? String(payload.permissionId) : null,
      };
    }),
    recentJarvisTurns: r.recentJarvisTurns.map((t) => ({ turnId: String(t.turnId ?? ''), text: String(t.text ?? ''), reply: String(t.reply ?? ''), createdAt: String(t.createdAt ?? '') })),
    activeOperationSummary: r.activeOperationSummary,
    generatedAt: r.generatedAt,
  };
}
