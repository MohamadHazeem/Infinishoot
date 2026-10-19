/**
 * Race lane pure rules: race standings and progress, challenge codes,
 * tournament brackets, ranked ratings and seasons, save migration, the
 * /ranked worker route and the ladder client.
 */
import { ok } from './check';
import {
  raceProgress,
  standings,
  raceOver,
  rowLabel,
  cleanRow,
  encodeChallenge,
  decodeChallenge,
  codeName,
  createTourney,
  nextMatch,
  recordWin,
  recordTurn,
  turnWinner,
  autoRecord,
  matchSeed,
  cleanTourney,
  roundName,
  type RaceRow,
  type Challenge,
} from '../src/game/raceRules';
import { expected, matchDelta, applyMatch, rollSeason, freshRanked, normalizeRanked, tierOf, toNextTier, seasonId, seasonName, rankedTuning, RANK_TIERS, rankBadge } from '../src/data/ranked';

// ---------------------------------------------------------------- race standings
ok(raceProgress(0, 240, -1, false) === 0, 'progress starts at 0');
ok(Math.abs(raceProgress(120, 240, -1, false) - 0.4995) < 1e-6, 'half the timer is ~0.5');
ok(raceProgress(999, 240, -1, false) < 1, 'the timer alone never reaches the boss band');
ok(raceProgress(240, 240, 1, false) === 1, 'a fresh boss is 1');
ok(Math.abs(raceProgress(240, 240, 0.25, false) - (1 + 0.75 * 0.999)) < 1e-6, 'boss at 25% life is ~1.75');
ok(raceProgress(240, 240, 0, true) === 2, 'finished is 2');

const row = (n: string, p: number, s: RaceRow['s'], t = 0): RaceRow => ({ n, c: '#fff', p, s, t, b: -1, lv: 1, r: -1 });
const st = standings([row('slow', 2, 'done', 300), row('fast', 2, 'done', 250), row('boss', 1.5, 'boss'), row('ko', 1.5, 'ko', 200), row('early', 0.3, 'run'), row('ko2', 0.3, 'ko', 100), row('ko3', 0.3, 'ko', 150)]);
ok(st.map((x) => x.row.n).join() === 'fast,slow,boss,ko,early,ko3,ko2', 'standings: finish time, progress, standing over K.O., longer K.O. first: ' + st.map((x) => x.row.n).join());
ok(st.map((x) => x.place).join() === '1,2,3,4,5,6,7', 'places count up');
const tie = standings([row('a', 0.5, 'run'), row('b', 0.5, 'run'), row('c', 0.2, 'run')]);
ok(tie[0].place === 1 && tie[1].place === 1 && tie[2].place === 3, 'equal progress shares a place');
ok(!raceOver([row('a', 0.5, 'run'), row('b', 1.2, 'boss')], 100), 'race goes on');
ok(raceOver([row('a', 0.5, 'run'), row('b', 2, 'done', 90)], 100), 'a finish ends the race');
ok(raceOver([row('a', 0.5, 'ko'), row('b', 1, 'left')], 100), 'nobody left racing ends it');
ok(raceOver([row('a', 0.5, 'run')], 420, 420), 'the clock ends it');
ok(!raceOver([], 9999), 'no racers, no end');
ok(rowLabel(row('a', 2, 'done', 262)) === 'FINISHED 4:22', 'label: finished');
ok(rowLabel({ ...row('a', 1.4, 'boss'), b: 0.6 }) === 'BOSS 60% LEFT', 'label: boss');
ok(rowLabel(row('a', 0.42, 'run')) === 'STAGE 42%', 'label: stage');
ok(rowLabel(row('a', 1.5, 'ko')) === 'K.O. · BOSS 50% DOWN', 'label: K.O. with progress');
const dirty = cleanRow({ n: '<b>Evil</b>\u0007name-that-is-long', c: 'red;background:url(x)', p: 99, s: 'hax', t: -5, b: 7, lv: 1e9, r: 'x' });
ok(!!dirty && !/[<>]/.test(dirty.n) && dirty.n.length <= 12 && dirty.c === '#f4f4f4' && dirty.p === 2 && dirty.s === 'run' && dirty.t === 0 && dirty.b === 1 && dirty.lv === 999 && dirty.r === -1, 'wire rows are cleaned: ' + JSON.stringify(dirty));
ok(cleanRow(null) === null && cleanRow('x') === null, 'junk rows are dropped');

