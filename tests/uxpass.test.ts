// uxpass lane: menu fit rules and the "▼ MORE" scroll cue (src/ui/menuFit.ts).
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="hud"></div></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'navigator', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
}
(globalThis as any).__APP_VERSION__ = 'test';
(globalThis as any).matchMedia = () => ({ matches: false });
(globalThis as any).innerHeight = 720;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
// Pixel icons draw on a canvas; jsdom has none, so a do-nothing 2D context.
const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop });
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, { get: (_t, k) => (k === 'createImageData' || k === 'getImageData' ? (w: number, h: number) => ({ data: new Uint8ClampedArray(4 * (w || 64) * (h || 64)) }) : k === 'canvas' ? this : noop) });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
(globalThis as any).Path2D = class { constructor(_d?: string) {} };
(dom.window.HTMLElement.prototype as any).scrollBy = function (this: HTMLElement, o: { top: number }) { this.scrollTop += o.top; };

const { hiddenBelow, menuScroller, MoreCue, SHOP_PARTS, menuFitCss, moreCueTuning } = await import('../src/ui/menuFit');
const { setLanguage } = await import('../src/i18n');
const { sfx } = await import('../src/audio/sfx');
for (const key of Object.keys(sfx)) if (typeof (sfx as any)[key] === 'function') (sfx as any)[key] = () => {};
await setLanguage('en');

// ---- hiddenBelow: the cue shows only while more than `minHidden` px sit below the fold.
assert.equal(hiddenBelow({ scrollHeight: 1000, clientHeight: 720, scrollTop: 0 }), true);
assert.equal(hiddenBelow({ scrollHeight: 1000, clientHeight: 720, scrollTop: 280 }), false, 'scrolled to the end');
assert.equal(hiddenBelow({ scrollHeight: 720 + moreCueTuning.minHidden, clientHeight: 720, scrollTop: 0 }), false, 'a few pixels is not "more"');
assert.equal(hiddenBelow({ scrollHeight: 720, clientHeight: 720, scrollTop: 0 }), false);

// ---- a fake scroller: jsdom has no layout, so give elements their sizes by hand.
const sized = (el: HTMLElement, scrollH: number, clientH: number) => {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollH });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientH });
  el.style.overflowY = 'auto';
  return el;
};
const scr = document.createElement('div');
scr.className = 'screen';
document.body.append(scr);
const list = sized(document.createElement('div'), 900, 400);
scr.append(list);
sized(scr, 720, 720);
assert.equal(menuScroller(scr), list, 'a screen that fits but holds a scrolling list: the list is the scroller');
sized(scr, 1100, 720);
assert.equal(menuScroller(scr), scr, 'the screen itself scrolls');

const cue = new MoreCue(document.body);
cue.watch(scr);
assert.equal(cue.el.hidden, false, 'cue shows while content is below the fold');
assert.equal(cue.el.textContent, '▼ MORE');
assert.equal(cue.el.getAttribute('aria-hidden'), 'true', 'cue is decoration for screen readers (focus already scrolls)');
assert.equal(cue.el.tabIndex, -1, 'cue never takes menu focus');
cue.el.click();
assert.ok(scr.scrollTop > 0, 'clicking the cue scrolls the menu down');
scr.scrollTop = 380;
cue.update();
assert.equal(cue.el.hidden, true, 'cue hides at the end of the menu');
scr.scrollTop = 0;
await setLanguage('ar');
cue.update();
assert.equal(cue.el.textContent, '▼ المزيد', 'Arabic cue label');
await setLanguage('en');
cue.watch(null);
assert.equal(cue.el.hidden, true, 'no menu open: no cue');
scr.hidden = true;
cue.watch(scr);
assert.equal(cue.el.hidden, true, 'hidden screens never show the cue');
cue.watch(null);

