import { degreeMidi, type Patch, type Style } from './music/composition';
import type { MusicSynth } from './music/synth';
import { FUSIONS } from '../data/fusions';

export const stemTuning = { slots: 8, gain: 0.032, maxLevel: 10 };
export interface StemWeapon { readonly def: { readonly id: string }; readonly level: number; readonly evolved: boolean }
interface Instrument { patch: Patch; steps: readonly number[]; degrees: readonly number[]; octave: number; length: number; cutoff: number; pan: number; sweep?: boolean }
/** Each weapon has its own rhythm/register, including the two click slots. */
const BASE_STEMS: Readonly<Record<string, Instrument>> = {
  buster: { patch: 'triangle', steps: [0, 6, 10, 14], degrees: [0, 2, 4, 2], octave: 12, length: 0.8, cutoff: 5200, pan: -0.12 },
  charge: { patch: 'bell', steps: [4, 12], degrees: [4, 7], octave: 12, length: 2.8, cutoff: 4200, pan: 0.15 },
  drones: { patch: 'triangle', steps: [0, 2, 4, 6, 8, 10, 12, 14], degrees: [0, 2, 4, 7], octave: 24, length: 0.8, cutoff: 7000, pan: -0.3 },
  aura: { patch: 'sine', steps: [0, 8], degrees: [2, 4], octave: 12, length: 6, cutoff: 2200, pan: 0.22 },
  lightning: { patch: 'square', steps: [1, 4, 7, 10, 13, 15], degrees: [7, 4, 2, 4], octave: 24, length: 0.28, cutoff: 4800, pan: 0.32 },
  discs: { patch: 'pluck', steps: [2, 6, 10, 14], degrees: [4, 2, 0, 2], octave: 24, length: 1.4, cutoff: 8000, pan: -0.35 },
  missiles: { patch: 'sawtooth', steps: [0, 7, 12], degrees: [0, 4, 7], octave: 12, length: 1.5, cutoff: 1500, pan: 0.2, sweep: true },
  mines: { patch: 'triangle', steps: [3, 11], degrees: [0, 4], octave: 0, length: 0.65, cutoff: 800, pan: -0.2 },
  nova: { patch: 'bell', steps: [2, 10], degrees: [7, 4], octave: 24, length: 3, cutoff: 6000, pan: 0.38 },
  fire: { patch: 'sawtooth', steps: [0, 3, 6, 8, 11, 14], degrees: [0, 0, 4, 2], octave: -12, length: 1.2, cutoff: 900, pan: 0 },
  scatter: { patch: 'square', steps: [4, 12], degrees: [0, 4], octave: 12, length: 0.5, cutoff: 1800, pan: -0.2 },
  laser: { patch: 'wide', steps: [0, 8], degrees: [4, 2], octave: 12, length: 6, cutoff: 4200, pan: 0.25, sweep: true },
  orb: { patch: 'bell', steps: [1, 5, 9, 13], degrees: [0, 4, 2, 7], octave: 12, length: 2, cutoff: 3200, pan: -0.25 },
  grenade: { patch: 'square', steps: [6, 14], degrees: [4, 0], octave: 0, length: 1, cutoff: 1100, pan: 0.12 },
  well: { patch: 'wide', steps: [0], degrees: [0, 2], octave: 0, length: 12, cutoff: 900, pan: -0.18, sweep: true },
  shield: { patch: 'bell', steps: [4, 10], degrees: [2, 4], octave: 12, length: 2, cutoff: 2400, pan: 0.18 },
  rail: { patch: 'pluck', steps: [3, 11], degrees: [7, 4], octave: 24, length: 0.6, cutoff: 9000, pan: -0.3 },
  orbital: { patch: 'sawtooth', steps: [0, 10], degrees: [0, 7], octave: 12, length: 2, cutoff: 1800, pan: 0.3, sweep: true },
  sweeper: { patch: 'wide', steps: [4, 12], degrees: [2, 4], octave: 12, length: 3, cutoff: 3000, pan: -0.22, sweep: true },
  pellets: { patch: 'square', steps: [2, 6, 10, 14], degrees: [0, 2, 4, 2], octave: 12, length: 0.3, cutoff: 2000, pan: 0.22 },
  bouncer: { patch: 'pluck', steps: [0, 5, 8, 13], degrees: [0, 4, 7, 4], octave: 12, length: 1.3, cutoff: 5500, pan: -0.38 },
  starfall: { patch: 'bell', steps: [3, 7, 11, 15], degrees: [7, 4, 2, 0], octave: 24, length: 2, cutoff: 6500, pan: 0.35 },
  // Hero kits (heroes3 lane)
  katana: { patch: 'pluck', steps: [0, 3, 6, 12], degrees: [0, 4, 7, 4], octave: 12, length: 0.5, cutoff: 7000, pan: -0.1 },
  iaido: { patch: 'wide', steps: [8], degrees: [7], octave: 12, length: 3, cutoff: 5200, pan: 0.15, sweep: true },
  beacon: { patch: 'square', steps: [2, 6, 10, 14], degrees: [4, 4, 7, 4], octave: 24, length: 0.4, cutoff: 3600, pan: 0.2 },
};
/** A fused weapon plays its first part's rhythm through its second part's patch, merged rhythms, an octave up. */
function fusedStem(a: Instrument, b: Instrument): Instrument {
  const steps = [...new Set([...a.steps, ...b.steps])].sort((x, y) => x - y).slice(0, 8);
  return { ...a, patch: b.patch, steps, octave: Math.min(24, a.octave + 12), cutoff: Math.max(a.cutoff, b.cutoff), sweep: a.sweep || b.sweep };
}
export const WEAPON_STEMS: Readonly<Record<string, Instrument>> = {
  ...BASE_STEMS,
  ...Object.fromEntries(FUSIONS.filter((f) => BASE_STEMS[f.parts[0]] && BASE_STEMS[f.parts[1]]).map((f) => [f.id, fusedStem(BASE_STEMS[f.parts[0]], BASE_STEMS[f.parts[1]])])),
};
export function stemIntensity(level: number): number {
  return 0.4 + 0.6 * (Math.max(1, Math.min(stemTuning.maxLevel, Number.isFinite(level) ? level : 1)) - 1) / (stemTuning.maxLevel - 1);
}
/** Sparse ranks keep the instrument's first hit; later ranks fill its rhythm. */
export function stemHit(instrument: Instrument, step: number, intensity: number): number {
  const index = instrument.steps.indexOf(step);
  return index >= 0 && (index === 0 || index % 2 === 0 || intensity >= 0.6) ? index : -1;
}

