/**
 * Rhythm stages (modes lane): enemies step, lunge, shoot and slam on the music's beat, and
 * kills on the beat score big. Pure rules and the beat clock; the Game side lives in
 * src/game/systems/modes.ts.
 *
 * The beat clock is gameplay, so it never reads the audio: the host derives it from the
 * stage track's tempo (src/audio/music/composition.ts, the same `bpm` the music plays) and its
 * own stage clock. Clients get {bpm, t0, b0, t} in the snapshot and run the same function, so
 * every machine agrees on where the beat is. The audio is pulled toward this clock instead
 * (`music.alignBeat`), not the other way round.
 */
import { TRACK_BY_ID, bossTrack } from '../../audio/music/composition';
import { biomeForStage } from '../../data/biomes';

export const rhythmTuning = {
  enabled: true,
  /** Seeded chance that a stage without a special route node is a rhythm stage (from `fromStage`). */
  chance: 0.12,
  fromStage: 2,
  /** On-beat window: seconds before a beat and after it (late is wider: clients see the world a little late). */
  early: 0.07,
  late: 0.13,
  /** On-beat kills: score x this (on top of the normal kill score) and extra combo. */
  killScore: 3,
  comboBonus: 1,
  /** Enemy step pulse: speed x `low` between beats, rising to a peak on the beat; averages x1. */
  low: 0.3,
  /** Exponent of the pulse's fall-off after a beat (2: (1 - phase)^2). */
  sharp: 2,
  /** Enemies squash on every beat (cosmetic). */
  bob: 2.5,
  /** Music: most seconds the audio beat grid moves per frame toward the game's beat. */
  align: 0.002,
};

/** A beat clock: beat(t) = b0 + (t - t0) * bpm / 60, where t is the stage's rhythm time (seconds). */
export interface BeatClock {
  bpm: number;
  t0: number;
  b0: number;
}

export function newClock(bpm: number): BeatClock {
  return { bpm, t0: 0, b0: 0 };
}

/** Beat position (beats since the stage began) at rhythm time `t`. */
export function beatAt(c: BeatClock, t: number): number {
  return c.b0 + ((t - c.t0) * c.bpm) / 60;
}

/** Change tempo at time `t` without a jump in the beat position. */
export function setTempo(c: BeatClock, bpm: number, t: number): void {
  if (bpm === c.bpm) return;
  c.b0 = beatAt(c, t);
  c.t0 = t;
  c.bpm = bpm;
}

/** Fraction of the way to the next beat, [0, 1). */
export function beatPhase(beat: number): number {
  return beat - Math.floor(beat);
}

/** Seconds per beat. */
export function beatSec(bpm: number): number {
  return 60 / Math.max(1, bpm);
}

/** Inside the on-beat window (just after a beat, or just before the next one). */
export function onBeat(beat: number, bpm: number, early = rhythmTuning.early, late = rhythmTuning.late): boolean {
  const p = beatPhase(beat);
  const s = beatSec(bpm);
  return p * s <= late || (1 - p) * s <= early;
}

/** True when a beat fell between two beat positions (this step crossed it). */
export function crossed(prev: number, now: number): boolean {
  return Math.floor(now) > Math.floor(prev);
}

/** Enemy move-speed multiplier at a beat phase: a step that peaks on the beat and averages x1. */
export function stepPulse(phase: number, low = rhythmTuning.low, sharp = rhythmTuning.sharp): number {
  // mean of (1 - p)^sharp over [0, 1) is 1 / (sharp + 1)
  return low + (1 - low) * (sharp + 1) * Math.pow(1 - phase, sharp);
}

/** Tempo of the music the stage plays: its biome's song, or the boss theme once the boss is out. */
export function stageBpm(stage: number, arenaStage: number, boss: boolean): number {
  const id = boss ? bossTrack(stage) : biomeForStage(arenaStage).music;
  return TRACK_BY_ID[id]?.style.bpm ?? 120;
}

/** Seeded roll: is this stage a rhythm stage (when no route node decides)? Same on every machine. */
export function rhythmRoll(seed: number, stage: number, chance = rhythmTuning.chance): boolean {
  if (!rhythmTuning.enabled || stage < rhythmTuning.fromStage) return false;
  let h = (seed ^ Math.imul(stage + 7, 0x27d4eb2d)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 < chance;
}

/** Snapshot form: [bpm, t0, b0, t] (rounded). */
export function clockNet(c: BeatClock, t: number): number[] {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return [c.bpm, r(c.t0), r(c.b0), r(t)];
}
