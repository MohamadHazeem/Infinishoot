import { spatialRoute, spatialTuning } from './spatial';
import { distanceCutoff, soundTuning, VoiceBudget } from './mix';
import { sampleTune } from './soundTuning';

/** Twelve short, common cues; the rest must not compete with the first stage. */
export const CORE_SAMPLES = ['vo_go', 'w_buster', 'w_charge_shot', 'w_charge_full', 'dash', 'hit_metal', 'hit_flesh', 'enemy_die', 'explode_small', 'level_up', 'vo_level_up', 'parry'] as const;
const CORE = new Set<string>(CORE_SAMPLES);
const BIOME_STEPS: Readonly<Record<string, string>> = { meadow: 'grass', dunes: 'sand', peaks: 'snow', magma: 'metal', neon: 'metal', sky: 'metal', factory: 'metal' };
/** Stable ordering: core, requested biome/cues, then the remaining optional pack. */
export function sampleLoadOrder(ids: readonly string[], wanted: readonly string[] = []): string[] {
  const available = new Set(ids);
  return [...new Set([...CORE_SAMPLES, ...wanted, ...ids])].filter(id => available.has(id));
}
const pauseLoading = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export interface SampleOptions {
  bus?: 'sfx' | 'ui';
  gain?: number;
  pan?: number;
  x?: number;
  z?: number;
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
  private pending: string[] = [];
  private promoted = new Set<string>();
  private biome = '';
  /** Core readiness is separate; gameplay never waits for either promise. */
  coreReady: Promise<void> = Promise.resolve();
  private coreDone: () => void = () => {};
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
    this.coreReady = new Promise(resolve => { this.coreDone = resolve; });
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    const base = (import.meta.env?.BASE_URL ?? '/') + 'audio/';
    try {
      const response = await fetch(base + 'manifest.json');
      if (!response.ok) return;
      const manifest: unknown = await response.json();
      this.pending = sampleLoadOrder(manifestIds(manifest), [...this.promoted]);
      const loadOne = async (id: string) => {
        try {
          const file = await fetch(base + id + '.mp3');
          if (!file.ok) return;
          const buffer = await this.ctx!.decodeAudioData(await file.arrayBuffer());
          this.buffers.set(id, buffer);
        } catch {
          /* Missing/offline/unsupported audio leaves the synth fully usable. */
        }
      };
      // Two bounded workers for the small core. One paced worker for everything else.
      const coreWorker = async () => {
        while (this.pending.length && CORE.has(this.pending[0])) await loadOne(this.pending.shift()!);
      };
      await Promise.all([coreWorker(), coreWorker()]);
      this.coreDone();
      if (this.pending.length) await pauseLoading(1500);
      while (this.pending.length) {
        await loadOne(this.pending.shift()!);
        await pauseLoading(120);
      }
    } catch {
      /* Optional pack: never reject into the game loop. */
    } finally {
      this.coreDone();
    }
  }

  /** Would a sample on this bus be heard (unlocked, not muted, volume up)? */
  canPlay(bus: 'sfx' | 'ui'): boolean {
    return !!this.ctx && this.ctx.state === 'running' && this.enabled(bus);
  }

  /** Promote once per cue, without fetches or allocation on repeated playback attempts. */
  private prioritize(id: string): void {
    if (this.buffers.has(id) || this.promoted.has(id)) return;
    this.promoted.add(id);
    const at = this.pending.indexOf(id);
    if (at < 0) return;
    this.pending.splice(at, 1);
    let firstOptional = 0;
    while (firstOptional < this.pending.length && CORE.has(this.pending[firstOptional])) firstOptional++;
    this.pending.splice(firstOptional, 0, id);
  }

  buffer(id: string): AudioBuffer | undefined {
    // Ambience asks for its current biome; reprioritize its bed and footsteps together.
    if (id.startsWith('amb_') && id !== 'amb_rain' && this.biome !== id) {
      this.biome = id;
      const step = BIOME_STEPS[id.slice(4)];
      if (step) this.prioritize('step_' + step);
      this.prioritize(id);
    }
    if (!this.buffers.has(id)) this.prioritize(id);
    return this.buffers.get(id);
  }

  play(id: string, options: SampleOptions = {}): SampleVoice | null {
    const ctx = this.ctx;
    const buffer = this.buffer(id);
    if (!ctx || ctx.state !== 'running' || !buffer || !this.enabled(options.bus ?? 'sfx'))
      return null;
    const now = ctx.currentTime;
    const tune = sampleTune(id); // per-sample tuning (src/audio/soundTuning.ts, debug panel)
    if (now - (this.last.get(id) ?? -Infinity) < (tune.cooldown ?? options.cooldown ?? 0.08)) return null;
    let stopped = false;
    const cleanup = () => {
      src.disconnect();
      gain.disconnect();
      spatial.dispose();
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
    const spatial = spatialRoute(ctx, this.outputs[options.bus ?? 'sfx'], options.pan ?? 0, options.bus === 'ui' ? NaN : options.x, options.bus === 'ui' ? NaN : options.z);
    const filter = ctx.createBiquadFilter();
    this.last.set(id, now);
    const variation = tune.variation ?? options.variation ?? 0.07;
    const rate = Math.max(
      0.5,
      Math.min(2, (options.pitch ?? 1) * (tune.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * variation)),
    );
    src.buffer = buffer;
    src.playbackRate.value = rate;
    gain.gain.value =
      (options.gain ?? soundTuning.sampleGain) *
      (tune.gain ?? 1) *
      (options.distance ?? 1) *
      (1 - Math.random() * variation);
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(distanceCutoff(options.distance ?? 1), 20000 - spatial.rear * (20000 - spatialTuning.rearCutoff));
    src
      .connect(filter)
      .connect(gain)
      .connect(spatial.node);
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
  // Validation is independent of scheduling; load() chooses core and biome priority.
  for (const list of [m.voice, m.sfx]) {
    if (!Array.isArray(list)) continue;
    for (const id of list)
      if (typeof id === 'string' && /^[a-z][a-z0-9_]*$/.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
export const samples = new SampleEngine();
