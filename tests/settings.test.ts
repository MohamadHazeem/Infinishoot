/** Settings lane: migration, tab isolation, accessible input, whole-page palettes and local aim. */
import { JSDOM } from 'jsdom';
import { ok } from './check';
const dom = new JSDOM('<body><canvas id="game"></canvas></body>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'navigator']) {
  Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
}
(globalThis as any).matchMedia = () => ({ matches: false });
const noop: any = new Proxy(function () {}, { get: (_t, key) => key === 'data' ? new Uint8ClampedArray(4 * 96 * 96) : noop, apply: () => noop, set: () => true });
(dom.window.HTMLCanvasElement.prototype as any).getContext = () => noop;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).Path2D = class {};
localStorage.setItem('infinishoot.settings.v1', JSON.stringify({ colorblind: true, volume: 0.3, chargeMode: 'toggle', shake: 0.75 }));
const { settings, SETTINGS_DEFAULTS, applySettings, saveSettings, access, applyQualityLevel } = await import('../src/game/settings');
const { SettingsScreen, SETTINGS_ROWS, SETTINGS_TABS, resetSettingsTab, applyTextScale } = await import('../src/ui/settingsScreen');
const { AccessibleAction, accessibilityInput, assistAim } = await import('../src/game/systems/aimAssist');
const { Input } = await import('../src/core/input');
const { PadInput } = await import('../src/core/padInput');
const { ChargeLatch, rightClickHeld } = await import('../src/game/chargeMode');
const { applyColorblind, correctedColor, COLORBLIND_MATRICES } = await import('../src/render/colorblind');
const { juiceTuning } = await import('../src/game/juice');
const { streaks } = await import('../src/game/streaks');

ok(settings.colorblind && settings.volume === 0.3 && settings.chargeMode === 'toggle' && settings.shake === 0.75, 'legacy setting keys and values survive');
ok(settings.textScale === 100 && settings.colorblindMode === 'off' && !settings.reduceScreenEffects, 'old saves receive local display defaults');
ok(settings.aimAssist && !settings.mouseAimAssist && settings.dashRunMode === 'hold' && settings.rewindMode === 'toggle' && settings.teamMoveMode === 'toggle', 'sensible input defaults preserve one-press rewind and team moves');
ok(new Set(SETTINGS_ROWS.map((r) => r.key)).size === SETTINGS_ROWS.length, 'each setting belongs to one tab');
for (const key of ['volume', 'musicVolume', 'sfxVolume', 'ambienceVolume', 'interactiveMusic', 'adaptiveSilence', 'lowHealthAudio', 'headphones3d', 'announcer', 'heroVoices', 'voiceVolume', 'captions', 'soundArrows', 'crowd', 'radioDj', 'uiVolume', 'retro', 'shake', 'glow', 'graphics', 'crt', 'distortion', 'nightStages', 'weather', 'rumble', 'colorblind', 'reduceFlash', 'dynamicCamera', 'bossIntros', 'slowMo', 'deathReplay', 'cinematics', 'uiScale', 'damageNumbers', 'chargeMode', 'petSounds', 'finishers', 'portraitPops', 'autoFire', 'showFps']) {
  ok(SETTINGS_ROWS.some((r) => r.key === key), `existing control retained: ${key}`);
}
const target = { ...settings, textScale: 150, volume: 0.2, aimAssist: false, skin: 'custom', loadout: { ...settings.loadout } };
resetSettingsTab('AUDIO', target);
ok(target.volume === SETTINGS_DEFAULTS.volume && target.textScale === 150 && !target.aimAssist && target.skin === 'custom', 'RESET TAB only resets that category');
let registered = false, back = false, controls = false;
const screen = new SettingsScreen({ addScreen: (name: string, el: HTMLElement) => { registered = name === 'settings'; document.body.append(el); } } as any, () => { back = true; }, () => { controls = true; });
ok(registered && screen.el.querySelectorAll('[role=tab]').length === 6, 'settings uses registered screen with all six tabs');
for (let tab = 0; tab < SETTINGS_TABS.length; tab++) {
  screen.selectTab(tab);
  ok(screen.el.querySelector(`[data-tab="${tab}"]`)!.getAttribute('aria-selected') === 'true', `tab selection: ${SETTINGS_TABS[tab]}`);
  for (const r of SETTINGS_ROWS.filter((r) => r.tab === SETTINGS_TABS[tab])) {
    const el = screen.el.querySelector<HTMLElement>(`[data-setting="${r.key}"]`)!;
    ok(!!el.getAttribute('aria-label'), `${r.key} has an accessible name and current value`);
    if (r.range) {
      const input = el as HTMLInputElement; input.value = String(r.range[1]); input.dispatchEvent(new Event('input', { bubbles: true }));
      ok(settings[r.key] === r.range[1], `${r.key} slider saves`);
    } else {
      const before = settings[r.key]; el.click();
      ok(settings[r.key] !== before, `${r.key} toggle/cycle changes`);
    }
    ok(JSON.parse(localStorage.getItem('infinishoot.settings.v1')!)[r.key] === settings[r.key], `${r.key} persists`);
    el.focus();
    ok(screen.el.querySelector('#settings-description')!.textContent === r.desc, `${r.key} describes itself on focus`);
  }
}
screen.selectTab(2); screen.el.querySelector<HTMLButtonElement>('[data-rebind]')!.click(); ok(controls, 'controls still opens key rebindings');
screen.el.querySelector<HTMLButtonElement>('[data-settings-back]')!.click(); ok(back, 'back returns to caller');
const input = new Input(document.querySelector('canvas')!);
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); screen.update(input, 1 / 60); input.endStep(); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
ok(screen.el.querySelector('[data-tab="3"]')!.getAttribute('aria-selected') === 'true', 'E switches tabs');
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' })); screen.update(input, 1 / 60); input.endStep(); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyQ' }));
ok(screen.el.querySelector('[data-tab="2"]')!.getAttribute('aria-selected') === 'true', 'Q switches tabs');
const fakePad = { keyPressed: () => false, padButtonPressed: (b: number) => b === 5, device: 'pad' } as any;
screen.update(fakePad, 1 / 60); ok(screen.el.querySelector('[data-tab="3"]')!.getAttribute('aria-selected') === 'true', 'RB switches tabs');
screen.update({ ...fakePad, padButtonPressed: (b: number) => b === 4 }, 1 / 60); ok(screen.el.querySelector('[data-tab="2"]')!.getAttribute('aria-selected') === 'true', 'LB switches tabs');
const { promptState } = await import('../src/ui/prompts');
promptState.mode = 'xbox'; screen.update(input, 1 / 60);
const hintNode = screen.el.querySelector('.settings-hint')!.firstChild;
screen.update(input, 1 / 60);
ok(screen.el.querySelector('.settings-hint')!.firstChild === hintNode, 'controller hints reuse DOM between frames');
screen.selectTab(4); screen.el.querySelector<HTMLButtonElement>('[data-reset]')!.click();
ok(settings.textScale === 100 && !settings.reduceScreenEffects, 'reset button restores active tab');
ok(!!screen.el.querySelector('[data-act=ob-tips-reset]') && !!screen.el.querySelector('[data-act=ob-tips]'), 'onboarding tips and reset remain mounted across tabs');
ok(!screen.el.querySelector('[hidden] [data-nav]'), 'inactive panels never enter keyboard or gamepad navigation');

