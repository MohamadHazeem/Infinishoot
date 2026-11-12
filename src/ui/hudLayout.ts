import { FIT_CSS, HudFit, centreBox } from './hudFit';
import { menuCoverCss } from './menuHud';
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
  zoom: calc(var(--ui) * var(--hf, 1));
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

/* ---------------- uipolish: menus. */
/* Title, 1280x720-class windows: the activity cards (training offer, FIRST STEPS,
 * Halloween booth, quests) flow into two columns instead of running off the bottom. */
@media (min-width: 1100px) and (max-height: 900px) {
  #hud #scr-title.menu-home .menu-activity { display: block; columns: 2; column-gap: calc(5 * var(--p)); width: calc(213 * var(--p)); }
  #hud #scr-title.menu-home .menu-activity > * { break-inside: avoid; margin-bottom: calc(5 * var(--p)); }
}
/* LOADOUT on wide windows: each slot's cards share one row, so START and BACK fit at 1280x720. */
@media (min-width: 1100px) {
  #hud #scr-loadout .lo-rows { max-width: min(1320px, 100%); }
  #hud #scr-loadout .lo-cards { flex-wrap: nowrap; }
  #hud #scr-loadout button.lo-card { width: auto; flex: 0 1 205px; min-width: 0; }
}
/* PLAY SOLO on 720p-class windows: one hero row, shorter mode cards, so DIFFICULTY and NEXT fit. */
@media (min-width: 1000px) and (max-height: 820px) {
  #hud #scr-modes { gap: calc(2 * var(--p)); padding-block: calc(3 * var(--p)); }
  #hud #scr-modes > * { margin-block: 0; }
  #hud #scr-modes > .note { line-height: 1.1; }
  #hud #scr-modes > h1 { font-size: calc(14 * var(--p)); margin: 0; }
  #hud #scr-modes .hero-row { flex-wrap: nowrap; gap: calc(2 * var(--p)); }
  #hud #scr-modes .hero-row button { font-size: 18px; padding-inline: calc(3 * var(--p)); min-height: 0; }
  #hud #scr-modes .hero-note, #hud #scr-modes .mode-note { min-height: 0; margin: 0; }
  #hud #scr-modes .mode-grid { width: min(1180px, 96vw); grid-template-columns: repeat(4, minmax(0, 1fr)); gap: calc(3 * var(--p)); }
  #hud #scr-modes button.mode { min-height: 0; padding: 6px 10px 8px; gap: 2px; }
  #hud #scr-modes button.mode b { font-size: 21px; }
  #hud #scr-modes button.mode small { font-size: 14px; line-height: 1.1; }
  #hud #scr-modes .diff-row button, #hud #scr-modes > .menu.row:last-child button { font-size: 20px; min-height: 0; padding-block: 4px; }
  #hud #scr-modes .casual-preset { padding-block: 0; }
  #hud #scr-modes .casual-preset button { font-size: 20px; min-height: 0; padding-block: 4px; }
  #hud #scr-modes .casual-preset small { font-size: 15px; }
  #hud #scr-modes .ft-quick { padding-block: var(--p); }
  #hud #scr-modes .ft-quick button { min-height: 0; padding-block: 4px; }
}
/* A first-time tip over the title sits bottom centre instead of on the profile badge / season banner. */
.menu-open:has(#scr-title:not([hidden])) #ob-tip { top: auto; right: auto; bottom: calc(18 * var(--p)); left: calc(50% - min(125px, 15vw)); }
/* Card slot ribbons stay on one line in long languages (AUTOMATISCHE WAFFE wrapped under the pick bar). */
.card .slot-ribbon { white-space: nowrap; overflow: hidden; }
:root:is([lang=de], [lang=fr], [lang=es], [lang=pt-BR], [lang=tr]) .card .slot-ribbon { letter-spacing: 0; font-size: 11px; gap: 5px; }
/* LEVEL UP on 720p-class windows: smaller icons and text so the cards and REROLL / SKIP fit. */
@media (min-width: 1000px) and (max-height: 820px) {
  #hud #scr-levelup button.card { min-height: 0; gap: 6px; padding-bottom: 12px; }
  #hud #scr-levelup .card .icon { width: 60px; height: 60px; }
  #hud #scr-levelup .card .icon img.px-icon { width: 48px; height: 48px; }
  #hud #scr-levelup .card .name { font-size: 24px; }
  #hud #scr-levelup .card .desc { font-size: 17px; line-height: 1.2; }
}
/* The playable-title hint sits bottom centre, clear of the menu and the activity cards. */
#cine .cn-tp { right: auto; left: 50%; bottom: calc(4 * var(--p)); transform: translateX(-50%); white-space: nowrap; }

/* Arabic (RTL) mirrors the HUD columns (src/i18n/layout.ts moves goals/loadout right and score/combo left):
 * the panels that live beside them follow, so the right column isn't shared by goals, style and roles. */
[lang=ar] #hud #stylemeter, [lang=ar] #hud #co2-panel { right: auto; left: 20px; }
[lang=ar] #hud #stylemeter { justify-items: start; }
[lang=ar] #hud > #ha-candy { left: auto; right: 20px; }
/* hudfit: the combo cash-in prompt follows the combo to the left (it hit the mirrored goals stack). */
[lang=ar] #hud #ingame > #gp-cash { right: auto; left: 20px; }
/* hudfit: the network panel stays left in Arabic too. The mirrored right column already holds the goals stack
 * above the minimap and weapon slots, while the left one has room under the roles panel and style meter. */
[lang=ar] #vc-self { left: auto; right: calc(4 * var(--p)); }
@media (max-width: 900px), (max-height: 500px), (pointer: coarse) {
  /* Phones in Arabic: the mobile layout's right-hand pause/score/combo meet the mirrored face and life bar. */
  [lang=ar] #hud #ingame #pausebtn { right: auto; left: 12px; }
  [lang=ar] #hud #ingame #score, [lang=ar] #hud #ingame #combo { right: auto; left: 76px; }
  /* The mirrored goals stack starts under the phone minimap (right: 12px, top: 82px) instead of on it. */
  [lang=ar] #hud #ingame #goals { top: 160px; }
  [lang=ar] #hud #ingame > #gp-cash { right: auto; left: 100px; }
}

/* Short windows (phones in landscape, 844x390): side panels shrink so the dock
 * finds room for them between the top row, the sticks and the bottom row. */
@media (max-height: 500px) {
  #hud #ingame > #goals { zoom: calc(var(--ui) * 0.8 * var(--hf, 1)); }
  #hud #ingame > :is(#petpanel, #teammeter, #stylemeter, #gp-power, #gp-cash), #hud #co2-panel, #hud #net-panel,
  #hud #ob-tip, #hud > #ha-candy, #vc-self, #hud #ingame > .pp-pop { zoom: calc(var(--ui) * 0.72 * var(--hf, 1)); }
  #hud #ob-tip { top: 30%; }
  #hud #ingame > #toast { font-size: 16px; padding: 4px 10px; }
  #cine .cn-tp { display: none; }
  /* Menus take the whole short screen: the life and XP bars hide too, or they collide with the headings. */
  .menu-open #ingame > :is(#xpbar, #hp) { visibility: hidden !important; }
}

`;

/** Add the layout CSS once (after style.css, so it overrides the rules it replaces). */
export function injectHudCss(): void {
  if (typeof document === 'undefined' || document.getElementById('hud-layout-css')) return;
  const st = document.createElement('style');
  st.id = 'hud-layout-css';
  st.textContent = CSS + FIT_CSS + menuCoverCss(HUD_DOCK.map(([s]) => s));
  document.head.appendChild(st);
}

/**
 * UI SCALE limits (percent). Scaling up is capped by the window so the top
 * row (life, clock, score) never overlaps: at most `fitW` CSS px of width and
 * `fitH` of height per 100% (1280x720 allows about 120%, 1920x1080 all 150%).
 * Windows narrower than `tinyW` shrink the HUD a little more (never under
 * `tinyMin`), so the level badge, life and clock still fit side by side.
 * Short desktop windows (`shortFrom`..`shortH` px tall, e.g. 960x540) shrink the
 * same way by height, so level-up cards and their SKIP/BANISH row stay on screen;
 * phones (under `shortFrom`) keep their own media-query layout.
 */
export const uiScaleTuning = { min: 75, max: 150, fitW: 950, fitH: 600, tinyW: 760, tinyMin: 0.75, shortH: 720, shortFrom: 500 };

/** Zoom factor for a stored UI SCALE (percent) in a w x h window; bad values fall back to 100%. */
export function uiZoom(pct: number, w = 1920, h = 1080): number {
  if (!Number.isFinite(pct)) return 1;
  const t = uiScaleTuning;
  const want = Math.max(t.min, Math.min(t.max, pct)) / 100;
  const fit = Math.max(1, Math.min(w / t.fitW, h / t.fitH));
  const tiny = w < t.tinyW ? Math.max(t.tinyMin, w / t.tinyW) : 1;
  const short = h >= t.shortFrom && h < t.shortH ? Math.max(t.tinyMin, h / t.shortH) : 1;
  return Math.round(Math.max(t.min / 100, Math.min(want, fit) * Math.min(tiny, short)) * 100) / 100;
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
  ['#ingame > #goals', 1], ['#ha-candy', -1], ['#vc-self', -1], ['#ingame > .pp-pop.left', 1],
  // Right column.
  ['#ingame > #combo', 1], ['#stylemeter', 1], ['#ingame > .pp-pop.right', 1], ['#gp-cash', 1], ['#vs-foe', 1], ['#lc-hud .lc-p', 1],
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
export interface DockBox { x: number; y: number; w: number; h: number; dir: -1 | 0 | 1; off: number; free?: boolean }

/** hudfit: top-middle banners and toasts that may sit over the middle of the field; every other panel keeps out of it. */
export const DOCK_FREE: ReadonlySet<string> = new Set(['#ingame > #toast', '#ingame > #chestreveal', '#pvp2-hud', '#s2-duel']);

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
 * that is 6x nearer. When no spot is free (a crowded phone screen) it takes
 * the one covering the least area (anchors weigh 4x). Writes `off` (px) on every box.
 */
export function resolveDock(boxes: DockBox[], n: number, gap: number, viewH: number, keepOut: DockBox | null = null): void {
  keep = keepOut;
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
      if (keep && !b.free && Math.min(b.x + b.w, keep.x + keep.w) - Math.max(b.x, keep.x) > 1) {
        consider(boxes, i, keep.y + keep.h + gap, viewH);
        consider(boxes, i, keep.y - gap - b.h, viewH);
      }
      consider(boxes, i, 0, viewH);
      consider(boxes, i, viewH, viewH);
    }
    b.off = Math.round(best.y - b.y);
  }
}

const best = { y: 0, area: 0, cost: 0 };
/** The middle of the field (hudfit): counts like an anchor for every panel that isn't `free`. */
let keep: DockBox | null = null;

/** Score spot y for box i against the boxes before it; keeps the best in `best`. */
function consider(boxes: DockBox[], i: number, y: number, viewH: number): void {
  const b = boxes[i];
  y = Math.max(0, Math.min(viewH - b.h, y));
  let area = 0;
  // Covering an anchor (life, clock, sticks, buttons) counts 4x: crowded panels rather overlap each other.
  for (let j = 0; j < i; j++) area += overlap(b, y, boxes[j]) * (boxes[j].dir ? 1 : 4);
  if (keep && !b.free) area += overlap(b, y, keep) * 4;
  const d = y - b.y;
  const cost = Math.abs(d) * (d * b.dir < 0 ? 6 : 1);
  if (area < best.area - 0.5 || (Math.abs(area - best.area) <= 0.5 && cost < best.cost)) {
    best.area = area;
    best.cost = cost;
    best.y = y;
  }
}

interface DockEl { el: HTMLElement; dir: -1 | 0 | 1; free: boolean }

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
      for (const el of document.querySelectorAll<HTMLElement>(sel)) if (!this.items.some((d) => d.el === el)) this.items.push({ el, dir, free: DOCK_FREE.has(sel) });
    }
    for (const el of this.applied.keys()) if (!el.isConnected) this.applied.delete(el);
  }

  private pending = false;
  private readonly run = (): void => {
    this.pending = false;
    this.layout();
  };

  /**
   * Call once per frame. The measuring runs in a task right after this frame
   * is painted, when layout is already clean, so reading the boxes never
   * forces a synchronous layout inside the game frame.
   */
  tick(dt: number): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    this.t -= dt;
    if ((this.t > 0 && !this.soon) || this.pending) return;
    this.soon = false;
    this.t = dockTuning.every;
    this.pending = true;
    setTimeout(this.run, 0);
  }

  /** hudfit lane: degrades a side column in steps when it doesn't fit (src/ui/hudFit.ts). */
  readonly fit = new HudFit();
  private zooms: number[] = [];
  private centre: DockBox = { x: 0, y: 0, w: 0, h: 0, dir: 0, off: 0 };
  private lastRun = -1;
  /** Run the next pass on the next frame (the fit just changed a column). */
  private soon = false;

  /** One layout pass: measure the docked panels and nudge the ones that overlap. */
  layout(): void {
    this.scanT -= dockTuning.every;
    if (this.scanT <= 0) {
      this.scanT = dockTuning.rescan;
      this.scan();
    }
    const now = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
    const dt = this.lastRun < 0 ? dockTuning.every : Math.min(0.25, Math.max(0, now - this.lastRun));
    this.lastRun = now;
    const viewH = window.innerHeight;
    // menuhud: under a menu the first-time tip is placed by MenuTip (src/ui/menuHud.ts), not the dock.
    const menuOpen = !!document.querySelector('#hud.menu-open');
    let n = 0;
    for (const { el, dir, free } of this.items) {
      const shown = el.isConnected && !el.hidden && !(menuOpen && el.id === 'ob-tip') && (typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true }));
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
      b.free = free;
      this.zooms[n] = (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom || 1;
      this.live[n++] = el;
    }
    resolveDock(this.boxes, n, dockTuning.gap, viewH, centreBox(window.innerWidth, viewH, this.centre));
    // All reads are done: the fit pass may now write its attributes, then the nudges.
    const ui = Number(document.documentElement.style.getPropertyValue('--ui')) || 1;
    this.soon = this.fit.update(this.boxes, this.live, this.zooms, n, window.innerWidth, viewH, dockTuning.gap, dt, ui);
    for (let i = 0; i < n; i++) {
      const el = this.live[i];
      if (Math.abs((this.applied.get(el) ?? 0) - this.boxes[i].off) >= 1) this.set(el, this.boxes[i].off, this.zooms[i]);
    }
  }

  private set(el: HTMLElement, off: number, z = 1): void {
    if (off) this.applied.set(el, off);
    else this.applied.delete(el);
    // `translate` lengths are zoomed with the element (UI SCALE), so undo that (zoom read in the measure pass).
    el.style.translate = off ? `0 ${Math.round((off / z) * 100) / 100}px` : '';
  }
}
