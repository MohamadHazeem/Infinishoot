/**
 * Per-sample tuning read by the sample engine (src/audio/samples.ts) on every play.
 * `gain` and `pitch` multiply what the caller asks for; `variation` and `cooldown`
 * replace it. Tune live in the debug panel (backquote > Sound designer), then
 * EXPORT JSON and paste the result into SAMPLE_TUNING below.
 * Dev builds layer the panel's localStorage edits on top of this data.
 */
import { loadJson, saveJson } from '../core/storage';

export interface SampleTune {
  /** Gain multiplier (1 = as the caller asks). */
  gain?: number;
  /** Playback-rate multiplier (1 = as the caller asks). */
  pitch?: number;
  /** Random pitch/volume spread, replaces the caller's (0..0.5). */
  variation?: number;
  /** Minimum seconds between two plays of this sample, replaces the caller's. */
  cooldown?: number;
}

/** Shipped tuning, pasted from the debug panel's EXPORT JSON. */
export const SAMPLE_TUNING: Record<string, SampleTune> = {
  hit_slime: { gain: 0.9 },
  hit_stone: { gain: 0.85 },
  hit_shield: { gain: 0.8 },
  choir_stab: { gain: 0.75, variation: 0 },
};

const KEY = 'soundTuning.v1';
const NONE: Readonly<SampleTune> = Object.freeze({});
/** Live tuning: data plus dev overrides. Read with `sampleTune(id)`. */
const live = new Map<string, SampleTune>();
let overrides: Record<string, SampleTune> = {};

function rebuild(): void {
  live.clear();
  for (const [id, t] of Object.entries(SAMPLE_TUNING)) live.set(id, { ...t });
  for (const [id, t] of Object.entries(overrides)) live.set(id, { ...live.get(id), ...t });
}

/** Load the panel's saved edits (dev builds only; production plays the shipped data). */
export function loadTuningOverrides(enabled = !!import.meta.env?.DEV): void {
  overrides = enabled ? loadJson<Record<string, SampleTune>>(KEY, {}) : {};
  if (!overrides || typeof overrides !== 'object') overrides = {};
  rebuild();
}
rebuild();
try {
  loadTuningOverrides();
} catch {
  /* No storage in tests/headless: the shipped data still applies. */
}

/** The tuning for a sample (a shared empty object when untuned: no allocation per play). */
export function sampleTune(id: string): Readonly<SampleTune> {
  return live.get(id) ?? NONE;
}

/** Debug panel: change one field of one sample, saved to localStorage. */
export function setSampleTune(id: string, field: keyof SampleTune, value: number): void {
  const o = (overrides[id] ??= {});
  o[field] = value;
  saveJson(KEY, overrides);
  rebuild();
}

/** Debug panel: drop the edits for one sample (or all), back to the shipped data. */
export function resetSampleTune(id?: string): void {
  if (id) delete overrides[id];
  else overrides = {};
  saveJson(KEY, overrides);
  rebuild();
}

/** The merged table (shipped data + edits) as the JSON to paste into SAMPLE_TUNING. */
export function exportSampleTuning(): string {
  const out: Record<string, SampleTune> = {};
  for (const id of [...live.keys()].sort()) {
    const t = live.get(id)!;
    const clean: SampleTune = {};
    for (const k of ['gain', 'pitch', 'variation', 'cooldown'] as const) {
      const v = t[k];
      if (v === undefined) continue;
      if ((k === 'gain' || k === 'pitch') && Math.abs(v - 1) < 1e-3) continue;
      clean[k] = Math.round(v * 1000) / 1000;
    }
    if (Object.keys(clean).length) out[id] = clean;
  }
  return JSON.stringify(out, null, 2);
}

/** Apply a tune to the caller's options (pure; used by the sample engine and tests). */
export function tuned(
  id: string,
  gain: number,
  pitch: number,
  variation: number,
  cooldown: number,
): [gain: number, pitch: number, variation: number, cooldown: number] {
  const t = sampleTune(id);
  return [
    gain * (t.gain ?? 1),
    pitch * (t.pitch ?? 1),
    t.variation ?? variation,
    t.cooldown ?? cooldown,
  ];
}
