/** Enemy definitions. Pure data; behaviour lives in game/enemies.ts. */
export type Behavior = 'chase' | 'lunge' | 'shooter' | 'charger' | 'exploder' | 'spawner' | 'boss' | 'rex' | 'queen' | 'omega' | 'reaper';
export type Model = 'bopper' | 'swarmer' | 'shooter' | 'charger' | 'exploder' | 'splitter' | 'spawner' | 'king' | 'rex' | 'queen' | 'omega' | 'reaper';

export interface EnemyDef {
  id: string;
  name: string;
  behavior: Behavior;
  model: Model;
  hp: number;
  speed: number;
  radius: number;
  bodyColor: string;
  accentColor: string;
  contactDamage: number;
  /** 0 = full knockback, 1 = immovable. */
  knockbackResist: number;
  /** XP gem value dropped on death. */
  xp: number;
  /** Base score before the combo multiplier. */
  score: number;
  /** Stage-1 minute this enemy starts appearing (later stages unlock sooner). -1 = never spawned by the director. */
  minMinute: number;
  /** Relative spawn weight once available. */
  weight: number;
  /** Spawned as a pack of this many (min, max). */
  pack?: [number, number];
  /** Max alive at once (spawners). */
  maxAlive?: number;
  lunge?: { range: number; windup: number; speed: number; duration: number; recover: number };
  /**
   * Shooters. `pattern`: spread (one fan), spiral (spins out a stream of bullets),
   * burst (three quick fans), sniper (long aim line, one fast shot).
   */
  shoot?: { keepDistance: number; interval: number; bullets: number; spreadDeg: number; speed: number; damage: number; pattern?: 'spread' | 'spiral' | 'burst' | 'sniper' };
  charge?: { range: number; windup: number; speed: number; duration: number; recover: number };
  fuse?: { range: number; time: number; radius: number; damage: number };
  split?: { into: string; count: number };
  spawn?: { into: string; count: number; interval: number };
  /** Stage boss (boss bar, bounty, no crowd separation). */
  boss?: boolean;
  /** How it dies: robots scatter bolts and springs, goo splashes, shards shatter. */
  death?: 'robot' | 'goo' | 'shards';
}

