// Dev probe (firstten lane): open a test link, wait, run a JS expression in the page and print it.
//   node scripts/firstten-probe.mjs "?test&ftdie=Rhino" 9 "document.title" [shot.png]
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const [query, wait, expr, shot] = process.argv.slice(2);
function findChrome() {
  if (process.env.SHOT_CHROME) return process.env.SHOT_CHROME;
  for (const r of [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')]) {
    if (!existsSync(r)) continue;
    for (const d of readdirSync(r).filter((x) => x.startsWith('chromium_headless_shell-')).sort().reverse())
      for (const sub of readdirSync(join(r, d))) if (existsSync(join(r, d, sub, 'chrome-headless-shell'))) return join(r, d, sub, 'chrome-headless-shell');
  }
}
const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${query}`);
await page.waitForTimeout(Number(wait) * 1000);
console.log(JSON.stringify(await page.evaluate(expr)));
if (shot) await page.screenshot({ path: shot });
await browser.close();
await server.close();
if (errors.length) console.log('ERRORS', errors);
