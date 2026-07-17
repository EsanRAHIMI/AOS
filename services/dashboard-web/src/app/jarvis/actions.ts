'use server';
/**
 * Phase AF.1 — server action for the daily command briefing. Single source
 * of truth consumed by BOTH the homepage Presence Bar/Focus Row (server
 * component, calls this directly) and the persistent Jarvis shell (client
 * component, calls this to refresh). One mapped shape, one real endpoint
 * (`GET /v1/jarvis/briefing`, Phase AE/AE.1) — no duplicated fetch/mapping
 * logic between the two call sites.
 */
import { gateway } from '@/lib/gateway';

export interface JarvisMemoryFactView { kind: string; content: string; importance: number; createdAt: string }
export interface JarvisPrioritizedItemView { label: string; detail: string; type: 'task' | 'project' | 'action'; weight: number }

export interface JarvisBriefingView {
  briefingId: string;
  headline: string;
  narrative: string;
  primaryPriority: string;
  activeBlockers: string[];
  systemWarnings: string[];
  recommendedNextActions: string[];
  suggestedFollowUps: string[];
  memoryFactsUsed: JarvisMemoryFactView[];
  prioritizedItems: JarvisPrioritizedItemView[];
  confidence: number;
  dataFreshness: string;
  language: string;
}

/** Real endpoint, real mapping — never a hardcoded/placeholder briefing.
 *  Returns null (never a fake object) when the kernel is unreachable or the
 *  actor has no scoped context yet; callers must render an honest empty
 *  state, not invented content. */
export async function getBriefingAction(): Promise<JarvisBriefingView | null> {
  const r = await gateway.briefing();
  if (!r) return null;
  return {
    briefingId: r.briefingId,
    headline: r.headline,
    narrative: r.narrative,
    primaryPriority: r.primaryPriority,
    activeBlockers: r.activeBlockers,
    systemWarnings: r.systemWarnings,
    recommendedNextActions: r.recommendedNextActions,
    suggestedFollowUps: r.suggestedFollowUps,
    memoryFactsUsed: r.memoryFactsUsed,
    prioritizedItems: r.prioritizedItems,
    confidence: r.confidence,
    dataFreshness: r.dataFreshness,
    language: r.language,
  };
}

/* ============================ K2 Persistent Jarvis (D-177) ================ */

export interface JarvisSessionView { sessionId: string; title: string; turnCount: number; lastTurnAt: string | null; totalCostUsd: number }
export interface JarvisTurnView { turnId: string; userText: string; replyText: string; status: string; reasoningMode: string; provider: string; costUsd: number; pendingApprovalId: string | null; runId: string | null; createdAt: string }
export interface JarvisTurnResult { turnId: string; runId: string | null; status: string; replyText: string; pendingApprovalId: string | null; reasoningMode: string }

export async function listSessionsAction(): Promise<JarvisSessionView[]> {
  return (await gateway.jarvisSessions()) ?? [];
}

export async function createSessionAction(title?: string): Promise<string | null> {
  const r = await gateway.createJarvisSession(title);
  return r?.sessionId ?? null;
}

export async function getSessionAction(sessionId: string): Promise<{ session: JarvisSessionView | null; turns: JarvisTurnView[] }> {
  const r = await gateway.jarvisSession(sessionId);
  if (!r) return { session: null, turns: [] };
  return { session: r.session as unknown as JarvisSessionView, turns: (r.turns as unknown as JarvisTurnView[]) ?? [] };
}

export async function sendTurnAction(sessionId: string, text: string): Promise<JarvisTurnResult | null> {
  return gateway.jarvisTurn(sessionId, text);
}

export async function decideApprovalAction(approvalId: string, runId: string, action: 'approve' | 'reject', reason?: string): Promise<{ status: string; replyText: string; pendingApprovalId: string | null } | null> {
  return gateway.jarvisApprovalDecision(approvalId, runId, action, reason);
}

export async function intelligenceStatusAction() {
  return gateway.jarvisIntelligenceStatus();
}

export async function listMemoriesAction() {
  return (await gateway.jarvisMemories()) ?? [];
}

export async function correctMemoryAction(id: string, newContent: string) {
  return gateway.jarvisMemoryCorrect(id, newContent);
}
export async function pinMemoryAction(id: string, pinned: boolean) {
  return gateway.jarvisMemoryPin(id, pinned);
}
export async function deleteMemoryAction(id: string) {
  return gateway.jarvisMemoryDelete(id);
}
export async function listToolsAction() {
  return gateway.jarvisTools();
}
