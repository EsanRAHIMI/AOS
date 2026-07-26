/**
 * Jarvis Board — data model (CIN-2c).
 *
 * The /jarvis stage is an INFINITE 3D board with the Gargantua singularity at
 * world origin. Everything the owner operates lives on it as a living card.
 *
 * ORBITAL LAW (owner directive 2026-07-25): distance from the centre encodes
 * how personal the subject is. The self sits on the singularity; personal
 * life orbits closest; work/projects next; organisation beyond that; then the
 * network of counterparties; the public/macro world is the outermost shell.
 * A card's ring is therefore semantic, not decorative — moving outward always
 * means "less mine, more shared".
 *
 * This module is pure data: no DOM, no React, no renderer. The camera
 * (boardCamera), the placement (boardLayout), the live traffic (boardSynapses)
 * and the personalisation (boardProfile) each consume it independently, so any
 * one of them can be rewritten without touching the others.
 */

export type BoardScope = 'self' | 'personal' | 'work' | 'org' | 'network' | 'world';

export const BOARD_SCOPES: readonly BoardScope[] = ['self', 'personal', 'work', 'org', 'network', 'world'] as const;

/** Ring geometry in world units (singularity radius ≈ 1). Tuned so a default
 *  camera frames `personal` + `work` and the outer shells invite exploration. */
export const SCOPE_RING: Record<BoardScope, { radius: number; label: string; labelFa: string; tone: [number, number, number] }> = {
  self:     { radius: 0,    label: 'SELF',     labelFa: 'خود',            tone: [255, 214, 140] },
  personal: { radius: 6.2,  label: 'PERSONAL', labelFa: 'شخصی',           tone: [255, 176, 108] },
  work:     { radius: 10.4, label: 'WORK',     labelFa: 'کار و پروژه',     tone: [128, 214, 255] },
  org:      { radius: 14.8, label: 'ORG',      labelFa: 'سازمان',          tone: [150, 168, 255] },
  network:  { radius: 19.6, label: 'NETWORK',  labelFa: 'شبکه و طرف‌ها',   tone: [122, 240, 200] },
  world:    { radius: 25.2, label: 'WORLD',    labelFa: 'عمومی و کلان',    tone: [190, 200, 230] },
};

/** Where a card's content comes from. Adding a source never requires touching
 *  the renderer — only a mapper in boardSources. */
export type BoardSourceId =
  | 'loop' | 'missions' | 'proactive' | 'cin' | 'memory' | 'research' | 'services'
  | 'profile' | 'finance' | 'business' | 'documents' | 'relations' | 'custom';

export type BoardLinkKind = 'data' | 'control' | 'trust' | 'derives' | 'alert';

export interface BoardMetric {
  k: string;
  v: string;
  /** 0..1 — drives the metric's emphasis; omit for neutral. */
  heat?: number;
}

export interface BoardCard {
  id: string;
  sourceId: BoardSourceId;
  scope: BoardScope;
  title: string;
  subtitle: string;
  metrics: BoardMetric[];
  /** 0..1 live activity: pulse rate, glow, synapse traffic. */
  activity: number;
  /** ISO timestamp of the newest underlying record, when known. */
  updatedAt: string | null;
  /** Optional deep link into the classic dashboard page. */
  href: string | null;
  accent: [number, number, number];
  /** Honest empty-state text when the source has nothing yet. */
  emptyHint?: string;
  /** Cards the owner has not configured a real source for yet. */
  placeholder?: boolean;
}

export interface BoardLink {
  from: string;
  to: string;
  kind: BoardLinkKind;
  /** 0..1 structural strength — thickness/opacity of the resting synapse. */
  strength: number;
  /** 0..1 live traffic — how often packets travel this axon right now. */
  flow: number;
  label?: string;
}

export interface BoardGraph {
  cards: BoardCard[];
  links: BoardLink[];
  /** Sources that answered vs. failed — surfaced honestly in the UI. */
  degraded: string[];
  generatedAt: string;
}

export const EMPTY_GRAPH: BoardGraph = { cards: [], links: [], degraded: [], generatedAt: '' };

/** Stable 0..1 hash — deterministic angles so cards don't jump between loads. */
export function hash01(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export function scopeIndex(scope: BoardScope): number {
  return BOARD_SCOPES.indexOf(scope);
}

/** Recency → 0..1 activity, halving every `halfLifeMs`. Used by every source
 *  mapper so "alive" means the same thing across the whole board. */
export function recencyActivity(iso: string | null | undefined, halfLifeMs = 10 * 60_000): number {
  if (!iso) return 0;
  const age = Date.now() - Date.parse(iso);
  if (!Number.isFinite(age) || age < 0) return 1;
  return Math.max(0, Math.min(1, Math.pow(0.5, age / halfLifeMs)));
}
