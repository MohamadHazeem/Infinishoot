import { saveLock } from '../save';
import { halloweenKill } from './halloween';
import { markSeen } from '../save';
/**
 * Statuses and combos, hazards, strikes, specials, pickups and other per-step systems.
 * Split out of src/game/game.ts: these are Game methods (`this` is the Game),
 * installed on the class as fields, e.g. `ignite = Statuses.ignite;`.
 */
import { ARENA_SOURCE_NAMES } from './arena';
import { MECH_SOURCE_NAMES } from './heroMechs';
import { gpBulletBlast } from './gameplay';
import { GP_SOURCE_NAMES } from '../gameplay';
import { copyOrbPulse } from './enemyAi';
import type { Game } from '../game';
import { scoreTuning, bombTuning, dropTuning, chestTuning, nukeTuning, statusTuning, cheats, BULLET_KINDS, IMPACT_BLAST, OWNED_CHEST } from '../game';
import { StaticBoxGrid } from '../../core/spatialHash';
import { MOD_BY_ID } from '../../data/mods';
import type { Tag } from '../../data/tags';
import { PASSIVES } from '../../data/passives';
import { SPECIALS } from '../../data/specials';
import { WEAPONS } from '../../data/weapons';
import { startSpecial, type SpecialApi } from '../specials';
import { specialEvoCue } from './sound';
import { barrelTuning, type Barrel } from '../barrels';
import { BULLET_Y, Team } from '../bullets';
import { type Enemy } from '../enemies';
import { Hero, MAX_GEARS } from '../hero';
import { PickupType } from '../pickups';
import { playerTuning } from '../player';
import { SCAR_COLORS } from '../scars';
import { CURSE_BY_ID } from '../../data/curses';
import { bossLike } from '../bossRules';
import { noteBulletHit } from '../netFeel';
import { vampHeal } from '../lifesteal';
import { noteShock, overloadPartner, teamCombo, teamGame, teamTuning } from '../teamPlay';
import { bossVoiceCue } from '../../audio/voices';
import { COOP2_SOURCE_NAMES } from '../coop2';

export function ignite(this: Game, e: Enemy, dps: number, by: Hero): void {
  if (!e.active || e.hp <= 0) return;
  e.burnT = statusTuning.burnTime;
  e.burnDps = Math.max(e.burnDps, dps);
  e.burnOwner = by.index;
  if (e.shockT > 0) {
    // My Burn on your Shock: a team combo (src/game/teamPlay.ts).
    const mate = overloadPartner(this, e, by, 'burn');
    this.overload(e, by, mate >= 0 ? teamTuning.overloadMul : 1);
    if (mate >= 0) teamCombo(this, e, by, this.heroes[mate], 'OVERLOAD');
  }
}

/** Right-click hit: the enemy takes more damage from everyone for a few seconds. */
export function expose(this: Game, e: Enemy): void {
  if (e.exposeT <= 0) {
    this.vfx.ring(e.x, e.z, e.radius, e.radius * 2.6, '#c4b8ff', 0.25);
    if (this.runTime - this.exposeTextT > 0.6) {
      this.exposeTextT = this.runTime;
      this.vfx.num(e.x, 2.2 * e.scale, e.z, 'EXPOSED', 'crit');
    }
  }
  e.exposeT = statusTuning.exposeTime;
}

export function shock(this: Game, e: Enemy, by: Hero): void {
  if (!e.active || e.hp <= 0) return;
  const mate = e.burnT > 0 ? overloadPartner(this, e, by, 'shock') : -1;
  e.shockT = statusTuning.shockTime + by.synergy.flags.shockTime;
  noteShock(this, e, by);
  if (e.burnT > 0) {
    this.overload(e, by, mate >= 0 ? teamTuning.overloadMul : 1);
    if (mate >= 0) teamCombo(this, e, by, this.heroes[mate], 'OVERLOAD');
  }
}

/** Burn + Shock on the same enemy: consume both for a blast. */
export function overload(this: Game, e: Enemy, by: Hero, teamMul = 1): void {
  e.burnT = e.shockT = 0;
  e.burnDps = 0;
  this.overloads++;
  const m = (1 + by.synergy.flags.overloadMult) * teamMul;
  if (this.overloads % 3 === 1) this.vfx.num(e.x, 2.2, e.z, 'OVERLOAD!', 'crit');
  this.blast(e.x, e.z, 1.8 * Math.sqrt(m), (statusTuning.overloadDamage + statusTuning.overloadPerLevel * this.level) * m, '#ffe14d', 'overload', ['explosive'], true, by);
}

/** Frozen enemy killed: ice shards burst out. */
export function shatter(this: Game, e: Enemy, by: Hero): void {
  const m = 1 + by.synergy.flags.shatterMult;
  this.vfx.burst(e.x, 0.8, e.z, { count: 10, color: '#ffffff', color2: '#9fe8ff', speed: [5, 10], size: [0.1, 0.25], life: [0.2, 0.4], up: 3, gravity: 10 });
  this.vfx.ring(e.x, e.z, 1, 4, '#9fe8ff', 0.2);
  for (const o of this.enemiesInRadius(e.x, e.z, 2, this.scratch).slice()) {
    if (o === e) continue;
    const d = Math.hypot(o.x - e.x, o.z - e.z) || 1;
    this.damage(o, (statusTuning.shatterDamage + statusTuning.shatterPerLevel * this.level) * m, { source: 'shatter', tags: ['frost'], dirX: (o.x - e.x) / d, dirZ: (o.z - e.z) / d, knockback: 4, noStatus: true }, by);
  }
}

/** Lightning arc from an enemy through nearby ones (Mods: Crit Cascade). */
export function zap(this: Game, from: Enemy, hops: number, dmg: number, by: Hero): void {
  const hit = new Set<number>([from.uid]);
  let cur: Enemy = from;
  hops += by.synergy.flags.chainBonus;
  for (let i = 0; i < hops; i++) {
    const next = this.nearestEnemy(cur.x, cur.z, 5, (o) => hit.has(o.uid));
    if (!next) break;
    hit.add(next.uid);
    // One event per hop: a spark at the start plus the arc to the next enemy (systems/sky.ts draws it).
    this.vfx.burst(cur.x, 1, cur.z, { count: 2, color: '#fff35c', color2: '#ffffff', speed: [0, 0.5], size: [0.12, 0.2], life: [0.08, 0.14], arc: [Math.round(next.x * 100) / 100, Math.round(next.z * 100) / 100] });
    this.vfx.star(next.x, 1, next.z, 1, '#fff35c', 0.1);
    this.damage(next, dmg, { source: 'zap', tags: ['chain', 'shock'] }, by);
    cur = next;
  }
}

