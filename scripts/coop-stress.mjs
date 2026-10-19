// Four-player online co-op stress test: 1 host + 3 clients in headless Chromium.
//   npm run coop4 [-- --secs 260] [--lag 70] [--out shots/coop4] [--size 640x360] [--no-extra]
// Every page plays with the dev bot (`botAuto`) through stage 1 into stage 2.
// The script forces the things four players run into: level-ups for everyone,
// the boss with its owned chests, the shop, the route map vote, team moves, a
// team ultimate, emotes and pings, a mech suit and a supply crate, a world
// event, a map chest, a downed and revived hero, a revive-pool buy-back, and
// one client dropping out (autopilot) and back in (reclaims its hero). Client 2
// gets `--lag` ms of extra latency each way (an in-page message delay).
// After the co-op run, Versus Swarm (a client Overlord) and a local co-op run
// get a smoke check.
// Every 4 s it compares the host with every client: stage, mode, team level,
// kills, boss and phase, each hero's HP, dead/left flags and build, the
// client's own gold, passives and Mods, and whether any screen is stuck (a
// client on a level-up/shop/route screen the host has closed, or the host
// waiting on a menu nobody answers). A difference that lasts two checks in a
// row fails the run, as does any page error. It also reports snapshot bytes
// per client and the host's update time with four players.
// Times (scenario schedule, waits, --secs) are the host's simulated seconds, not
// wall seconds: on a loaded machine the pages run slower than real time, and the
// checks must not depend on how fast this machine is. The report gives the sim
// speed it got.
// Signalling goes through PeerJS's public broker like the real game.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i < 0 ? d : args[i + 1];
};
const SECS = Number(opt('--secs', '260'));
const LAG = Number(opt('--lag', '70'));
const OUT = opt('--out', join('shots', 'coop4'));
const EXTRA = !args.includes('--no-extra');
const [W, H] = opt('--size', '640x360').split('x').map(Number);
mkdirSync(OUT, { recursive: true });

function findChrome() {
  if (process.env.SHOT_CHROME) return process.env.SHOT_CHROME;
  const roots = [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    for (const d of readdirSync(r).filter((x) => x.startsWith('chromium_headless_shell-')).sort().reverse()) {
      for (const sub of readdirSync(join(r, d))) {
        const p = join(r, d, sub, 'chrome-headless-shell');
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(5)}s]`, ...a);
const failures = [];
const fail = (msg) => {
  failures.push(msg);
  log('FAIL', msg);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false }, logLevel: 'error' }); // no HMR: edits elsewhere must not reload the pages mid-run
await server.listen();
const base = `http://127.0.0.1:${server.config.server.port ?? server.httpServer.address().port}/`;
const browser = await chromium.launch({
  headless: true,
  executablePath: findChrome(),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

async function openPage(name, path = '') {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack ?? '').split('\n').slice(1, 5).join('\n')}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|Failed to load resource|AudioContext was not allowed|WebGL: INVALID_OPERATION|GPU stall|ERR_|net::/i.test(t)) return;
    errors.push(t);
  });
  const pending = new Set();
  page.on('request', (r) => pending.add(r));
  page.on('requestfinished', (r) => pending.delete(r));
  page.on('requestfailed', (r) => pending.delete(r));
  // A busy machine can take a while; what counts is the game being up, not every font having loaded.
  await page.goto(base + path, { timeout: 180000, waitUntil: 'domcontentloaded' }).catch((e) => log(`${name}: ${e.message.split('\n')[0]}; pending ${[...pending].map((r) => r.url()).join(', ')}`));
  await page.waitForFunction(() => window.game && window.botAuto && (window.game.mode === 'title' || location.search.includes('test')), null, { timeout: 600000 }).catch(async (e) => {
    const st = await page.evaluate(() => ({ game: !!window.game, bot: !!window.botAuto, mode: window.game?.mode, screen: window.game?.screens?.current, ready: document.readyState })).catch((x) => x.message);
    throw new Error(`${name} never came up: ${JSON.stringify(st)}; errors ${errors.join(' | ')}; pending ${[...pending].map((r) => r.url()).join(', ')}`);
  });
  return { name, page, errors };
}

const HEROES = ['rookie', 'bulwark', 'ace', 'dash'];
const PETS = ['sparky', 'bit', 'none', 'sparky'];
const [A, ...C] = await Promise.all(['host', 'client1', 'client2', 'client3'].map((n) => openPage(n)));
const ALL = [A, ...C];
log('pages loaded');

// ---------------------------------------------------------------- setup and lobby
await Promise.all(
  ALL.map((p, i) =>
    p.page.evaluate(
      async ([hero, pet]) => {
        const { settings } = await import('/src/game/settings.ts');
        window.cheats.unlockAll = true;
        settings.hero = hero;
        settings.pet = pet;
        settings.coopPool = true; // the shared revive pool (host's setting counts)
        settings.coopJoinable = true;
        settings.helpGhosts = false;
        window.game.applyLocalSkin();
      },
      [HEROES[i], PETS[i]],
    ),
  ),
);

/** Client 2: a fixed extra delay on every message in and out (order kept). */
async function addLag(p, ms) {
  if (!ms) return;
  await p.page.evaluate((ms) => {
    const c = window.game.client;
    if (!c || c.__lag) return;
    c.__lag = ms;
    const send = c.send.bind(c);
    c.send = (m) => setTimeout(() => send(m), ms);
    const on = c.onMessage;
    c.onMessage = (m) => setTimeout(() => on(m), ms);
  }, ms);
}

async function host_(name) {
  await A.page.evaluate((name) => void window.game.hostGame(name), name);
  const ok = await A.page.evaluate(async () => {
    for (let k = 0; k < 100 && !window.game.host; k++) await new Promise((r) => setTimeout(r, 100));
    try {
      await window.game.host.ready;
      return true;
    } catch (e) {
      return String(e?.type ?? e);
    }
  });
  if (ok !== true) {
    fail(`host could not register with the signalling server: ${ok}`);
    await done();
  }
  return A.page.evaluate(() => window.game.host.code);
}

