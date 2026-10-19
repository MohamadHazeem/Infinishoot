/**
 * Enemy lane: callbacks the smarter enemies need (leaper landings, medic heals,
 * elite squads and rallies, the Goldbug), Shield Bot damage reduction, and
 * squad / Goldbug spawning. Game methods (`this` is the Game), installed on
 * the class as fields like the other systems.
 */
import type { Game } from '../game';
import { dropTuning } from '../game';
import { ENEMIES, squadOf, squadSize, type EnemyDef } from '../../data/enemies';
import { guardFactor, squadTuning, type Enemy, type EnemyCtx } from '../enemies';
import type { Hero } from '../hero';
import { PickupType } from '../pickups';
import { SCAR_COLORS } from '../scars';
import type { DamageOpts } from '../weapons';
import { bossLike } from '../bossRules';

/** Goldbug reward and spawn numbers. */
export const treasureTuning = {
  coins: 6, // coin pickups dropped
  goldBase: 3, // gold per coin: base + perStage x stage
  goldPerStage: 1,
  gemPerStage: 12, // extra XP gem value per stage (before dropTuning.xpMul)
  spawnMin: 9, // spawns this close to a hero (on screen) so you can see it run
  spawnMax: 12,
};

/** EnemyCtx members for the enemy lane (spread into Game.makeEnemyCtx). */
export function enemyCtxExtras(this: Game): Pick<EnemyCtx, 'land' | 'heal' | 'rally' | 'sparkle' | 'escape' | 'bounds'> {
  return {
    land: (e, r, damage) => {
      this.vfx.ring(e.x, e.z, 1, r * 2, e.def.accentColor, 0.3);
      this.vfx.burst(e.x, 0.3, e.z, { count: 10, color: '#f2e2b8', color2: e.def.bodyColor, speed: [3, 7], size: [0.15, 0.3], life: [0.3, 0.5], up: 3, gravity: 10 });
      this.vfx.sound('impact', e.x, e.z, 1.2);
      this.vfx.shake(e.x, e.z, 0.15);
      for (const h of this.aliveHeroes) {
        if (Math.hypot(h.player.x - e.x, h.player.z - e.z) < r + h.player.radius) this.hurtHero(h, damage * e.dmgMul, e.x, e.z, e, e.def.name);
      }
    },
    heal: (e, r, frac) => {
      let n = 0;
      for (const o of this.enemies.list) {
        if (o === e || !o.alive || bossLike(o) || o.def.behavior === 'reaper' || o.pvpOwner >= 0 || o.hp >= o.maxHp) continue;
        if ((o.x - e.x) ** 2 + (o.z - e.z) ** 2 > r * r) continue;
        // Elites heal at half rate so a medic can't make one unkillable.
        const amt = Math.min(o.maxHp - o.hp, o.maxHp * frac * (o.elite ? 0.5 : 1));
        o.hp += amt;
        if (n++ < 4) this.vfx.num(o.x, 1.8 * o.scale, o.z, `+${Math.round(amt)}`, 'heal');
      }
      this.vfx.ring(e.x, e.z, 1, r * 2, '#a7f070', 0.4);
      this.vfx.burst(e.x, 1.2, e.z, { count: 8, color: '#a7f070', color2: '#ffffff', speed: [1, 3], size: [0.15, 0.3], life: [0.4, 0.7], up: 4, drag: 2 });
      this.vfx.sound('heal', e.x, e.z);
    },
    rally: (e) => {
      const R2 = squadTuning.rallyRange * squadTuning.rallyRange;
      let n = 0;
      for (const o of this.enemies.list) {
        if (o.leader !== e || !o.alive || (o.x - e.x) ** 2 + (o.z - e.z) ** 2 > R2) continue;
        o.rallyT = squadTuning.rallyTime;
        o.hp = Math.min(o.maxHp, o.hp + o.maxHp * squadTuning.rallyHeal);
        o.squash(5);
        n++;
      }
      if (!n) return;
      e.squash(-6);
      this.vfx.num(e.x, 2.6 * e.scale, e.z, 'RALLY!', 'score');
      this.vfx.ring(e.x, e.z, 1, squadTuning.rallyRange * 2, '#ffcd75', 0.45);
      this.vfx.sound('telegraph', e.x, e.z);
    },
    sparkle: (e) => {
      this.vfx.burst(e.x, 0.6 + e.radius, e.z, { count: 1, color: '#fff6c8', color2: '#ffd23f', speed: [0.5, 2], size: [0.12, 0.24], life: [0.3, 0.6], up: 3, drag: 2 });
    },
    escape: (e) => {
      this.vfx.burst(e.x, 0.8, e.z, { count: 24, color: '#ffd23f', color2: '#ffffff', speed: [2, 7], size: [0.15, 0.3], life: [0.3, 0.7], up: 5, drag: 2 });
      this.vfx.ring(e.x, e.z, 1, 4, '#ffd23f', 0.3);
      this.vfx.num(e.x, 2.2, e.z, 'HEE HEE!', 'score');
      this.vfx.toast('THE GOLDBUG GOT AWAY!');
      this.vfx.sound('goldenLaugh', e.x, e.z);
      this.vfx.sound('portal', e.x, e.z);
      this.enemies.kill(e);
    },
    bounds: () => this.arena.halfSize,
  };
}

