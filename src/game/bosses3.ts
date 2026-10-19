/**
 * Biome boss brains (bosses3 lane): Glitch DJ (Neon City), Boxer Jack (Toy
 * Factory) and Admiral Gale (Sky Fortress), plus their mini-bosses, which
 * share the brains (MC Static, Jack Jr., Commodore Squall). Defs live in
 * src/data/bosses3.ts; the arena they act on (laser grids, punch lines, gusts,
 * boarding parties, lightning) in src/game/systems/bosses3.ts, which syncs it
 * to clients and draws it (src/game/bosses3View.ts).
 *
 *   Glitch DJ    Every attack starts and lands on its beat (`DJ_BPM`, the boss
 *                track's tempo; the music is pulled onto the same grid).
 *                P1 pulse rings, bass drops (shockwave on the downbeat), a laser
 *                grid that steps across the floor one beat at a time, backup
 *                dancers. P2 two grids crossing, double drops, scratch spirals.
 *                P3 REMIX: grids step back and forth, rings spin both ways, and
 *                every drop echoes from the spot mirrored across you.
 *   Boxer Jack   Every attack winds its crank first (the telegraph). P1 glove
 *                punches along long lines, springs across the arena, toy-ball
 *                pops, toy soldiers. P2 one-two punches and double springs.
 *                P3 the box opens: pinball runs that bounce off the arena edge
 *                (path shown first, smashing cover), double hooks.
 *   Admiral Gale Flies over cover at range. P1 cannon volleys, walking barrages,
 *                wind gusts that push heroes and every bullet, boarding parties.
 *                P2 broadsides and longer gusts. P3 the storm: lightning keeps
 *                striking near every hero, thunder rings.
 *
 * Everything here runs on the host inside Enemies.update (via updateBoss in
 * src/game/bosses.ts).
 */
import type { Enemy, EnemyCtx } from './enemies';
import { DJ_BPM } from '../data/bosses3';
import { enter, isMini, lockOn, next, pace, ring } from './bosses';

export const bosses3Tuning = {
  /** Glitch DJ */
  djRange: [8.5, 12] as [number, number], // keeps between these distances
  djHover: 1.1,
  pulseBeats: 8, // beats of pulse rings
  pulseBullets: 10, // +4 per phase
  pulseSpeed: 6.5,
  pulseDamage: 12,
  gridLines: 9,
  gridSpacing: 4, // metres between lines; they step a quarter of this per beat
  gridLength: 44,
  gridHalf: 0.38, // half-width that hurts
  gridHot: 0.2, // seconds a line burns after its beat
  gridBeats: 10, // hot beats per grid (P1); +4 from P2
  gridDamage: 14,
  dropBeats: 4, // wind-up beats before the bass drop lands on the downbeat
  dancers: 4,
  /** Boxer Jack */
  crank: 0.85, // punch wind-up (seconds; x0.9 / x0.8 in P2 / P3)
  punchLength: 17,
  punchHalf: 0.85,
  punchDamage: 22,
  punchHot: 0.22,
  springAir: 0.7,
  springHeight: 6,
  soldiers: 4,
  pinSpeed: 16,
  pinTime: 4.2,
  pinWindup: 1.1,
  /** Admiral Gale */
  galeRange: [10, 13.5] as [number, number],
  galeHover: 2.1,
  cannonSpeed: 9,
  cannonDamage: 14,
  cannonRadius: 0.5,
  gustTime: 2.8, // seconds of gust (3.4 in P3)
  gustTele: 0.9,
  gustShove: 2.6, // shove per pulse (5 pulses a second) on heroes
  gustBullets: 7, // m/s² on bullets (x windTuning team factors)
  boarders: 3,
  boltDelay: 1.0,
  boltRadius: 1.8,
  boltDamage: 18,
  stormEvery: 1.7, // P3: seconds between lightning strikes near each hero
};

/** Test links (`&b3move=grid`): every attack pick of a biome boss becomes this one when it can use it. */
export const bosses3Force = { move: '' };

/** The forced pick if this boss has it in `order`'s phase set, else `pick`. */
function forced<T extends string>(all: readonly T[][], pick: T): T {
  const m = bosses3Force.move as T;
  return m && all.some((o) => o.includes(m)) ? m : pick;
}

/** Behaviours driven by this module. */
export const BOSS3_BEHAVIORS: readonly string[] = ['glitch', 'boxer', 'gale'];

