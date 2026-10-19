import { noiseFor, type NoiseGovernor } from '../render/noiseGovernor';
import * as THREE from 'three';
import { createRetroMaterial } from '../render/retroMaterial';
import { commit } from '../render/instancing';
import { renderQuality } from '../render/quality';
import { SpritePool, spriteTextures } from './fx';
import { Debris } from './debris';
import { Decals } from './decals';

/**
 * Pooled chunky 3D particles (little spinning cubes), one InstancedMesh.
 * Used for sparks, death pops, dash trails, dust.
 */
const MAX = 2048;

export interface BurstOptions {
  count: number;
  color: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation; // random mix between color and color2
  speed: [number, number];
  size: [number, number];
  life: [number, number];
  up?: number; // extra upward velocity
  gravity?: number;
  drag?: number;
  /** Bias direction (x, z) and cone spread in radians; omit for all directions. */
  dir?: { x: number; z: number; spread: number };
  /** Billowing smoke puffs left behind (explosions). Also leaves a short scorch mark unless `scorch` is 0. */
  smoke?: number;
  /** Chunky debris pieces in color/color2 that bounce and settle (deaths, broken barrels). */
  debris?: number;
  /** Bright sparks that fall and bounce. */
  sparks?: number;
  /** A ring of soft dust puffs in `color` along the ground (slams, impacts). */
  dust?: number;
  /** Scorch mark radius for smoke bursts (default from the burst speed); 0 = none. */
  scorch?: number;
  /** An electric arc from the burst to this point (x, z) at the burst's height (chain zaps; drawn by systems/sky.ts). */
  arc?: [number, number];
}

/** Quality knobs for the world effects (low preset thins them out). */
export const worldFxTuning = {
  smokeLife: [1.4, 2.4] as [number, number],
  smokeRise: 1.1,
  dustLife: [0.45, 0.85] as [number, number],
  sparkGravity: 24,
  /** Global count multiplier for smoke, dust, sparks and debris (quality preset). */
  amount: 1,
};

const PUFFS = 420;
const SPARKS = 320;

/**
 * Soft round puffs (smoke and dust) and glowing sparks, simulated here and
 * drawn as camera-facing sprites. Cosmetic and local.
 */
export class SoftFx {
  private puffs: SpritePool;
  private glow: SpritePool;
  // Puffs
  private n = 0;
  private x = new Float32Array(PUFFS);
  private y = new Float32Array(PUFFS);
  private z = new Float32Array(PUFFS);
  private vx = new Float32Array(PUFFS);
  private vy = new Float32Array(PUFFS);
  private vz = new Float32Array(PUFFS);
  private age = new Float32Array(PUFFS);
  private life = new Float32Array(PUFFS);
  private s0 = new Float32Array(PUFFS);
  private s1 = new Float32Array(PUFFS);
  private a0 = new Float32Array(PUFFS);
  private rise = new Float32Array(PUFFS);
  private rot = new Float32Array(PUFFS);
  private col = new Float32Array(PUFFS * 3);
  // Sparks
  private sn = 0;
  private sx = new Float32Array(SPARKS);
  private sy = new Float32Array(SPARKS);
  private sz = new Float32Array(SPARKS);
  private svx = new Float32Array(SPARKS);
  private svy = new Float32Array(SPARKS);
  private svz = new Float32Array(SPARKS);
  private sAge = new Float32Array(SPARKS);
  private sLife = new Float32Array(SPARKS);
  private sSize = new Float32Array(SPARKS);
  private sCol = new Float32Array(SPARKS * 3);
  private c = new THREE.Color();

  private noise: NoiseGovernor;

  constructor(scene: THREE.Scene) {
    this.noise = noiseFor(scene);
    const art = spriteTextures();
    this.puffs = new SpritePool(scene, { max: PUFFS, map: art.puff, mode: 'billboard', renderOrder: 3 });
    this.glow = new SpritePool(scene, { max: SPARKS, map: art.puff, mode: 'billboard', additive: true, renderOrder: 4 });
  }

  private addPuff(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, a0: number, rise: number, color: THREE.ColorRepresentation, rand: () => number): void {
    // Full: drop the oldest (slot 0 is as good as any; puffs are short-lived).
    const i = this.n < PUFFS ? this.n++ : Math.floor(rand() * PUFFS);
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.a0[i] = a0;
    this.rise[i] = rise;
    this.rot[i] = rand() * Math.PI * 2;
    this.c.set(color);
    this.col[i * 3] = this.c.r;
    this.col[i * 3 + 1] = this.c.g;
    this.col[i * 3 + 2] = this.c.b;
  }

