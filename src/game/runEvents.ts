import type { Rng } from '../core/rng';
import { EVENT_IDS, STAGE_EVENTS, type ChallengeKind, type EventId } from '../data/stageEvents';
import type { Tag } from '../data/tags';
import { WEAPONS } from '../data/weapons';

/**
 * Run spice, all host-side (clients mirror the HUD text from snapshots):
 * - one stage event per stage at a random moment (meteor shower, gold rush,
 *   fog bank, elite parade, stampede)
 * - one side challenge per stage with a gold and score reward
 * - combo power-ups: FRENZY at 100 combo, MAGNET BURST at 250, OVERDRIVE at
 *   500 and every 250 after.
 */
export interface EventHost {
  readonly rng: Rng;
  readonly stage: number;
  readonly dmgMul: number;
  /** Living hero positions. */
  targets(): { x: number; z: number }[];
  /** Team-owned weapon ids (for tag challenges). */
  ownedWeapons(): string[];
  meteor(x: number, z: number, r: number, delay: number, dmg: number): void;
  spawnElite(): void;
  spawnRing(): void;
  vacuum(): void;
  banner(title: string, sub: string, seconds: number): void;
  toast(msg: string, seconds?: number): void;
  sound(name: string): void;
  reward(goldEach: number, score: number): void;
}

export interface ChallengeState {
  kind: ChallengeKind;
  text: string;
  cur: number;
  max: number;
  done: boolean;
  tag?: Tag;
}

/** Statuses and combo blasts count toward their element. */
const SOURCE_TAG: Record<string, Tag> = { burn: 'fire', shatter: 'frost', overload: 'shock', zap: 'shock', charge: 'projectile', barrel: 'explosive' };

export class RunEvents {
  event: { id: EventId; t: number } | null = null;
  challenge: ChallengeState | null = null;
  /** Combo power-ups: seconds left. */
  frenzyT = 0;
  overdriveT = 0;
  private eventAt = 0;
  private eventDone = false;
  private meteorT = 0;
  private paradeLeft = 0;
  private paradeT = 0;
  private challengeAt = 20;
  private lastBuffCombo = 0;
  private noHitT = 0;
  /** A second, early event this stage (EVENTFUL route), seconds; -1 = none. */
  private extraAt = -1;
  /** Route knobs for the next stage (src/game/systems/runMods.ts), set before startStage(). */
  mods = { events: 1, rewardMul: 1, challengeAt: 18 };

  constructor(private host: EventHost) {}

  /** New stage: schedule an event, clear the challenge. */
  startStage(duration: number): void {
    const r = this.host.rng;
    this.event = null;
    this.eventDone = false;
    this.eventAt = r.range(duration * 0.3, duration * 0.72);
    this.extraAt = this.mods.events > 1 ? r.range(duration * 0.08, duration * 0.18) : -1;
    this.challenge = null;
    this.challengeAt = this.mods.challengeAt;
    this.noHitT = 0;
  }

  reset(): void {
    this.event = null;
    this.challenge = null;
    this.frenzyT = this.overdriveT = 0;
    this.lastBuffCombo = 0;
  }

  /** Fire-rate and damage multipliers from combo power-ups. */
  get fireRateMul(): number {
    return this.frenzyT > 0 ? 0.6 : 1;
  }
  get damageMul(): number {
    return this.overdriveT > 0 ? 2 : 1;
  }

  get goldRush(): boolean {
    return this.event?.id === 'goldrush';
  }

  get fog(): boolean {
    return this.event?.id === 'fog';
  }

  /** Every fight step (not during the boss). `time` = stage seconds elapsed. */
  update(dt: number, time: number, bossUp: boolean): void {
    this.frenzyT = Math.max(0, this.frenzyT - dt);
    this.overdriveT = Math.max(0, this.overdriveT - dt);
    if (!bossUp && !this.eventDone && time >= this.eventAt && !this.event) this.startEvent();
    if (!bossUp && this.extraAt >= 0 && time >= this.extraAt && !this.event) {
      // The extra event leaves the main one scheduled.
      const done = this.eventDone;
      this.extraAt = -1;
      this.startEvent();
      this.eventDone = done;
    }
    if (this.event) this.tickEvent(dt);
    if (!bossUp && !this.challenge && time >= this.challengeAt) this.pickChallenge();
    const c = this.challenge;
    if (c && !c.done && c.kind === 'nohit') {
      this.noHitT += dt;
      this.progress(Math.floor(this.noHitT));
    }
  }

  // ---------------------------------------------------------------- events

  /** Test links: start a specific event now. */
  forceEvent(id: EventId): void {
    this.eventAt = 0;
    this.eventDone = false;
    this.startEvent(id);
  }

  private startEvent(force?: EventId): void {
    this.eventDone = true;
    const id = force ?? this.host.rng.pick(EVENT_IDS);
    const def = STAGE_EVENTS[id];
    this.event = { id, t: def.seconds };
    this.host.banner(def.name, def.sub, 2);
    this.host.sound(def.good ? 'jingle' : 'ominous');
    this.meteorT = 1.2;
    if (id === 'parade') {
      this.paradeLeft = 3;
      this.paradeT = 0;
    }
    if (id === 'stampede') {
      this.host.spawnRing();
      this.paradeT = 3.5;
      this.paradeLeft = 1;
    }
  }

