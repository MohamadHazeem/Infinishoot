import { noiseFor, type NoiseGovernor } from '../render/noiseGovernor';
import * as THREE from 'three';
import { particleLod } from '../render/lod';
import { ParticleBatch } from '../render/particlesGpu';
import { ParticleKind } from '../render/particlesShader';
import { renderQuality } from '../render/quality';
import { fxFor } from './fx';
import type { Material } from '../data/enemies';
import { Debris } from './debris';
import { Decals } from './decals';

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
  /** Rare reward presentation, carried by the existing burst codec extras. */
  flourish?: 'level' | 'evolution' | 'chest';
  /** Optional silhouette; templates carry this through the codec's extra fields. */
  shape?: 'splat' | 'chip';
}

/** Material-specific hits use compact burst fields, with no new frequent wire event. */
export function materialHit(
  material: Material | undefined,
  color: string,
  dx = 0,
  dz = 0,
): BurstOptions {
  const dir = { x: -dx, z: -dz, spread: 2.4 };
  if (material === 'metal' || material === 'shield')
    return {
      count: 3,
      color: material === 'shield' ? '#73eff7' : '#ffcd75',
      color2: '#f4f4f4',
      speed: [4, 8],
      size: [0.06, 0.12],
      life: [0.12, 0.3],
      up: 2,
      gravity: 16,
      sparks: 2,
      dir,
    };
  if (material === 'slime')
    return {
      shape: 'splat',
      count: 4,
      color,
      color2: '#a7f070',
      speed: [1.5, 3.5],
      size: [0.16, 0.28],
      life: [0.25, 0.45],
      up: 1.8,
      gravity: 14,
      drag: 5,
      dir,
    };
  if (material === 'stone')
    return {
      shape: 'chip',
      count: 3,
      color: '#94b0c2',
      color2: color,
      speed: [2, 5],
      size: [0.1, 0.2],
      life: [0.3, 0.55],
      up: 3,
      gravity: 22,
      drag: 2,
      dir,
    };
  return {
    count: 3,
    color: '#ffffff',
    color2: color,
    speed: [3, 7],
    size: [0.1, 0.18],
    life: [0.12, 0.25],
    dir,
  };
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

/** Soft effects share the launch buffer with impact fragments. */
export class SoftFx {
  private color = new THREE.Color();
  constructor(private batch: ParticleBatch) {}

  smoke(
    x: number,
    y: number,
    z: number,
    count: number,
    size = 1,
    rand = Math.random,
    color: THREE.ColorRepresentation = '#dcd8ec',
  ): void {
    if (!renderQuality.worldEffects) return;
    const t = worldFxTuning;
    const n = this.batch.admit('smoke', Math.round(count * t.amount));
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2;
      const sp = (0.6 + rand()) * size;
      this.batch.add(
        x,
        y + rand() * 0.5,
        z,
        Math.cos(a) * sp,
        (0.4 + rand()) * t.smokeRise,
        Math.sin(a) * sp,
        t.smokeLife[0] + rand() * (t.smokeLife[1] - t.smokeLife[0]),
        size * (0.32 + rand() * 0.18),
        -0.15,
        1.5,
        ParticleKind.Smoke,
        this.color.set(k % 3 === 0 ? '#aaa6c6' : color),
        0.26,
      );
    }
  }

  dust(
    x: number,
    z: number,
    count: number,
    size: number,
    color: THREE.ColorRepresentation,
    rand = Math.random,
    dirX = 0,
    dirZ = 0,
    speed = 2.2,
  ): void {
    if (!renderQuality.worldEffects) return;
    const t = worldFxTuning;
    const n = this.batch.admit('smoke', Math.round(count * t.amount));
    this.color.set(color);
    for (let k = 0; k < n; k++) {
      const a =
        dirX || dirZ
          ? Math.atan2(dirZ, dirX) + (rand() - 0.5) * 1.6
          : ((k + rand() * 0.4) / n) * Math.PI * 2;
      const sp = speed * (0.5 + rand() * 0.7);
      this.batch.add(
        x,
        0.14,
        z,
        Math.cos(a) * sp,
        0.5,
        Math.sin(a) * sp,
        t.dustLife[0] + rand() * (t.dustLife[1] - t.dustLife[0]),
        size * (0.17 + rand() * 0.1),
        0.6,
        2,
        ParticleKind.Dust,
        this.color,
        0.35,
      );
    }
  }

  sparks(
    x: number,
    y: number,
    z: number,
    count: number,
    color: THREE.ColorRepresentation,
    speed = 7,
    rand = Math.random,
  ): void {
    if (!renderQuality.worldEffects) return;
    const n = this.batch.admit('particles', Math.round(count * worldFxTuning.amount));
    this.color.set(color);
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2,
        sp = speed * (0.4 + rand() * 0.8);
      this.batch.add(
        x,
        y,
        z,
        Math.cos(a) * sp,
        3 + rand() * speed,
        Math.sin(a) * sp,
        0.35 + rand() * 0.5,
        0.11 + rand() * 0.09,
        worldFxTuning.sparkGravity,
        1.2,
        ParticleKind.Spark,
        this.color,
      );
    }
  }
}

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  readonly soft: SoftFx;
  readonly debris: Debris;
  readonly decals: Decals;
  private readonly batch: ParticleBatch;
  private readonly noise: NoiseGovernor;
  private c1 = new THREE.Color();
  private c2 = new THREE.Color();
  private tint = new THREE.Color();

  /** Admitted launch groups, including emissions before their first draw. */
  get alive(): number {
    return this.batch.liveGroups;
  }

  get drawnCount(): number {
    return this.batch.drawnCount;
  }

  constructor(private scene: THREE.Scene) {
    this.noise = noiseFor(scene);
    this.batch = new ParticleBatch(scene, this.noise);
    this.mesh = this.batch.mesh;
    this.soft = new SoftFx(this.batch);
    this.debris = new Debris(scene, this.batch);
    this.decals = new Decals(scene);
  }

  burst(x: number, y: number, z: number, o: BurstOptions, rand = Math.random): void {
    if (o.flourish) fxFor(this.scene)?.flourish(x, z, o.color, o.flourish === 'evolution');
    if (renderQuality.worldEffects && (o.smoke || o.debris || o.sparks || o.dust))
      this.extras(x, y, z, o, rand);
    this.c1.set(o.color);
    this.c2.set(o.color2 ?? o.color);
    const count = this.batch.admit(
      'particles',
      o.count <= 2 ? o.count : Math.ceil(o.count * renderQuality.particles * particleLod(x, z)),
    );
    const kind =
      o.shape === 'splat'
        ? ParticleKind.Splat
        : o.shape === 'chip' || o.debris
          ? ParticleKind.Flake
          : ParticleKind.Chip;
    for (let i = 0; i < count; i++) {
      const a = o.dir
        ? Math.atan2(o.dir.z, o.dir.x) + (rand() - 0.5) * o.dir.spread
        : rand() * Math.PI * 2;
      const speed = o.speed[0] + rand() * (o.speed[1] - o.speed[0]);
      const vy = (o.up ?? 0) * (0.5 + rand());
      const life = o.life[0] + rand() * (o.life[1] - o.life[0]);
      const radius = (o.size[0] + rand() * (o.size[1] - o.size[0])) * 0.77;
      this.tint.copy(this.c1).lerp(this.c2, rand());
      this.batch.add(
        x,
        y,
        z,
        Math.cos(a) * speed,
        vy,
        Math.sin(a) * speed,
        life,
        radius,
        o.gravity ?? 0,
        o.drag ?? 3,
        kind,
        this.tint,
      );
    }
  }

  /** The world-effect extras a burst asks for (smoke, debris, sparks, scorch). */
  private extras(x: number, y: number, z: number, o: BurstOptions, rand: () => number): void {
    const size = Math.max(
      0.6,
      Math.min(2.2, Math.max((o.speed[1] + o.speed[0]) / 9, o.size[1] * 2.5)),
    );
    if (o.smoke) {
      // Ring + the original debris + a narrower smoke column make the blast silhouette legible.
      if (!this.noise.calm) fxFor(this.scene)?.ring(x, z, size * 0.8, 3, o.color2 ?? o.color, 0.32);
      if (!o.debris)
        this.debris.spawn(
          x,
          Math.max(0.3, y),
          z,
          Math.min(3, o.smoke),
          '#566c86',
          o.color,
          0.18,
          4,
          rand,
        );
      this.soft.smoke(x, Math.max(0.3, y), z, o.smoke, size, rand);
      const r = o.scorch ?? size * 0.9;
      if (r > 0) this.decals.scorch(x, z, r, rand);
    }
    if (o.sparks)
      this.soft.sparks(x, Math.max(0.3, y), z, o.sparks, o.color2 ?? '#ffd23f', 4 + size * 3, rand);
    if (o.dust) this.soft.dust(x, z, o.dust, size, o.color, rand, 0, 0, 2 + size * 2);
    if (o.debris)
      this.debris.spawn(
        x,
        Math.max(0.3, y),
        z,
        Math.floor(o.debris * worldFxTuning.amount + rand()),
        o.color,
        o.color2 ?? o.color,
        Math.min(0.6, o.size[1] * 0.85),
        o.speed[1] * 0.7,
        rand,
      );
  }

  clear(): void {
    this.batch.clear();
    this.debris.clear();
    this.decals.clear();
  }

  update(dt: number): void {
    if (!renderQuality.worldEffects) {
      this.debris.clear();
      this.decals.clear();
    }
    this.batch.update(dt);
    this.debris.update(dt);
    this.decals.update(dt);
  }

  render(): void {
    this.batch.render();
    this.debris.render();
    this.decals.render();
  }
}
