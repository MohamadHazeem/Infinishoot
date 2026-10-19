/**
 * Trading lane UI (src/game/systems/trading.ts):
 * - the TRADE quick menu (screen 'trade'): give each teammate gold, a gear or one of your relics;
 *   opened with Y in a co-op fight, from PAUSE > TRADE (gamepads) or the shop's TRADE button;
 * - the shop's TEAM POOL panel: start a pool on one of your offers, chip into a teammate's;
 * - co-op titles on the team panel's player cards.
 * Plain DOM, pixel-art rules, CSS injected from here.
 */
import type { Game } from '../game/game';
import type { ShopView } from './screens';
import { MenuNav } from './menu';
import { escapeHtml, t } from '../i18n';
import { MOD_BY_ID } from '../data/mods';
import { RELIC_BY_ID } from '../data/relics';
import { titleChip } from './coopTitle';
import { iconHtml } from './pixelIcons';
import { MAX_GEARS } from '../game/hero';
import { promptText } from './prompts';
import { tradeTuning } from '../game/trading';
import { tradeVersion, tradingOn, type TradeView } from '../game/systems/trading';

const CSS = `
#scr-trade .tr-wrap { max-width: 760px; margin: 0 auto; text-align: start; }
#scr-trade .tr-me { font: 20px var(--font); color: var(--yellow); text-align: center; margin-bottom: calc(2 * var(--p)); text-shadow: var(--outline); }
#scr-trade .tr-mate { --bg: var(--night); --hi: var(--slate); --lo: var(--ink); background: var(--bg); padding: calc(3 * var(--p)) calc(4 * var(--p)); margin: calc(4 * var(--p)) 0; border-inline-start: calc(2 * var(--p)) solid var(--c); }
#scr-trade .tr-mate.left { opacity: 0.5; }
#scr-trade .tr-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: calc(2 * var(--p)); font: 24px var(--font); color: var(--white); text-shadow: var(--outline); }
#scr-trade .tr-head small { font: 11px var(--label); letter-spacing: 1px; color: var(--mist); }
#scr-trade .tr-btns { display: flex; flex-wrap: wrap; gap: calc(2 * var(--p)); margin-top: calc(2 * var(--p)); }
#scr-trade .tr-btns button { font-size: 20px; padding: var(--p) calc(3 * var(--p)); }
#scr-trade .tr-relics { display: flex; flex-wrap: wrap; gap: calc(2 * var(--p)); margin-top: calc(2 * var(--p)); }
#scr-trade .tr-relics button { font-size: 18px; display: inline-flex; align-items: center; gap: var(--p); padding: var(--p) calc(2 * var(--p)); }
#scr-trade .tr-relics .px-icon { width: 24px; height: 24px; }
#scr-trade .tr-note { font: 11px var(--label); letter-spacing: 1px; color: var(--mist); text-align: center; margin-top: calc(3 * var(--p)); }
#scr-trade .tr-back { display: flex; justify-content: center; margin-top: calc(3 * var(--p)); }
.tr-title { display: inline-block; font: 10px var(--label); letter-spacing: 1px; color: var(--ink); background: var(--tc, var(--yellow)); padding: 0 var(--p); text-shadow: none; vertical-align: middle; }
.tr-title.mythic { animation: tr-myth 1.2s steps(4) infinite; }
@keyframes tr-myth { 0% { background: var(--white); } 25% { background: var(--cyan); } 50% { background: var(--yellow); } 75% { background: var(--lime); } }
#team .mate .tr-title, #scr-trade .tr-me .tr-title { margin-inline-start: calc(2 * var(--p)); }
#scr-trade .tr-mate .gold-dot, #scr-trade .tr-me .gold-dot, #scr-shop .tr-pool .gold-dot { margin-inline-start: var(--p); }
#scr-online .diff[data-diff=legend]:not(.on):not(.locked) { color: var(--yellow); }
#scr-shop .tr-pool { --bg: var(--night); --hi: var(--slate); --lo: var(--ink); background: var(--bg); max-width: 1000px; margin: calc(3 * var(--p)) auto 0; padding: calc(2 * var(--p)) calc(3 * var(--p)); text-align: start; }
#scr-shop .tr-sec { font: 12px var(--label); letter-spacing: 1px; color: var(--cyan); margin-bottom: var(--p); }
#scr-shop .tr-prow { display: flex; flex-wrap: wrap; align-items: center; gap: calc(2 * var(--p)); font: 20px var(--font); color: var(--white); text-shadow: var(--outline); margin: var(--p) 0; }
#scr-shop .tr-prow > i { width: calc(3 * var(--p)); height: calc(3 * var(--p)); background: var(--c); box-shadow: 0 0 0 calc(0.5 * var(--p)) var(--ink); }
#scr-shop .tr-bar { width: 120px; height: calc(3 * var(--p)); background: var(--ink); box-shadow: 0 0 0 calc(0.5 * var(--p)) var(--slate); position: relative; }
#scr-shop .tr-bar b { position: absolute; inset: 0 auto 0 0; width: var(--f); background: var(--yellow); }
#scr-shop .tr-pool button { font-size: 18px; padding: 0 calc(2 * var(--p)); }
#scr-shop .tr-pool .tr-start { display: flex; flex-wrap: wrap; align-items: center; gap: calc(2 * var(--p)); margin-top: var(--p); }
#scr-shop .tr-pool .tr-start > span, #scr-shop .tr-pool .tr-none { font: 11px var(--label); letter-spacing: 1px; color: var(--mist); }
`;