/** Bosses that hover (no wall collisions, no contact damage, keep their height through roars). */
export const isFlyer3 = (e: Enemy): boolean => e.def.behavior === 'glitch' || e.def.behavior === 'gale';

/** What the biome bosses need from the game beyond EnemyCtx and BossApi. Host only. */
export interface Bosses3Api {
  /** Glitch DJ's beat clock (seconds); its beats are floor(clock / beatLen). */
  clock(): number;
  /** A laser grid: `n` parallel lines across (cx, cz), stepping along `ang` one quarter-gap per beat from beat `b0 + 2`. */
  grid(e: Enemy, cx: number, cz: number, ang: number, beats: number, flip: boolean): void;
  /** A straight hazard from (x, z) along `ang`: telegraphed for `tele` s, then hot for `life` s. */
  beam(e: Enemy, x: number, z: number, ang: number, len: number, half: number, tele: number, life: number, dmg: number): void;
  /** Pinball path telegraph (no damage): segments shown for `tele` s. */
  path(e: Enemy, pts: number[], tele: number): void;
  /** Wind gust from the boss along (dx, dz): telegraphed for `tele` s, then blows for `life` s. */
  gust(e: Enemy, dx: number, dz: number, tele: number, life: number): void;
  /** A boarding party drops at (x, z) after a telegraph. */
  board(e: Enemy, x: number, z: number, n: number): void;
  /** A lightning bolt at (x, z) after `delay`. */
  bolt(e: Enemy, x: number, z: number, delay: number): void;
  /** A red warning disc on the ground at (x, z) for `t` seconds (no damage). */
  mark(x: number, z: number, r: number, t: number): void;
  /** The boss duel's ring of fire right now (src/game/bossDuel.ts), or null: pinballs bounce off it too. */
  ring(): { x: number; z: number; r: number } | null;
  /** Cosmetic cue (sound, shake, toast) through the effects bus. */
  cue(e: Enemy, kind: Boss3Cue): void;
}
export type Boss3Cue = 'scratch' | 'drop' | 'crank' | 'boing' | 'pop' | 'bounce' | 'cannon' | 'horn' | 'remix';

// ------------------------------------------------------------------ pure helpers

/** Seconds per DJ beat. */
export const beatLen = (bpm = DJ_BPM): number => 60 / bpm;

/** Beat index and the fraction into it at clock `t`. */
export function beatAt(t: number, out: { n: number; f: number }): { n: number; f: number } {
  const L = beatLen();
  out.n = Math.floor(t / L);
  out.f = t / L - out.n;
  return out;
}

/**
 * A laser grid's step offset (metres along its direction) at beat `b`.
 * Lines step a quarter gap per beat; with `flip` (the REMIX) they reverse every bar.
 */
export function gridShift(b: number, b0: number, spacing: number, flip: boolean): number {
  const k = Math.max(0, b - b0);
  const q = spacing / 4;
  if (!flip) return k * q;
  // Back and forth: 4 beats one way, 4 back.
  const m = k % 8;
  return (m <= 4 ? m : 8 - m) * q;
}

/** Distance from (px, pz) to the nearest line of a grid at shift `s`, or Infinity if past the ends. */
export function gridDist(px: number, pz: number, cx: number, cz: number, ang: number, n: number, spacing: number, len: number, s: number): number {
  const ux = Math.cos(ang);
  const uz = Math.sin(ang);
  const rx = px - cx;
  const rz = pz - cz;
  const along = rx * -uz + rz * ux; // along the lines
  if (Math.abs(along) > len / 2) return Infinity;
  const across = rx * ux + rz * uz; // across the lines
  const first = -((n - 1) / 2) * spacing + s;
  const k = Math.round((across - first) / spacing);
  const kk = Math.max(0, Math.min(n - 1, k));
  return Math.abs(across - (first + kk * spacing));
}

/** Distance from (px, pz) to the segment from (x, z) along angle `ang` for `len`. */
export function segDist3(px: number, pz: number, x: number, z: number, ang: number, len: number): number {
  const dx = Math.cos(ang);
  const dz = Math.sin(ang);
  const t = Math.max(0, Math.min(len, (px - x) * dx + (pz - z) * dz));
  return Math.hypot(px - (x + dx * t), pz - (z + dz * t));
}

/** A pinball's motion state (position and unit heading). */
export interface Pin {
  x: number;
  z: number;
  dx: number;
  dz: number;
}

