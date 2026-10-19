/** Six new companions. Host-only combat; cp.p2 mirrors durable presentation state. */
import type { Game } from '../game';
import type { Hero } from '../hero';
import type { Enemy } from '../enemies';
import type { DamageOpts } from '../weapons/base';
import { pets2Tuning as T, rankOf } from '../../data/pets';
import { isPets2 } from '../pets2';
import { Team } from '../bullets';
import { secretsState } from './secrets';
import { renderPetScout } from '../../ui/pets2Hud';
import type { LightPicker } from '../../render/lights';

const skipPlayer = (e: Enemy) => e.pvpOwner >= 0 || e.def.hidden === true;
const targets: Enemy[] = [];
const FIRE: DamageOpts = { source: 'pet', tags: ['fire', 'area'], canCrit: true, loud: true };
const HIT: DamageOpts = { source: 'pet', tags: [], canCrit: true, loud: true };

/** Shared pure cone test, including the tip at zero distance. */
export function petCone(dx: number, dz: number, ax: number, az: number, range: number): boolean {
  const d = Math.hypot(dx, dz);
  return d <= range && (d < 0.01 || (dx * ax + dz * az) / d >= 0.65);
}
function cue(g: Game, h: Hero, name: string, x = h.player.x, z = h.player.z): void {
  // Local playback and remote playback both honor PET SOUNDS (see Vfx.sound).
  g.vfx.sound('pet2:' + name, x, z);
}

