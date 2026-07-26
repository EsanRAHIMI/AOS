/**
 * Jarvis Ensemble Stage — shared pose for independent subsystems.
 *
 * Gargantua (WebGL) and NeuralMesh3D stay separate, scalable modules.
 * This file is the only place that defines their shared proportions and clock
 * so they move as one organism without importing each other.
 */
import { GARGANTUA_LOCK } from './gargantua3d';

export type RGB = [number, number, number];

/** Locked visual ratios — change here to retune the whole ensemble. */
export const JARVIS_ENSEMBLE = {
  /** Black-hole view radius / coreRadius */
  bhToCore: 0.252,
  /** Neural cage radius / coreRadius */
  meshToCore: 1.38,
  /** Horizon keepout / bhRadius (nodes occluded inside) */
  keepoutToBh: 3.4,
  coreFrac: { compact: 0.18, desktop: 0.15 },
  fieldFrac: { compact: 0.46, desktop: 0.52 },
  centerY: { compact: 0.42, desktop: 0.46 },
} as const;

export type JarvisOrbitSample = {
  theta: number;
  phi: number;
  dist: number;
};

export type JarvisEnsembleDrive = {
  t: number;
  dt: number;
  w: number;
  h: number;
  compact: boolean;
  reducedMotion: boolean;
  speak: number;
  speedMul: number;
  accent: RGB;
  /** Live Gargantua orbit — mesh precesses with user drag */
  orbit?: JarvisOrbitSample | null;
  /** CIN-2c — the ensemble sits at the infinite board's world origin. When the
   *  board pans/zooms it reports the projected origin here and the whole
   *  organism (horizon, cage, threads) travels with it. Omitted ⇒ the classic
   *  viewport-centred behaviour, byte-for-byte unchanged. */
  boardOrigin?: { x: number; y: number; scale: number } | null;
};

export type JarvisEnsemblePose = {
  t: number;
  dt: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  coreRadius: number;
  bhRadius: number;
  meshRadius: number;
  fieldRadius: number;
  bhKeepout: number;
  breath: number;
  speak: number;
  speedMul: number;
  accent: RGB;
  /** Shared 3D spin — mesh rotates; singularity disk shears with the same phase */
  spin: { yaw: number; pitch: number; roll: number };
};

export function resolveJarvisEnsemble(d: JarvisEnsembleDrive): JarvisEnsemblePose {
  const E = JARVIS_ENSEMBLE;
  const cx = d.boardOrigin ? d.boardOrigin.x : d.w * 0.5;
  const cy = d.boardOrigin ? d.boardOrigin.y : d.h * (d.compact ? E.centerY.compact : E.centerY.desktop);
  // Board zoom scales the organism with the world. The singularity is an
  // OBJECT ON the board, not chrome: it must shrink and grow exactly like the
  // rings and the cards do, so the clamp is wide enough to stay faithful and
  // only guards the degenerate extremes.
  const boardScale = d.boardOrigin ? Math.max(0.1, Math.min(3, d.boardOrigin.scale)) : 1;
  const scale = Math.min(d.w, d.h) * boardScale;
  const breath = d.reducedMotion ? 1 : 1 + Math.sin(d.t * 0.55) * 0.015;
  // Speak thickens the whole organism slightly (cage + horizon footprint).
  const speakBreath = 1 + d.speak * 0.045;
  const coreRadius =
    scale * (d.compact ? E.coreFrac.compact : E.coreFrac.desktop) * breath * speakBreath;
  const bhRadius = coreRadius * E.bhToCore;
  const meshRadius = coreRadius * E.meshToCore;
  const fieldRadius = scale * (d.compact ? E.fieldFrac.compact : E.fieldFrac.desktop);
  const bhKeepout = bhRadius * E.keepoutToBh;

  const orbitYaw = d.orbit ? d.orbit.theta - GARGANTUA_LOCK.theta : 0;
  const orbitPitch = d.orbit ? (d.orbit.phi - GARGANTUA_LOCK.phi) * 0.55 : 0;
  const speakSpin = d.speak * 0.22;

  return {
    t: d.t,
    dt: d.dt,
    cx,
    cy,
    w: d.w,
    h: d.h,
    coreRadius,
    bhRadius,
    meshRadius,
    fieldRadius,
    bhKeepout,
    breath: breath * speakBreath,
    speak: d.speak,
    speedMul: d.speedMul,
    accent: d.accent,
    spin: {
      yaw: d.t * 0.07 + orbitYaw + speakSpin,
      pitch: Math.sin(d.t * 0.048) * 0.22 + d.t * 0.018 + orbitPitch,
      roll: Math.cos(d.t * 0.037) * 0.12 + orbitYaw * 0.15,
    },
  };
}