/**
 * One pinball step of `step` metres inside a square of half-size `lim` and,
 * optionally, a circle (the duel's ring; `rad` = the ball's radius). Reflects
 * the heading off whatever it would leave; returns true on a bounce. Pure: the
 * brain and its telegraphed path share it, so the path is the run.
 */
export function pinStep(p: Pin, step: number, lim: number, ring: { x: number; z: number; r: number } | null, rad: number): boolean {
  let hit = false;
  if (Math.abs(p.x + p.dx * step) > lim) {
    p.dx = -p.dx;
    hit = true;
  }
  if (Math.abs(p.z + p.dz * step) > lim) {
    p.dz = -p.dz;
    hit = true;
  }
  if (ring) {
    const nx = p.x + p.dx * step - ring.x;
    const nz = p.z + p.dz * step - ring.z;
    const d = Math.hypot(nx, nz);
    const max = Math.max(1, ring.r - rad);
    if (d > max && (p.dx * nx + p.dz * nz) > 0) {
      // Reflect off the ring's wall (normal points out from its centre).
      const ux = nx / d;
      const uz = nz / d;
      const k = 2 * (p.dx * ux + p.dz * uz);
      p.dx -= k * ux;
      p.dz -= k * uz;
      hit = true;
    }
  }
  p.x += p.dx * step;
  p.z += p.dz * step;
  return hit;
}

/**
 * A pinball run from (x, z) along (dx, dz) at `speed` for `time` seconds (see
 * pinStep). Returns the corner points [x0, z0, x1, z1, ...]: start, each
 * bounce, end. Pure.
 */
export function pinballPath(x: number, z: number, dx: number, dz: number, speed: number, time: number, lim: number, maxPts = 8, ring: { x: number; z: number; r: number } | null = null, rad = 0, dt = 1 / 60): number[] {
  const pts = [x, z];
  const p: Pin = { x, z, dx, dz };
  for (let t = 0; t < time - 1e-9 && pts.length < maxPts * 2; t += dt) {
    if (pinStep(p, speed * dt, lim, ring, rad)) pts.push(p.x - p.dx * speed * dt, p.z - p.dz * speed * dt);
  }
  if (pts.length < maxPts * 2) pts.push(p.x, p.z);
  return pts;
}

// ------------------------------------------------------------------ per-boss memory

interface Mem {
  uid: number;
  /** Last beat this boss reacted to. */
  beat: number;
  /** Local beat clock (unit tests without a Bosses3Api). */
  clock: number;
  /** Boxer: pinball path started; bounces this run. */
  pinShown: boolean;
  bounces: number;
}
const mems = new WeakMap<Enemy, Mem>();
function mem(e: Enemy): Mem {
  let m = mems.get(e);
  if (!m || m.uid !== e.uid) {
    m = { uid: e.uid, beat: -1, clock: 0, pinShown: false, bounces: 0 };
    mems.set(e, m);
  }
  return m;
}

const BEAT = { n: 0, f: 0 };
const PIN: Pin = { x: 0, z: 0, dx: 0, dz: 0 };

// ------------------------------------------------------------------ dispatch

/** One step of a biome boss (from updateBoss). Sets e.vx/e.vz; returns true while the move is rigid. */
export function bosses3Step(e: Enemy, dt: number, ctx: EnemyCtx, nx: number, nz: number, dist: number, speed: number): boolean {
  switch (e.def.behavior) {
    case 'glitch':
      glitch(e, dt, ctx, nx, nz, dist, speed);
      return false;
    case 'boxer':
      return boxer(e, dt, ctx, nx, nz, dist, speed);
    default:
      gale(e, dt, ctx, nx, nz, dist, speed);
      return false;
  }
}

/** Circle the target between `near` and `far` (hovering bosses). */
function orbit(e: Enemy, nx: number, nz: number, dist: number, speed: number, near: number, far: number): void {
  const radial = dist > far ? 1 : dist < near ? -1 : 0;
  e.vx = (nx * radial - nz * e.strafe * 0.8) * speed;
  e.vz = (nz * radial + nx * e.strafe * 0.8) * speed;
}

// ------------------------------------------------------------------ Glitch DJ

type DjPick = 'ring' | 'grid' | 'drop' | 'summon' | 'spiral';

