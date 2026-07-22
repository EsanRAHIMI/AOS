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
  /** Vertical squash for lensed far-disk wraps (follows view pitch). */
  wrapScale: number;
  outer: number;
  sweep: number;
  /** 0..1 — user voice / mic (inhale, rim, contact) */
  listen: number;
  /** 0..1 — assistant TTS (disk sweep, bloom, emit) */
  speak: number;
};

/** Presence drive for singularity — not mesh spin. */
export type PresenceDrive = {
  listen?: number;
  speak?: number;
  /**
   * Whole-object orbit (applied AFTER the locked silhouette is painted).
   * yaw/pitch rotate+tip the black hole and disk together — never split them.
   */
  yaw?: number;
  pitch?: number;
};

/** Neutral orbit — identity view transform (cinematic lock unchanged). */
export const GARGANTUA_DEFAULT_YAW = 0;
export const GARGANTUA_DEFAULT_PITCH = 0;

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
 * Accretion palette closer to Interstellar / EHT-style disk:
 * white-hot → gold → fiery orange → deep red → magenta fringe.
 */
export function luxPaletteFromAccent(accent: RGB): LuxPalette & {
  pearl: RGB;
  steel: RGB;
  ink: RGB;
  gilt: RGB;
  orange: RGB;
  scarlet: RGB;
  magenta: RGB;
} {
  const hot = mixRgb([255, 248, 230], accent, 0.04);
  const gold = mixRgb([255, 190, 88], accent, 0.06);
  const amber = mixRgb([242, 128, 36], accent, 0.05);
  const orange = mixRgb([230, 86, 28], accent, 0.04);
  const scarlet = mixRgb([188, 42, 28], accent, 0.04);
  const ember = mixRgb([110, 28, 28], accent, 0.04);
  const magenta = mixRgb([92, 28, 78], accent, 0.03);
  return {
    hot,
    gold,
    amber,
    ember,
    orange,
    scarlet,
    magenta,
    pearl: hot,
    steel: gold,
    ink: ember,
    gilt: mixRgb(hot, gold, 0.35),
  };
}

