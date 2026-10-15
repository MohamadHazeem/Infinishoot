import { Rng } from '../core/rng';
import { sfx } from './sfx';

/**
 * Procedural chiptune music, synthesized with WebAudio (no asset files).
 *
 * Each track is a style (tempo, scale, instruments, drum feel). A song is
 * generated from a style plus a seed, so every stage gets its own tune in the
 * biome's style. Songs have six layers (pad, hats, bass, drums, lead, arp)
 * whose volumes follow `intensity`, so the music thickens as the fight
 * heats up. Changing track crossfades. `keyUp` shifts the song up two
 * semitones at the next bar (the boss's last phase). `pulse` is 1 on each
 * beat and decays, for visuals that bounce to the music.
 */

export type TrackId = 'title' | 'meadow' | 'dunes' | 'frost' | 'magma' | 'boss';

interface Style {
  name: string;
  bpm: number;
  /** MIDI note of the key's root (bass octave). */
  root: number;
  scale: number[];
  lead: OscillatorType;
  arp: OscillatorType;
  bass: OscillatorType;
  /** Pad brightness (low-pass cutoff in Hz). */
  padCut: number;
  /** 0 = straight 16ths, up to ~0.3 = shuffled. */
  swing: number;
  drums: 'four' | 'break' | 'half' | 'gallop';
  /** Notes per bar the melody aims for (density). */
  density: number;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MIXO = [0, 2, 4, 5, 7, 9, 10];
const PHRYG_DOM = [0, 1, 4, 5, 7, 8, 10];
const HARM_MINOR = [0, 2, 3, 5, 7, 8, 11];

export const TRACKS: { id: TrackId; name: string; style: Style }[] = [
  { id: 'title', name: 'Insert Coin', style: { name: 'title', bpm: 104, root: 43, scale: MIXO, lead: 'square', arp: 'triangle', bass: 'triangle', padCut: 1400, swing: 0.12, drums: 'half', density: 5 } },
  { id: 'meadow', name: 'Bright Meadow', style: { name: 'meadow', bpm: 128, root: 48, scale: MAJOR, lead: 'square', arp: 'triangle', bass: 'square', padCut: 1800, swing: 0, drums: 'four', density: 6 } },
  { id: 'dunes', name: 'Sunset Dunes', style: { name: 'dunes', bpm: 112, root: 38, scale: PHRYG_DOM, lead: 'sawtooth', arp: 'triangle', bass: 'triangle', padCut: 1100, swing: 0.18, drums: 'break', density: 5 } },
  { id: 'frost', name: 'Frosty Peaks', style: { name: 'frost', bpm: 120, root: 40, scale: DORIAN, lead: 'triangle', arp: 'square', bass: 'triangle', padCut: 2400, swing: 0, drums: 'half', density: 4 } },
  { id: 'magma', name: 'Magma Isle', style: { name: 'magma', bpm: 140, root: 33, scale: MINOR, lead: 'sawtooth', arp: 'square', bass: 'sawtooth', padCut: 900, swing: 0, drums: 'gallop', density: 7 } },
  { id: 'boss', name: 'Big Trouble', style: { name: 'boss', bpm: 152, root: 35, scale: HARM_MINOR, lead: 'square', arp: 'sawtooth', bass: 'sawtooth', padCut: 1000, swing: 0, drums: 'gallop', density: 8 } },
];

const TRACK_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t])) as Record<TrackId, (typeof TRACKS)[number]>;

/** The track for a stage's biome (biomes cycle every 4 stages). */
export function biomeTrack(stage: number): TrackId {
  return (['meadow', 'dunes', 'frost', 'magma'] as const)[(stage - 1) % 4];
}

// ---------------------------------------------------------------- song generation

interface Song {
  style: Style;
  /** Chord root per bar, as a scale degree (4 bars). */
  chords: number[];
  /** Per 16th step (16): bass note offset in scale degrees from the chord root, or null. */
  bass: (number | null)[];
  kick: boolean[];
  snare: boolean[];
  hat: boolean[];
  /** 4 bars x 16 steps: melody note (scale degree) or null; `len` in steps. */
  melody: ({ deg: number; len: number } | null)[];
  /** Per step: chord-tone index for the arp, or -1. */
  arp: number[];
}

