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

// ================= menuhud lane (src/ui/menuHud.ts)
{
  const { HUD_DOCK, injectHudCss } = await import('../src/ui/hudLayout');
  const { MENU_KEEP, MENU_COVER_EXTRA, freeSpot, placeTip, MenuTip, columnsHeight, syncShopLife, STICKY_BARS, stickyBarTop } = await import('../src/ui/menuHud');
  injectHudCss();
  const win = dom.window;
  // Build every corner HUD panel from its dock selector (inside #hud), plus the chips that live beside #hud.
  const build = (sel: string, parent: Element): HTMLElement => {
    let at: Element = parent;
    for (const tok of sel.split(/\s*>\s*|\s+/)) {
      const id = tok.match(/#([\w-]+)/)?.[1];
      const classes = [...tok.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      let el = (id ? document.getElementById(id) : null) ?? (!id ? at.querySelector(`:scope > ${tok}`) : null);
      if (!el) {
        el = document.createElement('div');
        if (id) el.id = id;
        el.classList.add(...classes);
        at.append(el);
      }
      at = el;
    }
    return at as HTMLElement;
  };
  const panels = new Map<string, HTMLElement>();
  for (const [sel] of HUD_DOCK) if (!MENU_KEEP.includes(sel)) panels.set(sel, build(sel, hud));
  for (const sel of MENU_COVER_EXTRA) panels.set(sel, build(sel, hud));
  const vc = document.getElementById('vc-self') ?? Object.assign(document.createElement('div'), { id: 'vc-self' });
  hud.after(vc); // the voice chip is #hud's sibling in the game
  const visible = (el: HTMLElement) => win.getComputedStyle(el).visibility !== 'hidden';
  const MENUS = ['shop', 'relic', 'levelup', 'pause', 'route', 'gameover', 'settings', 'title'] as const;
  for (const name of MENUS) {
    screens.show(name as any);
    assert.ok(hud.classList.contains('menu-open'), `${name}: #hud is marked menu-open`);
    for (const [sel, el] of panels) assert.equal(visible(el), false, `${name}: corner HUD panel ${sel} is hidden under the menu`);
    assert.equal(visible(vc), false, `${name}: the voice chip beside #hud hides too`);
  }
  screens.show('none');
  for (const [sel, el] of panels) assert.equal(visible(el), true, `in play: ${sel} shows again`);
  assert.ok(panels.has('#ingame > #xpbar') && panels.has('#ingame > #hp') && panels.has('#hudface'), 'life bar, XP bar and the LV/face badge are covered');
  assert.ok(HUD_DOCK.filter(([s]) => !MENU_KEEP.includes(s)).length >= 30, 'every docked panel is covered (generated from the dock list)');

  // ---- tips over menus: a free spot, else the title chip, else hidden (never over content)
  // The 5-Mod shop at 1280x720 (recorded): title, gold line, the offer row reaching the right edge, owned row, extras.
  const shopBoxes = [
    { x: 540, y: 6, w: 200, h: 38 }, { x: 348, y: 50, w: 583, h: 32 }, { x: 262, y: 88, w: 755, h: 29 },
    { x: 97, y: 123, w: 1084, h: 293 }, { x: 21, y: 433, w: 1054, h: 229 }, { x: 1090, y: 542, w: 168, h: 120 }, { x: 356, y: 674, w: 567, h: 38 },
  ];
  const sizes = [{ w: 250, h: 128, chipH: 32 }, { w: 340, h: 104, chipH: 32 }, { w: 460, h: 92, chipH: 32 }];
  const hit = (a: any, b: any) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const spot = placeTip(shopBoxes, sizes, 1280, 720)!;
  assert.ok(spot, 'the shop leaves room for at least the tip chip');
  assert.equal(spot.fold, true, 'MOD ORDER MATTERS folds to its title chip over the 5-Mod shop (no room for the full panel)');
  assert.ok(!shopBoxes.some((b) => hit(spot.rect, b)), 'the tip chip covers no card, button or line of the shop');
  assert.ok(spot.rect.x + spot.rect.w > 1000 && spot.rect.y < 60, 'the chip keeps the old top-right corner');
  const roomy = placeTip([{ x: 300, y: 150, w: 680, h: 420 }], sizes, 1280, 720)!;
  assert.deepEqual([roomy.fold, roomy.rect.x, roomy.rect.y], [false, 1280 - 250 - 8, 8], 'with room the full tip keeps the top-right corner');
  const left = placeTip([{ x: 700, y: 0, w: 580, h: 720 }, { x: 300, y: 300, w: 400, h: 420 }], sizes, 1280, 720)!;
  assert.equal(left.fold, false, 'a full tip moves to the free left side');
  assert.ok(left.rect.x < 300 && !hit(left.rect, { x: 700, y: 0, w: 580, h: 720 }), 'left side, clear of the menu');
  assert.equal(placeTip([{ x: 0, y: 0, w: 1280, h: 720 }], sizes, 1280, 720), null, 'a menu with no free space hides the tip');
  assert.equal(freeSpot([], 2000, 50, 1280, 720), null, 'a box wider than the window never fits');

  // MenuTip on a real DOM: content boxes and tip sizes stubbed (jsdom has no layout).
  const rect = (el: Element, f: () => { x: number; y: number; w: number; h: number }) =>
    Object.defineProperty(el, 'getBoundingClientRect', { configurable: true, value: () => { const r = f(); return { left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h, width: r.w, height: r.h, x: r.x, y: r.y }; } });
  const tipRoot = document.createElement('div');
  tipRoot.id = 'hud';
  const menu = document.createElement('div');
  menu.className = 'screen';
  menu.id = 'scr-fake';
  const card = document.createElement('button');
  card.textContent = 'BUY';
  rect(card, () => ({ x: 97, y: 123, w: 1084, h: 293 }));
  const row2 = document.createElement('button');
  row2.textContent = 'SELL';
  rect(row2, () => ({ x: 21, y: 433, w: 1054, h: 250 }));
  menu.append(card, row2);
  const tipEl = document.createElement('div');
  tipEl.id = 'ob-tip';
  tipEl.innerHTML = '<div class="ob-tip-h"><b>MOD ORDER MATTERS</b></div><p>Damage flows left to right.</p>';
  rect(tipEl, () => ({ x: Number.parseFloat(tipEl.style.left) || 1022, y: Number.parseFloat(tipEl.style.top) || 8, w: Number.parseFloat(tipEl.style.width) || 250, h: tipEl.hasAttribute('data-mh-fold') ? 32 : 128 }));
  tipRoot.append(menu, tipEl);
  document.body.append(tipRoot);
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
  (dom.window as any).innerWidth = 1280;
  (dom.window as any).innerHeight = 720;
  const placer = new MenuTip(tipRoot);
  placer.watch(menu);
  assert.ok(tipEl.hasAttribute('data-mh'), 'MenuTip takes over the tip while a menu is open');
  assert.equal(tipEl.getAttribute('data-mh-fold'), '', 'the tip folds to its chip when the full panel would cover the card');
  const tr = tipEl.getBoundingClientRect();
  assert.ok(tr.bottom + 8 <= 123, `the chip sits above the card row (bottom ${tr.bottom})`);
  rect(card, () => ({ x: 97, y: 300, w: 900, h: 300 }));
  rect(row2, () => ({ x: 97, y: 610, w: 900, h: 100 }));
  placer.update(true);
  assert.equal(tipEl.hasAttribute('data-mh-fold'), false, 'with room the full tip shows');
  placer.watch(null);
  assert.equal(tipEl.hasAttribute('data-mh'), false, 'no menu: the HUD dock places the tip again');
  assert.equal(tipEl.style.left, '', 'inline placement cleared');
  tipRoot.remove();

  // ---- the shop shows the hero's life (the HUD life bar is hidden under it)
  await setLanguage('en');
  screens.showShop(view as any);
  const hpNum = build('#ingame > #hp', hud).appendChild(Object.assign(document.createElement('div'), { className: 'num', textContent: '30/100' }));
  syncShopLife(hud);
  assert.match(shop.querySelector('.shop-top .mh-life')?.textContent ?? '', /LIFE\s*30\/100/, 'the shop shows LIFE hp/max next to the gold');
  assert.equal(shop.querySelector('.mh-life')!.classList.contains('low'), true, 'low life is marked');
  await setLanguage('ar');
  syncShopLife(hud);
  assert.match(shop.querySelector('.mh-life')?.textContent ?? '', /الحياة/, 'Arabic life label');
  await setLanguage('en');
  hpNum.remove();
  screens.show('none');

  // ---- game over: RETRY and the score on the first screen, result panels in .go-body, and the recorded 720p blocks fit
  const go = hud.querySelector<HTMLElement>('#scr-gameover')!;
  const kids = [...go.children];
  assert.ok(kids.indexOf(go.querySelector('.menu.row')!) < kids.indexOf(go.querySelector('.go-body')!), 'RETRY / TITLE come before the result panels');
  for (const sel of ['.summary', '.dmg-table', '.build', '.unlocked', '.hiscores', '.hiscores.global']) assert.ok(go.querySelector(`.go-body ${sel}`), `${sel} lives in .go-body (the column layout)`);
  assert.ok(go.querySelector('.go-body > .hiscores'), 'the high scores stay a direct child (clips insert before them)');
  const css2 = menuFitCss();
  assert.match(css2, /\(min-width: 1000px\) and \(max-height: 1200px\)[\s\S]*#scr-gameover \.go-body \{ display: block;[^}]*columns: 3/, 'game over: three balanced columns on 720p/1080p-class windows');
  assert.match(css2, /#hud #scr-gameover \.go-body \{ display: contents; \}/, 'big windows: .go-body is transparent (old layout)');
  assert.match(css2, /\(max-height: 820px\)[\s\S]*\.ob-recap:not\(:hover, :focus-within, \.focused\) tbody/, 'the 720p timeline folds to a strip, full table on hover/focus');
  const { GAME_OVER_720 } = await import('./menuhudCases');
  assert.equal(columnsHeight([100, 100, 100], 3), 100, 'three blocks, three columns');
  assert.equal(columnsHeight([100, 100, 100, 100], 2, 10), 190, 'a column break drops the last margin');
  for (const c of GAME_OVER_720) {
    const body = columnsHeight(c.items.map(([, h]) => h), 3, c.margin);
    assert.ok(Math.abs(body - c.bodyH) <= 12, `${c.lang}: the column model matches the browser (${body} vs ${c.bodyH})`);
    const total = c.padTop + c.head.reduce((a, [, h]) => a + h, 0) + c.gap * c.head.length + body + c.padBottom;
    assert.ok(total <= 720, `${c.lang}: game over fits one 1280x720 screen (${total} px, was ${c.before})`);
    const oneColumn = c.items.reduce((a, [, h]) => a + h, 0);
    assert.ok(c.padTop + c.head.reduce((a, [, h]) => a + h, 0) + oneColumn > 720, `${c.lang}: the same blocks in one column would not fit (the check can fail)`);
    assert.ok(c.head.findIndex(([n]) => n === 'menu') >= 0 && c.items[0][0] === 'summary', `${c.lang}: RETRY in the header, the score first in the columns`);
  }
  // The recap folds to a strip with a details hint, and is focusable for pads.
  const { OnboardingUi } = await import('../src/ui/onboarding');
  const ob = new OnboardingUi(hud, screens, new Proxy({}, { get: () => () => {} }) as any);
  ob.renderGameOver([], [1, 2, 3].map((n) => ({ stage: n, level: n * 5, kills: 100 * n, damage: 9000 * n, gold: n, time: 240, bossTime: 30 })));
  const recap = go.querySelector<HTMLElement>('.go-body .ob-recap');
  assert.ok(recap, 'the run timeline sits in the game-over columns');
  assert.ok(recap!.hasAttribute('data-nav'), 'the folded timeline can take pad/keyboard focus (focus opens the full table)');
  assert.equal(recap!.querySelectorAll('tr').length, 4, 'header + one row per stage');
  assert.match(recap!.querySelector('.mh-more')?.textContent ?? '', /DETAILS/, 'the strip says how to open the details');

  // ---- phones: the primary action rows are sticky, and the cue sits above them
  assert.match(css2, /\(max-height: 500px\)[\s\S]*position: sticky/, 'phone action bars are sticky');
  for (const sel of STICKY_BARS) assert.ok(css2.includes(`#hud ${sel}`), `${sel} is a sticky bar on phones`);
  screens.show('loadout');
  const lo = hud.querySelector<HTMLElement>('#scr-loadout')!;
  const startRow = lo.querySelector<HTMLElement>(':scope > .menu.row:last-of-type');
  assert.ok(startRow?.querySelector('[data-act=lo-start], [data-act=lo-back], button'), 'LOADOUT has its START row last');
  assert.equal(stickyBarTop(lo), null, 'jsdom applies no phone media rules: no sticky bar, so the cue keeps its spot');
  screens.show('none');
}

console.log('ok uxpass: scroll cue, menu-fit CSS rules, shop 720p markup; menuhud: HUD under menus, tips, game over, phones');
