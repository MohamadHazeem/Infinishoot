// Cold HTTP cache and fresh storage, including the ordinary PWA registration. Count actual local responses
// requested by the first submitted frame, including HTML and late-finishing fonts.
export const networks = { broadband: { mbps: 20, latency: 40 }, slow4g: { mbps: 1.6, latency: 150 } };
export async function measureLoad(browser, base, network, target) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const cdp = await context.newCDPSession(page);
    const entries = new Map();
    // Cache installation belongs to another CDP target. Include any same-origin
    // requests it starts before the first frame without double counting the page.
    const workerEntries = new Map();
    context.on('request', (request) => {
      if (request.serviceWorker() && request.url().startsWith(base)) {
        workerEntries.set(request, { path: new URL(request.url()).pathname, epochMs: Date.now() });
      }
    });
    context.on('requestfinished', async (request) => {
      const r = workerEntries.get(request);
      if (!r) return;
      try {
        const sizes = await request.sizes();
        r.transfer = sizes.responseHeadersSize + sizes.responseBodySize;
        r.encoding = (await request.response())?.headers()['content-encoding'] ?? 'identity';
      } catch {
        /* An unfinished entry at the milestone invalidates the sample below. */
      }
    });
    cdp.on('Network.requestWillBeSent', (e) => {
      if (e.request.url.startsWith(base))
        entries.set(e.requestId, { path: new URL(e.request.url).pathname, epochMs: e.wallTime * 1000 });
    });
    cdp.on('Network.responseReceived', (e) => {
      const entry = entries.get(e.requestId);
      if (entry)
        entry.encoding =
          Object.entries(e.response.headers).find(([k]) => k.toLowerCase() === 'content-encoding')?.[1] ?? 'identity';
    });
    cdp.on('Network.loadingFinished', (e) => {
      const entry = entries.get(e.requestId);
      if (entry) entry.transfer = e.encodedDataLength;
    });
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const { mbps, latency } = networks[network];
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency,
      downloadThroughput: mbps * 125000,
      uploadThroughput: mbps * 125000,
    });
    const mark = 'infinishoot:' + (target === 'title' ? 'title-frame' : 'stage1-frame');
    await page.goto(base + (target === 'title' ? '' : '?test&stage=1&seed=42&god'), {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    });
    await page.waitForFunction((m) => performance.getEntriesByName(m).length > 0, mark, { timeout: 90000 });
    const timing = await page.evaluate(async (m) => {
      const firstMs = performance.getEntriesByName(m)[0].startTime;
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvas = document.querySelector('#game');
      const gl = canvas.dataset.backend === 'WebGPU' ? null : canvas.getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return {
        firstMs,
        readyMs: performance.now(),
        epochMs: performance.timeOrigin + firstMs,
        renderer: canvas.dataset.adapter || (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'),
      };
    }, mark);
    const workerInitial = [...workerEntries.values()].filter((r) => r.epochMs <= timing.epochMs);
    const initial = [...entries.values()].filter((r) => r.epochMs <= timing.epochMs).concat(workerInitial);
    const until = Date.now() + 10000;
    while (initial.some((r) => r.transfer === undefined) && Date.now() < until) await page.waitForTimeout(100);
    const bytes = { js: 0, css: 0, html: 0, assets: 0 };
    for (const resource of initial) {
      if (resource.transfer === undefined) throw Error('Missing transfer size for ' + resource.path);
      const type = resource.path.endsWith('.js')
        ? 'js'
        : resource.path.endsWith('.css')
          ? 'css'
          : resource.path === '/'
            ? 'html'
            : 'assets';
      bytes[type] += resource.transfer;
    }
    return {
      network,
      target,
      mbps,
      latency,
      workerBefore: workerInitial.length,
      workerRequests: workerEntries.size,
      ...timing,
      errors,
      bytes,
      total: Object.values(bytes).reduce((a, b) => a + b, 0),
      resources: initial.map(({ path, encoding, transfer }) => ({ path, encoding, transfer })),
    };
  } finally {
    await context.close();
  }
}
