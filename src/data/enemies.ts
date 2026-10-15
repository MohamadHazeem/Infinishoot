/** Enemy definitions. Pure data; behaviour lives in game/enemies.ts. */
export type Behavior = 'chase' | 'lunge' | 'shooter' | 'charger' | 'exploder' | 'spawner' | 'boss' | 'rex' | 'queen';
export type Model = 'bopper' | 'swarmer' | 'shooter' | 'charger' | 'exploder' | 'splitter' | 'spawner' | 'king' | 'rex' | 'queen';

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
  shoot?: { keepDistance: number; interval: number; bullets: number; spreadDeg: number; speed: number; damage: number };
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
    contactDamage: 18,
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
    contactDamage: 18,
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
    contactDamage: 25,
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
};

/** Bosses rotate by stage: King, Rex, Queen, King... */
export const BOSS_ORDER = ['king', 'rex', 'queen'];
export function bossForStage(stage: number): EnemyDef {
  return ENEMIES[BOSS_ORDER[(Math.max(1, stage) - 1) % BOSS_ORDER.length]];
}
