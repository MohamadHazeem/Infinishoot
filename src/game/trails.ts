import * as THREE from 'three';
import { retroGlobals } from '../render/retroMaterial';

/**
 * Ribbon trails and electric arcs: glowing segments that always face the
 * camera, fade and taper over their life, drawn as one instanced mesh.
 *
 * Callers add a segment from where a thing was to where it is each frame
 * (discs, missiles, charge shots, rail spirals), so consecutive segments join
 * into a ribbon without the trail needing to know who owns it. That also
 * works on co-op clients, where weapon state is rebuilt from snapshots.
 * Arcs (lightning, chain zaps, shock crackle) are jagged, branching paths of
 * short-lived segments, re-rolled a few times a second so they flicker.
 *
 * The ring buffer is written in place and only the slots written this frame
 * are uploaded; fading happens in the shader against a clock that stops
 * while the game is frozen. Cosmetic and local: nothing here touches netcode.
 */
const MAX = 4096;

export const TrailStyle = {
  /** Coloured ribbon with a white-hot core. */
  Glow: 0,
  /** Flame: yellow to orange to deep red as it ages, flickering and widening. */
  Fire: 1,
  /** Electric: thin, white core, flickers on and off. */
  Electric: 2,
  /** Soft wide haze, no core (vapour, sparkle dust). */
  Soft: 3,
} as const;
export type TrailStyle = (typeof TrailStyle)[keyof typeof TrailStyle];

export const trailTuning = {
  /** Glow strength (multiplies colour). */
  intensity: 1,
  /** Branches per arc segment (chance) and how far they reach (fraction of the hop). */
  branchChance: 0.35,
  branchReach: 0.4,
  /** How often arcs are re-rolled (per second of game time). */
  arcRate: 30,
};

