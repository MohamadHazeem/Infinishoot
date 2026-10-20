// Host migration test (hostmig lane): real game instances in headless Chromium play online co-op over the
// PeerJS broker, then the host's page is closed (no goodbye: a crash) mid-fight, and later the new host's page
// mid-shop (the first like a crash, no goodbye; the second a closing tab). The run must go on for everyone left with the same state.
//   npm run migrate [-- --players 4] [--runs 3] [--out shots/migrate] [--netsim 70,30,0.02|off]
// With 4 players (default): A hosts, B, C, D join. A is killed mid-fight -> B must take over (lowest join order),
// C and D reconnect to B and reclaim their heroes. Then B is killed with the shop open -> C takes over, D reclaims
// and both still have the shop with the same offers and gold. With --players 3 the second kill leaves one player,
// who must carry on solo with the shop still open. The last page's link is simulated as a bad one (lag + jitter +
// retransmit stalls) unless --netsim off. Each run fails on page errors, a missing or doubled host, lost heroes,
// builds that changed across the migration, or host and clients disagreeing afterwards. Screenshots in --out.
// HOSTMIG_SECS=<s> sets the fight time before the first kill (default 20). Needs internet (the PeerJS broker).
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
const PLAYERS = Math.max(3, Math.min(4, Number(opt('--players', '4'))));
const RUNS = Math.max(1, Number(opt('--runs', '1')));
const OUT = opt('--out', join('shots', 'migrate'));
const NETSIM = opt('--netsim', '70,30,0.02') === 'off' ? '' : opt('--netsim', '70,30,0.02');
const FIGHT_SECS = Number(process.env.HOSTMIG_SECS ?? 20);
const WAIT_MS = Number(process.env.HOSTMIG_WAIT_MS ?? 150000);
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
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
let failures = [];
const fail = (msg) => {
  failures.push(msg);
  log('FAIL', msg);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// No file watching: edits made while a long run goes on must not hand the pages a second copy of a module.
const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const base = `http://127.0.0.1:${server.config.server.port ?? server.httpServer.address().port}/`;
const browser = await chromium.launch({
  headless: true,
  executablePath: findChrome(),
  args: [`--use-angle=${process.env.COOP_ANGLE ?? 'swiftshader'}`, '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

const NAMES = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'];

async function openPage(name) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  // Low graphics: four headless pages share one busy machine.
  await ctx.addInitScript(() => localStorage.setItem('infinishoot.settings.v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('infinishoot.settings.v1') ?? '{}'), graphics: 0, bossIntros: false })));
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack ?? '').split('\n').slice(1, 4).join('\n')}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|Failed to load resource|AudioContext was not allowed|WebGL: INVALID_OPERATION|GPU stall|PeerJS|Could not connect to peer|Lost connection to server/i.test(t)) return;
    errors.push(t);
  });
  await page.goto(base + '?season=off', { timeout: 300000 });
  await page.waitForFunction(() => window.game && window.botAuto && window.game.mode === 'title', null, { timeout: 300000 });
  return { name, page, ctx, errors, closed: false };
}

async function until(p, fn, arg, ms = 10000) {
  const t = Date.now();
  let v;
  do {
    try {
      v = await p.page.evaluate(fn, arg);
    } catch {
      v = undefined;
    }
    if (v) return v;
    await pause(250);
  } while (Date.now() - t < ms);
  return v;
}

async function shot(pages, tag) {
  try {
    await Promise.all(pages.map((p) => p.page.screenshot({ path: join(OUT, `${tag}-${p.name.toLowerCase()}.png`), timeout: 90000 })));
    log(`screenshots ${tag}`);
  } catch (e) {
    log(`screenshots ${tag} skipped: ${String(e.message).split('\n')[0]}`);
  }
}

/** What a page knows about the run (host: authoritative; client: its mirror). */
const probe = (p) =>
  p.page.evaluate(async () => {
    const g = window.game;
    const { netcodeState } = await import('/src/game/systems/netcode.ts');
    const hm = g.hostmig ?? { migrations: 0, events: [], mig: null };
    return {
      role: g.role,
      mode: g.mode,
      screen: g.screens.current,
      stage: g.stage,
      level: g.level,
      local: g.local,
      code: g.host?.code ?? g.client?.code ?? '',
      rc: !!netcodeState(g).rc,
      heroes: g.heroes.map((h) => ({
        name: h.name,
        left: h.left,
        peer: h.peerId,
        gold: h.gold,
        weapons: h.weapons.map((w) => w.def.id + ':' + (w.build ? w.buildKey : w.level)).join(' '),
        passives: JSON.stringify(Object.entries(h.passives).sort()),
        mods: h.synergy.slots.map((s) => s.def.id + s.level).join(' '),
        shop: h.shopOffers.map((m) => m?.id ?? '-').join(' '),
        shopDone: h.shopDone,
      })),
      enemies: g.enemies.list.filter((e) => e.active).length,
      grace: g.role === 'client' ? [] : g.heroes.filter((h) => !h.left && !h.peerId && h !== g.hero).map((h) => h.index),
      pending: g.heroes.map((h) => h.pendingLevels + h.chestsPending),
      hasMig: !!hm.mig,
      migrations: hm.migrations,
      events: hm.events.slice(-12),
      netEvents: netcodeState(g).events.slice(-8),
    };
  });

