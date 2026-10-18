import type { Rarity } from './rarity';
import type { Upgradable } from './tracks';

/**
 * Specials: the screen-clearing ability on Q/E/middle click (pad RB/Y), on a
 * cooldown, picked in the loadout before the run. Each has 5 levels with full
 * params per level, or upgrade tracks (src/data/tracks.ts, `levels[0]` is the
 * base). `charge` divides the cooldown (upgrades recharge faster), and Battery
 * Pack (`stats.specialCooldownMul`) lowers it for any special.
 * Behaviour: the Bomb lives in Game (tryBomb/updateBomb); the others in
 * src/game/specials.ts.
 */
export interface SpecialDef extends Upgradable {
  id: string;
  name: string;
  /** Short label for the HUD meter. */
  short: string;
  icon: string;
  color: string;
  rarity: Rarity;
  desc: string;
  /** Pickable from the first run; otherwise unlocked by an achievement. */
  starter: boolean;
  levels: { text: string; p: Record<string, number> }[];
}

export const specialTuning = {
  cooldown: 15, // seconds for a level-1 special, before Battery Pack
};

/** Cooldown in seconds of a special with these params, times the hero's specialCooldownMul. */
export function specialCooldown(p: Record<string, number>, mul = 1): number {
  return (specialTuning.cooldown / (p.charge ?? 1)) * mul;
}

/** Cooldown for card text: "12.5s". */
export function cooldownText(s: number): string {
  return `${+s.toFixed(1)}s`;
}