const vert = /* glsl */ `
in vec4 aA;
in vec4 aB;
in vec4 aC;
in vec2 aT;
uniform float uClock;
uniform float uFogNear;
uniform float uFogFar;
out vec3 vCol;
out float vSide;
out float vK;
out float vFog;
flat out int vStyle;
flat out float vSeed;
void main() {
  float k = (uClock - aT.x) / aT.y;
  vStyle = int(aC.w + 0.5);
  vSeed = fract(sin(aT.x * 91.7 + float(gl_InstanceID) * 12.9898) * 43758.5453);
  if (k < 0.0 || k >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float e = position.x;
  float side = position.y;
  vec3 dir = aB.xyz - aA.xyz;
  float dl = length(dir);
  vec3 dn = dl > 1e-5 ? dir / dl : vec3(0.0);
  vec3 P = mix(aA.xyz, aB.xyz, e);
  float w = mix(aA.w, aB.w, e);
  if (vStyle == 1) w *= 1.0 + k * 0.6;
  else if (vStyle == 3) w *= 1.0 + k * 1.4;
  else w *= 1.0 - k * 0.65;
  vec3 V = cameraPosition - P;
  vec3 sv = cross(dn, V);
  float sl = length(sv);
  sv = sl > 1e-5 ? sv / sl : vec3(1.0, 0.0, 0.0);
  // Overlap the ends a little so a chain of segments reads as one ribbon.
  P += dn * (e * 2.0 - 1.0) * w * 0.35;
  P += sv * side * w * 0.5;
  vCol = aC.rgb;
  vSide = side;
  vK = k;
  vec4 mv = viewMatrix * vec4(P, 1.0);
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const frag = /* glsl */ `
uniform float uClock;
uniform float uIntensity;
in vec3 vCol;
in float vSide;
in float vK;
in float vFog;
flat in int vStyle;
flat in float vSeed;
layout(location = 0) out vec4 outColor;
void main() {
  float x = abs(vSide);
  float body = 1.0 - x * x;
  float core = smoothstep(0.55, 0.0, x);
  float fade = 1.0 - vK;
  vec3 col;
  if (vStyle == 1) {
    // Flame: hot yellow core, the colour, then a deep red as it cools.
    vec3 hot = mix(vec3(1.0, 0.95, 0.55), vCol, smoothstep(0.0, 0.45, vK));
    col = mix(hot, vec3(0.55, 0.08, 0.06), smoothstep(0.45, 1.0, vK));
    float fl = 0.7 + 0.3 * sin(uClock * 40.0 + vSeed * 30.0);
    col = col * body * fl + vec3(1.0, 0.9, 0.6) * core * fade * 0.4;
    fade = fade * fade;
  } else if (vStyle == 2) {
    float on = step(0.25, fract(sin(floor(uClock * 24.0) * 7.31 + vSeed * 91.0) * 4375.85));
    col = vCol * body * 0.9 + vec3(1.0) * core * 1.2;
    fade *= on * 0.6 + 0.4;
  } else if (vStyle == 3) {
    col = vCol * body * body * 0.22;
    body = 0.0; // haze doesn't feed the bloom mask
  } else {
    col = vCol * body * 0.85 + vec3(1.0) * core * 0.3;
    fade *= 0.5 + 0.5 * fade;
  }
  float a = fade * (1.0 - vFog) * uIntensity;
  outColor = vec4(col * a, body * a * 0.35);
}
`;

const v3 = new THREE.Vector3();

class Trails {
  private mesh: THREE.Mesh | null = null;
  private aA = new Float32Array(MAX * 4);
  private aB = new Float32Array(MAX * 4);
  private aC = new Float32Array(MAX * 4);
  private aT = new Float32Array(MAX * 2);
  private attrs: THREE.InstancedBufferAttribute[] = [];
  private geo: THREE.InstancedBufferGeometry | null = null;
  private next = 0;
  private used = 0;
  /** Slots written since the last upload: `wn` slots from `w0` on (wrapping), or everything. */
  private w0 = 0;
  private wn = 0;
  private full = false;
  private clockU = { value: 0 };
  private colors = new Map<string, THREE.Color>();
  private tmp = new THREE.Color();
  /** Seconds of (unfrozen) game time; arcs and flicker key off it. */
  clock = 0;
  /** Off on LOW quality (settings), like the old streaks. */
  enabled = true;

  attach(scene: THREE.Scene): void {
    const g = new THREE.InstancedBufferGeometry();
    // A quad: x = end (0 tail, 1 head), y = side (-1, 1).
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (arr: Float32Array, size: number, name: string) => {
      const a = new THREE.InstancedBufferAttribute(arr, size).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      this.attrs.push(a);
    };
    mk(this.aA, 4, 'aA');
    mk(this.aB, 4, 'aB');
    mk(this.aC, 4, 'aC');
    mk(this.aT, 2, 'aT');
    // Never-written slots are born at -1e9 with life 1: always faded out.
    for (let i = 0; i < MAX; i++) {
      this.aT[i * 2] = -1e9;
      this.aT[i * 2 + 1] = 1;
    }
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uClock: this.clockU,
        uIntensity: { value: trailTuning.intensity },
        uFogNear: retroGlobals.uFogNear,
        uFogFar: retroGlobals.uFogFar,
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  private col(c: THREE.ColorRepresentation): THREE.Color {
    if (typeof c !== 'string') return this.tmp.set(c);
    let col = this.colors.get(c);
    if (!col) {
      col = new THREE.Color(c);
      if (this.colors.size < 256) this.colors.set(c, col);
    }
    return col;
  }

  /** A segment from (x0, y0, z0) to (x1, y1, z1), widths w0 -> w1, fading over `life` seconds. */
  seg(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w0: number, w1: number, color: THREE.ColorRepresentation, life: number, style: TrailStyle = TrailStyle.Glow): void {
    if (!this.enabled || !this.mesh) return;
    const i = this.next;
    this.next = (i + 1) % MAX;
    if (this.used < MAX) this.used++;
    if (this.wn === 0) this.w0 = i;
    this.wn++;
    const c = this.col(color);
    const o = i * 4;
    this.aA[o] = x0;
    this.aA[o + 1] = y0;
    this.aA[o + 2] = z0;
    this.aA[o + 3] = w0;
    this.aB[o] = x1;
    this.aB[o + 1] = y1;
    this.aB[o + 2] = z1;
    this.aB[o + 3] = w1;
    this.aC[o] = c.r;
    this.aC[o + 1] = c.g;
    this.aC[o + 2] = c.b;
    this.aC[o + 3] = style;
    this.aT[i * 2] = this.clock;
    this.aT[i * 2 + 1] = Math.max(1e-3, life);
  }

  /** A flat ribbon piece at height y (the old motion-streak call). */
  ribbon(x0: number, z0: number, x1: number, z1: number, y: number, width: number, color: THREE.ColorRepresentation, life: number, style: TrailStyle = TrailStyle.Glow): void {
    if ((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0) < 0.0025) return;
    this.seg(x0, y, z0, x1, y, z1, width, width, color, life, style);
  }

  /**
   * A jagged electric arc from A to B with random side branches. `jitter` is
   * the sideways wander (m); `rand` lets tests pass a seeded generator.
   */
  arc(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.ColorRepresentation, width: number, life: number, jitter = 0.45, branches = true, rand: () => number = Math.random): void {
    if (!this.enabled || !this.mesh) return;
    const n = arcPath(ARC, x0, y0, z0, x1, y1, z1, jitter, rand);
    for (let i = 0; i < n - 1; i++) {
      const o = i * 3;
      this.seg(ARC[o], ARC[o + 1], ARC[o + 2], ARC[o + 3], ARC[o + 4], ARC[o + 5], width, width, color, life, TrailStyle.Electric);
      // A soft coloured halo round the main bolt.
      if (branches) this.seg(ARC[o], ARC[o + 1], ARC[o + 2], ARC[o + 3], ARC[o + 4], ARC[o + 5], width * 3, width * 3, color, life, TrailStyle.Soft);
    }
    if (!branches) return;
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    for (let i = 1; i < n - 1; i++) {
      if (rand() > trailTuning.branchChance) continue;
      const o = i * 3;
      // Off to one side of the main direction, a short forked twig.
      v3.set(x1 - x0, 0, z1 - z0).normalize();
      const a = (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.7);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const reach = len * trailTuning.branchReach * (0.4 + rand() * 0.6);
      const bx = ARC[o] + (v3.x * ca - v3.z * sa) * reach;
      const bz = ARC[o + 2] + (v3.x * sa + v3.z * ca) * reach;
      const by = Math.max(0.3, ARC[o + 1] - rand() * 0.6);
      const m = arcPath(TWIG, ARC[o], ARC[o + 1], ARC[o + 2], bx, by, bz, jitter * 0.6, rand, 3);
      for (let k = 0; k < m - 1; k++) {
        const p = k * 3;
        const w = width * 0.55 * (1 - k / m);
        this.seg(TWIG[p], TWIG[p + 1], TWIG[p + 2], TWIG[p + 3], TWIG[p + 4], TWIG[p + 5], w, w * 0.6, color, life, TrailStyle.Electric);
      }
    }
  }

  /** Advance the fade clock by `dt` (0 while frozen) and upload what changed. */
  render(dt: number): void {
    this.clock += dt;
    this.clockU.value = this.clock;
    this.flush();
  }

  /** Upload the slots written since the last upload (call again late in the frame for pieces added after render()). */
  flush(): void {
    if (!this.geo) return;
    this.geo.instanceCount = this.used;
    if (this.wn === 0 && !this.full) return;
    const all = this.full || this.wn >= MAX;
    const end = this.w0 + this.wn;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      const s = a.itemSize;
      if (all) a.addUpdateRange(0, MAX * s);
      else if (end <= MAX) a.addUpdateRange(this.w0 * s, this.wn * s);
      else {
        a.addUpdateRange(this.w0 * s, (MAX - this.w0) * s);
        a.addUpdateRange(0, (end - MAX) * s);
      }
      a.needsUpdate = true;
    }
    this.wn = 0;
    this.full = false;
  }

  clear(): void {
    for (let i = 0; i < MAX; i++) this.aT[i * 2] = -1e9;
    this.used = this.next = 0;
    this.wn = 0;
    this.full = true;
    if (this.geo) this.geo.instanceCount = 0;
  }
}

const ARC = new Float32Array(3 * 16);
const TWIG = new Float32Array(3 * 8);

/**
 * Points of a jagged path from A to B into `out` (x, y, z triples): `steps`
 * pieces, interior points pushed sideways by up to `jitter` (more in the
 * middle). Returns the number of points. Pure apart from `rand`.
 */
export function arcPath(out: Float32Array, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, jitter: number, rand: () => number, steps = 0): number {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.min(out.length / 3 - 1, steps || Math.max(3, Math.min(10, Math.round(len / 0.7))));
  // Sideways unit vector on the ground.
  const sx = len > 1e-4 ? -(z1 - z0) / len : 1;
  const sz = len > 1e-4 ? (x1 - x0) / len : 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const mid = i === 0 || i === n ? 0 : Math.sin(t * Math.PI) * 0.6 + 0.4;
    const j = (rand() - 0.5) * 2 * jitter * mid;
    const o = i * 3;
    out[o] = x0 + (x1 - x0) * t + sx * j;
    out[o + 1] = y0 + (y1 - y0) * t + (i === 0 || i === n ? 0 : (rand() - 0.5) * jitter * 0.5);
    out[o + 2] = z0 + (z1 - z0) * t + sz * j;
  }
  return n + 1;
}

export const trails = new Trails();
