/**
 * Spawning enemies, rings, bosses and elites.
 * Split out of src/game/game.ts: these are Game methods (`this` is the Game),
 * installed on the class as fields, e.g. `ringPoint = Spawning.ringPoint;`.
 */
import type { Game } from '../game';
import { RECYCLE_DIST } from '../game';
import { ELITE_MOD_IDS, ELITE_MODS, type EliteModId } from '../../data/eliteMods';
import { type EnemyDef } from '../../data/enemies';
import { bossLike } from '../bossRules';

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

export function spawnEnemy(this: Game, def: EnemyDef, elite = false, near: { x: number; z: number } | null = null, forceMod?: EliteModId) {
  if (def.treasure) return this.spawnGolden(def);
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
  if (elite) this.spawnSquad(spawned); // escort in formation
  if (def.id === 'reaper') {
    this.vfx.banner('THE REAPER COMES', 'RUN. OR TRY YOUR LUCK.', 2.4);
    this.vfx.sound('boss', NaN, NaN);
    this.vfx.flash(0.4);
  }
  if (elite) {
    const mod = eliteMod ? `${ELITE_MODS[eliteMod].name.toUpperCase()} ` : '';
    this.vfx.toast(`ELITE ${mod}${def.name.toUpperCase()} INCOMING!`);
    this.vfx.sound('elite', NaN, NaN);
  }
  return pos;
}

/** Weighted elite modifier roll. Splitting skips enemies that already split, don't move, or blow themselves up. */
export function rollEliteMod(this: Game, def: EnemyDef): EliteModId {
  const noSplit = !!def.split || def.behavior === 'spawner' || def.behavior === 'exploder';
  const ok = ELITE_MOD_IDS.filter((id) => !(ELITE_MODS[id].split && noSplit) && !(ELITE_MODS[id].teleport && def.behavior === 'spawner'));
  let r = this.rng.next() * ok.reduce((a, id) => a + ELITE_MODS[id].weight, 0);
  for (const id of ok) if ((r -= ELITE_MODS[id].weight) <= 0) return id;
  return ok[ok.length - 1];
}

export function spawnRing(this: Game, def: EnemyDef, count: number): void {
  const alive = this.aliveHeroes;
  if (!alive.length) return;
  const p = alive[Math.floor(this.rng.next() * alive.length)].player;
  const lim = this.arena.halfSize - 2;
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
    if (!e.alive || e.elite || bossLike(e) || e.def.behavior === 'spawner') continue;
    if (alive.some((h) => Math.hypot(e.x - h.player.x, e.z - h.player.z) < RECYCLE_DIST)) continue;
    const pos = this.ringPoint(18, 24, e.radius + 0.2);
    if (!pos) continue;
    e.x = e.px = pos.x;
    e.z = e.pz = pos.z;
    e.kx = e.kz = 0;
  }
}
