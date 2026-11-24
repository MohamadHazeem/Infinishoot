import { readBody, saneRun } from './validation.js';
import {
  rankedSeason,
  rankedBoard,
  isBoard,
  finishChecksum,
  rankBand,
  seasonEnd,
} from '../../src/data/seasons2.ts';
import { dailySeed } from '../../src/data/modes.ts';
import { REPLAY_VERSION } from '../../src/dev/replay.ts';

const uint = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;

async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

function validFinish(b, now) {
  if (
    b.season < 1 ||
    b.season !== rankedSeason(now) ||
    !isBoard(b.board) ||
    !uint(b.seed) ||
    !uint(b.hash) ||
    b.replayVersion !== REPLAY_VERSION ||
    rankedBoard(b.board, b.difficulty) !== b.board
  )
    return false;
  if (
    !saneRun(b.score, b.stage, b.kills, b.time) ||
    b.time < 10 ||
    b.kills > 200 + b.time * 360 ||
    b.score > (b.kills + 1) * 100000 + b.stage * 100000 ||
    !Number.isSafeInteger(b.bonus) ||
    b.bonus < 0 ||
    b.bonus > b.kills * 90 ||
    b.bonus % 30
  )
    return false;
  if (
    b.check !== finishChecksum(b) ||
    typeof b.version !== 'string' ||
    !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(b.version)
  )
    return false;
  if (b.board !== 'daily') return true;
  const date =
    typeof b.day === 'string' && /^\d{4}-\d\d-\d\d$/.test(b.day) ? Date.parse(b.day) : NaN;
  // Daily uses local midnight. Allow any timezone and a run finishing the next day.
  return (
    Number.isFinite(date) &&
    new Date(date).toISOString().slice(0, 10) === b.day &&
    date <= now + 14 * 3600000 &&
    now - date < 60 * 3600000 &&
    b.seed === dailySeed(b.day)
  );
}

const standings = (scope) => `WITH best AS (
 SELECT season,board,pilot,points,ROW_NUMBER() OVER
 (PARTITION BY season,board,pilot ORDER BY points DESC,seed,hash) AS pick
 FROM seasonal_finish WHERE ${scope}
), totals AS (
 SELECT season,board,pilot,COUNT(*) AS runs,SUM(points) AS points FROM best
 WHERE pick <= 5 GROUP BY season,board,pilot
), placed AS (
 SELECT *,CASE WHEN runs=5 THEN RANK() OVER(PARTITION BY season,board,runs ORDER BY points DESC) END AS rank
 FROM totals
)`;

// Check duplicate evidence before the cooldown so retrying a lost response is idempotent.
async function receipt(db, b, pilot, json) {
  const row = await db
    .prepare('SELECT pilot,checksum FROM seasonal_finish WHERE seed=? AND hash=?')
    .bind(b.seed, b.hash)
    .first();
  if (!row) return null;
  return row.pilot === pilot && row.checksum === b.check
    ? json({ accepted: true })
    : json({ error: 'duplicate replay' }, 409);
}

export async function seasons2(req, env, url, { json }) {
  const history = url.pathname === '/seasons2/history';
  if (!history && url.pathname !== '/seasons2') return null;
  const db = env.TELEMETRY;
  if (!db) return json({ error: 'storage unavailable' }, 503);
  const now = Date.now(),
    current = rankedSeason(now);
  if (req.method === 'GET' && !history) {
    const season = Number(url.searchParams.get('season') ?? current),
      board = url.searchParams.get('board');
    if (!isBoard(board) || !Number.isSafeInteger(season) || season < 1 || season > current)
      return json({ error: 'bad board' }, 400);
    const { results } = await db
      .prepare(
        standings('season=? AND board=?') +
          ' SELECT substr(pilot,1,8) AS pilot,points,rank FROM placed WHERE rank IS NOT NULL ORDER BY rank,pilot LIMIT 50',
      )
      .bind(season, board)
      .all();
    return json({ season, board, rows: results });
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let b;
  try {
    b = await readBody(req);
  } catch (e) {
    return json({ error: 'bad body' }, e.status ?? 400);
  }
  if (typeof b.token !== 'string' || !/^[0-9a-f]{32}$/.test(b.token))
    return json({ error: 'bad pilot' }, 400);
  const pilot = await digest('pilot/' + b.token);
  if (history) {
    const { results } = await db
      .prepare(
        standings(
          '(season,board) IN (SELECT DISTINCT season,board FROM seasonal_finish WHERE pilot=?)',
        ) +
          ' SELECT season,board,rank,points,runs FROM placed WHERE pilot=? ORDER BY season DESC,board',
      )
      .bind(pilot, pilot)
      .all();
    return json({
      placements: results.map((r) => ({
        ...r,
        band: r.rank && r.season < current ? rankBand(r.rank) : null,
      })),
    });
  }
  if (!validFinish(b, now)) return json({ error: 'invalid finish' }, 400);
  const duplicate = await receipt(db, b, pilot, json);
  if (duplicate) return duplicate;
  const ip = req.headers.get('CF-Connecting-IP') ?? '';
  const bucket = 's2:' + (await digest(Math.floor(now / 86400000) + '/' + ip));
  if (await env.SCORES.get(bucket)) return json({ error: 'slow down' }, 429);
  // D1 serializes the write, cutoff and pilot cooldown. An in-flight request can't
  // move a closed board after its title was awarded, even if two isolates race.
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO seasonal_finish
    (season,board,seed,hash,pilot,points,score,bonus,stage,kills,time,difficulty,replay_version,checksum,version,received)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch() WHERE unixepoch() < ? AND
    NOT EXISTS (SELECT 1 FROM seasonal_finish WHERE pilot=? AND received > unixepoch()-60)`,
    )
    .bind(
      b.season,
      b.board,
      b.seed,
      b.hash,
      pilot,
      b.score + b.bonus,
      b.score,
      b.bonus,
      b.stage,
      b.kills,
      b.time,
      b.difficulty,
      b.replayVersion,
      b.check,
      b.version,
      seasonEnd(b.season) / 1000,
      pilot,
    )
    .run();
  if (!result.meta.changes) {
    return (await receipt(db, b, pilot, json)) ?? json({ error: 'closed or cooling down' }, 429);
  }
  await env.SCORES.put(bucket, '1', { expirationTtl: 60 });
  return json({ accepted: true });
}
