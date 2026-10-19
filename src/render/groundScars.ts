import * as THREE from 'three';
import { retroGlobals } from './retroMaterial';

/**
 * Persistent battle damage on the ground: one scar map per stage.
 *
 * The map is an RGBA byte texture over the whole arena (about 0.23 m per
 * texel at 512): R scorch, G heat (glowing lava cracks), B frost, A crater
 * depth. Big explosions stamp craters and scorch, frost novas stamp frozen
 * patches, and on Magma Isle craters crack open into lava that cools over
 * time. Stamps take the max with what is there, so a spot that's blown up
 * ten times is no darker than one that's blown up once (the ground stays
 * readable under heavy explosive builds), and the field keeps its battle
 * history for the stage. A slow sweep fades everything; when scarred ground
 * goes over the budget the sweep fades faster, so the oldest (faintest)
 * marks go first. One flat overlay mesh draws it (one draw call), and only
 * the rows that changed are uploaded.
 */

export const scarTuning = {
  /** Map resolution (texels per side) and the half-size of the area it covers (m). */
  size: 512,
  extent: 60,
  /** Darkness of scorch and crater bowls (max overlay alpha), and of the crater rims. */
  scorchAlpha: 0.5,
  craterAlpha: 0.6,
  /** Fade per second, as a fraction of full strength. Scorch and craters last most of a stage. */
  scorchFade: 1 / 260,
  craterFade: 1 / 300,
  heatFade: 1 / 5,
  heatFadeMagma: 1 / 22,
  frostFade: 1 / 45,
  /** Seconds for the fade sweep to visit every row once. */
  sweep: 2,
  /** Scarred fraction of the map (scorch or crater above ~10%) before fading speeds up... */
  budget: 0.1,
  /** ...by up to this factor at twice the budget. */
  overBudget: 8,
};

export type ScarKind = 'scorch' | 'crater' | 'frost' | 'lava';

const hash = (x: number, y: number) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * The scar data (pure, no GPU): stamping, the fade sweep and the coverage
 * budget. `dirty` row spans record what changed since the last flush.
 */
export class ScarMap {
  readonly data: Uint8Array;
  readonly n: number;
  readonly extent: number;
  /** Changed span per row (min > max = clean). */
  readonly dirtyMin: Int16Array;
  readonly dirtyMax: Int16Array;
  /** Highest value in each row (0 = empty, skipped by the sweep). */
  private rowMax: Uint8Array;
  private sweepRow = 0;
  private sweepAcc = 0;
  /** Per-channel fade carried between visits (fractional units). */
  private carry = new Float32Array(4);
  private step = new Uint8Array(4);
  /** Texels counted as scarred in the sweep in progress / the last full sweep. */
  private covCount = 0;
  coverage = 0;
  /** Magma stages: lava cracks cool slowly. */
  magma = false;

  constructor(n = scarTuning.size, extent = scarTuning.extent) {
    this.n = n;
    this.extent = extent;
    this.data = new Uint8Array(n * n * 4);
    this.dirtyMin = new Int16Array(n).fill(n);
    this.dirtyMax = new Int16Array(n).fill(-1);
    this.rowMax = new Uint8Array(n);
  }

  clear(): void {
    this.data.fill(0);
    this.rowMax.fill(0);
    this.dirtyMin.fill(this.n);
    this.dirtyMax.fill(-1);
    this.coverage = this.covCount = 0;
    this.sweepRow = 0;
    this.carry.fill(0);
  }

  /** World metres to texel coordinates. */
  texel(x: number, z: number): [number, number] {
    const k = this.n / (this.extent * 2);
    return [(x + this.extent) * k, (z + this.extent) * k];
  }

  /** Channel value (0..1) at a world point (tests and debugging). */
  sample(x: number, z: number, ch: 0 | 1 | 2 | 3): number {
    const [tx, ty] = this.texel(x, z);
    const ix = Math.floor(tx);
    const iy = Math.floor(ty);
    if (ix < 0 || iy < 0 || ix >= this.n || iy >= this.n) return 0;
    return this.data[(iy * this.n + ix) * 4 + ch] / 255;
  }

