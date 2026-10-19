/**
 * The invisible arena crowd. A synthesized bed (two bands of looped noise:
 * a low murmur and a brighter chatter, panned apart) swells with how exciting
 * the fight is, and one-shot reactions play on top: cheers (a noise roar plus
 * a handful of "yay" formant voices), applause, whistles, "oohs", gasps, boos
 * and an "aww". Everything is on the effects bus (the announcer duck already
 * applies) and also dips under any voice line (boss lines, announcer, barks,
 * the radio DJ). Local to each machine: systems/sound2.ts derives the moments
 * from synced state. SETTINGS > CROWD turns it off.
 */
import { samples } from './samples';
import { sfx } from './sfx';
import { LaneVoice, noiseBuffer } from './synthGraph';
import { VOWELS } from './voice';

export const crowdSettings = { enabled: true };

export type CrowdReaction = 'cheer' | 'roar' | 'applause' | 'whistle' | 'ooh' | 'gasp' | 'boo' | 'aww';
export const CROWD_REACTIONS: readonly CrowdReaction[] = ['cheer', 'roar', 'applause', 'whistle', 'ooh', 'gasp', 'boo', 'aww'];

export const crowdTuning = {
  /** Overall crowd level (a cheer peaks near 0.15 before bus volumes). */
  gain: 1.4,
  /** Bed level at excitement 0 and 1. */
  bedMin: 0.012,
  bedMax: 0.07,
  /** The crowd's level while somebody is talking. */
  speechDuck: 0.35,
  /** Seconds before the same reaction can play again. */
  cooldown: { cheer: 2.5, roar: 6, applause: 5, whistle: 3, ooh: 2.2, gasp: 2.8, boo: 6, aww: 5 } as Record<CrowdReaction, number>,
  /** Any two reactions at least this far apart (s), so they don't pile up. */
  gap: 0.6,
  /** Voices in a cheer / ooh / boo (each is one oscillator and two band-passes). */
  voices: 7,
};

/** A reaction's voice-chorus shape: pitch range, contour, vowels, length. */
interface ChorusShape {
  f0: [number, number];
  contour: [number, number];
  from: string;
  to: string;
  dur: [number, number];
  spread: number;
  vol: number;
}
const CHORUS: Partial<Record<CrowdReaction, ChorusShape>> = {
  cheer: { f0: [190, 420], contour: [1, 1.35], from: 'e', to: 'a', dur: [0.35, 0.7], spread: 0.45, vol: 0.05 },
  roar: { f0: [140, 360], contour: [1, 1.25], from: 'a', to: 'a', dur: [0.7, 1.2], spread: 0.5, vol: 0.05 },
  ooh: { f0: [150, 300], contour: [0.95, 1.18], from: 'o', to: 'u', dur: [0.6, 0.9], spread: 0.18, vol: 0.055 },
  boo: { f0: [100, 170], contour: [1, 0.82], from: 'u', to: 'u', dur: [0.8, 1.1], spread: 0.25, vol: 0.06 },
  aww: { f0: [160, 300], contour: [1.1, 0.78], from: 'a', to: 'o', dur: [0.6, 0.9], spread: 0.2, vol: 0.05 },
  gasp: { f0: [260, 420], contour: [1.2, 1.4], from: 'a', to: 'e', dur: [0.15, 0.25], spread: 0.05, vol: 0.03 },
};

/** Pure: the voices of a reaction chorus (tests can check ranges without WebAudio). */
export function chorusNotes(kind: CrowdReaction, rand: () => number, voices = crowdTuning.voices): { delay: number; dur: number; f0a: number; f0b: number; pan: number; vol: number }[] {
  const s = CHORUS[kind];
  if (!s) return [];
  const out = [];
  for (let i = 0; i < voices; i++) {
    const f = s.f0[0] + (s.f0[1] - s.f0[0]) * rand();
    out.push({
      delay: rand() * s.spread,
      dur: s.dur[0] + (s.dur[1] - s.dur[0]) * rand(),
      f0a: f * s.contour[0],
      f0b: f * s.contour[1],
      pan: (i / Math.max(1, voices - 1)) * 1.6 - 0.8,
      vol: s.vol * (0.7 + rand() * 0.5),
    });
  }
  return out;
}

