/** Procedural music: generated songs are valid and seeded. */
import { ok } from './check';
(globalThis as any).window = { addEventListener() {} };
const { makeSong, TRACKS } = await import('../src/audio/music');
let bad = 0;
for (const t of TRACKS) for (let seed = 0; seed < 200; seed++) {
  const s = makeSong(t.style, seed);
  if (s.chords.length !== 4 || s.melody.length !== 64 || s.bass.length !== 16 || s.kick.length !== 16) bad++;
  for (const n of s.melody) if (n && (!Number.isFinite(n.deg) || n.deg < 0 || n.deg > 14)) bad++;
  if (s.melody.filter(Boolean).length < 4) bad++;
}
const a = JSON.stringify(makeSong(TRACKS[1].style, 42)), b = JSON.stringify(makeSong(TRACKS[1].style, 42)), c = JSON.stringify(makeSong(TRACKS[1].style, 43));
ok(bad === 0, 'songs are well formed for every track and 200 seeds');
ok(a === b, 'same seed, same song');
ok(a !== c, 'different seed, different song');

const { sectionAt, chordAt, degreeMidi, stageTranspose, bossTrack, biomeTrack, phaseAt, inBeatWindow, trackUnlocked } = await import('../src/audio/music/composition');
const { Music, musicTuning } = await import('../src/audio/music');
const { sfx } = await import('../src/audio/sfx');
const { MusicSynth } = await import('../src/audio/music/synth');

ok([0, 4, 12, 20, 28, 36, 40, 48, 52].map((b) => sectionAt(b, 0.6)).join(',') === 'intro,verse,chorus,verse,chorus,bridge,final,turnaround,verse', 'song form includes a single intro, contrasting bridge, lifted final and turnaround');
ok(sectionAt(12, 0.1) === 'verse' && sectionAt(8, 0.9) === 'chorus' && sectionAt(4, 0.9) === 'verse', 'intensity adapts at phrase boundaries while preserving verse setup');
ok(new Set([1, 2, 3, 4, 5, 6].map(stageTranspose)).size === 6 && stageTranspose(7) === 0, 'each stage changes key without drifting out of instrument register');
ok([1, 2, 3, 4, 5].map(bossTrack).join(',') === 'boss,rex,queen,omega,boss', 'four dedicated boss tracks match the stage rotation');
ok(biomeTrack(5) === 'neon' && biomeTrack(6) === 'factory' && biomeTrack(7) === 'sky' && biomeTrack(9) === 'meadow' && biomeTrack(0) === 'meadow', 'biomes repeat safely');
ok(TRACKS.length === 15 && new Set(TRACKS.slice(1, 5).map((t) => t.style.scale.join(','))).size === 4, 'jukebox has fifteen tracks (three for the loop-2 biomes) and four distinct classic area modes');
ok(trackUnlocked('shop', 0, 0) && !trackUnlocked('omega', 3, 10) && trackUnlocked('omega', 4, 1), 'jukebox unlocks use track metadata, not display index');
const song = makeSong(TRACKS[1].style, 42);
ok(chordAt(song, 'bridge', 0) === 5 && chordAt(song, 'turnaround', 3) === 4, 'bridge contrasts and turnaround resolves via the dominant');
ok(degreeMidi(song.style, -1) === 47 && degreeMidi(song.style, 7, 2) === 62, 'scale-degree conversion handles octaves and modulation');
ok(phaseAt(10.25, 10, 0.5) === 0.5 && phaseAt(9.9, 10, 0.5) === 0, 'beat phase follows absolute audio time');
ok(inBeatWindow(10.49, 10, 0.5, 15) && inBeatWindow(10.01, 10, 0.5, 15) && !inBeatWindow(10.25, 10, 0.5, 50), 'beat windows work on both sides of the beat');
ok(!inBeatWindow(10, 10, 0.5, -1) && !inBeatWindow(10, 10, 0.5, NaN), 'invalid beat windows never reward a kill');

