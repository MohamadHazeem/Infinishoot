/**
 * Time lane: tuning and the pure rules behind the time rewind, last stand,
 * bullet-time dodges, the death replay and clutch revives (no Game access,
 * so tests can run them directly). The Game side lives in
 * src/game/systems/time.ts, the recording in src/game/timeline.ts.
 */

export const timeTuning = {
  // ---- history (src/game/timeline.ts)
  /** Snapshots of the world per second of play. */
  recordHz: 10,

  // ---- rewind
  /** How far a rewind goes back (seconds of play). */
  rewindSeconds: 5,
  /** Shortest history worth rewinding. */
  rewindMin: 1,
  /** Rewinds per stage (solo: yours; co-op: the team's). */
  rewindPerStage: 1,
  /** Real seconds the backward playback takes. */
  rewindPlay: 1.1,
  /** Invulnerability after a rewind, so the restored moment can't be lost on the spot. */
  rewindIframes: 1.2,
  /** Co-op: seconds the team has to agree on a rewind. */
  voteTime: 6,

  // ---- last stand
  /** Team combo needed when the killing blow lands: the best combo of the last standMemory seconds (a hit breaks the combo, so the killing blow usually follows a break). */
  standCombo: 50,
  standMemory: 3,
  /** Kills that earn your life back. */
  standKills: 30,
  /** Seconds to get them (god mode meanwhile). */
  standTime: 5,
  /** Solo: the world freezes this long before the countdown (online: the picture holds briefly). */
  standFreeze: 0.6,
  /** Life you get back on success (fraction of max life). */
  standHeal: 0.35,
  /** Invulnerability after a successful stand. */
  standIframes: 1.5,
  /** Once per stage (false = once per run). */
  standPerStage: true,

  // ---- bullet-time dodge (boss and mini-boss fights)
  /** Seconds of slow motion (solo, SKILL SLOW-MO on). */
  btSlow: 0.9,
  /** Camera swing length (every machine, the dodging hero's own screen). */
  btSwing: 1.15,
  /** Swing angle (radians) and pitch drop (degrees) at the peak. */
  btYaw: 0.55,
  btPitch: 16,
  /** Zoom at the peak (below 1 = closer). */
  btZoom: 0.72,
  /** No second one for this hero within this many seconds. */
  btCooldown: 12,
  /** A strike or slam landing this close outside its edge counts as a near miss (metres). */
  btMargin: 1.4,
  /** Enemy bullets passing this close outside a hero (metres) graze them... */
  grazeBand: 0.6,
  /** ...and this much graze (bullet-steps, decaying with grazeDecay seconds) makes a near miss. */
  grazeNeed: 9,
  grazeDecay: 0.35,
  /** A boss charging this close past a hero without touching them (metres beyond contact). */
  chargeMargin: 1.1,

  // ---- death replay
  /** Recorded seconds before the death the replay shows. */
  replayWindow: 1.8,
  /** Real seconds it plays over (slow motion). */
  replayPlay: 3.2,
  /** Then it holds on the death frame with the "so close" card. */
  replayLinger: 0.6,
  /** Seconds after the death before the replay starts (the fall plays first). */
  replayDelay: 0.8,
  /** Camera: pitch (degrees), distance (metres) and orbit (radians over the replay). */
  replayPitch: 24,
  replayDist: 10,
  replayOrbit: 0.7,

  // ---- clutch revive (co-op)
  /** A rescuer at or under this share of life makes a revive clutch... */
  clutchHp: 0.35,
  /** ...or this many enemies within clutchRadius of the downed hero... */
  clutchCrowd: 10,
  clutchRadius: 6,
  /** ...or (3+ players) the rescuer was the last one standing. */
  clutchLastStanding: true,
  /** Cutscene length and the slow motion it gets in solo test runs. */
  clutchTime: 1.7,
  clutchSlow: 0.8,
  /** No second cutscene within this many seconds. */
  clutchCooldown: 20,
};

/** Debug: pin holds and camera moves at this progress (0..1) for screenshots; -1 = off. */
export const timeDebug = { pin: -1 };

// ---------------------------------------------------------------- curves

/** Smoothstep 0..1. */
export function smooth(k: number): number {
  const t = Math.max(0, Math.min(1, k));
  return t * t * (3 - 2 * t);
}

