/**
 * Sound lane, wave 2: surround stingers, the arena crowd, the radio DJ, the
 * instrument band, the boss music duel and comeback tension, loudness and
 * hearing, and the wave-1 feature cues. WebAudio is a recording fake (graph
 * building, automation curves, routing, budgets and cleanup); nothing here
 * actually listens.
 */
import { ok } from './check';

// ---------------------------------------------------------------- a recording WebAudio fake
class Param {
  value = 0;
  events: { value: number; time: number }[] = [];
  curves: { values: Float32Array; time: number; dur: number }[] = [];
  setValueAtTime(value: number, time: number) { this.events.push({ value, time }); this.value = value; return this; }
  exponentialRampToValueAtTime(value: number, time: number) { return this.setValueAtTime(value, time); }
  linearRampToValueAtTime(value: number, time: number) { return this.setValueAtTime(value, time); }
  setTargetAtTime(value: number, time: number) { return this.setValueAtTime(value, time); }
  setValueCurveAtTime(values: Float32Array, time: number, dur: number) { this.curves.push({ values: Float32Array.from(values), time, dur }); this.value = values[values.length - 1]; return this; }
  cancelScheduledValues() { return this; }
  cancelAndHoldAtTime() { return this; }
}
let made: FakeNode[] = [];
class FakeNode {
  gain = new Param(); frequency = new Param(); detune = new Param(); pan = new Param(); Q = new Param(); playbackRate = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  positionX = new Param(); positionY = new Param(); positionZ = new Param();
  panningModel = ''; rolloffFactor = 1; curve: Float32Array | null = null; loop = false;
  type = ''; buffer: unknown = null; kind: string; outs: FakeNode[] = []; disconnected = false; started = -1; stopped = -1;
  onended: (() => void) | null = null;
  constructor(kind: string) { this.kind = kind; made.push(this); }
  connect(n: FakeNode) { this.outs.push(n); return n; }
  disconnect() { this.disconnected = true; this.outs.length = 0; }
  start(t = 0) { this.started = t; }
  stop(t = 0) { this.stopped = t; }
}
class FakeContext {
  currentTime = 1; sampleRate = 8000; state = 'running'; destination = new FakeNode('dest');
  listener = { positionX: new Param(), positionY: new Param(), positionZ: new Param(), forwardX: new Param(), forwardY: new Param(), forwardZ: new Param(), upX: new Param(), upY: new Param(), upZ: new Param() };
  createGain() { return new FakeNode('gain'); }
  createOscillator() { return new FakeNode('osc'); }
  createBufferSource() { return new FakeNode('src'); }
  createBiquadFilter() { return new FakeNode('filter'); }
  createStereoPanner() { return new FakeNode('pan'); }
  createPanner() { return new FakeNode('panner3d'); }
  createWaveShaper() { return new FakeNode('shaper'); }
  createDynamicsCompressor() { return new FakeNode('comp'); }
  createConvolver() { return new FakeNode('conv'); }
  createBuffer(_c: number, length: number) { const d = new Float32Array(length); return { duration: length / 8000, getChannelData: () => d }; }
  resume() { return Promise.resolve(); }
  decodeAudioData() { return Promise.reject(new Error('no')); }
}
(globalThis as any).window = { addEventListener() {} };
(globalThis as any).AudioContext = FakeContext;
(globalThis as any).fetch = () => Promise.reject(new Error('offline'));

const { sfx } = await import('../src/audio/sfx');
const { cuePriority } = await import('../src/audio/mix');
const { samples } = await import('../src/audio/samples');
const SR = await import('../src/audio/surround');
const { spatialSettings, updateListener } = await import('../src/audio/spatial');
const CR = await import('../src/audio/crowd');
const RD = await import('../src/audio/radio');
const IN = await import('../src/audio/instruments');
const DU = await import('../src/audio/musicDuel');
const LD = await import('../src/audio/loudness');
const FC = await import('../src/audio/featureCues');
const { voiceChannel, setVoiceClock } = await import('../src/audio/voices');
const { a11yAudio, setCaptionSink } = await import('../src/audio/captions');
const { Music } = await import('../src/audio/music');

(sfx as any).ensure();
const sx = sfx as any;
const ctx = sx.ctx as FakeContext;
ok(!!ctx, 'fake audio context is up');

