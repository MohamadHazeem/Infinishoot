/** Recorded layers with immediate synthesized attacks and offline fallback. */
import type { Rarity } from '../data/rarity';
import { samples } from './samples';
import { announcer } from './announcer';
import { cuePriority, cueSamples, distanceCutoff, soundTuning, swarmGap, weaponSamples } from './mix';
import { playEvoLayer } from './evoLayers';
import { playCall, type Family } from './families';
import { playThreat, threatTuning, type ThreatId } from './threats';
import { speakSyllables, type Utterance } from './voice';
import { playUi, type UiCue } from './uiKit';

/** `voice` is the hero-voice volume (VOICE setting). */
export const audioSettings = { volume: 0.5, sfx: 1, music: 0.7, ui: 0.8, voice: 0.8, muted: false };

type Wave = OscillatorType;
/**
 * `threat`: off-screen danger telegraphs. Follows the Effects volume but skips
 * the announcer duck and the hit-stop muffle, so it is never buried.
 * `voice`: hero barks (VOICE volume), ducked under the announcer like effects.
 */
export type Bus = 'sfx' | 'music' | 'ui' | 'threat' | 'voice';

/** Building blocks the cue recipes (evolution layers, calls, telegraphs, voice, UI) play with. */
export interface SynthKit {
  tone(wave: Wave, f0: number, f1: number, dur: number, vol: number, delay?: number): void;
  noise(dur: number, vol: number, hz: number, hzEnd?: number, q?: number, delay?: number): void;
  /** A sung vowel: glottal wave at f0a -> f0b through two formant band-passes (F1, F2) gliding from `from` to `to`. */
  vowel(wave: Wave, f0a: number, f0b: number, dur: number, from: readonly [number, number], to: readonly [number, number], vol: number, delay?: number): void;
}

function busLevel(bus: Bus): number {
  return bus === 'threat' ? audioSettings.sfx : audioSettings[bus];
}

