/**
 * Voicechat lane: proximity gain and pan math, the open-mic gate, call
 * planning and roster packing, then the VoiceChat runtime with a fake
 * AudioContext, microphone and PeerJS peer: starting and stopping with the
 * setting, who calls whom, answering, per-player volume and mute, team radio,
 * downed listeners, push to talk (key and pad, which moves the ultimate to R3),
 * open mic with hang time, listen-only without a mic, and the host roster.
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
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent', 'Audio']) {
  try { (globalThis as any)[k] = (dom.window as any)[k]; } catch { Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true }); }
}
(globalThis as any).Path2D = (dom.window as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'test';
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});

// ------------------------------------------------------------------ fakes: WebAudio, WebRTC, mic, PeerJS

/** Level every analyser reports (RMS of a square wave of this amplitude). */
let micAmp = 0;
let remoteAmp = 0;
class FakeParam { value = 0; setTargetAtTime(v: number) { this.value = v; } }
class FakeNode { connect(n: any) { return n; } disconnect() {} }
class FakeTrack { enabled = true; stopped = false; kind = 'audio'; stop() { this.stopped = true; } }
class FakeStream {
  tracks = [new FakeTrack()];
  constructor(public remote = false) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
  clone() { const s = new FakeStream(this.remote); (s as any).probe = true; return s; }
}
class FakeAnalyser extends FakeNode {
  fftSize = 512;
  constructor(private amp: () => number) { super(); }
  getFloatTimeDomainData(b: Float32Array) { const a = this.amp(); for (let i = 0; i < b.length; i++) b[i] = i % 2 ? a : -a; }
}
class FakeCtx {
  state = 'running';
  currentTime = 0;
  destination = new FakeNode();
  private lastSrc: any = null;
  createGain() { const n: any = new FakeNode(); n.gain = new FakeParam(); n.gain.value = 1; return n; }
  createStereoPanner() { const n: any = new FakeNode(); n.pan = new FakeParam(); return n; }
  createMediaStreamSource(s: any) { this.lastSrc = s; return new FakeNode(); }
  createAnalyser() { const remote = !!this.lastSrc?.remote; return new FakeAnalyser(() => (remote ? remoteAmp : micAmp)); }
  createMediaStreamDestination() { return { stream: new FakeStream() }; }
  resume() { return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
(dom.window.HTMLMediaElement.prototype as any).play = () => Promise.resolve();
(dom.window.HTMLMediaElement.prototype as any).pause = () => {};
(globalThis as any).AudioContext = (dom.window as any).AudioContext = FakeCtx;
(globalThis as any).RTCPeerConnection = class {};
let micMode: 'ok' | 'denied' | 'none' = 'ok';
let lastMic: FakeStream | null = null;
Object.defineProperty((dom.window as any).navigator, 'mediaDevices', {
  configurable: true,
  value: {
    getUserMedia: async () => {
      if (micMode === 'denied') throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
      if (micMode === 'none') throw Object.assign(new Error('no'), { name: 'NotFoundError' });
      return (lastMic = new FakeStream());
    },
  },
});

class FakeCall {
  handlers: Record<string, ((...a: any[]) => void)[]> = {};
  closed = false;
  answered: any = null;
  peerConnection = undefined;
  constructor(public peer: string, public metadata: any) {}
  on(ev: string, fn: (...a: any[]) => void) { (this.handlers[ev] ??= []).push(fn); return this; }
  emit(ev: string, ...a: any[]) { for (const f of this.handlers[ev] ?? []) f(...a); }
  answer(s: any) { this.answered = s; }
  close() { if (this.closed) return; this.closed = true; this.emit('close'); }
}
class FakePeer {
  destroyed = false;
  disconnected = false;
  calls: FakeCall[] = [];
  handlers: Record<string, ((...a: any[]) => void)[]> = {};
  constructor(public id: string) {}
  on(ev: string, fn: (...a: any[]) => void) { (this.handlers[ev] ??= []).push(fn); return this; }
  call(id: string, _s: any, o: any) { const c = new FakeCall(id, o.metadata); this.calls.push(c); return c; }
  incoming(from: string, meta: any) { const c = new FakeCall(from, meta); for (const f of this.handlers.call ?? []) f(c); return c; }
}

const V = await import('../src/net/voice');
const { settings } = await import('../src/game/settings');
const { PAD_ULT } = await import('../src/core/keybinds');
const { audioSettings } = await import('../src/audio/sfx');
const { meterPos } = await import('../src/ui/voiceUi');
const { buildRoster } = await import('../src/game/systems/voicechat');
const { voiceTuning: T } = V;

// ------------------------------------------------------------------ pure math

ok(V.proximityGain(0) === 1 && V.proximityGain(T.fullDist) === 1, 'full volume up close');
ok(Math.abs(V.proximityGain(T.quietDist) - T.quietGain) < 1e-9, `quiet (${T.quietGain}) at ${T.quietDist} m`);
ok(V.proximityGain(T.cutDist) === 0 && V.proximityGain(100) === 0, `silent from ${T.cutDist} m`);
let mono = true;
for (let d = 0, last = 2; d <= 50; d += 0.5) {
  const g = V.proximityGain(d);
  if (g > last + 1e-12) mono = false;
  last = g;
}
ok(mono, 'gain never rises with distance');
ok(V.proximityGain(30, true) === 1 && V.proximityGain(NaN) === 1, 'team radio / no positions: full');
ok(V.voicePan(0) === 0 && V.voicePan(100) === T.panMax && V.voicePan(-100) === -T.panMax, 'pan follows the side, capped');
ok(V.voicePan(7) > 0 && V.voicePan(7) < T.panMax, 'half pan halfway');
ok(V.voicePan(20, true) === 0 && V.voicePan(NaN) === 0, 'centred on team radio / no positions');
ok(V.vadThreshold(0) > V.vadThreshold(0.5) && V.vadThreshold(0.5) > V.vadThreshold(1), 'more sensitivity = lower threshold');
ok(Math.abs(V.rms(new Float32Array([0.5, -0.5, 0.5, -0.5])) - 0.5) < 1e-6, 'rms');
ok(meterPos(1) === 1 && meterPos(0) === 0 && Math.abs(meterPos(0.001) - 0) < 1e-9 && Math.abs(meterPos(0.01) - 1 / 3) < 1e-6, 'meter is -60..0 dB');

const gate = new V.VadGate();
ok(gate.update(0.1, 0.05, 0.1, 0.4), 'gate opens above the threshold');
ok(gate.update(0, 0.05, 0.3, 0.4), 'gate holds during the hang time');
ok(!gate.update(0, 0.05, 0.2, 0.4), 'gate closes after the hang time');

ok(V.shouldCall('a', 'b') && !V.shouldCall('b', 'a') && !V.shouldCall('', 'b'), 'the lower id calls');
const roster = [
  { id: 'b', name: 'BEE', on: true, hero: 1 },
  { id: '0', name: 'ZERO', on: true, hero: 2 },
  { id: 'c', name: 'SEA', on: false, hero: 3 },
  { id: 'a', name: 'ME', on: true, hero: 0 },
];
const plan = V.planCalls('a', true, roster, ['c', 'x']);
ok(plan.call.join() === 'b', 'calls only higher ids with voice on');
ok(plan.hangup.sort().join() === 'c,x', 'hangs up on voice-off and unknown peers');
ok(V.planCalls('a', false, roster, ['b']).hangup.join() === 'b' && V.planCalls('a', false, roster, []).call.length === 0, 'voice off: no calls');
const packed = V.unpackRoster(JSON.parse(JSON.stringify(V.packRoster(roster))));
ok(JSON.stringify(packed) === JSON.stringify(roster), 'roster survives the wire');
ok(V.unpackRoster('junk').length === 0 && V.unpackRoster([[1, '<long name over twelve>', 'yes', 99]])[0].hero === -1, 'malformed roster is cleaned');
const prefs = V.cleanPrefs({ vol: { BEE: 5, X: 'loud' }, mute: { SEA: true, Q: 'y' } });
ok(prefs.vol.BEE === T.maxPlayerVol && !('X' in prefs.vol) && prefs.mute.SEA && !('Q' in prefs.mute), 'prefs are clamped and cleaned');
ok(V.playerGain(0.5, 'BEE', { vol: { BEE: 2 }, mute: {} }, 0.5, 0.8) === 0.4 && V.playerGain(1, 'SEA', prefs, 1, 1) === 0, 'final gain: prox x player x chat x master; mute = 0');

// ------------------------------------------------------------------ runtime

const vc = new V.VoiceChat();
const peer = new FakePeer('a');
const pos: Record<number, { x: number; z: number }> = { 0: { x: 0, z: 0 }, 1: { x: 10, z: 0 }, 2: { x: -3, z: 0 } };
const world = { net: 'client' as 'host' | 'client' | null, peer: peer as any, myIndex: 3, heroPos: (i: number) => pos[i] ?? null, listenerDown: false, talkHeld: false };
const step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) vc.tick(world, dt); };

