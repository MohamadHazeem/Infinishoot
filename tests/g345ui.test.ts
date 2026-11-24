import './jsdomEnv';
import assert from 'node:assert/strict';
import { Hud, type HudState } from '../src/ui/hud';
import { HUD_DOCK } from '../src/ui/hudLayout';
import { Screens, type Offer, type ScreenActions } from '../src/ui/screens';
import { localize, setLanguage } from '../src/i18n';
import { WEAPONS } from '../src/data/weapons';

const root = document.getElementById('hud')!;
const hud = new Hud(root);
const screens = new Screens(root, {} as ScreenActions);
const state: HudState = {
  hp: 100, maxHp: 100, dash01: 1, dashStock: 1, dashMax: 1, bomb01: 1, special: 'BOMB',
  score: 0, combo: 0, multiplier: 1, combo01: 0, stage: 2, level: 1, xp01: 0,
  timeLeft: -1, kills: 0, gold: 0, gears: 0, lowHp: false,
  boss: { name: 'Rampage Rex', hp01: 1, enrage: 'ENRAGE IN 0:52' },
  spice: [{ kind: 'challenge', text: '★ REACH A 100 COMBO 0/100' }],
};
const $ = (s: string) => root.querySelector<HTMLElement>(s)!;
const hint = document.createElement('div');
hint.className = 'boss-act-hint';
$('#bossbar').appendChild(hint);

// The old visual fixture could advance through several UI messages within a single browser paint.
const frames: FrameRequestCallback[] = [];
globalThis.requestAnimationFrame = cb => frames.push(cb);
const paint = () => frames.splice(0).forEach(cb => cb(0));

// Chromium Rex fixture, 60 steps (warning) and 240 steps (toast and mechanic).
// Each line records [left, top, width, height] at the default HUD scale.
const layouts = [
  ['960 EN', [363,162,235,123], [287,149,387,30], [285,83,390,51], [14,88,145,21], [14,157,150,22]],
  ['960 AR', [393,162,174,196], [354,149,252,50], [285,83,390,64], [776,88,170,21], [771,171,176,22]],
  ['1280 EN', [483,216,313,163], [382,198,516,40], [380,111,520,68], [18,84,193,29], [18,175,199,29]],
  ['1280 AR', [524,216,232,260], [472,198,336,67], [380,111,520,85], [1035,88,227,29], [1028,200,234,29]],
  ['1920 EN', [803,324,313,163], [702,264,516,40], [700,148,520,84], [18,112,258,38], [18,216,205,32]],
  ['1920 AR', [844,324,232,260], [792,264,336,67], [700,148,520,104], [1599,112,303,38], [1662,237,240,32]],
] as const;
function overlaps(a: readonly number[], b: readonly number[]) {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}
function checkFrame() {
  paint();
  const centre = root.querySelectorAll('#banner.show, #toast.show, #bossintro:not([hidden]), #chestreveal:not([hidden])');
  assert(centre.length <= 1, 'at most one centre announcement per paint');
  for (const [size, warning, toast, bar, hint, challenge] of layouts) {
    const boxes: (readonly number[])[] = [bar, hint, challenge];
    if ($('#banner.show')) boxes.push(warning);
    if ($('#toast.show')) boxes.push(toast);
    for (let i = 0; i < boxes.length; i++)
      for (const other of boxes.slice(i + 1)) assert(!overlaps(boxes[i], other), size);
  }
}
hud.toast('ELITE INCOMING', 2);
hud.showBanner('WARNING!', 'RAMPAGE REX APPROACHES', 2.2);
hud.toast('NEXT', 2);
hud.toast('CHALLENGE: REACH A 100 COMBO', 3);
hud.update(state, 1);
checkFrame();
assert($('#banner.show'));
assert.equal($('#goals > .boss-act-hint'), hint);
assert(HUD_DOCK.some(([sel]) => hint.parentElement!.matches(sel)));
const intro = document.createElement('div');
intro.id = 'bossintro';
root.appendChild(intro);
hud.update(state, 2);
checkFrame();
assert(!$('#toast.show'), 'intro takes over when the warning expires');
intro.hidden = true;
hud.update(state, 0.01);
checkFrame();
assert.equal($('#toast.show').textContent, 'ELITE INCOMING', 'interrupted toast still gets its reading time');
hud.update(state, 1.3);
assert.equal($('#toast.show').textContent, 'NEXT');
hud.update(state, 3);
checkFrame();
assert(!$('#toast.show'), 'challenge lives only in the goals stack');
hud.showBanner('WARNING!', '', 0.1);
hud.update(state, 1);
paint();
assert(!$('#banner.show'), 'an animation callback cannot revive an expired warning');

