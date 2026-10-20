import type { Stats } from '../game/stats';

/**
 * Playable heroes: a starting kit and stat quirks. Picked on the MODE screen;
 * all but the Rookie unlock with achievements.
 */
export interface HeroDef {
  id: string;
  name: string;
  desc: string;
  /** Auto weapons the run starts with, on top of the loadout (left click, right click, special). */
  start: string[];
  add: Partial<Stats>;
  /** Body proportions: [width, height] scale. */
  build: [number, number];
  unlock?: string;
  /** Ultimate id (src/game/ultimates.ts ULTS). */
  ult: string;
  /** A unique hero mechanic (src/game/heroMechs.ts), on top of the stat quirks. */
  mech?: 'duelist' | 'furnace' | 'twin' | 'ronin' | 'tinker' | 'medic' | 'brawler';
  /** Hero kit clicks (src/data/heroWeapons.ts) that replace the loadout's left / right click. */
  clicks?: { primary?: string; secondary?: string };
}

export const HEROES: HeroDef[] = [
  { id: 'rookie', name: 'Rookie', desc: 'Balanced. No extra weapon. ULTIMATE: Mega Barrage.', start: [], add: {}, build: [1, 1], ult: 'barrage' },
  {
    id: 'bulwark',
    name: 'Bulwark',
    desc: '+40 life, +1 armor, 10% slower. Starts with a Zap Field. ULTIMATE: Titan Stomp.',
    start: ['aura'],
    add: { maxHp: 40, armor: 1, moveSpeedMul: -0.1 },
    build: [1.18, 1.02],
    unlock: 'boss_slayer',
    ult: 'stomp',
  },
  {
    id: 'dash',
    name: 'Dash',
    desc: '15% faster, dash recharges 25% sooner, -20 life. Starts with Blaze Boots. ULTIMATE: Sonic Blitz.',
    start: ['fire'],
    add: { moveSpeedMul: 0.15, dashCooldownMul: -0.25, maxHp: -20 },
    build: [0.9, 0.98],
    unlock: 'speedster',
    ult: 'blitz',
  },
  {
    id: 'ace',
    name: 'Ace',
    desc: '+20% damage, +10% crit chance, slower right click. Starts with Chain Zap. ULTIMATE: Lock-On Storm.',
    start: ['lightning'],
    add: { damageMul: 0.2, critChance: 0.1, chargeSpeed: -0.2 },
    build: [0.96, 1.06],
    unlock: 'elite_hunter',
    ult: 'storm',
  },
  {
    id: 'duelist',
    name: 'Duelist',
    desc: 'No dash: the dash key parries. A longer parry window, and every parry in a chain adds +12% damage (up to x6) while it lasts. +5% crit chance. ULTIMATE: Blade Dance.',
    start: [],
    add: { critChance: 0.05 },
    build: [0.86, 1.12],
    unlock: 'riposte',
    ult: 'dance',
    mech: 'duelist',
  },
  {
    id: 'furnace',
    name: 'Furnace',
    desc: 'Heats up while standing still: up to +60% damage and a burning aura that grows. Moving vents the heat. +30 life, 15% slower. ULTIMATE: Meltdown.',
    start: [],
    add: { maxHp: 30, moveSpeedMul: -0.15 },
    build: [1.3, 0.9],
    unlock: 'immovable',
    ult: 'meltdown',
    mech: 'furnace',
  },
  {
    id: 'twin',
    name: 'Twin',
    desc: 'A small mirror twin walks beside you and copies your left click at half damage. -10 life. ULTIMATE: Mirror Storm.',
    start: [],
    add: { maxHp: -10 },
    build: [0.88, 0.92],
    unlock: 'double_trouble',
    ult: 'mirror',
    mech: 'twin',
  },
  // heroes3 lane (src/game/systems/heroes3.ts): a melee hero and a summoner.
  {
    id: 'ronin',
    name: 'Ronin',
    desc: 'Melee. LEFT CLICK is a 3-hit sword combo (the third hit cleaves), RIGHT CLICK a focused dash-strike through enemies; a parry answers with a counter-slash. +30 life, +1 armor, 5% faster. ULTIMATE: Thousand Cuts.',
    start: [],
    add: { maxHp: 30, armor: 1, moveSpeedMul: 0.05 },
    build: [1.02, 1.04],
    unlock: 'point_blank',
    ult: 'cuts',
    mech: 'ronin',
    clicks: { primary: 'katana', secondary: 'iaido' },
  },
  {
    id: 'tinker',
    name: 'Tinker',
    desc: 'Builds an army: little robots assemble every few seconds (more as the team levels), zap nearby enemies and soak bullets. RIGHT CLICK drops a turret beacon that repairs. +15% pickup range. ULTIMATE: Scrap Legion.',
    start: [],
    add: { magnet: 0.15 },
    build: [0.94, 0.94],
    unlock: 'workshop',
    ult: 'legion',
    mech: 'tinker',
    clicks: { secondary: 'beacon' },
  },
  // heroes4 lane (src/game/systems/heroes4.ts): a healer and a melee grappler.
  {
    id: 'medic',
    name: 'Medic',
    desc: 'Healer. LEFT CLICK is a mending beam that burns through enemies, heals every teammate it passes through and mends you with every hit; RIGHT CLICK sends a drone that revives a downed teammate from range (or shields you). Teammates near you regenerate. +0.4 life/s, faster revives. ULTIMATE: Field Hospital.',
    start: [],
    add: { regen: 0.4, reviveSpeed: 0.5 },
    build: [0.95, 1.0],
    unlock: 'lifesaver',
    ult: 'hospital',
    mech: 'medic',
    clicks: { primary: 'medbeam', secondary: 'revdrone' },
  },
  {
    id: 'brawler',
    name: 'Brawler',
    desc: 'Melee grappler. LEFT CLICK is a 3-punch combo whose haymaker sends enemies flying, RIGHT CLICK grabs an enemy to throw into the others (bosses get an uppercut), and the dash is a shoulder charge. Knock enemies into lava, thorns and pillars! +50 life, +3 armor, +25% knockback, a little life per kill, 5% slower. ULTIMATE: Wrecking Ball.',
    start: [],
    add: { maxHp: 50, armor: 3, knockbackMul: 0.25, killHeal: 0.05, moveSpeedMul: -0.05 },
    build: [1.2, 0.98],
    unlock: 'wrecking_crew',
    ult: 'wrecking',
    mech: 'brawler',
    clicks: { primary: 'fists', secondary: 'grab' },
  },
];

/** The clicks a hero actually plays with: its kit's clicks (Ronin, Tinker) over the loadout's. */
export function heroClicks(def: HeroDef, l: { primary: string; secondary: string }): { primary: string; secondary: string } {
  return { primary: def.clicks?.primary ?? l.primary, secondary: def.clicks?.secondary ?? l.secondary };
}

export const HERO_BY_ID = Object.fromEntries(HEROES.map((h) => [h.id, h])) as Record<string, HeroDef>;

export function heroOf(id: string | undefined): HeroDef {
  return HERO_BY_ID[id ?? ''] ?? HEROES[0];
}
