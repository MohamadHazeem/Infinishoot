/**
 * The radio host. Between stages (portal, shop, route map) DJ VOLT on RADIO
 * INFINI 88.8 comments on the stage you just played: lines are picked from the
 * stage's highlights (a no-hit boss, a big combo, a last stand, the Titan...)
 * and filled in with your numbers. The voice is the formant synth (like the
 * synthesized hero barks) speaking the line's own vowels, run through a radio
 * chain (band-pass, presence peak, soft clipping, a little static) with a
 * station jingle before and after. Every line is captioned, and the ON AIR
 * panel (src/ui/sound2Hud.ts) shows who's talking. SETTINGS > RADIO DJ.
 *
 * Pure parts (highlights -> script, text -> syllables) are testable without
 * WebAudio. Playback waits its turn on the shared voice channel.
 */
import { samples } from './samples';
import { synthMasterGain } from './loudness';
import { sfx, type SynthKit } from './sfx';
import { LaneVoice } from './synthGraph';
import { VOWELS, speakSyllables, type Syllable, type Utterance } from './voice';
import { caption } from './captions';
import { voiceChannel } from './voices';

export const radioSettings = { enabled: true };

export const radioTuning = {
  /** Voice level into the radio chain (VOICE volume applies on top), and the chain's output trim. */
  gain: 0.9,
  out: 0.32,
  /** DJ speaking pitch (Hz), seconds per syllable. */
  f0: 170,
  syl: 0.072,
  /** Highlight lines per break (plus the station intro and a sign-off). */
  lines: 2,
  /** Seconds to wait after a stage clear before the DJ starts (the announcer and barks go first). */
  delay: 1.6,
  /** Voice channel priority: above hero barks, below the announcer and boss lines. */
  priority: 8,
  /** Static hiss level. */
  hiss: 0.012,
  /** Chance the DJ speaks at a given break (1 = every stage). */
  chance: 1,
};

/** Running counts of local moments the DJ can mention (bumped by src/game/timeAudio.ts). */
export const radioEvents = { closeCalls: 0, standWins: 0, rewinds: 0 };

export const DJ_NAME = 'DJ VOLT';
export const STATION = 'RADIO INFINI 88.8';
export const DJ_COLOR = '#ffcd75';

/** What happened this stage (gathered locally by src/game/systems/sound2.ts). */
export interface RunHighlights {
  stage: number;
  /** Stage boss's display name ('' if none was beaten). */
  boss: string;
  titan: boolean;
  /** Times the local hero was hit while the boss was up. */
  bossHits: number;
  /** Seconds from the boss landing to its defeat. */
  bossTime: number;
  duel: boolean;
  maxCombo: number;
  kills: number;
  level: number;
  levelsGained: number;
  /** Hits taken all stage. */
  hits: number;
  closeCalls: number;
  lastStandWon: boolean;
  rewound: boolean;
  mech: boolean;
  /** A super weapon from a supply crate. */
  crate: boolean;
  comeback: boolean;
  /** World event kind seen this stage ('' none). */
  event: string;
  /** Name of an instrument that joined the band this stage ('' none). */
  instrument: string;
  coop: boolean;
  revives: number;
}

export function emptyHighlights(stage = 1): RunHighlights {
  return { stage, boss: '', titan: false, bossHits: 0, bossTime: 0, duel: false, maxCombo: 0, kills: 0, level: 1, levelsGained: 0, hits: 0, closeCalls: 0, lastStandWon: false, rewound: false, mech: false, crate: false, comeback: false, event: '', instrument: '', coop: false, revives: 0 };
}

const EVENT_LINES: Readonly<Record<string, string[]>> = {
  collapse: ['The floor fell out from under you and you kept on dancing!'],
  flood: ['A flash flood mid-fight? You just swam through it!'],
  split: ['The whole island split in two, and you did not even blink!'],
  giant: ['A colossus strolled right past you. Big day out there!'],
  eclipse: ['Lights out, and you still found the beat!'],
  flower: ['Stopped to smell the giant flower? Good for the soul!'],
  volcano: ['Lava raining from the sky and you kept your cool!'],
  stealth: ['Sneaky, sneaky. Nobody saw a thing!'],
};

/** Short boss name for the lines ("King Bopper" -> "the King"). */
export function bossNick(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('rex')) return 'Rex';
  if (n.includes('queen')) return 'the Queen';
  if (n.includes('king')) return 'the King';
  if (n.includes('omega')) return 'Omega';
  if (n.includes('titan')) return 'the Titan';
  if (n.includes('glitch')) return 'the DJ';
  if (n.includes('jack')) return 'Jack';
  if (n.includes('gale')) return 'the Admiral';
  return name || 'the boss';
}

