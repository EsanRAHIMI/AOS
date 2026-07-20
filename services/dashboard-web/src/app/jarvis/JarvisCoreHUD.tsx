'use client';
/**
 * Jarvis Core HUD — the living presence stage for /jarvis.
 *
 * Replaces the old chat-box look with a single always-alive canvas: a
 * breathing central "core" connected by neural threads to a ring of real
 * kernel concepts (memory, living loop, heartbeat, trust chain, missions,
 * research). Threads light up when their concept is active; the core's
 * color/motion reflects Jarvis's current state (idle/listening/thinking/
 * speaking/acting/alert). A single minimal command line at the bottom is
 * wired to the real turn pipeline — no fake replies.
 *
 * Visual-first slice: state transitions are demo-driven for now (honest,
 * clearly a placeholder cadence) except the command bar, which calls the
 * real `sendTurnAction`. Next slice wires anchor activity to real live
 * signals (heartbeat/loop ticks) over a realtime channel instead of demo timers.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  listSessionsAction, createSessionAction, sendTurnAction,
} from './actions';
import { dirProps } from '@/lib/rtl';

type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'acting' | 'alert' | 'degraded';

const STATE_COLOR: Record<CoreState, { core: [number, number, number]; thread: [number, number, number] }> = {
  idle: { core: [110, 168, 255], thread: [90, 140, 220] },
  listening: { core: [130, 200, 255], thread: [110, 180, 255] },
  thinking: { core: [190, 140, 255], thread: [170, 120, 255] },
  speaking: { core: [255, 200, 110], thread: [255, 180, 90] },
  acting: { core: [110, 240, 190], thread: [90, 220, 170] },
  alert: { core: [255, 130, 110], thread: [255, 110, 90] },
  degraded: { core: [130, 140, 160], thread: [110, 120, 140] },
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
  radiusFrac: number;
  activity: number; // 0..1, decays over time
}

function buildAnchors(): Anchor[] {
  const defs = [
    { id: 'memory', label: 'MEMORY' },
    { id: 'loop', label: 'LIVING LOOP' },
    { id: 'heartbeat', label: 'HEARTBEAT' },
    { id: 'trust', label: 'TRUST CHAIN' },
    { id: 'missions', label: 'MISSIONS' },
    { id: 'research', label: 'RESEARCH' },
  ];
  return defs.map((d, i) => ({
    ...d,
    angle: (i / defs.length) * Math.PI * 2 - Math.PI / 2,
    radiusFrac: 0.44,
    activity: 0.08,
  }));
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function rgba(c: [number, number, number], a: number): string { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

export default function JarvisCoreHUD() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<CoreState>('idle');
  const targetColorRef = useRef(STATE_COLOR.idle);
  const currentColorRef = useRef({ core: [...STATE_COLOR.idle.core] as [number, number, number], thread: [...STATE_COLOR.idle.thread] as [number, number, number] });
  const anchorsRef = useRef<Anchor[]>(buildAnchors());
  const anchorPosRef = useRef<Array<{ xFrac: number; yFrac: number; label: string; activity: number }>>([]);

  const [uiState, setUiState] = useState<CoreState>('idle');
  const [anchorLabels, setAnchorLabels] = useState<Array<{ xFrac: number; yFrac: number; label: string; activity: number }>>([]);
  const [caption, setCaption] = useState(STATE_LABEL_FA.idle);
  const [input, setInput] = useState('');
  const [busy, setBusyState] = useState(false);
  const busyRef = useRef(false);
  const setBusy = useCallback((v: boolean) => { busyRef.current = v; setBusyState(v); }, []);
  const sessionIdRef = useRef<string | null>(null);

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

  // Demo-driven autoplay (honest placeholder cadence until real events wire in).
  useEffect(() => {
    let alive = true;
    const cycle = ['idle', 'thinking', 'acting', 'idle', 'listening', 'idle'] as CoreState[];
    const anchorCycle = ['memory', 'loop', 'heartbeat', 'trust', 'missions', 'research'];
    let i = 0;
    const timer = setInterval(() => {
      if (!alive || busyRef.current) return;
      const s = cycle[i % cycle.length];
      setCoreState(s);
      pulseAnchor(anchorCycle[i % anchorCycle.length], 0.7);
      i += 1;
    }, 4200);
    return () => { alive = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Canvas render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    const canvasEl: HTMLCanvasElement = canvas;
    const ctx: CanvasRenderingContext2D = ctx2d;

    let raf = 0;
    let w = 0, h = 0, dpr = 1;
    const spiralParticles = Array.from({ length: 160 }, (_, i) => ({
      arm: i % 3,
      t: i / 160,
      phase: Math.random() * Math.PI * 2,
      speed: 0.15 + Math.random() * 0.25,
      jitter: Math.random() * 6,
    }));

    function resize() {
      const parent = canvasEl.parentElement;
      if (!parent) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = parent.clientWidth;
      h = parent.clientHeight;
      canvasEl.width = Math.floor(w * dpr);
      canvasEl.height = Math.floor(h * dpr);
      canvasEl.style.width = `${w}px`;
      canvasEl.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    let last = performance.now();
    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const cx = w / 2;
      const cy = h / 2;
      const coreRadius = Math.min(w, h) * 0.16;
      const fieldRadius = Math.min(w, h) * 0.46;

      // Color transition toward target.
      const cur = currentColorRef.current;
      const tgt = targetColorRef.current;
      const ease = 1 - Math.pow(0.001, dt);
      cur.core = [lerp(cur.core[0], tgt.core[0], ease), lerp(cur.core[1], tgt.core[1], ease), lerp(cur.core[2], tgt.core[2], ease)];
      cur.thread = [lerp(cur.thread[0], tgt.thread[0], ease), lerp(cur.thread[1], tgt.thread[1], ease), lerp(cur.thread[2], tgt.thread[2], ease)];

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      // Ambient outer glow field.
      const grad = ctx.createRadialGradient(cx, cy, coreRadius * 0.2, cx, cy, fieldRadius);
      grad.addColorStop(0, rgba(cur.core, 0.16));
      grad.addColorStop(1, rgba(cur.core, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, fieldRadius, 0, Math.PI * 2);
      ctx.fill();

      // Neural threads to anchors.
      const positions: Array<{ xFrac: number; yFrac: number; label: string; activity: number }> = [];
      const anchors = anchorsRef.current;
      const t = now / 1000;
      for (const a of anchors) {
        a.activity = Math.max(0.08, a.activity - dt * 0.18);
        const ax = cx + Math.cos(a.angle) * fieldRadius;
        const ay = cy + Math.sin(a.angle) * fieldRadius;
        const midx = cx + Math.cos(a.angle) * fieldRadius * 0.5 + Math.sin(t * 0.3 + a.angle) * 14;
        const midy = cy + Math.sin(a.angle) * fieldRadius * 0.5 + Math.cos(t * 0.3 + a.angle) * 14;
        const alpha = 0.05 + a.activity * 0.55;
        ctx.strokeStyle = rgba(cur.thread, alpha);
        ctx.lineWidth = 1 + a.activity * 1.6;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a.angle) * coreRadius * 0.9, cy + Math.sin(a.angle) * coreRadius * 0.9);
        ctx.quadraticCurveTo(midx, midy, ax, ay);
        ctx.stroke();

        if (a.activity > 0.18) {
          const pt = (t * (0.4 + a.activity)) % 1;
          const px = lerp(lerp(cx, midx, pt), lerp(midx, ax, pt), pt);
          const py = lerp(lerp(cy, midy, pt), lerp(midy, ay, pt), pt);
          ctx.beginPath();
          ctx.fillStyle = rgba(cur.thread, Math.min(1, a.activity + 0.2));
          ctx.shadowColor = rgba(cur.thread, 1);
          ctx.shadowBlur = 10;
          ctx.arc(px, py, 2.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        positions.push({ xFrac: ax / w, yFrac: ay / h, label: a.label, activity: a.activity });
      }
      anchorPosRef.current = positions;

      // Spiral nucleus particles.
      const speedMul = stateRef.current === 'thinking' ? 2.2 : stateRef.current === 'acting' ? 1.6 : 1;
      for (const p of spiralParticles) {
        const angle = p.phase + t * p.speed * speedMul;
        const localT = (p.t + t * 0.02 * speedMul) % 1;
        const r = coreRadius * (0.15 + localT * 0.85);
        const wobble = Math.sin(t * 1.3 + p.phase) * p.jitter;
        const armOffset = (p.arm / 3) * Math.PI * 2;
        const x = cx + Math.cos(angle + armOffset + localT * 6) * (r + wobble);
        const y = cy + Math.sin(angle + armOffset + localT * 6) * (r + wobble);
        const size = 0.6 + (1 - localT) * 1.8;
        ctx.beginPath();
        ctx.fillStyle = rgba(cur.core, 0.35 + (1 - localT) * 0.5);
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }

      // Bright core center.
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius * 0.55);
      coreGrad.addColorStop(0, rgba([255, 255, 255], 0.9));
      coreGrad.addColorStop(0.35, rgba(cur.core, 0.85));
      coreGrad.addColorStop(1, rgba(cur.core, 0));
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius * 0.55, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // Decoupled low-frequency sync: keeps the HTML glyph overlay smooth
    // enough without re-rendering React on every 60fps canvas frame.
    const syncTimer = setInterval(() => setAnchorLabels([...anchorPosRef.current]), 180);

    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); clearInterval(syncTimer); };
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
      <div className="jarvis-live-overlay" aria-hidden>
        {anchorLabels.map((p, idx) => (
          <span
            key={idx}
            className="jarvis-live-glyph"
            style={{
              left: `${p.xFrac * 100}%`,
              top: `${p.yFrac * 100}%`,
              opacity: 0.35 + p.activity * 0.6,
            }}
          >
            {p.label}
          </span>
        ))}
      </div>
      <div className="jarvis-live-caption">
        <span className={`jarvis-live-dot jarvis-live-dot--${uiState}`} />
        {caption}
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
