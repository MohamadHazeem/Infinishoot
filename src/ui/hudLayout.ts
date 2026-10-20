/**
 * HUD layout pass (HUD lane): the level badge under the XP bar, the goals
 * stack on the left (teammates, objective, stage event, side challenge,
 * power-ups), button prompts and the gamepad legend, and UI SCALE.
 * Injected once as a <style> after style.css, so these rules win over the
 * older ones they replace without growing style.css.
 */
const CSS = `
:root { --ui: 1; }

/* ---------------- UI SCALE: zoom the HUD panels and menu contents.
 * World-anchored things (name tags, elite bars, pointers, damage numbers)
 * keep 1:1 screen coordinates, so they are not zoomed. SETTINGS itself stays at
 * 100% so the UI SCALE slider doesn't move under the pointer while dragged. */
#ingame > #xpbar, #ingame > #hp, #ingame > #runinfo, #ingame > #timer, #ingame > #goals,
#ingame > #pausebtn, #ingame > #bossbar, #ingame > #toast, #ingame > #chestreveal,
#ingame > #score, #ingame > #combo, #ingame > #loadout, #ingame > #mods, #ingame > #minimap,
#ingame > #petpanel, #ingame > #teammeter,
#ingame > #downed, #ingame > #meters, #ingame > #banner, #ingame > #stylemeter,
.casual-run-badge, #architect-hud, #ha-candy, #hud > #navhint, #ob-tip, #ob-train, #caps, #ingame > #gp-power, #ingame > #gp-cash, #ingame > #gp-comeback,
#hud > #co2-panel, #hud > #net-panel, #vc-self, #lc-hud > .lc-p, #vs-foe, #s2-onair, #s2-band, #weather2, #secret-hint,
.screen:not(.hud-pick-layer):not(#scr-settings) > * {
  zoom: var(--ui);
}

/* ---------------- Level badge: hangs under the XP bar's left end. */
#xpbar .lv {
  inset: auto;
  left: 18px;
  top: calc(9 * var(--p));
  width: calc(18 * var(--p));
  height: calc(15 * var(--p));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  --bg: var(--navy);
  --hi: var(--blue);
  --lo: var(--ink);
  text-shadow: var(--outline);
}
#xpbar .lv span {
  font: 10px var(--label);
  letter-spacing: 2px;
  color: var(--cyan);
  line-height: 1;
}
#xpbar .lv b {
  font: 34px var(--display);
  font-weight: normal;
  line-height: 0.8;
  color: var(--white);
}
#xpbar.up .lv { animation: lvpop 0.45s steps(3); }
#xpbar.up .lv b { color: var(--yellow); }
@keyframes lvpop {
  0% { transform: scale(1.35); }
  60% { transform: scale(0.92); }
  100% { transform: none; }
}
#hp, #runinfo { left: calc(18px + 18 * var(--p) + 14px); }
/* With the HUD face (src/ui/portraits.ts) in the corner, the badge sits right of it and life moves along. */
#hud #ingame.has-face #xpbar .lv { left: calc(18px + 64px + 4 * var(--p)); top: calc(6 * var(--p)); }
#hud #ingame.has-face > #hp,
#hud #ingame.has-face > #runinfo { left: calc(18px + 64px + 4 * var(--p) + 18 * var(--p) + 14px); }

/* ---------------- Goals stack (left): teammates, objective, event, challenge, power-ups. */
#goals {
  position: absolute;
  top: calc(28 * var(--p));
  left: 18px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: calc(4 * var(--p));
  pointer-events: none;
  max-width: min(320px, 42vw);
}
#goals > #team { position: static; }
#goals > #team:empty, #goals > #spice:empty { display: none; }
#goals > #spice {
  position: static;
  transform: none;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: calc(3 * var(--p));
  white-space: normal;
  font: 18px var(--font);
  letter-spacing: 0;
}
#spice > div {
  --bg: var(--night);
  --hi: var(--slate);
  --lo: var(--ink);
  --drop: transparent;
  min-width: 190px;
  padding: var(--p) calc(3 * var(--p)) calc(2 * var(--p));
  line-height: 1.1;
  animation: goalin 0.3s steps(3) both;
}
#spice > .event { --bg: var(--plum); --hi: var(--red); color: var(--white); animation: goalin 0.3s steps(3) both; }
#spice > .challenge { color: var(--yellow); }
#spice > .done { --bg: var(--teal); --hi: var(--green); color: var(--lime); }
#spice > .buff { --bg: var(--navy); --hi: var(--blue); color: var(--cyan); }
#spice > div i {
  display: block;
  font: 10px var(--label);
  font-style: normal;
  letter-spacing: 1px;
  color: var(--yellow);
}
#spice > .event i { color: var(--orange); animation: flash 0.8s steps(1) infinite; }
#spice > .buff i { color: var(--white); }
@keyframes goalin {
  from { transform: translateX(calc(-6 * var(--p))); opacity: 0; }
}

/* ---------------- Button prompts (src/ui/prompts.ts). */
kbd.prompt {
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  vertical-align: middle;
  text-shadow: none;
}
kbd.prompt:empty { display: none; }
.kc {
  display: inline-block;
  padding: 1px 4px 3px;
  font: 10px/12px var(--label);
  letter-spacing: 1px;
  color: var(--ink);
  background: var(--white);
  text-shadow: none;
  white-space: nowrap;
  vertical-align: middle;
  box-shadow:
    inset 0 -2px 0 0 var(--mist),
    0 -2px 0 0 var(--ink),
    0 2px 0 0 var(--ink),
    -2px 0 0 0 var(--ink),
    2px 0 0 0 var(--ink);
}
.kc.pad { background: var(--night); color: var(--white); box-shadow: inset 0 -2px 0 0 var(--ink), 0 -2px 0 0 var(--ink), 0 2px 0 0 var(--ink), -2px 0 0 0 var(--ink), 2px 0 0 0 var(--ink); }
.kc.mouse { padding: 0; background: transparent; box-shadow: none; }
.pg { display: block; image-rendering: pixelated; }
.pad-face { display: inline-block; vertical-align: middle; line-height: 0; }
.input-touch kbd.prompt { display: none; }

/* HUD meters: the prompt sits on the tank's top edge like a tab. */
#meters .pip { position: relative; }
#meters .pip kbd.prompt .kc { margin: 0; font: 10px/12px var(--label); letter-spacing: 1px; }
#meters .pip > kbd.prompt {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translate(-50%, -60%);
}

/* Title controls line: one chip per action. */
#scr-title .controls[data-prompt] { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 14px; }
#scr-title .controls .ctl { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }

/* Level-up card keys: numbers on keyboard; on a pad only the focused card shows its A / cross. */
.input-pad .screen button.card .key { visibility: hidden; }
.input-pad .screen button.card.focused .key { visibility: visible; }
.screen button.card .key .pad-face { margin-top: 1px; }

/* Gamepad legend on the CONTROLS screen. */
.pad-legend {
  display: grid;
  grid-template-columns: repeat(3, auto);
  gap: 8px 22px;
  font: 16px var(--font);
  color: var(--white);
}
.pad-legend .pl-row { display: flex; align-items: center; gap: 8px; }
.pad-legend .pl-btn { display: inline-flex; gap: 4px; align-items: center; }
@media (max-width: 800px) { .pad-legend { grid-template-columns: repeat(2, auto); } }

/* Menu navigation hint (pads only): bottom right while a menu is open. */
#navhint {
  position: absolute;
  right: 18px;
  bottom: 36px; /* clear of the title's version line */
  z-index: 11;
  display: none;
  gap: 16px;
  font: 12px var(--label);
  letter-spacing: 1px;
  color: var(--white);
  text-shadow: var(--outline);
  pointer-events: none;
}
#navhint > span { display: inline-flex; align-items: center; gap: 6px; }
.input-pad .menu-open > #navhint { display: flex; }

/* ---------------- uipolish lane: one look for the small HUD chips. */
/* Halloween candy line: a framed chip by the weapon slots (the dock lifts it above them). */
#hud > #ha-candy {
  left: 20px;
  bottom: 20px;
  padding: var(--p) calc(2 * var(--p));
  font: 10px/12px var(--label);
  letter-spacing: 1px;
  color: var(--yellow);
  background: var(--ink);
  box-shadow: inset var(--p) var(--p) 0 0 var(--night), 0 calc(-1 * var(--p)) 0 0 var(--ink), 0 var(--p) 0 0 var(--ink), calc(-1 * var(--p)) 0 0 0 var(--ink), var(--p) 0 0 0 var(--ink);
}
/* HUD chips that live outside #ingame hide with the rest of the HUD under menus and cinematics. */
.menu-open > :is(#ha-candy, #co2-panel, #co2-buy, #net-panel, #weather2), .menu-open ~ #vc-self,
.cinematic > :is(#ha-candy, #co2-panel, #net-panel) { visibility: hidden !important; }

/* Short windows (phones in landscape, 844x390): side panels shrink so the dock
 * finds room for them between the top row, the sticks and the bottom row. */
@media (max-height: 500px) {
  #hud #ingame > #goals { zoom: calc(var(--ui) * 0.8); }
  #hud #ingame > :is(#petpanel, #teammeter, #stylemeter, #gp-power, #gp-cash), #hud #co2-panel, #hud #net-panel,
  #hud #ob-tip, #hud > #ha-candy, #vc-self { zoom: calc(var(--ui) * 0.72); }
  #hud #ob-tip { top: 30%; }
  #hud #ingame > #toast { font-size: 16px; padding: 4px 10px; }
}

`;

