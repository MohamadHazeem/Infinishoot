// Weekly co-op challenge: one team board per ISO week.
//
//   GET  /teamboard?week=2026-W43  -> { teams: [{ team, members, score, stage, date }] } (top 20)
//   POST /teamboard                <- { week, team, members, score, stage, kills, time, version }
//                                  -> { rank } (1-based, 0 if it missed the top 100)
//
// A team is its name plus its members (so two groups that pick the same name
// don't overwrite each other); each team keeps only its best run of the week.
// Same plausibility checks and one-post-per-minute-per-IP limit as /scores.

const KEEP = 100;
const SHOW = 20;
const WEEK_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

function cleanTeam(name) {
  return (
    String(name ?? '')
      .replace(/[^\p{L}\p{N} _.'-]/gu, '')
      .trim()
      .slice(0, 16) || 'Team'
  );
}

export async function teamboard(req, env, url, { json, clean }) {
  if (url.pathname !== '/teamboard') return null;
  const kv = env.SCORES;

  if (req.method === 'GET') {
    const week = url.searchParams.get('week') ?? '';
    if (!WEEK_RE.test(week)) return json({ error: 'bad week' }, 400);
    const list = (await kv.get(`team:${week}`, 'json')) ?? [];
    return json({ teams: list.slice(0, SHOW).map(({ team, members, score, stage, date }) => ({ team, members, score, stage, date })) });
  }

  if (req.method === 'POST') {
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (await kv.get(`tip:${ip}`)) return json({ error: 'slow down' }, 429);
    await kv.put(`tip:${ip}`, '1', { expirationTtl: 60 });
    let b;
    try {
      b = await req.json();
    } catch {
      return json({ error: 'bad json' }, 400);
    }
    const week = String(b.week ?? '');
    const score = Math.floor(Number(b.score));
    const stage = Math.floor(Number(b.stage));
    const kills = Math.floor(Number(b.kills));
    const time = Number(b.time);
    const members = Array.isArray(b.members) ? b.members.slice(0, 4).map((m) => clean(m)) : [];
    if (!WEEK_RE.test(week)) return json({ error: 'bad week' }, 400);
    if (members.length < 2) return json({ error: 'a team needs 2+ players' }, 400);
    if (!(score > 0 && stage >= 1 && stage < 200 && kills >= 0 && time > 0 && time < 86400)) return json({ error: 'bad score' }, 400);
    if (score > (kills + 50) * 40 * stage * 3 * members.length) return json({ error: 'implausible' }, 400);

    const team = cleanTeam(b.team);
    const id = `${team.toLowerCase()}|${members.map((m) => m.toLowerCase()).sort().join(',')}`;
    const key = `team:${week}`;
    const list = (await kv.get(key, 'json')) ?? [];
    let entry = list.find((e) => e.id === id);
    if (entry && entry.score >= score) {
      list.sort((x, y) => y.score - x.score);
      return json({ rank: list.indexOf(entry) + 1, best: entry.score });
    }
    if (entry) list.splice(list.indexOf(entry), 1);
    entry = { id, team, members, score, stage, kills, time: Math.round(time), date: new Date().toISOString().slice(0, 10) };
    list.push(entry);
    list.sort((x, y) => y.score - x.score);
    const rank = list.indexOf(entry) + 1;
    await kv.put(key, JSON.stringify(list.slice(0, KEEP)));
    return json({ rank: rank <= KEEP ? rank : 0 });
  }

  return json({ error: 'method' }, 405);
}
