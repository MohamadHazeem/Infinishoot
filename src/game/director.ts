import type { Rng } from '../core/rng';
import { ENEMIES, familyTuning, VETERAN_OF, biomeAllows, bossForStage, type EnemyDef } from '../data/enemies';
import { bossPlayers, capHpComp, countPlayers, hpPlayers } from './eightp';
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

/** Pacing changes count/rate only. Damage, HP, rewards and boss time retain difficulty curves. */
export const adaptiveTuning = {
  enabled: true, min: 0.78, max: 1.18, breather: 6, cooldown: 28,
  nearHp: 0.25, cruiseHp: 0.75, cruiseKills: 0.8, cruiseDpm: 0.35,
  rise: 0.018, fall: 0.22, memory: 15, repay: 0.08,
};

/** Allocation-free telemetry filter, also used by deterministic pacing tests. */
export class AdaptivePace {
  pressure = 1;
  breather = 0;
  cooldown = 0;
  damagePerMinute = 0; // fraction of one hero's max life / minute, team-averaged
  killsPerSecond = 0;
  deaths = 0;
  nearDeaths = 0;
  debt = 0; // deferred pressure-seconds; repaid only after the weakest hero recovers

  reset(): void {
    this.pressure = 1;
    this.breather = this.cooldown = this.damagePerMinute = this.killsPerSecond = 0;
    this.deaths = this.nearDeaths = this.debt = 0;
  }

  hurt(fraction: number, hp01: number, died: boolean, players = 1): void {
    this.damagePerMinute += Math.max(0, fraction) * 60 / adaptiveTuning.memory / Math.max(1, players);
    if (died) this.deaths++;
    if (hp01 <= adaptiveTuning.nearHp && this.cooldown <= 0) {
      this.nearDeaths++;
      this.breather = adaptiveTuning.breather;
      this.cooldown = adaptiveTuning.cooldown;
    }
  }

  step(dt: number, weakestHp: number, kills: number, players = 1): void {
    const t = adaptiveTuning;
    if (!t.enabled) { this.reset(); return; }
    const decay = Math.exp(-dt / t.memory);
    this.damagePerMinute *= decay;
    this.killsPerSecond = this.killsPerSecond * decay + Math.max(0, kills) / Math.max(1, players) / t.memory;
    this.breather = Math.max(0, this.breather - dt);
    this.cooldown = Math.max(0, this.cooldown - dt);
    const cruise = weakestHp >= t.cruiseHp && this.damagePerMinute < t.cruiseDpm && this.killsPerSecond >= t.cruiseKills;
    const target = this.breather > 0 ? t.min : cruise ? t.max : 1 + (weakestHp > 0.5 && this.debt > 0 ? t.repay : 0);
    this.pressure += Math.max(-t.fall * dt, Math.min(t.rise * dt, target - this.pressure));
    this.pressure = Math.max(t.min, Math.min(t.max, this.pressure));
    this.debt = Math.min(8, Math.max(0, this.debt + (1 - this.pressure) * dt));
  }
}

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
  readonly adaptive = new AdaptivePace();
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
  /** Stage length x this (the Pacifist road's shorter stage, src/game/systems/modes.ts); reset by start(). */
  lengthMul = 1;
  /** Boss duel (src/game/systems/bossLane.ts): no more spawns while it plays. */
  hold = false;
  /** Swarm rings sent this stage (firstten lane: the first one is a new player's "use your special" moment). */
  ringsSent = 0;
  private spawnBudget = 0;
  private nextElite = 0;
  private nextRing = 0;
  private nextReaper = 0;
  /** Goldbug arrival time this stage (-1 = not rolled yet, Infinity = none). */
  goldenAt = -1;
  private swarmQueenSent = false;
  private queue: SpawnRequest[] = [];

  start(stage: number): void {
    this.adaptive.reset();
    this.stage = stage;
    this.time = 0;
    this.bossSpawned = false;
    this.lengthMul = 1;
    this.hold = false;
    this.spawnBudget = 0;
    this.nextElite = directorTuning.eliteEvery;
    this.nextRing = directorTuning.ringEvery * 0.6;
    this.nextReaper = directorTuning.reaperDelay;
    this.goldenAt = -1;
    this.swarmQueenSent = false;
    this.queue = [];
    this.ringsSent = 0;
  }

  /** Stage time of the next elite (firstten lane: a heads-up for new players). */
  get nextEliteAt(): number {
    return this.nextElite;
  }

  get duration(): number {
    return directorTuning.stageSeconds * this.lengthMul;
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
    return this.curve(t.hpPerStage, t.hpPerStage2) * (1 + t.hpPerMinute * this.paceMinute) * (1 + 0.45 * (hpPlayers(this.players) - 1)) * this.coop * this.capHp; // eightp: players past 4 count 0.6
  }

  /** Bosses scale per stage only (not by minute), so they stay beatable. */
  get bossHpMul(): number {
    const loop = Math.ceil(this.stage / 4);
    return bossTuning.hp * this.curve(directorTuning.bossPerStage, directorTuning.bossPerStage2) * Math.pow(directorTuning.bossLoopHp, loop - 1) * (1 + 0.6 * (bossPlayers(this.players) - 1)) * this.coop;
  }

  get dmgMul(): number {
    return this.curve(directorTuning.dmgPerStage, directorTuning.dmgPerStage2);
  }

  get speedMul(): number {
    return Math.min(1.4, 1 + directorTuning.speedPerStage * (this.stage - 1));
  }

  /** How many enemies the director wants alive right now. */
  get targetAlive(): number {
    return Math.min(directorTuning.aliveCap, Math.round(this.aliveRaw(this.players)));
  }

  /** The alive target before the cap, for a team of `players`. */
  private aliveRaw(players: number): number {
    const t = directorTuning;
    const k = Math.min(1, this.time / this.duration);
    const n = t.aliveStart + (t.aliveEnd - t.aliveStart) * Math.pow(k, 1.3) + t.alivePerStage * (this.stage - 1);
    return n * (1 + 0.5 * (countPlayers(players) - 1)) * this.coop * this.countMul * this.adaptive.pressure;
  }

  /** 5-8 players (eightp lane): enemies the alive cap cuts beyond what it cuts for 4 come back as life. 1 for up to 4. */
  private get capHp(): number {
    return this.players <= 4 ? 1 : capHpComp(this.aliveRaw(this.players), this.aliveRaw(4), directorTuning.aliveCap);
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

    // Delay spike arrivals during the breather; do not bank a burst for its end.
    if (this.adaptive.breather > 0) {
      this.nextElite = Math.max(this.nextElite, this.time + 2);
      this.nextRing = Math.max(this.nextRing, this.time + 5);
    }
    if (this.time >= this.nextElite && !this.bossSpawned) {
      this.nextElite += t.eliteEvery;
      const choices = this.pool().filter((d) => d.behavior !== 'spawner' && d.id !== 'swarmer');
      this.queue.push({ kind: 'enemy', def: this.vet(rng.pick(choices.length ? choices : this.pool()), rng), elite: true });
    }

    if (this.time >= this.nextRing && !this.bossSpawned) {
      this.nextRing += t.ringEvery * rng.range(0.8, 1.2);
      this.ringsSent++;
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
      this.spawnBudget = Math.min(this.spawnBudget + t.spawnPerSecond * this.adaptive.pressure * dt * (1 + (this.stage - 1) * 0.3), 6);
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