settings.voiceChat = false;
settings.voiceMode = 'ptt';
settings.teamRadio = false;
settings.voiceChatVolume = 1;
step();
ok(vc.status === 'off' && PAD_ULT.includes(10), 'off by default; L3 stays an ultimate button');
settings.voiceChat = true;
step();
ok(vc.status === 'asking', 'turning it on asks for the mic');
await vc.start();
ok(vc.status === 'on' && !!lastMic && lastMic.tracks[0].enabled === false, 'mic ready, sent track muted until talking');
ok(!PAD_ULT.includes(10) && PAD_ULT.includes(11), 'push to talk takes L3; the ultimate keeps R3');

vc.roster = roster;
step();
ok(peer.calls.length === 1 && peer.calls[0].peer === 'b' && peer.calls[0].metadata?.vc === 1, 'dials the higher peer once');
step(5);
ok(peer.calls.length === 1, 'no redial while the call is up');
const inc = peer.incoming('0', { vc: 1 });
ok(inc.answered === lastMic && !inc.closed, 'answers a known lower peer with the mic');
const stranger = peer.incoming('zz', { vc: 1 });
ok(stranger.closed, 'refuses a peer not in the roster');
const notOurs = peer.incoming('b', undefined);
ok(!notOurs.closed && !notOurs.answered, 'ignores calls without the voice tag');