/** Add the layout CSS once (after style.css, so it overrides the rules it replaces). */
export function injectHudCss(): void {
  if (typeof document === 'undefined' || document.getElementById('hud-layout-css')) return;
  const st = document.createElement('style');
  st.id = 'hud-layout-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/**
 * UI SCALE limits (percent). Scaling up is capped by the window so the top
 * row (life, clock, score) never overlaps: at most `fitW` CSS px of width and
 * `fitH` of height per 100% (1280x720 allows about 120%, 1920x1080 all 150%).
 * Windows narrower than `tinyW` shrink the HUD a little more (never under
 * `tinyMin`), so the level badge, life and clock still fit side by side.
 */
export const uiScaleTuning = { min: 75, max: 150, fitW: 950, fitH: 600, tinyW: 760, tinyMin: 0.75 };

/** Zoom factor for a stored UI SCALE (percent) in a w x h window; bad values fall back to 100%. */
export function uiZoom(pct: number, w = 1920, h = 1080): number {
  if (!Number.isFinite(pct)) return 1;
  const t = uiScaleTuning;
  const want = Math.max(t.min, Math.min(t.max, pct)) / 100;
  const fit = Math.max(1, Math.min(w / t.fitW, h / t.fitH));
  const tiny = w < t.tinyW ? Math.max(t.tinyMin, w / t.tinyW) : 1;
  return Math.round(Math.max(t.min / 100, Math.min(want, fit) * tiny) * 100) / 100;
}

let lastPct = 100;
let resizeHooked = false;

/** Apply UI SCALE: zooms the HUD panels and menu contents (CSS `--ui`); follows window resizes. */
export function applyUiScale(pct: number): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  lastPct = pct;
  document.documentElement.style.setProperty('--ui', String(uiZoom(pct, window.innerWidth, window.innerHeight)));
  if (!resizeHooked) {
    resizeHooked = true;
    window.addEventListener('resize', () => applyUiScale(lastPct));
  }
}

