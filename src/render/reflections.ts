import * as THREE from 'three';
import { retroGlobals } from './retroMaterial';
import { MAX_LIGHTS } from './lights';

/**
 * Reflective water and puddles (graphics lane). The dynamic lights of the
 * frame (explosions, muzzle flashes, bullets, neon signs, lanterns, lava,
 * the portal: everything src/render/lights.ts picked) are mirrored in the
 * water in real time: for each water pixel the mirrored light's image is
 * where the line from the camera to the light's reflection (under the water
 * plane) crosses the surface, drawn as a glint stretched along the view
 * (the camera never yaws, so that is always screen-vertical) and broken up
 * by ripples. Cheap: one extra transparent draw per water kind, a loop over
 * at most MAX_LIGHTS lights per water pixel only.
 *
 *  - Ponds (src/render/surfaces.ts water patches) and the sea near the shore.
 *  - Puddles: wet patches on Neon City's roofs and on rainy stages, which also
 *    darken the ground and mirror a little sky.
 *
 * `createMirrorMaterial()` and `mirrorUniforms` are exported so other water
 * (the WORLD lane's flood water) can reuse it: put a mesh at the water height
 * with this material and set `uWaterY`.
 */
export const reflectTuning = {
  /** Glint strength, size (m, plus a share of the light's radius) and stretch along the view. */
  strength: 1.15,
  size: 0.55,
  sizePerRadius: 0.06,
  stretch: 3.2,
  /** Ripple wobble (m) and speed. */
  ripple: 0.22,
  rippleSpeed: 1.6,
  /** Puddles: how much they darken the ground, how much sky they mirror. */
  puddleDark: 0.32,
  puddleSky: 0.34,
  /** Puddles per stage on Neon City / in rain, and their size range (m). */
  puddles: 90,
  rainPuddles: 60,
  puddleMin: 0.9,
  puddleMax: 2.4,
};

export const mirrorUniforms = {
  uMirror: { value: 1 },
  uMirrorSize: { value: new THREE.Vector3(0.55, 0.06, 3.2) },
  uRipple: { value: new THREE.Vector2(0.22, 1.6) },
  uPuddle: { value: new THREE.Vector2(0.32, 0.22) },
  uPuddleSky: { value: new THREE.Color('#5a6a9a') },
};

const vert = /* glsl */ `
uniform float uFogNear;
uniform float uFogFar;
out vec3 vWorld;
out vec2 vUv;
out float vFog;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  #ifdef USE_INSTANCING
    wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  #endif
  vWorld = wp.xyz;
  vUv = uv;
  vec4 mv = viewMatrix * wp;
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const frag = /* glsl */ `
uniform vec4 uLightPos[MAX_LIGHTS];
uniform vec4 uLightCol[MAX_LIGHTS];
uniform int uLightCount;
uniform float uLightMax;
uniform float uTime;
uniform float uMirror;
uniform vec3 uMirrorSize; // base size, size per light radius, stretch along the view
uniform vec2 uRipple;     // wobble (m), speed
uniform vec2 uPuddle;     // darkening, sky mirror
uniform vec3 uPuddleSky;
uniform float uWaterY;
uniform float uNight;
in vec3 vWorld;
in vec2 vUv;
in float vFog;
layout(location = 0) out vec4 outColor;

