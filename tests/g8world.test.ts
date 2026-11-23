import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import './jsdomEnv';
import service from '../server/leaderboard/telemetry.js';
import { goalCredit, goalWeek } from '../server/leaderboard/goals.js';
import {
  channelName,
  chatCommand,
  ChatBallot,
  StreamMode,
  streamSettings,
} from '../src/game/streamMode';
import { readWorldGoal, WorldGoals } from '../src/game/worldGoals';
import type { Game } from '../src/game/game';

const monday = Date.UTC(2026, 10, 23);
assert.equal(goalWeek(monday).start, monday);
assert.equal(goalWeek(monday - 1).ends, monday);
assert.equal(goalCredit(99, 9), 0);
assert.equal(goalCredit(6000, 1000), 5000);
assert.equal(goalCredit(6000, 10), 160);
for (const k of [-1, 0.5, Infinity, NaN]) assert.equal(goalCredit(k, 300), 0);

const sql = new DatabaseSync(':memory:');
const kv = new Map<string, string>();
const db = {
  prepare: (q: string) => {
    const s = sql.prepare(q);
    return {
      run: async () => s.run(),
      bind: (...args: (string | number)[]) => ({
        run: () => s.run(...args),
        first: () => s.get(...args),
      }),
    };
  },
};
const env = {
  TELEMETRY: db,
  SCORES: {
    get: (k: string, as?: string) =>
      as === 'json' && kv.has(k) ? JSON.parse(kv.get(k)!) : kv.get(k),
    put: (k: string, v: string) => kv.set(k, v),
  },
};
const run = {
  name: 'PRIVATE',
  score: 2100,
  stage: 2,
  kills: 80,
  time: 81,
  board: 'standard-normal',
};
const request = (path: string, body?: object, ip = 'test', bindings = env) =>
  service.fetch(
    new Request('https://example.test' + path, {
      headers: { 'CF-Connecting-IP': ip },
      method: body ? 'POST' : 'GET',
      body: body ? JSON.stringify(body) : undefined,
    }),
    bindings,
  );
const goal = async () => (await request('/goals')).json();
assert.equal((await goal()).total, 0);
assert.equal((await request('/goals', run)).status, 405);
assert.equal((await request('/scores', { ...run, name: 'x'.repeat(5000) })).status, 413);
assert.equal((await request('/scores', { ...run, board: 'bogus' })).status, 400);
assert.equal((await goal()).total, 0);
assert.equal((await (await request('/scores', run)).json()).rank, 1);
assert.equal((await request('/scores', { ...run, kills: 81 })).status, 429);
assert.equal((await goal()).total, 80);
await Promise.all([
  request('/scores', run, 'retry'),
  request('/scores', { ...run, kills: 12 }, 'fresh'),
]);
assert.equal((await goal()).total, 92);
const row = sql.prepare("SELECT * FROM world_goal WHERE receipt <> '' LIMIT 1").get()!;
assert.deepEqual(Object.keys(row).sort(), ['week', 'receipt', 'kills'].sort());
assert.match(String(row.receipt), /^[a-f0-9]{64}$/);
sql.prepare("INSERT INTO world_goal VALUES(?, 'almost', 999900)").run(goalWeek().start);
await request('/scores', { ...run, kills: 500 }, 'cross');
const reached = await goal();
assert.equal(reached.unlocked, true);
assert.equal(reached.total, reached.target);
const now = Date.now;
try {
  Date.now = () => reached.ends + 1;
  assert.deepEqual(await goal(), {
    target: 1000000,
    total: 0,
    unlocked: false,
    ends: reached.ends + 7 * 86400000,
  });
} finally {
  Date.now = now;
}
assert.equal(
  (await request('/scores', run, 'offline', { ...env, TELEMETRY: undefined } as never)).status,
  200,
);
assert.equal(
  (await request('/goals', undefined, 'offline', { ...env, TELEMETRY: undefined } as never)).status,
  503,
);
sql.close();
assert.equal((await request('/scores', run, 'database-down')).status, 200);
assert.equal((await request('/goals')).status, 503);

assert(readWorldGoal(reached));
assert.equal(readWorldGoal({ ...reached, ends: Date.now() }), null);
assert.equal(readWorldGoal({ ...reached, unlocked: false }), null);
assert.equal(readWorldGoal({ ...reached, total: -1 }), null);
const offline = new WorldGoals(() => assert.fail('offline callback'), '');
offline.tick(true, 100);
const oldFetch = globalThis.fetch;
let clock = monday,
  reads = 0;
