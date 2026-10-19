import { JSDOM } from 'jsdom';
import { ok } from './check';
import { mobileDevice, MobileFrameGate } from '../src/core/mobile';
const dom = new JSDOM('<body></body>', { url: 'http://localhost/' });
for (const key of [
  'window',
  'document',
  'localStorage',
  'HTMLElement',
  'HTMLInputElement',
  'Event',
  'MutationObserver',
  'navigator',
])
  Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
const {
  defaultTouchLayout,
  normalizeTouchLayout,
  touchRect,
  TOUCH_IDS,
  TOUCH_BUTTONS,
  setupTouchEditor,
  touchLayout,
} = await import('../src/ui/touchEditor');
ok(
  mobileDevice(5, 390, false) && mobileDevice(0, 2000, true) && mobileDevice(5, 1024, false),
  'phones, coarse pointers and tablets start conservatively',
);
ok(
  !mobileDevice(0, 844, false) && !mobileDevice(0, 1920, false),
  'small desktop windows do not become mobile devices',
);
const defaults = defaultTouchLayout();
for (const raw of [null, undefined, {}, [], { version: 9 }, 'broken'])
  ok(
    JSON.stringify(normalizeTouchLayout(raw)) === JSON.stringify(defaults),
    'corrupt or future layouts fall back',
  );
const partial = normalizeTouchLayout({
  version: 1,
  controls: { move: { x: -9, y: 8, size: 4 }, dash: { x: NaN, y: 0.5, size: 900 }, cash: null },
});
ok(
  partial.controls.move.x === 0 &&
    partial.controls.move.y === 1 &&
    partial.controls.move.size === 80,
  'stick geometry clamps',
);
ok(
  partial.controls.dash.size === 160 && partial.controls.dash.x === defaults.controls.dash.x,
  'invalid positions fallback and buttons clamp',
);
ok(partial.portrait.aim.x === defaults.portrait.aim.x, 'old layouts migrate portrait defaults');
for (const [w, h] of [
  [844, 390],
  [390, 844],
  [1024, 768],
])
  for (const id of TOUCH_IDS) {
    const rect = touchRect(defaults[w < h ? 'portrait' : 'controls'][id], w, h);
    ok(
      rect.left >= 8 &&
        rect.top >= 8 &&
        rect.left + rect.size <= w - 8 &&
        rect.top + rect.size <= h - 8,
      `${id} stays inside ${w}x${h}`,
    );
    ok(rect.size >= 48, 'minimum touch size retained');
  }
ok(
  TOUCH_BUTTONS.rewind === 12 &&
    TOUCH_BUTTONS.cashpick === 14 &&
    TOUCH_BUTTONS.team === 13 &&
    TOUCH_BUTTONS.cash === 15,
  'rewind and cash/team use distinct canonical D-pad bindings',
);
for (const hz of [60, 90, 120]) {
  const gate = new MobileFrameGate();
  let frames = 0,
    elapsed = 0;
  for (let i = 0; i < hz * 10; i++)
    if (gate.ready((i * 1000) / hz, 1 / hz, true)) {
      frames++;
      elapsed += gate.dt;
    }
  ok(Math.abs(frames - 300) <= 1, `battery cap is 30 fps on ${hz} Hz display`);
  ok(
    Math.abs(elapsed - 10) < 0.04,
    'render receives accumulated time instead of slowing visual timers',
  );
}
const gate = new MobileFrameGate();
for (let i = 0; i < 120; i++)
  ok(gate.ready((i * 1000) / 120, 1 / 120, false), 'uncapped preserves display refresh');
let name = '',
  shown = '';
setupTouchEditor({
  addScreen: (n: string, el: HTMLElement) => {
    name = n;
    document.body.append(el);
  },
  show: (n: string) => {
    shown = n;
  },
} as any);
ok(
  name === 'touchlayout' && document.querySelectorAll('[data-touch]').length === 11,
  'registered editor covers both sticks and every action',
);
(document.querySelector('[data-touch=dash]') as HTMLElement).click();
const slider = document.querySelector<HTMLInputElement>('[data-position=size]')!;
slider.value = '80';
slider.dispatchEvent(new Event('input', { bubbles: true }));
ok(touchLayout.controls.dash.size === 80, 'selected control resizes independently');
ok(
  JSON.parse(localStorage.getItem('infinishoot.touch.layout.v1')!).controls.dash.size === 80,
  'layout persists locally through storage wrapper',
);
(document.querySelector('[data-reset-layout]') as HTMLElement).click();
ok(touchLayout.controls.dash.size === 60, 'reset restores both orientations');
(document.querySelector('[data-done]') as HTMLElement).click();
ok(shown === 'settings', 'done returns to settings');
console.log('Mobile layout, bindings, migration, editor and frame pacing passed');

