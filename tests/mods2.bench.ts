/** Reproducible 60s bot probe: MOD=id|none, COMBO=0|1, LV=1|2.
 * All runs use the same seeded host + stationary support ally. The bot attacks
 * normal hordes; successful skill events are scheduled to measure trigger uptime.
 * This is a controlled build comparison, not a prediction of human survival.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const noop: any = new Proxy(function () {}, {
  get: (_t, k) =>
    k === 'data'
      ? new Uint8ClampedArray(4 * 64 * 64)
      : k === Symbol.toPrimitive
        ? () => 0
        : k === 'measureText'
          ? () => ({ width: 10 })
          : noop,
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, {
    get: (_t, k) =>
      k === 'createImageData' || k === 'getImageData'
        ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) })
        : k === 'canvas'
          ? this
          : noop[k as never],
  });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
for (const k of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'HTMLElement',
  'HTMLCanvasElement',
  'HTMLInputElement',
  'Event',
  'KeyboardEvent',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'innerWidth',
  'innerHeight',
  'addEventListener',
  'dispatchEvent',
  'Node',
  'MouseEvent',
  'PointerEvent',
]) {
  try {
    (globalThis as any)[k] = (dom.window as any)[k];
  } catch {
    Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true });
  }
}
(globalThis as any).Path2D = (dom.window as any).Path2D = class {
  constructor(_d?: string) {}
};
(globalThis as any).__APP_VERSION__ = 'bench';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});

const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { Rng } = await import('../src/core/rng');
const { installBot } = await import('../src/dev/bot');
const { settings } = await import('../src/game/settings');
const { MOD_BY_ID } = await import('../src/data/mods');
const { createWeapon } = await import('../src/game/weapons');
const { WEAPONS } = await import('../src/data/weapons');
const { mechTuning, crateTuning, mutationTuning } = await import('../src/game/gameplay');
mechTuning.dropChance = mechTuning.eliteChance = 0;
crateTuning.first = 1e9;
mutationTuning.enabled = false;
const seed = Number(process.env.SEED ?? 42);
let rand = seed;
Math.random = () => {
  rand = (Math.imul(rand, 1664525) + 1013904223) | 0;
  return (rand >>> 0) / 4294967296;
};
const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new Input(canvas);
const g = new Game(
  input,
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
installBot(g, input);
settings.mode = 'standard';
settings.difficulty = 'normal';
settings.hero = 'rookie';
settings.pet = 'none';
settings.loadout = { primary: 'buster', secondary: 'charge', special: 'bomb' };
g.setHeroes([
  g.makeHero(0, 'Bot', Object.keys(WEAPONS)),
  g.makeHero(1, 'Support', Object.keys(WEAPONS)),
]);
g.startRun();
if (g.mode === 'shop') g.closeShop();
g.rng = new Rng(seed);
const h = g.hero,
  ally = g.heroes[1];
const id = process.env.MOD ?? 'none';
const combo = process.env.COMBO === '1';
const lv = Number(process.env.LV ?? 2);
const def = MOD_BY_ID[id];
// Support-family ownership: the primary bot is the recipient of auras and
// the caster of novas. Signal Flare/Blood Bond are worn by the support hero.
const owner = ['pit_crew', 'signal_flare', 'blood_bond'].includes(id) ? ally : h;
if (def) {
  owner.synergy.add(def);
  for (let i = 1; i < lv; i++) owner.synergy.upgrade(0);
}
if (combo) {
  for (const hero of g.heroes) {
    for (const w of ['fire', 'nova', 'drones', 'lightning']) {
      const weapon = createWeapon(w, g.scene);
      weapon.levelUp();
      weapon.levelUp();
      hero.weapons.push(weapon);
    }
  }
}
for (const hero of g.heroes) {
  hero.passives.nanobots = 1;
  hero.recomputeStats();
}
// Avoid unrelated level-up/shop choices so every run retains the intended kit.
g.xpNext = 1e9;
// Optional sustained-target probe: remove spawn/kill caps so stronger damage
// is not hidden by overkill. The same bot kites twelve durable chasing Chonks.
const probe = process.env.PROBE === '1';
if (probe) {
  const { ENEMIES } = await import('../src/data/enemies');
  g.enemies.clear();
  const requests: ReturnType<typeof g.director.update> = [];
  g.director.update = () => requests;
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    const e = g.enemies.spawn(ENEMIES.chonk, h.player.x + Math.cos(angle) * 6, h.player.z + Math.sin(angle) * 6, g.spawnOpts({}));
    e.state = 'move'; e.hp = e.maxHp = 1e7;
  }
}
const update = g.update.bind(g);
let step = 0,
  damage = 0,
  healing = 0,
  protectedTime = 0,
  auraTime = 0;
const damageFn = g.damage;
g.damage = function (e, base, o, by) {
  const before = e.hp + e.shield;
  const out = damageFn.call(this, e, base, o, by);
  damage += Math.min(before, Math.max(0, before - e.hp - e.shield));
  return out;
};
g.update = (dt) => {
  // A support buddy follows 1m behind, within every ally radius.
  ally.player.pos.x = h.player.x - 1;
  ally.player.pos.z = h.player.z;
  if (step % 900 === 0) {
    // Successful event injection: fixed 15s opportunities for every trigger,
    // including rare rewind/mech/chest events. Actual call sites have unit coverage.
    for (const hero of g.heroes)
      for (const event of [
        'parry',
        'perfectDash',
        'ultimate',
        'cashIn',
        'rewind',
        'mechExit',
        'chest',
      ] as const)
        g.mods2Event(hero, event);
  }
  if (step % 60 === 0) {
    // Ten genuine recovered HP per second is the shared-heal probe.
    h.player.hp = h.player.maxHp / 2;
    ally.player.hp = ally.player.maxHp / 2;
    const before = h.player.hp;
    g.mods2Heal(ally, ally.player.heal(10));
    healing += h.player.hp - before;
  }
  update(dt);
  if (h.player.invuln > 0) protectedTime += dt;
  if (h.stats.cooldownMul < 1) auraTime += dt;
  step++;
};
let laneMs = 0;
if (process.env.LANE_PERF === '1') {
  for (const name of ['mods2Position', 'mods2Auras', 'mods2Crit', 'mods2Event', 'mods2Heal'] as const) {
    const fn = g[name] as Function;
    (g as any)[name] = function (...args: unknown[]) {
      const start = performance.now();
      const out = fn.apply(this, args);
      laneMs += performance.now() - start;
      return out;
    };
  }
}
const report = (window as any).botRun(Number(process.env.SECS ?? 60), true);
console.log(
  JSON.stringify({
    id,
    probe,
    combo,
    lv,
    seed,
    kills: report.kills,
    damage: Math.round(damage),
    sharedHeal: +healing.toFixed(1),
    laneMsPerStep: +(laneMs / Math.max(1, step)).toFixed(4),
    protectedTime: +protectedTime.toFixed(1),
    auraTime: +auraTime.toFixed(1),
    avgMs: report.avgMs,
    by: h.damageBy,
    support: ally.damageBy,
  }),
);
process.exit(0);
