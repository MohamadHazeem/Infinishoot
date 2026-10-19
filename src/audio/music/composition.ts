import { Rng } from '../../core/rng';
import { biomeForStage } from '../../data/biomes';
import { BIOME_BOSSES, DJ_BPM } from '../../data/bosses3';

export type TrackId = 'architect' | 'candy' | 'ruins' | 'cake' | 'kraken' | 'raid' | 'pvp' | 'gauntlet' | 'titleRemix' | 'pumpking' | 'halloween' | 'title' | 'meadow' | 'dunes' | 'frost' | 'magma' | 'neon' | 'factory' | 'sky' | 'boss' | 'rex' | 'queen' | 'omega' | 'shop' | 'victory' | 'gameover' | 'glitch' | 'boxer' | 'gale';
export type Patch = OscillatorType | 'pluck' | 'bell' | 'wide' | 'organ';
export type Section = 'intro' | 'verse' | 'chorus' | 'bridge' | 'final' | 'turnaround';

export interface Style {
  name: string;
  bpm: number;
  /** MIDI note of the key's root (bass octave). */
  root: number;
  scale: number[];
  lead: Patch;
  arp: Patch;
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
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const HARM_MINOR = [0, 2, 3, 5, 7, 8, 11];

// ---------------------------------------------------------------- authored themes

/** One authored note: start step (16 per bar), scale degree (7 = an octave up), length in steps. */
export type ThemeNote = readonly [step: number, degree: number, len: number];

/**
 * A fixed melody (leitmotif) played over the procedural layers. `notes` span
 * 4 bars (64 steps) and loop; `chords` replace the generated progression in
 * verses and choruses so the tune and the harmony agree. Bridges keep the
 * procedural melody for contrast.
 */
export interface Theme {
  chords: readonly number[];
  notes: readonly ThemeNote[];
}

/**
 * The hero's leitmotif (title): a bright climbing call, I - bVII - IV - v in
 * mixolydian. Its opening cell (4 4 5 | 7) is quoted by the victory fanfare and
 * turned dark (7 7 8 | 7, phrygian dominant) by Omega.
 */
export const HERO_THEME: Theme = {
  chords: [0, 6, 3, 4],
  notes: [
    [0, 4, 2], [2, 4, 1], [3, 5, 1], [4, 7, 4], [8, 4, 2], [10, 2, 2], [12, 4, 4],
    [16, 6, 4], [20, 8, 2], [22, 6, 2], [24, 3, 2], [26, 5, 2], [28, 6, 4],
    [32, 5, 3], [35, 4, 1], [36, 7, 4], [40, 3, 2], [42, 4, 2], [44, 5, 4],
    [48, 4, 4], [52, 6, 2], [54, 5, 2], [56, 4, 6], [62, 2, 2],
  ],
};

/** Omega's theme: the hero's cell made menacing, i - bII - i - bvii in phrygian dominant. */
export const OMEGA_THEME: Theme = {
  chords: [0, 1, 0, 6],
  notes: [
    [0, 7, 2], [2, 7, 1], [3, 8, 1], [4, 7, 4], [8, 4, 2], [10, 5, 2], [12, 4, 4],
    [16, 8, 4], [20, 5, 2], [22, 4, 2], [24, 3, 4], [28, 1, 4],
    [32, 4, 2], [34, 5, 1], [35, 4, 1], [36, 2, 2], [38, 1, 2], [40, 0, 4], [44, 2, 2], [46, 4, 2],
    [48, 6, 4], [52, 8, 2], [54, 7, 2], [56, 6, 4], [60, 8, 2], [62, 7, 2],
  ],
};

/** Victory fanfare (2 bars): the hero cell, a climb, and a long tonic. */
export const VICTORY_THEME: Theme = {
  chords: [0, 0, 0, 0],
  notes: [[0, 4, 2], [2, 4, 1], [3, 5, 1], [4, 7, 4], [8, 4, 2], [10, 5, 2], [12, 9, 4], [16, 7, 14]],
};

/** Per-step lookup of a theme's notes (64 steps). */
export function themeSteps(theme: Theme): (ThemeNote | null)[] {
  const out: (ThemeNote | null)[] = new Array(64).fill(null);
  for (const n of theme.notes) out[n[0] % 64] = n;
  return out;
}

/** Four-bar hooks for the new encounters; bridges still use the seeded generator. */
export const AUDIO3_THEMES: Readonly<Record<string, Theme>> = {
  raid: { chords: [0, 0, 5, 4], notes: [[0, 0, 3], [3, 0, 1], [4, 4, 4], [8, 7, 4], [12, 6, 4], [16, 7, 6], [22, 4, 2], [24, 2, 4], [28, 4, 4], [32, 5, 3], [35, 6, 1], [36, 7, 4], [40, 9, 4], [44, 7, 4], [48, 6, 4], [52, 4, 4], [56, 1, 4], [60, 4, 4]] },
  pvp: { chords: [0, 3, 6, 4], notes: [[0, 7, 1], [3, 4, 1], [6, 7, 2], [10, 9, 2], [14, 7, 2], [16, 8, 2], [20, 5, 2], [23, 8, 1], [26, 10, 2], [30, 8, 2], [32, 6, 2], [35, 9, 1], [38, 6, 2], [42, 4, 2], [46, 2, 2], [48, 4, 2], [52, 6, 2], [56, 8, 2], [60, 7, 4]] },
  gauntlet: { chords: [0, 5, 3, 4], notes: [[0, 0, 2], [2, 4, 2], [4, 7, 2], [8, 6, 2], [10, 4, 2], [12, 2, 4], [16, 5, 2], [18, 7, 2], [20, 9, 4], [26, 7, 2], [28, 5, 4], [32, 3, 2], [34, 5, 2], [36, 7, 4], [42, 8, 2], [44, 7, 4], [48, 4, 2], [50, 6, 2], [52, 8, 2], [56, 7, 6], [62, 4, 2]] },
  glitch: { chords: [0, 0, 5, 6], notes: [[0, 7, 1], [3, 7, 1], [6, 4, 1], [8, 7, 2], [12, 9, 1], [15, 7, 1], [16, 7, 1], [19, 4, 1], [22, 7, 2], [26, 2, 1], [30, 4, 2], [32, 5, 1], [35, 7, 1], [38, 9, 2], [42, 7, 1], [46, 5, 2], [48, 6, 1], [51, 8, 1], [54, 10, 2], [58, 8, 2], [62, 6, 2]] },
  boxer: { chords: [0, 4, 0, 4], notes: [[0, 7, 2], [2, 4, 2], [4, 2, 4], [8, 0, 2], [10, 2, 2], [12, 4, 4], [16, 6, 3], [19, 8, 1], [20, 6, 4], [24, 4, 6], [30, 6, 2], [32, 7, 2], [34, 9, 2], [36, 7, 4], [40, 4, 2], [42, 2, 2], [44, 0, 4], [48, 4, 2], [50, 6, 2], [52, 8, 4], [56, 7, 6], [62, 4, 2]] },
  gale: { chords: [0, 6, 3, 0], notes: [[0, 0, 3], [3, 2, 1], [4, 4, 4], [8, 4, 3], [11, 5, 1], [12, 4, 4], [16, 6, 3], [19, 8, 1], [20, 6, 4], [24, 3, 4], [28, 2, 4], [32, 3, 3], [35, 4, 1], [36, 5, 4], [40, 7, 4], [44, 5, 4], [48, 4, 3], [51, 2, 1], [52, 0, 4], [56, 0, 8]] },
  pumpking: { chords: [0, 5, 3, 4], notes: [[0, 7, 6], [6, 6, 2], [8, 7, 4], [12, 4, 4], [16, 5, 6], [22, 7, 2], [24, 9, 4], [28, 8, 4], [32, 7, 4], [36, 5, 2], [38, 3, 2], [40, 5, 8], [48, 8, 4], [52, 6, 4], [56, 4, 6], [62, 6, 2]] },
  halloween: { chords: [0, 5, 1, 4], notes: [[0, 7, 3], [3, 6, 1], [4, 7, 4], [10, 4, 2], [12, 2, 4], [16, 5, 3], [19, 7, 1], [20, 9, 4], [26, 7, 2], [28, 5, 4], [32, 8, 3], [35, 7, 1], [36, 8, 4], [42, 5, 2], [44, 3, 4], [48, 6, 3], [51, 4, 1], [52, 1, 4], [56, 0, 8]] },
  titleRemix: { chords: [0, 6, 3, 4], notes: HERO_THEME.notes.map(([step, degree, len]) => [step, degree + (step >= 32 ? 7 : 0), len] as const) },
};

export const TRACKS: { id: TrackId; name: string; stage: number; boss?: boolean; bars?: number; theme?: Theme; style: Style }[] = [
  { id: 'title', stage: 0, name: 'Insert Coin', theme: HERO_THEME, style: { name: 'title', bpm: 104, root: 43, scale: MIXO, lead: 'square', arp: 'triangle', bass: 'triangle', padCut: 1400, swing: 0.12, drums: 'half', density: 5 } },
  { id: 'meadow', stage: 1, name: 'Bright Meadow', style: { name: 'meadow', bpm: 128, root: 48, scale: MAJOR, lead: 'pluck', arp: 'bell', bass: 'square', padCut: 1800, swing: 0, drums: 'four', density: 6 } },
  { id: 'dunes', stage: 2, name: 'Sunset Dunes', style: { name: 'dunes', bpm: 112, root: 38, scale: PHRYG_DOM, lead: 'pluck', arp: 'triangle', bass: 'triangle', padCut: 1100, swing: 0.18, drums: 'break', density: 5 } },
  { id: 'frost', stage: 3, name: 'Frosty Peaks', style: { name: 'frost', bpm: 120, root: 40, scale: LYDIAN, lead: 'bell', arp: 'pluck', bass: 'triangle', padCut: 2400, swing: 0, drums: 'half', density: 4 } },
  { id: 'magma', stage: 4, name: 'Magma Isle', style: { name: 'magma', bpm: 140, root: 33, scale: DORIAN, lead: 'wide', arp: 'pluck', bass: 'sawtooth', padCut: 900, swing: 0, drums: 'gallop', density: 7 } },
  // Loop-2 biomes: first heard on stages 5, 6 and 7 (src/data/biomes.ts BIOME_ORDER).
  { id: 'neon', stage: 5, name: 'Neon City', style: { name: 'neon', bpm: 124, root: 37, scale: MINOR, lead: 'square', arp: 'pluck', bass: 'sawtooth', padCut: 1300, swing: 0.1, drums: 'break', density: 6 } },
  { id: 'factory', stage: 6, name: 'Toy Factory', style: { name: 'factory', bpm: 136, root: 45, scale: MIXO, lead: 'square', arp: 'bell', bass: 'square', padCut: 1600, swing: 0.1, drums: 'four', density: 7 } },
  { id: 'sky', stage: 7, name: 'Sky Fortress', style: { name: 'sky', bpm: 132, root: 45, scale: MIXO, lead: 'bell', arp: 'triangle', bass: 'square', padCut: 2600, swing: 0, drums: 'four', density: 5 } },
  { id: 'boss', stage: 1, boss: true, name: 'King Bopper · Crown Bounce', style: { name: 'boss', bpm: 152, root: 35, scale: MIXO, lead: 'square', arp: 'pluck', bass: 'sawtooth', padCut: 1000, swing: 0, drums: 'gallop', density: 8 } },
  { id: 'rex', stage: 2, boss: true, name: 'Rampage Rex · Redline', style: { name: 'rex', bpm: 160, root: 34, scale: MINOR, lead: 'wide', arp: 'square', bass: 'sawtooth', padCut: 850, swing: 0, drums: 'gallop', density: 7 } },
  { id: 'queen', stage: 3, boss: true, name: 'Hive Queen · Royal Flight', style: { name: 'queen', bpm: 146, root: 41, scale: HARM_MINOR, lead: 'bell', arp: 'pluck', bass: 'square', padCut: 2200, swing: 0.08, drums: 'break', density: 6 } },
  { id: 'architect', stage: 12, boss: true, name: 'The Architect · Unwritten Future', theme: OMEGA_THEME, style: { name: 'architect', bpm: 180, root: 36, scale: PHRYG_DOM, lead: 'wide', arp: 'bell', bass: 'sawtooth', padCut: 1800, swing: 0, drums: 'gallop', density: 9 } },
  { id: 'omega', stage: 4, boss: true, name: 'Omega · Last Light', theme: OMEGA_THEME, style: { name: 'omega', bpm: 168, root: 36, scale: PHRYG_DOM, lead: 'wide', arp: 'bell', bass: 'sawtooth', padCut: 1200, swing: 0, drums: 'gallop', density: 8 } },
  // Biome bosses (src/data/bosses3.ts): Glitch DJ plays at DJ_BPM, the tempo its attacks keep.
  { id: 'glitch', theme: AUDIO3_THEMES.glitch, stage: 5, boss: true, name: 'Glitch DJ · Bass Drop', style: { name: 'glitch', bpm: DJ_BPM, root: 37, scale: MINOR, lead: 'square', arp: 'pluck', bass: 'sawtooth', padCut: 1100, swing: 0, drums: 'four', density: 8 } },
  { id: 'boxer', theme: AUDIO3_THEMES.boxer, stage: 6, boss: true, name: 'Boxer Jack · Pop Goes the Beat', style: { name: 'boxer', bpm: 150, root: 43, scale: MIXO, lead: 'bell', arp: 'bell', bass: 'square', padCut: 1500, swing: 0.12, drums: 'gallop', density: 7 } },
  { id: 'gale', theme: AUDIO3_THEMES.gale, stage: 7, boss: true, name: 'Admiral Gale · Stormy Seas', style: { name: 'gale', bpm: 132, root: 38, scale: DORIAN, lead: 'organ', arp: 'triangle', bass: 'sawtooth', padCut: 1400, swing: 0.22, drums: 'break', density: 5 } },
  { id: 'raid', stage: 1, boss: true, name: 'Raid · All Hands', theme: AUDIO3_THEMES.raid, style: { name: 'raid', bpm: 138, root: 33, scale: HARM_MINOR, lead: 'wide', arp: 'bell', bass: 'sawtooth', padCut: 1300, swing: 0, drums: 'half', density: 6 } },
  { id: 'pvp', stage: 0, name: 'Arena · Face Off', theme: AUDIO3_THEMES.pvp, style: { name: 'pvp', bpm: 156, root: 38, scale: DORIAN, lead: 'square', arp: 'pluck', bass: 'sawtooth', padCut: 1600, swing: 0.06, drums: 'break', density: 8 } },
  { id: 'gauntlet', stage: 0, name: 'Gauntlet · Never Yield', theme: AUDIO3_THEMES.gauntlet, style: { name: 'gauntlet', bpm: 148, root: 40, scale: MINOR, lead: 'pluck', arp: 'square', bass: 'sawtooth', padCut: 1500, swing: 0, drums: 'four', density: 7 } },
  { id: 'titleRemix', stage: 0, name: 'Insert Coin · After Hours', theme: AUDIO3_THEMES.titleRemix, style: { name: 'titleRemix', bpm: 112, root: 43, scale: MIXO, lead: 'bell', arp: 'pluck', bass: 'triangle', padCut: 1500, swing: 0.18, drums: 'break', density: 5 } },
  { id: 'pumpking', stage: 2, boss: true, name: 'Pumpking · Pipe Fright', theme: AUDIO3_THEMES.pumpking, style: { name: 'pumpking', bpm: 124, root: 38, scale: HARM_MINOR, lead: 'organ', arp: 'bell', bass: 'triangle', padCut: 950, swing: 0, drums: 'half', density: 5 } },
  { id: 'shop', stage: 0, name: 'Pocket Change', style: { name: 'shop', bpm: 96, root: 43, scale: MAJOR, lead: 'bell', arp: 'pluck', bass: 'triangle', padCut: 1000, swing: 0.2, drums: 'half', density: 4 } },
  { id: 'victory', stage: 1, bars: 2, name: 'Stage Clear!', theme: VICTORY_THEME, style: { name: 'victory', bpm: 132, root: 48, scale: MAJOR, lead: 'square', arp: 'bell', bass: 'triangle', padCut: 2400, swing: 0, drums: 'four', density: 6 } },
  { id: 'gameover', stage: 0, bars: 2, name: 'One More Coin', style: { name: 'gameover', bpm: 88, root: 48, scale: MINOR, lead: 'bell', arp: 'triangle', bass: 'triangle', padCut: 900, swing: 0, drums: 'half', density: 4 } },
  { id: 'halloween', theme: AUDIO3_THEMES.halloween, stage: 2, name: 'Midnight Candy Parade', style: { name: 'halloween', bpm: 116, root: 38, scale: HARM_MINOR, lead: 'sine', arp: 'square', bass: 'triangle', padCut: 750, swing: 0.12, drums: 'half', density: 4 } },
  { id: 'candy', stage: 9, name: 'Candy Kingdom', boss: false, style: { name: 'candy', bpm: 132, root: 48, scale: MAJOR, lead: 'bell', arp: 'bell', bass: 'triangle', padCut: 1600, swing: 0.08, drums: 'break', density: 6 } },
  { id: 'ruins', stage: 10, name: 'Sunken Ruins', boss: false, style: { name: 'ruins', bpm: 108, root: 40, scale: DORIAN, lead: 'pluck', arp: 'bell', bass: 'triangle', padCut: 1600, swing: 0.08, drums: 'break', density: 6 } },
  { id: 'cake', stage: 9, name: 'Cake Tyrant · Sugar Rush', boss: true, style: { name: 'cake', bpm: 150, root: 43, scale: MIXO, lead: 'square', arp: 'bell', bass: 'triangle', padCut: 1600, swing: 0.08, drums: 'break', density: 6 } },
  { id: 'kraken', stage: 10, name: 'Kraken King · Deep Current', boss: true, style: { name: 'kraken', bpm: 138, root: 38, scale: HARM_MINOR, lead: 'organ', arp: 'bell', bass: 'triangle', padCut: 1600, swing: 0.08, drums: 'break', density: 6 } },
];

export const TRACK_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t])) as Record<TrackId, (typeof TRACKS)[number]>;