const PROGRESSIONS = [
  [0, 5, 3, 4],
  [0, 3, 4, 4],
  [0, 4, 5, 3],
  [5, 3, 0, 4],
  [0, 6, 5, 4],
  [0, 3, 5, 4],
  [0, 0, 3, 4],
];

const BASS_PATTERNS: (number | null)[][] = [
  [0, null, 0, null, 0, null, 0, null, 0, null, 0, null, 0, null, 0, null],
  [0, null, null, 0, null, null, 0, null, 0, null, null, 0, null, null, 4, null],
  [0, null, 7, null, 0, null, 7, null, 0, null, 7, null, 0, null, 7, 4],
  [0, 0, null, 0, null, 0, 0, null, 0, 0, null, 0, null, 4, 2, null],
  [0, null, null, null, 4, null, null, null, 0, null, null, null, 4, null, 2, null],
];

function drumPattern(kind: Style['drums'], rng: Rng): { kick: boolean[]; snare: boolean[]; hat: boolean[] } {
  const on = (s: string) => [...s].map((c) => c === 'x');
  switch (kind) {
    case 'four':
      return { kick: on('x...x...x...x...'), snare: on('....x.......x...'), hat: on(rng.chance(0.5) ? '..x...x...x...x.' : 'x.x.x.x.x.x.x.x.') };
    case 'break':
      return { kick: on(rng.chance(0.5) ? 'x.....x...x.....' : 'x......x..x.....'), snare: on('....x.......x..x'), hat: on('x.x.x.xxx.x.x.x.') };
    case 'half':
      return { kick: on('x.........x.....'), snare: on('........x.......'), hat: on('x...x...x...x...') };
    case 'gallop':
      return { kick: on('x..xx..xx..xx..x'), snare: on('....x.......x...'), hat: on('xxxxxxxxxxxxxxxx') };
  }
}

export function makeSong(style: Style, seed: number): Song {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const chords = rng.pick(PROGRESSIONS);
  const bass = rng.pick(BASS_PATTERNS);
  const drums = drumPattern(style.drums, rng);
  // Melody: a 2-bar motif, repeated with a varied ending (A A' / A B).
  const motif: ({ deg: number; len: number } | null)[] = new Array(32).fill(null);
  let deg = rng.int(2, 6);
  const p = style.density / 8;
  for (let s = 0; s < 32; s += 2) {
    const strong = s % 8 === 0;
    if (!strong && !rng.chance(p)) continue;
    // Strong beats land on chord tones (0, 2, 4 above the bar's chord root).
    const bar = Math.floor(s / 16);
    if (strong) deg = chords[bar] + rng.pick([0, 2, 4, 7]);
    else deg += rng.pick([-2, -1, -1, 1, 1, 2]);
    deg = Math.max(0, Math.min(11, deg));
    const len = rng.chance(0.3) ? 4 : 2;
    motif[s] = { deg, len };
  }
  const melody = [...motif, ...motif];
  // Second half: re-target the last bar to the 4th chord and vary a few notes.
  for (let s = 48; s < 64; s += 2) {
    const n = melody[s];
    if (!n) continue;
    melody[s] = { deg: Math.max(0, Math.min(11, n.deg + (rng.chance(0.5) ? rng.pick([-2, 2]) : 0) + chords[3] - chords[1])), len: n.len };
  }
  const arpShapes = [
    [0, 1, 2, 1],
    [0, 1, 2, 3],
    [2, 1, 0, 1],
    [0, 2, 1, 3],
  ];
  const shape = rng.pick(arpShapes);
  const arp = Array.from({ length: 16 }, (_, i) => shape[i % shape.length]);
  return { style, chords, bass, ...drums, melody, arp };
}

// ---------------------------------------------------------------- playback

type LayerId = 'pad' | 'hat' | 'bass' | 'drums' | 'lead' | 'arp';
const LAYERS: LayerId[] = ['pad', 'hat', 'bass', 'drums', 'lead', 'arp'];
/** Intensity at which each layer starts and finishes fading in. */
const LAYER_RAMP: Record<LayerId, [number, number]> = {
  pad: [-1, 0],
  hat: [0, 0.15],
  bass: [0.12, 0.3],
  drums: [0.25, 0.45],
  lead: [0.45, 0.65],
  arp: [0.7, 0.9],
};
const LAYER_VOL: Record<LayerId, number> = { pad: 0.05, hat: 0.09, bass: 0.11, drums: 0.3, lead: 0.07, arp: 0.045 };

