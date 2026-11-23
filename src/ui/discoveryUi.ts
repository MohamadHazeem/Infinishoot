import { INTERACTIONS, PARTS, partPrice, sockets } from '../data/craftParts';
import { readJournal } from '../game/crafting';
import { onLanguageChange, t } from '../i18n';
import { prompt } from './prompts';
import type { Screens, ShopView } from './screens';

const back = () =>
  `<button data-nav data-craft-back>${prompt('back')} ${t('text.back_1dd26f')}</button>`;
export class DiscoveryUi {
  private bench = document.createElement('div');
  private book = document.createElement('div');
  private view?: ShopView;
  private tab = 0;
  private fromBench = false;

  constructor(
    private screens: Screens,
    private buy: (i: number) => void,
  ) {
    this.bench.id = 'scr-workbench';
    this.book.id = 'scr-discoveries';
    this.bench.className = this.book.className = 'screen dim craft-screen';
    screens.addScreen('workbench', this.bench, { onBack: () => screens.show('shop') });
    screens.addScreen('discoveries', this.book, { onBack: () => this.leaveBook() });
    this.bench.addEventListener('click', (event) => {
      const b = (event.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.hasAttribute('data-craft-back')) screens.show('shop');
      else if (b.hasAttribute('data-book')) this.openBook(true);
      else if (b.dataset.tab !== undefined) {
        this.tab = Number(b.dataset.tab);
        this.drawBench();
        screens.refreshNav(this.tab);
      } else if (b.dataset.part !== undefined && b.getAttribute('aria-disabled') !== 'true')
        this.buy(Number(b.dataset.part));
    });
    this.book.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-craft-back]')) this.leaveBook();
    });
    onLanguageChange(() => {
      if (screens.current === 'workbench') this.drawBench();
      if (screens.current === 'discoveries') this.drawBook();
    });
    if (!document.getElementById('craft-style')) {
      const style = document.createElement('style');
      style.id = 'craft-style';
      style.textContent = `
        #hud .craft-screen { gap:calc(3 * var(--p)); padding:calc(6 * var(--p)); }
        #hud .craft-screen > h1 { margin:0; color:var(--yellow); }
        .craft-screen .craft-body { width:min(94%,calc(224 * var(--p))); max-height:65vh; overflow:auto; background:var(--ink); padding:calc(2 * var(--p)); }
        .craft-screen .craft-tabs { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:calc(2 * var(--p)); }
        .craft-screen .craft-tabs button { display:grid; text-align:start; }
        .craft-screen .craft-tabs small,.craft-screen .craft-cost { color:var(--yellow); }
        .craft-screen [aria-pressed=true] { --bg:var(--blue); --hi:var(--cyan); }
        #hud .craft-screen button { padding:calc(2 * var(--p)) calc(4 * var(--p)); font-size:calc(7 * var(--p)); }
        .craft-screen .craft-choices { display:grid; gap:calc(2 * var(--p)); padding:calc(3 * var(--p)); }
        .craft-screen .craft-choices button { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.7fr) auto; gap:calc(3 * var(--p)); text-align:start; align-items:center; }
        .craft-screen small { display:block; font:calc(5.5 * var(--p))/1.25 var(--font); }
        .craft-screen .craft-cost { grid-column:3; }
        .craft-screen .craft-choices [aria-disabled=true] .craft-cost { color:var(--mist); }
        .craft-screen p { margin:0; text-align:center; max-width:calc(220 * var(--p)); }
        @media(max-width:600px){ .craft-screen .craft-choices button { grid-template-columns:1fr auto; } .craft-screen .craft-choices small { grid-column:1; } .craft-screen .craft-cost { grid-column:2; grid-row:1 / 3; } }
        .craft-screen .craft-record { background:var(--ink); text-align:start; padding:calc(3 * var(--p)); margin:calc(2 * var(--p)); }
        .craft-screen .craft-record.focused { outline:var(--p) solid var(--cyan); }
        .craft-screen .craft-record b { color:var(--cyan); }
        .craft-screen .craft-record small:last-child { color:var(--yellow); }
      `;
      document.head.append(style);
    }
  }
  openBench(v: ShopView): void {
    if (!v.craft) return;
    this.view = v;
    this.drawBench();
    this.screens.show('workbench');
  }
  private drawBench(): void {
    const v = this.view;
    if (!v?.craft) return;
    const { recipe, room } = v.craft;
    const group = sockets[this.tab];
    const tabs = sockets
      .map(
        (s, i) =>
          `<button data-nav data-tab="${i}" aria-pressed="${s === group}"><b>${t('craft.' + s)}</b><small>${t('craft.' + (recipe?.[s] ?? 'empty'))}</small></button>`,
      )
      .join('');
    const buttons = PARTS.slice(this.tab * 5, this.tab * 5 + 5)
      .map((id, i) => {
        const price = partPrice(id),
          fitted = recipe?.[group] === id;
        const unavailable = fitted || (!recipe && (!room || group !== 'frame')) || price > v.gold;
        return `<button data-nav data-part="${this.tab * 5 + i}" aria-disabled="${unavailable}"><b>${t('craft.' + id)}</b><small>${t('craft.' + id + '.tip')}</small>
        <span class="craft-cost">${fitted ? t('craft.fitted') : '<span class="gold-dot"></span> ' + price}</span></button>`;
      })
      .join('');
    const info = !recipe ? (!room ? 'full' : group !== 'frame' ? 'needFrame' : 'intro') : 'refit';
    this.bench.innerHTML = `<h1>${t('craft.bench')}</h1><p>${t('craft.' + info)}</p><b><span class="gold-dot"></span> ${v.gold}</b>
      <div class="craft-body"><div class="craft-tabs">${tabs}</div><div class="craft-choices">${buttons}</div></div>
      <div class="menu row"><button data-nav data-book>${t('craft.codex')}</button>${back()}</div>`;
  }
  openBook(fromBench = false): void {
    this.fromBench = fromBench;
    this.drawBook();
    this.screens.show('discoveries');
  }
  private leaveBook(): void {
    this.screens.show(this.fromBench ? 'workbench' : 'bestiary');
  }
  private drawBook(): void {
    const journal = readJournal();
    const rows = INTERACTIONS.filter((id) => journal[id] !== undefined).map(
      (id) =>
        `<div class="craft-record" data-nav tabindex="0"><b>${t('craft.' + id)}</b><small>${t('craft.' + id + '.tip')}</small><small>${t('craft.spent', { seed: journal[id]! })}</small></div>`,
    );
    this.book.innerHTML = `<h1>${t('craft.codex')}</h1><p>${t('craft.progress', { n: rows.length, total: INTERACTIONS.length })}</p>
      <div class="craft-body">${rows.join('')}${rows.length < INTERACTIONS.length ? `<p>◇ ${t('craft.hidden')}</p>` : ''}</div><div class="menu row">${back()}</div>`;
  }
}