// ---- the injected CSS keeps the pixel-art rules (CLAUDE.md): palette variables only, no radii/blur/smooth animation.
const css = menuFitCss();
assert.doesNotMatch(css, /border-radius|blur\(|box-shadow:\s*[^;]*\d+px\s+\d+px\s+\d+px/, 'no radii or blurred shadows');
assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-f]{3,8}\b(?![\w-])(?!\s*[,{>)])/i, 'colours come from the Sweetie 16 variables');
assert.doesNotMatch(css, /gradient\(/, 'no gradient shading');
for (const m of css.matchAll(/animation:\s*([^;]+);/g)) if (!/^none/.test(m[1])) assert.match(m[1], /steps\(/, `animation "${m[1]}" uses steps()`);
// A rule that sets `display` on a whole menu screen must keep `.screen[hidden]` working
// (the 720p shop grid once showed the hidden shop behind SETTINGS).
const topSplit = (s: string, sep: RegExp) => {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && sep.test(ch)) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
const screenDisplayRulesOk = (text: string) => {
  for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|[;\s])display\s*:/.test(m[2])) continue;
    for (const part of topSplit(m[1], /,/)) {
      const last = topSplit(part, /\s/).pop() ?? '';
      if (/^#(scr-[\w-]+|story-play)/.test(last) && !last.includes(':not([hidden])')) return part;
    }
  }
  return '';
};
assert.equal(screenDisplayRulesOk(css), '', 'every display rule on a menu screen keeps :not([hidden])');
assert.notEqual(screenDisplayRulesOk('#hud #scr-shop:not(:has(> :not(h1, .x))) { display: grid; }'), '', 'the check catches the old shop grid selector');
assert.match(css, /button\.lock \{ color: var\(--white\)/, 'shop LOCK labels are white on the blue button');
assert.match(css, /\(min-width: 1000px\) and \(max-height: 820px\)[\s\S]*#scr-shop \.owned-mods/, 'the shop has a 720p layout for the owned Mod row');
assert.match(css, /text-wrap: balance/, 'card text avoids one-word orphan lines');

// ---- the real shop markup: every top-level part is one the 720p grid places, so the grid applies.
const { Screens } = await import('../src/ui/screens');
const { MODS } = await import('../src/data/mods');
const { RELICS } = await import('../src/data/relics');
const hud = document.querySelector<HTMLElement>('#hud')!;
const screens = new Screens(hud, new Proxy({}, { get: () => () => {} }) as any);
const mods = MODS.filter((m) => !m.coop).slice(0, 9);
const view = {
  gold: 60, interest: 10, interestCap: 10, interestPer: 5,
  offers: mods.slice(0, 4).map((def) => ({ def, price: def.price, hint: '' })),
  owned: mods.slice(4, 9).map((def) => ({ def, sell: 3, readout: '+1', level: 1, maxLevel: 2, upCost: 6 })),
  slots: 5, rerollCost: 2, healCost: 3, healed: false, loadout: [], stage: 2, secret: false, relicOffers: [],
  relics: RELICS.slice(0, 3).map((r) => r.id),
  curse: { id: 'thick', name: 'Thick Skin', desc: 'Enemies have 25% more life.', icon: '☠', color: '#b13e53', gold: 10, score: 0.25 },
};
screens.showShop(view as any);
const shop = hud.querySelector<HTMLElement>('#scr-shop')!;
assert.equal(screens.current, 'shop');
for (const child of shop.children) assert.ok(SHOP_PARTS.some((sel) => child.matches(sel)), `shop part ${child.tagName}.${child.className} is placed by the 720p grid`);
assert.equal(shop.querySelectorAll('.owned-mod:not(.empty)').length, 5);
for (const m of shop.querySelectorAll('.owned-mod')) assert.ok(m.querySelector(':scope > .ctrl'), 'each owned Mod keeps its move/sell row as a direct child (pinned to the slot bottom at 720p)');
assert.match(shop.querySelector('.shop-relics .strip-t.mf-short')?.textContent ?? '', /YOUR RELICS 3/, 'relic strip carries its own short label for 720p');
assert.equal(shop.querySelectorAll('[data-act=lock]').length, 4, 'one LOCK per offer');
assert.equal(document.head.lastElementChild?.id, 'menu-fit-css', 'menu-fit CSS is last in <head>, so it wins ties with other injected menu rules');
assert.ok(hud.querySelector('.mf-more'), 'Screens mounts the scroll cue');
await setLanguage('ar');
screens.showShop(view as any);
assert.match(shop.querySelector('.shop-relics .strip-t.mf-short')?.textContent ?? '', /3/, 'Arabic relic label keeps the count');
assert.doesNotMatch(shop.querySelector('.shop-relics .strip-t.mf-short')?.textContent ?? '', /YOUR RELICS/, 'Arabic relic label is translated');
await setLanguage('en');

// BACK stays last in its row even when a lane appends a button after it later (RAID RECORDS on PLAY SOLO).
const { keepBackLast } = await import('../src/ui/menuFit');
const row = document.createElement('div');
row.className = 'menu row';
row.innerHTML = '<button data-act="md-start">NEXT</button><button data-act="md-back"><kbd data-prompt="back">ESC</kbd> BACK</button><button>RAID RECORDS</button>';
const wrap = document.createElement('div');
wrap.append(row);
keepBackLast(wrap);
assert.equal(row.lastElementChild?.getAttribute('data-act'), 'md-back', 'BACK moved after RAID RECORDS');
const mixed = document.createElement('div');
mixed.className = 'menu';
mixed.innerHTML = '<button data-act="x-back">BACK</button><p class="note">hint</p>';
keepBackLast(mixed.appendChild(document.createElement('span')).parentElement!);
assert.equal(mixed.firstElementChild?.getAttribute('data-act'), 'x-back', 'a BACK followed by non-button content is left alone');
screens.show('modes');
const modesRow = hud.querySelector('[data-act=md-back]')!.parentElement!;
modesRow.append(Object.assign(document.createElement('button'), { textContent: 'RAID RECORDS' }));
screens.show('title');
screens.show('modes');
assert.equal(modesRow.lastElementChild?.getAttribute('data-act'), 'md-back', 'PLAY SOLO keeps BACK last after a lane adds a button');

// Level-up cards: rarity, separator and item label are separate text nodes, so Arabic can't glue them ("أسطوريتطور").
const evo = { kind: 'evo', id: 'buster_evo', pick: 'buster|e|0', label: 'BUSTER EVOLUTION', slot: 'left', name: 'Flare Buster', icon: '✦', color: '#ef7d57', tag: 'EVOLVE!', text: 'Blazing orange bolts.', rarity: 'legendary' };
const plain = { kind: 'track', id: 'buster', pick: 'buster|t|0', label: 'BUSTER', slot: 'left', name: 'Heavy Rounds', icon: '•', color: '#41a6f6', tag: 'UPGRADE', text: 'Hits harder.' };
await setLanguage('ar');
screens.showLevelUp([evo, plain] as any, 'LEVEL 1!', 0, []);
const kinds = [...hud.querySelectorAll('#scr-levelup .card .kind')];
assert.equal(kinds.length, 2);
assert.ok(kinds[0].querySelector('.kind-label'), 'the item label has its own span');
assert.equal(kinds[0].querySelector('.kind-sep')?.textContent, ' · ', 'separator between rarity and label');
assert.doesNotMatch(kinds[0].querySelector('.kind-label')!.textContent!, /EVOLUTION/, 'label translated on its own');
assert.equal(kinds[1].querySelector('.kind-sep')?.textContent, '', 'no leading separator when a loadout card has no rarity');
await setLanguage('en');

// The shop's NEXT LV line diffs the localized sentences (wrapping English words first left Arabic half English).
const { nextLevelHtml } = await import('../src/ui/screens');
const { MOD_BY_ID } = await import('../src/data/mods');
await setLanguage('ar');
for (const id of ['momentum', 'kindling', 'hoarder']) {
  const def = MOD_BY_ID[id];
  if (!def) continue;
  const text = nextLevelHtml(def, 1).replace(/<[^>]+>/g, '');
  assert.doesNotMatch(text, /\b(for each|take|more|damage|every)\b/i, `${id}: NEXT LV line is Arabic: ${text}`);
}
await setLanguage('en');
assert.match(nextLevelHtml(MOD_BY_ID.momentum, 1), /<b>/, 'changed words are still highlighted');

console.log('ok uxpass: scroll cue, menu-fit CSS rules, shop 720p markup');