(globalThis as any).requestAnimationFrame = () => 0;
const { GameLoop } = await import('../src/core/loop');
let updates = 0,
  renders = 0,
  renderTime = 0;
const loop = new GameLoop({
  update: () => updates++,
  render: (_a, dt) => {
    renders++;
    renderTime += dt;
  },
  runHidden: () => false,
  batterySaver: () => true,
});
(loop as any).running = true;
for (let i = 1; i <= 600; i++) (loop as any).frame((i * 1000) / 60);
ok(
  Math.abs(updates - 600) <= 1 && Math.abs(renders - 300) <= 1,
  'battery saver preserves 60 Hz fixed simulation while rendering 30 Hz',
);
ok(Math.abs(renderTime - 10) < 0.04, 'capped loop preserves elapsed render time');

// Service worker lifecycle in an isolated scope: atomic install, offline navigation, version cleanup.
const { readFileSync } = await import('node:fs');
const { runInNewContext } = await import('node:vm');
const handlers: Record<string, (event: any) => void> = {};
const stores = new Map<string, Map<string, Response>>();
const other = 'infinishoot:/another-game/:old';
stores.set(other, new Map());
const old = 'infinishoot:/game/:old';
stores.set(old, new Map());
let fetched = '',
  claimed = false;
const cacheApi = {
  keys: async () => [...stores.keys()],
  delete: async (key: string) => stores.delete(key),
  open: async (key: string) => {
    if (!stores.has(key)) stores.set(key, new Map());
    const entries = stores.get(key)!;
    return {
      addAll: async (reqs: Request[]) => {
        for (const r of reqs) entries.set(r.url, new Response(r.url));
      },
      match: async (url: string) => entries.get(url.split('?')[0]),
    };
  },
};
const worker = readFileSync('public/sw.js', 'utf8')
  .replace('__BUILD_VERSION__', 'new')
  .replace('/* __PRECACHE__ */ []', JSON.stringify(['index.html', 'assets/game.js']));
runInNewContext(worker, {
  URL,
  Request,
  Response,
  caches: cacheApi,
  fetch: async (req: Request) => {
    fetched = req.url;
    return new Response('network');
  },
  self: {
    location: { href: 'https://example.test/game/sw.js' },
    clients: {
      claim: async () => {
        claimed = true;
      },
    },
    addEventListener: (name: string, fn: (e: any) => void) => (handlers[name] = fn),
  },
});
let pending = Promise.resolve();
const event = { waitUntil: (p: Promise<void>) => (pending = p) };
handlers.install(event);
await pending;
ok(
  stores.get('infinishoot:/game/:new')?.size === 2,
  'installation caches every declared file under the deployment base',
);
ok(stores.has(old), 'install preserves active version until activation');
handlers.activate(event);
await pending;
ok(
  claimed && !stores.has(old) && stores.has(other),
  'activation deletes only this deployment’s obsolete caches',
);
let response: Promise<Response> | undefined;
handlers.fetch({
  request: { method: 'GET', url: 'https://example.test/game/?run=1', mode: 'navigate' },
  respondWith: (p: Promise<Response>) => (response = p),
});
ok(
  (await (await response!).text()) === 'https://example.test/game/index.html' && !fetched,
  'offline navigation serves the active cached shell',
);
response = undefined;
handlers.fetch({
  request: { method: 'GET', url: 'https://other.test/api' },
  respondWith: (p: Promise<Response>) => (response = p),
});
ok(!response, 'external APIs are never intercepted');
handlers.fetch({
  request: { method: 'GET', url: 'https://example.test/game/api', mode: 'cors' },
  respondWith: (p: Promise<Response>) => (response = p),
});
await response;
ok(fetched === 'https://example.test/game/api', 'unknown same-origin URLs go to the network');
