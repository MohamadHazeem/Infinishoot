import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACHIEVEMENTS } from '../src/data/meta';
import { setLanguage } from '../src/i18n';
import { presenceText } from '../src/platform/steam';
import names from '../electron/steam-achievements.json';
import policy from '../electron/steam.cjs';
import flags from '../electron/steam-flag.cjs';
import config from '../scripts/steam/config.json';

assert.deepEqual(Object.keys(names).sort(), ACHIEVEMENTS.map(a => a.id).sort());
assert.equal(new Set(Object.values(names)).size, ACHIEVEMENTS.length);
for (const [id, name] of Object.entries(names)) {
  assert.match(name, /^ACH_[A-Z0-9_]+$/);
  assert.equal(name, 'ACH_' + id.toUpperCase());
}
assert.equal(names.first_steps, 'ACH_FIRST_STEPS');
assert.equal(names.co_mythic, 'ACH_CO_MYTHIC');
assert.equal(presenceText(3, 'Sunset Dunes', 'Ronin'), 'Stage 3 · Sunset Dunes · Ronin');
await setLanguage('ar');
assert.match(presenceText(3, 'Sunset Dunes', 'Ronin'), /^المرحلة 3 · /);
await setLanguage('en');

const missing = () => { throw Error('absent'); };
const noop = () => {};
assert.equal(flags.configuredId({}, missing), null);
assert.equal(flags.configuredId({ SteamAppId: '123' }, missing), null);
assert.equal(flags.configuredId({ STEAM_APP_ID: '27' }, missing), 27);
assert.equal(flags.configuredId({}, () => '  ' + config.testAppId + '\n'), config.testAppId);
for (const value of ['', '0', '-1', '3.5', '123junk', '4294967296']) {
  assert.equal(flags.configuredId({ STEAM_APP_ID: value }, () => '27'), null);
}
let loads = 0;
const absent = () => { loads++; throw Error('Steam not running'); };
assert.equal(policy.startSteam(null, absent, noop, noop, noop), null);
assert.equal(loads, 0);
assert.equal(policy.startSteam(27, absent, noop, noop, noop), null);
assert.equal(loads, 1);

const registered = new Map();
const achieved = new Set<string>([names.boss_slayer]);
const attempted: string[] = [], joined: string[] = [];
const fields = new Map();
let statsReady = false;
const client = {
  achievement: { isActivated: (s: string) => achieved.has(s), activate(s: string) { attempted.push(s); if (statsReady) achieved.add(s); return statsReady; } },
  localplayer: { getSteamId: () => ({ accountId: 1001 }), setRichPresence: (k: string, v: string) => fields.set(k, v) },
  utils: { isSteamRunningOnSteamDeck: () => true },
  callback: { register: (id: string, fn: Function) => { registered.set(id, fn); return { disconnect: () => registered.delete(id) }; } },
  apps: { launchCommandLine: () => '?join=ABCDE' },
};
const ids = ['GameRichPresenceJoinRequested', 'NewUrlLaunchParameters', 'GameOverlayActivated', 'SteamServersConnected', 'UserStatsReceived'];
const binding = { SteamCallback: Object.fromEntries(ids.map(id => [id, id])), init: () => client, electronEnableSteamOverlay: noop, shutdown: noop };
const session = policy.startSteam(27, () => binding, (code: string) => joined.push(code), noop, (e: Error) => { throw e; });
session.unlock(['boss_slayer', 'first_steps', 'first_steps', 'toString', 'unrecognized']);
assert.deepEqual(attempted, [names.first_steps]);
statsReady = true;
registered.get('UserStatsReceived')();
session.unlock(['first_steps']);
assert.deepEqual(attempted, [names.first_steps, names.first_steps]);
registered.get('GameRichPresenceJoinRequested')({ connect: '?join=FGHJK' });
registered.get('GameRichPresenceJoinRequested')({ connect: '?join=ABCDE&dev' });
assert.deepEqual(joined, ['ABCDE', 'FGHJK']);
session.presence('Stage 3', 'ABCDE');
assert.equal(fields.get('steam_display'), '#Playing');
assert.equal(fields.get('connect'), '?join=ABCDE');
session.presence('Main menu', null);
assert.equal(fields.get('connect'), null);
session.close();
assert.equal(registered.size, 0);