/** Burn damage ticks and status timers. */
export function updateStatuses(this: Game, dt: number): void {
  for (const e of this.enemies.list) {
    if (!e.active) continue;
    // Ka-Boomer fuse: ticks that speed up and rise in pitch as it burns down.
    if (e.state === 'windup' && e.def.behavior === 'exploder' && e.frozen <= 0 && (e.tickT -= dt) <= 0) {
      const k = Math.max(0, Math.min(1, e.t / e.def.fuse!.time));
      e.tickT = 0.06 + 0.22 * k;
      this.vfx.sound('fuseTick', e.x, e.z, 1 + (1 - k) * 0.8);
    }
    if (e.shockT > 0) e.shockT -= dt;
    if (e.exposeT > 0) e.exposeT -= dt;
    if (e.burnT <= 0) continue;
    e.burnT -= dt;
    e.burnAcc += dt;
    if (e.burnAcc < 0.5) continue;
    e.burnAcc = 0;
    if (this.rng.chance(0.5)) this.vfx.burst(e.x, 0.6 + e.radius, e.z, { count: 1, color: '#ff7a2f', color2: '#ffd23f', speed: [0.2, 1], size: [0.15, 0.3], life: [0.3, 0.5], up: 2, drag: 2 });
    const by = this.heroes[e.burnOwner] ?? this.hero;
    this.damage(e, e.burnDps * 0.5, { source: 'burn', tags: ['fire'], noStatus: true }, by);
    if (e.burnT <= 0) e.burnDps = 0;
  }
}

export function sourceName(this: Game, id: string): string {
  if (SPECIALS[id]) return SPECIALS[id].name;
  if (ARENA_SOURCE_NAMES[id]) return ARENA_SOURCE_NAMES[id];
  if (PASSIVES[id]) return PASSIVES[id].name;
  if (id === 'parry' || id === 'ult') return id === 'parry' ? 'Parry' : 'Ultimate'; // skill layer
  if (MECH_SOURCE_NAMES[id]) return MECH_SOURCE_NAMES[id]; // hero mechanics, biome foes
  if (GP_SOURCE_NAMES[id]) return GP_SOURCE_NAMES[id]; // gameplay lane: mech, super weapons, relics
  if (id === 'pet' || id === 'team') return id === 'pet' ? 'Pet' : 'Team Moves'; // companion lane
  if (COOP2_SOURCE_NAMES[id]) return COOP2_SOURCE_NAMES[id]; // team ultimate, help ghosts
  const named: Record<string, string> = { pet: 'Sparky', meteor: 'Meteors', thorns: 'Thorn Mail', r_dashbomb: 'Blast Boots', bomb: 'Bomb', nuke: 'Nuke', burn: 'Burning', shatter: 'Shatter', overload: 'Overload', zap: 'Chain Zaps', exploder: 'Enemy blasts', charge: 'Charge Shot', barrel: 'Barrels' };
  return WEAPONS[id]?.name ?? MOD_BY_ID[id]?.name ?? named[id] ?? 'Other';
}

