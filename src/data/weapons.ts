import type { Rarity } from './rarity';
import type { Tag } from './tags';
import type { Upgradable } from './tracks';

/**
 * Weapon definitions. Each level lists its full parameter set (not deltas)
 * plus the text shown on the level-up card. Loadout weapons with `tracks`
 * use upgrade tracks instead (src/data/tracks.ts): `levels[0]` is their base.
 * Behaviour lives in src/game/weapons/. Damage, cooldown and area are further
 * scaled by stats.
 */
export interface WeaponLevel {
  text: string;
  p: Record<string, number>;
}

/**
 * Partner-item evolution for auto weapons: a maxed weapon plus its partner
 * passive (any level) becomes a stronger form. It is stored as level
 * `levels.length + 1`, so co-op snapshots carry it like any other level.
 * (Loadout weapons evolve through their upgrade trees instead.)
 */
export interface WeaponEvolution {
  name: string;
  /** The evolved form's own colour (shots, drones, fields, flames...). */
  color: string;
  /** Passive id that must be owned to evolve. */
  passive: string;
  text: string;
  p: Record<string, number>;
}

/** Loadout slot: left click (primary) or right click (secondary), picked before the run. */
export type ArmSlot = 'primary' | 'secondary';

export interface WeaponDef extends Upgradable {
  id: string;
  rarity: Rarity;
  /** Loadout slot; loadout weapons don't take an auto-weapon slot. */
  slot?: ArmSlot;
  /** Weapons without tracks: the last level is an evolution (new name, colour and look). */
  evo?: { name: string; color: string };
  tags: Tag[];
  name: string;
  icon: string;
  color: string;
  desc: string;
  /** Available from the first run; otherwise unlocked by an achievement. */
  starter: boolean;
  levels: WeaponLevel[];
  /** Auto weapons: partner-item evolution (see WeaponEvolution). */
  evolution?: WeaponEvolution;
}

/** Damage from the right-click slot: the Buster's charge shot or a secondary arm weapon. */
export function isRightClick(source: string): boolean {
  return source === 'charge' || WEAPONS[source]?.slot === 'secondary';
}

