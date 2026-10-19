// Native browser capture, all six event hooks, WebM decode, pause/quality/reset cleanup.
// node scripts/clips-test.mjs (SHOT_CHROME optional; Metal on macOS)
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
let executablePath = process.env.SHOT_CHROME;
for (const root of [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')]) {
  if (executablePath || !existsSync(root)) continue;
  for (const dir of readdirSync(root).filter(n => n.startsWith('chromium_headless_shell-')).sort().reverse()) {
    for (const sub of readdirSync(join(root, dir))) {
      const p = join(root, dir, sub, 'chrome-headless-shell'); if (existsSync(p)) executablePath ??= p;
    }
  }
}
const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath, headless: true, args: [`--use-angle=${process.platform === 'darwin' ? 'metal' : 'swiftshader'}`, '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?test&stage=2&god&quality=medium&clips=on&reveal=vampire&revealgo=3`);
  await page.waitForFunction(() => window.game?.hero);
  await page.evaluate(async () => {
    const { clipsFor } = await import('/src/game/systems/clips.ts');
    window.clipRecorder = clipsFor(window.game); window.game.addXp = () => {};
  });
  await page.waitForFunction(() => window.clipRecorder.ring.count > 20);
  await page.evaluate(() => {
    const g = window.game;
    g.onFinisher('king', 0, g.player.x, g.player.z);
    g.onCine('flawless', 0, 0, 0, '');
    // These are the same decoded events that host snapshots deliver to clients.
    g.applyTimeNet({ e: [[1, 'cr', 0, g.player.x, g.player.z, 0]] });
    g.applyCoopNet({ e: [[1, 'tu', g.player.x * 100, g.player.z * 100, 1]] });
    g.combo = 500; g.comboT = 100;
  });
  await page.waitForFunction(() => window.clipRecorder.highlights.some(h => h.kind === 'legendary'), null, { timeout: 20000 });
  await page.waitForTimeout(17000);
  const captured = await page.evaluate(() => {
    const s = window.clipRecorder; return { count: s.ring.count, seconds: s.ring.snapshot().at(-1).time - s.ring.snapshot()[0].time, kinds: s.highlights.map(h => h.kind), bytes: s.ring.bytes };
  });
  assert(captured.count <= 301 && captured.seconds <= 15.01 && captured.seconds > 14, JSON.stringify(captured));
  for (const k of ['boss', 'flawless', 'revive', 'team', 'combo', 'legendary']) assert(captured.kinds.includes(k), k);
  await page.evaluate(async () => {
    const { rebind } = await import('/src/core/keybinds.ts'); rebind('clip', 0, 'KeyJ');
    window.manualCount = 0; window.originalSave = window.clipRecorder.save;
    window.clipRecorder.save = async h => { window.manualCount++; window.manualKind = h.kind; };
  });
  await page.keyboard.press('KeyH'); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.manualCount), 0);
  await page.keyboard.press('KeyJ'); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.manualCount === 1 && window.manualKind === 'manual'), true);
  await page.evaluate(() => { window.clipRecorder.save = window.originalSave; const g = window.game; g.paused = true; g.screens.show('clips'); });
  await page.waitForTimeout(4000);
  assert.equal(await page.evaluate(() => window.clipRecorder.recording), false);
  mkdirSync('shots', { recursive: true }); await page.screenshot({ path: 'shots/clips-gallery-browser.png' });
  // Encode a complete rolling window and verify the browser decodes a non-black moving video.
  const video = await page.evaluate(async () => {
    const { encodeClip } = await import('/src/platform/clips.ts');
    const frames = window.clipRecorder.highlights.at(-1).frames;
    const tracks = []; const capture = HTMLCanvasElement.prototype.captureStream;
    HTMLCanvasElement.prototype.captureStream = function (...args) { const stream = capture.apply(this, args); tracks.push(...stream.getTracks()); return stream; };
    try {
      const blob = await encodeClip(frames); window.clipBlob = blob;
      const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(blob); document.body.append(v);
      await new Promise((resolve, reject) => { v.onloadeddata = resolve; v.onerror = reject; });
      await v.play(); await new Promise(r => setTimeout(r, 500));
      const c = document.createElement('canvas'); c.width = 480; c.height = 270; const ctx = c.getContext('2d'); ctx.drawImage(v, 0, 0);
      const pixels = ctx.getImageData(0, 0, 480, 270).data;
      const colors = new Set(); for (let i = 0; i < pixels.length; i += 80) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      const result = { size: blob.size, width: v.videoWidth, height: v.videoHeight, time: v.currentTime, colors: colors.size, stopped: tracks.every(t => t.readyState === 'ended') };
      await new Promise((resolve, reject) => { v.onended = resolve; v.onerror = reject; });
      result.duration = v.currentTime;
      v.pause(); URL.revokeObjectURL(v.src); v.remove(); return result;
    } finally { HTMLCanvasElement.prototype.captureStream = capture; }
  });
  assert(video.size > 10000 && video.width === 480 && video.height === 270 && video.time > 0 && video.colors > 20 && video.stopped && video.duration > 14 && video.duration < 17, JSON.stringify(video));
  const download = page.waitForEvent('download');
  await page.locator('#scr-clips .clips-card button').first().click();
  const file = await download; assert(file.suggestedFilename().endsWith('.webm')); await file.saveAs('shots/clips-test.webm');
  await page.evaluate(async () => {
    const { applyQualityLevel, settings } = await import('/src/game/settings.ts');
    const g = window.game; g.paused = false; g.screens.show('none'); settings.graphics = 0; applyQualityLevel(1, false);
  });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.clipRecorder.recording || window.clipRecorder.ring.count > 0), false);
  await page.evaluate(async () => {
    const { mvpDemo } = await import('/src/game/systems/mvp.ts');
    const g = window.game; const report = mvpDemo(g, 4); g.mode = 'dead';
    g.screens.showGameOver(g.summary(g.hero), -1, [], false); g.showMvp(report);
  });
  await page.waitForTimeout(4000);
  assert.equal(await page.evaluate(() => document.getElementById('scr-mvp').scrollWidth <= innerWidth + 1), true, 'MVP fits viewport with a full clip rail');
  await page.screenshot({ path: 'shots/clips-mvp.png', fullPage: true });
  await page.locator('#scr-mvp .mvp-footer button').click();
  await page.waitForTimeout(4000); await page.screenshot({ path: 'shots/clips-gameover.png', fullPage: true });
  await page.evaluate(() => window.clipRecorder.reset());
  assert.equal(await page.evaluate(() => window.clipRecorder.highlights.length), 0);
  assert.deepEqual(errors, []);
  console.log('clips browser PASS', captured, video);
} finally { await browser.close(); await server.close(); }