/** Pure: when the crowd claps (s from the start) for an applause of `length` seconds. */
export function clapTimes(length: number, rand: () => number, rate = 22): number[] {
  const out: number[] = [];
  const n = Math.min(48, Math.round(length * rate));
  for (let i = 0; i < n; i++) out.push(rand() * length * (0.6 + 0.4 * rand()));
  return out.sort((a, b) => a - b);
}

interface Bed {
  out: GainNode;
  low: GainNode;
  high: GainNode;
  nodes: AudioNode[];
  srcs: AudioBufferSourceNode[];
}

export class Crowd {
  private bed: Bed | null = null;
  private last = new Map<CrowdReaction, number>();
  private any = -Infinity;
  private ctxRef: BaseAudioContext | null = null;
  /** 0..1, set by update(). */
  excitement = 0;
  /** Last reaction that played (tests, debug). */
  lastReaction: CrowdReaction | null = null;
  playing = 0;
  constructor(private rand: () => number = Math.random) {}

  /** Every frame: bed level from excitement; `talking` dips it under voices. Off outside fights. */
  update(excitement: number, active: boolean, talking: boolean): void {
    this.excitement = Math.max(0, Math.min(1, excitement));
    const out = sfx.output('sfx');
    if (!out) return;
    const on = active && crowdSettings.enabled;
    if (!on && !this.bed) return;
    if (!this.bed || this.ctxRef !== out.ctx) this.bed = this.makeBed(out.ctx, out.node);
    const t = out.ctx.currentTime;
    const T = crowdTuning;
    const level = on ? (T.bedMin + (T.bedMax - T.bedMin) * this.excitement) * T.gain * (talking ? T.speechDuck : 1) : 0;
    this.bed.out.gain.setTargetAtTime(level, t, on ? 0.35 : 0.2);
    // The chatter band brightens as they get louder.
    this.bed.high.gain.setTargetAtTime(0.35 + this.excitement * 0.65, t, 0.4);
    if (!on && this.bed.out.gain.value < 0.0005) this.dropBed();
  }

