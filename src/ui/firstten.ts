import { GOALS, FIRST_TEN_REWARD, type FirstTenSave, type NextTry } from '../game/firstten';
import { SKINS } from '../data/skins';
import type { Screens } from './screens';

/**
 * Firstten lane DOM (plain DOM, pixel style, CSS injected here): the FIRST
 * STEPS checklist on the title, the QUICK START strip on PLAY SOLO, one-time
 * helper strips on the first level-up and shop, the GOOD FIRST PICK badge
 * and the game-over NEXT TRY card. Logic: src/game/systems/firstten.ts.
 */
export interface FirstTenActions {
  quickStart(): void;
  hideChecklist(): void;
  claimReward(): void;
}

export class FirstTenUi {
  private readonly list: HTMLElement;
  private readonly quick: HTMLElement;
  private readonly lvHelp: HTMLElement;
  private readonly shopHelp: HTMLElement;
  private readonly next: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    _screens: Screens,
    actions: FirstTenActions,
  ) {
    injectCss();
    const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s);
    const title = q('#scr-title')!;
    title.insertAdjacentHTML('beforeend', `<div class="ft-list px" hidden></div>`);
    this.list = title.querySelector<HTMLElement>('.ft-list')!;

    const modes = q('#scr-modes')!;
    modes.querySelector('h1')!.insertAdjacentHTML(
      'afterend',
      `<div class="ft-quick px" hidden><span><b>FIRST TIME?</b> ROOKIE · STANDARD · MEDIUM are picked for you.</span><button data-nav data-act="ft-quick" class="continue">QUICK START &#9654;</button></div>`,
    );
    this.quick = modes.querySelector<HTMLElement>('.ft-quick')!;

    const lv = q('#scr-levelup')!;
    lv.querySelector('h1')!.insertAdjacentHTML('afterend', `<div class="ft-help px" hidden></div>`);
    this.lvHelp = lv.querySelector<HTMLElement>('.ft-help')!;

    const shop = q('#scr-shop')!;
    shop.querySelector('.shop-top')!.insertAdjacentHTML('afterend', `<div class="ft-help px" hidden></div>`);
    this.shopHelp = shop.querySelector<HTMLElement>('.ft-help')!;

    const go = q('#scr-gameover')!;
    go.querySelector('.newbest')!.insertAdjacentHTML('afterend', `<div class="ft-next px" hidden></div>`);
    this.next = go.querySelector<HTMLElement>('.ft-next')!;
    // Quick retry: RETRY / TITLE sit right under the K.O. (they used to fall below the fold at 720p).
    const row = go.querySelector<HTMLElement>(':scope > .menu.row');
    if (row) this.next.insertAdjacentElement('afterend', row);

    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'ft-quick') actions.quickStart();
      else if (b.dataset.act === 'ft-hide') actions.hideChecklist();
      else if (b.dataset.act === 'ft-claim') actions.claimReward();
    });
  }

  /** The FIRST STEPS panel on the title (hidden when `s` is null). */
  renderChecklist(s: FirstTenSave | null, complete: boolean): void {
    this.list.hidden = !s;
    if (!s) return;
    const skin = SKINS.find((k) => k.id === FIRST_TEN_REWARD.skin);
    const sw = skin ? [skin.armor, skin.accent, skin.suit, skin.hair].map((c) => `<i style="background:${c}"></i>`).join('') : '';
    const n = GOALS.filter((g) => s.done.includes(g.id)).length;
    if (complete) {
      this.list.className = 'ft-list px done';
      this.list.innerHTML = `<b class="ft-h">ALL DONE!</b><p>You finished FIRST STEPS. The <em>${FIRST_TEN_REWARD.name.toUpperCase()}</em> armour is yours: wear it in EXTRAS &gt; WARDROBE.</p><span class="ft-sw big">${sw}</span><button data-nav data-act="ft-claim" class="continue">AWESOME!</button>`;
      return;
    }
    this.list.className = 'ft-list px';
    const rows = GOALS.map((g) => {
      const on = s.done.includes(g.id);
      return `<li class="${on ? 'on' : ''}" title="${g.hint}"><i class="ft-box"></i><span>${g.label}</span>${on ? '' : `<small>${g.hint}</small>`}</li>`;
    }).join('');
    this.list.innerHTML = `<div class="ft-top"><b class="ft-h">FIRST STEPS</b><span class="ft-n">${n}/${GOALS.length}</span></div>
      <div class="ft-seg">${GOALS.map((_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>
      <ul>${rows}</ul>
      <div class="ft-reward"><span class="ft-sw">${sw}</span><span>REWARD: ${FIRST_TEN_REWARD.name.toUpperCase()} ARMOUR</span></div>
      <button data-nav data-act="ft-hide" class="ft-hide">HIDE</button>`;
  }

  setQuickStart(on: boolean): void {
    this.quick.hidden = !on;
  }

  /** First level-up: what to look at (null hides it). */
  setLevelHelp(on: boolean): void {
    this.lvHelp.hidden = !on;
    this.root.querySelector('#scr-levelup')!.classList.toggle('ft-first', on);
    if (!on) return;
    const chip = (cls: string, t: string) => `<i class="ft-chip ${cls}">${t}</i>`;
    this.lvHelp.innerHTML = `<b>PICK 1 CARD.</b> It's yours for the whole run. The ribbon says what it powers up: ${chip('left', 'LEFT CLICK')}${chip('right', 'RIGHT CLICK')}${chip('special', 'SPECIAL')}${chip('auto', 'AUTO WEAPON')}${chip('item', 'ITEM')} <small>NEW = something new · UPGRADE = level up what you have</small>`;
  }

  /** First shop: free gold (starting shop) or the real thing; marks the GOOD FIRST PICK offer. */
  setShopHelp(kind: 'pre' | 'shop' | null, pick = -1): void {
    this.shopHelp.hidden = !kind;
    const shop = this.root.querySelector('#scr-shop')!;
    shop.classList.toggle('ft-first', !!kind);
    for (const b of shop.querySelectorAll('.ft-pick')) b.remove();
    if (!kind) return;
    this.shopHelp.innerHTML =
      kind === 'pre'
        ? `<b>FREE GOLD!</b> Buy a Mod or two: Mods change how ALL your damage works. Gold left here isn't kept. Then <b>CONTINUE &#9654;</b>`
        : `<b>STAGE CLEAR!</b> Spend gold on Mods, or keep some: every 5 gold you hold pays 1 interest at the next clear.`;
    if (pick < 0) return;
    const card = shop.querySelectorAll('.shop-offers > *')[pick];
    card?.insertAdjacentHTML('afterbegin', `<i class="ft-pick">GOOD FIRST PICK</i>`);
  }

  /** Game over: the encouraging line and one next-try suggestion (null hides it). */
  setNextTry(t: NextTry | null, steps: string): void {
    this.next.hidden = !t;
    if (!t) return;
    this.next.innerHTML = `<b class="ft-cheer">${t.cheer}</b><div class="ft-tip"><i>NEXT TRY</i><span>${t.tip}</span></div>${steps ? `<small>${steps}</small>` : ''}`;
  }
}

