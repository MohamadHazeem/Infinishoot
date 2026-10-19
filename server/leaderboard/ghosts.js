// Weekly ghost board (modes lane): players upload their weekly run's ghost and race other people's.
//
//   GET  /ghosts?week=<YYYY-Www>           -> { ghosts: [{ id, name, score, stage, time }] } (best first, top 10)
//   GET  /ghosts?week=<YYYY-Www>&id=<id>   -> { code }
//   POST /ghosts  <- { week, name, score, stage, time, code } -> { rank } (1-based, 0 if it missed the board)
//
// KV: `ghosts:<week>` holds the board (metadata only); each ghost's code is `ghost:<week>:<id>` and
// expires after 60 days. Codes are the game's share codes ("ISG1." / "ISG1z." + base64url), checked
// for shape and size only. One upload per IP per minute.

const WEEK_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const CODE_RE = /^ISG1z?\.[A-Za-z0-9_-]+$/;
const KEEP = 10;
const MAX_CODE = 200000;
const TTL = 60 * 24 * 3600;

export async function ghostsRoute(req, env, url, { json, clean }) {
  if (url.pathname !== '/ghosts') return null;
  const week = req.method === 'GET' ? url.searchParams.get('week') ?? '' : '';
  if (req.method === 'GET') {
    if (!WEEK_RE.test(week)) return json({ error: 'bad week' }, 400);
    const id = url.searchParams.get('id');
    if (id) {
      if (!/^[a-z0-9]{6,16}$/.test(id)) return json({ error: 'bad id' }, 400);
      const code = await env.SCORES.get(`ghost:${week}:${id}`);
      return code ? json({ code }) : json({ error: 'gone' }, 404);
    }
    const list = (await env.SCORES.get(`ghosts:${week}`, 'json')) ?? [];
    return json({ ghosts: list });
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (await env.SCORES.get(`gip:${ip}`)) return json({ error: 'slow down' }, 429);
  await env.SCORES.put(`gip:${ip}`, '1', { expirationTtl: 60 });
  let b;
  try {
    b = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const w = String(b.week ?? '');
  const code = String(b.code ?? '');
  const score = Math.floor(Number(b.score));
  const stage = Math.floor(Number(b.stage));
  const time = Number(b.time);
  if (!WEEK_RE.test(w)) return json({ error: 'bad week' }, 400);
  if (!CODE_RE.test(code) || code.length > MAX_CODE) return json({ error: 'bad ghost' }, 400);
  if (!(score >= 0 && stage >= 1 && stage < 200 && time > 0 && time < 86400)) return json({ error: 'bad run' }, 400);
  const id = Math.random().toString(36).slice(2, 12).padEnd(8, '0');
  const entry = { id, name: clean(b.name), score, stage, time: Math.round(time) };
  const list = (await env.SCORES.get(`ghosts:${w}`, 'json')) ?? [];
  list.push(entry);
  list.sort((x, y) => y.score - x.score || y.stage - x.stage || x.time - y.time);
  const rank = list.indexOf(entry) + 1;
  if (rank > KEEP) return json({ rank: 0 });
  await env.SCORES.put(`ghost:${w}:${id}`, code, { expirationTtl: TTL });
  await env.SCORES.put(`ghosts:${w}`, JSON.stringify(list.slice(0, KEEP)));
  return json({ rank });
}
