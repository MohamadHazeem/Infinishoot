// Online co-op test with two real game instances in headless Chromium. The host plays the Tinker and the client
// the Ronin (COOP_HEROES=host,client picks others).
//   npm run coop [-- --secs 80] [--out shots/coop] [--size 960x540]
// Page A hosts an online co-op game, page B joins with the invite code, and
// both play with the dev autoplay bot (src/dev/bot.ts `botAuto`), at night in
// the rain. Along the way the script forces situations through the dev
// handles: new enemy types, an elite and the Goldbug near the client, the
// client taking a jump pad and switching on a turret, a toppled pillar,
// ultimates, a mini-boss, the stage boss (entrance, pushed to phase 3), a ring
// of enemy bullets to parry, and the client hero downed and revived. Every 4 s
// it compares host and client (stage, seed, team level and kills, enemies in
// the client's interest box and their positions, boss and mini-boss phase,
// objective, arena props, heroes' HP, position, style, ultimate and weapons),
// takes screenshots of both views (shots/coop/) and fails on any page error,
// console error or desync that lasts two checks in a row.
// Signalling goes through PeerJS's public broker like the real game (needs
// internet); the WebRTC data channel itself is local, page to page.
// COOP_TIMEOUT_MS=120000 COOP_LOW=1 accommodates busy shared builders (assertions unchanged).
// COOP_ANGLE=metal can use the native macOS GPU instead of the default SwiftShader.
// COOP_TRACE=1 prints the client hero's position trail on both pages when they disagree.
// Lobby lane: page B joins through the invite link (?join=CODE), the two chat
// (filtered, quick chat), pings and player cards show on both, and the run
// starts by READY-UP (both ready, countdown). After the run: game over, the
// PARTY screen, a unanimous RESTART vote, a second game over, BACK TO LOBBY
// (still connected), then the host KICKs the client.
// Netcode lane: the client's connection is a simulated bad one by default
// (--netsim <latency ms>,<jitter ms>,<loss>, default 70,30,0.02; --netsim off
// for a clean link): every message both ways is delayed, jittered and now and
// then held up by a resent packet (src/net/netsim.ts). Late in the run the
// client's connection is cut and it must reconnect and reclaim its hero
// (--reload: also reload the client's tab and rejoin from the reloaded page).
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i < 0 ? d : args[i + 1];
};
const SECS = Number(opt('--secs', '80'));
const PAGE_TIMEOUT = Number(process.env.COOP_TIMEOUT_MS ?? 30000);
const OUT = opt('--out', join('shots', 'coop'));
const [W, H] = opt('--size', '960x540').split('x').map(Number);
const NETSIM = opt('--netsim', '70,30,0.02') === 'off' ? '' : opt('--netsim', '70,30,0.02');
const RELOAD = args.includes('--reload');
/** --only <text>: run only the scenarios whose name contains it (checks still run). */
const ONLY = opt('--only', '');
/** Host and client positions may differ by what the client's view lags behind (more on a simulated slow link). */
const POS_TOL = NETSIM ? 4.5 : 3;
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

const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(5)}s]`, ...a);
const T0 = Date.now();
const failures = [];
const fail = (msg) => {
  failures.push(msg);
  log('FAIL', msg);
};

const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false }, logLevel: 'error' });
await server.listen();
if (args.includes('--offline')) await server.watcher.close(); // keep an in-progress regression run on one build
const base = `http://127.0.0.1:${server.config.server.port ?? server.httpServer.address().port}/`;
const browser = await chromium.launch({
  headless: true,
  executablePath: findChrome(),
  args: [...(args.includes('--offline') ? ['--disable-features=WebRtcHideLocalIpsWithMdns'] : []), `--use-angle=${opt('--angle', process.env.COOP_ANGLE ?? 'swiftshader')}`, '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

// ci2: in-process PeerJS signalling for offline CI; the actual WebRTC channel is unchanged.
const offlinePeers = new Map();
let offlineId = 0;
async function openPage(name) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  if (args.includes('--offline')) {
    await ctx.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
      if (url.hostname.endsWith('peerjs.com') && url.pathname.endsWith('/id')) return route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: `ci2-peer-${++offlineId}` });
      return route.fulfill({ status: 503, body: 'null' });
    });
    await ctx.routeWebSocket(/peerjs\.com/, ws => {
      const id = new URL(ws.url()).searchParams.get('id');
      if (process.env.COOP_TRACE) log('offline signalling open', id);
      offlinePeers.set(id, ws); ws.send(JSON.stringify({ type: 'OPEN' }));
      ws.onMessage(data => {
        const msg = JSON.parse(String(data));
        if (msg.type === 'HEARTBEAT') return;
        if (process.env.COOP_TRACE) log('offline signalling', id, msg.type, msg.dst);
        const target = offlinePeers.get(msg.dst);
        if (target) target.send(JSON.stringify({ ...msg, src: id }));
        else ws.send(JSON.stringify({ type: 'EXPIRE', src: msg.dst }));
      });
      ws.onClose(() => offlinePeers.delete(id));
    });
    await ctx.addInitScript(() => {
      const NativePeer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends NativePeer { constructor(config) { super({ ...config, iceServers: [] }); } };
    });
  }
  if (process.env.COOP_LOW) await ctx.addInitScript(() => localStorage.setItem('infinishoot.settings.v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('infinishoot.settings.v1') ?? '{}'), graphics: 0 })));
  // --modsupport: real persisted pack on both peers (including invite-link reload).
  if (args.includes('--modsupport')) await ctx.addInitScript(raw => {
    localStorage.setItem('infinishoot.contentMods', JSON.stringify({ version: 1, files: [{ key: 'import/mint', name: 'example.json', raw, enabled: false }], order: ['import/mint'], enabled: ['import/mint'] }));
  }, readFileSync(new URL('../docs/mods/example.json', import.meta.url), 'utf8'));
  const page = await ctx.newPage();
  page.setDefaultTimeout(PAGE_TIMEOUT);
  // Large parallel builds can saturate the dev server before the game has loaded.
  page.setDefaultNavigationTimeout(Number(process.env.COOP_LOAD_TIMEOUT) || 30000);
  // Parallel overnight lanes can take longer to load the cold Vite module graph.
  if (args.includes('--weapons3')) page.setDefaultNavigationTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack ?? '').split('\n').slice(1, 4).join('\n')}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Chromium's own noise, not the game's.
    if (/favicon|Failed to load resource|AudioContext was not allowed|WebGL: INVALID_OPERATION|GPU stall/i.test(t)) return;
    errors.push(t);
  });
  await page.goto(base + '?season=' + opt('--season', 'off'), { timeout: Math.max(PAGE_TIMEOUT, 300000) }); // a busy build machine serves the dev bundle slowly
  await page.waitForFunction(() => window.game && window.botAuto && window.game.mode === 'title', null, { timeout: Math.max(PAGE_TIMEOUT, 300000) });
  return { name, page, errors };
}

const A = await openPage('host');
const B = await openPage('client');
log('pages loaded');
const setNetSim = (page) => page.evaluate(async (c) => {
  const m = await import('/src/net/netsim.ts');
  m.setNetSim(m.parseNetSim(c));
}, NETSIM);
// Headless pages on a busy machine stall for seconds at a time (screenshots, arena loads); the game would read that
// as a dead connection and reconnect. Be patient here: the reconnect scenario cuts the connection on purpose.
const patient = (page) => page.evaluate(async () => {
  const { netQualityTuning } = await import('/src/net/netQuality.ts');
  netQualityTuning.dropMs = netQualityTuning.hostSilentMs = 30000;
});
await Promise.all([patient(A.page), patient(B.page)]);
if (NETSIM) {
  await setNetSim(B.page);
  log(`client link simulated: ${NETSIM} (latency ms, jitter ms, loss)`);
}

