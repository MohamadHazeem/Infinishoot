/**
 * Sound lane: evolution layers, threat telegraphs on the reserved band, hero
 * voice, enemy family calls, the UI kit, authored music themes and the
 * style-rank layer, captions and sound arrows. WebAudio is a recording fake
 * (graph construction, routing, budgets, cleanup); nothing here listens.
 */
import { ok } from './check';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';

// ---------------------------------------------------------------- a recording WebAudio fake
class Param {
  value = 0;
  events: { value: number; time: number }[] = [];
  setValueAtTime(value: number, time: number) { this.events.push({ value, time }); this.value = value; return this; }
  exponentialRampToValueAtTime(value: number, time: number) { return this.setValueAtTime(value, time); }
  linearRampToValueAtTime(value: number, time: number) { return this.setValueAtTime(value, time); }
  setTargetAtTime(value: number, time: number) { return this.setValueAtTime(value, time); }
  cancelScheduledValues() { return this; }
  cancelAndHoldAtTime() { return this; }
}
let made: FakeNode[] = [];
class FakeNode {
  gain = new Param(); frequency = new Param(); detune = new Param(); pan = new Param(); Q = new Param(); playbackRate = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
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
  createGain() { return new FakeNode('gain'); }
  createOscillator() { return new FakeNode('osc'); }
  createBufferSource() { return new FakeNode('src'); }
  createBiquadFilter() { return new FakeNode('filter'); }
  createStereoPanner() { return new FakeNode('pan'); }
  createDynamicsCompressor() { return new FakeNode('comp'); }
  createConvolver() { return new FakeNode('conv'); }
  createBuffer(_c: number, length: number) { const d = new Float32Array(length); return { duration: length / 8000, getChannelData: () => d }; }
  resume() { return Promise.resolve(); }
  decodeAudioData() { return Promise.reject(new Error('no')); }
}
(globalThis as any).window = { addEventListener() {} };
(globalThis as any).AudioContext = FakeContext;
(globalThis as any).fetch = () => Promise.reject(new Error('offline'));

const { sfx, audioSettings } = await import('../src/audio/sfx');
const { cuePriority, VoiceBudget } = await import('../src/audio/mix');
const { EVO_LAYERS, evoLayerOf, playEvoLayer } = await import('../src/audio/evoLayers');
const { enemyFamily, CallGate, callPitch, FAMILIES, familyTuning } = await import('../src/audio/families');
const { THREAT_CUES, reaperInterval, threatOf } = await import('../src/audio/threats');
const { BARKS, BARK_KINDS, compose, voiceProfile, speakSyllables, HERO_VOICES, voiceTuning } = await import('../src/audio/voice');
const { HeroVoice, voiceSettings } = await import('../src/audio/heroVoice');
const { UI_CUES, playUi, tickNote, UI_NOTES } = await import('../src/audio/uiKit');
const { a11yAudio, setCaptionSink, ANNOUNCER_LINES } = await import('../src/audio/captions');
const { WEAPONS } = await import('../src/data/weapons');
const { SPECIALS } = await import('../src/data/specials');
const { ENEMIES } = await import('../src/data/enemies');
const { HEROES } = await import('../src/data/heroes');
const { createWeapon } = await import('../src/game/weapons');
const { weaponCue, evoSoundKey } = await import('../src/game/systems/sound');

(sfx as any).ensure();
const sx = sfx as any;
ok(!!sx.ctx && !!sx.buses.threat && !!sx.buses.voice, 'sfx builds threat and voice buses');

/** Run fn, return the nodes it created. */
function capture(fn: () => void): FakeNode[] {
  made = [];
  fn();
  return made.slice();
}
const sources = (nodes: FakeNode[]) => nodes.filter((n) => (n.kind === 'osc' || n.kind === 'src') && n.started >= 0);
const tick = () => { sx.ctx.currentTime += 1; };

// A fake kit that just counts calls.
function countingKit() {
  const c = { tone: 0, noise: 0, vowel: 0 };
  return { c, kit: { tone: () => void c.tone++, noise: () => void c.noise++, vowel: () => void c.vowel++ } };
}

