/** HUD lane: button prompts, UI scale, damage-number filter, charge mode, settings defaults, HUD layout bits. */
import { JSDOM } from 'jsdom';
import { ok } from './check';

const dom = new JSDOM('<body></body>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'navigator']) {
  Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
}
(globalThis as any).matchMedia = () => ({ matches: false });
(globalThis as any).requestAnimationFrame = (f: () => void) => setTimeout(f, 0);
const noop: any = new Proxy(function () {}, {
  get: (_t, key) => (key === 'data' ? new Uint8ClampedArray(4 * 96 * 96) : noop),
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = () => noop;
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
(globalThis as any).Path2D = class {};
(globalThis as any).__APP_VERSION__ = 'test';

// An old saved settings object without the new keys must load with their defaults.
localStorage.setItem('infinishoot.settings.v1', JSON.stringify({ volume: 0.3, shake: 0.5 }));
const { settings } = await import('../src/game/settings');
ok(settings.volume === 0.3 && settings.uiScale === 100 && settings.damageNumbers === 'all' && settings.weather === true && settings.chargeMode === 'hold', 'old settings keep loading; new HUD settings get defaults');

// ---------------------------------------------------------------- prompts
const { padFamily, promptModeFor, promptText, promptHtml, prompt, refreshPrompts, promptState } = await import('../src/ui/prompts');
ok(padFamily('Xbox 360 Controller (XInput STANDARD GAMEPAD)') === 'xbox', 'XInput pads get Xbox glyphs');
ok(padFamily('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)') === 'xbox', 'Xbox Wireless Controller is not mistaken for a Sony pad');
ok(padFamily('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)') === 'ps', 'DualSense gets PlayStation glyphs');
ok(padFamily('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)') === 'ps', 'DualShock 4 (Chrome id) gets PlayStation glyphs');
ok(padFamily('054c-05c4-Sony Computer Entertainment Wireless Controller') === 'ps', 'DualShock 4 (Firefox id) gets PlayStation glyphs');
ok(padFamily('Logitech Gamepad F310 (STANDARD GAMEPAD Vendor: 046d Product: c216)') === 'xbox', 'unknown pads default to Xbox');
ok(promptModeFor('kbm', 'x') === 'kbm' && promptModeFor('pad', null) === 'touch' && promptModeFor('pad', 'DualSense') === 'ps', 'mode follows the device; a pad device without a real pad is touch');
ok(promptText('bomb', 'kbm') === 'Q/E' && promptText('bomb', 'xbox') === 'RB' && promptText('bomb', 'ps') === 'R1', 'special prompt text per device');
ok(promptText('parry', 'ps') === 'CIRCLE' && promptText('dash', 'xbox') === 'LB', 'pad button names');
ok(promptHtml('dash', 'kbm').includes('SPACE') && promptHtml('move', 'kbm').includes('WASD'), 'keyboard prompts read the binds');
const { rebind, resetBinds } = await import('../src/core/keybinds');
rebind('dash', 0, 'KeyK');
ok(promptHtml('dash', 'kbm').includes('>K<'), 'keyboard prompts follow a rebind');
resetBinds();
ok(promptHtml('pick:2', 'kbm') === '2' && promptHtml('pick:2', 'ps').includes('<svg'), 'level-up card keys: number on keyboard, a glyph on pads');
ok(promptHtml('charge', 'kbm').includes('<svg') && promptHtml('charge', 'xbox').includes('<svg'), 'mouse and face buttons are pixel sprites');
ok(promptHtml('dash', 'touch') === '', 'touch hides prompts');
ok(promptHtml('padlegend', 'ps').includes('pl-row') && promptHtml('controls', 'kbm').includes('ultimate'), 'legend and title controls line render');
document.body.innerHTML = prompt('bomb');
promptState.mode = 'xbox';
refreshPrompts();
ok(document.body.textContent === 'RB', 'refreshPrompts re-renders data-prompt elements for the new device');
promptState.mode = 'kbm';
refreshPrompts();
ok(document.body.textContent === 'Q', 'and back to the keyboard');
document.body.innerHTML = '';

// ---------------------------------------------------------------- UI scale
const { uiZoom } = await import('../src/ui/hudLayout');
ok(uiZoom(100, 1280, 720) === 1 && uiZoom(75, 800, 600) === 0.75, 'UI SCALE 100% and 75%');
ok(uiZoom(150, 1920, 1080) === 1.5 && uiZoom(150, 1280, 720) === 1.2, 'big scales are capped to what fits the window');
ok(uiZoom(100, 640, 480) === 1, 'small windows never shrink the default on their own');
ok(uiZoom(NaN) === 1 && uiZoom(400, 3840, 2160) === 1.5 && uiZoom(10) === 0.75, 'bad values are clamped');

// ---------------------------------------------------------------- damage numbers
const { DamageNumbers, showDamageNumber } = await import('../src/ui/damageNumbers');
ok(showDamageNumber('all', 1, 0) && showDamageNumber('mine', 0, 0) && !showDamageNumber('mine', 1, 0) && !showDamageNumber('off', 0, 0), 'ALL / MINE / OFF on hero hits');
ok(showDamageNumber('off', undefined, 0) && showDamageNumber('mine', undefined, 2), 'messages, heals and old events without a source always show');
const parent = document.createElement('div');
document.body.appendChild(parent);
const nums = new DamageNumbers(parent);
nums.localHero = () => 1;
const live = () => [...parent.children].filter((el) => (el as HTMLElement).style.display !== 'none').length;
settings.damageNumbers = 'mine';
nums.spawn(0, 0, 0, 10, 'hit', 0);
ok(live() === 0, "MINE hides a teammate's hit");
nums.spawn(0, 0, 0, 10, 'hit', 1);
nums.spawn(3, 0, 0, 'PERFECT!', 'score');
ok(live() === 2, 'MINE shows your own hits and messages');
nums.clear();
settings.damageNumbers = 'off';
const { Vfx } = await import('../src/game/vfx');
const bus = new Vfx({ dmg: nums } as any);
bus.recording = true;
bus.num(0, 0, 0, 12, 'hit', 1);
bus.num(0, 0, 0, 'COMBO!', 'score');
ok(live() === 1, 'OFF hides hits but keeps labels');
const ev = JSON.parse(JSON.stringify(bus.drain()));
ok(ev[0].length === 7 && ev[0][6] === 1 && ev[1].length === 6, 'the number event carries its hero only when it has one');
nums.clear();
settings.damageNumbers = 'all';
bus.apply(ev[0]);
bus.apply(['n', 5, 0, 0, 5, 'hit'] as any); // an event from an older host
ok(live() === 2, 'clients replay new and old number events');
nums.clear();

// ---------------------------------------------------------------- charge mode
const { ChargeLatch } = await import('../src/game/chargeMode');
const run = (mode: 'hold' | 'toggle', downs: boolean[], control = true) => {
  const l = new ChargeLatch();
  return downs.map((d) => l.update(mode, d, false, control));
};
const T = true;
const F = false;
ok(run('hold', [F, T, T, F]).join() === [F, T, T, F].join(), 'HOLD: held = charging');
ok(run('toggle', [F, T, T, F, F, T, F, F]).join() === [F, T, T, T, T, F, F, F].join(), 'TOGGLE: a press starts, the next press releases');
ok(run('toggle', [T, T, F], false).every((x) => !x), 'TOGGLE: no charging without control');
{
  const l = new ChargeLatch();
  ok(l.update('toggle', false, true, true) && !l.update('toggle', false, true, true), 'TOGGLE: clicks shorter than a step still count');
}
{
  // The dev bot holds right click 1.4 s, lets go 0.2 s (it sets the button bits directly).
  const l = new ChargeLatch();
  let on = 0;
  let flips = 0;
  let prev = false;
  for (let i = 0; i < 600; i++) {
    const c = l.update('toggle', i % 96 < 84, false, true);
    if (c) on++;
    if (c !== prev) flips++;
    prev = c;
  }
  ok(on > 200 && flips >= 6, `the bot's held pattern still charges and releases in TOGGLE (${on} steps on, ${flips} flips)`);
}

// ---------------------------------------------------------------- HUD layout
const { Hud } = await import('../src/ui/hud');
const root = document.createElement('div');
document.body.appendChild(root);
const hud = new Hud(root);
const state = {
  hp: 100, maxHp: 100, dash01: 1, dashStock: 1, dashMax: 1, bomb01: 1, special: 'BOMB',
  score: 0, combo: 0, multiplier: 1, combo01: 1, stage: 2, level: 12, xp01: 0.2,
  timeLeft: 100, kills: 0, gold: 0, gears: 0, boss: null, lowHp: false,
  spice: [{ text: 'METEOR SHOWER 12', kind: 'event' as const }, { text: '★ KILL 30 0/30', kind: 'challenge' as const }],
};
hud.update(state, 1 / 60);
const q = (s: string) => root.querySelector<HTMLElement>(s)!;
ok(q('#xpbar .lv b').textContent === '12' && q('#xpbar .lv span').textContent === 'LV', 'the level sits in its own badge by the XP bar');
ok(q('#goals > #spice').children.length === 2 && q('#spice .event i').textContent === 'STAGE EVENT', 'event and challenge lines live in the goals stack');
ok(!!q('#goals > #team'), 'teammate bars are part of the goals stack');
ok(q('#bombpip > span').textContent === 'BOMB' && q('#bombpip kbd.prompt').textContent === 'Q', 'special meter label and its key prompt');
ok(!!document.getElementById('hud-layout-css'), 'layout CSS injected once');
const { ObjectiveHud } = await import('../src/ui/objectiveHud');
new ObjectiveHud().update({ kind: 'totems', state: 'active', count: '0/3', title: 'DESTROY', hint: 'x', cur: 0, max: 3, active: true, hp: 0 } as any, null);
ok(q('#goals').firstElementChild?.id === 'team' && q('#goals > #objective')?.nextElementSibling?.id === 'spice', 'objective panel mounts between teammates and goal lines');

const { SkillHud } = await import('../src/ui/styleMeter');
const sk = new SkillHud(root);
const skState = { points: 0, rank: 0, notes: [], seq: 0, ult01: 0.5, ultActive: 0, ultName: 'X', visible: true };
sk.update(skState, 1 / 60);
const meter = document.getElementById('stylemeter')!;
ok(meter.hidden, 'style meter is hidden at rank D');
sk.update({ ...skState, rank: 1, points: 90 }, 1 / 60);
ok(!meter.hidden, 'and shows from rank C');
sk.update({ ...skState, rank: 0, points: 10 }, 0.1);
ok(!meter.hidden, 'a drop back to D lingers briefly');
sk.update({ ...skState, rank: 0, points: 10 }, 1);
ok(meter.hidden, 'then hides');
const { touchHud } = await import('../src/ui/touch');
sk.update({ ...skState, ult01: 1 }, 1 / 60);
ok(touchHud.ultReady && touchHud.ult01 === 1 && document.querySelector('#ultpip > span')!.textContent === 'ULT', 'ULT meter feeds the touch ULT button');
dom.window.close();
