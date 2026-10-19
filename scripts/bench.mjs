// Repeatable performance benchmark in headless Chromium.
//   npm run bench                         heavy scene, HIGH quality, 20 s, production build
//   npm run bench -- --quality low        pin another quality (low|medium|high|auto)
//   npm run bench -- --scene magma        another preset (see SCENES), or --link "?test&..."
//   npm run bench -- --seconds 30 --warmup 5 --dev --json out.json --size 1280x720
// Builds the game (vite build to dist/, skipped with --dev, which uses the dev server),
// opens a test link with `&bench` (src/dev/testLinks.ts turns on src/core/prof.ts),
// waits out the warm-up, then records every frame: simulation (all fixed steps in the
// frame), game.render, renderer.render (GL submit), frame interval, draw calls and
// triangles, plus per-phase timers, JS heap and GC pauses (Chrome trace).
// Headless Chromium uses SwiftShader (software GL), so frame intervals are
// GPU-bound and pessimistic; the CPU columns are the ones to compare.
import { chromium } from 'playwright-core';
import { build, createServer, preview } from 'vite';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  if (i < 0) return d;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const flag = (k) => {
  const i = args.indexOf(k);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};

const WEAPONS = 'weapons=drones:6,missiles:6,lightning:6,fire:6';
const BASE = `?test&bench&seed=42&god&circle&aim=0.7,0.7&${WEAPONS}`;
/** Heavy presets. heavy: stage-5 numbers in the meadow (grass tufts, rain; pinned, since stage 5 is the Toy Factory now); stage 4 is magma (lava lights, heat). */
const SCENES = {
  heavy: `${BASE}&stage=5&biome=meadow&night&rain&boom&swarm=200&hold=170,24:spinner,12:burster&bullets=500`,
  factory: `${BASE}&stage=5&night&boom&swarm=200&hold=170,24:spinner,12:burster&bullets=500`,
  skyruins: `${BASE}&stage=6&night&boom&swarm=200&hold=170,24:spinner,12:burster&bullets=500`,
  magma: `${BASE}&stage=4&night&boom&swarm=200&hold=170,24:spinner,12:burster&bullets=500`,
  light: `${BASE}&stage=1&day&dry`,
};
const seconds = Number(opt('--seconds', '20'));
const warmup = Number(opt('--warmup', '4'));
const quality = opt('--quality', 'high');
const scene = opt('--scene', 'heavy');
const [w, h] = opt('--size', '1280x720').split('x').map(Number);
const jsonOut = opt('--json', null);
const dev = flag('--dev');
const link = `${opt('--link', SCENES[scene] ?? SCENES.heavy)}&quality=${quality}`;

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

// Cross-origin isolation gives performance.now() 5 us resolution instead of 100 us.
const ISOLATE = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
let server;
let base;
if (dev) {
  server = await createServer({ server: { port: 0, host: '127.0.0.1', headers: ISOLATE }, logLevel: 'error' });
  await server.listen();
  base = `http://127.0.0.1:${server.httpServer.address().port}/`;
} else {
  await build({ logLevel: 'error' });
  server = await preview({ preview: { port: 0, host: '127.0.0.1', headers: ISOLATE }, logLevel: 'error' });
  base = `http://127.0.0.1:${server.httpServer.address().port}/`;
}

