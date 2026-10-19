import type Peer from 'peerjs';
import type { MediaConnection } from 'peerjs';
import { loadJson, saveJson } from '../core/storage';
import { PAD_TALK, PAD_ULT } from '../core/keybinds';
import { audioSettings } from '../audio/sfx';
import { settings } from '../game/settings';

/**
 * Proximity voice chat (voicechat lane, notes/lanes/voicechat.md).
 *
 * Audio goes peer to peer over WebRTC media calls on the same PeerJS peers the
 * game already uses (a mesh: every pair of players with VOICE CHAT on has one
 * call; the host relays nothing). The host only shares a small roster over the
 * data channel: who is in the game (peer id and hero/lobby index) and who has
 * voice on. Each machine then calls the players whose peer id sorts after its
 * own, so every pair connects exactly once.
 *
 * Everything else is local: push to talk or an open mic with a voice activity
 * gate (the mic track is disabled while not talking, so silence costs almost
 * nothing), per-player volume and mute, distance gain and stereo pan from the
 * heroes' positions, and speaking lights from analysers on the received audio.
 * Voices play through their own AudioContext (master volume applies, but game
 * ducking and muffling never touch them).
 */

// ------------------------------------------------------------------ tuning and pure math

export const voiceTuning = {
  /** Full volume up to this distance (m). */
  fullDist: 6,
  /** "Quiet" from here on (m): the gain has fallen to quietGain. */
  quietDist: 25,
  quietGain: 0.15,
  /** Silent from here (m). */
  cutDist: 40,
  /** Metres of sideways offset for a full pan, and the pan limit (never fully one-eared). */
  panRange: 14,
  panMax: 0.8,
  /** Open mic: the gate stays open this long after speech drops under the threshold (s). */
  vadHang: 0.4,
  /** Speaking light for received audio: RMS level and hang time. */
  remoteLevel: 0.012,
  remoteHang: 0.25,
  /** Host roster broadcast: on change, and at least this often (s). */
  rosterEvery: 3,
  /** Gain smoothing time constant (s). */
  smooth: 0.08,
  /** Per-player volume range (1 = as received). */
  maxPlayerVol: 2,
  /** Wait this long before calling the same peer again (ms). */
  redialMs: 3000,
};

/** Distance gain 0..1 between two heroes. `full` (team radio, downed/spectating listener, no positions) is always 1. */
export function proximityGain(dist: number, full = false): number {
  if (full || !Number.isFinite(dist)) return 1;
  const t = voiceTuning;
  if (dist <= t.fullDist) return 1;
  if (dist <= t.quietDist) {
    const k = (dist - t.fullDist) / (t.quietDist - t.fullDist);
    const s = k * k * (3 - 2 * k);
    return 1 + (t.quietGain - 1) * s;
  }
  if (dist >= t.cutDist) return 0;
  return t.quietGain * (1 - (dist - t.quietDist) / (t.cutDist - t.quietDist));
}

/** Stereo pan -1..1 from the speaker's sideways offset (the camera never rotates, so world x is screen x). */
export function voicePan(dx: number, full = false): number {
  if (full || !Number.isFinite(dx)) return 0;
  const p = dx / voiceTuning.panRange;
  return Math.max(-1, Math.min(1, p)) * voiceTuning.panMax;
}

/** MIC SENSITIVITY 0..1 to an RMS threshold (log scale: 0 -> 0.08, 0.5 -> 0.014, 1 -> 0.0025). */
export function vadThreshold(sensitivity: number): number {
  const s = Math.max(0, Math.min(1, Number.isFinite(sensitivity) ? sensitivity : 0.5));
  return 0.08 * Math.pow(10, -1.5 * s);
}

/** RMS of a block of samples. */
export function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / (buf.length || 1));
}

