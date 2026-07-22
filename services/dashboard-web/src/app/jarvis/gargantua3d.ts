/**
 * Live Jarvis WebGL Gargantua entry.
 *
 * Active: gargantua3d-v2 (development).
 * Frozen restore: gargantua3d-v1 — do not edit that file.
 * Cue: «برگردون به gargantua3d-v1» → re-export createGargantua3DV1 as createGargantua3D.
 */
export {
  createGargantua3DV2 as createGargantua3D,
  GARGANTUA_LOCK_V2 as GARGANTUA_LOCK,
  GARGANTUA3D_V2_META,
  type Gargantua3D,
} from './baselines/gargantua3d-v2';
