/**
 * Eightp lane: an in-process co-op team of up to 8 players (jsdom, no WebGL):
 * one host Game and n-1 client Games wired by peer id, messages structured-
 * cloned and delivered on flush(), like the other *Coop tests. Every machine
 * can be driven by the autopilot brain through its own Input (the way the dev
 * bot does it), so clients really move, aim and fire and the host only sees
 * their `i` messages. Snapshots are measured as PeerJS would put them on the
 * wire (binarypack bytes). Used by tests/eightp.test.ts and scripts/coop8.mjs.
 * Not a test file itself (no .test.ts), so `npm test` doesn't run it alone.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { pack } from 'peerjs-js-binarypack';

export async function bootDom(): Promise<void> {
  const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  const noop: any = new Proxy(function () {}, {
    get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop),
    apply: () => noop,
    set: () => true,
  });
  (dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
    return new Proxy(noop, { get: (_t, k) => (k === 'createImageData' || k === 'getImageData' ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) }) : k === 'canvas' ? this : noop[k as never]) });
  };
  (dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
  for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent', 'location', 'history']) {
    try {
      (globalThis as any)[k] = (dom.window as any)[k];
    } catch {
      Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true });
    }
  }
  (globalThis as any).Path2D = (dom.window as any).Path2D = class {
    constructor(_d?: string) {}
  };
  (globalThis as any).__APP_VERSION__ = 'test';
  (dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
  (globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  (dom.window.navigator as any).getGamepads = () => [];
}

export interface TeamStats {
  /** Snapshot bytes (binarypack) per client peer id. */
  snapBytes: Map<string, number[]>;
  /** Host Game.update() time per step (ms), and buildSnapshot time per call (ms). */
  hostMs: number[];
  snapMs: number[];
  /** Snapshot build time per host step (all clients' snapshots built in that step), ms. */
  snapStepMs: number[];
  /** Other host -> client messages (bytes), client -> host messages (bytes). */
  otherBytes: number;
  upBytes: number;
  /** The largest snapshot and its fields' sizes; total bytes per binary field (b body, en enemies, pk pickups, bd bullets, fx effects). */
  biggest: { bytes: number; parts: Record<string, number> };
  parts: Record<string, number>;
}

