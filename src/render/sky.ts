import * as THREE from 'three';
import { retroGlobals } from './retroMaterial';
import type { Grade } from './postfx';

/**
 * The sky. The 3/4 top-down camera never sees the horizon, so the sky is
 * shown through what it does to the world:
 *  - a per-biome sky model (zenith/horizon gradient, sun, moon, stars) that
 *    drives the time-of-day light (midday -> golden hour -> sunset, see
 *    `timeOfDay`, applied by src/render/biomeLook.ts),
 *  - its reflection on the sea and the ponds (gradient, reflected clouds,
 *    sun glitter, and on night stages stars and the moon),
 *  - drifting cloud shadows on everything lit by the sun (a scrolling noise
 *    map sampled by every retro material, see retroMaterial.ts),
 *  - sun shafts slanting across the field at low sun (and faint moonbeams).
 * Everything is cosmetic and computed locally on every machine.
 */

export const skyTuning = {
  /** Cloud shadow map: metres per texture tile, drift (m/s), strength, coverage cut and edge softness. */
  cloudTile: 72,
  windX: 1.5,
  windZ: 0.6,
  cloudStrength: 0.55,
  cloudCut: 0.54,
  cloudSoft: 0.16,
  /** Height of the cloud layer (sets how far shadows slide with a low sun). */
  cloudHeight: 30,
  /** Rain: more cover (cut drops) and darker shadows. */
  rainCut: 0.2,
  /** Night clouds hide the moon: shadow strength multiplier. */
  nightClouds: 0.6,
  /** Sea / pond reflection strength (per biome multiplier below). */
  reflect: 0.6,
  /** Sun shafts: how many, peak opacity, from which time of day (0 midday .. 1 sunset). */
  shafts: 7,
  shaftAlpha: 0.32,
  shaftFrom: 0.3,
  moonbeamAlpha: 0.14,
  /** Sky light over the field: the glow of the sky toward the sun (up-screen) and the cool side opposite. Peak opacity by day, at sunset and at night. */
  hazeDay: 0.08,
  hazeSunset: 0.34,
  hazeNight: 0.14,
  /** Star density and twinkle in reflections (night). */
  stars: 1,
};

/** Test-link / debug overrides: time of day (0 midday .. 1 sunset, null = follow the stage clock). */
export const skyOverrides: { tod: number | null } = { tod: null };

type RGB = [number, number, number];

export interface SkyPalette {
  /** Midday sky, seen in reflections. */
  zenith: string;
  horizon: string;
  /** Golden hour sun (mid-stage). */
  goldSun: RGB;
  goldFog: string;
  /** Sunset (the final minute and the boss). */
  duskSun: RGB;
  duskSky: RGB;
  duskGround: RGB;
  duskFog: string;
  duskZenith: string;
  duskHorizon: string;
  /** Night reflections. */
  nightZenith: string;
  nightHorizon: string;
  /** Reflection strength on this biome's sea (0 = lava, no reflection). */
  reflect: number;
  /** Cloud colour in reflections. */
  cloud: string;
}

