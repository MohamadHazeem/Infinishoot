// npm run replay -- run.isr | --record out.isr [--seconds 30] | --balance [--update]
// Uses the real game in Chromium without the wall-clock animation loop.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

export function chromePath() {
  if (process.env.SHOT_CHROME) return process.env.SHOT_CHROME;
  for (const root of [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')]) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).filter(x => x.startsWith('chromium_headless_shell-')).sort().reverse()) {
      for (const sub of readdirSync(join(root, dir))) {
        const p = join(root, dir, sub, 'chrome-headless-shell'); if (existsSync(p)) return p;
      }
    }
  }
}
export async function harness({ angle = 'swiftshader' } = {}) {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' });
  await server.listen();
  let browser;
  try { browser = await chromium.launch({ executablePath: chromePath(), args: [`--use-angle=${angle}`, '--enable-unsafe-swiftshader'] }); }
  catch (e) { await server.close(); throw e; }
  const errors = [];
  return {
    async page(query = '', epoch = 1792454400000, timezoneId = 'UTC') {
      const page = await browser.newPage({ viewport: { width: 960, height: 540 }, locale: 'en-US', timezoneId });
      page.on('pageerror', e => errors.push(e.message));
      // No broker, score submission or remote assets in regression runs.
      await page.route('**/*', route => { const u = new URL(route.request().url()); return ['127.0.0.1', 'localhost'].includes(u.hostname) || u.protocol === 'data:' ? route.continue() : route.abort(); });
      await page.addInitScript(({ epoch }) => {
        const NativeDate = Date;
        class FixedDate extends NativeDate { constructor(...args) { super(...(args.length ? args : [epoch])); } static now() { return epoch; } }
        window.Date = FixedDate;
        let seed = 42;
        Math.random = () => { let t = seed = (seed + 0x6d2b79f5) >>> 0; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      }, { epoch });
      const params = new URLSearchParams(query.replace(/^\?/, ''));
      if (!params.has('season')) params.set('season', 'off');
      params.set('ci2', '');
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?${params}`);
      await page.waitForFunction(() => window.replay && window.botRun && window.renderer, null, { timeout: 90000 });
      await page.evaluate(() => document.fonts.ready);
      return page;
    },
    errors,
    async close() { await browser.close(); await server.close(); },
  };
}

export async function record(page, seconds = 30, host = false, prelude = false) {
  return page.evaluate(async ({ seconds, host, prelude }) => {
    const { settings } = await import('/src/game/settings.ts');
    Object.assign(settings, { tips: false, cinematics: 'off', bossIntros: false, finishers: false, deathReplay: false });
    const g = window.game;
    if (prelude) {
      for (let i = 0; i < 180; i++) { g.update(1 / 60); if (i % 10 === 0) g.render(1, 1 / 6); }
      g.startSolo(); g.closeShop(); window.botRun(5, true);
    }
    if (host) {
      g.role = 'host';
      g.host = { send() {}, broadcast() {}, close() {}, kick() {}, clientIds: ['replay-peer'], code: 'LOCAL' };
      const mate = g.makeHero(1, 'Replay mate', g.hero.unlocked, 'replay-peer');
      g.setHeroes([g.hero, mate]); g.runMode = 'standard'; g.startRun();
      g.onHostMessage('replay-peer', { t: 'ui', a: 'shop-done', i: 0 });
    } else g.startSolo();
    g.closeShop();
    let report;
    for (let i = 0; i < seconds; i++) {
      if (host) {
        g.onHostMessage('replay-peer', { t: 'i', x: Math.sin(i) * 4, z: Math.cos(i) * 4, vx: 0, vz: 0, ax: 1, az: 0, f: true, c: true });
        if (g.heroes[1].needsPick) g.onHostMessage('replay-peer', { t: 'ui', a: 'pick', i: 0 });
      }
      report = window.botRun(1, true);
    }
    return { replay: window.replay.export(), report };
  }, { seconds, host, prelude });
}

async function balance(h, update) {
  const kits = ['buster,charge,bomb', 'laser,well,meteor', 'scatter,grenade,blizzard', 'rail,shield,storm'];
  const actual = {};
  for (const kit of kits) {
    const p = await h.page('seed=4242');
    const result = await p.evaluate(async kit => {
      const { settings } = await import('/src/game/settings.ts');
      const { cheats } = await import('/src/game/game.ts');
      const { save } = await import('/src/game/save.ts');
      const { ACHIEVEMENTS } = await import('/src/data/meta.ts');
      save.achievements = ACHIEVEMENTS.map(a => a.id);
      const [primary, secondary, special] = kit.split(',');
      Object.assign(settings, { loadout: { primary, secondary, special }, mode: 'standard', difficulty: 'normal', hero: 'rookie', pet: 'none', tips: false, cinematics: 'off', bossIntros: false, finishers: false });
      cheats.unlockAll = true;
      window.game.startSolo(); window.game.closeShop();
      const stages = [];
      // Two full survival stages, with normal director clocks and bosses. Stop at stage 3.
      for (let n = 0; n < 100 && window.game.stage < 3; n++) {
        const before = window.game.stage;
        const r = window.botRun(10, true);
        if (window.game.stage !== before) stages.push({ stage: before, level: r.level, kills: r.kills, ranks: r.ranks, time: Math.round(window.game.runTime) });
      }
      return { stage: window.game.stage, stages, level: window.game.level, kills: window.game.kills, time: Math.round(window.game.runTime), actualKit: window.game.hero.loadoutPick };
    }, kit);
    actual[kit] = result; console.log(kit, JSON.stringify(result)); await p.close();
    if (result.stage < 3 || result.stages.length < 2) throw new Error(`${kit}: bot failed to finish two stages`);
    if (Object.values(result.actualKit).join(',') !== kit) throw new Error(`${kit}: loadout was substituted`);
  }
  const path = 'tests/visual/balance.json';
  if (update) { mkdirSync('tests/visual', { recursive: true }); writeFileSync(path, JSON.stringify({ tolerance: 0.25, runs: actual }, null, 2) + '\n'); return; }
  const baseline = JSON.parse(readFileSync(path, 'utf8'));
  const failures = [];
  for (const [kit, run] of Object.entries(actual)) for (let stage = 0; stage < 2; stage++) {
    for (const key of ['level', 'kills', 'ranks', 'time']) {
      const a = run.stages[stage][key], b = baseline.runs[kit]?.stages[stage]?.[key];
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > Math.max(key === 'kills' ? 30 : 3, b * baseline.tolerance)) failures.push(`${kit} stage ${stage + 1} ${key}: ${a} vs ${b}`);
    }
  }
  mkdirSync('shots', { recursive: true }); writeFileSync('shots/ci2-balance.json', JSON.stringify(actual, null, 2));
  if (failures.length) throw new Error('Balance regression:\n' + failures.join('\n'));
  console.log('Balance: four kits cleared two stages within 25% tolerance.');
}

async function main() {
  const args = process.argv.slice(2), h = await harness();
  try {
    if (args.includes('--balance')) await balance(h, args.includes('--update'));
    else if (args[0] === '--record') {
      if (!args[1]) throw new Error('Usage: npm run replay -- --record file.isr [--seconds 30]');
      const p = await h.page('seed=4242');
      const r = await record(p, Number(args[args.indexOf('--seconds') + 1]) || 30, args.includes('--host'), args.includes('--prelude'));
      mkdirSync(dirname(args[1]), { recursive: true });
      writeFileSync(args[1], gzipSync(JSON.stringify(r.replay))); console.log(JSON.stringify(r.report)); console.log(`Recorded ${r.replay.steps} steps to ${args[1]}`);
    } else {
      if (!args[0]) throw new Error('Usage: npm run replay -- file.isr');
      const bytes = readFileSync(args[0]);
      const r = JSON.parse((bytes[0] === 31 ? gunzipSync(bytes) : bytes).toString());
      const season = new URLSearchParams(r.header.query).get('season') ?? '';
      const p = await h.page(`seed=${r.header.seed}&season=${encodeURIComponent(season)}`, r.header.date, r.header.timezone || 'UTC');
      const result = await p.evaluate(r => { window.replay.play(r); return window.replay.run(); }, r);
      console.log(JSON.stringify(result));
      if (result.failed || !result.done) throw new Error(result.failed || 'Incomplete replay');
      console.log(`Replay matched: ${result.steps} steps.`);
    }
    if (h.errors.length) throw new Error(h.errors.join('\n'));
  } finally { await h.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(e => { console.error(e); process.exitCode = 1; });
