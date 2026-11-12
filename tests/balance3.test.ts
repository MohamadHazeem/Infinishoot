import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

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
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent']) {
  try { (globalThis as any)[k] = (dom.window as any)[k]; } catch { Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true }); }
}
(globalThis as any).Path2D = (dom.window as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'test';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});
const assert = (await import('node:assert/strict')).default;
const { Input } = await import('../src/core/input');
const { Game, cheats, BULLET_KINDS, statusTuning } = await import('../src/game/game');
const { ENEMIES } = await import('../src/data/enemies');
const { WEAPONS } = await import('../src/data/weapons');
const { Team } = await import('../src/game/bullets');
const { Shield } = await import('../src/game/weapons/shield');
const { settings } = await import('../src/game/settings');
const { ascensionRules } = await import('../src/data/ascension');
const g = new Game(new Input(document.getElementById('game') as HTMLCanvasElement), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
settings.bossIntros = false;
settings.finishers = false;
g.startRun({ seed: 42 });
if (g.mode === 'shop') g.closeShop();
g.enemies.clear(); g.bullets.clear();
const h = g.hero;
h.player.teleport(0, 0); h.player.aim.x = 1; h.player.aim.z = 0;
h.ctx.charging = true;
const begin = (evo = -1) => {
  g.enemies.clear(); g.bullets.clear();
  const w = new Shield(WEAPONS.shield, g.scene);
  if (evo >= 0) { for (let i = 0; i < 9; i++) w.addRank(i % 3); w.evolve(evo); }
  w.update(0.51, h.ctx);
  return w;
};
const end = (w: InstanceType<typeof Shield>) => {
  h.ctx.charging = false;
  for (let i = 0; i < 600 && w.net()[0]; i++) w.update(1 / 60, h.ctx);
  h.ctx.charging = true;
  return (w as any).cd as number;
};
const shot = (team = Team.Enemy, damage = 2, x = 0.7) => g.bullets.spawn({ x, z: 0, dirX: -1, dirZ: 0, speed: 4, life: 4, radius: 0.1, damage, knockback: 0, team, color: '#73eff7', owner: team === Team.Enemy ? -1 : 0 });
const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

// A whiff, own bullets, and shots behind the facing arc do not earn a refund.
let w = begin(); shot(Team.Player); shot(Team.Enemy, 2, -0.7); w.update(1 / 60, h.ctx);
near(end(w), w.p.cd); w.dispose();
// A blocked shot rewards the next recharge exactly once, even in a barrage.
for (const evo of [-1, 0, 1]) {
  w = begin(evo);
  for (let i = 0; i < 8; i++) shot();
  w.update(1 / 60, h.ctx);
  assert.equal(g.bullets.team[0], Team.Player);
  assert.equal(g.bullets.owner[0], h.index);
  assert.equal(BULLET_KINDS[g.bullets.kind[0]].source, 'shield');
  near(end(w), w.p.cd * (1 - w.p.refund));
  // The earned reduction cannot leak into the next empty deployment.
  g.bullets.clear(); w.update((w as any).cd + 0.01, h.ctx);
  near(end(w), w.p.cd); w.dispose();
}
// Even the bullet that breaks the shield earns the reward.
w = begin(); shot(Team.Enemy, 1000); w.update(0, h.ctx);
assert.equal(w.net()[0], 0); near((w as any).cd, w.p.cd * (1 - w.p.refund)); w.dispose();
// A successful bash earns the same bounded refund; cooldown modifiers still apply.
w = begin();
const e = g.enemies.spawn(ENEMIES.chonk, 1, 0, { instant: true, hpMul: 100 });
e.state = 'move';
g.hash.clear(); g.hash.insert(e, e.x, e.z, e.radius);
for (let i = 0; i < 20; i++) w.update(1 / 60, h.ctx);
assert(e.exposeT > 0 && e.exposeT <= statusTuning.exposeTime);
h.stats.cooldownMul = 0.8; h.stats.chargeSpeed = 1.25;
near(end(w), w.p.cd * (1 - w.p.refund) * 0.8 / 1.25); w.dispose();
h.stats.cooldownMul = h.stats.chargeSpeed = 1;
// A rejected hit on an invulnerable target must not earn a bash reward.
w = begin();
const damage = h.ctx.damage, inRadius = h.ctx.inRadius;
h.ctx.inRadius = (_x, _z, _r, out) => { out.length = 0; out.push(e); return out; };
h.ctx.damage = () => 0;
w.update(0.3, h.ctx);
near(end(w), w.p.cd); w.dispose(); h.ctx.damage = damage; h.ctx.inRadius = inRadius;

// High Ascension cannot bypass the same player hit cap or hurt i-frames.
cheats.god = false;
h.player.hp = h.player.maxHp; h.player.invuln = 0;
const max = h.player.maxHp;
g.hurtHero(h, 1e6, 1, 0, null, 'Shockwave');
assert(h.player.hp >= max * 0.65 - 0.5);
const hp = h.player.hp;
g.hurtHero(h, 1e6, 1, 0, null, 'Shockwave');
assert.equal(h.player.hp, hp);
for (const key of ['hp', 'damage', 'speed', 'count', 'attacks'] as const) {
  const steps: number[] = [];
  for (let a = 1; a <= 20; a++) {
    const delta = ascensionRules(a)[key] - ascensionRules(a - 1)[key];
    assert(delta >= 0);
    if (delta) steps.push(delta);
  }
  for (let i = 1; i < steps.length; i++) assert(Math.max(steps[i] / steps[i - 1], steps[i - 1] / steps[i]) <= 2 + 1e-9);
}
const intervals = [0, 6, 13, 19].map(a => 30 / ascensionRules(a).chest);
assert.deepEqual(intervals, [30, 60, 90, 150]);
const steps = intervals.slice(1).map((n, i) => n - intervals[i]);
for (let i = 1; i < steps.length; i++) assert(steps[i] <= steps[i - 1] * 2);
console.log('ok   Aegis earns a bounded recharge refund, retains ownership/Expose, and Ascension respects hit protection');