/* ======================================================================
 * HUD dock (uipolish lane): one layout pass for every corner panel.
 *
 * Each lane positions its own panel with CSS. With ~40 lanes that gives
 * overlaps (candy line on the weapon slots, network panel under a tall goals
 * stack, toasts on the boss bar...). The dock keeps those CSS spots and only
 * nudges a panel vertically when it would cover a panel listed before it in
 * HUD_DOCK (top-anchored panels move down, bottom-anchored ones up), with
 * `dockTuning.gap` px between them. It measures real screen boxes, so it works
 * at every UI SCALE, window size, language and with touch controls. The nudge
 * uses the CSS `translate` property, so a panel's own `transform` animations
 * keep working. New corner panels: add their selector to HUD_DOCK.
 * ====================================================================== */

/**
 * Corner panels in priority order, each with the way it may move: 0 = an
 * anchor (the fixed frame of the HUD, never moves), 1 = a top-anchored panel
 * (moves down), -1 = a bottom-anchored one (moves up). Every movable panel is
 * pushed clear of all panels listed before it, so put the panels that matter
 * most (and small chips that must stay by their anchor) first.
 */
export const HUD_DOCK: readonly (readonly [string, -1 | 0 | 1])[] = [
  // Anchors.
  ['#ingame > #xpbar', 0], ['#hudface', 0], ['#ingame > #hp', 0], ['#ingame > #runinfo', 0], ['#ingame > #timer', 0],
  ['#ingame > #pausebtn', 0], ['#ingame > #score', 0], ['#ingame > #loadout', 0], ['#ingame > #meters', 0],
  ['#ingame > #minimap', 0], ['#ingame > #bossbar', 0], ['#touch .tstick', 0], ['#touch .tbtn', 0],
  // Left column, then the chips by the weapon slots.
  ['#ingame > #goals', 1], ['#ha-candy', -1], ['#vc-self', -1],
  // Right column.
  ['#ingame > #combo', 1], ['#stylemeter', 1], ['#gp-cash', 1], ['#vs-foe', 1], ['#lc-hud .lc-p', 1],
  ['#s2-onair', 1], ['#s2-band', 1], ['#weather2', 1],
  // Bottom row.
  ['#ingame > #mods', -1], ['#co2-panel', -1], ['#petpanel', -1], ['#teammeter', -1], ['#gp-power', -1],
  ['#gp-comeback', -1], ['#architect-hud', -1],
  // Top middle: banners under the clock, then toasts and the chest reveal.
  ['#pvp2-hud', 1], ['#s2-duel', 1], ['#ingame > #toast', 1], ['#ingame > #chestreveal', 1],
  // Extra left-column panels last: they go where there is room.
  ['#net-panel', 1], ['#hm-panel', 1], ['#secret-hint', 1], ['#ob-tip', 1],
];

