'use client';
/**
 * JarvisBoard — the infinite 3D operating board (CIN-2c).
 *
 * Layered deliberately, so nothing here can break the presence stage:
 *   · a canvas painting the orbital rings and the LIVE SYNAPSES (axons +
 *     travelling packets) between cards,
 *   · absolutely-positioned DOM cards projected from world space each frame
 *     (DOM keeps text crisp, selectable and accessible; the canvas keeps the
 *     neural traffic cheap),
 *   · the Gargantua singularity, which the parent stage draws at the board's
 *     world origin — this component reports the projected origin back up via
 *     `onOriginChange` instead of drawing anything at the centre itself.
 *
 * Interaction: drag to pan (infinite), wheel/pinch to zoom about the cursor,
 * Alt+drag or right-drag to orbit, double-click a card to focus it, drag a
 * card to hand-place it forever. Everything is owner-personalisable through
 * boardProfile.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardCamera } from './boardCamera';
import { layoutCards, driftOffset, type CardPlacement } from './boardLayout';
import {
  SCOPE_RING, BOARD_SCOPES,
  type BoardCard, type BoardGraph, type BoardScope,
} from './boardModel';
import { SynapseTraffic, axonPoint } from './boardSynapses';
import {
  DEFAULT_PROFILE, ROLE_LABEL_FA, isSourceVisible, loadBoardProfile,
  resolveScope, saveBoardProfile, type BoardProfile, type BoardRole,
} from './boardProfile';
import { loadBoardGraphAction } from './boardSources';

const REFRESH_MS = 12_000;

/* Zoom feel. WHEEL_GAIN is per pixel of wheel delta (a mouse notch is ~100px);
 * TRACKPAD_GAIN applies to ctrl+wheel, which is how a trackpad pinch arrives —
 * its deltas are tiny, so it needs a much larger multiplier to track fingers.
 * PINCH_GAIN scales the raw finger-distance ratio on touch screens. */
const WHEEL_GAIN = 0.0055;
const TRACKPAD_GAIN = 0.022;
const PINCH_GAIN = 1.9;
const MAX_ZOOM_STEP = 1.1;

type ScreenCard = {
  card: BoardCard;
  x: number;
  y: number;
  /** World scale = perspective x board zoom (drives card size). */
  scale: number;
  /** Perspective only (drives the depth fade, independent of zoom). */
  persp: number;
  depth: number;
  visible: boolean;
};

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

export interface JarvisBoardProps {
  /** Reports the projected world origin + zoom so the parent can keep the
   *  black hole locked to the centre of the board as it pans/zooms. */
  onOriginChange?: (o: { x: number; y: number; scale: number }) => void;
  /** Board dims the chrome while the owner is typing a command. */
  dimmed?: boolean;
}

