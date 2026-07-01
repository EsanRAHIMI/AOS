import { z } from 'zod';
import { IsoDate } from './common.js';

/* ===========================================================================
 * Phase 18 — Realtime Voice Operator schemas.
 * The voice operator never mutates state directly: every action is a tool call
 * routed through the deterministic mediation layer, gated by RBAC / safe mode /
 * approvals, and audited. No secrets are stored in any of these records.
 * ======================================================================== */

export const VoiceMode = z.enum(['collapsed', 'listening', 'speaking', 'thinking', 'waiting_for_permission', 'executing', 'reporting', 'error']);
export type VoiceMode = z.infer<typeof VoiceMode>;

export const VoiceRiskLevel = z.enum(['low', 'medium', 'high', 'critical']);
export type VoiceRiskLevel = z.infer<typeof VoiceRiskLevel>;

export const VoiceSessionSchema = z.object({
  voiceSessionId: z.string(),
  userId: z.string(),
  role: z.string(),
  startedAt: IsoDate,
  endedAt: z.string().nullable().default(null),
  status: z.enum(['active', 'ended']).default('active'),
  currentPage: z.string().default('/'),
  activeTaskId: z.string().nullable().default(null),
  activeOperationPlanId: z.string().nullable().default(null),
  mode: VoiceMode.default('collapsed'),
  provider: z.string().default('text'),
  model: z.string().default(''),
  costUsd: z.number().default(0),
  transcriptSummary: z.string().default(''),
});
export type VoiceSession = z.infer<typeof VoiceSessionSchema>;

export const VoiceMessageSchema = z.object({
  messageId: z.string(),
  sessionId: z.string(),
  direction: z.enum(['user', 'agent']),
  modality: z.enum(['voice', 'text']).default('text'),
  text: z.string(),
  timestamp: IsoDate,
  linkedTaskId: z.string().nullable().default(null),
  linkedOperationPlanId: z.string().nullable().default(null),
});
export type VoiceMessage = z.infer<typeof VoiceMessageSchema>;

export const VoiceToolCallSchema = z.object({
  toolCallId: z.string(),
  sessionId: z.string(),
  toolName: z.string(),
  category: z.string().default(''),
  proposedArgs: z.record(z.string(), z.unknown()).default({}),
  riskLevel: VoiceRiskLevel.default('low'),
  requiresApproval: z.boolean().default(false),
  ownerOnly: z.boolean().default(false),
  status: z.enum(['proposed', 'awaiting_confirmation', 'awaiting_approval', 'executed', 'blocked', 'rejected', 'failed']).default('proposed'),
  blockedReason: z.string().default(''),
  resultSummary: z.string().default(''),
  evidenceIds: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type VoiceToolCall = z.infer<typeof VoiceToolCallSchema>;

export const VoicePermissionSchema = z.object({
  permissionId: z.string(),
  sessionId: z.string(),
  toolCallId: z.string(),
  prompt: z.string(),
  riskLevel: VoiceRiskLevel.default('medium'),
  ownerOnly: z.boolean().default(false),
  approvedBy: z.string().nullable().default(null),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  createdAt: IsoDate,
  decidedAt: z.string().nullable().default(null),
});
export type VoicePermission = z.infer<typeof VoicePermissionSchema>;

export const VoiceMemorySchema = z.object({
  memoryId: z.string(),
  userId: z.string(),
  kind: z.enum(['preference', 'instruction', 'mistake_avoidance', 'mapping', 'workflow']),
  content: z.string(),
  sourceSessionId: z.string().nullable().default(null),
  createdAt: IsoDate,
});
export type VoiceMemory = z.infer<typeof VoiceMemorySchema>;

export const VoiceLearningEventSchema = z.object({
  learningEventId: z.string(),
  sessionId: z.string(),
  userId: z.string(),
  summary: z.string(),
  lessons: z.array(z.string()).default([]),
  linkedTaskIds: z.array(z.string()).default([]),
  linkedEvidenceIds: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type VoiceLearningEvent = z.infer<typeof VoiceLearningEventSchema>;
