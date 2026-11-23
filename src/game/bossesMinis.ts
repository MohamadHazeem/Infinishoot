import type { Enemy, EnemyCtx } from './enemies';
import { enter, lockOn } from './bosses';

/** Loop-one midbosses use short phrases between the horde's ordinary attacks. */
export function miniStep(e: Enemy, dt: number, ctx: EnemyCtx, nx: number, nz: number, speed: number): boolean {
  const rex = e.def.id === 'rexling';
  const princess = e.def.id === 'princess';
  const prince = !rex && !princess;
  if (e.state === 'recover') {
    e.vx = e.vz = 0;
    if (e.t <= 0) {
      e.state = 'move';
      e.timerA = e.phase === 1 ? 1.5 : 1;
      e.move = '';
    }
    return false;
  }
  if (e.state === 'move') {
    // Rex flanks before a single rush. The two heirs circle in opposite directions.
    const side = e.strafe * (e.step % 2 ? -1 : 1);
    e.vx = (nx * 0.45 - nz * side) * speed;
    e.vz = (nz * 0.45 + nx * side) * speed;
    e.facing = Math.atan2(nx, nz);
    if (princess) e.hopY = 1.1;
    if ((e.timerA -= dt) > 0 || !ctx.targetAlive) return false;
    lockOn(e, nx, nz);
    e.targetX = ctx.target.x;
    e.targetZ = ctx.target.z;
    e.step++;
    e.action = rex ? 'charge' : prince ? 'volley' : 'rain';
    e.move = rex ? 'switchback' : prince ? (e.step % 2 ? 'skipFork' : 'skipCentre') : 'petals';
    e.burst = rex && e.phase === 2 ? 2 : 1;
    e.vx = e.vz = 0;
    enter(e, 'windup', 0.85, -6, ctx);
    return false;
  }
  if (e.state === 'windup') {
    e.vx = e.vz = 0;
    if (e.t > 0) return false;
    if (rex) {
      // The second charge retraces the first ground line after another full tell.
      enter(e, 'attack', 0.5, 8);
      return true;
    }
    const a = Math.atan2(e.lungeZ, e.lungeX);
    if (prince) {
      // Alternating fork / centre shot. Each fork leaves a safe centre lane.
      const fork = e.move === 'skipFork';
      for (let i = 0; i < (fork ? 2 : 1); i++) {
        const angle = a + (fork ? (i ? 0.3 : -0.3) : 0);
        ctx.fireBullet(e, Math.cos(angle), Math.sin(angle), 9, 12);
        if (e.phase === 2) ctx.fireBullet(e, Math.cos(angle), Math.sin(angle), 5.5, 12);
      }
    } else {
      // A flower of separately marked impacts. The centre stays open until the late bloom.
      for (let i = 0; i < 3; i++) {
        const angle = a + i * Math.PI * 2 / 3;
        ctx.strike(e.targetX + 3.4 * Math.cos(angle), e.targetZ + 3.4 * Math.sin(angle), 1.5, 1 + i * 0.18, 12);
      }
      if (e.phase === 2) ctx.strike(e.targetX, e.targetZ, 1.4, 2, 12);
    }
    enter(e, 'recover', 0.8, 5);
    return false;
  }
  e.vx = e.lungeX * 24;
  e.vz = e.lungeZ * 24;
  if (e.t <= 0) {
    e.vx = e.vz = 0;
    if (--e.burst > 0) {
      lockOn(e, -e.lungeX, -e.lungeZ);
      enter(e, 'windup', 0.9, -6, ctx);
    } else enter(e, 'recover', 1.1, 5);
  }
  return true;
}