// ---------------------------------------------------------------- challenge codes
const ch: Challenge = { seed: 3141592653, mode: 'endless', difficulty: 'hard', hero: 'ace', loadout: { primary: 'scatter', secondary: 'grenade', special: 'storm' }, score: 1234567, stage: 5, name: 'Lina Q.' };
const code = encodeChallenge(ch);
ok(code.startsWith('IS1.') && code.length < 90, 'code is short: ' + code);
const back = decodeChallenge(`  my code: ${code}\n `);
ok(back.seed === ch.seed && back.mode === 'endless' && back.difficulty === 'hard' && back.hero === 'ace' && back.loadout.special === 'storm' && back.score === ch.score && back.stage === 5 && back.name === 'Lina Q', 'round trip (surrounding text ignored): ' + JSON.stringify(back));
const throws = (s: string, re: RegExp) => {
  try {
    decodeChallenge(s);
    return false;
  } catch (e) {
    return re.test((e as Error).message);
  }
};
ok(throws('hello', /NOT A CHALLENGE/), 'not a code');
ok(throws(code.replace('.ace.', '.acf.'), /DAMAGED/), 'a changed letter fails the check');
ok(throws(code.slice(0, code.lastIndexOf('.')), /INCOMPLETE|DAMAGED/), 'a cut code fails');
const bad = encodeChallenge({ ...ch, hero: 'nobody' });
ok(throws(bad, /HERO/), 'unknown hero is refused');
ok(throws(encodeChallenge({ ...ch, loadout: { ...ch.loadout, primary: 'banana' } }), /WEAPON/), 'unknown weapon is refused');
ok(codeName('  Ünïcode Name!! ') === 'Unicode_Name', 'names are made code-safe: ' + codeName('  Ünïcode Name!! '));
ok(decodeChallenge(encodeChallenge({ ...ch, seed: 0, score: 0 })).seed === 0, 'seed 0 survives');

// ---------------------------------------------------------------- tournament
let thrown = '';
try {
  createTourney(['a', 'b', 'c'], 'race', 1);
} catch (e) {
  thrown = (e as Error).message;
}
ok(/4 TO 8/.test(thrown), 'too few players refused');
try {
  createTourney(['a', 'b', 'A', 'd'], 'race', 1);
  thrown = '';
} catch (e) {
  thrown = (e as Error).message;
}
ok(/DIFFERENT NAME/.test(thrown), 'duplicate names refused');
const t4 = createTourney(['A', 'B', 'C', 'D'], 'pvp', 5);
ok(t4.rounds.length === 2 && t4.rounds[0].length === 2 && t4.rounds[0][0].a === 0 && t4.rounds[0][0].b === 3 && t4.rounds[0][1].a === 1 && t4.rounds[0][1].b === 2, '4 players: 1v4, 2v3');
ok(roundName(t4, 0) === 'SEMI-FINALS' && roundName(t4, 1) === 'FINAL', 'round names');
let nm = nextMatch(t4)!;
ok(nm.round === 0 && nm.match === 0, 'first match first');
recordWin(t4, 0, 0, 3);
recordWin(t4, 0, 0, 0); // already decided: ignored
ok(t4.rounds[0][0].w === 3 && t4.rounds[1][0].a === 3, 'winner moves on, a second result is ignored');
recordWin(t4, 0, 1, 99);
ok(t4.rounds[0][1].w === -1, 'a winner who is not in the match is ignored');
recordWin(t4, 0, 1, 1);
nm = nextMatch(t4)!;
ok(nm.round === 1 && nm.m.a === 3 && nm.m.b === 1, 'final: D vs B');
recordWin(t4, 1, 0, 1);
ok(t4.champion === 1 && nextMatch(t4) === null, 'champion B, nothing left');

