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
