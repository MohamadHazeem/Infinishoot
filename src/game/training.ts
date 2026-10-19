import { ENEMIES } from '../data/enemies';
import { WEAPONS } from '../data/weapons';
import { Team } from './bullets';
import type { Enemy } from './enemies';
import type { Game } from './game';
import { binds, keyLabel, type Action } from '../core/keybinds';
import { keysOf } from './tips';

/** The first key bound to an action ("W"). */
const key1 = (a: Action) => keyLabel(binds[a][0] || binds[a][1]);

/**
 * The TRAINING field: a short guided run on the real game (no forked loop).
 * It starts an ordinary solo run, then holds the director (no spawns, no
 * stage clock), keeps the hero safe and walks through one step at a time;
 * each step completes when you do the thing. Steps spawn harmless target
 * bots and slow pink shots with the normal enemy/bullet systems.
 */
export const trainingTuning = {
  seed: 424242,
  moveDist: 8, // metres walked for the MOVE step
  targets: 3, // target bots for the FIRE step
  targetDist: 7,
  shotEvery: 1.7, // seconds between training shots (dash and parry steps)
  shotSpeed: 6.5,
  shotFrom: 9, // metres away the shot starts
  bombCluster: 6, // bots in the SPECIAL step's cluster
  skipAfter: 12, // seconds before SKIP STEP shows
};

export interface TrainingStep {
  id: string;
  title: string;
  text: () => string;
  /** Set up the step (spawns, charges). */
  start?(t: Training): void;
  /** Per sim step while it runs; true = done. */
  tick(t: Training, dt: number): boolean;
}

const clickName = (g: Game, slot: 'primary' | 'secondary') => WEAPONS[g.hero.loadoutPick[slot]]?.name ?? (slot === 'primary' ? 'Buster' : 'Charge Shot');

/** Harmless bots: they barely move and never hurt. */
function bot(t: Training, x: number, z: number, hpMul = 1): Enemy {
  const g = t.game;
  const e = g.enemies.spawn(ENEMIES.swarmer, x, z, { hpMul, speedMul: 0.02, dmgMul: 0, instant: true });
  t.bots.push(e);
  return e;
}

/** Bots ahead of the hero: up the screen (-z), where the prompt panel doesn't cover them. */
function botsAhead(t: Training, n: number, dist: number, hpMul = 1, spread = 1.1): void {
  const p = t.game.hero.player;
  const base = -Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const a = base + (i - (n - 1) / 2) * (spread / Math.max(1, n - 1 || 1));
    bot(t, p.x + Math.cos(a) * dist, p.z + Math.sin(a) * dist, hpMul);
  }
}

/** A slow pink shot flying straight at the hero. */
function shoot(t: Training): void {
  const g = t.game;
  const p = g.hero.player;
  const T = trainingTuning;
  const a = t.shotAngle;
  t.shotAngle += 1.9;
  const x = p.x + Math.cos(a) * T.shotFrom;
  const z = p.z + Math.sin(a) * T.shotFrom;
  g.bullets.spawn({ x, z, dirX: -Math.cos(a), dirZ: -Math.sin(a), speed: T.shotSpeed, life: 3, radius: 0.3, damage: 1, knockback: 2, team: Team.Enemy, color: '#ff3df0', width: 0.6, length: 0.6 });
  g.vfx.ring(x, z, 0.4, 1.4, '#ff3df0', 0.25);
}

const alive = (t: Training) => t.bots.filter((e) => e.active).length;

