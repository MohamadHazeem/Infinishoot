import { makeChampion, eliteToast, discoverElite } from './elites2';
import { challengeState, gauntletBoss, gauntletElite } from './gauntlet';
/**
 * Spawning enemies, rings, bosses and elites.
 * Split out of src/game/game.ts: these are Game methods (`this` is the Game),
 * installed on the class as fields, e.g. `ringPoint = Spawning.ringPoint;`.
 */
import { halloweenBoss } from './halloween';
import type { Game } from '../game';
import { RECYCLE_DIST } from '../game';
import { pickEliteMod, championRoll, type EliteModId } from '../../data/eliteMods';
import { ordersFor, patrolTuning as patrol } from '../squads';
import { patrolDefs, type EnemyDef } from '../../data/enemies';
import { spawnCue } from './sound';
import { directorTuning, type SpawnRequest } from '../director';
import { bossLike } from '../bossRules';
import { spawnTitan, stageBossDef } from './bossLane';

/** A point on a ring just off-screen around a living hero, inside the arena and not in a wall. */
export function ringPoint(this: Game, rMin: number, rMax: number, r = 0.6): { x: number; z: number } | null {
  const alive = this.aliveHeroes;
  if (!alive.length) return null;
  const p = alive[Math.floor(this.rng.next() * alive.length)].player;
  const lim = this.arena.halfSize - 3;
  // Bias spawns toward where the hero is heading so running away isn't free.
  const heading = Math.atan2(p.vel.z, p.vel.x);
  const moving = p.speed > 1;
  for (let i = 0; i < 10; i++) {
    const a = moving && this.rng.chance(0.5) ? heading + this.rng.range(-1, 1) : this.rng.range(0, Math.PI * 2);
    const d = this.rng.range(rMin, rMax);
    const x = p.x + Math.cos(a) * d;
    const z = p.z + Math.sin(a) * d;
    if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
    if (this.walls.hitCircle(x, z, r)) continue;
    return { x, z };
  }
  return null;
}

/** Double the existing chance at full pressure, with the same stage unlock and one RNG draw. */
export function pressureChampion(stage: number, roll: number, intensity: number): boolean {
  return championRoll(stage, roll / (1 + intensity));
}

export function spawnEnemy(this: Game, def: EnemyDef, elite = false, near: { x: number; z: number } | null = null, forceMod?: EliteModId, championMod?: EliteModId) {
  if (this.bossDuel) return null; // boss duel: nobody joins the one-on-one (stage events included; systems/bossLane.ts)
  if (def.treasure) return this.spawnGolden(def);
  if (!elite && !def.special && def.id !== 'reaper' && this.enemies.activeCount >= directorTuning.aliveCap) return null;
  if (!elite && def.maxAlive !== undefined && this.enemies.countOf(def.id) >= def.maxAlive) return null;
  if (this.meta.rule('elites') && !def.boss && !def.miniboss) elite = true;
  let pos: { x: number; z: number } | null = null;
  if (near) {
    const x = near.x + this.rng.range(-1.6, 1.6);
    const z = near.z + this.rng.range(-1.6, 1.6);
    if (!this.walls.hitCircle(x, z, def.radius)) pos = { x, z };
  }
  pos ??= this.ringPoint(18, 24, def.radius * (elite ? 1.6 : 1) + 0.2);
  if (!pos) return null;
  const eliteMod = elite ? (forceMod ?? this.rollEliteMod(def)) : undefined;
  const spawned = this.enemies.spawn(def, pos.x, pos.z, this.spawnOpts({ elite, eliteMod }));
  if (elite && (championMod || (!forceMod && pressureChampion(this.stage, this.rng.next(), this.director.adaptive.intensity)))) makeChampion(this, spawned, championMod);
  if (elite) discoverElite(spawned);
  gauntletElite(this, spawned);
  if (def.special) {
    this.vfx.toast('SWARM QUEEN! CUT THE WALL, BREAK THE EGGS!', 3);
    this.vfx.sound('swarmScreech', pos.x, pos.z);
  }
  if (elite) this.spawnSquad(spawned); // escort in formation
  spawnCue(this, def, pos.x, pos.z, elite); // family call, elite arrival telegraph (systems/sound.ts)
  if (def.id === 'reaper') {
    this.vfx.banner('THE REAPER COMES', 'RUN. OR TRY YOUR LUCK.', 2.4);
    this.vfx.sound('boss', NaN, NaN);
    this.vfx.flash(0.4);
  }
  if (elite) {
    this.vfx.toast(eliteToast(spawned));
    this.vfx.sound('elite', NaN, NaN);
  }
  return pos;
}