  private tickEvent(dt: number): void {
    const ev = this.event!;
    ev.t -= dt;
    const h = this.host;
    if (ev.id === 'meteors' && (this.meteorT -= dt) <= 0) {
      this.meteorT = 0.55;
      const ts = h.targets();
      if (ts.length) {
        const p = h.rng.pick(ts);
        const a = h.rng.next() * Math.PI * 2;
        const d = h.rng.range(2, 9);
        h.meteor(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 2.4, 1.3, 18 * h.dmgMul);
      }
    }
    if ((ev.id === 'parade' || ev.id === 'stampede') && this.paradeLeft > 0 && (this.paradeT -= dt) <= 0) {
      this.paradeLeft--;
      this.paradeT = 2.5;
      if (ev.id === 'parade') h.spawnElite();
      else h.spawnRing();
    }
    if (ev.t <= 0) {
      if (ev.id === 'goldrush' || ev.id === 'fog') h.toast(ev.id === 'fog' ? 'THE FOG LIFTS' : 'GOLD RUSH OVER', 2);
      this.event = null;
    }
  }

  // ---------------------------------------------------------------- challenges

  private pickChallenge(): void {
    const h = this.host;
    const s = h.stage;
    const tags = new Set<Tag>();
    for (const id of h.ownedWeapons()) for (const t of WEAPONS[id]?.tags ?? []) if (t !== 'projectile') tags.add(t);
    const kinds: ChallengeKind[] = ['nohit', 'combo', 'chests', 'elites'];
    if (tags.size) kinds.push('tagkills', 'tagkills');
    const kind = h.rng.pick(kinds);
    let c: ChallengeState;
    switch (kind) {
      case 'nohit':
        c = { kind, text: 'TAKE NO HITS FOR 30 S', cur: 0, max: 30, done: false };
        break;
      case 'combo': {
        const n = 60 + 20 * s;
        c = { kind, text: `REACH A ${n} COMBO`, cur: 0, max: n, done: false };
        break;
      }
      case 'chests':
        c = { kind, text: 'OPEN 3 TREASURE CHESTS', cur: 0, max: 3, done: false };
        break;
      case 'elites':
        c = { kind, text: 'DEFEAT 2 ELITES', cur: 0, max: 2, done: false };
        break;
      default: {
        const tag = h.rng.pick([...tags]);
        const n = 40 + 20 * s;
        c = { kind: 'tagkills', text: `${n} KILLS WITH ${tag.toUpperCase()}`, cur: 0, max: n, done: false, tag };
      }
    }
    this.challenge = c;
    this.host.toast(`CHALLENGE: ${c.text}`, 3);
  }

  private progress(v: number): void {
    const c = this.challenge;
    if (!c || c.done) return;
    c.cur = Math.min(c.max, v);
    if (c.cur < c.max) return;
    c.done = true;
    const gold = Math.round((5 + 2 * this.host.stage) * this.mods.rewardMul);
    this.host.reward(gold, Math.round(1500 * this.host.stage * this.mods.rewardMul));
    this.host.banner('CHALLENGE COMPLETE!', `+${gold} GOLD EACH`, 2);
    this.host.sound('jingle');
  }

  // ---------------------------------------------------------------- hooks from Game

  onKill(source: string, combo: number): void {
    const c = this.challenge;
    if (c?.kind === 'tagkills' && c.tag) {
      const tags = WEAPONS[source]?.tags ?? (SOURCE_TAG[source] ? [SOURCE_TAG[source]] : []);
      if (tags.includes(c.tag)) this.progress(c.cur + 1);
    }
    if (c?.kind === 'combo') this.progress(Math.max(c.cur, combo));
    this.comboBuffs(combo);
  }

  onElite(): void {
    if (this.challenge?.kind === 'elites') this.progress(this.challenge.cur + 1);
  }

  onChest(): void {
    if (this.challenge?.kind === 'chests') this.progress(this.challenge.cur + 1);
  }

  onHurt(): void {
    this.noHitT = 0;
    if (this.challenge?.kind === 'nohit' && !this.challenge.done) this.challenge.cur = 0;
  }

  /** The combo broke: power-ups are earned again from the next thresholds. */
  onComboBreak(): void {
    this.lastBuffCombo = 0;
  }

  private comboBuffs(combo: number): void {
    const h = this.host;
    if (combo >= 100 && this.lastBuffCombo < 100) {
      this.frenzyT = 6;
      h.banner('FRENZY!', 'WEAPONS FIRE FASTER', 1.4);
      h.sound('comboUp');
    }
    if (combo >= 250 && this.lastBuffCombo < 250) {
      h.vacuum();
      h.banner('MAGNET BURST!', 'ALL GEMS INCOMING', 1.4);
      h.sound('comboUp');
    }
    // 500, 750, 1000...
    const step = (n: number) => (n < 500 ? 0 : Math.floor((n - 500) / 250) + 1);
    if (step(combo) > step(this.lastBuffCombo)) {
      this.overdriveT = 8;
      h.banner('OVERDRIVE!', 'DOUBLE DAMAGE', 1.4);
      h.sound('evolve');
    }
    this.lastBuffCombo = Math.max(this.lastBuffCombo, combo);
  }
}