const t6 = createTourney(['s1', 's2', 's3', 's4', 's5', 's6'], 'race', 7);
ok(t6.rounds.length === 3 && t6.rounds[0].length === 4, '6 players: an 8 bracket');
const byes = t6.rounds[0].filter((m) => m.a < 0 || m.b < 0);
ok(byes.length === 2 && byes.every((m) => m.w >= 0), 'two byes, auto-advanced');
ok(t6.rounds[1].some((m) => m.a === 0 || m.b === 0) && t6.rounds[1].some((m) => m.a === 1 || m.b === 1), 'top seeds got the byes');
const n6 = nextMatch(t6)!;
ok(n6.m.a >= 0 && n6.m.b >= 0 && n6.round === 0, 'next is a real first-round match');
ok(matchSeed(t6, 0, 1) === matchSeed(t6, 0, 1) && matchSeed(t6, 0, 1) !== matchSeed(t6, 0, 3), 'match seeds stable and distinct');
ok(recordTurn(t6, n6.round, n6.match, 'a', { p: 1.4, t: 300, score: 20000 }) === null, 'one turn in: waiting');
const w6 = recordTurn(t6, n6.round, n6.match, 'b', { p: 2, t: 280, score: 15000 });
ok(w6 === n6.m.b && t6.rounds[0][n6.match].w === n6.m.b, 'boss down beats further-but-not-done');
ok(turnWinner({ p: 2, t: 250, score: 1 }, { p: 2, t: 260, score: 99 }) === 'a', 'both finished: faster wins');
ok(turnWinner({ p: 0.5, t: 420, score: 500 }, { p: 0.5, t: 420, score: 900 }) === 'b', 'same progress: score');
ok(turnWinner({ p: 0.5, t: 420, score: 5 }, { p: 0.5, t: 420, score: 5 }) === 'a', 'dead heat: higher seed');
const nx = nextMatch(t6)!;
const names = [t6.names[nx.m.a], t6.names[nx.m.b]];
ok(autoRecord(t6, 'stranger', [...names, 'stranger']) === null, 'auto record: winner must be in the match');
ok(autoRecord(t6, names[1].toUpperCase(), ['x', ...names]) !== null && t6.rounds[nx.round][nx.match].w === nx.m.b, 'auto record from an online result (case-insensitive)');
const re = cleanTourney(JSON.parse(JSON.stringify(t6)));
ok(!!re && JSON.stringify(re) === JSON.stringify(cleanTourney(t6)), 'stored tournament round-trips');
ok(cleanTourney({ ...t6, rounds: [[{ a: 99, b: 0, w: -1 }]] }) === null && cleanTourney(null) === null && cleanTourney({ kind: 'x' }) === null, 'broken stored tournaments are dropped');

// ---------------------------------------------------------------- ranked
ok(Math.abs(expected(1000, 1000) - 0.5) < 1e-9 && expected(1400, 1000) > 0.9, 'Elo expectation');
ok(matchDelta({ rating: 1000, place: 1 }, [{ rating: 1000, place: 2 }], 32) === 16, 'even duel win: +K/2');
ok(matchDelta({ rating: 1000, place: 2 }, [{ rating: 1000, place: 1 }], 32) === -16, 'even duel loss: -K/2');
ok(matchDelta({ rating: 1000, place: 1 }, [{ rating: 1000, place: 1 }], 32) === 0, 'even draw: 0');
const upset = matchDelta({ rating: 1000, place: 1 }, [{ rating: 1600, place: 2 }], 32);
const expectedWin = matchDelta({ rating: 1600, place: 1 }, [{ rating: 1000, place: 2 }], 32);
ok(upset > 28 && expectedWin < 3, `upsets move more (${upset}) than expected wins (${expectedWin})`);
const six = [1, 2, 3, 4, 5, 6].map((place) => ({ rating: 1000, place }));
const firstOfSix = matchDelta({ rating: 1000, place: 1 }, six.slice(1), 32);
const lastOfSix = matchDelta({ rating: 1000, place: 6 }, six.slice(0, 5), 32);
ok(firstOfSix === 16 && lastOfSix === -16, 'a 6-player race moves like one duel at the extremes');
ok(matchDelta({ rating: 1000, place: 1 }, [], 32) === 0, 'alone: no change');
// Zero-sum-ish: everyone's deltas in an even race sum to ~0.
const sum = six.reduce((s, me, i) => s + matchDelta(me, six.filter((_, j) => j !== i), 32), 0);
ok(Math.abs(sum) <= 3, 'even race is zero-sum (rounding): ' + sum);

