/**
 * FROZEN BASELINE — gargantua3d-v1
 *
 * Locked 2026-07-22: cinematic WebGL raymarch Gargantua — opaque circular
 * event horizon, thin turbulent fiery accretion disk, purple outer veil,
 * strong uneven gravitational lens wraps, Kepler shear + orbiting hotspots,
 * soft GRAV breath. Locked ¾ camera. Transparent outside HUD plate.
 *
 * Do not edit. Experiment in gargantua3d-v2.ts.
 * Restore cue: «برگردون به gargantua3d-v1» → re-export createGargantua3DV1.
 */
import * as THREE from 'three';

export type Gargantua3D = {
  setSize: (cssW: number, cssH: number, dpr: number) => void;
  setViewRadius: (cssPx: number) => void;
  setSpeak: (speak: number) => void;
  tick: (tSec: number) => void;
  dispose: () => void;
};

export const GARGANTUA3D_V1_META = {
  id: 'gargantua3d-v1',
  lockedAt: '2026-07-22',
  label: 'Cinematic raymarch baseline',
} as const;

/** Slight ¾ perspective — not face-on, not razor edge-on */
export const GARGANTUA_LOCK_V1: { theta: number; phi: number; dist: number } = {
  theta: 0.28,
  phi: 1.48,
  dist: 6.25,
};

const VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uSpeak;
uniform float uRadiusPx;
uniform float uCamTheta;
uniform float uCamPhi;
uniform float uCamDist;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++) {
    v += a * noise2(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

vec3 diskEmission(float r, float ang, float doppler, float speak, float time) {
  // Fiery body first; cream/white only as sparse highlights (no large white surfaces)
  float t = clamp((r - 1.12) / 5.2, 0.0, 1.0);
  vec3 cHot   = vec3(0.945, 0.859, 0.820);
  vec3 cCream = vec3(0.953, 0.800, 0.655);
  vec3 cPeach = vec3(0.925, 0.671, 0.616);
  vec3 cGold  = vec3(0.929, 0.620, 0.400);
  vec3 cOrng  = vec3(0.886, 0.361, 0.133);
  vec3 cFire  = vec3(0.827, 0.165, 0.067);
  vec3 cDeep  = vec3(0.612, 0.133, 0.090);
  vec3 cShad  = vec3(0.345, 0.110, 0.149);
  vec3 cWine  = vec3(0.373, 0.173, 0.306);

  vec3 col = mix(cFire, cOrng, smoothstep(0.0, 0.28, t));
  col = mix(col, cGold, smoothstep(0.18, 0.48, t));
  col = mix(col, cDeep, smoothstep(0.42, 0.72, t));
  col = mix(col, mix(cShad, cWine, 0.5), smoothstep(0.68, 1.0, t));
  // Bright mid-disk band (visible horizontal body)
  float mid = exp(-pow((r - 2.55) * 0.85, 2.0));
  col = mix(col, mix(cOrng, cGold, 0.55), mid * 0.72);
  float hi = exp(-pow((r - 1.32) * 3.5, 2.0)) * (0.55 + 0.45 * doppler);
  col = mix(col, mix(cGold, cPeach, 0.4), hi * 0.88);
  float tip = exp(-pow((r - 1.22) * 5.0, 2.0)) * doppler;
  col = mix(col, mix(cCream, cHot, 0.35), tip * 0.52);

  // Turbulent filaments — broken, not smooth Saturn bands
  float kepler = time * (0.62 + speak * 0.7) * pow(1.15 / max(r, 1.15), 1.6);
  float shear = ang * (1.0 + 0.08 * sin(ang * 3.0)) + kepler;
  float smoke = fbm(vec2(r * 4.2, shear * 3.1));
  float filA = fbm(vec2(r * 9.0 - kepler * 1.7, shear * 6.2));
  float filB = fbm(vec2(r * 14.0 + shear * 0.4, ang * 8.0 - kepler));
  float structure = 0.4 + 0.6 * smoke;
  structure *= 0.5 + 0.5 * filA;
  structure *= 0.58 + 0.42 * filB;
  structure *= 0.72 + 0.28 * step(0.32, smoke);
  structure *= 0.78 + 0.22 * sin(ang * 5.0 + kepler + smoke * 6.0);

  col *= structure;
  col *= 0.7 + 0.95 * doppler;
  col *= 1.0 + mid * 0.55;
  col = mix(col, mix(col, cFire, 0.4), speak * 0.4);
  return col * 1.28;
}

vec3 starfield(vec3 dir) {
  vec3 d = normalize(dir);
  float n = 0.0;
  vec3 p = d * 95.0;
  vec3 id = floor(p);
  float h = hash31(id);
  if (h > 0.9965) {
    vec3 f = fract(p) - 0.5;
    n += exp(-dot(f, f) * 120.0) * (0.4 + 0.4 * hash31(id + 9.0));
  }
  return vec3(0.925, 0.671, 0.616) * n * 0.55;
}

vec3 nebula(vec3 dir) {
  vec3 d = normalize(dir);
  float n = fbm(d.xy * 1.8 + d.z * 0.7);
  float n2 = fbm(d.yz * 2.2 - d.x);
  vec3 voidBg = vec3(0.075, 0.039, 0.094);
  vec3 shad = vec3(0.345, 0.110, 0.149);
  vec3 wine = vec3(0.373, 0.173, 0.306);
  return mix(voidBg, mix(shad, wine, n2), n * 0.55) * 0.4;
}

float diskScaleHeight(float r, float speak) {
  // Thin front disk; modest puff near photon orbit for lens wraps
  float near = exp(-pow((r - 1.35) * 1.9, 2.0));
  float mid = exp(-pow((r - 2.1) * 1.15, 2.0));
  float H = 0.016 + 0.12 * near + 0.04 * mid;
  H *= 1.0 + speak * 0.1;
  return H;
}

void accumulateDisk(
  vec3 hit, vec3 vel, vec3 camPos,
  float time, float speak, float vertWeight, float pathLen,
  inout vec3 color, inout float alpha, inout float tr
) {
  const float R_IN = 1.16;
  const float R_OUT = 8.2;
  float r = length(hit.xz);
  if (r < R_IN || r > R_OUT) return;

  float ang = atan(hit.z, hit.x);
  float orbitSpeed = 0.62 / sqrt(max(r, 1.2));
  vec3 tang = normalize(vec3(-hit.z, 0.0, hit.x));
  float doppler = 0.35 + 0.8 * clamp(dot(normalize(vel), tang) * orbitSpeed * 2.0, -1.0, 1.0);
  doppler = pow(max(doppler, 0.12), 1.08);

  float radial = (r - R_IN) / (R_OUT - R_IN);
  float dens = pow(1.0 - clamp(radial, 0.0, 1.0), 0.88);
  dens *= smoothstep(R_IN, R_IN + 0.12, r);
  dens *= 1.15 + 0.9 * exp(-pow((r - 1.4) * 2.0, 2.0));
  // Stronger, wider mid-disk body
  dens *= 1.0 + 1.05 * exp(-pow((r - 2.6) * 0.7, 2.0));
  dens *= 1.0 + 0.55 * exp(-pow((r - 1.55) * 2.4, 2.0));
  dens *= 0.55 + 0.45 * fbm(vec2(r * 5.5, ang * 4.0 + time * 0.3));
  dens *= vertWeight;
  dens *= clamp(pathLen * 5.0, 0.25, 1.55);

  float far = smoothstep(-0.25, 0.9, -dot(normalize(hit), normalize(camPos)));
  float uneven = 0.7 + 0.6 * fbm(hit.xz * 1.7 + time * 0.05);
  dens *= 1.0 + far * 1.4 * uneven;
  dens *= 0.95 + speak * 0.16;

  vec3 emit = diskEmission(r, ang, doppler, speak, time);
  emit = mix(emit, emit * vec3(0.612, 0.133, 0.090), smoothstep(0.55, 0.9, radial) * 0.38);
  // Lensed rear light — moderated wrap brightness
  emit *= 1.0 + far * 0.35;
  emit = mix(emit, emit * vec3(1.1, 0.95, 0.85), far * 0.22);

  float a = dens * mix(0.92, 0.55, smoothstep(0.35, 1.0, radial));
  a *= 1.0 + far * 0.2;
  a = clamp(a, 0.0, 0.96);
  color += tr * emit * a;
  alpha += tr * a;
  tr *= (1.0 - clamp(a * 0.7, 0.0, 0.9));
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 center = 0.5 * uResolution;
  vec2 d = frag - center;

  float plate = uRadiusPx * 6.8;
  float distPx = length(d);
  if (distPx > plate) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float edgeFade = 1.0 - smoothstep(plate * 0.97, plate, distPx);

  float theta = uCamTheta;
  float phi = clamp(uCamPhi, 0.18, 2.95);
  vec3 camPos = uCamDist * vec3(
    sin(phi) * cos(theta),
    cos(phi),
    sin(phi) * sin(theta)
  );
  vec3 forward = normalize(-camPos);
  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  if (length(right) < 1e-4) right = vec3(1.0, 0.0, 0.0);
  vec3 up = cross(right, forward);

  vec2 uv = d / uRadiusPx;
  float fov = 0.6;
  vec3 rd = normalize(forward + (uv.x * right + uv.y * up) * fov);
  vec3 ro = camPos;

  const float RS = 1.0;
  const float HORIZON = 1.01;
  const float GRAV = 2.85;

  vec3 color = vec3(0.0);
  float alpha = 0.0;
  float tr = 1.0;

  vec3 pos = ro;
  vec3 vel = rd;
  float h2 = length(cross(pos, vel));
  h2 = max(h2 * h2, 1e-5);

  bool hitHorizon = false;
  float closestR = 1e5;

  const int STEPS = 170;
  for (int i = 0; i < STEPS; i++) {
    float r = length(pos);
    closestR = min(closestR, r);
    if (r < HORIZON) { hitHorizon = true; break; }
    if (r > 44.0) break;
    if (tr < 0.025) break;

    float stepLen = clamp(0.02 + 0.036 * r, 0.016, 0.17);
    if (r < 3.5) stepLen *= 0.36;
    if (r < 2.0) stepLen *= 0.62;

    vec3 pos0 = pos;
    vec3 acc = -GRAV * RS * h2 * pos / (pow(r, 5.0) + 1e-6);
    vec3 vMid = vel + acc * (stepLen * 0.5);
    vec3 pMid = pos + vel * (stepLen * 0.5);
    float rm = max(length(pMid), 1e-4);
    vec3 aMid = -GRAV * RS * h2 * pMid / (pow(rm, 5.0) + 1e-6);
    vec3 pos1 = pos + vMid * stepLen;
    vec3 vel1 = vel + aMid * stepLen;

    vec3 sampleP = mix(pos0, pos1, 0.5);
    float rr = length(sampleP.xz);
    float H = diskScaleHeight(rr, uSpeak);
    // Moderate vertical slab for lens wraps
    if (rr > 1.16 && rr < 8.2 && abs(sampleP.y) < H * 4.0) {
      float vert = exp(-pow(sampleP.y / max(H * 1.15, 0.01), 2.0));
      float isco = 1.0 + 0.85 * exp(-pow((rr - 1.35) * 2.3, 2.0));
      accumulateDisk(sampleP, vel1, ro, uTime, uSpeak, vert * isco, stepLen, color, alpha, tr);
    }

    if (pos0.y * pos1.y < 0.0) {
      float th = pos0.y / (pos0.y - pos1.y + 1e-6);
      vec3 hit = mix(pos0, pos1, clamp(th, 0.0, 1.0));
      float Hr = diskScaleHeight(length(hit.xz), uSpeak);
      accumulateDisk(hit, vel1, ro, uTime, uSpeak, 1.05, max(stepLen, Hr * 0.95), color, alpha, tr);
    }

    pos = pos1;
    float sp = max(length(vel1), 0.75);
    vel = normalize(vel1) * sp;
  }

  float ndcR = distPx / uRadiusPx;
  // Screen-space event-horizon disk (opaque void — nothing shows through)
  float voidDisk = 1.0 - smoothstep(0.94, 1.035, ndcR);

  if (!hitHorizon) {
    vec3 bg = nebula(vel) * 0.55 + starfield(vel) * 0.35;
    float skim = exp(-pow((closestR - 1.45) * 3.8, 2.0));
    bg += vec3(0.886, 0.361, 0.133) * skim * 0.12;
    bg += vec3(0.929, 0.620, 0.400) * skim * 0.05;
    // Never paint background inside the silhouette
    bg *= 1.0 - voidDisk;
    color += tr * bg;
    alpha = max(alpha, tr * (0.12 + length(bg) * 0.4) * (1.0 - voidDisk));
  } else {
    // Captured rays: keep only front-disk light already accumulated; kill everything else
    float front = smoothstep(0.02, 0.16, alpha);
    color *= front;
  }

  // Opaque black core — full alpha so HUD/mesh behind cannot show through
  float diskSignal = smoothstep(0.035, 0.22, length(color));
  color = mix(color, color * diskSignal, voidDisk);
  color = mix(color, vec3(0.0), voidDisk * (1.0 - diskSignal));
  alpha = max(alpha, voidDisk);

  float lum = dot(color, vec3(0.25, 0.5, 0.25));
  // No bloom inside the void
  color += color * smoothstep(0.42, 1.5, lum) * 0.11 * (1.0 - voidDisk * 0.85);

  // No concentric fringe rings (Saturn / icon look)
  alpha *= mix(edgeFade, 1.0, voidDisk);
  color = max(color, vec3(0.0));
  color *= 1.2;
  color = clamp(color, 0.0, 2.5);
  color = color * (2.51 * color + 0.03) / (color * (2.43 * color + 0.59) + 0.14);
  // After tonemap, re-assert pure black void (tonemap can lift blacks)
  color = mix(color, vec3(0.0), voidDisk * (1.0 - smoothstep(0.02, 0.18, length(color))));
  alpha = max(alpha, voidDisk);

  gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
}
`;

export function createGargantua3DV1(canvas: HTMLCanvasElement): Gargantua3D {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
    premultipliedAlpha: false,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uSpeak: { value: 0 },
    uRadiusPx: { value: 80 },
    uCamTheta: { value: GARGANTUA_LOCK_V1.theta },
    uCamPhi: { value: GARGANTUA_LOCK_V1.phi },
    uCamDist: { value: GARGANTUA_LOCK_V1.dist },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  scene.add(quad);

  const orbit = {
    theta: GARGANTUA_LOCK_V1.theta,
    phi: GARGANTUA_LOCK_V1.phi,
    dist: GARGANTUA_LOCK_V1.dist,
    dragging: false,
    lastX: 0,
    lastY: 0,
    pointerId: -1,
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    orbit.dragging = true;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
    orbit.pointerId = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    canvas.style.cursor = 'grabbing';
  };
  const onMove = (e: PointerEvent) => {
    if (!orbit.dragging || e.pointerId !== orbit.pointerId) return;
    const dx = e.clientX - orbit.lastX;
    const dy = e.clientY - orbit.lastY;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
    orbit.theta -= dx * 0.0048;
    orbit.phi = Math.max(0.2, Math.min(2.9, orbit.phi - dy * 0.0038));
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== orbit.pointerId) return;
    orbit.dragging = false;
    orbit.pointerId = -1;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    canvas.style.cursor = 'grab';
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    orbit.dist = Math.max(4.2, Math.min(9.5, orbit.dist + e.deltaY * 0.0035));
  };
  const onDbl = (e: Event) => {
    e.preventDefault();
    orbit.theta = GARGANTUA_LOCK_V1.theta;
    orbit.phi = GARGANTUA_LOCK_V1.phi;
    orbit.dist = GARGANTUA_LOCK_V1.dist;
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDbl);
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';
  canvas.title = 'Gargantua — بکشید / اسکرول / دوبارکلیک ریست';

  let speak = 0;
  let viewRadius = 80;
  let disposed = false;
  let cssW = 1;

  return {
    setSize(w, h, dpr) {
      if (disposed) return;
      cssW = w;
      const rw = Math.max(1, Math.floor(w * dpr));
      const rh = Math.max(1, Math.floor(h * dpr));
      renderer.setPixelRatio(1);
      renderer.setSize(rw, rh, false);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      uniforms.uResolution.value.set(rw, rh);
      uniforms.uRadiusPx.value = viewRadius * dpr;
    },
    setViewRadius(cssPx) {
      viewRadius = Math.max(24, cssPx);
      const dpr = uniforms.uResolution.value.x / Math.max(1, cssW);
      uniforms.uRadiusPx.value = viewRadius * dpr;
    },
    setSpeak(v) {
      speak = Math.max(0, Math.min(1, v));
    },
    tick(tSec) {
      if (disposed) return;
      uniforms.uTime.value = tSec;
      uniforms.uSpeak.value = speak;
      uniforms.uCamTheta.value = orbit.theta;
      uniforms.uCamPhi.value = orbit.phi;
      uniforms.uCamDist.value = orbit.dist;
      renderer.render(scene, camera);
    },
    dispose() {
      disposed = true;
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDbl);
      mat.dispose();
      quad.geometry.dispose();
      renderer.dispose();
    },
  };
}
