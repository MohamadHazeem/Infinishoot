import type { Enemy } from './enemies';
import type { Game } from './game';
import type { BulletSpawn, Bullets } from './bullets';
import { patternTuning as T, Shot, shotFor, type ShotKind } from '../data/patterns';

const lastShot = new WeakMap<Enemy, number>();

/** Replace one existing round per volley. Keep close-range and additional fan rounds ordinary. */
export function patternedShot(
  g: Game,
  e: Enemy,
  dx: number,
  dz: number,
  speed: number,
  damage: number,
): boolean {
  const kind = shotFor(g.stage, e.def.shoot?.threat);
  if (e.state !== 'windup' && e.state !== 'attack') return false;
  if (!kind || !g.authority || g.mode !== 'fight' || g.bullets.simTime < (lastShot.get(e) ?? 0))
    return false;
  for (const h of g.heroes) {
    if (!h.left && !h.player.dead && Math.hypot(h.player.x - e.x, h.player.z - e.z) < T.minRange)
      return false;
  }
  lastShot.set(e, g.bullets.simTime + T.shotInterval);
  spawnPattern(
    g.bullets,
    kind,
    e.x + dx * (e.radius + 0.2),
    e.z + dz * (e.radius + 0.2),
    dx,
    dz,
    speed * (g.meta.has('bullets') ? 1.35 : 1) * (g.meta.rule('barrage') ? 2 : 1),
    damage * e.dmgMul,
  );
  g.vfx.sound('enemyShoot', e.x, e.z);
  return true;
}

const round: BulletSpawn = {
  x: 0,
  z: 0,
  dirX: 0,
  dirZ: 0,
  speed: 0,
  damage: 0,
  life: T.life,
  radius: 0.26,
  team: 1,
  width: 0.95,
  length: 0.95,
  color: '#ff3df0',
  knockback: 6,
};

export function spawnPattern(
  b: Bullets,
  kind: ShotKind,
  x: number,
  z: number,
  dx: number,
  dz: number,
  speed: number,
  damage: number,
): void {
  round.x = x;
  round.z = z;
  round.dirX = dx;
  round.dirZ = dz;
  round.speed = Math.min(T.maxSpeed, speed);
  round.damage = damage;
  round.life = T.life;
  round.shape = kind;
  round.bounce = kind === Shot.Bounce ? 1 : 0;
  round.width = round.length = kind ? 1.15 : 0.52;
  // Enemy boomerangs store the locked outbound heading in the pooled steering field (also recorded by rewind).
  round.homing = kind === Shot.Return ? Math.atan2(dz, dx) : 0;
  b.spawn(round);
}

/** Held rounds keep their bearing on the wire. Both peers derive the motionless portion from remaining life. */
export function flightTime(shape: number, life: number, dt: number): number {
  return shape === Shot.Delayed ? Math.max(0, dt - Math.max(0, life - (T.life - T.hang))) : dt;
}

export function steerPattern(b: Bullets, i: number, dt: number): void {
  const k = b.shape[i],
    age = b.age[i];
  if (k === Shot.Curve) {
    const a = T.curveRate * dt,
      c = Math.cos(a),
      s = Math.sin(a),
      vx = b.vx[i],
      vz = b.vz[i];
    b.vx[i] = vx * c - vz * s;
    b.vz[i] = vx * s + vz * c;
  } else if (k === Shot.Return) {
    // Brake through zero, then accelerate backwards along the locked bearing.
    const speed =
      T.maxSpeed * Math.max(-1, Math.min(1, 1 - ((age - T.turnAt) * 2) / T.returnBrake));
    b.vx[i] = Math.cos(b.homing[i]) * speed;
    b.vz[i] = Math.sin(b.homing[i]) * speed;
  }
}

/** The parent is removed before spawning, so saturation can only reduce the fan. */
export function forkShot(b: Bullets, i: number): void {
  const a = Math.atan2(b.vz[i], b.vx[i]),
    x = b.x[i],
    z = b.z[i],
    damage = b.damage[i],
    parent = b.uid[i];
  b.kill(i);
  for (let side = -1; side <= 1; side += 2) {
    const angle = a + side * T.forkAngle, slot = b.count;
    spawnPattern(b, Shot.Plain, x, z, Math.cos(angle), Math.sin(angle), T.splitSpeed, damage * 0.7);
    if (b.count > slot) b.parentUid[slot] = parent;
  }
}

/** Test the two axes separately. On a diagonal corner both components reverse. */
export function ricochet(g: Game, i: number): boolean {
  const b = g.bullets;
  if (b.team[i] !== 1 || b.shape[i] !== Shot.Bounce || !b.bounce[i]) return false;
  const px = b.px[i],
    pz = b.pz[i],
    r = b.radius[i];
  if (g.walls.hitSolid(px, pz, r)) return false;
  const blockX = g.walls.hitSolid(b.x[i], pz, r),
    blockZ = g.walls.hitSolid(px, b.z[i], r);
  if (blockX || !blockZ) b.vx[i] *= -1;
  if (blockZ || !blockX) b.vz[i] *= -1;
  b.x[i] = px;
  b.z[i] = pz;
  b.bounce[i]--;
  return true;
}

/** Deterministic QA composition; without threathold the five rounds and zone play normally. */
export function previewThreats(
  g: Game,
  kind: import('../data/patterns').ZoneKind,
  hold: boolean,
): void {
  const p = g.player;
  for (const shot of [Shot.Delayed, Shot.Bounce, Shot.Curve, Shot.Split, Shot.Return]) {
    spawnPattern(g.bullets, shot, p.x + (shot - 3) * 1.6, p.z + 2.4, 0, 1, 8, 8);
  }
  g.bossField.denial.place(kind, p.x - 3.2, p.z - 1.3, 0, 8, 'Ground strike');
  if (hold) g.juice.hitStop = 25;
}
