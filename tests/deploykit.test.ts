import { ok } from './check';
import { FakeKV } from './fakeKv';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../server/leaderboard/worker.js';
import { burstLimiter } from '../server/leaderboard/validation.js';
import { resolveOnlineServer, checkOnlineServer } from '../src/net/onlineServer';
import { deployServer, renderConfig, configId, parseNamespaces, pickNamespace, KV_TITLE, LOCAL_ID } from '../scripts/server-config.mjs';

// Real KV rejects sub-minute expirationTtl. FakeKV deliberately permits it for other lanes.
class StrictKV extends FakeKV {
  async put(k: string, v: string, o: { expirationTtl?: number; metadata?: unknown } = {}) {
    if (o.expirationTtl !== undefined && o.expirationTtl < 60) throw new Error('KV TTL below 60');
    return super.put(k, v, o);
  }
}
let serial = 0;
const kv = new StrictKV();
const env = { SCORES: kv };
async function call(path: string, body?: unknown, opts: { method?: string; raw?: string; ip?: string; origin?: string; env?: unknown; length?: string } = {}) {
  const method = opts.method ?? (body === undefined && opts.raw === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'CF-Connecting-IP': opts.ip ?? `test-${serial++}`, Origin: opts.origin ?? 'https://mansouralmadi.github.io' };
  if (opts.length) headers['Content-Length'] = opts.length;
  return worker.fetch(new Request('https://worker.example' + path, { method, headers, body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)) }), opts.env ?? env);
}
const fixtures: Record<string, { get: string; body: Record<string, unknown> }> = {
  '/scores': { get: '?board=standard-normal', body: { board: 'standard-normal', name: '<Lina>', score: 1000, stage: 2, kills: 100, time: 120 } },
  '/lobbies': { get: '?region=EU', body: { code: 'ABCDE', token: 'abcdefgh123', name: 'Lina', players: 2, max: 8, mode: 'coop', difficulty: 'normal', region: 'EU', version: '1.6.0' } },
  '/teamboard': { get: '?week=2026-W43', body: { week: '2026-W43', team: 'Team', members: ['Lina', 'Omar'], score: 1000, stage: 2, kills: 100, time: 120 } },
  '/ranked': { get: '?season=2026-10', body: { season: '2026-10', id: 'abcdef12', name: 'Lina', rating: 1100, games: 10, wins: 5 } },
  '/ghosts': { get: '?week=2026-W43', body: { week: '2026-W43', name: 'Lina', score: 1000, stage: 2, time: 120, code: 'ISG1.ABCD_123' } },
  '/ghost': { get: '?code=ABCDEF', body: { ghost: { name: 'Lina', hero: 'rookie', level: 12, stage: 2, kit: ['buster'], color: '#73eff7' } } },
};
const routesSource = readFileSync('server/leaderboard/routes.js', 'utf8');
for (const file of readdirSync('server/leaderboard').filter(f => f.endsWith('.js') && !['worker.js', 'routes.js', 'validation.js'].includes(f))) {
  ok(routesSource.includes(`'./${file}'`), `${file} is registered (new route modules must be audited)`);
}
for (const [path, fixture] of Object.entries(fixtures)) {
  for (const origin of ['https://mansouralmadi.github.io', 'null', 'http://127.0.0.1:5173']) {
    const preflight = await call(path, undefined, { method: 'OPTIONS', origin });
    ok(preflight.status === 204 && preflight.headers.get('Access-Control-Allow-Origin') === '*' && preflight.headers.get('Access-Control-Allow-Headers') === 'Content-Type' && !preflight.headers.has('Access-Control-Allow-Credentials'), `${path} preflight supports ${origin} without credentials`);
  }
  const accepted = await call(path, fixture.body, { ip: `valid-${path}` });
  ok(accepted.status === 200, `${path} valid POST reaches registered handler`);
  const acceptedBody = await accepted.json();
  const get = await call(path + (path === '/ghost' ? `?code=${acceptedBody.code}` : fixture.get));
  ok(get.status === 200 && get.headers.get('Access-Control-Allow-Origin') === '*', `${path} round trip and CORS`);
  ok((await call(path, undefined, { method: 'DELETE' })).status === 405, `${path} method guard`);
  for (const raw of ['null', '[]', '"text"', '{', '{}']) {
    const writes = kv.writes;
    const result = await call(path, undefined, { raw });
    ok(result.status === 400 && kv.writes === writes && result.headers.get('Access-Control-Allow-Origin') === '*', `${path} rejects ${raw} without writes, with CORS`);
  }
  const limit = path === '/ghosts' ? 204096 : path === '/ghost' ? 2000 : 4096;
  ok((await call(path, undefined, { raw: JSON.stringify({ padding: 'a'.repeat(limit) }) })).status === 413, `${path} bounds actual stream with no Content-Length`);
  ok((await call(path, fixture.body, { length: String(limit + 1) })).status === 413, `${path} rejects oversized Content-Length before parsing`);
  if (path !== '/ghost') ok((await call(path, fixture.body, { ip: `valid-${path}` })).status === 429, `${path} posting cooldown`);
}
// UTF-8 bytes, not UTF-16 character count; a plausible ASCII length must not bypass the limit.
ok((await call('/scores', undefined, { raw: JSON.stringify({ padding: '界'.repeat(1500) }), length: '100' })).status === 413, 'multibyte body bounded even with a dishonest length');
for (const path of ['/scores', '/teamboard', '/ghosts']) {
  ok((await call(path, { ...fixtures[path].body, score: 'Infinity', kills: 'Infinity' })).status === 400, `${path} rejects non-finite scores`);
  ok((await call(path, { ...fixtures[path].body, score: Number.MAX_SAFE_INTEGER + 1 })).status === 400, `${path} rejects unsafe scores`);
  ok((await call(path, { ...fixtures[path].body, time: 0 })).status === 400, `${path} rejects zero duration`);
}
ok((await call('/scores', { ...fixtures['/scores'].body, score: 1e12 })).status === 400, 'score plausibility envelope');
ok((await call('/teamboard', { ...fixtures['/teamboard'].body, kills: 1e12 })).status === 400, 'kill-rate sanity check');
ok((await call('/ranked', { ...fixtures['/ranked'].body, rating: 4000, games: 1 })).status === 400, 'ranked plausibility');
ok((await call('/lobbies?region=BAD')).status === 400, 'lobby filter validation');
ok((await call('/lobbies', { ...fixtures['/lobbies'].body, token: 'wrongtoken' })).status === 409, 'lobby ownership token enforced');
ok((await call('/lobbies', { code: 'ABCDE', token: 'abcdefgh123', close: true })).status === 200, 'owner can close lobby');
ok((await call('/scores?board=../../other')).status === 400, 'invalid board rejected');
for (const board of ['daily-2026-10-20', 'weekly-2026-W43', 'raid-hard', 'gauntlet-normal']) {
  ok((await call('/scores', { ...fixtures['/scores'].body, board })).status === 200 && (await call(`/scores?board=${board}`)).status === 200, `${board} is served by /scores`);
}
ok((await call('/teamboard', { ...fixtures['/teamboard'].body, members: Array.from({ length: 8 }, (_, i) => `P${i}`) })).status === 200, 'team board accepts all eight players');
ok((await call('/teamboard', { ...fixtures['/teamboard'].body, members: Array(9).fill('P') })).status === 400, 'team board refuses oversized roster');
for (let i = 0; i < 10; i++) await call('/ghost', fixtures['/ghost'].body, { ip: 'ghost-limit' });
ok((await call('/ghost', fixtures['/ghost'].body, { ip: 'ghost-limit' })).status === 429, 'help ghosts limited to ten per hour');
// Ranked keeps its intended 20-second window while every KV TTL is >= 60 seconds.
const realNow = Date.now;
let now = realNow();
Date.now = () => now;
try {
  await call('/ranked', fixtures['/ranked'].body, { ip: 'rank-window' });
  now += 19999;
  ok((await call('/ranked', fixtures['/ranked'].body, { ip: 'rank-window' })).status === 429, 'ranked blocked before 20 seconds');
  now += 1;
  ok((await call('/ranked', fixtures['/ranked'].body, { ip: 'rank-window' })).status === 200, 'ranked unblocks at 20 seconds with valid KV TTL');
} finally { Date.now = realNow; }
const burst = burstLimiter();
for (let i = 0; i < 120; i++) burst('ip', 1000);
ok(!burst('ip', 1001) && burst('other', 1001) && burst('ip', 61000), 'burst guard: 120/minute, independent IPs, window reset');
for (let i = 0; i < 120; i++) await call('/health', undefined, { ip: 'burst-http' });
const limited = await call('/health', undefined, { ip: 'burst-http' });
ok(limited.status === 429 && limited.headers.get('Retry-After') === '60', 'HTTP burst guard and retry hint');
const healthWrites = kv.writes;
const health = await call('/health');
ok(health.status === 200 && (await health.json()).ok === true && kv.writes === healthWrites, 'health checks KV with no write');
for (const broken of [{}, { SCORES: { get: async () => { throw new Error('private account details'); } } }]) {
  const response = await call('/health', undefined, { env: broken });
  ok(response.status === 503 && response.headers.get('Access-Control-Allow-Origin') === '*' && !(await response.text()).includes('private'), 'storage failure is safe JSON with CORS');
}
ok((await call('/missing')).status === 404, 'unknown path is 404');
ok((await call('/health', {}, { method: 'POST' })).status === 405, 'health is read-only');

