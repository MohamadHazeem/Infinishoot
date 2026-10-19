import type * as THREE from 'three';
import type { Rng } from '../../core/rng';
import type { SpatialHash } from '../../core/spatialHash';
import type { Tag } from '../../data/tags';
import { buildKey, buildMaxed, buildParams, newBuild, parseBuild, totalRanks, type Build } from '../../data/tracks';
import { DEFAULT_FEEL, type WeaponDef, type WeaponFeel } from '../../data/weapons';
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
  /** Exact damage: skip stats, Mods, status multipliers and crits (the Nuke's bite on bosses). */
  fixed?: boolean;
}

/** Cosmetic effects (recorded for online clients). */
export interface FxApi {
  star(x: number, y: number, z: number, size: number, color?: string, life?: number): void;
  ring(x: number, z: number, size: number, grow: number, color: string, life?: number): void;
  scar(x: number, z: number, r: number, color: string, life?: number): void;
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
  /** Whether a pooled shot threatens this hero (including opponents during a duel). */
  hostileBullet?(index: number): boolean;
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
  /** Damage every barrel whose centre passes `inside` (beams, zaps, fields; bullets and blasts handle their own). */
  hitBarrels(dmg: number, inside: (x: number, z: number) => boolean): void;
  /** Chain lightning from an enemy: `hops` jumps, with its own visuals (Storm Rail). */
  zap(from: Enemy, hops: number, dmg: number): void;
  /** Area blast that damages enemies (never the player). */
  blast(x: number, z: number, r: number, base: number, color: string, source: string, tags?: Tag[]): void;
  sound(
    name: 'scatter' | 'pellets' | 'laser' | 'sweeper' | 'nova' | 'aura' | 'orb' | 'bouncer' | 'drone' | 'meteor' | 'zap' | 'disc' | 'missile' | 'mine' | 'freeze' | 'explode' | 'shoot' | 'flame' | 'charge' | 'chargeFull' | 'chargeShot' | 'lob' | 'vortex' | 'shieldUp' | 'block' | 'uplink' | 'beam' | 'rail' | 'mechCannon' | 'mechMissile' | 'swordSlash' | 'swordCombo' | 'swordDash' | 'summon' | 'minionZap',
  ): void;
  /** The weapon updating right now: its evolution adds a sound layer to `sound()` (src/audio/evoLayers.ts). */
  soundSource?: Weapon | null;
  /** Screen shake at a world point (scaled by distance to each player). */
  shake(x: number, z: number, amount: number): void;
  /** Weapon combos this hero has unlocked (src/data/weaponCombos.ts). */
  readonly combos: ReadonlySet<string>;
}

/**
 * Base class for an owned weapon. Levels are 1-based. Loadout weapons with
 * upgrade tracks keep a `build` (ranks, evolution, Overdrive) instead, and
 * `level` just counts what was taken.
 */
export abstract class Weapon {
  level = 1;
  /** Track weapons: what's been taken (null for level-ladder weapons). */
  readonly build: Build | null;
  private params: Record<string, number> | null = null;
  protected cd = 0.5;
  /** Muzzle flash timer (arm weapons; drives the flash and camera kick). */
  muzzleT = 0;
  /** Last step's muzzleT, so a new shot (muzzleT rising) fires its feel (kick, recoil) once. */
  feelMuzzle = 0;
  /** Right-click weapons: 0..1 readiness for the crosshair meter (synced to clients). */
  ready = 1;
  /** Length of the last cooldown, for `ready`. */
  protected cdMax = 1;

  constructor(readonly def: WeaponDef) {
    this.build = def.tracks ? newBuild(def) : null;
  }

  /** Parameters for the current level (or build, or the partner-item evolution). */
  get p(): Record<string, number> {
    if (!this.build) return this.partnerEvolved ? this.def.evolution!.p : this.def.levels[this.level - 1].p;
    return (this.params ??= buildParams(this.def.levels[0].p, this.def, this.build));
  }

  get maxed(): boolean {
    return this.build ? buildMaxed(this.def, this.build) : this.level >= this.def.levels.length;
  }

  /** Evolved: the chosen evolution (track weapons), a partner-item evolution, or the def's last level. */
  get evolved(): boolean {
    if (this.build) return this.build.evo >= 0;
    if (this.def.evolution) return this.partnerEvolved;
    return !!this.def.evo && this.maxed;
  }

  /** Auto weapons with a partner-item evolution sit one level past their last normal level once evolved. */
  get partnerEvolved(): boolean {
    return !!this.def.evolution && this.level > this.def.levels.length;
  }

  private tagCache: { evo: number; tags: readonly Tag[] } | null = null;
  /** The def's tags plus the chosen evolution's (Mods and statuses key off them). */
  get tags(): readonly Tag[] {
    const evo = this.build?.evo ?? -1;
    if (this.tagCache?.evo !== evo) {
      const extra = this.def.evos?.[evo]?.tags ?? [];
      this.tagCache = { evo, tags: extra.length ? [...this.def.tags, ...extra.filter((t) => !this.def.tags.includes(t))] : this.def.tags };
    }
    return this.tagCache.tags;
  }

  /** Game feel (src/data/weapons.ts WEAPON_FEEL). */
  get feel(): WeaponFeel {
    return this.def.feel ?? DEFAULT_FEEL;
  }