/** A level gate with hang time: opens at once above the threshold, closes `hang` s after dropping below. */
export class VadGate {
  open = false;
  private quiet = 0;
  update(level: number, threshold: number, dt: number, hang: number): boolean {
    if (level >= threshold) {
      this.open = true;
      this.quiet = 0;
    } else if (this.open) {
      this.quiet += dt;
      if (this.quiet >= hang) this.open = false;
    }
    return this.open;
  }
  reset(): void {
    this.open = false;
    this.quiet = 0;
  }
}

/** Should this machine send the call for a pair? The lower peer id calls, so each pair connects once. */
export function shouldCall(myId: string, otherId: string): boolean {
  return !!myId && !!otherId && myId < otherId;
}

/** One roster entry, by hero index (in a run) or lobby index (in the lobby). */
export interface VoiceRosterEntry {
  /** PeerJS peer id ('' = unknown, e.g. a bot). */
  id: string;
  name: string;
  /** VOICE CHAT is on for this player. */
  on: boolean;
  /** Hero index in the run (-1 in the lobby: no positions yet). */
  hero: number;
}

/** Which calls to open and close: open to roster peers with voice on that we call; close anything not wanted. */
export function planCalls(myId: string, myOn: boolean, roster: readonly VoiceRosterEntry[], open: Iterable<string>): { call: string[]; hangup: string[] } {
  const wanted = new Set<string>();
  if (myOn && myId) for (const r of roster) if (r.on && r.id && r.id !== myId) wanted.add(r.id);
  const have = new Set(open);
  const call = [...wanted].filter((id) => !have.has(id) && shouldCall(myId, id));
  const hangup = [...have].filter((id) => !wanted.has(id));
  return { call, hangup };
}

/** Wire form of the roster: [id, name, on (0/1), hero][]. Cleans anything malformed. */
export function packRoster(r: readonly VoiceRosterEntry[]): [string, string, number, number][] {
  return r.map((e) => [e.id, e.name, e.on ? 1 : 0, e.hero]);
}

export function unpackRoster(raw: unknown): VoiceRosterEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 8).map((e) => {
    const a = Array.isArray(e) ? e : [];
    const hero = Number(a[3]);
    return { id: String(a[0] ?? '').slice(0, 64), name: String(a[1] ?? '').slice(0, 12), on: a[2] === 1 || a[2] === true, hero: Number.isInteger(hero) && hero >= 0 && hero < 8 ? hero : -1 };
  });
}

/** Per-player volume (0..2) and mute, kept by player name (peer ids change every session). */
export interface VoicePrefs {
  vol: Record<string, number>;
  mute: Record<string, boolean>;
}

export function cleanPrefs(raw: unknown): VoicePrefs {
  const p = (raw ?? {}) as Partial<VoicePrefs>;
  const vol: Record<string, number> = {};
  const mute: Record<string, boolean> = {};
  if (p.vol && typeof p.vol === 'object') for (const [k, v] of Object.entries(p.vol)) if (Number.isFinite(v)) vol[k.slice(0, 12)] = Math.max(0, Math.min(voiceTuning.maxPlayerVol, Number(v)));
  if (p.mute && typeof p.mute === 'object') for (const [k, v] of Object.entries(p.mute)) if (v === true) mute[k.slice(0, 12)] = true;
  return { vol, mute };
}

/** Final gain for one teammate's voice. */
export function playerGain(prox: number, name: string, prefs: VoicePrefs, chatVolume: number, master: number): number {
  if (prefs.mute[name]) return 0;
  return prox * (prefs.vol[name] ?? 1) * chatVolume * master;
}

// ------------------------------------------------------------------ runtime

/** off; asking (waiting for the mic); on (mic ready); denied / nomic (listen only); unsupported (no WebRTC or WebAudio). */
export type VoiceStatus = 'off' | 'asking' | 'on' | 'denied' | 'nomic' | 'unsupported';

/** What the voice system needs from the game each tick (kept narrow so tests can drive it). */
export interface VoiceWorld {
  /** 'host' | 'client' when online, else null. */
  net: 'host' | 'client' | null;
  peer: Peer | null;
  /** The roster (host builds it; clients use the last one received). */
  myIndex: number;
  /** Positions by hero index (null = no positions: lobby, menus). */
  heroPos(i: number): { x: number; z: number } | null;
  /** The local hero is downed or spectating (hears everyone). */
  listenerDown: boolean;
  /** Talk key / pad button held. */
  talkHeld: boolean;
}