  /** Leave a mark of `kind` with radius `r` (m) at (x, z). `strength` 0..1 scales it. */
  stamp(kind: ScarKind, x: number, z: number, r: number, strength = 1): void {
    if (!(r > 0.05)) return;
    const n = this.n;
    const k = n / (this.extent * 2);
    // Scorch reaches a bit past a crater's bowl; frost patches are ragged.
    const reach = kind === 'crater' ? r * 1.35 : r * 1.15;
    const cx = (x + this.extent) * k;
    const cy = (z + this.extent) * k;
    const R = reach * k;
    const x0 = Math.max(0, Math.floor(cx - R));
    const x1 = Math.min(n - 1, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R));
    const y1 = Math.min(n - 1, Math.ceil(cy + R));
    if (x0 > x1 || y0 > y1) return;
    const rt = r * k;
    const d = this.data;
    const s = Math.max(0, Math.min(1, strength));
    const heatK = this.magma ? 1 : 0.55;
    for (let ty = y0; ty <= y1; ty++) {
      let touched = false;
      for (let tx = x0; tx <= x1; tx++) {
        const dx = tx + 0.5 - cx;
        const dy = ty + 0.5 - cy;
        // Ragged pixel edge: jitter the distance per texel.
        const jit = (hash(tx, ty) - 0.5) * 0.28;
        const q = Math.sqrt(dx * dx + dy * dy) / rt + jit;
        if (q >= reach / r) continue;
        const o = (ty * n + tx) * 4;
        let sc = 0;
        let ht = 0;
        let fr = 0;
        let cr = 0;
        if (kind === 'crater') {
          cr = Math.max(0, 1 - q);
          sc = Math.min(1, Math.max(0, 1.3 - q * 0.9));
          ht = q < 0.6 ? Math.min(1, (0.7 - q) * 1.6) * heatK : 0;
        } else if (kind === 'scorch') {
          sc = Math.max(0, 1 - q * q * 0.8);
          ht = q < 0.4 ? Math.min(1, (0.5 - q) * 1.6) * heatK * 0.7 : 0;
        } else if (kind === 'lava') {
          sc = Math.max(0, 1 - q * 0.7);
          ht = Math.max(0, 1.1 - q);
        } else {
          fr = Math.min(1, Math.max(0, (1.05 - q) * 1.6));
        }
        if (max(d, o, sc * s, ht * s, fr * s, cr * s)) touched = true;
      }
      if (touched) {
        if (x0 < this.dirtyMin[ty]) this.dirtyMin[ty] = x0;
        if (x1 > this.dirtyMax[ty]) this.dirtyMax[ty] = x1;
        let m = this.rowMax[ty];
        for (let tx = x0; tx <= x1; tx++) {
          const o = (ty * n + tx) * 4;
          m = Math.max(m, d[o], d[o + 1], d[o + 2], d[o + 3]);
        }
        this.rowMax[ty] = m;
      }
    }
  }

  /** Advance the fade sweep by `dt` seconds (visits a slice of rows). */
  fade(dt: number): void {
    if (dt <= 0) return;
    const T = scarTuning;
    const n = this.n;
    this.sweepAcc += (dt / T.sweep) * n;
    let rows = Math.floor(this.sweepAcc);
    if (rows <= 0) return;
    this.sweepAcc -= rows;
    rows = Math.min(rows, n);
    const d = this.data;
    for (let r = 0; r < rows; r++) {
      const y = this.sweepRow;
      if (y === 0) {
        // A new pass: work out this pass's fade steps (with the over-budget boost).
        this.coverage = this.covCount / (n * n);
        this.covCount = 0;
        const over = Math.max(0, Math.min(1, this.coverage / T.budget - 1));
        const boost = 1 + (T.overBudget - 1) * over;
        const rates = [T.scorchFade * boost, this.magma ? T.heatFadeMagma : T.heatFade, T.frostFade, T.craterFade * boost];
        for (let c = 0; c < 4; c++) {
          this.carry[c] += rates[c] * T.sweep * 255;
          this.step[c] = Math.min(255, Math.floor(this.carry[c]));
          this.carry[c] -= this.step[c];
        }
      }
      this.sweepRow = (y + 1) % n;
      if (this.rowMax[y] === 0) continue;
      let m = 0;
      let lo = n;
      let hi = -1;
      const s0 = this.step[0];
      const s1 = this.step[1];
      const s2 = this.step[2];
      const s3 = this.step[3];
      for (let x = 0, o = y * n * 4; x < n; x++, o += 4) {
        const a = d[o];
        const b = d[o + 1];
        const c = d[o + 2];
        const e = d[o + 3];
        if ((a | b | c | e) === 0) continue;
        const na = a > s0 ? a - s0 : 0;
        const nb = b > s1 ? b - s1 : 0;
        const nc = c > s2 ? c - s2 : 0;
        const ne = e > s3 ? e - s3 : 0;
        if (na !== a || nb !== b || nc !== c || ne !== e) {
          d[o] = na;
          d[o + 1] = nb;
          d[o + 2] = nc;
          d[o + 3] = ne;
          if (x < lo) lo = x;
          hi = x;
        }
        if (na > 25 || ne > 25) this.covCount++;
        m = Math.max(m, na, nb, nc, ne);
      }
      this.rowMax[y] = m;
      if (hi >= 0) {
        if (lo < this.dirtyMin[y]) this.dirtyMin[y] = lo;
        if (hi > this.dirtyMax[y]) this.dirtyMax[y] = hi;
      }
    }
  }

  /** Hand every dirty row span to `each(row, x0, x1)` and mark the map clean. */
  flush(each: (row: number, x0: number, x1: number) => void): number {
    let rows = 0;
    for (let y = 0; y < this.n; y++) {
      if (this.dirtyMax[y] < 0) continue;
      each(y, this.dirtyMin[y], this.dirtyMax[y]);
      this.dirtyMin[y] = this.n;
      this.dirtyMax[y] = -1;
      rows++;
    }
    return rows;
  }
}

