/**
 * End-of-run recap: a per-stage timeline recorded while you play (level,
 * damage, gold, kills, time, boss kill time), shown as a small pixel chart on
 * the game-over screen. Pure: the onboarding layer feeds it a sample of the
 * run every few steps (src/game/onboarding.ts).
 */
export interface RecapSample {
  stage: number;
  level: number;
  kills: number;
  /** Run time (s). */
  time: number;
  /** Total damage this hero has dealt this run. */
  damage: number;
  /** This hero's gold right now. */
  gold: number;
  /** Starting-shop gold is free and wiped: don't count it. */
  preShop: boolean;
  /** A boss of this stage is alive. */
  boss: boolean;
}

export interface StageRecap {
  stage: number;
  /** Team level when the stage ended (or now). */
  level: number;
  kills: number;
  damage: number;
  gold: number;
  /** Seconds spent on the stage. */
  time: number;
  /** Seconds from the boss showing up to it dying (-1 = not beaten). */
  bossTime: number;
}

export class RunRecorder {
  stages: StageRecap[] = [];
  private start = { kills: 0, damage: 0, time: 0 };
  private lastGold = -1;
  private bossAt = -1;
  private cur: StageRecap | null = null;

  reset(): void {
    this.stages = [];
    this.cur = null;
    this.lastGold = -1;
    this.bossAt = -1;
  }

  sample(s: RecapSample): void {
    if (!this.cur || s.stage !== this.cur.stage) this.open(s);
    const c = this.cur!;
    c.level = s.level;
    c.kills = s.kills - this.start.kills;
    c.damage = s.damage - this.start.damage;
    c.time = s.time - this.start.time;
    // Gold earned: only rises count (spending isn't income), and never the free starting gold.
    if (this.lastGold >= 0 && s.gold > this.lastGold && !s.preShop) c.gold += s.gold - this.lastGold;
    this.lastGold = s.preShop ? 0 : s.gold;
    if (s.boss && this.bossAt < 0) this.bossAt = s.time;
    else if (!s.boss && this.bossAt >= 0 && c.bossTime < 0) c.bossTime = s.time - this.bossAt;
  }

  private open(s: RecapSample): void {
    // Endless waves and portals both bump the stage number; a boss still up then counts as beaten.
    if (this.cur && this.bossAt >= 0 && this.cur.bossTime < 0) this.cur.bossTime = s.time - this.bossAt;
    this.start = { kills: s.kills, damage: s.damage, time: s.time };
    this.bossAt = -1;
    this.cur = { stage: s.stage, level: s.level, kills: 0, damage: 0, gold: 0, time: 0, bossTime: -1 };
    this.stages.push(this.cur);
  }
}

/** Damage per second over a stage (0 for an empty one). */
export function stageDps(s: StageRecap): number {
  return s.time > 1 ? s.damage / s.time : 0;
}
