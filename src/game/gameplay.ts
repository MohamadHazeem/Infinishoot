import type { Tag } from '../data/tags';
import { buildMaxed } from '../data/tracks';
import type { Stats } from './stats';
import type { Weapon } from './weapons';

/**
 * Gameplay lane: mech suits, supply crates with super weapons, build-defining
 * relics, enemy mutations, weapon overload, combo cash-ins, the chain-reaction
 * finale and the comeback mode. This file is the pure part (tuning, per-hero
 * state, rules); the Game side lives in src/game/systems/gameplay.ts, the
 * meshes in src/game/gameplayView.ts, the HUD in src/ui/gameplayHud.ts and
 * the temporary weapons in src/game/weapons/super.ts.
 */

// ---------------------------------------------------------------- tuning

/** Mech suit: a rare drop; walk into it to pilot a giant mech for 30 s. */
export const mechTuning = {
  duration: 30,
  /** Per normal kill (thinned with the horde like hearts and magnets), per elite kill. */
  dropChance: 0.0003,
  eliteChance: 0.04,
  /** Seconds between mech drops, and how long a dropped suit waits on the ground. */
  dropCooldown: 90,
  dropLife: 40,
  speedMul: 0.72,
  /** Flat armour while piloting (+ per stage): most small hits do 1 damage. */
  armor: 8,
  armorPerStage: 4,
  /** Arm cannons: shots a second (alternating arms), damage, auto-aim range when not firing. */
  cannonRate: 7,
  cannonDmg: 22,
  cannonRange: 20,
  /** Shoulder missile salvo. */
  salvoEvery: 2.4,
  salvoCount: 6,
  missileDmg: 34,
  missileBlast: 2.2,
  missileTurn: 7,
  /** Walking: a heavy step every `stepEvery` s; every `stompEvery`-th step is a stomp shockwave. */
  stepEvery: 0.5,
  stompEvery: 3,
  stompRadius: 3.4,
  stompDmg: 30,
  /** Ejection blast when the timer runs out. */
  ejectRadius: 6.5,
  ejectDmg: 120,
  /** Mech, super weapon and relic damage grows with enemy life: x (director.hpMul ^ powerExp). */
  powerExp: 0.8,
};

/** Supply drops from the sky: a flare marks the spot, a crate lands, whoever grabs it gets a super weapon. */
export const crateTuning = {
  first: 40,
  every: [55, 85] as [number, number],
  fall: 3,
  life: 25,
  max: 2,
  /** Lands this far (m) from a random living hero. */
  near: [8, 18] as [number, number],
  grab: 1.5,
};

export type SuperId = 'minigun' | 'railgun' | 'flamer';

export interface SuperDef {
  id: SuperId;
  name: string;
  color: string;
  /** Ammo (shots, or seconds of fire for the flamethrower) and the time limit. */
  ammo: number;
  time: number;
  /** Base damage per hit (x power). */
  dmg: number;
  desc: string;
  glyph: string;
}

export const SUPERS: Record<SuperId, SuperDef> = {
  minigun: { id: 'minigun', name: 'Minigun', color: '#ffd23f', ammo: 420, time: 15, dmg: 8, desc: 'Spins up to 30 shots a second.', glyph: '≡' },
  railgun: { id: 'railgun', name: 'Railgun', color: '#7df9ff', ammo: 14, time: 15, dmg: 170, desc: 'A line of lightning that pierces everything.', glyph: '─' },
  flamer: { id: 'flamer', name: 'Flamethrower', color: '#ff7a2f', ammo: 12, time: 15, dmg: 5, desc: 'A cone of fire that burns what it licks.', glyph: '♨' },
};
export const SUPER_IDS = Object.keys(SUPERS) as SuperId[];

/** Super weapon handling (the defs above hold ammo, time and damage). */
export const superTuning = {
  minigunSpin: 1, // seconds to spin up
  minigunRate: [8, 30] as [number, number],
  minigunSpread: 0.1,
  railgunEvery: 0.5,
  railgunLength: 30,
  railgunWidth: 0.7,
  flamerRate: 30,
  flamerSpread: 0.45,
  flamerRange: 0.35, // life (s) of a flame puff
};

/** Weapon overload: every weapon slot maxed fills a meter; full, the hero fires everything at once. */
export const overloadTuning = {
  /** Seconds of eligibility to fill the meter. */
  charge: 25,
  duration: 5,
  /** Weapon cooldowns x this while it runs. */
  cooldownMul: 0.35,
  volleyEvery: 0.08,
  volleyShots: 4,
  volleyDmg: 16,
  volleySpeed: 22,
};

export interface CashTier {
  id: 'heal' | 'bomb' | 'gold';
  name: string;
  color: string;
  /** Combo it costs (rises within a stage, see `growth`). */
  cost: number;
}

