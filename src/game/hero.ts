import { setHeroModel } from './heroModel';
import type * as THREE from 'three';
import type { Rng } from '../core/rng';
import { DEFAULT_LOADOUT, type Loadout } from '../data/loadout';
import { MOD_RARITY_WEIGHT, MODS } from '../data/mods';
import { PASSIVES } from '../data/passives';
import { SPECIALS, cooldownText, specialCooldown, type SpecialDef } from '../data/specials';
import { RARITY, rarityWeight, type Rarity } from '../data/rarity';
import type { Tag } from '../data/tags';
import { RANK_RARITY, buildKey, buildMaxed, buildParams, canEvolve, newBuild, parseBuild, totalRanks, trackTuning, type Build, type Upgradable } from '../data/tracks';
import { WEAPONS } from '../data/weapons';
import type { LoadoutItem, Slot } from '../ui/hud';
import type { Offer, ShopView } from '../ui/screens';
import type { Enemy } from './enemies';
import { modMaxLevel, type ModDef } from './modTypes';
import { Player, dashLevelMul } from './player';
import { computeStats, type Stats } from './stats';
import { MAX_MOD_SLOTS, Synergy, type SynergyHost } from './synergy';
import { createWeapon, type Weapon, type WeaponCtx } from './weapons';
import { SKINS, type SkinDef } from '../data/skins';
import { CURSE_BY_ID, CURSES } from '../data/curses';
import { activeCombos, WEAPON_COMBOS } from '../data/weaponCombos';
import { PET_BY_ID, pets2Tuning } from '../data/pets';
import { PetState, PetView } from './pet';
import { RELIC_BY_ID, rollRelic } from '../data/relics';
import { HEROES, heroClicks, heroOf, type HeroDef } from '../data/heroes';
import { HeroSkill } from './style';
import { banishTuning, canBanish, offerKey } from './banish';
import { HeroMech, attachHeroGear, detachHeroGear } from './heroMechs';
import { fuseWeapons, fusionOfferFor, placeFusion } from './fusion';
import { HeroPlay } from './gameplay';

/** Auto-weapon slots (the loadout's clicks don't use them). */
export const MAX_WEAPONS = 4;
export const MAX_PASSIVES = 6;
/** Gears are spent to reroll level-up cards; you can carry this many. */
export const MAX_GEARS = 5;
export const HERO_COLORS = ['#2f7bff', '#22c76a', '#ffb627', '#d8def0', '#ff5e7a', '#a77bff', '#4ff2ff', '#a7f070']; // 5-8: PvP free-for-all

export const economyTuning = {
  clearGold: 5, // flat gold for clearing a stage
  interestPer: 5, // +1 gold per this much held at stage clear
  interestCap: 10, // max interest per stage; holding 50 gold pays 10
  rerollBase: 2, // first paid reroll; +1 each reroll in the same shop
  startGold: 15, // free gold in the starting shop (not kept)
  healCost: 3,
  shopOffers: 4,
};

export const chestTuning = {
  goldShare: 0.5, // chance a chest holds gold instead of an item level
  gold: 5, // was 10: chests were the biggest gold source
};

export interface ChestFind {
  id: string;
  name: string;
  color: string;
  icon: string;
  text: string;
  rarity: Rarity;
}

/** A loadout item with upgrade tracks, as the level-up cards need it. */
type UpgradeItem = Upgradable & { name: string; icon: string; color: string; iconBase: string };

/** The slot a weapon fills: its click, or an auto-weapon slot. */
function weaponSlot(slot: string | undefined): Slot {
  return slot === 'primary' ? 'left' : slot === 'secondary' ? 'right' : 'auto';
}

/** Icon id for an item's evolution: `<id>_evo` for the first, `<id>_evo2` for the second. */
function evoIconId(base: string, evo: number): string {
  return evo < 0 ? base : evo === 0 ? `${base}_evo` : `${base}_evo${evo + 1}`;
}

/** "Buckshot 2/4 · Choke 1/4", plus the evolution once chosen. */
function trackSummary(def: Upgradable, b: Build): string {
  const parts = (def.tracks ?? []).map((t, i) => `${t.name} ${b.ranks[i]}/${t.ranks.length}`);
  const evo = def.evos?.[b.evo];
  if (evo) parts.push(`${evo.name}${b.od ? ` + Overdrive ${b.od}` : ''}`);
  return parts.join(' · ') + '.';
}

/** What a hero needs from the game (combat, world, randomness). */
export interface HeroWorld {
  readonly scene: THREE.Scene;
  readonly rng: Rng;
  readonly level: number;
  /** 2+ players still in the run: co-op items can be offered. */
  readonly coop: boolean;
  blast(x: number, z: number, r: number, dmg: number, color: string, source: string, tags: Tag[], noStatus: boolean, by: Hero): void;
  zap(from: Enemy, hops: number, dmg: number, by: Hero): void;
  ignite(e: Enemy, dps: number, by: Hero): void;
  shock(e: Enemy, by: Hero): void;
  makeCtx(hero: Hero): WeaponCtx;
  goldFx(hero: Hero, n: number): void;
  /** Team-wide multipliers: combo power-ups and curses. */
  readonly fireRateBuff: number;
  readonly damageBuff: number;
  readonly dashCurse: number;
  readonly shopPriceMul?: number;
  /** Curse ids already in effect (not offered again). */
  readonly activeCurses: readonly string[];
  director2Live?(hero: Hero): void;
}