// ---------------------------------------------------------------- lobby
// Pets: Sparky for the host, Bit for the client (companion lane checks pet levels and team moves).
await Promise.all(
  [
    [A, args.includes('--pets2') ? 'minimech' : 'sparky'],
    [B, args.includes('--pets2') ? 'owlbot' : 'bit'],
  ].map(([p, pet]) =>
    p.page.evaluate(async (pet) => {
      const { settings, saveSettings } = await import('/src/game/settings.ts');
      settings.pet = pet;
      saveSettings(); // kept through the client's reload (it joins by the invite link)
      window.game.applyLocalSkin(); // what the wardrobe does: the title hero gets the pet
    }, pet),
  ),
);
// Heroes (heroes3 lane): the host plays the Tinker (its bots reach the client through the snapshot), the client
// the Ronin (it dashes itself; the host judges the cuts). COOP_HEROES=rookie,rookie plays the old pair.
const [heroA, heroB] = (process.env.COOP_HEROES ?? 'tinker,ronin').split(',');
await Promise.all(
  [
    [A, heroA],
    [B, heroB],
  ].map(([p, hero]) =>
    p.page.evaluate(async (hero) => {
      const { settings, saveSettings } = await import('/src/game/settings.ts');
      const { heroOf } = await import('/src/data/heroes.ts');
      const { grantAchievement } = await import('/src/game/save.ts');
      window.cheats.unlockAll = true; // both heroes unlock through achievements a fresh profile doesn't have
      const unlock = heroOf(hero).unlock;
      if (unlock) grantAchievement(unlock); // invite/rejoin reloads must keep the intended hero too
      settings.hero = hero;
      saveSettings();
      window.game.applyLocalSkin();
    }, hero),
  ),
);
await A.page.evaluate(() => {
  window.cheats.god = true; // keep the run going; the client hero is protected by the host's god cheat too
  void window.game.hostGame('HOSTBOT');
});
await A.page.waitForFunction(() => window.game.host && window.game.screens && document.querySelector('#scr-online')?.textContent?.includes(window.game.host.code), null, { timeout: 30000 }).catch(() => {});
const code = await A.page.evaluate(() => window.game.host?.code ?? '');
const hostReady = await A.page.evaluate(async () => {
  try {
    await window.game.host.ready;
    return true;
  } catch (e) {
    return String(e?.type ?? e);
  }
});
if (hostReady !== true) {
  fail(`host could not register with the signalling server: ${hostReady}`);
  await done();
}
log(`hosting, code ${code}`);
// Lobby lane: the client opens the invite link instead of typing the code.
await B.page.evaluate(() => window.game.saveName('CLIENTBOT'));
const invite = await A.page.evaluate(async () => {
  const { inviteLink, inviteBase } = await import('/src/game/lobby.ts');
  return inviteLink(inviteBase(location), window.game.host.code);
});
if (!invite.includes(`join=${code}`)) fail(`invite link ${invite} has no code ${code}`);
await B.page.goto(invite, { timeout: 300000 });
await B.page.waitForFunction(() => window.game && window.botAuto, null, { timeout: 300000 });
try {
  await A.page.waitForFunction(() => window.game.lobby.length === 2, null, { timeout: 25000 });
} catch {
  if (args.includes('--offline')) {
    log('offline client errors', B.errors);
    for (const p of [A, B]) log('offline ICE', p.name, await p.page.evaluate(() => { const peer = window.game.host?.peer ?? window.game.client?.peer; return Object.values(peer?.connections ?? {}).flat().map(c => ({ peer: c.peer, open: c.open, ice: c.peerConnection?.iceConnectionState, signal: c.peerConnection?.signalingState })); }));
  }
  fail(`client never joined the lobby (client status: ${await B.page.evaluate(() => document.querySelector('#scr-online')?.innerText?.slice(0, 200))})`);
  await done();
}
log('client in lobby, starting');
// Night and rain on both machines (cosmetic and local on each, so set before the first arena loads).
await Promise.all(
  [A, B].map((p) =>
    p.page.evaluate(async () => {
      const { lookOverrides } = await import('/src/game/systems/look.ts');
      const { weatherForce } = await import('/src/game/ambience.ts');
      lookOverrides.night = true;
      weatherForce.mode = 'rain';
    }),
  ),
);
await lobbyPhase();
await B.page.waitForFunction(() => window.game.role === 'client' && window.game.mode !== 'title' && window.game.heroes.length === 2, null, { timeout: 60000 }).catch(() => fail('client never started the run'));
// Optional weapons3 coverage: both fork choices plus all four evolved auto weapons.
if (args.includes('--weapons3')) await A.page.evaluate(async () => {
  const { createWeapon } = await import('/src/game/weapons/index.ts');
  const g = window.game;
  // This maxed kit would end the boss before the timed ping/parry checks.
  const spawnBoss = g.spawnBoss;
  g.spawnBoss = function (...a) {
    spawnBoss.apply(this, a);
    if (this.boss) this.boss.hp = this.boss.maxHp = 1e7;
  };
  for (const h of g.heroes) {
    for (const w of h.weapons) w.dispose();
    h.weapons.length = 0;
    h.loadoutPick = { primary: 'whip', secondary: 'sentry', special: 'bomb' };
    for (const id of ['whip', 'sentry', 'crosswind', 'tesla', 'swarm', 'prism']) {
      const w = createWeapon(id, g.scene);
      if (w.build) { for (let t = 0; t < 3; t++) for (let r = 0; r < 4; r++) w.addRank(t); w.evolve(h.index % 2); }
      else { while (!w.maxed) w.levelUp(); w.evolve(); }
      h.weapons.push(w);
    }
    h.loadoutDirty = true;
  }
});
await Promise.all(
  [A, B].map((p) =>
    p.page.evaluate(async (trace) => {
      // Count what arrives: skill events and effect kinds (client), skill events sent (host).
      const g = window.game;
      const counts = (window.__coop = { skill: {}, vfx: {} });
      const bump = (o, k) => (o[k] = (o[k] ?? 0) + 1);
      if (g.role === 'client') {
        const apply = g.applySkillNet;
        g.applySkillNet = function (d) {
          for (const e of d?.e ?? []) bump(counts.skill, e[1]);
          return apply.call(this, d);
        };
        const vapply = g.vfx.apply.bind(g.vfx);
        g.vfx.apply = (e) => (bump(counts.vfx, Array.isArray(e) ? e[0] : (e?.k ?? e?.t ?? '?')), vapply(e));
      } else {
        // Snapshot sizes: the real wire bytes (PeerJS binarypack), split by field.
        let bp = null;
        try {
          bp = await import('/src/dev/netSize.ts');
        } catch {}
        const size = (v) => (bp ? bp.wireBytes(v) : JSON.stringify(v, (k, x) => (x instanceof ArrayBuffer ? x.byteLength : x)).length);
        const build = g.buildSnapshot;
        counts.snap = { n: 0, total: 0, max: 0, over16k: 0, wire: !!bp, parts: {} };
        g.buildSnapshot = function (h, ev) {
          const r = build.call(this, h, ev);
          const bytes = size(r);
          const c = counts.snap;
          c.n++;
          c.total += bytes;
          c.max = Math.max(c.max, bytes);
          if (bytes > 16000) c.over16k++;
          if (c.n % 4 === 0) for (const k of ['ev', 'b', 'fx', 'en', 'bu', 'bd', 'pk', 'heroes', 'sk', 'ar', 'bx', 'you']) if (r[k] !== undefined) c.parts[k] = (c.parts[k] ?? 0) + size(r[k]) * 4;
          return r;
        };
        const net = g.skillNet;
        g.skillNet = function (h) {
          const r = net.call(this, h);
          if (h.index === 1) for (const e of r.e) bump(counts.skill, e[1]);
          return r;
        };
      }
      window.botAuto(true);
      if (trace) {
        window.__tr = [];
        setInterval(() => {
          const h = g.heroes[1];
          window.__tr.push([Date.now() % 100000, g.mode, g.screens.current, +h.player.x.toFixed(1), +h.player.z.toFixed(1)]);
        }, 100);
      }
    }, !!process.env.COOP_TRACE),
  ),
);
log('run started, bots on');

// ---------------------------------------------------------------- state probes
/** Host: the authoritative view, seen from the client's hero. */
const hostProbe = () =>
  A.page.evaluate(async () => {
    const g = window.game;
    const { INTEREST } = await import('/src/game/game.ts');
    const c = g.heroes[1];
    const near = (e) => e.def.boss || (Math.abs(e.x - c.player.x) < INTEREST && Math.abs(e.z - c.player.z) < INTEREST);
    const act = g.enemies.list.filter((e) => e.active);
    const boss = g.boss && g.boss.active ? g.boss : null;
    return {
      mode: g.mode,
      stage: g.stage,
      level: g.level,
      kills: g.kills,
      score: g.score,
      seed: g.seed,
      enemiesNear: act.filter(near).length,
      enemies: act.length,
      defs: [...new Set(act.filter(near).map((e) => e.def.id))].sort(),
      boss: boss ? { id: boss.def.id, phase: boss.phase, hp01: +(boss.hp / boss.maxHp).toFixed(2), x: boss.x, z: boss.z } : null,
      mini: g.bossField.mini && g.bossField.mini.active ? { id: g.bossField.mini.def.id, phase: g.bossField.mini.phase } : null,
      objective: g.toys.objective ? { kind: g.toys.objective.kind, cur: g.toys.objective.cur, state: g.toys.objective.state } : null,
      props: g.toys.props.filter((p) => p.alive).length,
      totems: g.toys.totems.filter((t) => t.alive).length,
      arenaStage: g.arenaStage,
      heroes: g.heroes.map((h) => ({ x: h.player.x, z: h.player.z, hp: Math.ceil(h.player.hp), dead: h.player.dead, style: Math.round(h.skill.style.points), ult: +h.skill.ult.toFixed(2), ultT: +h.skill.ultT.toFixed(2), weapons: h.weapons.map((w) => w.def.id + ':' + (w.build ? w.buildKey : w.level)).join(' ') })),
      sample: act.filter(near).slice(0, 6).map((e) => ({ uid: e.uid, id: e.def.id, x: e.x, z: e.z })),
      pets: g.heroes.map((h) => [h.pet, h.petState.level, h.petState.shieldReady, h.petState.reviveUsed]),
      team: +g.companionState().meter.charge.toFixed(2),
      move: g.companionState().move?.id ?? null,
    };
  });
/** Client: its mirror. */
const clientProbe = () =>
  B.page.evaluate(() => {
    const g = window.game;
    const act = g.enemies.list.filter((e) => e.active);
    const bossE = act.find((e) => e.def.boss);
    const byUid = {};
    for (const [uid, e] of g.netEnemies) if (e.active) byUid[uid] = { x: e.x, z: e.z, id: e.def.id };
    return {
      mode: g.mode,
      stage: g.stage,
      level: g.level,
      kills: g.kills,
      score: g.score,
      seed: g.seed,
      enemies: act.length,
      netEnemies: g.netEnemies.size,
      defs: [...new Set(act.map((e) => e.def.id))].sort(),
      boss: bossE ? { id: bossE.def.id, phase: bossE.phase } : null,
      netBoss: g.netBoss,
      mini: g.bossField.netMini,
      objective: g.toys.objective ? { kind: g.toys.objective.kind, cur: g.toys.objective.cur, state: g.toys.objective.state } : null,
      props: g.toys.props.filter((p) => p.alive).length,
      totems: g.toys.totems.filter((t) => t.alive).length,
      arenaStage: g.arenaStage,
      heroes: g.heroes.map((h) => ({ x: h.player.x, z: h.player.z, hp: Math.ceil(h.player.hp), dead: h.player.dead, style: Math.round(h.skill.style.points), ult: +h.skill.ult.toFixed(2), ultT: +h.skill.ultT.toFixed(2), weapons: h.weapons.map((w) => w.def.id + ':' + (w.build ? w.buildKey : w.level)).join(' ') })),
      byUid,
      screen: g.screens.current,
      pets: g.heroes.map((h) => [h.pet, h.petState.level, h.petState.shieldReady, h.petState.reviveUsed]),
      team: +g.companionState().meter.charge.toFixed(2),
      move: g.companionState().move?.id ?? null,
    };
  });

/** Desyncs that last across two checks in a row are failures; one-offs are logged (snapshots lag 50-100 ms). */
const strikes = new Map();
function check(key, ok, msg) {
  if (ok) {
    strikes.delete(key);
    return;
  }
  const n = (strikes.get(key) ?? 0) + 1;
  strikes.set(key, n);
  if (n === 2) fail(msg);
  else log('desync?', msg);
}

