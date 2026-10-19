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
#ingame > #downed, #ingame > #meters, #ingame > #banner, #ingame > #stylemeter,
#hud > #navhint,
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