/** The track for a stage's biome (its data's `music`). */
export function biomeTrack(stage: number): TrackId {
  return biomeForStage(stage).music;
}

// ---------------------------------------------------------------- song generation

export interface Song {
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
  /** Authored leitmotif, if the track has one. */
  theme?: Theme;
  /** Its notes per step (64). */
  themeAt?: (ThemeNote | null)[];
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

export function makeSong(style: Style, seed: number, theme?: Theme): Song {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const picked = rng.pick(PROGRESSIONS);
  const chords = theme ? [...theme.chords] : picked;
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
  return { style, chords, bass, ...drums, melody, arp, ...(theme ? { theme, themeAt: themeSteps(theme) } : {}) };
}


/** Legacy `boss` id remains King Bopper so existing jukebox selections still work. */
export function bossTrack(stage: number): TrackId {
  const rot = (['boss', 'rex', 'queen', 'omega'] as const)[(Math.max(1, Math.floor(stage)) - 1) % 4];
  // Neon City, Toy Factory and Sky Fortress have their own boss and theme (its id is the track id).
  return rot === 'omega' ? rot : ((BIOME_BOSSES[biomeForStage(stage).id] as TrackId | undefined) ?? rot);
}

/** Whole-tone stage modulation, wrapped to keep instruments in their intended register. */
export function stageTranspose(stage: number): number {
  return ((Math.max(1, Math.floor(stage)) - 1) * 2) % 12;
}

/** Four-bar intro, then a 48-bar song. Decide only at phrase boundaries in playback. */
export function sectionAt(bar: number, intensity: number): Section {
  if (bar < 4) return 'intro';
  const b = (bar - 4) % 48;
  if (b >= 44) return 'turnaround';
  if (b >= 36) return 'final';
  if (b >= 32) return 'bridge';
  const chorus = b % 16 >= 8;
  if (chorus) return intensity < 0.3 ? 'verse' : 'chorus';
  return intensity >= 0.72 && b % 8 >= 4 ? 'chorus' : 'verse';
}

const BRIDGE = [5, 1, 3, 4];
const TURNAROUND = [1, 3, 4, 4];
const CHORUS = [0, 4, 5, 3];
export function chordAt(song: Song, section: Section, bar: number): number {
  const chords = section === 'bridge' ? BRIDGE : section === 'turnaround' ? TURNAROUND : song.theme ? song.theme.chords : section === 'chorus' || section === 'final' ? CHORUS : song.chords;
  return chords[bar % 4];
}

export function degreeMidi(style: Style, degree: number, transpose = 0): number {
  return style.root + transpose + style.scale[((degree % 7) + 7) % 7] + 12 * Math.floor(degree / 7);
}

/** Absolute-clock helpers: never derive rhythm from render dt or scheduled-ahead steps. */
export function phaseAt(now: number, beat: number, duration: number): number {
  if (now < beat || duration <= 0) return 0;
  return ((now - beat) / duration) % 1;
}
export function inBeatWindow(now: number, beat: number, duration: number, ms: number): boolean {
  if (duration <= 0 || ms < 0 || !Number.isFinite(ms)) return false;
  if (now < beat) return (beat - now) * 1000 <= ms;
  const phase = phaseAt(now, beat, duration);
  return Math.min(phase, 1 - phase) * duration * 1000 <= ms + 1e-7;
}

export function trackUnlocked(id: TrackId, bestStage: number, bosses: number): boolean {
  const track = TRACK_BY_ID[id];
  return bestStage >= track.stage && (!track.boss || bosses > 0);
}