export const WEAPONS: Record<string, WeaponDef> = {
  buster: {
    id: 'buster',
    rarity: 'common',
    slot: 'primary',
    tags: ['projectile'],
    name: 'Buster',
    icon: '▶',
    color: '#ffd23f',
    desc: 'LEFT CLICK: your trusty arm cannon. Rapid shots where you aim.',
    starter: true,
    levels: [{ text: 'Rapid shots where you aim.', p: { dmg: 10, rate: 7, shots: 1, arc: 0, pierce: 0, size: 1, speed: 28 } }],
    tracks: [
      {
        id: 'heavy',
        name: 'Heavy Rounds',
        ranks: [
          { text: '+2 damage, bigger shots.', p: { dmg: 2, size: 0.1 } },
          { text: '+2 damage, bigger shots.', p: { dmg: 2, size: 0.1 } },
          { text: '+2 damage, bigger shots.', p: { dmg: 2, size: 0.1 } },
          { text: '+3 damage, bigger shots.', p: { dmg: 3, size: 0.1 } },
        ],
      },
      {
        id: 'rapid',
        name: 'Rapid Fire',
        ranks: [
          { text: 'Fires faster.', p: { rate: 1 } },
          { text: 'Fires faster.', p: { rate: 1 } },
          { text: 'Fires faster.', p: { rate: 1.2 } },
          { text: 'Fires much faster.', p: { rate: 1.3, speed: 4 } },
        ],
      },
      {
        id: 'multi',
        name: 'Multi-Shot',
        ranks: [
          { text: 'Fires 2 shots.', p: { shots: 1, arc: 10 } },
          { text: 'Shots pierce 1 enemy.', p: { pierce: 1 } },
          { text: 'Fires 3 shots.', p: { shots: 1, arc: 6 } },
          { text: 'Shots pierce 1 more enemy.', p: { pierce: 1 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'flare', name: "Flare Buster", color: '#ff7a2f', text: 'Blazing orange bolts that set enemies on fire (Fire). x1.15 damage.', tags: ['fire'], p: { size: 0.2 }, mul: { dmg: 1.15 } },
      { id: 'volt', name: "Volt Buster", color: '#7df9ff', text: 'Crackling bolts that Shock what they hit (Shock) and pierce 2 more enemies.', tags: ['shock'], p: { pierce: 2, speed: 6 } },
    ],
  },
  charge: {
    id: 'charge',
    rarity: 'common',
    slot: 'secondary',
    tags: ['projectile'],
    name: 'Charge Shot',
    icon: '◆',
    color: '#3dffb0',
    desc: 'RIGHT CLICK: hold to charge, release for a big piercing shot.',
    starter: true,
    levels: [{ text: 'Hold to charge a piercing shot; a full charge explodes.', p: { dmg: 10, speed: 28, time: 1.3, blast: 2.4, pierce: 0, size: 1, lance: 0 } }],
    tracks: [
      {
        id: 'heavy',
        name: 'Heavy Charge',
        ranks: [
          { text: '+2 charged damage.', p: { dmg: 2 } },
          { text: '+2 charged damage.', p: { dmg: 2 } },
          { text: '+3 charged damage.', p: { dmg: 3 } },
          { text: '+3 charged damage.', p: { dmg: 3 } },
        ],
      },
      {
        id: 'quick',
        name: 'Quick Charge',
        ranks: [
          { text: 'Charges 0.1s faster.', p: { time: -0.1 } },
          { text: 'Charges 0.1s faster.', p: { time: -0.1 } },
          { text: 'Charges 0.1s faster.', p: { time: -0.1 } },
          { text: 'Charges 0.15s faster.', p: { time: -0.15 } },
        ],
      },
      {
        id: 'core',
        name: 'Blast Core',
        ranks: [
          { text: 'Bigger full-charge blast.', p: { blast: 0.4 } },
          { text: 'Bigger full-charge blast.', p: { blast: 0.4 } },
          { text: 'Charged shots pierce 2 more enemies.', p: { pierce: 2 } },
          { text: 'Huge shots and blasts.', p: { blast: 0.5, size: 0.2 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'star', name: "Star Cannon", color: '#ff5e3a', text: 'Full charges become blazing stars whose blast sets everything on fire (Fire). Bigger blasts.', tags: ['fire'], p: { blast: 1 }, mul: { dmg: 1.2 } },
      { id: 'lance', name: "Lance Shot", color: '#ffd23f', text: 'A long, fast lance that pierces everything in line and Shocks it (Shock). No blast.', tags: ['shock'], p: { lance: 1, speed: 20, pierce: 20 }, mul: { dmg: 1.3 } },
    ],
  },
  drones: {
    id: 'drones',
    rarity: 'common',
    tags: ['orbit'],
    name: 'Orbit Drones',
    icon: '✦',
    color: '#4fc3ff',
    desc: 'Little drones circle you and bonk enemies.',
    starter: true,
    levels: [
      { text: '3 drones orbit you.', p: { count: 3, dmg: 15, radius: 2.0, spin: 3.0, size: 1 } },
      { text: '+1 drone.', p: { count: 4, dmg: 17, radius: 2.2, spin: 3.2, size: 1 } },
      { text: 'Harder hits, wider orbit.', p: { count: 4, dmg: 24, radius: 2.4, spin: 3.4, size: 1.15 } },
      { text: '+1 drone, spins faster.', p: { count: 5, dmg: 30, radius: 2.6, spin: 3.6, size: 1.2 } },
      { text: '6 big drones!', p: { count: 6, dmg: 38, radius: 2.8, spin: 3.8, size: 1.45 } },
    ],
    evolution: { name: 'Aegis Swarm', color: '#ffcd75', passive: 'armor', text: '8 heavy drones in a wide ring.', p: { count: 8, dmg: 54.89, radius: 3.13, spin: 4.2, size: 1.6 } },
  },
  aura: {
    id: 'aura',
    rarity: 'common',
    tags: ['area', 'shock'],
    name: 'Zap Field',
    icon: '◎',
    color: '#3de0c8',
    desc: 'An electric field shocks nearby enemies.',
    starter: true,
    levels: [
      { text: 'Shocks enemies around you.', p: { radius: 2.3, dmg: 12, tick: 0.5, slow: 0 } },
      { text: 'Bigger field.', p: { radius: 2.8, dmg: 15, tick: 0.45, slow: 0 } },
      { text: 'Stronger shocks.', p: { radius: 3.0, dmg: 20, tick: 0.4, slow: 0 } },
      { text: 'Enemies inside are slowed.', p: { radius: 3.4, dmg: 24, tick: 0.35, slow: 0.35 } },
      { text: 'Huge storm field!', p: { radius: 4.2, dmg: 32, tick: 0.3, slow: 0.45 } },
    ],
    evolution: { name: 'Thunderdome', color: '#a35cff', passive: 'big_bang', text: 'A giant storm that cripples all inside.', p: { radius: 5.4, dmg: 46.93, tick: 0.25, slow: 0.6 } },
  },
  lightning: {
    id: 'lightning',
    rarity: 'common',
    tags: ['chain', 'shock'],
    name: 'Chain Zap',
    icon: 'ϟ',
    color: '#fff35c',
    desc: 'Lightning jumps between enemies.',
    starter: true,
    levels: [
      { text: 'Zaps an enemy, chains to 3 more.', p: { cd: 1.2, dmg: 28, chains: 3, bolts: 1, range: 10, hop: 4.5 } },
      { text: 'Chains to 4.', p: { cd: 1.1, dmg: 32, chains: 4, bolts: 1, range: 10, hop: 4.5 } },
      { text: '2 bolts, more damage.', p: { cd: 1.0, dmg: 38, chains: 4, bolts: 2, range: 11, hop: 5 } },
      { text: 'Chains to 5, faster.', p: { cd: 0.9, dmg: 44, chains: 5, bolts: 2, range: 11, hop: 5 } },
      { text: '3 thunder bolts!', p: { cd: 0.8, dmg: 52, chains: 7, bolts: 3, range: 12, hop: 5.5 } },
    ],
    evolution: { name: 'Storm Caller', color: '#7df9ff', passive: 'lucky_star', text: '5 bolts that chain through 10 enemies.', p: { cd: 0.64, dmg: 66.44, chains: 10, bolts: 5, range: 13, hop: 6 } },
  },
  discs: {
    id: 'discs',
    rarity: 'common',
    tags: ['projectile', 'orbit'],
    name: 'Boomer Disc',
    icon: '◐',
    color: '#3de0c8',
    desc: 'Throws a disc that slices out and back.',
    starter: true,
    levels: [
      { text: 'Throws a piercing disc.', p: { cd: 1.4, dmg: 22, count: 1, range: 7, size: 1, speed: 16 } },
      { text: 'Bigger disc.', p: { cd: 1.3, dmg: 26, count: 1, range: 7.5, size: 1.35, speed: 16 } },
      { text: 'Throws 2 discs.', p: { cd: 1.3, dmg: 30, count: 2, range: 8, size: 1.35, speed: 17 } },
      { text: 'Longer, harder throws.', p: { cd: 1.15, dmg: 36, count: 2, range: 9.5, size: 1.5, speed: 19 } },
      { text: '4 giant discs!', p: { cd: 1.0, dmg: 44, count: 4, range: 10, size: 1.6, speed: 20 } },
    ],
    evolution: { name: 'Buzzsaw Halo', color: '#ff5d3a', passive: 'magnet', text: '6 huge saws that fly far and fast.', p: { cd: 0.85, dmg: 57.54, count: 6, range: 11.5, size: 1.9, speed: 23 } },
  },
  missiles: {
    id: 'missiles',
    rarity: 'uncommon',
    tags: ['projectile', 'explosive'],
    name: 'Seeker Pod',
    icon: '➶',
    color: '#ff5e5e',
    desc: 'Homing missiles that explode on impact.',
    starter: false,
    levels: [
      { text: 'Fires 2 homing missiles.', p: { cd: 1.5, count: 2, dmg: 26, radius: 1.8 } },
      { text: '3 missiles.', p: { cd: 1.4, count: 3, dmg: 28, radius: 1.9 } },
      { text: 'Bigger blasts.', p: { cd: 1.4, count: 3, dmg: 34, radius: 2.3 } },
      { text: '5 missiles.', p: { cd: 1.35, count: 5, dmg: 36, radius: 2.4 } },
      { text: 'Missile swarm!', p: { cd: 1.3, count: 8, dmg: 40, radius: 2.7 } },
    ],
    evolution: { name: 'Hellfire Pod', color: '#ff2d4a', passive: 'rapid_coil', text: '12 missiles with huge blasts.', p: { cd: 1.1, count: 12, dmg: 48.42, radius: 3.2 } },
  },
  mines: {
    id: 'mines',
    rarity: 'uncommon',
    tags: ['explosive', 'trail'],
    name: 'Pop Mines',
    icon: '✷',
    color: '#ff9f3d',
    desc: 'Drops mines behind you as you run.',
    starter: false,
    levels: [
      { text: 'Drop a mine every second.', p: { cd: 1.0, dmg: 30, radius: 2.0, max: 6, per: 1 } },
      { text: 'More mines out at once.', p: { cd: 0.85, dmg: 36, radius: 2.1, max: 10, per: 1 } },
      { text: 'Stronger blasts.', p: { cd: 0.8, dmg: 44, radius: 2.4, max: 10, per: 1 } },
      { text: 'Bigger blasts.', p: { cd: 0.7, dmg: 46, radius: 2.8, max: 14, per: 1 } },
      { text: 'Drops 2 at a time!', p: { cd: 0.6, dmg: 58, radius: 3.0, max: 20, per: 2 } },
    ],
    evolution: { name: 'Nano Minefield', color: '#7dffb0', passive: 'nanobots', text: 'Drops 3 mines at a time. Huge blasts.', p: { cd: 0.5, dmg: 72, radius: 3.4, max: 30, per: 3 } },
  },
  nova: {
    id: 'nova',
    rarity: 'rare',
    tags: ['area', 'frost'],
    name: 'Frost Nova',
    icon: '❄',
    color: '#9fe8ff',
    desc: 'Freezes enemies around you solid.',
    starter: false,
    levels: [
      { text: 'Freezes nearby enemies. Frozen enemies take +20% damage.', p: { cd: 4.0, radius: 4.5, freeze: 1.0, dmg: 20, shatter: 0.2 } },
      { text: 'Bigger nova, +30% frozen damage.', p: { cd: 3.8, radius: 5.5, freeze: 1.2, dmg: 28, shatter: 0.3 } },
      { text: 'Longer freeze, +40%.', p: { cd: 3.6, radius: 5.8, freeze: 1.4, dmg: 38, shatter: 0.4 } },
      { text: 'Frozen enemies take +50% damage.', p: { cd: 3.4, radius: 6.5, freeze: 1.6, dmg: 50, shatter: 0.5 } },
      { text: 'Absolute zero! +75%.', p: { cd: 3.2, radius: 8, freeze: 1.8, dmg: 65, shatter: 0.75 } },
    ],
    evolution: { name: 'Glacier Heart', color: '#4f7bff', passive: 'heart', text: 'Huge, frequent novas. Frozen enemies take +110% damage.', p: { cd: 2.51, radius: 9.5, freeze: 2.08, dmg: 97.5, shatter: 1.12 } },
  },
  fire: {
    id: 'fire',
    rarity: 'rare',
    tags: ['trail', 'fire'],
    name: 'Blaze Boots',
    icon: '♨',
    color: '#ff7a2f',
    desc: 'Leave a trail of fire when you move.',
    starter: false,
    levels: [
      { text: 'Running leaves burning flames.', p: { life: 2.0, radius: 0.8, dps: 30, dash: 0 } },
      { text: 'Flames last longer.', p: { life: 2.4, radius: 0.85, dps: 38, dash: 0 } },
      { text: 'Hotter, wider flames.', p: { life: 2.8, radius: 1.0, dps: 50, dash: 0 } },
      { text: 'Dashing leaves a firewall.', p: { life: 3.0, radius: 1.05, dps: 65, dash: 1 } },
      { text: 'Inferno!', p: { life: 3.6, radius: 1.25, dps: 90, dash: 1 } },
    ],
    evolution: { name: 'Phoenix Trail', color: '#ffe14d', passive: 'sneakers', text: 'Blazing trail; dashes leave a huge firewall.', p: { life: 4.27, radius: 1.5, dps: 130, dash: 1 } },
  },

  // ---------------------------------------------------------------- arm weapons
  scatter: {
    id: 'scatter',
    rarity: 'uncommon',
    slot: 'primary',
    tags: ['projectile'],
    name: 'Scattergun',
    icon: '⁂',
    color: '#ffe9a8',
    desc: 'LEFT CLICK: a close-range blast of pellets.',
    starter: true,
    levels: [{ text: 'Blasts 8 pellets where you aim.', p: { dmg: 12, rate: 2.2, pellets: 8, spread: 40, life: 0.32, speed: 26, pierce: 0, knock: 3, blast: 0 } }],
    tracks: [
      {
        id: 'buckshot',
        name: 'Buckshot',
        ranks: [
          { text: '+1 pellet, +3 damage.', p: { pellets: 1, dmg: 3 } },
          { text: '+1 pellet, +3 damage.', p: { pellets: 1, dmg: 3 } },
          { text: '+1 pellet, +3 damage, wider blast.', p: { pellets: 1, dmg: 3, spread: 4 } },
          { text: '+1 pellet, +3 damage.', p: { pellets: 1, dmg: 3 } },
        ],
      },
      {
        id: 'pump',
        name: 'Pump Action',
        ranks: [
          { text: 'Fires 15% faster.', p: { rate: 0.33 } },
          { text: 'Fires faster, +2 damage.', p: { rate: 0.3, dmg: 2 } },
          { text: 'Fires 15% faster.', p: { rate: 0.33 } },
          { text: 'Fires faster, +3 damage.', p: { rate: 0.3, dmg: 3 } },
        ],
      },
      {
        id: 'choke',
        name: 'Choke',
        ranks: [
          { text: 'Tighter blast that reaches further.', p: { spread: -6, life: 0.06 } },
          { text: 'Pellets pierce 1 more enemy.', p: { pierce: 1, life: 0.04 } },
          { text: 'Tighter, harder-hitting blast.', p: { spread: -6, life: 0.05, knock: 2, dmg: 2 } },
          { text: 'Pellets pierce 1 more enemy.', p: { pierce: 1, life: 0.05 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'dragon', name: "Dragon's Breath", color: '#ff5e3a', text: 'Breathes fire: long flame pellets that set enemies ablaze (Fire). x1.25 damage.', tags: ['fire'], p: { pellets: 1, life: 0.08 }, mul: { dmg: 1.25 } },
      { id: 'flak', name: 'Flak Cannon', color: '#ffb627', text: 'Pellets burst on impact in small blasts that hit the crowd behind (Explosive).', tags: ['explosive'], p: { blast: 1.2 }, mul: { dmg: 1.1 } },
    ],
  },
  laser: {
    id: 'laser',
    rarity: 'legendary',
    slot: 'primary',
    tags: ['projectile', 'area'],
    name: 'Pulse Laser',
    icon: '═',
    color: '#5cf2ff',
    desc: 'LEFT CLICK: a held beam that burns through lines of enemies.',
    starter: false, // unlocked by an achievement (src/data/meta.ts)
    levels: [{ text: 'Hold to fire a piercing beam.', p: { dps: 150, range: 9, width: 0.35, beams: 1, focus: 0 } }],
    tracks: [
      {
        id: 'focus',
        name: 'Focus',
        ranks: [
          { text: '+70 beam damage per second.', p: { dps: 70 } },
          { text: '+80 beam damage per second.', p: { dps: 80 } },
          { text: '+90 beam damage per second.', p: { dps: 90 } },
          { text: '+110 beam damage per second.', p: { dps: 110 } },
        ],
      },
      {
        id: 'lens',
        name: 'Lens',
        ranks: [
          { text: 'Longer, wider beam.', p: { range: 1, width: 0.05 } },
          { text: 'Longer, wider beam.', p: { range: 1, width: 0.05 } },
          { text: 'Much longer beam.', p: { range: 1.5, width: 0.05 } },
          { text: 'Much longer, wider beam.', p: { range: 1.5, width: 0.1 } },
        ],
      },
      {
        id: 'split',
        name: 'Splitter',
        ranks: [
          { text: 'A second beam fans out beside the first.', p: { beams: 1 } },
          { text: '+40 beam damage per second.', p: { dps: 40 } },
          { text: 'A third beam on the other side.', p: { beams: 1 } },
          { text: '+60 beam damage per second.', p: { dps: 60 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'prism', name: "Prism Lance", color: '#fff35c', text: 'Splits into a 5-way rainbow lance. x1.15 damage.', p: { beams: 2, range: 1 }, mul: { dps: 1.15 } },
      { id: 'scorch', name: "Scorch Ray", color: '#ff7a2f', text: 'Fuses into one thick, blazing beam that sets enemies on fire (Fire).', tags: ['fire'], p: { focus: 1 }, mul: { width: 1.8, dps: 1.35 } },
    ],
  },
  orb: {
    id: 'orb',
    rarity: 'legendary',
    slot: 'primary',
    tags: ['projectile', 'area'],
    name: 'Plasma Orb',
    icon: '◉',
    color: '#7dff9a',
    desc: 'LEFT CLICK: slow orbs that zap the nearest enemies as they drift.',
    starter: false, // unlocked by an achievement (src/data/meta.ts)
    levels: [{ text: 'Fires orbs that zap the 3 nearest enemies.', p: { dmg: 18, rate: 1.6, speed: 7, radius: 2.2, tick: 0.25, zaps: 3, life: 2.0, burst: 0, chill: 0 } }],
    tracks: [
      {
        id: 'plasma',
        name: 'Plasma Charge',
        ranks: [
          { text: '+6 zap damage.', p: { dmg: 6 } },
          { text: '+6 zap damage.', p: { dmg: 6 } },
          { text: '+7 zap damage.', p: { dmg: 7 } },
          { text: '+8 zap damage.', p: { dmg: 8 } },
        ],
      },
      {
        id: 'rapid',
        name: 'Rapid Orbs',
        ranks: [
          { text: 'Fires orbs faster.', p: { rate: 0.25 } },
          { text: 'Fires orbs faster.', p: { rate: 0.25 } },
          { text: 'Fires orbs faster.', p: { rate: 0.3 } },
          { text: 'Fires orbs much faster.', p: { rate: 0.3 } },
        ],
      },
      {
        id: 'arc',
        name: 'Arc Field',
        ranks: [
          { text: 'Bigger field, zaps 1 more enemy.', p: { radius: 0.3, zaps: 1 } },
          { text: 'Bigger field, orbs last longer.', p: { radius: 0.3, life: 0.3 } },
          { text: 'Zaps 1 more enemy, faster.', p: { zaps: 1, tick: -0.03 } },
          { text: 'Huge field, zaps 1 more enemy.', p: { radius: 0.4, zaps: 1, tick: -0.02 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'storm', name: "Storm Sphere", color: '#b48cff', text: 'Violet storm orbs Shock what they zap (Shock) and burst when they fade.', tags: ['shock'], p: { burst: 3, radius: 0.3 }, mul: { dmg: 1.15 } },
      { id: 'cryo', name: "Cryo Sphere", color: '#9fe8ff', text: 'Slow, icy orbs freeze what they zap for a moment (Frost).', tags: ['frost'], p: { chill: 0.3, speed: -2, radius: 0.6 }, mul: { dmg: 1.1 } },
    ],
  },
  grenade: {
    id: 'grenade',
    rarity: 'rare',
    slot: 'secondary',
    tags: ['explosive'],
    name: 'Grenade Lobber',
    icon: '●',
    color: '#9be35a',
    desc: 'RIGHT CLICK: lob grenades over the crowd.',
    starter: true,
    levels: [{ text: 'Lobs a grenade where you aim.', p: { cd: 1.2, dmg: 85, radius: 2.6, range: 8, count: 1, bomblets: 0, after: 0 } }],
    tracks: [
      {
        id: 'payload',
        name: 'Payload',
        ranks: [
          { text: '+25 damage.', p: { dmg: 25 } },
          { text: '+25 damage.', p: { dmg: 25 } },
          { text: '+30 damage.', p: { dmg: 30 } },
          { text: '+35 damage.', p: { dmg: 35 } },
        ],
      },
      {
        id: 'reload',
        name: 'Quick Reload',
        ranks: [
          { text: 'Reloads 0.1s faster.', p: { cd: -0.1 } },
          { text: 'Reloads 0.1s faster.', p: { cd: -0.1 } },
          { text: 'Reloads 0.1s faster.', p: { cd: -0.1 } },
          { text: 'Lobs 2 grenades at once.', p: { cd: -0.05, count: 1 } },
        ],
      },
      {
        id: 'wide',
        name: 'Wide Blast',
        ranks: [
          { text: 'Bigger blasts.', p: { radius: 0.3 } },
          { text: 'Bigger blasts, longer throws.', p: { radius: 0.3, range: 1 } },
          { text: 'Bigger blasts.', p: { radius: 0.3 } },
          { text: 'Huge blasts, longer throws.', p: { radius: 0.4, range: 1 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'cluster', name: 'Cluster Mortar', color: '#ff3d5e', text: 'Each shell scatters 6 bomblets into the crowd.', p: { bomblets: 6 } },
      { id: 'thunder', name: 'Thunder Mortar', color: '#73eff7', text: 'Blasts Shock everything (Shock), then a thunderclap hits the spot again.', tags: ['shock'], p: { after: 0.6 } },
    ],
  },
  well: {
    id: 'well',
    rarity: 'legendary',
    slot: 'secondary',
    tags: ['area'],
    name: 'Gravity Well',
    icon: '◌',
    color: '#7a8cff',
    desc: 'RIGHT CLICK: throw a vortex that drags enemies in.',
    starter: false, // unlocked by an achievement (src/data/meta.ts)
    levels: [{ text: 'Throws a vortex that pulls and grinds.', p: { cd: 3.5, radius: 4, pull: 6, dps: 55, life: 2.5, implode: 0, freeze: 0 } }],
    tracks: [
      {
        id: 'crush',
        name: 'Crush',
        ranks: [
          { text: '+25 damage per second.', p: { dps: 25 } },
          { text: '+30 damage per second.', p: { dps: 30 } },
          { text: '+35 damage per second.', p: { dps: 35 } },
          { text: '+40 damage per second.', p: { dps: 40 } },
        ],
      },
      {
        id: 'pull',
        name: 'Wide Pull',
        ranks: [
          { text: 'Bigger vortex, stronger pull.', p: { radius: 0.4, pull: 1 } },
          { text: 'Bigger vortex, stronger pull.', p: { radius: 0.4, pull: 1 } },
          { text: 'Bigger vortex, stronger pull.', p: { radius: 0.4, pull: 1 } },
          { text: 'Huge vortex, much stronger pull.', p: { radius: 0.5, pull: 1.5 } },
        ],
      },
      {
        id: 'stable',
        name: 'Stability',
        ranks: [
          { text: 'Vortexes last longer.', p: { life: 0.4 } },
          { text: 'Recharges 0.25s faster.', p: { cd: -0.25 } },
          { text: 'Vortexes last longer.', p: { life: 0.4 } },
          { text: 'Recharges 0.35s faster.', p: { cd: -0.35 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'horizon', name: "Event Horizon", color: '#c23dff', text: 'A black hole that implodes in a huge blast when it closes (Explosive).', tags: ['explosive'], p: { implode: 450, radius: 0.5, pull: 1 } },
      { id: 'cryo', name: "Cryo Well", color: '#9fe8ff', text: 'An icy vortex that grinds with Frost and freezes everything inside when it closes (Frost).', tags: ['frost'], p: { freeze: 1.5, radius: 0.5 }, mul: { dps: 1.15 } },
    ],
  },
  shield: {
    id: 'shield',
    rarity: 'legendary',
    slot: 'secondary',
    tags: ['area'],
    name: 'Aegis Shield',
    icon: '◗',
    color: '#5ce1ff',
    desc: 'RIGHT CLICK: deploy a shield toward your aim that blocks bullets and slams enemies away until it breaks or times out.',
    starter: false, // unlocked by an achievement (src/data/meta.ts)
    levels: [{ text: 'Press to deploy a shield that follows your aim.', p: { dmg: 30, arc: 100, radius: 1.6, knock: 22, dur: 3, cd: 5, hp: 60, reflect: 0 } }],
    tracks: [
      {
        id: 'bash',
        name: 'Shield Bash',
        ranks: [
          { text: '+12 damage, harder shoves.', p: { dmg: 12, knock: 2 } },
          { text: '+15 damage, harder shoves.', p: { dmg: 15, knock: 2 } },
          { text: '+18 damage, harder shoves.', p: { dmg: 18, knock: 2 } },
          { text: '+22 damage, harder shoves.', p: { dmg: 22, knock: 2 } },
        ],
      },
      {
        id: 'bulwark',
        name: 'Bulwark',
        ranks: [
          { text: 'Tougher, wider shield.', p: { hp: 30, arc: 15 } },
          { text: 'Tougher, wider shield.', p: { hp: 35, arc: 15 } },
          { text: 'Tougher, bigger shield.', p: { hp: 40, arc: 15, radius: 0.2 } },
          { text: 'Much tougher, bigger shield.', p: { hp: 50, arc: 20, radius: 0.2 } },
        ],
      },
      {
        id: 'deploy',
        name: 'Quick Deploy',
        ranks: [
          { text: 'Recharges faster, lasts longer.', p: { cd: -0.3, dur: 0.5 } },
          { text: 'Recharges faster, lasts longer.', p: { cd: -0.3, dur: 0.5 } },
          { text: 'Recharges faster, lasts longer.', p: { cd: -0.3, dur: 0.5 } },
          { text: 'Recharges much faster, lasts longer.', p: { cd: -0.4, dur: 0.8 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'mirror', name: "Mirror Aegis", color: '#ffd23f', text: 'A full golden dome that reflects enemy bullets back at them.', p: { arc: 260, reflect: 1, hp: 60 } },
      { id: 'pyre', name: "Pyre Aegis", color: '#ff7a2f', text: 'A blazing shield that sets everything it touches on fire (Fire). x1.3 damage.', tags: ['fire'], p: { arc: 30 }, mul: { dmg: 1.3 } },
    ],
  },
  rail: {
    id: 'rail',
    rarity: 'legendary',
    slot: 'primary',
    tags: ['projectile'],
    name: 'Rail Driver',
    icon: '⟶',
    color: '#a0c4ff',
    desc: 'LEFT CLICK: a hyper-velocity rail that pierces everything in a long line.',
    starter: false, // unlocked by an achievement (src/data/meta.ts)
    levels: [{ text: 'Fires a rail through every enemy in line.', p: { dmg: 90, rate: 1.6, range: 18, width: 0.5, ion: 0, arcs: 0 } }],
    tracks: [
      {
        id: 'coil',
        name: 'Coil Power',
        ranks: [
          { text: '+30 damage.', p: { dmg: 30 } },
          { text: '+35 damage.', p: { dmg: 35 } },
          { text: '+40 damage.', p: { dmg: 40 } },
          { text: '+45 damage.', p: { dmg: 45 } },
        ],
      },
      {
        id: 'cycle',
        name: 'Cycle Rate',
        ranks: [
          { text: 'Fires faster.', p: { rate: 0.15 } },
          { text: 'Fires faster.', p: { rate: 0.15 } },
          { text: 'Fires faster.', p: { rate: 0.2 } },
          { text: 'Fires much faster.', p: { rate: 0.2 } },
        ],
      },
      {
        id: 'bore',
        name: 'Wide Bore',
        ranks: [
          { text: 'Wider rails.', p: { width: 0.1 } },
          { text: 'Longer, wider rails.', p: { range: 2, width: 0.05 } },
          { text: 'Wider rails.', p: { width: 0.1 } },
          { text: 'Longer, much wider rails.', p: { range: 2, width: 0.1 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'ion', name: "Ion Rail", color: '#9b6bff', text: 'The rail leaves an ion trail that detonates along its length (Explosive).', tags: ['explosive'], p: { ion: 1 }, mul: { dmg: 1.1 } },
      { id: 'storm', name: "Storm Rail", color: '#fff35c', text: 'Rails Shock everything they pierce (Shock) and the first 3 enemies hit arc lightning onward (Chain).', tags: ['shock', 'chain'], p: { arcs: 3 }, mul: { dmg: 1.1 } },
    ],
  },
  orbital: {
    id: 'orbital',
    rarity: 'legendary',
    slot: 'secondary',
    tags: ['area', 'explosive'],
    name: 'Orbital Strike',
    icon: '⇓',
    color: '#73eff7',
    desc: 'RIGHT CLICK: call a satellite beam down from the sky.',
    starter: false, // unlocked by an achievement (src/data/meta.ts)
    levels: [{ text: 'Calls a sky beam where you aim.', p: { cd: 2.6, dmg: 220, radius: 2.4, range: 9, delay: 0.7, linger: 0, dps: 0, count: 1 } }],
    tracks: [
      {
        id: 'uplink',
        name: 'Uplink Power',
        ranks: [
          { text: '+70 damage.', p: { dmg: 70 } },
          { text: '+90 damage.', p: { dmg: 90 } },
          { text: '+100 damage.', p: { dmg: 100 } },
          { text: '+120 damage.', p: { dmg: 120 } },
        ],
      },
      {
        id: 'target',
        name: 'Targeting',
        ranks: [
          { text: 'Recharges faster.', p: { cd: -0.15 } },
          { text: 'Lands faster, recharges faster.', p: { delay: -0.1, cd: -0.1 } },
          { text: 'Recharges faster.', p: { cd: -0.15 } },
          { text: 'Lands faster, recharges much faster.', p: { delay: -0.05, cd: -0.2 } },
        ],
      },
      {
        id: 'wide',
        name: 'Wide Beam',
        ranks: [
          { text: 'Wider beam.', p: { radius: 0.25 } },
          { text: 'Wider beam, longer reach.', p: { radius: 0.25, range: 0.5 } },
          { text: 'Wider beam.', p: { radius: 0.3 } },
          { text: 'Much wider beam, longer reach.', p: { radius: 0.4, range: 0.5 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'sun', name: "Sun Lance", color: '#ff7a2f', text: 'A blazing sun beam that lingers and burns everything under it (Fire).', tags: ['fire'], p: { linger: 2, dps: 250 } },
      { id: 'barrage', name: "Storm Barrage", color: '#fff35c', text: 'Calls 3 crackling beams around the target that Shock what they hit (Shock).', tags: ['shock'], p: { count: 2 }, mul: { dmg: 0.6 } },
    ],
  },
  sweeper: {
    id: 'sweeper',
    rarity: 'uncommon',
    tags: ['area'],
    name: 'Laser Sweep',
    icon: '═',
    color: '#ff3d5a',
    desc: 'Sweeps a burning laser across enemies.',
    starter: false,
    levels: [
      { text: 'Sweeps a laser across enemies.', p: { cd: 3.0, dmg: 6, range: 8, width: 0.5, arc: 90, sweep: 0.6, beams: 1 } },
      { text: 'Longer beam.', p: { cd: 2.9, dmg: 7, range: 9.5, width: 0.55, arc: 90, sweep: 0.6, beams: 1 } },
      { text: 'Wider sweep, more damage.', p: { cd: 2.6, dmg: 9, range: 9.5, width: 0.6, arc: 120, sweep: 0.65, beams: 1 } },
      { text: 'Two beams.', p: { cd: 2.5, dmg: 10, range: 10, width: 0.6, arc: 120, sweep: 0.65, beams: 2 } },
      { text: 'Triple beam!', p: { cd: 2.2, dmg: 12, range: 11, width: 0.7, arc: 140, sweep: 0.7, beams: 3 } },
    ],
    evolution: { name: 'Halo Beam', color: '#ff7eb6', passive: 'capacitor', text: 'Three beams spin a full circle.', p: { cd: 1.6, dmg: 16, range: 13, width: 0.9, arc: 360, sweep: 1.0, beams: 3 } },
  },
  pellets: {
    id: 'pellets',
    rarity: 'common',
    tags: ['projectile'],
    name: 'Pellet Turret',
    icon: '⁂',
    color: '#ffcd75',
    desc: 'An auto turret that blasts pellets at the nearest enemy.',
    starter: false,
    levels: [
      { text: 'Fires 5 pellets at the nearest enemy.', p: { cd: 1.4, dmg: 7, pellets: 5, spread: 40, pierce: 0, range: 9 } },
      { text: '6 harder pellets.', p: { cd: 1.4, dmg: 8, pellets: 6, spread: 40, pierce: 0, range: 9 } },
      { text: 'Fires faster.', p: { cd: 1.2, dmg: 10, pellets: 6, spread: 42, pierce: 0, range: 9.5 } },
      { text: '8 pellets that pierce.', p: { cd: 1.15, dmg: 10, pellets: 8, spread: 45, pierce: 1, range: 9.5 } },
      { text: 'Pellet storm!', p: { cd: 0.9, dmg: 13, pellets: 10, spread: 50, pierce: 1, range: 10 } },
    ],
    evolution: { name: 'Scorch Turret', color: '#ff5d3a', passive: 'plasma_core', text: '14 burning pellets.', p: { cd: 0.7, dmg: 16, pellets: 14, spread: 60, pierce: 2, range: 11 } },
  },
  bouncer: {
    id: 'bouncer',
    rarity: 'uncommon',
    tags: ['orbit', 'projectile'],
    name: 'Bounce Drone',
    icon: '✧',
    color: '#73eff7',
    desc: 'A drone that ricochets between enemies.',
    starter: false,
    levels: [
      { text: 'Bounces between 3 enemies.', p: { cd: 1.6, dmg: 12, bounces: 3, speed: 18, count: 1, hop: 6 } },
      { text: 'Bounces 4 times.', p: { cd: 1.6, dmg: 13, bounces: 4, speed: 19, count: 1, hop: 6 } },
      { text: 'Faster, harder.', p: { cd: 1.4, dmg: 16, bounces: 4, speed: 20, count: 1, hop: 6.5 } },
      { text: 'Two drones.', p: { cd: 1.3, dmg: 17, bounces: 5, speed: 20, count: 2, hop: 6.5 } },
      { text: 'Three drones, 6 bounces!', p: { cd: 1.1, dmg: 20, bounces: 6, speed: 22, count: 3, hop: 7 } },
    ],
    evolution: { name: 'Swarm Mother', color: '#a7f070', passive: 'growth', text: 'Five drones bounce 9 times.', p: { cd: 0.8, dmg: 26, bounces: 9, speed: 26, count: 5, hop: 8 } },
  },
};
