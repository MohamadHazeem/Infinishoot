import * as THREE from 'three';
import { commit, instanceMatrix } from '../render/instancing';
import { GroundScars, type ScarKind } from '../render/groundScars';

/**
 * Ground scars. Scorch, craters and frost go into the stage's persistent
 * scar map (src/render/groundScars.ts): they merge instead of piling up as
 * dark blobs, last most of the stage and fade oldest-first over a budget.
 * Anything else (goo splats from jellies, a boss's burning ground) is a
 * short-lived coloured splat: a ring buffer of flat pixel-art splats that
 * shrink away over the end of their life.
 */
const MAX = 160;

/** How strongly a persistent scar of each kind is stamped (the `life` a caller passes hints at how big a deal it was). */
export const scarKindTuning = {
  /** Radius multiplier per kind. */
  scorchR: 1.15,
  craterR: 1.1,
  frostR: 1.0,
};

export const SCAR_COLORS = {
  scorch: '#2b2233',
  frost: '#bfefff',
  crater: '#3d3046',
} as const;

export class Scars {
  private mesh: THREE.InstancedMesh;
  private x = new Float32Array(MAX);
  private z = new Float32Array(MAX);
  private r = new Float32Array(MAX);
  private rot = new Float32Array(MAX);
  private age = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private next = 0;
  private used = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private c = new THREE.Color();
  /** The persistent scar map. */
  readonly ground: GroundScars;

  constructor(scene: THREE.Scene) {
    this.ground = new GroundScars(scene);
    const mat = new THREE.MeshBasicMaterial({
      map: splatTexture(),
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), mat, MAX);
    this.mesh.setColorAt(0, this.c.set('#ffffff'));
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 0;
    scene.add(this.mesh);
  }

  add(x: number, z: number, r: number, color: string, life = 14): void {
    const kind = scarKind(color);
    if (kind) {
      const T = scarKindTuning;
      const k = kind === 'crater' ? T.craterR : kind === 'frost' ? T.frostR : T.scorchR;
      this.ground.stamp(kind, x, z, r * k, Math.min(1, 0.55 + life / 30));
      return;
    }
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.used = Math.min(MAX, this.used + 1);
    this.x[i] = x;
    this.z[i] = z;
    this.r[i] = r;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.age[i] = 0;
    this.life[i] = life;
    this.mesh.setColorAt(i, this.c.set(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    this.used = this.next = 0;
    this.mesh.count = 0;
    this.ground.clear();
  }

  render(dt: number): void {
    this.ground.render(dt);
    const n = this.used;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      const left = this.life[i] - this.age[i];
      // Pop in fast, shrink out over the last 25% of life.
      const k = left <= 0 ? 0 : Math.min(1, this.age[i] * 10, left / (this.life[i] * 0.25));
      this.q.setFromAxisAngle(this.up, this.rot[i]);
      const r = this.r[i] * k;
      this.m4.compose(this.v.set(this.x[i], 0.02, this.z[i]), this.q, this.s.set(r, 1, r));
      instanceMatrix(this.mesh, i, this.m4);
    }
    this.mesh.count = n;
    commit(this.mesh.instanceMatrix, n);
  }
}

/** Which persistent kind a scar colour is (null = a short-lived coloured splat). */
export function scarKind(color: string): ScarKind | null {
  return color === SCAR_COLORS.scorch ? 'scorch' : color === SCAR_COLORS.crater ? 'crater' : color === SCAR_COLORS.frost ? 'frost' : null;
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
