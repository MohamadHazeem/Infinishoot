// Ten real minutes of rendered bot play, with post-GC heap samples every 30 s.
// node scripts/soak.mjs --gpu metal --seconds 600 --json shots/perf2-soak.json
// Replay history is intentional retained ArrayBuffer storage; report it separately.
import { harness } from './replay.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const args = process.argv.slice(2);
const opt = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const seconds = Number(opt('--seconds', '600'));
const warmup = Number(opt('--warmup', '60'));
const out = opt('--json', 'shots/perf2-soak.json');
const h = await harness({ angle: opt('--gpu', 'metal') });
const samples = [];
try {
  const page = await h.page('test&bench&seed=42&god&stage=5&biome=meadow&quality=high&night&rain&weapons=drones:6,missiles:6,lightning:6,fire:6&hold=170,24:spinner,12:burster&bullets=500');
  await page.evaluate(() => { window.__prof.on = false; window.botAuto(true); window.loop.start(); });
  const cdp = await page.context().newCDPSession(page);
  for (let elapsed = -warmup; elapsed <= seconds; elapsed += 30) {
    if (elapsed >= 0) {
      await cdp.send('HeapProfiler.collectGarbage');
      const heap = await cdp.send('Runtime.getHeapUsage');
      const dom = await cdp.send('Memory.getDOMCounters');
      const game = await page.evaluate(() => {
        const g = window.game, info = window.renderer.gl.info;
        return { runTime: g.runTime, stage: g.stage, mode: g.mode, enemies: g.enemies.activeCount, bullets: g.bullets.count, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs.length, replay: window.replay.status() };
      });
      samples.push({ elapsed, ...heap, ...dom, ...game });
      console.log(JSON.stringify(samples.at(-1)));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify({ seconds, warmup, samples, errors: h.errors }, null, 2));
    }
    if (elapsed < seconds) await page.waitForTimeout(30_000);
  }
  if (h.errors.length) throw new Error(h.errors.join('\n'));
  const first = samples[0], last = samples.at(-1);
  if (last.runTime <= first.runTime + seconds * 0.7) throw new Error('Bot did not sustain simulation throughout the soak');
  console.log(`Post-GC JS heap: ${(first.usedSize / 1048576).toFixed(2)} -> ${(last.usedSize / 1048576).toFixed(2)} MiB; retained replay: ${(last.replay.tapeBytes / 1048576).toFixed(2)} MiB`);
} finally { await h.close(); }
