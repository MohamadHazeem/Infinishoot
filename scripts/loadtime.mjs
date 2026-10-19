// Cold production loads, using Chromium + SwiftShader. No external services.
// npm run loadtime -- --json shots/loadtime.json [--skip-build] [--mbps 20] [--latency 40]
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
const args = process.argv.slice(2);
const opt = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const mbps = Number(opt('--mbps', 20)), latency = Number(opt('--latency', 40));
function chrome() {
  if (process.env.SHOT_CHROME) return process.env.SHOT_CHROME;
  for (const root of [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')]) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).filter(x => x.startsWith('chromium_headless_shell-')).sort().reverse()) {
      for (const sub of readdirSync(join(root, dir))) {
        const p = join(root, dir, sub, 'chrome-headless-shell');
        if (existsSync(p)) return p;
      }
    }
  }
}
function files(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
if (!args.includes('--skip-build')) await build({ logLevel: 'error' });
const all = files('dist');
const report = {
  conditions: { mbps, latencyMs: latency, cache: 'cold', compression: 'Vite preview (uncompressed)', renderer: 'Chromium SwiftShader', viewport: '1280x720' },
  distBytes: all.reduce((n, p) => n + statSync(p).size, 0),
  audioBytes: all.filter(p => p.includes('/audio/')).reduce((n, p) => n + statSync(p).size, 0),
  js: all.filter(p => p.endsWith('.js')).map(p => ({ file: relative('dist', p), bytes: statSync(p).size, gzipBytes: gzipSync(readFileSync(p)).length })),
  runs: [],
};
let server, browser;
try {
  server = await preview({ preview: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
  browser = await chromium.launch({ executablePath: chrome(), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  for (const [name, query, mark] of [['title', '', 'title-frame'], ['stage1', '?test&stage=1&seed=42&god', 'stage1-frame']]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // A load measurement should not contact leaderboards or other external services.
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: mbps * 1e6 / 8, uploadThroughput: mbps * 1e6 / 8 });
    await page.goto(base + query, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(mark => performance.getEntriesByName('infinishoot:' + mark).length > 0, mark, { timeout: 60000 });
    const first = await page.evaluate(mark => {
      const ms = performance.getEntriesByName('infinishoot:' + mark)[0].startTime;
      const resources = performance.getEntriesByType('resource').filter(r => r.startTime <= ms);
      return { ms, resourceBytes: resources.reduce((n, r) => n + r.encodedBodySize, 0), resources: resources.map(r => ({ file: new URL(r.name).pathname, bytes: r.encodedBodySize, startMs: r.startTime })), audioRequests: resources.filter(r => r.name.includes('/audio/')).length };
    }, mark);
    const gestureMs = await page.evaluate(() => performance.now());
    await page.mouse.click(1250, 700);
    await page.waitForTimeout(10000);
    const audio = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => r.name.includes('/audio/')).map(r => ({ file: new URL(r.name).pathname, bytes: r.encodedBodySize, startMs: r.startTime })));
    report.runs.push({ name, ...first, gestureMs, audioAfter10s: audio, errors });
    await context.close();
  }
} finally {
  await browser?.close();
  server?.httpServer.close();
}
const out = opt('--json', null);
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, runs: report.runs.map(({ resources, audioAfter10s, ...run }) => ({ ...run, audioAfter10s: { count: audioAfter10s.length, bytes: audioAfter10s.reduce((n, r) => n + r.bytes, 0), first: audioAfter10s[0], firstSamples: audioAfter10s.slice(1, 10).map(r => r.file) } })) }, null, 2));
process.exitCode = report.runs.some(r => r.errors.length) ? 1 : 0;