hud.toast('ELITE INCOMING', 2);
hud.chestReveal({ id: 'armor', name: 'Armor', icon: '◆', color: '#73eff7', text: 'Armor' });
checkFrame();
assert(!$('#chestreveal').hidden);
hud.showBanner('WARNING!', '', 1);
checkFrame();
assert($('#chestreveal').hidden);
hud.update(state, 1);
checkFrame();
assert(!$('#chestreveal').hidden, 'the chest reel resumes before the interrupted toast');
hud.update(state, 4);
hud.update(state, 3);
checkFrame();
assert.equal($('#toast.show').textContent, 'ELITE INCOMING', 'time spent behind the chest does not expire the toast');

const cine = document.createElement('div');
cine.id = 'cine';
const overlays = ['cn-end', 'cn-reveal', 'cn-jack', 'cn-flaw'].map(name => {
  const el = document.createElement('div');
  el.className = name;
  el.hidden = true;
  cine.appendChild(el);
  return el;
});
root.appendChild(cine);
for (const overlay of overlays) {
  overlay.hidden = false;
  hud.update(state, 1);
  assert(!$('#toast.show'), overlay.className);
  overlay.hidden = true;
  hud.update(state, 1);
  assert.equal($('#toast.show').textContent, 'ELITE INCOMING');
}

const base: Offer = {
  id: 'drones', kind: 'weapon', slot: 'auto', name: 'Orbit Drones', text: 'Little drones circle you and bonk enemies.',
  icon: '✦', color: '#73eff7', tag: 'NEW!', tags: ['orbit'], paths: [{ id: 'gunslinger', points: 2 }, { id: 'demolitionist', points: 1 }],
};
const partner = { weapon: 'drones', passive: 'armor', haveWeapon: false, haveItem: true };
for (const lang of ['en', 'ar'] as const) {
  await setLanguage(lang);
  hud.update(state, 0);
  assert($('#goals .challenge').textContent!.includes(localize('REACH A 100 COMBO')));
  if (lang === 'ar') assert(!/[a-z]/i.test($('#goals .challenge').textContent!));
  for (const [offer, expected] of [
    [{ ...base, partner }, '.recipe'],
    [{ ...base, kind: 'evolve', name: WEAPONS.drones.evolution!.name, tag: 'EVOLVE!' }, '.recipe'],
    [{ ...base, kind: 'fusion', id: 'storm_drones', fuses: ['lightning', 'drones'] }, '.recipe'],
    [base, '.set-chip:not(.path-chip)'],
    [{ ...base, kind: 'track', id: 'buster' }, '.path-chip'],
    [{ ...base, kind: 'track', id: 'buster', paths: [] }, '.armour-hint'],
    [{ ...base, kind: 'gold', id: 'gold', slot: 'bonus', paths: [] }, null],
  ] as [Offer, string | null][]) {
    screens.showLevelUp([offer, offer, offer], 'LEVEL 1!', 0, []);
    const cards = root.querySelectorAll('#scr-levelup .cards > button.card');
    assert.equal(cards.length, 3);
    for (const card of cards) {
      const face = card.querySelector(':scope > .offer-context');
      const contextOnFace = [...card.querySelectorAll('.recipe, .partner, .set-chip, .armour-hint, .replaces')]
        .filter(el => !el.closest('.offer-detail'));
      assert.equal(contextOnFace.length, expected ? 1 : 0, 'counts every visible context, including stray strips');
      assert.equal(card.querySelectorAll(':scope > .offer-context').length, expected ? 1 : 0);
      if (expected) {
        assert(face!.matches(expected) || face!.querySelector(expected), expected);
        assert(face!.childElementCount <= 1, 'only one set/path even for multi-set or multi-path cards');
      }
      const detail = document.getElementById(card.getAttribute('aria-describedby')!)!;
      assert.equal(detail.getAttribute('role'), 'tooltip');
      assert(detail.textContent!.includes(localize(offer.text)));
      if (offer.kind === 'evolve') {
        assert.equal(detail.querySelectorAll('.partner .have').length, 2, 'ready evolution has both ingredients');
        assert(face!.textContent!.includes(localize(WEAPONS.drones.name)));
      }
      if (offer.partner) {
        assert(detail.querySelector('.partner .have'));
        assert(detail.querySelector('.armour-hint'));
        assert.equal(detail.querySelectorAll('.path-chip').length, 2);
        assert(detail.querySelector('.set-chip:not(.path-chip)'));
        assert(detail.querySelector('.chip-effect'));
      }
    }
  }
  const fusion = WEAPONS.storm_drones;
  screens.setPauseBuild([{ id: fusion.id, name: fusion.name, icon: fusion.icon, color: fusion.color,
    level: 1, max: true, kind: 'weapon', slot: 'auto' }]);
  const pauseTip = $('#scr-pause .build .badge .tip');
  assert(pauseTip.closest('[data-nav]'));
  assert(pauseTip.querySelector('.armour-hint'));
  for (const id of ['drones', 'lightning']) assert(pauseTip.textContent!.includes(localize(WEAPONS[id].name)));
}
console.log('Gate 3–5 HUD and level-up readability passed.');
window.close();
