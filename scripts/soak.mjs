// Soak test: one long god-mode bot run in headless Chromium through many stages and loops,
// sampling memory and speed every --sample seconds and flagging leaks (steady growth) and slowdowns.
//   npm run soak -- --minutes 30
// Options: --minutes <wall minutes> (30), --sample <s between samples> (30), --ff <game seconds
// fast-forwarded with botRun per sample> (90; the rest of each sample the live loop renders with
// botAuto), --link <test link> (?test&god&hero=rookie), --out <json> (shots/soak/report.json),
// --churn (a fresh run every sample: per-run teardown leaks).
// Each sample (after a forced GC): JS heap, DOM nodes, event listeners (CDP Memory.getDOMCounters),
// live timers, scene objects, GPU geometries/textures/programs, enemies/bullets, the size of every
// collection on `game` and its systems (one level down), frame time (rAF) and sim time per step.
// Exits 1 if anything was flagged.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CHROME_ARGS, findChrome, root, serveDevBundle } from './fuzz/browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i < 0 ? d : args[i + 1];
};
const minutes = Number(opt('--minutes', '30'));
const sampleS = Number(opt('--sample', '30'));
const ff = Number(opt('--ff', '90'));
const link = opt('--link', '?test&god&hero=rookie');
// --churn: quit to the title and start a fresh run every sample, to catch per-run leaks (teardown).
const churn = args.includes('--churn');
const out = opt('--out', join(root, 'shots', 'soak', 'report.json'));
mkdirSync(dirname(out), { recursive: true });