async function compare(tag) {
  const [h, c] = await Promise.all([hostProbe(), clientProbe()]);
  const fighting = h.mode === 'fight' && c.mode === 'fight';
  log(`${tag} host mode=${h.mode} st${h.stage} lv${h.level} kills=${h.kills} enemies=${h.enemies} near=${h.enemiesNear} boss=${JSON.stringify(h.boss && { id: h.boss.id, ph: h.boss.phase, hp: h.boss.hp01 })} obj=${JSON.stringify(h.objective)}`);
  log(`${tag} clnt mode=${c.mode} st${c.stage} lv${c.level} kills=${c.kills} enemies=${c.enemies} net=${c.netEnemies} boss=${JSON.stringify(c.boss)} obj=${JSON.stringify(c.objective)} screen=${c.screen}`);
  check('stage', h.stage === c.stage, `stage host ${h.stage} vs client ${c.stage}`);
  check('seed', h.seed === c.seed, `seed host ${h.seed} vs client ${c.seed}`);
  check('level', Math.abs(h.level - c.level) <= 1, `team level host ${h.level} vs client ${c.level}`);
  check('kills', h.kills - c.kills <= 40 && c.kills <= h.kills, `kills host ${h.kills} vs client ${c.kills}`);
  check('arena', h.arenaStage === c.arenaStage, `arena stage host ${h.arenaStage} vs client ${c.arenaStage}`);
  if (fighting) {
    // Enemy mirrors: the client should hold about as many as the host has in its interest box.
    const tol = Math.max(6, h.enemiesNear * 0.25);
    check('enemies', Math.abs(h.enemiesNear - c.netEnemies) <= tol, `enemies near client: host ${h.enemiesNear} vs client mirrors ${c.netEnemies}`);
    check('active', c.enemies === c.netEnemies, `client has ${c.enemies} active enemies but ${c.netEnemies} mirrors (stray locals)`);
    for (const e of h.sample) {
      const m = c.byUid[e.uid];
      if (!m) continue;
      check(`pos${e.uid}`, Math.hypot(m.x - e.x, m.z - e.z) < POS_TOL && m.id === e.id, `enemy ${e.uid} (${e.id}) host ${e.x.toFixed(1)},${e.z.toFixed(1)} vs client ${m.id} ${m.x.toFixed(1)},${m.z.toFixed(1)}`);
    }
    const missing = h.defs.filter((d) => !c.defs.includes(d));
    check('defs', missing.length <= 2, `enemy types near the client on the host, not on the client: ${missing.join(',')}`);
    check('boss', !!h.boss === !!c.boss, `boss host ${JSON.stringify(h.boss)} vs client ${JSON.stringify(c.boss)}`);
    if (h.boss && c.boss) check('phase', h.boss.phase === c.boss.phase, `boss phase host ${h.boss.phase} vs client ${c.boss.phase}`);
    check('mini', !!h.mini === !!c.mini, `mini-boss host ${JSON.stringify(h.mini)} vs client ${JSON.stringify(c.mini)}`);
    if (h.mini && c.mini) check('miniphase', h.mini.phase === c.mini[2], `mini-boss phase host ${h.mini.phase} vs client ${c.mini[2]}`);
    check('obj', JSON.stringify(h.objective && { k: h.objective.kind, s: h.objective.state }) === JSON.stringify(c.objective && { k: c.objective.kind, s: c.objective.state }) && Math.abs((h.objective?.cur ?? 0) - (c.objective?.cur ?? 0)) <= 1, `objective host ${JSON.stringify(h.objective)} vs client ${JSON.stringify(c.objective)}`);
    check('props', h.props === c.props, `arena props alive host ${h.props} vs client ${c.props}`);
    check('totems', h.totems === c.totems, `totems alive host ${h.totems} vs client ${c.totems}`);
  }
  for (let i = 0; i < 2; i++) {
    const a = h.heroes[i];
    const b = c.heroes[i];
    if (!a || !b) {
      check(`hero${i}`, false, `hero ${i} missing (host ${!!a}, client ${!!b})`);
      continue;
    }
    check(`hp${i}`, Math.abs(a.hp - b.hp) <= Math.max(10, a.hp * 0.2) && a.dead === b.dead, `hero ${i} hp host ${a.hp}${a.dead ? ' dead' : ''} vs client ${b.hp}${b.dead ? ' dead' : ''}`);
    if (process.env.COOP_TRACE && Math.hypot(a.x - b.x, a.z - b.z) >= 3) {
      const [ta, tb] = await Promise.all([A.page.evaluate(() => window.__tr.slice(-30)), B.page.evaluate(() => window.__tr.slice(-30))]);
      console.log('host trace', JSON.stringify(ta), '\nclient trace', JSON.stringify(tb));
    }
    // Both fighting: during level-ups the host holds the client's hero while the client may still be finishing its last step.
    check(`pos${i}`, !fighting || Math.hypot(a.x - b.x, a.z - b.z) < POS_TOL, `hero ${i} position host ${a.x.toFixed(1)},${a.z.toFixed(1)} vs client ${b.x.toFixed(1)},${b.z.toFixed(1)}`);
    check(`style${i}`, Math.abs(a.style - b.style) <= 120, `hero ${i} style host ${a.style} vs client ${b.style}`);
    check(`ult${i}`, Math.abs(a.ult - b.ult) <= 0.15 && !(a.ultT > 0.3 && b.ultT <= 0), `hero ${i} ult host ${a.ult}/${a.ultT} vs client ${b.ult}/${b.ultT}`);
    check(`weap${i}`, a.weapons === b.weapons, `hero ${i} weapons host [${a.weapons}] vs client [${b.weapons}]`);
  }
  // Companion lane: pets (id, level, shield, revive) and the TEAM meter mirror the host.
  check('pets', JSON.stringify(h.pets) === JSON.stringify(c.pets), `pets host ${JSON.stringify(h.pets)} vs client ${JSON.stringify(c.pets)}`);
  check('team', Math.abs(h.team - c.team) <= 0.15, `team meter host ${h.team} vs client ${c.team}`);
  return { h, c };
}

async function shot(tag) {
  // A busy machine can take very long to render a headless frame: a missed screenshot isn't a co-op failure.
  try {
    await Promise.all([A, B].map((p) => p.page.screenshot({ path: join(OUT, `${tag}-${p.name}.png`), timeout: 90000 })));
    log(`screenshots ${tag}`);
  } catch (e) {
    log(`screenshots ${tag} skipped: ${String(e.message).split('\n')[0]}`);
  }
}

/** Host-side scenario steps (run through the dev handles). */
const host = (fn, arg) => A.page.evaluate(fn, arg);
const client = (fn, arg) => B.page.evaluate(fn, arg);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
/** Client hero onto an arena toy (the client moves its own hero; the host sees it through inputs). */
const clientTo = (kind) =>
  client((kind) => {
    const g = window.game;
    const p = g.hero.player;
    const list = kind === 'pad' ? g.toys.pads : g.toys.turrets.filter((t) => t.t <= 0 && t.cd <= 0);
    let best = null;
    for (const s of list) if (!best || Math.hypot(s.x - p.x, s.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z)) best = s;
    if (!best) return null;
    window.botAuto(false);
    for (const w of g.hero.weapons) if ('predFocus' in w) w.predFocus = 0; // a Ronin client: no dash-strike off the toy when the bot lets go
    g.input.keys.clear(); // the bot's last keys and buttons would otherwise stay held and walk the hero off the toy
    g.input.mouseButtons = 0;
    g.toys.jumps[g.local] = null; // not mid-flight from an earlier pad
    p.teleport(best.x, best.z);
    setTimeout(() => window.botAuto(true), kind === 'pad' ? 1200 : 3000);
    return [best.x, best.z];
  }, kind);
/** heroes3 lane: the host Tinker's bots on both screens, the client Ronin's sword (and later its dash-strike) on the host. */
const heroes3Check = (dash) => async () => {
  const h = await host(async () => {
    const { minionsOf } = await import('/src/game/heroes3.ts');
    const g = window.game;
    const d = (i, k) => Math.round(g.heroes[i]?.damageBy[k] ?? 0);
    const iai = g.heroes[1]?.weapons.find((w) => w.def.id === 'iaido');
    const strikes = iai?.cutSeq ?? 0;
    return { heroes: g.heroes.map((x) => x.heroDef.id).join(), bots: minionsOf(g).count, minion: d(0, 'minion'), katana: d(1, 'katana'), iaido: d(1, 'iaido'), strikes, applied: iai?.remoteStrikes ?? 0, refused: iai?.remoteRefused ?? 0 };
  });
  if (h.heroes !== 'tinker,ronin') return `skipped (heroes ${h.heroes})`;
  const c = await client(async () => {
    const { minionsOf } = await import('/src/game/heroes3.ts');
    const { heroes3ClientStats } = await import('/src/game/systems/heroes3.ts');
    const g = window.game;
    return { bots: minionsOf(g).count, swings: g.hero.weapons.find((w) => w.def.id === 'katana')?.seq ?? -1, dashStrikes: heroes3ClientStats.strikes };
  });
  if (h.bots < 1 || c.bots < 1) fail(`heroes3: bots host ${h.bots}, client ${c.bots}`);
  if (h.katana <= 0 || c.swings <= 0) fail(`heroes3: client Ronin's sword: host damage ${h.katana}, client swings ${c.swings}`);
  if (dash && h.iaido <= 0) fail(`heroes3: the client Ronin's dash-strike never cut anything on the host (client reported ${c.dashStrikes} strikes, host applied ${h.applied}, refused ${h.refused})`);
  return { host: h, client: c };
};

