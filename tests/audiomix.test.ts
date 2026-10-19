import { ok } from './check';
import { silenceDuration } from '../src/audio/mix';
import { WEAPONS } from '../src/data/weapons';
import { WEAPON_STEMS, WeaponStems, stemIntensity, stemHit, stemTuning } from '../src/audio/stems';
import { LowHealthState, healthPressure, healthCutoff, heartbeatPeriod } from '../src/audio/lowHealth';
import { spatialRoute, spatialSettings, spatialTuning, rearAmount, updateListener } from '../src/audio/spatial';
import { MusicSynth, musicTuning } from '../src/audio/music/synth';
import { TRACKS, degreeMidi } from '../src/audio/music/composition';

ok(Object.keys(WEAPONS).every((id) => !!WEAPON_STEMS[id]), 'every weapon, including click slots, has an instrument');
ok(stemIntensity(10) > stemIntensity(1) && stemIntensity(1000) === stemIntensity(10) && stemIntensity(NaN) === stemIntensity(1), 'ranks grow intensity with a finite cap');
for (const [id, instrument] of Object.entries(WEAPON_STEMS)) {
  const hits = (level: number) => Array.from({ length: 16 }, (_, s) => stemHit(instrument, s, stemIntensity(level))).filter((n) => n >= 0).length;
  ok(hits(1) > 0 && hits(10) >= hits(1), `${id} is audible at rank one and grows without losing its rhythm`);
}
ok(healthPressure(25, 100) === 0 && healthPressure(10, 100) > 0.5 && healthPressure(0, 100) === 0, 'health effect starts below 25% and excludes death');
ok(healthPressure(10, 0) === 0 && healthPressure(NaN, 100) === 0, 'invalid health cannot poison the audio graph');
ok(healthCutoff(1) === 1800 && healthCutoff(0) === 20000 && heartbeatPeriod(1) < heartbeatPeriod(0), 'critical health closes the filter and raises the pulse rate');
ok(silenceDuration(0.45, 10, 10, 0.5) === 0.5 && silenceDuration(0.3, 10, 10, 0.5) === 0.3, 'nearby beat aligns re-entry without delaying an urgent impact');
ok(silenceDuration(4, 10, -1, 0) === 0.6 && silenceDuration(NaN, 10, 10, 0.5) === 0, 'silence duration is finite and bounded even without a music clock');
const health = new LowHealthState();
health.update(0.016, 20, 100, true);
ok(health.beat && !health.ring, 'joining an already injured hero does not invent a big hit');
health.update(0.016, 90, 100, true);
ok(health.pressure === 0 && !health.beat, 'healing clears health pressure and heartbeat');
health.update(0.016, 65, 100, true);
ok(health.ring, 'an 18%+ local hit triggers the faint ring even above critical health');
health.update(0.016, 40, 100, true);
ok(!health.ring, 'successive large hits cannot stack tinnitus');
health.update(0.016, 10, 100, false);
ok(!health.ring && !health.beat && health.pressure === 0, 'pause, death and disabled state clear the mix');
health.update(0.016, 10, 100, true);
ok(!health.ring, 'resume does not treat inactive health changes as damage');
health.reset(); health.update(0.016, 10, 100, true);
ok(!health.ring, 'hero/run reset discards the prior hero health');