const server = await serveDevBundle('web-soak');
const browser = await chromium.launch({ headless: true, executablePath: findChrome(), args: [...CHROME_ARGS, '--js-flags=--expose-gc'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  // Live timers and frame times, for the samples.
  const iv = new Set();
  const to = new Set();
  const si = window.setInterval.bind(window);
  const ci = window.clearInterval.bind(window);
  const st = window.setTimeout.bind(window);
  const ct = window.clearTimeout.bind(window);
  window.setInterval = (fn, ms, ...a) => {
    const id = si(fn, ms, ...a);
    iv.add(id);
    return id;
  };
  window.clearInterval = (id) => (iv.delete(id), ci(id));
  window.setTimeout = (fn, ms, ...a) => {
    const id = st((...b) => (to.delete(id), typeof fn === 'function' ? fn(...b) : undefined), ms, ...a);
    to.add(id);
    return id;
  };
  window.clearTimeout = (id) => (to.delete(id), ct(id));
  const frames = [];
  let last = 0;
  const raf = (t) => {
    if (last) frames.push(t - last);
    if (frames.length > 4000) frames.splice(0, 2000);
    last = t;
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  window.__soak = { iv, to, frames };
  window.addEventListener('unhandledrejection', (e) => console.error('unhandledrejection: ' + (e.reason?.stack ?? e.reason)));
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
page.on('console', (m) => m.type() === 'error' && !/net::ERR_|Failed to load resource/.test(m.text()) && errors.push(m.text()));
const cdp = await ctx.newCDPSession(page);
await cdp.send('HeapProfiler.enable');
await page.goto(server.base + link, { waitUntil: 'commit' });
await page.waitForFunction(() => typeof window.botAuto === 'function', null, { timeout: 120000, polling: 250 });
await page.evaluate(() => window.botAuto(true));

/** In-page numbers. `sim` is the botRun report of the fast-forward that just ran. */
const measure = () =>
  page.evaluate(() => {
    const g = window.game;
    const r = window.renderer?.gl;
    let objects = 0;
    g.scene.traverse(() => objects++);
    const sizeOf = (v) => (Array.isArray(v) ? v.length : v instanceof Map || v instanceof Set ? v.size : -1);
    const cols = {};
    const seen = new Set();
    const walk = (o, path, depth) => {
      if (!o || typeof o !== 'object' || seen.has(o) || o instanceof Node || o.isObject3D || o.isMaterial || o.isBufferGeometry || ArrayBuffer.isView(o)) return;
      seen.add(o);
      for (const k of Object.keys(o)) {
        let v;
        try {
          v = o[k];
        } catch {
          continue;
        }
        const n = sizeOf(v);
        if (n >= 0) cols[path + k] = n;
        else if (depth > 0 && v && typeof v === 'object') walk(v, path + k + '.', depth - 1);
      }
    };
    walk(g, '', 2);
    const f = window.__soak.frames.splice(0);
    f.sort((a, b) => a - b);
    const p = g.hero.player;
    const diag = { hero: [+p.x.toFixed(1), +p.z.toFixed(1)], dead: p.dead, portal: g.portal.active ? [+g.portal.x.toFixed(1), +g.portal.z.toFixed(1)] : null, screen: g.screens.current, paused: g.paused, modeT: +g.modeT.toFixed(1), biome: g.arena?.biome?.key ?? g.arena?.biome?.id ?? '' };
    return {
      diag,
      mode: g.mode,
      stage: g.stage,
      level: g.level,
      runTime: Math.round(g.runTime),
      enemies: g.enemies.activeCount,
      bullets: g.bullets.count,
      objects,
      geometries: r?.info.memory.geometries ?? -1,
      textures: r?.info.memory.textures ?? -1,
      programs: r?.info.programs?.length ?? -1,
      intervals: window.__soak.iv.size,
      timeouts: window.__soak.to.size,
      frameMs: f.length ? +(f.reduce((a, b) => a + b, 0) / f.length).toFixed(2) : -1,
      frameP95: f.length ? +f[Math.floor(f.length * 0.95)].toFixed(1) : -1,
      cols,
    };
  });

const samples = [];
const t0 = Date.now();
let restarts = 0;
let lastStage = 0;
while (Date.now() - t0 < minutes * 60000) {
  const ts = Date.now();
  if (churn) {
    await page.evaluate(() => {
      const g = window.game;
      g.leaveToTitle();
      g.startSolo();
      if (g.mode === 'shop') g.closeShop();
    });
  }
  // Fast-forward (simulation only), then let the live loop render with the bot for the rest of the sample.
  const sim = await page.evaluate((s) => {
    const r = window.botRun(s, true);
    window.cheats.god = true; // the live loop between fast-forwards plays in god mode too
    window.botAuto(true);
    return { avgMs: Number(r.avgMs), worstMs: Number(r.worstMs), mode: r.mode };
  }, ff);
  const g = await page.evaluate(() => window.game.mode);
  if (g === 'title' || g === 'dead') {
    restarts++;
    await page.evaluate(() => {
      window.game.startSolo();
      if (window.game.mode === 'shop') window.game.closeShop();
    });
  }
  await page.waitForTimeout(Math.max(1000, sampleS * 1000 - (Date.now() - ts)));
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters');
  const m = await measure();
  const s = { t: Math.round((Date.now() - t0) / 1000), heapMB: +(heap.usedSize / 1048576).toFixed(1), nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents, simMs: sim.avgMs, simWorst: sim.worstMs, ...m };
  samples.push(s);
  if (s.stage !== lastStage) lastStage = s.stage;
  console.log(`t=${s.t}s st${s.stage} ${s.mode} lv${s.level} run ${s.runTime}s | heap ${s.heapMB} MB, nodes ${s.nodes}, listeners ${s.listeners}, timers ${s.intervals}/${s.timeouts}, objects ${s.objects}, geo ${s.geometries}, tex ${s.textures}, prog ${s.programs} | frame ${s.frameMs} ms (p95 ${s.frameP95}), sim ${s.simMs} ms/step | enemies ${s.enemies}${errors.length ? ` | ${errors.length} errors` : ''}`);
}
await browser.close();
await server.close();

// ---- analysis: steady growth after a warm-up ----
const warm = Math.min(3, Math.floor(samples.length / 4));
const body = samples.slice(warm);
const third = Math.max(1, Math.floor(body.length / 3));
const median = (a) => {
  const b = [...a].sort((x, y) => x - y);
  return b.length ? b[Math.floor(b.length / 2)] : 0;
};
/** Linear fit: slope per sample and R². */
const fit = (ys) => {
  const n = ys.length;
  const xm = (n - 1) / 2;
  const ym = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  ys.forEach((y, x) => ((sxy += (x - xm) * (y - ym)), (sxx += (x - xm) ** 2), (syy += (y - ym) ** 2)));
  const slope = sxx ? sxy / sxx : 0;
  return { slope, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0 };
};
// Absolute growth that counts (below it, noise): per metric, collections default to 50 entries.
// These counters have big baselines (7000+ listeners), so they are judged on absolute growth alone;
// collections also need 20% growth. Nodes: owned relics add chips to two screens (~300 nodes for all 24).
const MIN = { heapMB: 8, nodes: 500, listeners: 30, documents: 1, intervals: 5, timeouts: 50, objects: 300, geometries: 60, textures: 20, programs: 10 };
const series = {};
for (const k of Object.keys(MIN)) series[k] = body.map((s) => s[k]);
const colKeys = new Set(body.flatMap((s) => Object.keys(s.cols)));
for (const k of colKeys) series['game.' + k] = body.map((s) => s.cols[k] ?? 0);
const flags = [];
// Pools keep their high-water mark (a bigger horde later grows them once), and the spatial hash keeps a bucket
// per cell ever touched (at most the arena's ~3000 cells); not leaks.
const POOLS = /^game\.(enemies\.(list|free|corpses)|specialApi\.enemies|toys\.sink|bullets\.|particles\.|pickups\.list|hash\.buckets)/;
for (const k of Object.keys(series)) if (POOLS.test(k)) delete series[k];
// Stalls: the run sits in a between-fights mode (portal, shop...) for 4+ samples in a row.
for (let i = 3; i < samples.length; i++) {
  const w = samples.slice(i - 3, i + 1);
  if (w.every((x) => x.mode === w[0].mode && x.stage === w[0].stage) && w[0].mode !== 'fight' && !flags.some((f) => f.kind === 'stall' && f.stage === w[0].stage)) flags.push({ kind: 'stall', metric: w[0].mode, stage: w[0].stage, first: w[0].t, last: w[3].t, diag: w[3].diag });
}
if (body.length >= 6) {
  for (const [k, ys] of Object.entries(series)) {
    const a = median(ys.slice(0, third));
    const b = median(ys.slice(-third));
    const { slope, r2 } = fit(ys);
    const min = MIN[k] ?? 50;
    if (b - a > min && (k in MIN || b > a * 1.2) && slope > 0 && r2 > 0.6) flags.push({ kind: 'leak', metric: k, first: a, last: b, perSample: +slope.toFixed(2), r2: +r2.toFixed(2) });
  }
  for (const k of ['frameMs', 'simMs']) {
    const ys = body.map((s) => s[k]).filter((v) => v > 0);
    const a = median(ys.slice(0, third));
    const b = median(ys.slice(-third));
    if (a > 0 && b > a * 1.5 && b - a > 1) flags.push({ kind: 'slowdown', metric: k, first: a, last: b });
  }
}
const first = body[0] ?? samples[0];
const last = samples[samples.length - 1];
const report = { link, minutes, samples: samples.length, restarts, stages: last?.stage, runTime: last?.runTime, errors: errors.slice(0, 20), flags, first, last, all: samples };
writeFileSync(out, JSON.stringify(report, null, 2));
const pick = (s) => s && `heap ${s.heapMB} MB, nodes ${s.nodes}, listeners ${s.listeners}, timers ${s.intervals}/${s.timeouts}, objects ${s.objects}, geo ${s.geometries}, tex ${s.textures}, frame ${s.frameMs} ms, sim ${s.simMs} ms`;
console.log(`\nsoak: ${samples.length} samples over ${minutes} min, reached stage ${last?.stage} (run ${last?.runTime}s), ${restarts} restarts, ${errors.length} page errors (report: ${out})`);
console.log(`  first (after warm-up): ${pick(first)}\n  last:                  ${pick(last)}`);
for (const f of flags) console.log(`  ${f.kind.toUpperCase()}: ${f.metric} ${f.first} -> ${f.last}${f.perSample !== undefined ? ` (+${f.perSample}/sample, r2 ${f.r2})` : ''}${f.diag ? ' ' + JSON.stringify(f.diag) : ''}`);
for (const e of errors.slice(0, 5)) console.log('  ERROR ' + e.split('\n').slice(0, 3).join(' | '));
if (!flags.length && !errors.length) console.log('  no leaks or slowdowns flagged');
process.exit(flags.length || errors.length ? 1 : 0);
