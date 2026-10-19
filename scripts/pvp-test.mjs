// Online PvP test (pvp2 lane) with three real game instances in headless Chromium.
//   node scripts/pvp-test.mjs [--out shots/pvp] [--size 960x540] [--format teams|ffa]
// Page A hosts a PvP lobby (2 TEAMS, BEST OF 3) and adds a bot, pages B and C
// join with the code. Everyone plays their own stage for a few seconds with the
// dev bot (`botAuto`), hands in the build, and the duel runs over the real
// netcode: every 3 s the script compares host and clients (round, wins, teams,
// arena, ring radius, every hero's life and position) and takes screenshots
// (shots/pvp/). Rounds are decided by the bots fighting; if a round runs past
// 30 s the host knocks out one side so the match keeps moving. Fails on page
// errors, console errors, lasting desyncs, or a match that never ends.
// Signalling goes through PeerJS's public broker like the real game (needs internet).
// PVP_TIMEOUT_MS=60000 for slow machines.
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
const OUT = opt('--out', join('shots', 'pvp'));
const FORMAT = opt('--format', 'teams');
const [W, H] = opt('--size', '960x540').split('x').map(Number);
const PAGE_TIMEOUT = Number(process.env.PVP_TIMEOUT_MS ?? 30000);
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

const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const base = `http://127.0.0.1:${server.config.server.port ?? server.httpServer.address().port}/`;
const browser = await chromium.launch({
  headless: true,
  executablePath: findChrome(),
  args: [`--use-angle=${process.env.COOP_ANGLE ?? 'swiftshader'}`, '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

async function openPage(name) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript(() => localStorage.setItem('infinishoot.settings.v1', JSON.stringify({ graphics: 0, bossIntro: false })));
  const page = await ctx.newPage();
  page.setDefaultTimeout(PAGE_TIMEOUT);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack ?? '').split('\n').slice(1, 4).join('\n')}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|Failed to load resource|AudioContext was not allowed|WebGL: INVALID_OPERATION|GPU stall/i.test(t)) return;
    errors.push(t);
  });
  await page.goto(base + '?season=off', { timeout: 300000 });
  await page.waitForFunction(() => window.game && window.botAuto && window.game.mode === 'title', null, { timeout: 300000 });
  return { name, page, errors };
}

const pages = [await openPage('host'), await openPage('clientB'), await openPage('clientC')];
const [A, B, C] = pages;
log('pages loaded');

async function done() {
  for (const p of pages) for (const e of p.errors) fail(`${p.name} page error: ${e}`);
  await browser.close().catch(() => {});
  await server.close();
  console.log(failures.length ? `\nPVP TEST FAILED (${failures.length}):\n- ${[...new Set(failures)].join('\n- ')}` : '\nPVP TEST PASSED');
  process.exit(failures.length ? 1 : 0);
}
const shot = async (tag) => {
  for (const p of pages) await p.page.screenshot({ path: join(OUT, `${tag}-${p.name}.png`) }).catch(() => {});
};

// ---------------------------------------------------------------- lobby
await A.page.evaluate(() => void window.game.hostGame('HOSTBOT'));
const hostReady = await A.page
  .waitForFunction(() => window.game.host?.code && window.game.host.ready, null, { timeout: 30000 })
  .then(() => A.page.evaluate(async () => {
    try {
      await window.game.host.ready;
      return true;
    } catch (e) {
      return String(e?.type ?? e);
    }
  }))
  .catch((e) => String(e));
