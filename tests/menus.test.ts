import assert from 'node:assert/strict';
import './jsdomEnv';
import { jsdomErrors } from './jsdomEnv';

const { Game } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { save } = await import('../src/game/save');
const { settings } = await import('../src/game/settings');
const { menuItemAvailable } = await import('../src/ui/menu');
const { SETTINGS_ROWS, SETTINGS_TABS, commonSettings } = await import('../src/ui/settingsScreen');
const { MODES } = await import('../src/data/modes');
const { hasPlayed, runSummary, seenModes, visibleModes } = await import('../src/ui/menuRun');
const { gauntletProfile } = await import('../src/data/ascension');
const { setLanguage } = await import('../src/i18n');
const hud = document.getElementById('hud')!;
const game = new Game(new Input(document.querySelector('canvas')!), 16 / 9, hud, document.getElementById('reticle')!);
const screens = game.screens;

// Count actual button activations, including transition callbacks.
const menu = () => hud.querySelector<HTMLElement>('.screen:not([hidden])')!;
const available = (root: HTMLElement, selector = '[data-nav]') => [...root.querySelectorAll<HTMLElement>(selector)].filter(menuItemAvailable);
function press(selector: string): void {
  const b = available(menu(), selector)[0];
  assert.ok(b, `Missing action ${selector} on ${screens.current}`);
  b.click();
}
function home(): void { screens.show('none'); screens.show('title'); }
home();
assert.equal(available(menu()).length, 4, 'only four launchers on a fresh title');
press('[data-menu-play]');
assert.equal(screens.current, 'play');
assert.equal(available(menu(), '[data-run-mode]').length, 1);
assert.match(menu().querySelector('.run-summary')!.textContent!, /Rookie.*Buster.*Charge Shot.*Bomb.*Medium/);
assert.equal(screens.nav('play').element?.dataset.act, 'start');
press('[data-act=start]');
assert.equal(game.mode, 'fight', 'two presses reach the arena on a fresh save');
assert.ok(!game.preShop && game.hero.synergy.slots.length > 0, 'the first run equips a recommended starting upgrade');

assert.deepEqual(seenModes({}), []);
assert.deepEqual(seenModes(['bogus','raid','raid']), ['raid']);
assert.ok(hasPlayed(0, [], 1) && hasPlayed(0, ['run'], 0) && hasPlayed(1, [], 0));
assert.equal(visibleModes(true, 'standard').length, MODES.length);
assert.deepEqual(visibleModes(false, 'raid').map(m => m.id), ['standard','raid']);
save.lifetime.runs = 1;
// The full game's render hooks mount these destinations lazily.
(await import('../src/game/systems/meta2')).meta2Ui(game);
(await import('../src/game/systems/season')).seasonUi(game);
new (await import('../src/ui/customise')).CustomiseUi(screens);
new (await import('../src/ui/ghostScreen')).GhostScreen(screens);
new (await import('../src/ui/ghostRaceScreen')).GhostScreen(game);
home(); press('[data-menu-play]');
assert.equal(available(menu(), '[data-run-mode]').length, MODES.length);
assert.ok(menu().querySelector('[data-run-mode=endless] em'));
press('[data-run-mode=endless]');
assert.equal(settings.mode, 'endless');
home(); press('[data-menu-play]');
assert.ok(menu().querySelector('[data-run-mode=endless][aria-pressed=true]'));
assert.equal(menu().querySelector('[data-run-mode=endless] em'), null);
gauntletProfile.unlocked = gauntletProfile.selected = 1;
assert.match(runSummary(), /Hard$/);
press('[data-act=modes]');
assert.ok(menu().querySelector('[data-diff=hard].on:disabled'));
press('[data-act=g-down]');
assert.equal(screens.current, 'modes');
assert.equal(menu().querySelectorAll('[data-gear]').length, 3);
press('[data-diff=hard]');
assert.equal(settings.difficulty, 'hard');
assert.ok(menu().querySelector('[data-hero=rookie]'));
for (const selector of ['[data-casual-preset]', '.squad-options button', '[data-act=g-records]', '[data-act=heat]', '[data-act=weekly]']) assert.ok(available(menu(), selector).length, selector);
press('[data-act=play]');
assert.equal(game.mode, 'shop');
assert.equal(game.difficulty.id, 'hard');

for (const [action, destination] of [
  ['m2-profile','profile'], ['m2-achievements','achievements'], ['sp-season','season'], ['cu-open','customise'],
  ['gh-open','ghosts'], ['gr-open','ghostrace'], ['cp-open','compete'], ['fr-open-x','friends'], ['event','halloween'],
  ['wardrobe','wardrobe'], ['rewards','rewards'], ['history','history'], ['bestiary','bestiary'], ['jukebox','jukebox'],
  ['ob-codex','arsenal'], ['ae-open','arenas'], ['activity','activity'],
]) {
  home(); press('[data-act=extras]'); press(`[data-act="${action}"]`);
  assert.equal(screens.current, destination, action + ' reachable in two activations');
}
home(); press('[data-act=extras]');
const story = available(menu()).find(b => b.textContent === 'STORY');
assert.ok(story); story.click(); assert.equal(screens.current, 'story');
home(); press('[data-act=extras]');
for (const action of ['wardrobe','rewards','history','bestiary','jukebox','ob-codex','activity','unlocks','codex','ae-open']) {
  assert.ok(available(menu(), `[data-act="${action}"]`).length, action);
}
press('[data-act=unlocks]'); press('[data-act=savedata]');
assert.equal(screens.current, 'savedata', 'save tools take three activations');
home(); press('[data-act=extras]'); press('[data-act=codex]'); press('[data-act=meta-back]');
assert.equal(screens.current, 'extras');

home(); press('[data-act=online]');
for (const act of ['mp-host','mp-join','lb-open']) assert.ok(available(menu(), `[data-act=${act}]`).length);
assert.equal(available(menu(), '[data-act=sp-join]').length, 0);
press('[data-room-more]');
for (const act of ['sp-join','fr-open','lc-open','tb-open','vs-practice','lo-online']) assert.ok(available(menu(), `[data-act=${act}]`).length, act);

home(); press('[data-act=settings]');
const keys: string[] = [];
for (let i = 0; i < SETTINGS_TABS.length; i++) {
  press(`[data-tab="${i}"]`);
  const basic = available(menu(), '[data-setting]').map(el => el.dataset.setting!);
  assert.deepEqual(basic, [...commonSettings[SETTINGS_TABS[i]]]);
  press(`#settings-panel-${i} [data-advanced]`);
  keys.push(...available(menu(), '[data-setting]').map(el => el.dataset.setting!));
}
assert.deepEqual(keys.sort(), SETTINGS_ROWS.map(r => r.key).sort(), 'all settings reachable exactly once');
await setLanguage('ar');
home(); press('[data-menu-play]');
assert.doesNotMatch(menu().innerText ?? menu().textContent!, /Continue with|Start run|Change setup/i);
assert.deepEqual(jsdomErrors, []);
console.log('ok menus: real title paths, run launch, kit, disclosure, setup, collection, online and every settings row');
