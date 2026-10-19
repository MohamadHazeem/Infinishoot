// Crash fuzzer: random combinations of test-link options (src/dev/fuzzLinks.ts) played by
// the autoplay bot, collecting every page error, unhandled rejection and console error with
// the link that caused it, deduped by stack.
//   npm run fuzz -- --runs 300                 headless Chromium (dev-mode bundle), 6-10 s per link
//   npm run fuzz -- --runs 1000 --jsdom        jsdom (no WebGL, test-link timers on the sim clock), fast
//   npm run fuzz -- --link "?test&god&titan"   replay one link (add --jsdom for jsdom)
// Options: --seed <first seed> (default: time), --par <parallel pages/processes>, --secs <s per link>
// (default random 6-10), --out <report.json> (default shots/fuzz/<mode>.json). Exits 1 if anything failed.
// Needs a Chromium for the browser mode, found like scripts/shot.mjs (or SHOT_CHROME=<path>).
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { CHROME_ARGS, findChrome, root, serveDevBundle } from './fuzz/browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i < 0 ? d : args[i + 1];
};
const jsdom = args.includes('--jsdom');
const runs = Number(opt('--runs', '300'));
const seed0 = Number(opt('--seed', String(Date.now() % 1e6)));
const par = Number(opt('--par', String(jsdom ? Math.max(2, cpus().length - 2) : 4)));
const fixedSecs = opt('--secs', '');
const oneLink = opt('--link', '');
const out = opt('--out', join(root, 'shots', 'fuzz', `${jsdom ? 'jsdom' : 'browser'}.json`));
mkdirSync(dirname(out), { recursive: true });

const secsFor = (seed) => (fixedSecs ? Number(fixedSecs) : 6 + ((seed * 2654435761) >>> 0) % 5);
/** Messages that are the sandbox, not the game: blocked network, and PeerJS not constructing in the jsdom bundle (online play needs a browser). */
const IGNORE = [/net::ERR_/, /Failed to load resource/, /ERR_INTERNET_DISCONNECTED/, /WebGL.*(CONTEXT_LOST|lost)/i, /import_bundler\.default is not a constructor/];