const setup = (p, i, n) =>
  p.page.evaluate(
    async ({ i, n, netsim }) => {
      const { netQualityTuning } = await import('/src/net/netQuality.ts');
      const { chestTuning } = await import('/src/game/game.ts');
      const { settings } = await import('/src/game/settings.ts');
      // Headless pages stall for seconds on a busy machine: hosts are patient with clients, clients notice a dead host.
      netQualityTuning.dropMs = 30000;
      netQualityTuning.hostSilentMs = 12000;
      chestTuning.every = 1e9; // map chests change builds at random moments; the build checks want a quiet window
      settings.coopJoinable = true;
      window.cheats.god = true;
      window.game.saveName(['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'][i]);
      if (netsim && i === n - 1) {
        const m = await import('/src/net/netsim.ts');
        m.setNetSim(m.parseNetSim(netsim));
      }
    },
    { i, n, netsim: NETSIM },
  );

/** Connection internals, for a failure report. */
const dump = (p) =>
  p.page.evaluate(async () => {
    const g = window.game;
    const { netcodeState } = await import('/src/game/systems/netcode.ts');
    const ns = netcodeState(g);
    const now = performance.now();
    return {
      role: g.role,
      mode: g.mode,
      screen: g.screens.current,
      stepN: g.stepN,
      paused: g.paused,
      lastSnap: ns.lastSnapStep,
      playout: ns.playout ? { last: ns.playout.lastStep, render: Math.round(ns.playout.renderStep), stats: ns.playout.stats } : null,
      heardAgo: g.client ? Math.round(now - g.client.lastHeard) : null,
      peers: g.heroes.map((h) => h.peerId.slice(0, 8)),
      lastHeard: g.host?.lastHeard ? [...g.host.lastHeard.entries()].map(([k, v]) => [k.slice(0, 8), Math.round(now - v)]) : null,
      hm: g.hostmig?.events?.slice(-10),
      net: ns.events.slice(-10),
    };
  });

/** Every hero's build as the given page sees it (host: authoritative). */
const builds = (p) =>
  p.page.evaluate(() =>
    window.game.heroes.map((h) => ({
      weapons: h.weapons.map((w) => w.def.id + ':' + (w.build ? w.buildKey : w.level)).join(' '),
      passives: JSON.stringify(Object.entries(h.passives).sort()),
      mods: h.synergy.slots.map((s) => s.def.id + s.level).join(' '),
      relics: h.relics.join(' '),
      left: h.left,
    })),
  );

/** Freeze levelling on whoever hosts (and on everyone who might): the build checks need a quiet window. */
const freezeXp = (pages, on) =>
  Promise.all(
    pages.map((p) =>
      p.page.evaluate(async (on) => {
        const g = window.game;
        const { xpForLevel } = await import('/src/game/game.ts');
        if (g.role === 'client') return;
        g.xpNext = on ? 1e12 : xpForLevel(g.level);
        if (on) g.xp = 0;
      }, on),
    ),
  );

/** Wait until the survivors settle: one host (or a solo player), everyone else back in as a client. */
async function waitMigrated(pages, expectHost, expectRole, nHeroes, label) {
  const t = Date.now();
  let st = [];
  while (Date.now() - t < WAIT_MS) {
    st = await Promise.all(pages.map((p) => probe(p).catch((e) => ({ err: String(e) }))));
    const hosts = st.filter((s) => s.role === 'host' || s.role === 'solo');
    // Every client must be connected to the new host's room (a client that hasn't noticed the loss yet still shows the old code).
    const room = st[expectHost]?.code ?? '';
    const ok = hosts.length === 1 && st[expectHost]?.role === expectRole && st.every((s, i) => i === expectHost || (s.role === 'client' && !s.rc && s.mode !== 'title' && s.heroes.length === nHeroes && s.code === room));
    if (ok) {
      log(`${label}: settled after ${((Date.now() - t) / 1000).toFixed(1)} s (${pages[expectHost].name} is ${expectRole})`);
      return st;
    }
    await pause(1000);
  }
  fail(`${label}: no clean takeover within ${WAIT_MS / 1000} s: ${JSON.stringify(st.map((s) => ({ role: s.role, mode: s.mode, rc: s.rc, heroes: s.heroes?.length, ev: s.events, net: s.netEvents, err: s.err })))}`);
  return null;
}

