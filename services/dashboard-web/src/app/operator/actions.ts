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
}

function toView(sessionRaw: Record<string, unknown> | null | undefined, permissions: Array<Record<string, unknown>> = []): RuntimeSessionView | null {
  if (!sessionRaw) return null;
  const s = sessionRaw as Record<string, unknown> & { plan?: RuntimePlanStep[]; observations?: string[]; evidenceIds?: string[] };
  const pending = permissions.find((p) => p.status === 'pending') ?? null;
  return {
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

export interface OperatorCommandResult {
  kind: 'capabilities' | 'session' | 'clarify' | 'ignored' | 'error';
  reply: string;
  spoken: string;
  groups: Array<{ label: string; tools: Array<{ name: string; riskLevel: string; requiresApproval: boolean; available: boolean; example: string }> }>;
  session: RuntimeSessionView | null;
}

export async function operatorCommandAction(text: string): Promise<OperatorCommandResult> {
  const r = await gateway.operatorCommand(text);
  if (!r) return { kind: 'error', reply: 'The kernel is unreachable.', spoken: '', groups: [], session: null };
  const kind = String(r.kind ?? 'error');
  if (kind === 'capabilities') {
    const groups = (r.groups as OperatorCommandResult['groups'] | undefined) ?? [];
    return { kind: 'capabilities', reply: String(r.spoken ?? ''), spoken: String(r.spoken ?? ''), groups, session: null };
  }
  if (kind === 'session') {
    const view = toView(r.session as Record<string, unknown>);
    // Pull pending permission from a follow-up fetch (session doc stores ids only).
    const full = view ? await gateway.operatorSession(view.runtimeSessionId) : null;
    const withPerm = full ? toView(full.session, full.permissions) : view;
    return { kind: 'session', reply: String(r.narration ?? ''), spoken: String(r.narration ?? ''), groups: [], session: withPerm };
  }
  if (kind === 'clarify') return { kind: 'clarify', reply: String(r.reply ?? ''), spoken: String(r.reply ?? ''), groups: [], session: null };
  return { kind: 'ignored', reply: '', spoken: '', groups: [], session: null };
}

export async function getRuntimeSessionAction(id: string): Promise<RuntimeSessionView | null> {
  const r = await gateway.operatorSession(id);
  return r ? toView(r.session, r.permissions) : null;
}

export async function decideRuntimePermissionAction(id: string, action: 'approve' | 'reject'): Promise<RuntimeSessionView | null> {
  const r = await gateway.decideOperatorPermission(id, action);
  if (!r?.session) return null;
  const sid = String((r.session as Record<string, unknown>).runtimeSessionId ?? '');
  return getRuntimeSessionAction(sid);
}
