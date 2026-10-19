import { sfx, audioSettings } from './sfx';
import { MUSIC_GAINS } from './loudness';
import { silenceDuration } from './mix';
import { WeaponStems, type StemWeapon } from './stems';
import {
  TRACKS, TRACK_BY_ID, makeSong, stageTranspose, sectionAt, chordAt, degreeMidi, phaseAt, inBeatWindow,
  type TrackId, type Song, type Section,
} from './music/composition';
import { MusicSynth, musicTuning } from './music/synth';
import { InstrumentLayers } from './instruments';
import { answerDegree, duelTuning, duelTurnAt, minorScale, tensionTuning, type DuelTurn } from './musicDuel';
import type { Style } from './music/composition';
export { TRACKS, makeSong, bossTrack, trackUnlocked } from './music/composition';
export type { TrackId } from './music/composition';
export { musicTuning } from './music/synth';

export interface MusicWant {
  track: TrackId | null;
  seed: number;
  intensity: number;
  duck: boolean;
  /** Legacy caller support; new callers should use setBossPhase. */
  keyUp?: boolean;
  stage?: number;
  cue?: 'victory' | 'gameover';
}

type LayerId = 'pad' | 'hat' | 'bass' | 'drums' | 'lead' | 'arp' | 'counter' | 'style' | 'duel';
const LAYERS: readonly LayerId[] = ['pad', 'hat', 'bass', 'drums', 'lead', 'arp', 'counter', 'style', 'duel'];
/** `duel`: the boss duel's call/answer and accents, and the comeback heartbeat (src/audio/musicDuel.ts). */
const VOLUME: Record<LayerId, number> = { pad: 0.028, hat: 0.065, bass: 0.1, drums: 0.22, lead: 0.075, arp: 0.035, counter: 0.038, style: 0.05, duel: 0.06 };
const PAN: Record<LayerId, number> = { pad: -0.18, hat: 0.18, bass: 0, drums: 0, lead: -0.12, arp: 0.32, counter: -0.32, style: 0.24, duel: 0.1 };
const NO_CALL = -999;
/**
 * Style-rank layer (playing well sounds better). Ranks are the style meter's
 * 0 = D .. 5 = SS; it changes on the next bar.
 *   B: off-beat shaker. A: a harmony a third over the lead. S: drum fills every
 *   two bars and a high octave arp. SS: crash on every bar and a doubled bass.
 */
export const styleLayerTuning = { shakerAt: 2, harmonyAt: 3, fillsAt: 4, crashAt: 5, gain: 1 };
const TONES = [0, 2, 4, 7];
const HOOK = [4, 4, 5, 4, 2, 0, 2, 4];
const VICTORY = [0, 2, 4, 7, 6, 7];
const GAMEOVER = [7, 4, 2, 1, 0];

interface Playing {
  id: TrackId;
  seed: number;
  stage: number;
  song: Song;
  out: GainNode;
  filter: BiquadFilterNode;
  menu: GainNode;
  layers: Record<LayerId, GainNode>;
  nodes: AudioNode[];
  padDuck: GainNode;
  stems: WeaponStems;
  step: number;
  nextTime: number;
  section: Section;
  transpose: number;
  phase: number;
  energy: number;
  end: number;
  finished: boolean;
  /** Style rank in effect this bar (set by arrange). */
  rank: number;
  /** Instrument pickups' layers (src/audio/instruments.ts). */
  instruments: InstrumentLayers;
  /** Boss duel phrase this bar, comeback tension this bar, the minor style and the boss's last called phrase. */
  duel: DuelTurn;
  tense: boolean;
  tenseStyle: Style | null;
  call: Int16Array;
}