/** Small WebAudio graph double: validates scheduling/lifecycle without browser globals. */
class Param {
  value = 0;
  events: { value: number; time: number }[] = [];
  setValueAtTime(value: number, time: number) { this.events.push({ value, time }); this.value = value; }
  exponentialRampToValueAtTime(value: number, time: number) { this.setValueAtTime(value, time); }
  linearRampToValueAtTime(value: number, time: number) { this.setValueAtTime(value, time); }
  setTargetAtTime(value: number, time: number) { this.setValueAtTime(value, time); }
  cancelScheduledValues(_time: number) {}
  cancelAndHoldAtTime(_time: number) {}
}
class Node {
  gain = new Param(); frequency = new Param(); detune = new Param(); pan = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  type = ''; buffer: unknown; disconnected = false; startTime = -1; stopTime = -1;
  connect(node: Node) { return node; }
  disconnect() { this.disconnected = true; }
  start(t: number) { this.startTime = t; }
  stop(t: number) { this.stopTime = t; }
}
class Context {
  currentTime = 0; sampleRate = 8000; state = 'running'; nodes: Node[] = [];
  createGain() { const n = new Node(); this.nodes.push(n); return n; }
  createOscillator() { return this.createGain(); }
  createBufferSource() { return this.createGain(); }
  createBiquadFilter() { return this.createGain(); }
  createStereoPanner() { return this.createGain(); }
  createDynamicsCompressor() { return this.createGain(); }
  createBuffer(_channels: number, length: number) { const data = new Float32Array(length); return { getChannelData: () => data }; }
}
function rig() {
  const ctx = new Context();
  (sfx as any).output = () => ctx.state === 'running' ? { ctx, node: new Node() } : null;
  const music = new Music();
  const want = { track: 'meadow' as import('../src/audio/music').TrackId | null, seed: 42, stage: 1, intensity: 0.8, duck: false, cue: undefined as 'victory' | 'gameover' | undefined };
  const advance = (seconds: number) => {
    const end = ctx.currentTime + seconds;
    while (ctx.currentTime < end) { ctx.currentTime += 1 / 60; music.update(1 / 60, want); }
  };
  return { ctx, music, want, advance };
}
{
  const { ctx, music, want, advance } = rig();
  ok(music.beatPhase() === 0 && !music.onBeatWindow(100), 'unstarted music has no bonus window');
  music.update(1 / 60, want);
  ok(music.beatPhase() === 0, 'scheduled-ahead first beat does not move phase early');
  advance(0.06);
  ok(music.beats === 1 && music.onBeatWindow(40), 'counter and window start on the audible beat');
  const boundary = 0.04 + 4 * 60 / 128;
  want.track = 'omega';
  advance(0.8);
  ok(music.playing === 'meadow', 'track requests wait for the outgoing bar');
  advance(1.1);
  const internal = music as any;
  ok(music.playing === 'omega' && Math.abs(internal.old[0].end - boundary - musicTuning.crossfade - 0.03) < 1e-6, 'tempo change and crossfade share the outgoing downbeat');
  music.setBossPhase(3);
  advance(1.5);
  ok(internal.cur.phase === 3 && internal.cur.transpose === 4, 'boss phase escalation is applied on the next bar');
  ok(internal.old.length === 0, 'fading tracks retire at a fixed deadline');
  const before = music.beats;
  ctx.currentTime += 120;
  music.update(1 / 60, want);
  ok(music.beats === before && !music.onBeatWindow(5), 'tab sleep discards stale beats instead of awarding backlog');
  ctx.state = 'suspended';
  ok(music.beatPhase() === 0 && !music.onBeatWindow(100), 'suspended context has no active beat window');
  ctx.state = 'running';
  music.stop();
  ok(music.beatTimes.length === 0 && music.pulse === 0 && !music.onBeatWindow(100), 'stop resets queued beats and bonus windows');
}
{
  const { music, want, advance } = rig();
  advance(0.2);
  want.cue = 'victory'; want.track = 'shop';
  advance(0.02);
  want.cue = undefined;
  advance(2);
  ok(music.playing === 'victory', 'short stage-clear state latches a quantized victory sting');
  advance(5);
  ok(music.playing === 'shop', 'victory finishes once and hands off to shop');
  want.cue = 'victory';
  advance(3);
  ok(music.playing === 'shop', 'returning from a level-up to cleared does not replay the victory');
  want.cue = undefined;
  want.cue = 'gameover'; want.track = null;
  advance(8);
  ok(music.playing === null, 'game-over sting finishes into silence');
  advance(4);
  ok(music.playing === null, 'remaining on game-over screen does not repeat the sting');
}
{
  const { ctx, music, want, advance } = rig();
  for (const track of TRACKS.filter((t) => !t.bars)) {
    want.track = track.id;
    want.stage = 4;
    want.intensity = 1;
    music.setBossPhase(3);
    advance(5);
    // Visit the busiest final-chorus phrase with real scheduling, not just pure generators.
    const p = (music as any).cur;
    p.step = 40 * 16;
    p.nextTime = ctx.currentTime + 0.04;
    advance(9);
    ok(p.transpose === stageTranspose(track.id === 'title' ? 1 : want.stage) + (track.boss ? 4 : 0) + 2, `${track.id} final chorus lifts two semitones above its current key`);
  }
  const synth = (music as any).synth;
  ok(synth.peakVoices <= musicTuning.maxVoices && synth.droppedVoices === 0, `all full arrangements stay below the voice cap (peak ${synth.peakVoices})`);
  want.track = null;
  advance(8);
  ok((music as any).old.length === 0 && ctx.nodes.filter((n) => !n.disconnected).length <= 1, 'all source and routing nodes disconnect after playback stops');
}
{
  const ctx = new Context();
  const synth = new MusicSynth(ctx as any, new Node() as any);
  for (let i = 0; i < 120; i++) synth.note(new Node() as any, 'bell', 60, 0, 1, 0.5);
  ok(synth.peakVoices === 96 && synth.droppedVoices === 24, 'voice cap bounds even an overloaded scheduler');
  ctx.currentTime = 2; synth.reap();
  ok(ctx.nodes.filter((n) => !n.disconnected).length === 1, 'FM carriers, modulators and envelopes are all reclaimed');
}