class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private duckGain!: GainNode;
  private duckUntil = 0;
  private reverb: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private voice: { pending: number; release(): void; nodes: AudioNode[]; sources: AudioScheduledSourceNode[] } | null = null;
  crowd = 0;
  private muffler!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;
  private lastPlay = new Map<string, number>();
  /** Where the next sound plays from: stereo pan (-1..1) and distance gain. Set by `at()`. */
  private pan = 0;
  private posGain = 1;
  /** Input node for the sound being built (set by `begin`). */
  private route!: AudioNode;
  // Combo hum: two detuned saws through a low-pass, faded with the combo.
  private hum: { gain: GainNode; filter: BiquadFilterNode; a: OscillatorNode; b: OscillatorNode } | null = null;

  constructor() {
    const unlock = () => {
      this.ensure();
      if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
    } catch {
      return null;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 9;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    this.master.connect(limiter).connect(ctx.destination);
    this.muffler = ctx.createBiquadFilter();
    this.muffler.type = 'lowpass';
    this.muffler.frequency.value = 20000;
    this.muffler.connect(this.master);
    this.buses = { sfx: ctx.createGain(), music: ctx.createGain(), ui: ctx.createGain(), threat: ctx.createGain(), voice: ctx.createGain() };
    this.duckGain = ctx.createGain();
    this.buses.sfx.connect(this.duckGain).connect(this.muffler);
    this.buses.voice.connect(this.duckGain);
    this.buses.music.connect(this.muffler);
    this.buses.ui.connect(this.master);
    // Reserved band: telegraphs bypass the duck and the muffle (straight into the limiter).
    this.buses.threat.connect(this.master);
    this.applyVolumes();
    // 1 s of white noise, reused by every noisy sound.
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    samples.init(ctx, this.buses, (bus) => !audioSettings.muted && audioSettings.volume > 0 && busLevel(bus) > 0);
    announcer.configure(() => ctx.currentTime, (seconds) => this.duck(seconds, 0.4, true));
    return ctx;
  }

  /** Push audioSettings into the bus gains. */
  applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = audioSettings.muted ? 0 : audioSettings.volume;
    this.buses.sfx.gain.value = audioSettings.sfx;
    this.buses.music.gain.value = audioSettings.music;
    this.buses.ui.gain.value = audioSettings.ui;
    this.buses.threat.gain.value = audioSettings.sfx * threatTuning.gain;
    this.buses.voice.gain.value = audioSettings.voice;
  }

  /** The running context and a bus input, for the music player. */
  output(bus: Bus): { ctx: AudioContext; node: AudioNode } | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    return { ctx, node: this.buses[bus] };
  }

  /** A parallel send: the dry signal is preserved, including in dry desert rooms. */
  setReverb(impulse: AudioBuffer, wet: number): void {
    if (!this.ctx) return;
    if (!this.reverb) {
      this.reverb = this.ctx.createConvolver();
      this.reverbGain = this.ctx.createGain();
      this.buses.sfx.connect(this.reverb).connect(this.reverbGain).connect(this.duckGain);
    }
    this.reverb.buffer = impulse;
    this.reverbGain!.gain.setTargetAtTime(wet, this.ctx.currentTime, 0.15);
  }

  /** Position the next sound: pan -1 (left) .. 1 (right), gain 0..1 for distance. Reset with at(0, 1). */
  at(pan: number, gain: number): void {
    this.pan = Math.max(-1, Math.min(1, pan));
    this.posGain = Math.max(0, Math.min(1, gain));
  }

  /** Returns a ready context, or null if muted / locked / rate-limited. */
  private begin(name: string, minGap: number, bus: Bus = 'sfx'): AudioContext | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || audioSettings.muted) return null;
    const now = ctx.currentTime;
    if (name === 'w:drone' || name === 'w:flame' || name === 'w:laser' || name === 'w:aura') minGap = Math.max(minGap, 0.18);
    if (name === 'die' || name === 'hit' || name === 'hitMetal') minGap = Math.max(minGap, swarmGap(this.crowd));
    if (now - (this.lastPlay.get(name) ?? -Infinity) < minGap) return null;
    this.lastPlay.set(name, now);
    const line = ({ boss: 'boss', elite: 'elite', evolve: 'evolution', legendaryPick: 'legendary', lvl: 'level_up' } as Record<string, string>)[name];
    if (line) announcer.say(line);
    if (audioSettings.volume <= 0 || busLevel(bus) <= 0) return null;
    // Telegraphs stay audible off-screen: their distance fade has a floor.
    const posGain = bus === 'threat' ? Math.max(this.posGain, threatTuning.minGain) : this.posGain;
    const priority = cuePriority(name) - (name.startsWith('w:') && posGain < 0.7 ? 1 : 0);
    const nodes: AudioNode[] = [];
    const sources: AudioScheduledSourceNode[] = [];
    const cleanup = () => { for (const node of nodes) node.disconnect(); };
    const release = samples.budget.acquire('synth:' + name, priority, priority === 0 ? 2 : 4, () => {
      for (const source of sources) source.stop();
      cleanup();
    });
    if (!release) return null;
    this.applyVolumes();
    let node: AudioNode = this.buses[bus];
    const placed = bus !== 'ui' && bus !== 'music';
    if (placed) {
      const p = ctx.createStereoPanner();
      p.pan.value = this.pan;
      p.connect(node);
      nodes.push(p);
      node = p;
      if (posGain < 0.95) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = distanceCutoff(posGain);
        filter.connect(node);
        nodes.push(filter);
        node = filter;
      }
    }
    const sample = name.startsWith('w:') ? weaponSamples[name.slice(2)] : cueSamples[name];
    const layered = sample ? samples.play(sample, { bus: bus === 'ui' ? 'ui' : 'sfx', pan: this.pan,
      distance: posGain, priority, cooldown: minGap, limit: priority === 0 ? 2 : 3 }) : null;
    const g = ctx.createGain();
    // A telegraph's synth stays at full level: its sample rides the (duckable) effects bus.
    g.gain.value = (placed ? posGain : 1) * (layered && bus !== 'threat' ? soundTuning.synthLayer : 1);
    g.connect(node);
    nodes.push(g);
    this.route = g;
    this.voice = { pending: 0, release: () => { release(); cleanup(); }, nodes, sources };
    if (name === 'bomb' || name === 'bossSlam') this.duck(0.25, 0.7);
    // Some optional weapon cues only have a sample. Release their empty synth lease.
    const voice = this.voice;
    queueMicrotask(() => { if (voice.pending === 0) voice.release(); });
    return ctx;
  }

  private track(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    const voice = this.voice!;
    voice.pending++;
    voice.sources.push(source);
    voice.nodes.push(...nodes);
    source.onended = () => { for (const node of nodes) node.disconnect(); if (--voice.pending === 0) voice.release(); };
  }

  /** Dedicated gain automation survives volume changes and overlapping big moments. */
  duck(seconds: number, depth = 0.4, replace = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const until = now + seconds;
    if (!replace && until < this.duckUntil) return;
    this.duckUntil = until;
    const gain = this.duckGain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(seconds > 0 ? depth : 1, now + 0.025);
    if (seconds > 0) {
      gain.setValueAtTime(depth, Math.max(until, now + 0.025));
      gain.linearRampToValueAtTime(1, until + 0.35);
    }
  }

  private tone(ctx: AudioContext, wave: Wave, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.route);
    this.track(o, [o, g]);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(ctx: AudioContext, dur: number, vol: number, filterHz: number, filterEnd = filterHz, q = 1, delay = 0) {
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(filterHz, t);
    f.frequency.exponentialRampToValueAtTime(filterEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.route);
    this.track(src, [src, f, g]);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private vowel(ctx: AudioContext, wave: Wave, f0a: number, f0b: number, dur: number, from: readonly [number, number], to: readonly [number, number], vol: number, delay = 0) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(f0a, t);
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
    env.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.015, dur / 4));
    env.gain.setValueAtTime(vol, t + dur * 0.62);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f1).connect(env);
    o.connect(f2).connect(g2).connect(env);
    env.connect(this.route);
    this.track(o, [o, f1, f2, g2, env]);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** The recipe kit, bound to whatever voice `begin` opened last. */
  private readonly kit: SynthKit = {
    tone: (wave, f0, f1, dur, vol, delay = 0) => {
      if (this.ctx) this.tone(this.ctx, wave, f0, f1, dur, vol, delay);
    },
    noise: (dur, vol, hz, hzEnd = hz, q = 1, delay = 0) => {
      if (this.ctx) this.noise(this.ctx, dur, vol, hz, hzEnd, q, delay);
    },
    vowel: (wave, f0a, f0b, dur, from, to, vol, delay = 0) => {
      if (this.ctx) this.vowel(this.ctx, wave, f0a, f0b, dur, from, to, vol, delay);
    },
  };

  /**
   * Play a recipe as one rate-limited, budgeted voice group. `name` drives
   * priority (src/audio/mix.ts cuePriority) and the per-name rate limit.
   */
  play(name: string, minGap: number, bus: Bus, recipe: (k: SynthKit) => void): boolean {
    const ctx = this.begin(name, minGap, bus);
    if (!ctx) return false;
    recipe(this.kit);
    return true;
  }

  /** Any cue by name: an sfx method, `w:<weapon>[|<evo key>]`, `evo:<key>` or `call:<family>`. Used by the effects bus. */
  named(name: string, pitch = 1): void {
    if (name.startsWith('w:')) return this.weapon(name.slice(2));
    if (name.startsWith('evo:')) return this.evoLayer(name.slice(4));
    if (name.startsWith('call:')) return this.call(name.slice(5) as Family, pitch);
    const fn = (this as unknown as Record<string, unknown>)[name];
    if (typeof fn === 'function') (fn as (p?: number) => void).call(this, pitch);
  }

  /** An evolved item's extra layer on its own (specials, the Bomb). */
  evoLayer(key: string): void {
    this.play('evo:' + key, 0.08, 'sfx', (k) => playEvoLayer(k, key, 1));
  }

  /** Enemy family call (robots beep, slimes squelch, frogs croak, bugs buzz, bosses roar). */
  call(family: Family, pitch = 1): void {
    this.play('call:' + family, 0.12, 'sfx', (k) => playCall(k, family, pitch));
  }

  /** Off-screen danger telegraph on the reserved band. */
  threat(id: ThreatId): void {
    this.play('threat:' + id, 0.12, 'threat', (k) => playThreat(k, id));
  }
  threatSniper(): void {
    this.threat('sniper');
  }
  threatMortar(): void {
    this.threat('mortar');
  }
  threatLeap(): void {
    this.threat('leap');
  }
  threatElite(): void {
    this.threat('elite');
  }
  threatReaper(): void {
    this.threat('reaper');
  }

  /** Hero voice bark (already composed into syllables by src/audio/voice.ts). */
  speak(u: Utterance): boolean {
    return this.play('voice:' + u.speaker, 0.05, 'voice', (k) => speakSyllables(k, u));
  }

  /** The shared UI kit (menu bus). `value` is 0..1 (slider position, toggle state). */
  ui(cue: UiCue, value = 0): void {
    this.play('menu:' + cue, cue === 'tick' ? 0.03 : cue === 'move' || cue === 'hover' ? 0.035 : 0.07, 'ui', (k) => playUi(k, cue, value));
  }

  /** Hit-stop: close the low-pass on effects and music, then open it again. */
  muffle(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const f = this.muffler.frequency;
    const t = ctx.currentTime;
    f.cancelScheduledValues(t);
    f.setValueAtTime(650, t);
    f.setValueAtTime(650, t + seconds);
    f.exponentialRampToValueAtTime(20000, t + seconds + 0.25);
  }

  /** Combo hum: 0 = silent, 1 = a loud, bright buzz. Call every frame. */
  setHum(level: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.hum) {
      if (level <= 0) return;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 4;
      const a = ctx.createOscillator();
      const b = ctx.createOscillator();
      a.type = b.type = 'sawtooth';
      a.frequency.value = 55;
      b.frequency.value = 55.6;
      a.connect(filter);
      b.connect(filter);
      filter.connect(gain).connect(this.buses.sfx);
      a.start();
      b.start();
      this.hum = { gain, filter, a, b };
    }
    const h = this.hum;
    const t = ctx.currentTime;
    const k = Math.max(0, Math.min(1, level));
    h.gain.gain.setTargetAtTime(k * k * 0.06, t, 0.15);
    h.filter.frequency.setTargetAtTime(160 + k * 1400, t, 0.15);
    h.a.frequency.setTargetAtTime(55 * (1 + k * 0.5), t, 0.3);
    h.b.frequency.setTargetAtTime(55.6 * (1 + k * 0.5), t, 0.3);
  }

  // ---------------------------------------------------------------- new cues

  /** Low thump layered under big hits; `weight` 1..3 deepens and lengthens it. */
  impact(weight = 1): void {
    const ctx = this.begin('impact', 0.05);
    if (!ctx) return;
    const w = Math.max(1, Math.min(3, weight));
    this.tone(ctx, 'sine', 120 / Math.sqrt(w), 32, 0.12 + 0.06 * w, 0.18 + 0.08 * w);
    this.noise(ctx, 0.08 + 0.03 * w, 0.18 * w, 300, 80, 0.8);
  }

  /** Rising whine while a charger lines up its charge. */
  chargerWindup(): void {
    const ctx = this.begin('cwind', 0.15, 'threat');
    if (!ctx) return;
    this.tone(ctx, 'sawtooth', 180, 900, 0.5, 0.07);
    this.tone(ctx, 'square', 360, 1800, 0.5, 0.03);
  }

  /** Fuse tick; `pitch` climbs as the fuse burns down. */
  fuseTick(pitch = 1): void {
    const ctx = this.begin('fuse', 0.04);
    if (!ctx) return;
    this.tone(ctx, 'square', 1500 * pitch, 1500 * pitch, 0.025, 0.06);
  }

  evolve(): void {
    const ctx = this.begin('evolve', 0.6);
    if (!ctx) return;
    [262, 330, 392, 523, 659, 784, 1047].forEach((f, i) => this.tone(ctx, 'square', f, f, 0.1, 0.09, i * 0.055));
    this.tone(ctx, 'triangle', 1047, 1047, 0.6, 0.12, 0.4);
    this.tone(ctx, 'triangle', 1319, 1319, 0.6, 0.08, 0.4);
    this.noise(ctx, 0.5, 0.15, 3000, 8000, 2, 0.35);
  }

  /** Every 50 combo. */
  comboUp(): void {
    const ctx = this.begin('combo', 0.3);
    if (!ctx) return;
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(ctx, 'square', f, f, 0.07, 0.08, i * 0.045));
  }

  /** Low-life heartbeat (local player only). */
  heartbeat(): void {
    const ctx = this.begin('heart', 0.3);
    if (!ctx) return;
    this.tone(ctx, 'sine', 70, 40, 0.12, 0.35);
    this.tone(ctx, 'sine', 60, 35, 0.14, 0.28, 0.18);
  }

  /** A chest-style jingle for big moments (stage events, challenges). */
  jingle(): void {
    const ctx = this.begin('jingle', 0.4);
    if (!ctx) return;
    [659, 784, 1047, 784, 1319].forEach((f, i) => this.tone(ctx, 'triangle', f, f, 0.1, 0.1, i * 0.07));
  }

  /** Something bad starts (curse, event). */
  ominous(): void {
    const ctx = this.begin('ominous', 0.5);
    if (!ctx) return;
    this.tone(ctx, 'sawtooth', 220, 110, 0.6, 0.12);
    this.tone(ctx, 'sawtooth', 233, 116, 0.6, 0.08);
    this.noise(ctx, 0.6, 0.15, 400, 100, 1);
  }

  shoot(): void {
    const ctx = this.begin('shoot', 0.03);
    if (!ctx) return;
    const p = 1 + (Math.random() - 0.5) * 0.12;
    this.tone(ctx, 'square', 880 * p, 220 * p, 0.08, 0.12);
    this.noise(ctx, 0.04, 0.15, 3000);
  }

  /** `pitch` rises with the combo so long chains sound increasingly frantic. */
  hit(pitch = 1): void {
    const ctx = this.begin('hit', 0.025);
    if (!ctx) return;
    this.noise(ctx, 0.07, 0.35, 1800 * pitch, 600, 2);
    this.tone(ctx, 'triangle', 320 * pitch, 160 * pitch, 0.06, 0.2);
  }

  crit(): void {
    const ctx = this.begin('crit', 0.04);
    if (!ctx) return;
    this.tone(ctx, 'square', 1400, 2400, 0.07, 0.1);
    this.noise(ctx, 0.1, 0.3, 4000, 1500, 3);
  }

  enemyDie(pitch = 1): void {
    const ctx = this.begin('die', 0.03);
    if (!ctx) return;
    this.tone(ctx, 'square', 300 * pitch, 1200 * pitch, 0.1, 0.15);
    this.tone(ctx, 'square', 1200 * pitch, 600 * pitch, 0.08, 0.1, 0.08);
    this.noise(ctx, 0.25, 0.4, 900, 200, 0.8);
  }

  /** An elite's shield shatters: glassy crack plus a falling chime. */
  shieldBreak(): void {
    const ctx = this.begin('shieldBreak', 0.08);
    if (!ctx) return;
    this.noise(ctx, 0.3, 0.45, 6000, 1200, 2);
    this.tone(ctx, 'triangle', 1800, 600, 0.25, 0.18);
    this.tone(ctx, 'square', 900, 300, 0.2, 0.08, 0.05);
  }

  explode(): void {
    const ctx = this.begin('explode', 0.05);
    if (!ctx) return;
    this.noise(ctx, 0.35, 0.5, 500, 80, 0.7);
    this.tone(ctx, 'sine', 160, 40, 0.3, 0.3);
  }

  bomb(): void {
    const ctx = this.begin('bomb', 0.3);
    if (!ctx) return;
    this.tone(ctx, 'sawtooth', 90, 30, 0.7, 0.35);
    this.tone(ctx, 'sine', 220, 40, 0.6, 0.4);
    this.noise(ctx, 0.8, 0.6, 1200, 60, 0.5);
  }

  heal(): void {
    const ctx = this.begin('heal', 0.15);
    if (!ctx) return;
    this.tone(ctx, 'triangle', 660, 990, 0.12, 0.08);
  }

  /** UI kit (src/audio/uiKit.ts): one palette for every menu. */
  menuMove(): void {
    this.ui('move');
  }

  menuSelect(): void {
    this.ui('confirm');
  }

  menuBack(): void {
    this.ui('back');
  }

  powerUp(): void {
    const ctx = this.begin('powerUp', 0.2);
    if (!ctx) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(ctx, 'square', f, f, 0.09, 0.1, i * 0.06));
  }

  /** Gear pickup: a quick ratchet. */
  gear(): void {
    const ctx = this.begin('gear', 0.08);
    if (!ctx) return;
    for (let i = 0; i < 3; i++) this.noise(ctx, 0.025, 0.3, 4000, 2500, 4, i * 0.04);
    this.tone(ctx, 'square', 990, 1320, 0.08, 0.08, 0.12);
  }

  /** A legendary card appears: a rising shimmer. */
  legendary(): void {
    const ctx = this.begin('legendary', 0.4);
    if (!ctx) return;
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(ctx, 'triangle', f, f, 0.5, 0.07, i * 0.05));
    this.tone(ctx, 'sine', 2093, 2093, 0.9, 0.06, 0.3);
  }

  /** Slot reel passing an item: a soft click. */
  reelTick(): void {
    const ctx = this.begin('reelTick', 0.035);
    if (!ctx) return;
    const p = 1 + (Math.random() - 0.5) * 0.1;
    this.noise(ctx, 0.015, 0.1, 3800 * p, 2600, 3);
    this.tone(ctx, 'square', 1700 * p, 1500, 0.012, 0.02);
  }

  /** Slot reel landing: a thunk, plus a sparkle that grows with the tier. */
  reelLand(rarity: Rarity = 'common'): void {
    const ctx = this.begin('reelLand', 0.03);
    if (!ctx) return;
    if (rarity === 'legendary') {
      this.tone(ctx, 'sine', 150, 45, 0.35, 0.3);
      this.noise(ctx, 0.25, 0.3, 900, 150, 0.8);
      return;
    }
    this.tone(ctx, 'triangle', 330, 200, 0.07, 0.12);
    this.noise(ctx, 0.04, 0.12, 1400, 700, 2);
    if (rarity === 'uncommon') [988, 1319].forEach((f, i) => this.tone(ctx, 'square', f, f, 0.06, 0.06, 0.04 + i * 0.05));
    if (rarity === 'rare') [1319, 1760, 2637].forEach((f, i) => this.tone(ctx, 'triangle', f, f, 0.45, 0.08, 0.04 + i * 0.06));
  }

  /** Picking a legendary: a big fanfare. */
  legendaryPick(): void {
    const ctx = this.begin('legendaryPick', 0.4);
    if (!ctx) return;
    [392, 523, 659, 784].forEach((f, i) => this.tone(ctx, 'square', f, f, 0.08, 0.1, i * 0.06));
    [1047, 1319, 1568].forEach((f) => this.tone(ctx, 'square', f, f, 0.6, 0.07, 0.26));
    this.noise(ctx, 0.6, 0.25, 6000, 2000, 1, 0.26);
  }

  // Shop: cash-register jingles.
  shopOpen(): void {
    const ctx = this.begin('shopOpen', 0.5);
    if (!ctx) return;
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(ctx, 'square', f, f, 0.07, 0.08, i * 0.05));
    this.tone(ctx, 'triangle', 2093, 2093, 0.5, 0.12, 0.22);
    this.tone(ctx, 'triangle', 2637, 2637, 0.4, 0.06, 0.24);
  }

  buy(): void {
    this.ui('purchase');
  }

  sell(): void {
    const ctx = this.begin('sell', 0.08);
    if (!ctx) return;
    [1568, 1175, 880].forEach((f, i) => this.tone(ctx, 'square', f, f, 0.06, 0.09, i * 0.05));
    this.noise(ctx, 0.08, 0.2, 2500, 1200, 2, 0.15);
  }

  reroll(): void {
    this.ui('flip');
  }

  deny(): void {
    this.ui('error');
  }

  stageClear(): void {
    const ctx = this.begin('clear', 0.5);
    if (!ctx) return;
    [392, 523, 659, 784, 659, 1047].forEach((f, i) =>
      this.tone(ctx, i === 5 ? 'triangle' : 'square', f, f, i === 5 ? 0.4 : 0.1, 0.12, i * 0.09),
    );
  }

  wave(): void {
    const ctx = this.begin('wave', 0.3);
    if (!ctx) return;
    this.tone(ctx, 'sawtooth', 220, 440, 0.25, 0.12);
    this.tone(ctx, 'sawtooth', 330, 660, 0.25, 0.08, 0.05);
  }

  /**
   * Weapon sounds, routed by name from the weapon context. `name|<evo key>`
   * (an evolved weapon's cue) adds that evolution's layer on top.
   */
  weapon(full: string): void {
    const bar = full.indexOf('|');
    const name = bar < 0 ? full : full.slice(0, bar);
    const ctx = this.begin('w:' + name, name === 'shoot' ? 0.03 : 0.06);
    if (!ctx) return;
    if (bar >= 0) playEvoLayer(this.kit, full.slice(bar + 1), 0.8);
    const p = 1 + (Math.random() - 0.5) * 0.1;
    switch (name) {
      case 'scatter':
      case 'pellets':
      case 'shoot':
        this.tone(ctx, 'square', 880 * p, 220 * p, 0.08, 0.1);
        this.noise(ctx, 0.04, 0.12, 3000);
        break;
      case 'laser':
      case 'sweeper':
      case 'storm':
      case 'lightning':
      case 'aura':
      case 'zap':
        this.noise(ctx, 0.12, 0.25, 5000, 2000, 4);
        this.tone(ctx, 'sawtooth', 1200 * p, 300, 0.08, 0.06);
        break;
      case 'drone':
      case 'bouncer':
      case 'disc':
        this.tone(ctx, 'triangle', 300 * p, 900 * p, 0.15, 0.08);
        break;
      case 'missile':
        this.noise(ctx, 0.25, 0.2, 400, 2400, 2);
        break;
      case 'mine':
        this.tone(ctx, 'square', 200, 160, 0.05, 0.06);
        break;
      case 'nova':
      case 'freeze':
        this.tone(ctx, 'sine', 1800, 600, 0.35, 0.1);
        this.noise(ctx, 0.35, 0.2, 6000, 3000, 6);
        break;
      case 'explode':
        this.noise(ctx, 0.35, 0.5, 500, 80, 0.7);
        this.tone(ctx, 'sine', 160, 40, 0.3, 0.3);
        break;
      case 'charge':
        this.tone(ctx, 'triangle', 500 * p, 900 * p, 0.06, 0.04);
        break;
      case 'chargeFull':
        this.tone(ctx, 'square', 1320, 1320, 0.08, 0.07);
        this.tone(ctx, 'square', 1760, 1760, 0.12, 0.06, 0.07);
        break;
      case 'orb':
      case 'chargeShot':
        this.tone(ctx, 'sawtooth', 220 * p, 60, 0.3, 0.16);
        this.noise(ctx, 0.25, 0.25, 900, 3000, 2);
        break;
      case 'flame':
        this.noise(ctx, 0.22, 0.3, 700, 2200, 1);
        this.tone(ctx, 'sawtooth', 160 * p, 90, 0.18, 0.08);
        break;
      // Right-click weapons: each gets a heavy, distinct report.
      case 'meteor':
      case 'lob':
        this.tone(ctx, 'sine', 190 * p, 80, 0.14, 0.28);
        this.noise(ctx, 0.1, 0.3, 700, 300, 1);
        this.tone(ctx, 'square', 900 * p, 600, 0.05, 0.05, 0.05);
        break;
      case 'blackhole':
      case 'vortex':
        this.noise(ctx, 0.45, 0.3, 250, 2400, 3);
        this.tone(ctx, 'sine', 140 * p, 50, 0.45, 0.25);
        this.tone(ctx, 'triangle', 600 * p, 1500, 0.3, 0.05, 0.1);
        break;
      case 'shieldUp':
        this.tone(ctx, 'triangle', 280 * p, 840, 0.16, 0.14);
        this.tone(ctx, 'square', 560, 560, 0.2, 0.04, 0.12);
        this.noise(ctx, 0.2, 0.12, 4000, 6000, 5);
        break;
      case 'block':
        this.tone(ctx, 'square', 1400 * p, 900, 0.05, 0.06);
        break;
      case 'uplink':
        this.tone(ctx, 'square', 1320, 1320, 0.05, 0.07);
        this.tone(ctx, 'square', 1760, 1760, 0.05, 0.07, 0.07);
        this.tone(ctx, 'sine', 400, 1800, 0.4, 0.06, 0.14);
        break;
      case 'beam':
        this.tone(ctx, 'sawtooth', 110 * p, 30, 0.7, 0.3);
        this.noise(ctx, 0.7, 0.45, 2600, 150, 0.7);
        this.tone(ctx, 'sine', 70, 35, 0.6, 0.35);
        break;
      case 'rail':
        this.noise(ctx, 0.06, 0.4, 7000, 3000, 2);
        this.tone(ctx, 'sawtooth', 2600 * p, 180, 0.18, 0.14);
        this.tone(ctx, 'sine', 90, 40, 0.25, 0.25);
        break;
      case 'ready':
        this.tone(ctx, 'triangle', 1568, 1568, 0.06, 0.06);
        this.tone(ctx, 'triangle', 2093, 2093, 0.12, 0.06, 0.05);
        break;
    }
  }

  enemyShoot(): void {
    const ctx = this.begin('eshoot', 0.06);
    if (!ctx) return;
    this.tone(ctx, 'sine', 700, 350, 0.1, 0.07);
  }

  private gemStreak = 0;
  private lastGem = 0;
  /** Gem pickup chime that climbs in pitch while you hoover up a trail. */
  gem(): void {
    const ctx = this.begin('gem', 0.025);
    if (!ctx) return;
    this.gemStreak = ctx.currentTime - this.lastGem < 0.4 ? Math.min(this.gemStreak + 1, 24) : 0;
    this.lastGem = ctx.currentTime;
    const f = 880 * Math.pow(2, this.gemStreak / 24);
    this.tone(ctx, 'triangle', f, f * 1.5, 0.06, 0.06);
  }

  coin(): void {
    const ctx = this.begin('coin', 0.05);
    if (!ctx) return;
    this.tone(ctx, 'square', 988, 988, 0.05, 0.07);
    this.tone(ctx, 'square', 1319, 1319, 0.12, 0.07, 0.05);
  }

  chest(): void {
    const ctx = this.begin('chest', 0.3);
    if (!ctx) return;
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(ctx, 'triangle', f, f, 0.12, 0.1, i * 0.05));
  }

  levelUp(): void {
    const ctx = this.begin('lvl', 0.2);
    if (!ctx) return;
    [392, 523, 659, 784].forEach((f, i) => this.tone(ctx, 'square', f, f * 1.01, 0.08, 0.09, i * 0.05));
    this.tone(ctx, 'triangle', 1047, 1047, 0.3, 0.1, 0.2);
  }

  elite(): void {
    const ctx = this.begin('elite', 0.5);
    if (!ctx) return;
    this.tone(ctx, 'sawtooth', 160, 120, 0.4, 0.15);
    this.tone(ctx, 'sawtooth', 240, 180, 0.4, 0.1, 0.1);
  }

  boss(): void {
    const ctx = this.begin('boss', 1);
    if (!ctx) return;
    [0, 0.35, 0.7].forEach((d) => this.tone(ctx, 'sawtooth', 110, 70, 0.3, 0.2, d));
    this.noise(ctx, 1.2, 0.3, 200, 80, 0.7);
  }

  bossWindup(): void {
    const ctx = this.begin('bwind', 0.3, 'threat');
    if (!ctx) return;
    this.tone(ctx, 'sawtooth', 120, 260, 0.4, 0.12);
  }

  portal(): void {
    const ctx = this.begin('portal', 0.5);
    if (!ctx) return;
    this.tone(ctx, 'sine', 200, 1600, 0.5, 0.15);
    this.noise(ctx, 0.5, 0.25, 300, 4000, 2);
  }

  telegraph(): void {
    const ctx = this.begin('tele', 0.08);
    if (!ctx) return;
    this.tone(ctx, 'sine', 500, 1100, 0.15, 0.08);
  }

  playerHurt(): void {
    const ctx = this.begin('hurt', 0.1);
    if (!ctx) return;
    this.tone(ctx, 'sawtooth', 420, 90, 0.3, 0.25);
    this.noise(ctx, 0.2, 0.3, 700, 200, 1);
  }

  dash(): void {
    const ctx = this.begin('dash', 0.05);
    if (!ctx) return;
    this.noise(ctx, 0.18, 0.35, 600, 3500, 3);
  }

  spawn(): void {
    const ctx = this.begin('spawn', 0.1);
    if (!ctx) return;
    this.tone(ctx, 'triangle', 200, 400, 0.12, 0.06);
  }

  parry(): void {
    const ctx = this.begin('parry', 0.2);
    if (ctx) { this.tone(ctx, 'triangle', 2300, 900, 0.18, 0.17); this.noise(ctx, 0.1, 0.2, 5000, 1600); }
  }

  perfectDash(): void {
    const ctx = this.begin('perfectDash', 0.3);
    if (ctx) { this.noise(ctx, 0.22, 0.2, 700, 3200); this.tone(ctx, 'sine', 1200, 2400, 0.2, 0.09); }
  }

  jumpPad(): void {
    const ctx = this.begin('jumpPad', 0.2);
    if (ctx) this.tone(ctx, 'triangle', 160, 950, 0.22, 0.14);
  }

  coverBreak(): void {
    const ctx = this.begin('coverBreak', 0.15);
    if (ctx) this.noise(ctx, 0.25, 0.25, 1200, 180);
  }

  goldenLaugh(): void {
    const ctx = this.begin('goldenLaugh', 2);
    if (ctx) { this.tone(ctx, 'square', 700, 950, 0.1, 0.07); this.tone(ctx, 'square', 1000, 650, 0.15, 0.07, 0.12); }
  }

  hitMetal(): void {
    const ctx = this.begin('hitMetal', 0.06);
    if (ctx) { this.tone(ctx, 'triangle', 1700, 600, 0.08, 0.1); this.noise(ctx, 0.06, 0.15, 5000, 1800); }
  }

  eliteDie(): void {
    const ctx = this.begin('eliteDie', 0.18);
    if (ctx) { this.noise(ctx, 0.4, 0.4, 800, 90); this.tone(ctx, 'sine', 150, 35, 0.35, 0.3); }
  }

  bossSlam(): void {
    const ctx = this.begin('bossSlam', 0.3);
    if (ctx) { this.noise(ctx, 0.45, 0.45, 350, 60); this.tone(ctx, 'sine', 100, 28, 0.4, 0.4); }
  }

  /** Thunder after a lightning flash: later and quieter when the strike is far (0 = overhead .. 1 = far). */
  thunder(dist: number): void {
    setTimeout(() => {
      if (samples.play('w_storm', { gain: 0.55 * (1 - dist * 0.6), priority: 2, cooldown: 1, limit: 1, variation: 0.15 })) return;
      const ctx = this.begin('thunder', 1);
      if (ctx) this.noise(ctx, 1.2, 0.3 * (1 - dist * 0.6), 400, 60, 1);
    }, 150 + dist * 1600);
  }

  bossRoar(): void {
    const ctx = this.begin('bossRoar', 0.8);
    if (ctx) { this.noise(ctx, 0.7, 0.35, 500, 120, 2); this.tone(ctx, 'sawtooth', 90, 55, 0.7, 0.2); }
  }

  bossPhase(): void {
    const ctx = this.begin('bossPhase', 1);
    if (ctx) this.tone(ctx, 'sawtooth', 110, 660, 0.6, 0.14);
  }

  footstep(ground: string): void {
    if (samples.play('step_' + ground, { gain: 0.1, priority: 0, cooldown: 0.22, limit: 2, variation: 0.12 })) return;
    const ctx = this.begin('step', 0.22);
    if (ctx) this.noise(ctx, 0.045, 0.045, ground === 'metal' ? 1900 : 650, 300);
  }

  whoosh(pan: number): void {
    this.at(pan, 0.7);
    const ctx = this.begin('whoosh', 0.35);
    if (ctx) this.noise(ctx, 0.13, 0.1, 500, 2600, 1.5);
    this.at(0, 1);
  }

  playerDie(): void {
    const ctx = this.begin('pdie', 0.5);
    if (!ctx) return;
    [523, 392, 330, 262].forEach((f, i) => this.tone(ctx, 'square', f, f * 0.97, 0.18, 0.15, i * 0.16));
  }
}

export const sfx = new Sfx();
