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

/** Legacy scope table. Since D-183.9 the ORBIT (family) decides the radius;
 *  scope now only nudges a card to an inner/outer LANE of its own orbit — the
 *  more personal an instance is, the closer to the inside of its track it
 *  rides. Tones are still used for card accents and ring captions. */
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

/**
 * ORBITS (D-183.9 — the board's primary structure).
 *
 * Each family of things gets its OWN ORBIT around the singularity, and the
 * orbits are ordered by how personal the family is: the innermost orbit is
 * the owner's own identity and life, the outermost is shared infrastructure
 * and the public world. Every card of a family is a body ON that orbit.
 *
 * This replaces the earlier "ring × wedge" grid because it says the same
 * thing with one axis instead of two: the orbit you are on IS your family,
 * and how far out you sit IS how shared you are. It also makes the connection
 * between related cards implicit — they literally share a track — so the
 * board stops needing a web of chords to express "these belong together".
 */
export type BoardGroup = 'identity' | 'value' | 'execution' | 'knowledge' | 'trust' | 'infra';

export const BOARD_GROUPS: readonly BoardGroup[] = ['identity', 'value', 'execution', 'knowledge', 'trust', 'infra'] as const;

export const GROUP_LABEL_FA: Record<BoardGroup, string> = {
  identity: 'هویت و زندگی',
  value: 'ارزش و دارایی',
  execution: 'اجرا و عملیات',
  knowledge: 'دانش و تحقیق',
  trust: 'اعتماد و روابط',
  infra: 'زیرساخت و جهان',
};

/**
 * The orbit table — the single source of truth for the board's geometry.
 * `index` is the distance order from the singularity (0 = closest, most
 * personal). Radii are spaced so a card sitting on one orbit never visually
 * belongs to its neighbour.
 */
export const ORBIT: Record<BoardGroup, { index: number; radius: number; label: string; labelFa: string; tone: [number, number, number] }> = {
  identity:  { index: 0, radius: 7.4,  label: 'IDENTITY',  labelFa: 'هویت و زندگی',      tone: [255, 196, 128] },
  value:     { index: 1, radius: 12.2, label: 'VALUE',     labelFa: 'ارزش و دارایی',     tone: [126, 231, 168] },
  execution: { index: 2, radius: 17.2, label: 'EXECUTION', labelFa: 'اجرا و عملیات',     tone: [155, 160, 255] },
  knowledge: { index: 3, radius: 22.4, label: 'KNOWLEDGE', labelFa: 'دانش و تحقیق',      tone: [110, 205, 255] },
  trust:     { index: 4, radius: 27.8, label: 'TRUST',     labelFa: 'اعتماد و روابط',    tone: [255, 190, 96] },
  infra:     { index: 5, radius: 33.4, label: 'INFRA',     labelFa: 'زیرساخت و جهان',    tone: [176, 190, 216] },
};

/** Orbits ordered from the singularity outward. */
export const ORBIT_ORDER: readonly BoardGroup[] =
  [...BOARD_GROUPS].sort((a, b) => ORBIT[a].index - ORBIT[b].index);

/** Default family per source; a card may override with its own `group`. */
export const GROUP_OF_SOURCE: Record<BoardSourceId, BoardGroup> = {
  profile: 'identity',
  documents: 'identity',
  finance: 'value',
  business: 'value',
  missions: 'execution',
  loop: 'execution',
  proactive: 'execution',
  memory: 'knowledge',
  research: 'knowledge',
  cin: 'trust',
  relations: 'trust',
  services: 'infra',
  custom: 'infra',
};

export interface BoardCard {
  id: string;
  sourceId: BoardSourceId;
  scope: BoardScope;
  /** Angular family (defaults to GROUP_OF_SOURCE[sourceId]). */
  group?: BoardGroup;
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

export function groupOf(card: Pick<BoardCard, 'group' | 'sourceId'>): BoardGroup {
  return card.group ?? GROUP_OF_SOURCE[card.sourceId] ?? 'infra';
}

/** Recency → 0..1 activity, halving every `halfLifeMs`. Used by every source
 *  mapper so "alive" means the same thing across the whole board. */
export function recencyActivity(iso: string | null | undefined, halfLifeMs = 10 * 60_000): number {
  if (!iso) return 0;
  const age = Date.now() - Date.parse(iso);
  if (!Number.isFinite(age) || age < 0) return 1;
  return Math.max(0, Math.min(1, Math.pow(0.5, age / halfLifeMs)));
}
