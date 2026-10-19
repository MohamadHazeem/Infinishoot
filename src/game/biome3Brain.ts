import type { Enemy, EnemyCtx } from './enemies';

export const biome3Tuning = {
  windup: 0.9,
  recover: 1.25,
  tentacleDelay: 1.1,
  tentacleRadius: 1.6,
  tentacleDamage: 17,
  inkTime: 1.35,
  whirlTime: 3.5,
  whirlRadius: 15,
  whirlPush: 1.35,
  jellyInterval: 3.6,
  jellyBullets: 10,
};
export const biome3Force = { move: '' };
export type Biome3Move = 'frosting' | 'candles' | 'summon' | 'tentacles' | 'ink' | 'whirlpool';
export interface Biome3Api {
  frosting(e: Enemy, delay: number): void;
  tentacle(e: Enemy, x: number, z: number): void;
  ink(e: Enemy): void;
  whirlpool(e: Enemy): void;
}
const CAKE_MOVES: readonly Biome3Move[] = ['frosting', 'candles', 'summon'];
const CAKE_FINAL: readonly Biome3Move[] = ['candles', 'frosting', 'candles', 'summon'];
const KRAKEN_MOVES: readonly Biome3Move[] = ['tentacles', 'summon'];
const KRAKEN_INK: readonly Biome3Move[] = ['tentacles', 'ink', 'tentacles'];
const KRAKEN_FINAL: readonly Biome3Move[] = ['whirlpool', 'tentacles', 'ink', 'tentacles'];
export function biome3Attack(kind: string, phase: number, step: number, mini = false): Biome3Move {
  const moves =
    kind === 'cake'
      ? phase >= 3 && !mini
        ? CAKE_FINAL
        : CAKE_MOVES
      : phase >= 3 && !mini
        ? KRAKEN_FINAL
        : phase >= 2
          ? KRAKEN_INK
          : KRAKEN_MOVES;
  return moves[step % moves.length];
}
const allowed = new Set(['frosting', 'candles', 'summon', 'tentacles', 'ink', 'whirlpool']);
/** Boss state already rides the enemy + boss snapshot; hazards use the lane's field. */
export function biome3Brain(
  e: Enemy,
  dt: number,
  ctx: EnemyCtx,
  nx: number,
  nz: number,
  dist: number,
  speed: number,
): boolean {
  e.facing = Math.atan2(nx, nz);
  const T = biome3Tuning;
  if (e.state === 'move') {
    const k = dist > 7 ? 0.7 : dist < 4 ? -0.4 : 0;
    e.vx = nx * speed * k;
    e.vz = nz * speed * k;
    e.timerA -= dt;
    if (e.timerA > 0 || !ctx.targetAlive) return false;
    e.state = 'windup';
    e.t = T.windup;
    e.targetX = ctx.target.x;
    e.targetZ = ctx.target.z;
    ctx.onWindup(e);
  }
  e.vx = e.vz = 0;
  if (e.state === 'recover') {
    if (e.t <= 0) {
      e.state = 'move';
      e.timerA = 0.65;
    }
    return false;
  }
  if (e.state !== 'windup' || e.t > 0) return false;
  const move = allowed.has(biome3Force.move)
    ? (biome3Force.move as Biome3Move)
    : biome3Attack(e.def.behavior, e.phase, e.step++, !!e.def.miniboss);
  const ph = e.phase;
  if (move === 'frosting') {
    ctx.boss?.biome3?.frosting(e, 0.2);
    if (ph >= 2 && !e.def.miniboss) ctx.boss?.biome3?.frosting(e, 0.9);
  } else if (move === 'candles') {
    const a = Math.atan2(nz, nx),
      n = 5 + ph * 2;
    for (let i = 0; i < n; i++) {
      const ang = a + (i - (n - 1) / 2) * 0.2;
      ctx.boss?.shot(e, Math.cos(ang), Math.sin(ang), 8.5 + ph, 12, '#ff3df0', 4, 0.3);
    }
  } else if (move === 'summon') {
    const n = e.def.miniboss ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const a = (i * Math.PI * 2) / n;
      const x = e.x + Math.cos(a) * 3,
        z = e.z + Math.sin(a) * 3;
      if (ctx.boss?.open(x, z, 0.8))
        ctx.spawnChild(e.def.behavior === 'cake' ? 'gummy' : 'jellyfish', x, z, e);
    }
  } else if (move === 'tentacles') {
    ctx.boss?.biome3?.tentacle(e, e.targetX, e.targetZ);
    const n = e.def.miniboss ? 2 : 3 + ph;
    for (let i = 0; i < n; i++) {
      const a = (i * Math.PI * 2) / n + e.step * 0.6;
      ctx.boss?.biome3?.tentacle(e, e.targetX + Math.cos(a) * 4.5, e.targetZ + Math.sin(a) * 4.5);
    }
  } else if (move === 'ink') ctx.boss?.biome3?.ink(e);
  else ctx.boss?.biome3?.whirlpool(e);
  e.state = 'recover';
  e.t = T.recover / (1 + (ph - 1) * 0.15);
  e.squash(9);
  return false;
}
/** Slow drift, clear wind-up, then a radial zap with roomy walking gaps. */
export function jellyfishBrain(
  e: Enemy,
  dt: number,
  ctx: EnemyCtx,
  nx: number,
  nz: number,
  dist: number,
  speed: number,
): void {
  e.hopY = 0.45;
  e.facing = Math.atan2(nx, nz);
  if (e.state === 'windup') {
    e.vx = e.vz = 0;
    if (e.t > 0) return;
    for (let i = 0; i < biome3Tuning.jellyBullets; i++) {
      const a = (i * Math.PI * 2) / biome3Tuning.jellyBullets + e.uid * 0.37;
      ctx.fireBullet(e, Math.cos(a), Math.sin(a), 5.5, 9);
    }
    e.state = 'move';
    e.timerA = biome3Tuning.jellyInterval;
  }
  const k = dist > 7 ? 0.7 : dist < 5 ? -0.35 : 0;
  e.vx = (nx * k - nz * 0.3) * speed;
  e.vz = (nz * k + nx * 0.3) * speed;
  if ((e.timerA -= dt) <= 0 && ctx.targetAlive) {
    e.state = 'windup';
    e.t = 0.9;
    ctx.onWindup(e);
  }
}
