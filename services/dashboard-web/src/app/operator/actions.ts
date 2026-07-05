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
  };
}

export interface ScopeContextView { actor: string; scope: string; mode: string; tenant: string | null; reason: string }

export interface OperatorCommandResult {
  kind: 'capabilities' | 'session' | 'clarify' | 'ignored' | 'error';
  reply: string;
  spoken: string;
  groups: Array<{ label: string; tools: Array<{ name: string; riskLevel: string; requiresApproval: boolean; available: boolean; example: string }> }>;
  session: RuntimeSessionView | null;
  scopeContext: ScopeContextView | null;
}

export async function operatorCommandAction(text: string): Promise<OperatorCommandResult> {
  const r = await gateway.operatorCommand(text);
  if (!r) return { kind: 'error', reply: 'The kernel is unreachable.', spoken: '', groups: [], session: null, scopeContext: null };
  const kind = String(r.kind ?? 'error');
  if (kind === 'capabilities') {
    const groups = (r.groups as OperatorCommandResult['groups'] | undefined) ?? [];
    return { kind: 'capabilities', reply: String(r.spoken ?? ''), spoken: String(r.spoken ?? ''), groups, session: null, scopeContext: null };
  }
  if (kind === 'session') {
    const view = toView(r.session as Record<string, unknown>);
    // Pull permissions + live workspace telemetry from the detail endpoint.
    const full = view ? await gateway.operatorSession(view.runtimeSessionId) : null;
    const withPerm = full ? toView(full.session, full.permissions, (full as Record<string, unknown>).workspace) : view;
    return { kind: 'session', reply: String(r.narration ?? ''), spoken: String(r.narration ?? ''), groups: [], session: withPerm, scopeContext: (r.scopeContext as ScopeContextView | undefined) ?? null };
  }
  if (kind === 'clarify') return { kind: 'clarify', reply: String(r.reply ?? ''), spoken: String(r.reply ?? ''), groups: [], session: null, scopeContext: null };
  return { kind: 'ignored', reply: '', spoken: '', groups: [], session: null, scopeContext: null };
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