/** Combo cash-in: spend the team combo for an instant effect; costs rise x(1 + growth) per cash-in this stage. */
export const cashTuning = {
  tiers: [
    { id: 'heal', name: 'HEAL', color: '#ff5e7a', cost: 40 },
    { id: 'bomb', name: 'BOMB', color: '#ffb627', cost: 80 },
    { id: 'gold', name: 'GOLD RAIN', color: '#ffcd75', cost: 150 },
  ] as CashTier[],
  growth: 0.5,
  /** Heal: share of max life for every living hero, + per combo cashed, capped. */
  healBase: 0.15,
  healPerCombo: 0.001,
  healMax: 0.6,
  /** Bomb: radius and damage grow with the combo cashed. */
  bombRadius: 7,
  bombRadiusPerCombo: 0.01,
  bombRadiusMax: 12,
  bombDmg: 40,
  bombDmgPerCombo: 0.5,
  /** Gold rain: coins = base + combo / perCoin, capped. */
  goldBase: 3,
  goldPerCoin: 30,
  goldMax: 25,
};

/** Enemy mutations: enemies left alive too long mutate into stronger forms (never bosses). */
export const mutationTuning = {
  /** Seconds alive before mutating. */
  after: 40,
  /** Mutated enemies alive at once (the oldest mutate first). */
  maxAlive: 30,
  hpMul: 2.5,
  speedMul: 1.25,
  dmgMul: 1.3,
  scale: 1.22,
  /** Kill rewards: extra XP and score x this. */
  rewardMul: 2,
  /** Their extra attack: a ring of spit bullets. */
  spitEvery: 4,
  spitShots: 6,
  spitSpeed: 8,
  /** x the enemy's contact damage. */
  spitDmg: 0.6,
  enabled: true,
};

/** Comeback: at death's door with no revives left, damage doubles until healed above the line. */
export const comebackTuning = {
  /** Share of max life (at least 1 life) that counts as death's door. */
  hpFrac: 0.1,
  damageMul: 2,
  enabled: true,
};

/** Chain-reaction finale when the stage's last enemies fall. */
export const finaleTuning = {
  /** Wave speed (m/s) from the last kill; the whole chain is squeezed into maxTime seconds. */
  speed: 22,
  maxTime: 2,
  maxSites: 90,
  /** At least this long between two detonations, so a tight crowd still rolls (capped by maxTime). */
  minGap: 0.025,
  /** Recent kill spots kept (seconds) as extra fireworks. */
  keepFor: 20,
  scorePer: 5,
};

/** Rule relics added by this lane (src/data/relics.ts r_dashfire ... r_combo). */
export const relicTuning = {
  dashfireShots: 10,
  dashfireDmg: 14,
  dashfireRapid: 1.2,
  dashfireRateMul: 0.6,
  orbitEvery: 0.3,
  orbitMax: 6,
  orbitTime: 1.2,
  orbitRadius: 1.6,
  orbitDmg: 22,
  novaEvery: 10,
  novaRadius: 4.2,
  novaDmg: 30,
  novaFreeze: 0.5,
  adrenalBelow: 0.5,
  adrenalRateMul: 0.65,
  adrenalDmg: 0.15,
  kegChance: 0.2,
  kegRadius: 2.4,
  kegDmg: 60,
  kegPerStep: 6,
  comboPerTier: 0.04,
};

// ---------------------------------------------------------------- bullet kinds

/**
 * Bullet kinds this lane fires. They're appended to BULLET_KINDS (game.ts) at
 * runtime the first time they're needed (systems/gameplay.ts `ensureKinds`),
 * so no fixed numbers clash with other lanes' kinds. Clients never see kinds
 * (the bullet record carries colour and shape only).
 */
export const GP_KIND_DEFS: { key: GpKind; source: string; tags: Tag[] }[] = [
  { key: 'minigun', source: 'minigun', tags: ['projectile'] },
  { key: 'flamer', source: 'flamer', tags: ['fire'] },
  { key: 'cannon', source: 'mech', tags: ['projectile'] },
  { key: 'missile', source: 'mech', tags: ['projectile', 'explosive'] },
  { key: 'overload', source: 'overload', tags: ['projectile'] },
  { key: 'dashfire', source: 'r_dashfire', tags: ['projectile'] },
  { key: 'orbit', source: 'r_orbit', tags: ['projectile'] },
];
export type GpKind = 'minigun' | 'flamer' | 'cannon' | 'missile' | 'overload' | 'dashfire' | 'orbit';
/** Registered kind numbers (-1 until registered). */
export const GP_KINDS: Record<GpKind, number> = { minigun: -1, flamer: -1, cannon: -1, missile: -1, overload: -1, dashfire: -1, orbit: -1 };