export const SPECIALS: Record<string, SpecialDef> = {
  bomb: {
    id: 'bomb',
    name: 'Bomb',
    short: 'BOMB',
    icon: '✹',
    color: '#ef7d57',
    rarity: 'common',
    desc: 'A shockwave that blasts everything around you and clears enemy bullets.',
    starter: true,
    levels: [{ text: 'Shockwave around you.', p: { dmg: 80, radius: 10, charge: 1, bomblets: 0, implode: 0 } }],
    tracks: [
      {
        id: 'payload',
        name: 'Payload',
        ranks: [
          { text: '+30 damage.', p: { dmg: 30 } },
          { text: '+30 damage.', p: { dmg: 30 } },
          { text: '+30 damage.', p: { dmg: 30 } },
          { text: '+40 damage.', p: { dmg: 40 } },
        ],
      },
      {
        id: 'wave',
        name: 'Shockwave',
        ranks: [
          { text: 'Wider wave.', p: { radius: 1.25 } },
          { text: 'Wider wave.', p: { radius: 1.25 } },
          { text: 'Wider wave.', p: { radius: 1.25 } },
          { text: 'Huge wave.', p: { radius: 1.5 } },
        ],
      },
      {
        id: 'recharge',
        name: 'Recharge',
        ranks: [
          { text: 'Recharges 10% faster.', p: { charge: 0.1 } },
          { text: 'Recharges 10% faster.', p: { charge: 0.1 } },
          { text: 'Recharges 12% faster.', p: { charge: 0.12 } },
          { text: 'Recharges 15% faster.', p: { charge: 0.15 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'cluster', name: 'Cluster Bomb', color: '#ff7a2f', text: 'The wave drops 8 bomblets that pop all around you (Explosive).', p: { bomblets: 8 } },
      { id: 'implode', name: 'Implosion', color: '#b48cff', text: 'The wave pulls enemies in, then a second, bigger blast hits them.', p: { implode: 1 } },
    ],
  },
  storm: {
    id: 'storm',
    name: 'Thunderstorm',
    short: 'STORM',
    icon: 'ϟ',
    color: '#ffcd75',
    rarity: 'rare',
    desc: 'Calls a storm: lightning strikes enemies around you for a few seconds.',
    starter: true,
    levels: [{ text: 'Lightning rains on nearby enemies and chains to 2 more.', p: { dur: 3, rate: 8, dmg: 40, radius: 14, chains: 2, charge: 1, fire: 0 } }],
    tracks: [
      {
        id: 'voltage',
        name: 'Voltage',
        ranks: [
          { text: '+12 bolt damage.', p: { dmg: 12 } },
          { text: '+14 bolt damage.', p: { dmg: 14 } },
          { text: '+16 bolt damage.', p: { dmg: 16 } },
          { text: '+20 bolt damage.', p: { dmg: 20 } },
        ],
      },
      {
        id: 'downpour',
        name: 'Downpour',
        ranks: [
          { text: 'More strikes, longer storm.', p: { rate: 1, dur: 0.5 } },
          { text: 'More strikes, longer storm.', p: { rate: 1, dur: 0.5 } },
          { text: 'Many more strikes, longer storm.', p: { rate: 1.5, dur: 0.5 } },
          { text: 'Many more strikes, longer storm.', p: { rate: 1.5, dur: 0.8 } },
        ],
      },
      {
        id: 'front',
        name: 'Storm Front',
        ranks: [
          { text: 'Wider storm, recharges faster.', p: { radius: 1, charge: 0.1 } },
          { text: 'Bolts chain to 1 more, recharges faster.', p: { chains: 1, charge: 0.1 } },
          { text: 'Wider storm, recharges faster.', p: { radius: 1.5, charge: 0.12 } },
          { text: 'Wider storm, recharges faster.', p: { radius: 1.5, charge: 0.15 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'supercell', name: "Supercell", color: '#73eff7', text: 'Bolts chain to 3 more enemies and strike far more often (Chain).', tags: ['chain'], p: { chains: 3, rate: 4 } },
      { id: 'firestorm', name: "Firestorm", color: '#ff7a2f', text: 'Burning bolts set enemies on fire as they Shock them: every strike sparks an Overload (Fire).', tags: ['fire'], p: { fire: 1 } },
    ],
  },
  blizzard: {
    id: 'blizzard',
    name: 'Blizzard',
    short: 'FREEZE',
    icon: '❄',
    color: '#73eff7',
    rarity: 'rare',
    desc: 'An icy wave freezes everything around you; frozen enemies take extra damage.',
    starter: false,
    levels: [{ text: 'Freezes enemies around you.', p: { radius: 14, freeze: 2.0, shatter: 0.4, dmg: 40, charge: 1, icicles: 0, burst: 0 } }],
    tracks: [
      {
        id: 'frostbite',
        name: 'Frostbite',
        ranks: [
          { text: '+18 damage.', p: { dmg: 18 } },
          { text: '+22 damage.', p: { dmg: 22 } },
          { text: '+26 damage.', p: { dmg: 26 } },
          { text: '+30 damage.', p: { dmg: 30 } },
        ],
      },
      {
        id: 'deep',
        name: 'Deep Freeze',
        ranks: [
          { text: 'Longer freeze, frozen enemies take more.', p: { freeze: 0.25, shatter: 0.1 } },
          { text: 'Longer freeze, frozen enemies take more.', p: { freeze: 0.25, shatter: 0.15 } },
          { text: 'Longer freeze, frozen enemies take more.', p: { freeze: 0.25, shatter: 0.15 } },
          { text: 'Much longer freeze, frozen enemies take more.', p: { freeze: 0.35, shatter: 0.2 } },
        ],
      },
      {
        id: 'whiteout',
        name: 'Whiteout',
        ranks: [
          { text: 'Bigger wave, recharges faster.', p: { radius: 2, charge: 0.08 } },
          { text: 'Bigger wave, recharges faster.', p: { radius: 2, charge: 0.08 } },
          { text: 'Bigger wave, recharges faster.', p: { radius: 2.5, charge: 0.1 } },
          { text: 'Huge wave, recharges faster.', p: { radius: 3, charge: 0.12 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'iceage', name: "Ice Age", color: '#9fe8ff', text: 'While the freeze lasts, icicles rain on frozen enemies (Frost).', p: { icicles: 10 } },
      { id: 'glacier', name: "Glacier Burst", color: '#ffffff', text: 'When the freeze ends, every enemy still frozen bursts in an icy blast (Explosive).', tags: ['explosive'], p: { burst: 1.5 } },
    ],
  },
  meteor: {
    id: 'meteor',
    name: 'Meteor Shower',
    short: 'METEOR',
    icon: '☄',
    color: '#ff7a2f',
    rarity: 'legendary',
    desc: 'Meteors rain down around you, exploding and setting enemies ablaze.',
    starter: false,
    levels: [{ text: '8 meteors crash around you.', p: { count: 8, dur: 2, dmg: 120, blast: 2.4, area: 12, charge: 1, crater: 0, ice: 0 } }],
    tracks: [
      {
        id: 'impact',
        name: 'Impact',
        ranks: [
          { text: '+25 meteor damage.', p: { dmg: 25 } },
          { text: '+30 meteor damage.', p: { dmg: 30 } },
          { text: '+35 meteor damage.', p: { dmg: 35 } },
          { text: '+40 meteor damage.', p: { dmg: 40 } },
        ],
      },
      {
        id: 'barrage',
        name: 'Barrage',
        ranks: [
          { text: '+2 meteors.', p: { count: 2, dur: 0.1 } },
          { text: '+3 meteors.', p: { count: 3, dur: 0.1 } },
          { text: '+3 meteors.', p: { count: 3, dur: 0.1 } },
          { text: '+4 meteors.', p: { count: 4, dur: 0.1 } },
        ],
      },
      {
        id: 'sky',
        name: 'Wide Sky',
        ranks: [
          { text: 'Bigger impacts, recharges faster.', p: { blast: 0.2, area: 1, charge: 0.08 } },
          { text: 'Bigger impacts, recharges faster.', p: { blast: 0.2, area: 1, charge: 0.08 } },
          { text: 'Bigger impacts, recharges faster.', p: { blast: 0.3, area: 1, charge: 0.1 } },
          { text: 'Huge impacts, recharges faster.', p: { blast: 0.3, area: 1.5, charge: 0.12 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'extinction', name: "Extinction", color: '#ff5e3a', text: 'Meteors leave burning craters that scorch anything standing in them (Fire).', tags: ['fire'], p: { crater: 3 } },
      { id: 'comet', name: "Ice Comets", color: '#9fe8ff', text: 'Icy comets freeze everything they hit for a moment (Frost).', tags: ['frost'], p: { ice: 1.5 } },
    ],
  },
};