remoteAmp = 0.05;
peer.calls[0].emit('stream', new FakeStream(true));
inc.emit('stream', new FakeStream(true));
step(2);
let d = vc.debug();
const rb = d.remotes.find((r) => r.id === 'b')!;
const r0 = d.remotes.find((r) => r.id === '0')!;
ok(Math.abs(rb.gain - V.proximityGain(10) * (audioSettings.muted ? 0 : audioSettings.volume)) < 1e-9 && rb.gain > 0, `gain at 10 m: ${rb.gain.toFixed(3)}`);
ok(rb.pan > 0 && r0.pan < 0, 'speaker to the right pans right, to the left pans left');
ok(r0.gain > rb.gain, 'the closer teammate is louder');
ok(d.speaking[0] && d.speaking[1] && !d.speaking[3], 'speaking lights from received audio (by roster index)');
pos[1] = { x: 60, z: 0 };
step();
ok(vc.debug().remotes.find((r) => r.id === 'b')!.gain === 0, 'silent far away');
settings.teamRadio = true;
step();
d = vc.debug();
ok(d.remotes.every((r) => Math.abs(r.gain - d.remotes[0].gain) < 1e-9 && r.pan === 0) && d.remotes[0].gain > 0, 'team radio: everyone full and centred');
settings.teamRadio = false;
world.listenerDown = true;
step();
ok(vc.debug().remotes.find((r) => r.id === 'b')!.gain === vc.debug().remotes.find((r) => r.id === '0')!.gain, 'downed: hears everyone at full');
world.listenerDown = false;
vc.toggleMute('ZERO');
step();
ok(vc.debug().remotes.find((r) => r.id === '0')!.gain === 0, 'muted player is silent');
vc.toggleMute('ZERO');
vc.setPlayerVolume('ZERO', 0.5);
step();
const half = vc.debug().remotes.find((r) => r.id === '0')!.gain;
vc.setPlayerVolume('ZERO', 1);
step();
ok(Math.abs(vc.debug().remotes.find((r) => r.id === '0')!.gain - 2 * half) < 1e-9, 'per-player volume scales');
remoteAmp = 0;
step(15);
ok(!vc.debug().speaking[1], 'speaking light goes out after the hang time');

