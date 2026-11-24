import type { Game } from './game';
import { Shot, patternTuning as T, zoneTuning } from '../data/patterns';
import { flightTime } from './enemyBullets';
import { zoneClearance } from './denial';
import { playerTuning } from './player';

type Movement = { mx: number; mz: number };
const samples = [0.18, 0.36, 0.54] as const;
const candidates = 9;
const risk = new Float32Array(candidates);
const ux = new Float32Array(candidates),
  uz = new Float32Array(candidates);
for (let k = 1; k < candidates; k++) {
  const a = ((k - 1) * Math.PI) / 4;
  ux[k] = Math.cos(a);
  uz[k] = Math.sin(a);
}

/** Gate 2 runner hook. Only observed world state; change movement if its current path enters danger. */
export function dodgeThreats(g: Game, move: Movement): void {
  if (g.mode !== 'fight') return;
  const b = g.bullets,
    p = g.player;
  const length = Math.hypot(move.mx, move.mz) || 1;
  ux[0] = move.mx / length;
  uz[0] = move.mz / length;
  const speed = playerTuning.maxSpeed * p.stats.moveSpeedMul;
  risk.fill(0);
  for (const q of g.bossField?.denial.slots ?? []) {
    if (q.age < 0 || Math.abs(q.x - p.x) > 11 || Math.abs(q.z - p.z) > 11) continue;
    for (const t of samples) {
      const age = q.age + t;
      if (
        age < zoneTuning.tell[q.kind] ||
        age > zoneTuning.tell[q.kind] + zoneTuning.duration[q.kind]
      )
        continue;
      for (let k = 0; k < candidates; k++) {
        const d = zoneClearance(q, p.x + ux[k] * speed * t, p.z + uz[k] * speed * t, age);
        risk[k] += Math.max(0, p.radius + 0.4 - d);
      }
    }
  }
  for (let i = 0; i < b.count; i++) {
    const kind = b.shape[i];
    if (b.team[i] !== 1 || !kind || Math.abs(p.x - b.x[i]) > 9 || Math.abs(p.z - b.z[i]) > 9)
      continue;
    let x = b.x[i],
      z = b.z[i],
      vx = b.vx[i],
      vz = b.vz[i],
      last = 0,
      bounce = b.bounce[i];
    const age = T.life - b.life[i],
      angle = Math.atan2(vz, vx);
    for (const t of samples) {
      const dt = t - last;
      if (b.life[i] < t) break;
      let flight = dt;
      if (kind === Shot.Delayed) flight = flightTime(kind, b.life[i] - last, dt);
      if (kind === Shot.Curve) {
        const a = angle + T.curveRate * (last + dt * 0.5),
          sp = Math.hypot(vx, vz);
        vx = Math.cos(a) * sp;
        vz = Math.sin(a) * sp;
      }
      if (kind === Shot.Return) {
        const sp =
          T.maxSpeed *
          Math.max(-1, Math.min(1, 1 - ((age + last + dt * 0.5 - T.turnAt) * 2) / T.returnBrake));
        // Before reversal velocity points along launch bearing; after reversal it points back.
        const heading = angle + (age > T.turnAt + T.returnBrake / 2 ? Math.PI : 0);
        vx = Math.cos(heading) * sp;
        vz = Math.sin(heading) * sp;
      }
      if (
        kind === Shot.Bounce &&
        bounce &&
        g.walls.hitSolid(x + vx * dt, z + vz * dt, b.radius[i])
      ) {
        const blockX = g.walls.hitSolid(x + vx * dt, z, b.radius[i]),
          blockZ = g.walls.hitSolid(x, z + vz * dt, b.radius[i]);
        if (blockX || !blockZ) vx = -vx;
        if (blockZ || !blockX) vz = -vz;
        bounce = 0;
      }
      const fork = kind === Shot.Split ? Math.max(0, t - Math.max(0, T.splitAt - age)) : 0;
      if (!fork) {
        x += vx * flight;
        z += vz * flight;
      } else if (age + last < T.splitAt) {
        x += vx * (T.splitAt - age - last);
        z += vz * (T.splitAt - age - last);
      }
      if (kind !== Shot.Delayed || age + t >= T.hang) {
        for (let k = 0; k < candidates; k++) {
          const dx = p.x + ux[k] * speed * t - x,
            dz = p.z + uz[k] * speed * t - z;
          let d = Math.hypot(dx, dz);
          if (fork) {
            const dist = T.splitSpeed * fork;
            d = Math.min(
              Math.hypot(
                dx - dist * Math.cos(angle - T.forkAngle),
                dz - dist * Math.sin(angle - T.forkAngle),
              ),
              Math.hypot(
                dx - dist * Math.cos(angle + T.forkAngle),
                dz - dist * Math.sin(angle + T.forkAngle),
              ),
            );
          }
          risk[k] += Math.max(0, p.radius + b.radius[i] + 0.5 - d);
        }
      }
      last = t;
    }
  }
  if (risk[0] === 0) return;
  let best = 0,
    lowest = risk[0];
  for (let k = 1; k < candidates; k++) {
    const cost = risk[k] + 0.12 * (1 - ux[k] * ux[0] - uz[k] * uz[0]);
    if (
      cost >= lowest ||
      !g.walls.segmentClear(
        p.x,
        p.z,
        p.x + ux[k] * speed * 0.4,
        p.z + uz[k] * speed * 0.4,
        p.radius,
      )
    )
      continue;
    best = k;
    lowest = cost;
  }
  if (best) {
    move.mx = ux[best];
    move.mz = uz[best];
  }
}