interface Playing {
  id: TrackId;
  seed: number;
  song: Song;
  out: GainNode;
  filter: BiquadFilterNode;
  layers: Record<LayerId, GainNode>;
  step: number;
  nextTime: number;
  transpose: number;
  wantTranspose: number;
}

export interface MusicWant {
  track: TrackId | null;
  seed: number;
  /** 0 = calm (pad only) .. 1 = everything playing. */
  intensity: number;
  /** Menus over gameplay: quieter and muffled. */
  duck: boolean;
  /** Boss last phase: up two semitones. */
  keyUp: boolean;
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

class Music {
  /** 1 on a beat (bar downbeats), 0.6 on other beats, decaying. */
  pulse = 0;
  /** Beat counter, for anything that alternates per beat. */
  beats = 0;
  /** Jukebox override (set by the jukebox screen). */
  jukebox: TrackId | null = null;
  /** Tracks heard this session (the jukebox also unlocks from save progress). */
  readonly heard = new Set<TrackId>(['title']);

  private cur: Playing | null = null;
  private old: Playing[] = [];
  private noise: AudioBuffer | null = null;
  private beatTimes: { t: number; down: boolean }[] = [];
  private intensity = 0;

  get playing(): TrackId | null {
    return this.cur?.id ?? null;
  }

  /** Call every frame with what should be playing. */
  update(dt: number, want: MusicWant): void {
    this.pulse *= Math.exp(-dt * 7);
    const o = sfx.output('music');
    if (!o) return;
    const { ctx } = o;
    if (this.jukebox) want = { track: this.jukebox, seed: 7 + TRACKS.findIndex((t) => t.id === this.jukebox), intensity: 0.95, duck: false, keyUp: false };

    // Track change: fade the old one out, start the new one.
    if (!this.cur || this.cur.id !== want.track || this.cur.seed !== want.seed) {
      if (this.cur) this.fadeOut(this.cur, ctx);
      this.cur = null;
      if (want.track) {
        this.cur = this.start(want.track, want.seed, ctx, o.node);
        this.heard.add(want.track);
      }
    }
    for (let i = this.old.length - 1; i >= 0; i--) {
      const p = this.old[i];
      if (ctx.currentTime > p.nextTime + 2) {
        p.filter.disconnect();
        this.old.splice(i, 1);
      } else this.schedule(p, ctx, 0.1);
    }
    const p = this.cur;
    if (!p) return;

    // Layer volumes follow a smoothed intensity.
    this.intensity += (want.intensity - this.intensity) * Math.min(1, dt * 1.5);
    const t = ctx.currentTime;
    for (const id of LAYERS) {
      const [a, b] = LAYER_RAMP[id];
      const k = Math.max(0, Math.min(1, (this.intensity - a) / (b - a)));
      p.layers[id].gain.setTargetAtTime(k * LAYER_VOL[id], t, 0.4);
    }
    p.out.gain.setTargetAtTime(want.duck ? 0.45 : 1, t, 0.2);
    p.filter.frequency.setTargetAtTime(want.duck ? 700 : 16000, t, 0.15);
    p.wantTranspose = want.keyUp ? 2 : 0;

    this.schedule(p, ctx, 0.15);
    while (this.beatTimes.length && this.beatTimes[0].t <= t) {
      const b = this.beatTimes.shift()!;
      this.pulse = b.down ? 1 : 0.6;
      this.beats++;
    }
  }

  stop(): void {
    this.jukebox = null;
    const o = sfx.output('music');
    if (this.cur && o) this.fadeOut(this.cur, o.ctx);
    this.cur = null;
  }

  private start(id: TrackId, seed: number, ctx: AudioContext, dest: AudioNode): Playing {
    const song = makeSong(TRACK_BY_ID[id].style, seed);
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 16000;
    out.connect(filter).connect(dest);
    const layers = {} as Record<LayerId, GainNode>;
    for (const l of LAYERS) {
      layers[l] = ctx.createGain();
      layers[l].gain.value = 0;
      layers[l].connect(out);
    }
    this.beatTimes = [];
    return { id, seed, song, out, filter, layers, step: 0, nextTime: ctx.currentTime + 0.1, transpose: 0, wantTranspose: 0 };
  }