// Push to talk.
world.talkHeld = true;
step();
ok(vc.transmitting && lastMic!.tracks[0].enabled && vc.debug().speaking[3], 'holding the talk key sends the mic and lights my own icon');
world.talkHeld = false;
step();
ok(!vc.transmitting && !lastMic!.tracks[0].enabled, 'releasing mutes the sent track');

// Open mic.
settings.voiceMode = 'open';
settings.voiceSensitivity = 0.5;
micAmp = 0.1;
step();
ok(vc.transmitting && PAD_ULT.includes(10), 'open mic opens on speech (and L3 is the ultimate again)');
micAmp = 0;
step(6);
ok(vc.transmitting, 'open mic hangs on through short pauses');
step(10);
ok(!vc.transmitting, 'open mic closes after the hang time');
settings.voiceMode = 'ptt';

// Roster changes hang up.
vc.roster = roster.filter((r) => r.id !== 'b');
step();
ok(peer.calls[0].closed && !vc.remotes.has('b'), 'a player leaving hangs up their call');
world.net = null;
step();
ok(vc.remotes.size === 0 && vc.roster.length === 0, 'offline: no calls');

// Off releases everything.
settings.voiceChat = false;
step();
ok(vc.status === 'off' && lastMic!.tracks[0].stopped && PAD_ULT.includes(10), 'turning it off releases the mic and gives L3 back');

// Listen-only without permission.
micMode = 'denied';
settings.voiceChat = true;
world.net = 'client';
step();
await vc.start();
ok(vc.status === 'denied' && /BLOCKED/.test(vc.notice), `mic blocked: listen-only with a notice (${vc.notice})`);
vc.roster = roster;
const inc2 = peer.incoming('0', { vc: 1 });
ok(!!inc2.answered && inc2.answered !== lastMic, 'still answers calls (with a silent stream)');
world.talkHeld = true;
step();
ok(!vc.transmitting, 'cannot transmit without a mic');
settings.voiceChat = false;
step();
micMode = 'none';
settings.voiceChat = true;
step();
await vc.start();
ok(vc.status === 'nomic', 'no mic found: listen-only');
settings.voiceChat = false;
step();

// Host roster: lobby order before a run, hero order in it.
const fakeGame: any = {
  host: { voicePeer: { id: 'H' } },
  mode: 'title',
  local: 0,
  heroes: [{ name: 'HOST' }],
  lobby: [{ peerId: '', name: 'HOST' }, { peerId: 'p1', name: 'ONE' }],
};
let r = buildRoster(fakeGame);
ok(r.length === 2 && r[0].id === 'H' && r[1].id === 'p1' && r[0].hero === -1, 'lobby roster: host first, no positions');
fakeGame.mode = 'fight';
fakeGame.heroes = [{ name: 'HOST', peerId: '', left: false }, { name: 'ONE', peerId: 'p1', left: false }, { name: 'TWO', peerId: 'p2', left: true }];
r = buildRoster(fakeGame);
ok(r.length === 3 && r[1].hero === 1 && r[2].id === '', 'run roster by hero index; players who left have no id');