/** Join with the invite code; returns how it went (the connection, the messages the host sent back, the toast). */
async function joinRun(p, name, code, lag = 0) {
  await p.page.evaluate(() => {
    const g = window.game;
    if (window.__msgs) return;
    window.__msgs = [];
    const on = g.onClientMessage;
    g.onClientMessage = function (m) {
      if (m?.t !== 's') window.__msgs.push(`${m?.t}${m?.reason ? ':' + m.reason : ''}`), window.__msgs.splice(0, window.__msgs.length - 30);
      return on.call(this, m);
    };
  });
  // A starved machine can miss the 12 s connect timeout: try again like a player would (after a
  // failed try, nothing from the host may reach this page any more).
  for (let tries = 1; ; tries++) {
    const r = await p.page.evaluate(async ([n, c]) => {
      await window.game.joinGame(n, c);
      return { role: window.game.role, client: !!window.game.client, msgs: window.__msgs.length, status: document.querySelector('#scr-online .mp-status')?.textContent };
    }, [name, code]);
    if (r.client || tries >= 4) break;
    log(`${p.name}: join try ${tries} failed (${JSON.stringify(r)}), trying again`);
    await pause(4000);
    const late = await p.page.evaluate((n0) => window.__msgs.length - n0, r.msgs);
    if (late > 0) fail(`${p.name}: ${late} host messages reached the page after its join was given up`);
  }
  await addLag(p, lag);
}
const joinState = (p) => p.page.evaluate(() => ({ role: window.game.role, mode: window.game.mode, local: window.game.local, client: !!window.game.client, msgs: window.__msgs?.slice(-12), toast: document.querySelector('#toast')?.textContent, status: document.querySelector('#scr-online .mp-status')?.textContent })).catch((e) => e.message);


let code = await host_('HOSTBOT');
log(`hosting, code ${code}`);
for (let i = 0; i < 3; i++) await joinRun(C[i], `CLIENT${i + 1}`, code, i === 1 ? LAG : 0);
try {
  await A.page.waitForFunction(() => window.game.lobby.length === 4, null, { timeout: 120000 });
} catch {
  fail(`not everyone joined the lobby (${await A.page.evaluate(() => window.game.lobby.length)})`);
  await done();
}
log('3 clients in lobby, starting');
await A.page.evaluate(() => {
  window.cheats.god = true; // keeps the run going; scenarios switch it off around downs
  window.game.hostStart();
});
for (const p of C) await p.page.waitForFunction(() => window.game.role === 'client' && window.game.mode !== 'title' && window.game.heroes.length === 4, null, { timeout: 120000 }).catch(() => fail(`${p.name} never started the run`));

/**
 * Per-page instrumentation: update time on every page (the test's own measuring is
 * taken out), snapshot bytes per client on the host, and a recorder sampled after
 * every step that latches short-lived things (emote bubbles, team-ultimate beats,
 * autopilot tags, world events), so a check made a little late still sees them.
 */
async function instrument(p) {
  await p.page.evaluate(async () => {
    const g = window.game;
    if (window.__st) return;
    const { coop2Debug } = await import('/src/game/systems/coop2.ts');
    const { worldEventOf } = await import('/src/game/systems/worldEvents.ts');
    const st = (window.__st = { upd: [], updN: 0, updSum: 0, updMax: 0, snap: {}, snapMs: 0, snapN: 0, meas: 0, over: 0, slow: [], steps0: g.stepN, t0: performance.now() });
    const rec = (window.__rec = { bubbles: new Set(), beats: 0, ai: new Set(), wev: new Set(), mech: new Set(), lastBeat: 0 });
    const upd = g.update.bind(g);
    g.update = (dt) => {
      const t = performance.now();
      st.meas = 0;
      upd(dt);
      const d = performance.now() - t - st.meas;
      st.updN++;
      st.updSum += d;
      if (st.updN > 120) st.updMax = Math.max(st.updMax, d);
      if (st.upd.length < 40000) st.upd.push(d);
      if (d > 1000 / 60) st.over++;
      if (d > 500 && st.slow.length < 10) st.slow.push([g.stepN, g.mode, Math.round(d)]);
      const s = coop2Debug(g);
      for (const k of s.bubbles.keys()) rec.bubbles.add(k);
      if (s.beatT > rec.lastBeat + 0.5) rec.beats++;
      rec.lastBeat = s.beatT;
      for (const [i] of g.role === 'client' ? s.net.ai : s.grace.map((x) => [x.index])) rec.ai.add(i);
      const ev = worldEventOf(g);
      if (ev) rec.wev.add(ev.kind);
      g.heroes.forEach((h, i) => h.play.mechT > 0 && rec.mech.add(i));
    };
    if (g.role === 'host') {
      const { wireBytes } = await import('/src/dev/netSize.ts');
      const build = g.buildSnapshot;
      g.buildSnapshot = function (h, ev) {
        const t = performance.now();
        const r = build.call(this, h, ev);
        const t1 = performance.now();
        st.snapMs += t1 - t;
        st.snapN++;
        const b = wireBytes({ t: 's', ...r });
        const s = (st.snap[h.index] ??= { n: 0, total: 0, max: 0, over16k: 0 });
        s.n++;
        s.total += b;
        s.max = Math.max(s.max, b);
        if (b > 16000) s.over16k++;
        st.meas += performance.now() - t1;
        return r;
      };
    }
    window.botAuto(true);
  });
}
for (const p of ALL) await instrument(p);
log('run started, bots on');

