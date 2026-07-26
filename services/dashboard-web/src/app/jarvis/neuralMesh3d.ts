/**
 * NeuralMesh3D — independent 3D cage around the singularity.
 * Driven only by JarvisEnsemblePose (no import of Gargantua renderer).
 */
import { luxPaletteFromAccent, type GargantuaRGB as RGB } from './drawGargantua';
import type { JarvisEnsemblePose } from './jarvisStage';

export type NeuralMesh3D = {
  nodes: Array<{ pos: [number, number, number]; flash: number; driftPhase: number; shell: number }>;
  edges: Array<[number, number]>;
  neighbors: number[][];
};

type Projected = { x: number; y: number; z: number; persp: number; occ: boolean };
type Signal = { a: number; b: number; t: number; speed: number };

function rgba(c: RGB, a: number): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function buildNeuralMesh3D(countPerShell: number, k: number, shells = 2): NeuralMesh3D {
  const nodes: NeuralMesh3D['nodes'] = [];
  const increment = Math.PI * (3 - Math.sqrt(5));
  for (let s = 0; s < shells; s += 1) {
    const shellR = shells === 1 ? 1 : 0.78 + (s / Math.max(1, shells - 1)) * 0.22;
    for (let i = 0; i < countPerShell; i += 1) {
      const y = 1 - (i / Math.max(1, countPerShell - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * increment;
      nodes.push({
        pos: [Math.cos(phi) * r * shellR, y * shellR, Math.sin(phi) * r * shellR],
        flash: 0,
        driftPhase: Math.random() * Math.PI * 2,
        shell: s,
      });
    }
  }
  const count = nodes.length;
  const seen = new Set<string>();
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < count; i += 1) {
    const dists: Array<[number, number]> = [];
    for (let j = 0; j < count; j += 1) {
      if (i === j) continue;
      const shellBias = nodes[i].shell === nodes[j].shell ? 0 : 0.35;
      const [ax, ay, az] = nodes[i].pos;
      const [bx, by, bz] = nodes[j].pos;
      dists.push([j, (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2 + shellBias]);
    }
    dists.sort((a, b) => a[1] - b[1]);
    for (let m = 0; m < k; m += 1) {
      const j = dists[m][0];
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (!seen.has(key)) { seen.add(key); edges.push([i, j]); }
    }
  }
  if (shells > 1) {
    for (let i = 0; i < countPerShell; i += 3) {
      const a = i;
      const b = countPerShell + i;
      const key = `${a}:${b}`;
      if (!seen.has(key)) { seen.add(key); edges.push([a, b]); }
    }
  }
  const neighbors: number[][] = Array.from({ length: count }, () => []);
  for (const [a, b] of edges) { neighbors[a].push(b); neighbors[b].push(a); }
  return { nodes, edges, neighbors };
}

export type NeuralMeshPainter = {
  paint: (ctx: CanvasRenderingContext2D, pose: JarvisEnsemblePose, now: number) => void;
  setCompact: (compact: boolean) => void;
};

export function createNeuralMeshPainter(compact: boolean): NeuralMeshPainter {
  let mesh = buildNeuralMesh3D(compact ? 28 : 40, 3, 2);
  let projected: Projected[] = mesh.nodes.map(() => ({ x: 0, y: 0, z: 0, persp: 1, occ: false }));
  const signals: Signal[] = [];
  let signalCap = compact ? 12 : 18;
  let nextSignalAt = 0;

  return {
    setCompact(next) {
      compact = next;
      signalCap = compact ? 12 : 18;
      // Keep graph topology stable across resize — only retune signal budget.
    },
    paint(ctx, pose, now) {
      const { cx, cy, meshRadius, bhKeepout, t, dt, speak, speedMul, spin, accent } = pose;
      const lux = luxPaletteFromAccent(accent);
      const keep2 = bhKeepout * bhKeepout;
      const cosY = Math.cos(spin.yaw), sinY = Math.sin(spin.yaw);
      const cosX = Math.cos(spin.pitch), sinX = Math.sin(spin.pitch);
      const cosZ = Math.cos(spin.roll), sinZ = Math.sin(spin.roll);
      const camDist = 2.55;

      for (let i = 0; i < mesh.nodes.length; i += 1) {
        const n = mesh.nodes[i];
        const wob = 1 + Math.sin(t * 0.7 + n.driftPhase) * 0.018 + speak * 0.012;
        const [x, y, z] = n.pos;
        const x0 = x * cosZ - y * sinZ;
        const y0 = x * sinZ + y * cosZ;
        const y1 = y0 * cosX - z * sinX;
        const z1 = y0 * sinX + z * cosX;
        const x2 = x0 * cosY - z1 * sinY;
        const z2 = x0 * sinY + z1 * cosY;
        const persp = camDist / (camDist - z2 * wob);
        const p = projected[i];
        p.x = cx + x2 * wob * meshRadius * persp;
        p.y = cy + y1 * wob * meshRadius * persp;
        p.z = z2;
        p.persp = persp;
        const dxn = p.x - cx, dyn = p.y - cy;
        p.occ = dxn * dxn + dyn * dyn < keep2;
        n.flash *= Math.pow(0.02, dt);
      }

      const edgeOrder = mesh.edges
        .map(([a, b]) => ({ a, b, z: (projected[a].z + projected[b].z) * 0.5 }))
        .sort((u, v) => u.z - v.z);
      for (const e of edgeOrder) {
        const pa = projected[e.a], pb = projected[e.b];
        if (pa.occ && pb.occ) continue;
        const mx = (pa.x + pb.x) * 0.5 - cx;
        const my = (pa.y + pb.y) * 0.5 - cy;
        if (mx * mx + my * my < keep2 * 0.92) continue;
        const flash = Math.max(mesh.nodes[e.a].flash, mesh.nodes[e.b].flash);
        const back = e.z < 0;
        const depth = Math.max(0, Math.min(1, (pa.persp + pb.persp) * 0.5 - 0.5));
        const alpha = (back ? 0.05 : 0.1) + depth * (back ? 0.12 : 0.28) + flash * 0.4;
        ctx.strokeStyle = rgba(back ? lux.ember : lux.gold, alpha);
        ctx.lineWidth = (back ? 0.45 : 0.7) + flash * 0.85;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      if (now >= nextSignalAt && signals.length < signalCap) {
        const [ea, eb] = mesh.edges[Math.floor(Math.random() * mesh.edges.length)];
        if (!projected[ea].occ || !projected[eb].occ) {
          signals.push({ a: ea, b: eb, t: 0, speed: 0.85 + Math.random() * 0.35 });
        }
        nextSignalAt = now + 520 + Math.random() * 320;
      }
      for (let i = signals.length - 1; i >= 0; i -= 1) {
        const s = signals[i];
        s.t += dt * s.speed * speedMul;
        if (s.t >= 1) {
          mesh.nodes[s.b].flash = 1;
          if (signals.length < signalCap && Math.random() < 0.55) {
            const options = mesh.neighbors[s.b];
            let pick = options[0];
            for (let oi = 0; oi < options.length; oi += 1) {
              if (options[oi] !== s.a) { pick = options[oi]; if (Math.random() < 0.5) break; }
            }
            if (pick !== undefined && pick !== s.a) {
              signals.push({ a: s.b, b: pick, t: 0, speed: 1.1 + Math.random() * 0.5 });
            }
          }
          signals.splice(i, 1);
          continue;
        }
        const pa = projected[s.a], pb = projected[s.b];
        if (pa.occ && pb.occ) continue;
        const sx = lerp(pa.x, pb.x, s.t);
        const sy = lerp(pa.y, pb.y, s.t);
        if ((sx - cx) ** 2 + (sy - cy) ** 2 < keep2) continue;
        const back = (pa.z + pb.z) * 0.5 < 0;
        ctx.beginPath();
        ctx.fillStyle = rgba(lux.hot, back ? 0.45 : 0.9);
        ctx.arc(sx, sy, back ? 1.15 : 1.65, 0, Math.PI * 2);
        ctx.fill();
      }

      const nodeOrder = projected.map((p, i) => ({ i, z: p.z })).sort((a, b) => a.z - b.z);
      for (const { i } of nodeOrder) {
        const p = projected[i];
        if (p.occ) continue;
        const flash = mesh.nodes[i].flash;
        const back = p.z < 0;
        const depthAlpha = Math.max(0, Math.min(1, (p.persp - 0.55) / 1.1));
        const size = ((back ? 0.75 : 1.05) + depthAlpha * 1.35) * (1 + flash * 1.05);
        const nodeColor = flash > 0.35 ? lux.hot : (back ? lux.ember : lux.gold);
        ctx.beginPath();
        ctx.fillStyle = rgba(
          nodeColor,
          (back ? 0.18 : 0.36) + depthAlpha * (back ? 0.22 : 0.42) + flash * 0.4,
        );
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
}
