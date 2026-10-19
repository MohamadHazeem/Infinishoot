import { isRtl, localize, localizeHtml, t } from '../i18n';
import type { Input } from '../core/input';
import { sfx } from '../audio/sfx';
import { navLock } from '../game/titlePlay';

/**
 * Keyboard / gamepad / mouse navigation for one menu. Navigable elements are
 * those with a `data-nav` attribute inside `root`. Range inputs are adjusted
 * with left/right; everything else is activated with Enter / Space / (A).
 */
export class MenuNav {
  focus = 0;
  private items: HTMLElement[] = [];
  private repeat = 0;
  private dirty = false;
  private selected: HTMLElement | undefined;
  private observer: MutationObserver | undefined;

  constructor(
    private root: HTMLElement,
    private opts: { horizontal?: boolean; columns?: number; onBack?: () => void } = {},
  ) {
    // Reconcile only after a menu mutates, never scan the DOM during normal play.
    const Observer = root.ownerDocument.defaultView?.MutationObserver;
    if (Observer) {
      this.observer = new Observer(() => { this.dirty = true; });
      this.observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'data-nav'] });
    }
    root.addEventListener('focusin', (event) => {
      const i = this.items.indexOf(event.target as HTMLElement);
      if (i >= 0) this.setFocus(i, false);
    });
    // Input's game bindings deliberately ignore text fields; Escape must still leave their screen.
    root.addEventListener('keydown', (event) => {
      if (event.code === 'Escape' && (event.target as HTMLElement).matches('input[type=text], textarea')) {
        event.preventDefault();
        (event.target as HTMLElement).blur();
        this.back();
      }
      if (['ArrowLeft', 'ArrowRight'].includes(event.code) && (event.target as HTMLElement).matches('input[type=range]')) event.preventDefault();
      // MenuNav owns activation, including a button reached with native focus.
      if (['Enter', 'Space'].includes(event.code) && (event.target as HTMLElement).matches('button, a[data-nav]')) event.preventDefault();
    });
    // One UI kit for mouse, keyboard and gamepad: all activate via click() (src/audio/uiKit.ts).
    this.root.addEventListener('click', (event) => {
      const el = (event.target as HTMLElement).closest<HTMLElement>('[data-nav]');
      if (!el || el.matches('.rolling, input')) return;
      if (el.matches(':disabled, .cant, .locked')) return sfx.deny();
      // Toggles run their own handler first, so the label already shows the new state.
      if (el.dataset.toggle !== undefined) return sfx.ui('toggle', el.querySelector('b')?.textContent === localize('ON') ? 1 : 0);
      sfx.menuSelect();
    });
    // Sliders tick up the scale with their value (mouse drags and keys alike).
    this.root.addEventListener('input', (event) => {
      const el = event.target as HTMLInputElement;
      if (el.type !== 'range') return;
      const min = Number(el.min || 0);
      const max = Number(el.max || 1);
      sfx.ui('tick', max > min ? (Number(el.value) - min) / (max - min) : 0);
    });
  }

  get element(): HTMLElement | undefined { return this.selected; }

  /** Re-scan items (call after the menu's content changes). */
  refresh(focus = 0): void {
    this.items.forEach(el => el.classList.remove('focused'));
    this.items = Array.from(this.root.querySelectorAll<HTMLElement>('[data-nav]')).filter(menuItemAvailable);
    this.dirty = false;
    this.observer?.takeRecords();
    this.items.forEach((el, i) => {
      el.onmouseenter = () => this.setFocus(i, true, false);
    });
    this.focus = Math.max(0, Math.min(focus, this.items.length - 1));
    this.selected = undefined;
    this.setFocus(this.focus, false);
  }

  private setFocus(i: number, sound = true, scroll = true): void {
    if (i < 0 || i >= this.items.length) return;
    if (sound && i !== this.focus) {
      const el = this.items[i];
      if (el.closest('.card, .mod-card')) sfx.ui('hover');
      else if (el.matches('[role=tab], [data-tab]')) sfx.ui('tab');
      else sfx.menuMove();
    }
    this.focus = i;
    this.selected = this.items[i];
    this.items.forEach((el, j) => el.classList.toggle('focused', j === i));
    if (sound && scroll) this.items[i].scrollIntoView({ block: 'nearest' });
  }

  /** Index of the closest item above (-1) or below (1) the focused one, or the focus itself. */
  private nearestVertical(dir: -1 | 1): number {
    const cur = this.items[this.focus]?.getBoundingClientRect();
    if (!cur) return this.focus;
    const cx = cur.left + cur.width / 2;
    const cy = cur.top + cur.height / 2;
    let best = this.focus;
    let bd = Infinity;
    this.items.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const dy = (r.top + r.height / 2 - cy) * dir;
      if (dy < 8) return;
      const d = dy + Math.abs(r.left + r.width / 2 - cx) * 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /** Back is independent of how many actions a loading/empty screen currently has. */
  back(): boolean {
    if (!this.opts.onBack) return false;
    sfx.menuBack();
    this.opts.onBack();
    return true;
  }

  update(input: Input, dt: number): void {
    if (this.dirty || (this.selected && (!this.root.contains(this.selected) || !menuItemAvailable(this.selected)))) {
      const selected = this.selected;
      const previous = this.focus;
      this.refresh(previous);
      const i = selected ? this.items.indexOf(selected) : -1;
      if (i >= 0) this.setFocus(i, false, false);
    }
    if (input.keyPressed('Escape') || input.keyPressed('Backspace') || input.padButtonPressed(1)) {
      if (this.back()) return;
    }
    if (this.items.length === 0) return;
    // Playable title: WASD, Space and the left stick drive the demo hero, not the menu (src/game/titlePlay.ts).
    const lock = navLock.move;
    const k = (c: string) => input.keyPressed(c) && !(lock && (c === 'Space' || c === 'KeyW' || c === 'KeyA' || c === 'KeyS' || c === 'KeyD'));
    const pad = (b: number) => input.padButtonPressed(b);

    // Analog stick with auto-repeat.
    let stick = 0;
    const axis = this.opts.horizontal ? input.move.x : input.move.y;
    const cross = this.opts.horizontal ? input.move.y : input.move.x;
    this.repeat -= dt;
    if (input.device === 'pad' && Math.abs(axis) > 0.6 && !lock) {
      if (this.repeat <= 0) {
        stick = Math.sign(axis);
        this.repeat = 0.22;
      }
    } else if (Math.abs(axis) < 0.3) this.repeat = 0;

    const prevKeys = this.opts.horizontal ? ['ArrowLeft', 'KeyA'] : ['ArrowUp', 'KeyW'];
    const nextKeys = this.opts.horizontal ? ['ArrowRight', 'KeyD'] : ['ArrowDown', 'KeyS'];
    const prevPad = this.opts.horizontal ? 14 : 12;
    const nextPad = this.opts.horizontal ? 15 : 13;
    const cols = this.opts.columns ?? 1;
    const horizontalDir = isRtl() && !this.items[this.focus]?.closest('.owned-mods') ? -1 : 1;
    if (cols > 1) {
      // Grids: up/down go to the nearest item on screen in that direction, so rows of any length work.
      if (prevKeys.some(k) || pad(prevPad) || stick < 0) this.setFocus(this.nearestVertical(-1));
      if (nextKeys.some(k) || pad(nextPad) || stick > 0) this.setFocus(this.nearestVertical(1));
    } else {
      if (prevKeys.some(k) || pad(prevPad) || stick < 0) this.setFocus(Math.max(0, this.focus - cols * (this.opts.horizontal ? horizontalDir : 1)));
      if (nextKeys.some(k) || pad(nextPad) || stick > 0) this.setFocus(Math.min(this.items.length - 1, this.focus + cols * (this.opts.horizontal ? horizontalDir : 1)));
    }
    if (cols > 1) {
      // Grid: left/right step one item.
      if (k('ArrowLeft') || k('KeyA') || pad(14)) this.setFocus(this.focus - horizontalDir);
      if (k('ArrowRight') || k('KeyD') || pad(15)) this.setFocus(this.focus + horizontalDir);
    }

    if (k('Tab')) {
      const dir = input.key?.('ShiftLeft') || input.key?.('ShiftRight') ? -1 : 1;
      this.setFocus((this.focus + dir + this.items.length) % this.items.length);
      this.items[this.focus].focus({ preventScroll: true });
    }
    const el = this.items[this.focus];
    // Sliders: adjust with the cross axis (left/right in a vertical menu).
    if (el instanceof HTMLInputElement && el.type === 'range' && !this.opts.horizontal && cols === 1) {
      let d = 0;
      if (k('ArrowLeft') || k('KeyA') || pad(14)) d = -1;
      if (k('ArrowRight') || k('KeyD') || pad(15)) d = 1;
      if (input.device === 'pad' && Math.abs(cross) > 0.6 && this.repeat <= 0) {
        d = Math.sign(cross);
        this.repeat = 0.12;
      }
      if (d !== 0) {
        el.value = String(Number(el.value) + d * Number(el.step || 1));
        el.dispatchEvent(new Event('input', { bubbles: true })); // ticks via the input listener
      }
    } else if (k('Enter') || k('Space') || pad(0)) {
      el.click();
    }

  }
}