if (hostReady !== true) {
  fail(`host could not register with the signalling server: ${hostReady}`);
  await done();
}
const code = await A.page.evaluate(() => window.game.host.code);
log(`hosting, code ${code}`);
await A.page.evaluate(async (format) => {
  const P2 = await import('/src/game/systems/pvp2.ts');
  window.game.lobbyKind = 'pvp';
  P2.setPvpRules(window.game, { format, rounds: 3, arena: 'rotate' });
  window.game.refreshLobby();
}, FORMAT);
for (const [p, name] of [[B, 'BLUEBOT'], [C, 'ORANGEBOT']]) await p.page.evaluate(([c, n]) => void window.game.joinGame(n, c), [code, name]);
try {
  await A.page.waitForFunction(() => window.game.lobby.length === 3, null, { timeout: 30000 });
} catch {
  fail(`clients never joined (lobby ${await A.page.evaluate(() => window.game.lobby.length)})`);
  await done();
}
await A.page.evaluate(async () => {
  const P2 = await import('/src/game/systems/pvp2.ts');
  P2.addPvpBot(window.game);
});
await new Promise((r) => setTimeout(r, 800));
const rulesSeen = await Promise.all([B, C].map((p) => p.page.evaluate(() => document.querySelector('#scr-online .p2-x')?.textContent ?? '')));
if (!rulesSeen.every((t) => t.includes('BEST OF 3') && t.includes('THORN GARDEN'))) fail(`clients don't see the PvP rules rows: ${rulesSeen.map((t) => t.slice(0, 60)).join(' | ')}`);
const lobbyN = await B.page.evaluate(() => document.querySelectorAll('#scr-online .lobby-player, #scr-online .lob-card').length);
if (lobbyN < 4) fail(`client lobby lists ${lobbyN} players (want 4 with the bot)`);
await shot('lobby');
log('lobby: 3 players + a bot, starting');
await A.page.evaluate(() => window.game.hostStart());
const started = await Promise.all(pages.map((p) => p.page.waitForFunction(() => window.game.pvp?.phase === 'stage', null, { timeout: 15000 }).then(() => true).catch(() => false)));
if (!started.every(Boolean)) fail(`not everyone started their stage: ${started}`);
for (const p of pages) await p.page.evaluate(() => window.botAuto(true));
await new Promise((r) => setTimeout(r, 6000));
await shot('stage');
// Hand in the builds (a real stage takes 4+ minutes).
for (const p of [B, C, A]) {
  await p.page.evaluate(() => {
    const g = window.game;
    if (g.mode === 'shop') g.closeShop?.();
    if (g.pvp?.phase === 'stage') g.pvpStageDone();
  });
  await new Promise((r) => setTimeout(r, 300));
}
const inDuel = await Promise.all(pages.map((p) => p.page.waitForFunction(() => window.game.pvp?.phase === 'duel' && window.game.heroes.length === 4, null, { timeout: 20000 }).then(() => true).catch(() => false)));
if (!inDuel.every(Boolean)) {
  fail(`not everyone reached the duel: ${inDuel}`);
  await done();
}
log('duel started on every screen');
for (const p of pages) await p.page.evaluate(() => window.botAuto(true));

// ---------------------------------------------------------------- the match
const stateOf = (p) =>
  p.page.evaluate(() => {
    const g = window.game;
    const pvp = g.pvp;
    if (!pvp) return null;
    return {
      phase: pvp.phase,
      round: pvp.round,
      wins: pvp.wins.join('-'),
      teams: pvp.teams.join(''),
      arena: pvp.arena,
      zone: pvp.zoneR,
      cd: pvp.countdown,
      re: pvp.roundEnd,
      walls: g.arena.colliders.length,
      heroes: g.heroes.map((h) => ({ hp: h.player.hp, dead: h.player.dead, x: h.player.x, z: h.player.z })),
      board: !document.getElementById('pvp2-board')?.hidden,
      local: g.local,
    };
  });
