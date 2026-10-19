/**
 * RANKED (race lane): a local Elo-style rating for online PvP and race
 * results, kept in the save (`save.ranked`). Seasons run by calendar month:
 * the first rated match of a new month archives the old season and pulls the
 * rating halfway back to the start. Pure rules, no Game access.
 */

export interface RankTier {
  id: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'legend';
  name: string;
  /** Lowest rating in the tier. */
  min: number;
  /** Sweetie 16 colour for the badge. */
  color: string;
  /** Badge glyph (drawn in the pixel font). */
  glyph: string;
}

export const RANK_TIERS: readonly RankTier[] = [
  { id: 'bronze', name: 'Bronze', min: 0, color: '#ef7d57', glyph: 'B' },
  { id: 'silver', name: 'Silver', min: 1100, color: '#94b0c2', glyph: 'S' },
  { id: 'gold', name: 'Gold', min: 1250, color: '#ffcd75', glyph: 'G' },
  { id: 'platinum', name: 'Platinum', min: 1400, color: '#73eff7', glyph: 'P' },
  { id: 'diamond', name: 'Diamond', min: 1550, color: '#41a6f6', glyph: 'D' },
  { id: 'legend', name: 'Legend', min: 1750, color: '#b13e53', glyph: '★' },
];

export const rankedTuning = {
  start: 1000,
  /** K factor for the first `placement` games, then `k`. */
  kPlacement: 40,
  k: 24,
  placement: 10,
  /** New season: rating = start + (old - start) * carry. */
  carry: 0.5,
  floor: 100,
  ceil: 4000,
  /** Seasons kept in the history. */
  keepSeasons: 24,
};

export interface SeasonRecord {
  season: string;
  rating: number;
  peak: number;
  games: number;
  wins: number;
}

export interface RankedSave {
  /** Random id for the online ladder (so two "Player"s don't overwrite each other). */
  id: string;
  season: string;
  rating: number;
  peak: number;
  games: number;
  wins: number;
  history: SeasonRecord[];
}

/** 'YYYY-MM' (local time). */
export function seasonId(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "October 2026" for a season id. */
export function seasonName(id: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(id);
  if (!m) return id;
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

export function freshRanked(now: Date = new Date()): RankedSave {
  return { id: '', season: seasonId(now), rating: rankedTuning.start, peak: rankedTuning.start, games: 0, wins: 0, history: [] };
}

const num = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d;
};

/** Fill missing or broken fields (older saves have no `ranked` at all). */
export function normalizeRanked(raw: unknown, now: Date = new Date()): RankedSave {
  const d = freshRanked(now);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<RankedSave>;
  if (typeof r.id === 'string' && /^[a-z0-9]{6,16}$/.test(r.id)) d.id = r.id;
  if (typeof r.season === 'string' && /^\d{4}-\d{2}$/.test(r.season)) d.season = r.season;
  d.rating = num(r.rating, rankedTuning.floor, rankedTuning.ceil, d.rating);
  d.peak = Math.max(d.rating, num(r.peak, rankedTuning.floor, rankedTuning.ceil, d.rating));
  d.games = num(r.games, 0, 1e6, 0);
  d.wins = Math.min(d.games, num(r.wins, 0, 1e6, 0));
  if (Array.isArray(r.history))
    d.history = r.history
      .filter((h) => h && typeof h === 'object' && typeof h.season === 'string' && /^\d{4}-\d{2}$/.test(h.season))
      .map((h) => ({ season: h.season, rating: num(h.rating, 0, rankedTuning.ceil, rankedTuning.start), peak: num(h.peak, 0, rankedTuning.ceil, rankedTuning.start), games: num(h.games, 0, 1e6, 0), wins: num(h.wins, 0, 1e6, 0) }))
      .slice(0, rankedTuning.keepSeasons);
  return d;
}

export function tierOf(rating: number): RankTier {
  let t = RANK_TIERS[0];
  for (const x of RANK_TIERS) if (rating >= x.min) t = x;
  return t;
}

/** Rating left to the next tier (0 at Legend). */
export function toNextTier(rating: number): { next: RankTier | null; need: number } {
  const next = RANK_TIERS.find((x) => x.min > rating) ?? null;
  return { next, need: next ? next.min - rating : 0 };
}

/** Elo expected score of `a` against `b`. */
export function expected(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/**
 * Rating change for one player after a match with any number of players:
 * every other player is a pairwise Elo game (win, loss or draw by place),
 * with K split across the opponents so a 6-player race moves as much as a duel.
 * `places`: 1 = winner, equal places draw.
 */
export function matchDelta(me: { rating: number; place: number }, others: { rating: number; place: number }[], k: number): number {
  if (!others.length) return 0;
  let sum = 0;
  for (const o of others) {
    const s = me.place < o.place ? 1 : me.place > o.place ? 0 : 0.5;
    sum += s - expected(me.rating, o.rating);
  }
  return Math.round((k * sum) / others.length);
}

export function kFor(r: RankedSave): number {
  return r.games < rankedTuning.placement ? rankedTuning.kPlacement : rankedTuning.k;
}

/** Start a new season if the month changed: archive the old one, carry half the gain or loss. */
export function rollSeason(r: RankedSave, now: Date = new Date()): boolean {
  const cur = seasonId(now);
  if (r.season === cur) return false;
  if (r.games > 0) {
    r.history.unshift({ season: r.season, rating: r.rating, peak: r.peak, games: r.games, wins: r.wins });
    r.history.length = Math.min(r.history.length, rankedTuning.keepSeasons);
  }
  r.season = cur;
  r.rating = Math.round(rankedTuning.start + (r.rating - rankedTuning.start) * rankedTuning.carry);
  r.peak = r.rating;
  r.games = r.wins = 0;
  return true;
}

/** Apply one match to the save. Returns the change and whether the tier moved. */
export function applyMatch(r: RankedSave, me: { place: number }, others: { rating: number; place: number }[], now: Date = new Date()): { delta: number; before: number; after: number; tierUp: boolean; tierDown: boolean } {
  rollSeason(r, now);
  const before = r.rating;
  const delta = matchDelta({ rating: before, place: me.place }, others, kFor(r));
  r.rating = Math.max(rankedTuning.floor, Math.min(rankedTuning.ceil, before + delta));
  r.peak = Math.max(r.peak, r.rating);
  r.games++;
  if (me.place === 1 && others.some((o) => o.place > 1)) r.wins++;
  const a = tierOf(before);
  const b = tierOf(r.rating);
  return { delta: r.rating - before, before, after: r.rating, tierUp: b.min > a.min, tierDown: b.min < a.min };
}

/** Pixel badge HTML (styled by raceUi's CSS): tier glyph on its colour, optional rating. */
export function rankBadge(rating: number, withRating = true): string {
  const t = tierOf(rating);
  return `<span class="rk-badge rk-${t.id}" style="--rk:${t.color}" title="${t.name} · ${rating}"><i>${t.glyph}</i>${withRating ? `<b>${t.name.toUpperCase()} ${rating}</b>` : ''}</span>`;
}