/** Hidden sections and disabled actions must never own controller focus. Locked rewards remain inspectable. */
export function menuItemAvailable(el: HTMLElement): boolean {
  return !el.closest('[hidden], [inert], [aria-hidden="true"]') && !el.matches(':disabled') && el.style.display !== 'none';
}

import type { Screens, ScreenName } from './screens';
import { save } from '../game/save';
import { levelOf } from '../data/profile';
import { prompt } from './prompts';

/** Cosmetic title earned from the same profile level shown in the online lobby. */
export function profileTitle(level: number): string {
  return level >= 20 ? 'menu.title.legend' : level >= 10 ? 'menu.title.ace' : level >= 5 ? 'menu.title.ranger' : 'menu.title.cadet';
}

/** Owns presentation only. Existing action nodes/listeners stay intact when moved to PLAY. */
export class TitleMenu {
  private readonly title: HTMLElement;
  private readonly play: HTMLElement;
  private readonly stash: HTMLElement;
  private readonly primary: HTMLElement;
  private readonly activity: HTMLElement;
  private readonly profile: HTMLElement;
  private readonly launch: HTMLElement;
  private playChild: ScreenName | null = null;

  constructor(private readonly root: HTMLElement, screens: Screens) {
    ensureMenuCss();
    this.title = root.querySelector('#scr-title')!;
    this.title.classList.add('menu-home');
    this.title.insertAdjacentHTML('afterbegin', localizeHtml(`<header class="menu-masthead"></header>`));
    const masthead = this.title.querySelector('.menu-masthead')!;
    for (const sel of ['.logo', '.tagline']) masthead.append(this.title.querySelector(sel)!);
    this.title.insertAdjacentHTML('beforeend', localizeHtml(`
      <div class="menu-home-body"><section class="menu-primary"></section><aside class="menu-activity"></aside></div>
      <div class="menu-launch-stash" hidden></div>
      <div class="menu-profile px"></div>
      <footer class="menu-footer"><span>${prompt('confirm')} ${t('menu.select')}</span><span>${t('menu.demo')}</span></footer>`));
    this.primary = this.title.querySelector('.menu-primary')!;
    this.activity = this.title.querySelector('.menu-activity')!;
    this.profile = this.title.querySelector('.menu-profile')!;
    this.stash = this.title.querySelector('.menu-launch-stash')!;
    const menu = this.title.querySelector<HTMLElement>('.menu')!;
    this.primary.append(menu);
    menu.insertAdjacentHTML('afterbegin', localizeHtml(`<button data-nav data-menu-play class="menu-play continue"><b>${t('menu.play')}</b><small>${t('menu.play.desc')}</small></button>`));
    menu.querySelector('[data-menu-play]')!.addEventListener('click', () => screens.show('play'));
    this.activity.insertAdjacentHTML('beforeend', localizeHtml(`<div class="menu-news px"><small>${t('menu.news')}</small><b>${t('menu.news.title')}</b><span>${t('menu.news.desc')}</span></div>`));
    this.play = document.createElement('div');
    this.play.id = 'scr-play';
    this.play.className = 'screen dim menu-hub';
    this.play.innerHTML = localizeHtml(`<h1>${t('menu.play')}</h1><p class="note">${t('menu.choose')}</p><div class="menu menu-launch"></div><div class="menu row"><button data-nav data-menu-back>${prompt('back')} ${t('text.back_1dd26f')}</button></div>`);
    this.launch = this.play.querySelector('.menu-launch')!;
    this.play.querySelector('[data-menu-back]')!.addEventListener('click', () => screens.show('title'));
    screens.addScreen('play', this.play, { onBack: () => screens.show('title') });
  }

