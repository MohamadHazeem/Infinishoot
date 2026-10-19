/** Burrowers, weapon-copying bots and the mid-stage Swarm Queen. Host simulation only. */
import { familyTuning } from '../../data/enemies';
import type { Enemy, EnemyCtx } from '../enemies';

export const MIRROR_ORB_KIND = 250;
export const COPY_IDS = ['buster', 'scatter', 'laser', 'orb', 'rail'] as const;
export function copyKind(id: string): number { return Math.max(0, COPY_IDS.indexOf(id as typeof COPY_IDS[number])); }
export function copyDamage(damage: number): number { return Math.max(1, Math.min(familyTuning.mirrorMaxDamage, damage * familyTuning.mirrorDamage)); }
export function copyFan(i: number, count: number, arc: number): number { return count > 1 ? (i / (count - 1) - 0.5) * arc : 0; }
export function familyCanHit(e: Enemy, explosive: boolean): boolean { return !e.underground || explosive; }

export interface FamilyApi {
  cue(e: Enemy, name: 'burrow' | 'mirrorCopy' | 'swarmScreech' | 'return'): void;
  scan(e: Enemy): void;
  fire(e: Enemy): void;
  wall(e: Enemy): void;
  eggs(e: Enemy): void;
  retire(e: Enemy): void;
}

function enter(e: Enemy, state: Enemy['state'], seconds: number, family = 0): void {
  e.state = state;
  e.t = seconds;
  e.familyState = family;
  e.vx = e.vz = 0;
}

