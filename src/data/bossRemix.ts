/**
 * Boss rematches and the Titan (bosses lane, wave 1).
 *
 * Rematches: from the second loop, a stage boss you already beat this run comes
 * back remixed: its own palette, name and subtitle, tougher, with new or changed
 * attacks (the flags below, read by the brains in src/game/bosses.ts). The
 * Titan takes one boss slot per loop from loop 2 (src/game/titan.ts).
 *
 * The defs are built here and registered into ENEMIES by src/data/enemies.ts
 * (`Object.assign(ENEMIES, bossLaneDefs(ENEMIES))`), so the snapshot codec's
 * enemy id table is the same on every machine. This module must not import
 * src/data/enemies.ts at runtime (type imports only): enemies.ts imports it
 * while it is still being evaluated.
 */
import type { EnemyDef } from './enemies';

/** Remix tweaks the boss brains read. Missing = the original's behaviour. */
export interface RemixFlags {
  /** King: phase from which slams send out shockwave rings (original 2). */
  shockFrom?: number;
  /** King: bullets in a ring fired on every slam landing (0 = none). */
  landRing?: number;
  /** King and Queen: summons are veterans. */
  vetSummons?: boolean;
  /** Rex: phase from which the fire breath joins its rotation (original 3). */
  breathFrom?: number;
  /** Rex: steps between burning patches while it charges (original 24, 15 from phase 2). */
  fireEvery?: number;
  /** Rex: arms in the bullet spiral (original 3). */
  spiralArms?: number;
  /** Queen: phase from which swarm walls join (original 3). */
  wallFrom?: number;
  /** Queen: bullets in each aimed fan (original 7). */
  fanBullets?: number;
  /** Queen: extra hives per planting. */
  extraHives?: number;
}

export interface RemixDef {
  /** Enemy id of the remix. */
  id: string;
  /** The boss it remixes. */
  of: string;
  name: string;
  title: string;
  bodyColor: string;
  accentColor: string;
  /** HP multiplier on the original's def HP (stage scaling still applies). */
  hp: number;
  flags: RemixFlags;
  /** Phase-change subtitles (phase 2, phase 3). */
  lines: [string, string];
}

/** Remix table: one per regular boss. Omega stays the final boss of every loop. */
export const BOSS_REMIXES: RemixDef[] = [
  {
    id: 'king_ex',
    of: 'king',
    name: 'King Bopper EX',
    title: 'THE BOUNCE STRIKES BACK',
    bodyColor: '#5d275d',
    accentColor: '#ffcd75',
    hp: 1.15,
    flags: { shockFrom: 1, landRing: 12, vetSummons: true },
    lines: ['ROYAL QUAKE: EVERY LANDING SENDS A RING', 'EX FURY'],
  },
  {
    id: 'rex_inferno',
    of: 'rex',
    name: 'Rampage Rex: Inferno',
    title: 'EVERYTHING BURNS',
    bodyColor: '#b13e53',
    accentColor: '#ffcd75',
    hp: 1.15,
    flags: { breathFrom: 2, fireEvery: 8, spiralArms: 4 },
    lines: ['INFERNO: FIRE BREATH ALREADY', 'MELTDOWN'],
  },
  {
    id: 'queen_night',
    of: 'queen',
    name: 'Hive Queen: Nightshade',
    title: 'THE SWARM REMEMBERS',
    bodyColor: '#333c57',
    accentColor: '#a7f070',
    hp: 1.15,
    flags: { wallFrom: 2, fanBullets: 9, extraHives: 1, vetSummons: true },
    lines: ['NIGHTSHADE: WALLS AND HIVES TOGETHER', 'THE LAST BROOD'],
  },
];

/** Remix id of a boss, or undefined. */
export const REMIX_OF: Readonly<Record<string, string>> = Object.fromEntries(BOSS_REMIXES.map((r) => [r.of, r.id]));

/** When rematches and the Titan show up. */
export const remixTuning = {
  /** First loop where beaten bosses come back remixed. */
  fromLoop: 2,
  /** First loop with a Titan (it replaces one regular boss per loop). */
  titanFromLoop: 2,
  /** Stages per loop (src/game/game.ts LOOP_STAGES; the 4th is always Omega). */
  loopStages: 4,
};

/**
 * Titan weak points: index -> kind, phase group and share of the Titan's life.
 * Group 1 (armour plates) breaks first, then 2 (hand cores), then 3 (the eye);
 * the core (the Titan enemy itself, `TITAN_CORE_SHARE`) is exposed last.
 */