// ---------------------------------------------------------------- 1. evolution layers
{
  const keys: string[] = [];
  for (const d of Object.values(WEAPONS)) {
    for (const e of d.evos ?? []) keys.push(`${d.id}.${e.id}`);
    if (d.evolution || d.evo) keys.push(`${d.id}.evo`);
  }
  for (const d of Object.values(SPECIALS)) for (const e of d.evos ?? []) keys.push(`${d.id}.${e.id}`);
  const missing = keys.filter((k) => !EVO_LAYERS[k]);
  ok(keys.length >= 40 && missing.length === 0, `all ${keys.length} evolutions have a sound layer` + (missing.length ? ' (missing ' + missing.join(',') + ')' : ''));
  const siblings = Object.values(WEAPONS).concat(Object.values(SPECIALS) as never[]).filter((d) => (d.evos?.length ?? 0) >= 2);
  ok(siblings.every((d) => { const [a, b] = d.evos!.map((e) => EVO_LAYERS[`${d.id}.${e.id}`]); return a.char !== b.char || a.pitch !== b.pitch; }), 'the two evolutions of each item sound different from each other');
  ok(evoLayerOf('nope.never').char === 'prism', 'unknown evolutions fall back to a default layer');
  let quiet = 0;
  for (const k of Object.keys(EVO_LAYERS)) {
    const { c, kit } = countingKit();
    playEvoLayer(kit as never, k, 1);
    if (c.tone + c.noise + c.vowel === 0) quiet++;
  }
  ok(quiet === 0, 'every evolution layer plays something');

  const scene = new THREE.Scene();
  const scatter = createWeapon('scatter', scene);
  ok(weaponCue('scatter', scatter) === 'w:scatter' && evoSoundKey(scatter) === '', 'unevolved weapons send the plain cue');
  scatter.evolve(1);
  ok(weaponCue('scatter', scatter) === 'w:scatter|scatter.flak', 'track evolutions tag their cue (' + weaponCue('scatter', scatter) + ')');
  const drones = createWeapon('drones', scene);
  while (!drones.maxed) drones.levelUp();
  drones.evolve();
  ok(weaponCue('drone', drones) === 'w:drone|drones.evo', 'partner evolutions tag their cue');
  ok(weaponCue('shoot', null) === 'w:shoot', 'cues outside a weapon update carry no layer');

  tick();
  const plain = sources(capture(() => sfx.named('w:rail')));
  tick();
  const evolved = sources(capture(() => sfx.named('w:rail|rail.storm')));
  ok(plain.length > 0 && evolved.length > plain.length, `an evolved cue adds a layer (${plain.length} -> ${evolved.length} sources)`);
  tick();
  const special = sources(capture(() => sfx.named('evo:meteor.extinction')));
  ok(special.length > 0, 'special evolution layers play on their own (evo:<key>)');
}

