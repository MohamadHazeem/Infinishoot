/** Item sets bot probe (not a unit test; see notes/lanes/sets.md).
 *   MODE=probe SET=inferno:4 [BONUS=0] SECS=60 SEED=42: same kit vs 12 durable chasing Chonks;
 *     BONUS=0 keeps the same pieces but turns the set bonuses off, so the ratio is the bonus alone.
 *   MODE=natural SECS=1100: god bot plays a normal run and reports the set tiers it reaches per stage.
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
const { WEAPONS } = await import('../src/data/weapons');
const { ENEMIES } = await import('../src/data/enemies');
const { SETS, SET_PIECES, setTier } = await import('../src/data/sets');
const { setsLinks } = await import('../src/dev/setsLinks');
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
const g = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
installBot(g, input);
settings.mode = 'standard';
settings.difficulty = 'normal';
settings.hero = 'rookie';
settings.pet = 'none';
settings.loadout = { primary: 'buster', secondary: 'charge', special: 'bomb' };
g.setHeroes([g.makeHero(0, 'Bot', Object.keys(WEAPONS))]);
g.startRun();
if (g.mode === 'shop') g.closeShop();
g.rng = new Rng(seed);
const h = g.hero;
const secs = Number(process.env.SECS ?? 60);
const total = () => Object.values(h.damageBy).reduce((a, b) => a + b, 0);

if ((process.env.MODE ?? 'probe') === 'natural') {
  const rows: string[] = [];
  let last = 0;
  for (let t = 0; t < secs; t += 20) {
    (window as any).botRun(20, true);
    const tiers = SETS.map((d, i) => (h.sets.counts[i] >= 2 ? `${d.id}:${h.sets.counts[i]}(t${setTier(h.sets.counts[i])})` : '')).filter(Boolean);
    if (g.stage !== last || t + 20 >= secs) rows.push(`st${g.stage} lv${g.level} ${tiers.join(' ') || '-'}`);
    last = g.stage;
  }
  const setDmg = Object.entries(h.damageBy).filter(([k]) => k.startsWith('set_')).map(([k, v]) => `${k}=${Math.round(v)}`);
  console.log(JSON.stringify({ seed, rows, setDamage: setDmg, setShare: +(Object.entries(h.damageBy).filter(([k]) => k.startsWith('set_')).reduce((a, [, v]) => a + v, 0) / total()).toFixed(3) }));
  process.exit(0);
}

const spec = process.env.SET ?? 'none';
// Same auto weapons in both arms, so the set's own weapons are always there.
const KIT: Record<string, string[]> = { inferno: ['fire'], storm: ['lightning', 'aura'], glacier: ['nova'], boomsmith: ['missiles', 'mines'], machinist: ['drones'], speedster: ['fire'], bulwark: ['drones'], duelist: ['lightning'] };
for (const w of KIT[spec.split(':')[0]] ?? []) {
  g.debugGiveWeapon(w);
  for (let i = 0; i < 3; i++) g.debugGiveWeapon(w);
}
if (spec !== 'none') setsLinks(g, new URLSearchParams(`set=${spec}`));
if (process.env.BONUS === '0') for (const k of Object.keys(SET_PIECES)) delete (SET_PIECES as Record<string, unknown>)[k];
h.recomputeStats();
g.xpNext = 1e9;
g.enemies.clear();
const none: ReturnType<typeof g.director.update> = [];
g.director.update = () => none;
const HP = Number(process.env.HP ?? 2500);
const top = () => {
  let n = g.enemies.list.filter((e) => e.active).length;
  for (; n < 16; n++) {
    const a = Math.random() * Math.PI * 2;
    const e = g.enemies.spawn(ENEMIES.chonk, h.player.x + Math.cos(a) * 7, h.player.z + Math.sin(a) * 7, g.spawnOpts({}));
    e.state = 'move';
    e.hp = e.maxHp = HP;
  }
};
const d0 = total();
const hp0 = h.player.hp;
const k0 = g.kills;
for (let t = 0; t < secs; t++) {
  top();
  (window as any).botRun(1, true);
}
const by = Object.entries(h.damageBy).filter(([k]) => k.startsWith('set_')).map(([k, v]) => `${k}=${Math.round(v)}`);
console.log(JSON.stringify({ set: spec, bonus: process.env.BONUS !== '0', seed, dps: Math.round((total() - d0) / secs), kills: g.kills - k0, counts: Array.from(h.sets.counts).join(''), setSources: by, hp: [hp0, h.player.hp] }));
process.exit(0);
