/**
 * The Pacifist road (modes lane): a hidden route-map node, shown as ??? until it is picked.
 * The stage is a pure survival run: weapons are holstered (no hero damage at all, no special,
 * no ultimate; dash and parry still work), the horde keeps coming, and there is no boss: the
 * stage ends when its (shorter) timer runs out. A hero who ends it with zero kills gets a relic,
 * gold, a big score bonus and a legendary level-up card. Any kill credited to a hero (a stray
 * Nuke pickup, say) forfeits that hero's reward; kills by the arena (collapses, hazards,
 * enemies' own blasts) don't count. Pure rules; the Game side is src/game/systems/modes.ts.
 */

export const pacifistTuning = {
  /** Stage length in seconds (no boss: the timer is the whole fight). */
  seconds: 120,
  /** Enemy count change for the stage (added like a curse: -0.4 = 40% fewer). */
  count: -0.4,
  /** Rewards per hero who made no kill. */
  gold: 40,
  goldPerStage: 12,
  score: 6000, // x stage
  /** Route-map weight (rare) and the first stage it can appear on. */
  weight: 0.6,
};

/** Seconds left on a pacifist stage. */
export function pacifistLeft(time: number, seconds = pacifistTuning.seconds): number {
  return Math.max(0, seconds - time);
}

/** What a hero earns for the stage: null when they killed something. */
export function pacifistReward(kills: number, stage: number): { gold: number; score: number; relic: boolean; legendary: boolean } | null {
  if (kills > 0) return null;
  const T = pacifistTuning;
  return { gold: T.gold + T.goldPerStage * stage, score: T.score * stage, relic: true, legendary: true };
}

/** The stage's rule lines for the HUD and the route card. */
export const PACIFIST_RULES = ['WEAPONS HOLSTERED', 'NO BOSS: SURVIVE THE TIMER', 'DASH AND PARRY', 'A KILL FORFEITS YOUR REWARD'];
