/**
 * Instrument pickups: rare collectibles that add an instrument to the run's
 * soundtrack for the rest of the run (cowbell, a sax-like lead, steel drums,
 * a choir pad, slap bass). The band is a team bitmask synced by the host
 * (src/game/systems/sound2.ts); every machine's music adds the same layers
 * (music stays local). Each instrument has fixed slot nodes (gain, filter,
 * pan) inside the playing song, committed at bar boundaries like the weapon
 * stems, and plays in the song's key, chord and transposition.
 */
import { degreeMidi, type Patch, type Section, type Style } from './music/composition';
import type { MusicSynth } from './music/synth';

export type InstrumentId = 'cowbell' | 'sax' | 'steel' | 'choir' | 'slap';
export const INSTRUMENT_IDS: readonly InstrumentId[] = ['cowbell', 'sax', 'steel', 'choir', 'slap'];

export interface InstrumentDef {
  id: InstrumentId;
  name: string;
  /** Palette colour (Sweetie 16) for the pickup, toast and HUD chip. */
  color: string;
  /** One-line flavour for the toast. */
  blurb: string;
  patch: Patch;
  filter: BiquadFilterType;
  cutoff: number;
  q: number;
  pan: number;
  gain: number;
}

export const INSTRUMENTS: Readonly<Record<InstrumentId, InstrumentDef>> = {
  cowbell: { id: 'cowbell', name: 'Cowbell', color: '#ffcd75', blurb: 'MORE COWBELL!', patch: 'square', filter: 'bandpass', cutoff: 900, q: 3, pan: 0.3, gain: 0.03 },
  sax: { id: 'sax', name: 'Sax', color: '#ef7d57', blurb: 'SMOOTH SAX SOLOS', patch: 'sawtooth', filter: 'bandpass', cutoff: 1300, q: 1.6, pan: -0.25, gain: 0.07 },
  steel: { id: 'steel', name: 'Steel Drum', color: '#73eff7', blurb: 'ISLAND STEEL DRUMS', patch: 'bell', filter: 'lowpass', cutoff: 6000, q: 0.7, pan: 0.35, gain: 0.05 },
  choir: { id: 'choir', name: 'Choir', color: '#b13e53', blurb: 'A HEAVENLY CHOIR', patch: 'wide', filter: 'bandpass', cutoff: 850, q: 1.1, pan: -0.1, gain: 0.05 },
  slap: { id: 'slap', name: 'Slap Bass', color: '#a7f070', blurb: 'FUNKY SLAP BASS', patch: 'pluck', filter: 'lowpass', cutoff: 2600, q: 1.2, pan: 0, gain: 0.08 },
};

export const instrumentTuning = {
  /** Overall level of the band layers. */
  gain: 1,
};

export function maskOf(ids: readonly InstrumentId[]): number {
  let m = 0;
  for (const id of ids) m |= 1 << INSTRUMENT_IDS.indexOf(id);
  return m;
}
export function idsOf(mask: number): InstrumentId[] {
  return INSTRUMENT_IDS.filter((_, i) => mask & (1 << i));
}

/** One note: degree offset from the chord root (or a fixed MIDI note with `midi`), octave, length in steps, volume. */
export interface BandNote {
  deg: number;
  octave: number;
  len: number;
  vol: number;
  midi?: number;
}

const COWBELL_HI = 79.2; // ~800 Hz
const COWBELL_LO = 72.6; // ~540 Hz
const SAX_RIFF: readonly (readonly [number, number, number])[] = [
  // step, degree, length (a two-bar riff that answers the melody in odd bars)
  [0, 4, 3], [4, 2, 2], [6, 4, 2], [8, 7, 4], [12, 6, 2], [14, 4, 2],
];
const STEEL: readonly (readonly [number, number])[] = [[0, 0], [3, 2], [6, 4], [8, 7], [11, 4], [14, 2]];

/**
 * Pure pattern: the notes an instrument plays at `step` (0..15) of `bar`.
 * Sparse in intros and bridges, fuller in choruses.
 */
export function bandNotes(id: InstrumentId, step: number, bar: number, section: Section, out: BandNote[] = []): BandNote[] {
  out.length = 0;
  const full = section === 'chorus' || section === 'final';
  const calm = section === 'intro' || section === 'bridge';
  switch (id) {
    case 'cowbell':
      if (step === 4 || step === 12 || (full && (step === 2 || step === 10 || step === 14)) || (!calm && step === 7)) {
        const v = step % 8 === 4 ? 0.8 : 0.5;
        out.push({ deg: 0, octave: 0, len: 0.6, vol: v, midi: COWBELL_HI }, { deg: 0, octave: 0, len: 0.6, vol: v * 0.8, midi: COWBELL_LO });
      }
      break;
    case 'sax':
      if (calm || bar % 2 === 0) break; // answers in odd bars only
      for (const [s, d, l] of SAX_RIFF) if (s === step) out.push({ deg: d, octave: 12, len: l * 0.95, vol: 0.62 });
      break;
    case 'steel':
      for (const [s, d] of STEEL) if (s === step && (full || s % 6 === 0 || s === 8)) out.push({ deg: d, octave: 24, len: 1.4, vol: 0.55 });
      break;
    case 'choir':
      if (step === 0) for (let k = 0; k < 3; k++) out.push({ deg: k * 2, octave: 12, len: 15.6, vol: 0.4 });
      break;
    case 'slap':
      if (calm && step % 8 !== 0) break;
      if (step === 0 || step === 6 || step === 10) out.push({ deg: 0, octave: 0, len: 1.2, vol: 0.75 });
      else if (step === 3 || step === 13) out.push({ deg: 7, octave: 12, len: 0.6, vol: 0.55 }); // the octave pop
      break;
  }
  return out;
}

/** Fixed slots (one per instrument), connected into a playing song's output. */
export class InstrumentLayers {
  private readonly slots;
  private mask = 0;
  private readonly tmp: BandNote[] = [];
  constructor(ctx: BaseAudioContext, out: AudioNode, nodes: AudioNode[]) {
    this.slots = INSTRUMENT_IDS.map((id) => {
      const d = INSTRUMENTS[id];
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = d.filter;
      filter.frequency.value = d.cutoff;
      filter.Q.value = d.q;
      const pan = ctx.createStereoPanner();
      pan.pan.value = d.pan;
      gain.connect(filter).connect(pan).connect(out);
      nodes.push(gain, filter, pan);
      return { id, def: d, gain };
    });
  }
  /** At a downbeat: which instruments are in the band. */
  commit(mask: number, t: number): void {
    this.mask = mask;
    this.slots.forEach((s, i) => s.gain.gain.setTargetAtTime(mask & (1 << i) ? s.def.gain * instrumentTuning.gain : 0, t, 0.05));
  }
  get active(): number {
    return this.mask;
  }
  play(synth: MusicSynth, style: Style, chord: number, transpose: number, step: number, section: Section, t: number, d: number): void {
    if (!this.mask) return;
    const s = step % 16;
    const bar = Math.floor(step / 16);
    for (let i = 0; i < this.slots.length; i++) {
      if (!(this.mask & (1 << i))) continue;
      const slot = this.slots[i];
      for (const n of bandNotes(slot.id, s, bar, section, this.tmp)) {
        const midi = n.midi ?? degreeMidi(style, chord + n.deg, transpose) + n.octave;
        synth.note(slot.gain, slot.def.patch, midi, t, d * n.len, n.vol);
      }
    }
  }
}
