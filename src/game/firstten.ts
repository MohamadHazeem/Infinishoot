import { ENEMIES } from '../data/enemies';

/**
 * The first ten minutes of a new player (firstten lane): pure data and rules.
 * The game-side controller is src/game/systems/firstten.ts, the DOM is
 * src/ui/firstten.ts. Kept free of Game/DOM imports so tests can load it.
 */
export const firstTenTuning = {
  /** Runs (lifetime.runs before the run) that count as "new player": guided stage-1 moments, quick start, curated first shop. */
  guidedRuns: 3,
  /** Stage 1: the first chest lands this many seconds in, this far ahead of the hero (every run; the regular 30 s clock restarts after it). */
  firstChestAt: 12,
  firstChestDist: 8,
  /** Guided runs: the SPECIAL tip waits for the first swarm ring (or this many seconds) so it lands when it's useful. */
  ringPromptBy: 40,
  /** Guided runs: heads-up this many seconds before the first elite. */
  eliteWarn: 4,
  /** Guided runs: "boss incoming" this many seconds before stage 1 ends. */
  bossWarn: 20,
  /** Seconds between two in-fight tips (menu tips don't wait). */
  tipGap: 3.5,
  /** No in-fight tips this long after a stage starts (the stage banner is up). */
  stageQuiet: 3,
};

/**
 * XP cost multiplier for the first levels (every run): level 2 comes after a
 * handful of kills, so the first level-up lands inside ~15 s instead of ~23 s.
 * Bot runs (notes/lanes/firstten.md): level 2 at 22.7 s -> ~14 s, level 5 a little earlier, same level by the boss.
 */
export const EARLY_XP = [0.55, 0.75, 0.9];

export function earlyXpMul(level: number): number {
  return EARLY_XP[level - 1] ?? 1;
}

/** Is this a new player's run? (`runs` = lifetime runs before it started.) */
export function isGuided(runs: number, solo: boolean, mode: string): boolean {
  return solo && mode === 'standard' && runs < firstTenTuning.guidedRuns;
}

// ---------------------------------------------------------------- FIRST STEPS checklist

export type GoalId = 'training' | 'run' | 'level5' | 'chest' | 'elite' | 'boss' | 'evolve' | 'coop';

export interface GoalDef {
  id: GoalId;
  label: string;
  hint: string;
}

/** Small goals on the title for new saves; all of them unlock the Star Cadet armour. */
export const GOALS: GoalDef[] = [
  { id: 'training', label: 'FINISH TRAINING', hint: 'TRAINING on the title menu' },
  { id: 'run', label: 'PLAY A RUN', hint: 'PLAY SOLO' },
  { id: 'level5', label: 'REACH LEVEL 5', hint: 'Grab the blue XP gems' },
  { id: 'chest', label: 'OPEN A CHEST', hint: 'Walk into a treasure chest' },
  { id: 'elite', label: 'BEAT AN ELITE', hint: 'The big one with a skull bar' },
  { id: 'boss', label: 'BEAT A BOSS', hint: 'Survive 4 minutes, then win' },
  { id: 'evolve', label: 'EVOLVE AN ITEM', hint: 'Rank up a loadout item 8 times' },
  { id: 'coop', label: 'TRY CO-OP', hint: 'PLAY ONLINE or LOCAL CO-OP' },
];

export const FIRST_TEN_REWARD = { achievement: 'graduate', skin: 'cadet', name: 'Star Cadet' };

export interface FirstTenSave {
  /** Goals ticked. */
  done: string[];
  /** Panel closed with HIDE (or a veteran save). */
  hidden: boolean;
  /** All goals done and the reward shown. */
  claimed: boolean;
  /** One-time helpers seen: level-up, shop. */
  seen: string[];
}

export function freshFirstTen(): FirstTenSave {
  return { done: [], hidden: false, claimed: false, seen: [] };
}

