/**
 * DEV — gargantua-v2 (fork of locked v1 — edit freely)
 *
 * Starts identical to the locked v1 (warm orbital gold + multi-shell inward
 * glow + speak gravity). Push experiments here; never edit gargantua-v1.ts.
 *
 * Parts: bloom | fullDisk | lensWraps | eventHorizon | frontDiskStrip
 *        | upperHorizonPunch | equatorialEllipse | photonRing | contactSparks
 */
export type RGB = [number, number, number];

export type LuxPalette = {
  /** Inner ISCO / signal highlights — near-white gold */
  hot: RGB;
  /** Primary orbital gold — synapses + disk mid */
  gold: RGB;
  /** Mid-orbit amber */
  amber: RGB;
  /** Outer / receding ember */
  ember: RGB;
};

/** @deprecated aliases kept so older mesh call sites stay readable */
export type LuxPaletteLegacy = LuxPalette & {
  pearl: RGB;
  steel: RGB;
  ink: RGB;
  gilt: RGB;
};

export type GargantuaPaint = {
  ctx: CanvasRenderingContext2D;
  cx: number;
  cy: number;
  R: number;
  hot: RGB;
  gold: RGB;
  amber: RGB;
  ember: RGB;
  accent: RGB;
  tilt: number;
  yScale: number;
  outer: number;
  sweep: number;
  /** 0..1 — user voice / mic (inhale, rim, contact) */
  listen: number;
  /** 0..1 — assistant TTS (disk sweep, bloom, emit) */
  speak: number;
};

/** Presence drive for singularity — not mesh spin. */
export type PresenceDrive = { listen?: number; speak?: number };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function rgba(c: RGB, a: number): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}
function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/**
 * Accretion-disk gold family with stellar outer limbs (gold → orange → red).
 * Base orbital hues stay dominant; accent only nudges temperature slightly.
 */
export function luxPaletteFromAccent(accent: RGB): LuxPalette & {
  pearl: RGB;
  steel: RGB;
  ink: RGB;
  gilt: RGB;
  orange: RGB;
  scarlet: RGB;
} {
  // Warmer stellar accretion: cream → gold → amber → orange → scarlet
  const hot = mixRgb([255, 232, 198], accent, 0.06);
  const gold = mixRgb([248, 176, 68], accent, 0.08);
  const amber = mixRgb([236, 132, 36], accent, 0.06);
  const orange = mixRgb([255, 98, 28], accent, 0.05);
  const scarlet = mixRgb([206, 36, 18], accent, 0.04);
  const ember = mixRgb([138, 24, 12], accent, 0.05);
  return {
    hot,
    gold,
    amber,
    ember,
    orange,
    scarlet,
    pearl: hot,
    steel: gold,
    ink: ember,
    gilt: mixRgb(gold, amber, 0.4),
  };
}