  /** Billowing smoke: puffs drift out, rise, swell and fade. `size` ~ explosion radius. */
  smoke(x: number, y: number, z: number, count: number, size = 1, rand = Math.random, color: THREE.ColorRepresentation = '#dcd8ec'): void {
    if (!renderQuality.worldEffects) return;
    const t = worldFxTuning;
    const n = this.noise.take('smoke', Math.round(count * t.amount));
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2;
      const sp = (0.4 + rand() * 1.0) * size;
      const dark = rand() < 0.3;
      this.addPuff(
        x + Math.cos(a) * 0.3 * size,
        y + rand() * 0.4,
        z + Math.sin(a) * 0.3 * size,
        Math.cos(a) * sp,
        0.3 + rand() * 0.6,
        Math.sin(a) * sp,
        t.smokeLife[0] + rand() * (t.smokeLife[1] - t.smokeLife[0]),
        (0.4 + rand() * 0.3) * size,
        (1.0 + rand() * 0.6) * size,
        0.75,
        t.smokeRise * (0.6 + rand() * 0.6),
        dark ? '#aaa6c6' : color,
        rand,
      );
    }
  }

  /** Low dust kicked along the ground. `dir` biases it (e.g. behind a dash); omit for a ring. */
  dust(x: number, z: number, count: number, size: number, color: THREE.ColorRepresentation, rand = Math.random, dirX = 0, dirZ = 0, speed = 2.2): void {
    if (!renderQuality.worldEffects) return;
    const t = worldFxTuning;
    const n = this.noise.take('smoke', Math.round(count * t.amount));
    const biased = dirX !== 0 || dirZ !== 0;
    const base = Math.atan2(dirZ, dirX);
    for (let k = 0; k < n; k++) {
      const a = biased ? base + (rand() - 0.5) * 1.6 : (k / n) * Math.PI * 2 + rand() * 0.5;
      const sp = speed * (0.5 + rand() * 0.7);
      this.addPuff(
        x + Math.cos(a) * 0.2 * size,
        0.15 + rand() * 0.15,
        z + Math.sin(a) * 0.2 * size,
        Math.cos(a) * sp,
        0.4 + rand() * 0.5,
        Math.sin(a) * sp,
        t.dustLife[0] + rand() * (t.dustLife[1] - t.dustLife[0]),
        (0.35 + rand() * 0.25) * size,
        (0.8 + rand() * 0.5) * size,
        0.8,
        0.2,
        color,
        rand,
      );
    }
  }

  /** Glowing sparks that arc, bounce and burn out. */
  sparks(x: number, y: number, z: number, count: number, color: THREE.ColorRepresentation, speed = 7, rand = Math.random): void {
    if (!renderQuality.worldEffects) return;
    const n = this.noise.take('particles', Math.round(count * worldFxTuning.amount));
    this.c.set(color);
    for (let k = 0; k < n; k++) {
      const i = this.sn < SPARKS ? this.sn++ : Math.floor(rand() * SPARKS);
      const a = rand() * Math.PI * 2;
      const sp = speed * (0.4 + rand() * 0.8);
      this.sx[i] = x;
      this.sy[i] = y;
      this.sz[i] = z;
      this.svx[i] = Math.cos(a) * sp;
      this.svz[i] = Math.sin(a) * sp;
      this.svy[i] = 3 + rand() * speed;
      this.sAge[i] = 0;
      this.sLife[i] = 0.35 + rand() * 0.5;
      this.sSize[i] = 0.16 + rand() * 0.14;
      this.sCol[i * 3] = this.c.r;
      this.sCol[i * 3 + 1] = this.c.g;
      this.sCol[i * 3 + 2] = this.c.b;
    }
  }

  clear(): void {
    this.n = this.sn = 0;
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.removePuff(i);
        i--;
        continue;
      }
      const d = Math.exp(-3.2 * dt);
      this.vx[i] *= d;
      this.vz[i] *= d;
      this.vy[i] = this.vy[i] * d + this.rise[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      this.rot[i] += dt * 0.6;
    }
    const g = worldFxTuning.sparkGravity;
    for (let i = 0; i < this.sn; i++) {
      this.sAge[i] += dt;
      if (this.sAge[i] >= this.sLife[i]) {
        this.removeSpark(i);
        i--;
        continue;
      }
      this.svy[i] -= g * dt;
      const d = Math.exp(-1.2 * dt);
      this.svx[i] *= d;
      this.svz[i] *= d;
      this.sx[i] += this.svx[i] * dt;
      this.sy[i] += this.svy[i] * dt;
      this.sz[i] += this.svz[i] * dt;
      if (this.sy[i] < 0.05) {
        this.sy[i] = 0.05;
        this.svy[i] *= -0.45;
      }
    }
  }

  private removePuff(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.z[i] = this.z[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.vz[i] = this.vz[j];
    this.age[i] = this.age[j];
    this.life[i] = this.life[j];
    this.s0[i] = this.s0[j];
    this.s1[i] = this.s1[j];
    this.a0[i] = this.a0[j];
    this.rise[i] = this.rise[j];
    this.rot[i] = this.rot[j];
    this.col[i * 3] = this.col[j * 3];
    this.col[i * 3 + 1] = this.col[j * 3 + 1];
    this.col[i * 3 + 2] = this.col[j * 3 + 2];
  }

  private removeSpark(i: number): void {
    const j = --this.sn;
    if (i === j) return;
    this.sx[i] = this.sx[j];
    this.sy[i] = this.sy[j];
    this.sz[i] = this.sz[j];
    this.svx[i] = this.svx[j];
    this.svy[i] = this.svy[j];
    this.svz[i] = this.svz[j];
    this.sAge[i] = this.sAge[j];
    this.sLife[i] = this.sLife[j];
    this.sSize[i] = this.sSize[j];
    this.sCol[i * 3] = this.sCol[j * 3];
    this.sCol[i * 3 + 1] = this.sCol[j * 3 + 1];
    this.sCol[i * 3 + 2] = this.sCol[j * 3 + 2];
  }

  render(): void {
    const p = this.puffs;
    p.begin();
    for (let i = 0; i < this.n; i++) {
      const k = this.age[i] / this.life[i];
      // Swell fast then slowly; fade over the second half.
      const e = 1 - (1 - k) * (1 - k);
      const s = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
      const a = this.a0[i] * (k < 0.08 ? k / 0.08 : k < 0.45 ? 1 : 1 - (k - 0.45) / 0.55);
      p.push(this.x[i], this.y[i], this.z[i], s, this.col[i * 3], this.col[i * 3 + 1], this.col[i * 3 + 2], a * this.noise.alpha(this.x[i], this.z[i]), this.rot[i]);
    }
    p.end();
    const g = this.glow;
    g.begin();
    for (let i = 0; i < this.sn; i++) {
      const k = this.sAge[i] / this.sLife[i];
      const s = this.sSize[i] * (1 - k * 0.6);
      g.push(this.sx[i], this.sy[i], this.sz[i], s, this.sCol[i * 3], this.sCol[i * 3 + 1], this.sCol[i * 3 + 2], (1 - k * k) * this.noise.alpha(this.sx[i], this.sz[i]));
    }
    g.end();
  }
}

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private px = new Float32Array(MAX);
  private py = new Float32Array(MAX);
  private pz = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private vz = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private spin = new Float32Array(MAX);
  private colors: THREE.Color[] = [];
  private alive = 0; // particles [0, alive) are live; dead ones are swapped out
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c1 = new THREE.Color();
  private c2 = new THREE.Color();
  /** Smoke, dust and sparks. */
  readonly soft: SoftFx;
  /** Chunky bouncing debris. */
  readonly debris: Debris;
  /** Short-lived ground marks (scorch, footprints). */
  readonly decals: Decals;

  private noise: NoiseGovernor;

  constructor(scene: THREE.Scene) {
    this.noise = noiseFor(scene);
    this.soft = new SoftFx(scene);
    this.debris = new Debris(scene);
    this.decals = new Decals(scene);
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), createRetroMaterial({ unlit: 0.7 }), MAX);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) {
      this.colors.push(new THREE.Color(1, 1, 1));
      this.mesh.setColorAt(i, this.colors[i]);
    }
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  burst(x: number, y: number, z: number, o: BurstOptions, rand = Math.random): void {
    if (renderQuality.worldEffects && (o.smoke || o.debris || o.sparks || o.dust)) this.extras(x, y, z, o, rand);
    this.c1.set(o.color);
    this.c2.set(o.color2 ?? o.color);
    const count = this.noise.take('particles', o.count <= 2 ? o.count : Math.ceil(o.count * renderQuality.particles));
    for (let n = 0; n < count && this.alive < MAX; n++) {
      const i = this.alive++;
      let a = rand() * Math.PI * 2;
      if (o.dir) a = Math.atan2(o.dir.z, o.dir.x) + (rand() - 0.5) * o.dir.spread;
      const sp = o.speed[0] + rand() * (o.speed[1] - o.speed[0]);
      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;
      this.vx[i] = Math.cos(a) * sp;
      this.vz[i] = Math.sin(a) * sp;
      this.vy[i] = (o.up ?? 0) * (0.5 + rand());
      this.maxLife[i] = this.life[i] = o.life[0] + rand() * (o.life[1] - o.life[0]);
      this.size[i] = o.size[0] + rand() * (o.size[1] - o.size[0]);
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 3;
      this.spin[i] = rand() * 10;
      this.colors[i].copy(this.c1).lerp(this.c2, rand());
    }
  }

  /** The world-effect extras a burst asks for (smoke, debris, sparks, scorch). */
  private extras(x: number, y: number, z: number, o: BurstOptions, rand: () => number): void {
    const size = Math.max(0.6, Math.min(2.2, Math.max((o.speed[1] + o.speed[0]) / 9, o.size[1] * 2.5)));
    if (o.smoke) {
      this.soft.smoke(x, Math.max(0.3, y), z, o.smoke, size, rand);
      const r = o.scorch ?? size * 0.9;
      if (r > 0) this.decals.scorch(x, z, r, rand);
    }
    if (o.sparks) this.soft.sparks(x, Math.max(0.3, y), z, o.sparks, o.color2 ?? '#ffd23f', 4 + size * 3, rand);
    if (o.dust) this.soft.dust(x, z, o.dust, size, o.color, rand, 0, 0, 2 + size * 2);
    if (o.debris) this.debris.spawn(x, Math.max(0.3, y), z, Math.floor(o.debris * worldFxTuning.amount + rand()), o.color, o.color2 ?? o.color, Math.min(0.6, o.size[1] * 0.85), o.speed[1] * 0.7, rand);
  }

  clear(): void {
    this.alive = 0;
    this.soft.clear();
    this.debris.clear();
    this.decals.clear();
  }

  update(dt: number): void {
    if (!renderQuality.worldEffects) {
      this.soft.clear();
      this.debris.clear();
      this.decals.clear();
    }
    this.soft.update(dt);
    this.debris.update(dt);
    this.decals.update(dt);
    for (let i = 0; i < this.alive; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.swapRemove(i);
        i--;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d;
      this.vz[i] *= d;
      this.vy[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.05) {
        this.py[i] = 0.05;
        this.vy[i] *= -0.4;
      }
      this.spin[i] += dt * 8;
    }
  }

  private swapRemove(i: number): void {
    const j = --this.alive;
    if (i === j) return;
    this.px[i] = this.px[j];
    this.py[i] = this.py[j];
    this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.vz[i] = this.vz[j];
    this.life[i] = this.life[j];
    this.maxLife[i] = this.maxLife[j];
    this.size[i] = this.size[j];
    this.grav[i] = this.grav[j];
    this.drag[i] = this.drag[j];
    this.spin[i] = this.spin[j];
    this.colors[i].copy(this.colors[j]);
  }

  /** Upload instance data. Particles are cosmetic, so no interpolation. */
  render(): void {
    this.soft.render();
    this.debris.render();
    this.decals.render();
    for (let i = 0; i < this.alive; i++) {
      const k = this.life[i] / this.maxLife[i];
      const sc = this.size[i] * Math.min(1, k * 2.5) * Math.sqrt(this.noise.alpha(this.px[i], this.pz[i]));
      this.q.setFromEuler(this.e.set(this.spin[i], this.spin[i] * 0.7, 0));
      this.m4.compose(this.v.set(this.px[i], this.py[i], this.pz[i]), this.q, this.s.set(sc, sc, sc));
      this.mesh.setMatrixAt(i, this.m4);
      this.mesh.setColorAt(i, this.colors[i]);
    }
    this.mesh.count = this.alive;
    commit(this.mesh.instanceMatrix, this.mesh.count);
    if (this.mesh.instanceColor) commit(this.mesh.instanceColor, this.mesh.count);
  }
}
