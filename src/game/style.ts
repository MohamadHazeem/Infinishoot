import type { Enemy } from './enemies';

/**
 * Skill layer, pure state: the style meter (D, C, B, A, S, SS) and each
 * hero's perfect-dash, parry and ultimate timers. The Game side lives in
 * src/game/systems/skill.ts; the HUD in src/ui/styleMeter.ts.
 *
 * Style rises with varied, skilful play: kills with different weapons,
 * perfect dashes, parries, multi-kills, no-hit streaks and click-weapon kills
 * on the music's beat. Repeating one weapon earns less and less, and plain
 * kills are capped per second so a big horde alone holds about C. Points
 * always decay (faster at higher ranks) and a hit drops two ranks.
 * The rank multiplies kill score and, slightly, XP.
 */
export const STYLE_RANKS = ['D', 'C', 'B', 'A', 'S', 'SS'] as const;
export type StyleRank = (typeof STYLE_RANKS)[number];

export const styleTuning = {
  /** Points needed for each rank (D, C, B, A, S, SS). */
  thresholds: [0, 80, 200, 380, 620, 920],
  cap: 1150,
  /** Points lost per second at each rank (always running: holding a rank takes a steady flow of style). */
  decay: [3, 8, 14, 22, 32, 45],
  /** A hit drops this many ranks (to the floor of the lower rank). */
  hitDrop: 2,
  kill: 2.5,
  /** Plain kill points are capped at this many per second, so a big horde alone can't carry the rank (about C). */
  killPerSec: 6,
  /** Kill points shrink with each recent kill by the same weapon (x(1 - this x repeats), floor `repeatFloor`). */
  repeatStep: 0.12,
  repeatFloor: 0.15,
  /** How many recent kill sources are remembered for the repeat penalty. */
  memory: 10,
  /** A weapon that hasn't scored a kill for `freshAfter` s gets a bonus on its next kill. */
  freshAfter: 5,
  freshKill: 6,
  /** Kills closer together than this form a multi-kill, paid once when the burst ends. */
  multiWindow: 0.25,
  multiPer: 1,
  multiMax: 10,
  multiMin: 6,
  /** Click-weapon kills right on the music's beat (at most one per `beatGap` s). */
  beatKill: 7,
  beatGap: 0.3,
  eliteKill: 45,
  bossKill: 220,
  perfectDash: 75,
  parry: 90,
  parryExtra: 15,
  /** Every this many seconds without getting hit, a growing bonus. */
  noHitEvery: 15,
  noHitBonus: 25,
  ult: 40,
  scoreMul: [1, 1.1, 1.25, 1.5, 1.8, 2.2],
  xpMul: [1, 1.02, 1.04, 1.07, 1.1, 1.15],
};

/** Rank index (0 = D .. 5 = SS) for a point total. */
export function rankOf(points: number): number {
  const t = styleTuning.thresholds;
  let r = 0;
  for (let i = 1; i < t.length; i++) if (points >= t[i]) r = i;
  return r;
}

/** 0..1 progress from this rank's floor to the next rank (1 at SS). */
export function rankProgress(points: number): number {
  const t = styleTuning.thresholds;
  const r = rankOf(points);
  if (r >= t.length - 1) return Math.min(1, (points - t[r]) / Math.max(1, styleTuning.cap - t[r]));
  return (points - t[r]) / (t[r + 1] - t[r]);
}

export function rankName(r: number): StyleRank {
  return STYLE_RANKS[Math.max(0, Math.min(STYLE_RANKS.length - 1, Math.round(r)))];
}

/** One line of the style feed ("PERFECT DODGE +75"). */
export interface StyleNote {
  text: string;
  pts: number;
}

export interface StyleKill {
  /** Damage source id (weapon, special, 'ult', 'parry'...). */
  source: string;
  elite?: boolean;
  boss?: boolean;
  /** Landed on the music's beat with a click weapon. */
  beat?: boolean;
}

