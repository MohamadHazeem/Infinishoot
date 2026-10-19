// Online co-op test with two real game instances in headless Chromium.
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
// COOP_TRACE=1 prints the client hero's position trail on both pages when they disagree.
// Lobby lane: page B joins through the invite link (?join=CODE), the two chat
// (filtered, quick chat), pings and player cards show on both, and the run
// starts by READY-UP (both ready, countdown). After the run: game over, the
// PARTY screen, a unanimous RESTART vote, a second game over, BACK TO LOBBY
// (still connected), then the host KICKs the client.
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
const SECS = Number(opt('--secs', '80'));
const OUT = opt('--out', join('shots', 'coop'));
const [W, H] = opt('--size', '960x540').split('x').map(Number);
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

const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const base = `http://127.0.0.1:${server.config.server.port ?? server.httpServer.address().port}/`;
const browser = await chromium.launch({
  headless: true,
  executablePath: findChrome(),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

async function openPage(name) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack ?? '').split('\n').slice(1, 4).join('\n')}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Chromium's own noise, not the game's.
    if (/favicon|Failed to load resource|AudioContext was not allowed|WebGL: INVALID_OPERATION|GPU stall/i.test(t)) return;
    errors.push(t);
  });
  await page.goto(base, { timeout: 300000 }); // generous: a busy build machine serves the dev bundle slowly
  await page.waitForFunction(() => window.game && window.botAuto && window.game.mode === 'title', null, { timeout: 300000 });
  return { name, page, errors };
}

const A = await openPage('host');
const B = await openPage('client');
log('pages loaded');

// ---------------------------------------------------------------- lobby
// Pets: Sparky for the host, Bit for the client (companion lane checks pet levels and team moves).
await Promise.all(
  [
    [A, 'sparky'],
    [B, 'bit'],
  ].map(([p, pet]) =>
    p.page.evaluate(async (pet) => {
      const { settings, saveSettings } = await import('/src/game/settings.ts');
      settings.pet = pet;
      saveSettings(); // kept through the client's reload (it joins by the invite link)
      window.game.applyLocalSkin(); // what the wardrobe does: the title hero gets the pet
    }, pet),
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
await B.page.waitForFunction(() => window.game.role === 'client' && window.game.mode !== 'title' && window.game.heroes.length === 2, null, { timeout: 15000 }).catch(() => fail('client never started the run'));
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
          if (c.n % 4 === 0) for (const k of ['ev', 'b', 'fx', 'en', 'bu', 'pk', 'heroes', 'sk', 'ar', 'bx', 'you']) if (r[k] !== undefined) c.parts[k] = (c.parts[k] ?? 0) + size(r[k]) * 4;
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
      check(`pos${e.uid}`, Math.hypot(m.x - e.x, m.z - e.z) < 3 && m.id === e.id, `enemy ${e.uid} (${e.id}) host ${e.x.toFixed(1)},${e.z.toFixed(1)} vs client ${m.id} ${m.x.toFixed(1)},${m.z.toFixed(1)}`);
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
    check(`pos${i}`, !fighting || Math.hypot(a.x - b.x, a.z - b.z) < 3, `hero ${i} position host ${a.x.toFixed(1)},${a.z.toFixed(1)} vs client ${b.x.toFixed(1)},${b.z.toFixed(1)}`);
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
  await Promise.all([A, B].map((p) => p.page.screenshot({ path: join(OUT, `${tag}-${p.name}.png`) })));
  log(`screenshots ${tag}`);
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
    g.toys.jumps[g.local] = null; // not mid-flight from an earlier pad
    p.teleport(best.x, best.z);
    setTimeout(() => window.botAuto(true), kind === 'pad' ? 1200 : 3000);
    return [best.x, best.z];
  }, kind);
