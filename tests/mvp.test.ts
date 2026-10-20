/**
 * Run awards and a bounded, proximity-based co-op band.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop),
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, { get: (_t, k) => (k === 'createImageData' || k === 'getImageData' ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) }) : k === 'canvas' ? this : noop[k as never]) });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent']) {
  try { (globalThis as any)[k] = (dom.window as any)[k]; } catch { Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true }); }
}
(globalThis as any).Path2D = (dom.window as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'test';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const M = await import('../src/game/systems/mvp');
const { BandMixer, bandGain, WeaponStems } = await import('../src/audio/stems');
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { ENEMIES } = await import('../src/data/enemies');
const { settings } = await import('../src/game/settings');
const { setLanguage } = await import('../src/i18n');
const game = new Game(new Input(document.getElementById('game') as HTMLCanvasElement), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
cheats.unlockAll = true;
settings.finishers = false;
game.startSolo(); game.closeShop(); game.enemies.clear();
const h = game.hero;
const ally = game.makeHero(1, '<img src=x onerror=alert(1)>', []);
ally.startRun(); game.setHeroes([h, ally]);
game.runTime = 10;
const kill = (by = h, state: 'move' | 'windup' = 'move') => {
  const e = game.enemies.spawn(ENEMIES.swarmer, 0, 0, game.spawnOpts({ instant: true }));
  e.state = state; e.hp = 1;
  game.damage(e, 20, { source: 'buster', fixed: true }, by);
};
kill(); game.runTime = 11; kill();
ally.player.dead = true; ally.player.teleport(0, 0);
game.runTime = 12; kill(h, 'windup');
let r = game.mvp.rows.get(h)!;
ok(r.kills === 3 && r.bestCombo === 3 && r.saves === 1, 'kills, personal combo and saves are attributed to the killer');
kill(h); ok(r.saves === 1, 'walking enemies are not saves');
h.player.invuln = 0; h.player.hp = 100; game.hurtHero(h, 9, 1, 1);
ok(r.taken === 9 && r.combo === 0, 'actual accepted damage resets only personal combo');
game.hurtHero(h, 9, 1, 1); ok(r.taken === 9, 'invulnerability does not inflate damage taken');
game.runTime = 20; kill(); ok(r.bestCombo === 4 && r.combo === 1, 'a kill after the window starts a new combo');
h.player.teleport(0, 0); h.player.hp = 10;
ally.reviveT = 3; game.updateRevives(0.01);
ok(r.revives === 1 && r.clutch === 1 && !ally.player.dead, 'a real last-standing revive credits its helper');
game.reviveHero(ally, 0.5, false); ok(r.revives === 1, 'free stage revives are not helper revives');
game.mvpShared(h, 12); ok(r.shared === 12, 'shared revive spending has its own counter');
const fusion = Object.values((await import('../src/data/weapons')).WEAPONS).find(w => w.fusion)!;
h.weapons.push((await import('../src/game/weapons')).createWeapon(fusion.id, game.scene));
game.mvpStep(true); game.mvpStep(true);
ok(game.mvp.moments.filter(m => m.kind === 'fusion').length === 1, 'fusion acquisition is captured once');
const oldKills = r.kills;
game.role = 'client'; kill(); game.mvpHurt(h, 99); game.mvpShared(h, 99); game.mvpRevive(ally, [h]);
ok(r.kills === oldKills && r.taken === 9 && r.shared === 12 && r.revives === 1, 'client event hooks never compute authority stats');
game.role = 'solo';
const demo = M.mvpDemo(game, 8);
ok(demo.awards.length === 8, 'eight eligible award categories');
const tied = [demo.players[1], { ...demo.players[1], index: 0 }];
ok(M.awardMvp(tied).every(a => a.player === 0), 'award ties deterministic regardless of iteration order');
ok(M.awardMvp([{ ...demo.players[0], damage: 0, gold: 0, peaceful: 0, saves: 0, dashes: 0, clutch: 0, bestCombo: 0 }]).length === 0, 'zero activity never earns invented achievements');
const state = M.createMvp();
for (let i = 0; i < 100; i++) M.addMoment(state, { time: i, player: 0, kind: i < 2 ? 'boss' : 'legendary', detail: '' });
ok(state.moments.length === M.mvpTuning.highlights && state.moments[0].kind === 'boss', 'bounded highlight reel preserves big moments before loot');
const report = game.mvpFinish();
ok(report.players[0].damage >= 5 && report.players[0].taken === 9, 'final report reads actual source damage, excluding overkill');
ok(game.mvpFinish() === report, 'finalization is idempotent');
ok(JSON.stringify(JSON.parse(JSON.stringify(report))) === JSON.stringify(report), 'report is lossless through the final co-op summary message');
game.showMvp(report);
ok(game.screens.current === 'mvp' && !document.querySelector('#scr-mvp img'), 'MVP opens with safe player names');
ok(document.querySelector('#scr-mvp')!.textContent!.includes(ally.name), 'user names are preserved as text');
(document.querySelector('#scr-mvp button') as HTMLButtonElement).click();
ok(game.screens.current === 'gameover', 'continue reaches the existing run summary');
await setLanguage('ar'); game.showMvp(demo);
ok(document.querySelector('#scr-mvp h1')!.textContent === 'ختام الفريق!', 'Arabic MVP screen is localized');
await setLanguage('en');
game.startSolo(); ok(game.mvp.rows.size === 1 && game.mvp.report === null && game.mvp.moments.length === 0, 'restart resets every run counter and highlight');
// Slots are reused, each of eight players gets heard, and a large team cannot multiply the music voice budget.
const players = Array.from({ length: 8 }, (_, index) => ({ index, left: false, player: { x: index, z: 0, dead: false }, weapons: ['buster', 'charge', 'drones', 'aura', 'well', 'laser'].map(id => ({ def: { id }, level: 10, evolved: true })) }));
const mixer = new BandMixer(); const mixed = mixer.mix(players, players[0], 0);
ok(mixed.length === 8 && new Set(mixer.weapons.map(w => w.owner)).size === 8, 'all eight nearby players receive one of eight fixed slots');
const slot = mixed[0]; const first = slot.def.id;
mixer.mix(players, players[0], 1);
ok(mixer.weapons[0] === slot && slot.def.id !== first, 'slots reuse objects and rotate loadouts at bar boundaries');
players[7].player.x = 50; players[6].left = true; players[5].player.dead = true;
mixer.mix(players, players[0], 2);
ok(mixer.weapons.every(w => w.owner < 5), 'distant, left and downed teammates are silent');
ok(bandGain(0) === 1 && bandGain(10) === 1 && bandGain(19) === 0.5 && bandGain(28) === 0, 'distance falloff is continuous and bounded');
const param = () => ({ value: 0, setTargetAtTime(v: number) { this.value = v; }, setValueAtTime(v: number) { this.value = v; }, exponentialRampToValueAtTime() {} });
const node = () => ({ gain: param(), frequency: param(), pan: param(), connect(n: unknown) { return n; } });
const ctx = { createGain: node, createBiquadFilter: node, createStereoPanner: node };
const stems = new WeaponStems(ctx as any, node() as any, []);
let notes = 0;
const synth = { note() { notes++; } };
const style = (await import('../src/audio/music/composition')).TRACK_BY_ID.omega.style;
for (let bar = 0; bar < 16; bar++) {
  stems.commit(mixer.mix(players, players[0], bar), bar);
  for (let step = 0; step < 16; step++) { notes = 0; stems.play(synth as any, style, 0, 0, bar * 16 + step, 0, 0.1); if (notes > 16) throw new Error('unbounded stem notes'); }
}
console.log('ok   MVP authority, awards, lifecycle, Arabic UI and eight-player band');

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

const { Music } = await import('../src/audio/music');
const { sfx } = await import('../src/audio/sfx');
const audioContext = new FakeContext();
const originalOutput = sfx.output;
(sfx as any).output = () => ({ ctx: audioContext, node: new FakeNode('out') });
const song = new Music();
for (const p of players) { p.player.x = p.index; p.player.dead = false; p.left = false; }
song.setInstruments(31); song.setDuel(true); song.setBossPhase(3); song.setStyleRank(5);
const want = { track: 'omega' as const, seed: 42, stage: 4, intensity: 1, duck: false };
for (let frame = 0; frame < 60 * 50; frame++) {
 audioContext.currentTime += 1 / 60;
 song.setWeapons(mixer.mix(players, players[0], Math.floor(song.beats / 4)));
 song.duelAccent(1.5);
 song.update(1 / 60, want);
}
const synthState = (song as any).synth;
ok(synthState.peakVoices < 96 && synthState.droppedVoices === 0, `eight players, full band, Omega duel and SS rank stay within budget: peak ${synthState.peakVoices}, dropped ${synthState.droppedVoices}`);
sfx.output = originalOutput;

// Exercise the actual host 'over' message and the client's end-of-run handler.
game.closeShop();
const remote = game.makeHero(1, 'Guest', [], 'mvp-test-peer'); remote.startRun();
game.setHeroes([game.hero, remote]);
const messages: Record<string, any>[] = [];
game.host = { send(_peer: string, message: Record<string, unknown>) { messages.push(JSON.parse(JSON.stringify(message))); } } as any;
game.role = 'host'; game.mode = 'dead'; game.endRun();
const over = messages.find(m => m.t === 'over');
ok(!!over?.sum.mvp && over.sum.mvp.players.length === 2, 'host sends its finalized team report through the reliable over message');
const hostReport = JSON.stringify(game.mvp.report);
const finalSnapshot = game.buildSnapshot(remote, []);
game.role = 'client'; game.mvp = M.createMvp(); game.meta.banked = false;
game.hero.damageBy = { impossibleClientDamage: 999999999 };
game.applySnapshot(finalSnapshot);
ok(JSON.stringify(game.mvp.report) === hostReport, 'the lane snapshot field also mirrors the final awards');
game.mvp = M.createMvp();
game.onClientMessage(over!);
ok(JSON.stringify(game.mvp.report) === hostReport && game.screens.current === 'mvp', 'client displays the exact host report without calculating its own awards');
game.onClientMessage(over!);
ok(JSON.stringify(game.mvp.report) === hostReport, 'duplicate over messages do not change or bank the report again');
game.clientStart(1234, 0, [{ name: 'Fresh run' }]);
ok(game.mvp.report === null && game.mvp.rows.size === 0, 'client restart clears the prior result');


game.role = 'solo'; game.mode = 'fight';
const retained = game.hero;
retained.damageBy = { buster: 5 }; game.mvpStep(true);
const retainedRow = game.mvp.rows.get(retained)!;
retained.damageBy = { buster: 20 }; game.mvpStep(true);
ok(retainedRow.damage === 25, 'a reconstructed hero ledger preserves earlier damage even when the new total is higher');
const replacement = game.makeHero(retained.index, 'Replacement', []); replacement.startRun();
game.setHeroes([replacement]); game.mvpStep(true);
ok(game.mvp.rows.size === 2 && game.mvp.rows.get(replacement)!.index !== retainedRow.index, 'reused roster slots retain separate player histories');
