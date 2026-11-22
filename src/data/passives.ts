import type { Stats } from '../game/stats';
import type { Rarity } from './rarity';

/** Raw bonuses keep their full value through the knee. The rational tail has
 * unit slope at the join and approaches the limit without reaching it. */
export function softBonus(raw: number, knee: number, limit: number): number {
  if (raw <= knee) return raw;
  const room = limit - knee;
  return knee + room * (raw - knee) / (room + raw - knee);
}

/** Extend an already-curved bonus (nearby teammates or a conditional Mod).
 * Invert once, so the existing build never takes the same penalty twice. */
export function rawBonus(effective: number, knee: number, limit: number): number {
  if (effective <= knee) return effective;
  const room = limit - knee;
  return knee + room * (effective - knee) / (limit - effective);
}

export function addAuraBonus(effective: number, extra: number, knee: number, limit: number): number {
  if (!extra || effective >= limit) return effective;
  return softBonus(rawBonus(effective, knee, limit) + extra, knee, limit);
}

export const curvedStats: readonly (keyof Stats)[] = [
  'damageMul', 'chargeDmg', 'cooldownMul', 'chargeSpeed', 'critChance', 'critMult',
  'areaMul', 'specialCooldownMul', 'dashCooldownMul', 'armor', 'moveSpeedMul', 'killHeal',
];

/** Permanent build bonuses only. Timed skill rewards retain their duration and strength. */
export function applyBuildCurves(s: Stats, modDamage: number, modCooldown: number, chargeBoost = 0): void {
  s.damageMul = modDamage * (1 + softBonus(s.damageMul / modDamage - 1, 0.30, 0.85));
  s.chargeDmg = 1 + softBonus(s.chargeDmg - 1, 0.60, 1.30);
  // A single cursed Mod still delivers its advertised tradeoff.
  s.cooldownMul = 1 - softBonus(1 - s.cooldownMul, Math.max(0.24, 1 - modCooldown), 0.70);
  s.chargeSpeed = 1 + softBonus(s.chargeSpeed * (1 + chargeBoost) - 1, chargeBoost ? 0.50 : 0.45, 1.10);
  s.critChance = 0.05 + softBonus(s.critChance - 0.05, 0.24, 0.65);
  s.critMult = 2 + softBonus(s.critMult - 2, 0.90, 2.10);
  s.areaMul = 1 + softBonus(s.areaMul - 1, 0.30, 0.75);
  s.specialCooldownMul = 1 - softBonus(1 - s.specialCooldownMul, 0.36, 0.55);
  s.dashCooldownMul = 1 - softBonus(1 - s.dashCooldownMul, 0.30, 0.50);
  s.killHeal = softBonus(s.killHeal, 0.15, 0.24);
  s.armor = softBonus(s.armor, 3, 8);
  s.moveSpeedMul = 1 + softBonus(s.moveSpeedMul - 1, 0.24, 0.65);
}

export const killHealLimit = (maxHp: number): number => Math.min(3, maxHp * 0.03);

/** One second of actual kill recovery per hero. Same-step kills share a
 * timestamp. If finely spaced events fill the ring, merge at the later time. */
export class KillHealWindow {
  private times = new Float64Array(64);
  private gains = new Float64Array(64);
  private head = 0;
  private size = 0;
  private total = 0;
  private last = -1;

  reset(): void {
    this.head = this.size = this.total = 0;
    this.last = -1;
  }

  grant(now: number, amount: number, maxHp: number): number {
    if (now < this.last) this.reset();
    this.last = now;
    const capacity = this.times.length;
    while (this.size && now - this.times[this.head] >= 1) {
      this.total -= this.gains[this.head];
      this.head = (this.head + 1) % capacity;
      this.size--;
    }
    if (!this.size) this.total = 0;
    const gain = Math.min(amount, Math.max(0, killHealLimit(maxHp) - this.total));
    if (gain <= 0) return 0;
    let tail = (this.head + this.size - 1 + capacity) % capacity;
    if (this.size < capacity && (!this.size || this.times[tail] !== now)) {
      tail = (this.head + this.size++) % capacity;
      this.gains[tail] = 0;
    }
    this.times[tail] = now;
    this.gains[tail] += gain;
    this.total += gain;
    return gain;
  }
}

