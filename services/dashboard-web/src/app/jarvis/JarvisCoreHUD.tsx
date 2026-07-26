'use client';
/**
 * Jarvis Core HUD — the living presence stage for /jarvis.
 *
 * DESIGN LOCK (shape / structure — do not redesign without an explicit ask):
 * Center: WebGL Gargantua (independent module). Cage: NeuralMesh3D (independent).
 * They share one ensemble pose via jarvisStage — one organism, scalable parts.
 * Outer stage: concept threads + telemetry + command bar.
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
import { createGargantua3D, type Gargantua3D } from './gargantua3d';
import { resolveJarvisEnsemble } from './jarvisStage';
import { createNeuralMeshPainter } from './neuralMesh3d';
import JarvisBoard from './board/JarvisBoard';
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
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<CoreState>('idle');
  const targetColorRef = useRef(STATE_COLOR.idle);
  const currentColorRef = useRef({ core: [...STATE_COLOR.idle.core] as RGB, ring: [...STATE_COLOR.idle.ring] as RGB });
  const anchorsRef = useRef<Anchor[]>(buildAnchors());
  /** CIN-2c — projected origin of the infinite board; the singularity and its
   *  cage ride on it. Null until the board reports its first frame, so the
   *  stage renders exactly as before if the board is ever removed. */
  const boardOriginRef = useRef<{ x: number; y: number; scale: number } | null>(null);
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
    const glCanvas = glCanvasRef.current;
    if (!canvas || !glCanvas) return;
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
      const { cx, cy, coreRadius, fieldRadius, bhRadius } = pose;

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
        const midx = cx + Math.cos(angle) * fieldRadius * 0.55 + Math.sin(t * 0.25 + angle) * 16;
        const midy = cy + Math.sin(angle) * fieldRadius * 0.55 + Math.cos(t * 0.25 + angle) * 16;
        const startx = cx + Math.cos(angle) * coreRadius * 0.42;
        const starty = cy + Math.sin(angle) * coreRadius * 0.42;

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

      // Independent modules, shared ensemble pose.
      meshPainter.paint(ctx, pose, now);
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
    try { rec.start(); } catch {
      setListening(false);
      voiceActiveRef.current = false;
      setCoreState('idle');
    }
  }

  return (
    <div className="jarvis-live-stage" {...dirProps(caption)}>
      {/* CIN-2c — infinite 3D board beneath the presence layer. It owns pan /
          zoom / card placement and reports its world origin so the singularity
          stays the centre of the board. */}
      <JarvisBoard
        onOriginChange={(o) => { boardOriginRef.current = o; }}
        dimmed={busy || listening}
      />
      <canvas ref={canvasRef} className="jarvis-live-canvas" />
      <canvas ref={glCanvasRef} className="jarvis-gl-canvas" aria-label="سیاه‌چاله سه‌بعدی" />
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