export const ENEMIES: Record<string, EnemyDef> = {
  swarmer: {
    id: 'swarmer',
    death: 'goo',
    name: 'Swarmer',
    behavior: 'chase',
    model: 'swarmer',
    hp: 6,
    speed: 4.0,
    radius: 0.36,
    bodyColor: '#7b5cff',
    accentColor: '#ff7eb6',
    contactDamage: 5,
    knockbackResist: 0,
    xp: 1,
    score: 20,
    minMinute: 0,
    weight: 10,
    pack: [5, 9],
  },
  bopper: {
    id: 'bopper',
    death: 'robot',
    name: 'Bopper',
    behavior: 'lunge',
    model: 'bopper',
    hp: 22,
    speed: 3.3,
    radius: 0.55,
    bodyColor: '#ff5e8a',
    accentColor: '#ffd23f',
    contactDamage: 9,
    knockbackResist: 0,
    xp: 2,
    score: 60,
    minMinute: 0,
    weight: 6,
    lunge: { range: 3.2, windup: 0.5, speed: 14, duration: 0.2, recover: 0.6 },
  },
  zippy: {
    id: 'zippy',
    death: 'robot',
    name: 'Zippy',
    behavior: 'lunge',
    model: 'bopper',
    hp: 12,
    speed: 6.0,
    radius: 0.42,
    bodyColor: '#3de0c8',
    accentColor: '#ff7eb6',
    contactDamage: 7,
    knockbackResist: 0,
    xp: 2,
    score: 50,
    minMinute: 1,
    weight: 5,
    pack: [2, 4],
    lunge: { range: 2.6, windup: 0.38, speed: 18, duration: 0.15, recover: 0.45 },
  },
  shooter: {
    id: 'shooter',
    death: 'robot',
    name: 'Blaster Bot',
    behavior: 'shooter',
    model: 'shooter',
    hp: 30,
    speed: 2.6,
    radius: 0.55,
    bodyColor: '#ff9f3d',
    accentColor: '#4fc3ff',
    contactDamage: 8,
    knockbackResist: 0.2,
    xp: 3,
    score: 100,
    minMinute: 1,
    weight: 3,
    shoot: { keepDistance: 8, interval: 2.6, bullets: 3, spreadDeg: 24, speed: 8, damage: 9 },
  },
  spinner: {
    id: 'spinner',
    death: 'robot',
    name: 'Spin Bot',
    behavior: 'shooter',
    model: 'shooter',
    hp: 40,
    speed: 2.2,
    radius: 0.6,
    bodyColor: '#a35cff',
    accentColor: '#ffcd75',
    contactDamage: 8,
    knockbackResist: 0.3,
    xp: 4,
    score: 140,
    minMinute: 2.2,
    weight: 1.6,
    shoot: { keepDistance: 7, interval: 3.6, bullets: 22, spreadDeg: 0, speed: 6.5, damage: 8, pattern: 'spiral' },
  },
  burster: {
    id: 'burster',
    death: 'robot',
    name: 'Burst Bot',
    behavior: 'shooter',
    model: 'shooter',
    hp: 36,
    speed: 2.8,
    radius: 0.55,
    bodyColor: '#38b764',
    accentColor: '#f4f4f4',
    contactDamage: 8,
    knockbackResist: 0.2,
    xp: 4,
    score: 130,
    minMinute: 1.8,
    weight: 1.8,
    shoot: { keepDistance: 9, interval: 3.2, bullets: 3, spreadDeg: 18, speed: 9.5, damage: 8, pattern: 'burst' },
  },
  sniper: {
    id: 'sniper',
    death: 'robot',
    name: 'Sniper Bot',
    behavior: 'shooter',
    model: 'shooter',
    hp: 28,
    speed: 2.4,
    radius: 0.55,
    bodyColor: '#333c57',
    accentColor: '#ff2d4a',
    contactDamage: 6,
    knockbackResist: 0.2,
    xp: 4,
    score: 150,
    minMinute: 2.6,
    weight: 1.2,
    shoot: { keepDistance: 13, interval: 3.4, bullets: 1, spreadDeg: 0, speed: 24, damage: 22, pattern: 'sniper' },
  },
  charger: {
    id: 'charger',
    death: 'robot',
    name: 'Rhino',
    behavior: 'charger',
    model: 'charger',
    hp: 50,
    speed: 2.6,
    radius: 0.65,
    bodyColor: '#ff3d5a',
    accentColor: '#ffd23f',
    contactDamage: 15,
    knockbackResist: 0.5,
    xp: 4,
    score: 150,
    minMinute: 2,
    weight: 2,
    charge: { range: 10, windup: 0.8, speed: 22, duration: 0.5, recover: 1.0 },
  },
  chonk: {
    id: 'chonk',
    death: 'robot',
    name: 'Chonk',
    behavior: 'lunge',
    model: 'bopper',
    hp: 150,
    speed: 2.0,
    radius: 0.85,
    bodyColor: '#9b6bff',
    accentColor: '#ffd23f',
    contactDamage: 15,
    knockbackResist: 0.75,
    xp: 6,
    score: 250,
    minMinute: 2,
    weight: 2,
    lunge: { range: 3.8, windup: 0.75, speed: 11, duration: 0.32, recover: 0.9 },
  },
  exploder: {
    id: 'exploder',
    death: 'robot',
    name: 'Ka-Boomer',
    behavior: 'exploder',
    model: 'exploder',
    hp: 16,
    speed: 4.6,
    radius: 0.5,
    bodyColor: '#3a3d5c',
    accentColor: '#ff3d5a',
    contactDamage: 6,
    knockbackResist: 0,
    xp: 3,
    score: 90,
    minMinute: 3,
    weight: 3,
    fuse: { range: 2.0, time: 0.9, radius: 2.8, damage: 22 },
  },
  splitter: {
    id: 'splitter',
    death: 'goo',
    name: 'Jelly',
    behavior: 'chase',
    model: 'splitter',
    hp: 55,
    speed: 2.8,
    radius: 0.75,
    bodyColor: '#7ddc4a',
    accentColor: '#ffffff',
    contactDamage: 10,
    knockbackResist: 0.3,
    xp: 3,
    score: 120,
    minMinute: 3,
    weight: 2,
    split: { into: 'jellet', count: 3 },
  },
  jellet: {
    id: 'jellet',
    death: 'goo',
    name: 'Jellet',
    behavior: 'chase',
    model: 'splitter',
    hp: 12,
    speed: 4.4,
    radius: 0.4,
    bodyColor: '#a8f07a',
    accentColor: '#ffffff',
    contactDamage: 6,
    knockbackResist: 0,
    xp: 1,
    score: 30,
    minMinute: -1,
    weight: 0,
  },
  spawner: {
    id: 'spawner',
    death: 'shards',
    name: 'Hive Pylon',
    behavior: 'spawner',
    model: 'spawner',
    hp: 260,
    speed: 0,
    radius: 1.0,
    bodyColor: '#9b6bff',
    accentColor: '#4fc3ff',
    contactDamage: 10,
    knockbackResist: 1,
    xp: 15,
    score: 500,
    minMinute: 4,
    weight: 0.6,
    maxAlive: 2,
    spawn: { into: 'swarmer', count: 5, interval: 5 },
  },
  king: {
    id: 'king',
    death: 'robot',
    name: 'King Bopper',
    behavior: 'boss',
    model: 'king',
    boss: true,
    hp: 2400,
    speed: 2.5,
    radius: 2.0,
    bodyColor: '#ff5e8a',
    accentColor: '#ffd23f',
    contactDamage: 20,
    knockbackResist: 0.97,
    xp: 100,
    score: 10000,
    minMinute: -1,
    weight: 0,
  },
  rex: {
    id: 'rex',
    death: 'robot',
    name: 'Rampage Rex',
    behavior: 'rex',
    model: 'rex',
    boss: true,
    hp: 2700,
    speed: 3.2,
    radius: 2.1,
    bodyColor: '#3de0c8',
    accentColor: '#ff7a2f',
    contactDamage: 25,
    knockbackResist: 0.97,
    xp: 100,
    score: 12000,
    minMinute: -1,
    weight: 0,
  },
  queen: {
    id: 'queen',
    death: 'goo',
    name: 'Hive Queen',
    behavior: 'queen',
    model: 'queen',
    boss: true,
    hp: 2300,
    speed: 4.5,
    radius: 1.8,
    bodyColor: '#ffd23f',
    accentColor: '#ff3df0',
    contactDamage: 20,
    knockbackResist: 0.97,
    xp: 100,
    score: 12000,
    minMinute: -1,
    weight: 0,
  },
  /** Final boss of every 4th stage (see bossForStage); three phases in updateOmega. */
  omega: {
    id: 'omega',
    name: 'Omega Overlord',
    behavior: 'omega',
    model: 'omega',
    boss: true,
    hp: 5000, // ~2x King, before bossTuning.hp and stage scaling
    speed: 2.8,
    radius: 2.4,
    bodyColor: '#3b5dc9',
    accentColor: '#ffcd75',
    contactDamage: 35,
    knockbackResist: 1,
    xp: 300,
    score: 50000,
    minMinute: -1,
    weight: 0,
    // Its charge chain: range = distance that triggers a gap-closing charge or jump.
    charge: { range: 15, windup: 0.85, speed: 26, duration: 0.5, recover: 1.0 },
  },
  /**
   * Late-run filter: the director sends Reapers once the team level reaches
   * directorTuning.reaperLevel. Not a boss: no boss bar, doesn't end the stage.
   * Ignores knockback, freezes, slows, crowds and walls.
   */
  reaper: {
    id: 'reaper',
    name: 'Reaper',
    behavior: 'reaper',
    model: 'reaper',
    hp: 15000, // times the director's stage and minute HP scaling (6000 melted in 10-15 s)
    speed: 7.7, // a hero's base speed is 7 (playerTuning.maxSpeed)
    radius: 0.9,
    bodyColor: '#333c57',
    accentColor: '#73eff7',
    contactDamage: 50, // times director.dmgMul
    knockbackResist: 1,
    xp: 150,
    score: 30000,
    minMinute: -1,
    weight: 0,
  },
};

