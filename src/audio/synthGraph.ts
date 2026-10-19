/**
 * A tiny self-cleaning synth voice for the sound lane's own graphs (surround
 * stingers, the crowd, the radio DJ): tones, noise bursts and formant vowels
 * into one input node. When every source has ended, all its nodes disconnect
 * and `onDone` runs (release the voice-budget lease). `stop()` cuts it early
 * (budget stealing). It implements SynthKit, so the existing recipes (voice
 * syllables, evolution layers) can play through a custom chain.
 */
import type { SynthKit } from './sfx';

const noiseBufs = new WeakMap<BaseAudioContext, AudioBuffer>();
/** One second of white noise per context, shared by every lane voice. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseBufs.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 7;
    for (let i = 0; i < d.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      d[i] = (s >>> 0) / 0x80000000 - 1;
    }
    noiseBufs.set(ctx, b);
  }
  return b;
}

export class LaneVoice implements SynthKit {
  /** Connect sources here (it feeds `dest` through whatever chain the owner built). */
  readonly input: GainNode;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private pending = 0;
  private done = false;
  /** Latest scheduled end (context time). */
  end = 0;

  constructor(readonly ctx: BaseAudioContext, dest: AudioNode, private onDone: () => void = () => {}, extra: AudioNode[] = []) {
    this.input = ctx.createGain();
    this.input.connect(dest);
    this.nodes.push(this.input, ...extra);
    // Nothing scheduled by the end of this tick: release at once.
    queueMicrotask(() => {
      if (this.pending === 0) this.finish();
    });
  }

  /** Extra nodes (chain pieces) disposed with the voice. */
  own(...n: AudioNode[]): void {
    this.nodes.push(...n);
  }

  private track(src: AudioScheduledSourceNode, nodes: AudioNode[], stopAt: number): void {
    this.pending++;
    this.sources.push(src);
    this.nodes.push(...nodes);
    this.end = Math.max(this.end, stopAt);
    src.onended = () => {
      for (const n of nodes) n.disconnect();
      if (--this.pending <= 0) this.finish();
    };
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    for (const n of this.nodes) n.disconnect();
    this.nodes.length = 0;
    this.onDone();
  }

  get finished(): boolean {
    return this.done;
  }

  /** Cut everything now. */
  stop(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.finish();
  }

  tone(wave: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0, dest: AudioNode = this.input): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(Math.max(0.0001, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
    this.track(o, [o, g], t + dur + 0.02);
  }

  /** A tone that swells in (attack seconds) instead of starting at full level. */
  swell(wave: OscillatorType, f0: number, f1: number, dur: number, vol: number, attack: number, delay = 0, dest: AudioNode = this.input): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t + Math.min(attack, dur * 0.9));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
    this.track(o, [o, g], t + dur + 0.02);
  }

  noise(dur: number, vol: number, hz: number, hzEnd = hz, q = 1, delay = 0, attack = 0, dest: AudioNode = this.input): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = dur > 0.9;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(20, hz), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, hzEnd), t + dur);
    const g = ctx.createGain();
    if (attack > 0) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t + Math.min(attack, dur * 0.9));
    } else g.gain.setValueAtTime(Math.max(0.0001, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, (t * 0.31) % 0.5);
    src.stop(t + dur + 0.02);
    this.track(src, [src, f, g], t + dur + 0.02);
  }

  vowel(wave: OscillatorType, f0a: number, f0b: number, dur: number, from: readonly [number, number], to: readonly [number, number], vol: number, delay = 0, dest: AudioNode = this.input): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(Math.max(20, f0a), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f0b), t + dur);
    const f1 = ctx.createBiquadFilter();
    const f2 = ctx.createBiquadFilter();
    f1.type = f2.type = 'bandpass';
    f1.Q.value = 4;
    f2.Q.value = 7;
    f1.frequency.setValueAtTime(from[0], t);
    f1.frequency.linearRampToValueAtTime(to[0], t + dur);
    f2.frequency.setValueAtTime(from[1], t);
    f2.frequency.linearRampToValueAtTime(to[1], t + dur);
    const g2 = ctx.createGain();
    g2.gain.value = 0.6;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t + Math.min(0.03, dur / 4));
    env.gain.setValueAtTime(Math.max(0.0001, vol), t + dur * 0.62);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f1).connect(env);
    o.connect(f2).connect(g2).connect(env);
    env.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
    this.track(o, [o, f1, f2, g2, env], t + dur + 0.02);
  }
}
