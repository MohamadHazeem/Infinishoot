import { Rng } from '../core/rng';

/**
 * Optional stage objectives (pure logic, no rendering). Every stage rolls one
 * from its seed, so every machine in a co-op game agrees on it without a message:
 *   totems    destroy 3 totems (shootable, solid)
 *   beacon    stand by the beacon until it has charged for 30 s; enemies next to it drain it
 *   shards    collect 5 relic shards scattered over the field
 *   envkills  kill enemies with the arena (lava, thorns, quicksand, ice, pillars, barrels)
 * Completing one pays gold to everyone, score, and a treasure chest per hero.
 * Progress runs on the host (src/game/systems/arena.ts) and reaches clients in the snapshot.
 */
export type ObjectiveKind = 'totems' | 'beacon' | 'shards' | 'envkills';
export const OBJECTIVE_KINDS: ObjectiveKind[] = ['totems', 'beacon', 'shards', 'envkills'];
export type ObjectiveState = 'active' | 'done' | 'failed';

export const objectiveTuning = {
  totems: 3,
  totemHp: 260, // x (1 + totemHpPerStage x (stage - 1))
  totemHpPerStage: 0.7,
  beaconTime: 30, // seconds of charging
  beaconRadius: 4.5,
  beaconHp: 100,
  beaconDrain: 1, // beacon life per second for each enemy inside its ring (up to beaconDrainMax enemies)
  beaconDrainMax: 4,
  beaconRegen: 1, // while nobody is attacking it
  shards: 5,
  envKills: 15, // + envKillsPerStage x (stage - 1), capped at 30
  envKillsPerStage: 3,
  goldBase: 8, // gold per hero: goldBase + goldPerStage x stage
  goldPerStage: 3,
  scoreBase: 800, // x stage
};

const STATES: ObjectiveState[] = ['active', 'done', 'failed'];

/** Which objective a stage offers (seeded: same seed and stage, same objective). */
export function pickObjective(seed: number, stage: number): ObjectiveKind {
  const rng = new Rng((seed ^ Math.imul(stage + 7, 0x2c1b3c6d) ^ 0x0b1ec7) >>> 0);
  rng.next();
  return rng.pick(OBJECTIVE_KINDS);
}

export function objectiveMax(kind: ObjectiveKind, stage: number): number {
  const T = objectiveTuning;
  switch (kind) {
    case 'totems':
      return T.totems;
    case 'beacon':
      return T.beaconTime;
    case 'shards':
      return T.shards;
    case 'envkills':
      return Math.min(30, T.envKills + T.envKillsPerStage * (stage - 1));
  }
}

export function totemHp(stage: number): number {
  return Math.round(objectiveTuning.totemHp * (1 + objectiveTuning.totemHpPerStage * (stage - 1)));
}

export function objectiveGold(stage: number): number {
  return objectiveTuning.goldBase + objectiveTuning.goldPerStage * stage;
}

export class Objective {
  cur = 0;
  state: ObjectiveState = 'active';
  /** Beacon only: its life (0..beaconHp) and whether a hero is charging it right now. */
  hp = objectiveTuning.beaconHp;
  charging = false;
  /** Beacon only: enemies are in its ring right now. */
  attacked = false;
  readonly max: number;

  constructor(
    readonly kind: ObjectiveKind,
    readonly stage: number,
  ) {
    this.max = objectiveMax(kind, stage);
  }

  get active(): boolean {
    return this.state === 'active';
  }

  /** Add progress; returns true when this call completed the objective. */
  progress(n = 1): boolean {
    if (!this.active) return false;
    this.cur = Math.min(this.max, this.cur + n);
    if (this.cur >= this.max) {
      this.state = 'done';
      return true;
    }
    return false;
  }

  /**
   * Beacon step: heroes inside charge it, enemies inside drain it.
   * Returns 'done' or 'failed' on the step that settles it, else null.
   */
  beaconStep(dt: number, heroesInside: number, enemiesInside: number): 'done' | 'failed' | null {
    if (!this.active || this.kind !== 'beacon') return null;
    const T = objectiveTuning;
    this.charging = heroesInside > 0;
    this.attacked = enemiesInside > 0;
    if (enemiesInside > 0) this.hp -= T.beaconDrain * Math.min(enemiesInside, T.beaconDrainMax) * dt;
    else this.hp = Math.min(T.beaconHp, this.hp + T.beaconRegen * dt);
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'failed';
      this.charging = false;
      return 'failed';
    }
    if (this.charging && this.progress(dt)) return 'done';
    return null;
  }

  /** HUD line: what to do. */
  get title(): string {
    switch (this.kind) {
      case 'totems':
        return 'DESTROY THE TOTEMS';
      case 'beacon':
        return 'CHARGE THE BEACON';
      case 'shards':
        return 'COLLECT RELIC SHARDS';
      case 'envkills':
        return 'ENVIRONMENTAL KILLS';
    }
  }

  /** HUD progress text: "1/3", "12 s", ... */
  get count(): string {
    if (this.kind === 'beacon') return `${Math.floor(this.cur)}/${this.max} S`;
    return `${Math.floor(this.cur)}/${this.max}`;
  }

  get hint(): string {
    switch (this.kind) {
      case 'totems':
        return 'Shoot them down';
      case 'beacon':
        return this.charging ? 'Keep enemies off it!' : 'Stand in its ring';
      case 'shards':
        return 'Walk over them';
      case 'envkills':
        return 'Lava, thorns, barrels, pillars...';
    }
  }

  net(): number[] {
    return [Math.round(this.cur * 10) / 10, STATES.indexOf(this.state), Math.round(this.hp), this.charging ? 1 : 0, this.attacked ? 1 : 0];
  }

  setNet(a: readonly number[]): void {
    this.cur = Number(a[0]) || 0;
    this.state = STATES[Number(a[1])] ?? 'active';
    this.hp = Number(a[2]) || 0;
    this.charging = a[3] === 1;
    this.attacked = a[4] === 1;
  }
}