ok(tierOf(0).id === 'bronze' && tierOf(1099).id === 'bronze' && tierOf(1100).id === 'silver' && tierOf(1750).id === 'legend' && tierOf(9999).id === 'legend', 'tiers by rating');
ok(RANK_TIERS.length === 6 && RANK_TIERS[0].name === 'Bronze' && RANK_TIERS[5].name === 'Legend', 'Bronze to Legend');
ok(toNextTier(1000).next?.id === 'silver' && toNextTier(1000).need === 100 && toNextTier(1800).next === null, 'next tier');
ok(seasonId(new Date(2026, 9, 20)) === '2026-10' && seasonName('2026-10') === 'October 2026', 'season ids by month');
ok(rankBadge(1300).includes('rk-gold') && rankBadge(1300).includes('1300') && !rankBadge(1300, false).includes('<b>'), 'badge markup');

const oct = new Date(2026, 9, 20);
const r = freshRanked(oct);
ok(r.rating === rankedTuning.start && r.season === '2026-10' && r.games === 0, 'fresh rating');
const res = applyMatch(r, { place: 1 }, [{ rating: 1000, place: 2 }], oct);
ok(res.delta === rankedTuning.kPlacement / 2 && r.games === 1 && r.wins === 1 && r.peak === r.rating, 'placement games use the bigger K: ' + res.delta);
for (let i = 0; i < 12; i++) applyMatch(r, { place: 1 }, [{ rating: 1000, place: 2 }], oct);
ok(r.games === 13 && r.rating > 1100 && tierOf(r.rating).id !== 'bronze', 'wins climb tiers: ' + r.rating);
const before = r.rating;
const loss = applyMatch(r, { place: 2 }, [{ rating: 1000, place: 1 }], oct);
ok(loss.delta < 0 && Math.abs(loss.delta) <= rankedTuning.k && r.peak === before, 'after placement, the normal K; the peak stays');
const nov = new Date(2026, 10, 2);
const ratingOct = r.rating;
ok(rollSeason(r, nov) && r.season === '2026-11' && r.games === 0 && r.history[0].season === '2026-10' && r.history[0].rating === ratingOct, 'new month archives the season');
ok(r.rating === Math.round(1000 + (ratingOct - 1000) * rankedTuning.carry), 'rating moves halfway back: ' + r.rating);
ok(!rollSeason(r, nov), 'same month: no roll');
applyMatch(r, { place: 1 }, [{ rating: 1000, place: 2 }], new Date(2027, 0, 5));
ok(r.season === '2027-01' && r.history.length === 1 && r.games === 1, 'an empty season (no games) is not archived');
for (let i = 0; i < 400; i++) applyMatch(r, { place: 2 }, [{ rating: 100, place: 1 }], new Date(2027, 0, 5));
ok(r.rating >= rankedTuning.floor, 'floor holds: ' + r.rating);

const mig = normalizeRanked(undefined, oct);
ok(mig.rating === 1000 && mig.history.length === 0 && mig.id === '', 'old saves get a fresh rating');
const junk = normalizeRanked({ id: 'BAD ID!', season: 'nope', rating: 'x', peak: -5, games: -1, wins: 50, history: [{ season: '2026-08', rating: 1300, peak: 1350, games: 9, wins: 4 }, { season: 'zzz' }, null] }, oct);
ok(junk.id === '' && junk.season === '2026-10' && junk.rating === 1000 && junk.games === 0 && junk.wins === 0 && junk.history.length === 1 && junk.history[0].rating === 1300, 'broken ranked fields are repaired: ' + JSON.stringify(junk));
const keep = normalizeRanked({ id: 'abc123xyz', season: '2026-09', rating: 1444, peak: 1500, games: 20, wins: 11, history: [] }, oct);
ok(keep.id === 'abc123xyz' && keep.season === '2026-09' && keep.rating === 1444 && keep.peak === 1500 && keep.wins === 11, 'valid ranked fields survive');