/** Host and clients agree (stage, mode, level, every hero's weapons; a client's own gold). Retries for the lag. */
async function agree(pages, hostIdx, label) {
  let last = '';
  for (let k = 0; k < 12; k++) {
    const st = await Promise.all(pages.map((p) => probe(p)));
    const h = st[hostIdx];
    const bad = [];
    st.forEach((c, i) => {
      if (i === hostIdx) return;
      if (c.stage !== h.stage) bad.push(`${pages[i].name} stage ${c.stage} vs ${h.stage}`);
      if (c.level !== h.level) bad.push(`${pages[i].name} level ${c.level} vs ${h.level}`);
      if (c.heroes.length !== h.heroes.length) bad.push(`${pages[i].name} ${c.heroes.length} heroes vs ${h.heroes.length}`);
      c.heroes.forEach((x, j) => {
        if (!h.heroes[j] || h.heroes[j].left) return;
        if (x.weapons !== h.heroes[j].weapons) bad.push(`${pages[i].name} sees ${h.heroes[j].name}'s weapons "${x.weapons}" vs "${h.heroes[j].weapons}"`);
      });
      if (c.heroes[c.local] && Math.abs(c.heroes[c.local].gold - h.heroes[c.local].gold) > 3) bad.push(`${pages[i].name} gold ${c.heroes[c.local].gold} vs ${h.heroes[c.local].gold}`);
    });
    if (!bad.length) {
      log(`${label}: host and clients agree (stage ${h.stage}, level ${h.level}, mode ${h.mode}, ${h.enemies} enemies)`);
      return true;
    }
    last = bad.join('; ');
    await pause(1500);
  }
  fail(`${label}: host and clients disagree: ${last}`);
  for (const p of pages) log(`${label} dump ${p.name}: ${JSON.stringify(await dump(p).catch((e) => String(e)))}`);
  return false;
}

function sameBuilds(before, after, label, skip = new Set()) {
  const diff = [];
  before.forEach((b, i) => {
    if (b.left || skip.has(i)) return;
    const a = after[i];
    if (!a) diff.push(`hero ${i} missing`);
    else for (const k of ['weapons', 'passives', 'mods', 'relics']) if (a[k] !== b[k]) diff.push(`hero ${i} ${k}: "${b[k]}" -> "${a[k]}"`);
  });
  if (diff.length) fail(`${label}: builds changed across the migration: ${diff.join('; ')}`);
  else log(`${label}: every hero's build survived the migration`);
}

async function kill(p, label, crash) {
  log(`${label}: closing ${p.name}'s page (${crash ? 'like a crash: no goodbye' : 'the tab closes: its goodbye goes out'})`);
  if (crash) await p.page.evaluate(() => (window.game.hostmig.crashTest = true)).catch(() => {});
  p.closed = true;
  await p.page.close({ runBeforeUnload: false }).catch(() => {});
  await p.ctx.close().catch(() => {});
}