function capture(fn: () => void): FakeNode[] {
  made = [];
  fn();
  return made.slice();
}
const sources = (nodes: FakeNode[]) => nodes.filter((n) => (n.kind === 'osc' || n.kind === 'src') && n.started >= 0);
const endAll = (nodes: FakeNode[]) => { for (const n of sources(nodes)) n.onended?.(); };
const flushMicro = () => new Promise<void>((r) => queueMicrotask(r));
function countingKit() {
  const c = { tone: 0, noise: 0, vowel: 0, swell: 0 };
  return { c, kit: { tone: () => void c.tone++, noise: () => void c.noise++, vowel: () => void c.vowel++, swell: () => void c.swell++ } };
}

// ---------------------------------------------------------------- 1. surround stingers
{
  const boss = SR.SURROUND.boss;
  const turn = SR.surroundAngle(boss, 1) - SR.surroundAngle(boss, 0);
  ok(Math.abs(turn - Math.PI * 2) < 1e-6, `a boss arrival goes around you exactly once (${(turn / Math.PI).toFixed(3)} pi)`);
  const pan = SR.panCurve(boss, 49);
  ok(pan.every((v) => v >= -1 && v <= 1) && Math.min(...pan) < -0.95 && Math.max(...pan) > 0.95, 'the boss sweep pans fully left and right');
  const rear = SR.rearCurve(boss, 49);
  ok(rear[0] < 0.01 && Math.max(...rear) > 0.99, 'it starts in front and passes straight behind you');
  const cut = SR.cutoffCurve(boss, 49);
  ok(cut[0] > 15000 && Math.min(...cut) <= SR.surroundTuning.rearCutoff + 1, 'the low-pass closes behind you (the stereo rear cue)');
  const wp = SR.worldPath(boss, 10, -4, 0, -1, 25);
  ok([...wp.x].every((x, i) => Math.abs(Math.hypot(x - 10, wp.z[i] + 4) - boss.radius) < 1e-4), 'the HRTF path keeps its radius around the listener');
  ok(Math.abs(wp.x[0] - 10) < 1e-4 && wp.z[0] < -4, 'and starts in front of where the hero faces');
  ok(SR.SURROUND_IDS.every((id) => { const { c, kit } = countingKit(); SR.playSurroundRecipe(kit as never, id); return c.tone + c.noise + c.swell > 0; }), 'every stinger id has a recipe');

  spatialSettings.headphones = false;
  SR.resetSurround();
  ctx.currentTime += 5;
  const nodes = capture(() => ok(SR.playSurround('boss'), 'boss stinger plays'));
  const sp = nodes.find((n) => n.kind === 'pan');
  ok(!!sp && sp.pan.curves.length === 1 && sp.pan.curves[0].dur === boss.dur, 'stereo: the pan follows an automation curve over the stinger');
  ok(nodes.some((n) => n.kind === 'filter' && n.frequency.curves.length === 1), 'stereo: the rear low-pass is automated too');
  ok(sources(nodes).length >= 3, `the boss stinger has a few layers (${sources(nodes).length})`);
  ok(!SR.playSurround('boss'), 'the same stinger is on cooldown right after');
  const before = samples.budget.count;
  endAll(nodes);
  ok(nodes.filter((n) => n.kind !== 'dest').every((n) => n.disconnected), 'all of its nodes disconnect when it ends');
  ok(samples.budget.count === before - 1, 'and it gives its voice budget lease back');

  spatialSettings.headphones = true;
  updateListener(ctx as never, 3, 7, 1, 0);
  ctx.currentTime += 5;
  const hn = capture(() => SR.playSurround('titan', true));
  const p3 = hn.find((n) => n.kind === 'panner3d');
  ok(!!p3 && p3.panningModel === 'HRTF' && p3.positionX.curves.length === 1 && p3.positionZ.curves.length === 1, 'headphones: an HRTF panner moves around the listener');
  const xs = p3!.positionX.curves[0].values;
  const zs = p3!.positionZ.curves[0].values;
  ok(Math.abs(Math.hypot(xs[0] - 3, zs[0] - 7) - SR.SURROUND.titan.radius) < 1e-3, 'headphones: the path is centred on the listener (the local hero)');
  endAll(hn);
  spatialSettings.headphones = false;

  ctx.currentTime += 5;
  SR.resetSurround();
  const el = capture(() => sfx.elite());
  ok(el.some((n) => n.kind === 'pan' && n.pan.curves.length === 1), 'an elite arrival also swooshes around you');
  endAll(el);
  ctx.currentTime += 5;
  SR.resetSurround();
  const ec = capture(() => sfx.named('s2:ev_eclipse'));
  ok(ec.some((n) => n.kind === 'pan' && n.pan.curves.length === 1), 'the eclipse start cue carries its surround stinger');
  endAll(ec);
}

