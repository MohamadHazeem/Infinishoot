import { distanceCutoff, soundTuning, VoiceBudget } from './mix';

export interface SampleOptions {
  bus?: 'sfx' | 'ui';
  gain?: number;
  pan?: number;
  distance?: number;
  pitch?: number;
  priority?: number;
  cooldown?: number;
  limit?: number;
  variation?: number;
}
export interface SampleVoice {
  duration: number;
  stop(): void;
}
/** No AudioContext, fetch or decoding until sfx unlocks on a real gesture. */
export class SampleEngine {
  readonly budget = new VoiceBudget();
  private ctx: AudioContext | null = null;
  private outputs!: { sfx: AudioNode; ui: AudioNode };
  private buffers = new Map<string, AudioBuffer>();
  private last = new Map<string, number>();
  private started = false;
  ready: Promise<void> = Promise.resolve();
  private enabled: (bus: 'sfx' | 'ui') => boolean = () => true;

  init(
    ctx: AudioContext,
    outputs: { sfx: AudioNode; ui: AudioNode },
    enabled: (bus: 'sfx' | 'ui') => boolean,
  ): void {
    if (this.started) return;
    this.started = true;
    this.ctx = ctx;
    this.outputs = outputs;
    this.enabled = enabled;
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    const base = (import.meta.env?.BASE_URL ?? '/') + 'audio/';
    try {
      const response = await fetch(base + 'manifest.json');
      if (!response.ok) return;
      const manifest: unknown = await response.json();
      const ids = manifestIds(manifest);
      // Three workers keep decoding/network pressure away from startup and gameplay.
      let cursor = 0;
      const worker = async () => {
        while (cursor < ids.length) {
          const id = ids[cursor++];
          try {
            const file = await fetch(base + id + '.mp3');
            if (!file.ok) continue;
            const buffer = await this.ctx!.decodeAudioData(await file.arrayBuffer());
            this.buffers.set(id, buffer);
          } catch {
            /* Missing/offline/unsupported audio leaves the synth fully usable. */
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    } catch {
      /* Optional pack: never reject into the game loop. */
    }
  }

  buffer(id: string): AudioBuffer | undefined {
    return this.buffers.get(id);
  }

  play(id: string, options: SampleOptions = {}): SampleVoice | null {
    const ctx = this.ctx;
    const buffer = this.buffers.get(id);
    if (!ctx || ctx.state !== 'running' || !buffer || !this.enabled(options.bus ?? 'sfx'))
      return null;
    const now = ctx.currentTime;
    if (now - (this.last.get(id) ?? -Infinity) < (options.cooldown ?? 0.08)) return null;
    let stopped = false;
    const cleanup = () => {
      src.disconnect();
      gain.disconnect();
      pan.disconnect();
      filter.disconnect();
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      src.stop();
      cleanup();
      release?.();
    };
    const release = this.budget.acquire(id, options.priority ?? 2, options.limit ?? 3, stop);
    if (!release) return null;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    const filter = ctx.createBiquadFilter();
    this.last.set(id, now);
    const variation = options.variation ?? 0.07;
    const rate = Math.max(
      0.5,
      Math.min(2, (options.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * variation)),
    );
    src.buffer = buffer;
    src.playbackRate.value = rate;
    gain.gain.value =
      (options.gain ?? soundTuning.sampleGain) *
      (options.distance ?? 1) *
      (1 - Math.random() * variation);
    pan.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0));
    filter.type = 'lowpass';
    filter.frequency.value = distanceCutoff(options.distance ?? 1);
    src
      .connect(filter)
      .connect(gain)
      .connect(pan)
      .connect(this.outputs[options.bus ?? 'sfx']);
    src.onended = () => {
      stopped = true;
      cleanup();
      release();
    };
    src.start();
    return { duration: buffer.duration / rate, stop };
  }
}

/** Validate ids before using a remotely loaded manifest as URL paths. */
export function manifestIds(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const m = value as Record<string, unknown>;
  const ids: string[] = [];
  // Voice first so Ready/Go becomes available quickly; ambience last.
  for (const list of [m.voice, m.sfx]) {
    if (!Array.isArray(list)) continue;
    for (const id of list)
      if (typeof id === 'string' && /^[a-z][a-z0-9_]*$/.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
export const samples = new SampleEngine();
