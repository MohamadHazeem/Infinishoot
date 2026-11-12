/**
 * menuhud lane: the last menu/HUD overlaps and the tallest menus.
 *
 * - The in-run corner HUD (life, XP bar, LV badge and every docked panel) hides
 *   under full-screen menus (`menuCoverCss`, generated from the dock's panel list
 *   in hudLayout.ts so a new docked panel is covered too).
 * - First-time tips shown over a menu are placed where the menu has no content
 *   (`placeTip`, measured from the open screen), folded to their title chip when
 *   only a chip fits, and hidden when not even that fits (`MenuTip`).
 * - The stage shop shows the hero's life beside its gold, since the HUD life bar
 *   is hidden under it and HEAL needs it (`ShopLife`, copied from the HUD).
 * - GAME OVER on 720p/1080p-class windows: header rows on top, everything else in
 *   three balanced columns; the run timeline folds to a per-stage strip at 720p
 *   with the full table on hover / focus.
 * - Phones: the primary action of PLAY, PLAY SOLO, LOADOUT and the shops sits in a
 *   sticky bar at the bottom of the screen.
 *
 * The CSS is appended to menuFit's injected style (so it stays last in <head>).
 * Pixel-art rules (CLAUDE.md): Sweetie 16 variables, sizes in --p, no radii,
 * blur or gradient shading, steps() animations.
 */
import { t } from '../i18n';

// ---------------------------------------------------------------- 1. HUD under menus

/**
 * Dock panels that stay visible under menus: touch controls (their own module
 * hides them) and the first-time tip (placed by `MenuTip`).
 */
export const MENU_KEEP: readonly string[] = ['#touch .tstick', '#touch .tbtn', '#ob-tip'];

/** Corner HUD panels that are not docked but sit in the corners too. */
export const MENU_COVER_EXTRA: readonly string[] = ['#hudface', '#ingame > #xpbar', '#ingame > #hp', '#ingame > #goals', '#ob-train'];

/** CSS that hides the given panels while a menu is open (`.menu-open` on #hud; some chips are #hud's siblings). */
export function menuCoverCss(dock: readonly string[]): string {
  const sels = [...new Set([...dock.filter((s) => !MENU_KEEP.includes(s)), ...MENU_COVER_EXTRA])];
  const list = sels.flatMap((s) => [`#hud.menu-open ${s}`, `#hud.menu-open ~ ${s.replace(/^#ingame > /, '')}`]);
  return `/* menuhud: the corner HUD hides under full-screen menus (shop, relic, level-up, pause, route, game over, settings...) */
${list.join(',\n')} { visibility: hidden !important; }\n`;
}

// ---------------------------------------------------------------- 2. first-time tips over menus

export interface Rect { x: number; y: number; w: number; h: number }

export const menuTipTuning = {
  /** Screen px kept between the tip and any menu content, and from the window edges. */
  gap: 8,
  /** Tip widths tried, widest first is shorter; the narrowest is the old 250px panel. */
  widths: [250, 340, 460] as readonly number[],
  /** Vertical scan step for candidate spots. */
  step: 8,
};

const hits = (a: Rect, b: Rect, g: number) => a.x < b.x + b.w + g && b.x < a.x + a.w + g && a.y < b.y + b.h + g && b.y < a.y + a.h + g;

/**
 * A free spot for a w x h box among `content` boxes in a vw x vh window, or null.
 * Tries the right edge top-down, then the left edge, then the top and bottom
 * middle, so a tip keeps the old top-right spot whenever it is free.
 */
export function freeSpot(content: readonly Rect[], w: number, h: number, vw: number, vh: number, gap = menuTipTuning.gap): Rect | null {
  if (w + 2 * gap > vw || h + 2 * gap > vh) return null;
  const xs = [vw - w - gap, gap, Math.round((vw - w) / 2)];
  const step = menuTipTuning.step;
  for (const x of xs) {
    const ys: number[] = [];
    if (x === xs[2]) ys.push(gap, vh - h - gap);
    else for (let y = gap; y <= vh - h - gap; y += step) ys.push(y);
    for (const y of ys) {
      const r = { x, y, w, h };
      if (!content.some((c) => hits(r, c, gap))) return r;
    }
  }
  return null;
}

