/** Enemy definitions. Pure data; behaviour lives in game/enemies.ts. */
export type Behavior = 'chase' | 'lunge' | 'shooter' | 'charger' | 'exploder' | 'spawner' | 'shielder' | 'leaper' | 'medic' | 'mortar' | 'golden' | 'boss' | 'rex' | 'queen' | 'omega' | 'reaper';
export type Model = 'bopper' | 'swarmer' | 'shooter' | 'charger' | 'exploder' | 'splitter' | 'spawner' | 'shielder' | 'leaper' | 'medic' | 'mortar' | 'golden' | 'king' | 'rex' | 'queen' | 'omega' | 'reaper' | 'hive';

export interface EnemyDef {
  id: string;
  name: string;
  /** Not drawn (PvP stand-ins for heroes). */
  hidden?: boolean;
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
  /** First stage it can appear on (default 1). */
  minStage?: number;
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
  /**
   * Shielders: hits from inside the front arc (`arcDeg` either side of facing) deal
   * x`frontMul`; allies within `range` behind it take x`behindMul` from that side.
   * `turn` is how fast it can swing round (rad/s), which is what makes flanking work.
   */
  guard?: { arcDeg: number; frontMul: number; behindMul: number; range: number; turn: number };
  /** Leapers: telegraphed hop in an arc (over cover) onto a marked landing ring. */
  leap?: { range: number; windup: number; air: number; height: number; radius: number; damage: number; recover: number; cooldown: number };
  /** Medics: every `interval` s heal allies within `radius` by `frac` of their max life. */
  heal?: { radius: number; frac: number; interval: number; windup: number; keepDistance: number };
  /** Mortars: lob `shells` telegraphed shells around you every `interval` s. */
  mortar?: { keepDistance: number; interval: number; shells: number; radius: number; delay: number; damage: number };
  /** Treasure enemy: flees, escapes after `life` seconds, drops a jackpot when caught. */
  treasure?: { life: number };
  /** Stage boss (boss bar, bounty, no crowd separation). */
  boss?: boolean;
  /**
   * Bosses and mini-bosses: HP fractions where the next phase starts (src/game/bosses.ts).
   * Crossing one triggers an invulnerable roar and a new attack set; damage can't skip a phase.
   */
  phases?: number[];
  /** Mid-stage mini-boss (own bar, drops a chest, not the stage boss). */
  miniboss?: boolean;
  /** Subtitle on the boss entrance title card. */
  title?: string;
  /** How it dies: robots scatter bolts and springs, goo splashes, shards shatter. */
  death?: 'robot' | 'goo' | 'shards';
  /** What hits sound like (src/audio/voices.ts); set for every enemy from ENEMY_MATERIALS below. */
  material?: Material;
}