/** Procedural songs with bar-quantized transitions and an audio-clock beat API. */
export class Music {
  pulse = 0;
  beats = 0;
  jukebox: TrackId | null = null;
  readonly heard = new Set<TrackId>(['title']);
  /** Scheduled, not-yet-audible beats. Entries are recycled; don't retain them. */
  readonly beatTimes: { t: number; down: boolean; duration: number }[] = [];
  private readonly beatPool = Array.from({ length: 32 }, () => ({ t: 0, down: false, duration: 0 }));
  private beatSerial = 0;
  private lastBeat = -1;
  private beatDuration = 0;
  private beatEnd = 0;
  private cur: Playing | null = null;
  private old: Playing[] = [];
  private synth: MusicSynth | null = null;
  private intensity = 0;
  private bossPhase = 1;
  private styleRank = 0;
  private desiredTrack: TrackId | null = null;
  private desiredSeed = 0;
  private desiredStage = 1;
  private cue: 'victory' | 'gameover' | null = null;
  private cueSeed = 0;
  private cueStage = 1;
  private lastCue: MusicWant['cue'];
  private lastCueSeed = 0;
  private lastJukebox: TrackId | null = null;
  private duck = false;
  private weapons: readonly StemWeapon[] = [];
  private readonly noWeapons: readonly StemWeapon[] = [];
  private duelOn = false;
  private accent = 0;
  private tension = false;
  private band = 0;
  private talk = false;

  /** Boss music duel on/off (sound lane: a boss's last phase or the ring-of-fire duel). Takes effect next bar. */
  setDuel(on: boolean): void { this.duelOn = on; }
  /** Your hits/kills during your phrase: accent strength (decays). */
  duelAccent(amount: number): void {
    if (amount > 0 && Number.isFinite(amount)) this.accent = Math.min(duelTuning.accentMax, this.accent + amount);
  }
  /** Whose phrase is playing now: 'boss', 'hero' or null (no duel). */
  get duelTurn(): 'boss' | 'hero' | null {
    const d = this.cur?.duel ?? 0;
    return d === 1 ? 'boss' : d === 2 ? 'hero' : null;
  }
  /** Comeback mode: the song turns minor and muffled (next bar; the filter moves at once). */
  setTension(on: boolean): void { this.tension = on; }
  get tense(): boolean { return this.cur?.tense ?? false; }
  /** The run's band (bitmask of src/audio/instruments.ts INSTRUMENT_IDS), committed at the next bar. */
  setInstruments(mask: number): void { this.band = Number.isFinite(mask) ? mask | 0 : 0; }
  get instruments(): number { return this.cur?.instruments.active ?? 0; }
  /** Pull the music back while the radio DJ talks. */
  setTalkover(on: boolean): void { this.talk = on; }

  /** Borrow the local build; it is sampled only on the next scheduled downbeat. */
  setWeapons(weapons: readonly StemWeapon[]): void { this.weapons = weapons; }

  /** Brief music/ambience vacuum; audio-clock release keeps the re-entry sharp. */
  silence(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    const now = this.synth?.ctx.currentTime ?? 0;
    sfx.silenceBeds(silenceDuration(seconds, now, this.clockActive(now) ? this.lastBeat : -1, this.beatDuration));
  }

  get playing(): TrackId | null { return this.cur?.id ?? null; }
  get section(): Section | null { return this.cur?.section ?? null; }

  /** Phases 2/3 add counterpoint/arps and raise the key by 2/4 semitones next bar. */
  setBossPhase(phase: number): void {
    this.bossPhase = Number.isFinite(phase) ? Math.max(1, Math.min(3, Math.floor(phase))) : 1;
  }

  /** The local hero's style rank (0 = D .. 5 = SS); the style layer follows on the next bar. */
  setStyleRank(rank: number): void {
    this.styleRank = Number.isFinite(rank) ? Math.max(0, Math.min(5, Math.floor(rank))) : 0;
  }

  get style(): number {
    return this.cur?.rank ?? 0;
  }

  beatPhase(): number {
    const now = this.synth?.ctx.currentTime ?? 0;
    if (!this.clockActive(now)) return 0;
    const next = this.beatTimes[0];
    if (next && now >= next.t) return phaseAt(now, next.t, next.duration);
    return this.lastBeat < 0 ? 0 : phaseAt(now, this.lastBeat, this.beatDuration);
  }

  onBeatWindow(ms: number): boolean {
    const now = this.synth?.ctx.currentTime ?? 0;
    if (!this.clockActive(now)) return false;
    // The next queued beat may belong to a different tempo after a transition.
    const next = this.beatTimes[0];
    if (next && Math.abs(next.t - now) * 1000 <= ms) return ms >= 0 && Number.isFinite(ms);
    if (next && now >= next.t) return inBeatWindow(now, next.t, next.duration, ms);
    return this.lastBeat >= 0 && inBeatWindow(now, this.lastBeat, this.beatDuration, ms);
  }