// Test link is opt-in, page-local, shared by every client, and rejects unsafe URL forms.
ok(resolveOnlineServer('https://example.com///') === 'https://example.com', 'build URL normalized');
ok(resolveOnlineServer('https://example.com', '?server=http://127.0.0.1:8787') === 'https://example.com', 'override requires test flag');
ok(resolveOnlineServer('', '?test&server=http://127.0.0.1:8787/') === 'http://127.0.0.1:8787', 'local test override');
ok(resolveOnlineServer('https://example.com', '?test&server=') === '', 'empty test override forces offline');
for (const value of ['javascript:alert(1)', 'http://public.example', 'https://user:pass@example.com', 'https://example.com?a=1', 'garbage']) ok(resolveOnlineServer(value) === '', `unsafe URL refused: ${value}`);
for (const file of ['leaderboard', 'lobbies', 'teamboard', 'ghostNet', 'ghostShare', 'rankedBoard']) ok(readFileSync(`src/net/${file}.ts`, 'utf8').includes("from './onlineServer'"), `${file} uses shared URL`);
ok(await checkOnlineServer('', (() => { throw new Error('must not fetch'); }) as typeof fetch) === 'off', 'disabled status does not fetch');
ok(await checkOnlineServer('https://worker.example', (async () => call('/health')) as typeof fetch) === 'on', 'healthy status');
ok(await checkOnlineServer('https://worker.example', (async () => new Response('{"ok":true}')) as typeof fetch) === 'unavailable', 'unrelated server not shown as online');
ok(await checkOnlineServer('https://worker.example', (async () => { throw new Error('offline'); }) as typeof fetch) === 'unavailable', 'fetch failure status');

