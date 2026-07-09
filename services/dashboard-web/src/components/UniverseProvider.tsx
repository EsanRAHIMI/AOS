'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getUniverseAction, type UniverseView, type UniverseZoneView } from '@/app/universe/actions';
import { getBriefingAction, type JarvisBriefingView } from '@/app/jarvis/actions';
import { getLiveStateAction, type LiveStateView } from '@/app/operator/actions';
import type { BlockId } from '@/lib/realtimeBlocks';

/**
 * Phase AF.4 — the client-side realtime block store for the homepage.
 *
 * `page.tsx` still does the initial fetch server-side (fast first paint,
 * unchanged). This context takes over AFTER hydration: `refresh(blocks)`
 * re-fetches the real `/v1/me/universe` (+ briefing) endpoints and merges
 * the result so ONLY the zones that map to a requested block are replaced
 * — every other zone keeps its previous object reference, so components
 * reading an unaffected zone don't re-render. This is the "block-level"
 * update the product brief asks for, built on the one real endpoint that
 * actually exists (there is no per-block backend), exactly as the brief
 * says is acceptable.
 *
 * A lightweight `window` CustomEvent (`aos:invalidate-blocks`) is the
 * invalidation bus — the same pattern already used for `aos:jarvis`
 * (UniverseZone → OperatorConsole). This lets components OUTSIDE this
 * provider's tree (the persistent OperatorConsole, mounted at the layout
 * level, above/outside page.tsx) request a refresh too, via
 * `invalidateBlocks()`, without a second data-fetching mechanism or a
 * second SSE connection.
 */

const ZONE_TO_BLOCK: Record<string, BlockId> = {
  health: 'health', daily: 'daily', life: 'life', finance: 'finance',
  ventures: 'ventures', growth: 'growth', opportunities: 'opportunities',
  systems: 'systems', presence: 'channels',
};

interface UniverseContextValue {
  zones: Map<string, UniverseZoneView>;
  actor: UniverseView['actor'] | null;
  generatedAt: string;
  suggestedPrompts: string[];
  systemHealthSummary: UniverseView['systemHealthSummary'] | null;
  memoryInsights: string[];
  briefing: JarvisBriefingView | null;
  liveState: LiveStateView | null;
  refreshingBlocks: Set<BlockId>;
  refresh: (blocks: BlockId[]) => void;
}

const UniverseContext = createContext<UniverseContextValue | null>(null);

export function UniverseProvider({ initialUniverse, initialBriefing, initialLiveState, children }: { initialUniverse: UniverseView | null; initialBriefing: JarvisBriefingView | null; initialLiveState: LiveStateView | null; children: ReactNode }) {
  const [zones, setZones] = useState<Map<string, UniverseZoneView>>(() => new Map((initialUniverse?.zones ?? []).map((z) => [z.zoneId, z])));
  const [meta, setMeta] = useState({
    actor: initialUniverse?.actor ?? null,
    generatedAt: initialUniverse?.generatedAt ?? '',
    suggestedPrompts: initialUniverse?.suggestedPrompts ?? [],
    systemHealthSummary: initialUniverse?.systemHealthSummary ?? null,
    memoryInsights: initialUniverse?.memoryInsights ?? [],
  });
  const [briefing, setBriefing] = useState<JarvisBriefingView | null>(initialBriefing);
  const [liveState, setLiveState] = useState<LiveStateView | null>(initialLiveState);
  const [refreshingBlocks, setRefreshingBlocks] = useState<Set<BlockId>>(new Set());

  const refresh = useCallback((blocks: BlockId[]) => {
    if (blocks.length === 0) return;
    setRefreshingBlocks((prev) => new Set([...prev, ...blocks]));
    void (async () => {
      // Phase AF.4.1 — 'live-pulse' drives its own fetch (live-state), kept
      // independent of the universe/briefing fetch below so an operation
      // event doesn't force a full universe refetch, and vice versa.
      const wantsLiveState = blocks.includes('live-pulse');
      const [freshUniverse, freshBriefing, freshLiveState] = await Promise.all([
        getUniverseAction(), getBriefingAction(),
        wantsLiveState ? getLiveStateAction() : Promise.resolve(null),
      ]);
      if (freshUniverse) {
        setZones((prev) => {
          const next = new Map(prev);
          for (const z of freshUniverse.zones) {
            const block = ZONE_TO_BLOCK[z.zoneId];
            if (block && blocks.includes(block)) next.set(z.zoneId, z);
          }
          return next;
        });
      }
      // 'focus' and 'presence' aren't zones — they're the Focus Row /
      // Presence Bar, both briefing-derived, plus the identity-strip meta.
      if (blocks.includes('focus') || blocks.includes('presence')) {
        setBriefing(freshBriefing);
        if (freshUniverse) {
          setMeta({ actor: freshUniverse.actor, generatedAt: freshUniverse.generatedAt, suggestedPrompts: freshUniverse.suggestedPrompts, systemHealthSummary: freshUniverse.systemHealthSummary, memoryInsights: freshUniverse.memoryInsights });
        }
      }
      if (wantsLiveState && freshLiveState) setLiveState(freshLiveState);
      setRefreshingBlocks((prev) => {
        const next = new Set(prev);
        for (const b of blocks) next.delete(b);
        return next;
      });
    })();
  }, []);

  useEffect(() => {
    const handler = (e: Event): void => {
      const blocks = (e as CustomEvent<{ blocks?: BlockId[] }>).detail?.blocks ?? [];
      refresh(blocks);
    };
    window.addEventListener('aos:invalidate-blocks', handler);
    return () => window.removeEventListener('aos:invalidate-blocks', handler);
  }, [refresh]);

  const value = useMemo<UniverseContextValue>(() => ({ zones, ...meta, briefing, liveState, refreshingBlocks, refresh }), [zones, meta, briefing, liveState, refreshingBlocks, refresh]);
  return <UniverseContext.Provider value={value}>{children}</UniverseContext.Provider>;
}

export function useUniverse(): UniverseContextValue {
  const ctx = useContext(UniverseContext);
  if (!ctx) throw new Error('useUniverse() must be called within a UniverseProvider');
  return ctx;
}

/** Safe outside a provider (e.g. `DecisionButtons` is also reused at plain
 *  `/me` pages that have no UniverseProvider) — returns a no-op refresh
 *  instead of throwing. */
export function useOptionalRefresh(): (blocks: BlockId[]) => void {
  const ctx = useContext(UniverseContext);
  return ctx?.refresh ?? (() => { /* no provider mounted — nothing to refresh */ });
}

/** Callable from anywhere, including components outside the provider tree
 *  (the persistent OperatorConsole at the layout level). A no-op if no
 *  UniverseProvider is currently mounted — harmless, since Next.js already
 *  refetches `page.tsx` fresh (it's `force-dynamic`) on navigation back to
 *  the homepage. */
export function invalidateBlocks(blocks: BlockId[]): void {
  if (typeof window === 'undefined' || blocks.length === 0) return;
  window.dispatchEvent(new CustomEvent('aos:invalidate-blocks', { detail: { blocks } }));
}
