import * as THREE from 'three';
import type { EnemyDef } from '../data/enemies';
import type { Enemy } from './enemies';
import { GAIT_FREQ, gaitOf, toLocal, type Gait } from './animMath';

/**
 * Enemy body language, computed locally in render from synced state (no
 * netcode): gait per model (hop, flutter, trundle, stomp, waddle, jiggle,
 * pulse, hover, glide), lean into movement and away from knockback, wind-up
 * poses that sell the telegraph (rear back, crouch, shake), hit wobble, and
 * flung corpses that tumble away (drawn into the same instanced batches).
 */
export const enemyAnimTuning = {
  /** Overall gait amplitude (0 = stiff). */
  gait: 1,
  /** Max lean (radians) into movement / away from knockback. */
  leanMax: 0.45,
  hitWobble: 1,
  /** Corpses: launch speed, upward speed, gravity, tumble rate, life (seconds). */
  flingSpeed: 7,
  flingUp: 7,
  gravity: 30,
  tumble: 13,
  corpseLife: 0.75,
};

/** Per-enemy cosmetic animation state (one per pooled Enemy, reused). */
export class EnemyAnim {
  uid = -1;
  ph = 0;
  rx = 0;
  rz = 0;
  move = 0;
  leanF = 0;
  leanS = 0;
  wind = 0;
  wob = 0;
  flashSeen = false;
  gait: Gait = 'hop';
}

/** Pose written by poseEnemy: offsets and multipliers on top of the base transform. */
export interface EnemyPose {
  y: number;
  ox: number;
  oz: number;
  sx: number;
  sy: number;
  sz: number;
  pitch: number;
  roll: number;
  yaw: number;
}

