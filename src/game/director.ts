import type { Rng } from '../core/rng';
import { ENEMIES, familyTuning, VETERAN_OF, biomeAllows, bossForStage, type EnemyDef } from '../data/enemies';
import { bossTuning } from './enemies';

/**
 * Survival director. Each stage is a timed fight: the number of enemies kept
 * alive ramps up over the stage, new enemy types join minute by minute, an
 * elite arrives every minute, swarm rings close in periodically, and the
 * boss appears when the timer runs out. Later stages scale everything up.
 */
export const directorTuning = {
  stageSeconds: 240,
  aliveStart: 15, // target enemies alive at 0:00
  aliveEnd: 230, // target alive at the end of stage 1
  alivePerStage: 60, // extra target alive per later stage
  aliveCap: 450,
  spawnPerSecond: 14, // max spawn rate when below target
  // Stage scaling is 1 + per * (stage - 1) + per2 * (stage - 1)^2, so each stage hits harder than the last.
  hpPerStage: 1.1, // enemy HP multiplier growth per stage
  hpPerStage2: 0.3,
  hpPerMinute: 0.1, // and within a stage
  dmgPerStage: 0.4,
  dmgPerStage2: 0.03,
  speedPerStage: 0.04,
  eliteEvery: 48, // seconds
  ringEvery: 36, // seconds between encircling swarm rings
  minuteHead: 1.5, // later stages unlock enemy types this many minutes earlier per stage
  veteranFrom: 3, // first stage where veterans (tougher, recoloured enemies) mix in
  veteranPerStage: 0.15, // share of spawns that are veterans, per stage from veteranFrom (capped)
  veteranMax: 0.6,
  // Bosses get their own curve (st2 x2.3, st3 x4.2, st4 x6.7): tuned so god-bot kills take ~30 s, Omega ~60 s.
  bossPerStage: 1.0,
  bossPerStage2: 0.3,
  bossLoopHp: 1.5, // boss HP x this per loop after the first
  reaperLevel: 50, // team level that summons Reapers (a filter for runaway builds)
  reaperDelay: 10, // seconds into a stage before the first one
  reaperEvery: 60, // seconds between Reapers after that
  reaperMax: 4, // most alive at once
  coopEase: 0.9, // co-op only: enemy HP, boss HP and enemy count x this (user: co-op was too hard)
  goldenChance: 1, // chance a stage gets a Goldbug (treasure enemy)
  goldenFrom: 0.2, // it shows up between these fractions of the stage...
  goldenTo: 0.8,
  goldenEarliest: 60, // ...but never in stage 1's first minute
};

/** When the stage's Goldbug arrives (seconds), from a 0..1 roll. */
export function goldenTime(stage: number, duration: number, r: number): number {
  const t = directorTuning;
  const lo = Math.max(duration * t.goldenFrom, stage <= 1 ? t.goldenEarliest : 0);
  const hi = Math.max(lo, duration * t.goldenTo);
  return lo + (hi - lo) * r;
}

export type SpawnRequest =
  | { kind: 'enemy'; def: EnemyDef; elite?: boolean }
  | { kind: 'ring'; def: EnemyDef; count: number }
  | { kind: 'boss'; def: EnemyDef };

export class Director {
  stage = 1;
  /** Co-op scales enemy count and toughness with the number of players. */
  players = 1;
  /** Extra enemies alive (curses, difficulty). */
  countMul = 1;
  /** Team level, set by the game every step; summons Reapers at directorTuning.reaperLevel. */
  teamLevel = 1;
  /** Current arena's biome id (set by the game): biome-native enemies only spawn at home. */
  biome = '';
  time = 0;
  bossSpawned = false;
  /** Boss duel (src/game/systems/bossLane.ts): no more spawns while it plays. */
  hold = false;
  private spawnBudget = 0;
  private nextElite = 0;
  private nextRing = 0;
  private nextReaper = 0;
  /** Goldbug arrival time this stage (-1 = not rolled yet, Infinity = none). */
  goldenAt = -1;
  private swarmQueenSent = false;
  private queue: SpawnRequest[] = [];

  start(stage: number): void {
    this.stage = stage;
    this.time = 0;
    this.bossSpawned = false;
    this.hold = false;
    this.spawnBudget = 0;
    this.nextElite = directorTuning.eliteEvery;
    this.nextRing = directorTuning.ringEvery * 0.6;
    this.nextReaper = directorTuning.reaperDelay;
    this.goldenAt = -1;
    this.swarmQueenSent = false;
    this.queue = [];
  }

  get duration(): number {
    return directorTuning.stageSeconds;
  }

  /**
   * Stage progress in "content minutes": enemy types, HP growth and rings were
   * tuned for 5-minute stages, so shorter stages run through them faster.
   */
  get paceMinute(): number {
    return (this.time / 60) * (300 / this.duration);
  }

  get remaining(): number {
    return Math.max(0, this.duration - this.time);
  }

  /** Co-op eases everything the player count scales up; solo is unaffected. */
  private get coop(): number {
    return this.players > 1 ? directorTuning.coopEase : 1;
  }

  private curve(per: number, per2: number): number {
    const s = this.stage - 1;
    return 1 + per * s + per2 * s * s;
  }

  get hpMul(): number {
    const t = directorTuning;
    return this.curve(t.hpPerStage, t.hpPerStage2) * (1 + t.hpPerMinute * this.paceMinute) * (1 + 0.45 * (this.players - 1)) * this.coop;
  }