// ---------------------------------------------------------------- 2. threat telegraphs
{
  ok(cuePriority('threat:sniper') > cuePriority('bossSlam') && cuePriority('cwind') === cuePriority('threat:mortar'), 'telegraphs outrank every effect');
  ok(cuePriority('threat:sniper') < 10, 'the announcer (10+) still outranks telegraphs');
  ok(cuePriority('call:robot') > cuePriority('die') && cuePriority('call:robot') < cuePriority('w:shoot'), 'family calls sit just above swarm noise');
  for (const name of Object.keys(THREAT_CUES)) ok(typeof sx[name] === 'function', `threat cue ${name} is playable by name`);
  ok(threatOf('threatSniper')?.id === 'sniper' && !threatOf('explode'), 'threat lookup');
  ok(reaperInterval(5) < reaperInterval(20) && reaperInterval(20) < reaperInterval(100) && reaperInterval(1000) === reaperInterval(40), 'the Reaper toll speeds up as it closes in');

  // Routing: reserved band skips duck and muffle.
  const threatBus: FakeNode = sx.buses.threat;
  ok(threatBus.outs.includes(sx.master) && !threatBus.outs.includes(sx.duckGain), 'threat bus goes straight to the master (never ducked)');
  ok(sx.buses.sfx.outs.includes(sx.duckGain), 'effects still go through the duck');
  tick();
  sfx.at(0.8, 0.1); // far right, far away
  const nodes = capture(() => sfx.threatSniper());
  sfx.at(0, 1);
  const pan = nodes.find((n) => n.kind === 'pan');
  ok(!!pan && pan.pan.value === 0.8 && pan.outs[0] === threatBus, 'telegraphs are panned toward their source on the threat bus');
  const g = nodes.find((n) => n.kind === 'gain' && n.outs.some((o) => o.kind === 'filter' || o.kind === 'pan'));
  ok(!!g && g.gain.value >= 0.55, 'far telegraphs keep a loudness floor');
  ok(sources(nodes).length >= 3, 'sniper lock-on plays several beeps');

  // Budget: a full budget of swarm noise yields to a telegraph.
  const b = new VoiceBudget(4);
  let stolen = 0;
  for (let i = 0; i < 4; i++) b.acquire('die' + i, cuePriority('die'), 2, () => stolen++);
  ok(!!b.acquire('threat:sniper', cuePriority('threat:sniper'), 4, () => {}) && stolen === 1 && b.count === 4, 'a telegraph steals a swarm voice when the budget is full');

  // Cleanup: every node of a finished cue disconnects.
  tick();
  const all = capture(() => sfx.threatMortar());
  for (const s of sources(all)) s.onended?.();
  await Promise.resolve();
  ok(all.filter((n) => n.kind !== 'dest').every((n) => n.disconnected), 'telegraph nodes disconnect when they end');
}

// ---------------------------------------------------------------- 3. hero voice
{
  for (const h of HEROES) ok(!!HERO_VOICES[h.id], `hero ${h.id} has a voice`);
  const f0s = HEROES.map((h) => voiceProfile(h.id).f0);
  ok(new Set(f0s).size === f0s.length, 'every hero speaks at its own pitch');
  const coop = [0, 1, 2, 3].map((i) => voiceProfile('rookie', i).f0);
  ok(new Set(coop).size === 4, 'four co-op Rookies still sound like four people');
  const odd = voiceProfile('some_new_hero', 0);
  ok(odd.f0 > 100 && odd.f0 < 400 && odd.syl > 0 && odd.tract > 0, 'unknown heroes get a derived voice');
  let bad = 0;
  for (const h of HEROES) for (const k of BARK_KINDS) for (let i = 0; i < 20; i++) {
    const u = compose(k, voiceProfile(h.id, i % 4), 'p0');
    const [lo, hi] = BARKS[k].syllables;
    if (u.syllables.length < lo || u.syllables.length > hi) bad++;
    for (const s of u.syllables) if (!(s.f0a > 40 && s.f0b > 40 && s.dur > 0.02 && s.vol > 0 && s.from[0] > 0 && s.to[1] > 0)) bad++;
    if (!(u.length > 0 && u.length < 2.5) || !BARKS[k].captions.includes(u.caption)) bad++;
  }
  ok(bad === 0, 'barks compose valid syllables for every hero and kind');
  const up = compose('levelUp', voiceProfile('rookie'), 'p0', () => 0.5);
  const down = compose('death', voiceProfile('rookie'), 'p0', () => 0.5);
  ok(up.syllables[up.syllables.length - 1].f0b > up.syllables[0].f0a && down.syllables[down.syllables.length - 1].f0b < down.syllables[0].f0a, 'level-up rises, death falls');
  const { c, kit } = countingKit();
  speakSyllables(kit as never, up);
  ok(c.vowel === up.syllables.length, 'each syllable sings one vowel');

  // Gates.
  let now = 100;
  let roll = 0;
  const caps: string[] = [];
  setCaptionSink((cap) => caps.push(cap.who + ': ' + cap.text));
  a11yAudio.captions = true;
  const v = new HeroVoice(() => now, () => roll);
  // A hero without recorded barks (the recorded ones speak through src/audio/voices.ts).
  const sp = { heroId: 'duelist', index: 1, name: 'Mia', color: '#fff' };
  ok(!!v.bark('hurt', sp), 'a bark plays');
  ok(caps.length === 1 && caps[0].startsWith('MIA: '), 'voice lines are captioned with the speaker');
  ok(!v.bark('hurt', sp), 'same bark is on cooldown');
  now += voiceTuning.globalGap + 0.01;
  ok(!v.bark('dash', sp), 'a low-priority bark waits for the hero to finish talking');
  ok(!!v.bark('death', sp), 'death interrupts');
  now += 10;
  roll = 0.99;
  ok(!v.bark('dash', sp), 'chance gates routine barks');
  ok(!!v.bark('dash', sp, { force: true, caption: false }) && caps.length === 2, 'forced barks skip the roll; uncaptioned ones stay off the strip');
  const sp2 = { ...sp, index: 2 };
  now += 10;
  roll = 0;
  v.bark('hurt', sp);
  ok(!v.bark('hurt', sp2), 'two heroes do not yelp at the same instant');
  now += voiceTuning.globalGap + 0.01;
  ok(!!v.bark('hurt', sp2), 'other heroes have their own cooldowns');
  voiceSettings.enabled = false;
  now += 100;
  ok(!v.bark('victory', sp, { force: true }), 'VOICE off silences barks');
  voiceSettings.enabled = true;
  a11yAudio.captions = false;
  const n = caps.length;
  now += 100;
  v.bark('victory', sp, { force: true });
  ok(caps.length === n, 'CAPTIONS off: no caption');

  tick();
  audioSettings.voice = 0.8;
  sfx.applyVolumes();
  const nodes = capture(() => sfx.speak(compose('evolve', voiceProfile('bulwark'), 'p0')));
  const pan = nodes.find((n) => n.kind === 'pan');
  ok(!!pan && pan.outs[0] === sx.buses.voice && sources(nodes).length >= 4, 'barks play on the voice bus');
  ok(sx.buses.voice.gain.value === 0.8, 'VOICE volume drives the voice bus');
}

