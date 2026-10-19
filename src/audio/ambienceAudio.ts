import { sfx } from './sfx';
import { samples } from './samples';
import { soundTuning } from './mix';

export const ambienceSettings = { volume: 0.45 };
export const roomTuning: Readonly<
  Record<string, { seconds: number; decay: number; wet: number; dark: number }>
> = {
  meadow: { seconds: 0.22, decay: 4, wet: 0.07, dark: 0.3 },
  dunes: { seconds: 0.12, decay: 5, wet: 0.025, dark: 0.5 },
  peaks: { seconds: 1.5, decay: 2.5, wet: 0.13, dark: 0.2 },
  magma: { seconds: 0.85, decay: 3, wet: 0.11, dark: 0.85 },
  neon: { seconds: 1.1, decay: 2.6, wet: 0.12, dark: 0.45 },
  sky: { seconds: 0.4, decay: 3.5, wet: 0.04, dark: 0.15 },
};
const LOOP_IDS = ['amb_halloween', 'amb_meadow', 'amb_dunes', 'amb_peaks', 'amb_magma', 'amb_neon', 'amb_sky', 'amb_rain'];
interface Loop {
  source: AudioBufferSourceNode;
  gain: GainNode;
  target: number;
}
class AmbienceAudio {
  private rain = 0;
  private loops = new Map<string, Loop>();
  private room = '';
  private areaId = 'amb_meadow';
  private impulses = new Map<string, AudioBuffer>();
  private ctx: AudioContext | null = null;
  private node: AudioNode | null = null;
  /** Graphics/weather can call this on every machine; zero stops the rain bed. */
  setRain(amount: number): void {
    this.rain = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
  }

  update(biome: string, active: boolean, quiet: boolean): void {
    if (!this.ctx) {
      const output = sfx.output('ambience');
      if (!output) return;
      this.ctx = output.ctx;
      this.node = output.node;
    }
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    if (this.room !== biome) {
      const tuning = roomTuning[biome] ?? roomTuning.meadow;
      let impulse = this.impulses.get(biome);
      if (!impulse) {
        impulse = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * tuning.seconds), ctx.sampleRate);
        for (let channel = 0; channel < 2; channel++) {
          const data = impulse.getChannelData(channel);
          let low = 0;
          for (let i = 0; i < data.length; i++) {
            low = low * tuning.dark + (Math.random() * 2 - 1) * (1 - tuning.dark);
            data[i] = low * (1 - i / data.length) ** tuning.decay;
          }
        }
        this.impulses.set(biome, impulse);
      }
      sfx.setReverb(impulse, tuning.wet);
      this.room = biome;
      this.areaId = 'amb_' + biome;
    }
    const volume = active ? ambienceSettings.volume * (quiet ? 0.3 : 1) * 0.3 : 0;
    const areaId = this.areaId;
    if (volume > 0) this.start(areaId);
    if (volume * this.rain > 0) this.start('amb_rain');
    for (let i = 0; i < LOOP_IDS.length; i++) {
      const id = LOOP_IDS[i];
      const loop = this.loops.get(id);
      if (!loop) continue;
      const target = id === areaId ? volume : id === 'amb_rain' ? volume * this.rain : 0;
      if (target !== loop.target) {
        const gain = loop.gain.gain;
        gain.cancelScheduledValues(ctx.currentTime);
        gain.setValueAtTime(gain.value, ctx.currentTime);
        gain.linearRampToValueAtTime(target, ctx.currentTime + soundTuning.crossfade);
        loop.target = target;
      }
      if (target === 0 && loop.gain.gain.value < 0.0001) {
        loop.source.stop();
        loop.source.disconnect();
        loop.gain.disconnect();
        this.loops.delete(id);
      }
    }
  }

  private start(id: string): void {
    if (this.loops.has(id)) return;
    const buffer = samples.buffer(id);
    if (!buffer) return;
    const source = this.ctx!.createBufferSource();
    const gain = this.ctx!.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = 0;
    source.connect(gain).connect(this.node!);
    source.start();
    this.loops.set(id, { source, gain, target: -1 });
  }
}
export const ambience = new AmbienceAudio();
