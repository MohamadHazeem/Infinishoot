import { firstLink, checksum, MAX_ROWS, PERIOD } from './protocol/replayChain.js';
import { readBody, saneRun } from './validation.js';
import { contribute, goalWeek } from './goals.js';

const boardPattern = /^(?:(?:standard|endless|bossrush|gauntlet|raid)-(?:assist|easy|normal|hard|nightmare)|daily-\d{4}-\d{2}-\d{2}|weekly-\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3]))$/;
const heroes = new Set(['rookie','bulwark','dash','ace','duelist','furnace','twin','ronin','tinker','medic','brawler']);
function seedFor(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function verifyReplay(submission) {
  const { board, score, stage, kills, time, replay } = submission;
  if (typeof board !== 'string' || !boardPattern.test(board) || !saneRun(score, stage, kills, time) ||
      (!board.startsWith('gauntlet-') && score > (kills + 50) * 120 * stage) || replay?.format !== 1 || board !== replay.board) return false;
  const { hero, build, seed, rows } = replay;
  if (!heroes.has(hero) || typeof build !== 'string' || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(build) ||
      !Number.isInteger(seed) || seed !== (seed >>> 0) || !Array.isArray(rows) || rows.length < 2 || rows.length > MAX_ROWS) return false;
  if (board.startsWith('daily-') && seed !== seedFor(board.slice(6))) return false;
  if (board.startsWith('weekly-') && seed !== seedFor('infinishoot-weekly-v1-' + board.slice(7))) return false;
  let hash = firstLink(board, build, hero, seed);
  let previous = null;
  for (const [i, row] of rows.entries()) {
    if (!Array.isArray(row) || row.length !== 10 || !row.every(Number.isSafeInteger)) return false;
    const [clock, timer, level, points, count, x, z, life, stateHash, link] = row;
    if (clock < 0 || clock >= 86400000 || timer < 0 || timer >= 86400000 || level < 1 || level >= 200 ||
        points < 0 || count < 0 || Math.abs(x) > 1e6 || Math.abs(z) > 1e6 || Math.abs(life) > 1e7) return false;
    if (stateHash !== (stateHash >>> 0)) return false;
    if (!/^(raid|bossrush|gauntlet)-/.test(board) && timer !== clock) return false;
    if (/^(bossrush|gauntlet)-/.test(board) && timer > clock + 200) return false;
    if (board.startsWith('gauntlet-') && Math.abs(points - timer / 1000 * count) > 1 + count / 2000) return false;
    if (i === 0 && (clock !== 0 || timer !== 0 || level !== 1 || points !== 0 || count !== 0)) return false;
    if (i > 0 && i < rows.length - 1 && (clock < i * PERIOD - 1 || clock > i * PERIOD + 200)) return false;
    if (previous && (clock < previous[0] || clock - previous[0] > PERIOD + 200 ||
        level < previous[2] || count - previous[4] > 1000 + (clock - previous[0]) * 20)) return false;
    hash = checksum(hash, row.slice(0, -1));
    if (hash !== link) return false;
    previous = row;
  }
  return previous[1] === Math.round(time * 1000) && previous[2] === stage && previous[3] === score && previous[4] === kills;
}
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export async function replayScores(req, env, url, { json }) {
  if (url.pathname !== '/replay-scores') return null;
  const db = env.TELEMETRY;
  if (!db) return json({ error: 'storage unavailable' }, 503);
  if (req.method === 'GET') {
    const board = url.searchParams.get('board') || '';
    if (!boardPattern.test(board)) return json({ error: 'bad board' }, 400);
    const list = await db.prepare('SELECT hero AS name, score, stage, kills, time, date FROM replay_score WHERE board=? ORDER BY score DESC, receipt LIMIT 20').bind(board).all();
    return json({ scores: list.results });
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let b;
  try { b = await readBody(req, 512 * 1024); }
  catch (e) { return json({ error: 'invalid body' }, e.status ?? 400); }
  if (!verifyReplay(b)) return json({ error: 'bad replay' }, 400);
  const { board, score, stage, kills, time, replay } = b;
  const receipt = await digest(JSON.stringify([board, replay.build, replay.seed, replay.hero, replay.rows]));
  const limiter = 'replay:limit:' + await digest(req.headers.get('CF-Connecting-IP') ?? 'unknown');
  if (await env.SCORES.get(limiter)) return json({ error: 'slow down' }, 429);
  await env.SCORES.put(limiter, '1', { expirationTtl: 60 });
  const rank = db.prepare('SELECT 1+COUNT(*) AS rank FROM replay_score WHERE board=? AND (score>? OR (score=? AND receipt<?))').bind(board, score, score, receipt);
  // D1 batch is transactional. A replay received twice or two simultaneous finishes cannot duplicate or lose a row.
  const [, placement] = await db.batch([
    db.prepare('INSERT OR IGNORE INTO replay_score VALUES(?,?,?,?,?,?,?,?)').bind(board, receipt, replay.hero, score, stage, kills, Math.round(time), new Date().toISOString().slice(0,10)),
    rank,
    db.prepare('DELETE FROM replay_score WHERE board=? AND receipt IN (SELECT receipt FROM replay_score WHERE board=? ORDER BY score DESC, receipt LIMIT -1 OFFSET 100)').bind(board, board),
  ]);
  try { await contribute(db, b, goalWeek().start); } catch { /* The score has already been banked. */ }
  const place = placement.results[0].rank;
  return json({ rank: place <= 100 ? place : 0 });
}