interface Candidate {
  score: number;
  text: string;
}

/** Every line this stage earned, best first. `rand` picks between phrasings. */
export function highlightLines(h: RunHighlights, rand: () => number = Math.random): Candidate[] {
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length) % a.length];
  const c: Candidate[] = [];
  const nick = bossNick(h.boss);
  const Nick = nick.charAt(0).toUpperCase() + nick.slice(1);
  if (h.titan) c.push({ score: 9.5, text: pick(['That Titan never stood a chance!', 'You toppled a Titan. A real, actual Titan!']) });
  if (h.boss && h.bossHits === 0) c.push({ score: 10, text: pick([`Zero hits on ${nick}? Respect!`, `${Nick} did not lay a finger on you!`]) });
  if (h.duel) c.push({ score: 7.5, text: 'One on one in a ring of fire? What a showdown!' });
  if (h.lastStandWon) c.push({ score: 8.5, text: 'A last stand, and you walked right out of it. Unreal!' });
  if (h.comeback) c.push({ score: 7, text: pick(['That comeback had me out of my chair!', 'Down to your last sliver of life and you turned it around!']) });
  if (h.maxCombo >= 50) c.push({ score: 5 + Math.min(4, h.maxCombo / 100), text: pick([`Combo of ${h.maxCombo}, the crowd loves you!`, `A ${h.maxCombo} hit combo! Somebody stop this hero!`]) });
  if (h.boss && h.bossTime > 0 && h.bossTime < 35) c.push({ score: 6.5, text: `${Nick} down in ${Math.max(1, Math.round(h.bossTime))} seconds flat!` });
  if (h.boss && h.bossTime >= 100) c.push({ score: 3, text: `That fight with ${nick} went the distance!` });
  if (h.instrument) c.push({ score: 6, text: `And is that a ${h.instrument.toLowerCase()} I hear in the mix? Groovy!` });
  if (h.closeCalls >= 2) c.push({ score: 4.5, text: `${h.closeCalls} close calls in one stage. My heart can't take it!` });
  else if (h.closeCalls === 1) c.push({ score: 2.5, text: 'That close call? I felt the wind from here!' });
  if (h.mech) c.push({ score: 5, text: 'Somebody handed you a mech suit. Bad news for the robots!' });
  if (h.crate) c.push({ score: 3.5, text: 'Special delivery from the sky! Enjoy the hardware!' });
  if (h.event && EVENT_LINES[h.event]) c.push({ score: 4, text: pick(EVENT_LINES[h.event]) });
  if (h.rewound) c.push({ score: 4, text: 'Did somebody just rewind time? I will allow it.' });
  if (h.hits === 0 && h.kills > 0) c.push({ score: 8, text: 'Not a scratch all stage. Flawless!' });
  if (h.coop && h.revives > 0) c.push({ score: 3.5, text: h.revives > 1 ? `${h.revives} rescues out there. Teamwork makes the dream work!` : 'Nice save on your teammate back there!' });
  if (h.kills >= 250) c.push({ score: 3 + Math.min(2, h.kills / 600), text: `${h.kills} knocked out this stage. Busy, busy!` });
  if (h.levelsGained >= 5) c.push({ score: 2.5, text: `Level ${h.level} and still climbing!` });
  if (!c.length || c.every((x) => x.score < 2)) c.push({ score: 1, text: `Stage ${h.stage} is in the books. Keep it locked!` });
  return c.sort((a, b) => b.score - a.score);
}

const INTROS = ['You are tuned to Radio Infini, eighty eight point eight!', 'DJ Volt here on Radio Infini!', 'Radio Infini, coming at you live!', 'This is DJ Volt with your stage report!'];
const OUTROS = ['Next stage coming right up!', 'Stay loud out there!', 'Back to the action after this!', 'Keep that volume up!'];

/** The whole break: station intro, the best highlights, a sign-off. */
export function radioScript(h: RunHighlights, rand: () => number = Math.random, lines = radioTuning.lines): string[] {
  const best = highlightLines(h, rand).slice(0, Math.max(1, lines)).map((x) => x.text);
  const intro = h.stage <= 1 ? INTROS[0] : INTROS[Math.floor(rand() * INTROS.length) % INTROS.length];
  return [intro, ...best, OUTROS[Math.floor(rand() * OUTROS.length) % OUTROS.length]];
}