let cssDone = false;
function injectCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'firstten-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const CSS = `
/* ---------------------------------------------------------------- FIRST STEPS (title) */
#scr-title .ft-list {
  --bg: var(--ink);
  --hi: var(--night);
  --lo: var(--ink);
  --ring: var(--lime);
  position: absolute;
  right: calc(10 * var(--p));
  top: 34%;
  width: min(290px, 26vw);
  padding: 10px 14px 12px;
  display: grid;
  gap: 6px;
  text-align: left;
  animation: ft-in 0.3s steps(3) both;
}
#scr-title .ft-list[hidden] { display: none; }
@keyframes ft-in { from { transform: translateX(calc(6 * var(--p))); opacity: 0; } }
.ft-top { display: flex; justify-content: space-between; align-items: baseline; }
.ft-h { font: 28px var(--display); color: var(--lime); text-shadow: var(--outline); }
.ft-n { font: 24px var(--display); color: var(--yellow); }
.ft-seg { display: flex; gap: var(--p); }
.ft-seg i { flex: 1; height: calc(2 * var(--p)); background: var(--night); }
.ft-seg i.on { background: var(--lime); }
.ft-list ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.ft-list li { display: grid; grid-template-columns: auto 1fr; column-gap: 8px; align-items: center; font-size: 18px; line-height: 1; color: var(--white); }
.ft-list li small { grid-column: 2; font: 9px var(--label); color: var(--mist); letter-spacing: 0; }
.ft-list li.on span { color: var(--lime); }
.ft-box { width: calc(4 * var(--p)); height: calc(4 * var(--p)); background: var(--night); box-shadow: 0 0 0 var(--p) var(--slate); position: relative; }
.ft-list li.on .ft-box { background: var(--green); box-shadow: 0 0 0 var(--p) var(--lime); }
.ft-list li.on .ft-box::after { content: ''; position: absolute; left: var(--p); top: 0; width: var(--p); height: calc(2 * var(--p)); border: solid var(--white); border-width: 0 var(--p) var(--p) 0; transform: rotate(45deg); }
.ft-reward { display: flex; align-items: center; gap: 8px; font: 10px var(--label); color: var(--yellow); }
.ft-sw { display: inline-flex; gap: 2px; }
.ft-sw i { width: calc(3 * var(--p)); height: calc(3 * var(--p)); box-shadow: 0 0 0 var(--p) var(--ink); }
.ft-sw.big i { width: calc(6 * var(--p)); height: calc(6 * var(--p)); }
#scr-title .ft-list .ft-hide { justify-self: end; font-size: 16px; padding: 3px 12px 5px; }
#scr-title .ft-list.done { --ring: var(--yellow); justify-items: center; text-align: center; font-size: 18px; }
#scr-title .ft-list.done .ft-h { color: var(--yellow); font-size: 34px; animation: ft-pop 0.6s steps(2) infinite; }
#scr-title .ft-list.done p { margin: 0; line-height: 1.1; }
#scr-title .ft-list.done em { font-style: normal; color: var(--yellow); }
@keyframes ft-pop { 50% { transform: translateY(calc(-1 * var(--p))); } }
@media (max-width: 1000px) {
  #scr-title .ft-list { position: static; width: min(520px, 92vw); }
}
@media (max-height: 640px) {
  #scr-title .ft-list li small { display: none; }
}