// ---------------------------------------------------------------- sim time
// A loaded machine runs the pages far slower than real time, so everything is
// scheduled and waited for in the host's simulated seconds, not wall seconds.
const host = (fn, arg) => A.page.evaluate(fn, arg);
const cl = (i, fn, arg) => C[i].page.evaluate(fn, arg);
const simNow = () => host(() => window.game.stepN / 60);
let SIM0 = 0;
/** Wait `s` simulated seconds on the host (capped in wall time). */
async function simPause(s, capMs = 180000) {
  const t0 = await simNow();
  const w0 = Date.now();
  while ((await simNow()) - t0 < s && Date.now() - w0 < capMs) await pause(150);
}
/** Poll `fn` on a page until truthy, for at most `s` simulated seconds; returns the last value. */
async function until(page, fn, s, arg) {
  const t0 = await simNow();
  const w0 = Date.now();
  let r;
  for (;;) {
    r = await page.evaluate(fn, arg).catch(() => undefined);
    if (r) return r;
    if ((await simNow()) - t0 >= s || Date.now() - w0 > 240000) return r;
    await pause(150);
  }
}
const resetRec = () => Promise.all(ALL.slice(0, 4).map((p) => p.page.evaluate(() => window.__rec && (window.__rec.bubbles.clear(), (window.__rec.beats = 0), window.__rec.ai.clear(), window.__rec.wev.clear(), window.__rec.mech.clear())).catch(() => {})));
const recOf = (p) => p.page.evaluate(() => { const r = window.__rec; return { bubbles: [...r.bubbles].sort(), beats: r.beats, ai: [...r.ai].sort(), wev: [...r.wev], mech: [...r.mech].sort() }; }).catch(() => null);

// ---------------------------------------------------------------- probes
const hostProbe = () =>
  A.page.evaluate(async () => {
    const g = window.game;
    const { coop2Debug } = await import('/src/game/systems/coop2.ts');
    const s = coop2Debug(g);
    const boss = g.boss && g.boss.active ? g.boss : null;
    return {
      mode: g.mode,
      screen: g.screens.current,
      stage: g.stage,
      level: g.level,
      kills: g.kills,
      seed: g.seed,
      route: g.route.open,
      boss: boss ? { id: boss.def.id, phase: boss.phase } : null,
      mini: g.bossField.mini && g.bossField.mini.active ? { id: g.bossField.mini.def.id, phase: g.bossField.mini.phase } : null,
      grace: s.grace.map((x) => x.index),
      pending: s.pending.length,
      pool: s.pool.lives,
      stepN: g.stepN,
      runTime: g.runTime,
      alive: g.enemies.activeCount,
      heroes: g.heroes.map((h) => ({
        name: h.name,
        peer: !!h.peerId,
        left: h.left,
        x: h.player.x,
        z: h.player.z,
        hp: Math.ceil(h.player.hp),
        dead: h.player.dead,
        gold: h.gold,
        needsPick: h.needsPick,
        shopDone: h.shopDone,
        weapons: h.weapons.map((w) => w.def.id + ':' + (w.build ? w.buildKey : w.level)).join(' '),
        passives: JSON.stringify(h.passives),
        mods: h.synergy.slots.map((x) => x.def.id).join(','),
        mech: h.play.mechT > 0,
      })),
    };
  });
const clientProbe = (p) =>
  p.page.evaluate(() => {
    const g = window.game;
    const bossE = g.enemies.list.find((e) => e.active && e.def.boss);
    return {
      role: g.role,
      runTime: g.runTime,
      mode: g.mode,
      screen: g.screens.current,
      stage: g.stage,
      level: g.level,
      kills: g.kills,
      seed: g.seed,
      local: g.local,
      boss: bossE ? { id: bossE.def.id, phase: bossE.phase } : null,
      mini: g.bossField.netMini,
      gold: g.hero?.gold,
      passives: JSON.stringify(g.hero?.passives ?? {}),
      mods: (g.netMods ?? []).map((m) => m.id).join(','),
      heroes: g.heroes.map((h) => ({ name: h.name, left: h.left, x: h.player.x, z: h.player.z, hp: Math.ceil(h.player.hp), dead: h.player.dead, weapons: h.weapons.map((w) => w.def.id + ':' + (w.build ? w.buildKey : w.level)).join(' '), mech: h.play.mechT > 0 })),
    };
  });

const strikes = new Map();
/** A difference that lasts `limit` checks in a row is a failure; one-offs are logged (snapshots lag 50-150 ms). */
function check(key, ok, msg, limit = 2) {
  if (ok) {
    strikes.delete(key);
    return;
  }
  // Strikes count at most once per 2.5 wall seconds: during a menu the host's clock stands still, and two
  // checks a moment apart would only measure how long a message takes to cross a starved machine.
  const prev = strikes.get(key);
  if (prev && Date.now() - prev.w < 2500) return;
  const n = (prev?.n ?? 0) + 1;
  strikes.set(key, { n, w: Date.now() });
  if (n === limit) fail(msg);
  else if (n < limit) log('desync?', msg);
}

/** Clients that are away on purpose (dropped / rejoining): skip them. */
const away = new Set();
const MENU = ['levelup', 'relic', 'shop', 'wait', 'route'];
let hostMenuSince = { mode: '', checks: 0 };
let lastSim = { t: 0, w: Date.now() };
const speeds = [];
const maxBehind = [0, 0, 0];

