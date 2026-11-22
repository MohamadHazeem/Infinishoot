// The same Playwright driver is used with a local Chromium, an attached test browser,
// and the packaged Electron window. The game ships none of this instrumentation.
const baseQuery = '?test&bench&seed=42&god&circle&aim=0.7,0.7';
const weapons = '&weapons=drones:6,missiles:6,lightning:6,fire:6';
const meadow = '&stage=5&biome=meadow&night&rain&boom';
export const scenes = {
  heavy: weapons + meadow + '&swarm=200&hold=170,24:spinner,12:burster&bullets=500',
  double: weapons + meadow + '&swarm=360&hold=390,24:spinner,12:burster&bullets=1010',
  boss: '&stage=4&bossnow&nointro&boom&gfx3=explosion&hold=150&bullets=500',
  team: weapons + '&stage=5&heroes=4&matebots&boom&hold=180&bullets=500',
  titan: '&stage=11&titan&bossnow&nointro&titanmove=beam',
  night: weapons + '&stage=5&biome=neon&night&rain&fog=1&puddles=90&boom&hold=180&bullets=500',
};
export function matrix() {
  const rows = [];
  for (const size of ['1280x720', '1920x1080']) {
    for (const [preset, rate] of [
      ['low', 1],
      ['medium', 1],
      ['high', 1],
      ['shadows', 1],
      ['low', 4],
    ]) {
      for (const scene of Object.keys(scenes)) rows.push({ size, preset, rate, scene });
    }
  }
  return rows;
}
export function stats(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const p = (q) => sorted[Math.ceil(q * sorted.length) - 1];
  return {
    n: sorted.length,
    min: sorted[0],
    median: p(0.5),
    p95: p(0.95),
    p99: p(0.99),
    max: sorted.at(-1),
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
}
export function hardware(renderer) {
  return /metal/i.test(renderer) && !/swiftshader|llvmpipe|software/i.test(renderer);
}
export function sceneLink({ scene, preset }) {
  return (
    baseQuery +
    scenes[scene] +
    '&quality=' +
    (preset === 'shadows' ? 'high' : preset) +
    '&shadows=' +
    Number(preset === 'shadows')
  );
}
export function missedSlots(intervals) {
  return intervals.reduce((total, dt) => total + Math.max(0, Math.round((dt * 60) / 1000) - 1), 0);
}

// Installs for the sample window only. GPU queries are asynchronous, bounded and
// bracket the commands issued from game.render through the end of its callback.
function collectFrames(duration) {
  return new Promise((resolve) => {
    const g = window.__game,
      original = g.render,
      q = window.__quality;
    const gl = document.getElementById('game').getContext('webgl2');
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';
    const stamps = [],
      gpu = [],
      census = [];
    const pending = [];
    const wallNow = performance.now.bind(performance);
    const start = wallNow();
    window.__profReset();
    g.render = function (alpha, frameDt) {
      stamps.push(document.timeline.currentTime);
      if ((stamps.length - 1) % 8 === 0) {
        census.push([
          g.enemies.activeCount,
          g.bullets.count,
          g.heroes.length,
          g.boss?.def.id ?? '',
          g.isCombatMode && !g.paused && g.screens.current === 'none',
        ]);
        if (ext) {
          if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
            for (const query of pending) gl.deleteQuery(query);
            pending.length = 0;
          }
          while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
            const query = pending.shift();
            gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(query);
          }
          if (pending.length < 4) {
            const query = gl.createQuery();
            gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
            queueMicrotask(() => {
              gl.endQuery(ext.TIME_ELAPSED_EXT);
              pending.push(query);
            });
          }
        }
      }
      return original.call(this, alpha, frameDt);
    };
    setTimeout(() => {
      g.render = original;
      for (const query of pending) gl.deleteQuery(query);
      const shadow = g.scene.getObjectByName('gfx3-sun');
      resolve({
        frames: window.__prof.frames,
        phase: window.__prof.phase,
        stamps,
        gpu,
        gpuExtension: !!ext,
        census,
        renderer,
        elapsed: wallNow() - start,
        viewport: [innerWidth, innerHeight],
        buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        visible: !document.hidden,
        quality: q.name,
        shadows: !!shadow?.visible,
        userAgent: navigator.userAgent,
      });
    }, duration);
  });
}

export async function measureScene(page, base, config, options) {
  const [width, height] = config.size.split('x').map(Number);
  await page.setViewportSize({ width, height });
  await page.bringToFront();
  const cdp = await page.context().newCDPSession(page);
  const errors = [];
  const onError = (e) => errors.push(e.message);
  const onConsole = (message) => {
    if (message.type() === 'error' && /WebGLProgram|Shader Error|GL_INVALID_|context lost/i.test(message.text()))
      errors.push(message.text());
  };
  page.on('pageerror', onError);
  page.on('console', onConsole);
  const link = sceneLink(config);
  try {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: config.rate });
    await page.goto(base + link, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__prof?.frames.length > 0 && window.__game.isCombatMode, null, {
      timeout: 90000,
    });
    await page.waitForTimeout(options.warmup * 1000);
    await cdp.send('Performance.enable');
    const metrics = async () =>
      Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    if (options.profile) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
    }
    const before = await metrics();
    const data = await page.evaluate(collectFrames, options.seconds * 1000);
    const after = await metrics();
    let profile;
    if (options.profile) {
      const { profile: cp } = await cdp.send('Profiler.stop');
      const times = new Map(),
        nodes = new Map(cp.nodes.map((n) => [n.id, n.callFrame]));
      cp.samples.forEach((id, i) => {
        const f = nodes.get(id),
          key = (f.functionName || '(anonymous)') + ' ' + f.url.split('/').pop() + ':' + (f.lineNumber + 1);
        times.set(key, (times.get(key) ?? 0) + cp.timeDeltas[i] / 1000);
      });
      profile = Object.fromEntries([...times].sort((a, b) => b[1] - a[1]).slice(0, 20));
    }
    const { frames, phase, gpu, stamps, census, ...meta } = data;
    const count = frames.length,
      col = (i) => stats(frames.map((f) => f[i]));
    const intervals = stamps.slice(1).map((s, i) => s - stamps[i]);
    const interval = stats(intervals);
    const fps = interval ? 1000 / interval.mean : 0;
    const drops = missedSlots(intervals);
    return {
      ...config,
      ...meta,
      link,
      errors,
      profile,
      frames: count,
      fps,
      interval,
      drops,
      dropFraction: drops / Math.max(1, intervals.length + drops),
      simulation: col(0),
      render: col(1),
      submit: col(2),
      cpu: stats(frames.map((f) => f[0] + f[1] + f[2])),
      gpu: stats(gpu),
      calls: col(5),
      triangles: col(6),
      enemies: stats(census.map((c) => c[0])),
      bullets: stats(census.map((c) => c[1])),
      heroes: stats(census.map((c) => c[2])),
      bosses: [...new Set(census.map((c) => c[3]))],
      fighting: census.length > 0 && census.every((c) => c[4]),
      heapBytes: { start: before.JSHeapUsedSize, end: after.JSHeapUsedSize },
      phasesMsPerFrame: Object.fromEntries(Object.entries(phase).map(([k, v]) => [k, v / count])),
      browserMsPerFrame: Object.fromEntries(
        ['LayoutDuration', 'RecalcStyleDuration', 'TaskDuration'].map((k) => [
          k,
          ((after[k] - before[k]) * 1000) / count,
        ]),
      ),
    };
  } finally {
    page.off('pageerror', onError);
    page.off('console', onConsole);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {}).finally(() => cdp.detach().catch(() => {}));
  }
}
