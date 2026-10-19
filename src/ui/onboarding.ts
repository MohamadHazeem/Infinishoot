import { localizeHtml, localize } from '../i18n';
import { CODEX_TABS, codexCount, codexTab, type CodexTab } from '../data/arsenal';
import { RARITY } from '../data/rarity';
import { tagChips } from '../data/tags';
import type { UnlockProgress } from '../data/unlockProgress';
import { stageDps, type StageRecap } from '../game/runRecap';
import { iconHtml } from './pixelIcons';
import type { Screens } from './screens';

/**
 * Onboarding UI (plain DOM, pixel style): first-time tip panel, the TRAINING
 * prompt and "you're ready" screen, the CODEX screen, the title's training
 * offer, SETTINGS > TIPS, and the game-over extras (closest unlocks, run
 * timeline, BUILD CARD). Styles are injected once here, so style.css stays
 * untouched. The logic lives in src/game/onboarding.ts.
 */
export interface OnboardingActions {
  training(): void;
  declineTraining(): void;
  skipStep(): void;
  /** Training finished: start a run, or back to the title. */
  trainingDone(run: boolean): void;
  buildCard(): Promise<boolean>;
  toggleTips(): void;
  resetTips(): void;
  tipClosed(): void;
}

export interface TrainingView {
  step: number;
  total: number;
  title: string;
  text: string;
  canSkip: boolean;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtNum = (n: number) => Math.round(n).toLocaleString('en-US');

export class OnboardingUi {
  readonly tip: HTMLElement;
  readonly train: HTMLElement;
  readonly codex: HTMLElement;
  readonly ready: HTMLElement;
  private tab: CodexTab = 'weapons';
  private trainKey = '';