export default function JarvisBoard({ onOriginChange, dimmed = false }: JarvisBoardProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef(new BoardCamera());
  const trafficRef = useRef(new SynapseTraffic());
  const graphRef = useRef<BoardGraph>({ cards: [], links: [], degraded: [], generatedAt: '' });
  const placementsRef = useRef<Map<string, CardPlacement>>(new Map());
  const profileRef = useRef<BoardProfile>(DEFAULT_PROFILE);
  const originRef = useRef(onOriginChange);
  originRef.current = onOriginChange;

  const [profile, setProfileState] = useState<BoardProfile>(DEFAULT_PROFILE);
  const [graph, setGraph] = useState<BoardGraph>(graphRef.current);
  const [screen, setScreen] = useState<ScreenCard[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [zoomPct, setZoomPct] = useState(100);
  /** Slider mirrors the camera's TARGET zoom; while the owner drags it we stop
   *  syncing so the eased camera can never fight the thumb. */
  const [sliderZoom, setSliderZoom] = useState(-0.35);
  const sliderHeldRef = useRef(false);

  const setProfile = useCallback((next: BoardProfile) => {
    profileRef.current = next;
    setProfileState(next);
    saveBoardProfile(next);
  }, []);

  /* ------------------------------- profile ------------------------------- */
  useEffect(() => {
    const p = loadBoardProfile();
    profileRef.current = p;
    setProfileState(p);
  }, []);

  /* ------------------------------ live data ------------------------------ */
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pull = async () => {
      try {
        const next = await loadBoardGraphAction();
        if (!alive) return;
        // Spike the synapses wherever a card's activity just jumped — the
        // animation is a readout of real change, never a random shimmer.
        const prev = new Map(graphRef.current.cards.map((c) => [c.id, c.activity]));
        for (const c of next.cards) {
          const before = prev.get(c.id);
          if (before !== undefined && c.activity > before + 0.12) {
            for (const l of next.links) {
              if (l.from === c.id) trafficRef.current.burst(next.links, { from: l.from, to: l.to, count: 3 });
            }
          }
        }
        graphRef.current = next;
        setGraph(next);
      } catch {
        /* fail-soft: keep the last good graph on screen */
      } finally {
        if (alive) {
          setLoading(false);
          timer = setTimeout(pull, REFRESH_MS);
        }
      }
    };
    void pull();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, []);

  /* --------------------- visible cards + placements ---------------------- */
  const visibleCards = useMemo(() => {
    return graph.cards
      .filter((c) => c.id === 'self' || (isSourceVisible(profile, c.sourceId) && !profile.hiddenCards[c.id]))
      .map((c) => (c.id === 'self' ? c : { ...c, scope: resolveScope(profile, c.sourceId, c.scope) }));
  }, [graph.cards, profile]);

  const visibleLinks = useMemo(() => {
    const ids = new Set(visibleCards.map((c) => c.id));
    return graph.links.filter((l) => ids.has(l.from) && ids.has(l.to));
  }, [graph.links, visibleCards]);

  useEffect(() => {
    const placed = layoutCards(visibleCards.filter((c) => c.scope !== 'self'), profile.placements);
    const map = new Map<string, CardPlacement>();
    for (const p of placed) map.set(p.id, p);
    map.set('self', { id: 'self', x: 0, y: 0, z: 0, r: 0, scope: 'self', manual: true });
    placementsRef.current = map;
  }, [visibleCards, profile.placements]);

  /* ------------------------------ interaction ---------------------------- */
  const dragRef = useRef<
    | { mode: 'pan'; lastX: number; lastY: number }
    | { mode: 'orbit'; lastX: number; lastY: number }
    | { mode: 'card'; id: string; lastX: number; lastY: number; moved: boolean }
    | null
  >(null);

  /** Live pointers for two-finger pinch. Driven by the stage-level capture
   *  listener (see the wheel/pinch effect) so a pinch centred on the black
   *  hole is not swallowed by the GL canvas. */
  const pinchRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistRef = useRef(0);
  const pinchingRef = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    // Chrome delivers `click` to the CAPTURE target, so capturing the pointer
    // on this wrapper silently eats clicks on any control inside it (the zoom
    // HUD, the layout panel, card actions). Never start a board gesture — and
    // never capture — when the gesture began on a real control.
    if (target.closest('button, a, select, input, textarea, label, .jboard-hud, .jboard-panel')) {
      dragRef.current = null;
      return;
    }
    const cardEl = target.closest('[data-card-id]') as HTMLElement | null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pinchingRef.current) { dragRef.current = null; return; }
    if (cardEl && !cardEl.dataset.cardFixed) {
      dragRef.current = { mode: 'card', id: cardEl.dataset.cardId!, lastX: e.clientX, lastY: e.clientY, moved: false };
      return;
    }
    dragRef.current = e.altKey || e.button === 2
      ? { mode: 'orbit', lastX: e.clientX, lastY: e.clientY }
      : { mode: 'pan', lastX: e.clientX, lastY: e.clientY };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (pinchingRef.current) return; // the stage-level pinch owns this gesture
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    if (d.mode === 'pan') cameraRef.current.panByScreen(dx, dy);
    else if (d.mode === 'orbit') cameraRef.current.orbitBy(dx * 0.004, -dy * 0.003);
    else {
      d.moved = d.moved || Math.abs(dx) + Math.abs(dy) > 2;
      const cam = cameraRef.current;
      const p = placementsRef.current.get(d.id);
      if (p) {
        // Screen delta → world delta, un-rotated by yaw and un-squashed by
        // pitch so the card tracks the cursor at any camera angle.
        const s = cam.pxPerUnit;
        const cy = Math.cos(-cam.pose.yaw);
        const sy = Math.sin(-cam.pose.yaw);
        const wy = (dy / s) / Math.max(0.35, Math.cos(cam.pose.pitch));
        const wx = dx / s;
        p.x += wx * cy - wy * sy;
        p.y += wx * sy + wy * cy;
        p.manual = true;
      }
    }
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.mode === 'card' && d.moved) {
      const p = placementsRef.current.get(d.id);
      if (p) {
        const cur = profileRef.current;
        setProfile({ ...cur, placements: { ...cur.placements, [d.id]: { x: p.x, y: p.y, z: p.z } } });
      }
    }
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }, [setProfile]);

  /**
   * Wheel + trackpad pinch. Registered natively with `{ passive: false }`:
   * React's synthetic onWheel is passive, so `preventDefault()` there is
   * ignored and a trackpad pinch (which arrives as ctrl+wheel) would zoom the
   * whole BROWSER instead of the board.
   */
  useEffect(() => {
    const el = wrapRef.current;
    // Listen on the STAGE in the CAPTURE phase, not on the board itself: the
    // Gargantua canvas is a SIBLING of the board with its own wheel handler
    // that moves the black hole's private camera distance. Without capturing
    // here, a wheel over the centre only resized the singularity and never
    // reached the board — the whole world must zoom as one instead (D-183.5).
    const stage = (el?.parentElement ?? null) as HTMLElement | null;
    if (!el || !stage) return;
    const onWheelNative = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.jboard-panel')) return; // let the panel scroll
      e.preventDefault();
      e.stopPropagation(); // the singularity must not zoom itself
      const rect = el.getBoundingClientRect();
      // Normalise line/page delta modes to pixels so a notch feels the same
      // in every browser.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
      const gain = e.ctrlKey ? TRACKPAD_GAIN : WHEEL_GAIN;
      const step = Math.max(-MAX_ZOOM_STEP, Math.min(MAX_ZOOM_STEP, -e.deltaY * unit * gain));
      cameraRef.current.zoomAt(step, e.clientX - rect.left, e.clientY - rect.top);
    };
    // Two-finger pinch, also captured at the stage and for the same reason:
    // a pinch centred on the singularity would otherwise be swallowed by the
    // GL canvas's own pointer capture. Single-pointer gestures are untouched,
    // so drag-to-orbit the black hole still behaves exactly as before.
    const pts = pinchRef.current;
    const onDownCap = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.jboard-hud, .jboard-panel')) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinchDistRef.current = Math.hypot(b.x - a.x, b.y - a.y);
        pinchingRef.current = true;
        dragRef.current = null; // pinch wins over pan / card drag
        e.stopPropagation();
      }
    };
    const onMoveCap = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!pinchingRef.current || pts.size < 2) return;
      e.stopPropagation();
      const [a, b] = [...pts.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const prev = pinchDistRef.current;
      pinchDistRef.current = dist;
      if (prev > 0 && dist > 0) {
        const rect = el.getBoundingClientRect();
        cameraRef.current.zoomAt(
          Math.log2(dist / prev) * PINCH_GAIN,
          (a.x + b.x) / 2 - rect.left,
          (a.y + b.y) / 2 - rect.top,
        );
      }
    };
    const onUpCap = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) { pinchDistRef.current = 0; pinchingRef.current = false; }
    };

    stage.addEventListener('wheel', onWheelNative, { capture: true, passive: false });
    stage.addEventListener('pointerdown', onDownCap, true);
    stage.addEventListener('pointermove', onMoveCap, true);
    stage.addEventListener('pointerup', onUpCap, true);
    stage.addEventListener('pointercancel', onUpCap, true);
    return () => {
      const cap = { capture: true } as EventListenerOptions;
      stage.removeEventListener('wheel', onWheelNative, cap);
      stage.removeEventListener('pointerdown', onDownCap, true);
      stage.removeEventListener('pointermove', onMoveCap, true);
      stage.removeEventListener('pointerup', onUpCap, true);
      stage.removeEventListener('pointercancel', onUpCap, true);
    };
  }, []);

  const focusCard = useCallback((id: string) => {
    const p = placementsRef.current.get(id);
    if (!p) return;
    setFocusId(id);
    cameraRef.current.resetTo(p.x, p.y, id === 'self' ? -0.2 : 0.45);
  }, []);

  const resetView = useCallback(() => {
    setFocusId(null);
    cameraRef.current.resetTo(0, 0, -0.35);
  }, []);

  /** Frame the entire board — every card, however far it was dragged out. */
  const fitAll = useCallback(() => {
    setFocusId(null);
    const places = [...placementsRef.current.values()];
    if (places.length === 0) {
      cameraRef.current.resetTo(0, 0, -0.35);
      return;
    }
    // Centroid of the actual content (hand-placed cards can be anywhere), then
    // the radius that still contains the farthest card + its own half-width.
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const p of places) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    let radius = 1;
    for (const p of places) radius = Math.max(radius, Math.hypot(p.x - cx, p.y - cy));
    // + a card's own footprint in world units so edge cards aren't clipped.
    cameraRef.current.fitRadius(radius + 4.5, { cx, cy, paddingPx: 110 });
  }, []);

  const zoomStep = useCallback((delta: number) => {
    cameraRef.current.zoomBy(delta);
  }, []);

  /* Keyboard: +/− zoom, 0 reset, F fit. Ignored while typing a command. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') { zoomStep(0.35); e.preventDefault(); }
      else if (e.key === '-' || e.key === '_') { zoomStep(-0.35); e.preventDefault(); }
      else if (e.key === '0') { resetView(); e.preventDefault(); }
      else if (e.key === 'f' || e.key === 'F') { fitAll(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomStep, resetView, fitAll]);

  /* ------------------------------- the frame ----------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let w = 0;
    let h = 0;
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cameraRef.current.setViewport(w, h);
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(wrap); else window.addEventListener('resize', resize);

    let syncAt = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const cam = cameraRef.current;
      cam.update(dt);
      ctx.clearRect(0, 0, w, h);

      const links = visibleLinks;
      trafficRef.current.update(links, dt, reduced ? 0.4 : 1);

      // --- orbital rings: the visual grammar of "how personal is this" ----
      const origin = cam.project(0, 0, 0);
      for (const scope of BOARD_SCOPES) {
        const ring = SCOPE_RING[scope];
        if (ring.radius <= 0) continue;
        ctx.beginPath();
        for (let i = 0; i <= 96; i += 1) {
          const a = (i / 96) * Math.PI * 2;
          const p = cam.project(Math.cos(a) * ring.radius, Math.sin(a) * ring.radius, 0);
          if (!p.visible) continue;
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = rgba(ring.tone, 0.07);
        ctx.lineWidth = 1;
        ctx.stroke();
        // Ring caption sits at the far side so it never fights the cards.
        const lp = cam.project(0, -ring.radius, 0);
        if (lp.visible) {
          ctx.font = '9px ui-monospace, monospace';
          ctx.fillStyle = rgba(ring.tone, 0.3);
          ctx.textAlign = 'center';
          ctx.fillText(ring.label, lp.x, lp.y - 4);
        }
      }

      // --- project cards -------------------------------------------------
      const projected = new Map<string, { x: number; y: number; scale: number; depth: number; visible: boolean }>();
      const out: ScreenCard[] = [];
      // Cards are part of the WORLD, not the chrome: their size follows the
      // board zoom exactly like ring radii and the singularity do. Without
      // this the board only spread cards apart while the black hole alone
      // changed size. The clamp is a readability floor/ceiling, not a
      // different scaling law.
      const worldScale = cam.zoomScale;
      for (const card of visibleCards) {
        const p = placementsRef.current.get(card.id);
        if (!p) continue;
        const d = reduced || p.manual ? { dx: 0, dy: 0, dz: 0 } : driftOffset(card.id, t);
        const pr = cam.project(p.x + d.dx, p.y + d.dy, p.z + d.dz);
        projected.set(card.id, pr);
        out.push({
          card, x: pr.x, y: pr.y,
          scale: Math.max(0.3, Math.min(2.4, pr.scale * worldScale)),
          persp: pr.scale,
          depth: pr.depth, visible: pr.visible,
        });
      }

      // --- axons + travelling packets (the neural network) ---------------
      // Tone lookup once per frame — the axon/packet loops must stay O(links).
      const toneOf = new Map<string, [number, number, number]>();
      const actOf = new Map<string, number>();
      for (const c of visibleCards) {
        toneOf.set(c.id, SCOPE_RING[c.scope].tone);
        actOf.set(c.id, c.activity);
      }
      // Effective traffic: the link's own flow, or the SENDING card's live
      // activity — both are real signals, so an active card visibly pushes
      // data down its axons even when that particular edge has no counter.
      const flowOf = (l: (typeof links)[number]) =>
        Math.max(0, Math.min(1, Math.max(l.flow, (actOf.get(l.from) ?? 0) * 0.5)));

      ctx.lineCap = 'round';
      for (const l of links) {
        const a = projected.get(l.from);
        const b = projected.get(l.to);
        if (!a || !b || !a.visible || !b.visible) continue;
        const flow = flowOf(l);
        const bow = Math.hypot(b.x - a.x, b.y - a.y) * 0.16;
        const tone = toneOf.get(l.from) ?? SCOPE_RING.work.tone;
        const mid = axonPoint(a.x, a.y, b.x, b.y, bow, 0.5);
        const cxq = mid.x * 2 - (a.x + b.x) / 2;
        const cyq = mid.y * 2 - (a.y + b.y) / 2;
        const trace = () => {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.quadraticCurveTo(cxq, cyq, b.x, b.y);
          ctx.stroke();
        };
        // Wide, very soft underglow makes the wiring legible over the
        // starfield without shouting; the crisp core line carries the detail.
        ctx.strokeStyle = rgba(tone, 0.05 + flow * 0.1);
        ctx.lineWidth = 3.2 + l.strength * 2.6 + flow * 3;
        trace();
        ctx.strokeStyle = rgba(tone, 0.2 + l.strength * 0.3 + flow * 0.35);
        ctx.lineWidth = 0.9 + l.strength * 1.3 + flow * 1.2;
        trace();
        // Endpoint terminals — where the axon meets the card.
        for (const [pt, isSender] of [[a, true], [b, false]] as const) {
          const r = (isSender ? 2.6 : 2) * Math.max(0.5, pt.scale);
          ctx.beginPath();
          ctx.fillStyle = rgba(tone, isSender ? 0.35 + flow * 0.5 : 0.22 + flow * 0.35);
          ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.globalCompositeOperation = 'lighter';
      for (const pk of trafficRef.current.list()) {
        const l = links[pk.linkIndex];
        if (!l || pk.t < 0) continue;
        const a = projected.get(l.from);
        const b = projected.get(l.to);
        if (!a || !b || !a.visible || !b.visible) continue;
        const bow = Math.hypot(b.x - a.x, b.y - a.y) * 0.16;
        const pt = axonPoint(a.x, a.y, b.x, b.y, bow, pk.t);
        const tone = toneOf.get(l.from) ?? SCOPE_RING.work.tone;
        const fade = Math.sin(Math.min(1, pk.t) * Math.PI) * pk.life;
        const r = (pk.size + 1.1) * Math.max(0.55, (a.scale + b.scale) / 2);
        // Short comet tail so direction of travel is unmistakable.
        const tail = axonPoint(a.x, a.y, b.x, b.y, bow, Math.max(0, pk.t - 0.06));
        ctx.strokeStyle = rgba(tone, 0.5 * fade);
        ctx.lineWidth = r * 1.1;
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
        const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r * 3.4);
        g.addColorStop(0, rgba(tone, 0.95 * fade));
        g.addColorStop(0.35, rgba(tone, 0.4 * fade));
        g.addColorStop(1, rgba(tone, 0));
        ctx.beginPath();
        ctx.fillStyle = g;
        ctx.arc(pt.x, pt.y, r * 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // Sort back-to-front so nearer cards overlap farther ones correctly.
      out.sort((p, q) => q.depth - p.depth);

      // The parent keeps the singularity glued to the board's origin — and
      // sized with the world (perspective × zoom-vs-default), so zooming out
      // to see everything actually shrinks the black hole too.
      originRef.current?.({ x: origin.x, y: origin.y, scale: origin.scale * cam.zoomScale });

      // DOM sync is throttled — 30fps of React state is plenty for text.
      if (now - syncAt > 33) {
        syncAt = now;
        setScreen(out);
        setZoomPct(Math.round(cam.zoomFactor * 100));
        if (!sliderHeldRef.current) setSliderZoom(cam.zoomTarget);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
    };
  }, [visibleCards, visibleLinks]);

  /* -------------------------------- render ------------------------------- */
  const roleOptions: BoardRole[] = ['founder', 'operator', 'engineer', 'analyst', 'custom'];

  return (
    <div
      ref={wrapRef}
      className={`jboard${dimmed ? ' jboard--dim' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} className="jboard-canvas" />

      <div className="jboard-cards">
        {screen.map(({ card, x, y, scale, persp, visible }) => {
          if (!visible) return null;
          const isSelf = card.id === 'self';
          const focus = focusId === card.id;
          const s = scale;
          const pinned = Boolean(profile.pinned[card.id]);
          // Level of detail: zoomed far out a card collapses to a labelled
          // chip so the whole space stays readable instead of a wall of text.
          const lod = s < 0.5 ? ' jboard-card--chip' : s < 0.8 ? ' jboard-card--tight' : '';
          return (
            <article
              key={card.id}
              data-card-id={card.id}
              {...(isSelf ? { 'data-card-fixed': 'true' } : {})}
              className={`jboard-card jboard-card--${card.scope}${focus ? ' jboard-card--focus' : ''}${isSelf ? ' jboard-card--self' : ''}${lod}`}
              style={{
                // The self nameplate hangs below the singularity (offset is
                // inside the scaled transform, so it tracks the black hole as
                // the board zooms); every other card sits on its own point.
                transform: `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${s})${isSelf ? ' translateY(150px)' : ''}`,
                opacity: Math.max(0.35, Math.min(1, persp * 1.15)),
                borderColor: rgba(card.accent, 0.35 + card.activity * 0.4),
                boxShadow: `0 0 ${12 + card.activity * 34}px ${rgba(card.accent, 0.1 + card.activity * 0.22)}`,
                zIndex: Math.round(1000 - (1 - scale) * 500),
              }}
              onDoubleClick={() => focusCard(card.id)}
            >
              <header className="jboard-card-h">
                <span className="jboard-card-dot" style={{ background: rgba(card.accent, 0.55 + card.activity * 0.45) }} />
                <span className="jboard-card-title">{card.title}</span>
                {(pinned || card.activity > 0.6) && (
                  <span className="jboard-card-live" style={{ color: rgba(card.accent, 0.9) }}>
                    {pinned ? '📌' : '●'}
                  </span>
                )}
              </header>
              <p className="jboard-card-sub">{card.subtitle}</p>
              <div className="jboard-card-metrics">
                {card.metrics.length === 0 && card.emptyHint ? (
                  <span className="jboard-card-empty">{card.emptyHint}</span>
                ) : card.metrics.map((m) => (
                  <span key={m.k} className="jboard-metric">
                    <b style={{ color: m.heat && m.heat > 0.5 ? rgba(card.accent, 1) : undefined }}>{m.v}</b>
                    <i>{m.k}</i>
                  </span>
                ))}
              </div>
              {focus && (
                <footer className="jboard-card-actions">
                  {card.href && <a href={card.href} onClick={(e) => e.stopPropagation()}>باز کردن</a>}
                  {!isSelf && (
                    <button type="button" onClick={(e) => {
                      e.stopPropagation();
                      const cur = profileRef.current;
                      const pin = { ...cur.pinned };
                      if (pin[card.id]) delete pin[card.id]; else pin[card.id] = true;
                      setProfile({ ...cur, pinned: pin });
                    }}>{pinned ? 'برداشتن پین' : 'پین'}</button>
                  )}
                  {!isSelf && (
                    <button type="button" onClick={(e) => {
                      e.stopPropagation();
                      const cur = profileRef.current;
                      setProfile({ ...cur, hiddenCards: { ...cur.hiddenCards, [card.id]: true } });
                    }}>پنهان</button>
                  )}
                </footer>
              )}
            </article>
          );
        })}
      </div>

      <div className="jboard-hud">
        <div className="jboard-zoom" role="group" aria-label="زوم برد">
          <button type="button" className="jboard-zbtn" onClick={() => zoomStep(-0.35)} title="کوچک‌نمایی (−)" aria-label="کوچک‌نمایی">−</button>
          <input
            className="jboard-zslider"
            type="range"
            min={cameraRef.current.zoomRange.min}
            max={cameraRef.current.zoomRange.max}
            step={0.05}
            value={sliderZoom}
            onChange={(e) => {
              const z = Number(e.target.value);
              setSliderZoom(z);
              cameraRef.current.setZoom(z);
            }}
            onPointerDown={(e) => { e.stopPropagation(); sliderHeldRef.current = true; }}
            onPointerUp={() => { sliderHeldRef.current = false; }}
            onPointerCancel={() => { sliderHeldRef.current = false; }}
            aria-label="میزان زوم"
            title="زوم"
          />
          <button type="button" className="jboard-zbtn" onClick={() => zoomStep(0.35)} title="بزرگ‌نمایی (+)" aria-label="بزرگ‌نمایی">+</button>
          <span className="jboard-zpct" title="سطح زوم">{zoomPct}%</span>
        </div>
        <button type="button" className="jboard-btn" onClick={fitAll} title="نمایش کل فضا (F)">کل فضا</button>
        <button type="button" className="jboard-btn" onClick={resetView} title="بازگشت به مرکز (0)">مرکز</button>
        <button type="button" className="jboard-btn" onClick={() => setPanelOpen((v) => !v)} title="شخصی‌سازی برد">
          چیدمان
        </button>
        <span className="jboard-stat">
          {loading ? 'در حال بارگذاری…' : `${screen.length} کارت · ${visibleLinks.length} سیناپس`}
          {graph.degraded.length > 0 ? ` · ${graph.degraded.length} منبع در دسترس نیست` : ''}
        </span>
      </div>

      {panelOpen && (
        <aside className="jboard-panel" onPointerDown={(e) => e.stopPropagation()}>
          <h3>چیدمان برد</h3>
          <label className="jboard-row">
            <span>نقش</span>
            <select
              value={profile.role}
              onChange={(e) => setProfile({ ...profileRef.current, role: e.target.value as BoardRole })}
            >
              {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL_FA[r]}</option>)}
            </select>
          </label>
          <p className="jboard-note">
            هرچه موضوع شخصی‌تر است نزدیک‌تر به مرکز می‌نشیند و هرچه عمومی‌تر، دورتر.
            حلقه‌ها: {BOARD_SCOPES.map((sc) => SCOPE_RING[sc].labelFa).join(' → ')}
          </p>
          <div className="jboard-sources">
            {graph.cards.filter((c) => c.id !== 'self').map((c) => {
              const hidden = Boolean(profile.hiddenCards[c.id]) || !isSourceVisible(profile, c.sourceId);
              const scope = resolveScope(profile, c.sourceId, c.scope);
              return (
                <div key={c.id} className="jboard-source-row">
                  <button
                    type="button"
                    className={`jboard-chip${hidden ? ' jboard-chip--off' : ''}`}
                    onClick={() => {
                      const cur = profileRef.current;
                      const hiddenCards = { ...cur.hiddenCards };
                      const hiddenSources = cur.hiddenSources.filter((sid) => sid !== c.sourceId);
                      if (hidden) delete hiddenCards[c.id];
                      else hiddenCards[c.id] = true;
                      setProfile({ ...cur, hiddenCards, hiddenSources });
                    }}
                  >{c.title}</button>
                  <select
                    value={scope}
                    onChange={(e) => {
                      const cur = profileRef.current;
                      setProfile({
                        ...cur,
                        scopeOverrides: { ...cur.scopeOverrides, [c.sourceId]: e.target.value as BoardScope },
                      });
                    }}
                  >
                    {BOARD_SCOPES.map((sc) => <option key={sc} value={sc}>{SCOPE_RING[sc].labelFa}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="jboard-btn jboard-btn--wide"
            onClick={() => setProfile({ ...DEFAULT_PROFILE, role: profileRef.current.role })}
          >بازنشانی چیدمان</button>
        </aside>
      )}
    </div>
  );
}