const observed: (boolean | null)[] = [];
try {
  Date.now = () => clock;
  globalThis.fetch = async () => {
    reads++;
    return Response.json({ ...reached, ends: monday + 30000 });
  };
  const service = new WorldGoals(
    (goal) => observed.push(goal?.unlocked ?? null),
    'https://example.test',
  );
  service.tick(true, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(observed, [true]);
  service.tick(false, 1);
  service.tick(true, 1);
  assert.equal(reads, 1);
  clock += 30001;
  service.tick(false, 1);
  assert.deepEqual(observed, [true, null]);
  assert.equal(reads, 1);
} finally {
  globalThis.fetch = oldFetch;
  Date.now = now;
}
assert.equal(channelName(' #Demo_Pilot '), 'demo_pilot');
assert.deepEqual(streamSettings({ enabled: 'yes', channel: 'one\r\nJOIN #two' }), {
  enabled: false,
  channel: '',
});
const tagged =
  '@badge-info=;badges=;color=#00FF7F;display-name=ArcadeFox :arcadefox!arcadefox@arcadefox.tmi.twitch.tv PRIVMSG #demo :!vote 2';
// Public IRC capture, with the viewer, channel and message replaced before recording.
const plain = ':cobalt!cobalt@cobalt.tmi.twitch.tv PRIVMSG #demo :1';
assert.deepEqual(chatCommand(tagged, 'demo'), { login: 'arcadefox', command: '!vote 2' });
for (const msg of [
  plain.replace('#demo', '#another'),
  plain + ' maybe',
  'PING :tmi.twitch.tv',
  plain.replace('PRIVMSG', 'WHISPER'),
])
  assert.equal(chatCommand(msg, 'demo'), null);
const ballot = new ChatBallot();
ballot.open();
ballot.vote('a', 1);
ballot.vote('a', 2);
ballot.vote('b', 0);
assert.equal(ballot.winner(), null);
ballot.vote('c', 1);
assert.equal(ballot.winner(), 'meteors');
ballot.clear();
ballot.vote('d', 1);
assert.equal(ballot.winner(), null);
ballot.open();
for (let i = 0; i < 2050; i++) ballot.vote(String(i), 2);
assert.deepEqual(ballot.counts, [0, 0, 2000]);

class Socket {
  sent: string[] = [];
  closed = false;
  onmessage?: (e: { data: string }) => void;
  onopen?: () => void;
  onclose?: () => void;
  send(line: string) {
    this.sent.push(line);
  }
  close() {
    this.closed = true;
  }
  frame(line: string) {
    this.onmessage?.({ data: line });
  }
}
const sockets: Socket[] = [];
const stream = new StreamMode(() => {
  const socket = new Socket();
  sockets.push(socket);
  return socket as unknown as WebSocket;
});
const outcomes: string[] = [];
const g = {
  role: 'client',
  runMode: 'standard',
  mode: 'fight',
  screens: { current: 'none' },
  meta: {},
  onboarding: {},
  director: { bossSpawned: false },
  runEvents: { event: null, forceEvent: (e: string) => outcomes.push(e) },
} as unknown as Game;
stream.configure({ enabled: true, channel: 'demo' });
stream.session(g, 1);
assert.equal(sockets.length, 0);
g.role = 'host';
stream.session(g, 1);
const socket = sockets[0];
socket.onopen!();
socket.frame(':tmi.twitch.tv 001 justinfan12345 :Welcome, GLHF!\r\n');
socket.frame(
  ':justinfan12345.tmi.twitch.tv 366 justinfan12345 #demo :End of /NAMES list\r\nPING :tmi.twitch.tv\r\n',
);
assert.equal(stream.status, 'live');
assert.match(socket.sent[0], /^NICK justinfan\d+\r\n$/);
assert.deepEqual(socket.sent.slice(1), ['JOIN #demo\r\n', 'PONG :tmi.twitch.tv\r\n']);
for (let i = 0; i < 75; i++) stream.fight(g, 1);
assert(stream.ballot.seconds > 0);
socket.frame(
  [
    tagged,
    plain,
    tagged,
    tagged.replaceAll('arcadefox', 'sky'),
    plain.replace(':1', ':!help'),
  ].join('\r\n'),
);
assert(stream.help > 0);
assert.deepEqual(stream.ballot.counts, [1, 2, 0]);
assert.deepEqual(outcomes, []);
g.director.bossSpawned = true;
for (let i = 0; i < 20; i++) stream.fight(g, 1);
assert.deepEqual(outcomes, []);
for (let i = 0; i < 75; i++) stream.fight(g, 1); // a quiet poll while the boss is still up
g.director.bossSpawned = false;
stream.fight(g, 1);
stream.fight(g, 1);
assert.deepEqual(outcomes, ['meteors']);
for (let i = 0; i < 95; i++) stream.fight(g, 1);
assert.deepEqual(outcomes, ['meteors']); // quiet chat
socket.onclose!();
stream.session(g, 1);
assert.equal(sockets.length, 1);
stream.session(g, 5);
assert.equal(sockets.length, 2);
g.role = 'client';
stream.session(g, 1);
assert(sockets[1].closed);
assert.equal(stream.status, 'off');
assert(!socket.sent.some((line) => line.includes('PRIVMSG')));
console.log(
  'ok   accepted-score accounting, UTC rollover, guest IRC, bounded ballots and host event execution',
);
