/**
 * Hero voice: synthesized formant "gibberish" barks (Banjo / Animal Crossing
 * style). A bark is a few sung syllables: a consonant tick, then a vowel made
 * of a glottal wave through two formant band-passes. Each hero has its own
 * pitch, vocal-tract size, speed and timbre; co-op players are shifted apart.
 *
 * Pure composition lives here (testable without WebAudio); src/audio/heroVoice.ts
 * decides when to speak (rate limits, settings, captions).
 */
import type { SynthKit } from './sfx';

export type BarkKind = 'hurt' | 'lowLife' | 'levelUp' | 'evolve' | 'revive' | 'victory' | 'death' | 'dash' | 'parry' | 'dodge';
export const BARK_KINDS: readonly BarkKind[] = ['hurt', 'lowLife', 'levelUp', 'evolve', 'revive', 'victory', 'death', 'dash', 'parry', 'dodge'];

export const voiceTuning = {
  /** Silence after a bark before the same hero barks again (s), unless the new bark outranks it. */
  gap: 0.5,
  /** Any two low-priority barks (any hero) are at least this far apart (s). */
  globalGap: 0.25,
  /** Overall bark loudness (the VOICE volume slider is separate). Formant voices peak near 0.2 at 1. */
  gain: 0.8,
  /** Syllable length multiplier. */
  speed: 1,
};

export interface VoiceProfile {
  /** Speaking pitch (Hz). */
  f0: number;
  /** Vocal-tract scale for the formants (bigger = smaller head, brighter). */
  tract: number;
  /** Seconds per syllable. */
  syl: number;
  wave: OscillatorType;
  /** Consonants this hero favours (b, d, k, m, n, p, s, t, w). */
  consonants: string;
}

/** Per-hero voices (src/data/heroes.ts ids). Unknown heroes get one derived from their id. */
export const HERO_VOICES: Readonly<Record<string, VoiceProfile>> = {
  rookie: { f0: 250, tract: 1.1, syl: 0.085, wave: 'sawtooth', consonants: 'btkmw' },
  bulwark: { f0: 120, tract: 0.82, syl: 0.115, wave: 'sawtooth', consonants: 'bdmn' },
  dash: { f0: 330, tract: 1.22, syl: 0.066, wave: 'square', consonants: 'tskp' },
  ace: { f0: 195, tract: 1.0, syl: 0.08, wave: 'square', consonants: 'pkns' },
  duelist: { f0: 230, tract: 1.06, syl: 0.07, wave: 'square', consonants: 'tsdk' },
  furnace: { f0: 105, tract: 0.78, syl: 0.125, wave: 'sawtooth', consonants: 'bmdw' },
  twin: { f0: 290, tract: 1.16, syl: 0.075, wave: 'triangle', consonants: 'pnmt' },
};
/** Co-op: each player slot shifts the voice so two Rookies still sound like two people. */
export const PLAYER_SHIFT = [1, 1.13, 0.88, 1.26];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function voiceProfile(heroId: string, playerIndex = 0): VoiceProfile {
  const h = hash(heroId);
  const base = HERO_VOICES[heroId] ?? {
    f0: 150 + (h % 180),
    tract: 0.85 + ((h >>> 8) % 40) / 100,
    syl: 0.07 + ((h >>> 16) % 4) * 0.012,
    wave: (h >>> 20) % 2 ? 'square' : 'sawtooth',
    consonants: 'bkmt',
  };
  const shift = PLAYER_SHIFT[((playerIndex % PLAYER_SHIFT.length) + PLAYER_SHIFT.length) % PLAYER_SHIFT.length];
  return { ...base, f0: base.f0 * shift, tract: base.tract * (1 + (shift - 1) * 0.5) };
}

/** Formants (F1, F2) for an adult-ish voice; scaled by the profile's tract. */
export const VOWELS: Readonly<Record<string, readonly [number, number]>> = {
  a: [800, 1250],
  e: [480, 1900],
  i: [300, 2300],
  o: [520, 900],
  u: [330, 800],
};

export interface BarkDef {
  /** Syllable count (min, max). */
  syllables: [number, number];
  /** Pitch contour across the bark: start and end multipliers of f0. */
  contour: [number, number];
  /** Vowels to pick from. */
  vowels: string;
  /** Syllable length multiplier. */
  length: number;
  vol: number;
  /** Caption lines (one is picked). */
  captions: string[];
  /** Per hero cooldown (s). */
  cooldown: number;
  /** Chance a qualifying moment actually barks. */
  chance: number;
  /** Higher priorities interrupt a hero's earlier bark. */
  priority: number;
}