export function killEnemy(this: Game, e: Enemy, source: string, by: Hero | null): void {
  if (this.finisherCatch(e, source, by)) return; // a stage boss's killing blow plays the finisher first
  halloweenKill.call(this, e);
  const def = e.def;
  markSeen(def.id);
  if ((def.boss || def.miniboss) && !saveLock.on) this.vfx.cine('story-chapter', 0, 0, 0, def.id);
  const wasFrozen = e.frozen > 0;
  this.kills++;
  this.combo++;
  this.comboT = scoreTuning.comboWindow + (this.heroes.some((h) => h.hasRelic('r_hourglass')) ? 1 : 0);
  this.maxCombo = Math.max(this.maxCombo, this.combo);
  this.score += def.score * this.multiplier * (e.elite ? 5 : 1) * (1 + this.curseSum('score')) * this.difficulty.score * this.styleScoreMul(by);
  const xp = def.xp * (e.elite ? 10 : 1);

  // Drops
  this.pickups.spawn(PickupType.Gem, e.x, e.z, xp * dropTuning.xpMul * this.styleXpMul(by));
  const isBoss = !!def.boss;
  const big = e.elite || isBoss || def.id === 'reaper' || !!def.miniboss;
  if (big) {
    // Bosses drop one chest per hero that only its owner can open (value OWNED_CHEST + hero index); elites drop one for anyone.
    if (isBoss) this.heroes.forEach((h, i) => !h.left && this.pickups.spawn(PickupType.Chest, e.x + i * 0.8, e.z, OWNED_CHEST + i));
    else this.pickups.spawn(PickupType.Chest, e.x, e.z);
    for (let i = 0; i < (isBoss ? 3 : 1); i++) this.pickups.spawn(PickupType.Bolt, e.x, e.z, 1);
    for (let i = 0; i < (isBoss ? 2 : 1); i++) this.pickups.spawn(PickupType.Gear, e.x, e.z);
    if (e.elite) {
      this.elitesRun++;
      this.runEvents.onElite();
    }
  } else {
    const thin = Math.min(1, dropTuning.dropRef / Math.max(1, this.director.targetAlive));
    const goldMul = (by?.hasRelic('r_midas') ? 3 : 1) * (this.runEvents.goldRush ? 4 : 1);
    if (this.rng.chance(dropTuning.goldChance * thin * goldMul)) this.pickups.spawn(PickupType.Bolt, e.x, e.z, 1);
    if (!this.meta.has('hearts') && !this.curses.some((c) => CURSE_BY_ID[c]?.noHearts) && this.rng.chance(dropTuning.heartChance * thin)) this.pickups.spawn(PickupType.Heart, e.x, e.z);
    if (this.rng.chance(dropTuning.magnetChance * thin)) this.pickups.spawn(PickupType.Magnet, e.x, e.z);
    if (this.rng.chance(dropTuning.gearChance * thin * (1 + 0.25 * (by?.stats.luck ?? 0)))) this.pickups.spawn(PickupType.Gear, e.x, e.z);
    if (this.rng.chance(dropTuning.nukeChance * thin)) this.pickups.spawn(PickupType.Nuke, e.x, e.z);
  }
  // Vampire Fang: life per kill, scaled by max life and budgeted per second (src/game/lifesteal.ts).
  if (by && by.stats.killHeal > 0 && !by.player.dead) this.mods2Heal(by, by.player.heal(vampHeal(by, by.stats.killHeal, this.runTime)));

  // Feedback scales with importance; swarm kills stay light so hundreds don't stutter.
  const r = e.radius;
  const y = r + 0.1 + e.hopY;
  this.vfx.sound(big ? 'eliteDie' : 'enemyDie', e.x, e.z, this.pitch);
  this.vfx.burst(e.x, y, e.z, { count: big ? 40 : def.xp >= 3 ? 12 : 6, color: def.bodyColor, color2: def.accentColor, speed: [3, 9], size: [0.15, 0.3 + r * 0.15], life: [0.3, 0.6], up: 5, gravity: 18, drag: 2, debris: big ? 12 : def.xp >= 3 ? 3 : 1 });
  if (def.xp >= 3 || big || this.rng.chance(0.25)) this.vfx.ring(e.x, e.z, r * 2, 3, def.bodyColor, 0.25);
  this.deathFx(e, big);
  // The body flies off, pushed by the hit (or away from the killer). Ka-Boomers that blew themselves up leave none.
  if (!(source === 'exploder' && def.fuse && e.t <= 0)) {
    let fx = e.kx;
    let fz = e.kz;
    if (Math.hypot(fx, fz) < 0.5 && by) {
      fx = e.x - by.player.x;
      fz = e.z - by.player.z;
    }
    const fl = Math.hypot(fx, fz);
    this.vfx.corpse(def.id, e.x, e.hopY, e.z, e.scale, e.facing, fl > 0.01 ? fx / fl : 0, fl > 0.01 ? fz / fl : 0);
  }
  if (isBoss) {
    const voice = bossVoiceCue(def, 'defeat'); // the boss's last words (src/audio/voices.ts)
    if (voice) this.vfx.sound(voice, NaN, NaN);
    this.slowMoT = 1.4;
    this.bossBoom = { x: e.x, z: e.z, r: r * 2.2, n: 7, t: 0, color: def.bodyColor };
  }
  if (big) {
    this.juice.freeze(isBoss ? 0.3 : 0.08);
    this.vfx.shake(e.x, e.z, isBoss ? 1 : 0.4);
    this.vfx.star(e.x, y + 0.3, e.z, r * 3, '#ffffff', 0.18);
    this.vfx.flash(isBoss ? 0.8 : 0.2);
    this.vfx.sound('explode', e.x, e.z);
  } else if (def.xp >= 4) this.vfx.shake(e.x, e.z, 0.08);
  if (this.combo % 50 === 0) {
    this.vfx.num(e.x, 3, e.z, `${this.combo} COMBO!`, 'score');
    this.vfx.sound('comboUp', NaN, NaN);
  }

  if (def.split) {
    for (let i = 0; i < def.split.count; i++) {
      const a = (i / def.split.count) * Math.PI * 2;
      this.enemyCtx.spawnChild(def.split.into, e.x + Math.cos(a) * 0.8, e.z + Math.sin(a) * 0.8, e);
    }
  }
  // Volatile elites leave a telegraphed blast behind.
  const boom = e.mod?.explode;
  if (boom) {
    this.strikes.push({ x: e.x, z: e.z, r: boom.r, t: boom.fuse, dmg: boom.dmg * this.director.dmgMul * this.difficulty.enemyDmg, cause: `Volatile ${e.def.name}` });
    this.vfx.zone(e.x, e.z, boom.r, boom.fuse);
    this.vfx.sound('fuseTick', e.x, e.z, 1.4);
  }
  // Splitting elites burst into normal-size copies that fly outward.
  const split = e.mod?.split;
  if (split) {
    this.vfx.ring(e.x, e.z, e.radius * 1.5, 4, e.mod!.color, 0.3);
    for (let i = 0; i < split.count && this.enemies.activeCount < 480; i++) {
      const a = (i / split.count) * Math.PI * 2 + this.rng.next();
      const x = e.x + Math.cos(a) * 0.9;
      const z = e.z + Math.sin(a) * 0.9;
      if (this.walls.hitCircle(x, z, def.radius)) continue;
      const c = this.enemies.spawn(def, x, z, this.spawnOpts({ hpMul: this.director.hpMul * split.hpMul, instant: true }));
      c.kx = Math.cos(a) * 9;
      c.kz = Math.sin(a) * 9;
      c.squash(6);
    }
  }
  this.onEnemyKilled(e, by); // Goldbug jackpot, elite squads scatter
  this.gpOnKill(e, source, by); // mutant rewards, mech drops, finale spots, Nova Heart, Powder Keg (systems/gameplay.ts)
  this.modesOnKill(e, source, by); // on-beat kill bonus, pacifist kill check (systems/modes.ts)
  this.enemies.kill(e);
  // Enemies are pooled: the next spawn may reuse this object, so the boss references must go now
  // (a stale `boss` once became a Chonk: wrong boss bar on clients and a stage that wouldn't clear).
  if (e === this.boss) this.boss = null;
  if (e === this.bossField.mini) this.bossField.mini = null;
  if (by?.hasRelic('r_fang') && ++by.fangKills % 20 === 0 && !by.player.dead) {
    const healed = by.player.heal(5);
    if (healed > 0) this.vfx.num(by.player.x, 2.4, by.player.z, `+${Math.round(healed)}`, 'heal');
  }
  this.runEvents.onKill(source, this.combo);
  this.onEnvKill(e, source);
  this.skillKill(e, source, by);
  this.timeKill(e, by);
  if (isBoss) this.grantRelics();
  // Combos and Mod triggers after the kill is resolved (they may kill more).
  if (by) {
    if (wasFrozen) this.shatter(e, by);
    by.synergy.kill(e, source);
  }
  if (this.kills === 300 || this.kills % 1000 === 0) this.checkAchievements();
}