function paintPlane(g: GargantuaPaint, alphaMul: number): void {
  const { ctx, R, hot, gold, amber, ember, outer } = g;
  const orange: RGB = mixRgb(amber, [255, 110, 40], 0.4);
  const scarlet: RGB = mixRgb(ember, [200, 55, 40], 0.45);
  const magenta: RGB = mixRgb(ember, [130, 40, 115], 0.5);

  // Compact disk: most mass hugs the hole; fringe dies quickly (smaller diameter).
  const body = ctx.createRadialGradient(0, 0, R * 0.98, 0, 0, outer);
  body.addColorStop(0, rgba(hot, 0.82 * alphaMul));
  body.addColorStop(0.12, rgba(gold, 0.78 * alphaMul));
  body.addColorStop(0.38, rgba(orange, 0.55 * alphaMul));
  body.addColorStop(0.62, rgba(scarlet, 0.32 * alphaMul));
  body.addColorStop(0.82, rgba(magenta, 0.14 * alphaMul));
  body.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, outer, 0, Math.PI * 2);
  ctx.fill();

  // Dense inner sheet — brightest / fattest luminous zone near ISCO
  const inner = ctx.createRadialGradient(0, 0, R * 0.98, 0, 0, R * 1.55);
  inner.addColorStop(0, rgba(hot, 0.75 * alphaMul));
  inner.addColorStop(0.35, rgba(gold, 0.7 * alphaMul));
  inner.addColorStop(0.7, rgba(orange, 0.45 * alphaMul));
  inner.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.55, 0, Math.PI * 2);
  ctx.fill();

  // Doppler: left approaching white-hot, right receding red
  const wash = ctx.createLinearGradient(-outer, 0, outer, 0);
  wash.addColorStop(0, rgba(scarlet, 0.35));
  wash.addColorStop(0.25, rgba(orange, 0.5));
  wash.addColorStop(0.48, rgba(hot, 0.95));
  wash.addColorStop(0.72, rgba(gold, 0.45));
  wash.addColorStop(1, rgba(magenta, 0.18));
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.4 * alphaMul;
  ctx.fillStyle = wash;
  ctx.beginPath();
  ctx.arc(0, 0, outer * 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // Soft mid lanes (stay inside compact outer)
  const lanes: Array<{ r: number; w: number; c: RGB; a: number }> = [
    { r: R * 1.18, w: R * 0.28, c: gold, a: 0.22 * alphaMul },
    { r: R * 1.4, w: R * 0.22, c: orange, a: 0.16 * alphaMul },
    { r: R * 1.65, w: R * 0.14, c: scarlet, a: 0.12 * alphaMul },
  ];
  for (const lane of lanes) {
    ctx.strokeStyle = rgba(lane.c, lane.a);
    ctx.lineWidth = lane.w;
    ctx.beginPath();
    ctx.arc(0, 0, lane.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Soft inner limb glow (no hard white stroke — those become chalky ellipses after yScale)
  const limb = ctx.createRadialGradient(0, 0, R * 0.98, 0, 0, R * 1.22);
  limb.addColorStop(0, 'rgba(0,0,0,0)');
  limb.addColorStop(0.35, rgba(gold, 0.35 * alphaMul));
  limb.addColorStop(0.55, rgba(mixRgb(hot, gold, 0.4), 0.42 * alphaMul));
  limb.addColorStop(0.75, rgba(orange, 0.2 * alphaMul));
  limb.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = limb;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.22, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Detached dark scarlet / magenta / violet fringe rings just outside the disk.
 * Tight spacing + uneven thickness so they read as natural spectroscopic layers.
 */
function paintDetachedOuterRings(g: GargantuaPaint, alphaMul: number): void {
  const { ctx, R, ember, outer } = g;
  const deepScarlet: RGB = mixRgb(ember, [150, 28, 36], 0.55);
  const wine: RGB = mixRgb(ember, [110, 24, 70], 0.5);
  const magenta: RGB = [95, 28, 105];
  const violet: RGB = [42, 14, 68];
  // Close to disk edge, irregular gaps & weights (not evenly spaced bullseye)
  const rings: Array<{ r: number; c: RGB; a: number; w: number; glow: number; glowW: number }> = [
    { r: outer * 1.035, c: deepScarlet, a: 0.48 * alphaMul, w: Math.max(1.4, R * 0.038), glow: 0.16, glowW: 0.055 },
    { r: outer * 1.1, c: wine, a: 0.34 * alphaMul, w: Math.max(0.85, R * 0.016), glow: 0.1, glowW: 0.035 },
    { r: outer * 1.175, c: magenta, a: 0.4 * alphaMul, w: Math.max(1.2, R * 0.028), glow: 0.12, glowW: 0.045 },
    { r: outer * 1.255, c: violet, a: 0.28 * alphaMul, w: Math.max(0.55, R * 0.009), glow: 0.07, glowW: 0.028 },
  ];
  for (const ring of rings) {
    const hw = R * ring.glowW;
    const soft = ctx.createRadialGradient(0, 0, Math.max(1, ring.r - hw), 0, 0, ring.r + hw);
    soft.addColorStop(0, 'rgba(0,0,0,0)');
    soft.addColorStop(0.4, rgba(ring.c, ring.glow * 0.55 * alphaMul));
    soft.addColorStop(0.5, rgba(ring.c, ring.glow * alphaMul));
    soft.addColorStop(0.6, rgba(ring.c, ring.glow * 0.55 * alphaMul));
    soft.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = soft;
    ctx.beginPath();
    ctx.arc(0, 0, ring.r + hw, 0, Math.PI * 2);
    ctx.fill();

    // Slight Doppler fade so rings don't look perfectly uniform
    const track = ctx.createLinearGradient(-ring.r, 0, ring.r, 0);
    track.addColorStop(0, rgba(ring.c, ring.a * 0.55));
    track.addColorStop(0.35, rgba(ring.c, ring.a));
    track.addColorStop(0.65, rgba(ring.c, ring.a * 0.85));
    track.addColorStop(1, rgba(ring.c, ring.a * 0.45));
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

  // v1 shells — stepped inward gold glow
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

  // Wide bright layer — same soft falloff as v1
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
    // Locked cinematic pose — orbit is a WHOLE-object transform in drawGargantuaV2.
    tilt: -0.05,
    yScale: 0.48 * thicknessBreath,
    wrapScale: 0.24,
    outer: R * 1.95,
    sweep: (t * sweepRate) % (Math.PI * 2),
    listen: 0,
    speak,
  };
}

export const gargantuaV2Parts = {
  bloom(g: GargantuaPaint): void {
    const { ctx, cx, cy, R, gold, amber, ember } = g;
    const orange = mixRgb(amber, [255, 108, 28], 0.5);
    const magenta = mixRgb(ember, [100, 30, 90], 0.4);
    const bloom = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 3.2);
    bloom.addColorStop(0, rgba(gold, 0.08));
    bloom.addColorStop(0.35, rgba(orange, 0.05));
    bloom.addColorStop(0.6, rgba(magenta, 0.035));
    bloom.addColorStop(0.82, rgba(ember, 0.02));
    bloom.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 3.2, 0, Math.PI * 2);
    ctx.fill();
  },

  fullDisk(g: GargantuaPaint): void {
    const { ctx, cx, cy, R, hot, gold, amber, tilt, yScale, sweep, speak } = g;
    const orange = mixRgb(amber, [255, 110, 40], 0.4);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.scale(1, yScale);
    paintPlane(g, 1);
    paintDetachedOuterRings(g, 1);

    // Extra vertical bulk near the hole — soft fill only (no chalky stroke ellipse)
    ctx.save();
    ctx.scale(1, 1.55);
    ctx.globalCompositeOperation = 'screen';
    const fat = ctx.createRadialGradient(0, 0, R * 0.98, 0, 0, R * 1.4);
    fat.addColorStop(0, 'rgba(0,0,0,0)');
    fat.addColorStop(0.25, rgba(gold, 0.32));
    fat.addColorStop(0.5, rgba(mixRgb(hot, gold, 0.45), 0.38));
    fat.addColorStop(0.78, rgba(orange, 0.16));
    fat.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fat;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(mixRgb(gold, orange, 0.35), 0.18 + speak * 0.2);
    ctx.lineWidth = R * (0.4 + speak * 0.15);
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.25, sweep - 0.5, sweep + 0.5);
    ctx.stroke();
    ctx.strokeStyle = rgba(orange, 0.12 + speak * 0.1);
    ctx.lineWidth = R * 0.24;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.55, sweep + 0.9, sweep + 1.65);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  },

  lensWraps(g: GargantuaPaint): void {
    const { ctx, cx, cy, R, hot, gold, amber, tilt, speak, wrapScale } = g;
    const orange = mixRgb(amber, [255, 110, 40], 0.45);
    const scarlet = mixRgb(amber, [200, 55, 40], 0.4);
    const magenta: RGB = [120, 40, 105];
    // Compact wraps — stay close to the hole like the reference framing
    const sheets: Array<{ y: number; r: number; w: number; a0: number; a1: number; cols: [RGB, RGB, RGB]; a: number }> = [
      { y: -0.22, r: 1.28, w: 0.95, a0: 0.14, a1: 0.86, cols: [scarlet, hot, gold], a: 0.58 },
      { y: -0.12, r: 1.48, w: 0.7, a0: 0.16, a1: 0.84, cols: [orange, gold, scarlet], a: 0.4 },
      { y: -0.04, r: 1.68, w: 0.35, a0: 0.2, a1: 0.8, cols: [magenta, scarlet, orange], a: 0.24 },
      { y: 0.38, r: 1.32, w: 0.7, a0: 1.14, a1: 1.86, cols: [orange, gold, scarlet], a: 0.34 },
      { y: 0.5, r: 1.52, w: 0.4, a0: 1.16, a1: 1.84, cols: [scarlet, magenta, orange], a: 0.22 },
    ];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.scale(1, wrapScale);
    for (const s of sheets) {
      const grad = ctx.createLinearGradient(-R * 1.9, 0, R * 1.9, 0);
      const a = s.a + speak * 0.08;
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.28, rgba(s.cols[0], a * 0.55));
      grad.addColorStop(0.5, rgba(s.cols[1], a));
      grad.addColorStop(0.72, rgba(s.cols[2], a * 0.55));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = R * s.w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, R * s.y, R * s.r, Math.PI * s.a0, Math.PI * s.a1);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
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
    const band = R * yScale * 2.4;
    const haloReach = outer * 1.75;
    ctx.rect(cx - haloReach, cy - band, haloReach * 2, band * 2 + R * 0.35);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.scale(1, yScale);
    paintPlane(g, 1.0);
    paintDetachedOuterRings(g, 0.95);
    // Fat contact limb where the thick inner disk crosses the silhouette
    ctx.save();
    ctx.scale(1, 1.55);
    const contact = ctx.createRadialGradient(0, 0, R * 0.55, 0, 0, R * 1.4);
    contact.addColorStop(0, 'rgba(0,0,0,0)');
    contact.addColorStop(0.35, rgba(gold, 0.38));
    contact.addColorStop(0.62, rgba(mixRgb(hot, gold, 0.4), 0.28));
    contact.addColorStop(0.85, rgba(amber, 0.12));
    contact.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = contact;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
    ctx.ellipse(cx, cy, R * 0.96, R * 0.38, tilt, 0, Math.PI * 2);
    ctx.fill();
    // Re-apply after punches so the soft inward limb survives the silhouette rebuild.
    paintInwardHorizonLimb(g);
    paintHorizonGoldRing(g);
  },

  photonRing(g: GargantuaPaint): void {
    const { ctx, cx, cy, R, hot, gold, amber, speak } = g;
    // Soft photon limb — gradient annulus, no hard chalk stroke
    const ring = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.12);
    ring.addColorStop(0, 'rgba(0,0,0,0)');
    ring.addColorStop(0.35, rgba(gold, 0.28));
    ring.addColorStop(0.55, rgba(mixRgb(hot, gold, 0.35), 0.42));
    ring.addColorStop(0.75, rgba(mixRgb(gold, amber, 0.4), 0.22));
    ring.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
    ctx.fill();
    const magenta = mixRgb(amber, [120, 40, 110], 0.55);
    ctx.beginPath();
    ctx.strokeStyle = rgba(magenta, 0.2 + speak * 0.06);
    ctx.lineWidth = Math.max(1.0, R * 0.032);
    ctx.arc(cx, cy, R * 1.08, 0, Math.PI * 2);
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
    'Dev fork — compact thick disk (fat near hole, short outer reach)',
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
  let presence: PresenceDrive = {};
  if (presenceOrOnly && !Array.isArray(presenceOrOnly)) {
    presence = presenceOrOnly as PresenceDrive;
  }
  const parts = Array.isArray(presenceOrOnly) ? presenceOrOnly : only;
  const g = prepareGargantuaV2(ctx, cx, cy, radius, t, accent, presence);
  const order = parts?.length
    ? GARGANTUA_V2_PART_ORDER.filter((id) => parts.includes(id))
    : GARGANTUA_V2_PART_ORDER;
  for (const id of order) gargantuaV2Parts[id](g);
}