export const SKY_PALETTES: Record<string, SkyPalette> = {
  meadow: {
    zenith: '#3b7ff0',
    horizon: '#bfeaff',
    goldSun: [0.9, 0.72, 0.44],
    goldFog: '#ffe0a6',
    duskSun: [0.94, 0.5, 0.36],
    duskSky: [0.46, 0.34, 0.64],
    duskGround: [0.32, 0.2, 0.36],
    duskFog: '#f08a8c',
    duskZenith: '#4a3c9c',
    duskHorizon: '#ff9a6a',
    nightZenith: '#0a0f2a',
    nightHorizon: '#1d2b5c',
    reflect: 1,
    cloud: '#ffffff',
  },
  dunes: {
    zenith: '#3f86e8',
    horizon: '#ffe4bd',
    goldSun: [0.98, 0.7, 0.4],
    goldFog: '#ffd28c',
    duskSun: [1.0, 0.46, 0.3],
    duskSky: [0.52, 0.32, 0.56],
    duskGround: [0.38, 0.2, 0.3],
    duskFog: '#f2826a',
    duskZenith: '#5a3088',
    duskHorizon: '#ff8c4a',
    nightZenith: '#120c2a',
    nightHorizon: '#2e1f52',
    reflect: 1,
    cloud: '#fff2e0',
  },
  peaks: {
    zenith: '#4c8cf4',
    horizon: '#e4f4ff',
    goldSun: [0.88, 0.72, 0.6],
    goldFog: '#ffe6d6',
    duskSun: [0.9, 0.52, 0.56],
    duskSky: [0.42, 0.36, 0.7],
    duskGround: [0.3, 0.26, 0.46],
    duskFog: '#d496cc',
    duskZenith: '#3e3c9e',
    duskHorizon: '#ffa0b4',
    nightZenith: '#081028',
    nightHorizon: '#1c3060',
    reflect: 0.45,
    cloud: '#ffffff',
  },
  magma: {
    zenith: '#5a2e6e',
    horizon: '#ff8a5c',
    goldSun: [1.0, 0.58, 0.36],
    goldFog: '#d06070',
    duskSun: [1.0, 0.42, 0.3],
    duskSky: [0.44, 0.28, 0.56],
    duskGround: [0.52, 0.2, 0.24],
    duskFog: '#b03e66',
    duskZenith: '#3a1848',
    duskHorizon: '#ff5a3a',
    nightZenith: '#120818',
    nightHorizon: '#3a1430',
    reflect: 0,
    cloud: '#7a5a6a',
  },
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How far along golden hour and sunset are for a time of day `k` (0 midday, 1
 * sunset): the sun goes gold first (`gold` peaks around k 0.55), then the
 * sunset (`dusk`) takes over toward the end of the stage.
 */
export function sunsetWeights(k: number): { gold: number; dusk: number } {
  const c = Math.max(0, Math.min(1, k));
  return { gold: smooth(0.08, 0.55, c), dusk: smooth(0.5, 1, c) };
}

export interface TimeOfDayColors {
  sun: THREE.Color;
  sky: THREE.Color;
  ground: THREE.Color;
  fog: THREE.Color;
}

const tc = new THREE.Color();

/**
 * Day light colours for a biome at time of day `k`, written into `out`:
 * midday (the biome's own light) -> golden hour -> sunset. Night is blended
 * on top by biomeLook.
 */
export function timeOfDay(biomeId: string, day: { sun: RGB; sky: RGB; ground: RGB }, dayFog: string, k: number, out: TimeOfDayColors): TimeOfDayColors {
  const P = SKY_PALETTES[biomeId] ?? SKY_PALETTES.meadow;
  const { gold, dusk } = sunsetWeights(k);
  out.sun.setRGB(...day.sun).lerp(tc.setRGB(...P.goldSun), gold).lerp(tc.setRGB(...P.duskSun), dusk * 0.9);
  out.sky.setRGB(...day.sky).lerp(tc.setRGB(...P.goldSun).multiplyScalar(0.62), gold * 0.25).lerp(tc.setRGB(...P.duskSky), dusk * 0.85);
  out.ground.setRGB(...day.ground).lerp(tc.setRGB(...P.duskGround), dusk * 0.8);
  out.fog.set(dayFog).lerp(tc.set(P.goldFog), gold * 0.4).lerp(tc.set(P.duskFog), dusk * 0.7);
  return out;
}

/** Sunset colour grade, blended in with the sunset (warm highlights, violet shadows, a little more colour). */
export const SUNSET_GRADE: Grade = { lift: [0.035, 0.0, 0.05], gamma: [1, 0.98, 1], gain: [1.07, 0.98, 0.9], saturation: 1.14 };

/** The sun as the sky shows it (reflections, shafts): ahead of the camera (up-screen), sinking toward the horizon. */
export function skySunDir(k: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.max(0, Math.min(1, k));
  const elev = THREE.MathUtils.degToRad(62 - 52 * c);
  const az = THREE.MathUtils.degToRad(-100 + 25 * c); // around -z, a little to the right
  return out.set(Math.cos(elev) * Math.cos(az), Math.sin(elev), Math.cos(elev) * Math.sin(az)).normalize();
}

/** The moon on night stages (up-screen, to the left). */
export const MOON_DIR = new THREE.Vector3(-0.3, 0.36, -0.88).normalize();

/**
 * Tileable value-noise clouds (a few octaves, wrapped), `size` x `size`
 * bytes. Pure and deterministic, so it can be unit-tested.
 */
export function cloudNoise(size: number, seed = 1): Uint8Array {
  const out = new Uint8Array(size * size);
  const acc = new Float32Array(size * size);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  let amp = 1;
  let total = 0;
  for (const cells of [4, 8, 16, 32]) {
    if (cells > size) break;
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    const step = size / cells;
    for (let y = 0; y < size; y++) {
      const gy = y / step;
      const y0 = Math.floor(gy) % cells;
      const y1 = (y0 + 1) % cells;
      let fy = gy - Math.floor(gy);
      fy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < size; x++) {
        const gx = x / step;
        const x0 = Math.floor(gx) % cells;
        const x1 = (x0 + 1) % cells;
        let fx = gx - Math.floor(gx);
        fx = fx * fx * (3 - 2 * fx);
        const a = g[y0 * cells + x0] + (g[y0 * cells + x1] - g[y0 * cells + x0]) * fx;
        const b = g[y1 * cells + x0] + (g[y1 * cells + x1] - g[y1 * cells + x0]) * fx;
        acc[y * size + x] += (a + (b - a) * fy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < acc.length; i++) {
    lo = Math.min(lo, acc[i]);
    hi = Math.max(hi, acc[i]);
  }
  void total;
  for (let i = 0; i < acc.length; i++) out[i] = Math.round(((acc[i] - lo) / Math.max(1e-6, hi - lo)) * 255);
  return out;
}

let cloudTex: THREE.DataTexture | null = null;
/** The shared cloud map (created once, bound to every retro material through retroGlobals). */
export function cloudTexture(): THREE.DataTexture {
  if (cloudTex) return cloudTex;
  const N = 128;
  const tex = new THREE.DataTexture(cloudNoise(N, 7), N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  cloudTex = tex;
  retroGlobals.uCloudMap.value = tex;
  return tex;
}

// ------------------------------------------------------------------ reflections

const reflectVert = /* glsl */ `
uniform float uFogNear;
uniform float uFogFar;
out vec3 vWorld;
out float vFog;
out vec2 vUv;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = m * instanceMatrix;
  #endif
  vec4 wp = m * vec4(position, 1.0);
  vWorld = wp.xyz;
  vUv = uv;
  vec4 mv = viewMatrix * wp;
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const reflectFrag = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunCol;
uniform vec3 uSunVis;
uniform vec3 uMoonDir;
uniform vec3 uCloudCol;
uniform float uStars;
uniform float uMoon;
uniform float uAlpha;
uniform float uGlitter;
uniform float uSkyTime;
uniform float uDisc;
uniform sampler2D uCloudMap;
uniform vec4 uCloud;
uniform vec3 uCloudCut;
uniform vec3 uFogColor;
in vec3 vWorld;
in float vFog;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec3 V = normalize(vWorld - cameraPosition);
  // Waves tilt the mirror: flatten the reflected ray so the sky toward the horizon shows.
  vec2 w = vWorld.xz * 0.9;
  float wob = sin(w.x + uSkyTime * 1.3) * cos(w.y * 1.3 - uSkyTime * 0.9);
  vec3 R = normalize(vec3(V.x + wob * 0.03, -V.y * 0.3, V.z + wob * 0.03));
  float h = clamp(R.y, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(h, 0.7));
  // Clouds, where the reflected ray meets the cloud layer.
  vec2 cp = vWorld.xz + R.xz / max(R.y, 0.15) * uCloudCut.z * 0.35;
  float cn = texture(uCloudMap, cp * uCloud.z + uCloud.xy).r;
  float cl = smoothstep(uCloudCut.x - 0.05, uCloudCut.x + uCloudCut.y, cn);
  sky = mix(sky, uCloudCol, cl * 0.55);
  // Sun: a broad glow and a glitter path of sparkling wave crests.
  float sd = max(dot(R, uSunVis), 0.0);
  float glow = pow(sd, 5.0) * 0.6 + pow(sd, 40.0) * 0.9;
  vec2 cell = floor(vWorld.xz * 2.0);
  float tw = hash(cell + floor(uSkyTime * 3.0 + hash(cell) * 7.0));
  float glit = step(0.9, tw) * pow(sd, 2.0) * uGlitter;
  vec3 col = sky + uSunCol * (glow * (1.0 - cl * 0.7) + glit * 1.6);
  // Night: stars and the moon.
  if (uStars > 0.0) {
    vec2 sp = R.xz / max(R.y, 0.2) * 60.0;
    vec2 sc = floor(sp);
    float st = hash(sc);
    float twinkle = 0.55 + 0.45 * sin(uSkyTime * (2.0 + st * 5.0) + st * 40.0);
    float star = step(0.985, st) * step(length(fract(sp) - 0.5), 0.22) * twinkle;
    col += vec3(0.85, 0.9, 1.0) * star * uStars * (1.0 - cl);
    float md = dot(R, uMoonDir);
    float disc = smoothstep(uDisc - 0.0008, uDisc, md);
    float halo = pow(max(md, 0.0), 60.0) * 0.4;
    // A moon path: glints on the waves toward the moon.
    float path = step(0.88, tw) * pow(max(md, 0.0), 12.0);
    col += vec3(0.95, 0.95, 0.82) * (disc * 1.1 + halo + path) * uMoon;
  }
  // Fade at pond edges (vUv is the disc's 0..1 square) and into the fog.
  float edge = 1.0;
  #ifdef POND
    // Ponds keep more of their own water colour: a lighter touch of sky.
    edge = smoothstep(0.5, 0.36, length(vUv - 0.5)) * 0.6;
  #endif
  // Far water still mirrors the sky (it isn't simply fogged out), so the sunset glows on the sea.
  col = mix(col, uFogColor, vFog * 0.35);
  outColor = vec4(col, min(0.95, uAlpha * edge * (1.0 - vFog * 0.3) * (0.6 + 0.4 * (1.0 - h))));
}
`;

function reflectMaterial(pond: boolean, shared: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: reflectVert,
    fragmentShader: reflectFrag,
    defines: pond ? { POND: '' } : {},
    uniforms: {
      uFogNear: retroGlobals.uFogNear,
      uFogFar: retroGlobals.uFogFar,
      uFogColor: retroGlobals.uFogColor,
      uCloudMap: retroGlobals.uCloudMap,
      uCloud: retroGlobals.uCloud,
      uCloudCut: retroGlobals.uCloudCut,
      ...shared,
    },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    // Colour blends over the water; the bloom mask in alpha is left alone.
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

// ------------------------------------------------------------------ sky light (screen haze)

const hazeVert = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
const hazeFrag = /* glsl */ `
uniform vec3 uHazeTop;
uniform vec3 uHazeBottom;
uniform vec3 uHazeSun;
uniform vec4 uHaze; // top alpha, bottom alpha, sun spot x (0..1), sun spot alpha
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  // The far edge of the view (top) takes the sky's glow; the near edge a cool tint.
  float top = smoothstep(0.25, 1.0, vUv.y);
  float bottom = smoothstep(0.45, 0.0, vUv.y);
  vec2 d = (vUv - vec2(uHaze.z, 1.08)) * vec2(1.6, 1.0);
  float sun = exp(-dot(d, d) * 3.2);
  float a = top * uHaze.x + bottom * uHaze.y + sun * uHaze.w;
  vec3 col = (uHazeTop * top * uHaze.x + uHazeBottom * bottom * uHaze.y + uHazeSun * sun * uHaze.w) / max(a, 1e-4);
  outColor = vec4(col * clamp(a, 0.0, 0.6), 1.0);
}
`;

// ------------------------------------------------------------------ sun shafts

const shaftVert = /* glsl */ `
in vec4 aShaft; // alpha, phase, -, -
out vec2 vUv;
out float vA;
out float vPhase;
void main() {
  vUv = uv;
  vA = aShaft.x;
  vPhase = aShaft.y;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const shaftFrag = /* glsl */ `
uniform vec3 uShaftCol;
uniform float uSkyTime;
in vec2 vUv;
in float vA;
in float vPhase;
layout(location = 0) out vec4 outColor;
void main() {
  // Soft across, fading at the ground and toward the sky, with slow ripples along.
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  across = across * across;
  float along = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
  float rip = 0.75 + 0.25 * sin(vUv.y * 9.0 - uSkyTime * 0.8 + vPhase);
  outColor = vec4(uShaftCol * across * along * rip * vA, 1.0);
}
`;

interface Shaft {
  x: number;
  z: number;
  age: number;
  life: number;
  w: number;
  len: number;
  phase: number;
}

export interface SkyFrame {
  biomeId: string;
  /** Time of day 0 (midday) .. 1 (sunset). */
  dayK: number;
  night: number;
  rain: number;
  /** Seconds to advance (0 while frozen). */
  dt: number;
  camera: THREE.PerspectiveCamera;
  /** Where the camera looks (shafts gather around it). */
  focusX: number;
  focusZ: number;
  /** Quality rung (0 = LOW: no shafts, no stars or glitter). */
  quality: number;
  /** Water ponds of the stage (decor and hazards), for their reflections. */
  ponds: readonly { x: number; z: number; r: number; kind: string }[];
}

const MAX_PONDS = 24;
const MAX_SHAFTS = 12;

/** Sea and pond reflections, cloud-shadow uniforms and sun shafts. */
export class SkyFx {
  private readonly uni = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunCol: { value: new THREE.Color() },
    uSunVis: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: MOON_DIR.clone() },
    uCloudCol: { value: new THREE.Color() },
    uStars: { value: 0 },
    uMoon: { value: 0 },
    uAlpha: { value: 0.5 },
    uGlitter: { value: 1 },
    uSkyTime: { value: 0 },
    uDisc: { value: Math.cos(0.02) },
  };
  private sea: THREE.Mesh;
  private ponds: THREE.InstancedMesh;
  private pondSrc: readonly unknown[] | null = null;
  private shaftMesh: THREE.InstancedMesh;
  private shaftAttr: THREE.InstancedBufferAttribute;
  private shaftCol = { value: new THREE.Color() };
  private shafts: Shaft[] = [];
  private haze: THREE.Mesh;
  private hazeU = {
    uHazeTop: { value: new THREE.Color() },
    uHazeBottom: { value: new THREE.Color() },
    uHazeSun: { value: new THREE.Color() },
    uHaze: { value: new THREE.Vector4() },
  };
  private time = 0;
  private offX = 0;
  private offZ = 0;
  private m4 = new THREE.Matrix4();
  private vx = new THREE.Vector3();
  private vy = new THREE.Vector3();
  private vz = new THREE.Vector3();
  private vc = new THREE.Vector3();
  private sunVis = new THREE.Vector3();
  private c1 = new THREE.Color();
  private c2 = new THREE.Color();

  constructor(scene: THREE.Scene) {
    cloudTexture();
    const seaGeo = new THREE.PlaneGeometry(400, 400, 1, 1).rotateX(-Math.PI / 2);
    this.sea = new THREE.Mesh(seaGeo, reflectMaterial(false, this.uni));
    this.sea.position.y = -0.395;
    this.sea.frustumCulled = false;
    this.sea.renderOrder = -1;
    scene.add(this.sea);

    this.ponds = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), reflectMaterial(true, this.uni), MAX_PONDS);
    this.ponds.count = 0;
    this.ponds.frustumCulled = false;
    scene.add(this.ponds);

    const sg = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    this.shaftAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHAFTS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('aShaft', this.shaftAttr);
    const smat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: shaftVert,
      fragmentShader: shaftFrag,
      uniforms: { uShaftCol: this.shaftCol, uSkyTime: this.uni.uSkyTime },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.shaftMesh = new THREE.InstancedMesh(sg, smat, MAX_SHAFTS);
    this.shaftMesh.count = 0;
    this.shaftMesh.frustumCulled = false;
    this.shaftMesh.renderOrder = 5;
    scene.add(this.shaftMesh);

    // Sky light: one full-screen triangle drawn right after the opaque world.
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.haze = new THREE.Mesh(
      hg,
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: hazeVert,
        fragmentShader: hazeFrag,
        uniforms: this.hazeU,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        // Screen blend: the sky's light brightens and tints, never muddies.
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneMinusDstColorFactor,
        blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
      }),
    );
    this.haze.frustumCulled = false;
    this.haze.renderOrder = -10;
    scene.add(this.haze);
  }

  update(f: SkyFrame): void {
    if (f.quality <= 0) {
      retroGlobals.uCloud.value.w = 0;
      this.sea.visible = this.ponds.visible = this.haze.visible = false;
      this.shaftMesh.count = 0;
      return;
    }
    const T = skyTuning;
    const P = SKY_PALETTES[f.biomeId] ?? SKY_PALETTES.meadow;
    const k = skyOverrides.tod ?? f.dayK;
    const n = f.night;
    this.time += f.dt;
    this.uni.uSkyTime.value = this.time;

    // --- Cloud shadows (every retro material reads these).
    this.offX += (T.windX * f.dt) / T.cloudTile;
    this.offZ += (T.windZ * f.dt) / T.cloudTile;
    this.offX %= 1;
    this.offZ %= 1;
    const cl = retroGlobals.uCloud.value;
    cl.set(-this.offX, -this.offZ, 1 / T.cloudTile, T.cloudStrength * (1 - n * (1 - T.nightClouds)) * (1 + f.rain * 0.4));
    if (f.biomeId === 'magma') cl.w *= 0.8; // ash clouds, the lava lights the rest
    retroGlobals.uCloudCut.value.set(T.cloudCut - f.rain * T.rainCut, T.cloudSoft, T.cloudHeight);

    // --- Sky colours for the reflections.
    const { gold, dusk } = sunsetWeights(k);
    skySunDir(k, this.sunVis);
    this.uni.uSunVis.value.copy(this.sunVis);
    const z = this.uni.uZenith.value.set(P.zenith).lerp(this.c1.set(P.duskZenith), dusk * 0.9);
    const hz = this.uni.uHorizon.value.set(P.horizon).lerp(this.c1.setRGB(...P.goldSun), gold * 0.35).lerp(this.c1.set(P.duskHorizon), dusk);
    z.lerp(this.c1.set(P.nightZenith), n);
    hz.lerp(this.c1.set(P.nightHorizon), n);
    // Rain greys the sky.
    if (f.rain > 0) {
      this.c2.setRGB(0.42, 0.46, 0.55);
      z.lerp(this.c2, f.rain * 0.6);
      hz.lerp(this.c2, f.rain * 0.5);
    }
    this.uni.uSunCol.value.setRGB(1, 0.95, 0.8).lerp(this.c1.setRGB(...P.goldSun), gold).lerp(this.c1.setRGB(...P.duskSun), dusk).multiplyScalar((1 - n) * (1 - f.rain * 0.8));
    this.uni.uCloudCol.value.set(P.cloud).lerp(this.c1.setRGB(...P.goldSun), gold * 0.3).lerp(this.c1.set(P.duskHorizon), dusk * 0.8).lerp(this.c1.set('#2a3050'), n * 0.85);
    const low = f.quality <= 0;
    this.uni.uStars.value = low ? 0 : n * T.stars * (1 - f.rain);
    this.uni.uMoon.value = n * (1 - f.rain * 0.8);
    this.uni.uGlitter.value = low ? 0 : 1;
    const a = T.reflect * P.reflect;
    this.uni.uAlpha.value = a * (1 + 0.45 * dusk + 0.3 * n);
    this.sea.visible = a > 0.01;

    // --- Pond reflections (rebuilt when the stage's patches change).
    if (f.ponds !== this.pondSrc) {
      this.pondSrc = f.ponds;
      let c = 0;
      for (const p of f.ponds) {
        if (p.kind !== 'water' || c >= MAX_PONDS) continue;
        this.m4.makeScale(p.r * 0.92, 1, p.r * 0.92).setPosition(p.x, 0.034, p.z);
        this.ponds.setMatrixAt(c++, this.m4);
      }
      this.ponds.count = c;
      this.ponds.instanceMatrix.needsUpdate = true;
    }
    this.ponds.visible = this.ponds.count > 0 && a > 0.01;

    this.updateHaze(f, P, n, gold, dusk);
    this.updateShafts(f, k, n, gold, dusk);
  }

  private updateHaze(f: SkyFrame, P: SkyPalette, n: number, gold: number, dusk: number): void {
    const T = skyTuning;
    const u = this.hazeU;
    const day = 1 - n;
    // Top: the horizon glow toward the sun (gold, then sunset orange); bottom: the cool sky behind you.
    u.uHazeTop.value.set(P.horizon).lerp(this.c1.setRGB(...P.goldSun), gold * 0.6).lerp(this.c1.set(P.duskHorizon), dusk).lerp(this.c1.set(P.nightHorizon), n);
    u.uHazeBottom.value.set(P.zenith).lerp(this.c1.set(P.duskZenith), dusk).lerp(this.c1.set(P.nightZenith), n);
    u.uHazeSun.value.setRGB(...P.goldSun).lerp(this.c1.setRGB(...P.duskSun), dusk).lerp(this.c1.setRGB(0.75, 0.82, 1), n);
    const warm = Math.max(gold * 0.45, dusk);
    const top = (T.hazeDay + (T.hazeSunset - T.hazeDay) * warm) * day + T.hazeNight * n;
    const rainK = 1 - f.rain * 0.6;
    u.uHaze.value.set(top * rainK, (0.03 + 0.12 * dusk) * day * rainK + 0.08 * n, n > 0.5 ? 0.3 : 0.62, (0.05 + 0.3 * warm * day + 0.12 * n) * rainK);
    this.haze.visible = top > 0.003;
  }

  private updateShafts(f: SkyFrame, k: number, n: number, gold: number, dusk: number): void {
    const T = skyTuning;
    const P = SKY_PALETTES[f.biomeId] ?? SKY_PALETTES.meadow;
    const day = smooth(T.shaftFrom, 0.85, k) * (1 - n) * (1 - f.rain);
    const moon = n * (1 - f.rain);
    const strength = Math.max(day * T.shaftAlpha, moon * T.moonbeamAlpha);
    const want = f.quality <= 0 || strength < 0.004 ? 0 : Math.min(MAX_SHAFTS, T.shafts);
    // Colour: warm gold to sunset orange by day, cool silver by moonlight.
    const sc = this.shaftCol.value.setRGB(...P.goldSun).lerp(this.c1.setRGB(...P.duskSun), dusk).lerp(this.c1.setRGB(0.55, 0.65, 1), n);
    void gold;
    sc.multiplyScalar(strength);
    const dir = n > 0.5 ? this.vc.copy(MOON_DIR) : this.vc.copy(this.sunVis);
    // Shafts lean toward the light; keep them steep enough to stay on screen.
    if (dir.y < 0.45) {
      dir.y = 0.45;
      dir.normalize();
    }
    while (this.shafts.length < want) this.shafts.push(this.newShaft(f, true));
    if (this.shafts.length > want) this.shafts.length = want;
    const cam = f.camera.position;
    const attr = this.shaftAttr.array as Float32Array;
    for (let i = 0; i < this.shafts.length; i++) {
      const s = this.shafts[i];
      s.age += f.dt;
      s.x += T.windX * 0.3 * f.dt;
      s.z += T.windZ * 0.3 * f.dt;
      if (s.age >= s.life || Math.abs(s.x - f.focusX) > 30 || Math.abs(s.z - f.focusZ) > 26) Object.assign(s, this.newShaft(f, false));
      const life = Math.sin((Math.PI * s.age) / s.life);
      // Basis: y along the light, x across facing the camera.
      this.vy.copy(dir);
      this.vz.set(cam.x - s.x, cam.y, cam.z - s.z).normalize();
      this.vx.crossVectors(this.vy, this.vz).normalize();
      this.vz.crossVectors(this.vx, this.vy);
      this.m4.makeBasis(this.vx.multiplyScalar(s.w), this.vy.multiplyScalar(s.len), this.vz);
      this.m4.setPosition(s.x, 0, s.z);
      this.shaftMesh.setMatrixAt(i, this.m4);
      attr[i * 4] = life * life;
      attr[i * 4 + 1] = s.phase;
    }
    this.shaftMesh.count = this.shafts.length;
    this.shaftMesh.visible = this.shafts.length > 0;
    if (this.shafts.length) {
      this.shaftMesh.instanceMatrix.needsUpdate = true;
      this.shaftAttr.needsUpdate = true;
    }
  }

  private newShaft(f: SkyFrame, first: boolean): Shaft {
    const life = 7 + Math.random() * 6;
    return {
      x: f.focusX + (Math.random() - 0.5) * 44,
      z: f.focusZ + (Math.random() - 0.5) * 30 - 4,
      age: first ? Math.random() * life : 0,
      life,
      w: 1.6 + Math.random() * 3.2,
      len: 16 + Math.random() * 10,
      phase: Math.random() * 6.28,
    };
  }
}