for (const mode of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
  applyColorblind(mode);
  ok(document.documentElement.style.filter.includes(mode), `${mode} covers the canvas AND all DOM cues`);
  ok(!!document.getElementById(`settings-color-${mode}`), `${mode} has an SVG transform`);
  const white = correctedColor([1, 1, 1], mode); ok(white.every((v) => Math.abs(v - 1) < 1e-8), `${mode} preserves neutral text`);
  const cue = correctedColor([1, 0, 0.7], mode); ok(cue.every(Number.isFinite) && cue.some((v, i) => v !== [1, 0, 0.7][i]), `${mode} transforms saturated gameplay cues`);
}
ok(Object.keys(COLORBLIND_MATRICES).length === 4, 'three modes plus off');
applyColorblind('off'); ok(document.documentElement.style.filter === '', 'OFF restores original colours');
const style = document.createElement('style'); style.textContent = '.test-copy { font-size: 20px; width: 100px; }'; document.head.append(style);
applyTextScale(150);
ok(style.sheet!.cssRules[0].cssText.includes('var(--text-scale'), 'text scale handles existing font declarations');
ok(style.sheet!.cssRules[0].cssText.includes('width: 100px'), 'text size does not zoom panel sizes');
applyTextScale(125); ok(!style.sheet!.cssRules[0].cssText.includes('calc(calc'), 'text scaling does not compound');
settings.reduceScreenEffects = true; settings.reduceFlash = false; settings.shake = 1.25; settings.distortion = true;
applySettings(); applyQualityLevel(3, true);
ok(access.reduceFlash && juiceTuning.shakeScale === 0 && !streaks.enabled && document.body.classList.contains('reduce-flash'), 'master suppresses flashes, shake, streaks and UI motion, including quality changes');
ok(settings.shake === 1.25 && settings.distortion && !settings.reduceFlash, 'master keeps individual preferences');
settings.reduceScreenEffects = false; applySettings();
ok(!access.reduceFlash && juiceTuning.shakeScale === 1.25, 'master OFF restores preferences');