export const dockTuning = {
  /** Seconds between layout passes (each pass reads ~20 boxes). */
  every: 0.1,
  /** Screen px kept between a pushed panel and the one it was pushed by. */
  gap: 6,
  /** Seconds between re-reading the selectors (panels appear lazily). */
  rescan: 1,
};

/** A panel box in screen px at its CSS (un-nudged) spot; `dir` 0 = anchored, 1 = may move down, -1 = up. `off` is the result. */
export interface DockBox { x: number; y: number; w: number; h: number; dir: -1 | 0 | 1; off: number }

/** Overlap area of box a (placed at top ay) with box b (placed at its resolved spot). */
function overlap(a: DockBox, ay: number, b: DockBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(ay + a.h, b.y + b.off + b.h) - Math.max(ay, b.y + b.off);
  return w > 1 && h > 1 ? w * h : 0;
}

/**
 * Resolve the dock: boxes[0..n) in priority order. A movable box keeps its
 * CSS spot when that spot covers none of the boxes before it. Otherwise it
 * tries the spots right below / above each box it could touch (and the view
 * edges) and takes the nearest free one, moving against its `dir` only when
 * that is 3x nearer. When no spot is free (a crowded phone screen) it takes
 * the one covering the least area (anchors weigh 4x). Writes `off` (px) on every box.
 */