  constructor(
    private readonly root: HTMLElement,
    screens: Screens,
    actions: OnboardingActions,
  ) {
    injectCss();
    root.insertAdjacentHTML(
      'beforeend',
      localizeHtml(`<div id="ob-tip" class="px" hidden>
        <div class="ob-tip-h"><i>TIP</i><b></b><button class="ob-x" data-act="ob-tip-x" aria-label="Close">X</button></div>
        <p></p>
        <div class="ob-tip-bar"><i></i></div>
      </div>
      <div id="ob-train" class="px" hidden></div>`),
    );
    this.tip = root.querySelector<HTMLElement>('#ob-tip')!;
    this.train = root.querySelector<HTMLElement>('#ob-train')!;

    this.codex = el(`<div id="scr-arsenal" class="screen dim">
      <h1>ARSENAL</h1>
      <div class="ob-tabs"></div>
      <p class="note ob-count"></p>
      <div class="scroll"><div class="ob-codex"></div></div>
      <div class="menu row"><button data-nav data-act="ob-codex-back">BACK</button></div>
    </div>`);
    screens.addScreen('arsenal', this.codex, { columns: 4, onBack: () => screens.show('extras') });

    this.ready = el(`<div id="scr-training" class="screen dim">
      <h1>YOU'RE READY!</h1>
      <div class="ob-ready px">
        <p>That's the basics. A few things you'll meet in a run:</p>
        <ul>
          <li><b>STATUSES</b> Burn, Shock and Freeze. Two on one enemy make a combo: Burn + Shock = OVERLOAD, kill a frozen enemy = SHATTER, blast a burning one = NAPALM.</li>
          <li><b>MODS</b> Bought in the shop after each boss. Damage flows through their 5 slots left to right, so their order matters.</li>
          <li><b>STYLE</b> Fast kills, perfect dodges and parries raise your style (D to SS) for more score and XP.</li>
          <li><b>EVOLUTIONS</b> Upgrade a loadout item enough and it evolves: you pick one of two forms.</li>
        </ul>
        <p class="ob-dim">Tips pop up the first time things happen (SETTINGS > TIPS). Everything you find goes in EXTRAS > ARSENAL.</p>
      </div>
      <div class="menu row">
        <button data-nav data-act="ob-run" class="continue">START A RUN &#9654;</button>
        <button data-nav data-act="ob-title">TITLE</button>
      </div>
    </div>`);
    screens.addScreen('training', this.ready, { horizontal: true, onBack: () => actions.trainingDone(false) });

    // Buttons on the built-in screens.
    const after = (sel: string, html: string) => root.querySelector(sel)?.insertAdjacentHTML('afterend', localizeHtml(html));
    after('#scr-title [data-act=online]', '<button data-nav data-act="ob-training">TRAINING</button>');
    after('#scr-extras [data-act=bestiary]', '<button data-nav data-act="ob-codex">ARSENAL</button>');
    root.querySelector('#scr-settings [data-act=controls]')?.insertAdjacentHTML('beforebegin', localizeHtml('<button data-nav data-act="ob-tips">TIPS <b></b></button><button data-nav data-act="ob-tips-reset">RESET TIPS</button>'));
    root.querySelector('#scr-title .menu')?.insertAdjacentHTML(
      'beforebegin',
      localizeHtml(`<div class="ob-offer px" hidden><b>NEW HERE?</b><span>A two-minute TRAINING run teaches you to dash, parry, use your right click, special and more.</span>
        <div class="menu row"><button data-nav data-act="ob-training" class="continue">TRAINING &#9654;</button><button data-nav data-act="ob-offer-no">NO THANKS</button></div></div>`),
    );
    const go = root.querySelector('#scr-gameover');
    go?.querySelector('.go-cols')?.insertAdjacentHTML('beforeend', localizeHtml('<div class="ob-go"></div>'));
    go?.querySelector('.menu.row')?.insertAdjacentHTML('beforeend', localizeHtml('<button data-nav data-act="ob-card">BUILD CARD</button>'));

    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      switch (b?.dataset.act) {
        case 'ob-training':
          return actions.training();
        case 'ob-offer-no':
          actions.declineTraining();
          this.setOffer(false);
          return screens.show('title');
        case 'ob-codex':
          return screens.show('arsenal');
        case 'ob-codex-back':
          return screens.show('extras');
        case 'ob-tab':
          this.tab = b.dataset.tab as CodexTab;
          this.renderCodex();
          return screens.show('arsenal', [...this.codex.querySelectorAll('[data-nav]')].indexOf(this.codex.querySelector('.ob-tab.on')!));
        case 'ob-skip':
          return actions.skipStep();
        case 'ob-run':
          return actions.trainingDone(true);
        case 'ob-title':
          return actions.trainingDone(false);
        case 'ob-tips':
          actions.toggleTips();
          return;
        case 'ob-tips-reset':
          actions.resetTips();
          b.textContent = localize('TIPS RESET!');
          return;
        case 'ob-tip-x':
          return actions.tipClosed();
        case 'ob-card': {
          b.textContent = localize('SAVING...');
          void actions.buildCard().then((ok) => {
            b.textContent = localize(ok ? 'CARD SAVED!' : 'NO CARD');
            setTimeout(() => (b.textContent = localize('BUILD CARD')), 2200);
          });
          return;
        }
      }
    });
  }

  // ---------------------------------------------------------------- tips

  showTip(title: string, text: string, seconds: number): void {
    const t = this.tip;
    t.querySelector('b')!.textContent = localize(title);
    t.querySelector('p')!.textContent = localize(text);
    t.style.setProperty('--life', `${seconds}s`);
    t.hidden = false;
    t.classList.remove('in');
    void t.offsetWidth;
    t.classList.add('in');
  }

  hideTip(): void {
    this.tip.hidden = true;
  }

  // ---------------------------------------------------------------- training

  setTraining(v: TrainingView | null): void {
    if (!v) {
      this.train.hidden = true;
      this.trainKey = '';
      return;
    }
    const key = `${v.step}|${v.text}|${v.canSkip}`;
    this.train.hidden = false;
    if (key === this.trainKey) return;
    const fresh = !this.trainKey.startsWith(`${v.step}|`);
    this.trainKey = key;
    const pips = Array.from({ length: v.total }, (_, i) => `<i class="${i < v.step ? 'on' : i === v.step ? 'now' : ''}"></i>`).join('');
    this.train.innerHTML = localizeHtml(`<div class="ob-tr-h"><span>TRAINING ${v.step + 1}/${v.total}</span><b>${v.title}</b>${v.canSkip ? '<button class="ob-x" data-act="ob-skip">SKIP STEP</button>' : ''}</div>
      <p>${v.text}</p><div class="ob-pips">${pips}</div>`);
    if (fresh) {
      this.train.classList.remove('in');
      void this.train.offsetWidth;
      this.train.classList.add('in');
    }
  }

  /** A step done: flash the panel. */
  stepDone(): void {
    this.train.classList.remove('ok');
    void this.train.offsetWidth;
    this.train.classList.add('ok');
  }

  // ---------------------------------------------------------------- title / settings

  setOffer(on: boolean): void {
    const o = this.root.querySelector<HTMLElement>('#scr-title .ob-offer');
    if (o) o.hidden = !on;
  }

  syncSettings(tipsOn: boolean): void {
    const b = this.root.querySelector<HTMLElement>('#scr-settings [data-act=ob-tips] b');
    if (b) b.textContent = localize(tipsOn ? 'ON' : 'OFF');
    const r = this.root.querySelector<HTMLElement>('#scr-settings [data-act=ob-tips-reset]');
    if (r) r.textContent = localize('RESET TIPS');
  }

  // ---------------------------------------------------------------- codex

  renderCodex(discovered: readonly string[] = this.lastDiscovered): void {
    this.lastDiscovered = discovered;
    const set = new Set(discovered);
    this.codex.querySelector('.ob-tabs')!.innerHTML = localizeHtml(CODEX_TABS.map((t) => {
      const c = codexCount(t.id, discovered);
      return `<button data-nav data-act="ob-tab" data-tab="${t.id}" class="ob-tab ${t.id === this.tab ? 'on' : ''}">${t.label}<small>${c.have}/${c.total}</small></button>`;
    }).join(''));
    const c = codexCount(this.tab, discovered);
    this.codex.querySelector('.ob-count')!.textContent = localize(`${c.have} / ${c.total} DISCOVERED`);
    this.codex.querySelector('.ob-codex')!.innerHTML = localizeHtml(codexTab(this.tab)
      .map((e) => {
        if (!set.has(e.key))
          return `<div class="ob-cx unseen" data-nav tabindex="-1"><div class="ic">${iconHtml(e.icon, '#333c57', '?')}</div><b>???</b><em>${e.kind}</em><span>Not discovered yet.</span></div>`;
        const r = e.rarity ? `<em class="r-text-${e.rarity}">${RARITY[e.rarity].label} · ${e.kind}</em>` : `<em>${e.kind}</em>`;
        return `<div class="ob-cx ${e.rarity ? 'r-' + e.rarity : ''}" data-nav tabindex="-1" style="--c:${e.color}"><div class="ic">${iconHtml(e.icon, e.color, e.glyph)}</div><b>${e.name}</b>${r}<span>${e.desc}</span>${e.tags?.length ? `<div class="chips">${tagChips(e.tags)}</div>` : ''}</div>`;
      })
      .join(''));
  }
  private lastDiscovered: readonly string[] = [];

  // ---------------------------------------------------------------- game over

  renderGameOver(unlocks: UnlockProgress[], stages: StageRecap[]): void {
    const box = this.root.querySelector<HTMLElement>('#scr-gameover .ob-go');
    if (!box) return;
    const ul = unlocks
      .map((u) => {
        const segs = 10;
        const on = Math.floor(u.frac * segs);
        return `<div class="ob-ul"><div class="ob-ul-t"><b>${u.label}</b><span>${fmtNum(u.cur)}/${fmtNum(u.max)} ${u.unit}</span></div><div class="ob-seg">${Array.from({ length: segs }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</div><small>${u.desc}</small></div>`;
      })
      .join('');
    const shown = stages.slice(-6);
    const maxDps = Math.max(1, ...shown.map(stageDps));
    const maxKills = Math.max(1, ...shown.map((s) => s.kills));
    const bar = (v: number, max: number, c: string) => `<i class="ob-bar" style="--w:${Math.max(1, Math.round((v / max) * 12))};--c:${c}"></i>`;
    const rows = shown
      .map(
        (s) => `<tr><td class="st">ST ${s.stage}</td><td>${s.level}</td>
          <td><span class="b">${bar(stageDps(s), maxDps, 'var(--orange)')}${fmtNum(stageDps(s))}</span></td>
          <td><span class="b">${bar(s.kills, maxKills, 'var(--lime)')}${fmtNum(s.kills)}</span></td>
          <td class="g">${fmtNum(s.gold)}</td><td>${fmtTime(s.time)}</td><td class="bt">${s.bossTime >= 0 ? fmtTime(s.bossTime) : '—'}</td></tr>`,
      )
      .join('');
    box.innerHTML =
      localizeHtml((ul ? `<div class="ob-unlocks px"><div class="hs-title">CLOSEST UNLOCKS</div>${ul}</div>` : '') +
      (rows
        ? `<div class="ob-recap px"><div class="hs-title">RUN TIMELINE</div><table><tr><th></th><th>LV</th><th>DPS</th><th>KILLS</th><th>GOLD</th><th>TIME</th><th>BOSS</th></tr>${rows}</table></div>`
        : ''));
  }
}

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = localizeHtml(html.trim());
  return t.content.firstElementChild as HTMLElement;
}

