// Count the kills already included in host score submissions. A receipt contains only
// numeric run results and the board, never the pilot name, IP or a tracking identifier.
import leaderboard from './worker.js';
import { readBody } from './validation.js';

const day = 86400000;
const target = 1000000;
export function goalWeek(now = Date.now()) {
  const start = Math.floor((now - 4 * day) / (7 * day)) * 7 * day + 4 * day;
  return { start, ends: start + 7 * day };
}
export function goalCredit(kills, seconds) {
  if (!Number.isSafeInteger(kills) || kills <= 0 || !Number.isFinite(seconds) || seconds < 10)
    return 0;
  return Math.min(kills, Math.floor(seconds * 16), 5000);
}

const schema = new WeakMap();
async function ready(db) {
  let work = schema.get(db);
  if (!work) {
    work = db
      .prepare(
        `CREATE TABLE IF NOT EXISTS world_goal (
      week INTEGER NOT NULL, receipt TEXT NOT NULL, kills INTEGER NOT NULL,
      PRIMARY KEY (week, receipt)) WITHOUT ROWID`,
      )
      .run()
      .then(() =>
        db
          .prepare(
            `CREATE TRIGGER IF NOT EXISTS world_goal_tally AFTER INSERT ON world_goal
        WHEN NEW.receipt <> '' BEGIN
        INSERT INTO world_goal (week, receipt, kills) VALUES (NEW.week, '', NEW.kills)
        ON CONFLICT(week, receipt) DO UPDATE SET kills=MIN(kills + NEW.kills, ${target});
        END`,
          )
          .run(),
      );
    schema.set(db, work);
  }
  try {
    await work;
  } catch (error) {
    schema.delete(db);
    throw error;
  }
}
async function contribute(db, score, week) {
  const count = goalCredit(score.kills, score.time);
  if (!count) return;
  const values = [score.board, score.score, score.stage, score.kills, score.time];
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(values)),
  );
  const receipt = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  await ready(db);
  // A single SQLite statement serializes simultaneous finishes and makes a replay a no-op.
  await db
    .prepare(
      `INSERT OR IGNORE INTO world_goal (week,receipt,kills)
    SELECT ?,?,? WHERE COALESCE((SELECT kills FROM world_goal WHERE week=? AND receipt=''),0) < ?`,
    )
    .bind(week, receipt, count, week, target)
    .run();
  await db.prepare('DELETE FROM world_goal WHERE week < ?').bind(week).run();
}

// The route API has no after-submit hook. Delegate the bounded POST to the normal
// score handler once, then account only its accepted body. The marker is internal
// request identity and cannot be supplied by an HTTP client.
const scoring = new WeakSet();
export async function goals(req, env, url, { json }) {
  const db = env.TELEMETRY;
  if (url.pathname === '/scores' && req.method === 'POST' && db && !scoring.has(req)) {
    let score;
    try {
      score = await readBody(req);
    } catch (error) {
      return json({ error: error.status === 413 ? 'too big' : 'bad json' }, error.status ?? 400);
    }
    const submission = new Request(req, { body: JSON.stringify(score) });
    scoring.add(submission);
    try {
      const response = await leaderboard.fetch(submission, env);
      if (response.ok) {
        try {
          await contribute(db, score, goalWeek().start);
        } catch {
          /* Goal storage is optional. The accepted leaderboard rank still stands. */
        }
      }
      return response;
    } finally {
      scoring.delete(submission);
    }
  }
  if (url.pathname !== '/goals') return null;
  if (req.method !== 'GET') return json({ error: 'method' }, 405);
  if (!db) return json({ error: 'storage unavailable' }, 503);
  const { start, ends } = goalWeek();
  await ready(db);
  const row = await db
    .prepare("SELECT kills FROM world_goal WHERE week=? AND receipt=''")
    .bind(start)
    .first();
  const total = row?.kills ?? 0;
  return json({ target, total, ends, unlocked: total === target });
}