/** Coopplay scenarios: wait until both machines fight, then hold level-ups off (restored by `coopEnd`). */
async function coopFight() {
  for (let k = 0; k < 60; k++) {
    const [h, c] = await Promise.all([host(() => window.game.mode), client(() => window.game.mode)]);
    if (h === 'fight' && c === 'fight') {
      await host(() => {
        window.__xpNext ??= window.game.xpNext;
        window.game.xpNext = 1e12;
      });
      return true;
    }
    await pause(250);
  }
  return false;
}
async function coopEnd() {
  await host(() => {
    if (window.__xpNext) window.game.xpNext = window.__xpNext;
    window.__xpNext = undefined;
    window.botAuto(true);
  });
  await client(() => window.botAuto(true));
}
const SCENARIO = [
  [20, 'heroes3: Tinker bots on both screens, the client Ronin swings', heroes3Check(false)],
  [70, 'heroes3: the client Ronin has dash-struck too', heroes3Check(true)],
  [8, 'new enemy types, an elite and the Goldbug near the client', async () => {
    const spawned = await host(async () => {
      const g = window.game;
      const { ENEMIES } = await import('/src/data/enemies.ts');
      const c = g.heroes[1].player;
      const ids = ['shielder', 'medic', 'leaper', 'mortar', 'charger', 'sniper', 'splitter', 'bastion', 'blinksniper', 'bombcourier'];
      let k = 0;
      for (const id of ids)
        for (let i = 0; i < 2; i++, k++) {
          const a = (k / (ids.length * 2)) * Math.PI * 2;
          g.enemies.spawn(ENEMIES[id], c.x + Math.cos(a) * 9, c.z + Math.sin(a) * 9, g.spawnOpts());
        }
      g.debugSpawnElite('charger', 'shielded');
      g.spawnEnemy(ENEMIES.golden);
      return { count: k, step: g.stepN };
    });
    // Compare only once the injected batch has had a snapshot applied. An
    // immediate comparison is guaranteed to see the pre-injection client.
    const applied = await until(B, async step => (await import('/src/game/systems/netcode.ts')).netcodeState(window.game).lastSnapStep > step, spawned.step, 4000);
    if (!applied) fail('injected enemies never reached a later client snapshot');
    return spawned.count;
  }],
  [11, 'client takes a jump pad', async () => {
    // The host notes every jump message it gets and whether a jump started.
    await host(() => {
      const g = window.game;
      const msg = g.arenaJumpMsg;
      window.__jumps = [];
      g.arenaJumpMsg = function (h, k) {
        msg.call(this, h, k);
        window.__jumps.push({ hero: h.index, k, mode: this.mode, started: !!this.toys.jumps[h.index] });
      };
    });
    // A level-up menu on the host holds the world (and jumps): try again after it (slow machines level up mid-scenario).
    let h, c;
    for (let attempt = 0; attempt < 4; attempt++) {
      for (let k = 0; k < 40 && (await host(() => window.game.mode)) !== 'fight'; k++) await pause(250);
      const at = await clientTo('pad');
      if (!at) return 'no pads on this arena';
      for (let k = 0; k < 10; k++) {
        await pause(250);
        let cj;
        [h, cj] = await Promise.all([host(() => window.__jumps), client(() => !!window.game.toys.jumps[window.game.local])]);
        c ||= cj;
        if (h.some((j) => j.hero === 1 && j.started)) break;
      }
      if (h.some((j) => j.hero === 1 && j.started)) break;
    }
    if (!h.some((j) => j.hero === 1 && j.started) || !c) fail(`jump pad: host got ${JSON.stringify(h)}, client jumping ${c}`);
    return { host: h, client: c };
  }],
  [14, 'client switches on a turret', async () => {
    const at = await clientTo('turret');
    if (!at) return 'no idle turrets';
    // Poll: a level-up on the host can hold the world for a moment.
    let h, c;
    for (let k = 0; k < 12; k++) {
      await pause(250);
      [h, c] = await Promise.all([
        host((at) => window.game.toys.turrets.find((t) => t.x === at[0] && t.z === at[1])?.owner, at),
        client((at) => window.game.toys.turrets.find((t) => t.x === at[0] && t.z === at[1])?.t, at),
      ]);
      if (h === 1 && c > 0) break;
    }
    if (h !== 1 || !(c > 0)) fail(`turret: host owner ${h} (want 1), client timer ${c}`);
    return { owner: h, clientT: c };
  }],
  [20, 'host topples the pillar nearest the client', async () => {
    const i = await host(() => {
      const g = window.game;
      const p = g.heroes[1].player;
      let best = -1;
      g.toys.props.forEach((t, i) => {
        if (!t.alive || t.def.kind !== 'pillar') return;
        const b = g.toys.props[best];
        if (best < 0 || Math.hypot(t.def.x - p.x, t.def.z - p.z) < Math.hypot(b.def.x - p.x, b.def.z - p.z)) best = i;
      });
      if (best >= 0) g.damageProp(g.toys.props[best], 1e6, 0, 0, 1);
      return best;
    });
    if (i < 0) return 'no pillars';
    let c;
    for (let k = 0; k < 16; k++) {
      await pause(250);
      c = await client((i) => window.game.toys.props[i] && { alive: window.game.toys.props[i].alive, fallT: window.game.toys.props[i].fallT }, i);
      if (c && !c.alive && c.fallT >= 0) break;
    }
    if (!c || c.alive || c.fallT < 0) fail(`pillar ${i} toppled on the host, client sees ${JSON.stringify(c)}`);
    return c;
  }],
  [18, 'ultimates charged for both heroes', () => host(() => window.game.heroes.forEach((h) => (h.skill.ult = 1)))],
  [20, 'director2 events, relics and event anchors reach the client', async () => {
    for (const id of ['garden', 'rebellion', 'gravity', 'goblins', 'blackout', 'turrets']) {
      await host((id) => {
        const g = window.game;
        g.runEvents.forceEvent(id);
        if (!g.heroes[1].relics.includes('r_cinder')) {
          g.heroes[1].relics.push('r_cinder', 'r_relay', 'r_backbeat');
          g.heroes[1].recomputeStats();
        }
      }, id);
      // The client sees it a snapshot or two later (simulated latency, playout buffer): poll up to 4 s.
      let seen = null;
      for (let k = 0; k < 16 && seen?.event !== id; k++) {
        await pause(250);
        seen = await client(() => ({ event: window.game.netEvent?.[0], relic: window.game.hero.relics.includes('r_cinder'), pressure: window.game.director.adaptive.pressure }));
      }
      if (seen.event !== id || !seen.relic || !Number.isFinite(seen.pressure)) fail(`director2 ${id}: ${JSON.stringify(seen)}`);
    }
    const [a, b] = await Promise.all([host(() => window.game.director2Net().slice(4)), client(() => window.game.director2Net().slice(4))]);
    if (JSON.stringify(a) !== JSON.stringify(b)) fail(`director2 turret anchors: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    return 'six events, guest relics, pressure and turret anchors synced';
  }],
  [24, 'mini-boss', () => host(() => window.game.debugBoss({ mini: true }))],
  [34, 'stage boss now, push to phase 3', () => host(() => window.game.debugBoss({ now: true, phase: 3 }))],
  [42, 'enemy bullets closing in on the client (parry)', () =>
    host(async () => {
      const g = window.game;
      const { Team } = await import('/src/game/bullets.ts');
      const p = g.heroes[1].player;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.bullets.spawn({ x: p.x + Math.cos(a) * 5, z: p.z + Math.sin(a) * 5, dirX: -Math.cos(a), dirZ: -Math.sin(a), speed: 5, life: 3, radius: 0.26, damage: 10, knockback: 6, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5 });
      }
    })],
  [38, 'boss entrance on the client', async () => {
    const [h, c] = await Promise.all([host(() => [window.game.introUid, window.game.boss?.uid]), client(() => window.game.bossIntro.uid)]);
    if (h[1] && c !== h[1]) fail(`boss intro: host boss uid ${h[1]} (intro ${h[0]}), client intro uid ${c}`);
    return { host: h, client: c };
  }],
  [56, 'client hero downed, then revived', async () => {
    await host(() => {
      const g = window.game;
      const h = g.heroes[1];
      window.cheats.god = false;
      h.revivesLeft = 0;
      h.phoenixUsed = true; // a boss relic (Frost Totem) would save it
      h.petState.reviveUsed = true; // and so would the pet (companion lane)
      h.petState.shieldReady = false;
      for (let k = 0; k < 4 && !h.player.dead; k++) {
        h.player.invuln = 0;
        h.player.hp = 1;
        g.hurtHero(h, 999, h.player.x + 1, h.player.z);
      }
      window.cheats.god = true;
    });
    // Poll briefly: a teammate standing close (with Guardian Angel) can revive within ~1.5 s.
    let h1, c1;
    // (40 x 100 ms: the client's view runs a little behind on the simulated slow link)
    for (let k = 0; k < 40 && !(h1 && c1); k++) {
      await pause(100);
      [h1, c1] = await Promise.all([host(() => window.game.heroes[1].player.dead), client(() => window.game.hero.player.dead)]);
    }
    await host(() => window.game.reviveHero(window.game.heroes[1], 0.5));
    await pause(1500);
    // The client's view runs behind (playout buffer, simulated link): wait for it to see itself standing.
    for (let k = 0; k < 30 && (await client(() => window.game.hero.player.dead)); k++) await pause(200);
    const [h2, c2] = await Promise.all([host(() => window.game.heroes[1].player.dead), client(async () => {
      // Visible at some point (it blinks while the revive i-frames run).
      let seen = false;
      for (let k = 0; k < 75 && !seen; k++, await new Promise((r) => setTimeout(r, 40))) seen = window.game.hero.player.rig.root.visible;
      return [window.game.hero.player.dead, seen];
    })]);
    if (!h1 || !c1 || h2 || c2[0] || !c2[1]) fail(`down/revive: down host ${h1} client ${c1}; revived host ${!h2} client ${!c2[0]} visible ${c2[1]}`);
    return { down: [h1, c1], up: [!h2, !c2[0], c2[1]] };
  }],
  [28, 'client hero fuses Orbit Drones + Chain Zap (weapon fusion)', async () => {
    const id = await host(async () => {
      const g = window.game;
      const { createWeapon } = await import('/src/game/weapons/index.ts');
      const { fuseWeapons } = await import('/src/game/fusion.ts');
      const h = g.heroes[1];
      for (const wid of ['drones', 'lightning']) {
        let w = h.weapons.find((x) => x.def.id === wid);
        if (!w) h.weapons.push((w = createWeapon(wid, g.scene)));
        while (!w.maxed) w.levelUp();
      }
      const f = fuseWeapons(h.weapons, 'storm_drones', g.scene);
      h.loadoutDirty = true;
      if (f) g.fusionFx(h, f.def.id);
      return f?.def.id ?? null;
    });
    if (id !== 'storm_drones') fail(`fusion: host could not fuse (${id})`);
    let c = null;
    for (let k = 0; k < 20 && !(c && c.drones); k++) {
      await pause(300);
      c = await client(() => {
        const w = window.game.hero.weapons.find((x) => x.def.id === 'storm_drones');
        return w ? { parts: w.parts.map((p) => p.def.id), drones: w.parts[0].net().length, merge: !!document.querySelector('.fusion-merge') } : null;
      });
    }
    if (!c || c.parts.join() !== 'drones,lightning' || !c.drones) fail(`fusion: client sees ${JSON.stringify(c)}`);
    return c;
  }],
  [50, 'ultimates again', () => host(() => window.game.heroes.forEach((h) => (h.skill.ult = 1)))],
  [62, 'route map vote (notes/lanes/route.md)', async () => {
    const opened = await host(() => {
      const g = window.game;
      if (g.mode !== 'fight' || g.route.open) return false;
      g.route.on = true;
      g.mode = 'shop';
      return g.openRoute() && g.stage;
    });
    if (!opened) return 'skipped (not fighting)';
    // The bots vote within about half a second, so poll quickly for the client's map.
    let seen = ['none', 0];
    for (let k = 0; k < 30 && seen[0] !== 'route'; k++) {
      await pause(100);
      seen = await client(() => [window.game.screens.current, document.querySelectorAll('#scr-route button[data-ri]').length]);
    }
    if (seen[0] !== 'route' || seen[1] < 2) fail(`route map: client screen ${seen[0]} with ${seen[1]} options`);
    else await shot('route');
    // Both bots vote for the first road; give the vote (10 s) plus an encounter time to finish.
    let st;
    for (let k = 0; k < 50; k++) {
      await pause(500);
      st = await host((s) => ({ open: window.game.route.open, mode: window.game.mode, picked: window.game.route.path[s + 1] }), opened);
      if (!st.open) break;
    }
    const cs = await client(() => window.game.screens.current);
    if (st.open || st.picked === undefined || cs === 'route') fail(`route map: host ${JSON.stringify(st)}, client screen ${cs}`);
    return { client: seen, host: st, clientAfter: cs };
  }],
  [16, 'pets grow to level 4 (as after three stage clears)', async () => {
    await host(() => {
      for (const h of window.game.heroes) for (let i = 0; i < 3; i++) h.petState.levelUp();
    });
    let h, c;
    for (let k = 0; k < 24; k++) {
      await pause(250);
      [h, c] = await Promise.all([
        host(() => window.game.heroes.map((h) => [h.pet, h.petState.level, h.petState.reviveUsed])),
        client(() => window.game.heroes.map((h) => [h.pet, h.petState.level, h.petState.reviveUsed])),
      ]);
      if (JSON.stringify(h) === JSON.stringify(c)) break;
    }
    if (JSON.stringify(h) !== JSON.stringify(c) || h.some((p) => p[1] !== 4)) fail(`pet levels: host ${JSON.stringify(h)} vs client ${JSON.stringify(c)}`);
    return { host: h, client: c };
  }],
  [30, 'the client fires a team move next to the host', async () => {
    // The host's hero steps next to the client's (each machine moves its own hero), the meter is full.
    await host(() => {
      const g = window.game;
      const c = g.heroes[1].player;
      g.hero.player.teleport(c.x + 1.5, c.z);
      g.companionState().meter.charge = 1;
      // Check spending at activation: standing together legitimately recharges during the network wait.
      const tryMove = g.tryTeamMove;
      window.__teamSpent = null;
      window.__restoreTeamMove = () => { g.tryTeamMove = tryMove; };
      g.tryTeamMove = function (h) {
        const started = tryMove.call(this, h);
        if (started) { window.__teamSpent = this.companionState().meter.charge; g.tryTeamMove = tryMove; }
        return started;
      };
    });
    let r = null;
    for (let k = 0; k < 12 && !r?.host; k++) {
      await pause(150);
      await client(() => window.game.client.send({ t: 'team' }));
      await pause(150);
      r = { host: await host(() => window.game.companionState().move?.id ?? null) };
    }
    for (let k = 0; k < 16; k++) {
      await pause(250);
      r.client = await client(() => window.game.companionState().move?.id ?? null);
      if (r.client) break;
    }
    r.hostMeter = await host(() => { window.__restoreTeamMove(); return window.__teamSpent; });
    if (!r.host || r.client !== r.host || r.hostMeter !== 0) fail(`team move: host ${r.host} (meter ${r.hostMeter}), client ${r.client}`);
    await shot('teammove');
    return r;
  }],
  // Netcode lane: the client's connection dies mid-fight; it reconnects on its own and gets its hero back.
  [66, 'client connection cut: autopilot, reconnect, same hero (netcode lane)', async () => {
    const before = await host(() => ({ peer: window.game.heroes[1].peerId, n: window.game.heroes.length, weapons: window.game.heroes[1].weapons.map((w) => w.def.id + ':' + (w.build ? w.buildKey : w.level)).join(' ') }));
    await client(() => window.game.client.drop());
    // The host notices (the stale connection is dropped when the hello comes back, or by silence) and the hero waits on autopilot.
    let sawBanner = false;
    let back = null;
    let last = null;
    for (let k = 0; k < 90 && !back; k++) {
      await pause(500);
      const c = await client(() => ({ banner: !!document.querySelector('#net-lost:not([hidden])'), role: window.game.role, mode: window.game.mode, local: window.game.local, n: window.game.heroes.length }));
      sawBanner ||= c.banner;
      const h = await host(() => ({ peer: window.game.heroes[1].peerId, n: window.game.heroes.length, left: window.game.heroes[1].left }));
      if (c.role === 'client' && !c.banner && c.local === 1 && c.n === h.n && h.peer && h.peer !== before.peer && !h.left) back = { client: c, host: h };
      if (c.role !== 'client') break;
      last = { c, h };
    }
    if (!back) {
      fail(`reconnect: client never got its hero back (before ${JSON.stringify(before)}, last ${JSON.stringify(last)})`);
      return { before };
    }
    if (back.host.n !== before.n) fail(`reconnect: hero count changed ${before.n} -> ${back.host.n} (a new hero instead of the old one)`);
    if (!sawBanner) fail('reconnect: the client never showed CONNECTION LOST');
    await pause(1500);
    const wc = await client(() => window.game.hero.weapons.map((w) => w.def.id + ':' + (w.build ? w.buildKey : w.level)).join(' '));
    if (wc.split(' ').length < before.weapons.split(' ').length) fail(`reconnect: client build after rejoin [${wc}] lost weapons vs [${before.weapons}]`);
    await client(() => window.botAuto(true));
    return { before: before.peer, after: back.host.peer, weapons: wc };
  }],
  // Finisher lane: a client ping pops the client's portrait in on both screens; the boss finisher plays on both.
  [46, 'client pings: its portrait pops in on both machines', async () => {
    await client(() => {
      const p = window.game.hero.player;
      window.game.client.send({ t: 'ping', x: p.x + 3, z: p.z });
    });
    const showing = () => import('/src/ui/portraits.ts').then((m) => m.portraits.showing('hero:1'));
    let h = false, c = false;
    for (let k = 0; k < 16 && !(h && c); k++) {
      await pause(200);
      const r = await Promise.all([host(showing), client(showing)]);
      h ||= r[0];
      c ||= r[1];
    }
    if (!h || !c) fail(`ping portrait: host ${h}, client ${c}`);
    return { host: h, client: c };
  }],
  [43, 'boss finisher on both machines', async () => {
    const id = await host(() => {
      const g = window.game;
      const b = g.boss && g.boss.active ? g.boss : null;
      if (!b) return null;
      g.killEnemy(b, 'buster', g.heroes[1]);
      return b.def.id;
    });
    if (!id) return 'no boss up';
    const on = () => !!document.getElementById('finisher') && !document.getElementById('finisher').hidden;
    let h1 = false, c1 = false, held = false;
    for (let k = 0; k < 20 && !(h1 && c1); k++) {
      await pause(250);
      const r = await Promise.all([host(on), client(on), host(() => !!window.game.boss?.active)]);
      h1 ||= r[0];
      c1 ||= r[1];
      held ||= r[2] && r[0];
    }
    let h2, c2, gone;
    for (let k = 0; k < 40; k++) {
      await pause(250);
      [h2, c2, gone] = await Promise.all([host(on), client(on), host(() => !window.game.boss || !window.game.boss.active)]);
      if (!h2 && !c2 && gone) break;
    }
    if (!h1 || !c1 || !held || h2 || c2 || !gone) fail(`finisher: playing host ${h1} client ${c1}, boss held ${held}; after: host ${h2} client ${c2}, boss gone ${gone}`);
    return { boss: id, playing: [h1, c1], held, after: [h2, c2], gone };
  }],
  // Coopplay lane (notes/lanes/coopplay.md): a co-op objective, carrying a downed teammate, the buddy tether.
  // Each waits for the fight (bots close level-ups) and holds team XP meanwhile so no new menu freezes the world.
  [51, 'co-op objective: host and client each hold a vault switch', async () => {
    if (!(await coopFight())) return 'skipped (not fighting)';
    const lay = await host(async () => {
      const g = window.game;
      const cp = await import('/src/game/systems/coopplay.ts');
      if (!cp.forceCoopObjective(g, 'door')) return null;
      window.botAuto(false);
      const L = cp.coopPlayState(g).lay;
      g.hero.player.teleport(L.a.x, L.a.z);
      return L;
    });
    if (!lay) {
      await coopEnd();
      return 'skipped (no room)';
    }
    await client((L) => {
      window.botAuto(false);
      window.game.hero.player.teleport(L.b.x, L.b.z);
    }, lay);
    let h, c;
    for (let k = 0; k < 50; k++) {
      await pause(200);
      await host((L) => window.game.hero.player.teleport(L.a.x, L.a.z), lay);
      await client((L) => window.game.hero.player.teleport(L.b.x, L.b.z), lay);
      [h, c] = await Promise.all([
        host(() => ({ kind: window.game.toys.objective.kind, state: window.game.toys.objective.state, cur: window.game.toys.objective.cur })),
        client(async () => ({ kind: window.game.toys.objective.kind, state: window.game.toys.objective.state, open: (await import('/src/game/systems/coopplay.ts')).coopPlayState(window.game).open })),
      ]);
      if (h.state === 'done' && c.open) break;
    }
    await shot('coopplay-vault');
    await coopEnd();
    if (h.kind !== 'door' || h.state !== 'done' || c.kind !== 'door' || c.state !== 'done' || !c.open) fail(`co-op vault: host ${JSON.stringify(h)}, client ${JSON.stringify(c)}`);
    return { host: h, client: c };
  }],
  // Before the stage boss (its ring-of-fire duel pens the heroes in).
  [21, 'client carries the downed host, then puts them down', async () => {
    if (!(await coopFight())) return 'skipped (not fighting)';
    const downed = await host(async () => {
      const g = window.game;
      if (!g.isCombatMode) return false;
      const h = g.heroes[0];
      // No last stand (time lane): it would put the host back on their feet mid-carry.
      const ht = (await import('/src/game/systems/time.ts')).heroTimeOf(g, h);
      ht.standUsed = true;
      ht.standT = 0;
      window.botAuto(false);
      window.cheats.god = false;
      h.revivesLeft = 0;
      h.phoenixUsed = true;
      h.petState.reviveUsed = true;
      h.petState.shieldReady = false;
      for (let k = 0; k < 4 && !h.player.dead; k++) {
        h.player.invuln = 0;
        h.player.hp = 1;
        g.hurtHero(h, 999, h.player.x + 1, h.player.z);
      }
      window.cheats.god = true;
      return h.player.dead ? [h.player.x, h.player.z] : false;
    });
    if (!downed) {
      await coopEnd();
      return 'skipped (host not downed)';
    }
    let carried = [-1, -1];
    await client(() => window.botAuto(false));
    for (let k = 0; k < 12 && !(carried[0] === 1 && carried[1] === 1); k++) {
      // Step next to them, let the host see where we are (input messages), then press INTERACT.
      await client((at) => window.game.hero.player.teleport(at[0] + 1, at[1]), downed);
      await pause(300);
      await client(() => window.game.client.send({ t: 'carry' }));
      await pause(250);
      carried = await Promise.all([
        host(async () => (await import('/src/game/systems/coopplay.ts')).coopPlayState(window.game).carriedBy[0] ?? -1),
        client(async () => (await import('/src/game/systems/coopplay.ts')).coopPlayState(window.game).carriedBy[0] ?? -1),
      ]);
    }
    // Walk 4 m with them; the host hero rides along on both screens.
    await client((at) => window.game.hero.player.teleport(at[0] + 5, at[1]), downed);
    let ride = [99, 99];
    for (let k = 0; k < 8 && !(ride[0] < 1 && ride[1] < 2.5); k++) {
      await pause(300);
      ride = await Promise.all([
      host(() => { const g = window.game; return Math.hypot(g.heroes[0].player.x - g.heroes[1].player.x, g.heroes[0].player.z - g.heroes[1].player.z); }),
      client(() => { const g = window.game; return Math.hypot(g.heroes[0].player.x - g.hero.player.x, g.heroes[0].player.z - g.hero.player.z); }),
      ]);
    }
    await shot('coopplay-carry');
    await client(() => window.game.client.send({ t: 'carry' }));
    await pause(400);
    const down = await host(async () => (await import('/src/game/systems/coopplay.ts')).coopPlayState(window.game).carriedBy[0] ?? -1);
    await host(() => window.game.reviveHero(window.game.heroes[0], 0.6));
    await coopEnd();
    if (carried[0] !== 1 || carried[1] !== 1 || ride[0] > 1 || ride[1] > 2.5 || down !== -1) fail(`carry: carried host ${carried[0]} client ${carried[1]}, ride host ${ride[0]?.toFixed(2)} client ${ride[1]?.toFixed(2)}, put down ${down}`);
    return { carried, ride: ride.map((d) => +d.toFixed(2)), down };
  }],
  [27, 'buddy tether between the two heroes', async () => {
    if (!(await coopFight())) return 'skipped (not fighting)';
    await host(() => window.botAuto(false));
    await client(() => window.botAuto(false));
    let r;
    for (let k = 0; k < 20; k++) {
      const at = await host(() => {
        const p = window.game.hero.player;
        return [p.x, p.z];
      });
      await client((at) => window.game.hero.player.teleport(at[0] + 3, at[1]), at);
      await pause(300);
      r = await Promise.all([
        host(async () => { const s = (await import('/src/game/systems/coopplay.ts')).coopPlayState(window.game); return [s.pairs, +(s.link[0] ?? 0).toFixed(1)]; }),
        client(async () => { const s = (await import('/src/game/systems/coopplay.ts')).coopPlayState(window.game); return [s.pairs, +(s.link[1] ?? 0).toFixed(1)]; }),
      ]);
      if (r[0][0] === 1 && r[1][0] === 1 && r[0][1] > 1) break;
    }
    await shot('coopplay-tether');
    await coopEnd();
    if (r[0][0] !== 1 || r[1][0] !== 1 || !(r[0][1] > 0) || !(r[1][1] > 0)) fail(`tether: host ${JSON.stringify(r[0])}, client ${JSON.stringify(r[1])}`);
    return { host: r[0], client: r[1] };
  }],
  // Trading lane: gifts go through the host and land on both screens; the TRADE quick menu opens on the client.
  [22, 'trading: the client gives the host gold, the host gives a gear back', async () => {
    await host(() => {
      const g = window.game;
      g.heroes[1].gold = 20;
      g.heroes[0].rerollsLeft = 2;
      g.heroes[1].rerollsLeft = 0;
    });
    await pause(500);
    const before = await host(() => window.game.heroes[0].gold);
    await client(() => window.game.tradeAct({ a: 'give', k: 'gold', to: 0, n: 7 }));
    await pause(400);
    await host(() => window.game.tradeAct({ a: 'give', k: 'gear', to: 1 }));
    // The client mirrors the host's snapshot: poll until it catches up (menus slow snapshots to 4 Hz).
    let h, c;
    for (let k = 0; k < 20; k++) {
      await pause(400);
      [h, c] = await Promise.all([
        host(() => ({ gold: window.game.heroes.map((x) => x.gold), gears: window.game.heroes.map((x) => x.rerollsLeft) })),
        client(() => ({ gold: window.game.hero.gold, gears: window.game.hero.rerollsLeft, mateGold: window.game.tradeView().heroes[0].gold })),
      ]);
      if (c.gears === h.gears[1] && c.gold === h.gold[1]) break;
    }
    if (h.gold[0] < before + 7 || h.gold[1] > 13 + 4 /* coins picked up meanwhile */ || h.gears[1] !== 1 || c.gears !== 1 || c.gold !== h.gold[1]) fail(`trading: host ${JSON.stringify(h)}, client ${JSON.stringify(c)}`);
    return { host: h, client: c };
  }],
  [25, 'trading: the TRADE quick menu on the client', async () => {
    // Wait for a fight moment on the client (no level-up or shop menu up), then open it.
    let open = false;
    for (let k = 0; k < 20 && !open; k++) {
      await client(() => {
        const g = window.game;
        if (g.isCombatMode && g.screens.current === 'none') g.openTrade();
      });
      await pause(400);
      open = await client(() => window.game.screens.current === 'trade' && document.querySelectorAll('#scr-trade [data-tr=gold]').length > 0);
    }
    await shot('trade');
    await client(() => window.game.resume());
    if (!open) fail('trading: the TRADE menu did not open on the client');
    return open;
  }],
];

// Optional secrets lane: real data-channel receipts, relics and a client room screenshot.
if (args.includes('--secrets')) SCENARIO.push([56, 'secret relay reward reaches the client once', async () => {
  if (!await until(A, () => window.game.mode === 'fight', null, 10000)) throw new Error('No fight window for secret relay');
  await Promise.all([host(() => window.botAuto(false)), client(() => window.botAuto(false))]);
  try {
    const result = await host(async () => {
      const S = await import('/src/game/systems/secrets.ts');
      const g = window.game, before = g.heroes[1].relics.length;
      S.secretsLinks(g, new URLSearchParams('secret=plates'));
      const r = S.secretsState(g).room;
      if (!r) throw new Error('No clear secret room');
      for (const j of [0, 2, 1]) { g.hero.player.teleport(r.x + (j - 1) * 3, r.z); S.updateSecrets(g, 1 / 60); }
      g.hero.player.teleport(r.x, r.z + 3);
      return { x: r.x + 1, z: r.z + 3, count: before + 1, done: r.done };
    });
    await client(({ x, z }) => { window.game.hero.player.teleport(x, z); window.game.cam.zoom = 1.3; }, result);
    const synced = await until(B, async () => {
      const S = await import('/src/game/systems/secrets.ts');
      return S.secretsState(window.game).room?.done && !!(S.secretsState(window.game).receipts & 1);
    }, null, 6000);
    const count = await client(() => window.game.hero.relics.length);
    if (!synced || !result.done || count !== result.count) fail(`secret relay: completed ${synced}, client relics ${count}, expected ${result.count}`);
    await shot('secrets');
    return { synced, relics: count };
  } finally { await Promise.all([host(() => window.botAuto(true)), client(() => window.botAuto(true))]); }
}]);

// --pets2: use Mini Mech / Owl-Bot and verify their additive companion records over WebRTC.
if (args.includes('--pets2')) SCENARIO.push([19, 'pets2 turret and scout snapshots', async () => {
  const expected = await host(() => {
    const g = window.game, mech = g.heroes[0].petState.extra, owl = g.heroes[1].petState.extra;
    mech.actionT = 60; mech.turretT = 30; mech.turretX = g.hero.player.x; mech.turretZ = g.hero.player.z;
    owl.scanT = 60; owl.scoutKind = 2; owl.scoutX = 24; owl.scoutZ = 17;
    owl.secret = true; owl.secretX = -21; owl.secretZ = 18;
    return { x: mech.turretX, z: mech.turretZ };
  });
  await B.page.waitForFunction(({ x, z }) => {
    const hs = window.game.heroes, a = hs[0]?.petState.extra, b = hs[1]?.petState.extra;
    return hs[0]?.pet === 'minimech' && hs[1]?.pet === 'owlbot' && a.turretT > 0 &&
      Math.abs(a.turretX - x) < 0.11 && Math.abs(a.turretZ - z) < 0.11 &&
      b.scoutKind === 2 && b.scoutX === 24 && b.secret && b.secretX === -21;
  }, expected, { timeout: PAGE_TIMEOUT });
  return client(() => window.game.heroes.map(h => [h.pet, h.petState.extra.net()]));
}]);

// Optional Halloween run: force a shared pickup and verify its receipt travels once.
if (opt('--season', 'off') === 'halloween') SCENARIO.push([14, 'Halloween shared candy snapshot', async () => {
  const before = await client(async () => (await import('/src/game/save.ts')).save.seasonal.candy);
  const earned = await host(async () => {
    const { dropCandy, halloweenStep } = await import('/src/game/systems/halloween.ts');
    const g = window.game, p = g.heroes[1].player;
    dropCandy.call(g, p.x, p.z, 3); halloweenStep.call(g, 1 / 60);
    return g.halloween.earned;
  });
  await pause(700);
  const result = await client(async () => ({ season: window.game.halloween.season, earned: window.game.halloween.earned, candy: (await import('/src/game/save.ts')).save.seasonal.candy }));
  if (result.season !== 'halloween' || result.earned < earned || result.candy < before + 3) fail(`Halloween candy: ${JSON.stringify(result)}`);
  return result;
}]);

if (RELOAD) {
  SCENARIO.push([74, 'client reloads its tab and rejoins within 60 s (netcode lane)', async () => {
    const before = await host(() => window.game.heroes.length);
    await B.page.reload({ timeout: 120000 });
    await B.page.waitForFunction(() => window.game && window.botAuto, null, { timeout: 120000 });
    if (NETSIM) await setNetSim(B.page);
    await patient(B.page);
    let ok = false;
    for (let k = 0; k < 120 && !ok; k++) {
      await pause(500);
      ok = await client(() => window.game.role === 'client' && window.game.mode !== 'title' && window.game.local === 1);
    }
    const after = await host(() => ({ n: window.game.heroes.length, left: window.game.heroes[1].left }));
    if (!ok || after.n !== before || after.left) fail(`reload: rejoined ${ok}, host heroes ${before} -> ${after.n}, left ${after.left}`);
    await client(() => window.botAuto(true));
    return { rejoined: ok, host: after };
  }]);
}
// Modsupport: inherited weapon state, new enemy wire IDs, and the exact same pack hash.
if (args.includes('--modsupport')) SCENARIO.push([5, 'matching content packs', async () => {
  const expected = await host(async () => {
    const { modSession } = await import('/src/mods/manager.ts');
    const { createWeapon } = await import('/src/game/weapons/index.ts');
    const { ENEMIES } = await import('/src/data/enemies.ts');
    const g = window.game, h = g.heroes[1];
    h.weapons.push(createWeapon('mint_drones', g.scene)); h.loadoutDirty = true;
    g.enemies.spawn(ENEMIES.mint_bopper, h.player.x + 8, h.player.z, g.spawnOpts());
    return modSession.hash;
  });
  const result = await until(B, async () => {
    const { modSession } = await import('/src/mods/manager.ts');
    const { ENEMIES } = await import('/src/data/enemies.ts');
    const w = window.game.hero.weapons.find(w => w.def.id === 'mint_drones');
    return w && { hash: modSession.hash, color: w.color, params: w.p.count, net: w.net(), enemy: ENEMIES.mint_bopper.bodyColor };
  });
  if (!result || result.hash !== expected || result.color !== '#a7f070' || result.params !== 4 || result.net.length !== 2 || result.enemy !== '#38b764') fail('custom content did not match on the client: ' + JSON.stringify(result));
  return result;
}]);

// Spectate lane: a third page joins with JOIN AS SPECTATOR, watches (follow, auto director, free camera, broadcast
// overlay), gets half the snapshots, sends an emote the client player sees, then leaves (--no-spectate skips it).
if (!args.includes('--no-spectate')) SCENARIO.push([22, 'a spectator joins, watches, emotes and leaves (spectate lane)', async () => {
  const C = await openPage('spectator');
  try {
    await patient(C.page);
    await C.page.evaluate((code) => {
      const g = window.game;
      g.saveName('SPECBOT');
      g.screens.showOnline('SPECBOT');
      document.querySelector('#mp-code').value = code;
      document.querySelector('#scr-online [data-act=sp-join]').click();
    }, code);
    const watching = await until(C, async () => {
      const S = await import('/src/game/systems/spectate.ts');
      const g = window.game;
      return S.spectating(g) && g.mode !== 'title' && g.heroes.length === 2 && g.netEnemies.size > 0;
    }, null, 30000);
    const seats = await until(A, async () => (await import('/src/game/systems/spectate.ts')).spectateState(window.game).specs.length, null, 6000);
    const badge = await until(B, async () => (await import('/src/game/systems/spectate.ts')).spectateState(window.game).watchers.n === 1, null, 6000);
    if (!watching || seats !== 1 || !badge) fail(`spectator: watching ${watching}, host seats ${seats}, client badge ${badge}`);
    // Snapshot rate: the spectator gets about half of what the client player gets.
    const count = (p) => p.page.evaluate(() => {
      const g = window.game;
      window.__snaps = 0;
      if (!window.__snapWrap) {
        window.__snapWrap = true;
        const on = g.onClientMessage;
        g.onClientMessage = function (m) {
          if (m?.t === 's') window.__snaps++;
          return on.call(this, m);
        };
      }
    });
    await Promise.all([count(B), count(C)]);
    await pause(3000);
    const [nB, nC] = await Promise.all([B.page.evaluate(() => window.__snaps), C.page.evaluate(() => window.__snaps)]);
    if (!(nC > 0 && nC < nB * 0.7)) fail(`spectator snapshots: client ${nB}, spectator ${nC} in 3 s (want about half)`);
    // Heroes mirrored on the spectator.
    const pos = async (p) => p.page.evaluate(() => window.game.heroes.map((h) => [h.player.x, h.player.z, h.player.dead]));
    // The spectator draws 10 Hz snapshots through the playout buffer: on a busy machine it lags, so sample a few times.
    let off = [];
    for (let k = 0; k < 6; k++) {
      const [ph, pc] = await Promise.all([pos(A), pos(C)]);
      off = ph.map((a, i) => (pc[i] && !a[2] ? Math.hypot(a[0] - pc[i][0], a[1] - pc[i][1]) : 0));
      if (!off.some((d) => d > POS_TOL * 2)) break;
      await pause(500);
    }
    if (off.some((d) => d > POS_TOL * 2)) fail(`spectator hero positions off by ${off.map((d) => d.toFixed(1))} m`);
    // Follow the client player, then the auto director, then the free camera.
    // Follow the other hero (one that's standing, so the follow camera doesn't move on from a downed one).
    const want = await C.page.evaluate(async () => {
      const S = await import('/src/game/systems/spectate.ts');
      const g = window.game;
      const st = S.spectateState(g);
      const i = g.heroes.findIndex((h, k) => k !== st.follow && !h.left && !h.player.dead);
      st.cam = 'follow';
      st.follow = i >= 0 ? i : st.follow === 0 ? 1 : 0;
      st.director.held = 0;
      return st.follow;
    });
    const followed = await until(A, async (i) => (await import('/src/game/systems/spectate.ts')).spectateState(window.game).specs[0]?.follow === i, want, 8000);
    const local = await until(C, (i) => window.game.local === i, want, 4000);
    if (!followed || !local) fail(`spectator follow ${want}: host knows ${followed}, spectator HUD on it ${local}`);
    try { await C.page.screenshot({ path: join(OUT, 'spectator-follow.png'), timeout: 90000 }); } catch {}
    await C.page.evaluate(async () => { (await import('/src/game/systems/spectate.ts')).spectateState(window.game).cam = 'auto'; });
    await pause(2500);
    await C.page.evaluate(async () => {
      const st = (await import('/src/game/systems/spectate.ts')).spectateState(window.game);
      st.cam = 'free';
      st.fx += 12;
    });
    const free = await until(A, async () => !!(await import('/src/game/systems/spectate.ts')).spectateState(window.game).specs[0]?.free, null, 4000);
    if (!free) fail('spectator free camera never reached the host');
    try { await C.page.screenshot({ path: join(OUT, 'spectator-free.png'), timeout: 90000 }); } catch {}
    // An emote from the spectator shows on the client player's screen.
    await C.page.evaluate(() => window.game.client.send({ t: 'emote', k: 'cheer' }));
    const seen = await until(B, () => (document.querySelector('#sp-root .sp-feed')?.textContent ?? '').includes('SPECBOT'), null, 6000);
    if (!seen) fail("the spectator's emote never reached the client player");
    try { await B.page.screenshot({ path: join(OUT, 'spectator-emote-client.png'), timeout: 90000 }); } catch {}
    for (const e of C.errors) fail(`spectator page error: ${e}`);
    return { watching, nB, nC, off: off.map((d) => +d.toFixed(2)), followed, free, seen };
  } finally {
    await C.page.context().close().catch(() => {});
  }
}]);
// The data channel close can take a while to reach the host; the silent-spectator drop (patient: 30 s here) is the backstop.
if (!args.includes('--no-spectate')) SCENARIO.push([66, 'the spectator seat is freed after it left (spectate lane)', async () => {
  const gone = await until(A, async () => (await import('/src/game/systems/spectate.ts')).spectateState(window.game).specs.length === 0, null, 40000);
  if (!gone) fail('the host kept the spectator seat after it left');
  return { gone };
}]);
// ultboss: optional real-WebRTC coverage, including the terminal ending snapshot.
// npm run coop -- --offline --only architect --architect --secs 22
if (args.includes('--architect')) SCENARIO.push([3, 'architect phases, ordered cores and true ending', async () => {
  await host(() => window.botAuto(false)); await client(() => window.botAuto(false));
  const expected = await host(async () => {
    const S = await import('/src/game/systems/architect.ts');
    const { settings } = await import('/src/game/settings.ts');
    const g = window.game; settings.finishers = false; g.loadStage(12); S.startArchitect(g, true);
    g.xpNext = 1e12; return { uid: g.boss.uid, hp: g.boss.maxHp };
  });
  const initial = await until(B, async expected => {
    const s = (await import('/src/game/systems/architect.ts')).architectState(window.game);
    return s.active && s.uid === expected.uid && s.phase === 1;
  }, expected);
  if (!initial) fail('architect arrival did not reach client');
  await host(async () => {
    const S = await import('/src/game/systems/architect.ts'), s = S.architectState(window.game);
    s.layout = 1; s.layoutTime = 3; s.pause = 10;
  });
  await until(B, async () => (await import('/src/game/systems/architect.ts')).architectState(window.game).layout === 1);
  await client(() => window.game.player.teleport(16, 16));
  const rescued = await until(B, async () => {
    const s = (await import('/src/game/systems/architect.ts')).architectState(window.game), p = window.game.player;
    return s.rescues[window.game.hero.index][0] > 0 && Math.min(Math.abs(p.x), Math.abs(p.z)) < 6;
  });
  if (!rescued) fail('architect host floor rescue did not correct the client');
  await host(async () => { (await import('/src/game/systems/architect.ts')).architectState(window.game).pause = 0; });
  for (const phase of [2, 3]) {
    await host(async () => {
      const S = await import('/src/game/systems/architect.ts'), g = window.game;
      S.updateArchitect(g, 3.1); g.damage(g.boss, 1e9, { source: 'qa', fixed: true, noStatus: true }, g.hero);
    });
    const mirrored = await until(B, async phase => (await import('/src/game/systems/architect.ts')).architectState(window.game).phase === phase, phase);
    if (!mirrored) fail('architect phase ' + phase + ' did not reach client');
  }
  for (let index = 0; index < 3; index++) {
    await host(async index => {
      const S = await import('/src/game/systems/architect.ts'), g = window.game;
      S.updateArchitect(g, 2.1); const s = S.architectState(g), e = g.enemies.list.find(e => e.active && e.uid === s.coreUids[index]);
      g.damage(e, 1e9, { source: 'qa', fixed: true, noStatus: true }, g.hero); S.updateArchitect(g, 1 / 60);
    }, index);
    const core = await until(B, async index => (await import('/src/game/systems/architect.ts')).architectState(window.game).core === index + 1, index);
    if (!core) fail('architect ordered core ' + index + ' did not reach client');
  }
  await host(async () => {
    const S = await import('/src/game/systems/architect.ts'), g = window.game;
    g.damage(g.boss, 1e9, { source: 'qa', fixed: true, noStatus: true }, g.hero);
  });
  if (!await until(B, async () => (await import('/src/game/systems/architect.ts')).architectState(window.game).desperate)) fail('architect desperation missing on client');
  await host(async () => {
    const S = await import('/src/game/systems/architect.ts'), g = window.game;
    for (let i = 0; i < 480; i++) S.updateArchitect(g, 1 / 60);
    g.damage(g.boss, 1e9, { source: 'qa', fixed: true, noStatus: true }, g.hero); g.stageClear();
  });
  const ending = await until(B, () => window.game.screens.current === 'architect-ending');
  if (!ending) fail('architect true ending screen missing on client');
  await shot('architect-ending');
  // Leave the shared harness ready for its party/restart checks.
  for (const p of [A, B]) await p.page.evaluate(() => { for (let i = 0; i < 3; i++) document.querySelector('#scr-architect-ending [data-nav]')?.click(); });
  return { ...expected, rescued, ending };
}]);

// weather2: opt-in real WebRTC coverage of the lane snapshot, including late warning reconstruction.
if (args.includes('--weather2')) SCENARIO.push([6, 'weather2: four combat events reach the client', async () => {
  if (!await coopFight()) throw new Error('weather2 needs both peers fighting');
  const results = [];
  for (const kind of ['sandstorm', 'blizzard', 'lightning', 'heatwave']) {
    const expected = await host(async kind => {
      const g = window.game;
      const { startWeather2, weather2Of, updateWeather2, weather2Net } = await import('/src/game/systems/weather2.ts');
      const { settings } = await import('/src/game/settings.ts');
      settings.weatherEffects = true;
      startWeather2(g, kind);
      const s = weather2Of(g);
      if (kind === 'lightning') { s.nextStrike = 0; updateWeather2.call(g, 0); }
      return weather2Net(g);
    }, kind);
    const mirrored = await until(B, async expected => {
      const { weather2Net } = await import('/src/game/systems/weather2.ts');
      const s = weather2Net(window.game);
      return s?.k === expected.k && s.p.length === expected.p.length && s.p.every((p, i) => Math.abs(p[0] - expected.p[i][0]) < 0.02 && Math.abs(p[1] - expected.p[i][1]) < 0.02)
        && (expected.k !== 'lightning' || s.s.some(p => expected.s.some(q => p[0] === q[0] && p[1] === q[1])));
    }, expected, 10000);
    if (!mirrored) fail(`weather2 ${kind} snapshot/telegraph did not arrive`);
    results.push({ kind, mirrored });
  }
  await host(() => { window.game.runEvents.event = null; });
  const cleared = await until(B, async () => !(await import('/src/game/systems/weather2.ts')).weather2Net(window.game), null, 8000);
  if (!cleared) fail('weather2 left a stale client event');
  await coopEnd();
  return { results, cleared };
}]);

SCENARIO.sort((a, b) => a[0] - b[0]);
if (ONLY) for (let i = SCENARIO.length - 1; i >= 0; i--) if (!SCENARIO[i][1].includes(ONLY)) SCENARIO.splice(i, 1);
let next = 0;
let shots = 0;
const shotAt = [12, 30, 48, SECS - 4];
const t0 = Date.now();
let lastCheck = 0;
while ((Date.now() - t0) / 1000 < SECS) {
  const t = (Date.now() - t0) / 1000;
  while (next < SCENARIO.length && SCENARIO[next][0] <= t) {
    const [, what, fn] = SCENARIO[next++];
    try {
      const r = await fn();
      log(`scenario: ${what}${r !== undefined ? ` -> ${JSON.stringify(r)}` : ''}`);
    } catch (e) {
      fail(`scenario "${what}" threw: ${e.message}`);
    }
  }
  if (shots < shotAt.length && t >= shotAt[shots]) await shot(`t${shotAt[shots++]}`);
  if (t - lastCheck >= 4) {
    lastCheck = t;
    try {
      await compare(`t=${t.toFixed(0)}`);
    } catch (e) {
      fail(`compare threw: ${e.message}`);
    }
  }
  if (A.errors.length || B.errors.length) break;
  await new Promise((r) => setTimeout(r, 250));
}
if (!A.errors.length && !B.errors.length) {
  try {
    if (args.includes('--raid')) await raidPhase();
    await partyPhase();
  } catch (e) {
    fail(`party phase threw: ${e.message}`);
  }
}
await done();

// ---------------------------------------------------------------- lobby lane
/** Poll `fn` on a page until it returns truthy (or time runs out); returns the last value. */
async function until(p, fn, arg, ms = 8000) {
  const t = Date.now();
  let v;
  do {
    v = await p.page.evaluate(fn, arg);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 150));
  } while (Date.now() - t < ms);
  return v;
}
function click(p, sel) {
  return p.page.evaluate((sel) => {
    const b = document.querySelector(sel);
    if (b) b.click();
    return !!b;
  }, sel);
}

/** Lobby: invite link landed, cards, pings, chat, then READY-UP starts the run. */
async function lobbyPhase() {
  const url = await B.page.evaluate(() => location.search);
  if (url.includes('join=')) fail(`the invite link's join= stays in the address (${url})`);
  const cards = await until(B, () => {
    const x = document.querySelectorAll('#scr-online .lob-card');
    return x.length === 2 && document.querySelector('#scr-online .players').textContent.includes('HOSTBOT') && [...x].map((c) => c.textContent.replace(/\s+/g, ' ').trim());
  });
  if (!cards) fail('client lobby: no player cards for both players');
  const ping = await until(A, () => {
    const t = document.querySelectorAll('#scr-online .lob-card')[1]?.querySelector('.ping')?.textContent ?? '';
    return /\d+ MS/.test(t) && t;
  });
  if (!ping) fail('host lobby: no ping for the client');
  // Chat both ways: free text (filtered) from the client, quick chat from the host.
  await B.page.evaluate(() => {
    const inp = document.querySelector('#scr-online .lob-input');
    inp.value = 'hi host, this shit works';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  });
  await click(A, '#scr-online [data-act=chat-quick][data-q="2"]');
  const chatA = await until(A, () => {
    const t = document.querySelector('#scr-online .lob-log')?.textContent ?? '';
    return t.includes('this **** works') && t.includes("LET'S GO!") && t;
  });
  const chatB = await until(B, () => {
    const t = document.querySelector('#scr-online .lob-log')?.textContent ?? '';
    return t.includes('this **** works') && t.includes("HOSTBOT: LET'S GO!") && t;
  });
  if (!chatA || !chatB) fail(`lobby chat: host sees "${chatA}", client sees "${chatB}"`);
  await shot('lobby');
  // READY-UP: the client first (no start yet), then the host; the countdown starts the run.
  await click(B, '#scr-online [data-act=lob-ready]');
  await new Promise((r) => setTimeout(r, 600));
  const early = await A.page.evaluate(() => window.game.mode);
  if (early !== 'title') fail(`the run started with only the client ready (${early})`);
  await click(A, '#scr-online [data-act=lob-ready]');
  const counting = await until(B, () => /STARTING IN/.test(document.querySelector('#scr-online .lob-status')?.textContent ?? ''), null, 3000);
  if (!counting) fail('client never saw the ready-up countdown');
  log(`lobby: cards ${JSON.stringify(cards)}, host ping ${ping}, chat ok ${!!(chatA && chatB)}, countdown seen ${!!counting}`);
}

/** After the run: game over, PARTY, vote RESTART, game over, BACK TO LOBBY, then KICK. */
async function partyPhase() {
  const over = async () => {
    await host(() => {
      const g = window.game;
      g.mode = 'dead';
      g.endRun();
    });
    // MVP is the shipped first post-run screen; continue through it before testing PARTY.
    await Promise.all([A, B].map(async p => {
      await until(p, () => ['mvp', 'gameover'].includes(window.game.screens.current), null, 6000);
      if (await p.page.evaluate(() => window.game.screens.current === 'mvp')) await click(p, '#scr-mvp button[data-nav]');
    }));
    const ok = await until(B, () => window.game.screens.current === 'gameover', null, 6000);
    const okA = await host(() => window.game.screens.current === 'gameover');
    if (!ok || !okA) fail(`party: game over screens host ${okA} client ${ok}`);
  };
  await Promise.all([A, B].map((p) => p.page.evaluate(() => window.botAuto(false))));
  await over();
  for (const p of [A, B]) if (!(await click(p, '#scr-gameover [data-act=party-open]:not([hidden])'))) fail(`party: no PARTY button on the ${p.name}`);
  const rows = await until(B, () => window.game.screens.current === 'party' && document.querySelectorAll('#scr-party .pty-row').length === 2 && document.querySelector('#scr-party .pty-sum').textContent);
  if (!rows) fail('party: the client party screen has no rows');
  await click(B, '#scr-party [data-act=pty-vote][data-v=restart]');
  const seen = await until(A, () => document.querySelector('#scr-party [data-act=pty-vote][data-v=restart]')?.textContent.includes('1/2'), null, 4000);
  if (!seen) fail('party: the host never saw the client vote');
  await shot('party');
  await click(A, '#scr-party [data-act=pty-vote][data-v=restart]');
  const again = await until(B, () => window.game.mode !== 'dead' && window.game.mode !== 'title' && window.game.heroes.length === 2 && window.game.stage === 1, null, 10000);
  const seeds = await Promise.all([host(() => window.game.seed), client(() => window.game.seed)]);
  if (!again || seeds[0] !== seeds[1]) fail(`party: RESTART didn't start the same run on both (client ok ${again}, seeds ${seeds})`);
  await new Promise((r) => setTimeout(r, 1500));
  await over();
  for (const p of [A, B]) await click(p, '#scr-gameover [data-act=party-open]:not([hidden])');
  await until(B, () => window.game.screens.current === 'party', null, 3000);
  await click(B, '#scr-party [data-act=pty-vote][data-v=lobby]');
  await new Promise((r) => setTimeout(r, 500));
  await click(A, '#scr-party [data-act=pty-vote][data-v=lobby]');
  const lobbyB = await until(B, () => window.game.mode === 'title' && window.game.role === 'client' && window.game.screens.current === 'online' && document.querySelectorAll('#scr-online .lob-card').length === 2, null, 6000);
  const lobbyA = await host(() => window.game.mode === 'title' && window.game.lobby.length === 2 && window.game.screens.current === 'online');
  if (!lobbyA || !lobbyB) fail(`party: BACK TO LOBBY host ${lobbyA} client ${lobbyB}`);
  await shot('lobby-again');
  // KICK: the client leaves for the title with a message; the host lobby has just the host.
  // The title demo can replace a toast before the next 150 ms poll. Observe the
  // actual notice as well as requiring the final disconnected/title state.
  await client(() => { window.__kickToasts = []; const toast = window.game.hud.toast; window.game.hud.toast = function (...args) { window.__kickToasts.push(args[0]); return toast.apply(this, args); }; });
  if (!(await click(A, '#scr-online [data-act=lob-kick]'))) fail('kick: no KICK button');
  const out = await until(B, () => window.game.role === 'solo' && window.game.mode === 'title' && window.game.screens.current === 'title' && window.__kickToasts.some(s => s.includes('REMOVED')), null, 5000);
  const hostOne = await until(A, () => window.game.lobby.length === 1, null, 3000);
  if (!out || !hostOne) fail(`kick: client out ${out}, host lobby down to 1 ${hostOne}, client ${JSON.stringify(await client(() => ({ role: window.game.role, mode: window.game.mode, screen: window.game.screens.current, toast: document.querySelector('#toast')?.textContent, notices: window.__kickToasts })))}`);
  log(`party: rows ok ${!!rows}, restart ok ${!!again}, back to lobby ${lobbyA && !!lobbyB}, kick ${!!out && !!hostOne}`);
}

async function done() {
  try {
    const [ha, cb] = await Promise.all([A.page.evaluate(() => window.__coop), B.page.evaluate(() => window.__coop)]);
    log(`skill events sent to the client: ${JSON.stringify(ha?.skill)}; received: ${JSON.stringify(cb?.skill)}`);
    log(`effects received by the client: ${JSON.stringify(cb?.vfx)}`);
    const net = await B.page.evaluate(async () => {
      const m = await import('/src/game/systems/netcode.ts');
      const s = m.netcodeState(window.game);
      return { playout: s.playout?.stats, nq: s.nq, events: s.events };
    });
    const hev = await A.page.evaluate(async () => (await import('/src/game/systems/netcode.ts')).netcodeState(window.game).events);
    log(`client playout (netcode lane): ${JSON.stringify(net.playout)}; host's numbers for everyone: ${JSON.stringify(net.nq)}`);
    log(`connection events: host ${JSON.stringify(hev)}; client ${JSON.stringify(net.events)}`);
    const sn = ha?.snap;
    if (sn?.n) {
      log(`snapshots${sn.wire ? ' (wire bytes)' : ' (JSON estimate)'}: ${sn.n}, avg ${Math.round(sn.total / sn.n)} B, max ${sn.max} B, ${sn.over16k} over 16 KB (PeerJS chunks those)`);
      log(`avg bytes per snapshot by field: ${Object.entries(sn.parts).map(([k, v]) => `${k} ${Math.round(v / sn.n)}`).join(', ')}`);
    }
  } catch {}
  for (const p of [A, B].filter(Boolean)) for (const e of p.errors) fail(`${p.name} page error: ${e}`);
  await browser.close().catch(() => {});
  await server.close();
  console.log(failures.length ? `\nCO-OP TEST FAILED (${failures.length}):\n- ${[...new Set(failures)].join('\n- ')}` : '\nCO-OP TEST PASSED');
  process.exit(failures.length ? 1 : 0);
}

/** Raid authority, role state, cell carry and late phases over the real data channel. */
async function raidPhase() {
  await A.page.evaluate(() => { const g=window.game;g.lobbyKind='raid';g.runMode='raid';g.startRun(); });
  const started=await until(B,()=>window.game.runMode==='raid'&&window.game.raidNet()?.phase==='heads');
  if(!started)fail('raid client did not start');
  const arena=await B.page.evaluate(()=>window.game.arena.halfSize);
  if(arena!==27)fail(`raid client arena wrong: ${arena}`);
  await new Promise(r=>setTimeout(r,3000));
  await shot('raid-heads');
  await A.page.evaluate(()=>{const s=window.game.raidNet();s.phase='core';for(const h of s.heads)h.sealed=true;s.actors[1].cell=true;});
  if(!await until(B,()=>window.game.raidNet()?.phase==='core'&&window.game.raidNet()?.actors[1].cell))fail('raid cell/core state did not mirror');
  await shot('raid-core');
  await A.page.evaluate(()=>{const s=window.game.raidNet();s.delivered=12;s.core=0;});
  if(!await until(B,()=>window.game.raidNet()?.phase==='overdrive'))fail('raid overdrive did not mirror');
  await A.page.evaluate(()=>{const s=window.game.raidNet();for(const h of s.heads)h.sealed=true;});
  if(!await until(B,()=>window.game.raidNet()?.phase==='won'))fail('raid finisher did not mirror');
  await shot('raid-finisher');
  log('raid: heads, arena, carry, overdrive and finisher checked');
}