/** Tip size at one width: full panel height and the folded (title-only) chip height. */
export interface TipSize { w: number; h: number; chipH: number }

/** Where the tip goes over a menu: a full panel at the first width that fits, else the title chip, else hidden. */
export function placeTip(content: readonly Rect[], sizes: readonly TipSize[], vw: number, vh: number): { rect: Rect; fold: boolean } | null {
  for (const s of sizes) {
    const r = freeSpot(content, s.w, s.h, vw, vh);
    if (r) return { rect: r, fold: false };
  }
  for (const s of sizes) {
    const r = freeSpot(content, s.w, s.chipH, vw, vh);
    if (r) return { rect: r, fold: true };
  }
  return null;
}

const CONTENT_SEL = 'button, [data-nav], h1, h2, h3, p, li, label, input, select, img, canvas, table, .mod-card, .owned-mod, .card, .px, .note, .section, .badge, .mod-strip';

/** Boxes of the visible content of a menu screen (screen px). Big wrappers are skipped: their children count. */
export function menuContent(screen: HTMLElement, vw: number, vh: number): Rect[] {
  const out: Rect[] = [];
  const big = vw * vh * 0.45;
  const ownText = (el: Element) => {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent!.trim()) return true;
    return false;
  };
  for (const el of screen.querySelectorAll<HTMLElement>('*')) {
    if (!el.matches(CONTENT_SEL) && !ownText(el)) continue;
    if (el.closest('#ob-tip')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.width * r.height > big) continue;
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  }
  return out;
}

/**
 * Keeps a first-time tip off the open menu's cards and buttons. Runs on the
 * menu cue's tick and whenever the tip's text or visibility changes; writes
 * only when the spot changes. With no menu open it clears its styles, so the
 * HUD dock places the tip as before.
 */
export class MenuTip {
  private screen: HTMLElement | null = null;
  private tip: HTMLElement | null = null;
  private obs: MutationObserver | null = null;
  private key = '';

  constructor(private readonly root: HTMLElement) {}

  watch(screen: HTMLElement | null): void {
    this.screen = screen;
    this.update(true);
  }

  private find(): HTMLElement | null {
    if (this.tip?.isConnected) return this.tip;
    this.tip = this.root.querySelector<HTMLElement>('#ob-tip');
    if (this.tip && typeof MutationObserver !== 'undefined') {
      this.obs?.disconnect();
      this.obs = new MutationObserver(() => this.update(true));
      this.obs.observe(this.tip, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true, characterData: true });
    }
    return this.tip;
  }

  private clear(tip: HTMLElement): void {
    if (!tip.hasAttribute('data-mh')) return;
    tip.removeAttribute('data-mh');
    tip.removeAttribute('data-mh-fold');
    for (const p of ['left', 'top', 'right', 'bottom', 'width']) tip.style.removeProperty(p);
    this.key = '';
  }

  update(force = false): void {
    const tip = this.find();
    if (!tip) return;
    const scr = this.screen;
    if (!scr || scr.hidden || !scr.isConnected || tip.hidden || typeof window === 'undefined') return this.clear(tip);
    const vw = window.innerWidth, vh = window.innerHeight;
    const text = tip.textContent ?? '';
    const key = `${scr.id}|${vw}x${vh}|${text.length}|${scr.scrollTop}`;
    const content = menuContent(scr, vw, vh);
    // Keep a placed tip where it is while it is still clear of the menu.
    if (!force && key === this.key && tip.hasAttribute('data-mh')) {
      const r = tip.getBoundingClientRect();
      if (!content.some((c) => hits({ x: r.left, y: r.top, w: r.width, h: r.height }, c, menuTipTuning.gap / 2))) return;
    }
    this.key = key;
    const zoom = (tip as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom || 1;
    // Measure the tip at each width, full and folded (writes then reads: only when the spot is re-picked).
    tip.setAttribute('data-mh', '');
    tip.style.right = 'auto';
    tip.style.bottom = 'auto';
    const sizes: TipSize[] = [];
    for (const w of menuTipTuning.widths) {
      if (w * zoom > vw * 0.6) continue;
      tip.style.width = `${w}px`;
      tip.removeAttribute('data-mh-fold');
      const h = tip.getBoundingClientRect().height;
      tip.setAttribute('data-mh-fold', '');
      const chipH = tip.getBoundingClientRect().height;
      sizes.push({ w: w * zoom, h, chipH });
    }
    const spot = placeTip(content, sizes, vw, vh);
    if (!spot) {
      tip.setAttribute('data-mh-fold', 'hide');
      return;
    }
    const w = sizes.find((s) => Math.abs(s.w - spot.rect.w) < 0.5)!.w / zoom;
    tip.style.width = `${w}px`;
    tip.style.left = `${spot.rect.x / zoom}px`;
    tip.style.top = `${spot.rect.y / zoom}px`;
    if (spot.fold) tip.setAttribute('data-mh-fold', '');
    else tip.removeAttribute('data-mh-fold');
  }
}

