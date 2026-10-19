/**
 * Combat: damage, kills, drops, blasts and death effects.
 * Split out of src/game/game.ts: these are Game methods (`this` is the Game),
 * installed on the class as fields, e.g. `nearestEnemy = Combat.nearestEnemy;`.
 */
import type { Game } from '../game';
import { CONVEYOR_SPEED, statusTuning } from '../game';
import type { Tag } from '../../data/tags';
import { feelOf, isRightClick } from '../../data/weapons';
import { BULLET_Y } from '../bullets';
import { type Enemy } from '../enemies';
import { Hero } from '../hero';
import { type DamageOpts } from '../weapons';
import { SCAR_COLORS } from '../scars';
import { damageNumberLabel } from '../../ui/damageNumbers';

export function nearestEnemy(this: Game, x: number, z: number, r: number, skip?: (e: Enemy) => boolean): Enemy | null {
  let best: Enemy | null = null;
  let bd = r * r;
  this.hash.query(x, z, r, (e) => {
    if (!e.alive || e.hp <= 0 || (skip && skip(e))) return;
    const d = (e.x - x) ** 2 + (e.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = e;
    }
  });
  return best;
}

export function enemiesInRadius(this: Game, x: number, z: number, r: number, out: Enemy[]): Enemy[] {
  out.length = 0;
  this.hash.query(x, z, r + 1, (e) => {
    if (!e.alive || e.hp <= 0) return;
    const rr = r + e.radius;
    if ((e.x - x) ** 2 + (e.z - z) ** 2 < rr * rr && !out.includes(e)) out.push(e);
  });
  return out;
}