/** Writes desired velocity into e.vx/vz, no temporary vectors or arrays. */
export function updateFamily(e: Enemy, dt: number, ctx: EnemyCtx, nx: number, nz: number, dist: number, speed: number): void {
  const api = ctx.family;
  e.vx = e.vz = 0;
  e.copyFlash = Math.max(0, e.copyFlash - dt);
  const move = e.def.behavior;
  if (move === 'burrower') {
    const p = e.def.burrow!;
    e.facing = Math.atan2(nx, nz);
    if (e.familyState === 1) {
      e.vx = nx * Math.min(speed, dist / Math.max(dt, 0.001));
      e.vz = nz * Math.min(speed, dist / Math.max(dt, 0.001));
      if ((dist < 1 || e.t <= 0) && ctx.targetAlive) {
        // Stop where the mound reached: no teleport and no tracking during the warning.
        enter(e, 'windup', p.warn, 2);
        e.targetX = e.x;
        e.targetZ = e.z;
        api?.cue(e, 'burrow');
      }
    } else if (e.familyState === 2) {
      e.x = e.targetX; e.z = e.targetZ;
      e.kx = e.kz = 0; // explosions may hurt it but cannot drag an eruption off its warning ring
      if (e.t <= 0) {
        enter(e, 'attack', 0.3);
        ctx.land(e, p.radius * e.scale, p.damage);
        e.squash(8);
      }
    } else if (e.state === 'attack' && e.t <= 0) enter(e, 'recover', p.exposed);
    else if ((e.state === 'recover' && e.t <= 0) || (e.state === 'move' && (e.timerA -= dt) <= 0)) {
      if (ctx.targetAlive) {
        enter(e, 'move', p.underground, 1);
        // Existing burns/freezes cannot reveal or stun-lock a buried digger.
        e.frozen = e.burnT = e.shockT = e.slowT = 0;
        api?.cue(e, 'burrow');
      }
    } else if (e.state === 'move') { e.vx = nx * speed * 0.5; e.vz = nz * speed * 0.5; }
    return;
  }
  if (move === 'mirror') {
    const p = e.def.mirror!;
    if (e.state === 'move') {
      const radial = dist > p.keepDistance + 1 ? 1 : dist < p.keepDistance - 2 ? -1 : 0;
      e.vx = (nx * radial - nz * e.strafe * 0.35) * speed;
      e.vz = (nz * radial + nx * e.strafe * 0.35) * speed;
      e.facing = Math.atan2(nx, nz);
      if ((e.timerA -= dt) <= 0 && ctx.targetAlive && dist < 18) {
        api?.scan(e);
        enter(e, 'windup', p.scan, 1);
        api?.cue(e, 'mirrorCopy');
      }
    } else if (e.state === 'windup') {
      if (e.t > 0.4) { e.lungeX = nx; e.lungeZ = nz; e.facing = Math.atan2(nx, nz); }
      if (e.t <= 0) { enter(e, 'attack', p.copy, 2); e.timerB = 0; }
    } else if (e.state === 'attack') {
      if (e.t <= 0) { enter(e, 'recover', 0.65); e.copyFlash = 0; }
      else if ((e.timerB -= dt) <= 0) { api?.fire(e); e.timerB += e.copyInterval; e.copyFlash = e.copyKind === 2 ? e.copyInterval + 0.03 : 0.12; }
    } else if (e.t <= 0) { enter(e, 'move', 0); e.timerA = p.cooldown; }
    return;
  }
  if (move === 'egg') {
    e.t = Math.max(0, e.timerA -= dt);
    if (e.timerA <= 0) {
      for (let i = 0; i < familyTuning.hatchCount; i++) {
        const a = i * Math.PI * 2 / familyTuning.hatchCount;
        ctx.spawnChild('swarmer', e.x + Math.cos(a), e.z + Math.sin(a), e);
      }
      api?.retire(e);
    }
    return;
  }
  if (move === 'swarmwall') {
    e.timerA -= dt;
    if (e.timerA <= 0) { e.vx = nx * speed; e.vz = nz * speed; e.facing = Math.atan2(nx, nz); }
    return;
  }
  if (move !== 'swarmqueen') return;
  const p = familyTuning;
  if (!e.familyFled && e.hp <= e.maxHp * p.queenFleeAt) {
    e.familyFled = true;
    enter(e, 'recover', p.queenFleeTime, 3);
    api?.cue(e, 'return');
  }
  if (e.familyState === 3) {
    // Retreat remains damageable. Clamp direction at the edge so she cannot escape the arena.
    const lim = ctx.bounds() - 4;
    e.vx = Math.abs(e.x) > lim ? -Math.sign(e.x) * speed : -nx * speed * 2;
    e.vz = Math.abs(e.z) > lim ? -Math.sign(e.z) * speed : -nz * speed * 2;
    e.facing = Math.atan2(e.vx, e.vz);
    if (e.t <= 0) { enter(e, 'recover', p.queenReturnTime, 4); api?.cue(e, 'swarmScreech'); }
    return;
  }
  if (e.familyState === 4) {
    e.vx = nx * speed * 2; e.vz = nz * speed * 2;
    if (e.t <= 0) { enter(e, 'move', 0); e.timerA = 0; }
    return;
  }
  e.facing = Math.atan2(nx, nz);
  if (e.state === 'move') {
    const radial = dist > 9 ? 1 : dist < 6 ? -1 : 0;
    e.vx = (nx * radial - nz * e.strafe * 0.6) * speed;
    e.vz = (nz * radial + nx * e.strafe * 0.6) * speed;
    if ((e.timerA -= dt) <= 0 && ctx.targetAlive) {
      const wall = (e.step++ % 2) === 0;
      enter(e, 'windup', p.queenWindup, wall ? 1 : 2);
      // Alternate axis-aligned walls that span the arena, three metres beyond the hero.
      e.lungeX = e.step % 4 === 1 ? 1 : 0;
      e.lungeZ = 1 - e.lungeX;
      e.targetX = Math.max(-ctx.bounds() + 5, Math.min(ctx.bounds() - 5, ctx.target.x + nx * 3));
      e.targetZ = Math.max(-ctx.bounds() + 5, Math.min(ctx.bounds() - 5, ctx.target.z + nz * 3));
      api?.cue(e, 'swarmScreech');
    }
  } else if (e.state === 'windup' && e.t <= 0) {
    if (e.familyState === 1) api?.wall(e); else api?.eggs(e);
    enter(e, 'recover', 0.8);
  } else if (e.state === 'recover' && e.t <= 0) { enter(e, 'move', 0); e.timerA = p.queenCooldown; }
}

/** Safe ray length up to the first wall; shared by hostile beam damage and local drawing. */
export function beamReach(x: number, z: number, dx: number, dz: number, range: number, boxes: EnemyCtx['colliders']): number {
  let reach = range;
  for (const b of boxes) {
    let lo = 0, hi = reach;
    for (let axis = 0; axis < 2; axis++) {
      const pos = axis ? z : x, dir = axis ? dz : dx;
      const min = axis ? b.minZ : b.minX, max = axis ? b.maxZ : b.maxX;
      if (Math.abs(dir) < 1e-8) { if (pos < min || pos > max) hi = -1; }
      else { const a = (min - pos) / dir, c = (max - pos) / dir; lo = Math.max(lo, Math.min(a, c)); hi = Math.min(hi, Math.max(a, c)); }
    }
    if (hi >= lo) reach = Math.min(reach, lo);
  }
  return reach;
}

