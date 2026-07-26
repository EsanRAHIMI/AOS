/**
 * Jarvis Board — synapse traffic (CIN-2c).
 *
 * Cards that exchange data are wired like neurons: a resting axon whose
 * thickness encodes structural strength, plus discrete packets that actually
 * travel from the sending card to the receiving one. Packet spawn rate is
 * driven by REAL activity (link.flow, itself derived from recency of the
 * underlying records), so a quiet system looks quiet — the animation is a
 * readout, not decoration.
 *
 * Renderer-agnostic: this module only advances packet positions. The board
 * canvas decides how to paint them.
 */
import type { BoardLink } from './boardModel';

export interface Packet {
  linkIndex: number;
  /** 0..1 along the axon, from → to. */
  t: number;
  speed: number;
  size: number;
  /** Fades in/out at the ends so packets don't pop. */
  life: number;
}

export interface BurstRequest {
  from: string;
  to: string;
  /** 1..n packets injected at once (a "spike"). */
  count?: number;
}

const MAX_PACKETS = 420;

export class SynapseTraffic {
  private packets: Packet[] = [];
  private carry: number[] = [];

  /** Advance the simulation. `links` may be replaced between frames. */
  update(links: BoardLink[], dt: number, speedMul = 1): void {
    if (this.carry.length !== links.length) this.carry = new Array(links.length).fill(0);

    // Spawn: expected packets/second scales with live flow only.
    for (let i = 0; i < links.length; i += 1) {
      const flow = Math.max(0, Math.min(1, links[i].flow));
      if (flow <= 0.02) continue;
      const rate = 0.35 + flow * 3.4;
      this.carry[i] += rate * dt;
      while (this.carry[i] >= 1) {
        this.carry[i] -= 1;
        if (this.packets.length < MAX_PACKETS) {
          this.packets.push({
            linkIndex: i,
            t: 0,
            speed: (0.28 + flow * 0.55) * speedMul,
            size: 1 + flow * 1.8,
            life: 0,
          });
        }
      }
    }

    // Advance + retire.
    for (let p = this.packets.length - 1; p >= 0; p -= 1) {
      const pk = this.packets[p];
      if (pk.linkIndex >= links.length) { this.packets.splice(p, 1); continue; }
      pk.t += pk.speed * dt;
      pk.life = Math.min(1, pk.life + dt * 4);
      if (pk.t >= 1) this.packets.splice(p, 1);
    }
  }

  /** Inject an immediate spike — used when a real event lands (SSE/poll diff). */
  burst(links: BoardLink[], req: BurstRequest): void {
    const idx = links.findIndex((l) => l.from === req.from && l.to === req.to);
    if (idx < 0) return;
    const n = Math.max(1, Math.min(6, req.count ?? 3));
    for (let i = 0; i < n; i += 1) {
      if (this.packets.length >= MAX_PACKETS) break;
      this.packets.push({ linkIndex: idx, t: -i * 0.06, speed: 0.75, size: 2.2, life: 0 });
    }
  }

  list(): readonly Packet[] {
    return this.packets;
  }

  clear(): void {
    this.packets = [];
    this.carry = [];
  }
}

/** Quadratic bezier point — axons bow away from the singularity so they never
 *  cut through the black hole at the centre of the board. */
export function axonPoint(
  ax: number, ay: number, bx: number, by: number, bow: number, t: number,
): { x: number; y: number } {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  // Perpendicular offset, sign chosen so the curve bends outward from origin.
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const outward = mx * nx + my * ny >= 0 ? 1 : -1;
  const cx = mx + nx * bow * outward;
  const cy = my + ny * bow * outward;
  const u = 1 - t;
  return {
    x: u * u * ax + 2 * u * t * cx + t * t * bx,
    y: u * u * ay + 2 * u * t * cy + t * t * by,
  };
}