/** Fixed slots, copied only at downbeats. Retiring songs retain their own build. */
export class WeaponStems {
  private readonly slots;
  constructor(ctx: AudioContext, out: AudioNode, nodes: AudioNode[]) {
    this.slots = Array.from({ length: stemTuning.slots }, () => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const pan = ctx.createStereoPanner();
      gain.connect(filter).connect(pan).connect(out);
      nodes.push(gain, filter, pan);
      return { instrument: null as Instrument | null, intensity: 0, evolved: false, gain, filter, pan };
    });
  }
  /** `mul` scales every stem (the boss duel makes your stems answer louder, then pulls them back). */
  commit(weapons: readonly StemWeapon[], t: number, mul = 1): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const w = weapons[i];
      slot.instrument = w ? WEAPON_STEMS[w.def.id] ?? null : null;
      slot.intensity = w ? stemIntensity(w.level) : 0;
      slot.evolved = w?.evolved ?? false;
      slot.gain.gain.setTargetAtTime(slot.instrument ? mul * stemTuning.gain * slot.intensity / Math.sqrt(Math.max(1, weapons.length / 2)) : 0, t, 0.025);
      if (slot.instrument) {
        slot.pan.pan.setValueAtTime(slot.instrument.pan, t);
        slot.filter.frequency.setValueAtTime(slot.instrument.cutoff, t);
      }
    }
  }
  play(synth: MusicSynth, style: Style, chord: number, transpose: number, step: number, t: number, d: number): void {
    for (const slot of this.slots) {
      const inst = slot.instrument;
      if (!inst) continue;
      const index = stemHit(inst, step % 16, slot.intensity);
      if (index >= 0) {
        if (inst.sweep) {
          slot.filter.frequency.setValueAtTime(inst.cutoff * 0.25, t);
          slot.filter.frequency.exponentialRampToValueAtTime(inst.cutoff, t + d * inst.length * 0.65);
        }
        synth.note(slot.gain, inst.patch, degreeMidi(style, chord + inst.degrees[index % inst.degrees.length], transpose) + inst.octave, t, d * inst.length, 0.7);
      }
      // One upper-register turnaround flourish per evolved instrument, every other bar.
      if (slot.evolved && step % 32 === 31) synth.note(slot.gain, 'bell', degreeMidi(style, chord + 7, transpose) + 24, t, d * 0.8, 0.45);
    }
  }
}