// ---------------------------------------------------------------- 2. crowd
{
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cheer = CR.chorusNotes('cheer', rand, 7);
  const boo = CR.chorusNotes('boo', rand, 7);
  ok(cheer.length === 7 && cheer.every((n) => n.f0b > n.f0a), 'cheers rise ("yay")');
  ok(boo.every((n) => n.f0b < n.f0a) && Math.max(...boo.map((n) => n.f0a)) < Math.min(...cheer.map((n) => n.f0a)) + 60, 'boos fall and sit low');
  ok(cheer.some((n) => n.pan < -0.5) && cheer.some((n) => n.pan > 0.5), 'the chorus is spread across the stereo field');
  const claps = CR.clapTimes(2, rand);
  ok(claps.length > 20 && claps.every((t, i) => t >= 0 && t <= 2 && (i === 0 || t >= claps[i - 1])), `applause: ${claps.length} claps inside 2 s, in order`);

  const c = new CR.Crowd(rand);
  ctx.currentTime += 10;
  CR.crowdSettings.enabled = true;
  c.update(0.5, true, false);
  ok(c.hasBed, 'the crowd bed starts in a fight');
  const out = (c as any).bed.out as FakeNode;
  const loud = out.gain.value;
  c.update(0.5, true, true);
  ok(out.gain.value < loud * 0.5, `the crowd dips under voices (${loud.toFixed(3)} -> ${out.gain.value.toFixed(3)})`);
  c.update(1, true, false);
  ok(out.gain.value > loud, 'and swells when the fight gets exciting');
  const rn = capture(() => ok(c.react('cheer', 1), 'a cheer plays'));
  ok(sources(rn).length >= 6, `a cheer is a roar plus a chorus (${sources(rn).length} sources)`);
  ok(!c.react('cheer', 1), 'the same reaction is on cooldown');
  ok(!c.react('boo', 1), 'and reactions keep a short gap between them');
  ctx.currentTime += 1;
  ok(c.react('boo', 1), 'a boo plays after the gap');
  endAll(rn);
  ok(rn.filter((n) => n.kind !== 'dest').every((n) => n.disconnected), 'a finished reaction disconnects everything');
  CR.crowdSettings.enabled = false;
  ctx.currentTime += 10;
  ok(!c.react('roar', 1, true), 'CROWD off: no reactions');
  c.update(0, false, false);
  c.update(0, false, false);
  ok(!c.hasBed, 'CROWD off: the bed fades out and stops');
  CR.crowdSettings.enabled = true;
  for (const k of CR.CROWD_REACTIONS) {
    ctx.currentTime += 10;
    const n = capture(() => c.react(k, 1, true));
    ok(sources(n).length > 0, `crowd reaction ${k} makes sound`);
    endAll(n);
  }
}