export class StyleMeter {
  points = 0;
  /** Best rank index this run. */
  best = 0;
  /** Seconds since the last gain. */
  sinceGain = 99;
  /** Seconds since the last hit (no-hit streak). */
  noHitT = 0;
  private noHitPaid = 0;
  /** Recent kill sources, newest last (repeat penalty). */
  private recent: string[] = [];
  /** Run time of each source's last kill (fresh bonus). */
  private lastKill = new Map<string, number>();
  private clock = 0;
  private multiT = 0;
  private multiN = 0;
  /** Plain kill points still allowed this second (refills at killPerSec). */
  private killPool = 0;
  private beatAt = -9;
  /** Newest notes for the HUD feed; `seq` counts every note ever added. */
  readonly notes: StyleNote[] = [];
  seq = 0;

  get rank(): number {
    return rankOf(this.points);
  }
  get scoreMul(): number {
    return styleTuning.scoreMul[this.rank];
  }
  get xpMul(): number {
    return styleTuning.xpMul[this.rank];
  }

  reset(): void {
    this.points = this.best = this.noHitT = this.noHitPaid = this.clock = this.multiT = this.multiN = this.killPool = 0;
    this.beatAt = -9;
    this.sinceGain = 99;
    this.recent.length = 0;
    this.lastKill.clear();
    this.notes.length = 0;
    this.seq = 0;
  }

  /** Add points; a `note` shows in the HUD feed. */
  add(pts: number, note?: string): void {
    if (pts <= 0) return;
    this.points = Math.min(styleTuning.cap, this.points + pts);
    this.sinceGain = 0;
    this.best = Math.max(this.best, this.rank);
    if (note) this.note(note, pts);
  }

  note(text: string, pts: number): void {
    this.notes.push({ text, pts: Math.round(pts) });
    if (this.notes.length > 4) this.notes.shift();
    this.seq++;
  }

  /** A kill credited to this hero. Returns the points it earned. */
  kill(k: StyleKill): number {
    const T = styleTuning;
    let repeats = 0;
    for (const s of this.recent) if (s === k.source) repeats++;
    let pts = Math.min(this.killPool, T.kill * Math.max(T.repeatFloor, 1 - T.repeatStep * repeats));
    this.killPool -= pts;
    const last = this.lastKill.get(k.source);
    if (last === undefined || this.clock - last >= T.freshAfter) {
      // Only weapons that actually switch in count: the run's very first kills don't.
      if (last !== undefined || this.lastKill.size > 0) {
        pts += T.freshKill;
        this.note('MIX-UP', T.freshKill);
      }
    }
    this.lastKill.set(k.source, this.clock);
    this.recent.push(k.source);
    if (this.recent.length > T.memory) this.recent.shift();
    // Multi-kills: counted while kills keep coming, paid when the burst ends (tick).
    this.multiN = this.multiT > 0 ? this.multiN + 1 : 1;
    this.multiT = T.multiWindow;
    if (k.beat && this.clock - this.beatAt >= T.beatGap) {
      this.beatAt = this.clock;
      pts += T.beatKill;
      this.note('ON BEAT', T.beatKill);
    }
    if (k.boss) {
      pts += T.bossKill;
      this.note('BOSS DOWN', T.bossKill);
    } else if (k.elite) {
      pts += T.eliteKill;
      this.note('ELITE DOWN', T.eliteKill);
    }
    this.add(pts);
    return pts;
  }

  /** Got hit: lose `hitDrop` ranks and the no-hit streak. Returns the rank before. */
  hit(): number {
    const before = this.rank;
    const to = Math.max(0, before - styleTuning.hitDrop);
    this.points = Math.min(this.points, styleTuning.thresholds[to]);
    this.noHitT = this.noHitPaid = 0;
    return before;
  }

  /** Advance timers; `fighting` = the stage is on (no decay or streaks in menus and between stages). */
  tick(dt: number, fighting: boolean): void {
    if (!fighting) return;
    const T = styleTuning;
    this.clock += dt;
    this.sinceGain += dt;
    this.killPool = Math.min(T.killPerSec, this.killPool + T.killPerSec * dt);
    if (this.multiT > 0 && (this.multiT -= dt) <= 0) {
      if (this.multiN >= T.multiMin) this.add(Math.min(this.multiN, T.multiMax) * T.multiPer, `MULTI x${this.multiN}`);
      this.multiN = 0;
    }
    this.noHitT += dt;
    const due = Math.floor(this.noHitT / T.noHitEvery);
    if (due > this.noHitPaid) {
      this.noHitPaid = due;
      this.add(T.noHitBonus, `UNTOUCHED ${due * T.noHitEvery}s`);
    }
    this.points = Math.max(0, this.points - T.decay[this.rank] * dt);
  }
}

