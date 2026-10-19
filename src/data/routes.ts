import { Rng } from '../core/rng';

/**
 * Routes: after each post-boss shop the team picks how the next stage plays
 * (Standard, Endless and co-op; Daily and Weekly get one fixed by the seed;
 * Boss Rush and PvP have none). A route only turns knobs on systems that
 * already exist: director elite timing, chest spawns, stage events and
 * challenges, shop prices, curses and relics. Behaviour lives in
 * src/game/systems/runMods.ts; the numbers in `routeTuning`.
 */
export type RouteId = 'treasure' | 'elite' | 'event' | 'shop' | 'cursed';

export interface RouteDef {
  id: RouteId;
  name: string;
  /** One-line summary for the route card. */
  desc: string;
  color: string;
  /** Glyph on the card and the HUD tag. */
  icon: string;
  weight: number;
  /** Offered before the final boss stage (every LOOP_STAGES-th). */
  final: boolean;
}

export const routeTuning = {
  offers: 3, // route cards per vote
  finalOffers: 2, // cards before the final boss stage (CURSED never shows there)
  voteSeconds: 15, // co-op vote timer; solo has none
  // TREASURE
  chestEveryMul: 0.55, // seconds between map chests x this
  chestMaxAdd: 2, // more unopened chests allowed on the map
  treasureEliteMul: 1.6, // seconds between elites x this (fewer elites)
  // ELITE HUNT
  eliteMul: 0.5, // seconds between elites x this (twice as many)
  eliteGears: 1, // extra gears per elite kill
  eliteGold: 2, // extra gold per elite kill
  relicLuck: 4, // added to Luck for the boss relic roll
  // EVENTFUL
  events: 2, // stage events this stage
  rewardMul: 2.5, // challenge gold and score x this
  challengeAt: 8, // seconds into the stage the challenge starts (normally 18)
  // BARGAIN
  priceMul: 0.7, // Mod prices in the next shop x this
  clearGold: 8, // extra gold each at stage clear
  // CURSED
  cursedScore: 2000, // team score x stage when the curse is taken
};

export const ROUTES: RouteDef[] = [
  { id: 'treasure', name: 'Treasure', desc: 'Chests appear almost twice as often and more wait on the map. Fewer elites.', color: '#ffcd75', icon: '◆', weight: 1, final: true },
  { id: 'elite', name: 'Elite Hunt', desc: 'Twice the elites. Each drops an extra gear and gold, and the boss relic is luckier.', color: '#ef7d57', icon: '☠', weight: 1, final: true },
  { id: 'event', name: 'Eventful', desc: 'Two stage events instead of one. The side challenge starts early and pays 2.5x.', color: '#73eff7', icon: '★', weight: 1, final: true },
  { id: 'shop', name: 'Bargain', desc: 'The next shop is 30% cheaper and the stage clear pays 8 extra gold each.', color: '#a7f070', icon: '●', weight: 1, final: true },
  { id: 'cursed', name: 'Cursed', desc: 'Take a random curse for the rest of the run. Everyone gets a relic right now.', color: '#b13e53', icon: '✷', weight: 0.8, final: false },
];

export const ROUTE_BY_ID = Object.fromEntries(ROUTES.map((r) => [r.id, r])) as Record<RouteId, RouteDef>;

export function isRouteId(id: unknown): id is RouteId {
  return typeof id === 'string' && id in ROUTE_BY_ID;
}

/**
 * The route cards offered for `stage`, a pure function of the run seed and the stage
 * (so a seed reproduces its routes and the run's own RNG isn't touched).
 * `final`: the final boss stage gets a reduced set.
 */
export function rollRoutes(seed: number, stage: number, final: boolean): RouteId[] {
  const rng = new Rng((seed ^ Math.imul(stage + 7, 0x85ebca6b) ^ 0x2f00d) >>> 0);
  const pool = ROUTES.filter((r) => !final || r.final);
  const want = Math.min(pool.length, final ? routeTuning.finalOffers : routeTuning.offers);
  const out: RouteId[] = [];
  while (out.length < want) {
    const left = pool.filter((r) => !out.includes(r.id));
    let roll = rng.next() * left.reduce((a, r) => a + r.weight, 0);
    let pick = left[left.length - 1];
    for (const r of left) if ((roll -= r.weight) <= 0) {
      pick = r;
      break;
    }
    out.push(pick.id);
  }
  return out;
}

/**
 * Co-op vote count: the most votes wins; a tie goes to the host's vote (index 0's pick)
 * if it's among the tied, else to the leftmost tied card. No votes: the first card.
 * `votes[i]` is the card hero i voted for (-1 = none).
 */
export function tallyVotes(votes: number[], cards: number, hostIndex = 0): number {
  const n = new Array(cards).fill(0);
  for (const v of votes) if (v >= 0 && v < cards) n[v]++;
  const top = Math.max(...n);
  if (top === 0) return 0;
  const tied = n.map((c, i) => (c === top ? i : -1)).filter((i) => i >= 0);
  const host = votes[hostIndex] ?? -1;
  return tied.includes(host) ? host : tied[0];
}