// ---------------------------------------------------------------- 4. enemy family calls
{
  const fam = (id: string) => enemyFamily(ENEMIES[id]);
  ok(fam('shooter') === 'robot' && fam('bopper') === 'robot', 'robots beep');
  ok(fam('splitter') === 'slime' && fam('jellet') === 'slime', 'jellies squelch');
  ok(fam('leaper') === 'frog' && fam('mortar') === 'frog', 'Hop Frog and Mortar Toad croak');
  ok(fam('swarmer') === 'bug' && fam('golden') === 'bug' && fam('hive') === 'bug', 'bugs buzz');
  ok(fam('king') === 'boss' && fam('omega') === 'boss' && fam('prince') === 'boss', 'bosses and mini-bosses roar');
  ok(fam('reaper') === 'ghost', 'the Reaper moans');
  ok(enemyFamily({ ...ENEMIES.shooter, voice: 'frog' }) === 'frog', 'an EnemyDef voice field overrides the default');
  ok(Object.values(ENEMIES).every((d) => FAMILIES.includes(enemyFamily(d))), 'every enemy has a family');
  ok(callPitch(2, false) < callPitch(0.5, false) && callPitch(0.5, true) < callPitch(0.5, false), 'big and elite enemies call lower');
  const gate = new CallGate();
  ok(gate.allow('robot', 10) && !gate.allow('robot', 10 + familyTuning.global + 0.01), 'one family calls at most once per gap');
  ok(!gate.allow('slime', 10.01) && gate.allow('slime', 10 + familyTuning.global + 0.01), 'the global gap thins calls across families');
  for (const f of FAMILIES) {
    tick();
    const s = sources(capture(() => sfx.named('call:' + f, 1)));
    ok(s.length > 0, `call:${f} plays`);
  }
}

// ---------------------------------------------------------------- 5. UI kit
{
  for (const cue of UI_CUES) {
    const { c, kit } = countingKit();
    playUi(kit as never, cue, 1);
    ok(c.tone + c.noise > 0, `ui cue ${cue} plays`);
  }
  ok(tickNote(0) === UI_NOTES[0] && tickNote(1) === UI_NOTES[UI_NOTES.length - 1] && tickNote(0.5) > tickNote(0.2), 'slider ticks climb the scale');
  tick();
  const nodes = capture(() => sfx.menuSelect());
  ok(sources(nodes).length > 0 && nodes.some((n) => n.outs.includes(sx.buses.ui)), 'menu cues play on the menu bus');
}