/** Build a team: host + (n - 1) clients, in the online lobby, then start the run through hostStart(). */
export async function makeTeam(n: number, opts: { bots?: boolean; renderEvery?: number } = {}) {
  const { Input } = await import('../src/core/input');
  const { Game } = await import('../src/game/game');
  const { Autopilot } = await import('../src/game/autopilot');
  const { unlockedWeapons } = await import('../src/game/save');
  const { validLoadout, DEFAULT_LOADOUT } = await import('../src/data/loadout');
  const THREE = await import('three');
  type G = InstanceType<typeof Game>;
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const newRoot = () => {
    const r = document.createElement('div');
    document.body.appendChild(r);
    return r;
  };
  const inputs = new Map<G, InstanceType<typeof Input>>();
  const mk = () => {
    const input = new Input(canvas);
    const g = new Game(input, 16 / 9, newRoot(), document.createElement('div'));
    inputs.set(g, input);
    return g;
  };
  const stats: TeamStats = { snapBytes: new Map(), hostMs: [], snapMs: [], snapStepMs: [], otherBytes: 0, upBytes: 0, biggest: { bytes: 0, parts: {} }, parts: {} };
  const A = mk();
  const peers = new Map<string, G>();
  const q: [G, any, string][] = [];
  let measure = true;
  const size = (m: any) => {
    try {
      return (pack(m) as ArrayBuffer).byteLength;
    } catch {
      return JSON.stringify(m).length;
    }
  };
  const down = (id: string, m: any) => {
    if (!measure) return;
    if (m?.t === 's') {
      let l = stats.snapBytes.get(id);
      if (!l) stats.snapBytes.set(id, (l = []));
      const n = size(m);
      l.push(n);
      if (n > stats.biggest.bytes) {
        stats.biggest.bytes = n;
        stats.biggest.parts = Object.fromEntries(Object.entries(m).map(([k, x]) => [k, x instanceof Uint8Array || x instanceof ArrayBuffer ? x.byteLength : JSON.stringify(x ?? null).length]));
      }
      for (const [k, x] of Object.entries(m)) if (x instanceof Uint8Array || x instanceof ArrayBuffer) stats.parts[k] = (stats.parts[k] ?? 0) + x.byteLength;
    } else stats.otherBytes += size(m);
  };
  (A as any).role = 'host';
  (A as any).host = {
    code: 'EIGHT',
    max: 7,
    get clientIds() {
      return [...peers.keys()];
    },
    get size() {
      return peers.size;
    },
    lastHeard: new Map<string, number>(),
    send: (id: string, m: any) => {
      const g = peers.get(id);
      if (!g) return;
      down(id, m);
      q.push([g, m, '']);
    },
    broadcast: (m: any) => {
      for (const [id, g] of peers) {
        down(id, m);
        q.push([g, m, '']);
      }
    },
    kick() {},
    drop() {},
    close() {},
  };
  const clients: G[] = [];
  for (let i = 1; i < n; i++) {
    const g = mk();
    const id = `peer${i}`;
    peers.set(id, g);
    (g as any).role = 'client';
    (g as any).client = {
      open: true,
      code: 'EIGHT',
      lastHeard: performance.now(),
      send: (m: any) => {
        if (measure) stats.upBytes += size(m);
        q.push([A, m, id]);
      },
      close() {},
      drop() {},
    };
    g.netName = `P${i + 1}`;
    clients.push(g);
  }
  const flush = () => {
    for (let guard = 0; q.length && guard < 20000; guard++) {
      const [g, m, from] = q.shift()!;
      if (g === A) A.onHostMessage(from, structuredClone(m));
      else {
        // A client that left (e.g. refused with 'full') has no connection: say which and why instead of a null crash.
        if (!(g as any).client) throw new Error(`eightp harness: ${g.netName} has no connection (it left or was refused) when the host sent ${JSON.stringify(m).slice(0, 120)}`);
        (g as any).client.lastHeard = performance.now();
        const wasFull = m && (m as { t?: string }).t === 'full';
        g.onClientMessage(structuredClone(m));
        if (wasFull) throw new Error(`eightp harness: the host refused ${g.netName}: ${String((m as { reason?: string }).reason)}`);
      }
    }
  };
  // Snapshot build time on the host.
  let stepSnap = 0;
  const build = A.buildSnapshot.bind(A);
  (A as any).buildSnapshot = (h: any, ev: any) => {
    const t = performance.now();
    const r = build(h, ev);
    const ms = performance.now() - t;
    if (measure) stats.snapMs.push(ms);
    stepSnap += ms;
    return r;
  };

  // Bot input per machine: the autopilot brain fed through that machine's own Input (src/dev/bot.ts style).
  const v = new THREE.Vector3();
  const drive = (g: G) => {
    const input = inputs.get(g)! as any;
    const pilot = new Autopilot();
    const poll = input.poll.bind(input);
    input.poll = () => {
      input.keys.clear();
      if (g.mode === 'fight' && !g.player.dead) {
        const o = pilot.decide(g);
        const l = Math.hypot(o.mx, o.mz) || 1;
        if (Math.abs(o.mx / l) > 0.3) input.keys.add(o.mx > 0 ? 'KeyD' : 'KeyA');
        if (Math.abs(o.mz / l) > 0.3) input.keys.add(o.mz > 0 ? 'KeyS' : 'KeyW');
        if (o.target) {
          v.set(o.target.x, 1.05, o.target.z).project(g.cam.camera);
          input.mouse.ndcX = v.x;
          input.mouse.ndcY = v.y;
        }
        input.mouseButtons = o.target ? 1 | (o.charge ? 4 : 0) : 0;
        if (o.dash) input.pressed.add('Space');
        if (o.special) input.pressed.add('KeyQ');
        if (o.ult) input.pressed.add('KeyV');
      } else input.mouseButtons = 0;
      poll();
      input.device = 'kbm';
    };
  };
  if (opts.bots) for (const g of [A, ...clients]) drive(g);

  const renderEvery = opts.renderEvery ?? 6;
  let stepN = 0;
  const menus = () => {
    if (A.mode === 'levelup') {
      for (const g of [A, ...clients]) (g as any).ui('pick', 0);
      flush();
    }
    if (A.mode === 'shop' || A.screens.current === 'shop') {
      for (const g of [A, ...clients]) (g as any).ui('done');
      flush();
    }
  };
  const step = (k: number) => {
    for (let i = 0; i < k; i++) {
      inputs.get(A)!.poll(); // the live loop polls before each step (bot input when driven)
      const t = performance.now();
      stepSnap = 0;
      A.update(1 / 60);
      if (measure) {
        stats.hostMs.push(performance.now() - t);
        stats.snapStepMs.push(stepSnap);
      }
      flush();
      for (const c of clients) {
        inputs.get(c)!.poll();
        c.update(1 / 60);
        flush();
      }
      if (++stepN % renderEvery === 0) {
        A.render(1, renderEvery / 60);
        for (const c of clients) c.render(1, renderEvery / 60);
      }
      menus();
    }
  };

  // Lobby: everyone says hello, then the host starts the run.
  A.netName = 'Host';
  A.lobbyKind = 'coop';
  A.lobby = [{ peerId: '', name: 'Host', unlocked: unlockedWeapons(), loadout: validLoadout(DEFAULT_LOADOUT), skin: 'classic', pet: 'none', hero: 'rookie' }];
  const heroIds = ['bulwark', 'ace', 'dash', 'rookie', 'twin', 'duelist', 'furnace'];
  clients.forEach((c, i) => {
    A.onHostMessage(`peer${i + 1}`, { t: 'hello', pid: `pid8p${i}abcdef`, name: c.netName, unlocked: unlockedWeapons(), loadout: DEFAULT_LOADOUT, skin: 'classic', pet: 'none', hero: heroIds[i % heroIds.length] });
  });
  flush();
  return {
    A,
    clients,
    all: [A, ...clients],
    peers,
    stats,
    flush,
    step,
    menus,
    inputs,
    setMeasure(on: boolean) {
      measure = on;
    },
    resetStats() {
      stats.snapBytes.clear();
      stats.hostMs.length = 0;
      stats.snapMs.length = 0;
      stats.snapStepMs.length = 0;
      stats.otherBytes = stats.upBytes = 0;
      stats.biggest = { bytes: 0, parts: {} };
      stats.parts = {};
    },
  };
}

export function summary(xs: number[]): { avg: number; p50: number; p95: number; max: number } {
  if (!xs.length) return { avg: 0, p50: 0, p95: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b);
  return { avg: xs.reduce((a, b) => a + b, 0) / xs.length, p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
}