// ---------- jsdom ----------
async function runJsdom(jobs) {
  const bundle = join(root, 'node_modules', '.fuzz', 'jsdomRun.mjs');
  mkdirSync(dirname(bundle), { recursive: true });
  execFileSync('npx', ['rolldown', 'scripts/fuzz/jsdomRun.ts', '--format', 'esm', '--platform', 'node', '--external', 'jsdom', '--inline-dynamic-imports', '-o', bundle], { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' });
  const one = (job) =>
    new Promise((res) => {
      const p = spawn('node', [bundle, String(job.seed), String(job.secs), job.link ?? ''], { cwd: root });
      let txt = '';
      let errTxt = '';
      p.stdout.on('data', (d) => (txt += d));
      p.stderr.on('data', (d) => (errTxt += d));
      const kill = setTimeout(() => p.kill('SIGKILL'), 120000);
      p.on('close', (code) => {
        clearTimeout(kill);
        const line = txt.split('\n').find((l) => l.startsWith('FUZZRESULT '));
        if (line) {
          const r = JSON.parse(line.slice(11));
          r.errors = r.errors.filter((e) => !IGNORE.some((x) => x.test(e.msg)));
          return res(r);
        }
        res({ seed: job.seed, link: job.link ?? `(seed ${job.seed})`, errors: [{ kind: 'process', msg: `exit ${code}`, stack: errTxt.slice(-2000) || `exit ${code}` }] });
      });
    });
  return pool(jobs, one);
}

// ---------- browser ----------
async function runBrowser(jobs) {
  const server = await serveDevBundle();
  const base = server.base;
  const links = linksFor(jobs);
  const browser = await chromium.launch({ headless: true, executablePath: findChrome(), args: CHROME_ARGS });
  const one = async (job) => {
    const link = job.link ?? links.get(job.seed);
    const errors = [];
    const push = (kind, msg, stack) => {
      if (IGNORE.some((r) => r.test(msg))) return;
      if (errors.length < 20) errors.push({ kind, msg, stack: stack || msg });
    };
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    await ctx.addInitScript(() => {
      window.addEventListener('unhandledrejection', (e) => console.error('unhandledrejection: ' + (e.reason?.stack ?? e.reason)));
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => push('pageerror', e.message, e.stack));
    // Errors, plus WebGL's own invalid-call warnings (a real bug: a bad draw, a texture feedback loop).
    page.on('console', (m) => (m.type() === 'error' || (m.type() === 'warning' && /GL_INVALID|WebGL: INVALID/.test(m.text()))) && push('console', m.text(), m.text() + (m.location()?.url ? `\n    at ${m.location().url}:${m.location().lineNumber}` : '')));
    page.on('crash', () => push('crash', 'page crashed'));
    let mode = '';
    try {
      await page.goto(base + link, { timeout: 60000, waitUntil: 'commit' });
      await page.waitForFunction(() => typeof window.botAuto === 'function', null, { timeout: 60000, polling: 250 });
      await page.evaluate(() => window.botAuto(true));
      await page.waitForTimeout(job.secs * 1000);
      mode = await page.evaluate(() => `${window.game?.mode} st${window.game?.stage} t${Math.round(window.game?.runTime ?? 0)}`);
    } catch (e) {
      if (!errors.length) push('harness', String(e.message).split('\n')[0], e.stack); // else: the boot threw, already reported
    }
    await ctx.close().catch(() => {});
    return { seed: job.seed, link, mode, errors };
  };
  try {
    return await pool(jobs, one);
  } finally {
    await browser.close();
    await server.close();
  }
}
/** Links for the jobs' seeds, from the generator the jsdom runner uses (src/dev/fuzzLinks.ts, bundled for Node). */
function linksFor(jobs) {
  const bundle = join(root, 'node_modules', '.fuzz', 'links.mjs');
  execFileSync('npx', ['rolldown', 'scripts/fuzz/links.ts', '--format', 'esm', '--platform', 'node', '--external', 'jsdom', '--inline-dynamic-imports', '-o', bundle], { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' });
  const seeds = jobs.filter((j) => !j.link).map((j) => j.seed);
  const map = new Map();
  if (!seeds.length) return map;
  const txt = execFileSync('node', [bundle, String(seeds[0]), String(seeds.length)], { cwd: root, maxBuffer: 64 << 20 }).toString();
  const list = JSON.parse(txt.split('\n').find((l) => l.startsWith('FUZZLINKS ')).slice(10));
  seeds.forEach((s, i) => map.set(s, list[i]));
  return map;
}

// ---------- shared ----------
async function pool(jobs, fn) {
  const results = [];
  let next = 0;
  let done = 0;
  const t0 = Date.now();
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const r = await fn(job);
      results.push(r);
      done++;
      const bad = r.errors.length ? `  FAIL ${r.errors[0].kind}: ${r.errors[0].msg.slice(0, 120)}` : '';
      console.log(`[${done}/${jobs.length}] ${((Date.now() - t0) / 1000).toFixed(0)}s seed ${r.seed} ${r.mode ?? ''} ${r.link}${bad}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(par, jobs.length) }, worker));
  return results;
}

/** Stack signature: message without numbers + the top game frames without line/column or Vite query strings. */
function signature(e) {
  const msg = e.msg.replace(/\d+(\.\d+)?/g, 'N').slice(0, 160);
  const frames = (e.stack || '')
    .split('\n')
    .filter((l) => /^\s*at /.test(l))
    .map((l) => l.replace(/\?[^:)\s]*/g, '').replace(/:\d+:\d+\)?$/, '').replace(/https?:\/\/[^/]+\//, '').trim())
    .filter((l) => !/node_modules|jsdomRun|fuzz/.test(l))
    .slice(0, 3);
  return `${msg} | ${frames.join(' < ')}`;
}

const jobs = oneLink ? [{ seed: 0, link: oneLink, secs: secsFor(1) }] : Array.from({ length: runs }, (_, i) => ({ seed: seed0 + i, secs: secsFor(seed0 + i) }));
console.log(`fuzz: ${jobs.length} ${jsdom ? 'jsdom' : 'browser'} runs, seeds ${seed0}..${seed0 + jobs.length - 1}, ${par} in parallel`);
const t0 = Date.now();
const results = jsdom ? await runJsdom(jobs) : await runBrowser(jobs);
const groups = new Map();
for (const r of results) {
  for (const e of r.errors) {
    const sig = signature(e);
    const g = groups.get(sig) ?? { sig, kind: e.kind, msg: e.msg, stack: e.stack, count: 0, links: [] };
    g.count++;
    if (g.links.length < 5 && !g.links.includes(r.link)) g.links.push(r.link);
    groups.set(sig, g);
  }
}
const failed = results.filter((r) => r.errors.length).length;
const report = { mode: jsdom ? 'jsdom' : 'browser', runs: results.length, failed, seconds: Math.round((Date.now() - t0) / 1000), seed0, bugs: [...groups.values()].sort((a, b) => b.count - a.count) };
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\n${results.length} runs in ${report.seconds}s, ${failed} with errors, ${groups.size} distinct (report: ${out})`);
for (const g of report.bugs) console.log(`\n x${g.count} [${g.kind}] ${g.msg.slice(0, 200)}\n   ${g.stack.split('\n').slice(1, 4).join('\n   ')}\n   e.g. ${g.links[0]}`);
process.exit(failed ? 1 : 0);
