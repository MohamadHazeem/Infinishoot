/**
 * Arena lane, co-op: a host Game and a client Game wired together in-process
 * (jsdom, no WebGL). Checks that toys, cover, pillars, turrets, jumps and the
 * objective stay in sync through the snapshot and the 'jump' message.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window as unknown as Record<string, unknown>;
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop),
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, { get: (_t, k) => (k === 'createImageData' || k === 'getImageData' ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) }) : k === 'canvas' ? this : noop[k as never]) });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent']) {
  try { (globalThis as any)[k] = (dom.window as any)[k]; } catch { Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true }); }
}
(globalThis as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'smoke';
(dom.window as any).Path2D = (globalThis as any).Path2D;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};

(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
// Any crash must fail the test (a rejected top-level await can otherwise exit 0 silently).
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});

const errors: string[] = [];
process.on('uncaughtException', (e) => errors.push('uncaught ' + e.stack));

const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { cheats } = await import('../src/game/game');
const { unlockedWeapons } = await import('../src/game/save');
cheats.god = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const A = mk();
const B = mk();
const q: [any, any][] = [];
(A as any).role = 'host';
(A as any).host = { send: (id: string, m: any) => q.push([B, m]), broadcast: (m: any) => q.push([B, m]), close() {} };
(B as any).role = 'client';
(B as any).client = { send: (m: any) => q.push([A, m]), close() {} };
const flush = () => { while (q.length) { const [g, m] = q.shift()!; if (g === A) A.onHostMessage('peerB', structuredClone(m)); else B.onClientMessage(structuredClone(m)); } };
A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons()), A.makeHero(1, 'Guest', [], 'peerB')]);
A.startRun();
flush();
if (A.mode === 'shop') A.closeShop();
flush();
console.log('modes', A.mode, B.mode, 'stageB', B.stage, 'objective', A.toys.objective.kind, B.toys.objective.kind);
const step = (n: number) => { for (let i = 0; i < n; i++) { A.update(1 / 60); flush(); B.update(1 / 60); flush(); } };
step(30);
ok(A.toys.props.length === B.toys.props.length && A.toys.pads.length === B.toys.pads.length && A.toys.objective.kind === B.toys.objective.kind, 'client builds the same toys and objective');
// Break a crate and topple a pillar on the host.
const crate = A.toys.props.findIndex((p) => p.def.kind !== 'pillar');
const pil = A.toys.props.findIndex((p) => p.def.kind === 'pillar');
const nCol = B.arena.colliders.length;
A.damageProp(A.toys.props[crate], 1e6, 0, 1, 0);
A.damageProp(A.toys.props[pil], 1e6, 0, 0, 1);
step(60);
ok(!B.toys.props[crate].alive && B.toys.props[pil].fallT >= 0 && B.arena.colliders.length === nCol - 2, 'client mirrors broken cover and falling pillars (colliders gone)');
ok(A.toys.props[pil].crushed, 'pillar landed on the host');
// Guest walks onto a turret pad.
const t = A.toys.turrets[0];
B.hero.player.teleport(t.x, t.z + 0.5);
step(20);
ok(A.toys.turrets[0].t > 0 && B.toys.turrets[0].t > 0 && A.toys.turrets[0].owner === 1, 'guest switches a turret on; client sees it');
// Guest takes a jump pad.
const pad = A.toys.pads[0];
B.hero.player.teleport(pad.x, pad.z);
step(4);
const jumpingA = !!A.toys.jumps[1];
const yB = B.toys.jumpT01(1, false);
step(60);
const d = Math.hypot(B.hero.player.x - pad.tx, B.hero.player.z - pad.tz);
ok(jumpingA && yB >= 0 && d < 1.5, `guest jump runs on both machines and lands on target (${d.toFixed(2)} m)`);
console.log('A sees B jumping', jumpingA, 'B t01', yB);
// Objective progress reaches the client.
const o = A.toys.objective;
if (o.kind === 'shards') { const s = A.toys.shards[0]; B.hero.player.teleport(s.x, s.z); step(20); }
else if (o.kind === 'totems') { A.damageTotem(A.toys.totems[0], 1e6, 0); step(10); }
else if (o.kind === 'envkills') { o.progress(); step(10); }
else { const b = A.toys.beacon!; B.hero.player.teleport(b.x, b.z); step(120); }
console.log('objective', o.kind, A.toys.objective.cur, B.toys.objective.cur);
ok(A.toys.objective.cur > 0 && Math.abs(A.toys.objective.cur - B.toys.objective.cur) < 0.6, 'objective progress mirrors to the client');
o.progress(99);
A.completeObjective(0, 0);
step(10);
ok(B.toys.objective.state === 'done', 'completion mirrors');
ok(errors.length === 0, 'no runtime errors' + (errors.length ? ':\n' + errors.slice(0, 3).join('\n') : ''));
process.exit(process.exitCode ?? 0);
