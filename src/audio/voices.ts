/**
 * Characters speak, and impacts sound like what they hit.
 * - One shared voice channel: boss lines, hero barks and the announcer (through
 *   `voiceGate` in announcer.ts) take turns by priority, with a short queue.
 * - Boss voices: each boss's own roar, intro, phase (with a choir stab) and defeat
 *   lines. The host sends them on the effects bus as 'v:...' sounds (see `bossVoiceCue`).
 * - Hero barks: short lines for the local hero (src/game/systems/voiceLines.ts decides when).
 * - Material impacts: 'm:<material>' / 'm:<material>:c' (crit) sounds pick the material sample.
 * Everything falls back to silence (voices) or the existing synth (impacts) without samples.
 */
import { samples } from './samples';
import { sfx } from './sfx';
import { swarmGap } from './mix';
import { voiceGate } from './announcer';
import type { EnemyDef, Material } from '../data/enemies';

export const voiceSettings = {
  /** SETTINGS > HERO VOICES. */
  heroVoices: true,
};

export const voiceTuning = {
  /** Gap after any line before a queued line starts (s). */
  gap: 0.3,
  /** A higher-priority line waits for the current one instead of cutting it if it ends within this (s). */
  politeWait: 0.9,
  /** Lower lines don't start this close (s) before a higher queued line is due. */
  reserve: 1.5,
  /** Boss lines: gain on the menu/voice bus, sfx duck depth while they talk. */
  bossGain: 0.95,
  bossDuck: 0.5,
  /** Delay from the roar to the boss's intro / phase line (s). */
  introDelay: 0.9,
  phaseDelay: 0.55,
  /** Hero barks. */
  barkGain: 0.8,
  barkDuck: 0.8,
  /** Material impacts: sample gain (crit layer at critLayer x this). */
  impactGain: 0.5,
  critLayer: 0.75,
  critPitch: 1.12,
};

/** Global channel priorities: barks < announcer (10 + its own 1..10) < boss lines. */
export const VOICE_PRIORITY = {
  bark: { start: 3, level: 2, lowhp: 5, bigkill: 3, boss: 4, revive: 5, evolve: 4, win: 4 },
  boss: { phase: 22, intro: 24, defeat: 26 },
} as const;

export type BarkKind = keyof typeof VOICE_PRIORITY.bark;
export type BossLine = keyof typeof VOICE_PRIORITY.boss;

interface Pending {
  priority: number;
  at: number;
  expires: number;
  run: () => boolean;
}

/**
 * Who is talking right now. Pure logic (clock passed in), shared by everything
 * that speaks. A higher priority cuts a lower one (unless it is about to end:
 * then it waits); equal or lower priorities wait in a short queue or are dropped.
 */
export class VoiceChannel {
  private until = -Infinity;
  private priority = -1;
  private stopActive: (() => void) | null = null;
  private queue: Pending[] = [];

  /** Seconds left of the current line (0 = free). */
  remaining(now: number): number {
    return Math.max(0, this.until - now);
  }
  get current(): number {
    return this.priority;
  }

  /** Can a line of this priority start now? (Interrupting a lower one counts as yes.) */
  canStart(priority: number, now: number): boolean {
    // Don't start a line just before a more important queued one is due.
    for (const p of this.queue) if (p.priority > priority && p.at - now < voiceTuning.reserve && p.expires >= now) return false;
    const left = this.until + voiceTuning.gap - now;
    if (left <= 0) return true;
    return priority > this.priority && this.until - now > voiceTuning.politeWait;
  }

  /** True when `priority` must wait; with `retry`, the line is queued for `wait` seconds. */
  blocks(priority: number, now: number, retry?: () => boolean, wait = 3): boolean {
    if (this.canStart(priority, now)) return false;
    // Wait at least until shortly after the current line ends.
    if (retry) this.enqueue(priority, now, Math.max(now + wait, this.until + voiceTuning.gap + 1), retry);
    return true;
  }

  /** A line started: cut whatever lower line was playing. */
  claim(priority: number, now: number, seconds: number, stop: () => void): void {
    if (now < this.until && this.stopActive && priority > this.priority) this.stopActive();
    this.until = now + seconds;
    this.priority = priority;
    this.stopActive = stop;
  }

  /** Queue a line to start once the channel is free, between `at` and `expires`. */
  enqueue(priority: number, at: number, expires: number, run: () => boolean): void {
    const q = this.queue;
    // One waiting line per priority (the newest), at most 4 in all.
    for (let i = q.length - 1; i >= 0; i--) if (q[i].priority === priority) q.splice(i, 1);
    q.push({ priority, at, expires, run });
    if (q.length > 4) {
      let low = 0;
      for (let i = 1; i < q.length; i++) if (q[i].priority < q[low].priority) low = i;
      q.splice(low, 1);
    }
  }

