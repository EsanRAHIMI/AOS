'use client';
/**
 * Jarvis Core HUD — the living presence stage for /jarvis.
 *
 * DESIGN LOCK (shape / structure — do not redesign without an explicit ask):
 * Center presence is Gargantua-style: continuous accretion disk through the
 * event horizon, far/near lens wraps, vertical black sphere silhouette,
 * horizontal black equatorial ellipse nested inside that sphere, photon ring,
 * left/right contact sparks. Outer stage: neural mesh + concept threads +
 * telemetry corners + command bar. No decorative blue HUD rings / ambient discs.
 *
 * Motion is continuous — trailing glow, micro-pulses, resting heartbeat.
 * The command line is wired to the real turn pipeline; no fake replies.
 * Voice presence: browser STT + TTS via Talk; transport marked 'voice' on turns.
 * Focus-state cadence still demos when idle — paused while mic/busy/voice.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  listSessionsAction, createSessionAction, sendTurnAction,
  jarvisTelemetryAction, type JarvisTelemetryView,
} from './actions';
import { drawGargantua, luxPaletteFromAccent } from './drawGargantua';
import { UtteranceGate } from '@/lib/utteranceGate';
import { dirProps } from '@/lib/rtl';

type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'acting' | 'alert' | 'degraded';
type RGB = [number, number, number];
type SpeechRec = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void;
  onend: () => void; onerror: () => void; start: () => void; stop: () => void; abort: () => void;
};

function speechCtor(): (new () => SpeechRec) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { webkitSpeechRecognition?: new () => SpeechRec; SpeechRecognition?: new () => SpeechRec };
  return w.webkitSpeechRecognition ?? w.SpeechRecognition ?? null;
}

/** Orbital gold family — warmer mesh, tracks the accretion spectrum. */
const STATE_COLOR: Record<CoreState, { core: RGB; ring: RGB }> = {
  idle: { core: [236, 168, 72], ring: [210, 132, 48] },
  listening: { core: [248, 186, 96], ring: [224, 152, 64] },
  thinking: { core: [220, 148, 78], ring: [190, 118, 56] },
  speaking: { core: [255, 198, 120], ring: [236, 168, 88] },
  acting: { core: [214, 152, 72], ring: [184, 124, 56] },
  alert: { core: [240, 96, 52], ring: [210, 72, 36] },
  degraded: { core: [158, 112, 68], ring: [128, 88, 52] },
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

const CMD_PLACEHOLDER = 'یک دستور کوتاه بدهید…';

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
  /** True only when this tab is visible AND the window has focus — desktop
   *  stays "visible" while you work in another app; without the focus check
   *  the canvas keeps burning and resume after minutes can wedge the loop. */
  const liveRef = useRef(true);

  const gateRef = useRef(new UtteranceGate({ minCommandChars: 2, silenceMs: 900 }));
  const recRef = useRef<{ stop?: () => void; abort?: () => void } | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalBufRef = useRef('');
  const voiceActiveRef = useRef(false);
  const voiceEnergyRef = useRef(0);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [interimHint, setInterimHint] = useState('');

  const setCoreState = useCallback((s: CoreState, note?: string) => {
    stateRef.current = s;
    targetColorRef.current = STATE_COLOR[s];
    setUiState(s);
    setCaption(note ?? STATE_LABEL_FA[s]);
  }, []);

  useEffect(() => {
    setSpeechSupported(Boolean(speechCtor()) && typeof window !== 'undefined' && 'speechSynthesis' in window);
  }, []);

  const stopListening = useCallback(() => {
    try { recRef.current?.abort?.(); recRef.current?.stop?.(); } catch { /* ignore */ }
    recRef.current = null;
    setListening(false);
    voiceActiveRef.current = false;
    setInterimHint('');
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  }, []);

  const interruptSpeech = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    gateRef.current.markSpeaking(false);
    gateRef.current.reset();
  }, []);

  useEffect(() => () => {
    stopListening();
    interruptSpeech();
  }, [stopListening, interruptSpeech]);

  const pulseAnchor = useCallback((id: string, amount = 0.9) => {
    const a = anchorsRef.current.find((x) => x.id === id);
    if (a) a.activity = Math.min(1, a.activity + amount);
  }, []);

  const refreshTelemetry = useCallback(async () => {
    if (!liveRef.current) return;
    try {
      const t = await jarvisTelemetryAction(sessionIdRef.current);
      setTelem(t);
      if (t.loop.tone === 'warn') pulseAnchor('loop', 0.35);
      if (t.trust.tone === 'warn') pulseAnchor('trust', 0.35);
    } catch { /* keep last good snapshot */ }
  }, [pulseAnchor]);

  useEffect(() => {
    const syncLive = () => {
      liveRef.current = document.visibilityState === 'visible' && document.hasFocus();
    };
    syncLive();
    window.addEventListener('focus', syncLive);
    window.addEventListener('blur', syncLive);
    document.addEventListener('visibilitychange', syncLive);
    return () => {
      window.removeEventListener('focus', syncLive);
      window.removeEventListener('blur', syncLive);
      document.removeEventListener('visibilitychange', syncLive);
    };
  }, []);

  useEffect(() => {
    void refreshTelemetry();
    const id = setInterval(() => { void refreshTelemetry(); }, 8000);
    return () => clearInterval(id);
  }, [refreshTelemetry]);

  // Continuous ambient life: a steady resting heartbeat + frequent tiny
  // pulses on random threads, so the stage never looks "off" between the
  // slower, more deliberate focus-state changes below.
  useEffect(() => {
    const hb = setInterval(() => {
      if (!liveRef.current || busyRef.current) return;
      pulseAnchor('heartbeat', 0.4);
    }, 1400);
    const ambient = setInterval(() => {
      if (!liveRef.current || busyRef.current) return;
      const ids = ['memory', 'loop', 'trust', 'missions', 'research'];
      pulseAnchor(ids[Math.floor(Math.random() * ids.length)], 0.14 + Math.random() * 0.14);
    }, 1600);
    return () => { clearInterval(hb); clearInterval(ambient); };
  }, [pulseAnchor]);

  // Demo-driven focus cycle — paused while mic, busy, or voice turn is live.
  useEffect(() => {
    let alive = true;
    const cycle: CoreState[] = ['idle', 'thinking', 'acting', 'idle', 'listening', 'idle'];
    const anchorCycle = ['memory', 'loop', 'heartbeat', 'trust', 'missions', 'research'];
    let i = 0;
    const timer = setInterval(() => {
      if (!alive || !liveRef.current || busyRef.current || voiceActiveRef.current || listening) return;
      setCoreState(cycle[i % cycle.length]);
      pulseAnchor(anchorCycle[i % anchorCycle.length], 0.55);
      i += 1;
    }, 7000);
    return () => { alive = false; clearInterval(timer); };
  }, [setCoreState, pulseAnchor, listening]);

  // Canvas render loop — tuned for crisp 60fps: hard clear (no smear trail),
  // no shadowBlur, capped DPR, lean mesh. Motion stays continuous without
  // the soft-fade tax that made desktop feel laggy and blurred.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx2d) return;
    const canvasEl: HTMLCanvasElement = canvas;
    const ctx: CanvasRenderingContext2D = ctx2d;
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let w = 0, h = 0, dpr = 1;
    let compact = (typeof window !== 'undefined') && (window.innerWidth < 720 || window.innerHeight < 640);
    let running = false;
    /** Wall-clock offset so animation time does not jump after a freeze. */
    let clockBase = performance.now();
    let last = performance.now();
    const mesh = buildNeuralMesh(compact ? 24 : 32, 3);
    const projected = mesh.nodes.map(() => ({ x: 0, y: 0, z: 0, persp: 1 }));
    const signals: Array<{ a: number; b: number; t: number; speed: number }> = [];
    let nextSignalAt = 0;
    let signalCap = compact ? 8 : 12;
    let dustCount = compact ? 14 : 24;
    const dust = Array.from({ length: 32 }, () => ({
      x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.1,
      phase: Math.random() * Math.PI * 2, speed: 0.03 + Math.random() * 0.04, drift: Math.random() * Math.PI * 2,
    }));
    const ripples: Array<{ start: number; strength: number }> = [];
    let nextRippleAt = 0;
    let frozenAt = 0;
    let voiceEnergy = 0;

    function isLive(): boolean {
      return document.visibilityState === 'visible' && document.hasFocus();
    }

    function freeze() {
      if (!running && raf === 0) return;
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
      frozenAt = performance.now();
      // Drop transient particles so resume never replays a backlog.
      signals.length = 0;
      ripples.length = 0;
      liveRef.current = false;
    }

    function resume() {
      if (!isLive()) return;
      if (running) return;
      // Absorb frozen wall time into the clock so `t` continues smoothly
      // instead of leaping minutes ahead (that leap is what wedges the loop).
      if (frozenAt > 0) {
        clockBase += performance.now() - frozenAt;
        frozenAt = 0;
      }
      last = performance.now();
      nextSignalAt = last + 400;
      nextRippleAt = last + 800;
      running = true;
      liveRef.current = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }

    function onPresence() {
      if (isLive()) resume();
      else freeze();
    }

    function resize() {
      const parent = canvasEl.parentElement;
      if (!parent) return;
      const nextW = parent.clientWidth;
      const nextH = parent.clientHeight;
      compact = nextW < 720 || nextH < 640;
      signalCap = compact ? 8 : 12;
      dustCount = compact ? 14 : 24;
      // Full-bleed desktop at DPR 2 is the main lag source — cap hard.
      dpr = Math.min(window.devicePixelRatio || 1, 1.25);
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
    window.addEventListener('focus', onPresence);
    window.addEventListener('blur', onPresence);
    document.addEventListener('visibilitychange', onPresence);
    window.addEventListener('pagehide', freeze);
    window.addEventListener('pageshow', onPresence);

    function frame(now: number) {
      if (!running) return;
      // Defensive: if focus was lost mid-frame batch, stop without scheduling.
      if (!isLive()) { freeze(); return; }

      const rawDt = (now - last) / 1000;
      // Any gap larger than a couple frames = we were throttled/frozen; skip
      // catch-up entirely rather than trying to simulate the missing time.
      if (rawDt > 0.1) {
        clockBase += now - last;
        last = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min(0.04, Math.max(0, rawDt));
      last = now;
      const t = Math.max(0, (now - clockBase) / 1000);

      // Hard clear — sharp frames, no motion smear.
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#070a12';
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h * (compact ? 0.42 : 0.48);
      const scale = Math.min(w, h);
      const breath = reducedMotion ? 1 : 1 + Math.sin(t * 0.55) * 0.015;
      const coreRadius = scale * (compact ? 0.18 : 0.15) * breath;
      const fieldRadius = scale * (compact ? 0.38 : 0.42);

      const cur = currentColorRef.current;
      const tgt = targetColorRef.current;
      const ease = 1 - Math.pow(0.002, dt);
      cur.core = mixRgb(cur.core, tgt.core, ease);
      cur.ring = mixRgb(cur.ring, tgt.ring, ease);

      // Voice drives the singularity — not mesh spin-up.
      voiceEnergy = Math.max(voiceEnergy * Math.pow(0.12, dt), voiceEnergyRef.current);
      voiceEnergyRef.current *= Math.pow(0.45, dt);
      const st = stateRef.current;
      const listenE = st === 'listening' ? voiceEnergy : 0;
      const speakE = st === 'speaking' ? voiceEnergy : 0;
      // Mesh stays calm; only mild think agitation (never listen/speak spin).
      const speedMul = st === 'thinking' ? 1.12 : 1;

      // Sparse starfield.
      for (let di = 0; di < dustCount; di += 1) {
        const s = dust[di];
        const tw = 0.2 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.2 + s.phase));
        ctx.beginPath();
        ctx.fillStyle = `rgba(180,195,230,${tw * 0.45})`;
        ctx.arc(
          (s.x + Math.sin(t * s.speed + s.drift) * 0.008) * w,
          (s.y + Math.cos(t * s.speed * 0.8 + s.drift) * 0.008) * h,
          s.r, 0, Math.PI * 2,
        );
        ctx.fill();
      }

      // Soft horizon ripples — only while the singularity is speaking (emit).
      if (speakE > 0.15 && now >= nextRippleAt) {
        ripples.push({ start: now, strength: 0.35 + speakE * 0.65 });
        nextRippleAt = now + 900 + Math.random() * 500;
      } else if (speakE <= 0.15 && now >= nextRippleAt) {
        nextRippleAt = now + 4000;
      }
      for (let i = ripples.length - 1; i >= 0; i -= 1) {
        const age = (now - ripples[i].start) / 1200;
        if (age >= 1) { ripples.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.strokeStyle = rgba(cur.core, (1 - age) * 0.28 * ripples[i].strength);
        ctx.lineWidth = 1.2;
        ctx.arc(cx, cy, coreRadius * (0.8 + age * 2.8), 0, Math.PI * 2);
        ctx.stroke();
      }

      // Outer neural threads.
      const positions: Array<{ xFrac: number; yFrac: number; label: string; activity: number; color: RGB }> = [];
      const anchors = anchorsRef.current;
      const sweep = t * 0.012;
      for (const a of anchors) {
        let target = 0.08;
        if (a.heartbeat) {
          const phase = (t % 0.9) / 0.9;
          target = Math.max(target, Math.pow(Math.max(0, Math.sin(phase * Math.PI)), 6) * 0.45);
        }
        a.activity = Math.max(target, a.activity - dt * 0.35);

        const angle = a.angle + sweep;
        const ax = cx + Math.cos(angle) * fieldRadius;
        const ay = cy + Math.sin(angle) * fieldRadius;
        const midx = cx + Math.cos(angle) * fieldRadius * 0.52 + Math.sin(t * 0.25 + angle) * 12;
        const midy = cy + Math.sin(angle) * fieldRadius * 0.52 + Math.cos(t * 0.25 + angle) * 12;
        const startx = cx + Math.cos(angle) * coreRadius * 0.9;
        const starty = cy + Math.sin(angle) * coreRadius * 0.9;

        ctx.strokeStyle = rgba(a.color, 0.08 + a.activity * 0.5);
        ctx.lineWidth = 0.9 + a.activity * 1.4;
        ctx.beginPath();
        ctx.moveTo(startx, starty);
        ctx.quadraticCurveTo(midx, midy, ax, ay);
        ctx.stroke();

        const pt = (t * (0.2 + a.activity * 0.5) + a.angle) % 1;
        const px = lerp(lerp(startx, midx, pt), lerp(midx, ax, pt), pt);
        const py = lerp(lerp(starty, midy, pt), lerp(midy, ay, pt), pt);
        ctx.beginPath();
        ctx.fillStyle = rgba(a.color, 0.35 + a.activity * 0.55);
        ctx.arc(px, py, 1.3 + a.activity * 1.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.fillStyle = rgba(a.color, 0.35 + a.activity * 0.4);
        ctx.arc(ax, ay, 2 + a.activity * 1.2, 0, Math.PI * 2);
        ctx.fill();

        positions.push({ xFrac: ax / w, yFrac: ay / h, label: a.label, activity: a.activity, color: a.color });
      }
      anchorPosRef.current = positions;

      // Neural mesh — steady slow orbit; never spins up with voice.
      const meshRadius = coreRadius * 0.98;
      const ry = t * 0.065;
      const rx = Math.sin(t * 0.05) * 0.16;
      const cosY = Math.cos(ry), sinY = Math.sin(ry);
      const cosX = Math.cos(rx), sinX = Math.sin(rx);
      const camDist = 2.6;
      // Listening: mesh contracts slightly (attention inward). Speaking: slight expand (emit).
      const meshScale = 1 - listenE * 0.06 + speakE * 0.04;
      for (let i = 0; i < mesh.nodes.length; i += 1) {
        const n = mesh.nodes[i];
        const wob = 1 + Math.sin(t * 0.7 + n.driftPhase) * 0.02;
        const [px0, py0, pz0] = n.pos;
        const x1 = px0 * cosY - pz0 * sinY;
        const z1 = px0 * sinY + pz0 * cosY;
        const y2 = py0 * cosX - z1 * sinX;
        const z2 = py0 * sinX + z1 * cosX;
        const persp = camDist / (camDist - z2 * wob);
        const p = projected[i];
        p.x = cx + x1 * wob * meshRadius * meshScale * persp;
        p.y = cy + y2 * wob * meshRadius * meshScale * persp;
        p.z = z2;
        p.persp = persp;
        n.flash *= Math.pow(0.02, dt);
        // Soft hear-flash while listening — not rotation.
        if (listenE > 0.2 && Math.random() < listenE * 0.04) n.flash = Math.max(n.flash, 0.55 + listenE * 0.4);
      }

      // Mesh + singularity share orbital gold (hot / gold via lux aliases).
      const lux = luxPaletteFromAccent(cur.core);

      // Synapses — orbital gold mid-tone.
      for (const [a, b] of mesh.edges) {
        const pa = projected[a], pb = projected[b];
        const flash = Math.max(mesh.nodes[a].flash, mesh.nodes[b].flash);
        const alpha = Math.max(0.05, 0.08 + ((pa.persp + pb.persp) / 2 - 0.55) * 0.18 + flash * 0.4);
        ctx.strokeStyle = rgba(lux.gold, alpha);
        ctx.lineWidth = 0.55 + flash * 0.75;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      if (now >= nextSignalAt && signals.length < signalCap) {
        const [ea, eb] = mesh.edges[Math.floor(Math.random() * mesh.edges.length)];
        signals.push({ a: ea, b: eb, t: 0, speed: 0.85 + Math.random() * 0.35 + speakE * 0.25 });
        nextSignalAt = now + (listenE > 0.15 ? 1400 : speakE > 0.15 ? 520 : 700) + Math.random() * 400;
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
            if (pick !== undefined && pick !== s.a) signals.push({ a: s.b, b: pick, t: 0, speed: 1.1 + Math.random() * 0.5 });
          }
          signals.splice(i, 1);
          continue;
        }
        const pa = projected[s.a], pb = projected[s.b];
        ctx.beginPath();
        ctx.fillStyle = rgba(lux.hot, 0.85);
        ctx.arc(lerp(pa.x, pb.x, s.t), lerp(pa.y, pb.y, s.t), 1.55, 0, Math.PI * 2);
        ctx.fill();
      }

      // Nodes — keep clear of the singularity so the void reads cleanly.
      const bhR = coreRadius * 0.44 * (1 + listenE * 0.06 + speakE * 0.03);
      const bhKeepout = bhR * 1.55;
      for (let i = 0; i < projected.length; i += 1) {
        const p = projected[i];
        const dxn = p.x - cx, dyn = p.y - cy;
        if (dxn * dxn + dyn * dyn < bhKeepout * bhKeepout) continue;
        const flash = mesh.nodes[i].flash;
        const depthAlpha = Math.max(0, Math.min(1, (p.persp - 0.55) / 1.1));
        const size = (0.9 + depthAlpha * 1.2) * (1 + flash * 1.05);
        const nodeColor = flash > 0.35 ? lux.hot : lux.gold;
        ctx.beginPath();
        ctx.fillStyle = rgba(nodeColor, 0.3 + depthAlpha * 0.35 + flash * 0.4);
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
      }

      drawGargantua(ctx, cx, cy, bhR, t, cur.core, { listen: listenE, speak: speakE });

      raf = requestAnimationFrame(frame);
    }

    // Start only if the window is actually live; otherwise wait for focus.
    if (isLive()) resume();
    else freeze();

    const syncTimer = setInterval(() => {
      if (!liveRef.current) return;
      setAnchorLabels([...anchorPosRef.current]);
    }, 240);

    return () => {
      freeze();
      clearInterval(syncTimer);
      window.removeEventListener('focus', onPresence);
      window.removeEventListener('blur', onPresence);
      document.removeEventListener('visibilitychange', onPresence);
      window.removeEventListener('pagehide', freeze);
      window.removeEventListener('pageshow', onPresence);
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

  function speakReply(text: string): void {
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setTimeout(() => {
        voiceActiveRef.current = false;
        setCoreState('idle');
        gateRef.current.markHandled();
      }, 2800);
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.slice(0, 500));
      u.lang = 'fa-IR';
      u.rate = 1.02;
      u.onstart = () => {
        gateRef.current.markSpeaking(true);
        voiceActiveRef.current = true;
        voiceEnergyRef.current = 0.85;
        setCoreState('speaking', text.slice(0, 140));
      };
      u.onboundary = () => { voiceEnergyRef.current = Math.min(1, 0.55 + Math.random() * 0.45); };
      const finish = () => {
        gateRef.current.markSpeaking(false);
        gateRef.current.markHandled();
        voiceActiveRef.current = false;
        voiceEnergyRef.current = 0.15;
        if (stateRef.current === 'speaking') setCoreState('idle');
      };
      u.onend = finish;
      u.onerror = finish;
      window.speechSynthesis.speak(u);
    } catch {
      gateRef.current.markHandled();
      voiceActiveRef.current = false;
      setCoreState('idle');
    }
  }

  async function submitTurn(raw: string, transport: 'text' | 'voice'): Promise<void> {
    const text = raw.trim();
    const gate = gateRef.current;
    const verdict = gate.evaluate(text, true, { voice: transport === 'voice' });
    if (!verdict.accept) return;
    if (transport === 'text' && (gate.speaking || busyRef.current)) interruptSpeech();

    gate.markSubmitted(text);
    if (transport === 'text') setInput('');
    setBusy(true);
    voiceActiveRef.current = true;
    setCoreState('thinking');
    pulseAnchor('memory', 0.5);
    try {
      const sid = await ensureSession();
      if (!sid) {
        setCoreState('degraded', 'ارتباط با کرنل برقرار نشد');
        gate.markHandled();
        voiceActiveRef.current = false;
        return;
      }
      const res = await sendTurnAction(sid, text, transport);
      if (!res) {
        setCoreState('degraded', 'پاسخی دریافت نشد');
        gate.markHandled();
        voiceActiveRef.current = false;
        return;
      }
      pulseAnchor('loop', 0.6);
      void refreshTelemetry();
      const reply = res.replyText?.trim() || 'انجام شد.';
      if (!gate.acceptAssistant(reply)) {
        setCoreState('idle');
        gate.markHandled();
        voiceActiveRef.current = false;
        return;
      }
      setCoreState('speaking', reply.slice(0, 140));
      speakReply(reply);
    } catch {
      setCoreState('degraded', 'خطا در ارتباط');
      gate.markHandled();
      voiceActiveRef.current = false;
    } finally {
      setBusy(false);
    }
  }

  function toggleListen(): void {
    if (!speechSupported) return;
    if (listening) {
      stopListening();
      if (stateRef.current === 'listening') setCoreState('idle');
      return;
    }
    if (gateRef.current.speaking || gateRef.current.busy || busyRef.current) return;
    interruptSpeech();
    const Ctor = speechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'fa-IR';
    rec.continuous = false;
    rec.interimResults = true;
    finalBufRef.current = '';
    rec.onresult = (e) => {
      if (gateRef.current.speaking) return;
      let interim = '';
      for (let i = 0; i < e.results.length; i += 1) {
        const r = e.results[i];
        const txt = r[0]?.transcript ?? '';
        if (r.isFinal) {
          if (i >= e.resultIndex || !finalBufRef.current.includes(txt.trim())) {
            finalBufRef.current = `${finalBufRef.current} ${txt}`.trim();
          }
        } else interim += txt;
      }
      const hint = (interim || finalBufRef.current).trim();
      setInterimHint(hint);
      if (hint) {
        voiceEnergyRef.current = Math.min(1, 0.55 + Math.min(0.45, hint.length * 0.03));
        setCoreState('listening', hint.slice(0, 120));
      }
      if (finalBufRef.current) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          const cmd = finalBufRef.current;
          finalBufRef.current = '';
          setInterimHint('');
          stopListening();
          void submitTurn(cmd, 'voice');
        }, gateRef.current.config.silenceMs);
      }
    };
    rec.onend = () => {
      setListening(false);
      if (!finalBufRef.current && !silenceTimerRef.current && stateRef.current === 'listening') {
        voiceActiveRef.current = false;
        setCoreState('idle');
      }
    };
    rec.onerror = () => {
      setListening(false);
      setInterimHint('');
      voiceActiveRef.current = false;
      if (stateRef.current === 'listening') setCoreState('idle');
    };
    recRef.current = rec;
    voiceActiveRef.current = true;
    setListening(true);
    setCoreState('listening');
    voiceEnergyRef.current = 0.4;
    try { rec.start(); } catch {
      setListening(false);
      voiceActiveRef.current = false;
      setCoreState('idle');
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
        className={`jarvis-live-cmdbar${listening ? ' jarvis-live-cmdbar--listening' : ''}`}
        onSubmit={(e) => { e.preventDefault(); void submitTurn(input, 'text'); }}
      >
        {speechSupported ? (
          <button
            type="button"
            className={`jarvis-live-mic${listening ? ' jarvis-live-mic--on' : ''}`}
            onClick={toggleListen}
            disabled={busy && !listening}
            aria-label={listening ? 'توقف شنیدن' : 'صحبت با جارویس'}
            title={listening ? 'توقف' : 'صحبت کنید'}
          >
            {listening ? '■' : 'MIC'}
          </button>
        ) : null}
        <input
          value={listening && interimHint ? interimHint : input}
          onChange={(e) => { if (!listening) setInput(e.target.value); }}
          placeholder={listening ? 'در حال شنیدن…' : CMD_PLACEHOLDER}
          disabled={busy || listening}
          readOnly={listening}
          data-auto-dir=""
          {...dirProps((listening && interimHint ? interimHint : input) || CMD_PLACEHOLDER)}
        />
        <button type="submit" disabled={busy || listening || !input.trim()} aria-label="ارسال">
          {busy ? '…' : '↵'}
        </button>
      </form>
    </div>
  );
}