export const TRAINING_STEPS: TrainingStep[] = [
  {
    id: 'move',
    title: 'MOVE',
    text: () => `Walk around with ${key1('up')} ${key1('left')} ${key1('down')} ${key1('right')} or the left stick. You always face where you aim.`,
    tick: (t) => t.walked >= trainingTuning.moveDist,
  },
  {
    id: 'fire',
    title: 'AIM AND FIRE',
    text: () => `Aim with the mouse (or right stick) and hold LEFT CLICK to fire your ${t0().name1}. Pop the ${trainingTuning.targets} target bots.`,
    start: (t) => botsAhead(t, trainingTuning.targets, trainingTuning.targetDist, 1, 1.2),
    tick: (t) => alive(t) === 0,
  },
  {
    id: 'right',
    title: 'RIGHT CLICK',
    text: () => `Hold RIGHT CLICK (or X) for your ${t0().name2}. Its hits EXPOSE enemies: +30% damage from everyone for 4 s. Expose the big bot.`,
    start: (t) => botsAhead(t, 1, 6, 12),
    tick: (t) => t.bots.some((e) => e.active && e.exposeT > 0) || (alive(t) === 0 && t.stepT > 0.5),
  },
  {
    id: 'dash',
    title: 'DASH',
    text: () => `Press ${keysOf('dash')} to dash: you can't be hit mid-dash. Dash THROUGH a pink shot just before it hits you.`,
    tick: (t, dt) => {
      t.everyShot(dt);
      return t.dodged;
    },
  },
  {
    id: 'parry',
    title: 'PARRY',
    text: () => `Press ${keysOf('parry')} (or B) right as a pink shot reaches you to PARRY it back at the shooter.`,
    tick: (t, dt) => {
      t.everyShot(dt);
      return t.game.hero.skill.parried > 0;
    },
  },
  {
    id: 'special',
    title: 'SPECIAL',
    text: () => `Your special is ready: press ${keysOf('bomb')} (or RB) to set off your ${t0().special} next to the bots. It recharges over time.`,
    start: (t) => {
      botsAhead(t, trainingTuning.bombCluster, 4, 1, 2.4);
      t.game.hero.bombCharge = 1;
    },
    tick: (t) => t.game.hero.bombCharge < 1,
  },
  {
    id: 'ult',
    title: 'ULTIMATE',
    text: () => `Perfect dodges, parries and kills charge your hero's ULTIMATE. It's full: press ${keysOf('ult')} (or R3).`,
    start: (t) => {
      botsAhead(t, 4, 5, 2, 2);
      t.game.hero.skill.ult = 1;
    },
    tick: (t) => t.game.hero.skill.ultT > 0 || t.game.hero.skill.ult < 1,
  },
  {
    id: 'levelup',
    title: 'LEVEL UP',
    text: () => 'Kills drop XP gems that fly to you. A full XP bar is a level-up: pick ONE of the 3 cards. The ribbon says what it upgrades.',
    start: (t) => t.game.gainXp(Math.max(1, t.game.xpNext - t.game.xp)),
    tick: (t) => {
      const g = t.game;
      if (g.mode === 'levelup') t.sawLevelUp = true;
      return t.sawLevelUp && g.mode !== 'levelup' && !g.hero.needsPick;
    },
  },
  {
    id: 'chest',
    title: 'TREASURE CHEST',
    text: () => 'Chests pop up on the map every 30 s (the arrow at the screen edge points to them). Walk into this one for a free item.',
    start: (t) => {
      const g = t.game;
      const p = g.hero.player;
      for (const d of [6, 4, 8]) {
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const x = p.x + Math.cos(a) * d;
          const z = p.z + Math.sin(a) * d;
          if (g.walls.hitCircle(x, z, 1.2)) continue;
          g.chests.add(x, z, a);
          g.vfx.ring(x, z, 1, 6, '#ffcd75', 0.6);
          return;
        }
      }
      g.chests.add(p.x + 3, p.z, 0);
    },
    tick: (t) => t.game.chests.closedCount === 0,
  },
];

// Names for the step texts, read from the live game when a step starts.
let names = { name1: 'Buster', name2: 'Charge Shot', special: 'Bomb' };
const t0 = () => names;

export class Training {
  step = 0;
  /** Seconds in the current step. */
  stepT = 0;
  walked = 0;
  bots: Enemy[] = [];
  shotT = 0;
  shotAngle = 0.4;
  dodged = false;
  sawLevelUp = false;
  done = false;
  private lastX = NaN;
  private lastZ = NaN;
  private lastDashes = 0;

  constructor(readonly game: Game, first = 0) {
    this.step = Math.max(0, Math.min(TRAINING_STEPS.length - 1, first));
  }

  get current(): TrainingStep {
    return TRAINING_STEPS[this.step];
  }

  get total(): number {
    return TRAINING_STEPS.length;
  }

  /** Begin the current step. */
  begin(): void {
    const g = this.game;
    names = { name1: clickName(g, 'primary'), name2: clickName(g, 'secondary'), special: g.hero.specialDef.name };
    this.stepT = 0;
    this.shotT = 0.6;
    this.dodged = false;
    this.sawLevelUp = false;
    this.lastDashes = g.hero.dashes;
    g.hero.skill.parried = 0;
    g.hero.skill.dashPerfect = false;
    // Leftover bots from the last step go away.
    for (const e of this.bots) if (e.active) g.enemies.kill(e);
    this.bots = [];
    this.current.start?.(this);
  }

  /** One sim step (solo, fighting or on a level-up menu). Returns true when the step just finished. */
  tick(dt: number): boolean {
    if (this.done) return false;
    const g = this.game;
    const h = g.hero;
    const p = h.player;
    if (!Number.isNaN(this.lastX)) this.walked += Math.min(1, Math.hypot(p.x - this.lastX, p.z - this.lastZ));
    this.lastX = p.x;
    this.lastZ = p.z;
    // A dash with a pink shot close by counts, perfect or not (the game's perfect-dash check is stricter).
    if (h.dashes > this.lastDashes) {
      this.lastDashes = h.dashes;
      if (h.skill.dashPerfect || this.shotNear(3)) this.dodged = true;
    }
    if (h.skill.dashPerfect) this.dodged = true; // the perfect-dash scan can land a moment after the dash starts
    this.stepT += dt;
    if (!this.current.tick(this, dt)) return false;
    return true;
  }

  /** Move to the next step; false when training is over. */
  next(): boolean {
    if (this.step + 1 >= TRAINING_STEPS.length) {
      this.done = true;
      for (const e of this.bots) if (e.active) this.game.enemies.kill(e);
      this.bots = [];
      return false;
    }
    this.step++;
    this.begin();
    return true;
  }

  /** Dash and parry steps: a slow shot every few seconds. */
  everyShot(dt: number): void {
    this.shotT -= dt;
    if (this.shotT > 0) return;
    this.shotT = trainingTuning.shotEvery;
    shoot(this);
  }

  private shotNear(r: number): boolean {
    const b = this.game.bullets;
    const p = this.game.hero.player;
    for (let i = 0; i < b.count; i++) if (b.team[i] === Team.Enemy && (b.x[i] - p.x) ** 2 + (b.z[i] - p.z) ** 2 < r * r) return true;
    return false;
  }
}
