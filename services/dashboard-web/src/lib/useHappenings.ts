'use client';
/**
 * useHappenings (D-208) — the client half of the owner's live happening feed.
 *
 * ONE EventSource on `/api/owner-stream` already carries presence and
 * proactive events; this hook reads the two frames the gateway added for the
 * stage:
 *
 *   `happenings.snapshot` — the settled backlog, delivered as one frame
 *   `happening`           — a single new card, delivered as it happens
 *
 * The distinction matters for the UI, not the data: a snapshot card renders
 * already-docked, a live card gets the surface→dwell→dock animation. Without
 * it, every reconnect would replay the last hour at the owner.
 *
 * The hook owns dedupe and ordering so the view never has to. `happeningId`
 * is stable and derived from the source row, so a card re-delivered across a
 * reconnect (or by the deliberately inclusive server cursor) is recognised
 * and dropped rather than animating twice.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type HappeningCategory =
  | 'calendar' | 'tasks' | 'memory' | 'personal'
  | 'knowledge' | 'trust' | 'system' | 'dialogue';

export type HappeningKind =
  | 'owner_said' | 'jarvis_replied' | 'tool_ran' | 'tool_blocked'
  | 'approval' | 'noticed' | 'loop_cycle';

export type HappeningStatus = 'ok' | 'failed' | 'waiting' | 'denied' | 'running';

export interface Happening {
  happeningId: string;
  parentId: string | null;
  kind: HappeningKind;
  category: HappeningCategory;
  status: HappeningStatus;
  actor: 'owner' | 'jarvis' | 'system';
  title: string;
  detail: string;
  weight: number;
  refIds: string[];
  href: string | null;
  at: string;
}

/** A card and the happenings that dock beneath it, oldest → newest. */
export interface HappeningGroup {
  root: Happening;
  children: Happening[];
}

export interface HappeningsState {
  /** Everything known, newest first. */
  items: Happening[];
  /** Roots with their children resolved — what the stage renders. */
  groups: HappeningGroup[];
  /** Ids that arrived live in this session and have not finished docking. */
  fresh: string[];
  /** SSE is currently connected. */
  live: boolean;
  /** A snapshot has been received — distinguishes "empty" from "not loaded". */
  loaded: boolean;
  /** Mark a card as finished animating so it renders in its settled place. */
  settle: (id: string) => void;
}

/** History cap. Past this the oldest cards fall off — the stage is a live
 *  surface, not an archive; the archive is the dashboard page each card
 *  links to. */
const MAX_ITEMS = 300;

export function useHappenings(): HappeningsState {
  const [items, setItems] = useState<Happening[]>([]);
  const [fresh, setFresh] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());

  const ingest = useCallback((incoming: Happening[], isLive: boolean) => {
    const unseen = incoming.filter((h) => h?.happeningId && !seenRef.current.has(h.happeningId));
    if (!unseen.length) return;
    for (const h of unseen) seenRef.current.add(h.happeningId);

    setItems((prev) => {
      const next = [...unseen, ...prev];
      next.sort((a, b) => (b.at.localeCompare(a.at) || b.happeningId.localeCompare(a.happeningId)));
      const capped = next.slice(0, MAX_ITEMS);
      // Keep the dedupe set aligned with what we actually hold, so a card that
      // aged out can legitimately reappear rather than being suppressed forever.
      if (capped.length < next.length) seenRef.current = new Set(capped.map((h) => h.happeningId));
      return capped;
    });

    if (isLive) setFresh((prev) => [...unseen.map((h) => h.happeningId), ...prev].slice(0, 24));
  }, []);

  const settle = useCallback((id: string) => {
    setFresh((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : prev));
  }, []);

  useEffect(() => {
    let stopped = false;
    let retryMs = 2000;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      es = new EventSource('/api/owner-stream');

      es.addEventListener('happenings.snapshot', (e) => {
        retryMs = 2000;
        setLive(true);
        setLoaded(true);
        try {
          const { items: snap } = JSON.parse((e as MessageEvent).data) as { items: Happening[] };
          ingest(Array.isArray(snap) ? snap : [], false);
        } catch { /* a malformed frame must not kill the stream */ }
      });

      es.addEventListener('happening', (e) => {
        try { ingest([JSON.parse((e as MessageEvent).data) as Happening], true); } catch { /* ignore */ }
      });

      // `presence` proves the socket is alive even before any happening exists.
      es.addEventListener('presence', () => { setLive(true); retryMs = 2000; });

      const reconnect = () => {
        es?.close();
        setLive(false);
        if (stopped) return;
        retryTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 30_000);
      };
      es.addEventListener('stream.end', reconnect);
      es.onerror = reconnect;
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [ingest]);

  /**
   * Roots with children attached.
   *
   * An orphan (parent aged out of the window) is promoted to a root instead of
   * being hidden — a card vanishing because of a retention rule would be a
   * silent lie about what the system did. This mirrors `groupHappenings` on
   * the server; the two must agree, which is why both state the same rule.
   */
  const groups = useMemo<HappeningGroup[]>(() => {
    const byId = new Map(items.map((h) => [h.happeningId, h]));
    const children = new Map<string, Happening[]>();
    const roots: Happening[] = [];
    for (const h of items) {
      if (h.parentId && byId.has(h.parentId)) {
        const list = children.get(h.parentId) ?? [];
        list.push(h);
        children.set(h.parentId, list);
      } else {
        roots.push(h);
      }
    }
    return roots.map((root) => ({
      root,
      children: (children.get(root.happeningId) ?? []).slice().reverse(),
    }));
  }, [items]);

  return { items, groups, fresh, live, loaded, settle };
}

export const CATEGORY_LABEL_FA: Record<HappeningCategory, string> = {
  dialogue: 'گفت‌وگو',
  calendar: 'تقویم',
  tasks: 'کارها و ماموریت‌ها',
  memory: 'حافظه و تصمیم‌ها',
  personal: 'شخصی',
  knowledge: 'دانش و تحقیق',
  trust: 'اعتماد و اسناد',
  system: 'سیستم',
};

/** Category order on the rail: closest to the owner first — the same law the
 *  board's orbits follow, so the two surfaces never disagree about what is
 *  "near". */
export const CATEGORY_ORDER: HappeningCategory[] = [
  'dialogue', 'calendar', 'tasks', 'memory', 'personal', 'knowledge', 'trust', 'system',
];
