import * as THREE from 'three';
import { commit } from '../render/instancing';

/**
 * Ground scars that linger: scorch marks from explosions, frost patches
 * from novas, craters from bombs and slams, goo splats from jellies. A ring
 * buffer of flat pixel-art splats; each fades and shrinks away over the end
 * of its life.
 */
const MAX = 220;

export const SCAR_COLORS = {
  scorch: '#2b2233',
  frost: '#bfefff',
  crater: '#3d3046',
} as const;

/**
 * Readability lane: explosive builds used to carpet the floor (scorch stayed
 * 10 s at 0.8 opacity). Life multipliers and peak opacity per kind; craters
 * (bombs, slams, boss deaths) keep most of their life so big hits still mark the arena.
 */
export const scarTuning = {
  scorchLife: 0.5,
  scorchAlpha: 0.55,
  craterLife: 1,
  craterAlpha: 0.8,
  /** Frost patches and goo splats. */
  otherLife: 0.6,
  otherAlpha: 0.65,
  /** Share of the life (at the end) spent fading out and shrinking. */
  fade: 0.45,
};

/** Life multiplier and peak opacity for a scar of this colour. Pure, for tests. */
export function scarLook(color: string): [life: number, alpha: number] {
  const T = scarTuning;
  if (color === SCAR_COLORS.scorch) return [T.scorchLife, T.scorchAlpha];
  if (color === SCAR_COLORS.crater) return [T.craterLife, T.craterAlpha];
  return [T.otherLife, T.otherAlpha];
}

/** 0..1 presence of a scar `age` seconds into a `life`-second life (pop in, hold, fade out over the last `fade` share). Pure, for tests. */
export function scarFade(age: number, life: number): number {
  const left = life - age;
  if (left <= 0) return 0;
  return Math.min(1, age * 10, left / (life * scarTuning.fade));
}

export class Scars {
  private mesh: THREE.InstancedMesh;
  private x = new Float32Array(MAX);
  private z = new Float32Array(MAX);
  private r = new Float32Array(MAX);
  private rot = new Float32Array(MAX);
  private age = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private a0 = new Float32Array(MAX);
  private alpha: THREE.InstancedBufferAttribute;
  private next = 0;
  private used = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private c = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({
      map: splatTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    // Per-instance opacity (each scar fades on its own).
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float scarAlpha;\nvarying float vScarAlpha;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvScarAlpha = scarAlpha;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vScarAlpha;').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vScarAlpha;');
    };
    const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('scarAlpha', this.alpha);
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.setColorAt(0, this.c.set('#ffffff'));
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 0;
    scene.add(this.mesh);
  }

  add(x: number, z: number, r: number, color: string, life = 14): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.used = Math.min(MAX, this.used + 1);
    this.x[i] = x;
    this.z[i] = z;
    this.r[i] = r;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.age[i] = 0;
    const [lifeMul, a0] = scarLook(color);
    this.life[i] = life * lifeMul;
    this.a0[i] = a0;
    this.mesh.setColorAt(i, this.c.set(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    this.used = this.next = 0;
    this.mesh.count = 0;
  }

  render(dt: number): void {
    const n = this.used;
    const al = this.alpha.array as Float32Array;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      // Pop in fast, then fade and shrink out over the end of life.
      const k = scarFade(this.age[i], this.life[i]);
      al[i] = this.a0[i] * k;
      this.q.setFromAxisAngle(this.up, this.rot[i]);
      const r = this.r[i] * (0.6 + 0.4 * k);
      this.m4.compose(this.v.set(this.x[i], 0.02, this.z[i]), this.q, this.s.set(r, 1, r));
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.count = n;
    commit(this.mesh.instanceMatrix, n);
    commit(this.alpha, n);
  }
}

/** A chunky 32x32 splat: a noisy disc with a few satellite blobs, nearest-filtered. */
function splatTexture(): THREE.Texture {
  const N = 32;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(N, N);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lobes = Array.from({ length: 7 }, () => ({ a: rnd() * Math.PI * 2, k: 0.75 + rnd() * 0.3 }));
  const blobs = Array.from({ length: 4 }, () => {
    const a = rnd() * Math.PI * 2;
    return { x: 16 + Math.cos(a) * 13, y: 16 + Math.sin(a) * 13, r: 1.5 + rnd() * 1.5 };
  });
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - 16;
      const dy = y + 0.5 - 16;
      const d = Math.hypot(dx, dy) / 16;
      const a = Math.atan2(dy, dx);
      let edge = 0.7;
      for (const l of lobes) edge += 0.06 * Math.cos(a - l.a) * l.k;
      let alpha = d < edge ? (d < edge * 0.65 ? 1 : 0.7) : 0;
      for (const b of blobs) if (Math.hypot(x + 0.5 - b.x, y + 0.5 - b.y) < b.r) alpha = 0.7;
      // Dither the outer ring for a pixel-art edge.
      if (alpha === 0.7 && (x + y) % 2 === 0) alpha = 0.45;
      const o = (y * N + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(alpha * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}
