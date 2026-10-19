/**
 * Pure maths for the animation lane: camera direction (auto zoom, co-op
 * framing, kill-cam curve) and enemy gait styles. No three.js, no DOM, so it
 * is unit tested in tests/anim.test.ts.
 */
import type { Model } from '../data/enemies';

/** Smart camera knobs (wired into the debug panel through cameraTuning's neighbours). */
export const camDirTuning = {
  /** Auto zoom range (multiplies the mouse-wheel zoom). */
  autoMin: 0.93,
  autoMax: 1.3,
  /** Enemies in view: zoom starts easing out at `swarmFrom` and is fully out at `swarmFull`. */
  swarmFrom: 30,
  swarmFull: 150,
  swarmOut: 0.17,
  /** Enemies crowding the screen edge (just inside or just outside it). */
  edgeFrom: 5,
  edgeFull: 28,
  edgeOut: 0.12,
  /** Calm moments (few enemies close) push in slightly. */
  calmBelow: 6,
  calmIn: 0.94,
  /** A boss on the field: room for its wide attacks. */
  bossOut: 0.08,
  /** Smoothing rates (per second): zoom out quickly when it gets busy, drift back in slowly. */
  outRate: 1.1,
  inRate: 0.3,
  /** Ground half-extents seen at zoom 1 (16:9, default distance), in metres. */
  viewHalfX: 13.5,
  viewHalfZ: 8.6,
  /** Co-op framing: the camera centre moves this far toward the team, and zooms out up to coopMax to fit everyone. */
  coopBias: 0.5,
  coopMargin: 0.8,
  coopMax: 1.6,
  /** Kill-cam on boss kills: seconds, zoom multiplier at its peak. */
  killCamTime: 2.6,
  killCamZoom: 0.6,
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => v * v * (3 - 2 * v);

/**
 * Target auto-zoom factor from what the camera sees: `near` enemies inside the
 * view, `edge` enemies near its border, and whether a boss is up. 1 = default.
 */
export function autoZoom(near: number, edge: number, boss: boolean): number {
  const t = camDirTuning;
  if (near < t.calmBelow && edge < t.edgeFrom && !boss) return Math.max(t.autoMin, t.calmIn);
  const swarm = clamp01((near - t.swarmFrom) / (t.swarmFull - t.swarmFrom));
  const crowd = clamp01((edge - t.edgeFrom) / (t.edgeFull - t.edgeFrom));
  const k = 1 + smooth(swarm) * t.swarmOut + smooth(crowd) * t.edgeOut + (boss ? t.bossOut : 0);
  return Math.min(t.autoMax, Math.max(t.autoMin, k));
}

/** Ease a smoothed value toward a target: faster when rising (zooming out) than falling. */
export function easeZoom(cur: number, target: number, dt: number): number {
  const t = camDirTuning;
  const rate = target > cur ? t.outRate : t.inRate;
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

/**
 * Where an enemy sits relative to the view: 0 = outside the outer band,
 * 1 = in view, 2 = in the edge band (within 25% of the border, either side).
 * `dx`/`dz` are offsets from the camera focus, `zoom` the current zoom.
 */
export function viewBand(dx: number, dz: number, zoom: number): 0 | 1 | 2 {
  const t = camDirTuning;
  const fx = Math.abs(dx) / (t.viewHalfX * zoom);
  const fz = Math.abs(dz) / (t.viewHalfZ * zoom);
  const f = fx > fz ? fx : fz;
  if (f > 1.25) return 0;
  return f > 0.78 ? 2 : 1;
}

/**
 * Co-op framing: shift the focus toward the team and zoom out so teammates stay
 * in view (bounded; teammates further away keep their edge arrows).
 * Writes the focus offset (from `lx`/`lz`) and the zoom factor into `out`.
 */
export function teamFrame(lx: number, lz: number, mates: ArrayLike<number>, count: number, out: { x: number; z: number; zoom: number }): void {
  const t = camDirTuning;
  out.x = out.z = 0;
  out.zoom = 1;
  if (count <= 0) return;
  // Bounding box of everyone (local hero included).
  let minX = lx, maxX = lx, minZ = lz, maxZ = lz;
  for (let i = 0; i < count; i++) {
    const x = mates[i * 2];
    const z = mates[i * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  // Move partway toward the team's centre, never so far the local hero leaves the middle 60% of the screen.
  let ox = (cx - lx) * t.coopBias;
  let oz = (cz - lz) * t.coopBias;
  const capX = t.viewHalfX * 0.6;
  const capZ = t.viewHalfZ * 0.6;
  ox = Math.max(-capX, Math.min(capX, ox));
  oz = Math.max(-capZ, Math.min(capZ, oz));
  out.x = ox;
  out.z = oz;
  // Zoom needed so the furthest corner of the box fits inside the margin.
  const fx = lx + ox;
  const fz = lz + oz;
  const needX = Math.max(Math.abs(maxX - fx), Math.abs(minX - fx)) / (t.viewHalfX * t.coopMargin);
  const needZ = Math.max(Math.abs(maxZ - fz), Math.abs(minZ - fz)) / (t.viewHalfZ * t.coopMargin);
  out.zoom = Math.min(t.coopMax, Math.max(1, needX, needZ));
}

/**
 * Kill-cam blend 0..1 over its life `t` in [0, dur]: snaps in over the first
 * 12%, holds, then eases back over the last 35%. 0 outside the range.
 */
export function killCamWeight(t: number, dur: number): number {
  if (t < 0 || t >= dur || dur <= 0) return 0;
  const u = t / dur;
  if (u < 0.12) return smooth(u / 0.12);
  if (u < 0.65) return 1;
  return smooth(1 - (u - 0.65) / 0.35);
}

/** How each enemy model moves. */
export type Gait = 'hop' | 'flutter' | 'trundle' | 'stomp' | 'waddle' | 'jiggle' | 'pulse' | 'hover' | 'glide';

export function gaitOf(model: Model): Gait {
  switch (model) {
    case 'burrower':
      return 'waddle';
    case 'mirror':
    case 'swarmqueen':
      return 'hover';
    case 'egg':
      return 'pulse';
    case 'bopper':
    case 'king':
      return 'hop';
    case 'swarmer':
      return 'flutter';
    case 'shooter':
      return 'trundle';
    case 'charger':
    case 'rex':
      return 'stomp';
    case 'exploder':
      return 'waddle';
    case 'splitter':
      return 'jiggle';
    case 'spawner':
      return 'pulse';
    case 'queen':
    case 'omega':
      return 'hover';
    case 'reaper':
      return 'glide';
    case 'shielder':
    case 'mortar':
      return 'trundle';
    case 'medic':
      return 'hover';
    case 'leaper':
      return 'hop';
    case 'golden':
      return 'flutter';
    case 'hive':
      return 'pulse';
    case 'bee':
      return 'flutter';
    case 'shark':
    case 'slug':
      return 'glide';
    case 'snowball':
      return 'glide';
    case 'soldier':
      return 'stomp';
    case 'kite':
      return 'hover';
  }
}

/** Steps per second (one cycle = left + right) for a gait at full walking speed. */
export const GAIT_FREQ: Record<Gait, number> = {
  hop: 1.3, // |sin| gives two hops per cycle
  flutter: 7,
  trundle: 5,
  stomp: 2.2,
  waddle: 3.2,
  jiggle: 2.6,
  pulse: 0.8,
  hover: 0.9,
  glide: 0.7,
};

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Local (forward, side) components of a world XZ vector for something facing
 * `yaw` (rig convention: yaw 0 faces +Z, local +X is world (cos yaw, -sin yaw)).
 */
export function toLocal(vx: number, vz: number, yaw: number, out: { f: number; s: number }): void {
  const sn = Math.sin(yaw);
  const cs = Math.cos(yaw);
  out.f = vx * sn + vz * cs;
  out.s = vx * cs - vz * sn;
}

/**
 * Death fall of the hero: returns height of the body above ground, backward
 * travel and tilt (0 = upright, 1 = flat on its back) at `t` seconds after death.
 */
export function deathFall(t: number, out: { y: number; back: number; tilt: number }): void {
  const air = 0.5;
  if (t < air) {
    const u = t / air;
    out.y = Math.sin(u * Math.PI) * 0.9;
    out.back = u * 1.1;
    out.tilt = smooth(u);
  } else if (t < air + 0.28) {
    const u = (t - air) / 0.28;
    out.y = Math.sin(u * Math.PI) * 0.18;
    out.back = 1.1 + u * 0.25;
    out.tilt = 1;
  } else {
    out.y = 0;
    out.back = 1.35;
    out.tilt = 1;
  }
}