/** Hit-sound materials: each maps to a recorded impact (hit_metal, hit_flesh, hit_slime, hit_stone, hit_shield). */
export type Material = 'metal' | 'flesh' | 'slime' | 'stone' | 'shield';

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
    // Joins in the last minute of stage 2 (user): content minute 3.75 of 5 plus stage 2's 1.5 head start.
    minMinute: 5.25,
    minStage: 2,
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
  shielder: {
    id: 'shielder',
    death: 'robot',
    name: 'Shield Bot',
    behavior: 'shielder',
    model: 'shielder',
    hp: 70,
    speed: 2.4,
    radius: 0.62,
    bodyColor: '#4fc3ff',
    accentColor: '#ffcd75',
    contactDamage: 12,
    knockbackResist: 0.8,
    xp: 4,
    score: 160,
    minMinute: 2.2,
    weight: 1.6,
    maxAlive: 8,
    guard: { arcDeg: 70, frontMul: 0.15, behindMul: 0.5, range: 3.6, turn: 1.5 },
    lunge: { range: 2.4, windup: 0.55, speed: 10, duration: 0.18, recover: 0.8 },
  },
  medic: {
    id: 'medic',
    death: 'robot',
    name: 'Medi Bot',
    behavior: 'medic',
    model: 'medic',
    hp: 34,
    speed: 3.2,
    radius: 0.5,
    bodyColor: '#f4f4f4',
    accentColor: '#38b764',
    contactDamage: 5,
    knockbackResist: 0.1,
    xp: 6,
    score: 300,
    minMinute: 3,
    weight: 1.0,
    maxAlive: 3,
    heal: { radius: 6, frac: 0.15, interval: 3.6, windup: 0.8, keepDistance: 10 },
  },
  leaper: {
    id: 'leaper',
    death: 'goo',
    name: 'Hop Frog',
    behavior: 'leaper',
    model: 'leaper',
    hp: 40,
    speed: 3.0,
    radius: 0.55,
    bodyColor: '#a7f070',
    accentColor: '#ff7a2f',
    contactDamage: 8,
    knockbackResist: 0.2,
    xp: 4,
    score: 140,
    // Stage 2 from 1:12 (content minute 1.5 after stage 2's 1.5 head start).
    minMinute: 3,
    minStage: 2,
    weight: 2,
    pack: [2, 3],
    leap: { range: 10, windup: 0.6, air: 0.75, height: 3.2, radius: 1.8, damage: 16, recover: 0.7, cooldown: 2.4 },
  },
  mortar: {
    id: 'mortar',
    death: 'robot',
    name: 'Mortar Toad',
    behavior: 'mortar',
    model: 'mortar',
    hp: 46,
    speed: 2.0,
    radius: 0.62,
    bodyColor: '#ef7d57',
    accentColor: '#333c57',
    contactDamage: 8,
    knockbackResist: 0.4,
    xp: 5,
    score: 180,
    // Stage 2 from 2:00.
    minMinute: 4,
    minStage: 2,
    weight: 1.2,
    maxAlive: 5,
    mortar: { keepDistance: 12, interval: 3.6, shells: 3, radius: 1.7, delay: 1.2, damage: 14 },
  },
  /** Rare treasure enemy: the director sends one per stage (see director.ts goldenTime). */
  golden: {
    id: 'golden',
    death: 'shards',
    name: 'Goldbug',
    behavior: 'golden',
    model: 'golden',
    hp: 90,
    speed: 6.4, // a hero's base speed is 7: catchable, but you have to chase
    radius: 0.55,
    bodyColor: '#ffd23f',
    accentColor: '#fff6c8',
    contactDamage: 0,
    knockbackResist: 0.4,
    xp: 40,
    score: 5000,
    minMinute: -1,
    weight: 0,
    treasure: { life: 12 },
  },
  king: {
    id: 'king',
    death: 'robot',
    name: 'King Bopper',
    behavior: 'boss',
    model: 'king',
    boss: true,
    phases: [0.66, 0.33],
    title: 'RULER OF THE BOUNCE',
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
    phases: [0.66, 0.33],
    title: 'THE HORN THAT FEARS NO WALL',
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
    phases: [0.66, 0.33],
    title: 'MOTHER OF THE SWARM',
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
    phases: [0.6, 0.25], // omegaTuning.phase2At / phase3At
    title: 'THE FINAL PROGRAM',
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
   * Mid-stage mini-bosses (from stage 2, see src/game/systems/bossFight.ts): smaller
   * variants of the bosses with the same brains, two phases and their own bar.
   */
  prince: {
    id: 'prince',
    death: 'robot',
    name: 'Prince Bopper',
    behavior: 'boss',
    model: 'king',
    miniboss: true,
    phases: [0.5],
    title: 'HEIR TO THE BOUNCE',
    hp: 720,
    speed: 2.8,
    radius: 1.3,
    bodyColor: '#41a6f6',
    accentColor: '#ffcd75',
    contactDamage: 16,
    knockbackResist: 0.9,
    xp: 40,
    score: 3000,
    minMinute: -1,
    minStage: 2,
    weight: 0,
  },
  rexling: {
    id: 'rexling',
    death: 'robot',
    name: 'Rex Jr.',
    behavior: 'rex',
    model: 'rex',
    miniboss: true,
    phases: [0.5],
    title: 'LITTLE HORN, BIG TEMPER',
    hp: 800,
    speed: 3.4,
    radius: 1.35,
    bodyColor: '#a7f070',
    accentColor: '#ef7d57',
    contactDamage: 18,
    knockbackResist: 0.9,
    xp: 40,
    score: 3000,
    minMinute: -1,
    minStage: 2,
    weight: 0,
  },
  princess: {
    id: 'princess',
    death: 'goo',
    name: 'Hive Princess',
    behavior: 'queen',
    model: 'queen',
    miniboss: true,
    phases: [0.5],
    title: 'HEIR TO THE HIVE',
    hp: 700,
    speed: 4.8,
    radius: 1.2,
    bodyColor: '#f4f4f4',
    accentColor: '#b13e53',
    contactDamage: 15,
    knockbackResist: 0.9,
    xp: 40,
    score: 3000,
    minMinute: -1,
    minStage: 2,
    weight: 0,
  },
  /** Planted by the Hive Queen: hatches Swarmers until destroyed, and heals her while it stands. */
  hive: {
    id: 'hive',
    death: 'goo',
    name: 'Royal Hive',
    behavior: 'spawner',
    model: 'hive',
    hp: 180,
    speed: 0,
    radius: 0.85,
    bodyColor: '#ffcd75',
    accentColor: '#ef7d57',
    contactDamage: 8,
    knockbackResist: 1,
    xp: 4,
    score: 400,
    minMinute: -1,
    weight: 0,
    spawn: { into: 'swarmer', count: 3, interval: 5.5 },
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
  shielder: ['#29366f', '#ff7a2f'],
  medic: ['#566c86', '#a7f070'],
  leaper: ['#257179', '#ff3d5a'],
  mortar: ['#5d275d', '#ffcd75'],
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
    leap: b.leap && { ...b.leap, damage: Math.round(b.leap.damage * t.dmg) },
    mortar: b.mortar && { ...b.mortar, damage: Math.round(b.mortar.damage * t.dmg) },
  };
}

