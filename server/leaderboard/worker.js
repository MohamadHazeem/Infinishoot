// InfiniShoot online leaderboard: a Cloudflare Worker backed by one KV namespace.
// Free tier is plenty. Deploy steps are in server/leaderboard/README.md.
//
//   GET  /scores?board=<id>   -> { scores: [{ name, score, stage, kills, time, date }] } (top 20)
//   POST /scores              <- { board, name, score, stage, kills, time, version }
//                             -> { rank } (1-based, or 0 if it didn't make the top 100)
//
// Boards: "<mode>-<difficulty>" (e.g. "standard-normal") and "daily-YYYY-MM-DD".
// Scores are sanity-checked and each IP may submit once a minute. This keeps
// casual nonsense out; it is not real anti-cheat (the game runs on the player's PC).

import { ROUTES } from './routes.js';

const KEEP = 100;
const SHOW = 20;
const BOARD_RE = /^(standard|endless|bossrush|gauntlet)-(easy|normal|hard|nightmare)$|^daily-\d{4}-\d{2}-\d{2}$|^weekly-\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function clean(name) {
  return String(name ?? 'Player')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .trim()
    .slice(0, 12) || 'Player';
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    // Extra endpoints (lobbies, ghosts, team boards...) live in their own modules: see routes.js.
    for (const route of ROUTES) {
      const res = await route(req, env, url, { json, cors, clean });
      if (res) return res;
    }
    if (url.pathname !== '/scores') return json({ error: 'not found' }, 404);

    if (req.method === 'GET') {
      const board = url.searchParams.get('board') ?? '';
      if (!BOARD_RE.test(board)) return json({ error: 'bad board' }, 400);
      const list = (await env.SCORES.get(`board:${board}`, 'json')) ?? [];
      return json({ scores: list.slice(0, SHOW) });
    }

    if (req.method === 'POST') {
      const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
      if (await env.SCORES.get(`ip:${ip}`)) return json({ error: 'slow down' }, 429);
      await env.SCORES.put(`ip:${ip}`, '1', { expirationTtl: 60 });

      let b;
      try {
        b = await req.json();
      } catch {
        return json({ error: 'bad json' }, 400);
      }
      const board = String(b.board ?? '');
      const score = Math.floor(Number(b.score));
      const stage = Math.floor(Number(b.stage));
      const kills = Math.floor(Number(b.kills));
      const time = Number(b.time);
      if (!BOARD_RE.test(board)) return json({ error: 'bad board' }, 400);
      // Rough plausibility: a positive score, a sane stage, and no more than ~40 points per kill per stage.
      if (!(score > 0 && stage >= 1 && stage < 200 && kills >= 0 && time > 0 && time < 86400)) return json({ error: 'bad score' }, 400);
      if (score > (kills + 50) * 40 * stage * 3) return json({ error: 'implausible' }, 400);

      const entry = { name: clean(b.name), score, stage, kills, time: Math.round(time), date: new Date().toISOString().slice(0, 10) };
      const list = (await env.SCORES.get(`board:${board}`, 'json')) ?? [];
      list.push(entry);
      list.sort((x, y) => y.score - x.score);
      const rank = list.indexOf(entry) + 1;
      await env.SCORES.put(`board:${board}`, JSON.stringify(list.slice(0, KEEP)));
      return json({ rank: rank <= KEEP ? rank : 0 });
    }

    return json({ error: 'method' }, 405);
  },
};
