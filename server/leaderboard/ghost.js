// Help ghosts (coop2 lane): share a friend's "help ghost" with a short code.
//
//   POST /ghost          <- { ghost: { name, hero, color, look, level, stage, boss, kit, date } }
//                        -> { code } (6 characters, kept 30 days)
//   GET  /ghost?code=XXXXXX -> { ghost }
//
// A ghost is a tiny build summary (name, hero, colours, kit ids, level, where they fell).
// The game also shares ghosts offline as a GHOST1- code or a file, so this is only a convenience.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TTL = 60 * 60 * 24 * 30;
const ID = /^[a-z0-9_]{1,24}$/;

function makeCode() {
  let s = '';
  const r = new Uint8Array(6);
  crypto.getRandomValues(r);
  for (const b of r) s += ALPHABET[b % ALPHABET.length];
  return s;
}

function cleanGhost(g, clean) {
  if (!g || typeof g !== 'object') return null;
  const level = Math.floor(Number(g.level));
  const stage = Math.floor(Number(g.stage));
  if (!(level >= 1 && level <= 999 && stage >= 1 && stage <= 999)) return null;
  return {
    v: 1,
    name: clean(g.name),
    hero: ID.test(String(g.hero)) ? String(g.hero) : 'rookie',
    color: /^#[0-9a-f]{6}$/i.test(String(g.color)) ? String(g.color) : '#73eff7',
    look: String(g.look ?? '---00').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8),
    level,
    stage,
    boss: String(g.boss ?? 'a boss').replace(/[^\p{L}\p{N} _.'!-]/gu, '').slice(0, 24),
    kit: (Array.isArray(g.kit) ? g.kit : []).map(String).filter((k) => ID.test(k)).slice(0, 7),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(g.date)) ? String(g.date) : '',
  };
}

export async function ghostRoute(req, env, url, { json, clean }) {
  if (url.pathname !== '/ghost') return null;
  if (req.method === 'GET') {
    const code = String(url.searchParams.get('code') ?? '').toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) return json({ error: 'bad code' }, 400);
    const ghost = await env.SCORES.get(`ghost:${code}`, 'json');
    return ghost ? json({ ghost }) : json({ error: 'not found' }, 404);
  }
  if (req.method === 'POST') {
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    const n = Number((await env.SCORES.get(`ghostip:${ip}`)) ?? 0);
    if (n >= 10) return json({ error: 'slow down' }, 429);
    await env.SCORES.put(`ghostip:${ip}`, String(n + 1), { expirationTtl: 3600 });
    let body;
    try {
      const text = await req.text();
      if (text.length > 2000) return json({ error: 'too big' }, 400);
      body = JSON.parse(text);
    } catch {
      return json({ error: 'bad json' }, 400);
    }
    const ghost = cleanGhost(body?.ghost, clean);
    if (!ghost) return json({ error: 'bad ghost' }, 400);
    let code = makeCode();
    for (let i = 0; i < 3 && (await env.SCORES.get(`ghost:${code}`)); i++) code = makeCode();
    await env.SCORES.put(`ghost:${code}`, JSON.stringify(ghost), { expirationTtl: TTL });
    return json({ code });
  }
  return json({ error: 'method' }, 405);
}