class Param {
  value = 0;
  events: { value: number; time: number }[] = [];
  setValueAtTime(value: number, time: number) { this.events.push({ value, time }); this.value = value; return this; }
  exponentialRampToValueAtTime(value: number, time: number) { return this.setValueAtTime(value, time); }
  linearRampToValueAtTime(value: number, time: number) { return this.setValueAtTime(value, time); }
  setTargetAtTime(value: number, time: number) { return this.setValueAtTime(value, time); }
  cancelScheduledValues(_time: number) { return this; }
  cancelAndHoldAtTime(_time: number) { return this; }
}
class Node {
  gain = new Param(); frequency = new Param(); detune = new Param(); pan = new Param(); Q = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param(); playbackRate = new Param();
  positionX = new Param(); positionY = new Param(); positionZ = new Param();
  forwardX = new Param(); forwardY = new Param(); forwardZ = new Param();
  upX = new Param(); upY = new Param(); upZ = new Param();
  type = ''; panningModel = ''; rolloffFactor = 1; buffer: unknown;
  disconnected = false; startTime = -1; stopTime = -1;
  onended: (() => void) | null = null;
  destinations: Node[] = [];
  connect(node: Node) { this.destinations.push(node); return node; }
  disconnect() { this.disconnected = true; }
  start(t = 0) { this.startTime = t; }
  stop(t = 0) { this.stopTime = t; }
}
class Context {
  currentTime = 0; sampleRate = 8000; state = 'running'; nodes: Node[] = [];
  listener = new Node(); destination = new Node();
  createGain() { const n = new Node(); this.nodes.push(n); return n; }
  createOscillator() { return this.createGain(); }
  createBufferSource() { return this.createGain(); }
  createBiquadFilter() { return this.createGain(); }
  createStereoPanner() { return this.createGain(); }
  createPanner() { return this.createGain(); }
  createDynamicsCompressor() { return this.createGain(); }
  createBuffer(_channels: number, length: number) { const data = new Float32Array(length); return { getChannelData: () => data }; }
}
const ctx = new Context();
const dest = new Node();
const ac = ctx as unknown as AudioContext;
const output = dest as unknown as AudioNode;
ok(rearAmount(0, 4, 0, -1) === 1 && rearAmount(0, -4, 0, -1) === 0 && rearAmount(4, 0, 0, -1) === 0, 'rear filter distinguishes front/back with equal stereo pan');
spatialSettings.headphones = false;
const stereo = spatialRoute(ac, output, -0.7, 0, 5);
ok((stereo.node as unknown as Node).pan.value === -0.7 && stereo.rear === 0, 'default keeps the existing stereo mix');
stereo.dispose();
spatialSettings.headphones = true;
updateListener(ac, 0, 0, 0, -1);
const routes = Array.from({ length: spatialTuning.hrtfVoices + 1 }, () => spatialRoute(ac, output, 0.2, 0, 5));
ok(routes.slice(0, -1).every((r) => (r.node as unknown as Node).panningModel === 'HRTF' && r.rear === 1), 'positional voices use real HRTF and rear filtering');
ok((routes.at(-1)!.node as unknown as Node).panningModel === '' && routes.at(-1)!.rear === 1, 'HRTF overflow falls back to stereo while retaining rear muffling');
for (const r of routes) { r.dispose(); r.dispose(); }
const reused = spatialRoute(ac, output, 0, 0, -5);
ok((reused.node as unknown as Node).panningModel === 'HRTF' && reused.rear === 0, 'HRTF leases are reusable and double cleanup is harmless');
reused.dispose();
const ui = spatialRoute(ac, output, 0);
ok((ui.node as unknown as Node).panningModel === '', 'nonpositional cues remain centered'); ui.dispose();
spatialSettings.headphones = false;

const stemNodes: AudioNode[] = [];
const stems = new WeaponStems(ac, output, stemNodes);
const weapons = [{ def: { id: 'drones' }, level: 1, evolved: false }];
const notes: { midi: number; t: number }[] = [];
const recorder = { note(_dest: unknown, _patch: unknown, midi: number, t: number) { notes.push({ midi, t }); } } as unknown as MusicSynth;
const style = TRACKS[1].style;
const playBar = (bar = 0) => { for (let s = 0; s < 16; s++) stems.play(recorder, style, 2, 4, s + bar * 16, s / 8, 0.125); };
stems.commit(weapons, 0); playBar(); const lowCount = notes.length;
weapons[0].level = 10; weapons[0].evolved = true; notes.length = 0; playBar();
ok(notes.length === lowCount, 'build changes cannot alter the currently scheduled bar');
stems.commit(weapons, 2); notes.length = 0; playBar(1);
ok(notes.length > lowCount && notes.some((n) => n.t === 15 / 8), 'next bar gains rank density and evolution turnaround');
ok(notes.every((n) => style.scale.some((_, degree) => ((n.midi - degreeMidi(style, degree, 4)) % 12 + 12) % 12 === 0)), 'stem notes follow the song scale and transposition');
stems.commit([], 4); notes.length = 0; playBar(); ok(notes.length === 0, 'removing the build retires all layers at the next bar');

