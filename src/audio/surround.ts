/**
 * Surround stingers: big moments (a boss arriving, the Titan rising, an elite
 * landing, an eclipse, the colossus walking past, a jackpot) play a sweep that
 * travels around your head. Stereo: the pan follows the angle and a low-pass
 * closes while the sound is behind you (a rear cue that works on speakers).
 * HEADPHONES 3D AUDIO: a real HRTF panner moves around the listener (the local
 * hero), so it circles in 3D. A boss arrival goes around you exactly once.
 *
 * Angles: 0 = in front of the hero (the way it faces), +PI/2 = to its right.
 * Local to each machine; triggered from systems/sound2.ts and sfx cues.
 */
import { samples } from './samples';
import { sfx } from './sfx';
import { LaneVoice } from './synthGraph';
import { listenerState, spatialSettings } from './spatial';
import { laneHooks } from './featureCues';

export type SurroundId = 'boss' | 'titan' | 'elite' | 'eclipse' | 'colossus' | 'jackpot';
export const SURROUND_IDS: readonly SurroundId[] = ['boss', 'titan', 'elite', 'eclipse', 'colossus', 'jackpot'];

export interface SurroundPath {
  /** Seconds. */
  dur: number;
  /** Start angle (rad). */
  start: number;
  /** Total travel (rad): 2*PI = once around. */
  sweep: number;
  /** HRTF distance from the listener (m). */
  radius: number;
  gain: number;
}

export const SURROUND: Readonly<Record<SurroundId, SurroundPath>> = {
  boss: { dur: 2.6, start: 0, sweep: Math.PI * 2, radius: 6, gain: 0.9 },
  titan: { dur: 3.4, start: Math.PI, sweep: Math.PI * 3, radius: 9, gain: 1 },
  elite: { dur: 1.2, start: -Math.PI / 2, sweep: Math.PI, radius: 5, gain: 0.55 },
  eclipse: { dur: 4.5, start: Math.PI / 2, sweep: Math.PI * 2, radius: 8, gain: 0.7 },
  colossus: { dur: 3.2, start: -Math.PI / 2, sweep: Math.PI, radius: 10, gain: 0.85 },
  jackpot: { dur: 1.8, start: 0, sweep: Math.PI * 4, radius: 4, gain: 0.7 },
};

export const surroundTuning = {
  /** Overall level. */
  gain: 1,
  /** Points in each automation curve. */
  points: 48,
  /** Low-pass when fully behind (stereo mode): the cue that a sound is at your back. */
  rearCutoff: 1800,
  /** Same stinger can't repeat inside this (s). */
  cooldown: 4,
};

/** Angle at progress k (0..1): eased so it starts and lands gently. */
export function surroundAngle(p: SurroundPath, k: number): number {
  const u = Math.max(0, Math.min(1, k));
  const e = u * u * (3 - 2 * u) * 0.35 + u * 0.65; // mostly linear, soft ends
  return p.start + p.sweep * e;
}

/** Stereo pan along the path (sin of the angle). */
export function panCurve(p: SurroundPath, n = surroundTuning.points): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin(surroundAngle(p, i / (n - 1)));
  return out;
}

/** How far behind the listener (0 front .. 1 straight behind) along the path. */
export function rearCurve(p: SurroundPath, n = surroundTuning.points): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, -Math.cos(surroundAngle(p, i / (n - 1))));
  return out;
}

/** Low-pass cutoff curve: open in front, closed toward rearCutoff behind. */
export function cutoffCurve(p: SurroundPath, n = surroundTuning.points): Float32Array {
  const rear = rearCurve(p, n);
  const out = new Float32Array(n);
  const lo = Math.log(surroundTuning.rearCutoff);
  const hi = Math.log(18000);
  for (let i = 0; i < n; i++) out[i] = Math.exp(hi + (lo - hi) * rear[i]);
  return out;
}

/** World positions (x, z pairs) around the listener for the HRTF path. */
export function worldPath(p: SurroundPath, lx: number, lz: number, fx: number, fz: number, n = surroundTuning.points): { x: Float32Array; z: Float32Array } {
  const len = Math.hypot(fx, fz) || 1;
  const ux = fx / len;
  const uz = fz / len;
  // Right-hand side of the facing on the XZ plane (screen right when facing up-screen).
  const rx = -uz;
  const rz = ux;
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = surroundAngle(p, i / (n - 1));
    const c = Math.cos(a) * p.radius;
    const s = Math.sin(a) * p.radius;
    x[i] = lx + ux * c + rx * s;
    z[i] = lz + uz * c + rz * s;
  }
  return { x, z };
}

