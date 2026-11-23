import './jsdomEnv';
import assert from 'node:assert/strict';
import { Hud, type HudState } from '../src/ui/hud';
import { HUD_DOCK } from '../src/ui/hudLayout';
import { Screens, type Offer, type ScreenActions } from '../src/ui/screens';
import { localize, setLanguage } from '../src/i18n';

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

// Title and toast text boxes intersected in the pre-fix recordings. Replay visibility over those boxes.
const layouts = [
  { width: 960, height: 540, warning: [0, 162, 960, 196], toast: [328, 176, 303, 50] },
  { width: 1280, height: 720, warning: [0, 216, 1280, 101], toast: [454, 215, 372, 40] },
  { width: 1920, height: 1080, warning: [0, 324, 1920, 198], toast: [758, 298, 404, 67] },
];
function checkFrame() {
  paint();
  for (const { width, height, warning: a, toast: b } of layouts) {
    const intersects = a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
    assert(!(intersects && $('#banner.show') && $('#toast.show')), `double centre banner at ${width}×${height}`);
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

const base: Offer = {
  id: 'drones', kind: 'weapon', slot: 'auto', name: 'Orbit Drones', text: 'Little drones circle you and bonk enemies.',
  icon: '✦', color: '#73eff7', tag: 'NEW!', tags: ['orbit'], paths: [{ id: 'gunslinger', points: 2 }, { id: 'demolitionist', points: 1 }],
};
const partner = { weapon: 'drones', passive: 'armor', haveWeapon: false, haveItem: true };
for (const lang of ['en', 'ar'] as const) {
  await setLanguage(lang);
  state.spice[0].text = '★ REACH A 100 COMBO 1/100';
  hud.update(state, 0);
  assert($('#goals .challenge').textContent!.includes(localize('REACH A 100 COMBO')));
  for (const [offer, expected] of [
    [{ ...base, partner }, '.recipe'],
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
      assert.equal(card.querySelectorAll(':scope > .offer-context').length, expected ? 1 : 0);
      if (expected) {
        assert(face!.matches(expected) || face!.querySelector(expected), expected);
        assert(face!.childElementCount <= 1, 'only one set/path even for multi-set or multi-path cards');
      }
      const detail = document.getElementById(card.getAttribute('aria-describedby')!)!;
      assert.equal(detail.getAttribute('role'), 'tooltip');
      assert(detail.textContent!.includes(localize(offer.text)));
      if (offer.partner) {
        assert(detail.querySelector('.partner .have'));
        assert(detail.querySelector('.armour-hint'));
        assert.equal(detail.querySelectorAll('.path-chip').length, 2);
        assert(detail.querySelector('.set-chip:not(.path-chip)'));
        assert(detail.querySelector('.chip-effect'));
      }
    }
  }
  state.spice[0].text = '★ REACH A 100 COMBO 0/100';
  hud.update(state, 0);
}
console.log('Gate 3–5 HUD and level-up readability passed.');
window.close();