/** Weighted elite modifier roll. Splitting skips enemies that already split, don't move, or blow themselves up. */
export function rollEliteMod(this: Game, def: EnemyDef): EliteModId {
  const climb = challengeState(this);
  if (climb.rules.doubleElites && !climb.shieldIssued) {
    climb.shieldIssued = true;
    return 'shielded';
  }
  const noSplit = !!def.split || def.behavior === 'spawner' || def.behavior === 'exploder';
  return pickEliteMod(this.rng.next(), noSplit, def.behavior === 'spawner');
}

const patrolRank = ['bulwark', 'bulwark', 'marksman', 'baiter'] as const;
const patrolArrivals = new WeakMap<Game['arena'], { start: number; end: number }>();

/** Give the two approach lanes time to open. Scheduled special enemies keep their own clocks. */
export function holdPatrolRefill(g: Game, request: SpawnRequest): boolean {
  if (request.kind !== 'enemy' || request.elite) return false;
  const arrival = patrolArrivals.get(g.arena);
  if (!arrival || g.director.time < arrival.start || g.director.time >= arrival.end) return false;
  const def = request.def;
  return !def.treasure && !def.special && !def.boss && !def.miniboss && def.id !== 'reaper';
}

/** Place a close formation in walkable space, with the shields toward the chosen hero. */
export function spawnPatrol(g: Game, x: number, z: number, faceX: number, faceZ: number, budget: number, guardsOnly = false): number {
  const escorts = guardsOnly ? 2 : patrolRank.length;
  if (!g.authority || g.bossDuel || Math.min(budget, directorTuning.aliveCap - g.enemies.activeCount) < escorts + 1) return 0;
  const limit = g.arena.halfSize - 2;
  const length = Math.hypot(faceX, faceZ) || 1;
  const fx = faceX / length, fz = faceZ / length;
  const spots = [{ x, z }];
  for (let i = 0; i < escorts; i++) {
    const forward = i < 2 ? patrol.guardForward : i === 2 ? -2.1 : 1;
    const side = i < 2 ? (i === 0 ? -patrol.guardSide : patrol.guardSide) : i === 2 ? -0.7 : 3;
    spots.push({ x: x + forward * fx + side * fz, z: z + forward * fz - side * fx });
  }
  for (let i = 0; i < spots.length; i++) {
    const p = spots[i], r = i ? patrolDefs[patrolRank[i - 1]].radius : patrolDefs.commander.radius;
    if (Math.abs(p.x) + r > limit || Math.abs(p.z) + r > limit || g.walls.hitCircle(p.x, p.z, r)) return 0;
    for (const h of g.heroes) if (!h.left && !h.player.dead && Math.hypot(p.x - h.player.x, p.z - h.player.z) < 4) return 0;
  }
  const brain = ordersFor(g), opts = g.spawnOpts();
  const c = g.enemies.spawn(patrolDefs.commander, x, z, opts);
  const command = brain.register(c);
  c.rallyCd = 1.1;
  for (let i = 0; i < escorts; i++) {
    const p = spots[i + 1];
    const m = g.enemies.spawn(patrolDefs[patrolRank[i]], p.x, p.z, opts);
    m.facing = Math.atan2(fx, fz);
    brain.attach(brain.register(m), command, i === 0 ? -1 : 1);
  }
  g.vfx.sound('telegraph', x, z);
  return escorts + 1;
}