/** The sound of each stinger (sources into the voice; the voice is panned along its path). */
export function playSurroundRecipe(v: LaneVoice, id: SurroundId): void {
  const d = SURROUND[id].dur;
  switch (id) {
    case 'boss':
      // A brass swell with a rumble under it and a rising whoosh.
      v.swell('sawtooth', 55, 82, d, 0.12, d * 0.4);
      v.swell('sawtooth', 55.6, 83, d, 0.1, d * 0.4);
      v.swell('square', 110, 165, d * 0.9, 0.035, d * 0.5);
      v.noise(d, 0.22, 200, 900, 0.8, 0, d * 0.45);
      v.noise(d * 0.8, 0.12, 1200, 5000, 1.5, d * 0.15, d * 0.5);
      break;
    case 'titan':
      // Stone grinding up out of the ground: sub swell, crunching noise, a deep groan.
      v.swell('sine', 32, 48, d, 0.35, d * 0.6);
      v.swell('triangle', 64, 52, d, 0.08, d * 0.5);
      v.noise(d, 0.32, 140, 420, 0.6, 0, d * 0.5);
      for (let i = 0; i < 7; i++) v.noise(0.12, 0.18, 900, 300, 1.2, 0.3 + i * (d / 8));
      v.swell('sawtooth', 70, 46, d * 0.7, 0.06, d * 0.3, d * 0.3);
      break;
    case 'elite':
      // A fast swoosh that ends on a horn blip.
      v.noise(d, 0.25, 600, 3800, 1.4, 0, d * 0.6);
      v.tone('sawtooth', 233, 233, 0.22, 0.06, d * 0.7);
      v.tone('sawtooth', 311, 311, 0.3, 0.06, d * 0.85);
      break;
    case 'eclipse':
      // A dark choir-like drone circling slowly, a cold wind under it.
      v.swell('sine', 98, 92, d, 0.12, d * 0.5);
      v.swell('sine', 146.8, 138, d, 0.08, d * 0.55);
      v.swell('triangle', 196, 184, d * 0.9, 0.03, d * 0.6);
      v.noise(d, 0.12, 400, 260, 3, 0, d * 0.5);
      break;
    case 'colossus':
      // A body passing by: a huge low whoosh with a boom at the closest point.
      v.noise(d, 0.35, 180, 700, 0.7, 0, d * 0.5);
      v.tone('sine', 70, 30, 0.9, 0.38, d * 0.48);
      v.noise(0.5, 0.3, 300, 80, 0.8, d * 0.48);
      break;
    case 'jackpot':
      // Coins raining all around: a cascade of bright blips and a sparkle.
      for (let i = 0; i < 16; i++) {
        const f = 1318 + ((i * 7) % 5) * 220;
        v.tone('triangle', f, f * 1.02, 0.09, 0.07, i * (d / 18));
      }
      v.noise(d, 0.1, 6000, 9000, 3, 0, 0.1);
      v.tone('square', 1046, 2093, 0.5, 0.04, d - 0.5);
      break;
  }
}

const lastAt = new Map<SurroundId, number>();

/**
 * Play a stinger around the listener. Returns false when it can't (audio
 * locked, muted, on cooldown, or the voice budget is full of more important
 * sounds). `force` skips the cooldown (debug panel).
 */
export function playSurround(id: SurroundId, force = false): boolean {
  const out = sfx.output('sfx');
  if (!out) return false;
  const { ctx, node } = out;
  const now = ctx.currentTime;
  if (!force && now - (lastAt.get(id) ?? -Infinity) < surroundTuning.cooldown) return false;
  const p = SURROUND[id];
  let voice: LaneVoice | null = null;
  const release = samples.budget.acquire('surround', 4, 2, () => voice?.stop());
  if (!release) return false;
  lastAt.set(id, now);
  const gain = ctx.createGain();
  gain.gain.value = p.gain * surroundTuning.gain;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 18000;
  const n = surroundTuning.points;
  let panner: AudioNode;
  if (spatialSettings.headphones && typeof ctx.createPanner === 'function') {
    const pn = ctx.createPanner();
    pn.panningModel = 'HRTF';
    pn.rolloffFactor = 0;
    const L = listenerState();
    const path = worldPath(p, L.x, L.z, L.fx, L.fz, n);
    pn.positionY.value = 0.5;
    pn.positionX.setValueCurveAtTime(path.x, now, p.dur);
    pn.positionZ.setValueCurveAtTime(path.z, now, p.dur);
    panner = pn;
    // The HRTF does the front/back; a light low-pass behind still helps.
    filter.frequency.setValueCurveAtTime(cutoffCurve(p, n).map((f) => Math.min(18000, f * 2.2)), now, p.dur);
  } else {
    const sp = ctx.createStereoPanner();
    sp.pan.setValueCurveAtTime(panCurve(p, n), now, p.dur);
    filter.frequency.setValueCurveAtTime(cutoffCurve(p, n), now, p.dur);
    panner = sp;
  }
  gain.connect(filter).connect(panner).connect(node);
  voice = new LaneVoice(ctx, gain, release, [gain, filter, panner]);
  playSurroundRecipe(voice, id);
  return true;
}

// sfx cues with a stinger (src/audio/featureCues.ts) reach it through this hook.
laneHooks.surround = (id) => void playSurround(id);

/** Tests: forget cooldowns. */
export function resetSurround(): void {
  lastAt.clear();
}