async function compare(tag) {
  const h = await hostProbe();
  const cs = await Promise.all(C.map((p) => (away.has(p.name) ? null : clientProbe(p).catch(() => null))));
  const now = { t: h.stepN / 60, w: Date.now() };
  const speed = (now.t - lastSim.t) / Math.max(0.001, (now.w - lastSim.w) / 1000);
  lastSim = now;
  speeds.push(speed);
  log(`${tag} host mode=${h.mode} st${h.stage} lv${h.level} kills=${h.kills} alive=${h.alive} boss=${h.boss ? h.boss.id + '/' + h.boss.phase : '-'} grace=${h.grace} pending=${h.pending} pool=${h.pool} sim x${speed.toFixed(2)} heroes=${h.heroes.map((x) => `${x.name}${x.left ? '(left)' : ''}${x.dead ? '(down)' : ''}${x.needsPick ? '(pick)' : ''}`).join(',')}`);
  // Host waiting on a menu for too long (a bot answers within half a second).
  if (h.mode === 'levelup' || h.mode === 'shop') {
    hostMenuSince = hostMenuSince.mode === h.mode ? { mode: h.mode, checks: hostMenuSince.checks + 1 } : { mode: h.mode, checks: 1 };
    const waiting = h.heroes.filter((x) => !x.left && (h.mode === 'levelup' ? x.needsPick : !x.shopDone)).map((x) => x.name);
    check('hostmenu', hostMenuSince.checks < 4, `host stuck in ${h.mode} for 4 checks, waiting on ${waiting.join(',')}`, 1);
  } else hostMenuSince = { mode: '', checks: 0 };
  if (h.route) check('hostroute', false, 'host route map open for 3 checks', 3);
  else strikes.delete('hostroute');
  for (let i = 0; i < C.length; i++) {
    const c = cs[i];
    const name = C[i].name;
    if (!c) continue;
    const k = c.local;
    log(`${tag} ${name} role=${c.role} mode=${c.mode} screen=${c.screen} st${c.stage} lv${c.level} kills=${c.kills} gold=${c.gold} boss=${c.boss ? c.boss.id + '/' + c.boss.phase : '-'}`);
    if (c.role !== 'client') {
      check(`${name}role`, false, `${name} is not in the run (role ${c.role}, mode ${c.mode})`);
      continue;
    }
    // How far behind the host this client's last snapshot is (sim seconds). A starved page can fall
    // behind for a while; comparing state across that gap would only measure the machine.
    const behind = h.runTime - c.runTime;
    maxBehind[i] = Math.max(maxBehind[i], behind);
    if (behind > 1.5) {
      log(`${tag} ${name} is ${behind.toFixed(1)} s behind the host: state checks skipped this time`);
      check(`${name}behind`, false, `${name} stayed more than 1.5 s behind the host for 5 checks`, 5);
      continue;
    }
    strikes.delete(`${name}behind`);
    check(`${name}stage`, h.stage === c.stage, `${name}: stage host ${h.stage} vs ${c.stage}`);
    check(`${name}seed`, h.seed === c.seed, `${name}: seed host ${h.seed} vs ${c.seed}`);
    check(`${name}mode`, h.mode === c.mode, `${name}: mode host ${h.mode} vs ${c.mode}`);
    check(`${name}level`, Math.abs(h.level - c.level) <= 1, `${name}: team level host ${h.level} vs ${c.level}`);
    check(`${name}kills`, h.kills - c.kills <= 80 && c.kills <= h.kills, `${name}: kills host ${h.kills} vs ${c.kills}`);
    check(`${name}nheroes`, h.heroes.length === c.heroes.length, `${name}: ${c.heroes.length} heroes, host has ${h.heroes.length}`);
    const fighting = h.mode === 'fight' && c.mode === 'fight';
    if (fighting) {
      check(`${name}boss`, !!h.boss === !!c.boss && (!h.boss || h.boss.id === c.boss.id), `${name}: boss host ${JSON.stringify(h.boss)} vs ${JSON.stringify(c.boss)}`);
      if (h.boss && c.boss) check(`${name}phase`, h.boss.phase === c.boss.phase, `${name}: boss phase host ${h.boss.phase} vs ${c.boss.phase}`);
      check(`${name}mini`, !!h.mini === !!c.mini, `${name}: mini-boss host ${JSON.stringify(h.mini)} vs ${JSON.stringify(c.mini)}`);
    }
    // Stuck screens.
    const me = h.heroes[k];
    if (MENU.includes(c.screen)) {
      const ok =
        ((c.screen === 'levelup' || c.screen === 'relic') && h.mode === 'levelup' && me?.needsPick) ||
        ((c.screen === 'shop' || c.screen === 'relic') && h.mode === 'shop' && !me?.shopDone) ||
        (c.screen === 'wait' && (h.mode === 'levelup' || h.mode === 'shop')) ||
        (c.screen === 'route' && h.route);
      check(`${name}stuck`, ok, `${name} stuck on the ${c.screen} screen (host mode ${h.mode}, route ${h.route}, needsPick ${me?.needsPick}, shopDone ${me?.shopDone})`);
    } else strikes.delete(`${name}stuck`);
    if (me && !me.left && h.mode === 'levelup' && me.needsPick) check(`${name}nopick`, c.screen === 'levelup' || c.screen === 'relic', `${name}: host waits for its level-up pick but its screen is ${c.screen}`, 3);
    else strikes.delete(`${name}nopick`);
    // Heroes.
    for (let j = 0; j < h.heroes.length; j++) {
      const a = h.heroes[j];
      const b = c.heroes[j];
      if (!b) continue;
      check(`${name}left${j}`, a.left === b.left, `${name}: hero ${j} left host ${a.left} vs ${b.left}`);
      if (a.left) continue;
      check(`${name}hp${j}`, Math.abs(a.hp - b.hp) <= Math.max(12, a.hp * 0.25) && a.dead === b.dead, `${name}: hero ${j} hp host ${a.hp}${a.dead ? ' down' : ''} vs ${b.hp}${b.dead ? ' down' : ''}`, 3); // life swings fast (buy-backs, team-ult heals): a lagged view may catch two in a row
      check(`${name}weap${j}`, a.weapons === b.weapons, `${name}: hero ${j} build host [${a.weapons}] vs [${b.weapons}]`);
      check(`${name}mech${j}`, a.mech === b.mech, `${name}: hero ${j} mech host ${a.mech} vs ${b.mech}`);
      const lim = i === 1 ? 6 : 4;
      if (fighting && !a.dead) check(`${name}pos${j}`, Math.hypot(a.x - b.x, a.z - b.z) < lim, `${name}: hero ${j} position host ${a.x.toFixed(1)},${a.z.toFixed(1)} vs ${b.x.toFixed(1)},${b.z.toFixed(1)}`);
    }
    if (me) {
      check(`${name}gold`, Math.abs(me.gold - c.gold) <= 12, `${name}: own gold host ${me.gold} vs ${c.gold}`);
      check(`${name}passives`, me.passives === c.passives, `${name}: own passives host ${me.passives} vs ${c.passives}`);
      check(`${name}mods`, me.mods === c.mods, `${name}: own Mods host [${me.mods}] vs [${c.mods}]`);
    }
  }
  return { h, cs };
}