// Deployment orchestration uses mocks only: test must never log in, create KV or deploy remotely.
const id = 'a'.repeat(32), other = 'b'.repeat(32);
const template = readFileSync('server/leaderboard/wrangler.template.toml', 'utf8');
ok(configId(renderConfig(template, id)) === id, 'template writes valid binding');
ok(parseNamespaces(`banner\n[{"title":"${KV_TITLE}","id":"${id}"}]`)[0].id === id, 'namespace list JSON parsing');
ok(pickNamespace([{ title: KV_TITLE, id }]) === id, 'existing namespace reused');
for (const fn of [() => renderConfig(template, 'bad'), () => pickNamespace([{ title: KV_TITLE, id }], other), () => pickNamespace([{ title: KV_TITLE, id }, { title: KV_TITLE, id: other }])]) {
  let threw = false; try { fn(); } catch { threw = true; } ok(threw, 'invalid/ambiguous/wrong-account deployment fails closed');
}
async function mockDeploy(existing: string, initial: { title: string; id: string }[], fail = '') {
  const commands: string[][] = [], writes: [string, string, string][] = [];
  let rows = initial;
  await deployServer({
    read: async () => existing,
    write: async (name: string, value: string, account = '') => { writes.push([name, value, account]); },
    log: () => {},
    run: async (args: string[], options?: { capture?: boolean }) => {
      commands.push(args);
      if (args.includes(fail)) throw new Error('mock failure');
      if (args.includes('list')) return JSON.stringify(rows);
      if (args.includes('create')) { ok(args.includes(KV_TITLE), 'create uses explicit namespace title (Wrangler no longer prefixes worker name)'); rows = [{ title: KV_TITLE, id }]; return ''; }
      if (args[0] === 'deploy') { ok(!options?.capture, 'deployment keeps the terminal attached for first-use subdomain prompts and URL output'); return ''; }
      throw new Error('unexpected command');
    },
  });
  return { commands, writes };
}
const first = await mockDeploy('', []);
ok(first.commands.at(-1)?.[0] === 'deploy' && first.commands.filter(x => x.includes('create')).length === 1 && first.writes.some(([name, value]) => name === 'wrangler.toml' && value === id), 'first deploy creates KV, writes config, deploys with terminal output');
const again = await mockDeploy(renderConfig(template, id), [{ title: KV_TITLE, id }]);
ok(!again.commands.some(x => x.includes('create')) && again.writes[0][1] === LOCAL_ID, 'rerun reuses storage and separates local config');
const recover = await mockDeploy('', [{ title: KV_TITLE, id }]);
ok(!recover.commands.some(x => x.includes('create')), 'missing local config recovers existing namespace');
let failed = false;
try { await mockDeploy('', [], 'list'); } catch { failed = true; }
ok(failed, 'auth/list failure stops deployment');
const pages = readFileSync('.github/workflows/pages.yml', 'utf8');
const release = readFileSync('.github/workflows/release.yml', 'utf8');
ok(pages.includes('VITE_LEADERBOARD_URL: ${{ vars.VITE_LEADERBOARD_URL }}') && release.match(/VITE_LEADERBOARD_URL: /g)?.length === 2, 'Pages and both desktop release jobs use repository variable');
for (const workflow of readdirSync('.github/workflows')) ok(!/server:deploy|wrangler deploy/.test(readFileSync(`.github/workflows/${workflow}`, 'utf8')), `${workflow} never deploys the Worker`);