const DJ_ORDER: DjPick[][] = [
  ['ring', 'grid', 'drop', 'summon', 'ring', 'grid'],
  ['grid', 'spiral', 'drop', 'ring', 'summon', 'grid', 'drop'],
  ['grid', 'drop', 'spiral', 'ring', 'grid', 'summon', 'drop'],
];
const DJ_MINI: DjPick[][] = [['ring', 'grid', 'summon'], ['drop', 'grid', 'ring']];

function glitch(e: Enemy, dt: number, ctx: EnemyCtx, nx: number, nz: number, dist: number, speed: number): void {
  const T = bosses3Tuning;
  const api = ctx.boss?.b3;
  const m = mem(e);
  const mini = isMini(e);
  const ph = e.phase;
  const remix = ph >= 3 && !mini;
  m.clock += dt;
  beatAt(api ? api.clock() : m.clock, BEAT);
  const onBeat = BEAT.n !== m.beat;
  m.beat = BEAT.n;
  // Bob on the deck with the beat.
  e.hopY = (mini ? 0.8 : T.djHover) + 0.3 * Math.exp(-6 * BEAT.f);
  if (onBeat) e.squash(e.state === 'attack' ? 5 : 3);
  e.facing = Math.atan2(nx, nz);
  const tgt = ctx.target;
  if (e.state === 'move') {
    orbit(e, nx, nz, dist, speed, T.djRange[0], T.djRange[1]);
    e.timerA -= dt;
    if (e.timerA <= 0 && onBeat && ctx.targetAlive) {
      const order = mini ? DJ_MINI[Math.min(1, ph - 1)] : DJ_ORDER[Math.min(3, ph) - 1];
      const pick = forced(DJ_ORDER, next(e, order));
      e.vx = e.vz = 0;
      e.move = pick === 'grid' || pick === 'drop' ? pick : '';
      e.action = pick === 'grid' || pick === 'drop' ? 'summon' : pick;
      // Wind-ups are counted in beats (e.burst), so every attack lands on one.
      e.burst = pick === 'drop' ? T.dropBeats : pick === 'grid' ? 1 : 2;
      if (Math.random() < 0.35) e.strafe *= -1;
      enter(e, 'windup', 99, -5, ctx);
      if (pick === 'drop') {
        e.targetX = tgt.x;
        e.targetZ = tgt.z;
        api?.cue(e, 'scratch');
      }
    }
    return;
  }
  e.vx *= 0.85;
  e.vz *= 0.85;
  if (e.state === 'windup') {
    if (!onBeat) return;
    if (e.move === 'drop') {
      // Track the target while the record winds back, then the bass drops on the downbeat.
      e.targetX = tgt.x;
      e.targetZ = tgt.z;
      e.squash(-4);
      if (e.burst > 1) api?.cue(e, 'scratch');
      else if (remix) api?.mark(2 * e.targetX - e.x, 2 * e.targetZ - e.z, 2.5, beatLen() * 1.5); // where the echo drops
    }
    if (--e.burst > 0) return;
    if (e.move === 'drop') {
      const sw = ctx.boss;
      sw?.shockwave(e, e.x, e.z, 0);
      if (ph >= 2) sw?.shockwave(e, e.x, e.z, beatLen());
      if (remix) {
        // REMIX: the drop echoes from the spot mirrored across the hero.
        const mx = 2 * e.targetX - e.x;
        const mz = 2 * e.targetZ - e.z;
        if (sw?.open(mx, mz, 1) ?? true) sw?.shockwave(e, mx, mz, beatLen() * 0.5);
      }
      api?.cue(e, 'drop');
      e.move = '';
      enter(e, 'recover', 1.0 * pace(e), 12);
    } else if (e.move === 'grid') {
      const ang = Math.atan2(nz, nx) + (Math.random() < 0.5 ? 0 : Math.PI / 2) + (Math.random() - 0.5) * 0.5;
      const beats = T.gridBeats + (ph >= 2 ? 4 : 0) - (mini ? 2 : 0);
      api?.grid(e, tgt.x, tgt.z, ang, beats, remix);
      if (ph >= 2 && !mini) api?.grid(e, tgt.x, tgt.z, ang + Math.PI / 2, beats, remix);
      e.burst = beats + 2;
      enter(e, 'attack', 99, 6);
    } else if (e.action === 'summon') {
      const n = mini ? 3 : T.dancers + (ph >= 2 ? 2 : 0);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.spawnChild('dancer', e.x + Math.cos(a) * 3, e.z + Math.sin(a) * 3, e);
      }
      enter(e, 'recover', 0.8 * pace(e), 8);
    } else {
      e.burst = e.action === 'spiral' ? 8 : mini ? 6 : T.pulseBeats;
      e.spin = Math.atan2(nz, nx);
      e.timerB = 0;
      enter(e, 'attack', 99, 6);
    }
    return;
  }
  if (e.state === 'attack') {
    if (e.move === 'grid') {
      // Dancing while the grid plays; from phase 2 a slow ring every other beat.
      if (onBeat) {
        if (ph >= 2 && e.burst % 2 === 0) ring(e, ctx, mini ? 6 : 8, 5, T.pulseDamage, BEAT.n * 0.4);
        if (--e.burst <= 0) {
          e.move = '';
          enter(e, 'recover', 0.6 * pace(e), 6);
        }
      }
      return;
    }
    if (e.action === 'spiral') {
      // Scratch: two arms spiral out, flipping direction on the beat (P3: on every half-beat too).
      const dir = (remix ? Math.floor(BEAT.f * 2) + BEAT.n : Math.floor(BEAT.n / 2)) % 2 ? -1 : 1;
      e.timerB -= dt;
      while (e.timerB <= 0) {
        e.timerB += 0.11;
        for (let k = 0; k < 2; k++) {
          const a = e.spin + k * Math.PI;
          ctx.fireBullet(e, Math.cos(a), Math.sin(a), 7, T.pulseDamage);
        }
        e.spin += 0.26 * dir;
      }
    } else if (onBeat) {
      // Pulse rings on every beat; the ring turns half a gap each beat (REMIX: both ways at once).
      const n = (mini ? 8 : T.pulseBullets) + (ph - 1) * 4;
      const off = e.spin + BEAT.n * (Math.PI / n);
      ring(e, ctx, n, T.pulseSpeed, T.pulseDamage, off);
      if (remix && BEAT.n % 2 === 0) ring(e, ctx, n, T.pulseSpeed * 0.75, T.pulseDamage, -off + Math.PI / n);
      e.squash(6);
    }
    if (onBeat && --e.burst <= 0) enter(e, 'recover', 0.8 * pace(e), 6);
    return;
  }
  // recover
  if (e.t <= 0) {
    e.state = 'move';
    e.timerA = 1.1 * pace(e);
  }
}

