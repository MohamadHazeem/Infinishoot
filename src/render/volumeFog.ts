import * as THREE from 'three';
import { retroGlobals } from './retroMaterial';
import { MAX_LIGHTS } from './lights';

/**
 * Volumetric ground fog for dark stages (graphics lane): a few stacked
 * horizontal fog layers that follow the camera, with drifting pixel-stepped
 * density, lit from inside by the frame's dynamic lights (hero lanterns,
 * explosions, neon signs, muzzle flashes), so every light glows as a dome of
 * lit mist and legs and bullets wade through it. Light shafts are the
 * composite's radial scattering (src/render/graphicsPost.ts) on top.
 * One instanced draw (all layers), only when there is something to see:
 * night stages, Neon City, the eclipse (other lanes set `fogForce`).
 */
export const volumeFogTuning = {
  /** Layer count (MEDIUM+; LOW+ uses 2) and their heights (m). */
  layers: 3,
  bottom: 0.12,
  spacing: 0.26,
  /** Size of the fog sheet around the camera focus (m). */
  width: 70,
  depth: 56,
  /** Base density per layer, colour, drift. */
  density: 0.15,
  color: new THREE.Color('#29366f'),
  drift: 0.6,
  /** In-scattering: how strongly lights glow in the mist, and how far (x the light radius). */
  scatter: 0.35,
  /** The mist parts around the local hero (m), so it never hides you. */
  clear: 2.8,
  reach: 1.1,
};

/** Other lanes (eclipse, stealth night) can force the fog on: 0..1 (null = follow the stage). */
export const fogForce: { amount: number | null } = { amount: null };

const vert = /* glsl */ `
uniform float uFogNear;
uniform float uFogFar;
in vec2 aLayer; // height index 0..n-1, phase
out vec3 vWorld;
out float vFogDist;
out float vLayer;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vLayer = aLayer.x;
  vec4 mv = viewMatrix * wp;
  vFogDist = smoothstep(uFogNear, uFogFar, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const frag = /* glsl */ `
uniform vec4 uLightPos[MAX_LIGHTS];
uniform vec4 uLightCol[MAX_LIGHTS];
uniform int uLightCount;
uniform float uLightMax;
uniform float uTime;
uniform vec3 uVolColor;
uniform vec4 uVol; // amount, density, scatter, reach
uniform vec2 uVolDrift;
uniform vec3 uVolFocus; // x, z, half extent for the edge fade
uniform vec3 uVolClear; // hero x, z, clear radius
in vec3 vWorld;
in float vFogDist;
in float vLayer;
layout(location = 0) out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  // Chunky pixel-stepped wisps drifting with the wind, each layer its own offset.
  vec2 p = floor(vWorld.xz * 2.0) / 2.0;
  vec2 drift = uVolDrift * uTime * (1.0 + vLayer * 0.35);
  float n = noise(p * 0.11 + drift * 0.11 + vLayer * 7.3) * 0.65 + noise(p * 0.31 - drift * 0.2 + vLayer * 3.1) * 0.35;
  float dens = uVol.x * uVol.y * smoothstep(0.25, 0.85, n) * (1.0 - vLayer * 0.22);
  // Fade toward the sheet's edges so it never shows a border.
  vec2 e = abs(vWorld.xz - uVolFocus.xy) / uVolFocus.z;
  dens *= 1.0 - smoothstep(0.7, 1.0, max(e.x, e.y));
  dens *= smoothstep(uVolClear.z * 0.45, uVolClear.z, length(vWorld.xz - uVolClear.xy));
  // In-scattering: lights glow inside the mist (a lit dome around every light).
  vec3 lit = vec3(0.0);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= uLightCount) break;
    vec4 lp = uLightPos[i];
    vec3 dv = lp.xyz - vWorld;
    float r = lp.w * uVol.w;
    float a = 1.0 - dot(dv, dv) / (r * r);
    if (a <= 0.0) continue;
    a = a * a;
    a = floor(a * 5.0 + 0.5) / 5.0; // banded like the cel lighting
    lit += uLightCol[i].rgb * a;
  }
  float peak = max(lit.r, max(lit.g, lit.b));
  lit *= min(1.0, uLightMax / max(peak, 1e-4));
  vec3 col = uVolColor * dens + lit * uVol.z * (dens + 0.04 * uVol.x);
  float alpha = dens * (1.0 - vFogDist * 0.5);
  if (alpha < 0.003 && peak < 0.01) discard;
  // Premultiplied: the mist dims what's under it and adds its own glow.
  outColor = vec4(col * (1.0 - vFogDist * 0.5), alpha);
}
`;

export class VolumeFog {
  readonly mesh: THREE.InstancedMesh;
  private mat: THREE.ShaderMaterial;
  private m4 = new THREE.Matrix4();
  /** Current amount 0..1 (eased). */
  amount = 0;

  constructor(scene: THREE.Scene) {
    const max = 4;
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2);
    const layer = new Float32Array(max * 2);
    for (let i = 0; i < max; i++) {
      layer[i * 2] = i;
      layer[i * 2 + 1] = i * 1.7;
    }
    geo.setAttribute('aLayer', new THREE.InstancedBufferAttribute(layer, 2));
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vert,
      fragmentShader: frag,
      defines: { MAX_LIGHTS },
      uniforms: {
        uFogNear: retroGlobals.uFogNear,
        uFogFar: retroGlobals.uFogFar,
        uTime: retroGlobals.uTime,
        uLightPos: retroGlobals.uLightPos,
        uLightCol: retroGlobals.uLightCol,
        uLightCount: retroGlobals.uLightCount,
        uLightMax: retroGlobals.uLightMax,
        uVolColor: { value: volumeFogTuning.color.clone() },
        uVol: { value: new THREE.Vector4() },
        uVolDrift: { value: new THREE.Vector2(1, 0.3) },
        uVolFocus: { value: new THREE.Vector3() },
        uVolClear: { value: new THREE.Vector3() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6; // over the ground effects, before particles' late passes
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /**
   * `want` 0..1: how much fog this frame should have (night, Neon City, forced);
   * `layers` 0 = off (LOW). Fog colour follows the scene fog, darkened.
   */
  update(dt: number, want: number, layers: number, focusX: number, focusZ: number, zoom: number, fogColor: THREE.Color, windX: number, windZ: number): void {
    const T = volumeFogTuning;
    this.amount += (want - this.amount) * Math.min(1, dt * 1.2);
    if (this.amount < 0.01 || layers <= 0) {
      this.mesh.count = 0;
      return;
    }
    const n = Math.min(4, layers);
    const w = T.width * zoom;
    const d = T.depth * zoom;
    for (let i = 0; i < n; i++) {
      this.m4.makeScale(w, 1, d).setPosition(focusX, T.bottom + i * T.spacing, focusZ - d * 0.08);
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    const u = this.mat.uniforms;
    // Mist takes the fog's hue, deepened toward the night blue, so it reads on every biome.
    u.uVolColor.value.copy(fogColor).lerp(T.color, 0.5);
    u.uVol.value.set(this.amount, T.density * (3 / n), T.scatter, T.reach);
    const wl = Math.hypot(windX, windZ);
    u.uVolDrift.value.set(T.drift + (wl > 0.01 ? windX : 0), 0.25 * T.drift + (wl > 0.01 ? windZ : 0));
    u.uVolFocus.value.set(focusX, focusZ - d * 0.08, Math.min(w, d) * 0.5);
    u.uVolClear.value.set(focusX, focusZ, T.clear);
  }
}
