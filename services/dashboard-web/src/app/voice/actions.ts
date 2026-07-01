'use server';
import { gateway } from '@/lib/gateway';

/**
 * Server actions for the voice dock. They proxy to the gateway, which is the
 * authoritative enforcer of RBAC / safe mode / approvals. The admin/internal
 * tokens stay server-side; the browser only ever sees plain results.
 */
export async function voiceStartAction(page: string): Promise<string | null> {
  const s = await gateway.startVoiceSession(page);
  return s?.voiceSessionId ?? null;
}

export interface VoiceTurn {
  reply: string;
  toolName: string;
  toolCallId: string;
  category: string;
  status: string;
  riskLevel: string;
  requiresApproval: boolean;
  ownerOnly: boolean;
  blocked: boolean;
  confirm: string;
  permissionId: string | null;
  guardrailNote: string;
  safeMode: boolean;
}

export async function voiceSendAction(sessionId: string, text: string, page: string): Promise<VoiceTurn> {
  const r = await gateway.voiceMessage(sessionId, text, page);
  const p = (r?.proposal ?? {}) as Record<string, unknown>;
  const tc = (r?.toolCall ?? {}) as Record<string, unknown>;
  return {
    reply: r?.reply ?? 'I could not reach the kernel right now.',
    toolName: String(p.toolName ?? ''),
    toolCallId: String(tc.toolCallId ?? ''),
    category: String(p.category ?? 'read'),
    status: String(tc.status ?? ''),
    riskLevel: String(p.riskLevel ?? 'low'),
    requiresApproval: Boolean(p.requiresApproval),
    ownerOnly: Boolean(p.ownerOnly),
    blocked: Boolean(p.blocked),
    confirm: String(p.confirm ?? 'none'),
    permissionId: r?.permissionId ?? null,
    guardrailNote: String(p.guardrailNote ?? ''),
    safeMode: Boolean(r?.safeMode),
  };
}

export async function voiceConfirmAction(toolCallId: string): Promise<{ ok: boolean; summary: string }> {
  const r = await gateway.confirmVoiceTool(toolCallId);
  return { ok: Boolean(r?.executed), summary: r?.resultSummary ?? 'Could not execute.' };
}

export async function voiceDecidePermissionAction(permissionId: string, action: string): Promise<{ status: string; message: string }> {
  const r = await gateway.decideVoicePermission(permissionId, action);
  return { status: r?.status ?? 'error', message: r?.message ?? '' };
}