// ---------------------------------------------------------------- save migration
(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { normalize } = await import('../src/game/save');
const v6 = normalize({ version: 6, achievements: [], lifetime: { runs: 3, kills: 100 } });
ok(v6.ranked && v6.ranked.rating === 1000 && v6.version >= 7 && v6.lifetime.kills === 100, 'v6 save loads with a fresh rating');
const v7 = normalize({ version: 7, ranked: { season: '2026-10', rating: 1290, peak: 1300, games: 4, wins: 3, history: [] } });
ok(v7.ranked.rating === 1290 && v7.ranked.wins === 3, 'v7 keeps its rating');

// ---------------------------------------------------------------- worker route + ladder client
const { ranked } = await import('../server/leaderboard/ranked.js');
const kv = new Map<string, string>();
const env = { SCORES: { get: async (k: string, type?: string) => (kv.has(k) ? (type === 'json' ? JSON.parse(kv.get(k)!) : kv.get(k)) : null), put: async (k: string, v: string) => void kv.set(k, v) } };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
const clean = (s: unknown) => String(s ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 12) || 'Player';
let ip = 0;
const call = async (method: string, path: string, body?: unknown) => {
  const url = new URL('https://w.example' + path);
  const req = new Request(url, { method, headers: { 'CF-Connecting-IP': `1.1.1.${ip++}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const out = await ranked(req, env, url, { json, cors: {}, clean });
  return out ? { status: out.status, body: await out.json() } : null;
};
ok((await call('GET', '/scores')) === null, 'route ignores other paths');
ok((await call('GET', '/ranked?season=2026-13'))!.status === 400, 'bad season refused');
const p1 = await call('POST', '/ranked', { id: 'aaaaaa1', season: '2026-10', name: 'Lina', rating: 1210, games: 6, wins: 4 });
ok(p1!.status === 200 && p1!.body.rank === 1, 'post 1');
const p2 = await call('POST', '/ranked', { id: 'bbbbbb2', season: '2026-10', name: 'Omar', rating: 1300, games: 9, wins: 6 });
ok(p2!.body.rank === 1, 'higher rating goes first');
await call('POST', '/ranked', { id: 'aaaaaa1', season: '2026-10', name: 'Lina', rating: 1190, games: 7, wins: 4 });
const top = await call('GET', '/ranked?season=2026-10');
ok(top!.body.players.length === 2 && top!.body.players[0].name === 'Omar' && top!.body.players[1].rating === 1190 && !('id' in top!.body.players[0]), 'latest rating per save id, ids not shown: ' + JSON.stringify(top!.body));
ok((await call('POST', '/ranked', { id: 'cccccc3', season: '2026-10', name: 'X', rating: 3900, games: 2, wins: 2 }))!.status === 400, 'implausible jump refused');
ok((await call('POST', '/ranked', { id: 'cccccc3', season: '2026-10', name: 'X', rating: 1000, games: 2, wins: 3 }))!.status === 400, 'more wins than games refused');
ok((await call('POST', '/ranked', { id: 'no', season: '2026-10', name: 'X', rating: 1000, games: 2, wins: 1 }))!.status === 400, 'bad id refused');
ip = 0;
await call('POST', '/ranked', { id: 'dddddd4', season: '2026-10', name: 'Y', rating: 1000, games: 1, wins: 0 });
ip = 0;
ok((await call('POST', '/ranked', { id: 'dddddd4', season: '2026-10', name: 'Y', rating: 1000, games: 1, wins: 0 }))!.status === 429, 'one post per 20 s per IP');
ok((await call('DELETE', '/ranked'))!.status === 405, 'other methods 405');

const { RankedLadder } = await import('../src/net/rankedBoard');
const off = new RankedLadder('');
ok(!off.enabled && (await off.top('2026-10')) === null && (await off.submit({ id: 'aaaaaa1', season: '2026-10', name: 'a', rating: 1000, games: 1, wins: 0 })) === null, 'ladder off without the service');
const on = new RankedLadder('https://w.example', async (u, i) => {
  const url = new URL(u);
  const req = new Request(url, { method: i?.method ?? 'GET', headers: { 'CF-Connecting-IP': `9.9.9.${ip++}`, 'Content-Type': 'application/json' }, body: i?.body as string | undefined });
  return (await ranked(req, env, url, { json, cors: {}, clean }))!;
});
ok((await on.submit({ id: 'eeeeee5', season: '2026-10', name: 'Zed', rating: 1400, games: 12, wins: 9 })) === 1, 'ladder client posts');
const list = await on.top('2026-10');
ok(!!list && list[0].name === 'Zed', 'ladder client reads the top');