void main() {
  float edge = 1.0;
  #ifdef PUDDLE
    // Blobby, pixel-stepped puddle edge inside the disc (vUv is the disc's 0..1 square).
    vec2 q = vUv - 0.5;
    float ang = atan(q.y, q.x);
    float r = length(q) * 2.0;
    float lim = 0.78 + 0.12 * sin(ang * 3.0 + vWorld.x) + 0.08 * sin(ang * 5.0 - vWorld.z);
    if (r > lim) discard;
    edge = smoothstep(lim, lim - 0.25, r);
  #endif
  #ifdef POND
    edge = smoothstep(0.5, 0.36, length(vUv - 0.5));
  #endif
  // Ripples move the mirror point (the reflection wobbles and breaks up).
  vec2 w = vWorld.xz;
  float t = uTime * uRipple.y;
  vec2 wob = vec2(sin(w.y * 2.3 + t * 1.7) + 0.5 * sin(w.x * 4.1 - t * 2.3), cos(w.x * 2.1 - t * 1.3) + 0.5 * cos(w.y * 3.7 + t * 2.9)) * uRipple.x;
  vec2 p = floor((w + wob) * 6.0) / 6.0; // pixel steps
  vec3 C = cameraPosition;
  vec3 glints = vec3(0.0);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= uLightCount) break;
    vec4 lp = uLightPos[i];
    // The light's mirror image under the water plane...
    float ly = 2.0 * uWaterY - lp.y;
    // ...seen from the camera crosses the surface here.
    float k = (C.y - uWaterY) / max(C.y - ly, 1e-3);
    vec2 hit = C.xz + (lp.xz - C.xz) * k;
    vec2 d = p - hit;
    d.y /= uMirrorSize.z; // stretched toward and away from the camera
    float s = uMirrorSize.x + uMirrorSize.y * lp.w;
    float g = exp(-dot(d, d) / (s * s));
    // Streak shimmer: bands across the stretched glint.
    g *= 0.75 + 0.25 * sin((p.y - hit.y) * 9.0 - t * 3.0);
    glints += uLightCol[i].rgb * g;
  }
  float peak = max(glints.r, max(glints.g, glints.b));
  glints *= min(1.0, uLightMax * 1.4 / max(peak, 1e-4));
  glints *= uMirror * edge * (1.0 - vFog * 0.7);
  float lum = max(glints.r, max(glints.g, glints.b));
  #ifdef PUDDLE
    // A wet patch: darker ground, a faint sky/neon sheen, plus the glints (premultiplied).
    float a = uPuddle.x * edge;
    vec3 sky = uPuddleSky * uPuddle.y * edge * (1.0 - 0.5 * uNight);
    outColor = vec4(sky + glints, a);
  #else
    outColor = vec4(glints, 0.0);
  #endif
  if (lum < 0.002 && outColor.a < 0.002) discard;
}
`;

/**
 * The mirror material. `kind`: 'pond' (glints only, soft disc edge), 'sea'
 * (glints only, any plane) or 'puddle' (dark wet patch + sheen + glints).
 * Premultiplied blending: colour = src + dst x (1 - src alpha); the bloom
 * mask in the target's alpha is left alone.
 */
export function createMirrorMaterial(kind: 'pond' | 'sea' | 'puddle', waterY: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vert,
    fragmentShader: frag,
    defines: { MAX_LIGHTS, ...(kind === 'pond' ? { POND: '' } : kind === 'puddle' ? { PUDDLE: '' } : {}) },
    uniforms: {
      uFogNear: retroGlobals.uFogNear,
      uFogFar: retroGlobals.uFogFar,
      uTime: retroGlobals.uTime,
      uNight: retroGlobals.uNight,
      uLightPos: retroGlobals.uLightPos,
      uLightCol: retroGlobals.uLightCol,
      uLightCount: retroGlobals.uLightCount,
      uLightMax: retroGlobals.uLightMax,
      uWaterY: { value: waterY },
      ...mirrorUniforms,
    },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -6,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

/** Seeded puddle spots: (x, z, r) triples on open ground. Pure (tests). */
export function puddleSpots(seed: number, count: number, half: number, blocked: (x: number, z: number, r: number) => boolean): Float32Array {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const T = reflectTuning;
  const out: number[] = [];
  for (let tries = 0; tries < count * 6 && out.length < count * 3; tries++) {
    const x = (rand() * 2 - 1) * (half - 4);
    const z = (rand() * 2 - 1) * (half - 4);
    const r = T.puddleMin + rand() * (T.puddleMax - T.puddleMin);
    if (blocked(x, z, r)) continue;
    out.push(x, z, r);
  }
  return new Float32Array(out);
}

const MAX_PONDS = 24;
const MAX_PUDDLES = 120;

/** The mirror overlays for one scene: ponds, the sea near the shore, puddles. */
export class WaterMirror {
  private ponds: THREE.InstancedMesh;
  private sea: THREE.Mesh;
  private puddles: THREE.InstancedMesh;
  private pondSrc: unknown = null;
  private puddleKey = '';
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    const disc = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
    this.ponds = new THREE.InstancedMesh(disc, createMirrorMaterial('pond', 0.04), MAX_PONDS);
    this.ponds.count = 0;
    this.ponds.frustumCulled = false;
    this.ponds.renderOrder = 2;
    scene.add(this.ponds);
    // The sea: a ring of plane around the island (the island hides its middle).
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(260, 260, 1, 1).rotateX(-Math.PI / 2), createMirrorMaterial('sea', -0.39));
    this.sea.position.y = -0.39;
    this.sea.frustumCulled = false;
    this.sea.renderOrder = 2;
    scene.add(this.sea);
    const pg = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.puddles = new THREE.InstancedMesh(pg, createMirrorMaterial('puddle', 0.03), MAX_PUDDLES);
    this.puddles.count = 0;
    this.puddles.frustumCulled = false;
    this.puddles.renderOrder = 2;
    scene.add(this.puddles);
  }

  get puddleCount(): number {
    return this.puddles.count;
  }

  /**
   * Per frame. `on` = reflections allowed (quality); `sea` = the sea mirrors
   * (not a lava sea); `ponds` = the stage's surface patches; `puddles` = how
   * many wet patches this stage wants (0 = none) with a seeded layout.
   */
  update(o: {
    on: boolean;
    sea: boolean;
    ponds: readonly { x: number; z: number; r: number; kind: string }[];
    puddles: number;
    seed: number;
    half: number;
    /** Builds the 'is this spot taken' test (only called when the puddle layout changes). */
    blocked: () => (x: number, z: number, r: number) => boolean;
    skyColor: THREE.Color;
  }): void {
    const T = reflectTuning;
    mirrorUniforms.uMirror.value = T.strength;
    mirrorUniforms.uMirrorSize.value.set(T.size, T.sizePerRadius, T.stretch);
    mirrorUniforms.uRipple.value.set(T.ripple, T.rippleSpeed);
    mirrorUniforms.uPuddle.value.set(T.puddleDark, T.puddleSky);
    mirrorUniforms.uPuddleSky.value.copy(o.skyColor);
    const lights = retroGlobals.uLightCount.value > 0;
    if (o.ponds !== this.pondSrc) {
      this.pondSrc = o.ponds;
      let c = 0;
      for (const p of o.ponds) {
        if (p.kind !== 'water' || c >= MAX_PONDS) continue;
        this.m4.makeScale(p.r * 0.92, 1, p.r * 0.92).setPosition(p.x, 0.04, p.z);
        this.ponds.setMatrixAt(c++, this.m4);
      }
      this.ponds.count = c;
      this.ponds.instanceMatrix.needsUpdate = true;
    }
    this.ponds.visible = o.on && lights && this.ponds.count > 0;
    this.sea.visible = o.on && lights && o.sea;
    const key = o.puddles > 0 ? `${o.seed}:${o.puddles}:${o.half}` : '';
    if (key !== this.puddleKey) {
      this.puddleKey = key;
      const spots = o.puddles > 0 ? puddleSpots(o.seed, Math.min(MAX_PUDDLES, o.puddles), o.half, o.blocked()) : new Float32Array(0);
      let c = 0;
      for (let i = 0; i + 2 < spots.length && c < MAX_PUDDLES; i += 3) {
        const r = spots[i + 2];
        this.q.setFromAxisAngle(this.up, (i * 1.7) % Math.PI);
        this.m4.compose(this.v.set(spots[i], 0.03, spots[i + 1]), this.q, this.s.set(r, 1, r * (0.65 + ((i * 0.37) % 0.35))));
        this.puddles.setMatrixAt(c++, this.m4);
      }
      this.puddles.count = c;
      this.puddles.instanceMatrix.needsUpdate = true;
    }
    // Puddles stay (wet ground) on every rung; their glints need lights.
    this.puddles.visible = o.puddles > 0 && this.puddles.count > 0;
  }
}
