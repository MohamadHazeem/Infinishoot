/**
 * When heroes speak: per-hero and per-kind cooldowns, chance rolls, priority
 * interrupts and a global gap, then the bark plays on the voice bus and its
 * caption goes to the caption strip. Local to each machine (src/game/systems/
 * sound.ts derives the moments from synced state), so co-op needs no messages.
 */
import { sfx } from './sfx';
import { caption } from './captions';
import { voiceGate } from './announcer';
import { RECORDED_VOICES, barkSample, speechBusy, type BarkKind as RecordedKind } from './voices';
import { samples } from './samples';
import { BARKS, compose, voiceProfile, voiceTuning, type BarkKind, type Utterance } from './voice';

/** VOICE setting (the volume is audioSettings.voice). */
export const voiceSettings = { enabled: true };

export interface Speaker {
  heroId: string;
  /** Player slot (co-op voice shift and the rate-limit key). */
  index: number;
  /** Caption name: the hero (solo) or the player's name (co-op). */
  name: string;
  color: string;
  x?: number;
  z?: number;
}

export interface BarkOptions {
  pan?: number;
  gain?: number;
  /** Caption it (default yes). */
  caption?: boolean;
  /** Skip the chance roll. */
  force?: boolean;
}

/** Synth bark kinds that have a recorded line (src/audio/voices.ts); the rest stay silent for recorded heroes. */
const RECORDED_KIND: Partial<Record<BarkKind, RecordedKind>> = { lowLife: 'lowhp', levelUp: 'level', evolve: 'evolve', revive: 'revive', victory: 'win' };

/**
 * Does this hero's recorded voice cover this moment? Recorded heroes never mix
 * in the synth voice, except as the fallback when their recorded line for the
 * moment is missing (not in the pack, or not loaded yet).
 */
export function speaksRecorded(heroId: string, kind: BarkKind): boolean {
  if (!RECORDED_VOICES.has(heroId)) return false;
  const k = RECORDED_KIND[kind];
  return !k || !!samples.buffer(barkSample(heroId, k));
}

export class HeroVoice {
  private last = new Map<string, number>();
  private busy = new Map<number, { until: number; priority: number }>();
  private any = -Infinity;
  constructor(
    private clock: () => number = () => performance.now() / 1000,
    private rand: () => number = Math.random,
  ) {}

  /** Try to bark; returns the utterance if the moment passed every gate. */
  bark(kind: BarkKind, sp: Speaker, o: BarkOptions = {}): Utterance | null {
    // Heroes with recorded barks speak through src/audio/voices.ts; this voice is for the rest.
    if (!voiceSettings.enabled || speaksRecorded(sp.heroId, kind)) return null;
    const b = BARKS[kind];
    // One voice channel for everyone: barks wait for boss lines and the announcer (src/audio/voices.ts).
    if (speechBusy()) return null;
    const channel = Math.min(5, 2 + b.priority);
    const now = this.clock();
    const key = sp.index + ':' + kind;
    if (now - (this.last.get(key) ?? -Infinity) < b.cooldown) return null;
    const busy = this.busy.get(sp.index);
    if (busy && now < busy.until && b.priority <= busy.priority) return null;
    if (b.priority <= 1 && now - this.any < voiceTuning.globalGap) return null;
    if (!o.force && this.rand() > b.chance) return null;
    const u = compose(kind, voiceProfile(sp.heroId, sp.index), 'p' + sp.index, this.rand);
    this.last.set(key, now);
    this.busy.set(sp.index, { until: now + u.length + voiceTuning.gap, priority: b.priority });
    this.any = now;
    voiceGate.claim(channel, u.length, () => {});
    sfx.at(o.pan ?? 0, o.gain ?? 1, sp.x, sp.z);
    sfx.speak(u);
    sfx.at(0, 1);
    if (o.caption !== false) caption({ who: sp.name.toUpperCase(), text: u.caption, color: sp.color, kind: 'voice' });
    return u;
  }

  /** This machine's hero while a run is on (set every frame by src/game/systems/sound.ts). */
  local: Speaker | null = null;

  /** Bark as this machine's hero (skill moments: parry, perfect dodge). */
  barkLocal(kind: BarkKind, o: BarkOptions = {}): Utterance | null {
    return this.local ? this.bark(kind, this.local, o) : null;
  }

  reset(): void {
    this.last.clear();
    this.busy.clear();
    this.any = -Infinity;
  }
}

export const heroVoice = new HeroVoice();