export const BARKS: Readonly<Record<BarkKind, BarkDef>> = {
  hurt: { syllables: [1, 1], contour: [1.6, 0.9], vowels: 'ao', length: 1.7, vol: 0.5, captions: ['Ouch!', 'Ow!', 'Oof!'], cooldown: 1.6, chance: 0.55, priority: 1 },
  lowLife: { syllables: [2, 2], contour: [0.95, 0.72], vowels: 'ue', length: 1.6, vol: 0.4, captions: ['Ugh... need help!', 'Running on fumes!'], cooldown: 18, chance: 1, priority: 2 },
  levelUp: { syllables: [3, 3], contour: [1, 1.45], vowels: 'eai', length: 1, vol: 0.5, captions: ['Yeah!', 'Level up!', 'Getting stronger!'], cooldown: 5, chance: 0.85, priority: 2 },
  evolve: { syllables: [4, 5], contour: [1, 1.7], vowels: 'aoi', length: 1, vol: 0.55, captions: ['Whoa! It evolved!', 'Check this out!'], cooldown: 3, chance: 1, priority: 3 },
  revive: { syllables: [2, 3], contour: [1.3, 1], vowels: 'aeu', length: 1.1, vol: 0.5, captions: ['Thanks!', 'Back in action!'], cooldown: 4, chance: 1, priority: 3 },
  victory: { syllables: [4, 5], contour: [1.1, 1.5], vowels: 'aoei', length: 1, vol: 0.55, captions: ['We did it!', 'Too easy!', 'Yahoo!'], cooldown: 6, chance: 1, priority: 3 },
  death: { syllables: [3, 3], contour: [1.2, 0.55], vowels: 'oau', length: 1.8, vol: 0.5, captions: ['Nooo...', "I'm done for..."], cooldown: 5, chance: 1, priority: 4 },
  dash: { syllables: [1, 1], contour: [1.1, 1.3], vowels: 'u', length: 0.7, vol: 0.35, captions: ['Hup!'], cooldown: 4, chance: 0.22, priority: 0 },
  parry: { syllables: [1, 1], contour: [1.3, 1.6], vowels: 'a', length: 0.8, vol: 0.45, captions: ['Ha!', 'Not today!'], cooldown: 2.5, chance: 0.6, priority: 1 },
  dodge: { syllables: [2, 2], contour: [1.2, 1.5], vowels: 'oa', length: 0.8, vol: 0.45, captions: ['Whoa!', 'Too slow!'], cooldown: 3, chance: 0.6, priority: 1 },
};

export interface Syllable {
  delay: number;
  dur: number;
  f0a: number;
  f0b: number;
  from: readonly [number, number];
  to: readonly [number, number];
  consonant: string;
  vol: number;
}

/** A composed bark, ready to play. `speaker` keys the per-hero rate limit. */
export interface Utterance {
  speaker: string;
  kind: BarkKind;
  wave: OscillatorType;
  syllables: Syllable[];
  caption: string;
  /** Total length (s). */
  length: number;
}

const scaleF = (v: readonly [number, number], k: number): [number, number] => [v[0] * k, v[1] * k];

/** Compose a bark. `rand` is any 0..1 source (cosmetic, so Math.random is fine). */
export function compose(kind: BarkKind, profile: VoiceProfile, speaker: string, rand: () => number = Math.random): Utterance {
  const b = BARKS[kind];
  const n = b.syllables[0] + Math.floor(rand() * (b.syllables[1] - b.syllables[0] + 1));
  const syl = profile.syl * b.length * voiceTuning.speed;
  const syllables: Syllable[] = [];
  let t = 0;
  let vowel = b.vowels[Math.floor(rand() * b.vowels.length)];
  for (let i = 0; i < n; i++) {
    const k0 = n === 1 ? 0 : i / (n - 1);
    const k1 = n === 1 ? 1 : Math.min(1, (i + 0.8) / (n - 1));
    const jitter = 1 + (rand() - 0.5) * 0.12;
    const f0a = profile.f0 * (b.contour[0] + (b.contour[1] - b.contour[0]) * k0) * jitter;
    const f0b = profile.f0 * (b.contour[0] + (b.contour[1] - b.contour[0]) * k1) * jitter;
    const next = b.vowels[Math.floor(rand() * b.vowels.length)];
    const dur = syl * (i === n - 1 ? 1.5 : 0.85 + rand() * 0.3);
    syllables.push({
      delay: t,
      dur,
      f0a,
      f0b,
      from: scaleF(VOWELS[vowel], profile.tract),
      to: scaleF(VOWELS[next], profile.tract),
      consonant: profile.consonants[Math.floor(rand() * profile.consonants.length)] ?? '',
      vol: b.vol * voiceTuning.gain * (i === 0 ? 1 : 0.85),
    });
    vowel = next;
    t += dur + syl * 0.15;
  }
  return { speaker, kind, wave: profile.wave, syllables, caption: b.captions[Math.floor(rand() * b.captions.length)], length: t };
}

/** Play a composed bark through the kit (inside an sfx voice group). */
export function speakSyllables(k: SynthKit, u: Utterance): void {
  for (const s of u.syllables) {
    const c = 0.022;
    switch (s.consonant) {
      case 'b':
      case 'p':
        k.noise(c, s.vol * 0.35, 700, 400, 1.5, s.delay);
        break;
      case 'd':
      case 't':
        k.noise(c, s.vol * 0.35, 3800, 2600, 2, s.delay);
        break;
      case 'k':
        k.noise(c, s.vol * 0.4, 2200, 1500, 2, s.delay);
        break;
      case 's':
        k.noise(0.045, s.vol * 0.25, 6500, 7000, 3, s.delay);
        break;
      case 'm':
      case 'n':
      case 'w':
        k.tone('sine', s.f0a, s.f0a, 0.035, s.vol * 0.25, s.delay);
        break;
    }
    const lead = s.consonant === 's' ? 0.04 : c;
    k.vowel(u.wave, s.f0a, s.f0b, s.dur, s.from, s.to, s.vol, s.delay + lead);
  }
}