  /**
   * Rhythm stages (modes lane, src/game/systems/modes.ts): pull the beat grid toward the game's own
   * deterministic beat clock. `phase` is where that clock's beat is now, in [0, 1). Moves future
   * scheduling by at most `maxShift` seconds per call (call once per frame), so the tempo bends
   * slightly while it locks on. No-op without a playing song. Gameplay never reads the audio.
   */
  alignBeat(phase: number, maxShift = 0.002): void {
    const p = this.cur;
    const ctx = this.synth?.ctx;
    if (!p || !ctx || ctx.state !== 'running' || TRACK_BY_ID[p.id].bars || !Number.isFinite(phase)) return;
    const beat = 60 / p.song.style.bpm;
    const now = ctx.currentTime;
    const audio = ((((p.step % 4) / 4 - (p.nextTime - now) / beat) % 1) + 1) % 1;
    let err = phase - audio;
    err -= Math.round(err);
    const shift = Math.max(-maxShift, Math.min(maxShift, err * beat));
    p.nextTime = Math.max(now + 0.005, p.nextTime - shift);
  }

  private clockActive(now: number): boolean {
    return this.synth?.ctx.state === 'running' && now <= this.beatEnd && (this.lastBeat >= 0 || this.beatTimes.length > 0);
  }

  update(dt: number, want: MusicWant): void {
    this.pulse *= Math.exp(-Math.max(0, dt) * 7);
    const output = sfx.output('music');
    if (!output) return;
    const { ctx } = output;
    this.synth ??= new MusicSynth(ctx, output.node);
    this.synth.reap();
    for (let i = this.old.length - 1; i >= 0; i--) {
      if (ctx.currentTime >= this.old[i].end) {
        this.dispose(this.old[i]);
        this.old.splice(i, 1);
      }
    }
    this.desiredTrack = this.jukebox ?? want.track;
    this.desiredSeed = this.jukebox ? 7 + TRACKS.findIndex((t) => t.id === this.jukebox) : want.seed;
    this.desiredStage = this.jukebox || want.track === 'title' ? 1 : want.stage ?? 1;
    this.duck = !this.jukebox && want.duck;
    this.intensity += ((this.jukebox ? 0.95 : want.intensity) - this.intensity) * Math.min(1, Math.max(0, dt) * 1.5);
    if (!this.jukebox && want.cue && (want.cue !== this.lastCue || want.seed !== this.lastCueSeed)) {
      this.cue = want.cue;
      this.cueSeed = want.seed;
      this.cueStage = want.stage ?? 1;
    }
    // Level-up can temporarily interrupt `cleared`; don't replay its victory on return.
    if (want.cue) { this.lastCue = want.cue; this.lastCueSeed = want.seed; }
    if (want.track === 'title' || want.track === 'titleRemix') this.lastCue = undefined;
    if (this.jukebox || want.track === 'title' || want.track === 'titleRemix') this.cue = null;
    // Clicking another jukebox entry should also interrupt an auditioned stinger.
    if (this.jukebox !== this.lastJukebox && this.cur?.finished) this.cur.seed = -1;
    this.lastJukebox = this.jukebox;
    if (!this.cur && (this.cue || this.desiredTrack)) this.switchTrack(ctx.currentTime + 0.04);
    let p = this.cur;
    if (!p) { this.consumeBeats(ctx.currentTime); return; }
    this.accent *= Math.exp(-Math.max(0, dt) * 1.2);
    const tenseNow = this.tension && !this.jukebox && p.id !== 'title' && p.id !== 'titleRemix' && !TRACK_BY_ID[p.id].bars;
    p.filter.frequency.setTargetAtTime(this.duck ? 900 : tenseNow ? tensionTuning.cutoff : 16000, ctx.currentTime, tenseNow ? 0.4 : 0.15);
    p.menu.gain.setTargetAtTime((this.duck ? 0.45 : 1) * (this.talk ? 0.5 : 1), ctx.currentTime, 0.12);
    if (p.nextTime < ctx.currentTime - 0.25) {
      // Tab sleep: skip backlog, resume a fresh bar, discard stale bonus windows.
      p.step = Math.ceil(p.step / 16) * 16;
      p.nextTime = ctx.currentTime + 0.04;
      this.resetBeats();
    }
    while (p.nextTime < ctx.currentTime + musicTuning.lookahead) {
      if (p.step % 16 === 0) {
        const bars = TRACK_BY_ID[p.id].bars;
        if (bars && p.step >= bars * 16) p.finished = true;
        const changed = p.id !== this.desiredTrack || p.seed !== this.desiredSeed || p.stage !== this.desiredStage;
        if (this.cue || (changed && (!bars || p.finished || this.desiredTrack === 'title'))) {
          this.switchTrack(p.nextTime);
          p = this.cur!;
          if (!p) break;
        }
        if (p.finished) break;
        this.arrange(p, p.nextTime, want.keyUp ?? false);
      }
      const dur = 60 / p.song.style.bpm / 4;
      const step = p.step % 16;
      this.playStep(p, p.nextTime + (step % 2 ? p.song.style.swing * dur : 0), dur);
      if (step % 4 === 0) {
        const beat = this.beatPool[this.beatSerial++ % this.beatPool.length];
        beat.t = p.nextTime;
        beat.down = step === 0;
        beat.duration = dur * 4;
        this.beatTimes.push(beat);
        this.beatEnd = beat.t + beat.duration;
      }
      p.step++;
      p.nextTime += dur;
    }
    this.consumeBeats(ctx.currentTime);
  }

