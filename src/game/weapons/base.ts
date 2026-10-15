import type * as THREE from 'three';
import type { Rng } from '../../core/rng';
import type { SpatialHash } from '../../core/spatialHash';
import type { Tag } from '../../data/tags';
import type { WeaponDef } from '../../data/weapons';
import type { ModFlags } from '../modTypes';
import type { Bullets } from '../bullets';
import type { Enemy, Enemies } from '../enemies';
import type { BurstOptions } from '../particles';
import type { Player } from '../player';
import type { Stats } from '../stats';

export interface DamageOpts {
  /** Weapon id, for the end-of-run damage breakdown. */
  source: string;
  dirX?: number;
  dirZ?: number;
  knockback?: number;
  /** Hit point for sparks (defaults to the enemy). */
  hx?: number;
  hz?: number;
  canCrit?: boolean;
  /** Show a damage number and play the hit sound (off for auras, burns, blasts). */
  loud?: boolean;
  /** Override the source weapon's tags (Mods, combos). */
  tags?: readonly Tag[];
  /** Don't apply statuses or fire Mod hit triggers (DoT ticks, combo blasts). */
  noStatus?: boolean;
}

/** Cosmetic effects (recorded for online clients). */
export interface FxApi {
  star(x: number, y: number, z: number, size: number, color?: string, life?: number): void;
  ring(x: number, z: number, size: number, grow: number, color: string, life?: number): void;
}
export interface ParticleApi {
  burst(x: number, y: number, z: number, o: BurstOptions): void;
}

/** Everything a weapon may touch. Implemented by Game, one per hero. */
export interface WeaponCtx {
  scene: THREE.Scene;
  player: Player;
  stats: Stats;
  rng: Rng;
  time: number;
  enemies: Enemies;
  hash: SpatialHash<Enemy>;
  bullets: Bullets;
  particles: ParticleApi;
  fx: FxApi;
  /** Index of the hero who owns this weapon. */
  owner: number;
  /** Manual fire held (mouse / trigger / auto-fire). */
  firing: boolean;
  /** Charge shot held (right mouse / X). */
  charging: boolean;
  /** Summed Mod flags (Hair Trigger, Pacifist Core, Lightning Rod...). */
  readonly flags: ModFlags;
  /** Apply base damage (scaled by stats, crits, shatter). Returns the dealt amount. */
  damage(e: Enemy, base: number, o: DamageOpts): number;
  nearest(x: number, z: number, r: number, skip?: (e: Enemy) => boolean): Enemy | null;
  inRadius(x: number, z: number, r: number, out: Enemy[]): Enemy[];
  /** Area blast that damages enemies (never the player). */
  blast(x: number, z: number, r: number, base: number, color: string, source: string): void;
  sound(name: 'zap' | 'disc' | 'missile' | 'mine' | 'freeze' | 'explode' | 'shoot' | 'flame' | 'charge' | 'chargeFull' | 'chargeShot'): void;
}

/** Base class for an owned weapon. Levels are 1-based. */
export abstract class Weapon {
  level = 1;
  protected cd = 0.5;

  constructor(readonly def: WeaponDef) {}

  /** Parameters for the current level (or the evolved form). */
  get p(): Record<string, number> {
    return this.evolved ? this.def.evo!.p : this.def.levels[this.level - 1].p;
  }

  get maxed(): boolean {
    return this.level >= this.def.levels.length;
  }

  /** Evolved forms sit one level past the last normal level. */
  get evolved(): boolean {
    return this.level > this.def.levels.length && !!this.def.evo;
  }

  get name(): string {
    return this.evolved ? this.def.evo!.name : this.def.name;
  }

  levelUp(): void {
    if (!this.maxed) this.level++;
  }

  evolve(): void {
    if (this.maxed && !this.evolved && this.def.evo) this.level = this.def.levels.length + 1;
  }

  /** Counts down a cooldown scaled by stats; returns true when it fires. */
  protected tick(dt: number, ctx: WeaponCtx, base: number): boolean {
    this.cd -= dt;
    if (this.cd > 0) return false;
    this.cd += base * ctx.stats.cooldownMul;
    if (this.cd < 0) this.cd = 0;
    return true;
  }

  abstract update(dt: number, ctx: WeaponCtx): void;
  /** Visual state for online clients (positions, angles...). */
  net(): number[] {
    return [];
  }
  /** Client: apply visual state from the host. */
  setNet(_a: number[]): void {}
  render(_alpha: number, _ctx: WeaponCtx): void {}
  dispose(): void {}
}
