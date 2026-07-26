/**
 * Jarvis Board — infinite 3D camera (CIN-2c).
 *
 * A Figma-style unbounded canvas that happens to be three-dimensional: pan is
 * unlimited in world space, zoom is exponential and unclamped at the top end,
 * and a gentle yaw/pitch orbit gives real depth without turning navigation
 * into a flight simulator.
 *
 * Pure math + input state. No DOM ownership, no React: the caller feeds it
 * pointer/wheel events and reads `project()`. That keeps the camera reusable
 * for any future surface (a second board, a mini-map, an export renderer).
 */

export interface CameraState {
  /** World-space point currently under the viewport centre. */
  tx: number;
  ty: number;
  /** Exponential zoom: screenPxPerWorldUnit = basePx * 2^zoom. */
  zoom: number;
  yaw: number;
  pitch: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Camera-space depth (higher = nearer). Drives scale + draw order. */
  depth: number;
  /** Perspective scale factor, 1 at the focal plane. */
  scale: number;
  /** False when the point is behind the camera — skip drawing. */
  visible: boolean;
}

const BASE_PX_PER_UNIT = 26;
/** Focal distance in world units — larger = flatter, more orthographic feel. */
const FOCAL = 46;
const MIN_ZOOM = -3.2;
const MAX_ZOOM = 3.4;
const MAX_PITCH = 0.62;

export class BoardCamera {
  state: CameraState = { tx: 0, ty: 0, zoom: -0.35, yaw: 0, pitch: 0.22 };

  /** Smoothed values actually used for drawing (inertia-free but eased). */
  private view: CameraState = { ...this.state };

  private w = 1;
  private h = 1;

  setViewport(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
  }

  /** Ease the rendered view toward the target each frame (dt in seconds). */
  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 9);
    this.view.tx += (this.state.tx - this.view.tx) * k;
    this.view.ty += (this.state.ty - this.view.ty) * k;
    this.view.zoom += (this.state.zoom - this.view.zoom) * k;
    this.view.yaw += (this.state.yaw - this.view.yaw) * k;
    this.view.pitch += (this.state.pitch - this.view.pitch) * k;
  }

  get pxPerUnit(): number {
    return BASE_PX_PER_UNIT * Math.pow(2, this.view.zoom);
  }

  get pose(): Readonly<CameraState> {
    return this.view;
  }

  panByScreen(dxPx: number, dyPx: number): void {
    const s = this.pxPerUnit;
    // Un-rotate the screen delta so dragging feels world-locked under yaw.
    const cy = Math.cos(-this.view.yaw);
    const sy = Math.sin(-this.view.yaw);
    const wx = (dxPx / s) * cy - (dyPx / s) * sy;
    const wy = (dxPx / s) * sy + (dyPx / s) * cy;
    this.state.tx -= wx;
    this.state.ty -= wy / Math.max(0.35, Math.cos(this.view.pitch));
  }

  /** Zoom about a screen anchor so the point under the cursor stays put. */
  zoomAt(deltaZoom: number, anchorX: number, anchorY: number): void {
    const before = this.unproject(anchorX, anchorY);
    this.state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.state.zoom + deltaZoom));
    // Apply immediately for the anchor math, then let update() ease the rest.
    const prevZoom = this.view.zoom;
    this.view.zoom = this.state.zoom;
    const after = this.unproject(anchorX, anchorY);
    this.view.zoom = prevZoom;
    this.state.tx += before.x - after.x;
    this.state.ty += before.y - after.y;
  }

  orbitBy(dYaw: number, dPitch: number): void {
    this.state.yaw += dYaw;
    this.state.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.state.pitch + dPitch));
  }

  resetTo(tx: number, ty: number, zoom: number): void {
    this.state.tx = tx;
    this.state.ty = ty;
    this.state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  }

  /** World (x, y, z) → screen px. z lifts a card off the ring plane. */
  project(x: number, y: number, z = 0): Projected {
    const v = this.view;
    const dx = x - v.tx;
    const dy = y - v.ty;
    const cy = Math.cos(v.yaw);
    const sy = Math.sin(v.yaw);
    const rx = dx * cy - dy * sy;
    const ry = dx * sy + dy * cy;
    const cp = Math.cos(v.pitch);
    const sp = Math.sin(v.pitch);
    // Tilt the ring plane: y compresses, and depth grows with distance "into"
    // the screen so far shells genuinely recede.
    const camY = ry * cp - z * sp;
    const camZ = ry * sp + z * cp;
    const depth = FOCAL - camZ;
    if (depth <= 4) return { x: 0, y: 0, depth, scale: 0, visible: false };
    const persp = FOCAL / depth;
    const s = this.pxPerUnit;
    return {
      x: this.w * 0.5 + rx * s * persp,
      y: this.h * 0.5 + camY * s * persp,
      depth,
      scale: persp,
      visible: true,
    };
  }

  /** Screen px → world point on the z = 0 plane (used for anchored zoom). */
  unproject(px: number, py: number): { x: number; y: number } {
    const v = this.view;
    const s = this.pxPerUnit;
    const sx = (px - this.w * 0.5) / s;
    const sy = (py - this.h * 0.5) / s;
    const cp = Math.max(0.35, Math.cos(v.pitch));
    const rx = sx;
    const ry = sy / cp;
    const cy = Math.cos(-v.yaw);
    const syaw = Math.sin(-v.yaw);
    return {
      x: v.tx + rx * cy - ry * syaw,
      y: v.ty + rx * syaw + ry * cy,
    };
  }
}
