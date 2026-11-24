// Each accepted floor has one winner per UTC week. D1 arbitrates concurrent claims.
import { readBody } from './validation.js';

const day = 86400000;
const starts = new Map();
function monday(now) {
  return Math.floor((now - 4 * day) / (7 * day)) * 7 * day + 4 * day;
}
function weekId(start) {
  const thursday = new Date(start + 3 * day);
  const year = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / day + 1) / 7);
  return year + '-W' + String(week).padStart(2, '0');
}

export async function abyssRoute(req, env, url, { json }) {
  if (url.pathname !== '/abyss') return null;
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'method' }, 405);
  const db = env.TELEMETRY;
  if (!db) return json({ error: 'unavailable' }, 503);
  const now = Date.now(),
    week = monday(now);
  if (req.method === 'GET') {
    const rows = await db
      .prepare('SELECT floor, pilot FROM abyss_first WHERE week=? ORDER BY floor DESC LIMIT 30')
      .bind(week)
      .all();
    return json({ week: weekId(week), rows: rows.results });
  }
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  let body;
  try {
    body = await readBody(req, 256);
  } catch (e) {
    return json({ error: 'body' }, e.status ?? 400);
  }
  if (body.start === weekId(week)) {
    if (now - (starts.get(ip) ?? 0) < 10000) return json({ error: 'slow down' }, 429);
    if (starts.size >= 4096) starts.delete(starts.keys().next().value);
    starts.set(ip, now);
    const ticket = crypto.randomUUID();
    const pilot = crypto.randomUUID().slice(0, 6).toUpperCase();
    await db.batch([
      db.prepare('DELETE FROM abyss_run WHERE week < ?').bind(week),
      db.prepare('DELETE FROM abyss_first WHERE week < ?').bind(week),
      db
        .prepare('INSERT INTO abyss_run(ticket,week,start,pilot,reached) VALUES (?,?,?,?,?)')
        .bind(ticket, week, now, pilot, now),
    ]);
    return json({ ticket, pilot });
  }
  if (
    typeof body.ticket !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(body.ticket) ||
    !Number.isSafeInteger(body.floor) ||
    body.floor < 2 ||
    body.floor > 13441
  )
    return json({ error: 'invalid claim' }, 400);
  // A run cannot predate this week or reach floor N faster than (N-1)*45s.
  // Allow a fixed 3s for delivery of the opening ticket.
  const latestStart = now - (body.floor - 1) * 45000 + 3000;
  // Keep the checkpoint and any first claim atomic. A lost request may skip a
  // floor after the corresponding survival time. Old claims cannot be backfilled.
  const eligible = 'ticket=? AND week=? AND start<=? AND floor<? AND reached+(?-floor)*45000<=?';
  const args = [body.ticket, week, latestStart, body.floor, body.floor, now + 3000];
  const [, update] = await db.batch([
    db
      .prepare(
        'INSERT OR IGNORE INTO abyss_first(week,floor,pilot) SELECT week,?,pilot FROM abyss_run WHERE ' +
          eligible,
      )
      .bind(body.floor, ...args),
    db
      .prepare('UPDATE abyss_run SET floor=?,reached=? WHERE ' + eligible)
      .bind(body.floor, now, ...args),
  ]);
  if (!update.meta.changes) {
    const repeat = await db
      .prepare('SELECT 1 FROM abyss_run WHERE ticket=? AND week=? AND floor=?')
      .bind(body.ticket, week, body.floor)
      .first();
    if (!repeat) return json({ error: 'unearned floor' }, 422);
  }
  return json({ floor: body.floor });
}