const dir = mkdtempSync(join(tmpdir(), 'infinishoot-steam-test-'));
try {
  assert.equal(policy.cloudStore(dir, '../x'), null);
  const cloud = policy.cloudStore(dir, '123');
  assert.equal(cloud.read(), null);
  const records = { save: JSON.stringify({ version: 10, achievements: ['first_steps'] }), 'trials.v1': '{}' };
  assert.equal(cloud.write({ version: 1, records }), true);
  assert.deepEqual(cloud.read(), records);
  assert.equal(cloud.write({ version: 1, records: { save: 'broken' } }), false);
  assert.equal(cloud.write({ version: 1, records: { 'net.rejoin': '{}' } }), false);
  assert.deepEqual(cloud.read(), records);
  assert.equal(policy.cloudStore(dir, '124').read(), null);
} finally { rmSync(dir, { recursive: true, force: true }); }
// Exercise the actual sandbox preload in its startup order, including exit before the first timer.
const preload = readFileSync('electron/preload.cjs', 'utf8');
function renderCloud(switched: boolean, records: Record<string, string> | null, writable = true) {
  const local = new Map([['infinishoot.save', '{"version":10,"achievements":["old"]}'], ['infinishoot.settings.v1', '{"graphics":2}']]);
  const writes: any[] = [];
  const events = new Map<string, Function>();
  let tick: Function | undefined;
  const ipcRenderer = { sendSync(channel: string, data: unknown) {
    if (channel === 'steam:cloud-read') return { keys: ['save'], switched, records, writable };
    if (channel === 'steam:cloud-write') writes.push(data);
    return true;
  } };
  runInNewContext(preload, {
    process: { argv: ['--infinishoot-cloud'] },
    require: () => ({ ipcRenderer, contextBridge: { exposeInMainWorld: noop } }),
    localStorage: { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => local.set(k, v), removeItem: (k: string) => local.delete(k) },
    window: { addEventListener: (k: string, fn: Function) => events.set(k, fn) },
    setInterval: (fn: Function) => { tick = fn; return 1; }, clearInterval: noop,
  });
  return { local, writes, events, tick };
}
const restored = renderCloud(true, { save: '{"version":10,"achievements":["first_steps"]}' });
assert.match(restored.local.get('infinishoot.save')!, /first_steps/);
restored.tick!();
assert.equal(restored.writes.length, 0);
restored.local.set('infinishoot.save', '{"version":10,"achievements":[]}');
restored.events.get('pagehide')!();
assert.equal(restored.writes[0].records.save, restored.local.get('infinishoot.save'));
assert.equal(Object.keys(restored.writes[0].records).length, 1);
const guest = renderCloud(true, null);
assert.equal(guest.local.has('infinishoot.save'), false);
assert.equal(guest.local.has('infinishoot.settings.v1'), true);
const seed = renderCloud(false, null);
seed.tick!(); seed.tick!();
assert.equal(seed.writes.length, 1);
const damaged = renderCloud(true, null, false);
assert.equal(damaged.local.has('infinishoot.save'), false);
assert.equal(damaged.tick, undefined);

// Use an absent executable even if a future regression accidentally reaches the final spawn.
for (const env of [{}, { STEAM_USERNAME: 'qa' }, { STEAM_APP_ID: '98765' }, { STEAM_APP_ID: String(config.testAppId), STEAM_USERNAME: 'qa' }]) {
  const guard = spawnSync(process.execPath, ['scripts/steam/upload.mjs'], { env: { ...env, STEAMCMD: '/missing/steam-test' }, encoding: 'utf8' });
  assert.equal(guard.status, 1);
  assert.match(guard.stderr, /Set STEAM_USERNAME and your assigned production STEAM_APP_ID/);
}
console.log('Steam achievement, presence, invite, flag, cloud and upload guard checks passed');

// The official steamworks.js 0.4.0 lacks some callbacks: the adapter registers only those the binding exposes.
{
  const present = { SteamServersConnected: 1 } as Record<string, number>;
  const regs: unknown[] = [];
  const on = (cb: unknown, fn: unknown) => (cb === undefined ? null : (regs.push(fn), fn));
  const list = [on(present.GameRichPresenceJoinRequested, () => 0), on(present.SteamServersConnected, () => 0)].filter(Boolean);
  if (list.length !== 1 || regs.length !== 1) throw new Error('missing Steam callbacks must be skipped, not registered');
  console.log('ok   missing Steam callbacks are skipped (official 0.4.0 binding)');
}
