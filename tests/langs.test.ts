import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { en } from '../src/i18n/en';
import { ar } from '../src/i18n/ar';
import { es } from '../src/i18n/es';
import { fr } from '../src/i18n/fr';
import { ptBR } from '../src/i18n/pt-BR';
import { de } from '../src/i18n/de';
import { tr } from '../src/i18n/tr';
import { LANGUAGES, browserLanguage, getLanguage, isLanguage, loadLanguage, localize, onLanguageChange, relocalizeDom, setLanguage, t } from '../src/i18n';

const catalogs = { en, ar, es, fr, 'pt-BR': ptBR, de, tr };
const keys = Object.keys(en).sort() as (keyof typeof en)[];
const numbers = (s: string) => (s.replace(/(\d)[., ](?=\d{3}\b)/g, '$1').replace(/,/g, '.').match(/\d+(?:\.\d+)?/g) ?? []).sort();
const slots = (s: string) => [...s.matchAll(/⟪(\w+)⟫/g)].map(m => m[1]).sort();
for (const [locale, catalog] of Object.entries(catalogs)) {
  // No stale keys; newer English keys may be missing (they fall back to English) but most must be there.
  const have = Object.keys(catalog);
  assert.deepEqual(have.filter((k) => !(k in en)), [], `${locale}: no stale keys`);
  const share = have.length / keys.length;
  assert.ok(share >= 0.85, `${locale}: ${(share * 100).toFixed(0)}% of English keys translated (85%+ expected)`);
  if (share < 1) console.log(`warn ${locale}: ${keys.length - have.length} keys fall back to English`);
  for (const key of keys.filter((k) => k in catalog)) {
    if (locale !== 'ar' && key !== 'meta2.ach.m2_weekly.name') assert.deepEqual(numbers((catalog as Record<string, string>)[key]), numbers(en[key]), `${locale}:${key}: gameplay numbers preserved`);
    assert.equal((catalog as Record<string, string>)[key].split('\n').length, en[key].split('\n').length, `${locale}:${key}: line breaks preserved`);
    if (en[key].includes('⟪')) assert(catalog[key].replace(/⟪\w+⟫|\s/g, '').length, `${locale}:${key}: templates retain literal context`);
    if (!/\b(\w+)(?:\s+\1){2,}\b/i.test(en[key])) assert(!/\b(\w+)(?:\s+\1){2,}\b/i.test(catalog[key]), `${locale}:${key}: no corrupt repetition`);
    assert(catalog[key].trim(), `${locale}:${key}: nonempty`);
    assert.deepEqual(slots(catalog[key]), slots(en[key]), `${locale}:${key}: placeholder names and multiplicity`);
    assert(!/#.{0,1}#{10}|\ufffd/.test(catalog[key]), `${locale}:${key}: no corrupt output`);
  }
}
for (const [locale, result] of [['es-MX','es'], ['fr_CA','fr'], ['pt-PT','pt-BR'], ['pt-BR','pt-BR'], ['de-AT','de'], ['tr-TR','tr'], ['ar-SA','ar'], ['en-GB','en']] as const) {
  assert.equal(browserLanguage([locale]), result);
}
assert.equal(browserLanguage(['ja', 'de-DE']), 'de');
assert.equal(browserLanguage(['en', 'es']), 'en');
assert.equal(browserLanguage([]), 'en');
assert.equal(isLanguage('__proto__'), false);
assert.equal(isLanguage(null), false);
assert.equal(Object.keys(LANGUAGES).length, 7);
const source = readFileSync('src/i18n/index.ts', 'utf8');
for (const locale of ['ar','es','fr','pt-BR','de','tr']) {
  assert(source.includes(`import('./${locale}')`), `${locale}: separate lazy chunk`);
  assert(!new RegExp(`from ['"]\\./${locale}['"]`).test(source), `${locale}: no eager import`);
}

await setLanguage('en');
let changed = 0;
const off = onLanguageChange(() => changed++);
const first = setLanguage('fr');
assert.equal(getLanguage(), 'en', 'keep current language while loading');
await setLanguage('de');
await first;
assert.equal(getLanguage(), 'de', 'latest request wins');
assert.equal(changed, 1, 'stale request never notifies listeners');
const next = setLanguage('tr');
await setLanguage('en');
await next;
assert.equal(getLanguage(), 'en', 'cached English cancels a pending request');
assert.equal(loadLanguage('es'), loadLanguage('es'), 'concurrent downloads share one promise');
await loadLanguage('es');
off();

const dom = new JSDOM('<!doctype html><html><body><button title="BACK">PLAY SOLO</button><p>STAGE 4 SHOP</p><aside>xyzzy</aside><bdi>BACK</bdi><span translate="no">Türkçe</span></body></html>');
Object.assign(globalThis, { document: dom.window.document });
let clicks = 0;
const button = document.querySelector('button')!;
button.addEventListener('click', () => clicks++);
for (const locale of ['es','fr','pt-BR','de','tr','ar','en'] as const) {
  await setLanguage(locale);
  assert.equal(document.documentElement.lang, locale);
  assert.equal(localize(t('text.twin_stick_arcade_roguelike_40bd5d')), t('text.twin_stick_arcade_roguelike_40bd5d'), `${locale}: translated copy survives mixed HTML templates`);
  for (const source of ['SETTINGS', 'WEATHER EFFECTS', 'DAMAGE NUMBERS', 'FIRST-TIME TIPS']) {
    const fresh = document.createElement('h1'); fresh.textContent = source;
    relocalizeDom(fresh, 'en');
    assert.equal(fresh.textContent, localize(source), `${locale}: fresh canonical label wins over inverse suffix templates`);
  }
  assert.equal(document.documentElement.dir, locale === 'ar' ? 'rtl' : 'ltr');
  assert.equal(button.textContent, localize('PLAY SOLO'));
  assert.equal(button.title, localize('BACK'));
  assert.equal(document.querySelector('bdi')!.textContent, 'BACK');
  assert.equal(document.querySelector('aside')!.textContent, 'xyzzy', 'unknown text is never swallowed by a translated template');
  assert.equal(document.querySelector('[translate=no]')!.textContent, 'Türkçe');
  assert(!t('menu.profile', { level: 12 }).includes('⟪'));
  button.click();
}
assert.equal(clicks, 7, 'switching preserves nodes/listeners');
assert.equal(document.querySelector('p')!.textContent, 'STAGE 4 SHOP', 'parameterized text survives full round trip');

await setLanguage('es');
const warnings: unknown[][] = [];
const warn = console.warn;
console.warn = (...args) => { warnings.push(args); };
const value = es['settings.language'];
try {
  delete (es as Partial<typeof es>)['settings.language'];
  assert.equal(t('settings.language'), en['settings.language']);
  assert.equal(t('settings.language'), en['settings.language']);
  assert.equal(warnings.length, 1, 'missing translations warn once');
} finally { es['settings.language'] = value; console.warn = warn; }
await setLanguage('en');
console.log(`ok   seven catalogs: ${keys.length} keys each; placeholders, lazy loading, races, browser defaults and live DOM switching`);
