import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { arch, release, type } from 'node:os';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';
import { gate, sceneFailures } from './benchRealBudget.mjs';
import { matrix, measureScene, hardware } from './benchRealScenes.mjs';
import { measureLoad, networks } from './benchRealLoad.mjs';
import { writeReport } from './benchRealReport.mjs';
import { measureDesktop } from './benchRealDesktop.mjs';

const { values } = parseArgs({
  options: {
    check: { type: 'boolean' },
    // Headless by default so no window ever comes to the front (user, 22 Nov 2026); --headed only for a manual look.
    headless: { type: 'boolean' },
    headed: { type: 'boolean' },
    'from-report': { type: 'string' },
    'skip-build': { type: 'boolean' },
    cdp: { type: 'string' },
    chrome: { type: 'string' },
    electron: { type: 'string' },
    output: { type: 'string' },
    seconds: { type: 'string', default: '5' },
    warmup: { type: 'string', default: '2' },
    profile: { type: 'boolean' },
  },
});
const options = { seconds: Number(values.seconds), warmup: Number(values.warmup), profile: !!values.profile };
if (!(options.seconds >= 4 && options.warmup >= 1 && Number.isFinite(options.seconds + options.warmup)))
  throw Error('Use at least 4 s of measurement and 1 s of warm-up.');

async function run() {
  const saved = values['from-report'];
  if (saved) {
    if (!values.check) throw Error('--from-report requires --check');
    return gate(JSON.parse(readFileSync(saved, 'utf8')));
  }
  if (!values['skip-build']) await build({ logLevel: 'error' });
  const server = await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  const base = 'http://127.0.0.1:' + server.httpServer.address().port + '/';
  const date = new Date().toISOString().slice(0, 10);
  const report = {
    date,
    revision: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    host: [type(), release(), arch()].join(' '),
    conditions:
      'Vite preview on loopback, fresh contexts, GPU timer query every eighth frame. Browser and OS caches below HTTP may be warm.',
    seconds: options.seconds,
    warmup: options.warmup,
    rows: [],
    loads: [],
  };
  let browser;
  try {
    browser = values.cdp
      ? await chromium.connectOverCDP(values.cdp)
      : await chromium.launch({
          executablePath: values.chrome,
          channel: values.chrome ? undefined : 'chromium',
          headless: !values.headed,
          ignoreDefaultArgs: ['--enable-unsafe-swiftshader'],
          args: ['--enable-gpu', '--use-angle=metal', '--disable-software-rasterizer'],
        });
    report.browser = browser.version();
    for (const config of matrix()) {
      const ctx = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const page = await ctx.newPage();
        const row = await measureScene(page, base, config, options);
        if (!hardware(row.renderer)) throw Error('Metal required. Observed ' + row.renderer);
        report.rows.push(row);
        console.log(
          config.size,
          config.preset,
          config.rate + 'x',
          config.scene,
          row.fps.toFixed(1) + ' fps',
          sceneFailures(row).join(', '),
        );
      } finally {
        await ctx.close();
      }
    }
    for (const network of Object.keys(networks))
      for (const target of ['title', 'fight']) {
        report.loads.push(await measureLoad(browser, base, network, target));
      }
  } finally {
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  }
  // The packaged app opens a real window, so it is measured only when asked for with --electron <path>.
  const packaged = values.electron;
  if (packaged) {
    report.desktopRequested = true;
    try {
      report.desktop = await measureDesktop(packaged, options);
    } catch (e) {
      report.desktop = { status: 'Packaged app measurement failed. ' + e.message, rows: [] };
    }
  } else
    report.desktop = {
      status: 'Packaged Electron unmeasured. Supply --electron with the packaged executable.',
      rows: [],
    };
  const stem = values.output ?? 'notes/perf/real-' + date;
  const failures = writeReport(stem, report);
  console.log(stem + '.md', stem + '.json');
  return failures;
}
const failures = await run();
if (failures.length) console.error(failures.join('\n'));
console.log('Performance budget ' + (failures.length ? 'FAIL' : 'PASS'));
if (values.check && failures.length) process.exitCode = 1;