async function shot(tag) {
  await Promise.all(ALL.filter((p) => !away.has(p.name)).map((p) => p.page.screenshot({ path: join(OUT, `${tag}-${p.name}.png`), timeout: 60000 }).catch(() => {})));
}
const live = () => C.map((p, i) => i).filter((i) => !away.has(C[i].name));
/** Knock a hero down on the host (god mode off for the hit; no relic, pet or Phoenix saves it). */
const downHero = (i) =>
  host((i) => {
    const g = window.game;
    const h = g.heroes[i];
    window.cheats.god = false;
    h.revivesLeft = 0;
    h.phoenixUsed = true;
    h.petState.reviveUsed = true;
    h.petState.shieldReady = false;
    for (let k = 0; k < 6 && !h.player.dead; k++) {
      h.player.invuln = 0;
      h.player.hp = 1;
      g.hurtHero(h, 999, h.player.x + 1, h.player.z);
    }
    window.cheats.god = true;
    return h.player.dead;
  }, i);

// ---------------------------------------------------------------- scenario (times in simulated seconds)
const SCENARIO = [
  [6, 'enemy mix around every client', () =>
    host(async () => {
      const g = window.game;
      const { ENEMIES } = await import('/src/data/enemies.ts');
      const ids = ['shielder', 'medic', 'leaper', 'mortar', 'charger', 'sniper', 'splitter', 'shooter'];
      let n = 0;
      for (const h of g.heroes.slice(1)) {
        const c = h.player;
        ids.forEach((id, k) => {
          const a = (k / ids.length) * Math.PI * 2;
          if (ENEMIES[id]) (g.enemies.spawn(ENEMIES[id], c.x + Math.cos(a) * 10, c.z + Math.sin(a) * 10, g.spawnOpts()), n++);
        });
      }
      g.debugSpawnElite('charger', 'shielded');
      return n;
    })],
  [12, 'emotes and pings from every client', async () => {
    await resetRec();
    const em = ['wave', 'cheer', 'thumbs'];
    await Promise.all(live().map((i) => cl(i, (k) => {
      const g = window.game;
      g.client.send({ t: 'emote', k });
      const pl = g.hero.player;
      g.client.send({ t: 'ping', x: pl.x + 3, z: pl.z });
    }, em[i])));
    await simPause(2);
    const [h, ...cs] = await Promise.all([recOf(A), ...C.map(recOf)]);
    const want = [1, 2, 3];
    if (want.some((i) => !h.bubbles.includes(i))) fail(`emotes: host showed bubbles ${JSON.stringify(h.bubbles)}`);
    cs.forEach((r, i) => {
      if (want.some((x) => !r.bubbles.includes(x))) fail(`emotes: client${i + 1} showed bubbles ${JSON.stringify(r.bubbles)}`);
    });
    return { host: h.bubbles, clients: cs.map((r) => r.bubbles) };
  }],
  [18, 'mech suit for client 1, supply crate by client 2', async () => {
    await resetRec();
    await host(async () => {
      const g = window.game;
      const { startMech, spawnCrate } = await import('/src/game/systems/gameplay.ts');
      startMech(g, g.heroes[1]);
      const p = g.heroes[2].player;
      spawnCrate(g, p.x + 3, p.z, 'minigun');
    });
    await simPause(1.5);
    const recs = await Promise.all(C.map(recOf));
    const crates = await cl(2, async () => (await import('/src/game/systems/gameplay.ts')).gpWorld(window.game).drops.length);
    if (recs.some((r) => !r.mech.includes(1))) fail(`mech: clients saw hero 1 in a mech ${JSON.stringify(recs.map((r) => r.mech))}`);
    return { mech: recs.map((r) => r.mech), crates };
  }],
  [24, 'world event (flood)', async () => {
    await resetRec();
    const k = await host(async () => {
      const { startWorldEvent, worldEventOf } = await import('/src/game/systems/worldEvents.ts');
      startWorldEvent(window.game, 'flood');
      return worldEventOf(window.game)?.kind ?? null;
    });
    await simPause(1.5);
    const recs = await Promise.all(C.map(recOf));
    if (!k || recs.some((r) => !r.wev.includes(k))) fail(`world event: host ${k}, clients saw ${JSON.stringify(recs.map((r) => r.wev))}`);
    return { host: k, clients: recs.map((r) => r.wev) };
  }],
  [30, 'team move from client 1 with all four together', async () => {
    await host(() => {
      const g = window.game;
      const c = g.heroes[1].player;
      g.hero.player.teleport(c.x + 1.5, c.z);
      g.companionState().meter.charge = 1;
    });
    let r = null;
    for (let k = 0; k < 12 && !r; k++) {
      await cl(0, () => window.game.client.send({ t: 'team' }));
      r = await until(A.page, () => window.game.companionState().move?.id ?? null, 0.5);
    }
    const cs = await Promise.all(C.map((p) => until(p.page, (id) => window.game.companionState().move?.id === id && id, 2, r)));
    if (!r || cs.some((x) => x !== r)) fail(`team move: host ${r}, clients ${JSON.stringify(cs)}`);
    return { host: r, clients: cs };
  }],
  [36, 'map chest by client 2', async () => {
    const n = await host(() => {
      const g = window.game;
      const p = g.heroes[2].player;
      g.chests.add(p.x + 2, p.z + 2, 0);
      g.host.broadcast({ t: 'chestspawn', x: p.x + 2, z: p.z + 2, f: 0 });
      return g.chests.list.length;
    });
    const cs = await Promise.all(C.map((p) => until(p.page, (n) => window.game.chests.list.length >= n && window.game.chests.list.length, 2, n)));
    if (cs.some((x) => x !== n)) fail(`map chest: host ${n} chests, clients ${JSON.stringify(cs)}`);
    return { host: n, clients: cs };
  }],
  [42, 'client 3 drops out (connection lost, no goodbye)', async () => {
    away.add(C[2].name);
    await resetRec();
    await cl(2, () => {
      const c = window.game.client;
      // A lost connection: the peer goes away without `bye`.
      c.onClose = () => {};
      c.peer.destroy();
    });
    const g = await until(A.page, () => window.game.heroes[3] && !window.game.heroes[3].peerId && !window.game.heroes[3].left && window.game.heroes[3].remote !== null, 30);
    await simPause(1);
    const [h, c1, c2] = await Promise.all([recOf(A), recOf(C[0]), recOf(C[1])]);
    if (!g || !h.ai.includes(3)) fail(`drop-out: host hero 3 on autopilot ${g}, grace ${JSON.stringify(h.ai)}`);
    if (!c1.ai.includes(3) || !c2.ai.includes(3)) fail(`drop-out: clients' autopilot tags ${JSON.stringify([c1.ai, c2.ai])}`);
    // The page itself goes back to the title, as the real game does when the host is gone.
    await cl(2, () => window.game.leaveToTitle());
    return { autopilot: !!g, host: h.ai, clients: [c1.ai, c2.ai] };
  }],
  [52, 'client 3 drops back in (reclaims its hero)', async () => {
    await joinRun(C[2], 'CLIENT3', code);
    const ok = await until(C[2].page, () => window.game.role === 'client' && window.game.mode !== 'title' && window.game.local === 3 && window.game.heroes.length === 4, 30);
    const h = await host(async () => {
      const g = window.game;
      const s = (await import('/src/game/systems/coop2.ts')).coop2Debug(g);
      return { peer: !!g.heroes[3].peerId, left: g.heroes[3].left, grace: s.grace.length, pending: s.pending.length, heroes: g.heroes.length, players: g.director.players };
    });
    const status = await joinState(C[2]);
    if (!ok || !h.peer || h.left || h.grace || h.heroes !== 4) fail(`drop-in: client ${JSON.stringify(status)}, host ${JSON.stringify(h)}`);
    else away.delete(C[2].name);
    return { ok: !!ok, host: h, client: status };
  }],
  [62, 'client 2 downed, then revived', async () => {
    await downHero(2);
    const down = await Promise.all([until(A.page, () => window.game.heroes[2].player.dead, 2), until(C[1].page, () => window.game.hero.player.dead, 3)]);
    await host(() => window.game.reviveHero(window.game.heroes[2], 0.5));
    const up = await Promise.all([until(A.page, () => !window.game.heroes[2].player.dead, 2), until(C[1].page, () => !window.game.hero.player.dead, 3), until(C[0].page, () => !window.game.heroes[2].player.dead, 3)]);
    if (!down.every(Boolean) || !up.every(Boolean)) fail(`down/revive: down ${JSON.stringify(down)}, up ${JSON.stringify(up)}`);
    return { down, up };
  }],
  [68, 'revive pool: client 1 downed, buys back in', async () => {
    const before = await host(async () => {
      const g = window.game;
      for (const h of g.heroes) h.gold += 40;
      // Teammates standing close would revive it for free (and block the buy-back): no walk-up revives for this one.
      window.__revives = g.updateRevives;
      g.updateRevives = () => {};
      return (await import('/src/game/systems/coop2.ts')).coop2Debug(g).pool.lives;
    });
    await simPause(0.5);
    const dead = await downHero(1);
    // The BUY BACK panel fills over 5 s; the client presses it as soon as it can.
    const seen = await until(C[0].page, () => window.game.hero.player.dead, 3);
    const can = seen && (await until(C[0].page, async () => {
      const n = (await import('/src/game/systems/coop2.ts')).coop2Debug(window.game).net;
      return (n.buy && n.buy[1]) || !window.game.hero.player.dead ? n.buy ?? 'revived another way' : null;
    }, 12));
    if (Array.isArray(can)) await cl(0, () => window.game.client.send({ t: 'cobuy' }));
    const up = await until(A.page, () => !window.game.heroes[1].player.dead, 3);
    const after = await host(async () => {
      window.game.updateRevives = window.__revives;
      return (await import('/src/game/systems/coop2.ts')).coop2Debug(window.game).pool.lives;
    });
    const cUp = await until(C[0].page, () => !window.game.hero.player.dead, 3);
    if (!dead || !up || !cUp || !Array.isArray(can) || after !== before - 1) fail(`revive pool: down ${dead} (client saw it ${seen}), buy ${JSON.stringify(can)}, up host ${up} client ${cUp}, lives ${before} -> ${after}`);
    return { before, can, after, up: [up, cUp] };
  }],
  [76, 'team ultimate (everyone fires within the window)', async () => {
    await resetRec();
    const before = await host(async () => (await import('/src/game/systems/coop2.ts')).coop2Debug(window.game).ult.count);
    // Fill everyone's ultimate at once; every bot fires it as soon as it sees it full.
    await host(() => {
      const g = window.game;
      for (const h of g.heroes) if (!h.left) ((h.skill.ult = 1), (h.skill.ultT = 0));
      g.tryUlt(g.hero);
    });
    await Promise.all(live().map((i) => cl(i, () => window.game.client?.send({ t: 'ult' }))));
    const n = await until(A.page, async (b) => (await import('/src/game/systems/coop2.ts')).coop2Debug(window.game).ult.count > b, 4, before);
    await simPause(1);
    const beats = await Promise.all(live().map((i) => recOf(C[i]).then((r) => r?.beats ?? 0)));
    if (!n || beats.some((b) => b < 1)) fail(`team ultimate: host fired ${!!n}, client beats ${JSON.stringify(beats)}`);
    return { host: !!n, beats };
  }],
  [86, 'stage boss now', () => host(() => window.game.debugBoss({ now: true }))],
  [96, 'boss to phase 3', () => host(() => {
    const b = window.game.boss;
    if (b?.active) b.hp = Math.min(b.hp, b.maxHp * 0.3);
    return !!b?.active;
  })],
  [100, 'boss killed (finisher), owned chests for everyone', async () => {
    const id = await host(() => {
      const g = window.game;
      const b = g.boss && g.boss.active ? g.boss : null;
      if (!b) return null;
      g.killEnemy(b, 'buster', g.heroes[2]);
      return b.def.id;
    });
    // Killed already by the bots: its chests dropped all the same, so check them either way.
    // Each hero has its own chest; every one must reach its owner (the stage-clear pull) before the stage ends.
    const r = await until(A.page, async () => {
      const g = window.game;
      const { PickupType } = await import('/src/game/pickups.ts');
      let chests = 0;
      for (let i = 0; i < g.pickups.count; i++) if (g.pickups.type[i] === PickupType.Chest && g.pickups.value[i] >= 100) chests++; // owned (boss) chests
      return g.mode !== 'fight' && chests === 0 && { mode: g.mode };
    }, 12);
    const left = await host(async () => {
      const g = window.game;
      const { PickupType } = await import('/src/game/pickups.ts');
      const out = [];
      for (let i = 0; i < g.pickups.count; i++) if (g.pickups.type[i] === PickupType.Chest) out.push([g.pickups.value[i], +g.pickups.x[i].toFixed(1), +g.pickups.z[i].toFixed(1)]);
      return { mode: g.mode, chests: out, heroes: g.heroes.map((h) => [h.index, +h.player.x.toFixed(1), +h.player.z.toFixed(1), h.chestsPending, h.relics.length]) };
    });
    if (!r) fail(`boss chests: not all taken: ${JSON.stringify(left)}`);
    return { boss: id ?? 'killed by the bots', after: left };
  }],
];
SCENARIO.sort((a, b) => a[0] - b[0]);