  get queued(): number {
    return this.queue.length;
  }

  /** Every frame: start the best queued line that is due, drop expired ones. */
  update(now: number): void {
    const q = this.queue;
    if (!q.length) return;
    let best = -1;
    for (let i = q.length - 1; i >= 0; i--) {
      if (q[i].expires < now) {
        q.splice(i, 1);
        if (best > i) best--;
        continue;
      }
      if (q[i].at <= now && (best < 0 || q[i].priority > q[best].priority)) best = i;
    }
    if (best < 0 || !this.canStart(q[best].priority, now)) return;
    // A line that can't play yet (sample still loading) stays queued until it expires.
    const p = q[best];
    if (p.run()) {
      const i = q.indexOf(p);
      if (i >= 0) q.splice(i, 1);
    }
  }

  /** Run start / quit: silence and forget everything. */
  reset(): void {
    if (this.stopActive) this.stopActive();
    this.stopActive = null;
    this.until = -Infinity;
    this.priority = -1;
    this.queue.length = 0;
  }
}

export const voiceChannel = new VoiceChannel();
let clock: () => number = () => (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
/** Tests: drive the shared channel with a fake clock. */
export function setVoiceClock(fn: () => number): void {
  clock = fn;
}
// The announcer asks the same channel before it speaks.
voiceGate.blocks = (priority, retry) => voiceChannel.blocks(priority, clock(), retry);
voiceGate.claim = (priority, seconds, stop) => voiceChannel.claim(priority, clock(), seconds, stop);

/** Play a voice sample on the channel; returns false if it can't play (busy, missing, muted). */
function speak(id: string, priority: number, gain: number, duck: number): boolean {
  const now = clock();
  if (!voiceChannel.canStart(priority, now) || !samples.buffer(id)) return false;
  const voice = samples.play(id, { bus: 'ui', priority: 10 + priority, gain, variation: 0, limit: 1, cooldown: 0.5 });
  if (!voice) return false;
  voiceChannel.claim(priority, now, voice.duration, () => voice.stop());
  if (duck < 1) sfx.duck(voice.duration, duck);
  return true;
}

/** Say a line now, or within `wait` seconds when the channel frees up (after `delay`). */
export function sayLine(id: string, priority: number, gain: number, duck: number, delay = 0, wait = 3): void {
  const now = clock();
  if (delay <= 0 && speak(id, priority, gain, duck)) return;
  voiceChannel.enqueue(priority, now + Math.max(0, delay), now + Math.max(0, delay) + wait, () => speak(id, priority, gain, duck));
}

// ---------------------------------------------------------------- boss voices

/** The boss whose voice an enemy uses (mini-bosses borrow their parent's), or '' for none. */
export function bossVoiceId(def: Pick<EnemyDef, 'model' | 'boss' | 'miniboss'>): string {
  if (!def.boss && !def.miniboss) return '';
  const m = def.model;
  return m === 'king' || m === 'rex' || m === 'queen' || m === 'omega' ? m : '';
}

/**
 * The effects-bus sound for a boss moment: 'v:b:<boss>:<line>' for stage bosses,
 * 'v:m:<boss>:<line>' for mini-bosses (their parent's roar, pitched up, no lines).
 * Empty when the enemy has no voice.
 */
export function bossVoiceCue(def: Pick<EnemyDef, 'model' | 'boss' | 'miniboss'>, line: BossLine): string {
  const id = bossVoiceId(def);
  return id ? `v:${def.boss ? 'b' : 'm'}:${id}:${line}` : '';
}

function bossMoment(mini: boolean, boss: string, line: BossLine, pitch: number, pan: number, gain: number): void {
  const p = VOICE_PRIORITY.boss[line];
  if (line !== 'defeat') {
    // The boss's own roar (falls back to the generic roar cue).
    const roar = samples.play('roar_' + boss, { pan, distance: gain, priority: 4, gain: mini ? 0.5 : 0.7, pitch: mini ? 1.3 : pitch, cooldown: 0.6, limit: 1, variation: 0.04 });
    if (!roar) sfx.bossRoar();
  }
  if (mini) return;
  if (line === 'phase') samples.play('choir_stab', { bus: 'ui', priority: 13, gain: 0.7, variation: 0, limit: 1, cooldown: 1 });
  const delay = line === 'intro' ? voiceTuning.introDelay : line === 'phase' ? voiceTuning.phaseDelay : 0;
  sayLine(`boss_${boss}_${line}`, p, voiceTuning.bossGain, voiceTuning.bossDuck, delay, line === 'defeat' ? 4 : 3);
}

// ---------------------------------------------------------------- hero barks

/** The sample for a hero bark; skins keep the hero's voice, unknown heroes use the Rookie's. */
export function barkSample(heroId: string, kind: BarkKind): string {
  const voice = heroId === 'bulwark' || heroId === 'dash' || heroId === 'ace' ? heroId : 'rookie';
  return `bark_${voice}_${kind}`;
}

/** The local hero says a line (if hero voices are on). Barks queue briefly behind other speech. */
export function heroBark(heroId: string, kind: BarkKind, delay = 0, wait = 1.5): void {
  if (!voiceSettings.heroVoices) return;
  sayLine(barkSample(heroId, kind), VOICE_PRIORITY.bark[kind], voiceTuning.barkGain, voiceTuning.barkDuck, delay, wait);
}

/** When the hero talks. Occasional and charming, never spammy. */
export const barkTuning = {
  minGap: 12, // seconds between any two barks (low HP and revive: x0.4)
  startDelay: 1.4, // after the run starts (the announcer's GO! goes first)
  levelChance: 0.3,
  levelCooldown: 60,
  lowHp: 0.3, // life fraction that triggers the low-HP line (once per dip)
  lowHpRearm: 0.6, // life must climb back above this before it can trigger again
  lowHpCooldown: 25,
  multiKill: 12, // team kills inside the window (x1.5 per extra co-op hero)
  multiKillWindow: 0.8,
  bigKillChance: 0.7,
  bigKillCooldown: 40,
  bossDelay: 4.2, // after the boss appears (its own intro line goes first)
  evolveCooldown: 15,
  winDelay: 2.4, // after the stage clears (boss defeat line and STAGE CLEAR go first)
};

/** What the local hero's state looks like this frame (built by systems/voiceLines.ts). */
export interface BarkInput {
  now: number;
  fighting: boolean;
  hp01: number;
  dead: boolean;
  level: number;
  kills: number;
  evolved: number;
  boss: boolean;
  cleared: boolean;
  heroes: number;
}
export interface BarkCall {
  kind: BarkKind;
  delay: number;
  wait: number;
}

/** Pure bark scheduler: feed it the hero's state every frame, it says when to talk. */
export class BarkBrain {
  private started = false;
  private lastBark = -Infinity;
  private last = new Map<BarkKind, number>();
  private level = 0;
  private evolved = 0;
  private lowArmed = true;
  private dead = false;
  private boss = false;
  private cleared = false;
  private winStart = 0;
  private winKills = 0;

  reset(): void {
    this.started = false;
    this.lastBark = -Infinity;
    this.last.clear();
    this.lowArmed = true;
    this.dead = this.boss = this.cleared = false;
    this.level = this.evolved = this.winKills = 0;
    this.winStart = 0;
  }

  private ready(kind: BarkKind, now: number, cooldown: number, urgent = false): boolean {
    if (now - this.lastBark < barkTuning.minGap * (urgent ? 0.4 : 1)) return false;
    return now - (this.last.get(kind) ?? -Infinity) >= cooldown;
  }

  private fire(kind: BarkKind, now: number, delay: number, wait: number): BarkCall {
    this.last.set(kind, now);
    this.lastBark = now + delay;
    return { kind, delay, wait };
  }

  step(i: BarkInput, rand: () => number): BarkCall | null {
    const T = barkTuning;
    const now = i.now;
    let call: BarkCall | null = null;
    const want = (kind: BarkKind, cooldown: number, delay: number, wait: number, urgent = false) => {
      if (call && VOICE_PRIORITY.bark[call.kind] >= VOICE_PRIORITY.bark[kind]) return;
      if (this.ready(kind, now, cooldown, urgent)) call = { kind, delay, wait };
    };
    if (i.fighting && !this.started) {
      this.started = true;
      this.level = i.level;
      this.evolved = i.evolved;
      this.dead = i.dead;
      this.winStart = now;
      this.winKills = i.kills;
      if (!this.last.has('start')) want('start', 0, T.startDelay, 6);
    }
    if (!this.started) return null;
    if (i.level > this.level) {
      if (rand() < T.levelChance) want('level', T.levelCooldown, 0.3, 2);
      this.level = i.level;
    }
    if (i.evolved > this.evolved) want('evolve', T.evolveCooldown, 0.6, 4);
    this.evolved = i.evolved;
    if (this.dead && !i.dead && i.fighting) want('revive', 0, 0.2, 2, true);
    this.dead = i.dead;
    if (i.dead || i.hp01 > T.lowHpRearm) this.lowArmed = true;
    else if (this.lowArmed && i.fighting && i.hp01 > 0 && i.hp01 < T.lowHp) {
      this.lowArmed = false;
      want('lowhp', T.lowHpCooldown, 0, 1, true);
    }
    if (i.boss && !this.boss) want('boss', 0, T.bossDelay, 6);
    this.boss = i.boss;
    if (i.cleared && !this.cleared) want('win', 0, T.winDelay, 6);
    this.cleared = i.cleared;
    // Multi-kill: a burst of team kills inside a short window.
    if (now - this.winStart > T.multiKillWindow || i.kills < this.winKills) {
      this.winStart = now;
      this.winKills = i.kills;
    } else if (i.fighting && i.kills - this.winKills >= T.multiKill * (1 + 0.5 * Math.max(0, i.heroes - 1))) {
      this.winStart = now;
      this.winKills = i.kills;
      if (rand() < T.bigKillChance) want('bigkill', T.bigKillCooldown, 0, 1);
    }
    const c = call as BarkCall | null;
    return c ? this.fire(c.kind, now, c.delay, c.wait) : null;
  }
}

// ---------------------------------------------------------------- material impacts

export const MATERIAL_SAMPLES: Readonly<Record<Material, string>> = {
  metal: 'hit_metal',
  flesh: 'hit_flesh',
  slime: 'hit_slime',
  stone: 'hit_stone',
  shield: 'hit_shield',
};
const MATERIALS = Object.keys(MATERIAL_SAMPLES) as Material[];
/** Prebuilt cue names so hits never build strings. */
const HIT_CUE = {} as Record<Material, string>;
const CRIT_CUE = {} as Record<Material, string>;
const IMPACT = new Map<string, { material: Material; crit: boolean }>();
for (const m of MATERIALS) {
  HIT_CUE[m] = 'm:' + m;
  CRIT_CUE[m] = 'm:' + m + ':c';
  IMPACT.set(HIT_CUE[m], { material: m, crit: false });
  IMPACT.set(CRIT_CUE[m], { material: m, crit: true });
}

/** The effects-bus sound for a hit: shielded hits clang on the shield whatever is under it. */
export function impactCue(material: Material | undefined, crit: boolean, shielded = false): string {
  const m = shielded ? 'shield' : (material ?? 'flesh');
  return crit ? CRIT_CUE[m] : HIT_CUE[m];
}

let lastHit = -Infinity;
let lastCrit = -Infinity;
function playImpact(material: Material, crit: boolean, pitch: number, pan: number, gain: number): void {
  const now = clock();
  // Same thinning as the old shared 'hit' cue: one hit stream for all materials.
  if (crit) {
    if (now - lastCrit < 0.04) return;
    lastCrit = now;
  } else {
    if (now - lastHit < swarmGap(sfx.crowd)) return;
    lastHit = now;
  }
  const p = Math.max(0.8, Math.min(1.4, pitch || 1));
  const id = MATERIAL_SAMPLES[material];
  if (crit) {
    const bright = samples.play('crit', { pan, distance: gain, priority: 4, cooldown: 0.04 });
    samples.play(id, { pan, distance: gain, priority: 3, gain: voiceTuning.impactGain * voiceTuning.critLayer, pitch: voiceTuning.critPitch, cooldown: 0.03, limit: 2 });
    if (!bright) sfx.crit();
    return;
  }
  const v = samples.play(id, { pan, distance: gain, priority: 0, gain: voiceTuning.impactGain, pitch: p, cooldown: 0.03, limit: 2 });
  if (!v) {
    if (material === 'metal' || material === 'shield' || material === 'stone') sfx.hitMetal();
    else sfx.hit(p);
  }
}

/**
 * Effects-bus sounds this module owns ('v:...' voices, 'm:...' impacts).
 * Called by Vfx with the listener-relative pan and distance gain; `sfx.at` is already set
 * for synth fallbacks. Returns false for names it doesn't know.
 */
export function playVoiceCue(name: string, pitch: number, pan: number, gain: number): boolean {
  const hit = IMPACT.get(name);
  if (hit) {
    playImpact(hit.material, hit.crit, pitch, pan, gain);
    return true;
  }
  if (name.startsWith('v:')) {
    const [, kind, boss, line] = name.split(':');
    if ((kind === 'b' || kind === 'm') && boss && line in VOICE_PRIORITY.boss) {
      bossMoment(kind === 'm', boss, line as BossLine, pitch, pan, gain);
      return true;
    }
  }
  return false;
}

/** Every frame on every machine. */
export function updateVoices(): void {
  voiceChannel.update(clock());
}

/** Run start / quit to title: stop anyone talking. */
export function resetVoices(): void {
  voiceChannel.reset();
}