// ---------------------------------------------------------------- game over column model

/**
 * Height of a balanced multi-column flow (break-inside: avoid): the smallest
 * column height that fits the blocks in order into `cols` columns. Blocks are
 * outer heights (margin-bottom included); a column break drops the last margin.
 * The unit test replays recorded 720p game-over blocks through it.
 */
export function columnsHeight(blocks: readonly number[], cols: number, margin = 0): number {
  const fits = (h: number) => {
    let col = 1, used = 0;
    for (const b of blocks) {
      if (used && used + b - margin > h) {
        col++;
        used = 0;
      }
      if (b - margin > h) return false;
      used += b;
    }
    return col <= cols;
  };
  let h = Math.max(0, ...blocks.map((b) => b - margin));
  while (!fits(h)) h++;
  return h;
}

// ---------------------------------------------------------------- shop life readout

/** The HUD life bar hides under the shop; the shop shows the same "hp/max" next to its gold (HEAL needs it). */
export function syncShopLife(root: ParentNode): void {
  const top = root.querySelector<HTMLElement>('#scr-shop:not([hidden]) .shop-top');
  if (!top) return;
  const num = root.querySelector<HTMLElement>('#hp .num')?.textContent?.trim() ?? '';
  let el = top.querySelector<HTMLElement>('.mh-life');
  if (!num) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('span');
    el.className = 'mh-life';
    el.innerHTML = '<i></i><b></b>';
    top.prepend(el);
  }
  const label = t('menuhud.life');
  const i = el.querySelector('i')!, b = el.querySelector('b')!;
  if (i.textContent !== label) i.textContent = label;
  if (b.textContent !== num) b.textContent = num;
  const [cur, max] = num.split('/').map(Number);
  el.classList.toggle('low', max > 0 && cur / max < 0.35);
}

// ---------------------------------------------------------------- phones: sticky action bars

/** The row with each menu's primary action (START / NEXT / CONTINUE), kept on screen on phones. */
export const STICKY_BARS: readonly string[] = [
  '#scr-play > .menu.row:last-of-type', '#scr-modes > .menu.row:last-of-type', '#scr-loadout > .menu.row:last-of-type',
  '#scr-shop > .shop-extras', '#scr-relic > .menu.row:last-of-type',
];

/** Top edge (screen px) of the screen's sticky action bar while it is stuck, else null: the scroll cue sits above it. */
export function stickyBarTop(screen: HTMLElement): number | null {
  for (const sel of STICKY_BARS) {
    const bar = screen.querySelector<HTMLElement>(`:scope > ${sel.split(' > ').slice(1).join(' > ')}`);
    if (!bar || !screen.matches(sel.split(' > ')[0])) continue;
    if (bar.ownerDocument.defaultView?.getComputedStyle(bar).position !== 'sticky') return null;
    const r = bar.getBoundingClientRect();
    return r.height > 0 ? r.top : null;
  }
  return null;
}

// ---------------------------------------------------------------- CSS

/** The shop when it holds only its own parts (so menuFit's 720p grid can place every child; re-exported there). */
export const SHOP_PARTS = ['h1', '.shop-top', '.ft-help', '.shop-offers', '.shop-extras', '.owned-title', '.mod-preview', '.owned-mods', '.relic-title', '.shop-relics'] as const;

