import type * as THREE from 'three';
import type { Rng } from '../core/rng';
import { MOD_RARITY_WEIGHT, MODS } from '../data/mods';
import { PASSIVES } from '../data/passives';
import type { Tag } from '../data/tags';
import { WEAPONS } from '../data/weapons';
import type { LoadoutItem } from '../ui/hud';
import type { Offer, ShopView } from '../ui/screens';
import type { Enemy } from './enemies';
import type { ModDef } from './modTypes';
import { Player, dashLevelMul } from './player';
import { computeStats, type Stats } from './stats';
import { MAX_MOD_SLOTS, Synergy, type SynergyHost } from './synergy';
import { createWeapon, type Weapon, type WeaponCtx } from './weapons';

export const MAX_WEAPONS = 6;
export const MAX_PASSIVES = 6;
export const HERO_COLORS = ['#2f7bff', '#22c76a', '#ffb627', '#d8def0'];

export const economyTuning = {
  clearGold: 5, // flat gold for clearing a stage
  interestPer: 5, // +1 gold per this much held at stage clear
  interestCap: 5, // max interest per stage (Piggy Bank raises it)
  rerollBase: 2, // first paid reroll; +1 each reroll in the same shop
  healCost: 3,
  shopOffers: 4,
};

/** What a hero needs from the game (combat, world, randomness). */
export interface HeroWorld {
  readonly scene: THREE.Scene;
  readonly rng: Rng;
  readonly level: number;
  blast(x: number, z: number, r: number, dmg: number, color: string, source: string, tags: Tag[], noStatus: boolean, by: Hero): void;
  zap(from: Enemy, hops: number, dmg: number, by: Hero): void;
  ignite(e: Enemy, dps: number, by: Hero): void;
  shock(e: Enemy, by: Hero): void;
  makeCtx(hero: Hero): WeaponCtx;
  goldFx(hero: Hero, n: number): void;
}

/** Latest input from a remote player (host side). */
export interface RemoteInput {
  x: number;
  z: number;
  vx: number;
  vz: number;
  ax: number;
  az: number;
  firing: boolean;
  charging: boolean;
  dashing: boolean;
}

/**
 * One player's run: hero body, weapons, passives, Mods, gold, level-up
 * cards and shop. Team-wide state (XP, level, score, stage) lives in Game.
 */
export class Hero implements SynergyHost {
  readonly player: Player;
  readonly synergy: Synergy;
  readonly ctx: WeaponCtx;
  weapons: Weapon[] = [];
  passives: Record<string, number> = {};
  /** Live stats (static + per-step Mod effects). Shared by reference with the player. */
  readonly stats: Stats = computeStats({});
  private statBase: Stats = computeStats({});
  gold = 0;
  rerollsLeft = 0;
  revivesLeft = 0;
  dashes = 0;
  damageBy: Record<string, number> = {};
  // Level-ups and chests waiting for this hero.
  pendingLevels = 0;
  chestsPending = 0;
  offers: Offer[] = [];
  // Shop
  shopOffers: (ModDef | null)[] = [];
  shopRerolls = 0;
  shopHealed = false;
  shopDone = true;
  // Bomb
  bombCharge = 0;
  bombT = -1;
  bombId = 0;
  bombX = 0;
  bombZ = 0;
  // Downed in co-op
  reviveT = 0;
  /** The player disconnected; the hero stays out of play. */
  left = false;
  // Network
  remote: RemoteInput | null = null;
  lastSeen = 0;
  loadoutDirty = true;

  constructor(
    private world: HeroWorld,
    readonly index: number,
    public name: string,
    readonly color: string,
    /** Weapons this player's own save has unlocked. */
    public unlocked: string[],
    readonly peerId = '',
  ) {
    this.player = new Player(world.scene, color);
    this.synergy = new Synergy(this);
    this.ctx = world.makeCtx(this);
  }

  // ---------------------------------------------------------------- SynergyHost
  get level(): number {
    return this.world.level;
  }
  get rng(): Rng {
    return this.world.rng;
  }
  blast(x: number, z: number, r: number, dmg: number, color: string, source: string, tags: Tag[]): void {
    this.world.blast(x, z, r, dmg, color, source, tags, false, this);
  }
  zap(from: Enemy, hops: number, dmg: number): void {
    this.world.zap(from, hops, dmg, this);
  }
  ignite(e: Enemy, dps: number): void {
    this.world.ignite(e, dps, this);
  }
  shock(e: Enemy): void {
    this.world.shock(e, this);
  }
  addGold(n: number): void {
    this.gold += n;
    this.world.goldFx(this, n);
  }

