/**
 * Shared headless game environment (jsdom, no WebGL) for the stability tests and the
 * jsdom crash fuzzer (scripts/fuzz.mjs). Same stubs as tests/smoke.test.ts, plus:
 * - `jsdomErrors`: jsdom's own errors (script errors in handlers), minus its "Not implemented" notes
 * - `simTimers`: optional fake setTimeout/setInterval on the simulation clock, so a test link's
 *   deferred actions (`ultgo=2`, `photo=1`...) fire in game time even though bot steps are synchronous
 * Import it first (before any src/ module).
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';

export const jsdomErrors: string[] = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e: Error) => {
  if (/Not implemented/.test(e.message)) return;
  jsdomErrors.push('jsdom: ' + (e.stack ?? e.message));
});

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
export const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, virtualConsole: vc });
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop),
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, { get: (_t, k) => (k === 'createImageData' || k === 'getImageData' ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) }) : k === 'canvas' ? this : noop[k as never]) });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
(dom.window.HTMLCanvasElement.prototype as any).toBlob = function (cb: (b: Blob | null) => void) { cb(null); };
for (const k of ['window', 'document', 'navigator', 'localStorage', 'location', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent', 'WheelEvent', 'Image', 'HTMLImageElement']) {
  try { (globalThis as any)[k] = (dom.window as any)[k]; } catch { Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true }); }
}
(globalThis as any).Path2D = (dom.window as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'test';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

/** Seeds Math.random (reproducible fuzz runs and tests). */
export function seedRandom(seed: number): void {
  let rs = seed | 0 || 0x9e3779b9;
  Math.random = () => {
    rs = (Math.imul(rs ^ (rs >>> 15), 1 | rs) + 0x6d2b79f5) | 0;
    return ((rs ^ (rs >>> 14)) >>> 0) / 4294967296;
  };
}

type Timer = { id: number; at: number; every: number; fn: () => void };
/** Fake timers on a simulation clock (ms); `advance(ms)` fires what's due, errors go to `onError`. */
export const simTimers = {
  now: 0,
  list: [] as Timer[],
  nextId: 1,
  onError: (e: unknown) => { throw e; },
  install(): void {
    const add = (fn: unknown, ms: unknown, every: boolean) => {
      if (typeof fn !== 'function') return 0;
      const d = Math.max(0, Number(ms) || 0);
      const t: Timer = { id: this.nextId++, at: this.now + d, every: every ? Math.max(1, d) : 0, fn: fn as () => void };
      this.list.push(t);
      return t.id;
    };
    const clear = (id: unknown) => {
      const i = this.list.findIndex((t) => t.id === id);
      if (i >= 0) this.list.splice(i, 1);
    };
    for (const g of [globalThis as any, dom.window as any]) {
      g.setTimeout = (fn: unknown, ms?: unknown) => add(fn, ms, false);
      g.setInterval = (fn: unknown, ms?: unknown) => add(fn, ms, true);
      g.clearTimeout = clear;
      g.clearInterval = clear;
    }
  },
  advance(ms: number): void {
    const end = this.now + ms;
    for (let guard = 0; guard < 10000; guard++) {
      let next: Timer | null = null;
      for (const t of this.list) if (t.at <= end && (!next || t.at < next.at)) next = t;
      if (!next) break;
      this.now = Math.max(this.now, next.at);
      if (next.every) next.at += next.every;
      else this.list.splice(this.list.indexOf(next), 1);
      try {
        next.fn();
      } catch (e) {
        this.onError(e);
      }
    }
    this.now = end;
  },
};