/** Return the scheduled ring slots consumed. The seeded hunt schedule is independent of loot rolls. */
export function patrolRing(g: Game, budget: number): number {
  if (!g.authority || g.director.bossSpawned || g.bossDuel || g.pvp || g.versus
    || (g.runMode !== 'standard' && g.runMode !== 'endless') || g.meta.rule('elites') || g.director.adaptive.breather > 0) return 0;
  const ring = g.director.ringsSent;
  const opening = g.stage >= patrol.huntStage && ring === 1;
  const introduction = g.stage === 1 && ring === 5;
  const formation = ring === 2 || ring === 5;
  if (!opening && !introduction && (g.stage < patrol.fromStage || (!formation && ring !== 3))) return 0;
  const power = g.director.adaptive.power;
  if (!opening && !power.ready) return 0;
  let health = 1;
  for (const h of g.heroes) {
    if (h.left) continue;
    if (h.player.dead) return 0;
    health = Math.min(health, h.player.hp / h.player.maxHp);
  }
  // A wounded team can break a crown without crossing a sniper lane or a trap.
  // Its two escorts carry plates only. Stronger teams meet the full five.
  // The first stage teaches the shield pair when anyone can use the crown's heart.
  if (introduction && health >= 1) return 0;
  const guardsOnly = opening || introduction || power.score < patrol.minPower
    || health < (ring === 5 ? patrol.lateHealth : patrol.minHealth);
  const available = Math.min(budget, directorTuning.aliveCap - g.enemies.activeCount);
  if ((opening || formation) && !g.enemies.countOf(patrolDefs.commander.id) && available >= (guardsOnly ? 3 : 5)) {
    for (let i = 0; i < 3; i++) {
      const p = g.ringPoint(15, 19);
      if (!p) continue;
      let hero = g.hero, best = Infinity;
      for (const h of g.heroes) {
        if (h.player.dead || h.left) continue;
        const d = Math.hypot(h.player.x - p.x, h.player.z - p.z);
        if (d < best) { best = d; hero = h; }
      }
      const n = spawnPatrol(g, p.x, p.z, hero.player.x - p.x, hero.player.z - p.z, available, guardsOnly);
      // This encounter takes the ring's entire slot. The open sides are the
      // counterplay to the shields. Refill resumes after the entrance warning.
      if (n) {
        const start = g.director.time;
        patrolArrivals.set(g.arena, { start, end: start + (guardsOnly ? patrol.reliefTime : patrol.entryTime) });
        return budget;
      }
    }
  }
  if (ring === 3 && g.stage >= patrol.huntStage && available > 0 && health >= patrol.minHealth && power.score >= patrol.huntPower
    && ((g.seed >>> 0) + g.stage) % 3 === 0 && !g.enemies.countOf(patrolDefs.hunter.id)) {
    const p = g.ringPoint(17, 21, patrolDefs.hunter.radius);
    if (p) { g.enemies.spawn(patrolDefs.hunter, p.x, p.z, g.spawnOpts()); return 1; }
  }
  return 0;
}

export function spawnRing(this: Game, def: EnemyDef, count: number): void {
  const alive = this.aliveHeroes;
  if (!alive.length || this.bossDuel) return;
  const p = alive[Math.floor(this.rng.next() * alive.length)].player;
  const lim = this.arena.halfSize - 2;
  count = Math.min(count, directorTuning.aliveCap - this.enemies.activeCount);
  const R = 15;
  let placed = 0;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = p.x + Math.cos(a) * R;
    const z = p.z + Math.sin(a) * R;
    if (Math.abs(x) > lim || Math.abs(z) > lim || this.walls.hitCircle(x, z, def.radius)) continue;
    this.enemies.spawn(def, x, z, this.spawnOpts());
    placed++;
  }
  if (placed > 0) {
    this.vfx.toast('SURROUNDED!');
    this.vfx.sound('wave', p.x, p.z);
  }
}

export function spawnBoss(this: Game, def: EnemyDef): void {
  if (this.runMode === 'abyss') return; // floor exits are survival timers
  def = halloweenBoss.call(this, def);
  if (this.runMode !== 'bossrush') def = stageBossDef.call(this, def); // rematches and the Titan (systems/bossLane.ts)
  def = gauntletBoss(this, def) ?? def;
  if (def.behavior === 'titan') return spawnTitan.call(this, def);
  const p = (this.aliveHeroes[0] ?? this.hero).player;
  const pos = this.ringPoint(13, 16, def.radius + 0.5) ?? { x: p.x + 12, z: p.z };
  this.boss = this.enemies.spawn(def, pos.x, pos.z, this.spawnOpts({ hpMul: this.director.bossHpMul }));
  this.startBossIntro(this.boss); // entrance cinematic (or the WARNING banner), see systems/bossFight.ts
}

/** Keep the action near the heroes: enemies far from everyone re-enter ahead. */
export function recycleFarEnemies(this: Game, dt: number): void {
  this.recycleT -= dt;
  if (this.recycleT > 0 || this.mode !== 'fight') return;
  this.recycleT = 0.5;
  const alive = this.aliveHeroes;
  if (!alive.length) return;
  for (const e of this.enemies.list) {
    if (e.def.patrolRole) continue; // preserve the approach and the marked firing position
    if (!e.alive || e.elite || bossLike(e) || e.def.special || e.def.behavior === 'egg' || e.def.behavior === 'swarmwall' || e.def.behavior === 'spawner') continue;
    if (alive.some((h) => Math.hypot(e.x - h.player.x, e.z - h.player.z) < RECYCLE_DIST)) continue;
    const pos = this.ringPoint(18, 24, e.radius + 0.2);
    if (!pos) continue;
    e.x = e.px = pos.x;
    e.z = e.pz = pos.z;
    e.kx = e.kz = 0;
  }
}
