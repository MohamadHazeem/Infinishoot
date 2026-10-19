/** Loading policy and low-end rendering budgets; no WebGL required. */
import { ok } from './check';
import { AUTO, AUTO_START, MANUAL_LEVELS, POTATO, QUALITY_LEVELS, QualityGovernor, qualitySettingLevel, setRenderQuality, renderQuality } from '../src/render/quality';
import { CORE_SAMPLES, manifestIds, sampleLoadOrder } from '../src/audio/samples';

ok(AUTO === 3 && POTATO === 4, 'old graphics settings keep their numeric meaning');
ok(MANUAL_LEVELS.map(l => QUALITY_LEVELS[l].name).join(',') === 'LOW,MEDIUM,HIGH', 'old manual presets still select the named quality');
ok(QUALITY_LEVELS[qualitySettingLevel(POTATO)].name === 'POTATO', 'Potato selects the cheapest rung');
for (const invalid of [NaN, Infinity, -1, 99]) {
  ok(qualitySettingLevel(invalid) === AUTO_START, 'invalid saved graphics value safely selects the default');
}
const potato = QUALITY_LEVELS[0];
const low = QUALITY_LEVELS[MANUAL_LEVELS[0]];
ok(potato.resolution === 216 && potato.lights === 0 && potato.ambience === 0, 'Potato is 216p, without light/weather/grass work');
for (const q of [potato, low]) {
  ok(!q.outlines && !q.glow && !q.distortion && !q.streaks && !q.worldEffects, `${q.name} drops costly decorative effects`);
}
const governor = new QualityGovernor();
for (let i = 0; i < 120; i++) governor.sample(0.05);
ok(governor.level === 0, 'sustained 20 fps reaches Potato within six seconds');
const hitch = new QualityGovernor();
for (let i = 0; i < 120; i++) hitch.sample(1 / 60);
hitch.sample(0.25);
ok(hitch.level === AUTO_START, 'one loading hitch does not degrade quality');
setRenderQuality(NaN, false);
ok(renderQuality.level === AUTO_START, 'invalid debug rung cannot poison live render budgets');
setRenderQuality(AUTO_START, true);

const ids = manifestIds({ voice: ['vo_boss', 'vo_go'], sfx: ['amb_peaks', 'step_snow', 'dash', 'w_buster', 'amb_meadow', '../bad', 'dash'] });
const order = sampleLoadOrder(ids, ['amb_peaks', 'step_snow', 'unknown']);
ok(order.length === ids.length && new Set(order).size === ids.length, 'priority order retains every valid sample exactly once');
ok(order.indexOf('vo_go') < order.indexOf('vo_boss') && order.indexOf('w_buster') < order.indexOf('amb_peaks'), 'small gameplay core precedes rare voices and ambient loops');
ok(order.indexOf('amb_peaks') < order.indexOf('amb_meadow') && order.indexOf('step_snow') < order.indexOf('vo_boss'), 'current biome ambience and steps precede unrelated clips');
ok(CORE_SAMPLES.length <= 12, 'startup core has a firm small limit');

// Exercise the actual asynchronous loader, including two core workers and biome promotion.
const { SampleEngine } = await import('../src/audio/samples');
const originalFetch = globalThis.fetch;
const fetched: string[] = [];
let active = 0, maxActive = 0;
globalThis.fetch = (async (url: string) => {
  if (url.endsWith('manifest.json')) return { ok: true, json: async () => ({ sfx: ['dash', 'amb_peaks', 'amb_magma', 'step_metal'], voice: ['vo_go', 'vo_boss'] }) };
  fetched.push(url.split('/').at(-1)!.replace('.mp3', ''));
  active++;
  maxActive = Math.max(maxActive, active);
  return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
}) as typeof fetch;
try {
  const engine = new SampleEngine();
  const ctx = { state: 'running', decodeAudioData: async () => { await new Promise(resolve => setTimeout(resolve, 2)); active--; return { duration: 0.1 }; } } as unknown as AudioContext;
  engine.init(ctx, { sfx: {} as AudioNode, ui: {} as AudioNode }, () => true);
  await engine.coreReady;
  ok(fetched.join(',') === 'vo_go,dash', 'coreReady resolves before any background download');
  engine.buffer('amb_magma');
  await engine.ready;
  ok(fetched.slice(2, 4).join(',') === 'amb_magma,step_metal', 'live biome request promotes its ambience and footsteps next');
  ok(fetched.length === 6 && new Set(fetched).size === 6 && maxActive === 2, 'all clips load exactly once with at most two concurrent decodes');
} finally {
  globalThis.fetch = originalFetch;
}