const loc = { f: 0, s: 0 };
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Fill `o` with this frame's pose for `e` drawn at (x, z). `dt` is the frame time (0 while frozen). */
export function poseEnemy(e: Enemy, a: EnemyAnim, x: number, z: number, dt: number, time: number, o: EnemyPose): void {
  o.y = o.ox = o.oz = o.pitch = o.roll = o.yaw = 0;
  o.sx = o.sy = o.sz = 1;
  const def = e.def;
  if (a.uid !== e.uid) {
    a.uid = e.uid;
    a.ph = (e.uid * 1.7) % (Math.PI * 2);
    a.rx = x;
    a.rz = z;
    a.move = a.leanF = a.leanS = a.wind = a.wob = 0;
    a.flashSeen = false;
    a.gait = gaitOf(def.model);
  }
  const T = enemyAnimTuning;
  const sc = e.scale;
  const boss = !!def.boss;

  // Velocity from the drawn motion (works the same on hosts and clients).
  if (dt > 0) {
    const vx = (x - a.rx) / dt;
    const vz = (z - a.rz) / dt;
    a.rx = x;
    a.rz = z;
    const sp = Math.hypot(vx, vz);
    if (sp < 60) {
      // ignore teleports (blinking elites, recycling)
      toLocal(vx, vz, e.facing, loc);
      const ref = Math.max(1.5, def.speed * e.speedMul);
      const k = 1 - Math.exp(-10 * dt);
      a.move += (Math.min(1, sp / ref) - a.move) * k;
      a.leanF += (loc.f / ref - a.leanF) * k;
      a.leanS += (loc.s / ref - a.leanS) * k;
    }
  }
  // Hit wobble on the rising edge of the hit flash.
  if (e.flash > 0) {
    if (!a.flashSeen) a.wob = 1;
    a.flashSeen = true;
  } else a.flashSeen = false;
  a.wob *= Math.exp(-9 * dt);
  const winding = e.state === 'windup' && e.frozen <= 0;
  a.wind += ((winding ? 1 : 0) - a.wind) * (1 - Math.exp(-(winding ? 14 : 8) * dt));

  if (e.state === 'spawning' || e.frozen > 0) return; // frozen solid: no life in it

  // --- Gait ---
  const m = a.move * T.gait;
  const g = a.gait;
  a.ph += dt * Math.PI * 2 * GAIT_FREQ[g] * (g === 'pulse' || g === 'hover' || g === 'glide' ? 1 : 0.35 + 0.65 * a.move) / Math.sqrt(sc);
  const s = Math.sin(a.ph);
  const as = Math.abs(s);
  switch (g) {
    case 'hop': {
      // Bouncy hops: stretch in the air, squash on landing.
      o.y += as * 0.32 * m * sc * (boss ? 0.6 : 1);
      const land = (1 - as) ** 6 * m;
      o.sy *= 1 + as * 0.08 * m - land * 0.18;
      o.sx *= 1 + land * 0.12;
      o.sz *= 1 + land * 0.12;
      o.pitch += 0.12 * m * Math.cos(a.ph) * Math.sign(s);
      break;
    }
    case 'flutter':
      o.y += s * 0.12 * sc;
      o.sx *= 1 + Math.sin(a.ph * 2) * 0.08;
      o.roll += Math.sin(a.ph * 0.5) * 0.18;
      o.pitch += 0.22 * m;
      break;
    case 'trundle':
      o.y += as * 0.035 * m * sc;
      o.roll += Math.sin(a.ph * 0.5) * 0.06 * m;
      break;
    case 'stomp': {
      // Heavy: weight rolls side to side, body drops on each footfall.
      o.roll += s * 0.1 * m;
      o.y += as * 0.08 * m * sc;
      const fall = (1 - as) ** 5 * m;
      o.sy *= 1 - fall * 0.07;
      o.sx *= 1 + fall * 0.05;
      o.pitch += 0.05 * m;
      break;
    }
    case 'waddle':
      o.roll += s * 0.26 * (0.25 + m);
      o.yaw += s * 0.18 * m;
      o.y += as * 0.07 * m * sc;
      break;
    case 'jiggle': {
      const j = Math.sin(a.ph * 2) * 0.11 * (0.35 + m);
      o.sx *= 1 + j;
      o.sz *= 1 + j;
      o.sy *= 1 - j;
      o.roll += s * 0.05 * m;
      break;
    }
    case 'pulse':
      o.sx *= 1 + s * 0.04;
      o.sz *= 1 + s * 0.04;
      o.sy *= 1 - s * 0.03;
      o.yaw += time * 0.6;
      break;
    case 'hover':
      o.y += s * 0.22 * sc;
      o.roll += Math.sin(a.ph * 0.5) * 0.05;
      break;
    case 'glide':
      o.y += s * 0.15 * sc;
      o.roll += Math.sin(a.ph * 0.5) * 0.08;
      o.pitch += 0.12;
      break;
  }

  // --- Lean: into movement, and tipped back by knockback ---
  const lk = boss ? 0.4 : 1;
  o.pitch += clamp(a.leanF * 0.12, -T.leanMax, T.leanMax * 0.6) * lk;
  o.roll -= clamp(a.leanS * (g === 'hover' ? 0.25 : 0.1), -T.leanMax, T.leanMax) * lk;

  // --- Wind-ups: make the telegraph read in the body ---
  const w = a.wind;
  if (w > 0.01) {
    const bh = def.behavior;
    const charge = bh === 'charger' || ((bh === 'rex' || bh === 'omega') && e.action === 'charge');
    if (charge) {
      // Rear back, paw the ground.
      o.pitch -= 0.42 * w - Math.sin(time * 15) * 0.08 * w;
      o.y += 0.14 * w * sc;
      o.oz -= 0.08 * w;
    } else if (bh === 'lunge') {
      // Crouch (the sim squashes) and lean back, quivering with tension.
      o.pitch -= 0.3 * w;
      o.ox += Math.sin(time * 61 + e.uid) * 0.035 * w * sc;
      o.oz += Math.cos(time * 53 + e.uid) * 0.035 * w * sc;
    } else if (bh === 'exploder') {
      // Shake harder and harder as the fuse burns down.
      const F = def.fuse!;
      const k = clamp(1 - e.t / F.time, 0, 1);
      const amp = (0.03 + 0.11 * k * k) * sc;
      o.ox += Math.sin(time * 71 + e.uid) * amp;
      o.oz += Math.cos(time * 83 + e.uid * 3) * amp;
      o.roll += Math.sin(time * 47) * (0.06 + 0.16 * k) * w;
      o.yaw += Math.sin(time * 39) * 0.12 * k;
    } else if (bh === 'shooter') {
      // Sniper hunkers down to aim; the others rock back to fire.
      if (def.shoot?.pattern === 'sniper') {
        o.sy *= 1 - 0.1 * w;
        o.pitch += 0.06 * w;
      } else {
        o.pitch -= 0.18 * w;
        o.sy *= 1 + 0.06 * w;
      }
    } else if (bh === 'spawner') {
      o.yaw += time * 9 * w;
      o.sx *= 1 + 0.12 * w;
      o.sz *= 1 + 0.12 * w;
    } else if (boss) {
      // Bosses rear up before every move.
      o.pitch -= 0.22 * w;
      o.y += 0.12 * w * sc;
      o.roll += Math.sin(time * 30) * 0.03 * w;
    }
  }
  if (e.state === 'attack') {
    const bh = def.behavior;
    if (bh === 'lunge' || bh === 'charger' || ((bh === 'rex' || bh === 'omega') && e.action === 'charge')) {
      // Diving forward, stretched along the attack.
      o.pitch += 0.32;
      o.sz *= 1.15;
      o.sy *= 0.92;
    } else if (bh === 'shooter' && def.shoot?.pattern === 'spiral') o.yaw += time * 11;
  } else if (e.state === 'recover') {
    // Dizzy wobble after an attack.
    o.roll += Math.sin(time * 9 + e.uid) * 0.13;
    o.yaw += Math.sin(time * 6 + e.uid) * 0.15;
  }

  // --- Hit reaction: squash, tip back, wobble ---
  const hw = a.wob * T.hitWobble * (boss ? 0.35 : 1);
  if (hw > 0.01) {
    o.sy *= 1 - 0.18 * hw;
    o.sx *= 1 + 0.12 * hw;
    o.sz *= 1 + 0.12 * hw;
    o.pitch -= 0.18 * hw;
    o.roll += Math.sin(time * 40 + e.uid) * 0.22 * hw;
  }
}