/** All damage to enemies, credited to the hero who dealt it. */
export function damage(this: Game, e: Enemy, base: number, o: DamageOpts, by: Hero): number {
  if (!e.active || e.hp <= 0) return 0;
  if (e.pvpOwner >= 0) return this.pvpHit(e, base, o, by);
  if (e.roarT > 0) return 0; // bosses are invulnerable while they roar or make their entrance
  const tags: readonly Tag[] = o.tags ?? by.tagsOf(o.source) ?? [];
  const crit = !o.fixed && !!o.canCrit && this.rng.chance(by.stats.critChance);
  const ev = { e, source: o.source, tags, dist: Math.hypot(e.x - by.player.x, e.z - by.player.z), crit };
  // Stats first, then Mods left to right, then statuses and crit.
  let amount = o.fixed ? base : by.synergy.damage(ev, base * by.stats.damageMul);
  if (!o.fixed && e.frozen > 0 && e.shatter > 0) amount *= 1 + e.shatter;
  if (!o.fixed && e.shockT > 0) amount *= 1 + statusTuning.shockMult + by.synergy.flags.shockMult;
  if (!o.fixed && e.exposeT > 0) amount *= 1 + statusTuning.exposeMult;
  if (!o.fixed) amount *= this.guardMul(e, o, by); // Shield Bots
  if (crit) amount *= by.stats.critMult;
  amount = Math.max(1, Math.round(amount));
  const dealt = Math.min(amount, Math.max(0, e.hp + e.shield));
  // Shielded elites: the shield soaks damage (and blocks statuses) until it breaks.
  const shielded = e.shield > 0;
  if (shielded) {
    const soak = Math.min(e.shield, amount);
    e.shield -= soak;
    e.hp -= amount - soak;
    if (e.shield <= 0) this.breakShield(e);
  } else e.hp -= amount;
  by.damageBy[o.source] = (by.damageBy[o.source] ?? 0) + dealt;
  e.flash = 0.07;
  const k = (o.knockback ?? 0) * by.stats.knockbackMul * (1 - e.def.knockbackResist) * (crit ? 1.5 : 1) * feelOf(o.source).knock;
  if (k > 0) {
    e.kx += (o.dirX ?? 0) * k;
    e.kz += (o.dirZ ?? 0) * k;
  }
  e.squash(crit ? -6 : -3);
  const hx = o.hx ?? e.x;
  const hz = o.hz ?? e.z;
  if (crit) {
    this.vfx.num(e.x, 1.9 * e.scale, e.z, `${amount}!`, 'crit');
    this.vfx.sound('crit', e.x, e.z);
    this.vfx.star(hx, BULLET_Y, hz, 1.5, '#fff35c', 0.12);
  } else if (o.loud) {
    // Cosmetic labels travel through the existing number event on hosts and clients.
    const accent = shielded ? 'shield' : tags.includes('fire') ? 'fire' : tags.includes('shock') ? 'shock' : tags.includes('frost') ? 'frost' : undefined;
    this.vfx.num(e.x, 1.7 * e.scale, e.z, damageNumberLabel(amount, accent));
    this.vfx.sound(shielded ? 'hitMetal' : 'hit', e.x, e.z, this.pitch);
    this.vfx.star(hx, BULLET_Y, hz, 0.85, '#ffffff', 0.08);
  }
  // Heavy hits get a low thump under the hit sound.
  if ((o.loud || crit) && amount >= 25) this.vfx.sound('impact', e.x, e.z, Math.min(3, amount / 25));
  if (o.loud || crit) {
    this.vfx.burst(hx, BULLET_Y, hz, { count: 3, color: '#ffffff', color2: e.def.bodyColor, speed: [3, 7], size: [0.1, 0.18], life: [0.12, 0.25], dir: { x: -(o.dirX ?? 0), z: -(o.dirZ ?? 0), spread: 2.4 } });
  }
  this.skillHit(e, o, dealt, crit, by);
  // Statuses from the weapon's own tags, then Mod triggers.
  if (!o.noStatus && e.hp > 0 && !shielded) {
    if (tags.includes('fire')) this.ignite(e, Math.max(3, amount * 0.15), by);
    if (tags.includes('shock')) this.shock(e, by);
    if (isRightClick(o.source)) this.expose(e);
  }
  if (!o.noStatus) {
    by.synergy.hit(ev);
    if (crit) by.synergy.crit(ev);
    if (crit && by.hasRelic('r_static') && o.source !== 'zap' && e.active) this.zap(e, 2, Math.max(4, amount * 0.35), by);
  }
  if (e.def.phases) this.bossHpGate(e); // boss phases: can't skip one or die early
  if (e.hp <= 0 && e.active) this.killEnemy(e, o.source, by);
  return amount;
}

/** Sparky zaps the nearest enemy every 1.5 s. */
export function updatePets(this: Game, dt: number): void {
  for (const h of this.heroes) {
    if (h.pet !== 'sparky' || h.left || h.player.dead || (h.sparkyT -= dt) > 0) continue;
    h.sparkyT = 1.5;
    const p = h.player;
    const e = this.nearestEnemy(p.x, p.z, 9);
    if (!e) continue;
    this.damage(e, 10 + 3 * this.level, { source: 'pet', tags: ['shock'], canCrit: true, loud: true }, h);
    this.vfx.star(e.x, 1, e.z, 1.3, '#fff35c', 0.12);
    this.vfx.ring(e.x, e.z, 0.5, 2, '#fff35c', 0.2);
    this.vfx.sound('w:zap', e.x, e.z);
    h.petView?.zap();
  }
}

