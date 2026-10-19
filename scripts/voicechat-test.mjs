// Voice chat test (voicechat lane): two headless game instances with Chromium's fake microphone (a beeping tone).
//   npm run voicechat [-- --out shots/voicechat]
// Page A hosts an online game, page B joins with the code; both have VOICE CHAT on with an open mic. The test
// checks that a WebRTC media call connects between them (audio bytes arrive on both sides, mesh: the host page
// relays nothing), that each page's speaking light for the other player turns on (lobby cards, then the in-run
// teammate list), that proximity gains are applied in the run, and that turning voice off hangs up on both.
// Screenshots go to shots/voicechat/. Signalling goes through PeerJS's public broker like the real game (needs
// internet); the media itself flows page to page on this machine. Fails on page errors.
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
const OUT = opt('--out', join('shots', 'voicechat'));
mkdirSync(OUT, { recursive: true });
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(5)}s]`, ...a);
const failures = [];
const fail = (msg) => {
  failures.push(msg);
  log('FAIL', msg);
};

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

const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const base = `http://127.0.0.1:${server.config.server.port ?? server.httpServer.address().port}/`;
const browser = await chromium.launch({
  headless: true,
  executablePath: findChrome(),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

async function openPage(name) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, permissions: ['microphone'] });
  // Voice chat on with an open mic at full sensitivity, before the game reads its settings.
  await ctx.addInitScript(() => {
    const k = 'infinishoot.settings.v1';
    localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) ?? '{}'), voiceChat: true, voiceMode: 'open', voiceSensitivity: 1, graphics: 0, tips: false, cinematics: 'off', bossIntros: false }));
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack ?? '').split('\n').slice(1, 4).join('\n')}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|Failed to load resource|AudioContext was not allowed|WebGL: INVALID_OPERATION|GPU stall/i.test(t)) return;
    errors.push(t);
  });
  await page.goto(base + '?season=off', { timeout: 300000 });
  await page.waitForFunction(() => window.game && window.game.mode === 'title', null, { timeout: 300000 });
  await page.evaluate(async () => (window.__voice = (await import('/src/net/voice.ts')).voice)); // sync handle for waitForFunction
  return { name, page, errors };
}

async function done() {
  for (const p of [A, B]) for (const e of p?.errors ?? []) fail(`${p.name} page error: ${e}`);
  await browser.close();
  await server.close();
  console.log(failures.length ? `\nvoicechat test FAILED (${failures.length})` : '\nvoicechat test passed');
  process.exit(failures.length ? 1 : 0);
}

const voiceState = (page) =>
  page.evaluate(async () => {
    const { voice } = await import('/src/net/voice.ts');
    return voice.debug();
  });