function injectCss(): void {
  if (document.getElementById('onboarding-css')) return;
  const st = document.createElement('style');
  st.id = 'onboarding-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const CSS = `
/* ---------------------------------------------------------------- onboarding: tip panel */
#ob-tip {
  --bg: var(--ink);
  --hi: var(--night);
  --lo: var(--ink);
  --ring: var(--yellow);
  position: absolute;
  left: calc(6 * var(--p));
  top: 42%;
  width: min(300px, 40vw);
  padding: 8px 12px 10px;
  pointer-events: auto;
  z-index: 12;
  text-shadow: none;
}
/* Over a menu: a compact panel in the top-right corner, which the level-up
 * cards and the shop's first row leave free (top-left covers the first card). */
.menu-open #ob-tip {
  top: calc(6 * var(--p));
  left: auto;
  right: calc(6 * var(--p));
  width: min(250px, 30vw);
  padding: 6px 10px 8px;
}
.menu-open #ob-tip .ob-tip-h b {
  font-size: 18px;
}
.menu-open #ob-tip p {
  margin: 2px 0 4px;
  font-size: 15px;
}
#ob-tip.in {
  animation: ob-in 0.24s steps(3) both;
}
#ob-tip .ob-tip-h {
  display: flex;
  align-items: center;
  gap: 8px;
}
#ob-tip .ob-tip-h i {
  font: 10px var(--label);
  font-style: normal;
  padding: 2px 4px;
  background: var(--yellow);
  color: var(--ink);
}
#ob-tip .ob-tip-h b {
  flex: 1;
  font: 22px var(--display);
  letter-spacing: 1px;
  color: var(--yellow);
  text-shadow: var(--outline);
}
#ob-tip p {
  margin: 4px 0 6px;
  font: 18px/1.15 var(--font);
  color: var(--white);
}
#ob-tip .ob-tip-bar {
  height: var(--p);
  background: var(--night);
}
#ob-tip .ob-tip-bar i {
  display: block;
  height: 100%;
  background: var(--yellow);
  transform-origin: left;
  animation: ob-drain var(--life, 6s) steps(12) both;
}
@keyframes ob-drain {
  to {
    transform: scaleX(0);
  }
}
@keyframes ob-in {
  from {
    transform: translateX(calc(-6 * var(--p)));
    opacity: 0;
  }
}
.ob-x {
  --bg: var(--night);
  --hi: var(--slate);
  --lo: var(--ink);
  font: 10px var(--label);
  color: var(--mist);
  background: var(--night);
  border: 0;
  padding: 3px 6px;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: 0 0 0 var(--p) var(--ink);
}
.ob-x:hover {
  color: var(--white);
  background: var(--slate);
}

