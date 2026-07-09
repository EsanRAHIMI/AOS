'use server';
/**
 * Phase AF.4 — server action wrapping `gateway.universe()` (previously only
 * ever called once, server-side, from `page.tsx`). This is the real
 * refetch path `UniverseProvider` calls after a domain action succeeds or a
 * relevant SSE event arrives, so the Domain Canvas can update without a
 * full page navigation. Same real endpoint, same mapped shape — no second
 * source of truth.
 */
import { gateway } from '@/lib/gateway';

export interface UniverseZoneItemView { label: string; detail: string; tone: string; href?: string; itemId?: string }
export interface UniverseZoneView {
  zoneId: string;
  title: string;
  status: string;
  headline: string;
  items: UniverseZoneItemView[];
  setupHint: string;
  jarvisCommand: string;
  href: string;
  metrics: Array<{ label: string; value: string; tone: string }>;
}
export interface UniverseView {
  zones: UniverseZoneView[];
  actor: { displayName: string };
  generatedAt: string;
  suggestedPrompts: string[];
  todaySummary: string;
  systemHealthSummary: { servicesRegistered: number; openIncidents: number; pendingApprovals: number; safeMode: boolean; activeOperation: string | null };
  memoryInsights: string[];
}

export async function getUniverseAction(): Promise<UniverseView | null> {
  const r = await gateway.universe();
  if (!r) return null;
  return {
    zones: r.zones as UniverseZoneView[],
    actor: r.actor,
    generatedAt: r.generatedAt,
    suggestedPrompts: r.suggestedPrompts,
    todaySummary: r.todaySummary,
    systemHealthSummary: r.systemHealthSummary,
    memoryInsights: r.memoryInsights,
  };
}
