'use client';
/**
 * Jarvis Core HUD — the living presence stage for /jarvis.
 *
 * A single always-alive canvas: a breathing central core wrapped in rotating
 * HUD rings, a slow-drifting starfield for depth, and neural threads (each
 * with its own signature color) reaching out to real kernel concepts
 * (memory, living loop, heartbeat, trust chain, missions, research).
 * Motion is continuous — trailing glow, constant micro-pulses, a resting
 * heartbeat — not a discrete slideshow of states. The command line at the
 * bottom is wired to the real turn pipeline; no fake replies.
 *
 * Visual-first slice: the bigger "focus" state changes are still demo-timed
 * (honest placeholder cadence) — the next slice replaces that timer with
 * real heartbeat/living-loop events over a realtime channel.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  listSessionsAction, createSessionAction, sendTurnAction,
  jarvisTelemetryAction, type JarvisTelemetryView,
} from './actions';
import { dirProps } from '@/lib/rtl';

type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'acting' | 'alert' | 'degraded';
type RGB = [number, number, number];

const STATE_COLOR: Record<CoreState, { core: RGB; ring: RGB }> = {
  idle: { core: [110, 168, 255], ring: [90, 140, 220] },
  listening: { core: [130, 200, 255], ring: [110, 180, 255] },
  thinking: { core: [190, 140, 255], ring: [170, 120, 255] },
  speaking: { core: [255, 200, 110], ring: [255, 180, 90] },
  acting: { core: [110, 240, 190], ring: [90, 220, 170] },
  alert: { core: [255, 130, 110], ring: [255, 110, 90] },
  degraded: { core: [130, 140, 160], ring: [110, 120, 140] },
};

const STATE_LABEL_FA: Record<CoreState, string> = {
  idle: 'حاضر و در کنار شما',
  listening: 'در حال شنیدن…',
  thinking: 'در حال فکر کردن…',
  speaking: 'در حال پاسخ…',
  acting: 'در حال انجام کار…',
  alert: 'یک نکتهٔ مهم',
  degraded: 'حالت محدود — بدون مدل واقعی',
};

interface Anchor {
  id: string;
  label: string;
  angle: number;
  color: RGB;
  activity: number; // 0..1, decays continuously
  heartbeat?: boolean;
}

function buildAnchors(): Anchor[] {
  const defs: Array<{ id: string; label: string; color: RGB; heartbeat?: boolean }> = [
    { id: 'memory', label: 'MEMORY', color: [110, 168, 255] },
    { id: 'loop', label: 'LIVING LOOP', color: [155, 123, 255] },
    { id: 'heartbeat', label: 'HEARTBEAT', color: [255, 110, 140], heartbeat: true },
    { id: 'trust', label: 'TRUST CHAIN', color: [255, 196, 90] },
    { id: 'missions', label: 'MISSIONS', color: [110, 240, 190] },
    { id: 'research', label: 'RESEARCH', color: [90, 220, 255] },
  ];
  return defs.map((d, i) => ({ ...d, angle: (i / defs.length) * Math.PI * 2 - Math.PI / 2, activity: 0.1 }));
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function rgba(c: RGB, a: number): string { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
function mixRgb(a: RGB, b: RGB, t: number): RGB { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

/** A small volumetric neural mesh (nodes + synapses) used for the core —
 * a real graph, not decorative dust. Built once per mount. */
interface NeuralMesh {
  nodes: Array<{ pos: [number, number, number]; flash: number; driftPhase: number }>;
  edges: Array<[number, number]>;
  neighbors: number[][];
}
function buildNeuralMesh(count: number, k: number): NeuralMesh {
  const offset = 2 / count;
  const increment = Math.PI * (3 - Math.sqrt(5));
  const nodes: NeuralMesh['nodes'] = [];
  for (let i = 0; i < count; i += 1) {
    const y = i * offset - 1 + offset / 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * increment;
    const depth = 0.5 + Math.random() * 0.5;
    nodes.push({ pos: [Math.cos(phi) * r * depth, y * depth, Math.sin(phi) * r * depth], flash: 0, driftPhase: Math.random() * Math.PI * 2 });
  }
  const seen = new Set<string>();
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < count; i += 1) {
    const dists: Array<[number, number]> = [];
    for (let j = 0; j < count; j += 1) {
      if (i === j) continue;
      const [ax, ay, az] = nodes[i].pos;
      const [bx, by, bz] = nodes[j].pos;
      dists.push([j, (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2]);
    }
    dists.sort((a, b) => a[1] - b[1]);
    for (let m = 0; m < k; m += 1) {
      const j = dists[m][0];
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (!seen.has(key)) { seen.add(key); edges.push([i, j]); }
    }
  }
  const neighbors: number[][] = Array.from({ length: count }, () => []);
  for (const [a, b] of edges) { neighbors[a].push(b); neighbors[b].push(a); }
  return { nodes, edges, neighbors };
}