  get alive(): boolean {
    return !this.player.dead;
  }

  // ---------------------------------------------------------------- run lifecycle

  /** Fresh run: Buster only, no passives or Mods. */
  startRun(): void {
    this.disposeWeapons();
    this.weapons = [createWeapon('buster', this.world.scene)];
    this.passives = {};
    this.synergy.reset();
    this.gold = this.dashes = 0;
    this.damageBy = {};
    this.pendingLevels = this.chestsPending = 0;
    this.bombCharge = 0;
    this.bombT = -1;
    this.reviveT = 0;
    this.shopDone = true;
    this.recomputeStats();
    this.rerollsLeft = this.stats.rerolls;
    this.revivesLeft = this.stats.revives;
    this.player.reset(this.stats);
    this.loadoutDirty = true;
  }

  disposeWeapons(): void {
    for (const w of this.weapons) w.dispose();
    this.weapons = [];
  }

  dispose(): void {
    this.disposeWeapons();
    this.player.dispose();
  }

  /** Rebuild static stats (passives + Mods) and the live copy. */
  recomputeStats(): void {
    this.statBase = computeStats(this.passives);
    this.synergy.applyStatic(this.statBase);
    this.refreshLive();
    this.player.stats = this.stats;
    this.player.hp = Math.min(this.player.hp, this.stats.maxHp);
  }

  /** Live stats = static stats + per-step Mod effects (moving, timers). */
  refreshLive(): void {
    Object.assign(this.stats, this.statBase);
    this.synergy.applyLive(this.stats);
    this.stats.dashCooldownMul *= dashLevelMul(this.world.level);
  }

  loadout(): LoadoutItem[] {
    return [
      ...this.weapons.map((w) => ({ id: w.def.id, icon: w.def.icon, color: w.def.color, level: w.level, max: w.maxed, evo: w.evolved, name: w.name, kind: 'weapon' as const })),
      ...Object.entries(this.passives).map(([id, lv]) => {
        const d = PASSIVES[id];
        return { id, icon: d.icon, color: d.color, level: lv, max: lv >= d.maxLevel, name: d.name, kind: 'passive' as const };
      }),
    ];
  }

  // ---------------------------------------------------------------- level-ups

  get needsPick(): boolean {
    return this.pendingLevels > 0 || this.chestsPending > 0;
  }

  get skipGold(): number {
    return 2 + Math.floor(this.world.level / 8);
  }

  levelUpTitle(teamLevel: number): string {
    return this.chestsPending > 0 ? 'TREASURE!' : `LEVEL ${teamLevel - this.pendingLevels + 1}!`;
  }

  /** A maxed weapon whose partner passive this hero owns. */
  canEvolve(w: Weapon): boolean {
    const evo = w.def.evo;
    return !!evo && w.maxed && !w.evolved && (this.passives[evo.passive] ?? 0) > 0;
  }

  private evolveOffer(w: Weapon): Offer {
    const evo = w.def.evo!;
    return { kind: 'evolve', id: w.def.id, name: evo.name, icon: w.def.icon, color: w.def.color, tag: 'EVOLVE!', text: evo.text, tags: w.def.tags };
  }

  /** Card hint naming the passive a weapon evolves with (or the weapons a passive evolves). */
  private evoHint(weaponId: string): string {
    const evo = WEAPONS[weaponId]?.evo;
    return evo ? ` Evolves with ${PASSIVES[evo.passive].name}.` : '';
  }

