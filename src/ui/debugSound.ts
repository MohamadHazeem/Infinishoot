import type GUI from 'lil-gui';
import type { Controller } from 'lil-gui';
import { samples } from '../audio/samples';
import { sfx } from '../audio/sfx';
import { cueSamples, weaponSamples } from '../audio/mix';
import { manifestIds } from '../audio/samples';
import { exportSampleTuning, resetSampleTune, sampleTune, setSampleTune } from '../audio/soundTuning';
import { MATERIAL_SAMPLES, barkTuning, playVoiceCue, voiceChannel, voiceTuning } from '../audio/voices';

/** Sfx methods that aren't sound cues. */
const NOT_CUES = new Set(['constructor', 'ensure', 'begin', 'track', 'tone', 'noise', 'applyVolumes', 'output', 'setReverb', 'at', 'duck', 'muffle', 'setHum', 'weapon']);

/** Every playable cue: sfx methods, weapon cues ('w:'), boss voices ('v:') and material impacts ('m:'). */
function cueList(): string[] {
  const proto = Object.getPrototypeOf(sfx) as Record<string, unknown>;
  const methods = Object.getOwnPropertyNames(proto).filter((n) => !NOT_CUES.has(n) && typeof proto[n] === 'function');
  const weapons = Object.keys(weaponSamples).map((w) => 'w:' + w);
  const voices: string[] = [];
  for (const b of ['king', 'rex', 'queen', 'omega', 'glitch', 'boxer', 'gale']) for (const l of ['intro', 'phase', 'defeat']) voices.push(`v:b:${b}:${l}`);
  const impacts = Object.keys(MATERIAL_SAMPLES).flatMap((m) => ['m:' + m, `m:${m}:c`]);
  return [...methods.sort(), ...weapons, ...voices, ...impacts];
}

/** The recorded sample a cue plays (for tuning), if any. */
function cueSample(cue: string): string {
  if (cue.startsWith('w:')) return weaponSamples[cue.slice(2)] ?? '';
  if (cue.startsWith('m:')) return MATERIAL_SAMPLES[cue.split(':')[1] as keyof typeof MATERIAL_SAMPLES] ?? '';
  if (cue.startsWith('v:')) {
    const [, , boss, line] = cue.split(':');
    return `boss_${boss}_${line}`;
  }
  return cueSamples[cue] ?? '';
}

/** A box with the exported JSON, ready to copy. */
function showExport(json: string): void {
  document.getElementById('sound-export')?.remove();
  const box = document.createElement('div');
  box.id = 'sound-export';
  box.style.cssText = 'position:fixed;left:16px;top:16px;z-index:10000;background:#1a1c2c;color:#f4f4f4;padding:8px;font:12px monospace;max-width:min(520px,calc(100vw - 32px))';
  box.innerHTML = '<div>Paste into SAMPLE_TUNING (src/audio/soundTuning.ts). Copied to the clipboard if allowed.</div>';
  const area = document.createElement('textarea');
  area.value = json;
  area.rows = 16;
  area.style.cssText = 'width:100%;box-sizing:border-box;background:#333c57;color:#f4f4f4;font:12px monospace';
  const close = document.createElement('button');
  close.textContent = 'CLOSE';
  close.onclick = () => box.remove();
  box.append(area, close);
  document.body.appendChild(box);
  area.select();
}

/**
 * Debug panel > Sound designer: every sample and cue, play them, live-tune a
 * sample's gain/pitch/variation/cooldown (saved to localStorage), export JSON.
 */