/** Old saves: keep valid fields; a save from before this checklist with 5+ runs starts hidden (veterans). */
export function normalizeFirstTen(raw: unknown, runs: number): FirstTenSave {
  const d = freshFirstTen();
  if (!raw || typeof raw !== 'object') {
    d.hidden = runs >= 5;
    return d;
  }
  const r = raw as Partial<FirstTenSave>;
  if (Array.isArray(r.done)) d.done = [...new Set(r.done.filter((x): x is string => GOALS.some((g) => g.id === x)))];
  if (Array.isArray(r.seen)) d.seen = r.seen.filter((x): x is string => typeof x === 'string');
  d.hidden = !!r.hidden;
  d.claimed = !!r.claimed;
  return d;
}

/** Mark goals done; returns the ones that are new. */
export function tickGoals(s: FirstTenSave, ids: readonly GoalId[]): GoalId[] {
  const out: GoalId[] = [];
  for (const id of ids) {
    if (s.done.includes(id)) continue;
    s.done.push(id);
    out.push(id);
  }
  return out;
}

export function allGoalsDone(s: FirstTenSave): boolean {
  return GOALS.every((g) => s.done.includes(g.id));
}

/** Show the checklist on the title? */
export function checklistVisible(s: FirstTenSave): boolean {
  return !s.hidden && !s.claimed;
}

// ---------------------------------------------------------------- first starting shop

/** A new player's first starting shop: simple Mods that work with any starting kit (picked in this order, first one gets GOOD FIRST PICK). */
export const FIRST_SHOP = ['pyromaniac', 'hair_trigger', 'patience', 'quick_draw', 'generalist'];

// ---------------------------------------------------------------- game over: one clear next-try suggestion

export interface DeathInfo {
  /** `hero.lastHitBy`: an enemy name or a cause ('Enemy fire', 'Lava', 'Burning ground'...). */
  cause: string;
  stage: number;
  /** Seconds into the stage when it ended. */
  stageTime: number;
  level: number;
  dashes: number;
  /** Was a boss up when it ended? */
  boss: boolean;
  /** Lifetime runs before this one (0 = the very first). */
  runs: number;
  /** Dash and parry key names (from the player's bindings). */
  keys: { dash: string; parry: string; special: string };
}

export interface NextTry {
  /** Headline, encouraging. */
  cheer: string;
  /** The single suggestion. */
  tip: string;
  /** What it keyed off (tests, debugging). */
  why: string;
}

type TipFn = (k: DeathInfo['keys']) => string;

/** Suggestions per enemy behaviour (src/data/enemies.ts `behavior`). */
const BY_BEHAVIOR: Record<string, TipFn> = {
  chase: () => "Don't let them box you in: walk in wide circles so the crowd trails behind you.",
  lunge: (k) => `They flash red before they lunge. Step aside, or dash through (${k.dash}): you can't be hit mid-dash.`,
  charger: (k) => `Try dashing through the Rhino's charge (${k.dash}). It whines and draws a line first, then can't turn.`,
  exploder: () => 'Ka-Boomers blink faster before they blow. Back off and shoot them from range.',
  shooter: (k) => `Pink shots can be dashed through (${k.dash}) or parried back (${k.parry}) right as they hit.`,
  diver: (k) => `Bees mark a spot, then dive. Keep moving and dash (${k.dash}) off the mark.`,
  leaper: () => 'Hop Frogs show where they land. Step out of the shadow.',
  mortar: () => 'Mortar Toads lob shells at where you stand: keep walking and the shells miss.',
  spawner: () => 'Hive Pylons keep making Swarmers: break the pylon first.',
  shielder: () => 'Shield Bots block shots from the front: circle around them, or use your right click.',
  medic: () => 'Medi Bots heal the crowd: take them out first.',
  burrower: () => 'Diggers pop up under you: watch for the dirt mound and move.',
  mirror: () => 'Mirror Bots copy your shots back: stop firing straight at them.',
  marcher: () => 'Wind-up Soldiers march in straight lines: step out of the column.',
  shark: () => 'Sand Sharks hunt under the sand: watch for the fin and step aside when it surfaces.',
  roller: () => 'Snowball Rollers roll in straight lines and grow: sidestep, never back up in their path.',
  slug: () => "Lava Slugs leave burning trails: don't walk through them.",
  swarmqueen: () => 'The Swarm Queen lays eggs: pop them before they hatch.',
  swarmwall: () => 'Swarm walls always leave one gap: run for the gap.',
  kite: () => 'Gust Kites push you around: keep open ground behind you, away from hazards and edges.',
  reaper: () => 'The Reaper hunts strong builds: kite it in circles and burst it with your special.',
  boss: (k) => `Red zones and lines are telegraphs: dash through them (${k.dash}) instead of running from them.`,
  rex: (k) => `Rex charges in lines it shows first: sidestep, or dash through (${k.dash}) at the last moment.`,
  queen: () => 'Break the Queen\'s hives first: each one heals her. Then keep moving between her fans.',
  titan: (k) => `The Titan's arms sweep where it glows: dash (${k.dash}) through the sweep, then hit the glowing weak points.`,
  omega: (k) => `Omega mixes every boss's moves: watch for the red telegraphs and save a dash (${k.dash}) for them.`,
};