function paintPlane(g: GargantuaPaint, alphaMul: number): void {
  const { ctx, R, hot, gold, amber, ember, outer } = g;
  const orange: RGB = mixRgb(amber, [255, 108, 28], 0.55);
  const scarlet: RGB = mixRgb(ember, [210, 36, 18], 0.45);

  // Inner hot → mid gold → outer stellar orange/red rings
  const rad = ctx.createRadialGradient(0, 0, 0, 0, 0, outer);
  rad.addColorStop(0, rgba(hot, 0.42 * alphaMul));
  rad.addColorStop(0.14, rgba(gold, 0.58 * alphaMul));
  rad.addColorStop(0.36, rgba(amber, 0.44 * alphaMul));
  rad.addColorStop(0.58, rgba(orange, 0.4 * alphaMul));
  rad.addColorStop(0.78, rgba(scarlet, 0.32 * alphaMul));
  rad.addColorStop(0.9, rgba(ember, 0.16 * alphaMul));
  rad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rad;
  ctx.beginPath();
  ctx.arc(0, 0, outer, 0, Math.PI * 2);
  ctx.fill();

  // Doppler: approaching hotter gold, receding scarlet
  const wash = ctx.createLinearGradient(-outer, 0, outer, 0);
  wash.addColorStop(0, rgba(scarlet, 0.22));
  wash.addColorStop(0.2, rgba(orange, 0.42));
  wash.addColorStop(0.48, rgba(hot, 0.8));
  wash.addColorStop(0.7, rgba(gold, 0.48));
  wash.addColorStop(0.88, rgba(orange, 0.28));
  wash.addColorStop(1, rgba(ember, 0.14));
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = wash;
  ctx.globalAlpha = 0.4 * alphaMul;
  ctx.beginPath();
  ctx.arc(0, 0, outer * 0.94, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // Inner bright gold layer — just outside the horizon, a bit more luminous
  const innerGold = mixRgb(hot, gold, 0.35);
  const inner = ctx.createRadialGradient(0, 0, R * 0.92, 0, 0, R * 1.28);
  inner.addColorStop(0, 'rgba(0,0,0,0)');
  inner.addColorStop(0.35, rgba(innerGold, 0.55 * alphaMul));
  inner.addColorStop(0.55, rgba(hot, 0.72 * alphaMul));
  inner.addColorStop(0.78, rgba(gold, 0.38 * alphaMul));
  inner.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.28, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = rgba(hot, 0.55 * alphaMul);
  ctx.lineWidth = R * 0.14;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.08, 0, Math.PI * 2);
  ctx.stroke();

  // Second inner gold ring — brighter, nested just outside the first
  const gilt = mixRgb(hot, [255, 220, 160], 0.45);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(gilt, 0.7 * alphaMul);
  ctx.lineWidth = R * 0.09;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = rgba(hot, 0.45 * alphaMul);
  ctx.lineWidth = R * 0.045;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';

  // Explicit outer orbital rings — star-like red / orange / gold
  const rings: Array<{ r: number; c: RGB; a: number; w: number }> = [
    { r: R * 1.55, c: gold, a: 0.35 * alphaMul, w: R * 0.1 },
    { r: R * 1.9, c: orange, a: 0.42 * alphaMul, w: R * 0.12 },
    { r: R * 2.2, c: scarlet, a: 0.32 * alphaMul, w: R * 0.14 },
  ];
  for (const ring of rings) {
    const track = ctx.createLinearGradient(-outer, 0, outer, 0);
    track.addColorStop(0, 'rgba(0,0,0,0)');
    track.addColorStop(0.35, rgba(ring.c, ring.a));
    track.addColorStop(0.5, rgba(hot, ring.a * 0.7));
    track.addColorStop(0.65, rgba(ring.c, ring.a));
    track.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.strokeStyle = track;
    ctx.lineWidth = ring.w;
    ctx.beginPath();
    ctx.arc(0, 0, ring.r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * Soft Interstellar limb: warm falloff reaching further into the void
 * (core stays black; roughly the outer ~55% of R carries the gradient).
 */
function paintInwardHorizonLimb(g: GargantuaPaint): void {
  const { ctx, cx, cy, R, hot, gold, amber, ember } = g;
  const warmRim = mixRgb(amber, [255, 72, 28], 0.4);
  const grad = ctx.createRadialGradient(cx, cy, R * 0.42, cx, cy, R);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.22, 'rgba(0,0,0,0)');
  grad.addColorStop(0.42, rgba(ember, 0.28));
  grad.addColorStop(0.62, rgba(mixRgb(amber, ember, 0.45), 0.48));
  grad.addColorStop(0.8, rgba(mixRgb(gold, amber, 0.45), 0.52));
  grad.addColorStop(0.92, rgba(warmRim, 0.45));
  grad.addColorStop(1, rgba(mixRgb(hot, warmRim, 0.35), 0.24));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
}

function paintHorizonGoldRing(g: GargantuaPaint): void {
  const { ctx, cx, cy, R, hot, gold, speak } = g;
  const gilt = mixRgb(hot, [255, 228, 170], 0.4);
  const soft = mixRgb(gold, gilt, 0.5);
  const amp = 1 + speak * 0.08;

  // Several milder luminous shells, stepped inward
  const shells: Array<{ mid: number; half: number; peak: number }> = [
    { mid: 0.9, half: 0.045, peak: 0.14 * amp },
    { mid: 0.82, half: 0.05, peak: 0.16 * amp },
    { mid: 0.72, half: 0.055, peak: 0.18 * amp },
    { mid: 0.62, half: 0.05, peak: 0.14 * amp },
  ];
  for (const s of shells) {
    const r0 = R * Math.max(0.05, s.mid - s.half);
    const r1 = R * (s.mid + s.half);
    const band = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    band.addColorStop(0, 'rgba(0,0,0,0)');
    band.addColorStop(0.35, rgba(soft, s.peak * 0.45));
    band.addColorStop(0.5, rgba(gilt, s.peak));
    band.addColorStop(0.65, rgba(soft, s.peak * 0.45));
    band.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = band;
    ctx.beginPath();
    ctx.arc(cx, cy, r1, 0, Math.PI * 2);
    ctx.fill();
  }

  // Wide bright layer — soft gradient falloff both inward and outward
  const mid = R * 0.88;
  const half = R * 0.14;
  const rIn = mid - half;
  const rOut = mid + half;
  const wide = ctx.createRadialGradient(cx, cy, rIn, cx, cy, rOut);
  wide.addColorStop(0, 'rgba(0,0,0,0)');
  wide.addColorStop(0.22, rgba(soft, 0.12 * amp));
  wide.addColorStop(0.4, rgba(gilt, 0.32 * amp));
  wide.addColorStop(0.5, rgba(hot, 0.58 * amp));
  wide.addColorStop(0.6, rgba(gilt, 0.32 * amp));
  wide.addColorStop(0.78, rgba(soft, 0.12 * amp));
  wide.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = wide;
  ctx.beginPath();
  ctx.arc(cx, cy, rOut, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

export function prepareGargantuaV2(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  t: number,
  accent: RGB,
  presence: PresenceDrive = {},
): GargantuaPaint {
  const R = Math.max(12, radius);
  const lux = luxPaletteFromAccent(accent);
  // Listening never drives the singularity — only speak (assistant TTS).
  const speak = Math.max(0, Math.min(1, presence.speak ?? 0));
  const scarlet: RGB = [210, 36, 18];
  const orange: RGB = [255, 98, 28];
  // Layers shift redder while speaking (gravity heat), without light explosion.
  const hot = mixRgb(lux.hot, orange, speak * 0.28);
  const gold = mixRgb(lux.gold, mixRgb(orange, scarlet, 0.35), speak * 0.42);
  const amber = mixRgb(lux.amber, scarlet, speak * 0.5);
  const ember = mixRgb(lux.ember, scarlet, speak * 0.35);
  // Soft disk-thickness breath — stronger gravity feel while speaking.
  const thicknessBreath = 1 + speak * 0.2 * (0.5 + 0.5 * Math.sin(t * 1.65));
  const sweepRate = 0.22 + speak * 0.95;
  return {
    ctx,
    cx,
    cy,
    R,
    hot,
    gold,
    amber,
    ember,
    accent,
    tilt: -0.08,
    yScale: 0.2 * thicknessBreath,
    outer: R * 2.35,
    sweep: (t * sweepRate) % (Math.PI * 2),
    listen: 0,
    speak,
  };
}

export const gargantuaV2Parts = {
  bloom(g: GargantuaPaint): void {
    const { ctx, cx, cy, R, gold, amber, ember } = g;
    const orange = mixRgb(amber, [255, 108, 28], 0.5);
    // Quiet ambient bloom only — never explode with speak.
    const bloom = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 3.2);
    bloom.addColorStop(0, rgba(gold, 0.1));
    bloom.addColorStop(0.3, rgba(amber, 0.07));
    bloom.addColorStop(0.55, rgba(orange, 0.05));
    bloom.addColorStop(0.78, rgba(ember, 0.04));
    bloom.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 3.2, 0, Math.PI * 2);
    ctx.fill();
  },

  fullDisk(g: GargantuaPaint): void {
    const { ctx, cx, cy, R, hot, gold, amber, tilt, yScale, sweep, speak } = g;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.scale(1, yScale);
    paintPlane(g, 1);
    // Extra orbital tracks — innermost gold is brighter; more spin while speaking.
    const tracks: Array<{ r: number; w: number; a: number; col: RGB }> = [
      { r: R * 1.06, w: R * 0.11, a: 0.48 + speak * 0.22, col: hot },
      { r: R * 1.22, w: R * 0.1, a: 0.58 + speak * 0.2, col: mixRgb(hot, [255, 230, 180], 0.4) },
      { r: R * 1.42, w: R * 0.08, a: 0.28 + speak * 0.2, col: gold },
      { r: R * 1.55, w: R * 0.12, a: 0.28 + speak * 0.25, col: mixRgb(hot, amber, 0.4) },
      { r: R * 1.9, w: R * 0.1, a: 0.2 + speak * 0.22, col: amber },
      { r: R * 2.15, w: R * 0.09, a: 0.14 + speak * 0.2, col: mixRgb(amber, [210, 36, 18], 0.45) },
    ];
    for (const tr of tracks) {
      const span = 0.35 + speak * 0.55;
      ctx.strokeStyle = rgba(tr.col, tr.a);
      ctx.lineWidth = tr.w;
      ctx.beginPath();
      ctx.arc(0, 0, tr.r, sweep - span * 0.5, sweep + span * 0.5);
      ctx.stroke();
      if (speak > 0.05) {
        ctx.strokeStyle = rgba(tr.col, tr.a * 0.55);
        ctx.beginPath();
        ctx.arc(0, 0, tr.r, sweep + Math.PI - span * 0.4, sweep + Math.PI + span * 0.4);
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  lensWraps(g: GargantuaPaint): void {
    const { ctx, cx, cy, R, hot, gold, amber, tilt, speak } = g;
    const orange = mixRgb(amber, [255, 108, 28], 0.55 + speak * 0.2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.scale(1, 0.12);
    const wrap = ctx.createLinearGradient(-R * 2.0, 0, R * 2.0, 0);
    wrap.addColorStop(0, 'rgba(0,0,0,0)');
    wrap.addColorStop(0.35, rgba(orange, 0.28 + speak * 0.08));
    wrap.addColorStop(0.5, rgba(mixRgb(hot, amber, speak * 0.4), 0.5));
    wrap.addColorStop(0.65, rgba(gold, 0.35));
    wrap.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.strokeStyle = wrap;
    ctx.lineWidth = R * 0.52;
    ctx.beginPath();
    ctx.arc(0, -R * 0.35, R * 1.75, Math.PI * 0.14, Math.PI * 0.86);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = rgba(mixRgb(orange, amber, 0.4), 0.26 + speak * 0.08);
    ctx.lineWidth = R * 0.34;
    ctx.arc(0, R * 0.45, R * 1.6, Math.PI * 1.14, Math.PI * 1.86);
    ctx.stroke();
    ctx.restore();
  },

  eventHorizon(g: GargantuaPaint): void {
    const { ctx, cx, cy, R, gold, amber, speak } = g;
    ctx.beginPath();
    ctx.fillStyle = '#000000';
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    paintInwardHorizonLimb(g);
    const limb = mixRgb(mixRgb(gold, amber, 0.55), [255, 48, 18], 0.55 + speak * 0.25);
    ctx.beginPath();
    ctx.strokeStyle = rgba(limb, 0.72);
    ctx.lineWidth = Math.max(1.2, R * 0.038);
    ctx.arc(cx, cy, R * 0.992, 0, Math.PI * 2);
    ctx.stroke();
    paintHorizonGoldRing(g);
  },

  frontDiskStrip(g: GargantuaPaint): void {
    const { ctx, cx, cy, R, hot, gold, amber, tilt, yScale, outer } = g;
    ctx.save();
    ctx.beginPath();
    const band = R * yScale * 1.65;
    ctx.rect(cx - outer, cy - band, outer * 2, band * 2 + R * 0.28);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.scale(1, yScale);
    paintPlane(g, 1.0);
    // Steady contact — no luminous explosion
    const contact = ctx.createRadialGradient(0, 0, R * 0.55, 0, 0, R * 1.35);
    contact.addColorStop(0, 'rgba(0,0,0,0)');
    contact.addColorStop(0.42, rgba(hot, 0.48));
    contact.addColorStop(0.68, rgba(gold, 0.32));
    contact.addColorStop(0.88, rgba(amber, 0.14));
    contact.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = contact;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  },

  upperHorizonPunch(g: GargantuaPaint): void {
    const { ctx, cx, cy, R } = g;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI, Math.PI * 2);
    ctx.lineTo(cx - R, cy);
    ctx.closePath();
    ctx.clip();
    ctx.beginPath();
    ctx.fillStyle = '#000000';
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  equatorialEllipse(g: GargantuaPaint): void {
    const { ctx, cx, cy, R, tilt } = g;
    ctx.beginPath();
    ctx.fillStyle = '#000000';
    ctx.ellipse(cx, cy, R * 0.96, R * 0.26, tilt, 0, Math.PI * 2);
    ctx.fill();
    // Re-apply after punches so the soft inward limb survives the silhouette rebuild.
    paintInwardHorizonLimb(g);
    paintHorizonGoldRing(g);
  },

  photonRing(g: GargantuaPaint): void {
    const { ctx, cx, cy, R, hot, gold, amber, speak } = g;
    const scarlet = mixRgb(amber, [255, 36, 12], 0.65 + speak * 0.2);
    const rim = mixRgb(mixRgb(hot, gold, 0.2), scarlet, 0.7 + speak * 0.15);

    ctx.beginPath();
    ctx.strokeStyle = rgba(rim, 0.88);
    ctx.lineWidth = Math.max(1.4, R * 0.052);
    ctx.arc(cx, cy, R * 1.03, 0, Math.PI * 2);
    ctx.stroke();

    // Thin red outer limb — hue shift only, no bloom blast
    ctx.beginPath();
    ctx.strokeStyle = rgba(scarlet, 0.42 + speak * 0.12);
    ctx.lineWidth = Math.max(1.6, R * 0.06);
    ctx.arc(cx, cy, R * 1.05, 0, Math.PI * 2);
    ctx.stroke();
  },

  contactSparks(g: GargantuaPaint): void {
    const { ctx, cx, cy, R, hot, gold, amber } = g;
    // Baseline contact only — no speak/listen amp
    ctx.globalCompositeOperation = 'lighter';
    for (const side of [-1, 1] as const) {
      const px = cx + side * R * 0.98;
      const grad = ctx.createRadialGradient(px, cy, 0, px, cy, R * 0.5);
      grad.addColorStop(0, rgba(hot, 0.85));
      grad.addColorStop(0.22, rgba(gold, 0.55));
      grad.addColorStop(0.5, rgba(amber, 0.28));
      grad.addColorStop(0.78, rgba(mixRgb(amber, [255, 60, 20], 0.4), 0.12));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, cy, R * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  },
} as const;

export type GargantuaV2PartId = keyof typeof gargantuaV2Parts;

export const GARGANTUA_V2_PART_ORDER: readonly GargantuaV2PartId[] = [
  'bloom',
  'fullDisk',
  'lensWraps',
  'eventHorizon',
  'frontDiskStrip',
  'upperHorizonPunch',
  'equatorialEllipse',
  'photonRing',
  'contactSparks',
] as const;

export const GARGANTUA_V2_META = {
  id: 'gargantua-v2',
  forkedFrom: 'gargantua-v1@2026-07-21-inward-glow',
  description:
    'Dev fork of locked v1 (orbital gold + multi-shell inward glow). Experiment here.',
  parts: GARGANTUA_V2_PART_ORDER,
} as const;

export function drawGargantuaV2(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  t: number,
  accent: RGB,
  presenceOrOnly?: PresenceDrive | readonly GargantuaV2PartId[],
  only?: readonly GargantuaV2PartId[],
): void {
  const presence: PresenceDrive = Array.isArray(presenceOrOnly) ? {} : (presenceOrOnly ?? {});
  const parts = Array.isArray(presenceOrOnly) ? presenceOrOnly : only;
  const g = prepareGargantuaV2(ctx, cx, cy, radius, t, accent, presence);
  const order = parts?.length
    ? GARGANTUA_V2_PART_ORDER.filter((id) => parts.includes(id))
    : GARGANTUA_V2_PART_ORDER;
  for (const id of order) gargantuaV2Parts[id](g);
}