  /** True once per shot: the muzzle flash just started (call once per step). */
  shotStarted(): boolean {
    const fired = this.muzzleT > this.feelMuzzle + 1e-4;
    this.feelMuzzle = this.muzzleT;
    return fired;
  }

  /** Track weapons: the chosen evolution's id ('' before evolving). */
  get evoId(): string {
    return (this.build && this.def.evos?.[this.build.evo]?.id) || '';
  }

  get name(): string {
    if (this.build) return this.def.evos?.[this.build.evo]?.name ?? this.def.name;
    if (this.partnerEvolved) return this.def.evolution!.name;
    return this.evolved ? this.def.evo!.name : this.def.name;
  }

  get color(): string {
    if (this.build) return this.def.evos?.[this.build.evo]?.color ?? this.def.color;
    if (this.partnerEvolved) return this.def.evolution!.color;
    return this.evolved ? this.def.evo!.color : this.def.color;
  }

  /** Track weapons: take a rank, the evolution or an Overdrive rank. */
  addRank(track: number): void {
    if (!this.build) return;
    this.build.ranks[track] = Math.min(this.def.tracks![track].ranks.length, this.build.ranks[track] + 1);
    this.rebuilt();
  }
  /** Track weapons: take evolution `i`. Partner-item weapons: evolve once maxed. */
  evolve(i = 0): void {
    if (!this.build) {
      if (this.def.evolution && this.maxed && !this.partnerEvolved) this.level = this.def.levels.length + 1;
      return;
    }
    if (this.build.evo >= 0) return;
    this.build.evo = i;
    this.rebuilt();
  }
  overdrive(): void {
    if (!this.build) return;
    this.build.od++;
    this.rebuilt();
  }
  private rebuilt(): void {
    this.params = null;
    this.level = 1 + totalRanks(this.build!) + (this.build!.evo >= 0 ? 1 : 0) + this.build!.od;
  }

  /** Network form of the build ('' for level-ladder weapons). */
  get buildKey(): string {
    return this.build ? buildKey(this.build) : '';
  }
  setBuildKey(key: string): void {
    if (!this.build || key === this.buildKey) return;
    Object.assign(this.build, parseBuild(key, this.def));
    this.rebuilt();
  }

  /** Right-click arm weapons: recharge speed from Quick Draw / Capacitor. */
  protected rightClickSpeed(ctx: WeaponCtx): number {
    return ctx.stats.chargeSpeed * (1 + ctx.flags.chargeSpeed);
  }

  /** Right-click weapons: start a cooldown and update `ready` as it runs. */
  protected startCooldown(seconds: number): void {
    this.cd = this.cdMax = seconds;
    this.ready = 0;
  }
  protected tickReady(): void {
    this.ready = this.cd <= 0 ? 1 : 1 - this.cd / this.cdMax;
  }

  /** Big right-click moment: ring and sparks at the hand, recoil and camera kick. */
  protected armFx(ctx: WeaponCtx, color: string, size = 1): void {
    const pl = ctx.player;
    const m = { x: 0, z: 0 };
    pl.muzzle(m);
    ctx.fx.ring(m.x, m.z, 0.4, 2.6 * size, color, 0.22);
    ctx.fx.star(m.x, 1.05, m.z, 1.2 * size, '#ffffff', 0.1);
    ctx.particles.burst(m.x, 1.05, m.z, { count: Math.round(10 * size), color, color2: '#ffffff', speed: [3, 9], size: [0.12, 0.28], life: [0.12, 0.3], dir: { x: pl.aim.x, z: pl.aim.z, spread: 1.3 } });
    pl.recoil = Math.max(pl.recoil, 2);
    this.muzzleT = Math.max(this.muzzleT, 0.1);
  }

  /** Left-click arm weapons: Hair Trigger makes every Nth shot a MEGA shot. */
  private shotCount = 0;
  protected megaShot(ctx: WeaponCtx): boolean {
    const every = ctx.flags.busterMegaEvery;
    if (every <= 0 || ++this.shotCount % every !== 0) return false;
    ctx.sound('explode');
    return true;
  }

  /** Pixel icon id (evolved weapons get their own icon; a second evolution `_evo2`). */
  get iconId(): string {
    if (this.build && this.build.evo >= 1) return `${this.def.id}_evo${this.build.evo + 1}`;
    if (this.partnerEvolved) return this.def.id;
    return this.evolved ? this.def.id + '_evo' : this.def.id;
  }

  /** Level-ladder weapons: next level. */
  levelUp(): void {
    if (!this.build && !this.maxed) this.level++;
  }

  /** The partner-item evolution's colour when evolved, else `base`. */
  protected look(base: string): string {
    return this.partnerEvolved ? this.def.evolution!.color : this.def.modColor ?? base;
  }

  private lookEvo = false;
  private modLookApplied = false;

  /** Render entry point: re-skins an auto weapon when it evolves, then draws it. */
  draw(alpha: number, ctx: WeaponCtx): void {
    if (this.def.modColor && !this.modLookApplied) {
      this.applyLook(this.def.modColor);
      this.modLookApplied = true;
    }
    if (this.partnerEvolved !== this.lookEvo) {
      this.lookEvo = this.partnerEvolved;
      this.applyLook(this.lookEvo ? this.def.evolution!.color : this.def.modColor ?? null);
    }
    this.render(alpha, ctx);
  }

  /** Recolour meshes for the evolved form (`null` = back to normal). */
  protected applyLook(_evoColor: string | null): void {}

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
