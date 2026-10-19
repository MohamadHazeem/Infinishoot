/**
 * Online feel and parry latency compensation (fixes lane).
 *
 * 1. Online hit-stop: a real hit-stop would freeze everyone's world, so online
 *    a machine only *looks* frozen for its own hero's heavy hits and parries:
 *    enemies, bullets, particles and animation clocks hold their last drawn
 *    frame for the stop while the simulation keeps running (render-side only).
 *    The host plays its own; a remote hero's stops reach its client as `hs`
 *    skill events, its parries as the existing `pa` event.
 * 2. Parry latency: clients measure their round trip (`hb` heartbeat echoed by
 *    the host) and send it with each parry. The host rewinds by that lag
 *    (capped): an enemy bullet whose path over the last `lag` seconds came
 *    within reach counts, and an enemy bullet that hit the hero within the last
 *    `lag` seconds is undone (life refunded) and reflected. Reach and window
 *    grow a little with ping, capped. The client predicts its parry from its
 *    own view for instant feedback (cosmetic; the host's verdict stands).
 */
import type { Game } from './game';
import type { Hero } from './hero';
import { sfx } from '../audio/sfx';
import { juiceTuning } from './juice';

export const netFeelTuning = {
  /** Online hit-stops (render-side) are this fraction of the solo hit-stop. 0 turns them off. */
  stopScale: 1,
  /** Longest online visual stop (s): long ones look like a stutter while the world keeps going. */
  stopMax: 0.1,
  /** Seconds between client heartbeats (round-trip measurement). */
  heartbeat: 1,
  /** Smoothing of the measured round trip (share of each new sample). */
  rttBlend: 0.3,
  /** Snapshot interpolation delay added to half the round trip (s). */
  interp: 0.05,
  /** Most the host rewinds a parry (s): beyond this, laggy parries aren't trusted. */
  maxRewind: 0.25,
  /** Parry reach grows this much per second of lag, up to reachMaxExtra metres. */
  reachPerSec: 2,
  reachMaxExtra: 0.45,
  /** Parry window grows this much per second of lag, up to windowMaxExtra seconds. */
  windowPerSec: 0.5,
  windowMaxExtra: 0.1,
};

// ---------------------------------------------------------------- pure judgement (unit-tested)

/** How far back (s) the host looks for a client's parry: half the round trip plus interpolation, capped. 0 = unknown. */
export function parryLag(rttMs: number): number {
  if (!(rttMs > 0)) return 0;
  const T = netFeelTuning;
  return Math.min(T.maxRewind, rttMs / 2000 + T.interp);
}

/** Reach (beyond the hero's radius) and window for a remote parry with `lag` seconds of latency. */
export function remoteParry(lag: number, baseReach: number, baseWindow: number): { reach: number; window: number } {
  const T = netFeelTuning;
  return {
    reach: baseReach + Math.min(T.reachMaxExtra, lag * T.reachPerSec),
    window: baseWindow + Math.min(T.windowMaxExtra, lag * T.windowPerSec),
  };
}

/**
 * Was a bullet now at (bx, bz) moving at (vx, vz) within `reach` (plus its
 * radius) of (px, pz) at any time during the last `lag` seconds? Closest
 * approach of the rewound segment to the hero.
 */
export function bulletWasInReach(px: number, pz: number, bx: number, bz: number, vx: number, vz: number, radius: number, reach: number, lag: number): boolean {
  const ax = bx - vx * lag;
  const az = bz - vz * lag;
  const sx = bx - ax;
  const sz = bz - az;
  const l2 = sx * sx + sz * sz;
  let t = l2 > 1e-9 ? ((px - ax) * sx + (pz - az) * sz) / l2 : 1;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + sx * t - px;
  const dz = az + sz * t - pz;
  const rr = reach + radius;
  return dx * dx + dz * dz <= rr * rr;
}

export interface BulletHit {
  /** Sim time of the hit (game.runTime). */
  at: number;
  /** Life it took. */
  dmg: number;
  vx: number;
  vz: number;
}

/** Hits that landed within the rewind (newest last); they are removed from `hits`. */
export function takeRewoundHits(hits: BulletHit[], now: number, lag: number, out: BulletHit[] = []): BulletHit[] {
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (now - h.at <= lag + 1e-6 && h.dmg > 0) {
      out.push(h);
      hits.splice(i--, 1);
    }
  }
  return out;
}

/** Visual stop seconds for a solo hit-stop of `seconds`. */
export function onlineStopTime(seconds: number): number {
  return Math.min(netFeelTuning.stopMax, seconds * netFeelTuning.stopScale * juiceTuning.hitStopScale);
}

// ---------------------------------------------------------------- per-game state