/**
 * Elite squads: the escort an elite brings (src/game/systems/enemyAi.ts spawnSquad).
 * Shooters and mortars bring melee bodyguards; brawlers bring fast flankers.
 */
export function squadOf(def: EnemyDef): string {
  const base = def.id.startsWith('v_') ? def.id.slice(2) : def.id;
  const pick: Record<string, string> = {
    shooter: 'bopper',
    burster: 'bopper',
    sniper: 'shielder',
    spinner: 'shielder',
    mortar: 'shielder',
    medic: 'bopper',
    charger: 'zippy',
    chonk: 'zippy',
    exploder: 'exploder',
    splitter: 'jellet',
    shielder: 'shooter',
    leaper: 'leaper',
    zippy: 'zippy',
  };
  const id = pick[base] ?? 'bopper';
  return def.id.startsWith('v_') && VETERAN_OF[id] ? VETERAN_OF[id] : id;
}

/** Squad size for an elite on `stage`: 3 on stage 1, one more every 2 stages, at most 6. */
export function squadSize(stage: number): number {
  return Math.min(6, 3 + Math.floor((Math.max(1, stage) - 1) / 2));
}

/** Bosses rotate by stage: King, Rex, Queen, then the final boss on every 4th stage; stage 5 starts the loop again. */
export const BOSS_ORDER = ['king', 'rex', 'queen', 'omega'];
export function bossForStage(stage: number): EnemyDef {
  return ENEMIES[BOSS_ORDER[(Math.max(1, stage) - 1) % BOSS_ORDER.length]];
}

/** Mini-bosses and the boss each one is a smaller copy of. */
export const MINI_BOSSES: { id: string; of: string }[] = [
  { id: 'prince', of: 'king' },
  { id: 'rexling', of: 'rex' },
  { id: 'princess', of: 'queen' },
];

/** The mid-stage mini-boss for a stage: never a copy of that stage's own boss, rotating by stage. */
export function miniBossForStage(stage: number): EnemyDef {
  const boss = bossForStage(stage).id;
  const pool = MINI_BOSSES.filter((m) => m.of !== boss);
  return ENEMIES[pool[Math.max(0, stage) % pool.length].id];
}

/** Every enemy's hit material (veterans use their base enemy's). Unlisted enemies sound like flesh. */
export const ENEMY_MATERIALS: Readonly<Record<string, Material>> = {
  swarmer: 'flesh',
  bopper: 'metal',
  zippy: 'metal',
  shooter: 'metal',
  spinner: 'metal',
  burster: 'metal',
  sniper: 'metal',
  charger: 'stone',
  chonk: 'stone',
  exploder: 'metal',
  splitter: 'slime',
  jellet: 'slime',
  spawner: 'stone',
  shielder: 'shield',
  medic: 'metal',
  leaper: 'flesh',
  mortar: 'flesh',
  golden: 'metal',
  king: 'metal',
  rex: 'stone',
  queen: 'flesh',
  omega: 'metal',
  prince: 'metal',
  rexling: 'stone',
  princess: 'flesh',
  hive: 'slime',
  reaper: 'stone',
};
for (const def of Object.values(ENEMIES)) {
  def.material ??= ENEMY_MATERIALS[def.id] ?? ENEMY_MATERIALS[def.id.replace(/^v_/, '')] ?? 'flesh';
}