let A, B;
try {
  A = await openPage('host');
  B = await openPage('client');
  log('pages loaded');
  for (const p of [A, B]) {
    // Headless Chromium parks a getUserMedia made during page load until the page asks again (a real browser shows
    // its permission prompt instead): ask once from the test, and release that extra stream.
    await p.page.bringToFront();
    await p.page.evaluate(async () => (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop())).catch(() => {});
    await p.page.waitForFunction(() => window.__voice.status === 'on', null, { timeout: 20000 }).catch(() => {});
    const s = await voiceState(p.page);
    if (s.status !== 'on') fail(`${p.name}: fake mic did not open (status ${s.status})`);
  }
  await A.page.evaluate(() => void window.game.hostGame('HOSTVOX'));
  const hostOk = await A.page.evaluate(async () => {
    for (let i = 0; i < 100 && !window.game.host; i++) await new Promise((r) => setTimeout(r, 100));
    try {
      await window.game.host.ready;
      return true;
    } catch (e) {
      return String(e?.type ?? e);
    }
  });
  if (hostOk !== true) {
    fail(`host could not register with the signalling server: ${hostOk}`);
    await done();
  }
  const code = await A.page.evaluate(() => window.game.host.code);
  log(`hosting, code ${code}`);
  await B.page.evaluate((c) => void window.game.joinGame('CLIENTVOX', c), code);
  await A.page.waitForFunction(() => window.game.lobby.length === 2, null, { timeout: 30000 }).catch(() => fail('client never joined the lobby'));
  log('client in lobby');

  // The call: both sides see one remote with a stream, and audio bytes arriving.
  for (const p of [A, B]) {
    const ok = await p.page
      .waitForFunction(() => {
        const d = window.__voice.debug();
        return d.remotes.length === 1 && d.remotes[0].stream && d.remotes[0].bytes > 2000;
      }, null, { timeout: 30000, polling: 250 })
      .then(() => true)
      .catch(() => false);
    const s = await voiceState(p.page);
    if (!ok) fail(`${p.name}: no voice audio arrived: ${JSON.stringify(s.remotes)} roster ${JSON.stringify(s.roster)}`);
    else log(`${p.name}: call up, ${s.remotes[0].bytes} audio bytes received, roster ${s.roster.map((r) => `${r.name}:${r.on ? 'on' : 'off'}`).join(' ')}`);
  }
  // Mesh: the host page has exactly one call, to the client (it carries nobody else's audio).
  const hostPeers = (await voiceState(A.page)).remotes.map((r) => r.id);
  const clientId = await B.page.evaluate(() => window.game.client.voicePeer.id);
  if (hostPeers.length !== 1 || hostPeers[0] !== clientId) fail(`host calls ${JSON.stringify(hostPeers)}, expected only ${clientId}`);

  // Speaking lights on the lobby cards: the other player's card (B sees the host at 0, A sees the client at 1).
  const lit = async (p, sel) =>
    p.page
      .waitForFunction((s) => !!document.querySelector(s), sel, { timeout: 20000, polling: 50 })
      .then(() => true)
      .catch(() => false);
  if (!(await lit(B, '#scr-online .lobby .players > .lobby-player:nth-child(1) > .vc-ico[data-s="talk"]'))) fail('client: host card never lit as talking');
  else log('client: host card lit (talking)');
  if (!(await lit(A, '#scr-online .lobby .players > .lobby-player:nth-child(2) > .vc-ico[data-s="talk"]'))) fail('host: client card never lit as talking');
  else log('host: client card lit (talking)');
  await B.page.screenshot({ path: join(OUT, 'lobby-client.png') });
  await A.page.screenshot({ path: join(OUT, 'lobby-host.png') });

  // The run: teammate list and name tag light up; gains follow distance.
  await A.page.evaluate(() => {
    window.cheats.god = true;
    window.game.hostStart();
  });
  await B.page.waitForFunction(() => window.game.role === 'client' && window.game.mode !== 'title' && window.game.heroes.length === 2, null, { timeout: 90000 }).catch(() => fail('client never started the run'));
  // Close any opening shop / level-up so the HUD shows.
  for (const p of [A, B]) await p.page.evaluate(() => window.game.screens.current !== 'none' && window.game.screens.show('none')).catch(() => {});
  if (!(await lit(B, '#team > .mate > .vc-ico[data-s="talk"]'))) fail('client: teammate row never lit as talking in the run');
  else log('client: teammate row lit (talking)');
  const s = await voiceState(B.page);
  const dist = await B.page.evaluate(() => Math.hypot(window.game.heroes[0].player.x - window.game.heroes[1].player.x, window.game.heroes[0].player.z - window.game.heroes[1].player.z));
  const expect = await B.page.evaluate(async (d) => {
    const { proximityGain } = await import('/src/net/voice.ts');
    const { audioSettings } = await import('/src/audio/sfx.ts');
    const { settings } = await import('/src/game/settings.ts');
    return proximityGain(d) * settings.voiceChatVolume * (audioSettings.muted ? 0 : audioSettings.volume);
  }, dist);
  const g = s.remotes[0]?.gain ?? -1;
  if (s.roster.some((r) => r.hero < 0)) fail(`run roster has no hero indexes: ${JSON.stringify(s.roster)}`);
  if (Math.abs(g - expect) > 0.05 + expect * 0.2) fail(`client gain ${g.toFixed(3)} far from proximity ${expect.toFixed(3)} at ${dist.toFixed(1)} m`);
  else log(`client: gain ${g.toFixed(3)} at ${dist.toFixed(1)} m (proximity ${expect.toFixed(3)}), pan ${s.remotes[0].pan.toFixed(2)}`);
  await B.page.waitForTimeout(500);
  await B.page.screenshot({ path: join(OUT, 'run-client.png') });

  // Voice off on the client: both sides hang up.
  await B.page.evaluate(async () => {
    const { settings, saveSettings } = await import('/src/game/settings.ts');
    settings.voiceChat = false;
    saveSettings();
  });
  const hung = await A.page
    .waitForFunction(() => window.__voice.debug().remotes.length === 0, null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!hung) fail('host kept the call after the client turned voice off');
  else log('client turned voice off: host hung up');
} catch (e) {
  fail(`test crashed: ${e?.stack ?? e}`);
}
await done();