interface FeelState {
  /** Render-side stop left (s). */
  stopT: number;
  /** Client: smoothed round trip (ms, 0 = not measured) and the next heartbeat (performance.now ms). */
  rtt: number;
  nextHb: number;
  /** Client: when the last predicted parry played (performance.now ms). */
  predictedAt: number;
  /** Host: per hero index, the lag (s) of its last parry and its recent bullet hits. */
  lag: number[];
  hits: BulletHit[][];
}

const states = new WeakMap<Game, FeelState>();
export function feelState(g: Game): FeelState {
  let s = states.get(g);
  if (!s) {
    s = { stopT: 0, rtt: 0, nextHb: 0, predictedAt: -1e9, lag: [], hits: [] };
    states.set(g, s);
  }
  return s;
}

// ---------------------------------------------------------------- online hit-stop (render side)

/** Hold the picture for a moment (online only; the simulation keeps running). */
export function onlineStop(g: Game, seconds: number): void {
  const t = onlineStopTime(seconds);
  if (t <= 0) return;
  const s = feelState(g);
  s.stopT = Math.max(s.stopT, t);
  if (seconds >= 0.08) sfx.muffle(t);
}

/** Render: true while the picture is held. Ticks the stop. */
export function tickOnlineStop(g: Game, frameDt: number): boolean {
  const s = states.get(g);
  if (!s || s.stopT <= 0) return false;
  if (!g.online) {
    s.stopT = 0;
    return false;
  }
  s.stopT -= frameDt;
  return true;
}

// ---------------------------------------------------------------- round trip (client)

/** Client, every step: send a heartbeat now and then. */
export function clientHeartbeat(g: Game): void {
  if (!g.client) return;
  const s = feelState(g);
  const now = performance.now();
  if (now < s.nextHb) return;
  s.nextHb = now + netFeelTuning.heartbeat * 1000;
  g.client.send({ t: 'hb', c: now });
}

/** Client: the host echoed a heartbeat. */
export function onHeartbeat(g: Game, m: Record<string, unknown>): void {
  const c = Number(m.c);
  if (!Number.isFinite(c)) return;
  const sample = performance.now() - c;
  if (!(sample >= 0 && sample < 5000)) return;
  const s = feelState(g);
  s.rtt = s.rtt > 0 ? s.rtt + (sample - s.rtt) * netFeelTuning.rttBlend : sample;
}

/** Client: the measured round trip (ms, 0 if unknown). */
export function clientRtt(g: Game): number {
  return Math.round(states.get(g)?.rtt ?? 0);
}

// ---------------------------------------------------------------- parry rewind (host)

/** Host: a parry message arrived with the client's round trip. */
export function noteParryLag(g: Game, h: Hero, rttMs: number): void {
  feelState(g).lag[h.index] = parryLag(rttMs);
}

/** Host: the lag to judge hero h's parry with (0 = local or unknown). */
export function heroParryLag(g: Game, h: Hero): number {
  return h.remote ? (states.get(g)?.lag[h.index] ?? 0) : 0;
}

/** Host: an enemy bullet hit a remote hero (kept briefly so a late parry can undo it). */
export function noteBulletHit(g: Game, h: Hero, dmg: number, vx: number, vz: number): void {
  if (!h.remote || dmg <= 0) return;
  const s = feelState(g);
  const list = (s.hits[h.index] ??= []);
  const now = g.runTime;
  while (list.length && now - list[0].at > netFeelTuning.maxRewind + 0.05) list.shift();
  if (list.length < 8) list.push({ at: now, dmg, vx, vz });
}

const rewound: BulletHit[] = [];
/** Host: undo the bullet hits a late parry would have caught. Calls `reflect` per hit; returns how many. */
export function refundRewoundHits(g: Game, h: Hero, lag: number, reflect: (vx: number, vz: number) => void): number {
  const s = states.get(g);
  const list = s?.hits[h.index];
  if (!list || lag <= 0 || h.player.dead) return 0;
  rewound.length = 0;
  takeRewoundHits(list, g.runTime, lag, rewound);
  const p = h.player;
  for (const hit of rewound) {
    p.hp = Math.min(p.maxHp, p.hp + hit.dmg);
    reflect(hit.vx, hit.vz);
  }
  return rewound.length;
}

// ---------------------------------------------------------------- client prediction

/** Client: was the last parry already shown locally (so the host's `pa` doesn't repeat it)? */
export function parryPredicted(g: Game): boolean {
  const s = states.get(g);
  return !!s && performance.now() - s.predictedAt < 1500;
}

export function markParryPredicted(g: Game, on: boolean): void {
  feelState(g).predictedAt = on ? performance.now() : -1e9;
}