const browser = await chromium.launch({
  headless: true,
  executablePath: findChrome(),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(base + link);
await page.waitForFunction(() => !!window.__prof, null, { timeout: 30000 });
await page.waitForTimeout(warmup * 1000);

// Reset the timers and start a heap sampler + entity counter in the page.
await page.evaluate(() => {
  window.__profReset();
  const g = window.__game;
  const s = (window.__benchSamples = { heap: [], enemies: [], bullets: [], particles: [] });
  window.__benchTimer = setInterval(() => {
    s.heap.push(performance.memory?.usedJSHeapSize ?? 0);
    s.enemies.push(g.enemies.activeCount);
    s.bullets.push(g.bullets.count);
    s.particles.push(g.particles.alive ?? 0);
  }, 100);
});
await browser.startTracing(page, { categories: ['devtools.timeline', 'v8', 'disabled-by-default-v8.gc'] });
await page.waitForTimeout(seconds * 1000);
const trace = JSON.parse((await browser.stopTracing()).toString());
const res = await page.evaluate(() => {
  clearInterval(window.__benchTimer);
  const p = window.__prof;
  const q = window.__quality;
  return { frames: p.frames, phase: p.phase, samples: window.__benchSamples, isolated: window.crossOriginIsolated, quality: q ? `${q.name}${q.auto ? ' (auto)' : ''} ${q.resolution}p, ${q.lights} lights, outlines ${q.outlines ? 'on' : 'off'}` : 'n/a' };
});
await browser.close();
await server.close?.();
if (server.httpServer) server.httpServer.close();

// --- Stats ---
const col = (i) => res.frames.map((f) => f[i]);
const stat = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const avg = s.reduce((x, y) => x + y, 0) / Math.max(1, s.length);
  return { avg, p95: s[Math.floor(s.length * 0.95)] ?? 0, worst: s[s.length - 1] ?? 0 };
};
const upd = col(0);
const ren = col(1);
const gl = col(2);
const cpu = res.frames.map((f) => f[0] + f[1] + f[2]);
const interval = col(3);
const steps = col(4).reduce((a, b) => a + b, 0);
const frames = res.frames.length;
const calls = stat(col(5));
const tris = stat(col(6));

// GC pauses from the trace (renderer main thread).
const gcEvents = trace.traceEvents.filter((e) => (e.name === 'MinorGC' || e.name === 'MajorGC') && e.ph === 'X');
const gcMs = (n) => gcEvents.filter((e) => e.name === n).reduce((a, e) => a + e.dur / 1000, 0);
const gcWorst = gcEvents.reduce((a, e) => Math.max(a, e.dur / 1000), 0);
// Browser work outside our timers: style recalc + layout (DOM HUD), paint, on the renderer main thread.
const mainTid = (() => {
  const t = trace.traceEvents.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  return t ? `${t.pid}:${t.tid}` : null;
})();
const onMain = (e) => !mainTid || `${e.pid}:${e.tid}` === mainTid;
const sumDur = (names) => trace.traceEvents.filter((e) => e.ph === 'X' && names.includes(e.name) && onMain(e)).reduce((a, e) => a + e.dur / 1000, 0);
const styleMs = sumDur(['UpdateLayoutTree', 'Layout']);
const paintMs = sumDur(['Paint', 'PrePaint', 'Layerize', 'UpdateLayer']);
const heap = res.samples.heap.filter((x) => x > 0);
let alloc = 0;
for (let i = 1; i < heap.length; i++) if (heap[i] > heap[i - 1]) alloc += heap[i] - heap[i - 1];
const mb = (b) => (b / 1048576).toFixed(1);
const ent = (a) => `${Math.round(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length))} avg / ${Math.max(0, ...a)} max`;

const fmt = (s) => `${s.avg.toFixed(2).padStart(6)} ${s.p95.toFixed(2).padStart(6)} ${s.worst.toFixed(2).padStart(7)}`;
const out = [];
out.push(`link     ${link}`);
out.push(`build    ${dev ? 'dev server' : 'production'}  ${w}x${h}  ${seconds}s after ${warmup}s warm-up`);
out.push(`quality  ${res.quality} (at the end)`);
out.push(`isolated ${res.isolated ? 'yes (5 us timers)' : 'no (100 us timers)'}`);
out.push(`frames   ${frames} rendered (${(frames / seconds).toFixed(1)} fps, SwiftShader), ${steps} sim steps (${(steps / seconds).toFixed(1)}/s)`);
out.push('');
out.push('ms per frame              avg    p95   worst');
out.push(`simulation (all steps) ${fmt(stat(upd))}`);
out.push(`  per sim step         ${(upd.reduce((a, b) => a + b, 0) / Math.max(1, steps)).toFixed(2).padStart(6)}`);
out.push(`game.render            ${fmt(stat(ren))}`);
out.push(`renderer.render (GL)   ${fmt(stat(gl))}`);
out.push(`total CPU              ${fmt(stat(cpu))}`);
out.push(`CPU at 1 step/frame    ${(upd.reduce((a, b) => a + b, 0) / Math.max(1, steps) + stat(ren).avg + stat(gl).avg).toFixed(2).padStart(6)}   (sim per step + render + GL: a 60 fps frame)`);
out.push(`frame interval         ${fmt(stat(interval))}`);
out.push(`style+layout (DOM)     ${(styleMs / Math.max(1, frames)).toFixed(2).padStart(6)}   paint ${(paintMs / Math.max(1, frames)).toFixed(2)}   (browser main thread, from the trace)`);
out.push('');
out.push(`draw calls  ${Math.round(calls.avg)} avg / ${calls.worst} max    triangles ${Math.round(tris.avg)} avg / ${tris.worst} max`);
out.push(`entities    enemies ${ent(res.samples.enemies)}   bullets ${ent(res.samples.bullets)}   particles ${ent(res.samples.particles)}`);
out.push(`JS heap     start ${mb(heap[0] ?? 0)} MB  end ${mb(heap.at(-1) ?? 0)} MB  peak ${mb(Math.max(0, ...heap))} MB  allocated ~${mb(alloc / seconds)} MB/s`);
out.push(`GC          minor ${gcEvents.filter((e) => e.name === 'MinorGC').length}x ${gcMs('MinorGC').toFixed(0)} ms, major ${gcEvents.filter((e) => e.name === 'MajorGC').length}x ${gcMs('MajorGC').toFixed(0)} ms, worst pause ${gcWorst.toFixed(1)} ms`);
out.push('');
out.push('phase (ms, avg: sim.* per sim step, ren.* per frame)');
const per = (k, v) => v / Math.max(1, k.startsWith('sim.') ? steps : frames);
const phases = Object.entries(res.phase).map(([k, v]) => [k, per(k, v)]).sort((a, b) => b[1] - a[1]);
for (const [k, v] of phases) out.push(`  ${k.padEnd(30)} ${v.toFixed(3).padStart(7)}`);
if (errors.length) out.push('', `ERRORS:\n${errors.slice(0, 10).join('\n')}`);
console.log(out.join('\n'));
if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify({ link, seconds, frames, steps, update: stat(upd), render: stat(ren), gl: stat(gl), cpu: stat(cpu), interval: stat(interval), calls, tris, phase: Object.fromEntries(phases), gc: { minorMs: gcMs('MinorGC'), majorMs: gcMs('MajorGC'), worst: gcWorst }, allocMBs: alloc / seconds / 1048576, styleLayoutMs: styleMs / frames, paintMs: paintMs / frames, errors }, null, 2),
  );
}
process.exit(errors.length ? 1 : 0);