/** Rewind playback: how far back (0 = now, 1 = the target) at progress k. Starts slow, speeds up, eases into the stop. */
export function rewindCurve(k: number): number {
  const t = Math.max(0, Math.min(1, k));
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

/** Camera move weight for a cutscene of `dur` s at time t: eases in over `inT`, holds, eases out over `outT`. */
export function camWeight(t: number, dur: number, inT = 0.25, outT = 0.35): number {
  if (t <= 0 || t >= dur) return 0;
  if (t < inT) return smooth(t / inT);
  if (t > dur - outT) return smooth((dur - t) / outT);
  return 1;
}

/** Bullet-time swing: out and back once (0 at both ends, 1 in the middle). */
export function swingWeight(k: number): number {
  const t = Math.max(0, Math.min(1, k));
  return Math.sin(Math.PI * t) ** 0.7;
}

// ---------------------------------------------------------------- rules

/** Can a rewind start? null = yes; '' = not now (say nothing); otherwise the reason, shown to the player. */
export function rewindBlock(o: { used: number; history: number; pvp: boolean; fighting: boolean; dead: boolean }): string | null {
  if (o.pvp) return 'NO REWIND IN PVP';
  if (!o.fighting || o.dead) return '';
  if (o.used >= timeTuning.rewindPerStage) return 'REWIND USED THIS STAGE';
  if (o.history < timeTuning.rewindMin) return 'NOTHING TO REWIND YET';
  return null;
}

/** Last stand: does a killing blow open one? */
export function standOpens(o: { combo: number; used: boolean; pvp: boolean; training: boolean; active: boolean }): boolean {
  return !o.pvp && !o.training && !o.used && !o.active && o.combo >= timeTuning.standCombo;
}

/** A team vote passes once every hero still standing has agreed (downed heroes don't vote). */
export function votePasses(yes: readonly number[], standing: readonly number[]): boolean {
  return standing.length > 0 && standing.every((i) => yes.includes(i));
}

/** Clutch revive: the rescue happened in dire straits. */
export function isClutch(o: { helperHp01: number; crowd: number; standing: number; players: number }): boolean {
  const T = timeTuning;
  if (o.helperHp01 <= T.clutchHp) return true;
  if (o.crowd >= T.clutchCrowd) return true;
  return T.clutchLastStanding && o.players >= 3 && o.standing <= 1;
}

/** Strike or slam of radius r centred (sx, sz) landing near a hero at (hx, hz) with radius hr: did it just miss? */
export function nearMiss(sx: number, sz: number, r: number, hx: number, hz: number, hr: number, hitFrac = 0.6): boolean {
  const d = Math.hypot(hx - sx, hz - sz);
  return d >= r + hr * hitFrac && d < r + hr + timeTuning.btMargin;
}

/** An enemy bullet at (bx, bz) of radius br grazing a hero (inside the graze band, not touching). */
export function grazes(bx: number, bz: number, br: number, hx: number, hz: number, hr: number): boolean {
  const d2 = (bx - hx) ** 2 + (bz - hz) ** 2;
  const touch = br + hr;
  const band = touch + timeTuning.grazeBand;
  return d2 > touch * touch && d2 < band * band;
}

// ---------------------------------------------------------------- "so close!"

export interface DeathInfo {
  /** Live boss life left (0..1), or -1 without a boss. */
  bossHp01: number;
  bossName: string;
  /** Seconds until the boss arrives (-1 once it has). */
  toBoss: number;
  level: number;
  xp01: number;
  /** Estimated kills to the next level (-1 = unknown). */
  killsToLevel: number;
  /** Points short of the best local score (<= 0: beaten). */
  toBest: number;
  bestScore: number;
  /** Last stand kills short of the goal (-1 = no failed stand). */
  standShort: number;
  combo: number;
  rewindLeft: boolean;
  runTime: number;
  kills: number;
}

/** The most painful near thing about this death: a headline and a line under it. */
export function soClose(d: DeathInfo): { title: string; text: string } {
  const opts: [number, string, string][] = [];
  if (d.bossHp01 >= 0 && d.bossHp01 <= 0.5) {
    const pct = Math.max(1, Math.round(d.bossHp01 * 100));
    opts.push([1 - d.bossHp01 + 0.25, 'SO CLOSE!', `${d.bossName.toUpperCase()} HAD ${pct}% LIFE LEFT`]);
  }
  if (d.toBoss >= 0 && d.toBoss <= 30) {
    const s = Math.max(1, Math.ceil(d.toBoss));
    opts.push([1.2 - d.toBoss / 30, 'SO CLOSE!', `${s} SECOND${s === 1 ? '' : 'S'} FROM THE BOSS`]);
  }
  if (d.standShort > 0 && d.standShort <= 10) opts.push([1.25 - d.standShort / 20, 'SO CLOSE!', `${d.standShort} KILL${d.standShort === 1 ? '' : 'S'} SHORT OF A LAST STAND`]);
  if (d.killsToLevel > 0 && d.killsToLevel <= 5) opts.push([0.9 - d.killsToLevel * 0.05, 'SO CLOSE!', `${d.killsToLevel} KILL${d.killsToLevel === 1 ? '' : 'S'} FROM LEVEL ${d.level + 1}`]);
  else if (d.xp01 >= 0.85) opts.push([0.6 + d.xp01 * 0.2, 'SO CLOSE!', `${Math.round(d.xp01 * 100)}% OF THE WAY TO LEVEL ${d.level + 1}`]);
  if (d.bestScore > 0 && d.toBest > 0 && d.toBest <= d.bestScore * 0.1) opts.push([1.1 - d.toBest / d.bestScore, 'SO CLOSE!', `${Math.ceil(d.toBest).toLocaleString('en-US')} POINTS FROM YOUR BEST`]);
  if (d.combo >= 50) opts.push([0.5 + Math.min(0.3, d.combo / 1000), 'COMBO LOST', `A x${d.combo} COMBO ENDED HERE`]);
  if (d.rewindLeft) opts.push([0.45, 'TIME WAS ON YOUR SIDE', 'YOUR REWIND WAS STILL CHARGED']);
  opts.sort((a, b) => b[0] - a[0]);
  if (opts.length) return { title: opts[0][1], text: opts[0][2] };
  const m = Math.floor(d.runTime / 60);
  const s = Math.floor(d.runTime % 60);
  return { title: 'GAME OVER', text: `LASTED ${m}:${String(s).padStart(2, '0')} · ${d.kills} KILLS` };
}
