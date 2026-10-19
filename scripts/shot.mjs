// Screenshots of the game in a headless browser, for checking visuals without a screen.
//   npm run shot -- "?test&stage=4&boss" [out.png] [--wait 3] [--size 1280x720]
// Starts a Vite dev server on a free port (or uses SHOT_URL), opens the test link
// (src/dev/testLinks.ts), waits, saves the PNG (default shots/<time>.png) and
// fails if the page threw errors. Needs a Chromium: Playwright's cache
// (`npx playwright install chromium-headless-shell`) or SHOT_CHROME=<path>.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
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
const wait = Number(opt('--wait', '3'));
const [w, h] = opt('--size', '1280x720').split('x').map(Number);
const query = args[0] ?? '?test';
mkdirSync('shots', { recursive: true });
const out = args[1] ?? join('shots', `${Date.now()}.png`);

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

let server = null;
let base = process.env.SHOT_URL;
if (!base) {
  server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  base = `http://127.0.0.1:${server.config.server.port ?? server.httpServer.address().port}/`;
}
const browser = await chromium.launch({ headless: true, executablePath: findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(base + query);
await page.waitForTimeout(wait * 1000);
await page.screenshot({ path: out });
await browser.close();
await server?.close();
console.log(`${out}${errors.length ? `\nERRORS:\n${errors.join('\n')}` : ''}`);
process.exit(errors.length ? 1 : 0);