const charge = new ChargeLatch();
ok(charge.update('hold', true, true, true) && !charge.update('hold', false, false, true), 'charge hold releases');
ok(charge.update('toggle', true, true, true) && charge.update('toggle', false, false, true) && !charge.update('toggle', true, true, true), 'charge toggle latches and releases');
for (const action of ['rewind', 'team']) {
  const hold = new AccessibleAction();
  ok(!hold.update('hold', true, true, true, 0.2) && hold.update('hold', true, false, true, 0.15), `${action} HOLD requires 350 ms`);
  ok(!hold.update('hold', true, false, true, 1), `${action} fires once per hold`);
  hold.update('hold', false, false, true, 0.1);
  ok(hold.update('hold', true, true, true, 0.35), `${action} rearms on release`);
  const tap = new AccessibleAction();
  ok(tap.update('toggle', true, true, true, 0.01) && !tap.update('toggle', true, false, true, 1), `${action} TOGGLE activates once immediately`);
}
const dash = new AccessibleAction();
ok(dash.update('toggle', true, true, true, 0.01, true) && dash.update('toggle', false, false, true, 1, true), 'dash toggle repeats after release');
ok(!dash.update('toggle', true, true, true, 0.01, true), 'second dash press stops repeat');
dash.update('toggle', false, false, true, 0.01, true); dash.update('toggle', true, true, true, 0.01, true);
ok(!dash.update('toggle', false, false, false, 0.01, true) && !dash.update('toggle', false, false, true, 0.01, true), 'menus cancel dash latch');
ok(dash.update('hold', true, true, true, 0.01, true) && !dash.update('hold', false, false, true, 0.01, true), 'dash HOLD stops on release');
settings.rewindMode = 'hold'; settings.dashRunMode = 'hold'; settings.teamMoveMode = 'toggle';
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB' }));
accessibilityInput(input, true, 0.2, 1); ok(!input.actionPressed('rewind'), 'raw rewind press is swallowed while confirming'); input.endStep();
accessibilityInput(input, true, 0.15, 1); ok(input.actionPressed('rewind'), 'confirmed rewind becomes ordinary local action'); input.endStep();
window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyB' }));
settings.chargeMode = 'toggle';
const otherInput = new Input(document.querySelector('canvas')!);
input.virtual.active = true; input.virtual.buttons[2] = true; input.poll();
ok(rightClickHeld(input, true) && !rightClickHeld(otherInput, true), 'charge toggle is isolated per local controller');
input.endStep(); input.virtual.buttons[2] = false; input.poll();
ok(!input.padButton(2) && rightClickHeld(input, true), 'touch release clears physical button but retains charge toggle');
accessibilityInput(input, false, 1 / 60, 1);
ok(!rightClickHeld(input, true), 'opening a menu cancels charge toggle');
settings.chargeMode = 'hold'; input.virtual.buttons[2] = true; input.poll();
ok(rightClickHeld(input, true), 'touch hold charges');
input.virtual.buttons[2] = false; input.poll(); ok(!rightClickHeld(input, true), 'touch release fires in hold mode');
const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
const pad = new PadInput(0, () => [{ connected: true, buttons, axes: [0, 0, 0, 0] } as any]);
buttons[4].pressed = true; pad.poll(); accessibilityInput(pad.asInput(), true, 1 / 60, 1);
ok(pad.actionPressed('dash') && !pad.padButtonPressed(4), 'local co-op pads use one synthesized action');
pad.poll(); accessibilityInput(pad.asInput(), false, 1 / 60, 1); ok(!pad.actionPressed('dash'), 'local co-op accessibility state clears at menus');
buttons[0].pressed = true; pad.poll(); accessibilityInput(pad.asInput(), true, 1 / 60, 1, true); ok(pad.padButtonPressed(0), 'downed players keep the spectate button');

const player = { x: 0, z: 0, aim: { x: 1, z: 0 }, aimDist: 7, setAimDir(x: number, z: number, d: number) { const l = Math.hypot(x, z); this.aim.x = x / l; this.aim.z = z / l; this.aimDist = d; } };
const enemy = (x: number, z: number, alive = true, hidden = false) => ({ x, z, alive, def: { hidden } });
const game = { enemies: { list: [enemy(6, 1.5), enemy(3, -0.5), enemy(1, 3), enemy(1, 0, false), enemy(1, 0, true, true)] }, arena: { colliders: [] } } as any;
const hero = { player } as any;
const aimInput = { device: 'pad', padAim: { x: 1, y: 0 }, padButton: () => false } as any;
settings.aimAssist = true; settings.mouseAimAssist = false;
assistAim.call(game, hero, aimInput);
ok(player.aim.z < 0 && player.aim.z > -0.17, 'soft snap selects nearest living visible enemy inside cone');
ok(player.aimDist === 7, 'aim assist keeps targeting distance');
player.aim.x = 1; player.aim.z = 0; settings.aimAssist = false; assistAim.call(game, hero, aimInput); ok(player.aim.z === 0, 'gamepad assist can be disabled');
settings.aimAssist = true; assistAim.call(game, hero, { ...aimInput, device: 'kbm' }); ok(player.aim.z === 0, 'mouse unassisted by default');
settings.mouseAimAssist = true; assistAim.call(game, hero, { ...aimInput, device: 'kbm' }); ok(player.aim.z < 0, 'mouse assist is independently opt-in');
player.aim.x = 1; player.aim.z = 0;
game.arena.colliders = [{ minX: 1, maxX: 2, minZ: -10, maxZ: 10 }]; assistAim.call(game, hero, aimInput); ok(player.aim.z === 0, 'assist never pulls toward enemies behind walls');
game.arena.colliders = []; game.enemies.list = [enemy(13, 0.5), enemy(3, 3)]; assistAim.call(game, hero, aimInput); ok(player.aim.z === 0, 'assist respects range and aim cone');
saveSettings();
