import { readBody, saneRun } from './validation.js';

import { rankedSeason as seasonAt, rankedBoard, isBoard, finishChecksum } from '../../src/data/seasons2.ts';
import { dailySeed } from '../../src/data/modes.ts';
const uint = n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const band = rank => rank === 1 ? 'comet' : rank <= 10 ? 'nova' : rank <= 50 ? 'orbit' : 'scout';

async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function validFinish(b, now) {
  if (b.season !== seasonAt(now) || !isBoard(b.board) || !uint(b.seed) || !uint(b.hash) || b.replayVersion !== 1) return false;
  if (!saneRun(b.score, b.stage, b.kills, b.time) || b.time < 10 ||
      b.kills > 200 + b.time * 360 || b.score > (b.kills + 50) * 100000 + b.stage * 100000 ||
      !Number.isSafeInteger(b.bonus) || b.bonus < 0 || b.bonus > b.kills * 90) return false;
  if (!['normal','hard','nightmare','legend','easy','assist'].includes(b.difficulty)) return false;
  if (rankedBoard(b.board,b.difficulty) !== b.board || b.bonus % 30 ||
      b.check !== finishChecksum(b) || typeof b.version !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(b.version)) return false;
  if (b.board !== 'daily') return true;
  const date = typeof b.day === 'string' && /^\d{4}-\d\d-\d\d$/.test(b.day) ? Date.parse(b.day) : NaN;
  // The Daily uses the player's local date. Allow its time zone and a run crossing midnight.
  return b.difficulty === 'normal' && Math.abs(date - now) < 3 * 86400000 && b.seed === dailySeed(b.day);
}

// D1 retains immutable receipts. Duplicate finishes cannot be moved to another pilot
// or credited twice. The window ranks whole pilots only after five accepted finishes.
const standings = scope => `WITH best AS (
 SELECT season,board,pilot,points,ROW_NUMBER() OVER
 (PARTITION BY season,board,pilot ORDER BY points DESC,seed,hash) AS pick
 FROM seasonal_finish WHERE ${scope}
), totals AS (
 SELECT season,board,pilot,COUNT(*) AS runs,SUM(points) AS points FROM best
 WHERE pick <= 5 GROUP BY season,board,pilot
), placed AS (
 SELECT *,RANK() OVER(PARTITION BY season,board ORDER BY points DESC) AS rank FROM totals WHERE runs=5
)`;

export async function seasons2(req, env, url, { json }) {
  const history = url.pathname === '/seasons2/history';
  if (!history && url.pathname !== '/seasons2') return null;
  const db = env.TELEMETRY;
  if (!db) return json({ error: 'storage unavailable' }, 503);
  const now = Date.now(), current = seasonAt(now);
  if (req.method === 'GET' && !history) {
    const season = Number(url.searchParams.get('season') ?? current), board = url.searchParams.get('board');
    if (!isBoard(board) || !Number.isSafeInteger(season) || season < 1 || season > current) return json({ error: 'bad board' }, 400);
    const { results } = await db.prepare(standings('season=? AND board=?') +
      ' SELECT substr(pilot,1,8) AS pilot,points,rank FROM placed ORDER BY rank,pilot LIMIT 50').bind(season,board).all();
    return json({ season, board, rows: results });
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let b;
  try { b = await readBody(req); } catch (e) { return json({ error: 'bad body' }, e.status ?? 400); }
  if (typeof b.token !== 'string' || !/^[0-9a-f]{32}$/.test(b.token)) return json({ error: 'bad pilot' }, 400);
  const pilot = await digest('pilot/' + b.token);
  if (history) {
    const { results } = await db.prepare(standings('(season,board) IN (SELECT DISTINCT season,board FROM seasonal_finish WHERE pilot=?)') +
      ' SELECT season,board,rank,points FROM placed WHERE pilot=? ORDER BY season DESC,board').bind(pilot,pilot).all();
    return json({ pilot: pilot.slice(0,8), placements: results.map(r => ({ ...r, band: r.season < current ? band(r.rank) : null })) });
  }
  if (!validFinish(b, now)) return json({ error: 'invalid finish' }, 400);
  const receipt = [b.season,b.board,b.seed,b.hash];
  const existing = await db.prepare('SELECT pilot FROM seasonal_finish WHERE season=? AND board=? AND seed=? AND hash=?').bind(...receipt).first();
  if (existing) return existing.pilot === pilot ? json({ accepted: true }) : json({ error: 'duplicate replay' }, 409);
  const ip = req.headers.get('CF-Connecting-IP') ?? '';
  const bucket = 's2:' + await digest(Math.floor(now / 86400000) + '/' + ip);
  if (await env.SCORES.get(bucket)) return json({ error: 'slow down' }, 429);
  await env.SCORES.put(bucket, '1', { expirationTtl: 60 });
  // The seed and existing replay state hash are retained for a replay verifier.
  const result = await db.prepare(`INSERT OR IGNORE INTO seasonal_finish
    (season,board,seed,hash,pilot,points,score,bonus,stage,kills,time,difficulty,replay_version,version)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...receipt,pilot,b.score+b.bonus,b.score,b.bonus,b.stage,b.kills,b.time,b.difficulty,b.replayVersion,b.version).run();
  if (!result.meta.changes) {
    const row = await db.prepare('SELECT pilot FROM seasonal_finish WHERE season=? AND board=? AND seed=? AND hash=?').bind(...receipt).first();
    if (row?.pilot !== pilot) return json({ error: 'duplicate replay' }, 409);
  }
  return json({ accepted: true });
}
