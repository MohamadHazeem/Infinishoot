import type { Rng } from '../core/rng';
import { ENEMIES, familyTuning, VETERAN_OF, biomeAllows, bossForStage, type EnemyDef } from '../data/enemies';
import { bossPlayers, capHpComp, countPlayers, hpPlayers } from './eightp';
import { bossTuning } from './enemies';
import { firstTenTuning } from './firstten';

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

/** Density and composition respond to team performance independently of the stage damage and boss HP curves. */
export const adaptiveTuning = {
  enabled: true, min: 0.78, max: 1.27, breather: 6, cooldown: 28,
  nearHp: 0.25, cruiseHp: 0.75, cruiseKills: 0.8, cruiseDpm: 0.35,
  rise: 0.018, fall: 0.22, memory: 15, repay: 0.08,
  powerStart: 0.65, powerFull: 0.95, mixRiseSeconds: 20, mixFallSeconds: 6,
  openingMix: 0.4, secondStageMix: 0.6,
  eliteRateBonus: 0.26, ringRateBonus: 0.18, shooterWeightBonus: 0.4,
  lateEliteQuiet: 8,
};

const unit = (v: number) => Math.max(0, Math.min(1, v));

function powerBucket() {
  return { seconds: 0, kills: 0, spawns: 0, damage: 0, full: 0, idle: 0, eliteSeconds: 0, elites: 0 };
}

/** Nine five-second buckets, scored only at bucket boundaries. All times use simulation seconds. */
export class PowerWindow {
  private readonly buckets = Array.from({ length: 9 }, powerBucket);
  private index = 0;
  score = 0;
  ready = false;

  reset(): void {
    for (const bucket of this.buckets) Object.assign(bucket, powerBucket());
    this.index = this.score = 0;
    this.ready = false;
  }

  spawn(): void { this.buckets[this.index].spawns++; }
  hurt(fractionPerHero: number): void { this.buckets[this.index].damage += fractionPerHero; }
  elite(seconds: number): void {
    const bucket = this.buckets[this.index];
    bucket.eliteSeconds += seconds;
    bucket.elites++;
  }

  step(dt: number, kills: number, fullShare: number, idleShare: number): void {
    const b = this.buckets[this.index];
    b.seconds += dt;
    b.kills += Math.max(0, kills);
    b.full += dt * fullShare;
    b.idle += dt * idleShare;
    if (b.seconds + 1e-8 < 5) return;

    let time = 0, cleared = 0, arrivals = 0, damage = 0, full = 0, idle = 0, eliteTime = 0, elites = 0;
    for (const w of this.buckets) {
      time += w.seconds;
      cleared += w.kills;
      arrivals += w.spawns;
      damage += w.damage;
      full += w.full;
      idle += w.idle;
      eliteTime += w.eliteSeconds;
      elites += w.elites;
    }
    // Camping counts as spare capacity only when the team actually clears incoming enemies.
    const clear = unit(cleared / Math.max(1, arrivals)) * unit(cleared / time);
    const eliteSpeed = elites ? unit(1 - eliteTime / elites / 30) : 0.5;
    const strength = 0.35 + 0.25 * unit(1 - damage * 60 / time) + 0.18 * full / time
      + 0.10 * idle / time + 0.12 * eliteSpeed;
    // Establish one full observation window before changing the wave mix.
    this.ready = time >= 45 - 1e-6;
    this.score = unit(clear * strength);
    this.index = (this.index + 1) % this.buckets.length;
    const next = this.buckets[this.index];
    next.seconds = next.kills = next.spawns = next.damage = next.full = next.idle = next.eliteSeconds = next.elites = 0;
  }
}

/** Allocation-free telemetry filter, also used by deterministic pacing tests. */
export class AdaptivePace {
  readonly power = new PowerWindow();
  pressure = 1;
  assist = true; // standalone legacy pacing; the host supplies the run difficulty each step
  intensity = 0; // smoothed share of the extra elites, shooters and rings
  breather = 0;
  cooldown = 0;
  damagePerMinute = 0; // fraction of one hero's max life / minute, team-averaged
  killsPerSecond = 0;
  deaths = 0;
  nearDeaths = 0;
  debt = 0; // deferred pressure-seconds; repaid only after the weakest hero recovers

  reset(): void {
    this.power.reset();
    this.intensity = 0;
    this.pressure = 1;
    this.breather = this.cooldown = this.damagePerMinute = this.killsPerSecond = 0;
    this.deaths = this.nearDeaths = this.debt = 0;
  }

  hurt(fraction: number, hp01: number, died: boolean, players = 1): void {
    const damage = Math.max(0, fraction) / Math.max(1, players);
    this.power.hurt(damage);
    this.damagePerMinute += damage * 60 / adaptiveTuning.memory;
    if (died) this.deaths++;
    if (hp01 <= adaptiveTuning.nearHp && this.cooldown <= 0) {
      this.nearDeaths++;
      this.breather = adaptiveTuning.breather;
      this.cooldown = adaptiveTuning.cooldown;
    }
  }