const SCENARIO = [
  [8, 'new enemy types, an elite and the Goldbug near the client', () =>
    host(async () => {
      const g = window.game;
      const { ENEMIES } = await import('/src/data/enemies.ts');
      const c = g.heroes[1].player;
      const ids = ['shielder', 'medic', 'leaper', 'mortar', 'charger', 'sniper', 'splitter'];
      let k = 0;
      for (const id of ids)
        for (let i = 0; i < 2; i++, k++) {
          const a = (k / 14) * Math.PI * 2;
          g.enemies.spawn(ENEMIES[id], c.x + Math.cos(a) * 9, c.z + Math.sin(a) * 9, g.spawnOpts());
        }
      g.debugSpawnElite('charger', 'shielded');
      g.spawnEnemy(ENEMIES.golden);
      return k;
    })],
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
    const at = await clientTo('pad');
    if (!at) return 'no pads on this arena';
    await pause(400);
    const [h, c] = await Promise.all([host(() => window.__jumps), client(() => !!window.game.toys.jumps[window.game.local])]);
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
    await pause(600);
    const c = await client((i) => window.game.toys.props[i] && { alive: window.game.toys.props[i].alive, fallT: window.game.toys.props[i].fallT }, i);
    if (!c || c.alive || c.fallT < 0) fail(`pillar ${i} toppled on the host, client sees ${JSON.stringify(c)}`);
    return c;
  }],
  [18, 'ultimates charged for both heroes', () => host(() => window.game.heroes.forEach((h) => (h.skill.ult = 1)))],
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
    for (let k = 0; k < 15 && !(h1 && c1); k++) {
      await pause(100);
      [h1, c1] = await Promise.all([host(() => window.game.heroes[1].player.dead), client(() => window.game.hero.player.dead)]);
    }
    await host(() => window.game.reviveHero(window.game.heroes[1], 0.5));
    await pause(1500);
    const [h2, c2] = await Promise.all([host(() => window.game.heroes[1].player.dead), client(async () => {
      // Visible at some point (it blinks while the revive i-frames run).
      let seen = false;
      for (let k = 0; k < 12 && !seen; k++, await new Promise((r) => setTimeout(r, 40))) seen = window.game.hero.player.rig.root.visible;
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
    await pause(1200);
    const c = await client(() => {
      const w = window.game.hero.weapons.find((x) => x.def.id === 'storm_drones');
      return w ? { parts: w.parts.map((p) => p.def.id), drones: w.parts[0].net().length, merge: !!document.querySelector('.fusion-merge') } : null;
    });
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
    await pause(600);
    const [h, c] = await Promise.all([
      host(() => window.game.heroes.map((h) => [h.pet, h.petState.level, h.petState.reviveUsed])),
      client(() => window.game.heroes.map((h) => [h.pet, h.petState.level, h.petState.reviveUsed])),
    ]);
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
    });
    let r = null;
    for (let k = 0; k < 12 && !r?.host; k++) {
      await pause(150);
      await client(() => window.game.client.send({ t: 'team' }));
      await pause(150);
      r = { host: await host(() => window.game.companionState().move?.id ?? null) };
    }
    await pause(200);
    r.client = await client(() => window.game.companionState().move?.id ?? null);
    r.hostMeter = await host(() => window.game.companionState().meter.charge);
    if (!r.host || r.client !== r.host || r.hostMeter !== 0) fail(`team move: host ${r.host} (meter ${r.hostMeter}), client ${r.client}`);
    await shot('teammove');
    return r;
  }],
  // Finisher lane: a client ping pops the client's portrait in on both screens; the boss finisher plays on both.
  [46, 'client pings: its portrait pops in on both machines', async () => {
    await client(() => {
      const p = window.game.hero.player;
      window.game.client.send({ t: 'ping', x: p.x + 3, z: p.z });
    });
    await pause(700);
    const showing = () => import('/src/ui/portraits.ts').then((m) => m.portraits.showing('hero:1'));
    const [h, c] = await Promise.all([host(showing), client(showing)]);
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
    await pause(700);
    const on = () => !!document.getElementById('finisher') && !document.getElementById('finisher').hidden;
    const [h1, c1, held] = await Promise.all([host(on), client(on), host(() => !!window.game.boss?.active)]);
    await pause(2600);
    const [h2, c2, gone] = await Promise.all([host(on), client(on), host(() => !window.game.boss || !window.game.boss.active)]);
    if (!h1 || !c1 || !held || h2 || c2 || !gone) fail(`finisher: playing host ${h1} client ${c1}, boss held ${held}; after: host ${h2} client ${c2}, boss gone ${gone}`);
    return { boss: id, playing: [h1, c1], held, after: [h2, c2], gone };
  }],
];

SCENARIO.sort((a, b) => a[0] - b[0]);
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
  if (!(await click(A, '#scr-online [data-act=lob-kick]'))) fail('kick: no KICK button');
  const out = await until(B, () => window.game.role === 'solo' && window.game.screens.current === 'title' && (document.querySelector('#toast')?.textContent ?? '').includes('REMOVED'), null, 5000);
  const hostOne = await until(A, () => window.game.lobby.length === 1, null, 3000);
  if (!out || !hostOne) fail(`kick: client out ${out}, host lobby down to 1 ${hostOne}`);
  log(`party: rows ok ${!!rows}, restart ok ${!!again}, back to lobby ${lobbyA && !!lobbyB}, kick ${!!out && !!hostOne}`);
}

async function done() {
  try {
    const [ha, cb] = await Promise.all([A.page.evaluate(() => window.__coop), B.page.evaluate(() => window.__coop)]);
    log(`skill events sent to the client: ${JSON.stringify(ha?.skill)}; received: ${JSON.stringify(cb?.skill)}`);
    log(`effects received by the client: ${JSON.stringify(cb?.vfx)}`);
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