// ---------------------------------------------------------------- 6. captions and sound arrows
{
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="hud"></div></body></html>');
  const { AudioA11y, edgePoint } = await import('../src/ui/audioA11y');
  const hud = dom.window.document.getElementById('hud')! as unknown as HTMLElement;
  const ui = new AudioA11y(hud);
  a11yAudio.captions = true;
  a11yAudio.arrows = true;
  const { caption, threatAt } = await import('../src/audio/captions');
  caption({ who: 'ANNOUNCER', text: ANNOUNCER_LINES.boss, color: '#ffcd75', kind: 'announcer' });
  ok(ui.caps.children.length === 1 && ui.caps.textContent!.includes('Warning! Boss approaching!'), 'captions show announcer lines');
  caption({ who: 'ANNOUNCER', text: ANNOUNCER_LINES.boss, color: '#ffcd75', kind: 'announcer' });
  ok(ui.caps.children.length === 1, 'a repeated line refreshes instead of stacking');
  for (const t of ['a', 'b', 'c', 'd']) caption({ who: 'ROOKIE', text: t, color: '#fff', kind: 'voice' });
  ok(ui.caps.children.length === 3, 'at most three caption lines');
  const offScreen = () => ({ x: -300, y: 200 });
  const onScreen = () => ({ x: 400, y: 300 });
  threatAt('threatSniper', 10, 0);
  ui.update(0.016, offScreen, 800, 600);
  ok(ui.shown.join() === 'sniper', 'an off-screen telegraph gets an edge arrow');
  ui.update(0.016, onScreen, 800, 600);
  ok(ui.shown.length === 0, 'on-screen sources need no arrow');
  threatAt('threatMortar', 10, 0);
  ui.update(5, offScreen, 800, 600);
  ok(ui.shown.length === 0, 'arrows expire');
  ui.update(5, offScreen, 800, 600);
  ok(ui.caps.children.length === 0, 'captions fade out');
  a11yAudio.arrows = false;
  threatAt('threatElite', 10, 0);
  ui.update(0.016, offScreen, 800, 600);
  ok(ui.shown.length === 0, 'SOUND ARROWS off: no arrows');
  const e = edgePoint(-300, 300, 800, 600, 56)!;
  ok(e && Math.round(e.x) === 56 && Math.round(e.y) === 300 && Math.round(e.angle) === 180, 'edge point clamps onto the inset rectangle');
  ok(edgePoint(400, 300, 800, 600, 56) === null, 'on-screen points have no edge point');
  setCaptionSink(null);
}

// ---------------------------------------------------------------- 7. announcer captions
{
  const { samples } = await import('../src/audio/samples');
  const { announcer, announcerSettings } = await import('../src/audio/announcer');
  const caps: string[] = [];
  setCaptionSink((c) => caps.push(c.text));
  a11yAudio.captions = true;
  announcerSettings.enabled = true;
  (samples as any).buffers.set('vo_boss', { duration: 1.4 });
  const play = samples.play;
  (samples as any).play = () => ({ duration: 1.4, stop() {} });
  announcer.reset();
  (await import('../src/audio/voices')).resetVoices(); // the barks above still hold the shared voice channel
  ok(announcer.say('boss') && caps[0] === 'Warning! Boss approaching!', 'announcer lines are captioned');
  (samples as any).play = () => null;
  audioSettings.muted = true;
  announcer.reset();
  (await import('../src/audio/voices')).resetVoices(); // the first line still holds the shared voice channel
  ok(announcer.say('boss') && caps.length === 2, 'muted audio still captions the announcer');
  audioSettings.muted = false;
  (samples as any).play = play;
  setCaptionSink(null);
  a11yAudio.captions = false;
}