export default function JarvisCoreHUD() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<CoreState>('idle');
  const targetColorRef = useRef(STATE_COLOR.idle);
  const currentColorRef = useRef({ core: [...STATE_COLOR.idle.core] as RGB, ring: [...STATE_COLOR.idle.ring] as RGB });
  const anchorsRef = useRef<Anchor[]>(buildAnchors());
  const anchorPosRef = useRef<Array<{ xFrac: number; yFrac: number; label: string; activity: number; color: RGB }>>([]);

  const [uiState, setUiState] = useState<CoreState>('idle');
  const [anchorLabels, setAnchorLabels] = useState<Array<{ xFrac: number; yFrac: number; label: string; activity: number; color: RGB }>>([]);
  const [caption, setCaption] = useState(STATE_LABEL_FA.idle);
  const [input, setInput] = useState('');
  const [busy, setBusyState] = useState(false);
  const busyRef = useRef(false);
  const setBusy = useCallback((v: boolean) => { busyRef.current = v; setBusyState(v); }, []);
  const sessionIdRef = useRef<string | null>(null);
  const [telem, setTelem] = useState<JarvisTelemetryView | null>(null);

  const setCoreState = useCallback((s: CoreState, note?: string) => {
    stateRef.current = s;
    targetColorRef.current = STATE_COLOR[s];
    setUiState(s);
    setCaption(note ?? STATE_LABEL_FA[s]);
  }, []);

  const pulseAnchor = useCallback((id: string, amount = 0.9) => {
    const a = anchorsRef.current.find((x) => x.id === id);
    if (a) a.activity = Math.min(1, a.activity + amount);
  }, []);

  const refreshTelemetry = useCallback(async () => {
    try {
      const t = await jarvisTelemetryAction(sessionIdRef.current);
      setTelem(t);
      if (t.loop.tone === 'warn') pulseAnchor('loop', 0.35);
      if (t.trust.tone === 'warn') pulseAnchor('trust', 0.35);
    } catch { /* keep last good snapshot */ }
  }, [pulseAnchor]);

  useEffect(() => {
    void refreshTelemetry();
    const id = setInterval(() => { void refreshTelemetry(); }, 8000);
    return () => clearInterval(id);
  }, [refreshTelemetry]);

  // Continuous ambient life: a steady resting heartbeat + frequent tiny
  // pulses on random threads, so the stage never looks "off" between the
  // slower, more deliberate focus-state changes below.
  useEffect(() => {
    const hb = setInterval(() => { if (!busyRef.current) pulseAnchor('heartbeat', 0.45); }, 1050);
    const ambient = setInterval(() => {
      if (busyRef.current) return;
      const ids = ['memory', 'loop', 'trust', 'missions', 'research'];
      pulseAnchor(ids[Math.floor(Math.random() * ids.length)], 0.16 + Math.random() * 0.18);
    }, 900 + Math.random() * 700);
    return () => { clearInterval(hb); clearInterval(ambient); };
  }, [pulseAnchor]);

  // Demo-driven focus cycle (honest placeholder cadence until real events wire in).
  useEffect(() => {
    let alive = true;
    const cycle: CoreState[] = ['idle', 'thinking', 'acting', 'idle', 'listening', 'idle'];
    const anchorCycle = ['memory', 'loop', 'heartbeat', 'trust', 'missions', 'research'];
    let i = 0;
    const timer = setInterval(() => {
      if (!alive || busyRef.current) return;
      setCoreState(cycle[i % cycle.length]);
      pulseAnchor(anchorCycle[i % anchorCycle.length], 0.7);
      i += 1;
    }, 5200);
    return () => { alive = false; clearInterval(timer); };
  }, [setCoreState, pulseAnchor]);

  // Canvas render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d', { alpha: false });
    if (!ctx2d) return;
    const canvasEl: HTMLCanvasElement = canvas;
    const ctx: CanvasRenderingContext2D = ctx2d;
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let w = 0, h = 0, dpr = 1;
    let compact = (typeof window !== 'undefined') && (window.innerWidth < 720 || window.innerHeight < 640);
    let running = true;
    const mesh = buildNeuralMesh(compact ? 28 : 42, 3);
    const signals: Array<{ a: number; b: number; t: number; speed: number }> = [];
    let nextSignalAt = 0;
    let signalCap = compact ? 10 : 18;
    let dustCount = compact ? 22 : 48;
    const dust = Array.from({ length: 70 }, () => ({
      x: Math.random(), y: Math.random(), r: 0.4 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2, speed: 0.03 + Math.random() * 0.05, drift: Math.random() * Math.PI * 2,
    }));
    const ripples: Array<{ start: number; strength: number }> = [];
    let nextRippleAt = 0;

    function resize() {
      const parent = canvasEl.parentElement;
      if (!parent) return;
      const nextW = parent.clientWidth;
      const nextH = parent.clientHeight;
      compact = nextW < 720 || nextH < 640;
      signalCap = compact ? 10 : 18;
      dustCount = compact ? 22 : 48;
      // Cap DPR on small screens — halves GPU work with almost no visual loss.
      dpr = Math.min(window.devicePixelRatio || 1, compact ? 1.5 : 2);
      w = nextW;
      h = nextH;
      canvasEl.width = Math.floor(w * dpr);
      canvasEl.height = Math.floor(h * dpr);
      canvasEl.style.width = `${w}px`;
      canvasEl.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
    if (ro && canvasEl.parentElement) ro.observe(canvasEl.parentElement);
    else window.addEventListener('resize', resize);
    const onVis = () => { running = document.visibilityState === 'visible'; if (running) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    document.addEventListener('visibilitychange', onVis);

    let last = performance.now();
    function frame(now: number) {
      if (!running) return;
      const dt = Math.min(0.045, (now - last) / 1000);
      last = now;
      const t = now / 1000;

      // Soft trail — slightly stronger on mobile so trails don't smear under lower FPS.
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = compact ? 'rgba(7,10,18,0.32)' : 'rgba(7,10,18,0.24)';
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      // Lift the core slightly so it clears the command bar / mobile chrome.
      const cy = h * (compact ? 0.42 : 0.48);
      const scale = Math.min(w, h);
      const breath = reducedMotion ? 1 : 1 + Math.sin(t * 0.55) * 0.018;
      const coreRadius = scale * (compact ? 0.18 : 0.155) * breath;
      const fieldRadius = scale * (compact ? 0.38 : 0.44);

      // Color transition toward target state.
      const cur = currentColorRef.current;
      const tgt = targetColorRef.current;
      const ease = 1 - Math.pow(0.001, dt);
      cur.core = mixRgb(cur.core, tgt.core, ease);
      cur.ring = mixRgb(cur.ring, tgt.ring, ease);

      const speedMul = stateRef.current === 'thinking' ? 2.2 : stateRef.current === 'acting' ? 1.6 : stateRef.current === 'alert' ? 1.8 : 1;

      ctx.globalCompositeOperation = 'lighter';

      // Drifting starfield — always-on depth cue, independent of state.
      for (let di = 0; di < dustCount; di += 1) {
        const s = dust[di];
        const dx = (s.x + Math.sin(t * s.speed + s.drift) * 0.01) * w;
        const dy = (s.y + Math.cos(t * s.speed * 0.8 + s.drift) * 0.01) * h;
        const tw = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.4 + s.phase));
        ctx.beginPath();
        ctx.fillStyle = rgba([180, 195, 230], tw * 0.5);
        ctx.arc(dx, dy, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Ambient outer glow field.
      const grad = ctx.createRadialGradient(cx, cy, coreRadius * 0.2, cx, cy, fieldRadius);
      grad.addColorStop(0, rgba(cur.core, 0.14));
      grad.addColorStop(1, rgba(cur.core, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, fieldRadius, 0, Math.PI * 2);
      ctx.fill();

      // Resting heartbeat ripples — expanding rings from the core, always on.
      if (now >= nextRippleAt) {
        ripples.push({ start: now, strength: 0.5 });
        nextRippleAt = now + 2200 + Math.random() * 900;
      }
      for (let i = ripples.length - 1; i >= 0; i -= 1) {
        const age = (now - ripples[i].start) / 1400;
        if (age >= 1) { ripples.splice(i, 1); continue; }
        const r = coreRadius * (0.7 + age * 3.2);
        ctx.beginPath();
        ctx.strokeStyle = rgba(cur.core, (1 - age) * 0.35 * ripples[i].strength);
        ctx.lineWidth = 1.4;
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Rotating HUD rings (arc-reactor style), independent speeds/directions.
      const ringSpecs = [
        { radius: coreRadius * 1.55, speed: 0.12, dash: [2, 10], width: 1.1 },
        { radius: coreRadius * 1.9, speed: -0.07, dash: [10, 6], width: 1 },
        { radius: coreRadius * 2.3, speed: 0.045, dash: [1, 5], width: 0.9 },
      ];
      for (const rs of ringSpecs) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * rs.speed);
        ctx.setLineDash(rs.dash);
        ctx.strokeStyle = rgba(cur.ring, 0.32);
        ctx.lineWidth = rs.width;
        ctx.beginPath();
        ctx.arc(0, 0, rs.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.setLineDash([]);

      // Neural threads to anchors — each with its own signature color,
      // continuously carrying faint data even at rest.
      const positions: Array<{ xFrac: number; yFrac: number; label: string; activity: number; color: RGB }> = [];
      const anchors = anchorsRef.current;
      const sweep = t * 0.015;
      for (const a of anchors) {
        let target = 0.08;
        if (a.heartbeat) {
          const phase = (t % 0.9) / 0.9;
          target = Math.max(target, Math.pow(Math.max(0, Math.sin(phase * Math.PI)), 6) * 0.5);
        }
        a.activity = Math.max(target, a.activity - dt * 0.35);

        const angle = a.angle + sweep;
        const ax = cx + Math.cos(angle) * fieldRadius;
        const ay = cy + Math.sin(angle) * fieldRadius;
        const midx = cx + Math.cos(angle) * fieldRadius * 0.52 + Math.sin(t * 0.3 + angle) * 16;
        const midy = cy + Math.sin(angle) * fieldRadius * 0.52 + Math.cos(t * 0.3 + angle) * 16;
        const startx = cx + Math.cos(angle) * coreRadius * 0.9;
        const starty = cy + Math.sin(angle) * coreRadius * 0.9;

        const lineGrad = ctx.createLinearGradient(startx, starty, ax, ay);
        lineGrad.addColorStop(0, rgba(cur.core, 0.05 + a.activity * 0.45));
        lineGrad.addColorStop(1, rgba(a.color, 0.06 + a.activity * 0.6));
        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 0.8 + a.activity * 1.8;
        ctx.beginPath();
        ctx.moveTo(startx, starty);
        ctx.quadraticCurveTo(midx, midy, ax, ay);
        ctx.stroke();

        // A faint data point always travels the line; brighter when active.
        const pt = (t * (0.22 + a.activity * 0.6) + a.angle) % 1;
        const px = lerp(lerp(startx, midx, pt), lerp(midx, ax, pt), pt);
        const py = lerp(lerp(starty, midy, pt), lerp(midy, ay, pt), pt);
        ctx.beginPath();
        ctx.fillStyle = rgba(a.color, 0.25 + a.activity * 0.7);
        if (!compact) { ctx.shadowColor = rgba(a.color, 1); ctx.shadowBlur = 4 + a.activity * 8; }
        ctx.arc(px, py, 1.4 + a.activity * 2, 0, Math.PI * 2);
        ctx.fill();
        if (!compact) ctx.shadowBlur = 0;

        // Anchor node glow.
        ctx.beginPath();
        ctx.fillStyle = rgba(a.color, 0.3 + a.activity * 0.5);
        if (!compact) { ctx.shadowColor = rgba(a.color, 1); ctx.shadowBlur = 6; }
        ctx.arc(ax, ay, 2.2 + a.activity * 1.6, 0, Math.PI * 2);
        ctx.fill();
        if (!compact) ctx.shadowBlur = 0;

        positions.push({ xFrac: ax / w, yFrac: ay / h, label: a.label, activity: a.activity, color: a.color });
      }
      anchorPosRef.current = positions;

      // Living neural mesh — the actual core: nodes + synapses in slow
      // pseudo-3D rotation, with signals that travel edge-to-edge and make
      // nodes flash on arrival, occasionally propagating onward like a
      // real thought moving through a small brain.
      const meshRadius = coreRadius * 0.98;
      const ry = t * (0.1 + (speedMul - 1) * 0.06);
      const rx = Math.sin(t * 0.05) * 0.18 + Math.sin(t * 0.023) * 0.07;
      const cosY = Math.cos(ry), sinY = Math.sin(ry);
      const cosX = Math.cos(rx), sinX = Math.sin(rx);
      const camDist = 2.6;
      const projected: Array<{ x: number; y: number; z: number; persp: number }> = new Array(mesh.nodes.length);
      for (let i = 0; i < mesh.nodes.length; i += 1) {
        const n = mesh.nodes[i];
        const wob = 1 + Math.sin(t * 0.8 + n.driftPhase) * 0.025;
        const [px0, py0, pz0] = n.pos;
        const x1 = px0 * cosY - pz0 * sinY;
        const z1 = px0 * sinY + pz0 * cosY;
        const y2 = py0 * cosX - z1 * sinX;
        const z2 = py0 * sinX + z1 * cosX;
        const persp = camDist / (camDist - z2 * wob);
        projected[i] = { x: cx + x1 * wob * meshRadius * persp, y: cy + y2 * wob * meshRadius * persp, z: z2, persp };
        n.flash *= Math.pow(0.015, dt);
      }

      // Subtle rim + faint inner glow to read as a bounded "core", not a free dust cloud.
      const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, meshRadius * 0.9);
      coreGlow.addColorStop(0, rgba(cur.core, 0.16));
      coreGlow.addColorStop(1, rgba(cur.core, 0));
      ctx.fillStyle = coreGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, meshRadius * 0.9, 0, Math.PI * 2);
      ctx.fill();

      // Synapses.
      for (const [a, b] of mesh.edges) {
        const pa = projected[a], pb = projected[b];
        const flash = Math.max(mesh.nodes[a].flash, mesh.nodes[b].flash);
        const depthAlpha = (pa.persp + pb.persp) / 2 - 0.55;
        const alpha = Math.max(0, 0.08 + depthAlpha * 0.22 + flash * 0.55);
        ctx.strokeStyle = rgba(mixRgb(cur.core, [255, 255, 255], 0.25 + flash * 0.4), alpha);
        ctx.lineWidth = 0.6 + flash * 1.1;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      // Signals traveling along synapses — spawn continuously, faster while thinking/acting.
      if (now >= nextSignalAt && signals.length < signalCap) {
        const [ea, eb] = mesh.edges[Math.floor(Math.random() * mesh.edges.length)];
        signals.push({ a: ea, b: eb, t: 0, speed: 1 + Math.random() * 0.6 });
        nextSignalAt = now + (320 + Math.random() * 260) / speedMul;
      }
      for (let i = signals.length - 1; i >= 0; i -= 1) {
        const s = signals[i];
        s.t += dt * s.speed * speedMul;
        if (s.t >= 1) {
          mesh.nodes[s.b].flash = 1;
          if (signals.length < signalCap && Math.random() < 0.65) {
            const options = mesh.neighbors[s.b].filter((n) => n !== s.a);
            if (options.length) signals.push({ a: s.b, b: options[Math.floor(Math.random() * options.length)], t: 0, speed: 1 + Math.random() * 0.6 });
          }
          signals.splice(i, 1);
          continue;
        }
        const pa = projected[s.a], pb = projected[s.b];
        const sx = lerp(pa.x, pb.x, s.t);
        const sy = lerp(pa.y, pb.y, s.t);
        const glowCol = mixRgb(cur.core, [255, 255, 255], 0.55);
        ctx.beginPath();
        ctx.fillStyle = rgba(glowCol, 0.85);
        if (!compact) { ctx.shadowColor = rgba(glowCol, 1); ctx.shadowBlur = 8; }
        ctx.arc(sx, sy, 1.7, 0, Math.PI * 2);
        ctx.fill();
        if (!compact) ctx.shadowBlur = 0;
      }

      // Nodes — far-to-near so nearer ones sit visually on top.
      const order = projected.map((_, i) => i).sort((i, j) => projected[i].z - projected[j].z);
      for (const i of order) {
        const p = projected[i];
        const flash = mesh.nodes[i].flash;
        const depthAlpha = Math.max(0, Math.min(1, (p.persp - 0.55) / 1.1));
        const size = (1.1 + depthAlpha * 1.6) * (1 + flash * 1.4);
        ctx.beginPath();
        ctx.fillStyle = rgba(mixRgb(cur.core, [255, 255, 255], 0.15 + depthAlpha * 0.2 + flash * 0.55), 0.35 + depthAlpha * 0.35 + flash * 0.5);
        if (!compact && flash > 0.08) { ctx.shadowColor = rgba(cur.core, 1); ctx.shadowBlur = 6 + flash * 8; }
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
        if (!compact) ctx.shadowBlur = 0;
      }

      ctx.strokeStyle = rgba(cur.core, 0.16);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, meshRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // Decoupled label sync — slower on mobile to avoid React thrash fighting the canvas.
    const syncTimer = setInterval(() => setAnchorLabels([...anchorPosRef.current]), compact ? 280 : 180);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      clearInterval(syncTimer);
      document.removeEventListener('visibilitychange', onVis);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', resize);
    };
  }, []);

  async function ensureSession(): Promise<string | null> {
    if (sessionIdRef.current) return sessionIdRef.current;
    try {
      const sessions = await listSessionsAction();
      if (sessions[0]?.sessionId) { sessionIdRef.current = sessions[0].sessionId; return sessionIdRef.current; }
      const id = await createSessionAction('Live');
      sessionIdRef.current = id;
      return id;
    } catch { return null; }
  }

  async function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    setCoreState('thinking');
    pulseAnchor('memory', 0.5);
    try {
      const sid = await ensureSession();
      if (!sid) { setCoreState('degraded', 'ارتباط با کرنل برقرار نشد'); return; }
      const res = await sendTurnAction(sid, text);
      if (!res) { setCoreState('degraded', 'پاسخی دریافت نشد'); return; }
      pulseAnchor('loop', 0.6);
      setCoreState('speaking', res.replyText.slice(0, 140) || '…');
      void refreshTelemetry();
      setTimeout(() => setCoreState('idle'), 5000);
    } catch {
      setCoreState('degraded', 'خطا در ارتباط');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="jarvis-live-stage" {...dirProps(caption)}>
      <canvas ref={canvasRef} className="jarvis-live-canvas" />
      <div className="jarvis-telem" aria-label="system telemetry">
        <TelemCell slot="mode" label="MODE" cell={telem?.mode} />
        <TelemCell slot="loop" label="LOOP" cell={telem?.loop} />
        <TelemCell slot="cost" label="COST" cell={telem?.cost} />
        <TelemCell slot="trust" label="TRUST" cell={telem?.trust} />
      </div>
      <div className="jarvis-live-overlay" aria-hidden>
        {anchorLabels.map((p, idx) => (
          <span
            key={idx}
            className="jarvis-live-glyph"
            style={{
              left: `${p.xFrac * 100}%`,
              top: `${p.yFrac * 100}%`,
              opacity: 0.4 + p.activity * 0.55,
              color: rgba(p.color, 1),
              textShadow: `0 0 10px ${rgba(p.color, 0.7)}`,
            }}
          >
            {p.label}
            <span className="jarvis-live-glyph-bar" style={{ width: `${8 + p.activity * 22}px`, background: rgba(p.color, 0.8) }} />
          </span>
        ))}
      </div>
      <div className="jarvis-live-caption">
        <span className={`jarvis-live-dot jarvis-live-dot--${uiState}`} />
        <span key={caption} className="jarvis-live-caption-text">{caption}</span>
      </div>
      <form
        className="jarvis-live-cmdbar"
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="یک دستور کوتاه بدهید…"
          disabled={busy}
          {...dirProps(input)}
        />
        <button type="submit" disabled={busy || !input.trim()} aria-label="ارسال">
          {busy ? '…' : '↵'}
        </button>
      </form>
    </div>
  );
}

function TelemCell({
  slot, label, cell,
}: {
  slot: 'mode' | 'loop' | 'cost' | 'trust';
  label: string;
  cell?: { value: string; detail: string; tone: string } | null;
}) {
  return (
    <div className={`jarvis-telem-cell jarvis-telem-cell--${slot} jarvis-telem-cell--${cell?.tone ?? 'muted'}`}>
      <span className="jarvis-telem-k">{label}</span>
      <span className="jarvis-telem-v">{cell?.value ?? '…'}</span>
      <span className="jarvis-telem-d">{cell?.detail ?? 'loading'}</span>
    </div>
  );
}
