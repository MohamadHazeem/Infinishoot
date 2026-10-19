/**
 * Spectate lane: pure rules for watching an online game (no Game, no DOM, so
 * tests/spectate.test.ts can drive them). The Game side lives in
 * src/game/systems/spectate.ts and the overlay in src/ui/spectateUi.ts.
 *
 * - Seats: up to `spectateTuning.max` spectators per host, on top of the 4 players.
 * - Snapshots: spectators get every `snapEvery`-th snapshot (10 Hz) with a wider
 *   interest box (`interestMul` x INTEREST) and no private build data.
 * - AUTO DIRECTOR: scores every hero (boss fight, low life, crowds, style rank,
 *   ultimate) and cuts to the most exciting one every few seconds.
 */

export const spectateTuning = {
  /** Spectator seats per host. */
  max: 8,
  /** Spectators get every Nth snapshot the players get (players: 20 Hz, so 10 Hz). */
  snapEvery: 2,
  /** Interest box half-size for spectators, times the players' INTEREST (their camera roams and zooms out). */
  interestMul: 1.3,
  /** How often a spectator tells the host where it looks (s). */
  viewEvery: 0.25,
  /** Free camera pan speed (m/s, x1.8 zoomed out fully) and the margin kept inside the arena edge (m). */
  freeSpeed: 22,
  freeEdge: 4,
  /** Auto director: hold a shot at least this long (s), cut to someone else after this long (s). */
  cutMin: 3.5,
  cutEvery: 7,
  /** A hero this much more exciting than the current one gets the cut early (after cutMin). */
  cutMargin: 2.5,
  /** Emotes from spectators: how long they stay in the players' feed (s), and how many lines show. */
  emoteShow: 4,
  feedMax: 4,
} as const;

/** What the director knows about one hero this frame. */
export interface DirectorInput {
  alive: boolean;
  /** Life 0..1. */
  hp01: number;
  /** Distance to the boss (m), Infinity without one. */
  bossDist: number;
  /** Enemies within 10 m. */
  crowd: number;
  /** Style rank index 0 (D) .. 5 (SS). */
  rank: number;
  /** Ultimate running right now. */
  ult: boolean;
  /** Took a hit in the last moment (hurt flash). */
  hurt: boolean;
}

/** How exciting a hero is to watch right now (higher is better; -Infinity = can't be watched). */
export function directorScore(x: DirectorInput): number {
  if (!x.alive) return -Infinity;
  let s = 1;
  if (x.bossDist < 24) s += 3 + (24 - x.bossDist) / 12; // the boss fight is the show
  if (x.hp01 < 0.35) s += 2.5 * (1 - x.hp01 / 0.35) + 1; // will they make it?
  s += Math.min(3, x.crowd / 8); // swarmed
  s += x.rank * 0.6; // big combos and style
  if (x.ult) s += 2.5;
  if (x.hurt) s += 0.5;
  return s;
}

/** The auto director's camera: which hero it watches, and when it cuts. */
export class AutoDirector {
  target = -1;
  /** Seconds on the current shot. */
  held = 0;
  /** Cuts so far (tests, the HUD's CUT flash). */
  cuts = 0;

  /** Advance by dt with this frame's scores (index = hero index). Returns the hero to watch, -1 for none. */
  step(dt: number, scores: readonly number[]): number {
    const T = spectateTuning;
    this.held += dt;
    let best = -1;
    for (let i = 0; i < scores.length; i++) if (scores[i] > -Infinity && (best < 0 || scores[i] > scores[best])) best = i;
    if (best < 0) return this.target; // nobody to watch: keep the last shot
    const cur = this.target >= 0 && this.target < scores.length ? scores[this.target] : -Infinity;
    if (cur === -Infinity) return this.cut(best);
    if (this.held < T.cutMin) return this.target;
    if (best !== this.target && scores[best] >= cur + T.cutMargin) return this.cut(best);
    if (this.held >= T.cutEvery) {
      // Variety: the most exciting of the others, unless they're far duller than this shot.
      let other = -1;
      for (let i = 0; i < scores.length; i++) if (i !== this.target && scores[i] > -Infinity && (other < 0 || scores[i] > scores[other])) other = i;
      if (other >= 0 && scores[other] >= cur - T.cutMargin) return this.cut(other);
      this.held = T.cutMin; // stay, look again in a moment
    }
    return this.target;
  }

  private cut(i: number): number {
    if (i !== this.target) this.cuts++;
    this.target = i;
    this.held = 0;
    return i;
  }
}

/** Next hero to follow from `cur` going `dir` (+1 / -1), skipping heroes that can't be watched; `cur` if none. */
export function cycleFollow(cur: number, watchable: readonly boolean[], dir: 1 | -1): number {
  const n = watchable.length;
  if (!n) return cur;
  for (let k = 1; k <= n; k++) {
    const i = (((cur + dir * k) % n) + n) % n;
    if (watchable[i]) return i;
  }
  return cur;
}

/** Keep a free camera point inside the arena. */
export function clampView(v: number, half: number): number {
  const lim = Math.max(0, half - spectateTuning.freeEdge);
  return Math.max(-lim, Math.min(lim, v));
}

/** Why someone joins as a spectator, or null if they join as a player. */
export type SeatReason = 'chosen' | 'full' | 'closed' | 'back';

export interface SeatInput {
  /** They pressed JOIN AS SPECTATOR. */
  asked: boolean;
  /** Host setting: spectators allowed. */
  allowed: boolean;
  /** They watched this host before (a reconnect keeps their seat). */
  wasSpectator: boolean;
  /** The lobby or run has no free player slot for them. */
  full: boolean;
  /** A run is going that won't take new players (joining closed, PvP or the run just ended). */
  closed: boolean;
  /** A hero in the run is theirs to reclaim (coop2 drop-in rules come first). */
  reclaim: boolean;
}

/** Seat rule on the host: spectate, or null to go through the normal player path. */
export function seatFor(x: SeatInput): SeatReason | null {
  if (!x.allowed) return null;
  if (x.asked) return 'chosen';
  if (x.reclaim) return null;
  if (x.wasSpectator) return 'back';
  if (x.full) return 'full';
  if (x.closed) return 'closed';
  return null;
}

/** Can a spectator take a player slot now? `players`: heroes in the run (or lobby entries) plus pending joins. */
export function slotOpen(players: number, max = 4): boolean {
  return players < max;
}

/** "3 WATCHING" style count text for the players' badge. */
export function watchingText(n: number): string {
  return n <= 0 ? '' : `${n} WATCHING`;
}