const GO = '#hud #scr-gameover';
const GB = `${GO} .go-body`;
/** menuFit's 720p shop grid (only when the shop holds just its own parts). */
const SG = `#hud #scr-shop:not([hidden]):not(:has(> :not(${SHOP_PARTS.join(', ')})))`;
/** The result panels inside .go-body (lanes add strips and the clips panel there too). */
const GO_ITEMS = `${GB} > :not(.go-cols), ${GB} > .go-cols > :not(.ob-go), ${GB} .ob-go > *`;

export const MENUHUD_CSS = `
/* ---- tips over menus: placed by MenuTip (src/ui/menuHud.ts); folded to the title chip when only a chip fits */
#hud.menu-open #ob-tip[data-mh] { translate: none; }
/* a chip state the HUD fit left on the tip doesn't fold it under a menu: MenuTip decides there */
#hud.menu-open #ob-tip[data-mh]:not([data-mh-fold]) > p { display: block; }
#hud.menu-open #ob-tip[data-mh-fold]:not(:hover) > :not(.ob-tip-h, .ob-tip-bar) { display: none; }
#hud.menu-open #ob-tip[data-mh-fold]:not(:hover) { padding-block: 4px 6px; }
#hud.menu-open #ob-tip[data-mh-fold=hide] { visibility: hidden; }

/* ---- shop: the hero's life next to the gold (the HUD life bar is hidden under menus) */
#hud #scr-shop .shop-top .mh-life { display: inline-flex; align-items: baseline; gap: calc(2 * var(--p)); font-size: 24px; color: var(--white); white-space: nowrap; }
#hud #scr-shop .shop-top .mh-life i { font: 11px var(--label); font-style: normal; letter-spacing: 1px; color: var(--lime); }
#hud #scr-shop .shop-top .mh-life.low b { color: var(--red); }
[lang=ar] #hud #scr-shop .shop-top .mh-life i { font-size: 14px; letter-spacing: 0; }

/* ---- shop at 720p with 5 Mods, relics and the first-shop help: 5px over (725) */
@media (min-width: 1000px) and (max-height: 820px) {
  #hud #scr-shop { row-gap: calc(1.5 * var(--p)); }
}
/* ---- Arabic shop at 720p (5 Mods, relics, curse deal: 924px): wider cards so descriptions take fewer lines, the
 * heading beside the gold line, tighter owned row. No text under 13px. */
@media (min-width: 1180px) and (max-height: 820px) {
  [lang=ar] #hud #scr-shop { row-gap: calc(1.5 * var(--p)); padding-top: var(--p); padding-bottom: calc(2 * var(--p)); }
  [lang=ar] #hud #scr-shop > h1 { font-size: 34px; line-height: 1.1; }
  [lang=ar] #hud #scr-shop .shop-top { line-height: 1.1; }
  [lang=ar] #hud #scr-shop .gold-big { font-size: 26px; line-height: 1.1; }
  [lang=ar] #hud #scr-shop .shop-top .mh-life { font-size: 22px; line-height: 1.1; }
  [lang=ar] #hud #scr-shop .interest { line-height: 1.25; }
  [lang=ar] #hud #scr-shop .ft-help { line-height: 1.2; padding-block: 0 2px; }
  [lang=ar] #hud #scr-shop .shop-offers { gap: calc(4 * var(--p)); }
  [lang=ar] #hud #scr-shop .mod-card { width: 226px; }
  [lang=ar] #hud #scr-shop button.mod-card { gap: 1px; }
  [lang=ar] #hud #scr-shop .mod-card .rarity { height: calc(7 * var(--p)); }
  [lang=ar] #hud #scr-shop .mod-card .icon { width: 40px; height: 40px; margin-top: 2px; }
  [lang=ar] #hud #scr-shop .mod-card .name { font-size: 20px; line-height: 1.2; }
  [lang=ar] #hud #scr-shop .mod-card .desc { font-size: 15px; line-height: 1.3; }
  [lang=ar] #hud #scr-shop .mod-card :is(.mod-ups, .hint) { line-height: 1.25; }
  [lang=ar] #hud #scr-shop .mod-card .price { padding: 1px 0 3px; }
  [lang=ar] #hud #scr-shop .offer-slot button.lock { line-height: 1.2; padding-block: 0 2px; }
  [lang=ar] #hud #scr-shop .owned-title { line-height: 1.2; }
  [lang=ar] #hud #scr-shop .mod-preview { line-height: 1.2; flex-wrap: nowrap; }
  [lang=ar] #hud #scr-shop .mod-preview > .pv-note { flex: 1 1 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  [lang=ar] #hud #scr-shop .owned-mod > :is(.desc, .mod-next) { line-height: 1.3; }
  [lang=ar] #hud #scr-shop .owned-mod > .name { line-height: 1.15; font-size: 17px; }
  [lang=ar] #hud #scr-shop .owned-mod { row-gap: 2px; padding-top: 4px; }
  [lang=ar] #hud #scr-shop .owned-mod .ctrl button { line-height: 1.15; padding-block: 1px 3px; }
  [lang=ar] #hud #scr-shop .shop-relics .mod-strip { line-height: 1.15; padding-block: 0; }
  [lang=ar] #hud #scr-shop .shop-relics .mod-chip { line-height: 1.15; }
  [lang=ar] #hud #scr-shop .shop-relics .mod-chip { padding-block: 0 1px; }
  [lang=ar] #hud #scr-shop .shop-extras button { line-height: 1.2; }
}
@media (min-width: 1180px) and (max-height: 820px) {
  /* heading and gold line share the top row: heading at the start (right), gold, life and interest at the end */
  [lang=ar] ${SG} { grid-template-areas: "h1 h1" "help help" "offers offers" "otitle extras" "pv extras" "owned extras" "rtitle rtitle" "relics relics"; }
  [lang=ar] ${SG} > h1 { justify-self: start; margin-inline-start: calc(10 * var(--p)); }
  [lang=ar] ${SG} > .shop-top { grid-area: h1; justify-self: end; align-self: center; flex-wrap: nowrap; white-space: nowrap; margin-inline-end: calc(10 * var(--p)); }
}

/* ---- GAME OVER on 720p- and 1080p-class windows: K.O., NEXT TRY and RETRY / TITLE on top, everything else
 * (summary, damage, unlocks, timeline, build, profile and season strips, clips, high scores) in three balanced columns */
/* Big windows: .go-body is transparent, so game over lays out as it always did. */
${GB} { display: contents; }
@media (min-width: 1000px) and (max-height: 1200px) {
  ${GO} { gap: calc(3 * var(--p)); padding: calc(3 * var(--p)) 20px calc(4 * var(--p)); }
  [lang=ar] ${GO} { padding-top: calc(3 * var(--p)); }
  ${GO} > h1.ko { font-size: 64px; line-height: 1; margin: 0; flex-shrink: 0; }
  ${GO} > .newbest { font-size: 14px; margin-top: calc(-2 * var(--p)); }
  ${GO} > .menu.row { flex-wrap: wrap; justify-content: center; }
  ${GO} > .menu.row button { min-height: 0; padding-block: 4px 6px; font-size: 22px; }
  ${GO} > .ft-next { max-width: min(1100px, 94vw); padding-block: 4px 6px; margin: 0 auto; flex-shrink: 0; }
  ${GB} { display: block; flex-shrink: 0; width: min(1520px, 100%); columns: 3; column-gap: calc(5 * var(--p)); column-fill: balance; text-align: center; }
  ${GB} .go-cols, ${GB} .ob-go { display: contents; }
  ${GO_ITEMS} { break-inside: avoid; margin: 0 auto calc(3 * var(--p)); max-width: 100%; box-sizing: border-box; }
  ${GB} :is(.summary, .dmg-table, .ob-unlocks, .ob-recap, .m2-strip, .sp-strip, .clips-panel, .hiscores) { width: 100%; min-width: 0; }
  ${GB} .summary { padding: 8px 14px 10px; }
  ${GB} .summary .big { font-size: 56px; line-height: 1.05; }
  ${GB} .summary .grid { grid-template-columns: auto auto auto auto; gap: 0 10px; margin-top: 4px; font-size: 22px; justify-content: center; }
  ${GB} .summary .grid span { font-size: 11px; line-height: 1.8; }
  ${GB} .dmg-table { padding: 8px 14px 10px; }
  ${GB} .dmg-row { grid-template-columns: minmax(0, 1.3fr) minmax(30px, 1fr) auto; gap: 8px; margin: 3px 0; font-size: 18px; }
  ${GB} .dmg-row > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: start; }
  ${GB} .ob-unlocks, ${GB} .ob-recap { padding: 8px 14px 10px; }
  ${GB} .ob-recap table { margin-inline: auto; }
  /* padding + layout containment: the badges' level numbers hang 1px under them, and a column break there sent
   * those positioned numbers to the top of the next column */
  ${GB} .build { display: flex; flex-wrap: wrap; justify-content: center; gap: calc(2 * var(--p)); padding-bottom: calc(2 * var(--p)); }
  ${GB} .build .badge { contain: layout; break-inside: avoid; }
  ${GB} .build .mod-strip { flex-basis: 100%; }
  ${GB} .unlocked:empty { display: none; }
  ${GB} .clips-panel { padding: calc(2 * var(--p)) calc(3 * var(--p)); text-align: start; }
  ${GB} .clips-panel h2 { font-size: 22px; }
  ${GB} .clips-panel p { font-size: 14px; margin: var(--p) 0; }
  ${GB} .clips-panel > button { min-height: 0; padding-block: 3px 5px; font-size: 18px; }
  ${GB} .clips-card { flex-basis: 112px; }
  ${GB} .clips-card img { width: 112px; height: 63px; }
  ${GB} .hiscores { padding: 8px 14px 10px; }
  ${GB} .hiscores table { margin-inline: auto; font-size: 18px; }
  [lang=ar] ${GO} > h1.ko { font-size: 40px; line-height: 1.15; }
  [lang=ar] ${GO} > .newbest { font-size: 16px; line-height: 1.2; margin-top: calc(-3 * var(--p)); }
  [lang=ar] ${GO} > .ft-next { padding-block: 2px 4px; gap: 0; }
  [lang=ar] ${GO} > .ft-next .ft-cheer { font-size: 20px; line-height: 1.3; }
  [lang=ar] ${GO} > .ft-next .ft-tip { font-size: 17px; line-height: 1.35; }
  [lang=ar] ${GO} > .ft-next small { font-size: 13px; line-height: 1.3; }
  [lang=ar] ${GO} > .menu.row button { padding-block: 2px 4px; line-height: 1.25; }
  [lang=ar] ${GB} .summary .big { font-size: 44px; line-height: 1.15; }
  [lang=ar] ${GB} .summary .grid { font-size: 20px; line-height: 1.35; }
  [lang=ar] ${GB} .dmg-row { font-size: 17px; line-height: 1.3; margin: 1px 0; }
  [lang=ar] ${GB} .clips-panel h2 { font-size: 20px; line-height: 1.3; }
  [lang=ar] ${GB} .clips-panel p { font-size: 14px; line-height: 1.35; }
  [lang=ar] ${GB} .summary .grid span { font-size: 13px; line-height: 1.7; }
}
/* 720p: the run timeline folds to one chip per stage (DPS bar); the full table opens on hover or focus */
@media (min-width: 1000px) and (max-height: 820px) {
  ${GO} > h1.ko { font-size: 48px; }
  ${GO} .summary .big { font-size: 46px; }
  ${GO} .ob-recap { position: relative; }
  ${GO} .ob-recap:not(:hover, :focus-within, .focused) table { display: block; border-spacing: 0; }
  ${GO} .ob-recap:not(:hover, :focus-within, .focused) tbody { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--p) calc(3 * var(--p)); }
  ${GO} .ob-recap:not(:hover, :focus-within, .focused) tr { display: flex; align-items: center; gap: calc(1.5 * var(--p)); }
  ${GO} .ob-recap:not(:hover, :focus-within, .focused) tr:first-child,
  ${GO} .ob-recap:not(:hover, :focus-within, .focused) td:not(.st, :nth-child(3)) { display: none; }
  ${GO} .ob-recap:not(:hover, :focus-within, .focused) td { padding: 0; }
  ${GO} .ob-recap:not(:hover, :focus-within, .focused) .b { min-width: 0; font-size: 16px; }
  ${GO} .ob-recap:is(:hover, :focus-within, .focused) table { position: absolute; z-index: 5; inset-inline: 0; bottom: 100%; padding: 6px 8px; background: var(--ink); box-shadow: 0 0 0 var(--p) var(--white); }
  ${GO} .ob-recap .mh-more { display: block; font: 9px var(--label); letter-spacing: 1px; color: var(--mist); margin-top: var(--p); }
  [lang=ar] ${GO} .ob-recap .mh-more { font-size: 13px; letter-spacing: 0; }
}
@media not ((min-width: 1000px) and (max-height: 820px)) {
  ${GO} .ob-recap .mh-more { display: none; }
}

/* ---- phones (landscape): the primary action stays on screen in a sticky bar at the bottom
 * (PLAY's and PLAY SOLO's NEXT / BACK row, LOADOUT's START row, the shop's REROLL / HEAL / CONTINUE) */
@media (max-height: 500px) {
  ${STICKY_BARS.map((sel) => `#hud ${sel}`).join(',\n  ')} {
    position: sticky; bottom: calc(-18px + var(--p)); z-index: 6; margin-top: auto; align-self: stretch;
    justify-content: center; padding: calc(2 * var(--p)) var(--p); background: var(--ink);
    box-shadow: 0 calc(-1 * var(--p)) 0 0 var(--slate);
  }
  #hud :is(#scr-modes, #scr-loadout, #scr-play) > .menu.row:last-of-type button,
  #hud #scr-shop > .shop-extras button { min-height: 0; padding-block: 2px 4px; font-size: 18px; }
  /* cheap height cuts: PLAY's launchers in two columns, smaller hero / mode / loadout / shop cards */
  #hud #scr-play .menu-launch { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: calc(2 * var(--p)); width: min(720px, 94vw); max-width: none; }
  #hud #scr-play .menu-launch button { min-height: calc(13 * var(--p)); font-size: 22px; padding-block: 2px 4px; }
  #hud #scr-modes .hero-row { gap: calc(1.5 * var(--p)); }
  #hud #scr-modes .hero-row button { font-size: 16px; min-height: 0; padding: 2px 8px 4px; }
  #hud #scr-modes .mode-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: calc(2 * var(--p)); width: min(820px, 96vw); }
  #hud #scr-modes button.mode { min-height: 0; padding: 4px 8px 6px; gap: 1px; }
  #hud #scr-modes button.mode b { font-size: 18px; }
  #hud #scr-modes button.mode small { font-size: 13px; line-height: 1.15; }
  #hud #scr-loadout .lo-cards { gap: calc(1.5 * var(--p)); }
  #hud #scr-loadout button.lo-card { min-height: 0; padding-block: 3px 4px; }
  #hud #scr-shop .mod-card { min-height: 0; }
  #hud #scr-shop button.mod-card { gap: 2px; }
  #hud #scr-shop .mod-card .icon { width: 36px; height: 36px; margin-top: 2px; }
  #hud #scr-shop .mod-card .icon img.px-icon { width: 24px; height: 24px; }
  #hud #scr-shop .mod-card .name { font-size: 19px; }
  #hud #scr-shop .mod-card .desc { font-size: 15px; line-height: 1.15; }
  #hud #scr-shop .mod-card .price { padding: 2px 0 4px; }
  #hud #scr-shop .shop-offers { gap: calc(3 * var(--p)); }
  #hud :is(#scr-modes, #scr-loadout, #scr-play, #scr-shop) { gap: calc(2 * var(--p)); padding-block: calc(2 * var(--p)); }
  #hud :is(#scr-modes, #scr-loadout, #scr-play, #scr-shop) > h1 { font-size: 28px; line-height: 1.05; margin: 0; }
}
`;
