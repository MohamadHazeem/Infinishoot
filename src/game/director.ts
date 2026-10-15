import type { Rng } from '../core/rng';
import { ENEMIES, bossForStage, type EnemyDef } from '../data/enemies';

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
  hpPerStage: 0.7, // enemy HP multiplier growth per stage
  hpPerMinute: 0.12, // and within a stage
  dmgPerStage: 0.2,
  speedPerStage: 0.04,
  eliteEvery: 48, // seconds
  ringEvery: 36, // seconds between encircling swarm rings
  minuteHead: 1.5, // later stages unlock enemy types this many minutes earlier per stage
};

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
  time = 0;
  bossSpawned = false;
  private spawnBudget = 0;
  private nextElite = 0;
  private nextRing = 0;
  private queue: SpawnRequest[] = [];

  start(stage: number): void {
    this.stage = stage;
    this.time = 0;
    this.bossSpawned = false;
    this.spawnBudget = 0;
    this.nextElite = directorTuning.eliteEvery;
    this.nextRing = directorTuning.ringEvery * 0.6;
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

  get hpMul(): number {
    const t = directorTuning;
    return (1 + t.hpPerStage * (this.stage - 1)) * (1 + t.hpPerMinute * this.paceMinute) * (1 + 0.45 * (this.players - 1));
  }

  /** Bosses scale per stage only (not by minute), so they stay beatable. */
  get bossHpMul(): number {
    return (1 + directorTuning.hpPerStage * (this.stage - 1)) * (1 + 0.6 * (this.players - 1));
  }

  get dmgMul(): number {
    return 1 + directorTuning.dmgPerStage * (this.stage - 1);
  }

  get speedMul(): number {
    return Math.min(1.4, 1 + directorTuning.speedPerStage * (this.stage - 1));
  }

  /** How many enemies the director wants alive right now. */
  get targetAlive(): number {
    const t = directorTuning;
    const k = Math.min(1, this.time / this.duration);
    const n = t.aliveStart + (t.aliveEnd - t.aliveStart) * Math.pow(k, 1.3) + t.alivePerStage * (this.stage - 1);
    return Math.min(t.aliveCap, Math.round(n * (1 + 0.5 * (this.players - 1)) * this.countMul));
  }

  private pool(): EnemyDef[] {
    const minute = this.paceMinute + (this.stage - 1) * directorTuning.minuteHead;
    return Object.values(ENEMIES).filter((d) => d.minMinute >= 0 && d.minMinute <= minute && d.weight > 0);
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
      this.queue.push({ kind: 'enemy', def: rng.pick(choices.length ? choices : this.pool()), elite: true });
    }

    if (this.time >= this.nextRing && !this.bossSpawned) {
      this.nextRing += t.ringEvery * rng.range(0.8, 1.2);
      const minute = this.paceMinute;
      this.queue.push({ kind: 'ring', def: minute > 2.5 && rng.chance(0.4) ? ENEMIES.zippy : ENEMIES.swarmer, count: Math.round(18 + minute * 6 + this.stage * 6) });
    }

    // Keep the field topped up toward the target (lighter during the boss).
    const target = this.bossSpawned ? Math.round(this.targetAlive * 0.25) : this.targetAlive;
    if (alive < target) {
      this.spawnBudget = Math.min(this.spawnBudget + t.spawnPerSecond * dt * (1 + (this.stage - 1) * 0.3), 6);
      while (this.spawnBudget >= 1) {
        this.spawnBudget -= 1;
        const def = this.pick(rng);
        if (def.maxAlive !== undefined && count(def.id) >= def.maxAlive) continue;
        const n = def.pack ? rng.int(def.pack[0], def.pack[1]) : 1;
        for (let i = 0; i < n; i++) this.queue.push({ kind: 'enemy', def });
      }
    }
    return this.queue;
  }
}