  buildOffers(): Offer[] {
    type Cand = Offer & { w: number };
    const cands: Cand[] = [];
    for (const w of this.weapons) {
      if (w.maxed) continue;
      const next = w.def.levels[w.level];
      const last = w.level + 1 === w.def.levels.length;
      cands.push({ kind: 'weapon', id: w.def.id, name: w.def.name, icon: w.def.icon, color: w.def.color, tag: `LV ${w.level + 1}`, text: next.text + (last ? this.evoHint(w.def.id) : ''), tags: w.def.tags, w: 3 });
    }
    if (this.weapons.length < MAX_WEAPONS) {
      for (const id of this.unlocked) {
        if (this.weapons.some((w) => w.def.id === id) || !WEAPONS[id]) continue;
        const d = WEAPONS[id];
        cands.push({ kind: 'weapon', id, name: d.name, icon: d.icon, color: d.color, tag: 'NEW!', text: d.desc, tags: d.tags, w: 2.4 });
      }
    }
    const owned = Object.keys(this.passives).length;
    for (const [id, d] of Object.entries(PASSIVES)) {
      const lv = this.passives[id] ?? 0;
      if (lv >= d.maxLevel || (lv === 0 && owned >= MAX_PASSIVES)) continue;
      const evolves = lv === 0 ? this.weapons.filter((w) => w.def.evo?.passive === id && !w.evolved).map((w) => w.def.name) : [];
      const hint = evolves.length ? `. Evolves ${evolves.join(', ')}.` : '';
      cands.push({ kind: 'passive', id, name: d.name, icon: d.icon, color: d.color, tag: lv ? `LV ${lv + 1}` : 'NEW!', text: d.desc + hint, w: lv ? 1.8 : 1.1 });
    }
    // A ready evolution is always offered, as the first card.
    const out: Offer[] = [];
    const ready = this.weapons.filter((w) => this.canEvolve(w));
    if (ready.length) out.push(this.evolveOffer(ready[Math.floor(this.rng.next() * ready.length)]));
    while (out.length < 3 && cands.length) {
      let r = this.rng.next() * cands.reduce((a, c) => a + c.w, 0);
      let i = 0;
      while (i < cands.length - 1 && (r -= cands[i].w) > 0) i++;
      const { w: _w, ...offer } = cands.splice(i, 1)[0];
      out.push(offer);
    }
    if (out.length === 0) {
      out.push(
        { kind: 'gold', id: 'gold', name: 'Gold Bag', icon: '●', color: '#ffb627', tag: 'BONUS', text: '+5 gold' },
        { kind: 'heal', id: 'heal', name: 'Snack', icon: '♥', color: '#ff5e7a', tag: 'BONUS', text: 'Heal 40 life' },
      );
    }
    return out;
  }

  /** Apply a level-up card. Returns its color (for the pickup burst). */
  applyOffer(o: Offer): string {
    if (o.kind === 'weapon') {
      const w = this.weapons.find((x) => x.def.id === o.id);
      if (w) w.levelUp();
      else this.weapons.push(createWeapon(o.id, this.world.scene));
    } else if (o.kind === 'evolve') {
      this.weapons.find((x) => x.def.id === o.id)?.evolve();
    } else if (o.kind === 'passive') {
      this.passives[o.id] = (this.passives[o.id] ?? 0) + 1;
      this.recomputeStats();
      const heal = PASSIVES[o.id].healOnPick;
      if (heal) this.player.heal(heal);
    } else if (o.kind === 'gold') this.gold += 5;
    else if (o.kind === 'heal') this.player.heal(40);
    this.player.hp = Math.min(this.player.hp, this.player.maxHp);
    this.loadoutDirty = true;
    return o.color;
  }

  /** One level-up or chest resolved. */
  consumePick(): void {
    if (this.chestsPending > 0) this.chestsPending--;
    else if (this.pendingLevels > 0) this.pendingLevels--;
  }

  /**
   * A treasure chest's item, applied on the spot: a ready evolution first,
   * else a random passive this hero can take, else a level for an owned
   * weapon, else gold.
   */
  chestItem(): { id: string; name: string; color: string; icon: string; text: string; evolved?: boolean } {
    const ready = this.weapons.filter((w) => this.canEvolve(w));
    if (ready.length) {
      const w = ready[Math.floor(this.rng.next() * ready.length)];
      w.evolve();
      this.loadoutDirty = true;
      return { id: w.def.id, name: w.name, color: w.def.color, icon: w.def.icon, text: 'EVOLVED!', evolved: true };
    }
    const owned = Object.keys(this.passives).length;
    const passives = Object.values(PASSIVES).filter((d) => {
      const lv = this.passives[d.id] ?? 0;
      return lv < d.maxLevel && (lv > 0 || owned < MAX_PASSIVES);
    });
    if (passives.length) {
      const d = passives[Math.floor(this.rng.next() * passives.length)];
      const lv = (this.passives[d.id] ?? 0) + 1;
      this.applyOffer({ kind: 'passive', id: d.id, name: d.name, icon: d.icon, color: d.color, tag: '', text: d.desc });
      return { id: d.id, name: d.name, color: d.color, icon: d.icon, text: lv > 1 ? `LV ${lv}` : 'NEW' };
    }
    const weapons = this.weapons.filter((w) => !w.maxed);
    if (weapons.length) {
      const w = weapons[Math.floor(this.rng.next() * weapons.length)];
      w.levelUp();
      this.loadoutDirty = true;
      return { id: w.def.id, name: w.def.name, color: w.def.color, icon: w.def.icon, text: `LV ${w.level}` };
    }
    this.gold += 10;
    return { id: 'gold', name: 'Gold', color: '#ffb627', icon: '●', text: '+10' };
  }