export function resolveDock(boxes: DockBox[], n: number, gap: number, viewH: number): void {
  for (let i = 0; i < n; i++) {
    const b = boxes[i];
    b.off = 0;
    if (!b.dir) continue;
    best.y = b.y;
    best.area = Infinity;
    best.cost = Infinity;
    consider(boxes, i, b.y, viewH);
    if (best.area > 0) {
      for (let j = 0; j < i; j++) {
        const o = boxes[j];
        if (Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x) <= 1) continue;
        consider(boxes, i, o.y + o.off + o.h + gap, viewH);
        consider(boxes, i, o.y + o.off - gap - b.h, viewH);
      }
      consider(boxes, i, 0, viewH);
      consider(boxes, i, viewH, viewH);
    }
    b.off = Math.round(best.y - b.y);
  }
}

const best = { y: 0, area: 0, cost: 0 };

/** Score spot y for box i against the boxes before it; keeps the best in `best`. */
function consider(boxes: DockBox[], i: number, y: number, viewH: number): void {
  const b = boxes[i];
  y = Math.max(0, Math.min(viewH - b.h, y));
  let area = 0;
  // Covering an anchor (life, clock, sticks, buttons) counts 4x: crowded panels rather overlap each other.
  for (let j = 0; j < i; j++) area += overlap(b, y, boxes[j]) * (boxes[j].dir ? 1 : 4);
  const d = y - b.y;
  const cost = Math.abs(d) * (d * b.dir < 0 ? 3 : 1);
  if (area < best.area - 0.5 || (Math.abs(area - best.area) <= 0.5 && cost < best.cost)) {
    best.area = area;
    best.cost = cost;
    best.y = y;
  }
}

interface DockEl { el: HTMLElement; dir: -1 | 0 | 1 }

/** The live dock: call `tick(dt)` once per frame (src/ui/hud.ts does). */
export class HudDock {
  private items: DockEl[] = [];
  private boxes: DockBox[] = [];
  private live: HTMLElement[] = [];
  private applied = new Map<HTMLElement, number>();
  private t = 0;
  private scanT = 0;

  private scan(): void {
    this.items.length = 0;
    for (const [sel, dir] of HUD_DOCK) {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) if (!this.items.some((d) => d.el === el)) this.items.push({ el, dir });
    }
    for (const el of this.applied.keys()) if (!el.isConnected) this.applied.delete(el);
  }

  tick(dt: number): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = dockTuning.every;
    this.scanT -= dockTuning.every;
    if (this.scanT <= 0) {
      this.scanT = dockTuning.rescan;
      this.scan();
    }
    const viewH = window.innerHeight;
    let n = 0;
    for (const { el, dir } of this.items) {
      const shown = el.isConnected && !el.hidden && (typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true }));
      const off = this.applied.get(el) ?? 0;
      if (!shown) {
        if (off) this.set(el, 0);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const b = (this.boxes[n] ??= { x: 0, y: 0, w: 0, h: 0, dir: 0, off: 0 });
      b.x = r.left;
      b.y = r.top - off;
      b.w = r.width;
      b.h = r.height;
      b.dir = dir;
      this.live[n++] = el;
    }
    resolveDock(this.boxes, n, dockTuning.gap, viewH);
    for (let i = 0; i < n; i++) {
      const el = this.live[i];
      if (Math.abs((this.applied.get(el) ?? 0) - this.boxes[i].off) >= 1) this.set(el, this.boxes[i].off);
    }
  }

  private set(el: HTMLElement, off: number): void {
    if (off) this.applied.set(el, off);
    else this.applied.delete(el);
    // `translate` lengths are zoomed with the element (UI SCALE), so undo that.
    const z = (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom || 1;
    el.style.translate = off ? `0 ${Math.round((off / z) * 100) / 100}px` : '';
  }
}