/** Causes that aren't enemies. */
const BY_CAUSE: Record<string, TipFn> = {
  'Enemy fire': (k) => `Pink shots can be dashed through (${k.dash}) or parried back (${k.parry}) right as they hit.`,
  Lava: () => 'Stay off the glowing lava: it burns every step.',
  'Lava Bomb': () => 'Lava bombs land on their red markers: step off the marker.',
  'Burning ground': () => 'The burning ground hurts: fight from the grass, not the flames.',
  'Ground strike': (k) => `Red circles on the ground are strikes about to land: dash out (${k.dash}).`,
  Crusher: () => 'Crusher presses slam on a beat: wait for them to lift, then cross.',
  'The ring': () => 'The red ring is closing: stay inside it.',
  'The ring of fire': () => 'The ring of fire closes in: keep to the middle.',
  'The Colossus': () => 'The Colossus shows where it stomps: get out of its shadow.',
  'Mirror plasma': () => 'Mirror Bots copy your shots back: stop firing straight at them.',
  'Lava Slug': () => 'Lava Slugs leave burning trails: don\'t walk through them.',
};

const NAME_TO_BEHAVIOR: Record<string, string> = Object.fromEntries(Object.values(ENEMIES).map((d) => [d.name, d.behavior]));

/** One encouraging line plus one clear suggestion, picked from what ended the run. */
export function nextTryFor(d: DeathInfo): NextTry {
  const k = d.keys;
  const mm = Math.floor(d.stageTime / 60);
  const ss = String(Math.floor(d.stageTime % 60)).padStart(2, '0');
  const cheer =
    d.runs === 0
      ? 'FIRST RUN DONE! THAT WAS THE HARD PART.'
      : d.stage > 1
        ? `STAGE ${d.stage} REACHED. NICE CLIMB!`
        : d.boss
          ? 'YOU REACHED THE BOSS! SO CLOSE.'
          : `YOU LASTED ${mm}:${ss}. GO AGAIN!`;
  // Died very early with almost no dashes: movement is the lesson, whatever hit you.
  if (d.stage === 1 && d.stageTime < 75 && d.dashes < 3 && !d.boss) return { cheer, tip: `Dash (${k.dash}) through danger: you can't be hit while dashing. Keep moving and let the gun do the work.`, why: 'early-nodash' };
  const behavior = NAME_TO_BEHAVIOR[d.cause];
  const fn = BY_CAUSE[d.cause] ?? (behavior ? BY_BEHAVIOR[behavior] : undefined);
  if (fn) return { cheer, tip: fn(k), why: BY_CAUSE[d.cause] ? `cause:${d.cause}` : `behavior:${behavior}` };
  if (d.boss) return { cheer, tip: BY_BEHAVIOR.boss(k), why: 'boss' };
  if (d.level < 6 && d.stageTime > 90) return { cheer, tip: 'Grab the blue XP gems: more levels mean more weapons. Walk through them as you kite.', why: 'low-level' };
  return { cheer, tip: `Surrounded? Your special (${k.special}) blasts the whole crowd. Use it, it recharges.`, why: 'default' };
}
