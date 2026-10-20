import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { en } from '../src/i18n/en';
import { ar } from '../src/i18n/ar';
import { browserLanguage, escapeHtml, getLanguage, isolateNumbers, localize, localizeHtml, relocalizeDom, setLanguage, t } from '../src/i18n';
import { VOICE_TEXT } from '../src/audio/voiceText';
import { ANNOUNCER_LINES } from '../src/audio/captions';
import { BARKS } from '../src/audio/voice';
import { WEAPONS } from '../src/data/weapons';
import { PASSIVES } from '../src/data/passives';
import { MODS } from '../src/data/mods';
import { SPECIALS } from '../src/data/specials';
import { RELICS } from '../src/data/relics';
import { ENEMIES } from '../src/data/enemies';
import { PHOTO_FILTERS } from '../src/ui/photoFilters';
import { unlockProgress } from '../src/data/unlockProgress';
import { codexEntries } from '../src/data/arsenal';
import { CODEX } from '../src/data/codex';
import { ACTIONS } from '../src/core/keybinds';
import { TRACKS } from '../src/audio/music/composition';
import { INSTRUMENTS } from '../src/audio/instruments';
import { modDesc } from '../src/game/modTypes';

assert.deepEqual(Object.keys(en).sort(), Object.keys(ar).sort(), 'both locales have every key');
const slots = (s: string) => [...s.matchAll(/⟪(\w+)⟫/g)].map(m => m[1]).sort();
for (const key of Object.keys(en) as (keyof typeof en)[]) {
  assert.ok(en[key].trim() && ar[key].trim(), key + ': nonempty');
  assert.deepEqual(slots(en[key]), slots(ar[key]), key + ': interpolation parity');
}
assert.equal(browserLanguage(['ar-SA']), 'ar');
assert.equal(browserLanguage(['ar_EG']), 'ar');
assert.equal(browserLanguage(['en-GB', 'ar']), 'en');
assert.equal(browserLanguage(['fr']), 'fr');
assert.equal(browserLanguage([]), 'en');
await setLanguage('en');
assert.equal(t('settings.language'), 'LANGUAGE');
assert.equal(localize('Stage 4'), 'Stage 4');
await setLanguage('ar');
assert.equal(t('settings.language'), 'اللغة');
assert.equal(t('new.lane.unknown'), 'new.lane.unknown');
const backup = ar['settings.language'];
delete (ar as Partial<typeof ar>)['settings.language'];
assert.equal(t('settings.language'), 'LANGUAGE', 'missing Arabic falls back to English');
ar['settings.language'] = backup;
assert.equal(localize('STAGE 4 SHOP'), 'متجر المرحلة 4');
assert.ok(!/[a-z]{3}/i.test(localize('★ Onward - Blizzard unlocked for your loadout!')), 'composed unlock toast');
assert.ok(!/[a-z]{3}/i.test(localizeHtml('SUNSET DUNES<br>SURVIVE 4 MINUTES')), 'stage banner tail after markup');
assert.ok(!/[a-z]{3}/i.test(localizeHtml(': the same seed and rules for every team. <b>ELITE PARADE</b> Everyone starts as the Rookie. Host a game with GAME: WEEKLY, or play it in LOCAL CO-OP.')), 'team board copy split by markup');
assert.equal(localize('YOUR RELICS 3'), 'آثارك 3');
assert.equal(localize('Right-click attacks deal x2.6.'), 'هجمات الزر الأيمن تسبب ضررا ×2.6.');
assert.equal(localize('Unregistered message xyzzy'), 'Unregistered message xyzzy', 'unknown data falls back verbatim');
assert.equal(localize('  BACK  '), '  رجوع  ');
assert.equal(isolateNumbers('0 / 19'), '\u20660 / 19\u2069', 'fractions remain left-to-right');
assert.equal(isolateNumbers(isolateNumbers('0 / 19')), isolateNumbers('0 / 19'), 'isolation is idempotent');
const html = localizeHtml('<button data-act="BACK" title="BACK"><bdi>BACK</bdi>BACK</button>');
assert.equal(html, '<button data-act="BACK" title="رجوع"><bdi>BACK</bdi>رجوع</button>', 'translate text and labels, preserve IDs and player names');
assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
assert.equal(localizeHtml('<span>&lt;img src=x&gt;</span>'), '<span>&lt;img src=x&gt;</span>', 'translation never turns escaped text into HTML');