/** Latest input from a remote player (host side). */
export interface RemoteInput {
  x: number;
  z: number;
  vx: number;
  vz: number;
  ax: number;
  /** Aim distance (mouse cursor), -1 for stick aim. */
  ad: number;
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
  /** Gears held (each rerolls one level-up). */
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
  /** Shop lane: shop offers kept through rerolls and into the next shop (aligned with shopOffers). */
  shopLocked: boolean[] = [];
  /** Shop lane: level-up items banished from this hero's pool this run, and banishes left. */
  banished = new Set<string>();
  banishLeft = 0;
  /** Left click, right click and special picked before the run. */
  loadoutPick: Loadout = { ...DEFAULT_LOADOUT };
  // Special (Q/E)
  bombCharge = 0;
  /** The special on Q/E, from the loadout; level-up cards upgrade it. */
  special = { id: 'bomb', level: 1 };
  /** Specials with upgrade tracks: ranks, evolution and Overdrive taken. */
  specialBuild: Build | null = null;
  private spParams: Record<string, number> | null = null;
  bombT = -1;
  /** The current wave is a Nuke pickup, not the bomb. */
  bombNuke = false;
  bombId = 0;
  bombX = 0;
  bombZ = 0;
  /** Implosion: which wave is running (1 pulls in, 2 blasts) and the pause before wave 2. */
  bombWave = 1;
  bombNext = 0;
  /** Cluster Bomb: bomblets waiting to pop. */
  bomblets: { x: number; z: number; t: number }[] = [];
  // Downed in co-op
  reviveT = 0;
  /** The player disconnected; the hero stays out of play. */
  left = false;
  // Network
  remote: RemoteInput | null = null;
  lastSeen = 0;
  loadoutDirty = true;
  /** Skill layer: style meter, perfect dash, parry and ultimate (src/game/style.ts). */
  readonly skill = new HeroSkill();
  /** Hero mechanic state: Furnace heat, Duelist chain, Twin clone (src/game/heroMechs.ts). */
  readonly mech = new HeroMech();
  /** Gameplay lane: mech suit, super weapon, overload, comeback and relic state (src/game/gameplay.ts). */
  readonly play = new HeroPlay();
  /** Comeback mode: at death's door with no revives left (x2 damage, red screen). For the music and sound. */
  get comeback(): boolean {
    return this.play.comeback;
  }
  private gear: THREE.Object3D[] = [];