/** Called only by updatePets, never by render or a client simulation. */
export function updatePet2(this: Game, h: Hero, dt: number): void {
  if (this.role === 'client' || this.pvp || !isPets2(h.pet) || h.left || h.player.dead) return;
  const st = h.petState,
    s = st.extra,
    r = st.ranks,
    p = h.player;
  if (r.scout && (s.scanT -= dt) <= 0) {
    s.scanT = T.scoutEvery;
    let best: Enemy | null = null,
      bestScore = Infinity;
    for (const e of this.enemies.list) {
      if (!e.targetable || e.hp <= 0 || skipPlayer(e)) continue;
      const d = (e.x - p.x) ** 2 + (e.z - p.z) ** 2;
      if (d > T.scoutRange ** 2) continue;
      const score = d - (e.elite || e.def.boss ? T.scoutRange ** 2 : 0);
      if (score < bestScore) {
        best = e;
        bestScore = score;
      }
    }
    s.scoutKind = best ? (best.elite || best.def.boss ? 2 : 1) : 0;
    if (best) {
      s.scoutX = best.x;
      s.scoutZ = best.z;
      this.vfx.ring(best.x, best.z, 1, 3, '#73eff7', 0.45);
    }
    const room = r.scout >= 2 ? secretsState(this).room : null;
    s.secret = !!room && !room.done;
    if (room) {
      s.secretX = room.x;
      s.secretZ = room.z;
    }
  }
  if (r.absorb) {
    s.supportT = Math.max(0, s.supportT - dt);
    if (s.supportT === 0 && (s.scanT -= dt) <= 0) {
      s.scanT = T.absorbScan;
      const b = this.bullets;
      for (let i = 0; i < b.count; i++) {
        if (
          b.team[i] !== Team.Enemy ||
          (b.x[i] - p.x) ** 2 + (b.z[i] - p.z) ** 2 > T.absorbRadius ** 2
        )
          continue;
        this.vfx.ring(b.x[i], b.z[i], 1, 0.1, '#a7f070', 0.3);
        b.kill(i);
        s.supportT = rankOf(T.absorbEvery, r.absorb);
        cue(this, h, 'gulp');
        break;
      }
    }
  }
  // Pacifist minigames retain utility, but never get pet attacks or free theft gold.
  if (this.modes.holster) return;
  s.actionT -= dt;
  if (r.flame && s.actionT <= 0) {
    const range = T.flameRange + (r.wings ? T.wingsRange : 0);
    const enemy = this.nearestEnemy(p.x, p.z, range, skipPlayer);
    s.actionT = enemy ? rankOf(T.flameEvery, r.flame) : 0.3;
    if (enemy) {
      const dx = enemy.x - p.x,
        dz = enemy.z - p.z,
        d = Math.hypot(dx, dz) || 1;
      this.enemiesInRadius(p.x, p.z, range, targets);
      const damage = (T.flameDamage + T.flamePerLevel * this.level) * (r.wings ? T.wingsDamage : 1);
      for (const e of targets) {
        if (
          !e.targetable ||
          skipPlayer(e) ||
          !this.walls.segmentClear(p.x, p.z, e.x, e.z) ||
          !petCone(e.x - p.x, e.z - p.z, dx / d, dz / d, range + e.radius)
        )
          continue;
        this.damage(e, damage, FIRE, h);
      }
      // A small, legible fan. All machines receive the same three bursts.
      const angle = Math.atan2(dz, dx);
      for (let k = -1; k <= 1; k++) {
        const x = p.x + Math.cos(angle + k * 0.45) * range * 0.55;
        const z = p.z + Math.sin(angle + k * 0.45) * range * 0.55;
        this.vfx.burst(x, 0.9, z, {
          count: 5,
          color: '#ef7d57',
          color2: '#ffcd75',
          speed: [1, 3],
          size: [0.15, 0.3],
          life: [0.2, 0.4],
          up: 1,
        });
      }
      cue(this, h, 'flame');
    }
  }
  if (r.steal && s.actionT <= 0) {
    s.actionT = rankOf(T.stealEvery, r.steal);
    let target: Enemy | null = null,
      best = T.stealRange ** 2;
    if (s.stolen.size < T.stealPerStage)
      for (const e of this.enemies.list) {
        if (!e.targetable || e.hp <= 0 || skipPlayer(e) || s.stolen.has(e.uid)) continue;
        const d = (e.x - p.x) ** 2 + (e.z - p.z) ** 2;
        if (d < best) {
          target = e;
          best = d;
        }
      }
    if (target) {
      s.stolen.add(target.uid);
      h.gold++;
      this.damage(target, 8 + this.level * 2, HIT, h);
      this.vfx.num(p.x, 2.4, p.z, '+1', 'score');
      this.vfx.star(target.x, 1, target.z, 0.9, '#ffcd75', 0.2);
      cue(this, h, 'swipe');
    }
  }
  if (r.split) {
    if (s.actionT <= 0) {
      s.actionT = T.splitEvery;
      s.splitT = T.splitTime;
      s.splitTick = 0;
      this.vfx.ring(p.x, p.z, 1, 4, '#a7f070', 0.3);
      cue(this, h, 'gulp');
    }
    s.splitT = Math.max(0, s.splitT - dt);
    if (s.splitT > 0 && (s.splitTick -= dt) <= 0) {
      s.splitTick = T.splitTick;
      for (let k = 0; k < 2; k++) {
        const e = this.nearestEnemy(p.x + (k ? 1 : -1), p.z, 7, skipPlayer);
        if (!e) continue;
        this.damage(e, (T.splitDamage + T.splitPerLevel * this.level) * r.split, HIT, h);
        this.vfx.star(e.x, 0.8, e.z, 0.7, '#a7f070', 0.15);
      }
    }
  }
  if (r.turret) {
    if (s.actionT <= 0) {
      s.actionT = T.turretEvery;
      s.turretT = T.turretTime;
      s.turretTick = 0;
      s.turretX = p.x;
      s.turretZ = p.z;
      this.vfx.ring(p.x, p.z, 0.4, 3, '#41a6f6', 0.3);
      cue(this, h, 'plant');
    }
    s.turretT = Math.max(0, s.turretT - dt);
    if (s.turretT > 0 && (s.turretTick -= dt) <= 0) {
      s.turretTick = rankOf(T.turretTick, r.turret);
      const e = this.nearestEnemy(s.turretX, s.turretZ, T.turretRange, skipPlayer);
      if (e && this.walls.segmentClear(s.turretX, s.turretZ, e.x, e.z)) {
        this.damage(e, T.turretDamage + T.turretPerLevel * this.level, HIT, h);
        this.vfx.star(s.turretX, 0.65, s.turretZ, 0.5, '#ffcd75', 0.12);
        this.vfx.star(e.x, 0.8, e.z, 0.6, '#41a6f6', 0.12);
        cue(this, h, 'turret', s.turretX, s.turretZ);
      }
    }
  }
}

/** Local scouting panel follows UI SCALE by living inside the existing pet panel. */
export function renderPets2(this: Game, dt: number): void {
  renderPetScout(this, dt);
}

/** Night vision is a steady cyan lantern, using the existing quality light budget. */
export function pets2Light(g: Game, picker: LightPicker, night: number): void {
  const h = g.hero;
  if (!h || h.left || h.player.dead || h.petState.ranks.scout < 2 || night <= 0.01) return;
  picker.add(h.player.x, 3, h.player.z, T.nightRadius, 0.45, 0.95, 1, night * 0.9, 1100);
}