// All merged content is translated; missing copy is a release regression.
const need = (ok: boolean, what: string): void => assert.ok(ok, what);
for (const text of [...Object.values(VOICE_TEXT), ...Object.values(ANNOUNCER_LINES), ...Object.values(BARKS).flatMap(b => b.captions)]) {
  need(/[\u0600-\u06ff]/.test(localize(text)), 'caption: ' + text);
  need(!/[a-z]{3}/i.test(localize(text)), 'no untranslated caption: ' + text);
}
for (const def of [...Object.values(WEAPONS), ...Object.values(SPECIALS), ...Object.values(PASSIVES), ...MODS, ...RELICS, ...Object.values(ENEMIES).filter(e => !e.hidden)]) {
  need(/[\u0600-\u06ff]/.test(localize(def.name)), 'data name: ' + def.name);
  if ('desc' in def && typeof def.desc === 'string') need(!/[a-z]{3}/i.test(localize(def.desc)), 'description: ' + def.desc);
}
const untranslatedEntries = [...codexEntries().flatMap(entry => [entry.name, entry.desc, entry.kind]), ...CODEX.flatMap(entry => [entry.name, entry.text])].filter(text => /[a-z]{3}/i.test(localize(text).replace(/\b(UTC|ISO)\b/g, '')));
need(untranslatedEntries.length === 0, 'all generated arsenal/codex copy translates: ' + untranslatedEntries.slice(0, 5).join(' | '));
for (const mode of ['standard', 'endless', 'bossrush']) for (const progress of unlockProgress({ kills: 0, bosses: 0, elites: 0, bestStage: 1 }, { stage: 1, dashes: 0, weapons: 2, bosses: 0, mode, difficulty: 'hard' }, [])) {
  need(!/[a-z]{3}/i.test(localize(progress.unit)), 'unlock progress: ' + progress.unit);
}
for (const filter of PHOTO_FILTERS) need(!/[a-z]{3}/i.test(localize(filter.name)), 'photo filter: ' + filter.name);
for (const action of ACTIONS) need(!/[a-z]{3}/i.test(localize(action.name)), 'binding: ' + action.name);
assert.equal(localize('Move down'), 'تحرك للأسفل', 'movement is not the downed-teammate status');
assert.equal(localizeHtml('<kbd>DOWN</kbd>'), '<kbd>DOWN</kbd>', 'physical key names stay literal');
for (const text of [...TRACKS.map(track => track.name), ...Object.values(INSTRUMENTS).flatMap(instrument => [instrument.name, instrument.blurb])]) {
  need(!/[a-z]{3}/i.test(localize(text)), 'music: ' + text);
}
for (const mod of MODS) for (let lv = 1; lv <= 3; lv++) {
  need(!/[a-z]{3}/i.test(localize(modDesc(mod, lv))), 'mod description: ' + mod.id + ' lv ' + lv + ': ' + localize(modDesc(mod, lv)));
}

const dom = new JSDOM('<body><button id="switch">PLAY SOLO</button><p>STAGE 4 SHOP</p><bdi>Player BACK</bdi><input value="Player BACK" placeholder="CODE"></body>');
const root = dom.window.document.body;
let clicks = 0;
root.querySelector('button')!.addEventListener('click', () => clicks++);
relocalizeDom(root, 'en');
assert.equal(root.querySelector('button')!.textContent, 'لعب فردي');
await setLanguage('en');
relocalizeDom(root, 'ar');
assert.equal(root.querySelector('button')!.textContent, 'PLAY SOLO');
assert.equal(root.querySelector('p')!.textContent, 'STAGE 4 SHOP');
assert.equal(root.querySelector('input')!.value, 'Player BACK');
assert.equal(root.querySelector('bdi')!.textContent, 'Player BACK');
root.querySelector('button')!.click();
assert.equal(clicks, 1, 'switching preserves DOM listeners');
assert.equal(getLanguage(), 'en');

// Mirrored menus and the intentionally LTR Mod pipeline follow their visible direction.
Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
Object.defineProperty(globalThis, 'HTMLInputElement', { value: dom.window.HTMLInputElement, configurable: true });
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
const { MenuNav } = await import('../src/ui/menu');
const { sfx } = await import('../src/audio/sfx');
sfx.menuMove = () => {};
sfx.ui = () => {};
await setLanguage('ar');
const menu = dom.window.document.createElement('div');
menu.innerHTML = '<button data-nav>A</button><button data-nav>B</button><button data-nav>C</button>';
const nav = new MenuNav(menu, { columns: 3 });
const press = (key: string) => nav.update({ keyPressed: (code: string) => code === key, padButtonPressed: () => false, device: 'kb', move: { x: 0, y: 0 } } as any, 1 / 60);
nav.refresh(0); press('ArrowLeft');
assert.equal(nav.focus, 1, 'left moves to the next RTL card');
menu.className = 'owned-mods';
press('ArrowRight');
assert.equal(nav.focus, 2, 'right moves along the LTR Mod pipeline');
await setLanguage('en');

// Parse source, not comments/CSS: every main-screen DOM write must pass through localization.
// This catches new hardcoded labels (and data-driven English) even inside conditional expressions.
const require = createRequire(import.meta.url);
const { parsers } = require('prettier/plugins/typescript');
for (const file of ['screens', 'hud', 'onboarding', 'metaScreens', 'mvpScreen', 'menu', 'loadingScreen']) {
  const source = readFileSync(`src/ui/${file}.ts`, 'utf8');
  const ast = parsers.typescript.parse(source);
  const inspect = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'AssignmentExpression' && ['textContent', 'innerHTML'].includes(node.left?.property?.name)) {
      const text = source.slice(...node.right.range);
      const left = source.slice(...node.left.range);
      if (!/^(?:''|CSS)$/.test(text) && !/\b(?:st|style|s)\.textContent$/.test(left) && left !== "el.querySelector('.code-big')!.textContent" && left !== 'd.nm.textContent') {
        assert.match(text, /^(?:localize(?:Html)?\(|t\(|b\.dataset\.cycle === 'language')/, file + ': unlocalized DOM write: ' + text.slice(0, 90));
      }
    }
    if (node.type === 'CallExpression' && node.callee?.property?.name === 'insertAdjacentHTML') {
      assert.match(source.slice(...node.arguments[1].range), /^localizeHtml\(/, file + ': unlocalized markup insertion');
    }
    if (node.type === 'CallExpression' && node.callee?.name === 't' && node.arguments[0]?.type === 'Literal') {
      assert.ok(node.arguments[0].value in en, file + ': unknown key ' + node.arguments[0].value);
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'range', 'comments', 'tokens'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(inspect);
      else if (value && typeof value === 'object') inspect(value);
    }
  };
  inspect(ast);
}
console.log(`ok   i18n: ${Object.keys(en).length} matching catalogs, placeholders, captions, content, fallback, RTL, switching and main-screen scanner`);