(globalThis as any).window = { addEventListener() {} };
const { Music } = await import('../src/audio/music');
const { sfx, audioSettings } = await import('../src/audio/sfx');
const { samples } = await import('../src/audio/samples');
(sfx as any).output = () => ({ ctx, node: output });
const music = new Music();
const want = { track: 'omega' as const, seed: 42, stage: 4, intensity: 1, duck: false };
// Adversarial eight-instrument build, evolved and max intensity, with the fullest boss arrangement.
music.setWeapons(Object.keys(WEAPON_STEMS).slice(0, stemTuning.slots).map((id) => ({ def: { id }, level: 30, evolved: true })));
music.setBossPhase(3);
music.update(1 / 60, want);
(music as any).cur.step = 40 * 16;
for (let i = 0; i < 60 * 20; i++) { ctx.currentTime += 1 / 60; music.update(1 / 60, want); }
const synth = (music as any).synth;
ok(synth.peakVoices <= musicTuning.maxVoices && synth.droppedVoices === 0, `full boss music plus eight evolved stems stays bounded (peak ${synth.peakVoices}, drops ${synth.droppedVoices})`);
const internal = sfx as any;
internal.ctx = ac;
internal.musicBed = new Node(); internal.ambienceBed = new Node();
internal.healthFilter = new Node();
internal.buses = { sfx: dest, music: new Node(), ui: new Node(), threat: new Node(), voice: new Node() };
internal.master = new Node();
internal.duckGain = new Node();
sfx.silenceBeds(0.5);
const envelope = internal.musicBed.gain.events;
ok(envelope[0].value === 0.035 && envelope.at(-1).value === 1 && Math.abs(envelope.at(-1).time - ctx.currentTime - 0.518) < 1e-6, 'silence dips music with a fast, scheduled re-entry');
ok(JSON.stringify(envelope) === JSON.stringify(internal.ambienceBed.gain.events), 'music and ambience share the same dip envelope');
const eventCount = envelope.length;
music.silence(0.6);
ok(envelope.length === eventCount, 'overlapping big cues cannot indefinitely extend a dip');
audioSettings.adaptiveSilence = false; sfx.applyVolumes();
ok(envelope.at(-1).value === 1, 'disabling dips restores both beds');
const afterDisable = envelope.length;
music.silence(0.5); ok(envelope.length === afterDisable, 'dip toggle prevents later automation');
sfx.setLowHealth(1); ok(internal.healthFilter.frequency.value === 1800, 'low health filter applies to the common music/effects path');
audioSettings.lowHealth = false; sfx.applyVolumes();
ok(internal.healthFilter.frequency.value === 20000, 'disabling low health opens its independent filter');
// Exercise both recorded and synthesized positional paths, including lease cleanup.
spatialSettings.headphones = true;
(samples as any).ctx = ac;
(samples as any).outputs = { sfx: dest, ui: dest };
(samples as any).buffers.set('hit_flesh', { duration: 0.2 });
sfx.at(0, 1, 0, 5);
sfx.hit();
const panners = ctx.nodes.filter((n) => n.panningModel === 'HRTF' && !n.disconnected);
ok(panners.length === 2, 'sample and synth layers each receive the real world position');
const rearFilters = ctx.nodes.filter((n) => n.type === 'lowpass' && n.frequency.value === spatialTuning.rearCutoff);
ok(rearFilters.length >= 2, 'rear muffling applies to both recorded and synthesized layers');
for (const n of ctx.nodes) n.onended?.();
ok(panners.every((n) => n.disconnected) && samples.budget.count === 0, 'natural sample/synth endings release both budgets and spatial routes');
sfx.at(0, 1);
spatialSettings.headphones = false;