// ------------------------------------------------------------------ Boxer Jack

type JackPick = 'punch' | 'slam' | 'ring' | 'summon' | 'pinball';

const JACK_ORDER: JackPick[][] = [
  ['punch', 'slam', 'ring', 'summon', 'punch', 'slam'],
  ['punch', 'slam', 'summon', 'punch', 'ring', 'slam'],
  ['pinball', 'punch', 'slam', 'summon', 'pinball', 'ring', 'punch'],
];
const JACK_MINI: JackPick[][] = [['punch', 'slam', 'summon'], ['punch', 'ring', 'slam']];

/** Punch wind-up for a phase (the crank speeds up). */
export const crankTime = (phase: number): number => bosses3Tuning.crank * (phase >= 3 ? 0.8 : phase === 2 ? 0.9 : 1);

function boxer(e: Enemy, dt: number, ctx: EnemyCtx, nx: number, nz: number, dist: number, speed: number): boolean {
  const T = bosses3Tuning;
  const api = ctx.boss?.b3;
  const m = mem(e);
  const mini = isMini(e);
  const ph = e.phase;
  const tgt = ctx.target;
  if (e.state === 'move') {
    e.facing = Math.atan2(nx, nz);
    const k = dist < 5 ? -0.5 : 1; // shuffles in, but not into your face
    e.vx = nx * speed * k;
    e.vz = nz * speed * k;
    e.timerA -= dt;
    if (e.timerA <= 0 && ctx.targetAlive) {
      const order = mini ? JACK_MINI[Math.min(1, ph - 1)] : JACK_ORDER[Math.min(3, ph) - 1];
      let pick = forced(JACK_ORDER, next(e, order));
      if (dist > 15 && pick !== 'pinball' && !bosses3Force.move) pick = 'slam';
      e.vx = e.vz = 0;
      e.move = pick === 'punch' || pick === 'pinball' ? pick : '';
      e.action = pick === 'punch' || pick === 'pinball' ? 'summon' : pick;
      lockOn(e, nx, nz);
      if (pick === 'slam') {
        e.burst = mini ? 1 : ph >= 2 ? 2 : 1;
        e.targetX = tgt.x;
        e.targetZ = tgt.z;
      } else if (pick === 'punch') e.burst = mini ? 1 : ph >= 2 ? 2 : 1;
      m.pinShown = false;
      enter(e, 'windup', pick === 'pinball' ? T.pinWindup : pick === 'punch' ? crankTime(ph) : pick === 'slam' ? 0.9 : 0.75, -6, ctx);
      api?.cue(e, 'crank');
    }
    return false;
  }
  if (e.state === 'windup') {
    e.vx = e.vz = 0;
    if (e.move === 'punch') {
      // Aim with the glove, then lock: the punch line lights up for the last 0.35 s.
      if (e.t > 0.35) {
        lockOn(e, nx, nz);
        return false;
      }
      if (!m.pinShown) {
        m.pinShown = true;
        const a = Math.atan2(e.lungeZ, e.lungeX);
        const sx = e.x + e.lungeX * e.radius * 0.6;
        const sz = e.z + e.lungeZ * e.radius * 0.6;
        const len = mini ? T.punchLength * 0.75 : T.punchLength;
        const dmg = T.punchDamage * e.dmgMul;
        if (ph >= 3 && !mini && e.burst === 1) {
          // Double hook: two lines either side of you.
          api?.beam(e, sx, sz, a - 0.3, len, T.punchHalf, e.t, T.punchHot, dmg);
          api?.beam(e, sx, sz, a + 0.3, len, T.punchHalf, e.t, T.punchHot, dmg);
        } else api?.beam(e, sx, sz, a, len, T.punchHalf, e.t, T.punchHot, dmg);
      }
      if (e.t > 0) return false;
      e.facing = Math.atan2(e.lungeX, e.lungeZ);
      api?.cue(e, 'boing');
      enter(e, 'attack', T.punchHot + 0.1, 10);
      return false;
    }
    if (e.move === 'pinball') {
      if (e.t > T.pinWindup * 0.55) lockOn(e, nx, nz);
      else if (!m.pinShown && api) {
        m.pinShown = true;
        api.path(e, pinballPath(e.x, e.z, e.lungeX, e.lungeZ, T.pinSpeed, T.pinTime, ctx.bounds() - e.radius - 1, 6, api.ring(), e.radius), e.t + 0.4);
      }
      if (e.t > 0) return false;
      m.bounces = 0;
      api?.cue(e, 'boing');
      enter(e, 'attack', T.pinTime, 12);
      return false;
    }
    if (e.action === 'slam' && e.t > 0.45) {
      e.targetX += (tgt.x - e.targetX) * Math.min(1, dt * 3);
      e.targetZ += (tgt.z - e.targetZ) * Math.min(1, dt * 3);
    }
    if (e.t > 0) return false;
    if (e.action === 'slam') {
      e.fromX = e.x;
      e.fromZ = e.z;
      api?.cue(e, 'boing');
      enter(e, 'attack', T.springAir, 10);
    } else if (e.action === 'ring') {
      // Pop! The head springs up and sprays toy balls.
      const n = mini ? 12 : 16;
      const off = Math.random() * Math.PI;
      ring(e, ctx, n, 6, 13, off);
      if (ph >= 2 && !mini) ring(e, ctx, n, 4.5, 13, off + Math.PI / n);
      for (let i = -2; i <= 2; i++) {
        const a = Math.atan2(nz, nx) + i * 0.14;
        ctx.fireBullet(e, Math.cos(a), Math.sin(a), 9.5, 13);
      }
      api?.cue(e, 'pop');
      enter(e, 'recover', 0.8 * pace(e), 12);
    } else {
      // Toy soldiers march out in a rank between Jack and you.
      const n = mini ? 3 : T.soldiers + (ph >= 2 ? 1 : 0);
      const cx = e.x + nx * 2.5;
      const cz = e.z + nz * 2.5;
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * 1.4;
        ctx.spawnChild('soldier', cx - nz * o, cz + nx * o, e);
      }
      enter(e, 'recover', 0.9 * pace(e), 8);
    }
    return false;
  }
  if (e.state === 'attack') {
    if (e.move === 'punch') {
      e.vx = e.vz = 0;
      if (e.t <= 0) {
        if (--e.burst > 0) {
          lockOn(e, nx, nz);
          m.pinShown = false;
          enter(e, 'windup', 0.55, -5, ctx);
          api?.cue(e, 'crank');
        } else {
          e.move = '';
          enter(e, 'recover', 0.9 * pace(e), -6);
        }
      }
      return false;
    }
    if (e.move === 'pinball') {
      // Bounce off the arena edge like a pinball, smashing through cover.
      PIN.x = e.x;
      PIN.z = e.z;
      PIN.dx = e.lungeX;
      PIN.dz = e.lungeZ;
      const hit = pinStep(PIN, T.pinSpeed * dt, ctx.bounds() - e.radius - 1, api?.ring() ?? null, e.radius);
      e.lungeX = PIN.dx;
      e.lungeZ = PIN.dz;
      if (hit) {
        m.bounces++;
        ring(e, ctx, 8, 6, 12, Math.random() * Math.PI);
        api?.cue(e, 'bounce');
      }
      e.vx = e.lungeX * T.pinSpeed;
      e.vz = e.lungeZ * T.pinSpeed;
      e.facing = Math.atan2(e.lungeX, e.lungeZ);
      e.hopY = Math.abs(Math.sin(e.t * 9)) * 0.8;
      ctx.boss?.rampage(e, false);
      if (e.t <= 0) {
        e.vx = e.vz = 0;
        e.hopY = 0;
        e.move = '';
        enter(e, 'recover', 1.3 * pace(e), -10); // dizzy: a window to punish
      }
      return true;
    }
    // Spring: arc to the landing point.
    const k = 1 - Math.max(0, e.t) / T.springAir;
    e.x = e.fromX + (e.targetX - e.fromX) * k;
    e.z = e.fromZ + (e.targetZ - e.fromZ) * k;
    e.hopY = Math.sin(k * Math.PI) * (mini ? 4 : T.springHeight);
    e.vx = e.vz = 0;
    if (e.t <= 0) {
      e.hopY = 0;
      ctx.slam(e);
      if (ph >= 3 && !mini) ctx.boss?.shockwave(e, e.x, e.z, 0);
      if (--e.burst > 0) {
        e.targetX = tgt.x;
        e.targetZ = tgt.z;
        enter(e, 'windup', 0.55, -6, ctx);
        api?.cue(e, 'crank');
      } else enter(e, 'recover', 1.0 * pace(e), -10);
    }
    return true;
  }
  e.vx = e.vz = 0;
  if (e.t <= 0) {
    e.state = 'move';
    e.timerA = 1.6 * pace(e);
  }
  return false;
}