  step(dt: number, weakestHp: number, kills: number, players = 1, stage = 3, fieldRoom = 1): void {
    const t = adaptiveTuning;
    if (!t.enabled) { this.pressure = 1; this.intensity = this.breather = this.debt = 0; return; }
    const decay = Math.exp(-dt / t.memory);
    this.damagePerMinute *= decay;
    this.killsPerSecond = this.killsPerSecond * decay + Math.max(0, kills) / Math.max(1, players) / t.memory;
    this.breather = Math.max(0, this.breather - dt);
    this.cooldown = Math.max(0, this.cooldown - dt);
    const cruise = weakestHp >= t.cruiseHp && this.damagePerMinute < t.cruiseDpm && this.killsPerSecond >= t.cruiseKills;
    const floor = this.assist ? t.min : 1;
    const headroom = unit((weakestHp - 0.35) / 0.4);
    // Give the opening stages time to establish a build before using the full wave mix.
    const stageShare = stage <= 1 ? t.openingMix : stage === 2 ? t.secondStageMix : 1;
    const surplus = this.breather > 0 || !this.power.ready ? 0 : unit((this.power.score - t.powerStart) / Math.max(0.01, t.powerFull - t.powerStart)) * headroom * stageShare * fieldRoom;
    this.intensity += Math.max(-dt / t.mixFallSeconds, Math.min(dt / t.mixRiseSeconds, surplus - this.intensity));
    // Established builds can sustain the old cruising crowd size. Keep the opening
    // and the refill budget tied to the measured mix so early XP stays bounded.
    const proven = this.power.ready && this.power.score >= t.powerStart;
    const cruiseBonus = cruise && (this.assist || (stage >= 3 && proven)) ? 0.18 : 0;
    const power = cruiseBonus + this.intensity * (t.max - 1 - cruiseBonus);
    const recovery = weakestHp > 0.5 && this.debt > 0 ? t.repay : 0;
    const target = this.breather > 0 ? floor : 1 + Math.max(power, recovery);
    this.pressure += Math.max(-t.fall * dt, Math.min(t.rise * dt, target - this.pressure));
    this.pressure = Math.max(floor, Math.min(t.max, this.pressure));
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
  // Primitive fields are included in the existing host-migration checkpoint.
  enrageBoss = '';
  bossAge = 0;
  lastBossTime = 0;
  bossBaseSpeed = 1;
  bossBaseDamage = 1;
  enrageStep = 0;
  bonusPattern = false;
  resumePatternAt = -1;
  enrageIn = 0;
  /** Stage length x this (the Pacifist road's shorter stage, src/game/systems/modes.ts); reset by start(). */
  lengthMul = 1;
  /** Boss duel (src/game/systems/bossLane.ts): no more spawns while it plays. */
  hold = false;
  /** Swarm rings sent this stage (firstten lane: the first one is a new player's "use your special" moment). */
  ringsSent = 0;
  private spawnBudget = 0;
  private nextElite = 0;
  private nextRing = 0;
  private baselineElite = 0;
  elitesSent = 0;
  private baselineRing = 0;
  private nextReaper = 0;
  /** Goldbug arrival time this stage (-1 = not rolled yet, Infinity = none). */
  goldenAt = -1;
  private swarmQueenSent = false;
  private queue: SpawnRequest[] = [];
  private readonly refillPool: EnemyDef[] = [];
  private readonly refills = new WeakMap<EnemyDef, SpawnRequest>();

  start(stage: number): void {
    this.adaptive.reset();
    this.stage = stage;
    this.time = 0;
    this.bossSpawned = false;
    this.resetBossClock();
    this.lengthMul = 1;
    this.hold = false;
    this.spawnBudget = 0;
    this.baselineElite = this.nextElite = directorTuning.eliteEvery;
    this.baselineRing = this.nextRing = directorTuning.ringEvery * 0.6;
    this.nextReaper = directorTuning.reaperDelay;
    this.goldenAt = -1;
    this.swarmQueenSent = false;
    this.queue = [];
    this.ringsSent = this.elitesSent = 0;
  }

  resetBossClock(id = ''): void {
    this.enrageBoss = id;
    this.bossAge = this.enrageStep = this.enrageIn = 0;
    this.lastBossTime = this.time;
    this.bonusPattern = false;
    this.resumePatternAt = -1;
  }

  /** Stage time of the next elite (firstten lane: a heads-up for new players). */
  get nextEliteAt(): number {
    return this.nextElite;
  }

  get nextRingAt(): number { return this.nextRing; }
  get acceleratedRing(): boolean { return this.nextRing < this.baselineRing; }
  get acceleratedElite(): boolean { return this.nextElite < this.baselineElite; }

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
    return Math.min(directorTuning.aliveCap, Math.round(this.aliveRaw(this.players) * this.adaptive.pressure));
  }

