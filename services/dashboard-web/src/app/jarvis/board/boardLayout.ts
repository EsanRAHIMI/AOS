/**
 * Jarvis Board — placement (CIN-2c, rebuilt in D-183.8 for scale).
 *
 * Two orthogonal axes, both semantic:
 *   · RADIUS  = scope — how personal the subject is (boardModel's orbital law)
 *   · ANGLE   = group — what family of thing it is (identity / value /
 *               execution / knowledge / trust / infra)
 *
 * Every group owns the same angular wedge on every ring, so a domain reads as
 * a spoke from the centre outward and related cards are always neighbours.
 * That is what keeps 50–100+ cards legible: an edge between two cards of the
 * same family stays inside one narrow wedge instead of crossing the board.
 *
 * Inside a wedge cards are laid out on evenly spaced angular slots; when a
 * wedge gets crowded the placement spills into concentric LANES (small radius
 * offsets) rather than letting cards overlap. Everything is deterministic —
 * same input, same seats, every reload — and owner-placed cards always win.
 */
import { BOARD_GROUPS, SCOPE_RING, groupOf, type BoardCard, type BoardGroup, type BoardScope } from './boardModel';

export interface CardPlacement {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Ring radius actually used (after lane offset). */
  r: number;
  scope: BoardScope;
  group: BoardGroup;
  /** Angle in radians — the renderer uses it for radial edge bundling. */
  theta: number;
  /** True when the owner pinned this position by hand. */
  manual: boolean;
}

export type PlacementOverrides = Record<string, { x: number; y: number; z?: number }>;

/** Gap between neighbouring group wedges (radians) — the visual separator. */
const SECTOR_GAP = 0.16;
/** Minimum arc length (world units) between two cards on the same lane. */
const MIN_ARC = 4.6;
/** Radius step when a wedge spills into another lane. */
const LANE_STEP = 3.1;
/** Out-of-plane lift so shells read as 3D without hiding anything. */
const Z_SPREAD = 1.1;

function wedges(): Map<BoardGroup, { start: number; size: number }> {
  const n = BOARD_GROUPS.length;
  const size = (Math.PI * 2) / n;
  const map = new Map<BoardGroup, { start: number; size: number }>();
  BOARD_GROUPS.forEach((g, i) => {
    // −π/2 puts the first wedge at the top; wedges then run clockwise.
    map.set(g, { start: i * size - Math.PI / 2 + SECTOR_GAP / 2, size: size - SECTOR_GAP });
  });
  return map;
}

export const GROUP_WEDGES = wedges();

/** Centre angle of a group's wedge — used for sector labels and bundling. */
export function wedgeCenter(group: BoardGroup): number {
  const w = GROUP_WEDGES.get(group)!;
  return w.start + w.size / 2;
}

/**
 * Deterministic sector placement. Pure function: no time, no randomness, so
 * a card keeps its seat across reloads and re-renders.
 */
export function layoutCards(cards: BoardCard[], overrides: PlacementOverrides = {}): CardPlacement[] {
  const placements: CardPlacement[] = [];

  // Bucket by (scope ring × group wedge) — the natural cell of this layout.
  const cells = new Map<string, BoardCard[]>();
  for (const c of cards) {
    const key = `${c.scope}|${groupOf(c)}`;
    const list = cells.get(key) ?? [];
    list.push(c);
    cells.set(key, list);
  }

  for (const [key, list] of cells) {
    const [scope, group] = key.split('|') as [BoardScope, BoardGroup];
    const ring = SCOPE_RING[scope];
    const wedge = GROUP_WEDGES.get(group)!;
    // Stable order inside a cell: by title then id, so the sequence never
    // depends on the order the sources happened to answer in.
    const ordered = [...list].sort((a, b) => (a.title === b.title ? a.id.localeCompare(b.id) : a.title.localeCompare(b.title)));

    // How many fit on one lane before spacing gets tighter than MIN_ARC?
    const perLane = Math.max(1, Math.floor((wedge.size * Math.max(ring.radius, 1)) / MIN_ARC));
    const lanes = Math.max(1, Math.ceil(ordered.length / perLane));

    ordered.forEach((card, i) => {
      const manual = overrides[card.id];
      if (manual) {
        placements.push({
          id: card.id, x: manual.x, y: manual.y, z: manual.z ?? 0,
          r: Math.hypot(manual.x, manual.y), scope, group,
          theta: Math.atan2(manual.y, manual.x), manual: true,
        });
        return;
      }
      const lane = i % lanes;
      const indexInLane = Math.floor(i / lanes);
      const countInLane = Math.ceil((ordered.length - lane) / lanes);
      // Centre the lane's cards inside the wedge; a single card sits dead
      // centre, which makes small boards look composed rather than random.
      const step = countInLane > 1 ? wedge.size / (countInLane + 1) : 0;
      const theta = countInLane > 1
        ? wedge.start + step * (indexInLane + 1)
        : wedge.start + wedge.size / 2;
      // Alternate lanes outward/inward around the nominal ring so a crowded
      // wedge thickens symmetrically instead of drifting off its shell.
      const laneOffset = lanes === 1 ? 0 : (lane - (lanes - 1) / 2) * LANE_STEP;
      const r = Math.max(2, ring.radius + laneOffset);
      placements.push({
        id: card.id,
        x: Math.cos(theta) * r,
        y: Math.sin(theta) * r,
        z: ((i % 3) - 1) * Z_SPREAD,
        r,
        scope,
        group,
        theta,
        manual: false,
      });
    });
  }

  return placements;
}

/** Idle drift so the board breathes even with no traffic (render-time only).
 *  Deliberately tiny: at 100 cards, motion is noise, not life. */
export function driftOffset(id: string, t: number): { dx: number; dy: number; dz: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  const p = ((h >>> 0) % 1000) / 1000 * Math.PI * 2;
  return {
    dx: Math.sin(t * 0.18 + p) * 0.12,
    dy: Math.cos(t * 0.15 + p * 1.3) * 0.1,
    dz: Math.sin(t * 0.11 + p * 0.7) * 0.3,
  };
}