async function oneRun(run) {
  log(`---- run ${run}/${RUNS}: ${PLAYERS} players${NETSIM ? `, last player's link simulated ${NETSIM}` : ''}`);
  const pages = [];
  for (let i = 0; i < PLAYERS; i++) pages.push(await openPage(NAMES[i]));
  log('pages loaded');
  await Promise.all(pages.map((p, i) => setup(p, i, PLAYERS)));
  const [A] = pages;
  await A.page.evaluate(() => void window.game.hostGame('ALPHA', true));
  const code = await until(A, async () => {
    const g = window.game;
    if (!g.host) return '';
    try {
      await g.host.ready;
    } catch {
      return '';
    }
    return g.host.code;
  }, null, 60000);
  if (!code) {
    fail('host could not register with the signalling server');
    return pages;
  }
  log(`hosting, code ${code}`);
  // Join one at a time: the join order is the hero order the election uses.
  for (let i = 1; i < PLAYERS; i++) {
    let ok = false;
    // The public broker can be slow or drop a signalling attempt: up to three tries.
    for (let k = 0; k < 3 && !ok; k++) {
      await pages[i].page.evaluate(([n, c]) => void window.game.joinGame(n, c), [NAMES[i], code]);
      ok = await until(A, (n) => window.game.lobby.length >= n, i + 1, 60000);
      if (!ok) log(`${NAMES[i]} join try ${k + 1} failed: ${await pages[i].page.evaluate(() => document.querySelector('#scr-online')?.innerText?.replace(/\s+/g, ' ').slice(0, 160))}`);
    }
    if (!ok) {
      fail(`${NAMES[i]} never joined the lobby`);
      return pages;
    }
  }
  log(`${PLAYERS} players in the lobby, starting`);
  await A.page.evaluate(() => window.game.hostStart());
  for (const p of pages.slice(1)) if (!(await until(p, (n) => window.game.mode !== 'title' && window.game.heroes.length === n, PLAYERS, 90000))) fail(`${p.name} never started the run`);
  await Promise.all(pages.map((p) => p.page.evaluate(() => window.botAuto(true))));
  log(`run started, bots on; fighting ${FIGHT_SECS} s`);
  await pause(FIGHT_SECS * 1000);
  // Wherever the run is (the starting shop, a level-up), get to a fight for the first kill.
  if (!(await until(A, () => window.game.mode === 'fight', null, 90000))) fail(`the host never reached a fight (${await A.page.evaluate(() => window.game.mode)})`);
  const snapsOk = await Promise.all(pages.slice(1).map((p) => until(p, () => !!window.game.hostmig?.mig, null, 15000)));
  if (snapsOk.some((x) => !x)) fail('a client never received a migration snapshot');

  // ---------------------------------------------------------------- 1: the host dies mid-fight
  await freezeXp(pages, true);
  await pause(3500); // a level-up in flight ends; the migration snapshot catches up
  if ((await A.page.evaluate(() => window.game.mode)) !== 'fight') await until(A, () => window.game.mode === 'fight', null, 30000);
  const pre = await builds(A);
  const preState = await probe(A);
  await kill(A, 'mid-fight', true);
  const surv1 = pages.slice(1);
  const st1 = await waitMigrated(surv1, 0, 'host', PLAYERS, 'migration 1 (mid-fight)');
  if (!st1) return pages;
  const B = surv1[0];
  const h1 = st1[0];
  sameBuilds(pre, await builds(B), 'migration 1');
  if (h1.stage !== preState.stage) fail(`migration 1: stage ${preState.stage} -> ${h1.stage}`);
  if (h1.level < preState.level) fail(`migration 1: team level went down ${preState.level} -> ${h1.level}`);
  log(`migration 1: team level ${preState.level} -> ${h1.level}, picks waiting before ${preState.pending} after ${h1.pending}`);
  if (!h1.code.includes('-M1H1')) fail(`migration 1: the new room is ${h1.code}, expected <code>-M1H1`);
  if (!h1.grace.includes(0)) fail(`migration 1: the old host's hero isn't on the autopilot (${h1.grace})`);
  if (h1.enemies < Math.min(10, preState.enemies * 0.5)) fail(`migration 1: the horde shrank from ${preState.enemies} to ${h1.enemies}`);
  log(`migration 1: ${preState.enemies} enemies on the old host, ${h1.enemies} on the new one; events ${JSON.stringify(h1.events)}`);
  st1.slice(1).forEach((s, i) => {
    if (s.heroes[s.local]?.name !== NAMES[i + 2]) fail(`migration 1: ${surv1[i + 1].name} came back as ${s.heroes[s.local]?.name} (hero ${s.local})`);
  });
  await agree(surv1, 0, 'migration 1');
  await shot(surv1, `run${run}-after-fight-migration`);
  await freezeXp(surv1, false);
  await pause(10000);
  await agree(surv1, 0, 'migration 1 (+10 s)');

  // ---------------------------------------------------------------- 2: the new host dies with the shop open
  await Promise.all(surv1.map((p) => p.page.evaluate(() => window.botAuto(false))));
  await until(B, () => window.game.mode === 'fight' || window.game.mode === 'levelup', null, 30000);
  // Finish any open level-up by hand (bots are off), then clear the stage: the shop opens.
  for (let k = 0; k < 40; k++) {
    const m = await B.page.evaluate(() => {
      const g = window.game;
      if (g.mode === 'levelup' && g.hero.needsPick) g.ui('pick', 0);
      return g.mode;
    });
    await Promise.all(surv1.slice(1).map((p) => p.page.evaluate(() => window.game.screens.current === 'levelup' && window.game.ui('pick', 0))));
    if (m === 'fight') break;
    await pause(500);
  }
  await freezeXp(surv1, true);
  await B.page.evaluate(() => window.game.stageClear());
  const shopOpen = await Promise.all(surv1.map((p) => until(p, () => window.game.screens.current === 'shop', null, 30000)));
  if (shopOpen.some((x) => !x)) fail(`the shop didn't open everywhere (${await Promise.all(surv1.map((p) => p.page.evaluate(() => window.game.screens.current)))})`);
  // One player has already bought something: the purchase must survive too.
  const bought = await surv1[1].page.evaluate(() => {
    const g = window.game;
    g.ui('buy', 0);
    return true;
  });
  await pause(3500);
  const preShop = await probe(B);
  const preB2 = await builds(B);
  await shot(surv1, `run${run}-shop-before`);
  await kill(B, 'mid-shop', false);
  const surv2 = surv1.slice(1);
  const solo = surv2.length === 1;
  const st2 = await waitMigrated(surv2, 0, solo ? 'solo' : 'host', PLAYERS, `migration 2 (mid-shop${solo ? ', solo fallback' : ''})`);
  if (!st2) return pages;
  const C = surv2[0];
  sameBuilds(preB2, await builds(C), 'migration 2', new Set([1]));
  const h2 = st2[0];
  if (h2.mode !== 'shop') fail(`migration 2: the new host isn't in the shop (${h2.mode})`);
  for (let i = 2; i < PLAYERS; i++) {
    const a = preShop.heroes[i];
    const b = h2.heroes[i];
    if (a.shop !== b.shop) fail(`migration 2: ${a.name}'s shop offers changed "${a.shop}" -> "${b.shop}"`);
    if (a.gold !== b.gold) fail(`migration 2: ${a.name}'s gold changed ${a.gold} -> ${b.gold}${bought ? ' (after a purchase)' : ''}`);
  }
  if (!solo) {
    if (!h2.code.includes('-M2H2')) fail(`migration 2: the new room is ${h2.code}, expected <code>-M2H2`);
    const back = await until(surv2[1], () => ['shop', 'wait'].includes(window.game.screens.current) && window.game.screens.current, null, 30000);
    if (!back) fail(`migration 2: ${surv2[1].name} didn't get the shop back (${await surv2[1].page.evaluate(() => window.game.screens.current)})`);
    else log(`migration 2: ${surv2[1].name} is back on its ${back} screen`);
  }
  await shot(surv2, `run${run}-after-shop-migration`);
  // Everyone finishes shopping; the run must go on to the next stage together.
  await freezeXp(surv2, false);
  await Promise.all(surv2.map((p) => p.page.evaluate(() => window.botAuto(true))));
  const next = (h2.stage ?? 1) + 1;
  const moved = await Promise.all(surv2.map((p) => until(p, (s) => window.game.stage >= s && window.game.mode === 'fight', next, 150000)));
  if (moved.some((x) => !x)) fail(`after migration 2 the run didn't reach stage ${next} on everyone (${JSON.stringify(await Promise.all(surv2.map((p) => p.page.evaluate(() => [window.game.mode, window.game.stage, window.game.screens.current]))))})`);
  else log(`after migration 2: everyone reached stage ${next}`);
  if (!solo) await agree(surv2, 0, 'migration 2 (next stage)');
  await shot(surv2, `run${run}-next-stage`);
  const fin = await Promise.all(surv2.map((p) => probe(p)));
  log(`run ${run}: migrations counted ${fin.map((s) => s.migrations).join(', ')}; host events ${JSON.stringify(fin[0].events)}`);
  return pages;
}

for (let run = 1; run <= RUNS; run++) {
  const before = failures.length;
  let pages = [];
  try {
    pages = await oneRun(run);
  } catch (e) {
    fail(`run ${run} crashed: ${e?.stack ?? e}`);
  }
  for (const p of pages) for (const e of p.errors) fail(`${p.name} page error: ${e}`);
  for (const p of pages) if (!p.closed) await p.ctx.close().catch(() => {});
  log(failures.length === before ? `run ${run} PASSED` : `run ${run} FAILED (${failures.length - before})`);
  if (failures.length > before) break;
}
await browser.close().catch(() => {});
await server.close();
console.log(failures.length ? `\nMIGRATION TEST FAILED (${failures.length}):\n- ${[...new Set(failures)].join('\n- ')}` : `\nMIGRATION TEST PASSED (${RUNS} run${RUNS > 1 ? 's' : ''} in a row)`);
process.exit(failures.length ? 1 : 0);