  destination(name: ScreenName, from: ScreenName): ScreenName {
    if (from === 'play' && ['modes', 'online', 'localcoop'].includes(name)) this.playChild = name;
    if (name === 'title' && from === this.playChild) return 'play';
    if (name === 'none' || (name === 'title' && from === 'play')) this.playChild = null;
    return name;
  }

  show(name: ScreenName): void {
    if (name !== 'title' && name !== 'play') return;
    // Other lanes inject their launchers during Game construction. Move their actual nodes, not copies.
    const target = name === 'play' ? this.launch : this.stash;
    for (const el of this.root.querySelectorAll<HTMLElement>('#scr-title .menu-launch-stash > *, #scr-title [data-act="modes"], #scr-title [data-act="online"], #scr-title [data-act="lc-open"], #scr-title .menu-primary > .menu > [data-act="ob-training"], #scr-play .menu-launch > *')) {
      if (el.parentElement !== target) target.append(el);
    }
    if (name !== 'title') return;
    for (const sel of ['.ob-offer', '.ft-list', '.ha-booth']) {
      const el = this.title.querySelector<HTMLElement>(sel);
      if (el && el.parentElement !== this.activity) this.activity.append(el);
    }
    // Seasonal headline belongs in the event card, away from the logo/profile.
    const banner = this.title.querySelector<HTMLElement>('.ha-banner');
    const booth = this.title.querySelector<HTMLElement>('.ha-booth');
    if (banner && booth && banner.parentElement !== booth) booth.append(banner);
    for (const sel of ['.wallet', '.hiscores']) {
      for (const el of this.title.querySelectorAll<HTMLElement>(sel)) {
        if (el.parentElement !== this.primary) this.primary.append(el);
      }
    }
    const level = levelOf(save.profile.xp).level;
    this.profile.innerHTML = localizeHtml(`<span class="menu-profile-star" aria-hidden="true">★</span><span><small>${t('menu.profile', { level })}</small><b>${t(profileTitle(level))}</b></span>`);
  }
}

