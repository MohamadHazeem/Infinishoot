import { readBody } from './validation.js';
// RANKED ladder (race lane): one board per season (calendar month).
//
//   GET  /ranked?season=2026-10  -> { players: [{ name, rating, games, wins }] } (top 50)
//   POST /ranked                 <- { id, season, name, rating, games, wins, version }
//                                -> { rank } (1-based, 0 if it missed the top 200)
//
// Ratings are computed on each player's own machine (src/data/ranked.ts), so
// this board is for fun, not proof: it keeps the latest rating per save id,
// checks the numbers are possible (rating 100-4000, wins <= games, a rating
// can't move faster than 40 per game away from 1000) and allows one post per
// 20 s per IP.

const KEEP = 200;
const SHOW = 50;
const SEASON_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_RE = /^[a-z0-9]{6,16}$/;

export async function ranked(req, env, url, { json, clean }) {
  if (url.pathname !== '/ranked') return null;
  const kv = env.SCORES;

  if (req.method === 'GET') {
    const season = url.searchParams.get('season') ?? '';
    if (!SEASON_RE.test(season)) return json({ error: 'bad season' }, 400);
    const list = (await kv.get(`ranked:${season}`, 'json')) ?? [];
    return json({ players: list.slice(0, SHOW).map(({ name, rating, games, wins }) => ({ name, rating, games, wins })) });
  }

  if (req.method === 'POST') {
    let b;
    try {
      b = await readBody(req);
    } catch (error) {
      return json({ error: error.status === 413 ? 'too big' : 'bad json' }, error.status ?? 400);
    }
    if (typeof b.season !== 'string' || typeof b.id !== 'string' || ['rating', 'games', 'wins'].some(k => typeof b[k] !== 'number')) return json({ error: 'bad rating' }, 400);
    const season = String(b.season ?? '');
    const id = String(b.id ?? '');
    const rating = Math.round(Number(b.rating));
    const games = Math.floor(Number(b.games));
    const wins = Math.floor(Number(b.wins));
    if (!SEASON_RE.test(season)) return json({ error: 'bad season' }, 400);
    if (!ID_RE.test(id)) return json({ error: 'bad id' }, 400);
    if (!(rating >= 100 && rating <= 4000 && games >= 1 && games < 100000 && wins >= 0 && wins <= games)) return json({ error: 'bad rating' }, 400);
    if (Math.abs(rating - 1000) > 40 * games + 500) return json({ error: 'implausible' }, 400); // a season starts within 500 of 1000

    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (Number(await kv.get(`rkip:${ip}`)) > Date.now()) return json({ error: 'slow down' }, 429);
    await kv.put(`rkip:${ip}`, String(Date.now() + 20000), { expirationTtl: 60 });

    const key = `ranked:${season}`;
    const list = (await kv.get(key, 'json')) ?? [];
    const old = list.findIndex((e) => e.id === id);
    if (old >= 0) list.splice(old, 1);
    const entry = { id, name: clean(b.name), rating, games, wins };
    list.push(entry);
    list.sort((x, y) => y.rating - x.rating || y.games - x.games);
    const rank = list.indexOf(entry) + 1;
    await kv.put(key, JSON.stringify(list.slice(0, KEEP)));
    return json({ rank: rank <= KEEP ? rank : 0 });
  }

  return json({ error: 'method' }, 405);
}