SIM0 = await simNow();
let next = 0;
let lastCheck = 0;
let stage2At = 0;
let shots = 0;
const wall0 = Date.now();
for (;;) {
  const t = (await simNow()) - SIM0;
  if (t >= SECS || (Date.now() - wall0) / 1000 > SECS * 12) {
    log(`stopping at ${t.toFixed(0)} simulated s`);
    break;
  }
  while (next < SCENARIO.length && SCENARIO[next][0] <= t) {
    const [, what, fn] = SCENARIO[next++];
    try {
      const r = await fn();
      log(`scenario: ${what}${r !== undefined ? ` -> ${JSON.stringify(r)}` : ''}`);
    } catch (e) {
      fail(`scenario "${what}" threw: ${e.message.split('\n')[0]}`);
    }
  }
  if (t - lastCheck >= 4) {
    lastCheck = t;
    try {
      const { h } = await compare(`t=${t.toFixed(0)}`);
      if (h.stage >= 2 && h.mode === 'fight' && !stage2At) {
        stage2At = t;
        log('reached stage 2');
      }
    } catch (e) {
      fail(`compare threw: ${e.message.split('\n')[0]}`);
    }
  }
  if (t > 30 * (shots + 1)) await shot(`t${30 * ++shots}`);
  // Stage 2 for a while, then stop.
  if (stage2At && t - stage2At > 40) break;
  if (ALL.some((p) => p.errors.length)) break;
  await pause(250);
}
if (!stage2At) fail('the run never reached stage 2');