/** Shared shell for registered screens; lane-specific layouts keep their own grids and content. */
export function polishMenuScreen(el: HTMLElement): void {
  if (el.id === 'scr-title') return;
  el.classList.add('menu-consistent');
  // A real back button gets the same live keyboard / controller prompt everywhere.
  for (const button of el.querySelectorAll<HTMLElement>('button')) {
    if (button.dataset.menuPrompt !== undefined || button.querySelector('[data-prompt]')) continue;
    if ([localize('BACK'), localize('TITLE')].includes(button.textContent?.trim() ?? '')) {
      button.dataset.menuPrompt = '';
      button.insertAdjacentHTML('afterbegin', localizeHtml(prompt('back') + ' '));
    }
  }
}

function ensureMenuCss(): void {
  if (document.getElementById('menu-css')) return;
  const style = document.createElement('style');
  style.id = 'menu-css';
  style.textContent = CSS;
  document.head.append(style);
}

const CSS = `
#scr-title.menu-home { justify-content: flex-start; align-items: stretch; gap: calc(7 * var(--p)); padding: calc(10 * var(--p)); }
#scr-title.menu-home::before { mask: none; -webkit-mask: none; background: repeating-conic-gradient(#1a1c2c66 0 25%, transparent 0 50%) 0 0 / calc(2 * var(--p)) calc(2 * var(--p)); }
#scr-title.menu-home .menu-masthead { width: fit-content; padding-top: calc(5 * var(--p)); padding-bottom: calc(4 * var(--p)); }
#scr-title.menu-home .logo { justify-content: flex-start; font-size: calc(32 * var(--p)); flex-wrap: nowrap; gap: .15em; }
#scr-title.menu-home .tagline { width: fit-content; margin-top: calc(7 * var(--p)); font-size: calc(3 * var(--p)); letter-spacing: 1px; }
#scr-title.menu-home .menu-home-body { display: flex; justify-content: space-between; gap: calc(12 * var(--p)); align-items: flex-start; }
#scr-title.menu-home .menu-primary { width: calc(110 * var(--p)); max-width: 100%; }
#scr-title.menu-home .menu-primary > .menu { min-width: 0; gap: calc(4 * var(--p)); }
#scr-title.menu-home .menu-primary > .menu > button { text-align: start; padding-inline: calc(6 * var(--p)); min-height: calc(13 * var(--p)); }
#scr-title.menu-home .menu-play { min-height: calc(28 * var(--p)); display: grid; gap: var(--p); }
#scr-title.menu-home .menu-play b { font: calc(19 * var(--p))/1 var(--display); }
#scr-title.menu-home .menu-play small { font: calc(5 * var(--p)) var(--font); letter-spacing: 0; }
#scr-title.menu-home .menu-profile { position: absolute; inset-inline-end: calc(10 * var(--p)); top: calc(10 * var(--p)); display: flex; align-items: center; gap: calc(4 * var(--p)); padding: calc(3 * var(--p)) calc(5 * var(--p)); --bg: var(--ink); --hi: var(--blue); --lo: var(--navy); --ring: var(--cyan); }
.menu-profile-star { color: var(--yellow); font-size: calc(13 * var(--p)); }
.menu-profile small, .menu-profile b { display: block; }
.menu-profile small { font: calc(3 * var(--p)) var(--label); color: var(--cyan); }
.menu-profile b { font: calc(8 * var(--p)) var(--display); color: var(--white); font-weight: normal; }
#scr-title.menu-home .menu-activity { display: grid; width: calc(104 * var(--p)); max-width: 100%; gap: calc(5 * var(--p)); }
#scr-title.menu-home .menu-activity > * { position: static; margin: 0; width: 100%; max-width: 100%; box-sizing: border-box; }
#scr-title.menu-home .menu-activity:has(.ob-offer:not([hidden])) .menu-news { display: none; }
#scr-title.menu-home .menu-news { --bg: var(--ink); --hi: var(--sky); --lo: var(--navy); --ring: var(--blue); padding: calc(4 * var(--p)); display: grid; gap: calc(2 * var(--p)); }
.menu-news small { color: var(--cyan); font: calc(3 * var(--p)) var(--label); }
.menu-news b { color: var(--yellow); font: calc(8 * var(--p)) var(--display); }
.menu-news span { font-size: calc(5 * var(--p)); line-height: 1.1; }
#scr-title.menu-home .menu-activity .ft-list { font-size: calc(4 * var(--p)); padding: calc(3 * var(--p)); gap: var(--p); }
#scr-title.menu-home .ft-list ul { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: calc(2 * var(--p)) calc(3 * var(--p)); }
#scr-title.menu-home .ft-list li { font-size: calc(5 * var(--p)); line-height: 1.15; }
#scr-title.menu-home .ft-list li small { display: none; }
#scr-title.menu-home .ft-list .ft-h { font-size: calc(7 * var(--p)); }
#scr-title.menu-home .menu-activity .ha-booth { display: grid; grid-template-columns: calc(16 * var(--p)) 1fr; column-gap: calc(3 * var(--p)); padding: calc(3 * var(--p)); text-align: start; }
#scr-title.menu-home .ha-booth svg { width: calc(16 * var(--p)); height: calc(16 * var(--p)); grid-row: span 2; }
#scr-title.menu-home .ha-booth b { font-size: calc(7 * var(--p)); }
#scr-title.menu-home .ha-booth small { font-size: calc(3 * var(--p)); }
#scr-title.menu-home .ha-booth .ha-banner { position: static; grid-column: 1 / -1; margin: 0; font: calc(3 * var(--p))/1.5 var(--label); color: var(--yellow); }
#scr-title.menu-home .menu-activity .ob-offer { padding: calc(3 * var(--p)); font-size: calc(5 * var(--p)); }
#scr-title.menu-home .ob-offer > b { font-size: calc(8 * var(--p)); }
#scr-title.menu-home .ob-offer .menu.row { min-width: 0; gap: calc(3 * var(--p)); }
#scr-title.menu-home .wallet { margin-top: calc(6 * var(--p)); text-align: start; font-size: calc(3 * var(--p)); }
#scr-title.menu-home .hiscores { margin-top: calc(5 * var(--p)); width: 100%; font-size: calc(4 * var(--p)); }
#scr-title.menu-home .hiscores:empty { display: none; }
#scr-title.menu-home > .controls { display: none; }
#scr-title.menu-home .menu-footer { display: flex; flex-wrap: wrap; gap: calc(5 * var(--p)); margin-top: auto; padding-block: calc(3 * var(--p)); font-size: calc(4 * var(--p)); color: var(--white); }
#scr-title.menu-home > .credits { position: static; order: 5; max-width: 80%; font-size: calc(2.5 * var(--p)); }
#scr-title.menu-home > .version { inset-inline-end: calc(5 * var(--p)); }
.menu-consistent { gap: calc(5 * var(--p)); padding: calc(7 * var(--p)); }
#scr-wardrobe.menu-consistent { justify-content: safe flex-end; }
.menu-consistent > :not(.scroll) { flex-shrink: 0; }
.menu-consistent > h1 { font-size: calc(20 * var(--p)); line-height: 1.1; text-align: center; }
.menu-consistent > .note { max-width: min(calc(240 * var(--p)), 90%); margin-block: calc(2 * var(--p)); text-align: center; }
.menu-consistent button { min-height: calc(12 * var(--p)); touch-action: manipulation; }
.menu-consistent .menu { max-width: 100%; }
[lang=ar] #scr-title.menu-home .ft-list li { font-size: calc(4 * var(--p)); line-height: 1.7; }
[lang=ar] #scr-title.menu-home .menu-profile small, [lang=ar] #scr-title.menu-home .menu-news small { font-size: calc(4 * var(--p)); }
[lang=ar] #scr-title.menu-home .ft-list { text-align: start; }
#scr-extras.menu-consistent > .menu { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); width: min(calc(260 * var(--p)), 90%); gap: calc(5 * var(--p)); }
#scr-extras.menu-consistent > .menu > button { min-height: calc(25 * var(--p)); font-size: calc(8 * var(--p)); padding-inline: calc(3 * var(--p)); }
#scr-extras.menu-consistent > .menu > [data-act=ex-back] { grid-column: 1 / -1; min-height: calc(14 * var(--p)); }
#scr-title.menu-home > .menu-home-body, #scr-title.menu-home > .menu-masthead { flex-shrink: 0; }
#scr-title.menu-home .menu-footer { flex-shrink: 0; }
#scr-title.menu-home .logo { direction: ltr; }
.menu-hub .menu-launch { width: calc(130 * var(--p)); max-width: 90%; }
.menu-hub .menu-launch button { min-height: calc(21 * var(--p)); text-align: start; padding-inline: calc(6 * var(--p)); font-size: calc(10 * var(--p)); }
.screen button:focus-visible, .screen [data-nav]:focus-visible { outline: var(--p) solid var(--yellow); outline-offset: calc(2 * var(--p)); }
.reduce-flash #scr-title.menu-home .logo { transform: none; }
@media (prefers-reduced-motion: reduce) { #scr-title.menu-home .logo { transform: none; } }
@media (max-width: 900px) {
  #scr-title.menu-home .menu-masthead { padding-top: calc(30 * var(--p)); }
  #scr-title.menu-home .logo { font-size: calc(23 * var(--p)); }
  #scr-title.menu-home .menu-home-body { flex-wrap: wrap; gap: calc(8 * var(--p)); }
  #scr-title.menu-home .menu-primary, #scr-title.menu-home .menu-activity { width: 100%; }
  #scr-title.menu-home .menu-activity { grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(90 * var(--p))), 1fr)); }
}
@media (max-width: 480px) {
  #scr-title.menu-home { padding: calc(5 * var(--p)); }
  #scr-title.menu-home .logo { font-size: calc(17 * var(--p)); }
  #scr-title.menu-home .tagline { font-size: calc(2.5 * var(--p)); letter-spacing: 0; }
  .menu-consistent > h1 { font-size: calc(15 * var(--p)); }
  #scr-extras.menu-consistent > .menu { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  #scr-extras.menu-consistent > .menu > button { font-size: calc(6 * var(--p)); }
}
`;