export function blast(this: Game, x: number, z: number, r: number, base: number, color: string, source: string, tags: readonly Tag[] = ['explosive'], noStatus = false, by: Hero = this.hero): void {
  const explosive = tags.includes('explosive');
  if (explosive) r *= 1 + by.synergy.flags.explosiveArea * by.synergy.tagCount('explosive');
  this.vfx.sound('explode', x, z);
  this.vfx.ring(x, z, 1, r * 2, color, 0.25);
  this.vfx.star(x, 1, z, r, color, 0.12);
  this.vfx.burst(x, 0.6, z, { count: 8, color, color2: '#fff35c', speed: [3, 8], size: [0.15, 0.3], life: [0.2, 0.45], up: 4, gravity: 12, smoke: Math.round(Math.min(4, 1 + r * 0.8)), sparks: 5, scorch: r >= 1.2 ? 0 : r * 0.7 });
  if (r >= 1.2) this.vfx.scar(x, z, r * 0.7, SCAR_COLORS.scorch, 10);
  if (this.authority) this.barrels.igniteNear(x, z, r, by.index);
  if (this.authority) this.blastToys(x, z, r, base, by.index);
  const targets = this.enemiesInRadius(x, z, r, this.scratch).slice();
  // Napalm: an explosion that catches a burning enemy sets the whole blast alight.
  const napalm = explosive && !noStatus && targets.some((e) => e.burnT > 0);
  if (napalm) {
    this.vfx.ring(x, z, 1, r * 2.2, '#ff5e3a', 0.35);
    this.onboarding.napalms++; // first-combo tip and the Codex
  }
  // My blast catching your Burn: a team combo.
  if (napalm && teamGame(this)) {
    const lit = targets.find((e) => e.burnT > 0 && e.burnOwner !== by.index && this.heroes[e.burnOwner] && !this.heroes[e.burnOwner].left);
    if (lit) teamCombo(this, lit, by, this.heroes[lit.burnOwner], 'NAPALM');
  }
  let n = 0;
  for (const e of targets) {
    const d = Math.hypot(e.x - x, e.z - z) || 1;
    this.damage(e, base, { source, tags, dirX: (e.x - x) / d, dirZ: (e.z - z) / d, knockback: 8, canCrit: true, noStatus, loud: n++ < 2 }, by);
    if (napalm && e.active) this.ignite(e, statusTuning.napalmDps + statusTuning.napalmPerLevel * this.level, by);
  }
}

/** A barrel blows up: big fiery blast credited to whoever lit it; neighbours follow. */
export function explodeBarrel(this: Game, i: number, b: Barrel): void {
  this.removeBarrelCollider(b);
  this.host?.broadcast({ t: 'barrel', i });
  const by = this.heroes[b.by] ?? this.hero;
  const R = barrelTuning.radius;
  this.vfx.shake(b.x, b.z, 0.45);
  this.vfx.ring(b.x, b.z, 1, R * 2.3, '#ffb627', 0.35);
  this.vfx.burst(b.x, 0.8, b.z, { count: 26, color: '#ff4d5e', color2: '#ffd23f', speed: [5, 12], size: [0.2, 0.45], life: [0.35, 0.7], up: 7, gravity: 14, debris: 7 });
  this.vfx.burst(b.x, 1.2, b.z, { count: 10, color: '#3a3d5c', color2: '#8a90c8', speed: [1, 3], size: [0.4, 0.7], life: [0.6, 1.0], up: 3, drag: 2, smoke: 8, scorch: 0 });
  this.vfx.num(b.x, 2.4, b.z, 'KABOOM!', 'crit');
  if (by === this.hero) this.juice.freeze(0.04);
  this.blast(b.x, b.z, R, barrelTuning.damage * (1 + 0.6 * (this.stage - 1)), '#ff7a2f', 'barrel', ['explosive', 'fire'], false, by);
  // Everything caught in it is set on fire.
  for (const e of this.enemiesInRadius(b.x, b.z, R, this.scratch).slice()) this.ignite(e, 10, by);
}

export function removeBarrelCollider(this: Game, b: Barrel): void {
  const k = this.arena.colliders.indexOf(b.box);
  if (k >= 0) this.arena.colliders.splice(k, 1);
  this.walls = new StaticBoxGrid(this.arena.colliders);
}

/** Exploder enemy goes off: hurts heroes and other enemies nearby. */
export function detonate(this: Game, e: Enemy): void {
  const F = e.def.fuse!;
  const R = F.radius * e.scale;
  this.vfx.scar(e.x, e.z, R * 0.75, SCAR_COLORS.scorch, 12);
  this.vfx.ring(e.x, e.z, 1, R * 2, '#ff3d5a', 0.3);
  this.vfx.star(e.x, 1, e.z, R * 1.2, '#ffb627', 0.15);
  this.vfx.burst(e.x, 0.6, e.z, { count: 14, color: '#ff9f3d', color2: '#3a3d5c', speed: [4, 9], size: [0.15, 0.35], life: [0.3, 0.6], up: 5, gravity: 14, smoke: 4, sparks: 6, scorch: 0 });
  this.vfx.sound('explode', e.x, e.z);
  this.vfx.shake(e.x, e.z, 0.3);
  this.barrels.igniteNear(e.x, e.z, R, 0);
  for (const h of this.aliveHeroes) {
    if (Math.hypot(h.player.x - e.x, h.player.z - e.z) < R + h.player.radius) this.hurtHero(h, F.damage * e.dmgMul, e.x, e.z, null, e.def.name);
  }
  for (const o of this.enemiesInRadius(e.x, e.z, R, this.scratch).slice()) {
    if (o === e) continue;
    const d = Math.hypot(o.x - e.x, o.z - e.z) || 1;
    this.damage(o, 40, { source: 'exploder', dirX: (o.x - e.x) / d, dirZ: (o.z - e.z) / d, knockback: 10 }, this.hero);
  }
  if (e.active) this.killEnemy(e, 'exploder', null);
}

export function updateStrikes(this: Game, dt: number): void {
  for (let i = this.strikes.length - 1; i >= 0; i--) {
    const s = this.strikes[i];
    s.t -= dt;
    if (s.t > 0) continue;
    this.strikes.splice(i, 1);
    this.vfx.ring(s.x, s.z, 1, (s.r * 2.2) / 0.46 / 2, '#ff7a2f', 0.3);
    this.vfx.star(s.x, 0.8, s.z, s.r * 1.2, '#ffb627', 0.12);
    this.vfx.burst(s.x, 0.4, s.z, { count: 10, color: '#ff3df0', color2: '#ffd23f', speed: [3, 8], size: [0.15, 0.3], life: [0.25, 0.5], up: 6, gravity: 14, smoke: 3 });
    this.vfx.sound('explode', s.x, s.z);
    this.vfx.shake(s.x, s.z, 0.2);
    for (const h of this.aliveHeroes) {
      if (Math.hypot(h.player.x - s.x, h.player.z - s.z) < s.r + h.player.radius * 0.6) this.hurtHero(h, s.dmg, s.x, s.z, null, s.cause ?? 'Ground strike');
    }
    if (s.foe) {
      this.vfx.scar(s.x, s.z, s.r * 0.8, SCAR_COLORS.crater, 12);
      for (const e of this.enemiesInRadius(s.x, s.z, s.r, this.scratch).slice()) this.damage(e, s.foe, { source: 'meteor', tags: ['explosive'], knockback: 8 }, this.hero);
    }
  }
}

