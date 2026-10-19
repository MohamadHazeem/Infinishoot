// Public lobby list (PLAY ONLINE > BROWSE). Hosts that mark their lobby PUBLIC
// register it here and send a heartbeat every ~45 s; a lobby that misses its
// heartbeats drops off after TTL seconds (KV expiry plus an `exp` stamp, since
// KV expiry and list() are only eventually consistent).
//
//   GET  /lobbies?region=EU&difficulty=normal&mode=coop&version=1.6.0
//        -> { lobbies: [{ code, name, players, max, mode, difficulty, region, version }] }
//   POST /lobbies  <- { code, token, name, players, max, mode, difficulty, region, version }   (register / heartbeat)
//   POST /lobbies  <- { code, token, close: true }                                            (unlist)
//        -> { ok: true, ttl } | { error }
//
// The token is a random string the host picks; only the same token can refresh
// or close a code. Joining still goes through the invite code and WebRTC: this
// is only a directory.

export const LOBBY_TTL = 120; // seconds without a heartbeat before a lobby disappears
const MIN_BEAT = 8; // seconds between two writes for the same lobby
const MAX_LIST = 50;
const CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;
const TOKEN_RE = /^[a-z0-9]{8,40}$/;
const MODES = ['coop', 'pvp', 'versus', 'weekly'];
const DIFFS = ['easy', 'normal', 'hard', 'nightmare'];
const REGIONS = ['EU', 'NA', 'SA', 'AS', 'OC', 'AF', 'ME'];
const NEW_PER_IP = 6; // new lobbies per IP per 10 minutes

export async function lobbies(req, env, url, { json, clean }) {
  if (url.pathname !== '/lobbies') return null;
  const kv = env.SCORES;
  const now = Date.now();

  if (req.method === 'GET') {
    const p = url.searchParams;
    const want = { region: p.get('region') ?? '', difficulty: p.get('difficulty') ?? '', mode: p.get('mode') ?? '', version: p.get('version') ?? '' };
    const rows = [];
    let cursor;
    // Lobby metadata rides on the KV keys, so one list() call reads the directory (no per-lobby get).
    for (let page = 0; page < 3; page++) {
      const res = await kv.list({ prefix: 'lobby:', cursor });
      for (const k of res.keys) {
        const m = k.metadata;
        if (!m || !(m.exp > now) || m.players >= m.max) continue;
        if (want.region && m.region !== want.region) continue;
        if (want.difficulty && m.difficulty !== want.difficulty) continue;
        if (want.mode && m.mode !== want.mode) continue;
        rows.push(m);
      }
      if (res.list_complete || !res.cursor) break;
      cursor = res.cursor;
    }
    // Same version first (different versions can't play together), then the fullest, then the newest.
    rows.sort((a, b) => (b.version === want.version) - (a.version === want.version) || b.players - a.players || b.t - a.t);
    return json({ lobbies: rows.slice(0, MAX_LIST).map(({ code, name, players, max, mode, difficulty, region, version }) => ({ code, name, players, max, mode, difficulty, region, version })) });
  }

  if (req.method === 'POST') {
    let b;
    try {
      b = await req.json();
    } catch {
      return json({ error: 'bad json' }, 400);
    }
    const code = String(b.code ?? '').toUpperCase();
    const token = String(b.token ?? '');
    if (!CODE_RE.test(code) || !TOKEN_RE.test(token)) return json({ error: 'bad lobby' }, 400);
    const key = `lobby:${code}`;
    const old = await kv.get(key, 'json');
    if (old && old.token !== token) return json({ error: 'code taken' }, 409);
    if (b.close) {
      if (old) await kv.delete(key);
      return json({ ok: true });
    }
    const players = Math.floor(Number(b.players));
    const max = Math.floor(Number(b.max));
    const mode = String(b.mode ?? '');
    const difficulty = String(b.difficulty ?? '');
    const region = String(b.region ?? '');
    if (!(max >= 2 && max <= 8 && players >= 1 && players <= max) || !MODES.includes(mode) || !DIFFS.includes(difficulty) || !REGIONS.includes(region)) return json({ error: 'bad lobby' }, 400);
    if (old && now - (old.beat ?? 0) < MIN_BEAT * 1000) return json({ error: 'slow down' }, 429);
    if (!old) {
      // Only brand-new lobbies count against the IP (heartbeats don't cost an extra write).
      const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
      const n = Number((await kv.get(`lip:${ip}`)) ?? 0);
      if (n >= NEW_PER_IP) return json({ error: 'slow down' }, 429);
      await kv.put(`lip:${ip}`, String(n + 1), { expirationTtl: 600 });
    }
    const meta = { code, name: clean(b.name), players, max, mode, difficulty, region, version: String(b.version ?? '').slice(0, 16), exp: now + LOBBY_TTL * 1000, t: old?.t ?? now };
    await kv.put(key, JSON.stringify({ ...meta, token, beat: now }), { expirationTtl: LOBBY_TTL, metadata: meta });
    return json({ ok: true, ttl: LOBBY_TTL });
  }

  return json({ error: 'method' }, 405);
}
