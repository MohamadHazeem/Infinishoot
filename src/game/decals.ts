import * as THREE from 'three';
import { SpritePool, spriteTextures } from './fx';

/**
 * Short-lived ground marks drawn flat on the floor: footprints in sand and
 * snow, small scorch marks under explosions. A pooled ring buffer (the
 * oldest mark is reused when full); marks fade out at the end of their
 * life. Long-lived scars (craters, frost, goo) stay in scars.ts.
 */
export const decalTuning = {
  max: 260,
  footLife: 6,
  footAlpha: 0.5,
  scorchLife: 5,
  scorchAlpha: 0.4,
};

const FOOT = 0;
const SCORCH = 1;

/** Alpha of a mark `age` seconds into a `life`-second life: quick fade-in, hold, fade out over the last 40%. Pure, for tests. */
export function markAlpha(age: number, life: number, a0: number): number {
  if (age <= 0 || age >= life) return 0;
  const k = age / life;
  return a0 * Math.min(1, age * 12, (1 - k) / 0.4);
}

export class Decals {
  private pool: SpritePool;
  private n = 0;
  private next = 0;
  private x: Float32Array;
  private z: Float32Array;
  private size: Float32Array;
  private rot: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private a0: Float32Array;
  private frame: Uint8Array;
  private col: Float32Array;
  private c = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const max = decalTuning.max;
    this.x = new Float32Array(max);
    this.z = new Float32Array(max);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.frame = new Uint8Array(max);
    this.col = new Float32Array(max * 3);
    this.pool = new SpritePool(scene, { max, map: spriteTextures().marks, mode: 'flat', frames: 2, renderOrder: 0 });
  }

  private add(x: number, z: number, size: number, rot: number, life: number, a0: number, frame: number, color: THREE.ColorRepresentation): void {
    const i = this.next;
    this.next = (this.next + 1) % decalTuning.max;
    this.n = Math.min(decalTuning.max, this.n + 1);
    this.x[i] = x;
    this.z[i] = z;
    this.size[i] = size;
    this.rot[i] = rot;
    this.age[i] = 0;
    this.life[i] = life;
    this.a0[i] = a0;
    this.frame[i] = frame;
    this.c.set(color);
    this.col[i * 3] = this.c.r;
    this.col[i * 3 + 1] = this.c.g;
    this.col[i * 3 + 2] = this.c.b;
  }

  /** A footprint pointing along `heading` (radians, atan2(dz, dx)); `size` ~ foot length in metres. */
  foot(x: number, z: number, heading: number, size: number, color: THREE.ColorRepresentation, life = decalTuning.footLife): void {
    // The toe is at the top of the texture, which a flat sprite maps to world -Z before rotating by `rot`.
    this.add(x, z, size, -heading - Math.PI / 2, life, decalTuning.footAlpha, FOOT, color);
  }

  /** A small scorch mark that fades after a few seconds. */
  scorch(x: number, z: number, r: number, rand = Math.random): void {
    this.add(x, z, r * 2, rand() * Math.PI * 2, decalTuning.scorchLife * (0.8 + rand() * 0.4), decalTuning.scorchAlpha, SCORCH, '#2b2233');
  }

  clear(): void {
    this.n = this.next = 0;
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) this.age[i] += dt;
  }

  render(): void {
    const p = this.pool;
    p.begin();
    for (let i = 0; i < this.n; i++) {
      const a = markAlpha(this.age[i], this.life[i], this.a0[i]);
      if (a <= 0) continue;
      p.push(this.x[i], 0.025, this.z[i], this.size[i], this.col[i * 3], this.col[i * 3 + 1], this.col[i * 3 + 2], a, this.rot[i], this.frame[i]);
    }
    p.end();
  }
}