/** Elite modifiers that act over time: vampiric regen and blinking teleports. */
export function updateEliteMods(this: Game, dt: number): void {
  for (const e of this.enemies.list) {
    const m = e.mod;
    if (!e.alive || !m || e.frozen > 0) continue;
    if (m.vampire) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * m.vampire.regen * dt);
    if (m.teleport && (e.modT -= dt) <= 0) {
      e.modT = m.teleport * this.rng.range(0.8, 1.2);
      const alive = this.aliveHeroes;
      if (!alive.length) continue;
      let best = alive[0].player;
      for (const h of alive) if (Math.hypot(h.player.x - e.x, h.player.z - e.z) < Math.hypot(best.x - e.x, best.z - e.z)) best = h.player;
      const a = this.rng.next() * Math.PI * 2;
      const d = this.rng.range(2.8, 4.2);
      const x = best.x + Math.cos(a) * d;
      const z = best.z + Math.sin(a) * d;
      if (this.walls.hitCircle(x, z, e.radius)) continue;
      this.vfx.burst(e.x, 1, e.z, { count: 12, color: m.color, color2: '#f4f4f4', speed: [2, 5], size: [0.15, 0.3], life: [0.25, 0.45], up: 3 });
      e.x = e.px = x;
      e.z = e.pz = z;
      e.squash(8);
      this.vfx.ring(x, z, 1, 3, m.color, 0.3);
      this.vfx.burst(x, 1, z, { count: 12, color: m.color, color2: '#f4f4f4', speed: [2, 5], size: [0.15, 0.3], life: [0.25, 0.45], up: 3 });
      this.vfx.sound('portal', x, z);
    }
  }
}

/** What's underfoot at (x, z): ice makes you slide, conveyors carry you. */
export function groundAt(this: Game, x: number, z: number, out: { slip: number; pushX: number; pushZ: number }): void {
  out.slip = out.pushX = out.pushZ = 0;
  for (const h of this.arena.hazards) if (h.kind === 'ice' && (x - h.x) ** 2 + (z - h.z) ** 2 < h.r * h.r) out.slip = 1;
  for (const c of this.arena.conveyors) {
    if (Math.abs(x - c.x) < c.w / 2 && Math.abs(z - c.z) < c.d / 2) {
      out.pushX = c.dx * CONVEYOR_SPEED;
      out.pushZ = c.dz * CONVEYOR_SPEED;
    }
  }
}

/** Lava burns heroes (with knockback out of the pool) and sets enemies alight; conveyors carry enemies too. */
export function updateHazards(this: Game, dt: number): void {
  if (!this.isCombatMode) return;
  const lava = this.arena.hazards.filter((h) => h.kind === 'lava');
  if (lava.length) {
    for (const h of this.aliveHeroes) {
      const p = h.player;
      if ((h.lavaT -= dt) > 0 || p.dashing) continue;
      const pool = lava.find((l) => (p.x - l.x) ** 2 + (p.z - l.z) ** 2 < l.r * l.r);
      if (!pool) continue;
      h.lavaT = 0.5;
      this.vfx.burst(p.x, 0.3, p.z, { count: 8, color: '#ff7a2f', color2: '#ffd23f', speed: [1, 3], size: [0.15, 0.3], life: [0.3, 0.5], up: 5 });
      this.hurtHero(h, 8 * this.director.dmgMul, pool.x, pool.z, null, 'Lava');
    }
    if (this.stepN % 30 === 0) {
      for (const e of this.enemies.list) {
        if (!e.alive || e.def.boss || e.burnT > 0) continue;
        if (lava.some((l) => (e.x - l.x) ** 2 + (e.z - l.z) ** 2 < l.r * l.r)) this.ignite(e, 6 + 2 * this.stage, this.hero);
      }
    }
  }
  if (this.arena.conveyors.length) {
    for (const e of this.enemies.list) {
      if (!e.alive || e.def.boss || e.hopY > 0) continue;
      for (const c of this.arena.conveyors) {
        if (Math.abs(e.x - c.x) < c.w / 2 && Math.abs(e.z - c.z) < c.d / 2) {
          e.x += c.dx * CONVEYOR_SPEED * dt;
          e.z += c.dz * CONVEYOR_SPEED * dt;
        }
      }
    }
  }
}

