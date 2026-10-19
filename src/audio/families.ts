/**
 * Enemy family calls: tiny synthesized voices per enemy family so a crowd is
 * readable by ear (robots beep, slimes squelch, frogs croak, bugs buzz,
 * bosses roar, the Reaper moans). Played on spawn and on attack wind-up,
 * heavily rate-limited on the host before they reach the effects bus.
 */
import type { EnemyDef } from '../data/enemies';
import type { SynthKit } from './sfx';

export type Family = 'robot' | 'slime' | 'frog' | 'bug' | 'boss' | 'ghost';
export const FAMILIES: readonly Family[] = ['robot', 'slime', 'frog', 'bug', 'boss', 'ghost'];

export const familyTuning = {
  /** Seconds between two calls of the same family (host gate). */
  perFamily: 1.1,
  /** Seconds between any two calls (host gate). */
  global: 0.3,
  /** Chance a spawn calls (wind-ups always try). */
  spawnChance: 0.3,
  /** Call loudness. */
  gain: 1,
};

/** An enemy's family: its `voice` field, else from how it looks and dies. */
export function enemyFamily(def: EnemyDef): Family {
  if (def.voice) return def.voice;
  if (def.boss || def.miniboss) return 'boss';
  if (def.behavior === 'reaper') return 'ghost';
  if (def.model === 'leaper' || def.model === 'mortar') return 'frog';
  if (def.model === 'swarmer' || def.model === 'golden' || def.model === 'hive') return 'bug';
  if (def.death === 'goo') return 'slime';
  return 'robot';
}

/** Pitch for a call: bigger enemies (elites, chonks, bosses) sound lower. */
export function callPitch(radius: number, elite: boolean): number {
  const p = 1.25 - Math.min(0.6, Math.max(0, radius - 0.4) * 0.35);
  return Math.max(0.5, elite ? p * 0.75 : p);
}

/** Host-side gate: at most one call per family every `perFamily` s and one call every `global` s. */
export class CallGate {
  private last = new Map<Family, number>();
  private any = -Infinity;
  allow(f: Family, now: number): boolean {
    if (now - this.any < familyTuning.global) return false;
    if (now - (this.last.get(f) ?? -Infinity) < familyTuning.perFamily) return false;
    this.any = now;
    this.last.set(f, now);
    return true;
  }
  reset(): void {
    this.last.clear();
    this.any = -Infinity;
  }
}

export function playCall(k: SynthKit, f: Family, pitch: number): void {
  const p = Math.max(0.4, Math.min(2, pitch || 1)) * (0.95 + Math.random() * 0.1);
  const v = familyTuning.gain;
  if (v <= 0) return;
  switch (f) {
    case 'robot':
      // Two-tone beep-boop.
      k.tone('square', 1320 * p, 1320 * p, 0.05, 0.035 * v);
      k.tone('square', 990 * p, 990 * p, 0.06, 0.035 * v, 0.06);
      break;
    case 'slime':
      // Squelch: a wet band-passed noise gulp sliding down, plus a bloop.
      k.noise(0.12, 0.2 * v, 900 * p, 260 * p, 6);
      k.tone('sine', 380 * p, 160 * p, 0.1, 0.08 * v, 0.02);
      break;
    case 'frog':
      // Ribbit: two short throaty "o" vowels.
      k.vowel('square', 140 * p, 120 * p, 0.07, [450, 900], [380, 800], 0.09 * v);
      k.vowel('square', 150 * p, 110 * p, 0.09, [450, 900], [350, 750], 0.09 * v, 0.1);
      break;
    case 'bug':
      // Buzz: a detuned saw pair with a fast wobble (two slightly offset ramps).
      k.tone('sawtooth', 220 * p, 240 * p, 0.16, 0.025 * v);
      k.tone('sawtooth', 233 * p, 214 * p, 0.16, 0.025 * v);
      k.noise(0.14, 0.05 * v, 3000 * p, 2400 * p, 4);
      break;
    case 'boss':
      // Roar layer: a wide "aaw" vowel on a low growl.
      k.vowel('sawtooth', 75 * p, 55 * p, 0.55, [700, 1100], [500, 850], 0.16 * v);
      k.noise(0.5, 0.18 * v, 380 * p, 120, 1.5);
      break;
    case 'ghost':
      // Hollow "ooo" moan sliding down.
      k.vowel('triangle', 220 * p, 160 * p, 0.7, [300, 870], [320, 700], 0.12 * v);
      break;
  }
}