// ---------------------------------------------------------------- 3. radio DJ
{
  const hl = RD.emptyHighlights(3);
  hl.boss = 'Rampage Rex';
  hl.bossHits = 0;
  hl.bossTime = 40;
  hl.maxCombo = 312;
  hl.kills = 180;
  const lines = RD.highlightLines(hl, () => 0);
  ok(lines[0].text === 'Zero hits on Rex? Respect!', `a no-hit boss is the top line ("${lines[0].text}")`);
  ok(lines.some((l) => l.text.includes('312')), 'the combo line names the number');
  const ti = RD.emptyHighlights(6);
  ti.boss = 'Titan Goliath';
  ti.titan = true;
  ti.bossHits = 3;
  ok(RD.highlightLines(ti, () => 0)[0].text.includes('Titan'), 'the Titan gets its own line');
  const plain = RD.highlightLines(RD.emptyHighlights(2), () => 0);
  ok(plain.length === 1 && plain[0].text.includes('Stage 2'), 'a quiet stage still gets a line');
  const script = RD.radioScript(hl, () => 0.5);
  ok(script.length === 4 && script[1] !== script[2], 'a break is an intro, two different highlights and a sign-off');
  ok(RD.bossNick('King Bopper') === 'the King' && RD.bossNick('Hive Queen') === 'the Queen', 'boss nicknames');
  const syl = RD.wordSyllables('respect');
  ok(syl.length === 2 && syl[0].vowel === 'e' && syl[1].vowel === 'e', 'words split into their vowel syllables');
  ok(RD.wordSyllables('312').length >= 2, 'numbers are spoken as a few syllables');
  const ex = RD.composeSpeech('That Titan never stood a chance!', () => 0.5);
  const q = RD.composeSpeech('Zero hits on Rex?', () => 0.5);
  const flat = RD.composeSpeech('Stage two is done.', () => 0.5);
  const last = (u: typeof ex) => u.syllables[u.syllables.length - 1];
  ok(last(ex).f0b > last(ex).f0a && last(q).f0b > last(q).f0a * 1.2, 'exclamations and questions rise at the end');
  ok(last(flat).f0b <= last(flat).f0a, 'statements fall at the end');
  ok(ex.syllables.every((s, i) => i === 0 || s.delay > ex.syllables[i - 1].delay) && ex.length > 0.5 && ex.length < 3, `a sentence is a sensible length (${ex.length.toFixed(2)} s)`);

  let now = 100;
  setVoiceClock(() => now);
  RD.setRadioClock(() => now);
  voiceChannel.reset();
  const caps: string[] = [];
  a11yAudio.captions = true;
  setCaptionSink((c) => caps.push(c.who + ': ' + c.text));
  const dj = new RD.RadioDj(() => 0.5);
  // Somebody else is talking: the break waits.
  voiceChannel.claim(15, now, 2, () => {});
  dj.queue(['Hello there!', 'Zero hits on Rex? Respect!'], 8);
  dj.update(true);
  ok(!dj.active, 'the DJ waits while the announcer talks');
  now += 2.5;
  ctx.currentTime += 3;
  const nodes = capture(() => dj.update(true));
  ok(dj.active, 'and starts once the channel is free');
  ok(nodes.some((n) => n.kind === 'filter' && n.type === 'highpass') && nodes.some((n) => n.kind === 'filter' && n.type === 'lowpass') && nodes.some((n) => n.kind === 'shaper'), 'the voice goes through the radio chain (band-pass and crunch)');
  ok(nodes.filter((n) => n.kind === 'osc' && n.started >= 0).length > 10, 'the jingle and the formant syllables are scheduled');
  ok(voiceChannel.current === RD.radioTuning.priority && voiceChannel.remaining(now) > 1, 'the DJ claims the voice channel');
  now += 0.8;
  dj.update(true);
  ok(caps.length === 1 && caps[0] === 'DJ VOLT: Hello there!', `the first line is captioned (${caps.join(' | ')})`);
  ok(dj.onAir.text === 'Hello there!', 'the ON AIR panel shows the current line');
  for (let i = 0; i < 40; i++) {
    now += 0.1;
    dj.update(true);
  }
  ok(caps.length === 2 && caps[1].includes('Respect'), `then the next line (${caps.length} captions)`);
  now += 10;
  dj.update(true);
  ok(!dj.active && dj.onAir.text === '', 'the break ends');
  RD.radioSettings.enabled = false;
  dj.queue(['Nope!'], 8);
  dj.update(true);
  ok(!dj.active, 'RADIO DJ off: nothing plays');
  RD.radioSettings.enabled = true;
  setCaptionSink(null);
  a11yAudio.captions = false;
  setVoiceClock(() => performance.now() / 1000);
  RD.setRadioClock(() => performance.now() / 1000);
  voiceChannel.reset();
}