// ---------------------------------------------------------------- numbers
const stats = await Promise.all(
  ALL.map((p) =>
    p.page.evaluate(() => {
      const st = window.__st;
      if (!st) return null;
      const s = [...st.upd].sort((a, b) => a - b);
      const q = (f) => s[Math.min(s.length - 1, Math.floor(s.length * f))] ?? 0;
      const secs = (performance.now() - st.t0) / 1000;
      return { avg: st.updSum / Math.max(1, st.updN), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: st.updMax, stepsPerSec: (window.game.stepN - st.steps0) / secs, snap: st.snap, snapMs: st.snapMs / Math.max(1, st.snapN), over: st.over / Math.max(1, st.updN), slow: st.slow };
    }).catch(() => null),
  ),
);
const hs = stats[0];
if (hs) {
  const sp = [...speeds].sort((a, b) => a - b);
  log(`host update (4 players): avg ${hs.avg.toFixed(2)} ms, p50 ${hs.p50.toFixed(2)}, p95 ${hs.p95.toFixed(2)}, p99 ${hs.p99.toFixed(2)}, max ${hs.max.toFixed(1)} ms per 1/60 s step; ${hs.stepsPerSec.toFixed(1)} steps/s; buildSnapshot ${hs.snapMs.toFixed(3)} ms per client; sim speed median x${(sp[sp.length >> 1] ?? 0).toFixed(2)} of real time`);
  log(`host steps over 16.7 ms: ${(hs.over * 100).toFixed(2)}%; steps over 0.5 s (step, mode, ms): ${JSON.stringify(hs.slow)}`);
  for (const [i, s] of Object.entries(hs.snap)) log(`snapshots to hero ${i}: ${s.n}, avg ${Math.round(s.total / s.n)} B, max ${s.max} B, ${s.over16k} over 16 KB (~${((s.total / s.n) * 20 / 1024).toFixed(1)} KB/s at 20 Hz)`);
}
log(`most a client's snapshots fell behind the host (sim s): ${maxBehind.map((x) => x.toFixed(1)).join(', ')}`);
stats.slice(1).forEach((s, i) => s && log(`client${i + 1} update: avg ${s.avg.toFixed(2)} ms, p95 ${s.p95.toFixed(2)} ms, ${s.stepsPerSec.toFixed(1)} steps/s`));
await shot('end');