// ---------------------------------------------------------------- text -> syllables

const VOWEL_OF: Readonly<Record<string, string>> = { a: 'a', e: 'e', i: 'i', o: 'o', u: 'u', y: 'i' };

/** Syllables of a word: vowel groups (at least one, at most four), each with its consonant onset. */
export function wordSyllables(word: string): { consonant: string; vowel: string }[] {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!w) return [];
  if (/^\d+$/.test(w)) {
    // Numbers are said as a couple of syllables per digit group.
    return Array.from({ length: Math.min(4, 1 + Math.floor(w.length / 1.5)) }, (_, i) => ({ consonant: 'tns'[i % 3], vowel: 'eiu'[i % 3] }));
  }
  const out: { consonant: string; vowel: string }[] = [];
  let onset = '';
  let i = 0;
  while (i < w.length && out.length < 4) {
    const ch = w[i];
    if (VOWEL_OF[ch]) {
      out.push({ consonant: onset, vowel: VOWEL_OF[ch] });
      onset = '';
      while (i < w.length && VOWEL_OF[w[i]]) i++;
      continue;
    }
    if (!onset) onset = ch;
    i++;
  }
  if (!out.length) out.push({ consonant: w[0], vowel: 'a' });
  return out;
}

const CONSONANT_MAP: Readonly<Record<string, string>> = { b: 'b', p: 'p', d: 'd', t: 't', k: 'k', c: 'k', g: 'k', q: 'k', x: 'k', s: 's', z: 's', f: 's', h: 's', j: 's', m: 'm', n: 'n', w: 'w', v: 'w', r: 'w', l: 'n' };

/** A spoken sentence as formant syllables: declining pitch, stressed word starts, a rise on ! and ?. */
export function composeSpeech(text: string, rand: () => number = Math.random, f0 = radioTuning.f0, syl = radioTuning.syl): Utterance {
  const words = text.split(/\s+/).filter(Boolean);
  const all: { consonant: string; vowel: string; first: boolean; word: number }[] = [];
  words.forEach((w, wi) => wordSyllables(w).forEach((s, si) => all.push({ ...s, first: si === 0, word: wi })));
  const end = /[!]\s*$/.test(text) ? 1.22 : /[?]\s*$/.test(text) ? 1.32 : 0.9;
  const syllables: Syllable[] = [];
  let t = 0;
  const n = all.length;
  for (let i = 0; i < n; i++) {
    const s = all[i];
    const k = n <= 1 ? 1 : i / (n - 1);
    const tail = i >= n - 2;
    const decl = 1.08 - 0.18 * k;
    const stress = s.first && words[s.word].length > 3 ? 1.1 : 1;
    const jitter = 1 + (rand() - 0.5) * 0.06;
    const a = f0 * decl * stress * jitter * (tail ? (end > 1 ? 1 + (end - 1) * 0.4 : 1) : 1);
    const b = a * (tail ? end : 0.98);
    const next = all[i + 1];
    const dur = syl * (tail ? 1.6 : s.first ? 1.05 : 0.9);
    const vol = (s.first ? 0.5 : 0.42) * radioTuning.gain;
    syllables.push({
      delay: t,
      dur,
      f0a: a,
      f0b: b,
      from: VOWELS[s.vowel],
      to: VOWELS[next && next.word === s.word ? next.vowel : s.vowel],
      consonant: CONSONANT_MAP[s.consonant] ?? '',
      vol,
    });
    t += dur + syl * 0.12 + (next && next.word !== s.word ? syl * 0.35 : 0);
  }
  return { speaker: 'dj', kind: 'levelUp', wave: 'sawtooth', syllables, caption: text, length: t };
}

// ---------------------------------------------------------------- playback

/** The station jingle: three bright notes up, a sweep (into any kit). */
export function playJingle(k: SynthKit, outro = false, delay = 0): void {
  const notes = outro ? [784, 1046] : [1046, 1318, 1568];
  notes.forEach((f, i) => {
    k.tone('triangle', f, f, 0.16, 0.12, delay + i * 0.11);
    k.tone('square', f * 2, f * 2, 0.05, 0.02, delay + i * 0.11);
  });
  if (!outro) k.noise(0.35, 0.05, 2000, 7000, 2, delay + 0.25);
}

function softClip(ctx: BaseAudioContext): WaveShaperNode | null {
  if (typeof ctx.createWaveShaper !== 'function') return null;
  const ws = ctx.createWaveShaper();
  const n = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.4) / Math.tanh(2.4);
  }
  ws.curve = curve;
  return ws;
}