// ---------------------------------------------------------------- 8. music: themes and the style layer
{
  const { TRACK_BY_ID, HERO_THEME, OMEGA_THEME, VICTORY_THEME, themeSteps, makeSong, chordAt } = await import('../src/audio/music/composition');
  const themes = { title: HERO_THEME, omega: OMEGA_THEME, victory: VICTORY_THEME } as const;
  for (const [id, th] of Object.entries(themes)) {
    ok(TRACK_BY_ID[id as 'title'].theme === th, `${id} has an authored theme`);
    const span = TRACK_BY_ID[id as 'title'].bars ? TRACK_BY_ID[id as 'title'].bars! * 16 : 64;
    let overlaps = 0;
    let dissonant = 0;
    th.notes.forEach((n, i) => {
      const next = th.notes[i + 1];
      if (n[0] + n[2] > (next ? next[0] : span)) overlaps++;
      if (n[0] % 4 === 0) {
        const chord = th.chords[Math.floor(n[0] / 16) % 4];
        const rel = (((n[1] - chord) % 7) + 7) % 7;
        if (![0, 2, 4].includes(rel)) dissonant++;
      }
    });
    ok(overlaps === 0, `${id} theme notes fit their bars without overlapping`);
    ok(dissonant === 0, `${id} theme lands on chord tones on every beat`);
  }
  const cell = (th: typeof HERO_THEME) => th.notes.slice(0, 4).map((n) => [n[0], n[2]].join(':')).join();
  const steps = (th: typeof HERO_THEME) => th.notes.slice(0, 4).map((n) => n[1] - th.notes[0][1]).join();
  ok(cell(VICTORY_THEME) === cell(HERO_THEME) && steps(VICTORY_THEME) === steps(HERO_THEME), 'the victory fanfare quotes the hero leitmotif');
  ok(cell(OMEGA_THEME) === cell(HERO_THEME), 'Omega keeps the leitmotif rhythm');
  const song = makeSong(TRACK_BY_ID.title.style, 5, HERO_THEME);
  ok(themeSteps(HERO_THEME).filter(Boolean).length === HERO_THEME.notes.length && chordAt(song, 'chorus', 1) === HERO_THEME.chords[1] && chordAt(song, 'bridge', 0) !== undefined, 'themed songs follow the theme chords');

  const { Music } = await import('../src/audio/music');
  const { MusicSynth } = await import('../src/audio/music/synth');
  const ctx = new FakeContext();
  (sfx as any).output = () => ({ ctx, node: new FakeNode('out') });
  const count = (rank: number, track: 'meadow' | 'title' | 'omega') => {
    const m = new Music() as any;
    m.setStyleRank(rank);
    let onStyle = 0;
    let onLead = 0;
    const note = MusicSynth.prototype.note;
    const hit = MusicSynth.prototype.noiseHit;
    const tally = function (this: unknown, dest: unknown) {
      if (m.cur && dest === m.cur.layers.style) onStyle++;
      if (m.cur && dest === m.cur.layers.lead) onLead++;
    };
    MusicSynth.prototype.note = function (this: any, dest: any, ...rest: any[]) { tally(dest); return (note as any).call(this, dest, ...rest); };
    MusicSynth.prototype.noiseHit = function (this: any, dest: any, ...rest: any[]) { tally(dest); return (hit as any).call(this, dest, ...rest); };
    const want = { track, seed: 3, stage: 1, intensity: 0.9, duck: false };
    for (let i = 0; i < 60 * 24; i++) { ctx.currentTime += 1 / 60; m.update(1 / 60, want); }
    MusicSynth.prototype.note = note;
    MusicSynth.prototype.noiseHit = hit;
    return { onStyle, onLead, rank: m.style };
  };
  const d = count(0, 'meadow');
  const b = count(2, 'meadow');
  const s = count(5, 'meadow');
  ok(d.onStyle === 0 && b.onStyle > 0 && s.onStyle > b.onStyle * 2, `style layer grows with rank (D ${d.onStyle}, B ${b.onStyle}, SS ${s.onStyle})`);
  ok(s.rank === 5, 'the style rank takes effect at a bar');
  const t = count(0, 'title');
  const o = count(0, 'omega');
  ok(t.onLead > 30 && o.onLead > 30, `themed tracks play their leitmotif (title ${t.onLead}, omega ${o.onLead} lead notes)`);
}
