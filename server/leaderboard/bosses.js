// One ballot per anonymous installation and design per UTC week. Ranking uses the previous
// completed week, so a route stays stable from Monday to Monday. D1 serializes ballot edits.
import { decodeBoss, maxBossCode } from '../../src/game/bossMakerCode.ts';
import { readBody } from './validation.js';

const weekMs = 7 * 86400000;
export const bossWeek = (ms = Date.now()) => Math.floor((ms - 4 * 86400000) / weekMs);
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function bosses(req, env, url, { json }) {
  if (!['/bosses', '/bosses/rate', '/bosses/weekly'].includes(url.pathname)) return null;
  const db = env.TELEMETRY,
    week = bossWeek();
  if (!db) return json({ error: 'offline' }, 503);
  if (req.method === 'GET' && url.pathname !== '/bosses/rate') {
    const weekly = url.pathname.endsWith('/weekly');
    const page = Number(url.searchParams.get('page') ?? 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 10000 || (weekly && page))
      return json({ error: 'page' }, 400);
    const rows = await db
      .prepare(
        `SELECT d.id, d.code, COUNT(v.stars) AS votes,
      COALESCE(ROUND(AVG(v.stars), 2), 0) AS rating FROM maker_design d
      ${weekly ? 'JOIN' : 'LEFT JOIN'} maker_vote v ON v.design=d.id AND v.week=?
      GROUP BY d.id ORDER BY rating DESC, votes DESC, d.published DESC, d.id LIMIT ? OFFSET ?`,
      )
      .bind(weekly ? week - 1 : week, weekly ? 3 : 30, page * 30)
      .all();
    return json({ week, designs: rows.results });
  }
  if (req.method !== 'POST' || url.pathname.endsWith('/weekly'))
    return json({ error: 'method' }, 405);
  let body;
  try {
    body = await readBody(req, maxBossCode + 200);
  } catch (e) {
    return json({ error: 'body' }, e.status ?? 400);
  }
  const vote = url.pathname.endsWith('/rate');
  if (
    vote
      ? !(
          typeof body.id === 'string' &&
          /^[a-f0-9]{24}$/.test(body.id) &&
          typeof body.ballot === 'string' &&
          /^[a-f0-9]{32}$/.test(body.ballot) &&
          Number.isInteger(body.stars) &&
          body.stars >= 1 &&
          body.stars <= 5
        )
      : !decodeBoss(body.code)
  )
    return json({ error: 'invalid' }, 400);
  // Short-lived, hour-scoped cooldown. Neither raw addresses nor installation tokens go into storage.
  const bucket = await digest(
    [
      'maker',
      Math.floor(Date.now() / 3600000),
      req.headers.get('CF-Connecting-IP') ?? 'local',
      vote,
    ].join('|'),
  );
  const throttle = 'maker:cool:' + bucket;
  if (await env.SCORES.get(throttle)) return json({ error: 'slow down' }, 429);
  if (vote && !(await db.prepare('SELECT id FROM maker_design WHERE id=?').bind(body.id).first()))
    return json({ error: 'unknown design' }, 404);
  await env.SCORES.put(throttle, '1', { expirationTtl: 60 });
  if (vote) {
    const voter = await digest([week, body.id, body.ballot].join('|'));
    await db
      .prepare(
        `INSERT INTO maker_vote (week,design,voter,stars) VALUES (?,?,?,?)
      ON CONFLICT(week,design,voter) DO UPDATE SET stars=excluded.stars`,
      )
      .bind(week, body.id, voter, body.stars)
      .run();
    return json({ ok: true });
  }
  const id = (await digest(body.code)).slice(0, 24);
  await db
    .prepare('INSERT OR IGNORE INTO maker_design (id,code,published) VALUES (?,?,?)')
    .bind(id, body.code, Date.now())
    .run();
  return json({ id });
}