/** Shield Bots: hits from the front (or on allies sheltering behind one) are reduced. */
export function guardMul(this: Game, e: Enemy, o: DamageOpts, by: Hero): number {
  if (!e.def.guard && e.guardT <= 0) return 1;
  // Where the hit comes from: against the push direction if it has one, else the attacker.
  const dx = o.dirX ?? 0;
  const dz = o.dirZ ?? 0;
  const k = dx || dz ? guardFactor(e, -dx, -dz) : guardFactor(e, by.player.x - e.x, by.player.z - e.z);
  if (k < 1 && e.blockT <= 0) {
    e.blockT = 1.2;
    const fx = e.def.guard ? e.facing : e.guardAng;
    // Only the Shield Bot itself says BLOCK (the bots hiding behind it just flash), so crowds don't spam labels.
    if (e.def.guard) this.vfx.num(e.x, 1.9 * e.scale, e.z, 'BLOCK', 'hit');
    this.vfx.star(e.x + Math.sin(fx) * e.radius, 1, e.z + Math.cos(fx) * e.radius, 0.9, '#73eff7', 0.08);
  }
  return k;
}

/** An elite arrives with an escort that follows it in formation (host only). */
export function spawnSquad(this: Game, leader: Enemy): void {
  if (!this.authority || leader.def.boss || leader.def.treasure) return;
  const def = ENEMIES[squadOf(leader.def)];
  if (!def) return;
  const n = squadSize(this.stage);
  const fs = Math.sin(leader.facing);
  const fc = Math.cos(leader.facing);
  for (let i = 0; i < n && this.enemies.activeCount < 470; i++) {
    const row = (i >> 1) + 1;
    const lx = (i & 1 ? 1 : -1) * row * squadTuning.spacing * 0.8;
    const lz = -row * squadTuning.spacing;
    const x = leader.x + fc * lx + fs * lz;
    const z = leader.z - fs * lx + fc * lz;
    if (this.walls.hitCircle(x, z, def.radius)) continue;
    const m = this.enemies.spawn(def, x, z, this.spawnOpts());
    m.leader = leader;
    m.leaderUid = leader.uid;
    m.slot = i;
  }
}

/** The Goldbug pops up on screen near a hero, sparkling, and starts running. */
export function spawnGolden(this: Game, def: EnemyDef): { x: number; z: number } | null {
  const pos = this.ringPoint(treasureTuning.spawnMin, treasureTuning.spawnMax, def.radius + 0.3);
  if (!pos) return null;
  this.enemies.spawn(def, pos.x, pos.z, this.spawnOpts());
  this.vfx.toast('A GOLDBUG APPEARED! CATCH IT!', 2.6);
  this.vfx.ring(pos.x, pos.z, 1, 5, '#ffd23f', 0.4);
  this.vfx.burst(pos.x, 1, pos.z, { count: 16, color: '#ffd23f', color2: '#ffffff', speed: [2, 6], size: [0.15, 0.3], life: [0.3, 0.6], up: 5, drag: 2 });
  this.vfx.sound('goldenLaugh', pos.x, pos.z);
  this.vfx.sound('jingle', pos.x, pos.z);
  return pos;
}

/** Extra kill handling for this lane: Goldbug jackpot, squads scattering. Called from killEnemy. */
export function onEnemyKilled(this: Game, e: Enemy, by: Hero | null): void {
  if (e.def.treasure) {
    const t = treasureTuning;
    const gold = t.goldBase + t.goldPerStage * this.stage;
    for (let i = 0; i < t.coins; i++) {
      const a = (i / t.coins) * Math.PI * 2;
      this.pickups.spawn(PickupType.Bolt, e.x + Math.cos(a) * 0.9, e.z + Math.sin(a) * 0.9, gold);
    }
    this.pickups.spawn(PickupType.Gem, e.x, e.z, t.gemPerStage * this.stage * dropTuning.xpMul);
    this.pickups.spawn(PickupType.Chest, e.x + 1.2, e.z);
    this.vfx.banner('JACKPOT!', `${(by?.name ?? 'YOU').toUpperCase()} CAUGHT THE GOLDBUG`, 1.8);
    this.vfx.flash(0.3);
    this.vfx.shake(e.x, e.z, 0.4);
    this.vfx.ring(e.x, e.z, 1, 8, '#ffd23f', 0.5);
    this.vfx.ring(e.x, e.z, 1, 5, '#ffffff', 0.35);
    this.vfx.star(e.x, 1.2, e.z, 3, '#fff35c', 0.2);
    this.vfx.burst(e.x, 1, e.z, { count: 40, color: '#ffd23f', color2: '#fff6c8', speed: [4, 11], size: [0.18, 0.36], life: [0.5, 1], up: 9, gravity: 14 });
    this.vfx.scar(e.x, e.z, 1.6, SCAR_COLORS.crater, 8);
    this.vfx.sound('chest', e.x, e.z);
    this.vfx.sound('legendary', NaN, NaN);
    return;
  }
  if (!e.elite) return;
  // The elite's escort breaks and runs.
  let n = 0;
  for (const o of this.enemies.list) {
    if (o.leader !== e || !o.active) continue;
    o.leader = null;
    o.scatterT = squadTuning.scatter;
    o.squash(6);
    n++;
  }
  if (n) this.vfx.num(e.x, 3, e.z, 'SCATTER!', 'score');
}