// ---------------------------------------------------------------- Versus Swarm (client 1 is the Overlord)
async function versusSmoke() {
  for (const p of C) away.add(p.name);
  await host(() => window.game.leaveToTitle());
  await pause(1500);
  code = await host_('HOSTBOT');
  for (let i = 0; i < 3; i++) await joinRun(C[i], `CLIENT${i + 1}`, code);
  await A.page.waitForFunction(() => window.game.lobby.length === 4, null, { timeout: 120000 });
  await host(async () => {
    const g = window.game;
    const { mpState } = await import('/src/game/systems/mp.ts');
    g.lobbyKind = 'versus';
    mpState(g).overlordPeer = g.lobby[1].peerId;
    g.refreshLobby();
    g.hostStart();
  });
  for (const p of C) await p.page.waitForFunction(() => window.game.role === 'client' && window.game.mode !== 'title' && window.game.heroes.length === 4, null, { timeout: 120000 });
  // The starting shop closes (bots), then the Overlord (client 1) orders a Swarm Pack at the first beacon.
  let r = null;
  for (let k = 0; k < 10; k++) {
    await simPause(1.5);
    await cl(0, () => {
      const g = window.game;
      const v = g.versus;
      const at = v?.markers?.[0] ?? { x: 10, z: 10 };
      g.client.send({ t: 'vcmd', c: 'swarm', x: at.x, z: at.z });
    });
    r = await host(() => {
      const g = window.game;
      const v = g.versus;
      return v && { mode: g.mode, overlord: v.overlord, points: Math.round(v.st.points), swarmers: g.enemies.list.filter((e) => e.active && e.def.id === 'swarmer').length, bench: g.heroes[1].left };
    });
    if (r?.swarmers > 0) break;
  }
  const cs = await Promise.all(C.map((p, i) => until(p.page, () => {
    const g = window.game;
    return g.versus?.overlord === 1 && { mode: g.mode, overlord: g.versus.overlord, enemies: g.enemies.list.filter((e) => e.active).length };
  }, 3)));
  // The Overlord looks at the beacon (its camera focus steers its interest box through `vcam`): it must see its swarm.
  const sees = await cl(0, () => {
    const g = window.game;
    window.botAuto(false);
    const at = g.versus.markers?.[0] ?? { x: 10, z: 10 };
    g.versus.camX = at.x;
    g.versus.camZ = at.z;
    return true;
  }).then(() => until(C[0].page, () => window.game.enemies.list.filter((e) => e.active && e.def.id === 'swarmer').length, 4));
  log(`versus: host ${JSON.stringify(r)}, clients ${JSON.stringify(cs)}, the Overlord sees ${sees} swarmers at its beacon`);
  if (!(sees > 0)) fail(`versus: the Overlord client sees no swarmers where it looks (${sees})`);
  if (!r || r.overlord !== 1 || !r.bench || !(r.swarmers > 0)) fail(`versus: host ${JSON.stringify(r)}`);
  if (cs.some((c) => !c)) fail(`versus: clients ${JSON.stringify(cs)}`);
  await simPause(5);
  await shot('versus');
  await host(() => window.game.leaveToTitle());
  await pause(1500);
}

// ---------------------------------------------------------------- local co-op (one PC, three fake pads)
async function localSmoke() {
  for (const p of ALL) await p.page.close().catch(() => {}); // the online pages are done; free the CPU
  ALL.length = 0;
  const L = await openPage('local', '?test&localcoop=run&lcpads=3&god');
  ALL.push(L);
  await L.page.evaluate(() => window.botAuto(true));
  const t0 = await L.page.evaluate(() => window.game.stepN);
  await L.page.waitForFunction((t0) => window.game.stepN - t0 > 60 * 20, t0, { timeout: 600000 }).catch(() => {});
  const r = await L.page.evaluate(() => {
    const g = window.game;
    return { mode: g.mode, heroes: g.heroes.length, alive: g.aliveHeroes.length, kills: g.kills, level: g.level, at: g.heroes.map((h) => [+h.player.x.toFixed(1), +h.player.z.toFixed(1)]) };
  });
  log(`local co-op: ${JSON.stringify(r)}`);
  if (r.heroes !== 4 || r.mode === 'title' || r.mode === 'dead' || !(r.kills > 0)) fail(`local co-op: ${JSON.stringify(r)}`);
  await L.page.screenshot({ path: join(OUT, 'local.png'), timeout: 60000 }).catch(() => {});
}

if (EXTRA && !ALL.some((p) => p.errors.length)) {
  try {
    await versusSmoke();
  } catch (e) {
    fail(`versus smoke threw: ${e.message.split('\n')[0]}`);
  }
  for (const p of ALL) for (const e of p.errors) fail(`${p.name} page error: ${e}`);
  for (const p of ALL) p.errors.length = 0;
  try {
    await localSmoke();
  } catch (e) {
    fail(`local co-op smoke threw: ${e.message.split('\n')[0]}`);
  }
}
await done();

async function done() {
  for (const p of ALL) for (const e of p.errors) fail(`${p.name} page error: ${e}`);
  await browser.close().catch(() => {});
  await server.close();
  console.log(failures.length ? `\nCO-OP STRESS TEST FAILED (${failures.length}):\n- ${[...new Set(failures)].join('\n- ')}` : '\nCO-OP STRESS TEST PASSED');
  process.exit(failures.length ? 1 : 0);
}