  // ---------------------------------------------------------------- shop

  openShop(): void {
    this.shopRerolls = 0;
    this.shopHealed = false;
    this.shopDone = false;
    this.rollShop();
  }

  rollShop(): void {
    const pool = MODS.filter((m) => !this.synergy.owns(m.id));
    this.shopOffers = [];
    for (let k = 0; k < economyTuning.shopOffers && pool.length; k++) {
      let r = this.rng.next() * pool.reduce((a, m) => a + MOD_RARITY_WEIGHT[m.rarity], 0);
      let i = 0;
      while (i < pool.length - 1 && (r -= MOD_RARITY_WEIGHT[pool[i].rarity]) > 0) i++;
      this.shopOffers.push(pool.splice(i, 1)[0]);
    }
  }

  price(m: ModDef): number {
    return Math.max(1, Math.round(m.price * (1 - this.synergy.flags.shopDiscount)));
  }

  /** Half price back, or full price with Pawn Shop. */
  sellPrice(m: ModDef): number {
    return this.synergy.flags.sellFull ? m.price : Math.floor(this.price(m) / 2);
  }

  get rerollCost(): number {
    if (this.shopRerolls < this.synergy.flags.freeRerolls) return 0;
    return economyTuning.rerollBase + this.shopRerolls - this.synergy.flags.freeRerolls;
  }

  get interestCap(): number {
    return economyTuning.interestCap + this.synergy.flags.interestCap;
  }

  get interest(): number {
    return Math.min(this.interestCap, Math.floor(this.gold / this.interestPer));
  }

  get interestPer(): number {
    return Math.max(2, economyTuning.interestPer - this.synergy.flags.interestPer);
  }

  shopView(stage: number): ShopView {
    return {
      gold: this.gold,
      interest: this.interest,
      interestCap: this.interestCap,
      interestPer: this.interestPer,
      offers: this.shopOffers.map((m) => (m ? { def: m, price: this.price(m), hint: this.synergyHint(m) } : null)),
      owned: this.synergy.slots.map((sl, i) => ({ def: sl.def, sell: this.sellPrice(sl.def), readout: this.synergy.readout(i) })),
      slots: MAX_MOD_SLOTS,
      rerollCost: this.rerollCost,
      healCost: economyTuning.healCost,
      healed: this.shopHealed || this.player.hp >= this.player.maxHp,
      loadout: this.loadout(),
      stage,
    };
  }

  /** Why a Mod fits this build, shown on its shop card. */
  synergyHint(m: ModDef): string {
    if (!m.synergy) return '';
    const parts = m.synergy
      .map((t) => [t, this.synergy.tagCount(t)] as const)
      .filter(([, n]) => n > 0)
      .map(([t, n]) => `${n} ${t}`);
    return parts.length ? `You have: ${parts.join(', ')}` : '';
  }

  /** Shop actions return an error message, or '' on success. */
  buy(i: number): string {
    const m = this.shopOffers[i];
    if (!m) return 'SOLD OUT';
    if (this.synergy.full) return 'MOD SLOTS FULL: SELL ONE FIRST';
    const cost = this.price(m);
    if (this.gold < cost) return 'NOT ENOUGH GOLD';
    this.gold -= cost;
    this.synergy.add(m);
    this.shopOffers[i] = null;
    this.recomputeStats();
    return '';
  }

  sell(i: number): string {
    const sl = this.synergy.slots[i];
    if (!sl) return 'NOTHING TO SELL';
    this.gold += this.sellPrice(sl.def);
    this.synergy.remove(i);
    this.recomputeStats();
    return '';
  }

  moveMod(i: number, dir: -1 | 1): void {
    this.synergy.move(i, dir);
    this.recomputeStats();
  }

  reroll(): string {
    const cost = this.rerollCost;
    if (this.gold < cost) return 'NOT ENOUGH GOLD';
    this.gold -= cost;
    this.shopRerolls++;
    this.rollShop();
    return '';
  }

  heal(): string {
    if (this.shopHealed) return 'ALREADY HEALED';
    if (this.gold < economyTuning.healCost) return 'NOT ENOUGH GOLD';
    this.gold -= economyTuning.healCost;
    this.shopHealed = true;
    this.player.heal(this.player.maxHp * 0.4);
    return '';
  }
}
