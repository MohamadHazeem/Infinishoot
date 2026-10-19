import { BIOME3_BOSSES, BIOME3_MINIS } from './biome3';
/**
 * Biome bosses (bosses3 lane): one stage boss for each loop-2 biome, their
 * mid-stage mini-bosses and their minions.
 *
 *   Glitch DJ     Neon City     attacks on the beat, bass drops, laser grids, a REMIX phase
 *   Boxer Jack    Toy Factory   springs, crank telegraphs, glove punches, toy soldiers, pinball
 *   Admiral Gale  Sky Fortress  cannon volleys, wind gusts, boarding parties, a lightning storm
 *
 * The defs are registered into ENEMIES by src/data/enemies.ts
 * (`Object.assign(ENEMIES, bosses3Defs())`), so the codec's enemy id table is
 * the same on every machine. This module must not import src/data/enemies.ts
 * at runtime (type imports only). Brains: src/game/bosses3.ts.
 */
import type { EnemyDef } from './enemies';

/** Biome id -> its own stage boss. Omega still ends every loop; see bossForStage. */
export const BIOME_BOSSES: Readonly<Record<string, string>> = { ...BIOME3_BOSSES, neon: 'glitch', factory: 'boxer', sky: 'gale' };

/** Every biome boss id. */
export const BIOME_BOSS_IDS: readonly string[] = Object.values(BIOME_BOSSES);

/** Their mini-bosses (smaller copies on the same brains), from loop 2 only. */
export const BIOME_MINIS: readonly { id: string; of: string }[] = [
  ...BIOME3_MINIS,
  { id: 'mc_static', of: 'glitch' },
  { id: 'jack_jr', of: 'boxer' },
  { id: 'squall', of: 'gale' },
];

/** Glitch DJ's tempo: its beats run on this clock (the 'glitch' boss track plays at the same BPM). */
export const DJ_BPM = 128;

const base = {
  minMinute: -1,
  weight: 0,
  knockbackResist: 0.97,
} as const;

export function bosses3Defs(): Record<string, EnemyDef> {
  return {
    glitch: {
      ...base,
      id: 'glitch',
      material: 'metal',
      death: 'robot',
      voice: 'boss',
      name: 'Glitch DJ',
      behavior: 'glitch',
      model: 'dj',
      boss: true,
      phases: [0.66, 0.33],
      title: 'MASTER OF THE BASS DROP',
      hp: 2600,
      speed: 3.4,
      radius: 1.9,
      bodyColor: '#3b5dc9',
      accentColor: '#73eff7',
      contactDamage: 20,
      xp: 100,
      score: 13000,
    },
    boxer: {
      ...base,
      id: 'boxer',
      material: 'metal',
      death: 'robot',
      voice: 'boss',
      name: 'Boxer Jack',
      behavior: 'boxer',
      model: 'jack',
      boss: true,
      phases: [0.66, 0.33],
      title: 'POP GOES THE KNOCKOUT',
      hp: 2800,
      speed: 2.8,
      radius: 2.0,
      bodyColor: '#ef7d57',
      accentColor: '#ffcd75',
      contactDamage: 22,
      xp: 100,
      score: 13000,
    },
    gale: {
      ...base,
      id: 'gale',
      material: 'metal',
      death: 'robot',
      voice: 'boss',
      name: 'Admiral Gale',
      behavior: 'gale',
      model: 'airship',
      boss: true,
      phases: [0.66, 0.33],
      title: 'TERROR OF THE TRADE WINDS',
      hp: 2500,
      speed: 4.2,
      radius: 2.0,
      bodyColor: '#b13e53',
      accentColor: '#ffcd75',
      contactDamage: 20,
      xp: 100,
      score: 13000,
    },
    // Mini-bosses: smaller, two phases, own bar (src/game/systems/bossFight.ts).
    mc_static: {
      ...base,
      knockbackResist: 0.9,
      id: 'mc_static',
      material: 'metal',
      death: 'robot',
      name: 'MC Static',
      behavior: 'glitch',
      model: 'dj',
      miniboss: true,
      phases: [0.5],
      title: 'OPENING ACT',
      hp: 760,
      speed: 3.6,
      radius: 1.25,
      bodyColor: '#5d275d',
      accentColor: '#a7f070',
      contactDamage: 15,
      xp: 40,
      score: 3000,
      minStage: 5,
    },
    jack_jr: {
      ...base,
      knockbackResist: 0.9,
      id: 'jack_jr',
      material: 'metal',
      death: 'robot',
      name: 'Jack Jr.',
      behavior: 'boxer',
      model: 'jack',
      miniboss: true,
      phases: [0.5],
      title: 'A SURPRISE IN EVERY BOX',
      hp: 820,
      speed: 3.0,
      radius: 1.3,
      bodyColor: '#41a6f6',
      accentColor: '#ffcd75',
      contactDamage: 16,
      xp: 40,
      score: 3000,
      minStage: 5,
    },
    squall: {
      ...base,
      knockbackResist: 0.9,
      id: 'squall',
      material: 'metal',
      death: 'robot',
      name: 'Commodore Squall',
      behavior: 'gale',
      model: 'airship',
      miniboss: true,
      phases: [0.5],
      title: 'FIRST MATE OF THE STORM',
      hp: 700,
      speed: 4.4,
      radius: 1.3,
      bodyColor: '#38b764',
      accentColor: '#f4f4f4',
      contactDamage: 15,
      xp: 40,
      score: 3000,
      minStage: 5,
    },
    // Minions.
    dancer: {
      id: 'dancer',
      material: 'metal',
      death: 'robot',
      name: 'Backup Dancer',
      behavior: 'chase',
      model: 'bopper',
      hp: 30,
      speed: 3.8,
      radius: 0.5,
      bodyColor: '#73eff7',
      accentColor: '#ff3df0',
      contactDamage: 8,
      knockbackResist: 0,
      xp: 1,
      score: 50,
      minMinute: -1,
      weight: 0,
    },
    deckhand: {
      id: 'deckhand',
      material: 'metal',
      death: 'robot',
      name: 'Sky Deckhand',
      behavior: 'lunge',
      model: 'bopper',
      hp: 34,
      speed: 3.5,
      radius: 0.55,
      bodyColor: '#333c57',
      accentColor: '#b13e53',
      contactDamage: 10,
      knockbackResist: 0,
      xp: 2,
      score: 70,
      minMinute: -1,
      weight: 0,
      lunge: { range: 3.4, windup: 0.5, speed: 14, duration: 0.2, recover: 0.6 },
    },
  };
}

/** Phase-change subtitles (phase 2, phase 3), by behaviour. */
export const BOSS3_PHASE_LINES: Readonly<Record<string, string[]>> = {
  glitch: ['', 'TURN IT UP: CROSSING GRIDS', 'REMIX: EVERYTHING PLAYS BACKWARDS'],
  boxer: ['', 'ONE-TWO: DOUBLE PUNCHES', 'THE BOX OPENS: PINBALL!'],
  gale: ['', 'FULL SAIL: CANNONS WITH THE WIND', 'THE STORM: WATCH FOR LIGHTNING'],
};