/** Register the kinds into a BULLET_KINDS-like list once; returns the kind map. */
export function registerKinds(list: { source: string; tags?: Tag[] }[]): Record<GpKind, number> {
  if (GP_KINDS.minigun >= 0 && list[GP_KINDS.minigun]?.source === 'minigun') return GP_KINDS;
  for (const k of GP_KIND_DEFS) {
    GP_KINDS[k.key] = list.length;
    list.push({ source: k.source, tags: k.tags });
  }
  return GP_KINDS;
}

/** Damage-breakdown names for this lane's sources. */
export const GP_SOURCE_NAMES: Record<string, string> = {
  minigun: 'Minigun',
  railgun: 'Railgun',
  flamer: 'Flamethrower',
  mech: 'Mech Suit',
  mech_eject: 'Mech Eject',
  overload: 'Overload',
  cashbomb: 'Combo Bomb',
  finale: 'Chain Reaction',
  r_dashfire: 'Trigger Dash',
  r_orbit: 'Satellite Rounds',
  r_nova: 'Nova Heart',
  r_keg: 'Powder Keg',
};

// ---------------------------------------------------------------- per-hero state

/** One satellite round circling its hero (Satellite Rounds relic). */
export interface Satellite {
  a: number;
  t: number;
}

/**
 * Per-hero state for this lane (hero.play). The host simulates it; clients
 * mirror what they draw through `net()` / `setNet()` (hero snapshot field `gp`).
 */
export class HeroPlay {
  /** Seconds left in the mech suit (0 = on foot). */
  mechT = 0;
  mechStep = 0;
  /** Super weapon from a supply crate ('' = none), ammo left (shots, or seconds for the flamethrower) and time left. */
  superId: SuperId | '' = '';
  superAmmo = 0;
  superT = 0;
  /** The live super weapon instance (host only). */
  superW: Weapon | null = null;
  /** The mech's weapons (host only). */
  mechW: Weapon | null = null;
  /** Every weapon slot maxed: the overload meter fills (0..1); overloadT > 0 while it fires. */
  overloadReady = false;
  overload01 = 0;
  overloadT = 0;
  volleyT = 0;
  volleyA = 0;
  /** Comeback mode: at death's door with no revives left (x2 damage, red screen). */
  comeback = false;
  /** Relic state. */
  dashFireT = 0;
  novaKills = 0;
  sats: Satellite[] = [];
  satT = 0;
  /** This step's real fire / right-click input (the mech and super weapons idle the clicks they replace). */
  firing = false;
  charging = false;
  /** Combo cash-in: the highlighted tier (local choice). */
  cashSel = 0;
  /** Live multipliers this lane adds (applied in Hero.refreshLive). */
  damageMul = 1;
  cooldownMul = 1;
  speedMul = 1;
  armor = 0;

  get inMech(): boolean {
    return this.mechT > 0;
  }

  reset(): void {
    this.mechT = this.mechStep = 0;
    this.superId = '';
    this.superAmmo = this.superT = 0;
    this.superW?.dispose();
    this.superW = null;
    this.mechW?.dispose();
    this.mechW = null;
    this.overloadReady = false;
    this.overload01 = this.overloadT = this.volleyT = this.volleyA = 0;
    this.comeback = false;
    this.dashFireT = this.novaKills = this.satT = 0;
    this.sats.length = 0;
    this.damageMul = this.cooldownMul = this.speedMul = 1;
    this.armor = 0;
  }

  /** Fold this lane's live effects into the hero's stats (Hero.refreshLive). */
  applyLive(s: Stats): void {
    s.damageMul *= this.damageMul;
    s.cooldownMul *= this.cooldownMul;
    s.moveSpeedMul *= this.speedMul;
    s.armor += this.armor;
  }

  /** What clients need to draw and show: [mech s, super index+1, super ammo 0..1, super s, overload 0..1, overload s, comeback, ready, ...satellite angles]. */
  net(): number[] {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const sup = this.superId ? SUPER_IDS.indexOf(this.superId) + 1 : 0;
    const ammo = this.superId ? r2(this.superAmmo / SUPERS[this.superId].ammo) : 0;
    const out = [r2(this.mechT), sup, ammo, r2(this.superT), r2(this.overload01), r2(this.overloadT), this.comeback ? 1 : 0, this.overloadReady ? 1 : 0];
    for (const s of this.sats) out.push(r2(s.a));
    return out;
  }

  setNet(a: number[] | undefined): void {
    if (!a) return;
    this.mechT = a[0] ?? 0;
    const sup = a[1] ?? 0;
    this.superId = sup > 0 ? (SUPER_IDS[sup - 1] ?? '') : '';
    this.superAmmo = this.superId ? (a[2] ?? 0) * SUPERS[this.superId].ammo : 0;
    this.superT = a[3] ?? 0;
    this.overload01 = a[4] ?? 0;
    this.overloadT = a[5] ?? 0;
    this.comeback = a[6] === 1;
    this.overloadReady = a[7] === 1;
    this.sats.length = 0;
    for (let i = 8; i < a.length; i++) this.sats.push({ a: a[i], t: 0 });
  }
}