// ---------------------------------------------------------------- 4. instruments and the music (duel, tension)
{
  ok(IN.idsOf(IN.maskOf(['cowbell', 'choir'])).join() === 'cowbell,choir', 'band masks round-trip');
  for (const id of IN.INSTRUMENT_IDS) {
    let notes = 0;
    for (let s = 0; s < 16; s++) notes += IN.bandNotes(id, s, 1, 'chorus').length;
    ok(notes > 0, `${id} plays in a chorus bar (${notes} notes)`);
  }
  ok(IN.bandNotes('sax', 0, 0, 'chorus').length === 0 && IN.bandNotes('sax', 0, 1, 'chorus').length === 1, 'the sax answers in odd bars only');
  ok(new Set(IN.INSTRUMENT_IDS.map((i) => IN.INSTRUMENTS[i].color)).size === IN.INSTRUMENT_IDS.length, 'every instrument has its own colour');

  ok(DU.duelTurnAt(0) === 1 && DU.duelTurnAt(1) === 1 && DU.duelTurnAt(2) === 2 && DU.duelTurnAt(3) === 2 && DU.duelTurnAt(4) === 1, 'duel phrases alternate every two bars, boss first');
  ok(DU.minorScale([0, 2, 4, 5, 7, 9, 11]).join() === '0,2,3,5,7,8,10', 'major turns natural minor');
  ok(DU.minorScale([0, 2, 3, 5, 7, 8, 10]).join() === '0,2,3,5,7,8,10', 'minor stays minor');

  // A small rig like tests/music.test.ts: count notes and watch automation.
  const rig = () => {
    const c = new FakeContext();
    (sfx as any).output = () => ({ ctx: c, node: new FakeNode('out') });
    const m = new Music();
    const want = { track: 'meadow' as any, seed: 42, stage: 1, intensity: 0.8, duck: false };
    const advance = (sec: number) => { const end = c.currentTime + sec; while (c.currentTime < end) { c.currentTime += 1 / 60; m.update(1 / 60, want); } };
    return { c, m, want, advance };
  };
  const notes = (setup: (m: InstanceType<typeof Music>) => void) => {
    const r = rig();
    setup(r.m);
    made = [];
    r.advance(8);
    return made.filter((n) => n.kind === 'osc' && n.started >= 0).length;
  };
  const plainN = notes(() => {});
  const bandN = notes((m) => m.setInstruments(IN.maskOf([...IN.INSTRUMENT_IDS])));
  ok(bandN > plainN * 1.15, `the band adds notes to the song (${plainN} -> ${bandN} oscillators in 8 s)`);
  {
    const r = rig();
    r.m.setInstruments(IN.maskOf(['cowbell']));
    r.advance(3);
    ok(r.m.instruments === IN.maskOf(['cowbell']), 'the band is committed at a bar');
  }
  {
    const r = rig();
    r.want.track = 'rex';
    r.m.setDuel(true);
    const turns = new Set<string>();
    for (let i = 0; i < 40; i++) { r.advance(0.5); turns.add(r.m.duelTurn ?? '-'); }
    ok(turns.has('boss') && turns.has('hero'), `boss tracks alternate boss and hero phrases (${[...turns].join(',')})`);
    r.m.setDuel(false);
    r.advance(3);
    ok(r.m.duelTurn === null, 'and stop when the duel is over');
    r.want.track = 'meadow';
    r.m.setDuel(true);
    r.advance(6);
    ok(r.m.duelTurn === null, 'a stage track never duels');
  }
  {
    const r = rig();
    r.advance(2);
    r.m.setTension(true);
    r.advance(3);
    ok(r.m.tense, 'comeback tension takes effect at a bar');
    const filt = (r.m as any).cur.filter as FakeNode;
    ok(filt.frequency.value <= DU.tensionTuning.cutoff + 1, `the tense song is muffled (${filt.frequency.value} Hz)`);
    const st = (r.m as any).cur.tenseStyle;
    ok(!!st && !st.scale.includes(4) && st.scale.includes(3), 'and plays in minor');
    const beat = r.m.beatPhase();
    ok(Number.isFinite(beat), 'the beat clock keeps running');
    r.m.setTension(false);
    r.advance(3);
    ok(!r.m.tense && filt.frequency.value > 10000, 'healing brings the normal song back');
  }
  {
    // Worst case: Omega, six evolved stems, the whole band, the duel, SS style rank.
    const r = rig();
    r.want.track = 'omega';
    r.want.intensity = 1;
    r.m.setWeapons(['buster', 'charge', 'drones', 'lightning', 'missiles', 'fire'].map((id) => ({ def: { id }, level: 10, evolved: true })));
    r.m.setInstruments(IN.maskOf([...IN.INSTRUMENT_IDS]));
    r.m.setDuel(true);
    r.m.setBossPhase(3);
    r.m.setStyleRank(5);
    r.m.duelAccent(1.5);
    r.advance(40);
    const syn = (r.m as any).synth;
    ok(syn.peakVoices < 96 && syn.droppedVoices === 0, `busiest mix stays inside the 96-voice music budget (peak ${syn.peakVoices}, dropped ${syn.droppedVoices})`);
  }
  {
    const r = rig();
    r.m.setTalkover(true);
    r.advance(1);
    const menu = (r.m as any).cur.menu as FakeNode;
    ok(menu.gain.value <= 0.51, 'the music pulls back while the DJ talks');
  }
  (sfx as any).output = Object.getPrototypeOf(sfx).output.bind(sfx);
}