for (const path of ['/scores?board=bad', '/teamboard?week=2026-W00', '/ranked?season=2026-13', '/ghost?code=../../', '/ghosts?week=2026-W43&id=../']) {
  ok((await call(path)).status === 400, `${path} rejects malformed selectors`);
}
ok((await call('/ghosts', { ...fixtures['/ghosts'].body, code: `ISG1.${'A'.repeat(200000)}` })).status === 400, 'ghost code cap inside body byte cap');
ok((await call('/ghosts', { ...fixtures['/ghosts'].body, code: 'not-a-code' })).status === 400, 'ghost code format checked');
ok((await call('/lobbies', { ...fixtures['/lobbies'].body, players: 9 })).status === 400, 'lobby cannot exceed eight slots');
const collisionWrites: string[] = [];
const collision = await call('/ghost', fixtures['/ghost'].body, { env: { SCORES: {
  get: async (key: string) => key.startsWith('ghost:') ? { name: 'existing ghost' } : null,
  put: async (key: string) => { collisionWrites.push(key); },
} } });
ok(collision.status === 503 && !collisionWrites.some(key => key.startsWith('ghost:')), 'exhausted short-code collisions never overwrite another ghost');
// Board metadata expires alongside uploads, so an abandoned weekly board does not keep dead links forever.
const ttlKv = new StrictKV();
const ttlEnv = { SCORES: ttlKv };
await call('/ghosts', fixtures['/ghosts'].body, { env: ttlEnv });
ttlKv.clock = () => Date.now() + 61 * 86400000;
ok(((await (await call('/ghosts?week=2026-W43', undefined, { env: ttlEnv })).json()).ghosts as unknown[]).length === 0, 'abandoned ghost board expires with its codes');
for (const [path, field] of [['/scores', 'board'], ['/lobbies', 'code'], ['/teamboard', 'week'], ['/ranked', 'season'], ['/ghosts', 'code']] as const) {
  const response = await call(path, { ...fixtures[path].body, [field]: { toString: null } });
  ok(response.status === 400, `${path} rejects objects in scalar fields without throwing`);
}
ok((await call('/scores', { ...fixtures['/scores'].body, score: { valueOf: null } })).status === 400, 'score numeric field rejects coercion objects');
ok((await call('/ghost', { ghost: { ...(fixtures['/ghost'].body.ghost as object), hero: { toString: null } } })).status === 400, 'ghost scalar fields checked');
ok(renderConfig(template, id, other).includes(`account_id = "${other}"`) && !renderConfig(template, id).includes('{{'), 'generated config preserves a selected account without leftover placeholders');

const selectedAccount = await mockDeploy(renderConfig(template, id, other), [{ title: KV_TITLE, id }]);
ok(selectedAccount.writes.find(([name]) => name === 'wrangler.toml')?.[2] === other, 'redeploy passes the existing account through to its new config');
ok(configId(`[[kv_namespaces]]\nbinding = "OTHER"\nid = "${other}"\n${renderConfig(template, id)}`) === id, 'namespace reuse selects SCORES, never the first unrelated binding');