// ---------------------------------------------------------------- rules (pure)

/** Mech, super weapon and relic damage scale: enemy life ^ powerExp. */
export function gpPower(hpMul: number): number {
  return Math.pow(Math.max(1, hpMul), mechTuning.powerExp);
}

/**
 * Weapon overload: all six weapon slots are maxed. That is the four auto
 * weapons at their last level (or evolved, or a fusion) and both clicks fully
 * ranked with their evolution chosen (or at their last level for clicks
 * without tracks). The special doesn't count.
 */
export function overloadEligible(weapons: readonly Weapon[], maxAuto: number): boolean {
  let autos = 0;
  let clicks = 0;
  for (const w of weapons) {
    if (w.def.slot) {
      const done = w.build ? buildMaxed(w.def, w.build) : w.maxed;
      if (!done) return false;
      clicks++;
    } else {
      if (!(w.maxed || w.evolved)) return false;
      autos++;
    }
  }
  return autos >= maxAuto && clicks >= 2;
}

/** Combo a cash-in tier costs after `uses` cash-ins this stage. */
export function cashCost(tier: CashTier, uses: number): number {
  return Math.round(tier.cost * Math.pow(1 + cashTuning.growth, uses));
}

/** Index of the cheapest tier the combo affords (-1 = none), for the HUD. */
export function cashAffordable(combo: number, uses: number): boolean[] {
  return cashTuning.tiers.map((t) => combo >= cashCost(t, uses));
}

/** What a cash-in of `combo` gives: heal share, bomb radius/damage, coins. */
export function cashEffect(combo: number): { heal: number; radius: number; dmg: number; coins: number } {
  const c = cashTuning;
  return {
    heal: Math.min(c.healMax, c.healBase + c.healPerCombo * combo),
    radius: Math.min(c.bombRadiusMax, c.bombRadius + c.bombRadiusPerCombo * combo),
    dmg: c.bombDmg + c.bombDmgPerCombo * combo,
    coins: Math.min(c.goldMax, c.goldBase + Math.floor(combo / c.goldPerCoin)),
  };
}

/** Comeback mode on or off this step: the line is max(1, hpFrac x max life); revives left keep it off. */
export function comebackState(hp: number, maxHp: number, revivesLeft: number, dead: boolean): boolean {
  if (!comebackTuning.enabled || dead || revivesLeft > 0 || hp <= 0) return false;
  return hp <= Math.max(1, comebackTuning.hpFrac * maxHp);
}

/** The bits of an enemy the mutation rules look at. */
export interface MutationSubject {
  def: { id: string; boss?: unknown; miniboss?: unknown; treasure?: unknown; hidden?: boolean; behavior: string };
  pvpOwner: number;
  mutated: boolean;
}

/** Can this enemy ever mutate? Never bosses, mini-bosses, the Reaper, the Goldbug, eggs, swarm walls or PvP stand-ins. */
export function canMutate(e: MutationSubject): boolean {
  const d = e.def;
  if (e.mutated || e.pvpOwner >= 0) return false;
  if (d.boss || d.miniboss || d.treasure || d.hidden) return false;
  if (d.id === 'reaper' || d.behavior === 'egg' || d.behavior === 'swarmwall') return false;
  return true;
}

/** A finale detonation: where, and when (seconds after the finale starts). */
export interface FinaleShot {
  x: number;
  z: number;
  t: number;
}

/**
 * Chain-reaction order: detonations roll outward from (ox, oz) at
 * `finaleTuning.speed`, squeezed into `maxTime`; at most `maxSites`, picked
 * evenly from the full list. Returned sorted by time.
 */
export function finaleSchedule(sites: readonly { x: number; z: number }[], ox: number, oz: number): FinaleShot[] {
  const T = finaleTuning;
  let list = sites;
  if (list.length > T.maxSites) {
    const step = list.length / T.maxSites;
    list = Array.from({ length: T.maxSites }, (_, i) => sites[Math.floor(i * step)]);
  }
  const out = list.map((s) => ({ x: s.x, z: s.z, t: Math.hypot(s.x - ox, s.z - oz) / T.speed })).sort((a, b) => a.t - b.t);
  const gap = Math.min(T.minGap, T.maxTime / Math.max(1, out.length));
  for (let i = 1; i < out.length; i++) out[i].t = Math.max(out[i].t, out[i - 1].t + gap);
  const last = out.length ? out[out.length - 1].t : 0;
  if (last > T.maxTime) for (const s of out) s.t *= T.maxTime / last;
  return out;
}