export function addSoundFolder(gui: GUI): void {
  const f = gui.addFolder('Sound designer').close();
  const state = { sample: '', cue: 'hit', mapped: '', gain: 1, pitch: 1, variation: 0.07, cooldown: 0.08, loaded: '0 / 0', talking: '' };
  let sampleCtl: Controller | null = null;
  const tuneCtls: Controller[] = [];
  const syncTune = () => {
    const t = sampleTune(state.sample);
    state.gain = t.gain ?? 1;
    state.pitch = t.pitch ?? 1;
    state.variation = t.variation ?? 0.07;
    state.cooldown = t.cooldown ?? 0.08;
    for (const c of tuneCtls) c.updateDisplay();
  };
  const pick = (id: string) => {
    if (!id) return;
    state.sample = id;
    sampleCtl?.updateDisplay();
    syncTune();
  };
  const play = () => {
    if (state.sample) samples.play(state.sample, { bus: 'ui', cooldown: 0, priority: 30, limit: 4 });
  };

  // Samples: the list comes from the pack manifest (same file the engine loads).
  const base = (import.meta.env?.BASE_URL ?? '/') + 'audio/';
  if (typeof fetch === 'function') void fetch(base + 'manifest.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((m: unknown) => {
      const ids = manifestIds(m);
      if (!ids.length) return;
      state.sample = ids[0];
      sampleCtl = f.add(state, 'sample', ids).name('Sample').onChange(pick);
      const row = sampleCtl.domElement;
      row.parentElement?.prepend(row); // top of the folder
      syncTune();
      const loaded = () => `${ids.filter((id) => samples.buffer(id)).length} / ${ids.length}`;
      setInterval(() => {
        state.loaded = loaded();
        state.talking = `${voiceChannel.remaining(performance.now() / 1000) > 0 ? `p${voiceChannel.current}` : 'quiet'}, queue ${voiceChannel.queued}`;
      }, 500);
    })
    .catch(() => {});

  f.add({ play }, 'play').name('▶ Play sample');
  tuneCtls.push(
    f.add(state, 'gain', 0, 3, 0.05).name('Gain x').onChange((v: number) => setSampleTune(state.sample, 'gain', v)),
    f.add(state, 'pitch', 0.5, 2, 0.01).name('Pitch x').onChange((v: number) => setSampleTune(state.sample, 'pitch', v)),
    f.add(state, 'variation', 0, 0.5, 0.01).name('Variation').onChange((v: number) => setSampleTune(state.sample, 'variation', v)),
    f.add(state, 'cooldown', 0, 2, 0.01).name('Cooldown (s)').onChange((v: number) => setSampleTune(state.sample, 'cooldown', v)),
  );
  f.add({ reset: () => { resetSampleTune(state.sample); syncTune(); } }, 'reset').name('Reset this sample');
  f.add({ resetAll: () => { if (confirm('Drop every sound tuning edit?')) { resetSampleTune(); syncTune(); } } }, 'resetAll').name('Reset all edits');
  f.add({ exp: () => {
    const json = exportSampleTuning();
    console.log(json);
    void navigator.clipboard?.writeText(json).catch(() => {});
    showExport(json);
  } }, 'exp').name('EXPORT JSON');

  // Cues: what the game calls. Picking one selects its sample for tuning.
  const cues = cueList();
  state.mapped = cueSample(state.cue);
  const mappedCtl = f.add(state, 'mapped').name('Cue plays sample').disable();
  f.add(state, 'cue', cues).name('Cue').onChange((c: string) => {
    state.mapped = cueSample(c) || '(synth only)';
    mappedCtl.updateDisplay();
    pick(cueSample(c));
  });
  f.add({ playCue: () => {
    const c = state.cue;
    if (c.startsWith('w:')) sfx.weapon(c.slice(2));
    else if (c[1] === ':') playVoiceCue(c, 1, 0, 1);
    else (sfx as unknown as Record<string, (p?: number) => void>)[c]?.call(sfx, 1);
  } }, 'playCue').name('▶ Play cue');

  const v = f.addFolder('Voices').close();
  v.add(voiceTuning, 'bossGain', 0, 2, 0.05);
  v.add(voiceTuning, 'bossDuck', 0, 1, 0.05).name('Boss sfx duck');
  v.add(voiceTuning, 'barkGain', 0, 2, 0.05);
  v.add(voiceTuning, 'barkDuck', 0, 1, 0.05).name('Bark sfx duck');
  v.add(voiceTuning, 'introDelay', 0, 3, 0.05);
  v.add(voiceTuning, 'phaseDelay', 0, 3, 0.05);
  v.add(voiceTuning, 'impactGain', 0, 2, 0.05);
  v.add(voiceTuning, 'critLayer', 0, 2, 0.05);
  v.add(barkTuning, 'minGap', 0, 60, 1).name('Bark min gap (s)');
  v.add(barkTuning, 'levelChance', 0, 1, 0.05).name('Level-up bark chance');
  v.add(barkTuning, 'multiKill', 3, 40, 1).name('Multi-kill kills');
  v.add(state, 'loaded').name('Samples loaded').disable().listen();
  v.add(state, 'talking').name('Voice channel').disable().listen();
}
