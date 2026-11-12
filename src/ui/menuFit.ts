/**
 * uxpass lane: menus that fit the window, and a visible cue when they don't.
 *
 * - `ensureMenuFitCss()` injects the lane's menu rules (shop at 720p, LOCK
 *   labels, wrap fixes...). It keeps its <style> last in <head> so it wins ties
 *   with other injected menu rules (hudLayout's, shopUi's) without editing them.
 * - `MoreCue` shows a blinking "▼ MORE" chip at the bottom of a menu screen
 *   (or its inner scroll list) while there is more content below the fold;
 *   clicking it scrolls one page. It only runs while a menu is open.
 *
 * Pixel-art rules (CLAUDE.md): Sweetie 16 variables only, sizes in --p, the
 * shared box-shadow frame, no radii, blur or gradient shading, steps() animations.
 */
import { t } from '../i18n';

/** Pixels of hidden content below the fold before the cue shows. */
export const moreCueTuning = { minHidden: 12, every: 0.3 };

/** True when a scroller has at least `min` px of content hidden below its bottom edge. */
export function hiddenBelow(el: Pick<HTMLElement, 'scrollHeight' | 'clientHeight' | 'scrollTop'>, min = moreCueTuning.minHidden): boolean {
  return el.scrollHeight - el.clientHeight - el.scrollTop > min;
}

/**
 * BACK stays the last button of its row. menu.ts does this for BACK buttons it gives a prompt to;
 * ones that already had a prompt (PLAY SOLO's BACK, then the raid lane's RAID RECORDS after it) were skipped.
 * Only moves a BACK when everything after it in the row is a button, like menu.ts.
 */
export function keepBackLast(screen: HTMLElement): void {
  for (const button of screen.querySelectorAll<HTMLElement>('button[data-menu-prompt], button[data-act$="back"], button[data-settings-back]')) {
    const row = button.parentElement;
    if (!row || !(row.classList.contains('menu') || row.classList.contains('settings-footer')) || !button.nextElementSibling) continue;
    let after: Element | null = button.nextElementSibling;
    while (after && after.tagName === 'BUTTON') after = after.nextElementSibling;
    if (!after) row.append(button);
  }
}

const scrolls = (el: Element) => {
  const s = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
  return !!s && /(auto|scroll)/.test(s.overflowY);
};

/** The element that actually scrolls on a menu screen: the screen itself, else its tallest scrolling child. */
export function menuScroller(screen: HTMLElement): HTMLElement | null {
  if (scrolls(screen) && screen.scrollHeight > screen.clientHeight + 1) return screen;
  let best: HTMLElement | null = null;
  for (const el of screen.querySelectorAll<HTMLElement>('*')) {
    if (el.clientHeight < 80 || el.scrollHeight <= el.clientHeight + 1 || !scrolls(el)) continue;
    if (!best || el.clientHeight > best.clientHeight) best = el;
  }
  return best;
}