export const TITAN_PARTS: readonly { kind: 'plate' | 'hand' | 'eye'; side: number; group: number; share: number }[] = [
  { kind: 'plate', side: -1, group: 1, share: 0.12 },
  { kind: 'plate', side: 1, group: 1, share: 0.12 },
  { kind: 'hand', side: -1, group: 2, share: 0.12 },
  { kind: 'hand', side: 1, group: 2, share: 0.12 },
  { kind: 'eye', side: 0, group: 3, share: 0.16 },
];
export const TITAN_CORE_SHARE = 1 - TITAN_PARTS.reduce((a, p) => a + p.share, 0);

/** Boss-bar ticks: the Titan's life left when each group of weak points is gone. */
export function titanTicks(): number[] {
  const out: number[] = [];
  let left = 1;
  for (let g = 1; g <= 3; g++) {
    for (const p of TITAN_PARTS) if (p.group === g) left -= p.share;
    out.push(Math.round(left * 100) / 100);
  }
  return out;
}

/** Loop slot (0 King, 1 Rex, 2 Queen) the Titan takes in a loop, or -1 for none. */
export function titanSlot(loop: number): number {
  if (loop < remixTuning.titanFromLoop) return -1;
  return (loop - remixTuning.titanFromLoop + 1) % 3; // loop 2: Rex's stage, loop 3: Queen's, loop 4: King's...
}

/**
 * The boss a stage actually gets. `base` is its rotation boss
 * (bossForStage(stage).id), `beaten` the base ids beaten this run.
 * Omega is never replaced; one slot per loop from loop 2 is the Titan; the
 * rest come back remixed once you've beaten them.
 */
export function stageBossId(stage: number, base: string, beaten: ReadonlySet<string>, force: { titan?: boolean; remix?: boolean } = {}): string {
  if (base === 'omega') return base;
  if (force.titan) return 'titan';
  const L = remixTuning.loopStages;
  const loop = Math.ceil(Math.max(1, stage) / L);
  const slot = (Math.max(1, stage) - 1) % L;
  if (titanSlot(loop) === slot) return 'titan';
  const remix = REMIX_OF[base];
  if (remix && (force.remix || (loop >= remixTuning.fromLoop && beaten.has(base)))) return remix;
  return base;
}

/** The base boss of a remix (or the id itself). */
export const remixBase = (id: string): string => BOSS_REMIXES.find((r) => r.id === id)?.of ?? id;

/** Enemy defs this lane adds: the remixes (cloned from their originals) and the Titan with its weak points. */
export function bossLaneDefs(base: Readonly<Record<string, EnemyDef>>): Record<string, EnemyDef> {
  const out: Record<string, EnemyDef> = {};
  for (const r of BOSS_REMIXES) {
    const o = base[r.of];
    out[r.id] = {
      ...o,
      id: r.id,
      name: r.name,
      title: r.title,
      bodyColor: r.bodyColor,
      accentColor: r.accentColor,
      hp: Math.round(o.hp * r.hp),
      xp: Math.round(o.xp * 1.5),
      score: Math.round(o.score * 1.5),
      remixOf: r.of,
      remix: r.flags,
      remixLines: r.lines,
    };
  }
  // The Titan: drawn by its own view (src/game/titan.ts), so every def is hidden from the enemy instancer.
  const part = (id: string, name: string, kind: 'plate' | 'hand' | 'eye', radius: number, bodyColor: string, accentColor: string, material: EnemyDef['material']): EnemyDef => ({
    id,
    name,
    hidden: true,
    behavior: 'titanpart',
    model: 'hive',
    titanPart: kind,
    hp: 1000, // replaced by the Titan's share when it spawns
    speed: 0,
    radius,
    bodyColor,
    accentColor,
    contactDamage: 0,
    knockbackResist: 1,
    xp: 30,
    score: 4000,
    minMinute: -1,
    weight: 0,
    material,
  });
  out.titan = {
    id: 'titan',
    name: 'Titan Goliath',
    hidden: true,
    behavior: 'titan',
    model: 'hive',
    boss: true,
    phases: titanTicks(),
    title: 'THE MOUNTAIN THAT WOKE UP',
    hp: 3400, // ~1.3x King: the whole body, weak points included (TITAN_PARTS shares)
    speed: 0,
    radius: 2.2,
    bodyColor: '#566c86',
    accentColor: '#ffcd75',
    contactDamage: 0,
    knockbackResist: 1,
    xp: 400,
    score: 60000,
    minMinute: -1,
    weight: 0,
    death: 'robot',
    material: 'stone',
  };
  out.titan_plate = part('titan_plate', 'Titan Armour Plate', 'plate', 1.6, '#94b0c2', '#ffcd75', 'metal');
  out.titan_hand = part('titan_hand', 'Titan Hand Core', 'hand', 1.5, '#73eff7', '#41a6f6', 'shield');
  out.titan_eye = part('titan_eye', 'Titan Eye', 'eye', 1.5, '#ff3d5a', '#ffcd75', 'shield');
  return out;
}