  /** Bosses scale per stage only (not by minute), so they stay beatable. */
  get bossHpMul(): number {
    const loop = Math.ceil(this.stage / 4);
    return bossTuning.hp * this.curve(directorTuning.bossPerStage, directorTuning.bossPerStage2) * Math.pow(directorTuning.bossLoopHp, loop - 1) * (1 + 0.6 * (this.players - 1)) * this.coop;
  }

  get dmgMul(): number {
    return this.curve(directorTuning.dmgPerStage, directorTuning.dmgPerStage2);
  }

  get speedMul(): number {
    return Math.min(1.4, 1 + directorTuning.speedPerStage * (this.stage - 1));
  }

  /** How many enemies the director wants alive right now. */
  get targetAlive(): number {
    const t = directorTuning;
    const k = Math.min(1, this.time / this.duration);
    const n = t.aliveStart + (t.aliveEnd - t.aliveStart) * Math.pow(k, 1.3) + t.alivePerStage * (this.stage - 1);
    return Math.min(t.aliveCap, Math.round(n * (1 + 0.5 * (this.players - 1)) * this.coop * this.countMul));
  }

  /** Enemy types the director may send right now (elites pick from these too). */
  pool(): EnemyDef[] {
    const minute = this.paceMinute + (this.stage - 1) * directorTuning.minuteHead;
    return Object.values(ENEMIES).filter((d) => d.minMinute >= 0 && d.minMinute <= minute && (d.minStage ?? 1) <= this.stage && d.weight > 0 && biomeAllows(d, this.biome));
  }

  /** Chance a spawn is swapped for its veteran: 15% on stage 3, 30% on 4... up to 60%. */
  get veteranChance(): number {
    const t = directorTuning;
    return this.stage < t.veteranFrom ? 0 : Math.min(t.veteranMax, t.veteranPerStage * (this.stage - t.veteranFrom + 1));
  }

  private vet(def: EnemyDef, rng: Rng): EnemyDef {
    const v = VETERAN_OF[def.id];
    return v && rng.chance(this.veteranChance) ? ENEMIES[v] : def;
  }

  private pick(rng: Rng): EnemyDef {
    const pool = this.pool();
    let r = rng.next() * pool.reduce((a, d) => a + d.weight, 0);
    for (const d of pool) if ((r -= d.weight) <= 0) return d;
    return pool[0];
  }

  /**
   * Advance the timer and return spawn requests for this step.
   * `alive` = enemies currently alive, `count(id)` = alive of a given type.
   */
  update(dt: number, alive: number, count: (id: string) => number, rng: Rng): SpawnRequest[] {
    const t = directorTuning;
    this.queue.length = 0;
    this.time += dt;

    if (this.time >= this.duration && !this.bossSpawned) {
      this.bossSpawned = true;
      this.queue.push({ kind: 'boss', def: bossForStage(this.stage) });
    }

    if (this.time >= this.nextElite && !this.bossSpawned) {
      this.nextElite += t.eliteEvery;
      const choices = this.pool().filter((d) => d.behavior !== 'spawner' && d.id !== 'swarmer');
      this.queue.push({ kind: 'enemy', def: this.vet(rng.pick(choices.length ? choices : this.pool()), rng), elite: true });
    }

    if (this.time >= this.nextRing && !this.bossSpawned) {
      this.nextRing += t.ringEvery * rng.range(0.8, 1.2);
      const minute = this.paceMinute;
      this.queue.push({ kind: 'ring', def: this.vet(minute > 2.5 && rng.chance(0.4) ? ENEMIES.zippy : ENEMIES.swarmer, rng), count: Math.round(18 + minute * 6 + this.stage * 6) });
    }

    if (!this.swarmQueenSent && !this.bossSpawned && this.stage >= familyTuning.queenFromStage && this.time >= this.duration * familyTuning.queenAt) {
      this.swarmQueenSent = true;
      this.queue.push({ kind: 'enemy', def: ENEMIES.swarmqueen });
    }

    if (this.goldenAt < 0) this.goldenAt = rng.chance(t.goldenChance) ? goldenTime(this.stage, this.duration, rng.next()) : Infinity;
    if (this.time >= this.goldenAt && !this.bossSpawned) {
      this.goldenAt = Infinity;
      this.queue.push({ kind: 'enemy', def: ENEMIES.golden });
    }

    if (this.teamLevel >= t.reaperLevel && this.time >= this.nextReaper && !this.bossSpawned) {
      this.nextReaper = this.time + t.reaperEvery;
      if (count('reaper') < t.reaperMax) this.queue.push({ kind: 'enemy', def: ENEMIES.reaper });
    }

    // Keep the field topped up toward the target (lighter during the boss).
    const target = this.bossSpawned ? Math.round(this.targetAlive * 0.25) : this.targetAlive;
    if (alive < target && !this.hold) {
      this.spawnBudget = Math.min(this.spawnBudget + t.spawnPerSecond * dt * (1 + (this.stage - 1) * 0.3), 6);
      while (this.spawnBudget >= 1) {
        this.spawnBudget -= 1;
        const def = this.vet(this.pick(rng), rng);
        if (def.maxAlive !== undefined && count(def.id) >= def.maxAlive) continue;
        const n = def.pack ? rng.int(def.pack[0], def.pack[1]) : 1;
        for (let i = 0; i < n; i++) this.queue.push({ kind: 'enemy', def });
      }
    }
    return this.queue;
  }
}