/**
 * Veterans: tougher versions of the regular enemies that the director mixes in
 * from stage 3 (see director.ts veteranChance). Same models and behaviours,
 * a darker armoured palette so they read as dangerous, more life and damage.
 */
export const veteranTuning = { hp: 2.6, dmg: 1.6, speed: 1.08, size: 1.12, reward: 2.5 };

/** Base id -> [body, accent] for its veteran. */
const VETERAN_LOOK: Record<string, [string, string]> = {
  swarmer: ['#29366f', '#ff3d5a'],
  bopper: ['#5d275d', '#ffcd75'],
  zippy: ['#257179', '#ef7d57'],
  shooter: ['#b13e53', '#73eff7'],
  charger: ['#333c57', '#ff7a2f'],
  chonk: ['#566c86', '#ff3d5a'],
  exploder: ['#ef7d57', '#1a1c2c'],
  splitter: ['#257179', '#ffcd75'],
  jellet: ['#38b764', '#5d275d'],
  spawner: ['#29366f', '#ffcd75'],
};

/** Regular enemy id -> its veteran's id. */
export const VETERAN_OF: Record<string, string> = {};

for (const [id, [bodyColor, accentColor]] of Object.entries(VETERAN_LOOK)) {
  const b = ENEMIES[id];
  const t = veteranTuning;
  const vid = 'v_' + id;
  VETERAN_OF[id] = vid;
  ENEMIES[vid] = {
    ...b,
    id: vid,
    name: 'Veteran ' + b.name,
    hp: Math.round(b.hp * t.hp),
    speed: b.speed * t.speed,
    radius: b.radius * t.size,
    bodyColor,
    accentColor,
    contactDamage: Math.round(b.contactDamage * t.dmg),
    xp: Math.round(b.xp * t.reward),
    score: Math.round(b.score * t.reward),
    minMinute: -1, // only spawned by swapping in for the regular one
    weight: 0,
    shoot: b.shoot && { ...b.shoot, damage: Math.round(b.shoot.damage * t.dmg) },
    fuse: b.fuse && { ...b.fuse, damage: Math.round(b.fuse.damage * t.dmg) },
    split: b.split && { ...b.split, into: 'v_' + b.split.into },
    spawn: b.spawn && { ...b.spawn, into: 'v_' + b.spawn.into },
  };
}

/** Bosses rotate by stage: King, Rex, Queen, then the final boss on every 4th stage; stage 5 starts the loop again. */
export const BOSS_ORDER = ['king', 'rex', 'queen', 'omega'];
export function bossForStage(stage: number): EnemyDef {
  return ENEMIES[BOSS_ORDER[(Math.max(1, stage) - 1) % BOSS_ORDER.length]];
}