/* ---------------------------------------------------------------- training prompt */
#ob-train {
  --bg: var(--navy);
  --hi: var(--blue);
  --lo: var(--ink);
  --ring: var(--cyan);
  position: absolute;
  left: 50%;
  bottom: calc(34 * var(--p));
  width: min(560px, 92vw);
  transform: translateX(-50%);
  padding: 8px 14px 10px;
  pointer-events: auto;
  z-index: 9;
  text-shadow: none;
}
#ob-train.in {
  animation: ob-up 0.24s steps(3) both;
}
#ob-train.ok {
  animation: ob-ok 0.4s steps(4) both;
}
@keyframes ob-up {
  from {
    transform: translate(-50%, calc(6 * var(--p)));
    opacity: 0;
  }
}
@keyframes ob-ok {
  0%,
  50% {
    background-color: var(--green);
  }
}
#ob-train .ob-tr-h {
  display: flex;
  align-items: center;
  gap: 10px;
}
#ob-train .ob-tr-h span {
  font: 10px var(--label);
  color: var(--cyan);
  letter-spacing: 1px;
}
#ob-train .ob-tr-h b {
  flex: 1;
  font: 30px var(--display);
  color: var(--yellow);
  text-shadow: var(--outline);
}
#ob-train p {
  margin: 2px 0 6px;
  font: 20px/1.15 var(--font);
  color: var(--white);
}
.ob-pips {
  display: flex;
  gap: var(--p);
}
.ob-pips i {
  flex: 1;
  height: calc(2 * var(--p));
  background: var(--ink);
}
.ob-pips i.on {
  background: var(--lime);
}
.ob-pips i.now {
  background: var(--yellow);
  animation: ob-blink 0.8s steps(2) infinite;
}
@keyframes ob-blink {
  50% {
    background: var(--orange);
  }
}