  constructor(
    private world: HeroWorld,
    readonly index: number,
    public name: string,
    readonly color: string,
    /** Weapons this player's own save has unlocked. */
    public unlocked: string[],
    readonly peerId = '',
    public skin: SkinDef = SKINS[0],
    petId = 'none',
    heroId = 'rookie',
  ) {
    this.player = new Player(world.scene, color, skin);
    this.setPet(petId);
    this.setHeroDef(heroId);
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

  /** Tags for a damage source: the owned weapon's (with its evolution's), else the def's. */
  tagsOf(source: string): readonly Tag[] | undefined {
    for (const w of this.weapons) if (w.def.id === source) return w.tags;
    return WEAPONS[source]?.tags;
  }

  get alive(): boolean {
    return !this.player.dead;
  }

  // ---------------------------------------------------------------- run lifecycle

  /** Relic ids (src/data/relics.ts), and their per-run state. */
  relics: string[] = [];
  phoenixUsed = false;
  fangKills = 0;
  /** The curse this hero's shop is offering (null = none / taken). */
  curseOffer: string | null = null;

  private comboKey = '';
  private comboSet = new Set<string>();

  /** Weapon combos unlocked by the weapons this hero holds. */
  get combos(): ReadonlySet<string> {
    const key = this.weapons.map((w) => w.def.id).join();
    if (key !== this.comboKey) {
      this.comboKey = key;
      this.comboSet = new Set(activeCombos(this.weapons.map((w) => w.def.id)).map((c) => c.id));
    }
    return this.comboSet;
  }

  hasRelic(id: string): boolean {
    return this.relics.includes(id);
  }

  /** Combos already announced this run. */
  combosSeen = new Set<string>();

  /** Fresh run: the loadout's two clicks and special, no passives or Mods. */
  startRun(): void {
    this.combosSeen.clear();
    this.relics = [];
    this.phoenixUsed = false;
    this.fangKills = 0;
    this.curseOffer = null;
    this.disposeWeapons();
    const lo = this.loadoutPick;
    const clicks = heroClicks(this.heroDef, lo); // the Ronin's sword and the Tinker's beacon replace loadout clicks
    this.weapons = [createWeapon(clicks.primary, this.world.scene), createWeapon(clicks.secondary, this.world.scene)];
    // The hero's own starting auto weapons (src/data/heroes.ts).
    for (const id of this.heroDef.start) {
      if (WEAPONS[id] && !WEAPONS[id].slot && !this.weapons.some((w) => w.def.id === id)) this.weapons.push(createWeapon(id, this.world.scene));
    }
    this.passives = {};
    this.synergy.reset();
    this.gold = this.dashes = 0;
    this.damageBy = {};
    this.pendingLevels = this.chestsPending = 0;
    this.setSpecial(lo.special);
    this.bombCharge = 0;
    this.bombT = -1;
    this.bombNext = 0;
    this.bomblets.length = 0;
    this.reviveT = 0;
    this.shopDone = true;
    this.shopOffers = [];
    this.shopLocked = [];
    this.banished.clear();
    this.banishLeft = banishTuning.start;
    this.skill.reset();
    this.mech.reset();
    this.play.reset();
    this.player.noDash = this.mech.id === 'duelist'; // a mech suit from the last run may have switched the dash off
    this.petState.reset();
    this.recomputeStats();
    this.rerollsLeft = Math.min(MAX_GEARS, this.stats.rerolls);
    this.revivesLeft = this.stats.revives;
    this.player.reset(this.stats);
    this.mech.twin?.snap();
    this.loadoutDirty = true;
  }

  disposeWeapons(): void {
    for (const w of this.weapons) w.dispose();
    this.weapons = [];
  }

  dispose(): void {
    this.disposeWeapons();
    this.mech.twin?.dispose();
    this.mech.twin = null;
    this.player.dispose();
    this.petView?.dispose();
  }

  /** Playable hero (src/data/heroes.ts): starting kit and stat quirks. */
  heroDef: HeroDef = HEROES[0];

  setHeroDef(id: string): void {
    this.heroDef = heroOf(id);
    setHeroModel(this.player.rig, this.heroDef.id);
    const [w, h] = this.heroDef.build;
    this.player.rig.body.scale.set(w, h, w);
    this.player.buildScale = [w, h];
    // Mechanic heroes: their gear (silhouette), no dash for the Duelist, and the Twin's clone (made on first use).
    const mech = this.heroDef.mech ?? '';
    if (mech !== this.mech.id || !this.gear.length) {
      detachHeroGear(this.player.rig, this.gear);
      this.gear = attachHeroGear(this.player.rig, this.heroDef.mech);
    }
    this.mech.id = mech;
    this.player.noDash = mech === 'duelist';
    if (mech !== 'twin' && this.mech.twin) {
      this.mech.twin.dispose();
      this.mech.twin = null;
    }
  }

  /** Companion (src/data/pets.ts); its body is drawn by PetView. */
  pet = 'none';
  petView: PetView | null = null;
  /** The pet's level, skills and timers this run (src/game/systems/companion.ts). */
  readonly petState = new PetState();
  /** Last ping time (ms), for rate limiting. */
  pingAt = -Infinity;
  /** What last hurt this hero (run history: cause of death). */
  lastHitBy = '';
  /** Lava burn cooldown. */
  lavaT = 0;

  setPet(id: string): void {
    const def = PET_BY_ID[id] ?? PET_BY_ID.none;
    if (def.id === this.pet && (this.petView || def.id === 'none')) return;
    this.pet = def.id;
    this.petState.setDef(def);
    this.petView?.dispose();
    this.petView = def.id === 'none' ? null : new PetView(this.world.scene, def, this.petState);
  }

  /** Rebuild static stats (passives + Mods) and the live copy. */
  recomputeStats(): void {
    this.statBase = this.statsWithPassives(this.passives);
    this.refreshLive();
    this.player.stats = this.stats;
    this.player.hp = Math.min(this.player.hp, this.stats.maxHp);
  }

  /** Static stats for these passive levels (and Mods): what recomputeStats builds, without applying it (card previews). */
  statsWithPassives(passives: Record<string, number>, syn: Pick<Synergy, 'applyStatic'> = this.synergy): Stats {
    const s = computeStats(
      passives,
      this.heroDef.add,
      this.relics.map((id) => RELIC_BY_ID[id]?.add ?? {}),
    );
    s.magnet += this.petState.magnetBonus;
    s.critChance = Math.min(1, s.critChance + this.petState.ranks.lucky * pets2Tuning.luckyCrit);
    syn.applyStatic(s);
    return s;
  }

  /** Live stats = static stats + per-step Mod effects (moving, timers). */
  refreshLive(): void {
    Object.assign(this.stats, this.statBase);
    this.synergy.applyLive(this.stats);
    this.stats.dashCooldownMul *= dashLevelMul(this.world.level) * this.world.dashCurse;
    this.stats.cooldownMul *= this.world.fireRateBuff;
    this.stats.damageMul *= this.world.damageBuff;
    this.stats.damageMul *= this.skill.damageMul;
    this.stats.damageMul *= this.mech.damageMul;
    this.play.applyLive(this.stats);
    this.world.director2Live?.(this);
  }

  get specialDef(): SpecialDef {
    return SPECIALS[this.special.id] ?? SPECIALS.bomb;
  }

  setSpecial(id: string): void {
    this.special = { id, level: 1 };
    this.specialBuild = SPECIALS[id]?.tracks ? newBuild(SPECIALS[id]) : null;
    this.spParams = null;
  }

  /** Client: mirror the host's special build. */
  setSpecialBuild(key: string): void {
    if (!this.specialBuild || key === buildKey(this.specialBuild)) return;
    this.specialBuild = parseBuild(key, this.specialDef);
    this.spParams = null;
    this.loadoutDirty = true;
  }

  /** Seconds for the special's meter to refill (upgrades and Battery Pack). */
  get specialCooldown(): number {
    return specialCooldown(this.specialP, this.stats.specialCooldownMul);
  }

  /** Params for the special's current level (or build). */
  get specialP(): Record<string, number> {
    const def = this.specialDef;
    if (this.specialBuild) return (this.spParams ??= buildParams(def.levels[0].p, def, this.specialBuild));
    return def.levels[Math.min(this.special.level, def.levels.length) - 1].p;
  }

  /** The special's chosen evolution ('' before evolving or for level-ladder specials). */
  get specialEvo(): string {
    return (this.specialBuild && this.specialDef.evos?.[this.specialBuild.evo]?.id) || '';
  }

  private get specialView(): { name: string; color: string; iconId: string; level: number; max: boolean } {
    const def = this.specialDef;
    const b = this.specialBuild;
    if (!b) return { name: def.name, color: def.color, iconId: 'sp_' + def.id, level: this.special.level, max: this.special.level >= def.levels.length };
    const evo = def.evos?.[b.evo];
    return {
      name: evo?.name ?? def.name,
      color: evo?.color ?? def.color,
      iconId: evoIconId('sp_' + def.id, b.evo),
      level: 1 + totalRanks(b) + (b.evo >= 0 ? 1 : 0) + b.od,
      max: buildMaxed(def, b),
    };
  }

  loadout(): LoadoutItem[] {
    const sp = this.specialDef;
    const sv = this.specialView;
    const spNow = this.specialBuild ? trackSummary(sp, this.specialBuild) : `Now: ${sp.levels[this.special.level - 1].text}`;
    return [
      {
        id: sv.iconId,
        icon: sp.icon,
        color: sv.color,
        level: sv.level,
        max: sv.max,
        evo: !!this.specialEvo,
        name: sv.name,
        // Loadout items have no rarity: you pick them, nothing rolls them.
        desc: `${sp.desc} ${spNow} Cooldown ${cooldownText(this.specialCooldown)}.`,
        kind: 'weapon' as const,
        slot: 'special' as const,
      },
      ...this.weapons.map((w) => ({
        id: w.iconId,
        icon: w.def.icon,
        color: w.color,
        level: w.level,
        max: w.maxed,
        evo: w.evolved,
        name: w.name,
        rarity: w.def.slot ? undefined : w.def.rarity,
        desc: `${w.def.desc.replace(/^(LEFT|RIGHT) CLICK: /, '')} ${w.build ? trackSummary(w.def, w.build) : `Now: ${w.partnerEvolved ? w.def.evolution!.text : w.def.levels[w.level - 1].text}`}${this.partnerTip(w)}`,
        kind: 'weapon' as const,
        slot: weaponSlot(w.def.slot),
      })),
      ...Object.entries(this.passives).map(([id, lv]) => {
        const d = PASSIVES[id];
        return { id, icon: d.icon, color: d.color, level: lv, max: lv >= d.maxLevel, name: d.name, rarity: d.rarity, desc: `${d.desc} (x${lv})${this.weapons.filter((w) => w.def.evolution?.passive === id && !w.evolved).map((w) => ` Partner of ${w.def.name}: max it to evolve into ${w.def.evolution!.name}.`).join('')}`, kind: 'passive' as const, slot: 'item' as const };
      }),
    ];
  }

  /** Tooltip line for an auto weapon that can still evolve with its partner item. */
  private partnerTip(w: Weapon): string {
    const evo = w.def.evolution;
    if (!evo || w.evolved) return '';
    const own = (this.passives[evo.passive] ?? 0) > 0;
    return ` EVOLVE: max it + ${PASSIVES[evo.passive].name}${own ? ' (owned)' : ''} = ${evo.name}.`;
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

  /** An auto weapon at its last level whose partner item this hero owns (src/data/weapons.ts `evolution`). */
  canEvolve(w: Weapon): boolean {
    const evo = w.def.evolution;
    return !!evo && !w.build && w.maxed && !w.evolved && (this.passives[evo.passive] ?? 0) > 0;
  }

  private evolveOffer(w: Weapon): Offer {
    const evo = w.def.evolution!;
    return { kind: 'evolve', id: w.def.id, name: evo.name, icon: w.def.icon, color: evo.color, tag: 'EVOLVE!', text: evo.text, tags: w.def.tags, rarity: 'legendary', label: 'AUTO WEAPON EVOLUTION', slot: 'auto' };
  }

  /** The evolution strip on an auto weapon's cards and its partner item's cards (ticks show what you already have). */
  private partnerOf(weaponId: string): Offer['partner'] {
    const evo = WEAPONS[weaponId]?.evolution;
    const w = this.weapons.find((x) => x.def.id === weaponId);
    if (!evo || w?.evolved) return undefined;
    return { weapon: weaponId, passive: evo.passive, haveWeapon: !!w?.maxed, haveItem: (this.passives[evo.passive] ?? 0) > 0 };
  }

  /**
   * Draw level-up cards. `keep` (banish): those cards stay in place and only
   * the null slots are redrawn, never repeating a kept card.
   */
  buildOffers(keep?: (Offer | null)[]): Offer[] {
    type Cand = Offer & { w: number };
    const cands: Cand[] = [];
    // Everything, new or an upgrade, shows up at its own rarity's rate: a
    // legendary's levels are as rare as the legendary itself (user: they maxed too fast).
    const luck = this.stats.luck;
    const fresh = (r: Rarity) => rarityWeight(r, luck);
    const upgrade = fresh;
    // The loadout's upgrade tracks; the first item that can evolve forces its two-way choice.
    let fork: Offer[] = [];
    const upgradable = (ref: string, def: UpgradeItem, b: Build, label: string, slot: Slot) => {
      if (canEvolve(def, b)) {
        if (!fork.length) {
          fork = def.evos!.map((e, k) => ({ kind: 'evo' as const, id: evoIconId(def.iconBase, k), pick: `${ref}|e|${k}`, name: e.name, icon: def.icon, color: e.color, tag: 'EVOLVE!', text: e.text, tags: e.tags, rarity: 'legendary' as const, label: `${label} EVOLUTION`, slot }));
        }
        return;
      }
      const color = def.evos?.[b.evo]?.color ?? def.color;
      if (buildMaxed(def, b)) {
        const text = `+${Math.round(trackTuning.overdrive * 100)}% damage, repeatable.`;
        cands.push({ kind: 'overdrive', id: evoIconId(def.iconBase, b.evo), pick: `${ref}|od`, name: 'Overdrive', icon: def.icon, color, tag: `OVERDRIVE ${b.od + 1}`, text, rarity: 'uncommon', label, slot, w: 1.2 * upgrade('uncommon') });
        return;
      }
      (def.tracks ?? []).forEach((t, k) => {
        const r = b.ranks[k];
        if (r >= t.ranks.length) return;
        const rarity = RANK_RARITY[Math.min(r, RANK_RARITY.length - 1)];
        cands.push({ kind: 'track', id: evoIconId(def.iconBase, b.evo), pick: `${ref}|t|${k}`, name: t.name, icon: def.icon, color, tag: `RANK ${r + 1}`, text: t.ranks[r].text, rarity, level: r, maxLevel: t.ranks.length, label, slot, w: 4 * upgrade(rarity) });
      });
    };
    for (const w of this.weapons) {
      if (w.build) {
        upgradable(w.def.id, { ...w.def, iconBase: w.def.id }, w.build, w.def.name.toUpperCase(), weaponSlot(w.def.slot));
        continue;
      }
      if (w.maxed) continue;
      const next = w.def.levels[w.level];
      const rarity = w.def.rarity;
      if (w.def.evo && w.level + 1 === w.def.levels.length) {
        const evo = w.def.evo;
        cands.push({ kind: 'weapon', id: w.def.id + '_evo', name: evo.name, icon: w.def.icon, color: evo.color, tag: 'EVOLVE!', text: next.text, tags: w.def.tags, rarity, level: w.level, maxLevel: w.def.levels.length, slot: weaponSlot(w.def.slot), w: 4 * upgrade(rarity) });
        continue;
      }
      // Loadout weapons without tracks yet weigh more, so they keep up with track ranks.
      const kindW = w.def.slot ? 4 : 3;
      cands.push({ kind: 'weapon', id: w.def.id, name: w.def.name, icon: w.def.icon, color: w.def.color, tag: `LV ${w.level + 1}`, text: next.text, tags: w.def.tags, rarity, level: w.level, maxLevel: w.def.evo ? w.def.levels.length - 1 : w.def.levels.length, slot: weaponSlot(w.def.slot), partner: this.partnerOf(w.def.id), w: kindW * upgrade(rarity) });
    }
    // New auto weapons, while slots are free. Loadout weapons are picked before the run.
    const autoCount = this.weapons.filter((w) => !w.def.slot).length;
    for (const id of this.unlocked) {
      const d = WEAPONS[id];
      if (!d || d.slot || d.fusion || autoCount >= MAX_WEAPONS || this.weapons.some((w) => w.def.id === id)) continue;
      // Say which weapon combo it completes (src/data/weaponCombos.ts), and weigh it up a little.
      const owned = this.weapons.map((w) => w.def.id);
      const made = WEAPON_COMBOS.filter((c) => c.weapons.includes(id) && owned.includes(c.weapons[0] === id ? c.weapons[1] : c.weapons[0]));
      const hint = made.length ? ` COMBO: ${made.map((c) => c.name).join(', ')}!` : '';
      cands.push({ kind: 'weapon', id, name: d.name, icon: d.icon, color: d.color, tag: 'NEW!', text: d.desc + hint, tags: d.tags, rarity: d.rarity, slot: 'auto', partner: this.partnerOf(id), w: (made.length ? 3.2 : 2.4) * fresh(d.rarity) });
    }
    // The special: its tracks, or its next level.
    const sp = this.specialDef;
    if (this.specialBuild) upgradable('sp', { ...sp, iconBase: 'sp_' + sp.id }, this.specialBuild, sp.name.toUpperCase(), 'special');
    else if (this.special.level < sp.levels.length) {
      const lv = this.special.level;
      const cd = cooldownText(specialCooldown(sp.levels[lv].p, this.stats.specialCooldownMul));
      cands.push({ kind: 'special', id: 'sp_' + sp.id, name: sp.name, icon: sp.icon, color: sp.color, tag: `LV ${lv + 1}`, text: `${sp.levels[lv].text} Cooldown ${cd}.`, rarity: sp.rarity, level: lv, maxLevel: sp.levels.length, slot: 'special', w: 4 * upgrade(sp.rarity) });
    }
    const owned = Object.keys(this.passives).length;
    for (const [id, d] of Object.entries(PASSIVES)) {
      if (d.coop && !this.world.coop) continue;
      const lv = this.passives[id] ?? 0;
      if (lv >= d.maxLevel || (lv === 0 && owned >= MAX_PASSIVES)) continue;
      // A new item that is an unlocked auto weapon's partner shows the evolution it leads to.
      const partnerOf = lv === 0 ? this.unlocked.find((wid) => WEAPONS[wid]?.evolution?.passive === id) : undefined;
      cands.push({ kind: 'passive', id, name: d.name, icon: d.icon, color: d.color, tag: lv ? `LV ${lv + 1}` : 'NEW!', text: d.desc, partner: partnerOf ? this.partnerOf(partnerOf) : undefined, rarity: d.rarity, level: lv, maxLevel: d.maxLevel, slot: 'item', w: lv ? 1.8 * upgrade(d.rarity) : 0.8 * fresh(d.rarity) });
    }
    // Banished items never come back this run.
    if (this.banished.size) for (let i = cands.length - 1; i >= 0; i--) if (this.banished.has(offerKey(cands[i]))) cands.splice(i, 1);
    if (keep) {
      const shown = new Set(keep.filter((o): o is Offer => !!o).map(offerKey));
      const pool = cands.filter((c) => !shown.has(offerKey(c)));
      return keep.map((o) => {
        if (o) return o;
        if (!pool.length) return { kind: 'gold', id: 'gold', name: 'Gold Bag', icon: '●', color: '#ffb627', tag: 'BONUS', text: `+${2 * this.skipGold} gold`, slot: 'bonus' } as Offer;
        let r = this.rng.next() * pool.reduce((a, c) => a + c.w, 0);
        let i = 0;
        while (i < pool.length - 1 && (r -= pool[i].w) > 0) i++;
        const { w: _w, ...offer } = pool.splice(i, 1)[0];
        return offer;
      });
    }
    // Late runs: when the pool runs dry, mix in gold and healing.
    if (cands.length + fork.length < 3) {
      cands.push(
        { kind: 'gold', id: 'gold', name: 'Gold Bag', icon: '●', color: '#ffb627', tag: 'BONUS', text: `+${2 * this.skipGold} gold`, slot: 'bonus', w: 2 },
        { kind: 'heal', id: 'heal', name: 'Snack', icon: '♥', color: '#ff5e7a', tag: 'BONUS', text: 'Heal 40 life', slot: 'bonus', w: 2 },
      );
    }
    const out: Offer[] = [...fork];
    // A ready auto-weapon evolution (maxed weapon + its partner item) is always on offer.
    const ready = this.weapons.filter((w) => this.canEvolve(w));
    if (ready.length && out.length < 3) out.push(this.evolveOffer(ready[Math.floor(this.rng.next() * ready.length)]));
    while (out.length < 3 && cands.length) {
      let r = this.rng.next() * cands.reduce((a, c) => a + c.w, 0);
      let i = 0;
      while (i < cands.length - 1 && (r -= cands[i].w) > 0) i++;
      const { w: _w, ...offer } = cands.splice(i, 1)[0];
      out.push(offer);
    }
    // Two maxed auto weapons that fuse: a FUSION card (src/game/fusion.ts).
    return placeFusion(out, fusionOfferFor(this.weapons, () => this.rng.next()));
  }

  /** Apply a level-up card. Returns its color (for the pickup burst). */
  applyOffer(o: Offer): string {
    if (o.kind === 'track' || o.kind === 'evo' || o.kind === 'overdrive') {
      const [ref, what, k] = (o.pick ?? '').split('|');
      const n = Number(k);
      if (ref === 'sp') {
        const b = this.specialBuild;
        if (b) {
          if (what === 't') b.ranks[n] = Math.min(this.specialDef.tracks![n].ranks.length, b.ranks[n] + 1);
          else if (what === 'e' && b.evo < 0) b.evo = n;
          else if (what === 'od') b.od++;
          this.spParams = null;
        }
      } else {
        const w = this.weapons.find((x) => x.def.id === ref);
        if (what === 't') w?.addRank(n);
        else if (what === 'e') w?.evolve(n);
        else if (what === 'od') w?.overdrive();
      }
    } else if (o.kind === 'weapon') {
      const id = o.id.replace(/_evo$/, '');
      const w = this.weapons.find((x) => x.def.id === id);
      if (w) w.levelUp();
      else this.weapons.push(createWeapon(id, this.world.scene));
    } else if (o.kind === 'fusion') {
      fuseWeapons(this.weapons, o.id, this.world.scene);
    } else if (o.kind === 'evolve') {
      this.weapons.find((x) => x.def.id === o.id)?.evolve();
    } else if (o.kind === 'special') {
      this.special.level = Math.min(this.specialDef.levels.length, this.special.level + 1);
    } else if (o.kind === 'passive') {
      this.passives[o.id] = (this.passives[o.id] ?? 0) + 1;
      this.recomputeStats();
      const heal = PASSIVES[o.id].healOnPick;
      if (heal) this.player.heal(heal);
    } else if (o.kind === 'gold') this.gold += 2 * this.skipGold;
    else if (o.kind === 'heal') this.player.heal(40);
    this.player.hp = Math.min(this.player.hp, this.player.maxHp);
    this.loadoutDirty = true;
    return o.color;
  }

  /** Banish level-up card i: its item leaves this hero's pool for the run and the card is redrawn. '' on success. */
  banish(i: number): string {
    const o = this.offers[i];
    if (!o) return 'NOTHING TO BANISH';
    if (!canBanish(o)) return "CAN'T BANISH THIS CARD";
    if (this.banishLeft <= 0) return 'NO BANISHES LEFT';
    this.banishLeft--;
    this.banished.add(offerKey(o));
    this.offers = this.buildOffers(this.offers.map((x, j) => (j === i ? null : x)));
    return '';
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
  chestItem(): ChestFind {
    // Half of all chests are a gold stash: chests every 30 s were maxing builds by stage 3 (user).
    if (this.rng.next() < chestTuning.goldShare) return this.chestGold();
    const passives = Object.values(PASSIVES).filter((d) => {
      if (d.coop && !this.world.coop) return false;
      const lv = this.passives[d.id] ?? 0;
      return lv > 0 && lv < d.maxLevel;
    });
    if (passives.length) {
      // Rarer items come out of chests less often too (Luck helps).
      const w = (r: Rarity) => rarityWeight(r, this.stats.luck);
      let r = this.rng.next() * passives.reduce((a, d) => a + w(d.rarity), 0);
      let i = 0;
      while (i < passives.length - 1 && (r -= w(passives[i].rarity)) > 0) i++;
      const d = passives[i];
      const lv = (this.passives[d.id] ?? 0) + 1;
      this.applyOffer({ kind: 'passive', id: d.id, name: d.name, icon: d.icon, color: d.color, tag: '', text: d.desc });
      return { id: d.id, name: d.name, color: d.color, icon: d.icon, text: lv > 1 ? `LV ${lv}` : 'NEW', rarity: d.rarity };
    }
    // Auto weapons only: the loadout grows through level-up choices. Evolutions are never a chest surprise.
    const weapons = this.weapons.filter((w) => !w.def.slot && !w.maxed && !(w.def.evo && w.level + 1 === w.def.levels.length));
    if (weapons.length) {
      const w = weapons[Math.floor(this.rng.next() * weapons.length)];
      w.levelUp();
      this.loadoutDirty = true;
      return { id: w.iconId, name: w.name, color: w.color, icon: w.def.icon, text: `AUTO WEAPON LV ${w.level}`, rarity: w.def.rarity };
    }
    return this.chestGold();
  }

  private chestGold(): ChestFind {
    this.gold += chestTuning.gold;
    return { id: 'gold', name: 'Gold', color: '#ffb627', icon: '●', text: `+${chestTuning.gold}`, rarity: 'common' };
  }

  // ---------------------------------------------------------------- shop

  /** This visit is the secret merchant: rare and cursed Mods at 25% off, plus a free pick of one of these relics. */
  secretShop = false;
  relicOffers: string[] = [];

  /** `pre`: the starting shop before stage 1 (its gold isn't kept, so no curse deals there). */
  openShop(secret = false, pre = false): void {
    this.shopRerolls = 0;
    this.shopHealed = false;
    this.shopDone = false;
    this.secretShop = secret;
    this.relicOffers = [];
    for (let k = 0; secret && k < 3; k++) {
      const r = rollRelic([...this.relics, ...this.relicOffers], this.stats.luck, () => this.rng.next());
      if (r) this.relicOffers.push(r.id);
    }
    if (!pre) this.banishLeft = Math.min(banishTuning.max, this.banishLeft + banishTuning.perShop);
    this.rollShop();
    const left = CURSES.filter((c) => !this.world.activeCurses.includes(c.id));
    this.curseOffer = !pre && left.length && this.rng.chance(0.85) ? left[Math.floor(this.rng.next() * left.length)].id : null;
  }

  rollShop(): void {
    // Locked offers stay on their card (rerolls and the next shop) until bought or unlocked.
    const kept = this.shopOffers.map((m, i) => (m && (!m.coop || this.world.coop) && this.shopLocked[i] && !this.synergy.owns(m.id) ? m : null));
    const pool = MODS.filter((m) => (!m.coop || this.world.coop) && !this.synergy.owns(m.id) && !kept.includes(m) && (!this.secretShop || m.rarity === 'rare' || m.rarity === 'legendary' || m.cursed));
    // Luck lifts the rarer Mods, like level-up cards.
    const w = (m: ModDef) => MOD_RARITY_WEIGHT[m.rarity] * (1 + this.stats.luck * RARITY[m.rarity].luck);
    this.shopOffers = [];
    this.shopLocked = [];
    for (let k = 0; k < Math.max(economyTuning.shopOffers, kept.length); k++) {
      if (kept[k]) {
        this.shopOffers.push(kept[k]);
        this.shopLocked.push(true);
        continue;
      }
      if (!pool.length) continue;
      let r = this.rng.next() * pool.reduce((a, m) => a + w(m), 0);
      let i = 0;
      while (i < pool.length - 1 && (r -= w(pool[i])) > 0) i++;
      this.shopOffers.push(pool.splice(i, 1)[0]);
      this.shopLocked.push(false);
    }
  }

  /** Lock or unlock shop offer i. '' on success. */
  toggleLock(i: number): string {
    if (!this.shopOffers[i]) return 'SOLD OUT';
    this.shopLocked[i] = !this.shopLocked[i];
    return '';
  }

  /** Take one of the secret merchant's relics: relics are free (user), the others go away. */
  buyRelic(i: number): string {
    const id = this.relicOffers[i];
    if (!id) return 'SOLD OUT';
    this.relics.push(id);
    this.relicOffers = [];
    this.recomputeStats();
    return '';
  }

  price(m: ModDef): number {
    return Math.max(1, Math.round(m.price * (this.world.shopPriceMul ?? 1) * (1 - Math.min(0.5, this.synergy.flags.shopDiscount)) * (this.secretShop ? 0.75 : 1)));
  }

  /** Half of what you actually paid (purchase + upgrades). */
  sellPrice(paid: number): number {
    return this.synergy.flags.sellFull ? paid : Math.floor(paid / 2);
  }

  /** Gold to take an owned Mod from `level` to level + 1: its price, then 1.5x. */
  upgradeCost(m: ModDef, level: number): number {
    return Math.round(this.price(m) * (level === 1 ? 1 : 1.5));
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

  shopView(stage: number, pre = false): ShopView {
    return {
      pre,
      gold: this.gold,
      interest: this.interest,
      interestCap: this.interestCap,
      interestPer: this.interestPer,
      offers: this.shopOffers.map((m, i) => (m ? { def: m, price: this.price(m), hint: this.synergyHint(m), locked: !!this.shopLocked[i] } : null)),
      owned: this.synergy.slots.map((sl, i) => ({
        def: sl.def,
        sell: this.sellPrice(sl.paid),
        readout: this.synergy.readout(i),
        level: sl.level,
        maxLevel: modMaxLevel(sl.def),
        upCost: this.synergy.canUpgrade(i) ? this.upgradeCost(sl.def, sl.level) : -1,
      })),
      slots: MAX_MOD_SLOTS,
      rerollCost: this.rerollCost,
      healCost: economyTuning.healCost,
      healed: this.shopHealed || this.player.hp >= this.player.maxHp,
      loadout: this.loadout(),
      stage,
      secret: this.secretShop,
      relicOffers: this.relicOffers.map((id) => RELIC_BY_ID[id]),
      relics: this.relics,
      curse: this.curseOffer && !this.world.activeCurses.includes(this.curseOffer) ? (({ id, name, desc, icon, color, gold, score }) => ({ id, name, desc, icon, color, gold, score }))(CURSE_BY_ID[this.curseOffer]) : null,
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
    this.synergy.add(m, cost);
    this.shopOffers[i] = null;
    this.shopLocked[i] = false;
    this.recomputeStats();
    return '';
  }

  /** Upgrade an owned Mod (acts like one more stacked copy). */
  upgradeMod(i: number): string {
    const sl = this.synergy.slots[i];
    if (!sl) return 'NOTHING TO UPGRADE';
    if (!this.synergy.canUpgrade(i)) return 'ALREADY MAX LEVEL';
    const cost = this.upgradeCost(sl.def, sl.level);
    if (this.gold < cost) return 'NOT ENOUGH GOLD';
    this.gold -= cost;
    this.synergy.upgrade(i, cost);
    this.recomputeStats();
    return '';
  }

  sell(i: number): string {
    const sl = this.synergy.slots[i];
    if (!sl) return 'NOTHING TO SELL';
    this.gold += this.sellPrice(sl.paid);
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
