/**
 * Jarvis Board — orbital placement (CIN-2c, rebuilt in D-183.9).
 *
 * ONE axis, one meaning: **every family of things has its own orbit around
 * the singularity, and the orbits are ordered by how personal the family is.**
 * A card is a body riding its family's track. Cards that belong together do
 * not need a drawn connector — they visibly share an orbit.
 *
 * Inside an orbit:
 *   · cards are spaced evenly around the whole track (deterministic slots, so
 *     a card keeps its seat across reloads),
 *   · `scope` nudges a card into an inner or outer LANE of that same track —
 *     the more personal an instance is, the closer to the inside it rides,
 *   · a crowded orbit adds lanes instead of letting cards overlap.
 *
 * Pure function: no time, no randomness. Owner-placed cards always win.
 */
import { ORBIT, groupOf, scopeIndex, type BoardCard, type BoardGroup, type BoardScope } from './boardModel';

export interface CardPlacement {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Actual orbital radius (nominal track ± lane offset). */
  r: number;
  /** Nominal radius of the track this card belongs to. */
  orbitRadius: number;
  scope: BoardScope;
  group: BoardGroup;
  /** Angle on the orbit, radians. The renderer needs it for orbital arcs. */
  theta: number;
  manual: boolean;
}

export type PlacementOverrides = Record<string, { x: number; y: number; z?: number }>;

/** Minimum arc length (world units) between two cards sharing a lane. */
const MIN_ARC = 5.2;
/** Angular window at 12 o'clock kept clear so the orbit's LABEL is never
 *  covered by a card. Scaled by radius so the reserved space is roughly the
 *  same number of pixels on every track. */
function labelGap(radius: number): number {
  return Math.min(0.62, 8.5 / Math.max(4, radius));
}
/** Radius offset between lanes of the same orbit. */
const LANE_STEP = 2.4;
/** How far `scope` may pull a card inside/outside its own track. */
const SCOPE_LANE = 0.85;
/** Out-of-plane lift so the orbits read as a 3D system, not a flat diagram. */
const Z_SPREAD = 0.9;

export function layoutCards(cards: BoardCard[], overrides: PlacementOverrides = {}): CardPlacement[] {
  const placements: CardPlacement[] = [];

  const byOrbit = new Map<BoardGroup, BoardCard[]>();
  for (const c of cards) {
    const g = groupOf(c);
    const list = byOrbit.get(g) ?? [];
    list.push(c);
    byOrbit.set(g, list);
  }

  for (const [group, list] of byOrbit) {
    const track = ORBIT[group];
    // Stable order around the track: alphabetical by title, id as tiebreak.
    const ordered = [...list].sort((a, b) => (a.title === b.title ? a.id.localeCompare(b.id) : a.title.localeCompare(b.title)));

    // How many bodies fit on one lane of this track before they crowd?
    const circumference = 2 * Math.PI * track.radius;
    const perLane = Math.max(1, Math.floor(circumference / MIN_ARC));
    const lanes = Math.max(1, Math.ceil(ordered.length / perLane));

    ordered.forEach((card, i) => {
      // Owner placement stores a DIRECTION only. A card can be slid around
      // its track but never pulled off it — leaving an orbit would break the
      // one rule the board is built on, so it is only possible by changing
      // the card's orbit explicitly (boardProfile.orbitOverrides).
      const manual = overrides[card.id];
      if (manual) {
        const theta = Math.atan2(manual.y, manual.x);
        const rManual = track.radius + (2 - Math.min(4, scopeIndex(card.scope))) * SCOPE_LANE * -0.5;
        placements.push({
          id: card.id,
          x: Math.cos(theta) * rManual,
          y: Math.sin(theta) * rManual,
          z: manual.z ?? 0,
          r: rManual, orbitRadius: track.radius,
          scope: card.scope, group, theta, manual: true,
        });
        return;
      }
      const lane = i % lanes;
      const indexInLane = Math.floor(i / lanes);
      const countInLane = Math.ceil((ordered.length - lane) / lanes);
      // Spread the lane's bodies over the circle MINUS the label window, so
      // the orbit's caption at 12 o'clock always stays readable. Lanes are
      // phase-shifted so neighbours interleave instead of lining up radially.
      const gap = labelGap(track.radius);
      const usable = Math.PI * 2 - gap;
      const step = usable / countInLane;
      const lanePhase = (lane / lanes) * step * 0.5;
      // Start just after the reserved label window at the top.
      const theta = -Math.PI / 2 + gap / 2 + step / 2 + indexInLane * step + lanePhase;

      // Lane offset: crowding pushes outward, personal scope pulls inward.
      const crowdOffset = lanes === 1 ? 0 : (lane - (lanes - 1) / 2) * LANE_STEP;
      const personalPull = (2 - Math.min(4, scopeIndex(card.scope))) * SCOPE_LANE * -0.5;
      const r = Math.max(2, track.radius + crowdOffset + personalPull);

      placements.push({
        id: card.id,
        x: Math.cos(theta) * r,
        y: Math.sin(theta) * r,
        z: ((i % 3) - 1) * Z_SPREAD,
        r,
        orbitRadius: track.radius,
        scope: card.scope,
        group,
        theta,
        manual: false,
      });
    });
  }

  return placements;
}

/** Idle drift — a body breathing along its track, never enough to blur it. */
export function driftOffset(id: string, t: number): { dx: number; dy: number; dz: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  const p = ((h >>> 0) % 1000) / 1000 * Math.PI * 2;
  return {
    dx: Math.sin(t * 0.16 + p) * 0.1,
    dy: Math.cos(t * 0.13 + p * 1.3) * 0.09,
    dz: Math.sin(t * 0.1 + p * 0.7) * 0.25,
  };
}
