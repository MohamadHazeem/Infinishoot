/** HUD feedback: numeric envelopes, pooled hits, state resets and accessibility. */
import { JSDOM } from 'jsdom';
import { PerspectiveCamera } from 'three';
import { ok } from './check';

const dom = new JSDOM('<body></body>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
}
let still = false;
let queries = 0;
(globalThis as any).matchMedia = () => {
  queries++;
  return { get matches() { return still; } };
};
const noop: any = new Proxy(function () {}, {
  get: (_target, key) => key === 'data' ? new Uint8ClampedArray(4 * 96 * 96) : noop,
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = () => noop;
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
(globalThis as any).Path2D = class {};
(globalThis as any).__APP_VERSION__ = 'test';
const { Hud, approachHud, comboTier, comboMilestone, reduceMotion } = await import('../src/ui/hud');
const { access, settings } = await import('../src/game/settings');
const { Vfx } = await import('../src/game/vfx');
const { DamageNumbers, damageNumberKind, damageNumberLabel, damageNumberValue, damageNumberScale, damageNumberTuning } = await import('../src/ui/damageNumbers');
const { MenuNav } = await import('../src/ui/menu');
const { sfx } = await import('../src/audio/sfx');

ok(comboTier(9) === 0 && comboTier(10) === 1 && comboTier(25) === 2 && comboTier(50) === 3 && comboTier(100) === 4, 'combo colour thresholds');
ok(comboMilestone(8, 12) && !comboMilestone(12, 13) && !comboMilestone(20, 0), 'milestones survive snapshot jumps and exclude resets');
const one = approachHud(0, 100, 14, 1 / 30);
const two = approachHud(approachHud(0, 100, 14, 1 / 60), 100, 14, 1 / 60);
ok(Math.abs(one - two) < 1e-9 && one > 0 && one < 100, 'counter easing is refresh-rate independent and bounded');
for (const kind of ['fire', 'shock', 'frost', 'shield'] as const) {
  const label = damageNumberLabel(40, kind);
  ok(damageNumberKind(label, 'hit') === kind && damageNumberValue(label) === 40, `${kind} label survives a plain string effects event`);
}
ok(damageNumberKind('SHIELD BROKEN!', 'crit') === 'shield', 'legacy shield-break messages get a shield style');
ok(damageNumberValue('32!') === 32 && damageNumberValue('+12') === 12, 'crit and heal values support merging');
ok(Number.isNaN(damageNumberValue('25 COMBO!')) && Number.isNaN(damageNumberValue('+1 GEAR (2/3)')), 'status labels never merge as numeric hits');
ok(damageNumberScale(5) < damageNumberScale(100) && damageNumberScale(1e9) === damageNumberTuning.maxScale, 'big hits grow but are capped');

const parent = document.createElement('div');
document.body.appendChild(parent);
const numbers = new DamageNumbers(parent);
const live = () => [...parent.children].filter(el => (el as HTMLElement).style.display !== 'none') as HTMLElement[];
const camera = new PerspectiveCamera(60, 1, 0.1, 100);
camera.position.z = 10;
camera.updateMatrixWorld();
numbers.spawn(0, 0, 0, 10);
numbers.render(0.05, camera);
numbers.spawn(0.1, 0, 0, 20);
ok(live().length === 1 && live()[0].textContent === '30', 'rapid nearby hits merge into the original pooled number');
numbers.spawn(2, 0, 0, 20);
numbers.spawn(0, 0, 0, '20!', 'crit');
ok(live().length === 3, 'different positions and critical styles remain separate');
numbers.render(0.15, camera);
numbers.spawn(0, 0, 0, 5);
ok(live().length === 4, 'hits outside the merge window start a fresh number');
numbers.render(1, camera);
ok(live().length === 0, 'all numbers expire even after merges');
for (let i = 0; i < 300; i++) numbers.spawn(i, 0, 0, 10);
ok(parent.children.length === damageNumberTuning.pool && live().length === damageNumberTuning.pool, '300 hits never grow the 48-element pool');
numbers.clear();
const bus = new Vfx({ dmg: numbers } as any);
bus.recording = true;
bus.num(0, 0, 0, damageNumberLabel(45, 'frost'));
const recorded = JSON.parse(JSON.stringify(bus.drain()));
numbers.clear();
bus.apply(recorded[0]);
ok(live().length === 1 && live()[0].className === 'dmg dmg-frost' && live()[0].textContent === '45', 'host number labels replay with the same style through the unchanged co-op effects bus');
numbers.clear();
still = true;
numbers.spawn(0, 0, 0, 10);
numbers.render(0.1, camera);
const first = live()[0].style.transform;
numbers.render(0.1, camera);
ok(first.split('translate(')[1].split('px')[0] === live()[0].style.transform.split('translate(')[1].split('px')[0], 'reduced motion removes sideways number arcs');
ok(reduceMotion() && queries === 1, 'motion preference is live and media query is cached');
still = false;
access.reduceFlash = true;
ok(reduceMotion(), 'reduce flashes also opts out of UI motion');
access.reduceFlash = false;

const root = document.createElement('div');
document.body.appendChild(root);
const hud = new Hud(root);
const state = {
  hp: 100, maxHp: 100, dash01: 1, dashStock: 1, dashMax: 1, bomb01: 1, special: 'BOMB',
  score: 0, combo: 0, multiplier: 1, combo01: 1, stage: 2, level: 1, xp01: 0.2,
  timeLeft: 10, kills: 0, gold: 0, gears: 0, boss: null, spice: [], lowHp: false,
};
const el = (selector: string) => root.querySelector<HTMLElement>(selector)!;
hud.update(state, 1 / 60);
hud.update({ ...state, hp: 60, gold: 100, xp01: 0.6, combo: 25, multiplier: 3 }, 1 / 60);
ok(el('#hp .fill').style.width === '60%' && el('#hp .chunk').style.transform === 'scaleX(1)', 'damage updates real HP immediately and holds the white chunk');
ok(el('#runinfo .gold').textContent !== '● 100' && el('#runinfo .gold').textContent !== '● 0', 'gold gain rolls toward its target');
ok(el('#combo').dataset.heat === '2' && el('#timer').classList.contains('urgent'), 'combo tiers and last-ten-second emphasis are exposed');
hud.update({ ...state, hp: 60, maxHp: 200, gold: 2 }, 1 / 60);
ok(el('#hp .fill').style.width === '30%' && el('#hp .num').textContent === '60/200', 'max HP changes refresh the bar without an HP change');
ok(el('#runinfo .gold').textContent === '● 2', 'spending updates gold immediately');
ok(el('#combo .num').textContent === '25 COMBO LOST' && el('#combo').classList.contains('broken'), 'lost combo remains visible for its break animation');
hud.update(state, 1);
ok(!el('#combo').classList.contains('on'), 'combo break clears after its lifetime');
hud.resetScore();
hud.update({ ...state, gold: 7 }, 1 / 60);
ok(el('#runinfo .gold').textContent === '● 7' && el('#hp .chunk').style.transform === 'scaleX(1)', 'new runs reset gold and health animation state');
settings.shake = 0;
hud.update({ ...state, combo: 50 }, 0.02);
hud.update({ ...state, combo: 50 }, 0.02);
ok(el('#combo').style.transform.startsWith('translateX(0px)'), 'shake slider at zero suppresses milestone shakes');
still = true;
hud.update({ ...state, hp: 20, gold: 100, xp01: 0.9, combo: 50 }, 1 / 60);
ok(el('#runinfo .gold').textContent === '● 100' && el('#combo').style.transform === 'translateX(0px) scale(1)' && el('#xpbar .spark').hidden, 'reduced motion snaps counters and suppresses combo motion and sparkles');

let moves = 0;
let selects = 0;
sfx.menuMove = () => { moves++; };
sfx.menuSelect = () => { selects++; };
const menu = document.createElement('div');
menu.innerHTML = '<button data-nav>A</button><button data-nav>B</button><button data-nav disabled>C</button>';
const nav = new MenuNav(menu);
nav.refresh();
const buttons = menu.querySelectorAll('button');
buttons[1].dispatchEvent(new dom.window.MouseEvent('mouseenter'));
buttons[1].click();
buttons[2].click();
ok(moves === 1 && selects === 1, 'pointer navigation gets one move and one select sound, disabled buttons stay silent');
nav.update({ keyPressed: (key: string) => key === 'Enter', padButtonPressed: () => false, device: 'kb', move: { x: 0, y: 0 } } as any, 1 / 60);
ok(selects === 2, 'keyboard selection shares the click sound without duplication');
dom.window.close();