/** Passive items: simple stat boosts, 5 levels each. `add` is applied once per level. */
export interface PassiveDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  desc: string; // per-level effect
  maxLevel: number;
  rarity: Rarity;
  add: Partial<Stats>;
  healOnPick?: number;
  /** Co-op only: offered only when 2+ players are in the run. */
  coop?: boolean;
}

export const PASSIVES: Record<string, PassiveDef> = {
  power_cell: {
    id: 'power_cell',
    rarity: 'common',
    name: 'Power Cell',
    icon: '⚡',
    color: '#ffd23f',
    desc: '+10% damage',
    maxLevel: 5,
    add: { damageMul: 0.1 },
  },
  rapid_coil: {
    id: 'rapid_coil',
    rarity: 'uncommon',
    name: 'Rapid Coil',
    icon: '»',
    color: '#ff9f3d',
    desc: 'Weapons recharge 8% faster',
    maxLevel: 5,
    add: { cooldownMul: -0.08 },
  },
  magnet: {
    id: 'magnet',
    rarity: 'common',
    name: 'Magnet',
    icon: 'U',
    color: '#ff3d5a',
    desc: '+35% pickup range',
    maxLevel: 5,
    add: { magnet: 0.35 },
  },
  sneakers: {
    id: 'sneakers',
    rarity: 'common',
    name: 'Turbo Sneakers',
    icon: '→',
    color: '#3de0c8',
    desc: '+8% move speed',
    maxLevel: 5,
    add: { moveSpeedMul: 0.08 },
  },
  heart: {
    id: 'heart',
    rarity: 'common',
    name: 'Heart Container',
    icon: '♥',
    color: '#ff5e7a',
    desc: '+20 max life, heal 20',
    maxLevel: 5,
    add: { maxHp: 20 },
    healOnPick: 20,
  },
  armor: {
    id: 'armor',
    rarity: 'uncommon',
    name: 'Armor Plate',
    icon: '▣',
    color: '#8a90c8',
    desc: 'Take 1 less damage per hit',
    maxLevel: 5,
    add: { armor: 1 },
  },
  big_bang: {
    id: 'big_bang',
    rarity: 'uncommon',
    name: 'Big Bang',
    icon: '◉',
    color: '#ff7eb6',
    desc: '+10% weapon area',
    maxLevel: 5,
    add: { areaMul: 0.1 },
  },
  lucky_star: {
    id: 'lucky_star',
    rarity: 'uncommon',
    name: 'Lucky Star',
    icon: '★',
    color: '#fff35c',
    desc: '+8% critical hit chance',
    maxLevel: 5,
    add: { critChance: 0.08 },
  },
  growth: {
    id: 'growth',
    rarity: 'common',
    name: 'Growth Chip',
    icon: '↑',
    color: '#7dffb0',
    desc: '+10% XP gained',
    maxLevel: 5,
    add: { xpMul: 0.1 },
  },
  capacitor: {
    id: 'capacitor',
    rarity: 'common',
    name: 'Capacitor',
    icon: '◔',
    color: '#5cf2ff',
    desc: 'Right click charges and reloads 15% faster',
    maxLevel: 5,
    add: { chargeSpeed: 0.15 },
  },
  plasma_core: {
    id: 'plasma_core',
    rarity: 'uncommon',
    name: 'Plasma Core',
    icon: '◈',
    color: '#3dffb0',
    desc: '+20% right-click damage',
    maxLevel: 5,
    add: { chargeDmg: 0.2 },
  },
  nanobots: {
    id: 'nanobots',
    rarity: 'uncommon',
    name: 'Nanobots',
    icon: '+',
    color: '#4fd36a',
    desc: 'Regenerate 0.3 life per second',
    maxLevel: 5,
    add: { regen: 0.3 },
  },
  thrusters: {
    id: 'thrusters',
    rarity: 'uncommon',
    name: 'Jet Thrusters',
    icon: '»',
    color: '#7df9ff',
    desc: 'Dash recharges 10% faster',
    maxLevel: 5,
    add: { dashCooldownMul: -0.1 },
  },
  clover: {
    id: 'clover',
    rarity: 'rare',
    name: 'Lucky Clover',
    icon: '♣',
    color: '#38b764',
    desc: '+1 Luck: rarer cards and Mods show up more, and gears drop more often',
    maxLevel: 5,
    add: { luck: 1 },
  },
  vampire: {
    id: 'vampire',
    rarity: 'legendary',
    name: 'Vampire Fang',
    icon: '♠',
    color: '#b13e53',
    desc: 'Kills heal 0.05% of max life each (full rate up to 12 kills a second)',
    maxLevel: 3,
    add: { killHeal: 0.05 },
  },
  dash_cells: {
    id: 'dash_cells',
    rarity: 'rare',
    name: 'Dash Cells',
    icon: '≫',
    color: '#41a6f6',
    desc: '+1 dash in a row before recharging',
    maxLevel: 2,
    add: { dashCharges: 1 },
  },
  focus_lens: {
    id: 'focus_lens',
    rarity: 'uncommon',
    name: 'Focus Lens',
    icon: '◎',
    color: '#ffcd75',
    desc: '+30% critical hit damage and +2% crit chance',
    maxLevel: 5,
    add: { critMult: 0.3, critChance: 0.02 },
  },
  boxing_glove: {
    id: 'boxing_glove',
    rarity: 'common',
    name: 'Boxing Glove',
    icon: '●',
    color: '#ef7d57',
    desc: '+30% knockback: hits shove enemies further away',
    maxLevel: 5,
    add: { knockbackMul: 0.3 },
  },
  spiked_shell: {
    id: 'spiked_shell',
    rarity: 'uncommon',
    name: 'Spiked Shell',
    icon: '✱',
    color: '#a7f070',
    desc: 'When you get hit, spikes burst out for +25 damage (+25% per Armor)',
    maxLevel: 5,
    add: { thorns: 25 },
  },
  tesla_boots: {
    id: 'tesla_boots',
    rarity: 'common',
    name: 'Tesla Boots',
    icon: 'ϟ',
    color: '#73eff7',
    desc: 'Dashing releases a pulse: +25 damage and Shock to enemies around you',
    maxLevel: 5,
    add: { dashZap: 25 },
  },
  cryo_rounds: {
    id: 'cryo_rounds',
    rarity: 'rare',
    name: 'Cryo Rounds',
    icon: '❄',
    color: '#9fe8ff',
    desc: 'Hits have a +3% chance to Freeze enemies for 1s (kill them frozen to Shatter)',
    maxLevel: 3,
    add: { freezeChance: 0.03 },
  },

  // ---------------------------------------------------------------- co-op only (2+ players)
  medic_link: {
    id: 'medic_link',
    coop: true,
    rarity: 'common',
    name: 'Medic Link',
    icon: '+',
    color: '#38b764',
    desc: 'CO-OP: teammates within 7m regenerate +0.4 life per second',
    maxLevel: 5,
    add: { teamHeal: 0.4 },
  },
  rally_banner: {
    id: 'rally_banner',
    coop: true,
    rarity: 'uncommon',
    name: 'Rally Banner',
    icon: '⚑',
    color: '#b13e53',
    desc: 'CO-OP: teammates within 7m deal +10% damage',
    maxLevel: 5,
    add: { teamDmgAura: 0.1 },
  },
  guardian_angel: {
    id: 'guardian_angel',
    coop: true,
    rarity: 'rare',
    name: 'Guardian Angel',
    icon: '♰',
    color: '#f4f4f4',
    desc: 'CO-OP: revive teammates 100% faster; they get up with +20% life',
    maxLevel: 3,
    add: { reviveSpeed: 1.0, reviveHp: 0.2 },
  },
  bond_of_steel: {
    id: 'bond_of_steel',
    coop: true,
    rarity: 'common',
    name: 'Bond of Steel',
    icon: '∞',
    color: '#94b0c2',
    desc: 'CO-OP: take 1 less damage per hit while a teammate is within 7m',
    maxLevel: 5,
    add: { nearMateArmor: 1 },
  },
  battery_pack: {
    id: 'battery_pack',
    rarity: 'uncommon',
    name: 'Battery Pack',
    icon: '▮',
    color: '#ffcd75',
    desc: 'Q/E special cooldown -12% (any special)',
    maxLevel: 3,
    add: { specialCooldownMul: -0.12 },
  },
};