  /** The alive target before the cap, for a team of `players`. */
  private aliveRaw(players: number): number {
    const t = directorTuning;
    const k = Math.min(1, this.time / this.duration);
    const n = t.aliveStart + (t.aliveEnd - t.aliveStart) * Math.pow(k, 1.3) + t.alivePerStage * (this.stage - 1);
    return n * (1 + 0.5 * (countPlayers(players) - 1)) * this.coop * this.countMul;
  }

  /** 5-8 players (eightp lane): enemies the alive cap cuts beyond what it cuts for 4 come back as life. 1 for up to 4. */
  private get capHp(): number {
    return this.players <= 4 ? 1 : capHpComp(this.aliveRaw(this.players), this.aliveRaw(4), directorTuning.aliveCap);
  }

  /** Enemy types the director may send right now (elites pick from these too). */
  pool(out: EnemyDef[] = []): EnemyDef[] {
    const minute = this.paceMinute + (this.stage - 1) * directorTuning.minuteHead;
    out.length = 0;
    for (const id in ENEMIES) {
      const d = ENEMIES[id];
      if (d.minMinute >= 0 && d.minMinute <= minute && (d.minStage ?? 1) <= this.stage && d.weight > 0 && biomeAllows(d, this.biome)) out.push(d);
    }
    return out;
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

  private pick(rng: Rng, pool: EnemyDef[]): EnemyDef {
    const shooter = 1 + adaptiveTuning.shooterWeightBonus * this.adaptive.intensity;
    let total = 0;
    for (const d of pool) total += d.weight * (d.behavior === 'shooter' ? shooter : 1);
    let r = rng.next() * total;
    for (const d of pool) if ((r -= d.weight * (d.behavior === 'shooter' ? shooter : 1)) <= 0) return d;
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
    if (this.adaptive.assist && this.adaptive.breather > 0) {
      this.nextElite = Math.max(this.nextElite, this.time + 2);
      this.nextRing = Math.max(this.nextRing, this.time + 5);
    }
    if (this.time >= this.nextElite && !this.bossSpawned) {
      this.elitesSent++;
      // Once announced an arrival keeps its deadline. Apply the smoothed mix to the next interval.
      this.baselineElite = this.nextElite + t.eliteEvery;
      this.nextElite += t.eliteEvery / (1 + adaptiveTuning.eliteRateBonus * this.adaptive.intensity);
      // A tiny cadence bonus used to put an entire extra elite/chest just before the boss.
      // Keep the final warning clear once all of the stage's base elites have been scheduled.
      const baselineElites = Math.ceil(this.duration / t.eliteEvery) - 1;
      const quiet = this.stage <= 2 ? firstTenTuning.bossWarn : adaptiveTuning.lateEliteQuiet;
      if (this.elitesSent >= baselineElites && this.nextElite > this.duration - quiet)
        this.nextElite = Math.max(this.nextElite, this.duration);
      const choices = this.pool().filter((d) => d.behavior !== 'spawner' && d.id !== 'swarmer');
      this.queue.push({ kind: 'enemy', def: this.vet(rng.pick(choices.length ? choices : this.pool()), rng), elite: true });
    }

    if (this.time >= this.nextRing && !this.bossSpawned) {
      const interval = t.ringEvery * rng.range(0.8, 1.2);
      this.baselineRing = this.nextRing + interval;
      this.nextRing += interval / (1 + adaptiveTuning.ringRateBonus * this.adaptive.intensity);
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
      const refillRate = this.adaptive.assist ? this.adaptive.pressure : 1 + (adaptiveTuning.max - 1) * this.adaptive.intensity;
      this.spawnBudget = Math.min(this.spawnBudget + t.spawnPerSecond * refillRate * dt * (1 + (this.stage - 1) * 0.3), 6);
      const pool = this.spawnBudget >= 1 ? this.pool(this.refillPool) : null;
      // Keep natural packs together until they reach the hard population ceiling.
      let slots = t.aliveCap - alive;
      while (pool && slots > 0 && this.spawnBudget >= 1) {
        this.spawnBudget -= 1;
        const def = this.vet(this.pick(rng, pool), rng);
        if (def.maxAlive !== undefined && count(def.id) >= def.maxAlive) continue;
        const n = Math.min(slots, def.pack ? rng.int(def.pack[0], def.pack[1]) : 1);
        slots -= n;
        let refill = this.refills.get(def);
        if (!refill) { refill = { kind: 'enemy', def }; this.refills.set(def, refill); }
        for (let i = 0; i < n; i++) this.queue.push(refill);
      }
    }
    return this.queue;
  }
}