/** Raise the four channels at byte offset `o` to at least the given 0..1 values. True if anything changed. */
function max(d: Uint8Array, o: number, r: number, g: number, b: number, a: number): boolean {
  let ch = false;
  const R = Math.round(r * 255);
  const G = Math.round(g * 255);
  const B = Math.round(b * 255);
  const A = Math.round(a * 255);
  if (R > d[o]) {
    d[o] = R;
    ch = true;
  }
  if (G > d[o + 1]) {
    d[o + 1] = G;
    ch = true;
  }
  if (B > d[o + 2]) {
    d[o + 2] = B;
    ch = true;
  }
  if (A > d[o + 3]) {
    d[o + 3] = A;
    ch = true;
  }
  return ch;
}

/** Tileable crack pattern (cell borders of a jittered grid): 1 on a crack, 0 elsewhere. Pure. */
export function crackPattern(size: number, cells: number, seed = 3): Uint8Array {
  const out = new Uint8Array(size * size);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) {
    px[i] = rnd();
    py[i] = rnd();
  }
  const step = size / cells;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x + 0.5) / step;
      const gy = (y + 0.5) / step;
      const cx = Math.floor(gx);
      const cy = Math.floor(gy);
      let d1 = 9;
      let d2 = 9;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const ix = (((cx + ox) % cells) + cells) % cells;
          const iy = (((cy + oy) % cells) + cells) % cells;
          const fx = cx + ox + px[iy * cells + ix] - gx;
          const fy = cy + oy + py[iy * cells + ix] - gy;
          const dd = Math.sqrt(fx * fx + fy * fy);
          if (dd < d1) {
            d2 = d1;
            d1 = dd;
          } else if (dd < d2) d2 = dd;
        }
      }
      out[y * size + x] = d2 - d1 < 0.09 ? 255 : 0;
    }
  }
  return out;
}

