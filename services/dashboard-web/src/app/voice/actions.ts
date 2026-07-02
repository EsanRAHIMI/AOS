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
  /** Phase 19.5 — server-side gate results: drop silently on the client. */
  duplicate: boolean;
  ignored: boolean;
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

export async function voiceSendAction(sessionId: string, text: string, page: string, modality: 'voice' | 'text' = 'text'): Promise<VoiceTurn> {
  const r = await gateway.voiceMessage(sessionId, text, page, modality);
  const p = (r?.proposal ?? {}) as Record<string, unknown>;
  const tc = (r?.toolCall ?? {}) as Record<string, unknown>;
  const flags = (r ?? {}) as Record<string, unknown>;
  return {
    duplicate: Boolean(flags.duplicate),
    ignored: Boolean(flags.ignored),
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

/* ----- Phase 19 — Full Realtime Voice WebRTC ------------------------------
 * These actions run server-side: the gateway admin token never reaches the
 * browser, and the browser only ever receives the short-lived EPHEMERAL
 * client secret minted by the voice-operator-agent (never the real API key). */

export interface RealtimeGrant {
  ok: boolean;
  clientSecret?: string;
  model?: string;
  expiresAt?: number;
  apiVariant?: 'ga' | 'beta';
  maxSessionSeconds: number;
  error?: string;
}

export async function voiceRealtimeTokenAction(): Promise<RealtimeGrant> {
  const r = await gateway.voiceRealtimeToken();
  if (!r) return { ok: false, maxSessionSeconds: 600, error: 'kernel unreachable' };
  return { ok: Boolean(r.ok), clientSecret: r.clientSecret, model: r.model, expiresAt: r.expiresAt, apiVariant: r.apiVariant, maxSessionSeconds: r.maxSessionSeconds ?? 600, error: r.error };
}

/** SDP offer → answer through the gateway proxy (sanitized event recorded server-side). */
export async function voiceRealtimeSdpAction(p: { sessionId: string; clientSecret: string; model: string; sdp: string; apiVariant?: string }): Promise<{ ok: boolean; sdp?: string; error?: string }> {
  const r = await gateway.voiceRealtimeSdp(p);
  return r?.sdp ? { ok: true, sdp: r.sdp } : { ok: false, error: 'SDP exchange failed (token expired or provider unreachable)' };
}

export async function voiceEndSessionAction(sessionId: string, meta: { durationSec: number; connectionMode: string; interactionMode: string; transcriptSummary: string; errorSummary: string; fallbackReason: string }): Promise<void> {
  await gateway.endVoiceSession(sessionId, meta);
}