/* ---------------------------------------------------------------- title offer, ready screen */
#scr-title .ob-offer {
  --bg: var(--navy);
  --hi: var(--blue);
  --lo: var(--ink);
  --ring: var(--yellow);
  position: absolute;
  left: calc(10 * var(--p));
  top: 46%;
  width: min(300px, 28vw);
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 10px 14px 12px;
  text-align: center;
  animation: ob-in 0.3s steps(3) both;
}
#scr-title .ob-offer[hidden] {
  display: none;
}
@media (max-width: 1000px) {
  #scr-title .ob-offer {
    position: static;
    width: min(520px, 92vw);
  }
}
#scr-title .ob-offer > b {
  font: 30px var(--display);
  color: var(--yellow);
}
#scr-title .ob-offer > span {
  font-size: 19px;
  line-height: 1.1;
}
#scr-title .ob-offer .menu.row button {
  font-size: 22px;
  padding: 8px 18px 10px;
}
.ob-ready {
  --bg: var(--ink);
  --hi: var(--night);
  --lo: var(--ink);
  max-width: 680px;
  padding: 12px 20px 14px;
  font-size: 20px;
  line-height: 1.2;
  text-shadow: none;
}
.ob-ready ul {
  margin: 6px 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}
.ob-ready li {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 10px;
  align-items: baseline;
}
.ob-ready li b {
  font: 12px var(--label);
  color: var(--cyan);
}
.ob-ready .ob-dim {
  color: var(--mist);
  font-size: 18px;
}