// ------------------------------------------------------------------ Admiral Gale

type GalePick = 'volley' | 'rain' | 'gust' | 'summon' | 'waves';

const GALE_ORDER: GalePick[][] = [
  ['volley', 'gust', 'rain', 'summon', 'volley'],
  ['gust', 'volley', 'rain', 'summon', 'gust', 'volley'],
  ['gust', 'volley', 'waves', 'rain', 'summon', 'gust', 'waves'],
];
const GALE_MINI: GalePick[][] = [['volley', 'gust', 'summon'], ['gust', 'volley', 'rain']];

function gale(e: Enemy, dt: number, ctx: EnemyCtx, nx: number, nz: number, dist: number, speed: number): void {
  const T = bosses3Tuning;
  const api = ctx.boss?.b3;
  const mini = isMini(e);
  const ph = e.phase;
  const tgt = ctx.target;
  e.timerB += dt;
  e.hopY = (mini ? 1.5 : T.galeHover) + Math.sin(e.timerB * 1.7) * 0.25;
  e.facing = Math.atan2(nx, nz);
  // The storm (phase 3): lightning keeps striking near every hero.
  if (ph >= 3 && !mini && api) {
    e.twistT -= dt;
    if (e.twistT <= 0) {
      e.twistT = T.stormEvery;
      for (const h of ctx.targets) {
        if (!h.alive) continue;
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * 3;
        api.bolt(e, h.x + Math.cos(a) * d, h.z + Math.sin(a) * d, T.boltDelay);
      }
    }
  }
  if (e.state === 'move') {
    orbit(e, nx, nz, dist, speed, T.galeRange[0], T.galeRange[1]);
    e.timerA -= dt;
    if (e.timerA <= 0 && ctx.targetAlive) {
      const order = mini ? GALE_MINI[Math.min(1, ph - 1)] : GALE_ORDER[Math.min(3, ph) - 1];
      const pick = forced(GALE_ORDER, next(e, order));
      e.move = pick === 'gust' ? 'gust' : pick === 'summon' ? 'board' : '';
      e.action = pick === 'gust' ? 'summon' : pick;
      lockOn(e, nx, nz);
      if (Math.random() < 0.3) e.strafe *= -1;
      enter(e, 'windup', pick === 'gust' ? 0.5 : pick === 'volley' ? 0.7 : 0.6, -5, ctx);
      if (pick === 'volley' || pick === 'rain') api?.cue(e, 'horn');
    }
    return;
  }
  e.vx *= 0.9;
  e.vz *= 0.9;
  if (e.state === 'windup') {
    if (e.t > 0) return;
    if (e.move === 'gust') {
      // The gust blows from the ship past you; the next attack fires into it.
      api?.gust(e, e.lungeX, e.lungeZ, T.gustTele, (mini ? 2 : T.gustTime) + (ph >= 3 ? 0.6 : 0));
      e.move = '';
      enter(e, 'recover', 0.35, 6);
    } else if (e.move === 'board') {
      const spots = mini || ph === 1 ? 1 : 2;
      for (let i = 0; i < spots; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 4 + Math.random() * 2.5;
        api?.board(e, tgt.x + Math.cos(a) * d, tgt.z + Math.sin(a) * d, mini ? 2 : T.boarders);
      }
      e.move = '';
      enter(e, 'recover', 0.8 * pace(e), 6);
    } else if (e.action === 'volley') {
      e.burst = mini ? 2 : ph >= 2 ? 4 : 3;
      e.spin = 0;
      enter(e, 'attack', 1.8, 4);
    } else if (e.action === 'rain') {
      // A walking barrage of cannon shells along the line through you (P3: crossed).
      const a = Math.atan2(nz, nx);
      const lines = ph >= 3 && !mini ? 2 : 1;
      for (let l = 0; l < lines; l++) {
        const b = a + l * (Math.PI / 2);
        for (let i = 0; i < (mini ? 5 : 7); i++) {
          const o = -6 + i * 2.3;
          ctx.strike(tgt.x + Math.cos(b) * o, tgt.z + Math.sin(b) * o, 1.9, 1.0 + i * 0.13, 20);
        }
      }
      api?.cue(e, 'cannon');
      enter(e, 'recover', 1.0 * pace(e), 6);
    } else if (e.action === 'waves') {
      // Thunder ring: bolts all round you, then one where you stand.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.random();
        api?.bolt(e, tgt.x + Math.cos(a) * 3.6, tgt.z + Math.sin(a) * 3.6, T.boltDelay);
      }
      api?.bolt(e, tgt.x, tgt.z, T.boltDelay + 0.5);
      enter(e, 'recover', 1.0 * pace(e), 6);
    } else enter(e, 'recover', 0.5, 4);
    return;
  }
  if (e.state === 'attack') {
    e.spin -= dt;
    if (e.spin <= 0 && e.burst > 0) {
      e.spin = 0.42;
      e.burst--;
      const base = Math.atan2(nz, nx);
      const n = mini ? 4 : 5;
      for (let i = 0; i < n; i++) {
        const a = base + (i / (n - 1) - 0.5) * 0.55;
        cannon(e, ctx, Math.cos(a), Math.sin(a));
      }
      if (ph >= 2 && !mini) {
        // Broadside: three balls from each beam of the ship.
        for (const side of [-1, 1]) {
          for (let i = -1; i <= 1; i++) {
            const a = base + side * (Math.PI / 2) + i * 0.18;
            cannon(e, ctx, Math.cos(a), Math.sin(a));
          }
        }
      }
      api?.cue(e, 'cannon');
      e.squash(5);
    }
    if (e.t <= 0 || e.burst <= 0) enter(e, 'recover', 0.7 * pace(e), 4);
    return;
  }
  if (e.t <= 0) {
    e.state = 'move';
    e.timerA = 1.4 * pace(e);
  }
}

function cannon(e: Enemy, ctx: EnemyCtx, dx: number, dz: number): void {
  const T = bosses3Tuning;
  if (ctx.boss) ctx.boss.shot(e, dx, dz, T.cannonSpeed, T.cannonDamage, '#ff4fa0', 2.6, T.cannonRadius);
  else ctx.fireBullet(e, dx, dz, T.cannonSpeed, T.cannonDamage);
}