/** Death flavour by enemy kind. Swarm kills only sometimes get the extras, so mass kills stay light. */
export function deathFx(this: Game, e: Enemy, big: boolean): void {
  const def = e.def;
  const y = e.radius + 0.2;
  const full = big || def.xp >= 2 || this.rng.chance(0.3);
  if (!full) return;
  switch (def.death) {
    case 'robot':
      // Bolts and springs.
      this.vfx.burst(e.x, y, e.z, { count: big ? 16 : 4, color: '#94b0c2', color2: '#566c86', speed: [3, 7], size: [0.1, 0.2], life: [0.5, 0.9], up: 8, gravity: 22, drag: 1 });
      this.vfx.burst(e.x, y, e.z, { count: big ? 6 : 1, color: '#ffcd75', color2: '#ef7d57', speed: [2, 5], size: [0.08, 0.14], life: [0.6, 1], up: 10, gravity: 24, drag: 1 });
      break;
    case 'goo':
      this.vfx.scar(e.x, e.z, e.radius * 1.7, def.bodyColor, 8);
      this.vfx.burst(e.x, y, e.z, { count: big ? 18 : 5, color: def.bodyColor, color2: def.accentColor, speed: [2, 6], size: [0.14, 0.26], life: [0.4, 0.7], up: 7, gravity: 22, drag: 1 });
      break;
    case 'shards':
      this.vfx.burst(e.x, y, e.z, { count: 14, color: '#73eff7', color2: '#f4f4f4', speed: [4, 9], size: [0.1, 0.24], life: [0.4, 0.8], up: 6, gravity: 16 });
      this.vfx.ring(e.x, e.z, e.radius, 4, '#73eff7', 0.3);
      break;
  }
}

/** The boss's last moments: a chain of explosions while time slows, then one big blast. */
export function updateBossBoom(this: Game, dt: number): void {
  const b = this.bossBoom;
  if (!b || (b.t -= dt) > 0) return;
  if (b.n > 0) {
    if (b.n === 3) this.vfx.sound('bossFinisher', b.x, b.z);
    b.n--;
    b.t = 0.17;
    const a = this.rng.next() * Math.PI * 2;
    const d = this.rng.range(0.3, 1) * b.r;
    const x = b.x + Math.cos(a) * d;
    const z = b.z + Math.sin(a) * d;
    this.vfx.burst(x, 1, z, { count: 14, color: b.color, color2: '#ffcd75', speed: [4, 9], size: [0.2, 0.4], life: [0.3, 0.6], up: 6, gravity: 14, smoke: 3, sparks: 4 });
    this.vfx.ring(x, z, 1, 4, '#ffcd75', 0.25);
    this.vfx.star(x, 1.2, z, 2.2, '#ffffff', 0.12);
    this.vfx.sound('explode', x, z);
    this.vfx.shake(x, z, 0.25);
    return;
  }
  this.bossBoom = null;
  this.vfx.ring(b.x, b.z, 1, b.r * 5, '#ffffff', 0.45);
  this.vfx.ring(b.x, b.z, 1, b.r * 3.5, b.color, 0.4);
  this.vfx.burst(b.x, 1.2, b.z, { count: 50, color: b.color, color2: '#ffffff', speed: [6, 14], size: [0.25, 0.5], life: [0.5, 1], up: 8, gravity: 12, smoke: 12, debris: 14, scorch: 0 });
  this.vfx.scar(b.x, b.z, b.r * 1.4, SCAR_COLORS.crater, 30);
  this.vfx.sound('bomb', b.x, b.z);
  this.vfx.shake(b.x, b.z, 1);
  this.vfx.flash(0.7);
}

export function breakShield(this: Game, e: Enemy): void {
  const y = e.radius + 0.4;
  this.vfx.burst(e.x, y, e.z, { count: 26, color: '#73eff7', color2: '#f4f4f4', speed: [4, 9], size: [0.12, 0.28], life: [0.35, 0.7], up: 5, gravity: 14 });
  this.vfx.ring(e.x, e.z, e.radius * 1.6, 5, '#41a6f6', 0.3);
  this.vfx.num(e.x, 2.2 * e.scale, e.z, 'SHIELD BROKEN!', 'crit');
  this.vfx.sound('shieldBreak', e.x, e.z);
  this.vfx.shake(e.x, e.z, 0.2);
  e.squash(-8);
}