export function bossSlam(this: Game, e: Enemy): void {
  const R = 3.8;
  this.vfx.scar(e.targetX, e.targetZ, R * 0.8, SCAR_COLORS.crater, 16);
  this.vfx.sound('bossSlam', e.x, e.z);
  this.vfx.shake(e.x, e.z, 0.8);
  this.juice.freeze(0.06);
  this.vfx.ring(e.x, e.z, 1, R * 2.4, '#ff3d5a', 0.4);
  this.vfx.ring(e.x, e.z, 1, R * 1.6, '#ffffff', 0.3);
  this.vfx.burst(e.x, 0.3, e.z, { count: 30, color: '#f2e2b8', color2: '#ffffff', speed: [5, 12], size: [0.2, 0.4], life: [0.4, 0.8], up: 4, gravity: 10, dust: 16 });
  for (const h of this.aliveHeroes) {
    if (Math.hypot(h.player.x - e.x, h.player.z - e.z) < R + h.player.radius) this.hurtHero(h, 24 * e.dmgMul, e.x, e.z, null, e.def.name);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    this.enemyCtx.fireBullet(e, Math.cos(a), Math.sin(a), 8, 12);
  }
}

export function contactDamage(this: Game, h: Hero): void {
  const p = h.player;
  if (p.invuln > 0) return;
  let worst: Enemy | null = null;
  let dmg = 0;
  this.hash.query(p.x, p.z, 2.5, (e) => {
    if (!e.targetable || e.frozen > 0 || e.hopY > 0.5 || e.pvpOwner >= 0) return;
    const rr = e.radius + p.radius;
    if ((e.x - p.x) ** 2 + (e.z - p.z) ** 2 > rr * rr) return;
    const d = e.contactDamage * (e.state === 'attack' ? 1.5 : 1);
    if (d > dmg) {
      dmg = d;
      worst = e;
    }
  });
  const w = worst as Enemy | null;
  if (w) this.hurtHero(h, dmg, w.x, w.z, w);
}

export function hurtHero(this: Game, h: Hero, raw: number, fromX: number, fromZ: number, src: Enemy | null = null, cause = ''): void {
  const p = h.player;
  if (cheats.god || p.dead || p.invuln > 0) return;
  h.lastHitBy = cause || src?.def.name || 'Enemy fire';
  if (this.petShield(h, raw, fromX, fromZ)) return; // pet shield: blocks one big hit per stage
  // One hit never takes more than maxHitFrac of max life (curses scale it before the cap).
  let dmg = Math.max(1, Math.round(Math.min((raw - h.stats.armor) * (1 + this.curseSum('dmgTaken')), p.maxHp * playerTuning.maxHitFrac)));
  if (this.meta.rule('glass')) dmg = Math.ceil(p.hp);
  // Frost Totem relic: once per stage a lethal hit leaves you at 1 life and freezes everything nearby.
  if (!this.meta.rule('glass') && dmg >= p.hp && h.hasRelic('r_phoenix') && !h.phoenixUsed) {
    h.phoenixUsed = true;
    dmg = Math.max(0, Math.ceil(p.hp) - 1);
    for (const e of this.enemiesInRadius(p.x, p.z, 7, this.scratch)) e.frozen = Math.max(e.frozen, bossLike(e) ? 0.4 : 2.5);
    this.vfx.ring(p.x, p.z, 1, 14, '#ff7a2f', 0.5);
    this.vfx.burst(p.x, 1, p.z, { count: 30, color: '#ff7a2f', color2: '#ffd23f', speed: [4, 10], size: [0.15, 0.3], life: [0.4, 0.8], up: 6, gravity: 10 });
    this.vfx.banner('PHOENIX!', `${h.name.toUpperCase()} RISES`, 1.4);
    p.invuln = Math.max(p.invuln, 1.5);
    if (dmg <= 0) return;
  }
  if (src && h.hasRelic('r_thorns') && src.active) this.damage(src, 80, { source: 'thorns', tags: [], noStatus: true }, h);
  const vamp = src?.mod?.vampire;
  if (vamp && src.active) {
    src.hp = Math.min(src.maxHp, src.hp + src.maxHp * vamp.onHit);
    this.vfx.num(src.x, 2.4 * src.scale, src.z, 'DRAIN', 'player');
    this.vfx.burst(p.x, 1, p.z, { count: 8, color: '#b13e53', color2: '#ff5e7a', speed: [2, 5], size: [0.12, 0.22], life: [0.3, 0.5], up: 3 });
  }
  this.runEvents.onHurt();
  this.runEvents.onComboBreak();
  const dx = p.x - fromX;
  const dz = p.z - fromZ;
  const d = Math.hypot(dx, dz) || 1;
  if (!p.hurt(dmg, dx / d, dz / d)) return;
  this.damagedThisStage = true;
  this.skillHurt(h);
  h.synergy.hurt();
  if (this.combo >= 25) this.vfx.num(p.x, 3, p.z, 'COMBO BREAK', 'player');
  this.combo = 0;
  this.vfx.sound('playerHurt', p.x, p.z);
  if (h === this.hero) {
    this.hud.hurt();
    this.juice.freeze(0.06);
    this.juice.shake(0.35);
    this.juice.kick(dx / d, dz / d, 6);
    this.input.rumble(0.6, 0.4, 160);
  } else this.tell(h, { t: 'hurt', dx: dx / d, dz: dz / d });
  this.vfx.num(p.x, 2.2, p.z, dmg, 'player');
  this.vfx.star(p.x, 1.1, p.z, 2, '#ff3d5a', 0.15);
  this.vfx.burst(p.x, 1, p.z, { count: 10, color: '#ff3d5a', color2: '#ffffff', speed: [3, 8], size: [0.12, 0.25], life: [0.2, 0.4], up: 3, gravity: 12 });
  if (p.dead && !this.lastStand(h)) this.onHeroDown(h); // a big combo can turn a killing blow into a last stand (systems/time.ts)
}