  private consumeBeats(now: number): void {
    while (this.beatTimes.length && this.beatTimes[0].t <= now) {
      const beat = this.beatTimes.shift()!;
      this.lastBeat = beat.t;
      this.beatDuration = beat.duration;
      this.pulse = (beat.down ? 1 : 0.6) * Math.exp(-(now - beat.t) * 7);
      this.beats++;
    }
  }

  private resetBeats(): void {
    this.beatTimes.length = 0;
    this.lastBeat = -1;
    this.beatDuration = this.beatEnd = this.pulse = 0;
  }

  stop(): void {
    this.jukebox = null;
    this.cue = null;
    if (this.cur && this.synth) this.fadeOut(this.cur, this.synth.ctx.currentTime);
    this.cur = null;
    this.resetBeats();
  }

  private switchTrack(t: number): void {
    if (this.cur) this.fadeOut(this.cur, t);
    const id = this.cue ?? this.desiredTrack;
    const seed = this.cue ? this.cueSeed : this.desiredSeed;
    const stage = this.cue ? this.cueStage : this.desiredStage;
    this.cue = null;
    this.cur = id ? this.start(id, seed, stage, t) : null;
    if (id) this.heard.add(id);
  }

  private start(id: TrackId, seed: number, stage: number, t: number): Playing {
    const ctx = this.synth!.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(MUSIC_GAINS[id] ?? 1, t + musicTuning.crossfade);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 16000;
    const menu = ctx.createGain();
    menu.gain.value = this.duck ? 0.45 : 1;
    out.connect(menu).connect(filter).connect(this.synth!.output);
    const padDuck = ctx.createGain();
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = TRACK_BY_ID[id].style.padCut;
    padDuck.connect(padFilter).connect(out);
    const nodes: AudioNode[] = [out, filter, menu, padDuck, padFilter];
    const layers = {} as Record<LayerId, GainNode>;
    for (const layer of LAYERS) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      pan.pan.value = PAN[layer];
      gain.connect(pan).connect(layer === 'pad' ? padDuck : out);
      layers[layer] = gain;
      nodes.push(gain, pan);
    }
    const stems = new WeaponStems(ctx, out, nodes);
    const instruments = new InstrumentLayers(ctx, out, nodes);
    return { stems, id, seed, stage, song: makeSong(TRACK_BY_ID[id].style, seed, TRACK_BY_ID[id].theme), out, filter, menu, layers, nodes, padDuck,
      step: 0, nextTime: t, section: 'intro', transpose: 0, phase: 1, energy: 0, end: Infinity, finished: false, rank: 0,
      instruments, duel: 0, tense: false, tenseStyle: null, call: new Int16Array(32).fill(NO_CALL) };
  }

  private fadeOut(p: Playing, t: number): void {
    p.out.gain.cancelAndHoldAtTime(t);
    p.out.gain.linearRampToValueAtTime(0, t + musicTuning.crossfade);
    p.end = t + musicTuning.crossfade + 0.03;
    this.old.push(p);
    // Even rapid stop/play spam has a bounded graph; never schedule retiring songs.
    if (this.old.length > 2) this.dispose(this.old.shift()!);
  }

  private dispose(p: Playing): void {
    for (const node of p.nodes) node.disconnect();
  }

  private arrange(p: Playing, t: number, legacyKeyUp: boolean): void {
    const bar = Math.floor(p.step / 16);
    const boss = TRACK_BY_ID[p.id].boss;
    const inRun = !this.jukebox && p.id !== 'title' && p.id !== 'titleRemix' && !TRACK_BY_ID[p.id].bars;
    p.duel = boss && inRun && this.duelOn ? duelTurnAt(bar) : 0;
    p.tense = this.tension && inRun;
    const stemMul = p.duel === 1 ? duelTuning.bossStems : p.duel === 2 ? duelTuning.heroStems : 1;
    p.stems.commit(audioSettings.interactiveMusic && inRun && p.id !== 'shop' ? this.weapons : this.noWeapons, t, stemMul);
    p.instruments.commit(inRun ? this.band : 0, t);
    p.phase = boss && !this.jukebox ? Math.max(this.bossPhase, legacyKeyUp ? 2 : 1) : 1;
    p.energy = Math.max(0, Math.min(1, this.intensity));
    p.rank = this.jukebox || TRACK_BY_ID[p.id].bars ? 0 : this.styleRank;
    if (bar % 4 === 0) p.section = sectionAt(bar, p.energy);
    p.transpose = stageTranspose(p.stage) + (p.phase - 1) * 2 + (p.section === 'final' ? 2 : 0);
    const full = !!TRACK_BY_ID[p.id].bars || p.section === 'chorus' || p.section === 'final';
    const intro = p.section === 'intro';
    const bridge = p.section === 'bridge';
    for (const layer of LAYERS) {
      let k = 1;
      if (layer === 'pad') k = bridge ? 1 : 0.8;
      if (layer === 'hat') k = intro ? 0.45 : 0.6 + p.energy * 0.4;
      if (layer === 'bass') k = intro ? 0.65 : 1;
      if (layer === 'drums') k = intro || bridge ? 0.45 : 0.6 + p.energy * 0.4;
      if (layer === 'lead') k = intro ? 0.65 : full ? 1 : 0.8;
      if (layer === 'arp') k = intro || bridge ? 0 : full ? 0.85 : p.energy * 0.45;
      if (layer === 'counter') k = full ? 0.85 : bridge ? 0.7 : 0;
      if (boss && layer === 'counter') k = p.phase >= 2 ? 0.85 : 0;
      if (boss && layer === 'arp') k = p.phase >= 3 ? 1 : p.phase >= 2 ? 0.65 : 0.25;
      if (layer === 'style') k = p.rank >= styleLayerTuning.shakerAt ? (0.55 + 0.09 * p.rank) * styleLayerTuning.gain : 0;
      // Boss duel: the boss calls (its lead louder), then the boss lead and counter drop out while you answer.
      if (p.duel === 2 && (layer === 'lead' || layer === 'counter')) k = 0;
      if (p.duel === 2 && layer === 'arp') k *= 0.3;
      if (p.duel === 1 && layer === 'lead') k *= 1.15;
      if (layer === 'duel') k = p.duel ? 1 : p.tense ? 0.8 : 0;
      p.layers[layer].gain.setTargetAtTime(VOLUME[layer] * k, t, 0.06);
    }
  }

  private playStep(p: Playing, t: number, d: number): void {
    if (TRACK_BY_ID[p.id].bars) { this.playStinger(p, t, d); return; }
    const synth = this.synth!;
    const song = p.song;
    const st = p.tense ? (p.tenseStyle ??= { ...song.style, scale: minorScale(song.style.scale) }) : song.style;
    const s = p.step % 16;
    const bar = Math.floor(p.step / 16);
    const chord = chordAt(song, p.section, bar);
    const root = degreeMidi(st, chord, p.transpose);
    const L = p.layers;
    const intro = p.section === 'intro';
    const bridge = p.section === 'bridge';
    const full = p.section === 'chorus' || p.section === 'final';
    const fill = bar % 4 === 3 && s >= 12;
    if (s === 0) {
      for (let k = 0; k < 3; k++) synth.note(L.pad, 'wide', degreeMidi(st, chord + k * 2, p.transpose) + 12, t, d * 15.8, 0.42);
    }
    if (song.hat[s] && (!intro || s % 4 === 0) && (!bridge || s % 4 === 2)) {
      synth.noiseHit(L.hat, t, s % 8 === 6 ? 0.12 : 0.035, s % 4 === 0 ? 0.65 : 0.42, 7200, true);
    }
    const b = song.bass[s];
    if (b !== null && (!intro && !bridge || s % 4 === 0)) {
      // Final beat walks back to the tonic: an audible turnaround before the next phrase.
      const degree = p.section === 'turnaround' && s >= 12 ? 6 - (s - 12) : chord + b;
      synth.note(L.bass, st.bass, degreeMidi(st, degree, p.transpose), t, d * 1.65, 0.75);
    }
    if (song.kick[s] && (!intro && !bridge || s === 0 || s === 8)) {
      synth.kick(L.drums, t);
      p.padDuck.gain.cancelScheduledValues(t);
      p.padDuck.gain.setValueAtTime(musicTuning.padDuck, t);
      p.padDuck.gain.linearRampToValueAtTime(1, t + Math.min(0.18, d * 1.8));
    }
    if (song.snare[s] && !intro && !fill) synth.snare(L.drums, t, bridge ? 0.55 : 1);
    if (fill && (s % 2 === 0 || full || p.phase >= 2)) {
      synth.snare(L.drums, t, 0.45 + (s - 12) * 0.13);
      if (s === 15) synth.noiseHit(L.hat, t, 0.25, 0.5, 6200, true);
    }
    const n = song.melody[p.step % 64];
    let leadDeg: number | null = null;
    if (song.themeAt && !bridge) {
      // Authored leitmotif; the intro saves it for its last two bars, choruses add a third below.
      const th = song.themeAt[p.step % 64];
      if (th && (!intro || bar % 4 >= 2)) {
        leadDeg = th[1];
        synth.note(L.lead, st.lead, degreeMidi(st, th[1], p.transpose) + 24, t, d * th[2] * 0.92, 0.72);
        if (full) synth.note(L.counter, 'bell', degreeMidi(st, th[1] - 2, p.transpose) + 24, t, d * th[2] * 0.9, 0.42);
      }
    } else if (full && s % 2 === 0) {
      leadDeg = chord + HOOK[s / 2];
      synth.note(L.lead, st.lead, degreeMidi(st, leadDeg, p.transpose) + 24, t, d * (s === 14 ? 1.9 : 1.5), 0.72);
    } else if (!full && n && (!intro || s % 8 === 0) && (!bridge || s < 8)) {
      leadDeg = n.deg - song.chords[bar % 4] + chord;
      synth.note(L.lead, st.lead, degreeMidi(st, leadDeg, p.transpose) + 24, t, d * Math.min(n.len, 3.8), 0.7);
    }
    if (p.rank >= styleLayerTuning.shakerAt) this.playStyle(p, t, d, s, bar, chord, leadDeg, b);
    if (p.duel) this.playDuel(p, st, t, d, s, chord, leadDeg);
    // Comeback: a heartbeat under the tense song.
    else if (p.tense && (s === 0 || s === 3)) synth.kick(L.duel, t);
    if ((!intro && !bridge && (full || p.energy > 0.45)) && (s % 2 === 0 || p.phase === 3)) {
      synth.note(L.arp, st.arp, degreeMidi(st, chord + TONES[song.arp[s]], p.transpose) + 24, t, d * 0.85, 0.55);
    }
    if ((full || bridge || p.phase >= 2) && (!TRACK_BY_ID[p.id].boss || p.phase >= 2) && s % 4 === 2) {
      synth.note(L.counter, st.lead === 'bell' ? 'pluck' : 'bell', degreeMidi(st, chord + TONES[3 - Math.floor(s / 4)], p.transpose) + 12, t, d * 2.8, 0.65);
    }
    if (bar % 4 === 0 && s === 0 && !intro) synth.noiseHit(L.hat, t, 0.45, 0.5, 6500, true);
    p.stems.play(synth, st, chord, p.transpose, p.step, t, d);
    p.instruments.play(synth, st, chord, p.transpose, p.step, p.section, t, d);
    // Phase 3 adds an octave pulse without changing the tempo/bonus grid.
    if (p.phase === 3 && s % 4 === 3) synth.note(L.bass, 'triangle', root + 12, t, d * 0.8, 0.4);
  }

  /** Boss duel for one step: record the boss's call, or answer it (src/audio/musicDuel.ts). */
  private playDuel(p: Playing, st: Style, t: number, d: number, s: number, chord: number, leadDeg: number | null): void {
    const synth = this.synth!;
    const L = p.layers.duel;
    const i = p.step % 32;
    if (p.duel === 1) {
      p.call[i] = leadDeg ?? NO_CALL;
      // The boss's voice: its lead doubled an octave down, gritty.
      if (leadDeg !== null) synth.note(L, 'sawtooth', degreeMidi(st, leadDeg, p.transpose) + 12, t, d * 1.5, 0.4);
      return;
    }
    const a = this.accent;
    const c = p.call[i];
    if (c !== NO_CALL) synth.note(L, 'square', degreeMidi(st, answerDegree(c), p.transpose) + 24, t, d * 1.3, Math.min(0.85, duelTuning.answerVol * (0.6 + a * 0.5)));
    if (a > 0.05 && s % 2 === 0) {
      synth.note(L, 'bell', degreeMidi(st, chord + TONES[(s / 2) % 4], p.transpose) + 36, t, d * 0.9, Math.min(0.7, 0.25 + a * 0.3));
      this.accent *= duelTuning.accentDecay;
    }
  }

  /** The style-rank layer for one step (see styleLayerTuning). */
  private playStyle(p: Playing, t: number, d: number, s: number, bar: number, chord: number, leadDeg: number | null, bass: number | null): void {
    const synth = this.synth!;
    const st = p.song.style;
    const L = p.layers.style;
    const T = styleLayerTuning;
    if (s % 2 === 1) synth.noiseHit(L, t, 0.03, 0.28, 9000, true);
    if (p.rank >= T.harmonyAt && leadDeg !== null) synth.note(L, 'pluck', degreeMidi(st, leadDeg + 2, p.transpose) + 24, t, d * 1.3, 0.4);
    if (p.rank >= T.fillsAt) {
      if (bar % 2 === 1 && s >= 12) synth.snare(L, t, 0.3 + (s - 12) * 0.1);
      else if (s % 4 === 2) synth.note(L, 'bell', degreeMidi(st, chord + TONES[p.song.arp[s]], p.transpose) + 36, t, d * 0.7, 0.3);
    }
    if (p.rank >= T.crashAt) {
      if (s === 0) synth.noiseHit(L, t, 0.6, 0.45, 5200, true);
      if (bass !== null && s % 4 === 0) synth.note(L, 'triangle', degreeMidi(st, chord + bass, p.transpose) + 12, t, d * 1.4, 0.45);
    }
  }

  private playStinger(p: Playing, t: number, d: number): void {
    const synth = this.synth!;
    const win = p.id === 'victory';
    const s = p.step;
    if (win && p.song.themeAt) {
      // Authored fanfare (quotes the title's leitmotif).
      const th = p.song.themeAt[s % 64];
      if (th) {
        synth.note(p.layers.lead, 'square', degreeMidi(p.song.style, th[1], p.transpose) + 24, t, d * th[2] * 0.95, 0.7);
        synth.note(p.layers.counter, 'bell', degreeMidi(p.song.style, th[1], p.transpose) + 36, t, d * Math.min(3, th[2]), 0.4);
      }
    } else {
      const notes = win ? VICTORY : GAMEOVER;
      const index = s / 2;
      if (s % 2 === 0 && index < notes.length) {
        const last = index === notes.length - 1;
        synth.note(p.layers.lead, win ? 'square' : 'bell', degreeMidi(p.song.style, notes[index], p.transpose) + 24, t, last ? d * 12 : d * 1.7, 0.7);
        if (win) synth.note(p.layers.counter, 'bell', degreeMidi(p.song.style, notes[index], p.transpose) + 36, t, d * 3, 0.4);
      }
    }
    if (s === 0 || s === 8) {
      for (let k = 0; k < 3; k++) synth.note(p.layers.pad, 'wide', degreeMidi(p.song.style, k * 2, p.transpose) + 12, t, d * 14, 0.5);
      synth.note(p.layers.bass, 'triangle', p.song.style.root + p.transpose, t, d * 7, 0.7);
      if (win) synth.kick(p.layers.drums, t);
    }
    if (win && s >= 4 && s < 8) synth.snare(p.layers.drums, t, 0.45 + (s - 4) * 0.15);
  }
}

export const music = new Music();