const vert = /* glsl */ `
uniform float uFogNear;
uniform float uFogFar;
out vec3 vWorld;
out float vFog;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const frag = /* glsl */ `
uniform sampler2D uScar;
uniform sampler2D uCrack;
uniform float uExtent;
uniform float uTime;
uniform float uScorchA;
uniform float uCraterA;
uniform vec3 uScorchCol;
uniform vec3 uRimCol;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform float uNight;
uniform sampler2D uCloudMap;
uniform vec4 uCloud;
uniform vec3 uCloudCut;
in vec3 vWorld;
in float vFog;
layout(location = 0) out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = vWorld.xz / (uExtent * 2.0) + 0.5;
  vec4 s = texture(uScar, uv);
  if (s.r + s.g + s.b + s.a < 0.004) discard;
  float scorch = s.r;
  float heat = s.g;
  float frost = s.b;
  float crater = s.a;
  // Light for the lit bits (crater rims, ice): sky ambient plus the sun, under the cloud shadows.
  float sun = max(uSunDir.y, 0.0);
  if (uCloud.w > 0.0) {
    vec2 cp = vWorld.xz + uCloudCut.z * uSunDir.xz / max(uSunDir.y, 0.25);
    sun *= 1.0 - uCloud.w * smoothstep(uCloudCut.x, uCloudCut.x + uCloudCut.y, texture(uCloudMap, cp * uCloud.z + uCloud.xy).r);
  }
  vec3 light = uSkyColor + uSunColor * sun;
  float crack = texture(uCrack, vWorld.xz / 5.0).r;

  // Scorch and the crater bowl darken; the crater rim is a lighter ring of thrown-up dirt.
  float bowl = smoothstep(0.25, 0.75, crater);
  float rim = smoothstep(0.02, 0.1, crater) * (1.0 - smoothstep(0.2, 0.34, crater));
  vec3 col = uScorchCol;
  float a = max(smoothstep(0.0, 1.0, scorch) * uScorchA, bowl * uCraterA);
  col = mix(col, uRimCol * light, rim * 0.85);
  a = max(a, rim * 0.5);
  // Dark cracks in the crater bowl.
  float cr = crack * smoothstep(0.4, 0.75, crater);
  col = mix(col, vec3(0.06, 0.03, 0.08), cr * 0.8);
  a = max(a, cr * 0.7);
  // Heat: the cracks glow, white-hot to orange to deep red as they cool, with a slow pulse.
  float pulse = 0.82 + 0.18 * sin(uTime * 2.6 + vWorld.x * 1.7 + vWorld.z * 1.1);
  float h = heat * pulse;
  vec3 lava = mix(vec3(0.75, 0.12, 0.08), mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.92, 0.45), smoothstep(0.55, 0.95, h)), smoothstep(0.1, 0.5, h));
  float lv = crack * smoothstep(0.06, 0.35, heat);
  float ember = smoothstep(0.35, 1.0, heat) * 0.3;
  col = mix(col, lava, max(lv, ember));
  a = max(a, max(lv, ember * 0.8));
  // Frost: pale ice, lit, with glints that come and go.
  float fr = smoothstep(0.04, 0.35, frost);
  vec2 cell = floor(vWorld.xz * 3.0);
  float tw = step(0.965, hash(cell + floor(uTime * 1.5 + hash(cell) * 9.0)));
  vec3 ice = vec3(0.74, 0.9, 1.0) * light + vec3(0.6, 0.8, 1.0) * crack * 0.25 + tw * 0.8;
  float fa = fr * (0.55 + 0.25 * frost);
  col = mix(col, ice, fa / max(a + fa, 0.001));
  a = max(a, fa);
  col = mix(col, uFogColor, vFog);
  outColor = vec4(col, a);
}
`;

/** The GPU side: the map as a texture plus the overlay that draws it. */
export class GroundScars {
  readonly map: ScarMap;
  private tex: THREE.DataTexture;
  private mesh: THREE.Mesh;
  private time = { value: 0 };
  private full = true;

  constructor(scene: THREE.Scene) {
    const T = scarTuning;
    this.map = new ScarMap(T.size, T.extent);
    const n = this.map.n;
    this.tex = new THREE.DataTexture(this.map.data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    const crackN = 64;
    const crack = new THREE.DataTexture(crackPattern(crackN, 5), crackN, crackN, THREE.RedFormat, THREE.UnsignedByteType);
    crack.wrapS = crack.wrapT = THREE.RepeatWrapping;
    crack.magFilter = crack.minFilter = THREE.NearestFilter;
    crack.generateMipmaps = false;
    crack.unpackAlignment = 1;
    crack.needsUpdate = true;
    const g = retroGlobals;
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uScar: { value: this.tex },
        uCrack: { value: crack },
        uExtent: { value: T.extent },
        uTime: this.time,
        uScorchA: { value: T.scorchAlpha },
        uCraterA: { value: T.craterAlpha },
        uScorchCol: { value: new THREE.Color('#2b2233') },
        uRimCol: { value: new THREE.Color('#c8a07a') },
        uFogNear: g.uFogNear,
        uFogFar: g.uFogFar,
        uFogColor: g.uFogColor,
        uSunColor: g.uSunColor,
        uSunDir: g.uSunDir,
        uSkyColor: g.uSkyColor,
        uNight: g.uNight,
        uCloudMap: g.uCloudMap,
        uCloud: g.uCloud,
        uCloudCut: g.uCloudCut,
      },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      // Blend the colour; leave the bloom mask (alpha) alone.
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(T.extent * 2, T.extent * 2).rotateX(-Math.PI / 2), mat);
    this.mesh.position.y = 0.022;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    scene.add(this.mesh);
  }

  set magma(v: boolean) {
    this.map.magma = v;
  }

  stamp(kind: ScarKind, x: number, z: number, r: number, strength = 1): void {
    this.map.stamp(kind, x, z, r, strength);
  }

  clear(): void {
    this.map.clear();
    this.full = true;
  }

  /** Fade, then upload what changed (only the dirty row spans). */
  render(dt: number): void {
    this.time.value += dt;
    this.map.fade(dt);
    const tex = this.tex;
    if (this.full) {
      this.full = false;
      this.map.flush(() => {});
      tex.clearUpdateRanges();
      tex.needsUpdate = true;
      return;
    }
    const n = this.map.n;
    const rows = this.map.flush((y, x0, x1) => tex.addUpdateRange((y * n + x0) * 4, (x1 - x0 + 1) * 4));
    if (rows > 0) tex.needsUpdate = true;
  }
}
