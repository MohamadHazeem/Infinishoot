// Attach to the packaged app's actual file:// window. A temporary user-data
// directory keeps settings, caches and saves independent of the player's profile.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { measureScene, scenes } from './benchRealScenes.mjs';

export async function measureDesktop(executable, options) {
  const dir = mkdtempSync(join(tmpdir(), 'infinishoot-bench-'));
  writeFileSync(join(dir, 'desktop.json'), JSON.stringify({ options: { autoUpdate: false } }));
  const start = Date.now();
  const child = spawn(
    resolve(executable),
    ['--user-data-dir=' + dir, '--remote-debugging-port=0', '--use-angle=metal', '--disable-software-rasterizer'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const stopped = new Promise((resolve) => child.once('close', resolve));
  let browser;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let log = '';
      const timer = setTimeout(() => reject(Error('No desktop debugger after 30 seconds')), 30000);
      child.stderr.on('data', (data) => {
        log = (log + data).slice(-4000);
        const match = log.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-f0-9-]+)/i);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        reject(
          Error('Packaged app exited ' + (signal ?? code) + ' before debugger connection. ' + log.trim().slice(-400)),
        );
      });
    });
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 30000 }));
    await page.waitForFunction(() => performance.getEntriesByName('infinishoot:title-frame').length > 0, null, {
      timeout: 90000,
    });
    const coldMs =
      (await page.evaluate(
        () => performance.timeOrigin + performance.getEntriesByName('infinishoot:title-frame')[0].startTime,
      )) - start;
    const url = new URL(page.url());
    if (url.protocol !== 'file:' || !url.pathname.includes('app.asar/dist/index.html'))
      throw Error('Expected packaged app.asar/dist/index.html');
    const rows = [];
    for (const scene of Object.keys(scenes)) {
      const r = await measureScene(page, url.href, { size: '1920x1080', preset: 'shadows', rate: 1, scene }, options);
      rows.push({ ...r, runtime: 'Electron' });
    }
    return { status: 'Packaged Electron measured with an empty user profile.', coldMs, rows };
  } finally {
    try {
      await browser?.close();
    } finally {
      if (child.exitCode === null && !child.signalCode) child.kill('SIGTERM');
      await stopped;
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