export function onHeroDown(this: Game, h: Hero): void {
  const p = h.player;
  if (h.revivesLeft > 0) {
    h.revivesLeft--;
    this.reviveHero(h, 0.5, false);
    h.bombCharge = 1;
    this.tryBomb(h);
    this.vfx.banner('SECOND WIND!', `${h.name} is back on their feet`, 1.6);
    return;
  }
  if (this.petRevive(h)) return; // pet revive: once per run
  if (this.pvp?.phase === 'duel') {
    this.vfx.sound('playerDie', p.x, p.z);
    this.vfx.shake(p.x, p.z, 1);
    this.vfx.burst(p.x, 1, p.z, { count: 40, color: h.color, color2: '#ffd23f', speed: [4, 12], size: [0.2, 0.45], life: [0.6, 1.2], up: 7, gravity: 16, drag: 1.5 });
    this.vfx.toast(`${h.name.toUpperCase()} IS OUT!`, 2.5);
    this.pvpCheckWinner();
    return;
  }
  this.vfx.sound('playerDie', p.x, p.z);
  this.vfx.shake(p.x, p.z, 1);
  this.vfx.ring(p.x, p.z, 1, 10, h.color, 0.6);
  this.vfx.burst(p.x, 1, p.z, { count: 40, color: h.color, color2: '#ffd23f', speed: [4, 12], size: [0.2, 0.45], life: [0.6, 1.2], up: 7, gravity: 16, drag: 1.5 });
  if (h === this.hero) {
    this.juice.freeze(0.25);
    this.hud.flash(0.5);
  }
  if (this.aliveHeroes.length === 0 && this.coopPoolSave(h)) return; // shared revive pool (systems/coop2.ts)
  if (this.aliveHeroes.length === 0) {
    this.mode = 'dead';
    this.modeT = 0;
    this.gameOverShown = false;
  } else this.vfx.toast(`${h.name.toUpperCase()} IS DOWN! STAND NEXT TO THEM TO REVIVE`, 3);
}

export function collect(this: Game, h: Hero, type: PickupType, value: number): void {
  const p = h.player;
  switch (type) {
    case PickupType.Gem:
      this.gainXp(value * h.stats.xpMul);
      h.synergy.gem(value);
      this.vfx.sound('gem', p.x, p.z);
      break;
    case PickupType.Bolt: {
      const g = Math.max(1, Math.round(value * (1 + h.synergy.flags.goldMul)));
      h.gold += g;
      this.vfx.sound('coin', p.x, p.z);
      this.vfx.num(p.x, 2.4, p.z, `+${g}●`, 'score');
      break;
    }
    case PickupType.Heart: {
      if (this.meta.has('hearts')) break;
      const healed = p.heal(30);
      this.vfx.sound('heal', p.x, p.z);
      if (healed > 0) this.vfx.num(p.x, 2.4, p.z, `+${Math.round(healed)}`, 'heal');
      break;
    }
    case PickupType.Magnet:
      this.pickups.vacuum = true;
      this.vfx.sound('heal', p.x, p.z);
      this.vfx.toast('MAGNET!');
      break;
    case PickupType.Nuke:
      this.nuke(h);
      break;
    case PickupType.Gear:
      h.rerollsLeft = Math.min(MAX_GEARS, h.rerollsLeft + 1);
      this.vfx.sound('gear', p.x, p.z);
      this.vfx.num(p.x, 2.4, p.z, `+1 GEAR (${h.rerollsLeft}/${MAX_GEARS})`, 'score');
      break;
    case PickupType.Chest:
      h.chestsPending++;
      this.mods2Event(h, 'chest');
      h.gold += 2;
      this.vfx.sound('chest', p.x, p.z);
      if (h === this.hero) this.hud.flash(0.3);
      break;
  }
}

export function updateBullets(this: Game, dt: number): void {
  const b = this.bullets;
  b.integrate(dt);
  for (let i = 0; i < b.count; i++) {
    const x = b.x[i];
    const z = b.z[i];
    if (b.life[i] <= 0) {
      // Flak pellets only burst on something; a miss just fizzles.
      if (b.kind[i] !== 5) this.bulletBlast(i);
      b.kill(i--);
      continue;
    }
    if (b.team[i] === Team.Player) {
      const bi = this.barrels.hitTest(x, z, b.radius[i]);
      if (bi >= 0) {
        this.barrels.hit(bi, b.damage[i], b.owner[i]);
        this.vfx.star(x, BULLET_Y, z, 0.9, '#ffd23f', 0.08);
        this.vfx.sound('hit', x, z, 0.8);
        b.kill(i--);
        continue;
      }
    }
    if (this.walls.hitSolid(x, z, b.radius[i])) {
      if (b.team[i] === Team.Player) this.hitToys(x, z, b.radius[i], b.damage[i], b.owner[i], b.vx[i], b.vz[i]);
      this.vfx.burst(b.px[i], BULLET_Y, b.pz[i], { count: 3, color: '#ffffff', color2: b.team[i] === Team.Enemy ? '#ff3df0' : '#fff36b', speed: [2, 6], size: [0.08, 0.15], life: [0.1, 0.25], up: 2, gravity: 10 });
      this.bulletBlast(i);
      b.kill(i--);
      continue;
    }
    if (b.team[i] === Team.Enemy) {
      if (copyOrbPulse(this, i, dt)) continue;
      for (const h of this.heroes) {
        const p = h.player;
        if (p.dead || h.left || p.invuln > 0) continue;
        const rr = b.radius[i] + p.radius * 0.8;
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < rr * rr) {
          const hp0 = p.hp;
          this.hurtHero(h, b.damage[i], b.px[i], b.pz[i], null, 'Enemy fire');
          if (h.remote) noteBulletHit(this, h, hp0 - p.hp, b.vx[i], b.vz[i]); // a late parry can undo it
          b.kill(i--);
          break;
        }
      }
      continue;
    }
    let hit = null as Enemy | null;
    const r = b.radius[i];
    this.hash.query(x, z, r, (e) => {
      if (hit || !e.targetable || e.hp <= 0 || b.hasHit(i, e.uid) || e.pvpOwner === b.owner[i]) return;
      const rr = e.radius + r;
      if ((e.x - x) ** 2 + (e.z - z) ** 2 < rr * rr) hit = e;
    });
    if (hit) {
      const sp = Math.hypot(b.vx[i], b.vz[i]) || 1;
      const by = this.heroes[b.owner[i]] ?? this.hero;
      const kind = BULLET_KINDS[b.kind[i]] ?? BULLET_KINDS[0];
      this.damage(hit, b.damage[i], { source: kind.source, tags: kind.tags, dirX: b.vx[i] / sp, dirZ: b.vz[i] / sp, knockback: b.knockback[i], hx: x, hz: z, canCrit: true, loud: true }, by);
      if (b.blast[i] > 0 && IMPACT_BLAST.includes(b.kind[i])) {
        this.bulletBlast(i);
        b.blast[i] = 0;
      }
      if (b.pierce[i] > 0) {
        b.pierce[i]--;
        b.markHit(i, hit.uid);
      } else {
        this.bulletBlast(i);
        b.kill(i--);
      }
    }
  }
}

