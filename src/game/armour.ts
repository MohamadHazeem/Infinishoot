import { armourTuning as tuning, countersArmour, armourOf } from '../data/armour';
import type { Tag } from '../data/tags';
import { isRightClick } from '../data/weapons';
import type { Enemy } from './enemies';
import { BULLET_KINDS, type Game } from './game';
import { lagOut, lagSteps, rewindEnemy } from './systems/netcode';
import type { Hero } from './hero';
import type { DamageOpts } from './weapons';

/** Shots and beams supply a point on the incoming line. Intersect that line with
 * the shoulder socket in the simulation plane; a large body hitbox alone isn't a core hit. */
export function hitsCore(e: Enemy, o: DamageOpts, centre: { x: number; z: number } = e): boolean {
  if (o.hx === undefined || o.hz === undefined || o.dirX === undefined || o.dirZ === undefined) return false;
  const lengthSq = o.dirX * o.dirX + o.dirZ * o.dirZ;
  if (lengthSq < 1e-8) return false;
  const offset = e.radius * tuning.coreOffset;
  const x = centre.x + Math.cos(e.facing) * offset - o.hx;
  const z = centre.z - Math.sin(e.facing) * offset - o.hz;
  const cross = x * o.dirZ - z * o.dirX;
  return cross * cross <= lengthSq * (e.radius * tuning.coreRadius) ** 2;
}

export function armourFactor(e: Enemy, tags: readonly Tag[], o: DamageOpts, centre: { x: number; z: number } = e): number {
  const armour = armourOf(e.def, e.elite);
  let factor = 1;
  if (armour === 'plated') {
    const dx = o.dirX ?? 0, dz = o.dirZ ?? 0;
    const length = Math.hypot(dx, dz);
    const face = length ? -(dx * Math.sin(e.facing) + dz * Math.cos(e.facing)) / length : 0;
    const counter = countersArmour(tags, armour);
    if (face >= tuning.arcCos && !counter) factor = tuning.front;
    else if (face <= -tuning.arcCos) factor = tuning.rear;
    else if (!counter && tags.includes('projectile')) factor = tuning.projectile;
    if (counter) factor *= tuning.counter;
  } else if (armour === 'ethereal') factor = countersArmour(tags, armour) ? tuning.counter : tuning.physical;
  else if (armour === 'swarm' && countersArmour(tags, armour)) factor = tuning.counter;
  if (e.def.weakPoint === 'core' && hitsCore(e, o, centre)) factor *= tuning.core;
  return factor;
}

/** Shielders already have a frontal arc and shelter units behind them. A secondary
 * hit opens that arc for the whole team. Their otherwise unused family state and
 * tick timer survive rewind; the family state is also in the enemy snapshot. */
export function routeArmour(g: Game, e: Enemy, tags: readonly Tag[], o: DamageOpts, by: Hero): number {
  if (e.def.armour === 'shielded' && isRightClick(o.source)) {
    if (e.familyState === 0) g.breakShield(e);
    e.familyState = 1;
    e.tickT = tuning.recharge;
  }
  const guard = e.def.armour === 'shielded' && e.familyState === 1 ? 1 : g.guardMul(e, o, by);
  // A remote pooled bullet collides with the historical body position. Use the
  // same host-clamped history for its socket. Hitscan uses the current body.
  if (g.role === 'host' && by.remote && e.def.weakPoint === 'core' && o.hx !== undefined) {
    const steps = lagSteps(g, by.index);
    if (steps > 0) for (const kind of BULLET_KINDS) {
      if (kind.source !== o.source) continue;
      if (rewindEnemy(g, e, steps)) return armourFactor(e, tags, o, lagOut) * guard;
      break;
    }
  }
  return armourFactor(e, tags, o) * guard;
}