/**
 * One hero's skill state: the style meter, perfect-dash scan, parry window,
 * damage buff and ultimate. Host-authoritative; clients mirror the parts they
 * draw from snapshots (see systems/skill.ts).
 */
export class HeroSkill {
  readonly style = new StyleMeter();
  // Perfect dash
  /** Seconds left in which a threat passing through this dash makes it perfect. */
  dashScanT = 0;
  /** This dash already counted as perfect. */
  dashPerfect = false;
  /** Damage buff from a perfect dash or parry (seconds left). */
  buffT = 0;
  // Parry
  /** Active parry window (seconds left). */
  parryT = 0;
  /** Seconds until parry can be pressed again (a whiff costs the full cooldown). */
  parryCd = 0;
  /** This press already parried something. */
  parried = 0;
  // Ultimate
  /** 0..1 charge; 1 = ready. */
  ult = 0;
  /** Seconds left of the running ultimate (0 = none). */
  ultT = 0;
  /** Ultimate-specific step timer and counter. */
  ultTick = 0;
  ultStep = 0;
  ultX = 0;
  ultZ = 0;
  ultA = 0;
  /** Lock-On Storm targets (host). */
  readonly ultTargets: Enemy[] = [];
  /** Blitz: enemy uid -> time it can be hit again. */
  readonly ultHitAt = new Map<number, number>();
  /** Client: last style note seq shown, and last skill event seq sent to this hero (host). */
  netSeq = 0;
  sentEv = 0;
  /** Presentation: seconds of golden glow after a perfect dash / parry (every machine). */
  glowT = 0;

  /** Damage multiplier from the perfect-dash/parry buff. */
  get damageMul(): number {
    return this.buffT > 0 ? 1 + skillTuning.buffDamage : 1;
  }

  reset(): void {
    this.style.reset();
    this.dashScanT = this.buffT = this.parryT = this.parryCd = this.parried = 0;
    this.dashPerfect = false;
    this.ult = this.ultT = this.ultTick = this.ultStep = this.glowT = 0;
    this.ultTargets.length = 0;
    this.ultHitAt.clear();
  }
}

/** Perfect dash and parry numbers. */
export const skillTuning = {
  /** A threat this close (beyond both radii) when the dash starts counts... */
  perfectMargin: 0.35,
  /** ...if it would reach you within this many seconds. */
  perfectLead: 0.22,
  /** After the dash starts, threats passing through you count for this long. */
  perfectScan: 0.2,
  perfectSlowMo: 0.35, // seconds of world slow-mo (solo, setting on)
  perfectIframes: 0.3,
  buffTime: 3,
  buffDamage: 0.25,
  // Parry
  parryWindow: 0.16,
  /** Online clients' presses reach the host late: a longer window and reach for them. */
  parryWindowRemote: 0.26,
  parryReach: 1.15, // beyond the hero's radius
  parryReachRemote: 1.6,
  parryCooldown: 0.6,
  parryStun: 1.1,
  parryKnock: 14,
  parryIframes: 0.35,
  parryFreeze: 0.09,
  reflectSpeed: 26,
  /** Reflected bullet damage: x the hero's level-scaled base (see systems/skill.ts). */
  reflectDmg: 2.2,
};

/** Threat check for a perfect dash: does a bullet at (bx, bz) moving (vx, vz) come within `reach` of (px, pz) in the next `lead` seconds? */
export function bulletThreat(px: number, pz: number, bx: number, bz: number, vx: number, vz: number, reach: number, lead: number): boolean {
  const dx = bx - px;
  const dz = bz - pz;
  const v2 = vx * vx + vz * vz;
  // Time of closest approach, clamped to [0, lead].
  let t = v2 > 0 ? -(dx * vx + dz * vz) / v2 : 0;
  t = Math.max(0, Math.min(lead, t));
  const cx = dx + vx * t;
  const cz = dz + vz * t;
  return cx * cx + cz * cz <= reach * reach;
}