const gold = (n: number) => `${n}<span class="gold-dot"></span>`;

export class TradeUi {
  readonly el: HTMLElement;
  private nav: MenuNav;
  /** Hero index whose relic picker is open in the TRADE menu (-1: none). */
  private relicFor = -1;
  private shown = -1;
  private shopShown = -1;
  private lastShop: ShopView | null = null;
  private titleT = 0;
  private titleKey = '';

  constructor(private g: Game) {
    if (!document.getElementById('tr-css')) {
      const st = document.createElement('style');
      st.id = 'tr-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.id = 'scr-trade';
    this.el.className = 'screen dim';
    this.nav = new MenuNav(this.el, { onBack: () => this.close() });
    g.screens.addScreen('trade', this.el, this.nav);
    this.el.addEventListener('click', (e) => this.click(e));
    // The shop: remember the last view (its offers start pools), and draw the pool panel after it.
    const screens = g.screens;
    const show = screens.showShop.bind(screens);
    screens.showShop = (v: ShopView, focus?: number) => {
      this.lastShop = v;
      show(v, focus);
      this.renderPool();
    };
    document.getElementById('scr-shop')?.addEventListener('click', (e) => this.click(e));
    // PAUSE > TRADE, for gamepads (and anyone who forgets the key); hidden outside co-op.
    const resume = document.querySelector('#scr-pause [data-act=resume]');
    if (resume && !document.querySelector('#scr-pause [data-tr=open]')) {
      resume.insertAdjacentHTML('afterend', `<button data-tr="open" hidden>${escapeHtml(t('trading.trade'))}</button>`);
      document.querySelector('#scr-pause [data-tr=open]')!.addEventListener('click', () => this.open());
    }
  }

  get isOpen(): boolean {
    return this.g.screens.current === 'trade';
  }

  open(): void {
    this.relicFor = -1;
    this.render();
    this.g.screens.show('trade', 0);
  }

  close(): void {
    this.relicFor = -1;
    const g = this.g;
    if (g.mode === 'shop' && this.lastShop) {
      g.screens.showShop(this.lastShop);
      if (g.role !== 'client') g.presentShop(g.hero);
      return;
    }
    if (g.mode === 'shop') return g.screens.show('none');
    g.resume();
  }

  /** Per step: redraw what changed, keep the pause button and the title chips current. */
  tick(): void {
    const g = this.g;
    const v = tradeVersion(g);
    const on = tradingOn(g);
    if (this.isOpen) {
      if (!on || !(g.isCombatMode || g.mode === 'shop')) this.close();
      else if (v !== this.shown) this.render(true);
    }
    if (g.screens.current === 'shop' && v !== this.shopShown) this.renderPool(true);
    const pb = document.querySelector<HTMLElement>('#scr-pause [data-tr=open]');
    if (pb && pb.hidden === on) {
      pb.hidden = !on;
      pb.toggleAttribute('data-nav', on); // hidden buttons stay out of the menu's navigation
    }
    if ((this.titleT -= 1) <= 0) {
      this.titleT = 15;
      this.titles();
    }
  }

  private view(): TradeView {
    return this.g.tradeView();
  }

  // ------------------------------------------------------------ TRADE menu

  private render(keepFocus = false): void {
    const v = this.view();
    this.shown = tradeVersion(this.g);
    const me = v.heroes[v.me];
    const mates = v.heroes.filter((h) => h.index !== v.me);
    const half = Math.floor((me?.gold ?? 0) / 2);
    const rows = mates
      .map((h) => {
        if (h.left) return `<div class="tr-mate left" style="--c:${h.color}"><div class="tr-head"><bdi>${escapeHtml(h.name)}</bdi><small>${escapeHtml(t('trading.left'))}</small></div></div>`;
        const can = (_n: number) => ((me?.gold ?? 0) > 0 ? '' : 'cant');
        const btns = [
          ...tradeTuning.goldSteps.map((n) => `<button data-nav data-tr="gold" data-to="${h.index}" data-n="${n}" class="${can(n)}">${escapeHtml(t('trading.give'))} ${gold(n)}</button>`),
          `<button data-nav data-tr="gold" data-to="${h.index}" data-n="${half}" class="${half > 0 ? '' : 'cant'}">${escapeHtml(t('trading.give_half'))} ${gold(half)}</button>`,
          `<button data-nav data-tr="gear" data-to="${h.index}" class="${(me?.gears ?? 0) > 0 && h.gears < MAX_GEARS ? '' : 'cant'}">${escapeHtml(t('trading.give_gear'))}</button>`,
          `<button data-nav data-tr="relics" data-to="${h.index}" class="${me?.relics.some((r) => !h.relics.includes(r)) ? '' : 'cant'}">${escapeHtml(t('trading.give_relic'))} &#9654;</button>`,
        ].join('');
        const relics =
          this.relicFor === h.index && me
            ? `<div class="tr-relics">${me.relics
                .filter((r) => !h.relics.includes(r))
                .map((id) => {
                  const r = RELIC_BY_ID[id];
                  return `<button data-nav data-tr="relic" data-to="${h.index}" data-id="${id}" class="r-${r.rarity}" title="${escapeHtml(r.desc)}">${iconHtml(r.id, r.color, r.icon)}${escapeHtml(r.name)}</button>`;
                })
                .join('')}<button data-nav data-tr="relics" data-to="-1">${escapeHtml(t('trading.cancel'))}</button></div>`
            : '';
        const info = `${gold(h.gold)} · ${escapeHtml(t('trading.gears', { n: h.gears }))} · ${escapeHtml(t('trading.relics', { n: h.relics.length }))}${h.down ? ` · ${escapeHtml(t('trading.down'))}` : ''}`;
        return `<div class="tr-mate px" style="--c:${h.color}"><div class="tr-head"><bdi>${escapeHtml(h.name)}</bdi>${titleChip(h.title)}<small>${info}</small></div><div class="tr-btns">${btns}</div>${relics}</div>`;
      })
      .join('');
    const fight = this.g.mode !== 'shop';
    this.el.innerHTML = `<h1>${escapeHtml(t('trading.trade'))}</h1><div class="tr-wrap">
      <div class="tr-me">${escapeHtml(t('trading.you'))}: ${gold(me?.gold ?? 0)} · ${escapeHtml(t('trading.gears', { n: me?.gears ?? 0 }))} · ${escapeHtml(t('trading.relics', { n: me?.relics.length ?? 0 }))}${me ? titleChip(me.title) : ''}</div>
      ${rows || `<div class="tr-note">${escapeHtml(t('trading.nobody'))}</div>`}
      <div class="tr-back"><button data-nav data-tr="back">${escapeHtml(t('trading.back'))}</button></div>
      <div class="tr-note">${escapeHtml(fight ? (promptText('trade') ? t('trading.note_fight', { key: promptText('trade') }) : t('trading.note_pad')) : t('trading.note_shop'))}</div></div>`;
    if (!this.isOpen) return;
    // The relic picker takes the focus when it opens.
    const items = [...this.el.querySelectorAll<HTMLElement>('[data-nav]')];
    const relic = this.relicFor >= 0 ? items.findIndex((b) => b.dataset.tr === 'relic') : -1;
    this.nav.refresh(relic >= 0 && !keepFocus ? relic : keepFocus ? this.nav.focus : 0);
  }

  // ------------------------------------------------------------ shop pool panel

  private renderPool(keep = false): void {
    const g = this.g;
    const shop = document.getElementById('scr-shop');
    if (!shop) return;
    this.shopShown = tradeVersion(g);
    let box = shop.querySelector<HTMLElement>('.tr-pool');
    const on = tradingOn(g) && g.screens.current === 'shop';
    if (!on) {
      box?.remove();
      return;
    }
    if (!box) {
      box = Object.assign(document.createElement('div'), { className: 'tr-pool px' });
      const at = shop.querySelector('.owned-title');
      if (at) at.before(box);
      else shop.appendChild(box);
    }
    // Keep the focus on the same control across the redraw (the panel's button count changes).
    const focused = shop.querySelector<HTMLElement>('[data-nav].focused');
    const fKey = focused && box.contains(focused) ? `${focused.dataset.tr}:${focused.dataset.p ?? focused.dataset.i ?? ''}` : '';
    const v = this.view();
    const me = v.heroes[v.me];
    const mine = v.pools.find((p) => p.owner === v.me);
    const rows = v.pools
      .map((p) => {
        const o = v.heroes[p.owner];
        const m = MOD_BY_ID[p.mod];
        if (!o || !m) return '';
        const f = Math.round((p.paid / Math.max(1, p.price)) * 100);
        const left = Math.max(0, p.price - p.paid);
        const chips = [
          ...tradeTuning.chipSteps.filter((n) => n < left).map((n) => `<button data-nav data-tr="chip" data-p="${p.id}" data-n="${n}" class="${(me?.gold ?? 0) > 0 ? '' : 'cant'}">${escapeHtml(t('trading.chip'))} ${gold(n)}</button>`),
          `<button data-nav data-tr="chip" data-p="${p.id}" data-n="${left}" class="${(me?.gold ?? 0) > 0 ? '' : 'cant'}">${escapeHtml(t('trading.chip_rest'))} ${gold(Math.min(left, me?.gold ?? 0))}</button>`,
          p.owner === v.me ? `<button data-nav data-tr="unpool" data-p="${p.id}">${escapeHtml(t('trading.cancel'))}</button>` : '',
        ].join('');
        return `<div class="tr-prow" style="--c:${o.color}"><i></i><bdi>${escapeHtml(o.name)}</bdi> ${iconHtml(m.id, m.color, m.icon)} ${escapeHtml(m.name)} <b>${p.paid}/${gold(p.price)}</b><span class="tr-bar" style="--f:${f}%"><b></b></span>${p.mine ? `<small>${escapeHtml(t('trading.yours', { n: p.mine }))}</small>` : ''}${chips}</div>`;
      })
      .join('');
    // Your own offers start pools: the host reads its hero, a client the last shop the host sent.
    const offers = g.role === 'client' ? (this.lastShop?.offers ?? []).map((o) => (o ? { name: o.def.name, price: o.price } : null)) : g.hero.shopOffers.map((m) => (m ? { name: m.name, price: g.hero.price(m) } : null));
    const start =
      !mine && me
        ? `<div class="tr-start"><span>${escapeHtml(t('trading.start_pool'))}</span>${offers
            .map((o, i) => (o ? `<button data-nav data-tr="pool" data-i="${i}">${escapeHtml(o.name)} ${gold(o.price)}</button>` : ''))
            .join('')}</div>`
        : '';
    box.innerHTML = `<div class="tr-sec">${escapeHtml(t('trading.pool_title'))}</div>${rows || `<div class="tr-none">${escapeHtml(t('trading.no_pools'))}</div>`}${start}<div class="tr-start"><button data-nav data-tr="open">${escapeHtml(t('trading.trade'))} &#9654;</button></div>`;
    void keep;
    const items = [...shop.querySelectorAll<HTMLElement>('[data-nav]')];
    let k = focused && !box.contains(focused) ? items.indexOf(focused) : -1;
    if (fKey) k = items.findIndex((x) => `${x.dataset.tr}:${x.dataset.p ?? x.dataset.i ?? ''}` === fKey);
    this.g.screens.refreshNav(k >= 0 ? k : undefined);
  }

  // ------------------------------------------------------------ titles on the team panel

  private titles(): void {
    const els = document.querySelectorAll<HTMLElement>('#team .mate');
    if (!els.length) return;
    const v = this.view();
    const mates = v.heroes.filter((h) => h.index !== v.me);
    const key = mates.map((h) => h.title).join(',') + els.length;
    els.forEach((el, j) => {
      const h = mates[j];
      const nm = el.querySelector('.nm');
      if (!h || !nm) return;
      const have = nm.querySelector('.tr-title');
      if (have && key === this.titleKey) return;
      have?.remove();
      if (h.title) nm.insertAdjacentHTML('beforeend', titleChip(h.title));
    });
    this.titleKey = key;
  }

  // ------------------------------------------------------------ input

  private click(e: Event): void {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tr]');
    if (!b || b.matches('.cant, :disabled')) return;
    const g = this.g;
    const to = Number(b.dataset.to);
    switch (b.dataset.tr) {
      case 'open':
        return this.open();
      case 'back':
        return this.close();
      case 'gold':
        return g.tradeAct({ a: 'give', k: 'gold', to, n: Number(b.dataset.n) });
      case 'gear':
        return g.tradeAct({ a: 'give', k: 'gear', to });
      case 'relic':
        this.relicFor = -1;
        g.tradeAct({ a: 'give', k: 'relic', to, id: String(b.dataset.id) });
        return this.render(true);
      case 'relics':
        this.relicFor = this.relicFor === to ? -1 : to;
        return this.render(this.relicFor < 0);
      case 'pool':
        return g.tradeAct({ a: 'pool', i: Number(b.dataset.i) });
      case 'chip':
        return g.tradeAct({ a: 'chip', p: Number(b.dataset.p), n: Number(b.dataset.n) });
      case 'unpool':
        return g.tradeAct({ a: 'unpool', p: Number(b.dataset.p) });
    }
  }
}