/** Walk into a treasure chest to open it; closed chests sparkle near players. */
export function updateChests(this: Game): void {
  if (!this.isCombatMode) return;
  for (const h of this.aliveHeroes) {
    const i = this.chests.touching(h.player.x, h.player.z);
    if (i >= 0) this.openChest(i, h);
  }
  if (this.stepN % 40 !== 0) return;
  for (const c of this.chests.list) {
    if (c.openT >= 0 || !this.aliveHeroes.some((h) => Math.hypot(h.player.x - c.x, h.player.z - c.z) < 30)) continue;
    this.vfx.burst(c.x, 0.9, c.z, { count: 2, color: '#ffcd75', color2: '#f4f4f4', speed: [0.4, 1.4], size: [0.1, 0.18], life: [0.5, 0.9], up: 2.5, drag: 1 });
  }
}

/** Host/solo: a new chest every chestTuning.every seconds at a random clear spot. */
export function updateChestSpawns(this: Game, dt: number): void {
  this.chestT += dt * (this.meta.has('chests') ? 0.5 : 1);
  if (this.chestT < chestTuning.every) return;
  this.chestT -= chestTuning.every;
  if (this.chests.closedCount >= chestTuning.maxClosed) return;
  const lim = this.arena.halfSize - 5;
  for (let tries = 0; tries < 30; tries++) {
    const x = this.rng.range(-lim, lim);
    const z = this.rng.range(-lim, lim);
    if (this.walls.hitCircle(x, z, 1.2)) continue;
    const facing = this.rng.range(0, Math.PI * 2);
    if (this.jackpotRoll(x, z, facing)) return; // now and then a golden jackpot chest instead (systems/cinematics.ts)
    this.chests.add(x, z, facing);
    this.host?.broadcast({ t: 'chestspawn', x, z, f: facing });
    this.vfx.ring(x, z, 1, 6, '#ffcd75', 0.6);
    this.vfx.burst(x, 1, z, { count: 20, color: '#ffcd75', color2: '#ffffff', speed: [2, 6], size: [0.15, 0.3], life: [0.5, 0.9], up: 8, gravity: 10 });
    this.vfx.toast('A TREASURE CHEST APPEARED!');
    this.vfx.sound('chest', NaN, NaN);
    return;
  }
}

export function openChest(this: Game, i: number, h: Hero): void {
  const c = this.chests.open(i);
  if (!c) return;
  this.host?.broadcast({ t: 'wchest', i });
  this.mods2Event(h, 'chest');
  const item = h.chestItem();
  this.runEvents.onChest();
  h.player.happyT = 1.2;
  this.vfx.sound('chest', c.x, c.z);
  this.vfx.ring(c.x, c.z, 1, 5, '#ffcd75', 0.35);
  this.vfx.burst(c.x, 0.8, c.z, { count: 22, color: '#ffcd75', color2: item.color, speed: [3, 7], size: [0.12, 0.28], life: [0.4, 0.8], up: 7, gravity: 12 });
  this.vfx.num(c.x, 2.6, c.z, `${item.name} ${item.text}`, 'crit');
  if (h === this.hero) {
    this.hud.chestReveal(item);
    this.hud.flash(0.25);
  } else this.tell(h, { t: 'chestitem', item });
  this.checkAchievements();
}

/** Full-charge shots explode where they end. */
export function bulletBlast(this: Game, i: number): void {
  const b = this.bullets;
  if (b.team[i] !== Team.Player || b.blast[i] <= 0) return;
  if (gpBulletBlast(this, i)) return; // mech missiles
  const by = this.heroes[b.owner[i]] ?? this.hero;
  if (b.kind[i] === 5) {
    this.blast(b.x[i], b.z[i], b.blast[i], b.damage[i] * 0.5, this.bullets.colorOf(i), 'scatter', ['projectile', 'explosive'], false, by);
    return;
  }
  this.vfx.shake(b.x[i], b.z[i], 0.25);
  const tags: Tag[] = b.kind[i] === 8 ? ['projectile', 'explosive', 'fire'] : ['projectile', 'explosive'];
  this.blast(b.x[i], b.z[i], b.blast[i], b.damage[i] * 0.6, this.bullets.colorOf(i), 'charge', tags, false, by);
}

export function makeSpecialApi(this: Game): SpecialApi {
  const g = this;
  return {
    get enemies() {
      return g.enemies.list;
    },
    get rng() {
      return g.rng;
    },
    get vfx() {
      return g.vfx;
    },
    damage: (e, base, o, by) => g.damage(e, base, o, by),
    blast: (x, z, r, base, color, source, tags, noStatus, by) => g.blast(x, z, r, base, color, source, tags, noStatus, by),
    zap: (from, hops, dmg, by) => g.zap(from, hops, dmg, by),
    ignite: (e, dps, by) => g.ignite(e, dps, by),
  };
}

/** Q/E: fire the hero's special once its meter is full. */
export function tryBomb(this: Game, h: Hero): void {
  if (h.bombCharge < 1 || h.player.dead || this.modesHolster(h)) return;
  if (h.special.id !== 'bomb') {
    h.bombCharge = 0;
    startSpecial(h, h.specialDef, h.specialP, this.specialApi);
    specialEvoCue(this, h);
    return;
  }
  if (h.bombT >= 0 || h.bombNext > 0) return;
  const p = h.player;
  h.bombCharge = 0;
  h.bombNuke = false;
  h.bombWave = 1;
  this.startBombWave(h, p.x, p.z);
  specialEvoCue(this, h);
  p.invuln = Math.max(p.invuln, 0.6);
  if (h === this.hero) {
    this.hud.flash(0.9);
    this.input.rumble(1, 0.8, 420);
  }
  this.juice.freeze(0.06);
  const R = h.specialP.radius;
  this.vfx.scar(p.x, p.z, 3, SCAR_COLORS.crater, 18);
  for (let i = 0; i < this.bullets.count; i++) {
    if (this.bullets.team[i] === Team.Enemy && Math.hypot(this.bullets.x[i] - p.x, this.bullets.z[i] - p.z) < R * 1.5) this.bullets.kill(i--);
  }
}