// ------------------------------------------------------------------ corpses

interface Corpse {
  def: EnemyDef;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  /** Tumble axis (horizontal) and angle. */
  axX: number;
  axZ: number;
  ang: number;
  spin: number;
  scale: number;
  t: number;
  life: number;
  bounces: number;
  /** 0 = flung, 1 = boss (stays and shakes apart under the explosion chain). */
  kind: number;
}

const CORPSE_CAP = 160;

/** Cosmetic corpses that tumble away. Pooled; rendered by Enemies into the enemy batches. */
export class Corpses {
  readonly list: Corpse[] = [];
  private pool: Corpse[] = [];
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private axis = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private seed = 1;

  private rand(): number {
    // Cosmetic only: a tiny LCG so corpses never touch the gameplay RNG.
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Fling a corpse along (dirX, dirZ) (0, 0 = straight up). */
  add(def: EnemyDef, x: number, y: number, z: number, scale: number, facing: number, dirX: number, dirZ: number): void {
    if (this.list.length >= CORPSE_CAP || def.hidden) return;
    const c = this.pool.pop() ?? ({} as Corpse);
    const T = enemyAnimTuning;
    const boss = !!def.boss;
    const heavy = scale > 1.2 || def.radius > 0.9;
    let l = Math.hypot(dirX, dirZ);
    if (l < 0.01) {
      const a = this.rand() * Math.PI * 2;
      dirX = Math.cos(a);
      dirZ = Math.sin(a);
      l = 0.3;
    } else {
      dirX /= l;
      dirZ /= l;
      l = 1;
    }
    // A little sideways scatter so a line of kills doesn't fly in lockstep.
    const sp = (this.rand() - 0.5) * 0.7;
    const cx = dirX - dirZ * sp;
    const cz = dirZ + dirX * sp;
    const speed = boss ? 0 : T.flingSpeed * (heavy ? 0.55 : 1) * (0.7 + this.rand() * 0.6) * l;
    c.def = def;
    c.x = x;
    c.y = y;
    c.z = z;
    c.vx = cx * speed;
    c.vz = cz * speed;
    c.vy = boss ? 0 : T.flingUp * (heavy ? 0.65 : 1) * (0.8 + this.rand() * 0.4);
    c.yaw = facing;
    c.axX = cz;
    c.axZ = -cx;
    c.ang = 0;
    c.spin = boss ? 0 : T.tumble * (heavy ? 0.5 : 1) * (0.7 + this.rand() * 0.6);
    c.scale = scale;
    c.t = 0;
    c.life = boss ? 1.5 : T.corpseLife * (heavy ? 1.35 : 1);
    c.bounces = 0;
    c.kind = boss ? 1 : 0;
    this.list.push(c);
  }

  clear(): void {
    while (this.list.length) this.pool.push(this.list.pop()!);
  }

  /**
   * Advance and draw every corpse. `put` receives the instance matrix and
   * flash colour for the corpse's enemy type; `shadow` gets a blob shadow.
   */
  render(dt: number, time: number, m4: THREE.Matrix4, put: (def: EnemyDef, m: THREE.Matrix4, r: number, g: number, b: number, a: number) => void, shadow: (x: number, z: number, size: number) => void): void {
    const T = enemyAnimTuning;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.t += dt;
      if (c.t >= c.life) {
        this.pool.push(c);
        this.list[i] = this.list[this.list.length - 1];
        this.list.pop();
        continue;
      }
      let ox = 0;
      let oz = 0;
      let swell = 1;
      if (c.kind === 0) {
        c.vy -= T.gravity * dt;
        c.x += c.vx * dt;
        c.z += c.vz * dt;
        c.y += c.vy * dt;
        c.ang += c.spin * dt;
        if (c.y < 0 && c.vy < 0) {
          c.y = 0;
          if (c.bounces++ < 1) {
            c.vy *= -0.32;
            c.vx *= 0.45;
            c.vz *= 0.45;
            c.spin *= 0.4;
          } else {
            c.vy = 0;
            c.vx *= 0.6;
            c.vz *= 0.6;
            c.spin = 0;
          }
        }
      } else {
        // Boss: rooted, shaking harder and swelling until the last blast.
        const u = c.t / c.life;
        const amp = (0.06 + 0.22 * u) * c.scale;
        ox = Math.sin(time * 67) * amp;
        oz = Math.cos(time * 59) * amp;
        swell = 1 + 0.22 * u * u;
        c.ang = Math.sin(time * 23) * 0.1 * (0.5 + u);
      }
      const end = c.life - c.t;
      const pop = (c.t < 0.08 ? 1 + (0.08 - c.t) * 3 : 1) * (end < 0.14 ? end / 0.14 : 1) * swell;
      const sc = c.scale * pop;
      this.axis.set(c.axX, 0, c.axZ);
      this.q.setFromAxisAngle(this.axis, c.ang);
      this.q2.setFromAxisAngle(this.up, c.yaw);
      this.q.multiply(this.q2);
      m4.compose(this.v.set(c.x + ox, c.y, c.z + oz), this.q, this.s.set(sc, sc, sc));
      if (c.t < 0.09) put(c.def, m4, 1, 1, 1, 0.9);
      else if (c.kind === 1) put(c.def, m4, 1, Math.sin(time * 30) > 0 ? 1 : 0.3, 0.3, 0.55);
      else put(c.def, m4, 0.16, 0.12, 0.22, 0.2 + 0.25 * (c.t / c.life));
      shadow(c.x, c.z, c.def.radius * 2.6 * sc * Math.max(0.3, 1 - c.y * 0.15));
    }
  }
}