  private makeBed(ctx: BaseAudioContext, dest: AudioNode): Bed {
    this.dropBed();
    this.ctxRef = ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(dest);
    const nodes: AudioNode[] = [out];
    const srcs: AudioBufferSourceNode[] = [];
    const band = (hz: number, q: number, pan: number, offset: number): GainNode => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = hz;
      f.Q.value = q;
      const g = ctx.createGain();
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      src.connect(f).connect(g).connect(p).connect(out);
      src.start(ctx.currentTime, offset);
      nodes.push(src, f, g, p);
      srcs.push(src);
      return g;
    };
    const low = band(520, 0.7, -0.45, 0.1);
    band(640, 0.9, 0.45, 0.37);
    const high = band(1900, 1.4, 0.2, 0.61);
    return { out, low, high, nodes, srcs };
  }

  private dropBed(): void {
    const b = this.bed;
    if (!b) return;
    for (const s of b.srcs) {
      try {
        s.stop();
      } catch {
        /* never started */
      }
    }
    for (const n of b.nodes) n.disconnect();
    this.bed = null;
  }

  /** Is a crowd bed running (tests)? */
  get hasBed(): boolean {
    return !!this.bed;
  }

  /**
   * A reaction. `strength` 0..1 scales its size (a bigger cheer for a boss kill
   * than for a combo). Returns false when gated, off or audio isn't running.
   */
  react(kind: CrowdReaction, strength = 1, force = false): boolean {
    if (!crowdSettings.enabled) return false;
    const out = sfx.output('sfx');
    if (!out) return false;
    const { ctx, node } = out;
    const now = ctx.currentTime;
    if (!force && (now - (this.last.get(kind) ?? -Infinity) < crowdTuning.cooldown[kind] || now - this.any < crowdTuning.gap)) return false;
    let voice: LaneVoice | null = null;
    const release = samples.budget.acquire('crowd', kind === 'gasp' || kind === 'boo' ? 3 : 2, 2, () => voice?.stop());
    if (!release) return false;
    this.last.set(kind, now);
    this.any = now;
    this.lastReaction = kind;
    const k = Math.max(0.3, Math.min(1, strength));
    const g = ctx.createGain();
    g.gain.value = crowdTuning.gain * (0.6 + 0.4 * k);
    g.connect(node);
    this.playing++;
    voice = new LaneVoice(ctx, g, () => {
      this.playing--;
      release();
    }, [g]);
    this.recipe(voice, ctx, kind, k);
    return true;
  }

  private chorus(v: LaneVoice, ctx: BaseAudioContext, kind: CrowdReaction, k: number, delay = 0): void {
    const s = CHORUS[kind]!;
    const n = Math.max(2, Math.round(crowdTuning.voices * (0.5 + 0.5 * k)));
    for (const c of chorusNotes(kind, this.rand, n)) {
      const p = ctx.createStereoPanner();
      p.pan.value = c.pan;
      p.connect(v.input);
      v.own(p);
      v.vowel(kind === 'boo' ? 'sawtooth' : 'triangle', c.f0a, c.f0b, c.dur, VOWELS[s.from], VOWELS[s.to], c.vol, delay + c.delay, p);
    }
  }

  private recipe(v: LaneVoice, ctx: BaseAudioContext, kind: CrowdReaction, k: number): void {
    switch (kind) {
      case 'cheer':
        v.noise(1.6 + k * 0.6, 0.12 * k, 1100, 1500, 0.8, 0, 0.15);
        this.chorus(v, ctx, 'cheer', k);
        if (k > 0.6) this.whistle(v, 0.25);
        break;
      case 'roar':
        // The biggest moments: a long roar, chorus, applause and two whistles.
        v.noise(3, 0.16, 800, 1300, 0.7, 0, 0.3);
        this.chorus(v, ctx, 'roar', k);
        this.claps(v, 2.4, 0.5);
        this.whistle(v, 0.4);
        this.whistle(v, 1.1);
        break;
      case 'applause':
        this.claps(v, 2 + k, 0);
        v.noise(2 + k, 0.04, 1600, 1600, 0.8, 0, 0.3);
        break;
      case 'whistle':
        this.whistle(v, 0);
        break;
      case 'ooh':
        this.chorus(v, ctx, 'ooh', k);
        break;
      case 'gasp':
        // A sharp intake of breath across the stands.
        v.noise(0.45, 0.14 * k, 1400, 3600, 1.1, 0, 0.3);
        this.chorus(v, ctx, 'gasp', k);
        break;
      case 'boo':
        this.chorus(v, ctx, 'boo', k);
        v.noise(1, 0.05, 300, 220, 0.8, 0, 0.3);
        break;
      case 'aww':
        this.chorus(v, ctx, 'aww', k);
        break;
    }
  }

  private claps(v: LaneVoice, length: number, delay: number): void {
    for (const t of clapTimes(length, this.rand)) v.noise(0.03, 0.09 + this.rand() * 0.05, 1800 + this.rand() * 1200, 1200, 1.2, delay + t);
  }

  private whistle(v: LaneVoice, delay: number): void {
    // Two-finger whistle: a quick rise, a hold, a fall.
    const f = 1900 + this.rand() * 500;
    v.tone('sine', f * 0.8, f * 1.25, 0.16, 0.05, delay);
    v.tone('sine', f * 1.25, f * 1.1, 0.32, 0.05, delay + 0.16);
  }

  /** Run end: silence the bed (reactions finish on their own). */
  reset(): void {
    this.dropBed();
    this.last.clear();
    this.any = -Infinity;
  }
}

export const crowd = new Crowd();
