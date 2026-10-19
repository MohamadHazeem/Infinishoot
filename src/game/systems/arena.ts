/**
 * Arena toys and environmental kills: breakable cover, toppling pillars, jump
 * pads, turrets, biome hazards (lava, ice, quicksand, thorns) and the stage
 * objective. These are Game methods (`this` is the Game), installed on the
 * class as fields, e.g. `updateArena = ArenaSys.updateArena;`.
 * Host/solo simulate; clients mirror `arenaNet()` from the snapshot and move
 * their own hero through jumps and quicksand locally (`arenaLocal`).
 */
import type { Game } from '../game';
import { StaticBoxGrid } from '../../core/spatialHash';
import { biomeForStage } from '../../data/biomes';
import type { AABB } from '../../world/collision';
import { Team } from '../bullets';
import type { Enemy } from '../enemies';
import { envKillScore, hazardAt, hazardTuning, heroGroundMul, knockedIn } from '../hazards';
import type { Hero } from '../hero';
import { arenaTuning, jumpHeight, underPillar, type PropState, type TotemState } from '../interactives';
import { objectiveGold, objectiveTuning } from '../objectives';
import { PickupType } from '../pickups';
import { SCAR_COLORS } from '../scars';

/** Damage sources that count as environmental kills (bonus score, ENVIRONMENTAL KILL popups, objective). */
export const ENV_SOURCES = ['lava', 'thorns', 'quicksand', 'splat', 'pillar', 'barrel', 'crusher'];
/** Names for the damage breakdown. */
export const ARENA_SOURCE_NAMES: Record<string, string> = { lava: 'Lava', thorns: 'Thorns', quicksand: 'Quicksand', splat: 'Ice Splat', pillar: 'Falling Pillars', turret: 'Turrets', jumppad: 'Jump Landings', crusher: 'Crushers' };
/** Bullet `kind` for turret shots (see BULLET_KINDS in game.ts). */
export const TURRET_BULLET = 12;

/** After a new arena is built: set up its toys and objective. */
export function loadToys(this: Game): void {
  const n = this.arena.colliders.length;
  this.toys.load(this.arena, this.arenaStage, biomeForStage(this.arenaStage).pillarTint);
  if (this.arena.colliders.length !== n) this.walls = new StaticBoxGrid(this.arena.colliders);
  this.toys.sink.length = this.toys.sinkUid.length = 0;
  this.toys.envStreak = 0;
}

function dropCollider(game: Game, box: AABB): void {
  const k = game.arena.colliders.indexOf(box);
  if (k < 0) return;
  game.arena.colliders.splice(k, 1);
  game.walls = new StaticBoxGrid(game.arena.colliders);
}