interface Remote {
  id: string;
  call: MediaConnection;
  stream: MediaStream | null;
  el: HTMLAudioElement | null;
  src: MediaStreamAudioSourceNode | null;
  analyser: AnalyserNode | null;
  gain: GainNode | null;
  pan: StereoPannerNode | null;
  level: number;
  gate: VadGate;
  /** Last applied gain/pan (tests and the VOICE screen). */
  g: number;
  p: number;
  bytes: number;
}

const PREFS_KEY = 'voicechat.v1';
const BUF = 512;

export class VoiceChat {
  status: VoiceStatus = 'off';
  roster: VoiceRosterEntry[] = [];
  /** Hero/lobby index -> speaking right now (includes this machine's own player). */
  readonly speaking: boolean[] = [];
  /** Talking: the mic is live and being sent. */
  transmitting = false;
  /** This machine's mic level (RMS) and the open-mic threshold, for the meter. */
  micLevel = 0;
  prefs: VoicePrefs = cleanPrefs(loadJson<unknown>(PREFS_KEY, {}));
  /** Mic test: hear yourself (loopback) while the VOICE screen's TEST MIC is on. */
  loopback = false;
  /** Set when a message should be shown to the player (the UI shows and clears it). */
  notice = '';
  readonly remotes = new Map<string, Remote>();
  /** Test links (src/dev/voiceLinks.ts): a fixed roster and speaking pattern, no audio or network. */
  demo: { roster: VoiceRosterEntry[]; talk: boolean[]; me: number } | null = null;

  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private mic: MediaStream | null = null;
  /** Analysis copy of the mic (the sent track is disabled while silent, which would silence the meter). */
  private micProbe: MediaStream | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micLoop: GainNode | null = null;
  private silent: MediaStream | null = null;
  private gate = new VadGate();
  private buf = new Float32Array(BUF);
  private peersHooked = new WeakSet<Peer>();
  private peer: Peer | null = null;
  private starting: Promise<void> | null = null;
  private resumeHook: (() => void) | null = null;
  /** performance.now() of the last call placed to each peer (retry backoff). */
  private dialed = new Map<string, number>();
  private analyseT = 0;
  private statsT = 0;

  /** The stream we send: the mic, or silence (listen-only without a mic). */
  get sendStream(): MediaStream | null {
    return this.mic ?? this.silent;
  }

  get enabled(): boolean {
    return this.status !== 'off';
  }

  savePrefs(): void {
    saveJson(PREFS_KEY, this.prefs);
  }

  setPlayerVolume(name: string, v: number): void {
    this.prefs.vol[name] = Math.max(0, Math.min(voiceTuning.maxPlayerVol, v));
    this.savePrefs();
  }

  toggleMute(name: string): void {
    if (this.prefs.mute[name]) delete this.prefs.mute[name];
    else this.prefs.mute[name] = true;
    this.savePrefs();
  }