let bad = 0;
let lastRound = 0;
let roundT = 0;
const rounds = new Set();
const t0 = Date.now();
while (Date.now() - t0 < 240000) {
  await new Promise((r) => setTimeout(r, 3000));
  const [h, ...cs] = await Promise.all(pages.map(stateOf));
  if (!h) break;
  if (h.phase === 'over') break;
  if (h.round !== lastRound) {
    lastRound = h.round;
    roundT = Date.now();
    rounds.add(`${h.round}:${h.arena}`);
    await shot(`round${h.round}`);
    log(`round ${h.round} in ${h.arena}, wins ${h.wins}`);
  }
  // Host vs clients (skip the moments around round changes).
  if (h.re <= 0 && h.cd <= 0) {
    const issues = [];
    for (const [k, c] of cs.entries()) {
      if (!c) {
        issues.push(`client ${k}: no pvp state`);
        continue;
      }
      if (c.round !== h.round || c.wins !== h.wins || c.teams !== h.teams || c.arena !== h.arena || c.walls !== h.walls) issues.push(`client ${k}: round/wins/teams/arena ${c.round}/${c.wins}/${c.teams}/${c.arena}/${c.walls} vs host ${h.round}/${h.wins}/${h.teams}/${h.arena}/${h.walls}`);
      if (Math.abs(c.zone - h.zone) > 1.5) issues.push(`client ${k}: ring ${c.zone.toFixed(1)} vs ${h.zone.toFixed(1)}`);
      h.heroes.forEach((hh, i) => {
        const ch = c.heroes[i];
        if (!ch) return issues.push(`client ${k}: hero ${i} missing`);
        if (ch.dead !== hh.dead) issues.push(`client ${k}: hero ${i} dead ${ch.dead} vs ${hh.dead}`);
        else if (!hh.dead && Math.abs(ch.hp - hh.hp) > 25) issues.push(`client ${k}: hero ${i} life ${ch.hp.toFixed(0)} vs ${hh.hp.toFixed(0)}`);
        if (!hh.dead && Math.hypot(ch.x - hh.x, ch.z - hh.z) > 4) issues.push(`client ${k}: hero ${i} at ${ch.x.toFixed(1)},${ch.z.toFixed(1)} vs ${hh.x.toFixed(1)},${hh.z.toFixed(1)}`);
      });
    }
    if (issues.length) {
      bad++;
      log('mismatch:', issues.join('; '));
      if (bad >= 2) fail(`desync two checks in a row: ${issues.join('; ')}`);
    } else bad = 0;
  }
  if (h.re > 0) {
    const boards = cs.map((c) => c?.board);
    if (!boards.every(Boolean)) log(`scoreboard on clients: ${boards}`);
  }
  // Keep the match moving: after 30 s of a round, the host knocks out the side with less life.
  if (h.re <= 0 && h.cd <= 0 && Date.now() - roundT > 30000) {
    await A.page.evaluate(() => {
      const g = window.game;
      const pvp = g.pvp;
      const life = [0, 1].map((t) => g.heroes.filter((x) => pvp.teams[x.index] === t && !x.player.dead).reduce((a, x) => a + x.player.hp, 0));
      const lose = life[0] <= life[1] ? 0 : 1;
      for (const x of g.heroes) {
        if (pvp.teams[x.index] !== lose || x.player.dead) continue;
        x.player.invuln = 0;
        x.player.hp = 1;
        g.hurtHero(x, 999, 0, 0, null, 'test');
      }
    });
    log(`round ${h.round}: forced a finish after 30 s`);
    roundT = Date.now();
  }
}
const final = await Promise.all(pages.map((p) => p.page.evaluate(() => ({ phase: window.game.pvp?.phase ?? window.game.mode, board: document.getElementById('pvp2-board')?.textContent ?? '' }))));
await shot('end');
log(`end: ${final.map((f) => f.phase).join(', ')}; rounds ${[...rounds].join(' ')}`);
if (!final.every((f) => f.phase === 'over' || f.phase === 'title')) fail(`the match never ended: ${final.map((f) => f.phase)}`);
if (rounds.size < 2) fail(`only ${rounds.size} round(s) played`);
if (!final.every((f) => /WINS|DRAW/.test(f.board))) log(`final boards: ${final.map((f) => f.board.slice(0, 40)).join(' | ')}`);
await done();