function nearestHero(game: Game, x: number, z: number): Hero {
  let best = game.hero;
  let bd = Infinity;
  for (const h of game.aliveHeroes) {
    const d = (h.player.x - x) ** 2 + (h.player.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

/** One authoritative step of the arena (solo and host). */
export function updateArena(this: Game, dt: number): void {
  if (!this.isCombatMode) return;
  const duel = this.pvp?.phase === 'duel';
  for (const h of this.heroes) if (!h.left) this.arenaMoveHero(h, dt);
  if (!duel) {
    this.updateTurrets(dt);
    this.updateEnvHazards(dt);
  }
  this.updatePillars(dt);
  if (this.mode === 'fight' && !duel) this.updateObjective(dt);
  // Barrel chain reactions get a counter.
  const b = this.barrels;
  if (b.chain >= 2 && b.chain !== this.toys.shownChain) {
    this.vfx.num(b.lastX, 3.6, b.lastZ, `CHAIN x${b.chain}!`, 'crit');
    this.vfx.shake(b.lastX, b.lastZ, Math.min(0.9, 0.3 + b.chain * 0.08));
    if (b.chain >= 4) this.vfx.sound('comboUp', b.lastX, b.lastZ);
  }
  this.toys.shownChain = b.chain;
  if (this.toys.envT > 0) this.toys.envT -= dt;
  else this.toys.envStreak = 0;
}

/**
 * Jump pads and ground slowdowns for a hero. The hero this machine controls is
 * moved here; remote heroes (host side) only get their i-frames and landing shockwave.
 */
export function arenaMoveHero(this: Game, h: Hero, dt: number): void {
  const T = arenaTuning;
  const toys = this.toys;
  const p = h.player;
  const i = h.index;
  const own = h === this.hero;
  toys.padCd[i] = (toys.padCd[i] ?? 0) - dt;
  let j = toys.jumps[i];
  if (j && p.dead) j = toys.jumps[i] = null;
  if (!j && own && !p.dead && toys.padCd[i] <= 0) {
    const k = toys.pads.findIndex((pad) => (p.x - pad.x) ** 2 + (p.z - pad.z) ** 2 < T.padRadius * T.padRadius);
    if (k >= 0) {
      j = this.startJump(h, k);
      if (this.role === 'client') this.client?.send({ t: 'jump', i: k });
    }
  }
  if (!j) {
    // Quicksand and thorns slow the hero this machine moves (dashing powers through).
    if (own && !p.dead && !p.dashing) {
      const mul = heroGroundMul(this.arena.hazards, p.x, p.z);
      if (mul < 1) {
        p.pos.x = p.prev.x + (p.pos.x - p.prev.x) * mul;
        p.pos.z = p.prev.z + (p.pos.z - p.prev.z) * mul;
      }
    }
    return;
  }
  j.t += dt;
  const k = Math.min(1, j.t / T.jumpTime);
  p.invuln = Math.max(p.invuln, 0.06); // i-frames all the way (at 0.06 the hero doesn't blink)
  if (own) {
    p.pos.x = j.fx + (j.tx - j.fx) * k;
    p.pos.z = j.fz + (j.tz - j.fz) * k;
    p.vel.x = (j.tx - j.fx) / T.jumpTime;
    p.vel.z = (j.tz - j.fz) / T.jumpTime;
  }
  if (k < 1) return;
  toys.jumps[i] = null;
  toys.padCd[i] = T.padCooldown;
  if (own) {
    p.vel.x *= 0.3;
    p.vel.z *= 0.3;
    this.juice.shake(0.25);
    this.input.rumble(0.5, 0.6, 120);
  }
  if (j.pending && this.authority) this.landShock(h, own ? p.x : j.tx, own ? p.z : j.tz);
}

/** Launch a hero off pad k. */
export function startJump(this: Game, h: Hero, k: number) {
  const pad = this.toys.pads[k];
  const p = h.player;
  const j = { t: 0, fx: h === this.hero ? p.x : pad.x, fz: h === this.hero ? p.z : pad.z, tx: pad.tx, tz: pad.tz, pending: this.authority };
  this.toys.jumps[h.index] = j;
  p.invuln = Math.max(p.invuln, 0.06);
  if (h === this.hero) this.juice.shake(0.08);
  if (this.authority) {
    this.vfx.sound('jumpPad', pad.x, pad.z);
    this.vfx.ring(pad.x, pad.z, 1, 3.5, '#ffcd75', 0.3);
    this.vfx.burst(pad.x, 0.3, pad.z, { count: 14, color: '#ffcd75', color2: '#ef7d57', speed: [3, 7], size: [0.15, 0.3], life: [0.25, 0.5], up: 9, gravity: 16 });
  }
  return j;
}

/** Host: a client says its hero took pad k. */
export function arenaJumpMsg(this: Game, h: Hero, k: number): void {
  if (h.player.dead || !this.isCombatMode || !this.toys.pads[k] || this.toys.jumps[h.index]) return;
  this.startJump(h, k);
}

/** Landing: a shockwave that flings enemies (into lava, thorns, walls...). */
export function landShock(this: Game, h: Hero, x: number, z: number): void {
  const T = arenaTuning;
  this.vfx.sound('impact', x, z, 2.2);
  this.vfx.sound('explode', x, z, 1.3);
  this.vfx.shake(x, z, 0.45);
  this.vfx.ring(x, z, 1, T.landRadius * 2, '#ffcd75', 0.3);
  this.vfx.ring(x, z, 0.5, T.landRadius * 1.3, '#f4f4f4', 0.22);
  this.vfx.burst(x, 0.2, z, { count: 18, color: '#f2e2b8', color2: '#ffffff', speed: [4, 9], size: [0.2, 0.4], life: [0.3, 0.6], up: 4, gravity: 12, drag: 2 });
  this.vfx.scar(x, z, 1.4, SCAR_COLORS.crater, 8);
  if (this.pvp?.phase === 'duel') return;
  const dmg = T.landDmg + T.landDmgPerStage * (this.stage - 1);
  let n = 0;
  for (const e of this.enemiesInRadius(x, z, T.landRadius, this.scratch).slice()) {
    const d = Math.hypot(e.x - x, e.z - z) || 1;
    this.damage(e, dmg, { source: 'jumppad', dirX: (e.x - x) / d, dirZ: (e.z - z) / d, knockback: T.landKnock, canCrit: true, loud: n++ < 3 }, h);
  }
  this.blastToys(x, z, T.landRadius * 0.6, dmg * 0.5, h.index);
}

/** Turrets: walk onto an idle pad to switch it on; it shoots the nearest enemy for a while. */
export function updateTurrets(this: Game, dt: number): void {
  const T = arenaTuning;
  for (const t of this.toys.turrets) {
    if (t.t <= 0) {
      if (t.cd > 0) {
        t.cd -= dt;
        continue;
      }
      if (this.mode !== 'fight') continue;
      const h = this.aliveHeroes.find((x) => (x.player.x - t.x) ** 2 + (x.player.z - t.z) ** 2 < T.turretPad * T.turretPad);
      if (!h) continue;
      t.t = T.turretTime;
      t.owner = h.index;
      t.fireT = 0;
      this.vfx.sound('powerUp', t.x, t.z);
      this.vfx.num(t.x, 3, t.z, 'TURRET ONLINE!', 'score');
      this.vfx.ring(t.x, t.z, 1, 5, '#73eff7', 0.35);
      this.vfx.burst(t.x, 1.4, t.z, { count: 12, color: '#73eff7', color2: '#f4f4f4', speed: [2, 5], size: [0.12, 0.25], life: [0.3, 0.5], up: 4 });
      continue;
    }
    t.t -= dt;
    if (t.t <= 0) {
      t.t = 0;
      t.cd = T.turretCooldown;
      this.vfx.sound('portal', t.x, t.z, 0.6);
      this.vfx.burst(t.x, 1.4, t.z, { count: 8, color: '#566c86', color2: '#94b0c2', speed: [1, 3], size: [0.2, 0.35], life: [0.4, 0.7], up: 2, drag: 2 });
      continue;
    }
    if ((t.fireT -= dt) > 0) continue;
    const target = this.nearestEnemy(t.x, t.z, T.turretRange, (e) => e.pvpOwner >= 0);
    if (!target) continue;
    t.fireT = T.turretRate;
    // Lead the target a little.
    const tx = target.x + (target.x - target.px) * 6;
    const tz = target.z + (target.z - target.pz) * 6;
    const d = Math.hypot(tx - t.x, tz - t.z) || 1;
    const dx = (tx - t.x) / d;
    const dz = (tz - t.z) / d;
    t.aim = Math.atan2(dx, dz);
    this.bullets.spawn({
      x: t.x + dx * 1.1,
      z: t.z + dz * 1.1,
      dirX: dx,
      dirZ: dz,
      speed: 30,
      life: T.turretRange / 30 + 0.1,
      radius: 0.24,
      damage: T.turretDmg + T.turretDmgPerStage * (this.stage - 1),
      knockback: 2.5,
      team: Team.Player,
      color: '#7df9ff',
      width: 0.34,
      length: 0.9,
      owner: t.owner,
      kind: TURRET_BULLET,
    });
    if (Math.random() < 0.5) this.vfx.sound('w:buster', t.x, t.z, 1.5);
  }
}

/** Enemies vs the ground: lava, ice, quicksand and thorns. */
export function updateEnvHazards(this: Game, dt: number): void {
  const zones = this.arena.hazards;
  if (!zones.length) return;
  const H = hazardTuning;
  const toys = this.toys;
  const tick = this.stepN % 30 === 0;
  const list = this.enemies.list;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive || e.hopY > 0 || e.pvpOwner >= 0 || e.def.boss) {
      toys.sink[i] = 0;
      continue;
    }
    if (toys.sinkUid[i] !== e.uid) {
      toys.sinkUid[i] = e.uid;
      toys.sink[i] = 0;
    }
    const z = hazardAt(zones, e.x, e.z);
    if (z < 0) {
      toys.sink[i] = 0;
      continue;
    }
    const kind = zones[z].kind;
    const tough = e.elite || e.def.behavior === 'reaper';
    if (kind === 'lava') {
      if (!knockedIn(e.kx, e.kz)) continue;
      e.kx = e.kz = 0;
      this.vfx.burst(e.x, 0.4, e.z, { count: 14, color: '#ff7a2f', color2: '#ffd23f', speed: [2, 6], size: [0.2, 0.4], life: [0.3, 0.6], up: 8, gravity: 16 });
      this.vfx.sound('explode', e.x, e.z, 1.4);
      this.envHit(e, 'lava', tough ? e.maxHp * H.eliteFrac : e.hp + e.shield + 1);
    } else if (kind === 'ice') {
      // Knockback keeps sliding on ice; a fast slide into a wall is a splat.
      const sp = Math.hypot(e.kx, e.kz);
      if (sp < 0.5) continue;
      if (sp < 14) {
        const keep = Math.exp(H.iceSlide * dt);
        e.kx *= keep;
        e.kz *= keep;
      }
      if (sp > H.splatSpeed && this.walls.hitCircle(e.x + (e.kx / sp) * (e.radius + 0.3), e.z + (e.kz / sp) * (e.radius + 0.3), 0.2)) {
        e.kx = e.kz = 0;
        this.vfx.num(e.x, 2, e.z, 'SPLAT!', 'crit');
        this.vfx.star(e.x, 1, e.z, 1.6, '#bfefff', 0.15);
        this.vfx.burst(e.x, 0.8, e.z, { count: 10, color: '#bfefff', color2: '#ffffff', speed: [2, 6], size: [0.15, 0.3], life: [0.25, 0.5], up: 4, gravity: 12 });
        this.vfx.sound('impact', e.x, e.z, 1.8);
        this.envHit(e, 'splat', e.maxHp * (tough ? H.eliteFrac : H.splatFrac));
      }
    } else if (kind === 'quicksand') {
      e.slowT = Math.max(e.slowT, 0.2);
      e.slowAmt = Math.max(e.slowAmt, H.sandSlow);
      if (tough || e.def.xp > H.sinkXp) continue;
      if (knockedIn(e.kx, e.kz)) toys.sink[i] += 0.5;
      toys.sink[i] += dt;
      if (tick) this.vfx.burst(e.x, 0.1, e.z, { count: 2, color: '#b98a5a', color2: '#f2e2b8', speed: [0.5, 1.5], size: [0.15, 0.25], life: [0.3, 0.5], up: 1.5, gravity: 4 });
      if (toys.sink[i] >= H.sinkTime) {
        toys.sink[i] = 0;
        this.vfx.burst(e.x, 0.2, e.z, { count: 12, color: '#b98a5a', color2: '#8a5a3a', speed: [1, 3], size: [0.2, 0.35], life: [0.35, 0.6], up: 3, gravity: 8 });
        this.vfx.num(e.x, 1.6, e.z, 'GULP!', 'crit');
        this.envHit(e, 'quicksand', e.hp + e.shield + 1);
      }
    } else if (kind === 'thorns') {
      e.slowT = Math.max(e.slowT, 0.2);
      e.slowAmt = Math.max(e.slowAmt, H.thornSlow);
      if (knockedIn(e.kx, e.kz)) {
        e.kx *= 0.2;
        e.kz *= 0.2;
        this.vfx.burst(e.x, 0.6, e.z, { count: 8, color: '#ff7eb6', color2: '#38b764', speed: [2, 5], size: [0.12, 0.22], life: [0.2, 0.4], up: 3 });
        this.vfx.sound('hit', e.x, e.z, 0.7);
        this.envHit(e, 'thorns', e.maxHp * (tough ? H.eliteFrac : H.thornKnock));
      } else if (tick) this.envHit(e, 'thorns', Math.max(4, e.maxHp * H.thornTick * (tough ? 0.35 : 1)));
    }
  }
}

/** Fixed hazard damage, credited to the nearest hero. */
export function envHit(this: Game, e: Enemy, source: string, amount: number): void {
  if (!e.active || e.hp <= 0) return;
  this.damage(e, Math.max(1, amount), { source, fixed: true, noStatus: true }, nearestHero(this, e.x, e.z));
}

/** killEnemy hook: an enemy died to the arena. */
export function onEnvKill(this: Game, e: Enemy, source: string): void {
  const toys = this.toys;
  if (!this.authority || !ENV_SOURCES.includes(source)) return;
  const bonus = Math.round(envKillScore(this.stage, this.multiplier));
  this.score += bonus;
  toys.envKills++;
  toys.envStreak++;
  if (toys.envT <= 0) {
    this.vfx.num(e.x, 3.2, e.z, 'ENVIRONMENTAL KILL!', 'score');
    this.vfx.sound('comboUp', e.x, e.z);
  } else if (toys.envStreak === 3 || toys.envStreak === 6 || toys.envStreak % 10 === 0) {
    this.vfx.num(e.x, 3.2, e.z, `ENV KILL x${toys.envStreak}!`, 'score');
  }
  toys.envT = 0.8;
  const o = toys.objective;
  if (o.kind === 'envkills' && this.mode === 'fight' && o.progress()) this.completeObjective(e.x, e.z);
}

/** A player bullet hit a wall: damage the cover it hit, if breakable. Returns true if it hit a toy. */
export function hitToys(this: Game, x: number, z: number, r: number, dmg: number, owner: number, vx: number, vz: number): boolean {
  const sp = Math.hypot(vx, vz) || 1;
  const i = this.toys.propAt(x, z, r + 0.05);
  if (i >= 0) {
    this.damageProp(this.toys.props[i], dmg, owner, vx / sp, vz / sp);
    return true;
  }
  const t = this.toys.totemAt(x, z, r + 0.05);
  if (t >= 0) {
    this.damageTotem(this.toys.totems[t], dmg, owner);
    return true;
  }
  return false;
}

/** Beams and other weapons that test barrels by shape also chew through cover. */
export function hitToysWhere(this: Game, dmg: number, owner: number, inside: (x: number, z: number) => boolean): void {
  const h = this.heroes[owner] ?? this.hero;
  for (const p of this.toys.props) {
    if (!p.alive || !inside(p.def.x, p.def.z)) continue;
    const d = Math.hypot(p.def.x - h.player.x, p.def.z - h.player.z) || 1;
    this.damageProp(p, dmg, owner, (p.def.x - h.player.x) / d, (p.def.z - h.player.z) / d);
  }
  for (const t of this.toys.totems) if (t.alive && inside(t.x, t.z)) this.damageTotem(t, dmg, owner);
}

/** Explosions break cover and push pillars over away from the blast. */
export function blastToys(this: Game, x: number, z: number, r: number, dmg: number, owner: number): void {
  for (const p of this.toys.props) {
    if (!p.alive) continue;
    const dx = p.def.x - x;
    const dz = p.def.z - z;
    const d = Math.hypot(dx, dz);
    if (d > r + 0.7) continue;
    this.damageProp(p, dmg, owner, d > 0.01 ? dx / d : 0, d > 0.01 ? dz / d : 1);
  }
  for (const t of this.toys.totems) if (t.alive && Math.hypot(t.x - x, t.z - z) < r + 0.7) this.damageTotem(t, dmg, owner);
}

export function damageProp(this: Game, p: PropState, dmg: number, owner: number, dirX: number, dirZ: number): void {
  if (!p.alive || !this.authority) return;
  p.hp -= dmg;
  p.flash = 1;
  p.dirX = dirX;
  p.dirZ = dirZ;
  p.by = owner;
  if (p.hp > 0) return;
  p.alive = false;
  dropCollider(this, p.def.box);
  const { x, z } = p.def;
  if (p.def.kind === 'pillar') {
    // Topple away from the hit; it crushes what's under it when it lands (updatePillars).
    p.fallA = Math.atan2(dirX, dirZ);
    p.fallT = 0;
    p.simT = 0;
    this.vfx.sound('chargerWindup', x, z, 0.6);
    this.vfx.num(x, 5.2, z, 'TIMBER!', 'crit');
    this.vfx.burst(x, 0.5, z, { count: 12, color: '#d8d0ff', color2: '#94b0c2', speed: [1, 4], size: [0.2, 0.4], life: [0.4, 0.8], up: 3, gravity: 8 });
    return;
  }
  const h = p.def.kind === 'stack' ? 2.4 : 1.2;
  this.vfx.sound('coverBreak', x, z);
  this.vfx.burst(x, h * 0.5, z, { count: p.def.kind === 'stack' ? 22 : 14, color: '#c8803f', color2: '#ffcd75', speed: [3, 8], size: [0.18, 0.4], life: [0.4, 0.8], up: 6, gravity: 18, drag: 1 });
  this.vfx.burst(x, h * 0.5, z, { count: 6, color: '#94b0c2', color2: '#f4f4f4', speed: [1, 2.5], size: [0.35, 0.6], life: [0.4, 0.7], up: 2, drag: 3 });
  this.vfx.star(x, h * 0.6, z, 1.6, '#ffcd75', 0.12);
  if (this.rng.chance(arenaTuning.crateGold)) this.pickups.spawn(PickupType.Bolt, x, z, 1);
}

export function damageTotem(this: Game, t: TotemState, dmg: number, owner: number): void {
  if (!t.alive || !this.authority) return;
  t.hp -= dmg;
  t.flash = 1;
  if (t.hp > 0) return;
  t.alive = false;
  dropCollider(this, t.box);
  this.vfx.sound('explode', t.x, t.z);
  this.vfx.sound('shieldBreak', t.x, t.z, 0.6);
  this.vfx.shake(t.x, t.z, 0.35);
  this.vfx.ring(t.x, t.z, 1, 6, '#ef7d57', 0.35);
  this.vfx.burst(t.x, 1.5, t.z, { count: 26, color: '#b13e53', color2: '#ffcd75', speed: [3, 9], size: [0.2, 0.45], life: [0.4, 0.8], up: 7, gravity: 16 });
  const o = this.toys.objective;
  this.vfx.num(t.x, 3.6, t.z, `TOTEM ${Math.min(o.max, o.cur + 1)}/${o.max}`, 'score');
  void owner;
  if (o.kind === 'totems' && o.progress()) this.completeObjective(t.x, t.z);
}

/** Falling pillars crush whatever they land on (sim-side timer; the fall itself is drawn in render). */
export function updatePillars(this: Game, dt: number): void {
  const T = arenaTuning;
  for (const p of this.toys.props) {
    if (p.def.kind !== 'pillar' || p.fallT < 0 || p.crushed) continue;
    p.simT += dt;
    if (p.simT < T.pillarFall) continue;
    p.crushed = true;
    const { x, z } = p.def;
    const a = p.fallA;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const by = this.heroes[p.by] ?? this.hero;
    this.vfx.sound('explode', x + dx * 3, z + dz * 3, 0.7);
    this.vfx.sound('impact', x + dx * 3, z + dz * 3, 3);
    this.vfx.shake(x + dx * 3, z + dz * 3, 0.6);
    this.vfx.num(x + dx * 3, 2.4, z + dz * 3, 'CRASH!', 'crit');
    for (let k = 1; k <= 5; k++) {
      const px = x + dx * k;
      const pz = z + dz * k;
      this.vfx.burst(px, 0.3, pz, { count: 5, color: '#d8d0ff', color2: '#94b0c2', speed: [2, 5], size: [0.25, 0.45], life: [0.4, 0.8], up: 4, gravity: 10, drag: 1 });
      if (k % 2) this.vfx.scar(px, pz, 1.1, SCAR_COLORS.crater, 10);
    }
    const midX = x + dx * T.pillarLen * 0.5;
    const midZ = z + dz * T.pillarLen * 0.5;
    for (const e of this.enemiesInRadius(midX, midZ, T.pillarLen * 0.5 + 1, this.scratch).slice()) {
      if (e.pvpOwner >= 0 || !underPillar(e.x, e.z, e.radius, x, z, a, T.pillarLen, T.pillarHalfWidth)) continue;
      this.damage(e, e.def.boss ? e.maxHp * T.pillarBossFrac : e.hp + e.shield + 1, { source: 'pillar', fixed: true, noStatus: true }, by);
    }
    const inside = (px: number, pz: number) => underPillar(px, pz, 0.5, x, z, a, T.pillarLen, T.pillarHalfWidth);
    this.barrels.hitWhere(999, p.by, inside);
    // Domino: other cover under it breaks (pillars fall the same way).
    for (const o of this.toys.props) if (o.alive && inside(o.def.x, o.def.z)) this.damageProp(o, 9999, p.by, dx, dz);
    for (const t of this.toys.totems) if (t.alive && inside(t.x, t.z)) this.damageTotem(t, t.maxHp * 0.5, p.by);
  }
}

/** Shards and the beacon (totems and env kills progress where they happen). */
export function updateObjective(this: Game, dt: number): void {
  const toys = this.toys;
  const o = toys.objective;
  if (!o.active) return;
  if (o.kind === 'shards') {
    const R = arenaTuning.shardRadius;
    for (const s of toys.shards) {
      if (s.taken) continue;
      const h = this.aliveHeroes.find((x) => (x.player.x - s.x) ** 2 + (x.player.z - s.z) ** 2 < R * R);
      if (!h) continue;
      s.taken = true;
      this.vfx.sound('gem', s.x, s.z, 0.7);
      this.vfx.sound('powerUp', s.x, s.z);
      this.vfx.burst(s.x, 1, s.z, { count: 16, color: '#a7f070', color2: '#f4f4f4', speed: [2, 6], size: [0.12, 0.25], life: [0.3, 0.6], up: 5 });
      this.vfx.ring(s.x, s.z, 0.6, 3, '#a7f070', 0.3);
      this.vfx.num(s.x, 2.6, s.z, `SHARD ${o.cur + 1}/${o.max}`, 'score');
      if (o.progress()) this.completeObjective(s.x, s.z);
    }
  } else if (o.kind === 'beacon' && toys.beacon) {
    const b = toys.beacon;
    const R = objectiveTuning.beaconRadius;
    let inside = 0;
    for (const h of this.aliveHeroes) if ((h.player.x - b.x) ** 2 + (h.player.z - b.z) ** 2 < R * R) inside++;
    let foes = 0;
    if (inside > 0 || o.cur > 0) for (const e of this.enemiesInRadius(b.x, b.z, R, this.scratch)) if (e.pvpOwner < 0) foes++;
    const wasCharging = o.charging;
    const r = o.beaconStep(dt, inside, foes);
    if (o.charging && !wasCharging && o.cur < 0.1) {
      this.vfx.sound('powerUp', b.x, b.z);
      this.vfx.toast('BEACON CHARGING - HOLD THE RING!');
    }
    if (o.charging && this.stepN % 20 === 0) this.vfx.burst(b.x, 2.9, b.z, { count: 3, color: '#73eff7', color2: '#ffcd75', speed: [1, 3], size: [0.1, 0.2], life: [0.4, 0.7], up: 3 });
    if (r === 'done') this.completeObjective(b.x, b.z);
    else if (r === 'failed') {
      this.vfx.toast('BEACON LOST!', 2.6);
      this.vfx.sound('shieldBreak', b.x, b.z, 0.5);
      this.vfx.sound('explode', b.x, b.z);
      this.vfx.burst(b.x, 2.5, b.z, { count: 24, color: '#73eff7', color2: '#29366f', speed: [3, 8], size: [0.2, 0.4], life: [0.4, 0.8], up: 6, gravity: 14 });
    }
  }
}

/** Objective done: gold for everyone, score, and a treasure chest per hero. */
export function completeObjective(this: Game, x: number, z: number): void {
  const gold = objectiveGold(this.stage);
  this.score += objectiveTuning.scoreBase * this.stage;
  const team = this.heroes.filter((h) => !h.left);
  team.forEach((h, i) => {
    h.gold += gold;
    if (!h.player.dead) this.vfx.num(h.player.x, 2.8, h.player.z, `+${gold}●`, 'score');
    this.pickups.spawn(PickupType.Chest, x + (i - (team.length - 1) / 2) * 0.9, z + 1.2);
  });
  this.vfx.toast(`OBJECTIVE COMPLETE! +${gold} GOLD`, 3);
  this.vfx.sound('stageClear', NaN, NaN);
  this.vfx.ring(x, z, 1, 10, '#a7f070', 0.5);
  this.vfx.burst(x, 1.5, z, { count: 30, color: '#a7f070', color2: '#ffcd75', speed: [3, 9], size: [0.15, 0.35], life: [0.5, 0.9], up: 8, gravity: 10 });
}

/** Client: move this machine's hero through jumps and slow ground (the host can't do it for us). */
export function arenaLocal(this: Game, dt: number): void {
  if (!this.isCombatMode || this.mode === 'levelup') return;
  this.arenaMoveHero(this.hero, dt);
}

/** Snapshot payload (see Interactives.net). */
export function arenaNet(this: Game): Record<string, unknown> {
  return this.toys.net();
}

/** Client: apply the host's arena state. */
export function arenaSetNet(this: Game, n: Record<string, unknown> | undefined): void {
  if (!n) return;
  const out = { broke: [] as PropState[], fell: [] as PropState[], totems: [] as TotemState[] };
  this.toys.setNet(n, out);
  let changed = false;
  for (const p of [...out.broke, ...out.fell]) {
    const k = this.arena.colliders.indexOf(p.def.box);
    if (k >= 0) {
      this.arena.colliders.splice(k, 1);
      changed = true;
    }
  }
  for (const t of out.totems) {
    const k = this.arena.colliders.indexOf(t.box);
    if (k >= 0) {
      this.arena.colliders.splice(k, 1);
      changed = true;
    }
  }
  if (changed) this.walls = new StaticBoxGrid(this.arena.colliders);
}

/** Draw the toys, lift jumping heroes and update the objective tracker. */
export function renderArena(this: Game, frameDt: number): void {
  this.toys.render(this.animTime, frameDt);
  const client = this.role === 'client';
  for (const h of this.heroes) {
    if (h.left || h.player.dead) continue;
    const t = this.toys.jumpT01(h.index, client && h !== this.hero);
    const root = h.player.rig.root;
    if (t >= 0) {
      // Up in an arc with a somersault in the middle.
      root.position.y = jumpHeight(t, arenaTuning.jumpHeight);
      const f = Math.min(1, Math.max(0, (t - 0.15) / 0.7));
      root.rotation.x = -Math.PI * 2 * f * f * (3 - 2 * f);
    } else if (root.rotation.x !== 0) root.rotation.x = 0;
  }
  const show = this.isCombatMode && this.mode !== 'title' && !this.pvp;
  const target = show ? this.objectiveTarget() : null;
  let ptr: { x: number; y: number; ang: number; dist: number } | null = null;
  if (target) {
    this.tmp.set(target.x, 1, target.z).project(this.cam.camera);
    const sx = ((this.tmp.x + 1) / 2) * innerWidth;
    const sy = ((1 - this.tmp.y) / 2) * innerHeight;
    if (sx < 10 || sx > innerWidth - 10 || sy < 10 || sy > innerHeight - 10 || this.tmp.z > 1) {
      const cx = innerWidth / 2;
      const cy = innerHeight / 2;
      let dx = sx - cx;
      let dy = sy - cy;
      if (this.tmp.z > 1) {
        dx = -dx;
        dy = -dy;
      }
      const mx = 130; // keep clear of the HUD in the corners
      const my = 120;
      const k = Math.min((cx - mx) / Math.max(1e-3, Math.abs(dx)), (cy - my) / Math.max(1e-3, Math.abs(dy)));
      const p = this.hero.player;
      ptr = { x: cx + dx * k, y: cy + dy * k, ang: Math.atan2(dy, dx), dist: Math.round(Math.hypot(target.x - p.x, target.z - p.z)) };
    }
  }
  this.objHud.update(show ? this.toys.objective : null, ptr);
}

/** Where the objective wants you: nearest totem or shard, or the beacon. */
export function objectiveTarget(this: Game): { x: number; z: number } | null {
  const toys = this.toys;
  const o = toys.objective;
  if (!o.active) return null;
  if (o.kind === 'beacon') return toys.beacon;
  const p = this.hero.player;
  let best: { x: number; z: number } | null = null;
  let bd = Infinity;
  const list = o.kind === 'totems' ? toys.totems : o.kind === 'shards' ? toys.shards : [];
  for (const t of list) {
    if ('alive' in t ? !t.alive : t.taken) continue;
    const d = (t.x - p.x) ** 2 + (t.z - p.z) ** 2;
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}