/* ---------------------------------------------------------------- QUICK START (PLAY SOLO) */
#scr-modes .ft-quick {
  --bg: var(--navy);
  --hi: var(--blue);
  --lo: var(--ink);
  --ring: var(--lime);
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 10px 8px 16px;
  margin: 0 auto 6px;
  font-size: 19px;
  max-width: min(760px, 94vw);
}
#scr-modes .ft-quick[hidden] { display: none; }
#scr-modes .ft-quick b { color: var(--lime); }
#scr-modes .ft-quick button { font-size: 22px; padding: 6px 16px 8px; white-space: nowrap; }

/* ---------------------------------------------------------------- first level-up / shop helper strips */
.screen .ft-help {
  --bg: var(--ink);
  --hi: var(--night);
  --lo: var(--ink);
  --ring: var(--yellow);
  max-width: min(900px, 94vw);
  margin: 0 auto 8px;
  padding: 6px 14px 8px;
  font-size: 19px;
  line-height: 1.25;
  text-align: center;
  animation: ft-in-down 0.3s steps(3) both;
}
.screen .ft-help[hidden] { display: none; }
#scr-levelup .ft-help {
  position: absolute;
  left: calc(6 * var(--p));
  top: 28%;
  width: min(230px, calc((100vw - 760px) / 2 - 8 * var(--p)));
  margin: 0;
  text-align: left;
  font-size: 18px;
  z-index: 2;
}
#scr-levelup .ft-help .ft-chip { display: block; width: max-content; margin: 4px 0; font-size: 11px; padding: 2px 6px 3px; }
@media (max-width: 1180px) {
  #scr-levelup .ft-help { position: static; width: auto; max-width: 94vw; margin: 0 auto 4px; text-align: center; font-size: 16px; }
  #scr-levelup .ft-help .ft-chip { display: inline-block; margin: 0 2px; }
  #scr-levelup .ft-help small { display: none; }
}
@keyframes ft-in-down { from { transform: translateY(calc(-4 * var(--p))); opacity: 0; } }
.ft-help b { color: var(--yellow); }
.ft-help small { display: block; font: 10px var(--label); color: var(--mist); margin-top: 2px; }
.ft-chip { font: 10px var(--label); font-style: normal; text-shadow: none; color: var(--ink); padding: 1px 5px 2px; margin: 0 3px; white-space: nowrap; }
.ft-chip.left { background: var(--sky); }
.ft-chip.right { background: var(--orange); }
.ft-chip.special { background: #b06bd6; }
.ft-chip.auto { background: var(--green); }
.ft-chip.item { background: var(--mist); }
/* First level-up: the slot ribbons blink to draw the eye. */
#scr-levelup.ft-first .card .slot-ribbon { animation: ft-ribbon 0.5s steps(2) 6; }
@keyframes ft-ribbon { 50% { filter: brightness(1.6); } }
#scr-shop.ft-first .offer-slot { position: relative; }
#scr-shop .ft-pick {
  position: absolute;
  left: 50%;
  top: calc(-4 * var(--p));
  transform: translateX(-50%);
  z-index: 3;
  font: 10px var(--label);
  font-style: normal;
  text-shadow: none;
  white-space: nowrap;
  color: var(--ink);
  background: var(--lime);
  padding: 2px 8px 3px;
  box-shadow: 0 0 0 var(--p) var(--ink), var(--p) var(--p) 0 var(--p) var(--ink);
  animation: ft-pop 0.6s steps(2) infinite;
  pointer-events: none;
}

/* ---------------------------------------------------------------- game over: NEXT TRY */
#scr-gameover .ft-next {
  --bg: var(--navy);
  --hi: var(--blue);
  --lo: var(--ink);
  --ring: var(--lime);
  max-width: min(760px, 94vw);
  margin: 0 auto 8px;
  padding: 6px 16px 8px;
  display: grid;
  gap: 2px;
  justify-items: center;
  text-align: center;
  animation: ft-in-down 0.35s steps(3) both;
}
#scr-gameover .ft-next[hidden] { display: none; }
.ft-cheer { font: 24px var(--display); color: var(--yellow); text-shadow: var(--outline); }
.ft-tip { display: flex; gap: 10px; align-items: center; font-size: 20px; line-height: 1.15; text-align: left; }
.ft-tip i { font: 10px var(--label); font-style: normal; text-shadow: none; color: var(--ink); background: var(--lime); padding: 2px 6px 3px; white-space: nowrap; }
#scr-gameover .ft-next small { font: 10px var(--label); color: var(--mist); }
`;