/* ---------------------------------------------------------------- codex */
#scr-arsenal {
  gap: 12px;
}
#scr-arsenal .ob-tabs {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  max-width: 1000px;
}
#scr-arsenal button.ob-tab {
  font-size: 20px;
  padding: 6px 12px 8px;
  display: grid;
  justify-items: center;
}
#scr-arsenal button.ob-tab small {
  font: 10px var(--label);
  color: var(--mist);
}
#scr-arsenal button.ob-tab.on {
  --bg: var(--teal);
  --hi: var(--green);
}
#scr-arsenal button.ob-tab.on.focused,
#scr-arsenal button.ob-tab.focused {
  --bg: var(--orange);
  --hi: var(--yellow);
}
#scr-arsenal .scroll {
  width: min(1040px, 96vw);
  max-height: 58vh;
  overflow-y: auto;
  padding: 8px;
}
.ob-codex {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px;
}
.ob-cx {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 2px 10px;
  align-content: start;
  padding: 8px 10px;
  background: var(--night);
  box-shadow: 0 0 0 var(--p) var(--ink), inset 0 calc(-1 * var(--p)) 0 var(--ink);
  outline: none;
}
.ob-cx .ic {
  grid-row: span 3;
}
.ob-cx > b {
  font: 20px var(--font);
  color: var(--white);
}
.ob-cx > em {
  font: 9px var(--label);
  font-style: normal;
  color: var(--cyan);
}
.ob-cx > span {
  grid-column: 1 / -1;
  font-size: 16px;
  line-height: 1.1;
  color: var(--mist);
}
.ob-cx .chips {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.ob-codex .ob-cx.focused {
  box-shadow: 0 0 0 var(--p) var(--ink), 0 0 0 calc(2 * var(--p)) var(--white);
}
.ob-cx.r-uncommon {
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) 0 0 var(--green);
}
.ob-cx.r-rare {
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) 0 0 var(--sky);
}
.ob-cx.r-legendary {
  box-shadow: 0 0 0 var(--p) var(--ink), inset 0 0 0 var(--p) var(--yellow);
}
.ob-cx.unseen {
  background: var(--ink);
}
.ob-cx.unseen > b,
.ob-cx.unseen > span {
  color: var(--slate);
}

/* ---------------------------------------------------------------- game over extras */
.ob-go {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: stretch;
}
.ob-go:empty {
  display: none;
}
.ob-unlocks,
.ob-recap {
  --bg: var(--ink);
  --hi: var(--night);
  --lo: var(--ink);
  padding: 10px 16px 12px;
  text-shadow: none;
}
.ob-unlocks {
  display: grid;
  gap: 4px;
  width: min(360px, 92vw);
}
.ob-ul-t {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 18px;
  line-height: 1;
}
.ob-ul-t b {
  font-weight: normal;
  color: var(--yellow);
}
.ob-ul-t span {
  color: var(--white);
}
.ob-ul small {
  font: 9px var(--label);
  color: var(--mist);
}
.ob-seg {
  display: flex;
  gap: var(--p);
  margin: 2px 0;
}
.ob-seg i {
  flex: 1;
  height: calc(3 * var(--p));
  background: var(--night);
}
.ob-seg i.on {
  background: var(--lime);
  box-shadow: inset 0 calc(-1 * var(--p)) 0 var(--green);
}
.ob-recap table {
  border-collapse: separate;
  border-spacing: 7px 1px;
  font-size: 17px;
  line-height: 1;
}
.ob-recap th {
  font: 9px var(--label);
  font-weight: normal;
  color: var(--cyan);
  text-align: left;
}
.ob-recap td.st {
  font: 10px var(--label);
  color: var(--yellow);
}
.ob-recap .b {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 78px;
}
.ob-recap .ob-bar {
  display: block;
  width: calc(var(--w) * var(--p));
  height: calc(3 * var(--p));
  background: var(--c);
  box-shadow: 0 0 0 1px var(--ink);
}
.ob-recap td.g {
  color: var(--yellow);
}
.ob-recap td.bt {
  color: var(--orange);
}
`;