export class MoreCue {
  readonly el: HTMLButtonElement;
  private screen: HTMLElement | null = null;
  private scroller: HTMLElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('button');
    this.el.className = 'mf-more px';
    this.el.type = 'button';
    this.el.tabIndex = -1;
    this.el.hidden = true;
    this.el.setAttribute('aria-hidden', 'true');
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      const s = this.scroller;
      if (s) s.scrollBy({ top: Math.max(80, s.clientHeight * 0.75), behavior: 'auto' });
      this.update();
    });
    root.appendChild(this.el);
  }

  /** Follow this menu screen (null: no menu open). */
  watch(screen: HTMLElement | null): void {
    this.screen = screen;
    this.scroller = null;
    if (!screen) {
      this.el.hidden = true;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    if (!this.timer && typeof setInterval !== 'undefined') {
      this.timer = setInterval(() => this.update(), moreCueTuning.every * 1000);
      // Never keep a Node process (unit tests, jsdom smoke) alive just for the cue.
      (this.timer as { unref?: () => void }).unref?.();
    }
    this.update();
  }

  update(): void {
    const scr = this.screen;
    if (!scr || scr.hidden || !scr.isConnected) {
      this.el.hidden = true;
      return;
    }
    // Lanes that add a button after the screen was first shown (the raid lane's RAID RECORDS) land after BACK.
    if (scr.id !== 'scr-title') keepBackLast(scr);
    // Re-pick the scroller when it stops scrolling (content changed) or none was found yet.
    if (!this.scroller || !this.scroller.isConnected || !scr.contains(this.scroller) || this.scroller.scrollHeight <= this.scroller.clientHeight + 1) this.scroller = menuScroller(scr);
    const s = this.scroller;
    const show = !!s && hiddenBelow(s);
    if (show) {
      const label = t('uxpass.more');
      if (this.el.dataset.label !== label) {
        this.el.dataset.label = label;
        this.el.textContent = `▼ ${label}`;
      }
      const r = s!.getBoundingClientRect();
      const zoom = (s as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
      this.el.style.left = `${(r.left + r.width / 2) / zoom}px`;
      this.el.style.top = `${Math.min(r.bottom, s!.ownerDocument.defaultView?.innerHeight ?? r.bottom) / zoom}px`;
    }
    this.el.hidden = !show;
  }
}

/** The shop when it holds only its own parts (so the 720p grid can place every child). */
export const SHOP_PARTS = ['h1', '.shop-top', '.ft-help', '.shop-offers', '.shop-extras', '.owned-title', '.mod-preview', '.owned-mods', '.relic-title', '.shop-relics'] as const;
const G = `#hud #scr-shop:not([hidden]):not(:has(> :not(${SHOP_PARTS.join(', ')})))`;

const CSS = `
/* ---- scroll cue */
.mf-more {
  --bg: var(--ink); --hi: var(--slate); --lo: var(--ink); --ring: var(--yellow); --drop: transparent;
  position: fixed; z-index: 40; transform: translate(-50%, calc(-100% - 2 * var(--p)));
  padding: var(--p) calc(3 * var(--p)) calc(1.5 * var(--p)); font: 12px var(--label); letter-spacing: 1px;
  color: var(--yellow); text-shadow: none; cursor: pointer; pointer-events: auto;
  animation: mf-bob 1s steps(2) infinite;
}
.mf-more[hidden] { display: none; }
@keyframes mf-bob { 50% { margin-top: var(--p); } }
@media (prefers-reduced-motion: reduce) { .mf-more { animation: none; } }

/* ---- cards: no one-word orphan lines ("UPGRADES IN SHOP TO LV" / "3") */
.mod-card :is(.desc, .mod-ups, .hint, .name), .card :is(.desc, .name), .owned-mod .desc { text-wrap: balance; }
.mod-card .mod-ups { letter-spacing: 0; }

/* ---- title on 720p-class windows: the icon credits line (CC BY attribution) was cut by the bottom edge */
@media (min-width: 1000px) and (max-height: 820px) {
  #hud #scr-title.menu-home { gap: calc(4 * var(--p)); padding-block: calc(6 * var(--p)) calc(3 * var(--p)); }
}

/* ---- title at 1080p: hudLayout's two activity columns stopped at 900px tall, so at 1920x1080 five cards
 * stacked in one column and pushed the quests, footer and credits off the bottom */
@media (min-width: 1100px) and (min-height: 901px) and (max-height: 1200px) {
  #hud #scr-title.menu-home .menu-activity { display: block; columns: 2; column-gap: calc(5 * var(--p)); width: calc(213 * var(--p)); }
  #hud #scr-title.menu-home .menu-activity > * { break-inside: avoid; margin-bottom: calc(5 * var(--p)); }
}

/* ---- title on phones in landscape (844x390): only the logo and PLAY were on screen; the menu now sits
 * beside the activity cards so PLAY, UNLOCKS, EXTRAS and SETTINGS all show (the rest scrolls, with the cue) */
@media (max-height: 500px) and (min-width: 600px) {
  #hud #scr-title.menu-home { padding: calc(3 * var(--p)) calc(5 * var(--p)); gap: calc(3 * var(--p)); }
  #hud #scr-title.menu-home .menu-masthead { padding: 0; }
  #hud #scr-title.menu-home .logo { font-size: calc(13 * var(--p)); }
  #hud #scr-title.menu-home .tagline { margin-top: var(--p); }
  #hud #scr-title.menu-home .menu-profile { top: calc(3 * var(--p)); padding-block: var(--p); }
  #hud #scr-title.menu-home .menu-home-body { flex-wrap: nowrap; gap: calc(5 * var(--p)); }
  #hud #scr-title.menu-home .menu-primary { width: calc(96 * var(--p)); flex: 0 0 auto; }
  #hud #scr-title.menu-home .menu-activity { width: auto; flex: 1 1 0; min-width: 0; grid-template-columns: 1fr; }
  #hud #scr-title.menu-home .menu-primary > .menu { gap: calc(2 * var(--p)); }
  #hud #scr-title.menu-home .menu-primary > .menu > button { min-height: calc(11 * var(--p)); padding-block: 0; }
  #hud #scr-title.menu-home .menu-play { min-height: calc(17 * var(--p)); }
  #hud #scr-title.menu-home .menu-play b { font-size: calc(12 * var(--p)); }
}

/* ---- PLAY SOLO in Arabic at 720p and 1080p: Arabic line heights pushed NEXT / BACK below the fold (837px / 1182px) */
@media (min-width: 1000px) and (max-height: 1200px) {
  [lang=ar] #hud #scr-modes { gap: calc(1.5 * var(--p)); }
  [lang=ar] #hud #scr-modes > h1 { font-size: 34px; line-height: 1.2; }
  [lang=ar] #hud #scr-modes > .section { font-size: 13px; line-height: 1.2; margin: 0; }
  [lang=ar] #hud #scr-modes .ft-quick { padding-block: 0; }
  [lang=ar] #hud #scr-modes .casual-preset small { font-size: 14px; line-height: 1.35; }
  [lang=ar] #hud #scr-modes button.mode small { font-size: 13px; line-height: 1.4; }
  [lang=ar] #hud #scr-modes button.mode b { font-size: 19px; line-height: 1.25; }
  [lang=ar] #hud #scr-modes .mode-grid { row-gap: calc(2 * var(--p)); }
  [lang=ar] #hud #scr-modes { padding-block: calc(2 * var(--p)); }
  [lang=ar] #hud #scr-modes .g-note { font-size: 13px; line-height: 1.3; }
}

/* ---- LEVEL UP / PAUSE at 720p: the build strip (level-up) and the evolutions / damage panels (pause)
 * were below the fold, more so in Arabic */
@media (min-width: 1000px) and (max-height: 820px) {
  #hud #scr-levelup, #hud #scr-pause { gap: calc(3 * var(--p)); padding-block: calc(3 * var(--p)); }
  #hud #scr-levelup > h1, #hud #scr-pause > h1 { font-size: 40px; line-height: 1.05; }
  #hud #scr-pause > .menu { gap: calc(2 * var(--p)); }
  #hud #scr-pause > .menu > button { padding-block: 4px 6px; min-height: 0; }
  [lang=ar] #hud #scr-levelup .card .desc { font-size: 16px; line-height: 1.4; }
  [lang=ar] #hud #scr-levelup button.card { gap: 4px; }
  [lang=ar] #hud #scr-levelup .reroll-row button { padding-block: 2px 4px; }
}
/* Arabic section labels in the pause build (RELICS, EVOLUTIONS, DAMAGE, SETS) were 10px Latin-label size */
[lang=ar] #hud #scr-pause :is(.pi-t, .strip-t) { font-size: 14px; letter-spacing: 0; }
/* the first level-up help: the SPECIAL chip's dark text on plum was unreadable */
#hud .ft-help .ft-chip.special { color: var(--white); }

/* ---- online lobby: one 1300px column (START GAME at y 1474 on a 720p window, 1640 with 8 players) and the
 * fixed chat panel overlapped the lobby frame. Wide windows: two columns (players | host settings), chat keeps its strip. */
@media (min-width: 1180px) {
  /* the chat panel is fixed on the physical right in both directions */
  #hud #scr-online.lob-in { padding-right: calc(18px + 252px); }
  #hud #scr-online.lob-in > .lobby { width: 100%; max-width: 1180px; box-sizing: border-box; columns: 2; column-gap: calc(6 * var(--p)); column-fill: balance; }
  #hud #scr-online.lob-in > .lobby > * { break-inside: avoid; }
  /* the columns balance themselves; a section label stays with the row under it */
  #hud #scr-online.lob-in > .lobby .section { break-after: avoid; margin-block: calc(3 * var(--p)) calc(2 * var(--p)); }
  #hud #scr-online.lob-in > .lobby .co2-lobby { break-inside: auto; }
  #hud #scr-online.lob-in > .lobby .co2-lobby > * { break-inside: avoid; }
  #hud #scr-online.lob-in > .lobby .players { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: calc(2 * var(--p)); width: 100%; }
  #hud #scr-online.lob-in > .lobby .players > .lobby-player { width: auto; min-width: 0; }
  #hud #scr-online.lob-in > .lobby :is(.note, .mp-kind-note, .mp-diff-note) { max-width: 100%; }
  #hud #scr-online.lob-in > .lobby .diff-row { flex-wrap: wrap; justify-content: center; }
}
@media (min-width: 1180px) and (max-height: 1200px) {
  #hud #scr-online.lob-in > .lobby :is(.diff-row, .menu.row, .ae-lobby) button { min-height: 0; padding-block: 2px 4px; font-size: 20px; }
  #hud #scr-online.lob-in > .lobby :is(.note, .bonus) { margin-block: var(--p); line-height: 1.15; }
}
@media (min-width: 1180px) and (max-height: 820px) {
  #hud #scr-online.lob-in { gap: calc(2 * var(--p)); padding-block: calc(2 * var(--p)); }
  #hud #scr-online.lob-in > h1 { font-size: 36px; line-height: 1.05; }
  #hud #scr-online.lob-in > .lobby { padding-block: calc(2 * var(--p)); }
  #hud #scr-online.lob-in > .lobby .code-big { font-size: 40px; line-height: 1; }
  #hud #scr-online.lob-in > .lobby :is(.diff-row, .menu.row) button { font-size: 18px; }
  #hud #scr-online.lob-in > .lobby :is(.note, .mp-kind-note, .mp-diff-note) { font-size: 17px; }
  #hud #scr-online.lob-in > .lobby .lob-kicks { gap: var(--p) calc(2 * var(--p)); }
  #hud #scr-online.lob-in > .lobby .lob-kicks button { font-size: 15px; }
  #hud #scr-online.lob-in > .lobby .lob-x { gap: calc(1.5 * var(--p)); }
  #hud #scr-online.lob-in > .lobby .players { gap: calc(1.5 * var(--p)); }
  [lang=ar] #hud #scr-online.lob-in > .lobby button, [lang=ar] #hud #scr-online.lob-in > .menu.row button { line-height: 1.2; }
  [lang=ar] #hud #scr-online.lob-in > .lobby :is(.note, .mp-kind-note, .mp-diff-note) { line-height: 1.3; margin-block: 0; }
  [lang=ar] #hud #scr-online.lob-in > .lobby .lob-card { line-height: 1.25; }
  #hud #scr-online.lob-in > .menu.row button { min-height: 0; padding-block: 3px 5px; font-size: 20px; }
}

/* ---- JUKEBOX: two columns of tall rows ran 1263px tall at 720p (BACK far below); wide windows get four
 * compact columns (up/down navigation is by position, left/right by order, so a wider grid navigates the same) */
@media (min-width: 1000px) {
  #hud #scr-jukebox .tracks { grid-template-columns: repeat(4, minmax(0, 1fr)); width: min(1200px, 100%); gap: calc(2.5 * var(--p)); }
  #hud #scr-jukebox .tracks button { min-height: 0; padding-block: 6px 8px; font-size: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
}

/* ---- TRIALS at 1080p: the tile list was capped at 100vh - 270px, but the header and footer grow with the
 * larger UI pixel there, so BACK and the footer note were cut by the bottom edge */
@media (min-height: 900px) {
  #hud #scr-trials .tl-grid { max-height: calc(100vh - 340px); }
}
@media (min-width: 1500px) {
  #hud #scr-trials .tl-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); width: min(1400px, 94vw); }
  #hud #scr-trials .tl-grid .tl-tile { min-height: calc(28 * var(--p)); }
}

/* ---- ROUTE MAP: "STAGE 4 ★" sat lower than the other column heads (the star's fallback font has a taller line box) */
#hud #scr-route .rt-col b { line-height: 1.1; }
#hud #scr-route .rt-col.final b::after { line-height: 0; }

/* PLAY SOLO in Arabic at 1080p has room to spare: a bigger heading and gaps than the 720p trim */
@media (min-width: 1000px) and (min-height: 821px) and (max-height: 1200px) {
  [lang=ar] #hud #scr-modes { gap: calc(2.5 * var(--p)); padding-block: calc(4 * var(--p)); }
  [lang=ar] #hud #scr-modes > h1 { font-size: 48px; line-height: 1.3; }
}

/* ---- GAME OVER summary card: in Arabic each value sat half a row below its label, and physical left/right
 * alignment pushed labels away from their values in RTL */
#hud .summary .grid { align-items: baseline; }
#hud .summary .grid span { text-align: end; }
#hud .summary .grid b { text-align: start; }

/* ---- SETTINGS: the list used a fixed 46vh box with empty space under it; let it take that space */
@media (min-height: 551px) {
  #hud #scr-settings .settings { max-height: max(46vh, calc(100vh - 380px)); }
}

/* the "Q / E · SWITCH TAB" hint in 10px mist was barely legible */
#hud #scr-settings .settings-hint { font-size: 12px; letter-spacing: 1px; color: var(--white); }
[lang=ar] #hud #scr-settings .settings-hint { font-size: 15px; letter-spacing: 0; }
/* Arabic tab labels in the 12px Latin label size were hard to read */
[lang=ar] #hud #scr-settings .settings-tabs button { font-size: 15px; letter-spacing: 0; }

/* ---- story pages on short windows (phones): NEXT / SKIP were below the fold in every language but Arabic */
@media (max-height: 550px) {
  #story-play { padding: 8px; gap: 4px; }
  #story-play h1 { font-size: 26px; padding: 0; }
  #story-play .story-comic { max-height: 44vh; }
  #story-play .story-caption { font-size: calc(17px * var(--text-scale, 1)); padding: 6px 10px; }
  #story-play .story-controls { margin-top: 4px; gap: 8px; }
  #story-play .story-controls button { font-size: 18px; min-height: 34px; padding-block: 2px; }
}

/* ---- shop relic strip: its inline label only shows when the section title is hidden (720p) */
.shop-relics .strip-t.mf-short { display: none; }

/* ---- shop LOCK: the mist label on the blue button was nearly invisible */
#hud .screen .offer-slot button.lock { color: var(--white); text-shadow: var(--o) var(--o) 0 var(--ink); font-size: 12px; }
#hud .screen .offer-slot button.lock.focused { color: var(--yellow); }

/* ---- shop on 720p-class windows: the owned-Mod row and its title were below the fold */
@media (min-width: 1000px) and (max-height: 820px) {
  #hud #scr-shop { gap: calc(2 * var(--p)); row-gap: calc(2 * var(--p)); padding-top: calc(2 * var(--p)); padding-bottom: calc(4 * var(--p)); }
  #hud #scr-shop h1 { font-size: 38px; line-height: 1; }
  #hud #scr-shop .shop-top { gap: calc(4 * var(--p)); }
  #hud #scr-shop .gold-big { font-size: 30px; }
  #hud #scr-shop .mod-card { min-height: 0; }
  #hud #scr-shop button.mod-card { gap: 2px; }
  #hud #scr-shop .mod-card .icon { width: 44px; height: 44px; }
  #hud #scr-shop .mod-card .icon img.px-icon { width: 24px; height: 24px; }
  #hud #scr-shop .mod-card .name { font-size: 21px; }
  #hud #scr-shop .mod-card .desc { font-size: 16px; line-height: 1.15; }
  #hud #scr-shop .mod-card .price { padding: 3px 0 5px; font-size: 22px; }
  #hud #scr-shop .offer-slot { gap: var(--p); }
  #hud #scr-shop .offer-slot button.lock { padding-block: 0 var(--p); }
  #hud #scr-shop .shop-extras button { font-size: 20px; padding-block: 3px 5px; }
  #hud #scr-shop .owned-mods { grid-template-columns: repeat(5, minmax(0, 184px)); column-gap: calc(4 * var(--p)); }
  #hud #scr-shop .owned-mods .owned-mod > .mod-next { -webkit-line-clamp: 1; }
  [lang=ar] #hud #scr-shop .mod-card .desc { font-size: 15px; line-height: 1.45; }
  [lang=ar] #hud #scr-shop .mod-card .name { line-height: 1.25; }
  #hud #scr-shop .ft-help { max-width: min(1180px, 94vw); margin-bottom: 0; padding-block: 2px 4px; }
  [lang=ar] #hud #scr-shop .ft-help { font-size: 17px; line-height: 1.3; }
}
/* ---- shop up to 1080p-class windows: with 5 Mods the owned row went off the bottom even at 1920x1080 */
@media (min-width: 1000px) and (max-height: 1200px) {
  #hud #scr-shop .mod-preview { row-gap: 0; padding-block: var(--p); }
  #hud #scr-shop .mod-preview .pv-note { flex-basis: auto; }
  /* owned Mods: icon beside the name, the rest spans the slot; long text clamps (the slot's tooltip has it all) */
  #hud #scr-shop .owned-mod { min-height: 0; padding: 5px 6px calc(6px + 26px + 4px); display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; align-content: start; column-gap: 6px; row-gap: 3px; }
  #hud #scr-shop .owned-mod > * { grid-column: 1 / -1; }
  #hud #scr-shop .owned-mod > .icon { grid-column: 1; width: 30px; height: 30px; }
  #hud #scr-shop .owned-mod > .name { grid-column: 2; font-size: 18px; line-height: 1; text-align: start; }
  #hud #scr-shop .owned-mod > .slot-no { grid-column: auto; }
  #hud #scr-shop .owned-mod > :is(.desc, .mod-next) { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: 13px; }
  #hud #scr-shop .owned-mod .ctrl button { white-space: nowrap; padding-inline: 6px; }
  /* the move/sell row sits on the slot's bottom edge, so the five slots line up */
  #hud #scr-shop .owned-mod > .ctrl { position: absolute; left: 6px; right: 6px; bottom: 6px; justify-content: center; }
  #hud #scr-shop .relic-title { display: none; }
  #hud #scr-shop .shop-relics .strip-t.mf-short { display: inline; }
  #hud #scr-shop .owned-mod.empty { min-height: calc(16 * var(--p)); }
  [lang=ar] #hud #scr-shop .owned-mod > .name { line-height: 1.3; }
  /* Arabic cards run taller (line heights): trim them up to 1080p too */
  [lang=ar] #hud #scr-shop .mod-card { min-height: 0; }
  [lang=ar] #hud #scr-shop button.mod-card { gap: 3px; }
  [lang=ar] #hud #scr-shop .mod-card .icon { width: 52px; height: 52px; }
  [lang=ar] #hud #scr-shop .mod-card .desc { font-size: 16px; line-height: 1.4; }
  [lang=ar] #hud #scr-shop .mod-card .price { padding: 3px 0 5px; }
  [lang=ar] #hud #scr-shop { gap: calc(3 * var(--p)); }
  [lang=ar] #hud #scr-shop .owned-mod > :is(.desc, .mod-next) { line-height: 1.4; }
}
/* Wide but short: REROLL / HEAL / CONTINUE stack beside the owned Mods instead of taking a row.
 * Only when the shop holds just its own parts (the Gauntlet clock or the co-op trade pool keep the column). */
@media (min-width: 1180px) and (max-height: 1200px) {
  ${G} {
    display: grid; justify-content: center; justify-items: center; align-content: safe center;
    grid-template-columns: auto auto; column-gap: calc(5 * var(--p));
    grid-template-areas: "h1 h1" "top top" "help help" "offers offers" "otitle extras" "pv extras" "owned extras" "rtitle rtitle" "relics relics";
  }
  ${G} > h1 { grid-area: h1; }
  ${G} > .shop-top { grid-area: top; }
  ${G} > .ft-help { grid-area: help; }
  ${G} > .shop-offers { grid-area: offers; }
  ${G} > .shop-extras { grid-area: extras; flex-direction: column; flex-wrap: nowrap; align-self: end; align-items: stretch; gap: calc(2 * var(--p)); min-width: 0; width: max-content; }
  ${G} > .owned-title { grid-area: otitle; }
  ${G} > .mod-preview { grid-area: pv; justify-self: stretch; width: auto; }
  ${G} > .owned-mods { grid-area: owned; }
  ${G} > .relic-title { grid-area: rtitle; }
  ${G} > .shop-relics { grid-area: relics; }
}
/* ---- Arabic shop labels: the Latin pixel label size made Arabic glyphs tiny (LOCK, rarity, interest, level cap) */
[lang=ar] #hud .screen .offer-slot button.lock { font-size: 15px; letter-spacing: 0; }
[lang=ar] #hud :is(#scr-shop, #scr-relic) .mod-card .rarity { font-size: 13px; letter-spacing: 0; }
[lang=ar] #hud #scr-shop .interest { font-size: 15px; color: var(--white); }
[lang=ar] #hud #scr-shop .mod-card :is(.mod-ups, .hint) { font-size: 13px; }
[lang=ar] #hud #scr-shop .owned-title { font-size: 15px; letter-spacing: 0; }
[lang=ar] #hud #scr-shop .mod-preview :is(.pv i, .pv-head, .pv-note) { font-size: 14px; letter-spacing: 0; }
`;

/** The lane's injected menu CSS (tests check it keeps the pixel-art rules). */
export function menuFitCss(): string {
  return CSS;
}

/** Inject (or move last) the lane's menu CSS. Cheap; call on every menu show. */
export function ensureMenuFitCss(): void {
  if (typeof document === 'undefined') return;
  let st = document.getElementById('menu-fit-css') as HTMLStyleElement | null;
  if (!st) {
    st = document.createElement('style');
    st.id = 'menu-fit-css';
    st.textContent = CSS;
  }
  if (document.head.lastElementChild !== st) document.head.appendChild(st);
}