/** One bomb wave from (x, z): Implosion's first wave pulls in (violet), everything else blasts out. */
export function startBombWave(this: Game, h: Hero, x: number, z: number): void {
  h.bombT = 0;
  h.bombId = (h.bombId + 1) % 1000;
  h.bombX = x;
  h.bombZ = z;
  const R = h.specialP.radius;
  const evo = h.specialEvo;
  const pull = evo === 'implode' && h.bombWave === 1;
  const color = pull ? '#b48cff' : evo === 'cluster' ? '#ff7a2f' : '#ef7d57';
  this.vfx.sound('bomb', x, z);
  this.vfx.shake(x, z, pull ? 0.5 : 0.9);
  this.vfx.ring(x, z, 1, R * 2, color, bombTuning.duration + 0.15);
  this.vfx.ring(x, z, 1, R * 1.6, '#ffffff', bombTuning.duration);
  this.vfx.star(x, 1.2, z, pull ? 3 : 5, '#ffffff', 0.2);
}

/** Cluster Bomb's bomblets pop one by one after the wave. */
export function updateBomblets(this: Game, h: Hero, dt: number): void {
  const p = h.specialP;
  for (let i = h.bomblets.length - 1; i >= 0; i--) {
    const b = h.bomblets[i];
    if ((b.t -= dt) > 0) continue;
    h.bomblets.splice(i, 1);
    this.blast(b.x, b.z, bombTuning.bombletRadius, p.dmg * bombTuning.bombletDmg, '#ff7a2f', 'bomb', ['explosive'], false, h);
  }
}

/** Nuke pickup: the bomb's wave, but screen-wide and lethal to everything but bosses. */
export function nuke(this: Game, h: Hero): void {
  const p = h.player;
  h.bombT = 0;
  h.bombNuke = true;
  h.bombId = (h.bombId + 1) % 1000;
  h.bombX = p.x;
  h.bombZ = p.z;
  p.invuln = Math.max(p.invuln, 1);
  this.vfx.banner('NUKE!', 'SCREEN WIPE', 1.4);
  this.vfx.sound('bomb', p.x, p.z);
  this.vfx.sound('explode', p.x, p.z);
  this.vfx.flash(1);
  this.vfx.shake(p.x, p.z, 1.6);
  this.juice.freeze(0.12);
  const R = nukeTuning.radius;
  this.vfx.ring(p.x, p.z, 1, R * 2, '#ffffff', nukeTuning.duration + 0.2);
  this.vfx.ring(p.x, p.z, 1, R * 1.7, '#ffcd75', nukeTuning.duration + 0.1);
  this.vfx.ring(p.x, p.z, 1, R * 1.3, '#ef7d57', nukeTuning.duration);
  this.vfx.star(p.x, 1.5, p.z, 9, '#ffffff', 0.3);
  this.vfx.burst(p.x, 1, p.z, { count: 60, color: '#ffcd75', color2: '#ffffff', speed: [8, 20], size: [0.2, 0.5], life: [0.5, 1.1], up: 10, gravity: 8 });
  for (let i = 0; i < this.bullets.count; i++) if (this.bullets.team[i] === Team.Enemy) this.bullets.kill(i--);
}

export function updateBomb(this: Game, h: Hero, dt: number): void {
  if (h.bomblets.length) this.updateBomblets(h, dt);
  // Implosion: the second, bigger blast after the pull.
  if (h.bombNext > 0 && (h.bombNext -= dt) <= 0) {
    h.bombWave = 2;
    this.startBombWave(h, h.bombX, h.bombZ);
    this.vfx.sound('explode', h.bombX, h.bombZ);
    this.vfx.flash(0.5);
  }
  if (h.bombT < 0) return;
  h.bombT += dt;
  const nuke = h.bombNuke;
  const sp = h.specialP;
  const implode = !nuke && sp.implode > 0;
  const pull = implode && h.bombWave === 1;
  const dmgMul = implode ? (pull ? bombTuning.pullDmg : bombTuning.implodeDmg) : 1;
  const k = Math.min(1, h.bombT / (nuke ? nukeTuning.duration : bombTuning.duration));
  const r = (nuke ? nukeTuning.radius : sp.radius) * (1 - (1 - k) * (1 - k));
  const stamp = h.index * 1000 + h.bombId + 1;
  for (const e of this.enemies.list) {
    if (!e.alive || e.hp <= 0 || e.bombStamp === stamp) continue;
    const dx = e.x - h.bombX;
    const dz = e.z - h.bombZ;
    const d = Math.hypot(dx, dz);
    if (d > r + e.radius) continue;
    e.bombStamp = stamp;
    const n = d || 1;
    // The nuke over-kills normal enemies and takes a big bite out of bosses.
    const tough = bossLike(e) || e.def.id === 'reaper';
    const dmg = !nuke ? sp.dmg * dmgMul : tough ? e.maxHp * nukeTuning.bossHpFrac : e.maxHp * 20;
    // Implosion's first wave drags enemies toward the centre instead of blasting them away.
    const dir = pull ? -Math.min(1, d / Math.max(1, sp.radius)) : 1;
    this.damage(e, dmg, { source: nuke ? 'nuke' : 'bomb', tags: nuke ? [] : ['explosive'], dirX: (dx / n) * dir, dirZ: (dz / n) * dir, knockback: pull ? bombTuning.pullKnock : bombTuning.knockback, noStatus: nuke, fixed: nuke && tough }, h);
  }
  if (k < 1) return;
  h.bombT = -1;
  if (nuke) return;
  if (pull) h.bombNext = bombTuning.implodeDelay;
  // Cluster Bomb: bomblets scatter through the wave's area and pop one after another.
  for (let i = 0; i < (sp.bomblets ?? 0); i++) {
    const a = this.rng.next() * Math.PI * 2;
    const d = sp.radius * (0.25 + this.rng.next() * 0.6);
    h.bomblets.push({ x: h.bombX + Math.cos(a) * d, z: h.bombZ + Math.sin(a) * d, t: 0.1 + i * 0.06 + this.rng.next() * 0.1 });
  }
}