export interface OnAir {
  /** The sentence being spoken now ('' between sentences). */
  text: string;
  /** Seconds left of the whole break. */
  left: number;
}

export class RadioDj {
  private voice: LaneVoice | null = null;
  private lines: { text: string; at: number; until: number }[] = [];
  private started = -1;
  private length = 0;
  private shown = -1;
  /** A queued break waiting for the channel (expires). */
  private pending: { script: string[]; until: number } | null = null;
  readonly onAir: OnAir = { text: '', left: 0 };
  breaks = 0;
  constructor(private rand: () => number = Math.random) {}

  get active(): boolean {
    return this.started >= 0;
  }

  /** Queue a break (it starts as soon as the voice channel and audio are free, within `wait` s). */
  queue(script: string[], wait = 8): void {
    if (!radioSettings.enabled || !script.length) return;
    this.pending = { script, until: now() + wait };
  }

  /** Every frame. `talkOk` = it's a good moment (a between-stages screen). */
  update(talkOk: boolean): void {
    const t = now();
    if (this.pending) {
      if (t > this.pending.until || !radioSettings.enabled) this.pending = null;
      else if (talkOk && !this.active && voiceChannel.canStart(radioTuning.priority, t) && this.start(this.pending.script)) this.pending = null;
    }
    if (!this.active) {
      this.onAir.text = '';
      this.onAir.left = 0;
      return;
    }
    const el = t - this.started;
    if (el > this.length + 0.3 || this.voice?.finished) {
      this.stop();
      return;
    }
    this.onAir.left = Math.max(0, this.length - el);
    let cur = -1;
    for (let i = 0; i < this.lines.length; i++) if (el >= this.lines[i].at && el < this.lines[i].until) cur = i;
    this.onAir.text = cur >= 0 ? this.lines[cur].text : '';
    if (cur >= 0 && cur !== this.shown) {
      this.shown = cur;
      caption({ who: DJ_NAME, text: this.lines[cur].text, color: DJ_COLOR, kind: 'voice' });
    }
  }

  /** Speak a break now. False if audio isn't running or the budget is full. */
  start(script: string[]): boolean {
    const out = sfx.output('voice');
    if (!out || !radioSettings.enabled) return false;
    const { ctx, node } = out;
    let voice: LaneVoice | null = null;
    const release = samples.budget.acquire('radio', 5, 1, () => voice?.stop());
    if (!release) return false;
    // The radio chain: band-limited, a presence bump, a little crunch.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 380;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3300;
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 1700;
    peak.gain.value = 7;
    const ws = softClip(ctx);
    const outGain = ctx.createGain();
    // The soft clip lifts quiet syllables (x2.4 at small levels), so the output is trimmed back.
    outGain.gain.value = radioTuning.out * synthMasterGain('radio');
    // Crunch first, then the band limit, so the clipping's harmonics stay inside the radio band.
    hp.connect(peak);
    if (ws) peak.connect(ws).connect(lp);
    else peak.connect(lp);
    lp.connect(outGain);
    outGain.connect(node);
    const chain: AudioNode[] = [hp, lp, peak, outGain];
    if (ws) chain.push(ws);
    voice = new LaneVoice(ctx, hp, release, chain);
    // Jingle, then the sentences with a breath between them, then the sign-off sting.
    playJingle(voice, false, 0);
    let t = 0.7;
    this.lines = [];
    for (const text of script) {
      const u = composeSpeech(text, this.rand);
      for (const s of u.syllables) s.delay += t;
      speakSyllables(voice, u);
      this.lines.push({ text, at: t, until: t + u.length + 0.3 });
      t += u.length + 0.35;
    }
    playJingle(voice, true, t + 0.05);
    this.length = t + 0.5;
    voice.noise(this.length, radioTuning.hiss, 5200, 5200, 0.6, 0);
    this.voice = voice;
    this.started = now();
    this.shown = -1;
    this.breaks++;
    voiceChannel.claim(radioTuning.priority, this.started, this.length, () => this.stop());
    return true;
  }

  stop(): void {
    const v = this.voice;
    this.voice = null;
    this.started = -1;
    this.lines = [];
    this.onAir.text = '';
    this.onAir.left = 0;
    v?.stop();
  }

  reset(): void {
    this.pending = null;
    this.stop();
  }
}

let clock: () => number = () => (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
function now(): number {
  return clock();
}
/** Tests: drive the DJ's clock. */
export function setRadioClock(fn: () => number): void {
  clock = fn;
}

export const radio = new RadioDj();
