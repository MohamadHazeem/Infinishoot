import type { Patch } from './composition';

export const musicTuning = {
  lookahead: 0.15,
  crossfade: 0.65,
  maxVoices: 96,
  padDuck: 0.38,
};

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
interface Voice {
  until: number;
  nodes: AudioNode[];
}

/** Fixed voice bookkeeping, one reusable noise buffer, no timers or per-note closures. */
export class MusicSynth {
  private readonly voices: Voice[] = Array.from({ length: musicTuning.maxVoices }, () => ({ until: 0, nodes: [] }));
  private readonly noise: AudioBuffer;
  readonly output: DynamicsCompressorNode;
  peakVoices = 0;
  droppedVoices = 0;

  constructor(readonly ctx: AudioContext, dest: AudioNode) {
    this.output = ctx.createDynamicsCompressor();
    this.output.threshold.value = -9;
    this.output.knee.value = 6;
    this.output.ratio.value = 4;
    this.output.attack.value = 0.003;
    this.output.release.value = 0.12;
    this.output.connect(dest);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 42;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      data[i] = (seed >>> 0) / 0x80000000 - 1;
    }
  }

  reap(): void {
    for (const voice of this.voices) {
      if (voice.until > 0 && voice.until <= this.ctx.currentTime) {
        for (const node of voice.nodes) node.disconnect();
        voice.nodes.length = 0;
        voice.until = 0;
      }
    }
  }

  private reserve(end: number): Voice | null {
    let free: Voice | null = null;
    let count = 0;
    for (const voice of this.voices) {
      if (voice.until > 0) count++;
      else if (!free) free = voice;
    }
    if (!free) { this.droppedVoices++; return null; }
    free.until = end + 0.03;
    this.peakVoices = Math.max(this.peakVoices, count + 1);
    return free;
  }

  note(dest: AudioNode, patch: Patch, midi: number, t: number, dur: number, vol: number): void {
    const voice = this.reserve(t + dur);
    if (!voice) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const hz = midiHz(midi);
    osc.type = patch === 'bell' ? 'sine' : patch === 'wide' || patch === 'pluck' ? 'sawtooth' : patch;
    osc.frequency.value = hz;
    const attack = Math.min(patch === 'wide' ? 0.025 : 0.008, dur / 4);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + attack);
    env.gain.exponentialRampToValueAtTime(vol * (patch === 'pluck' || patch === 'bell' ? 0.15 : 0.65), t + dur * 0.55);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env);
    voice.nodes.push(osc, env);
    if (patch === 'pluck') {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.min(11000, hz * 9), t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(250, hz * 1.2), t + dur);
      env.connect(filter).connect(dest);
      voice.nodes.push(filter);
    } else env.connect(dest);
    if (patch === 'wide' || patch === 'bell') {
      const second = ctx.createOscillator();
      second.type = patch === 'bell' ? 'sine' : 'sawtooth';
      second.frequency.value = patch === 'bell' ? hz * 2 : hz;
      if (patch === 'bell') {
        const mod = ctx.createGain();
        mod.gain.setValueAtTime(hz * 1.4, t);
        mod.gain.exponentialRampToValueAtTime(0.1, t + dur);
        second.connect(mod).connect(osc.frequency);
        voice.nodes.push(mod);
      } else {
        osc.detune.value = -6;
        second.detune.value = 6;
        second.connect(env);
        // Two detuned carriers share a normalised envelope.
        env.gain.cancelScheduledValues(t);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(vol * 0.5, t + attack);
        env.gain.exponentialRampToValueAtTime(vol * 0.32, t + dur * 0.65);
        env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      }
      second.start(t);
      second.stop(t + dur);
      voice.nodes.push(second);
    }
    osc.start(t);
    osc.stop(t + dur);
  }

  noiseHit(dest: AudioNode, t: number, dur: number, vol: number, hz: number, highpass = false): void {
    const voice = this.reserve(t + dur);
    if (!voice) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = highpass ? 'highpass' : 'bandpass';
    filter.frequency.value = hz;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(vol, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(env).connect(dest);
    src.start(t, (t * 0.137) % 0.5);
    src.stop(t + dur);
    voice.nodes.push(src, filter, env);
  }

  kick(dest: AudioNode, t: number): void {
    const voice = this.reserve(t + 0.26);
    if (!voice) return;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.frequency.setValueAtTime(165, t);
    osc.frequency.exponentialRampToValueAtTime(43, t + 0.11);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.95, t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    osc.connect(env).connect(dest);
    osc.start(t);
    osc.stop(t + 0.26);
    voice.nodes.push(osc, env);
  }

  snare(dest: AudioNode, t: number, accent = 1): void {
    this.noiseHit(dest, t, 0.15, 0.48 * accent, 2100);
    this.note(dest, 'triangle', 50, t, 0.09, 0.32 * accent);
  }
}
