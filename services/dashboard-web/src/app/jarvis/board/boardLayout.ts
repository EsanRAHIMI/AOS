/**
 * Jarvis Board — placement (CIN-2c).
 *
 * Cards are placed on concentric orbital shells around the singularity: the
 * ring radius comes from the card's scope (personal → macro, per the orbital
 * law in boardModel), the angle is a deterministic hash so a card keeps its
 * seat between reloads, and a light relaxation pass stops same-ring cards from
 * overlapping. Owner overrides always win — a dragged card stays where the
 * owner put it, forever.
 */
import { SCOPE_RING, hash01, type BoardCard, type BoardScope } from './boardModel';

export interface CardPlacement {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Ring radius actually used (after override). */
  r: number;
  scope: BoardScope;
  /** True when the owner pinned this position by hand. */
  manual: boolean;
}

export type PlacementOverrides = Record<string, { x: number; y: number; z?: number }>;

const RING_JITTER = 0.9;   // world units of radial breathing per card
const Z_SPREAD = 1.5;      // out-of-plane lift so shells read as 3D
const MIN_GAP = 3.4;       // world units between card centres on a ring

/**
 * Deterministic base placement + N relaxation passes.
 * Pure function: same input → same output (no time, no randomness).
 */
export function layoutCards(cards: BoardCard[], overrides: PlacementOverrides = {}): CardPlacement[] {
  // 1) Seat every card on its scope ring, spreading same-ring cards evenly and
  //    then nudging by a stable hash so the pattern never looks mechanical.
  const byScope = new Map<BoardScope, BoardCard[]>();
  for (const c of cards) {
    const list = byScope.get(c.scope) ?? [];
    list.push(c);
    byScope.set(c.scope, list);
  }

  const placements: CardPlacement[] = [];
  for (const [scope, list] of byScope) {
    const ring = SCOPE_RING[scope];
    // Stable order within a ring: by id hash, so adding a card elsewhere never
    // reshuffles this ring.
    const ordered = [...list].sort((a, b) => hash01(a.id) - hash01(b.id));
    ordered.forEach((card, i) => {
      const manual = overrides[card.id];
      if (manual) {
        placements.push({
          id: card.id, x: manual.x, y: manual.y, z: manual.z ?? 0,
          r: Math.hypot(manual.x, manual.y), scope, manual: true,
        });
        return;
      }
      const h = hash01(card.id);
      const slot = ordered.length > 1 ? i / ordered.length : 0;
      const angle = slot * Math.PI * 2 + h * 0.55 - Math.PI / 2;
      const r = ring.radius + (h - 0.5) * 2 * RING_JITTER;
      placements.push({
        id: card.id,
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        z: (hash01(`${card.id}:z`) - 0.5) * 2 * Z_SPREAD,
        r,
        scope,
        manual: false,
      });
    });
  }

  // 2) Relax overlaps — only auto-placed cards move, and only tangentially, so
  //    the scope→distance meaning is preserved exactly.
  for (let pass = 0; pass < 12; pass += 1) {
    let moved = false;
    for (let i = 0; i < placements.length; i += 1) {
      for (let j = i + 1; j < placements.length; j += 1) {
        const a = placements[i];
        const b = placements[j];
        if (a.manual && b.manual) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= MIN_GAP || d === 0) continue;
        const push = (MIN_GAP - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        if (!a.manual) { a.x -= nx * push; a.y -= ny * push; }
        if (!b.manual) { b.x += nx * push; b.y += ny * push; }
        moved = true;
      }
    }
    if (!moved) break;
  }

  // 3) Snap auto cards back onto their ring radius (relaxation only reorders
  //    them around the circle; it must never change what shell they live on).
  for (const p of placements) {
    if (p.manual) continue;
    const d = Math.hypot(p.x, p.y) || 1;
    p.x = (p.x / d) * p.r;
    p.y = (p.y / d) * p.r;
  }

  return placements;
}

/** Idle drift so the board breathes even with no traffic (render-time only). */
export function driftOffset(id: string, t: number): { dx: number; dy: number; dz: number } {
  const h = hash01(id);
  const p = h * Math.PI * 2;
  return {
    dx: Math.sin(t * 0.21 + p) * 0.26,
    dy: Math.cos(t * 0.17 + p * 1.3) * 0.22,
    dz: Math.sin(t * 0.13 + p * 0.7) * 0.5,
  };
}
