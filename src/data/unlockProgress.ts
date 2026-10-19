import { ACHIEVEMENTS } from './meta';
import { SPECIALS } from './specials';
import { WEAPONS } from './weapons';

/**
 * How close each locked achievement is, for the game-over screen
 * ("Rail Driver: 18/25 elites"). Lifetime goals read the save's lifetime
 * stats (already banked when game over shows); one-run feats read the run
 * that just ended. Achievements with no measurable progress (Maxed Out) are left out.
 */
export interface UnlockRun {
  stage: number;
  dashes: number;
  weapons: number;
  bosses: number;
  mode: string;
  difficulty: string;
}

export interface UnlockLifetime {
  kills: number;
  elites: number;
  bosses: number;
  bestStage: number;
}

export interface UnlockProgress {
  id: string;
  /** What it unlocks (item name), else the achievement's own name. */
  label: string;
  /** The achievement's goal, e.g. "Defeat 25 elites in total". */
  desc: string;
  cur: number;
  max: number;
  unit: string;
  frac: number;
}

type Goal = (L: UnlockLifetime, r: UnlockRun) => [cur: number, max: number, unit: string] | null;

const GOALS: Record<string, Goal> = {
  light_tamer: (L) => [L.kills, 1500, 'kills'],
  field_engineer: (L) => [L.elites, 12, 'elites'],
  first_steps: (L) => [L.kills, 300, 'kills'],
  boss_slayer: (L) => [L.bosses, 1, 'bosses'],
  stage_2: (L) => [L.bestStage, 2, 'best stage'],
  elite_hunter: (L) => [L.elites, 5, 'elites'],
  // Evolving is a one-run feat; reaching stage 3 also grants it (old saves).
  evolved: (L) => [L.bestStage, 3, 'best stage'],
  arsenal: (_L, r) => [r.weapons, 6, 'weapons at once'],
  exterminator: (L) => [L.kills, 3000, 'kills'],
  speedster: (_L, r) => [r.dashes, 60, 'dashes in a run'],
  stage_3: (L) => [L.bestStage, 3, 'best stage'],
  boss_rush: (L) => [L.bosses, 5, 'bosses'],
  elite_slayer: (L) => [L.elites, 25, 'elites'],
  victory: (L) => [Math.min(L.bestStage, 4), 5, 'best stage'],
  hard_stage3: (_L, r) => (r.difficulty === 'hard' || r.difficulty === 'nightmare' ? [r.stage, 3, 'stage on Hard'] : null),
  endless_5: (_L, r) => (r.mode === 'endless' ? [r.stage, 5, 'Endless waves'] : null),
  rush_3: (_L, r) => (r.mode === 'bossrush' ? [r.bosses, 3, 'Boss Rush bosses'] : null),
};

/** Progress toward every locked achievement that can be measured. */
export function unlockProgress(L: UnlockLifetime, run: UnlockRun, done: readonly string[]): UnlockProgress[] {
  const out: UnlockProgress[] = [];
  for (const a of ACHIEVEMENTS) {
    if (done.includes(a.id)) continue;
    const g = GOALS[a.id]?.(L, run);
    if (!g) continue;
    const [cur, max, unit] = g;
    const item = a.unlockLoadout ? (WEAPONS[a.unlockLoadout] ?? SPECIALS[a.unlockLoadout]) : a.unlockWeapon ? WEAPONS[a.unlockWeapon] : null;
    const c = Math.max(0, Math.min(max, Math.floor(cur)));
    out.push({ id: a.id, label: item?.name ?? a.name, desc: a.desc, cur: c, max, unit, frac: c / max });
  }
  return out;
}

/** The n locked unlocks you are closest to (most progress first; ties keep the achievement order). */
export function closestUnlocks(L: UnlockLifetime, run: UnlockRun, done: readonly string[], n = 3): UnlockProgress[] {
  return unlockProgress(L, run, done)
    .filter((p) => p.frac < 1)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.frac - a.p.frac || a.i - b.i)
    .slice(0, n)
    .map((x) => x.p);
}
