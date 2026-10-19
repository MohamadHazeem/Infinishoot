// Walks a brand-new player's first minutes in headless Chromium and screenshots every step:
//   node scripts/firstten-flow.mjs [outDir]   (firstten lane; uses the same Chromium as `npm run shot`)
// Fresh save: title (training offer) -> PLAY SOLO -> mode -> loadout -> starting shop -> stage 1,
// then the first level-up, the first shop and the first death.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? 'shots/firstten';
mkdirSync(out, { recursive: true });
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
const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({ headless: true, executablePath: findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let n = 0;
const shot = async (name) => {
  const f = join(out, `${String(++n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: f });
  console.log(f);
};
const wait = (s) => page.waitForTimeout(s * 1000);
const click = async (sel) => {
  const el = page.locator(sel).first();
  await el.click({ timeout: 4000 }).catch((e) => console.log('miss', sel, e.message.split('\n')[0]));
};
await page.goto(base);
await wait(4);
await shot('title');
// PLAY SOLO
await click('#scr-title [data-act=solo], #scr-title button:has-text("PLAY SOLO")');
await wait(1);
await shot('after-play');
const steps = (process.env.FLOW ?? '').split(',').filter(Boolean);
for (const s of steps) {
  await click(s);
  await wait(1.2);
  await shot('step');
}
await wait(Number(process.env.TAIL ?? 0));
if (process.env.TAIL) await shot('tail');
await browser.close();
await server.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'ok');
