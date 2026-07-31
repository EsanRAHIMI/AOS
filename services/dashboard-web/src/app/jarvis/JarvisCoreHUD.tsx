'use client';
/**
 * Jarvis Core HUD — the living presence stage for /jarvis.
 *
 * DESIGN LOCK (shape / structure — do not redesign without an explicit ask):
 * Center: WebGL Gargantua (independent module). Cage: NeuralMesh3D (independent).
 * They share one ensemble pose via jarvisStage — one organism, scalable parts.
 * Outer stage: the infinite board (board/JarvisBoard) + telemetry + command bar.
 *
 * Motion is continuous — trailing glow, micro-pulses, resting heartbeat.
 * The command line is wired to the real turn pipeline; no fake replies.
 * Voice presence: browser STT + TTS via Talk; transport marked 'voice' on turns.
 * Focus-state cadence still demos when idle — paused while mic/busy/voice.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  jarvisTelemetryAction, type JarvisTelemetryView,
} from './actions';
import { createGargantua3D, type Gargantua3D } from './gargantua3d';
import { resolveJarvisEnsemble } from './jarvisStage';
import { createNeuralMeshPainter } from './neuralMesh3d';
import JarvisBoard from './board/JarvisBoard';
import HappeningLayer from './HappeningLayer';
import { UtteranceGate } from '@/lib/utteranceGate';
import { bidiProps } from '@/lib/rtl';
import { subscribeJarvisPresence } from '@/lib/jarvisPresence';

type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'acting' | 'alert' | 'degraded';
type RGB = [number, number, number];
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

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function rgba(c: RGB, a: number): string { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
function mixRgb(a: RGB, b: RGB, t: number): RGB { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }


function TelemCell({
  slot, label, cell,
}: {
  slot: 'mode' | 'loop' | 'cost' | 'trust';
  label: string;
  cell?: { value: string; detail: string; tone: string } | null;
}) {
  return (
    <div className={`jarvis-telem-cell jarvis-telem-cell--${slot} jarvis-telem-cell--${cell?.tone ?? 'muted'}`}>
      <span className="jarvis-telem-k" dir="ltr">{label}</span>
      <span className="jarvis-telem-v" dir="ltr">{cell?.value ?? '…'}</span>
      <span className="jarvis-telem-d" {...bidiProps(cell?.detail)}>{cell?.detail ?? 'loading'}</span>
    </div>
  );
}

export default function JarvisCoreHUD() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  /** CIN-2c/D-183.11 — the half of the neural cage that passes IN FRONT of the
   *  singularity. Painted on its own transparent canvas above the WebGL layer
   *  so the black hole sits inside the mesh instead of on top of it. */
  const frontCanvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<CoreState>('idle');
  const targetColorRef = useRef(STATE_COLOR.idle);
  const currentColorRef = useRef({ core: [...STATE_COLOR.idle.core] as RGB, ring: [...STATE_COLOR.idle.ring] as RGB });
  /** CIN-2c — projected origin of the infinite board; the singularity and its
   *  cage ride on it. Null until the board reports its first frame, so the
   *  stage renders exactly as before if the board is ever removed. */
  const boardOriginRef = useRef<{ x: number; y: number; scale: number } | null>(null);

  const [uiState, setUiState] = useState<CoreState>('idle');
  const [caption, setCaption] = useState(STATE_LABEL_FA.idle);
  const busyRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const [telem, setTelem] = useState<JarvisTelemetryView | null>(null);
  /** True only when this tab is visible AND the window has focus — desktop
   *  stays "visible" while you work in another app; without the focus check
   *  the canvas keeps burning and resume after minutes can wedge the loop. */
  const liveRef = useRef(true);

  const gateRef = useRef(new UtteranceGate({ minCommandChars: 2, silenceMs: 900 }));
  const recRef = useRef<{ stop?: () => void; abort?: () => void } | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceActiveRef = useRef(false);
  const voiceEnergyRef = useRef(0);
  const [listening, setListening] = useState(false);

  const setCoreState = useCallback((s: CoreState, note?: string) => {
    stateRef.current = s;
    targetColorRef.current = STATE_COLOR[s];
    setUiState(s);
    setCaption(note ?? STATE_LABEL_FA[s]);
  }, []);

  /* The canvas pulses with what the ONE conversation is doing. Subscribing
   * beats re-deriving: there is no second chat here to derive it from. */
  useEffect(() => subscribeJarvisPresence((p) => {
    const map: Record<string, CoreState> = {
      idle: 'idle', listening: 'listening', thinking: 'thinking',
      acting: 'acting', speaking: 'speaking', error: 'alert',
    };
    voiceActiveRef.current = p === 'listening' || p === 'speaking';
    if (p === 'speaking') voiceEnergyRef.current = 0.8;
    setCoreState(map[p] ?? 'idle');
  }), [setCoreState]);

  const refreshTelemetry = useCallback(async () => {
    if (!liveRef.current) return;
    try {
      const t = await jarvisTelemetryAction(sessionIdRef.current);
      setTelem(t);
    } catch { /* keep last good snapshot */ }
  }, []);

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

  // Demo-driven focus cycle — paused while mic, busy, or voice turn is live.
  useEffect(() => {
    let alive = true;
    const cycle: CoreState[] = ['idle', 'thinking', 'acting', 'idle', 'listening', 'idle'];
    let i = 0;
    const timer = setInterval(() => {
      if (!alive || !liveRef.current || busyRef.current || voiceActiveRef.current || listening) return;
      setCoreState(cycle[i % cycle.length]);
      i += 1;
    }, 7000);
    return () => { alive = false; clearInterval(timer); };
  }, [setCoreState, listening]);

  // Canvas render loop — tuned for crisp 60fps: hard clear (no smear trail),
  // no shadowBlur, capped DPR, lean mesh. Motion stays continuous without
  // the soft-fade tax that made desktop feel laggy and blurred.
  useEffect(() => {
    const canvas = canvasRef.current;
    const glCanvas = glCanvasRef.current;
    const frontCanvas = frontCanvasRef.current;
    if (!canvas || !glCanvas) return;
    const ctx2d = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx2d) return;
    // Transparent (alpha:true) — this layer only carries the front half of
    // the cage and must never paint a background over the black hole.
    const ctxFront = frontCanvas?.getContext('2d', { alpha: true, desynchronized: true }) ?? null;
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
    const meshPainter = createNeuralMeshPainter(compact);
    let dustCount = compact ? 18 : 30;
    const dust = Array.from({ length: 32 }, () => ({
      x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.1,
      phase: Math.random() * Math.PI * 2, speed: 0.03 + Math.random() * 0.04, drift: Math.random() * Math.PI * 2,
    }));
    const ripples: Array<{ start: number; strength: number }> = [];
    let nextRippleAt = 0;
    let frozenAt = 0;
    let voiceEnergy = 0;
    let gargantua: Gargantua3D | null = null;
    try {
      gargantua = createGargantua3D(glCanvas);
    } catch {
      gargantua = null;
    }
    // If WebGL never came up, the (empty) GL canvas must not sit on top of the
    // board swallowing pan/zoom/card clicks — its hit disc is only set while
    // the frame loop runs.
    if (!gargantua) glCanvas.style.pointerEvents = 'none';

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
      meshPainter.setCompact(compact);
      dustCount = compact ? 18 : 30;
      // Full-bleed desktop at DPR 2 is the main lag source — cap hard.
      dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      w = nextW;
      h = nextH;
      canvasEl.width = Math.floor(w * dpr);
      canvasEl.height = Math.floor(h * dpr);
      canvasEl.style.width = `${w}px`;
      canvasEl.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (frontCanvas && ctxFront) {
        frontCanvas.width = Math.floor(w * dpr);
        frontCanvas.height = Math.floor(h * dpr);
        frontCanvas.style.width = `${w}px`;
        frontCanvas.style.height = `${h}px`;
        ctxFront.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      gargantua?.setSize(w, h, dpr);
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

      const cur = currentColorRef.current;
      const tgt = targetColorRef.current;
      const ease = 1 - Math.pow(0.002, dt);
      cur.core = mixRgb(cur.core, tgt.core, ease);
      cur.ring = mixRgb(cur.ring, tgt.ring, ease);

      // Assistant speak → ensemble gravity. Listening never touches the stage.
      voiceEnergy = Math.max(voiceEnergy * Math.pow(0.12, dt), voiceEnergyRef.current);
      voiceEnergyRef.current *= Math.pow(0.45, dt);
      const st = stateRef.current;
      const speakE = st === 'speaking' ? Math.max(0.35, voiceEnergy) : 0;
      const speedMul = st === 'thinking' ? 1.12 : 1;

      // Shared ensemble pose — mesh + singularity stay independent modules, one organism.
      const pose = resolveJarvisEnsemble({
        t,
        dt,
        w,
        h,
        compact,
        reducedMotion,
        speak: speakE,
        speedMul,
        accent: cur.core,
        orbit: gargantua?.getOrbit() ?? null,
        boardOrigin: boardOriginRef.current,
      });
      const { cx, cy, coreRadius, bhRadius } = pose;

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

      // Occasional soft ambient ripple (never voice-triggered).
      if (now >= nextRippleAt) {
        ripples.push({ start: now, strength: 0.4 });
        nextRippleAt = now + 3200 + Math.random() * 1600;
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

      // CIN-2c: the six legacy concept threads (MEMORY / LOOP / HEARTBEAT /
      // TRUST / MISSIONS / RESEARCH) were removed — the board now carries the
      // real, data-backed cards for exactly those domains, wired by real
      // synapses. Keeping decorative stand-ins beside them would be noise.

      // Independent modules, shared ensemble pose.
      // The cage is painted in two passes with the singularity BETWEEN them,
      // so the nodes visibly orbit around a black hole that sits inside the
      // mesh (D-183.11). `advance:false` on the second pass keeps one
      // simulation driving both halves.
      meshPainter.paint(ctx, pose, now, { layer: ctxFront ? 'back' : 'all' });
      if (gargantua) {
        // CIN-2c: clip the GL layer to a disc around the singularity. Purely a
        // HIT-TEST boundary (the disc is far wider than the drawn horizon, so
        // nothing visible is cut): inside it the black hole keeps its own
        // drag-to-orbit; outside, pointer events reach the board underneath.
        const glEl = glCanvasRef.current;
        if (glEl) {
          const clipR = Math.max(60, pose.bhKeepout * 1.35);
          glEl.style.clipPath = `circle(${clipR.toFixed(1)}px at ${pose.cx.toFixed(1)}px ${pose.cy.toFixed(1)}px)`;
        }
        gargantua.setCenter(pose.cx, pose.cy);
        gargantua.setViewRadius(bhRadius);
        gargantua.setSpeak(speakE);
        gargantua.setEnsemble(pose.spin.yaw, pose.spin.pitch, pose.t);
        gargantua.tick(t);
      }

      if (ctxFront) {
        ctxFront.clearRect(0, 0, w, h);
        meshPainter.paint(ctxFront, pose, now, { layer: 'front', advance: false });
      }

      raf = requestAnimationFrame(frame);
    }

    // Start only if the window is actually live; otherwise wait for focus.
    if (isLive()) resume();
    else freeze();

    return () => {
      freeze();
      gargantua?.dispose();
      window.removeEventListener('focus', onPresence);
      window.removeEventListener('blur', onPresence);
      document.removeEventListener('visibilitychange', onPresence);
      window.removeEventListener('pagehide', freeze);
      window.removeEventListener('pageshow', onPresence);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', resize);
    };
  }, []);

  /* D-191 — the conversation used to live HERE: session handling, submitTurn,
   * speech recognition and synthesis. That is why voice existed on this page
   * and nowhere else, while history and structured replies existed everywhere
   * else and not here. It now lives in JarvisConversation, rendered by the
   * rudder over every page including this one. What remains is the visual
   * layer, which subscribes to the shared presence instead of deriving state
   * from a conversation it owns. */

  return (
    <div className="jarvis-live-stage" dir="ltr">
      {/* CIN-2c — infinite 3D board beneath the presence layer. It owns pan /
          zoom / card placement and reports its world origin so the singularity
          stays the centre of the board. */}
      <JarvisBoard
        onOriginChange={(o) => { boardOriginRef.current = o; }}
        dimmed={uiState !== 'idle'}
      />
      <canvas ref={canvasRef} className="jarvis-live-canvas" />
      <canvas ref={glCanvasRef} className="jarvis-gl-canvas" aria-label="سیاه‌چاله سه‌بعدی" />
      <canvas ref={frontCanvasRef} className="jarvis-mesh-front-canvas" aria-hidden />
      {/* D-208 — the live happening feed. Sits ABOVE the canvases (so cards are
          readable over the singularity) and BELOW the telemetry, and is
          pointer-transparent except on its own cards, so the black hole keeps
          its drag and the board keeps its pan. */}
      <HappeningLayer />
      <div className="jarvis-telem" aria-label="system telemetry">
        <TelemCell slot="mode" label="MODE" cell={telem?.mode} />
        <TelemCell slot="loop" label="LOOP" cell={telem?.loop} />
        <TelemCell slot="cost" label="COST" cell={telem?.cost} />
        <TelemCell slot="trust" label="TRUST" cell={telem?.trust} />
      </div>
      <div className="jarvis-live-caption">
        <span className={`jarvis-live-dot jarvis-live-dot--${uiState}`} />
        <span key={caption} className="jarvis-live-caption-text" {...bidiProps(caption)}>{caption}</span>
      </div>
    </div>
  );
}