// ---------------------------------------------------------------- 5. loudness and hearing
{
  ok(LD.cueLoudness('w:shoot') === 1 && LD.cueLoudness('w:shoot|buster.flare') === 1, 'evolution tags keep their weapon loudness');
  ok(LD.cueLoudness('eshoot') === 0 && LD.cueLoudness('gem') === 0, 'enemy and pickup sounds make no noise');
  ok(LD.cueLoudness('w:chargeShot') < LD.hearingTuning.calm && LD.cueLoudness('w:aura') < LD.hearingTuning.calm, 'right-click shots and auras are quiet');
  ok(LD.cueLoudness('bomb') > LD.cueLoudness('explode') && LD.cueLoudness('explode') > LD.hearingTuning.attract && LD.cueLoudness('w:mechCannon') > 1.5, 'bombs, explosions and the mech are loud');
  const steady = (cue: string, rate: number) => {
    const f = new LD.NoiseField(8);
    for (let i = 0; i < 180; i++) {
      if (i % Math.round(60 / rate) === 0) f.add(0, 0, LD.cueLoudness(cue));
      f.decay(1 / 60);
    }
    return f.loudest(0, 0, 20, { x: 0, z: 0 });
  };
  const buster = steady('w:shoot', 8);
  const charge = steady('w:chargeShot', 1);
  const drones = steady('w:drone', 5);
  ok(buster > LD.hearingTuning.attract, `rapid Buster fire carries (${buster.toFixed(2)})`);
  ok(charge < LD.hearingTuning.calm && drones < LD.hearingTuning.calm, `charge shots and drones stay quiet (${charge.toFixed(2)}, ${drones.toFixed(2)})`);
  const f = new LD.NoiseField(4);
  f.add(0, 0, 1);
  f.add(1, 1, 1);
  ok(f.level.filter((l) => l > 0).length === 1 && f.level[0] > 1, 'nearby sounds merge into one blob that stacks up');
  f.add(30, 0, 2);
  const o = { x: 0, z: 0 };
  const h = f.loudest(25, 0, 20, o);
  ok(o.x > 20 && h > 1, 'the loudest heard blob wins');
  ok(f.loudest(-30, 0, 20, o) === 0, 'out of range is silence');
  ok(LD.hearDecision(2, 15, 10) === LD.HEARD.Attracted, 'a loud noise far from the hero pulls it in');
  ok(LD.hearDecision(2, 3, 10) === LD.HEARD.None, 'close to a hero it just attacks');
  ok(LD.hearDecision(0.1, 15, 0) === LD.HEARD.Calm, 'quiet and out of sight: it loses track');
  ok(LD.hearDecision(0.1, 5, 0) === LD.HEARD.None, 'but it still sees a hero nearby');
}

// ---------------------------------------------------------------- 6. feature cues (wave-1 features)
{
  const names = Object.keys(FC.LANE_CUES);
  for (const n of ['mechBoot', 'mechStep', 'mechStomp', 'mechEject', 'crateDrop', 'crateLand', 'titanRise', 'titanSweep', 'titanBreak', 'crack', 'collapse', 'giantStep', 'floodRush', 'eclipseDrone', 'bloom', 'volcanoRumble', 'sunBurst', 'standBeat', 'standTick', 'comeback', 'instrument', 'locator']) ok(names.includes(n), `feature cue ${n} exists`);
  for (const k of ['collapse', 'flood', 'split', 'giant', 'eclipse', 'flower', 'volcano', 'stealth']) ok(names.includes('ev_' + k), `world event ${k} has a start stinger`);
  let silent = 0;
  for (const n of names) {
    const { c, kit } = countingKit();
    FC.LANE_CUES[n].recipe(kit as never, 1);
    if (c.tone + c.noise + c.vowel + c.swell === 0) silent++;
  }
  ok(silent === 0, 'every feature cue plays something');
  ok(cuePriority('s2:titanRise') === 4 && cuePriority('s2:locator') === 1 && cuePriority('s2:nope') === 2, 'feature cues carry their own voice-budget priority');
  ctx.currentTime += 5;
  const a = capture(() => sfx.named('s2:mechStomp', 1));
  ok(sources(a).length >= 6, `the mech stomp layers a step and a shockwave (${sources(a).length})`);
  endAll(a);
  ctx.currentTime += 5;
  const w = capture(() => sfx.named('w:mechCannon'));
  ok(sources(w).length >= 3, 'the mech cannon has its own report');
  endAll(w);
  ctx.currentTime += 5;
  const tr = capture(() => sfx.named('s2:titanRise'));
  ok(tr.some((n) => n.kind === 'src' && n.loop), 'long rumbles loop the noise buffer');
  endAll(tr);
  await flushMicro();
}