  /** Turn voice on: audio graph, then the microphone (asks permission). Never throws. */
  start(): Promise<void> {
    if (this.status !== 'off') return this.starting ?? Promise.resolve();
    const AC = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!AC || typeof RTCPeerConnection === 'undefined') {
      this.status = 'unsupported';
      this.notice = 'VOICE CHAT IS NOT SUPPORTED HERE';
      return Promise.resolve();
    }
    this.status = 'asking';
    try {
      this.ctx = new AC();
    } catch {
      this.status = 'unsupported';
      return Promise.resolve();
    }
    const ctx = this.ctx;
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);
    this.silent = ctx.createMediaStreamDestination().stream;
    if (ctx.state === 'suspended') {
      const resume = () => void ctx.resume().catch(() => {});
      this.resumeHook = resume;
      addEventListener('pointerdown', resume);
      addEventListener('keydown', resume);
      resume();
    }
    this.starting = this.openMic().finally(() => (this.starting = null));
    return this.starting;
  }

  private async openMic(): Promise<void> {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md?.getUserMedia) {
      this.status = 'nomic';
      this.notice = 'NO MICROPHONE ACCESS: YOU CAN STILL LISTEN';
      return;
    }
    try {
      const mic = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (this.status !== 'asking' || !this.ctx) {
        mic.getTracks().forEach((t) => t.stop()); // turned off while asking
        return;
      }
      this.mic = mic;
      for (const t of mic.getAudioTracks()) t.enabled = false;
      this.micProbe = mic.clone();
      for (const t of this.micProbe.getAudioTracks()) t.enabled = true;
      const src = this.ctx.createMediaStreamSource(this.micProbe);
      this.micAnalyser = this.ctx.createAnalyser();
      this.micAnalyser.fftSize = BUF;
      src.connect(this.micAnalyser);
      this.micLoop = this.ctx.createGain();
      this.micLoop.gain.value = 0;
      src.connect(this.micLoop).connect(this.out!);
      this.status = 'on';
      // Calls that started on the silent stream switch to the mic.
      const track = mic.getAudioTracks()[0];
      for (const r of this.remotes.values()) replaceSendTrack(r.call, track);
    } catch (e) {
      if (this.status !== 'asking') return;
      const name = (e as { name?: string }).name ?? '';
      this.status = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'nomic';
      this.notice = this.status === 'denied' ? 'MICROPHONE BLOCKED: YOU CAN STILL LISTEN' : 'NO MICROPHONE FOUND: YOU CAN STILL LISTEN';
    }
  }

  /** Turn voice off: hang up, release the mic, close the audio graph. */
  stop(): void {
    for (const id of [...this.remotes.keys()]) this.hangup(id);
    this.mic?.getTracks().forEach((t) => t.stop());
    this.micProbe?.getTracks().forEach((t) => t.stop());
    this.mic = this.micProbe = this.silent = null;
    this.micAnalyser = null;
    this.micLoop = null;
    if (this.resumeHook) {
      removeEventListener('pointerdown', this.resumeHook);
      removeEventListener('keydown', this.resumeHook);
      this.resumeHook = null;
    }
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.out = null;
    this.status = 'off';
    this.transmitting = false;
    this.micLevel = 0;
    this.loopback = false;
    this.gate.reset();
    this.speaking.length = 0;
  }

  /** A PeerJS peer to call from and answer on (the host's or the client's). */
  attach(peer: Peer | null): void {
    this.peer = peer;
    if (!peer || this.peersHooked.has(peer)) return;
    this.peersHooked.add(peer);
    peer.on('call', (call) => this.onCall(call));
  }

  private onCall(call: MediaConnection): void {
    const meta = call.metadata as { vc?: number } | undefined;
    if (!meta?.vc) return; // not ours
    const known = this.roster.some((r) => r.id === call.peer && r.on);
    const stream = this.sendStream;
    if (!this.enabled || !stream || !known || this.remotes.has(call.peer)) {
      call.close();
      return;
    }
    call.answer(stream);
    this.track(call);
  }

  private dial(id: string): void {
    const stream = this.sendStream;
    if (!this.peer || !stream || this.peer.destroyed || this.peer.disconnected) return;
    const now = performance.now();
    if (now - (this.dialed.get(id) ?? -1e9) < voiceTuning.redialMs) return;
    this.dialed.set(id, now);
    let call: MediaConnection | undefined;
    try {
      call = this.peer.call(id, stream, { metadata: { vc: 1 } });
    } catch {
      return;
    }
    if (call) this.track(call);
  }

  private track(call: MediaConnection): void {
    const r: Remote = { id: call.peer, call, stream: null, el: null, src: null, analyser: null, gain: null, pan: null, level: 0, gate: new VadGate(), g: 0, p: 0, bytes: 0 };
    this.remotes.set(call.peer, r);
    call.on('stream', (s) => this.onStream(r, s));
    const gone = () => {
      if (this.remotes.get(r.id) === r) this.hangup(r.id);
    };
    call.on('close', gone);
    call.on('error', gone);
  }

  private onStream(r: Remote, stream: MediaStream): void {
    if (r.stream || !this.ctx || !this.out || this.remotes.get(r.id) !== r) return;
    r.stream = stream;
    // Chromium only pulls remote WebRTC audio into WebAudio while a media element plays it (muted here).
    const el = new Audio();
    el.muted = true;
    el.srcObject = stream;
    try {
      void el.play()?.catch(() => {});
    } catch {
      // no media element playback here (tests): WebAudio still gets the stream in real browsers
    }
    r.el = el;
    const ctx = this.ctx;
    r.src = ctx.createMediaStreamSource(stream);
    r.analyser = ctx.createAnalyser();
    r.analyser.fftSize = BUF;
    r.gain = ctx.createGain();
    r.gain.gain.value = 0;
    r.pan = ctx.createStereoPanner();
    r.src.connect(r.analyser);
    r.src.connect(r.gain).connect(r.pan).connect(this.out);
  }

  private hangup(id: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    this.remotes.delete(id);
    try {
      r.call.close();
    } catch {
      // already closed
    }
    r.src?.disconnect();
    r.gain?.disconnect();
    r.pan?.disconnect();
    if (r.el) {
      r.el.pause();
      r.el.srcObject = null;
    }
  }

  /** Roster index of a peer id (-1 = unknown). */
  indexOf(id: string): number {
    return this.roster.findIndex((r) => r.id === id);
  }

  /** Per-tick work: start/stop with the setting, connect calls, gains, pans, the talk gate and speaking lights. */
  tick(w: VoiceWorld, dt: number): void {
    if (this.demo) {
      this.status = 'on';
      this.roster = this.demo.roster;
      this.speaking.length = 0;
      this.speaking.push(...this.demo.talk);
      this.transmitting = !!this.demo.talk[this.demo.me];
      this.micLevel = 0.02 + 0.015 * Math.sin(performance.now() / 180);
      return;
    }
    if (settings.voiceChat && this.status === 'off') void this.start();
    else if (!settings.voiceChat && this.status !== 'off') this.stop();
    // Push to talk on a pad: L3 talks, so the ultimate keeps only R3 while it does.
    const padTalk = settings.voiceChat && settings.voiceMode === 'ptt';
    for (const b of PAD_TALK) {
      const i = PAD_ULT.indexOf(b);
      if (padTalk && i >= 0) PAD_ULT.splice(i, 1);
      else if (!padTalk && i < 0) PAD_ULT.push(b);
    }
    if (this.status === 'off' || this.status === 'unsupported') return;
    if (this.ctx?.state === 'suspended') return;

    // Calls follow the roster.
    this.attach(w.net ? w.peer : null);
    const myId = this.peer && !this.peer.destroyed ? this.peer.id : '';
    if (!w.net) this.roster = [];
    const plan = planCalls(myId, w.net !== null && this.status !== 'asking', this.roster, this.remotes.keys());
    for (const id of plan.hangup) this.hangup(id);
    for (const id of plan.call) this.dial(id);

    // Mic level (meter, open-mic gate) and remote levels, 30 times a second.
    this.analyseT -= dt;
    const analyse = this.analyseT <= 0;
    if (analyse) this.analyseT = 1 / 30;
    const step = analyse ? 1 / 30 : 0;
    if (analyse && this.micAnalyser) {
      this.micAnalyser.getFloatTimeDomainData(this.buf);
      this.micLevel = rms(this.buf);
    }
    const hasMic = !!this.mic;
    const open = settings.voiceMode === 'open' ? (analyse ? this.gate.update(this.micLevel, vadThreshold(settings.voiceSensitivity), step, voiceTuning.vadHang) : this.gate.open) : false;
    const talk = hasMic && w.net !== null && (settings.voiceMode === 'ptt' ? w.talkHeld : open);
    if (talk !== this.transmitting) {
      this.transmitting = talk;
      for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = talk;
    }
    if (this.micLoop && this.ctx) this.micLoop.gain.setTargetAtTime(this.loopback ? 1 : 0, this.ctx.currentTime, 0.03);

    // Speaking lights by roster index, and gains/pans from positions.
    for (let i = 0; i < this.speaking.length; i++) this.speaking[i] = false;
    if (w.myIndex >= 0 && w.net) this.speaking[w.myIndex] = this.transmitting;
    const me = w.myIndex >= 0 ? this.roster[w.myIndex] : undefined;
    const myPos = me && me.hero >= 0 ? w.heroPos(me.hero) : null;
    const master = audioSettings.muted ? 0 : audioSettings.volume;
    for (const r of this.remotes.values()) {
      const idx = this.indexOf(r.id);
      const entry = this.roster[idx];
      if (analyse && r.analyser) {
        r.analyser.getFloatTimeDomainData(this.buf);
        r.level = rms(this.buf);
        r.gate.update(r.level, voiceTuning.remoteLevel, step, voiceTuning.remoteHang);
      }
      if (idx >= 0 && r.gate.open) this.speaking[idx] = true;
      if (!r.gain || !r.pan || !this.ctx) continue;
      const pos = entry && entry.hero >= 0 ? w.heroPos(entry.hero) : null;
      const full = settings.teamRadio || w.listenerDown || !pos || !myPos;
      const dist = pos && myPos ? Math.hypot(pos.x - myPos.x, pos.z - myPos.z) : NaN;
      const prox = proximityGain(dist, full);
      r.g = playerGain(prox, entry?.name ?? '', this.prefs, settings.voiceChatVolume, master);
      r.p = voicePan(pos && myPos ? pos.x - myPos.x : NaN, full);
      const now = this.ctx.currentTime;
      r.gain.gain.setTargetAtTime(r.g, now, voiceTuning.smooth);
      r.pan.pan.setTargetAtTime(r.p, now, voiceTuning.smooth);
    }

    // Received bytes, twice a second (tests and the VOICE screen's link line).
    this.statsT -= dt;
    if (this.statsT <= 0) {
      this.statsT = 0.5;
      for (const r of this.remotes.values()) void inboundBytes(r.call).then((b) => (r.bytes = b));
    }
  }

  /** Snapshot for tests and debugging. */
  debug(): { status: VoiceStatus; transmitting: boolean; micLevel: number; roster: VoiceRosterEntry[]; speaking: boolean[]; remotes: { id: string; index: number; level: number; gain: number; pan: number; speaking: boolean; bytes: number; stream: boolean }[] } {
    return {
      status: this.status,
      transmitting: this.transmitting,
      micLevel: this.micLevel,
      roster: this.roster.map((r) => ({ ...r })),
      speaking: [...this.speaking],
      remotes: [...this.remotes.values()].map((r) => ({ id: r.id, index: this.indexOf(r.id), level: r.level, gain: r.g, pan: r.p, speaking: r.gate.open, bytes: r.bytes, stream: !!r.stream })),
    };
  }
}

function replaceSendTrack(call: MediaConnection, track: MediaStreamTrack | undefined): void {
  if (!track) return;
  const pc = call.peerConnection as RTCPeerConnection | undefined;
  for (const s of pc?.getSenders() ?? []) if (s.track?.kind === 'audio' || !s.track) void s.replaceTrack(track).catch(() => {});
}

async function inboundBytes(call: MediaConnection): Promise<number> {
  const pc = call.peerConnection as RTCPeerConnection | undefined;
  if (!pc) return 0;
  try {
    let bytes = 0;
    (await pc.getStats()).forEach((s: { type?: string; kind?: string; bytesReceived?: number }) => {
      if (s.type === 'inbound-rtp' && s.kind === 'audio') bytes += s.bytesReceived ?? 0;
    });
    return bytes;
  } catch {
    return 0;
  }
}

/** The one voice chat of this machine. */
export const voice = new VoiceChat();