  private fadeOut(p: Playing, ctx: AudioContext): void {
    p.out.gain.cancelScheduledValues(ctx.currentTime);
    p.out.gain.setTargetAtTime(0, ctx.currentTime, 0.35);
    // Keep scheduling a little so the fade isn't a cut.
    this.old.push(p);
  }

  private schedule(p: Playing, ctx: AudioContext, ahead: number): void {
    const st = p.song.style;
    const stepDur = 60 / st.bpm / 4;
    // Resync after the tab slept.
    if (p.nextTime < ctx.currentTime - 0.25) p.nextTime = ctx.currentTime + 0.05;
    while (p.nextTime < ctx.currentTime + ahead) {
      const s = p.step % 16;
      if (s === 0) p.transpose = p.wantTranspose;
      const swing = s % 2 === 1 ? st.swing * stepDur : 0;
      this.playStep(p, ctx, p.step, p.nextTime + swing, stepDur);
      if (s % 4 === 0 && p === this.cur) this.beatTimes.push({ t: p.nextTime, down: s === 0 });
      p.step++;
      p.nextTime += stepDur;
    }
  }

  private note(ctx: AudioContext, dest: AudioNode, wave: OscillatorType, midi: number, t: number, dur: number, vol: number, detune = 0): void {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = wave;
    o.frequency.value = midiHz(midi);
    o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(vol * 0.6, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseHit(ctx: AudioContext, dest: AudioNode, t: number, dur: number, vol: number, type: BiquadFilterType, hz: number): void {
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private playStep(p: Playing, ctx: AudioContext, step: number, t: number, stepDur: number): void {
    const song = p.song;
    const st = song.style;
    const s = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const scale = st.scale;
    const root = st.root + p.transpose;
    const degNote = (d: number) => root + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
    const chord = song.chords[bar];
    const L = p.layers;
    const live = (id: LayerId) => L[id].gain.value > 0.0005;

    // Pad: the bar's triad, held.
    if (s === 0 && live('pad')) {
      for (const k of [0, 2, 4]) {
        const m = degNote(chord + k) + 24;
        this.note(ctx, L.pad, 'sawtooth', m, t, stepDur * 16, 0.5, -7);
        this.note(ctx, L.pad, 'sawtooth', m, t, stepDur * 16, 0.5, 7);
      }
    }
    if (song.hat[s] && live('hat')) this.noiseHit(ctx, L.hat, t, s % 4 === 2 ? 0.07 : 0.035, 0.6, 'highpass', 7000);
    const b = song.bass[s];
    if (b !== null && live('bass')) {
      const m = b === 7 ? degNote(chord) + 12 : degNote(chord + b);
      this.note(ctx, L.bass, st.bass, m, t, stepDur * 1.8, 0.9);
    }
    if (live('drums')) {
      if (song.kick[s]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        g.gain.setValueAtTime(1, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        o.connect(g).connect(L.drums);
        o.start(t);
        o.stop(t + 0.3);
      }
      if (song.snare[s]) {
        this.noiseHit(ctx, L.drums, t, 0.16, 0.55, 'bandpass', 1900);
        this.note(ctx, L.drums, 'triangle', 50, t, 0.08, 0.4);
      }
    }
    const n = song.melody[(step % 64) | 0];
    if (n && live('lead')) {
      this.note(ctx, L.lead, st.lead, degNote(n.deg) + 24, t, stepDur * n.len * 0.95, 0.8);
      // Echo an octave up, quieter, for sparkle.
      this.note(ctx, L.lead, 'triangle', degNote(n.deg) + 36, t + stepDur * 3, stepDur * n.len * 0.8, 0.25);
    }
    if (live('arp')) {
      const tones = [0, 2, 4, 7];
      this.note(ctx, L.arp, st.arp, degNote(chord + tones[song.arp[s]]) + 36, t, stepDur * 0.9, 0.7);
    }
  }
}

export const music = new Music();
