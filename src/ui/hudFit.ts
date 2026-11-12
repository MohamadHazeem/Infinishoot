/**
 * HUD fit (hudfit lane): when a side column of HUD panels is taller than the
 * window (8 teammates + objective + Night Raid intel + buddy link + network
 * panel + voice chip + candy at 720p / 150%, or on a phone), the dock
 * (src/ui/hudLayout.ts) can't find a free spot for every panel. The fit pass
 * makes that column degrade in steps, only as far as needed:
 *
 *   level 1  TIGHT  teammate rows on one line; 4+ teammates in two columns
 *   level 2  FOLD   goal cards fold to their active line (title + count, the
 *                   progress bar, danger lines); a card that changes, or the
 *                   whole stack under a resting pointer, opens for 3 s
 *   level 3  CHIP   network panel, voice chip, buddy link, candy line become
 *                   small icon chips
 *   level 4+ SCALE  the column's panels zoom down 5% per level, never below
 *                   70% of the user's UI SCALE
 *
 * Never touched: life/face, XP, timer, boss bar, weapon slots (dock anchors);
 * downed teammates, revive bars, the objective count/timer, escort life and
 * Night Raid detection stay visible at every level.
 *
 * Stability: a column steps up only after overflowing on `upPasses`
 * consecutive dock passes, and steps down only when the measured size change
 * of the step it would undo (recorded when it was taken) still fits with a
 * `margin` px spare for `downHold` s, at least `minDwell` s after its last
 * change. A step down that overflows again within `minDwell` blocks further
 * step-downs for `cooldown` s. Measuring is the dock's own batched pass; this
 * module only does arithmetic on those boxes and writes data attributes.
 */
import { resolveDock, type DockBox } from './hudLayout';

export const fitTuning = {
  /** Overflowing dock passes (leaky count: -0.5 per clean pass) before a column steps up. */
  upPasses: 2,
  /** Seconds a step down must keep fitting (estimated) before it is taken. */
  downHold: 0.5,
  /** Seconds after any change before a column may step down. */
  minDwell: 1.5,
  /** Spare px a step down must leave (added to the dock gap in the estimate). */
  margin: 12,
  /** Seconds without step-downs after one that had to be taken back. */
  cooldown: 6,
  /** Seconds a changed goal card stays open while the stack is folded. */
  hotTime: 3,
  /** Seconds a new first-time tip shows in full before a CHIP column folds it to its title. */
  tipHot: 6,
  /** Seconds the pointer must rest on the folded stack before it opens. */
  hoverDelay: 0.35,
  /** Lowest zoom of a panel, as a fraction of the user's UI SCALE. */
  minScale: 0.7,
  /** Zoom step per SCALE level. */
  scaleStep: 0.05,
  /** The middle of the play field (fractions of the window) that side panels must stay out of. */
  centre: [0.35, 0.35, 0.65, 0.65] as readonly number[],
};

/** Last SCALE level (zoom at minScale). */
export const FIT_SCALE_MAX = 3 + Math.round((1 - fitTuning.minScale) / fitTuning.scaleStep);
/** Highest fit level: TIGHT, FOLD, CHIP, SCALE steps down to minScale, then HIDE (the lowest-priority chips go). */
export const FIT_MAX = FIT_SCALE_MAX + 1;

/** What a fit level turns on. */
export function fitFlags(level: number): { tight: boolean; fold: boolean; chip: boolean; scale: number; hide: boolean } {
  const steps = Math.max(0, Math.min(FIT_SCALE_MAX, level) - 3);
  return { tight: level >= 1, fold: level >= 2, chip: level >= 3, scale: Math.round((1 - steps * fitTuning.scaleStep) * 100) / 100, hide: level > FIT_SCALE_MAX };
}

/** Side column of a movable panel: 0 left, 1 right, -1 the middle (no fit) or an anchor. */
export function columnOf(b: DockBox, viewW: number): -1 | 0 | 1 {
  if (!b.dir) return -1;
  const cx = b.x + b.w / 2;
  return cx < viewW * 0.4 ? 0 : cx > viewW * 0.6 ? 1 : -1;
}

/** The hysteresis state of one column. */
export interface FitColumn {
  level: number;
  /** Overflowing passes, leaky (+1 per overflowing pass, -0.5 per clean one). */
  over: number;
  /** Seconds the step-down estimate has fit in a row. */
  okT: number;
  /** Seconds since the last level change. */
  since: number;
  /** Seconds left without step-downs. */
  cool: number;
  /** The last change was a step down (a quick overflow after it starts the cooldown). */
  wentDown: boolean;
  /** Box sizes just before the last step up, keyed by panel; turned into a delta on the next pass. */
  pre: Map<unknown, Rect> | null;
  /** deltas[k]: how much each panel shrank going from level k to k+1 (pre minus post). */
  deltas: Map<unknown, Rect>[];
}
/** A box, or in a delta the change; `gone` = the panel vanished with the step (its whole box, to add back). */
interface Rect { x: number; y: number; w: number; h: number; dir?: -1 | 0 | 1; gone?: boolean }

export function newFitColumn(): FitColumn {
  return { level: 0, over: 0, okT: 0, since: 99, cool: 0, wentDown: false, pre: null, deltas: [] };
}

/**
 * The hysteresis rule (pure): given whether the column overflows now and
 * whether undoing its top step is estimated to fit, returns +1 (step up),
 * -1 (step down) or 0, and advances the column's timers by dt.
 */
export function fitDecide(c: FitColumn, overflow: boolean, downFits: boolean, dt: number): -1 | 0 | 1 {
  const T = fitTuning;
  c.since += dt;
  c.cool = Math.max(0, c.cool - dt);
  if (overflow) {
    c.okT = 0;
    c.over = Math.min(T.upPasses, c.over + 1);
    if (c.wentDown && c.since < T.minDwell) c.cool = T.cooldown; // the last step down didn't hold
    if (c.over >= T.upPasses && c.level < FIT_MAX) {
      c.over = T.upPasses - 1; // keep climbing one pass per step while it still overflows
      c.since = 0;
      c.wentDown = false;
      c.level++;
      return 1;
    }
    return 0;
  }
  // Leaky: an overlap that blinks on every other pass (a chip changing width) still adds up.
  c.over = Math.max(0, c.over - 0.5);
  if (c.level <= 0) return 0;
  c.okT = downFits ? c.okT + dt : 0;
  if (c.okT >= T.downHold && c.since >= T.minDwell && c.cool <= 0) {
    c.okT = 0;
    c.since = 0;
    c.wentDown = true;
    c.level--;
    return -1;
  }
  return 0;
}

const area = (a: DockBox, b: DockBox): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.off + a.h, b.y + b.off + b.h) - Math.max(a.y + a.off, b.y + b.off);
  return w > 1 && h > 1 ? w * h : 0;
};

/**
 * Which columns still have an overlap after the dock pass: a side panel on
 * an earlier box or panel, or a side panel over the middle of the field.
 */
export function overflowing(boxes: DockBox[], cols: (-1 | 0 | 1)[], n: number, viewW: number, viewH: number, out: boolean[]): boolean[] {
  out[0] = out[1] = false;
  const mid = centreBox(viewW, viewH, midBox);
  for (let i = 0; i < n; i++) {
    const b = boxes[i];
    if (!b.dir) continue;
    const ci = cols[i];
    if (ci >= 0 && area(b, mid)) out[ci] = true;
    for (let j = 0; j < i; j++) {
      if (!area(b, boxes[j])) continue;
      if (ci >= 0) out[ci] = true;
      if (cols[j] >= 0) out[cols[j]] = true;
    }
  }
  return out;
}
const midBox: DockBox = { x: 0, y: 0, w: 0, h: 0, dir: 0, off: 0 };

/** The middle of the play field in screen px (fitTuning.centre), written into `out`. */
export function centreBox(viewW: number, viewH: number, out: DockBox = { x: 0, y: 0, w: 0, h: 0, dir: 0, off: 0 }): DockBox {
  const [x0, y0, x1, y1] = fitTuning.centre;
  out.x = x0 * viewW;
  out.y = y0 * viewH;
  out.w = (x1 - x0) * viewW;
  out.h = (y1 - y0) * viewH;
  return out;
}

/**
 * The fit engine (pure apart from the keys it is handed): call `update` after
 * every dock pass with the measured boxes (CSS spots, `off` resolved) and a
 * key per box (the element). It returns true when a column changed level;
 * read `levelOf(col)` / `cols` to apply it.
 */
export class FitEngine {
  readonly columns: [FitColumn, FitColumn] = [newFitColumn(), newFitColumn()];
  /** Column of each box in the last pass. */
  cols: (-1 | 0 | 1)[] = [];
  private scratch: DockBox[] = [];
  private scratchCols: (-1 | 0 | 1)[] = [];
  private over: boolean[] = [false, false];
  private overDown: boolean[] = [false, false];
  /** Dev/QA: pin both columns to this level (null = automatic). */
  force: number | null = null;

  update(boxes: DockBox[], keys: unknown[], n: number, viewW: number, viewH: number, gap: number, dt: number): boolean {
    const cols = this.cols;
    for (let i = 0; i < n; i++) cols[i] = columnOf(boxes[i], viewW);
    if (this.force !== null) {
      const lv = Math.max(0, Math.min(FIT_MAX, this.force));
      const changed = this.columns.some((c) => c.level !== lv);
      for (const c of this.columns) Object.assign(c, newFitColumn(), { level: lv });
      return changed;
    }
    // Turn the sizes saved before a step up into that step's delta.
    for (let c = 0; c < 2; c++) {
      const col = this.columns[c];
      if (!col.pre) continue;
      const d = new Map<unknown, Rect>();
      const here = new Set<unknown>();
      for (let i = 0; i < n; i++) {
        here.add(keys[i]);
        const p = col.pre.get(keys[i]);
        if (p && cols[i] === c) d.set(keys[i], { x: p.x - boxes[i].x, y: p.y - boxes[i].y, w: p.w - boxes[i].w, h: p.h - boxes[i].h });
      }
      // Panels the step hid (HIDE): undoing it brings their old box back.
      for (const [k, p] of col.pre) if (!here.has(k)) d.set(k, { ...p, gone: true });
      col.deltas[col.level - 1] = d;
      col.pre = null;
    }
    const over = overflowing(boxes, cols, n, viewW, viewH, this.over);
    let changed = false;
    for (let c = 0; c < 2; c++) {
      const col = this.columns[c];
      let downFits = false;
      if (!over[c] && col.level > 0) downFits = this.estimateDown(boxes, keys, n, c, viewW, viewH, gap);
      const step = fitDecide(col, over[c], downFits, dt);
      if (step > 0) {
        const pre = new Map<unknown, Rect>();
        for (let i = 0; i < n; i++) if (cols[i] === c) pre.set(keys[i], { x: boxes[i].x, y: boxes[i].y, w: boxes[i].w, h: boxes[i].h, dir: boxes[i].dir });
        col.pre = pre;
      }
      if (step) changed = true;
    }
    return changed;
  }

  /** Would column c still fit with its top step undone (sizes from the recorded delta, `margin` px spare)? */
  private estimateDown(boxes: DockBox[], keys: unknown[], n: number, c: number, viewW: number, viewH: number, gap: number): boolean {
    const col = this.columns[c];
    const d = col.deltas[col.level - 1];
    if (!d) return false;
    const s = this.scratch;
    const cs = this.scratchCols;
    for (let i = 0; i < n; i++) {
      const b = boxes[i];
      const t = (s[i] ??= { x: 0, y: 0, w: 0, h: 0, dir: 0, off: 0 });
      const k = this.cols[i] === c ? d.get(keys[i]) : undefined;
      t.x = b.x + (k?.x ?? 0);
      t.y = b.y + (k?.y ?? 0);
      t.w = b.w + (k?.w ?? 0);
      t.h = b.h + (k?.h ?? 0);
      t.dir = b.dir;
      t.free = b.free;
      t.off = 0;
      cs[i] = this.cols[i];
    }
    // Hidden panels come back last (they are the lowest-priority ones).
    let m = n;
    for (const k of d.values()) if (k.gone) {
      const t = (s[m] ??= { x: 0, y: 0, w: 0, h: 0, dir: 0, off: 0 });
      Object.assign(t, { x: k.x, y: k.y, w: k.w, h: k.h, dir: k.dir ?? 1, off: 0, free: false });
      cs[m++] = c as 0 | 1;
    }
    resolveDock(s, m, gap + fitTuning.margin, viewH, centreBox(viewW, viewH, midBox));
    // Inflate the estimate by the margin so a column hovering at the limit stays put.
    const pad = fitTuning.margin / 2;
    for (let i = 0; i < m; i++) if (cs[i] === c) {
      s[i].y -= pad;
      s[i].h += 2 * pad;
      if (s[i].y + s[i].off < 0 || s[i].y + s[i].off + s[i].h > viewH + 2 * pad) return false;
    }
    return !overflowing(s, cs, m, viewW, viewH, this.overDown)[c];
  }
}

/* ---------------------------------------------------------------------- DOM side */

/** Low-priority panels that fold into icon chips at level 3. */
const CHIPS = ['net-panel', 'vc-self', 'ha-candy', 'goals', 'petpanel', 'co2-panel', 'ob-tip'];
/** The lowest-priority chips, hidden at HIDE when a column still doesn't fit at the smallest zoom. */
const HIDEABLE = ['net-panel', 'vc-self', 'ha-candy', 'petpanel'];
/** Goal cards with their own fold rules; any other card in the stack is clipped to its first lines. */
const CARD_SKIP = new Set(['team', 'spice']);

interface Applied { level: number; scale: number }

/**
 * Applies the engine's levels to the panels (data attributes and the `--hf`
 * zoom factor), and runs the folded goals stack: changed cards and a resting
 * pointer open it for `hotTime` s.
 */
export class HudFit {
  readonly engine = new FitEngine();
  private applied = new WeakMap<HTMLElement, Applied>();
  private hidden = new Map<HTMLElement, 0 | 1>();
  private sigs = new Map<HTMLElement, { sig: string; until: number }>();
  private now = 0;
  private px = -1;
  private py = -1;
  private hoverT = 0;
  private openUntil = 0;
  private hooked = false;
  /** Dev/QA: changed cards and the pointer never open the folded stack (stable boxes for fixtures). */
  quiet = false;
  /** Dev/QA: set to list the overlapping pairs of each pass in `pairs`. */
  debug = false;
  pairs: string[] = [];
  /** Dock passes so far (QA scripts wait on it). */
  passes = 0;

  constructor() {
    // Dev builds: `__hudfit.engine.columns` shows each column's level (scripts and screenshots).
    if (typeof window !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as { __hudfit: HudFit }).__hudfit = this;
  }

  /**
   * After the dock resolved its boxes (reads done, nothing written yet).
   * `zooms[i]` is each element's currentCSSZoom from the same measure pass.
   * Returns true when something changed and the dock should run again soon.
   */
  update(boxes: DockBox[], els: HTMLElement[], zooms: number[], n: number, viewW: number, viewH: number, gap: number, dt: number, ui: number): boolean {
    this.hook();
    this.now += dt;
    this.passes++;
    const changed = this.engine.update(boxes, els, n, viewW, viewH, gap, dt);
    const cols = this.engine.cols;
    if (this.debug) {
      // Dev/QA: which pairs still overlap after the dock (what keeps a column climbing).
      const mid = centreBox(viewW, viewH);
      const name = (el: HTMLElement) => el.id || el.className;
      this.pairs = [];
      for (let i = 0; i < n; i++) {
        if (!boxes[i].dir) continue;
        if (cols[i] >= 0 && area(boxes[i], mid)) this.pairs.push(`${name(els[i])}/centre`);
        for (let j = 0; j < i; j++) if (area(boxes[i], boxes[j])) this.pairs.push(`${name(els[i])}/${name(els[j])}`);
      }
    }
    let goals = -1;
    // Work out every write first, then write (no reads after the first write).
    const writes: [HTMLElement, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const el = els[i];
      if (el.id === 'goals') goals = i;
      const c = cols[i];
      if (c < 0 && !this.applied.has(el)) continue;
      const level = c === -1 ? 0 : this.engine.columns[c].level;
      const f = fitFlags(level);
      const was = this.applied.get(el);
      // Floor: the panel's zoom never drops under minScale of the user's UI SCALE.
      const base = zooms[i] / (was?.scale || 1);
      // Only the stacked (top-anchored) panels zoom: a corner panel placed by a right/bottom offset would slide into its anchor.
      const scale = f.scale >= 1 || boxes[i].dir !== 1 ? 1 : Math.min(1, Math.max(f.scale, (fitTuning.minScale * ui) / Math.max(0.01, base)));
      const sc = Math.round(scale * 100) / 100;
      if (!was || was.level !== level || was.scale !== sc) writes.push([el, level, sc]);
    }
    for (const [el, level, scale] of writes) {
      const f = fitFlags(level);
      el.toggleAttribute('data-hf-tight', f.tight);
      el.toggleAttribute('data-hf-fold', f.fold);
      el.toggleAttribute('data-hf-chip', f.chip && CHIPS.includes(el.id));
      const hide = f.hide && HIDEABLE.includes(el.id);
      el.toggleAttribute('data-hf-hide', hide);
      if (hide) this.hidden.set(el, cols[els.indexOf(el)] as 0 | 1);
      if (scale < 1) el.style.setProperty('--hf', String(scale));
      else el.style.removeProperty('--hf');
      if (level || scale < 1) this.applied.set(el, { level, scale });
      else this.applied.delete(el);
    }
    // Hidden chips aren't measured any more: bring them back once their column leaves HIDE.
    let shown = false;
    for (const [el, c] of this.hidden) if (!el.isConnected || !fitFlags(this.engine.columns[c].level).hide) {
      el.removeAttribute('data-hf-hide');
      this.hidden.delete(el);
      shown = true;
    }
    let tipChanged = false;
    for (let i = 0; i < n; i++) if (els[i].id === 'ob-tip') tipChanged = this.tipOpen(els[i]);
    const g = goals >= 0 ? els[goals] : null;
    const folded = !!g && g.hasAttribute('data-hf-fold');
    const opened = folded ? this.goalsOpen(g!, boxes[goals], dt) : false;
    return changed || writes.length > 0 || opened || tipChanged || shown;
  }

  private tipSig = '';
  private tipUntil = 0;

  /** A new first-time tip stays open `tipHot` s before a crowded column folds it to its title (hover opens it again). */
  private tipOpen(el: HTMLElement): boolean {
    const sig = el.querySelector('b')?.textContent ?? '';
    if (sig !== this.tipSig) {
      this.tipSig = sig;
      this.tipUntil = this.now + fitTuning.tipHot;
    }
    const hot = !this.quiet && this.tipUntil > this.now;
    if (hot === el.hasAttribute('data-hf-hot')) return false;
    el.toggleAttribute('data-hf-hot', hot);
    return true;
  }

  /** Track changed cards and the pointer over a folded goals stack; returns true when an attribute changed. */
  private goalsOpen(g: HTMLElement, b: DockBox, dt: number): boolean {
    let changed = false;
    const cards: HTMLElement[] = [];
    for (const k of g.children) {
      if (!(k instanceof HTMLElement) || k.hidden) continue;
      if (k.id === 'spice') {
        for (const s of k.children) if (s instanceof HTMLElement) cards.push(s);
      } else if (!CARD_SKIP.has(k.id)) cards.push(k);
    }
    const fresh = this.sigs.size === 0;
    const seen = new Set<HTMLElement>();
    for (const el of cards) {
      seen.add(el);
      // Numbers ticking (counts, timers) don't count as a change; new text or a new card does.
      const sig = el.className.replace(/\bpop\b/g, '') + '|' + (el.textContent ?? '').replace(/[\d\s.,:%/٠-٩+\-]+/g, '');
      const s = this.sigs.get(el);
      if (!s) this.sigs.set(el, { sig, until: fresh ? 0 : this.now + fitTuning.hotTime });
      else if (s.sig !== sig) {
        s.sig = sig;
        s.until = this.now + fitTuning.hotTime;
      }
      const hot = !this.quiet && this.sigs.get(el)!.until > this.now;
      if (hot !== el.hasAttribute('data-hf-hot')) {
        el.toggleAttribute('data-hf-hot', hot);
        changed = true;
      }
    }
    for (const el of this.sigs.keys()) if (!seen.has(el)) {
      this.sigs.delete(el);
      el.removeAttribute('data-hf-hot');
    }
    // A pointer resting on the stack opens it (aiming across it doesn't).
    const inside = this.px >= b.x && this.px <= b.x + b.w && this.py >= b.y + b.off && this.py <= b.y + b.off + b.h;
    this.hoverT = inside ? this.hoverT + dt : 0;
    if (this.hoverT >= fitTuning.hoverDelay && !this.quiet) this.openUntil = this.now + 0.5;
    const open = this.openUntil > this.now;
    if (open !== g.hasAttribute('data-hf-open')) {
      g.toggleAttribute('data-hf-open', open);
      changed = true;
    }
    return changed;
  }

  private hook(): void {
    if (this.hooked || typeof window === 'undefined') return;
    this.hooked = true;
    window.addEventListener(
      'pointermove',
      (e) => {
        this.px = e.clientX;
        this.py = e.clientY;
      },
      { passive: true },
    );
  }
}

/* ---------------------------------------------------------------------- CSS */

/** Pixel glyph as box-shadows of one UI pixel: '#' ink-outlined colour `c`. */
function glyph(rows: string[], colors: Record<string, string>): string {
  const sh: string[] = [];
  rows.forEach((r, y) =>
    [...r].forEach((ch, x) => {
      if (colors[ch]) sh.push(`calc(${x} * var(--p)) calc(${y} * var(--p)) 0 0 ${colors[ch]}`);
    }),
  );
  return sh.join(', ');
}
const NET_GLYPH = glyph(['......c', '....c.c', '..c.c.c', 'c.c.c.c'], { c: 'var(--cyan)' });
const CANDY_GLYPH = glyph(['y.....y', 'yyoooyy', 'y.ooo.y'], { y: 'var(--yellow)', o: 'var(--orange)' });

/** Unfolded goal cards: hot (just changed) ones, or every card while the stack is open. */
const FOLD = '#goals[data-hf-fold]:not([data-hf-open])';
const CARD = ':not([data-hf-hot])';

export const FIT_CSS = `
/* ---------------- hudfit: the column zoom factor (1 unless SCALE steps are on). */
#ingame > #goals, #hud > #net-panel, #vc-self, #hud > #ha-candy { --hf: 1; }

/* TIGHT: teammate rows on one line; four or more teammates in two columns. */
#goals[data-hf-tight] > #team { gap: var(--p); }
#goals[data-hf-tight] > #team .mate { display: flex; align-items: center; gap: calc(2 * var(--p)); font-size: 10px; line-height: 1; }
#goals[data-hf-tight] > #team .mate .nm { width: 70px; overflow: hidden; white-space: nowrap; }
#goals[data-hf-tight] > #team .mate .bar { width: 64px; height: calc(2 * var(--p)); margin-top: 0; }
#goals[data-hf-tight] > #team.compact { display: grid; grid-template-columns: repeat(2, max-content); grid-auto-flow: row dense; column-gap: calc(4 * var(--p)); row-gap: var(--p); }
/* The voice icon (voiceUi) joins the row instead of hanging off its end, so it can't sit on the next column. */
#goals[data-hf-tight] > #team .mate > .vc-ico { position: static; }
#goals[data-hf-tight] > #team .mate > .vc-ico svg { width: 12px; height: 11px; }
#goals[data-hf-tight] > #team.compact .mate .nm { width: 46px; }
#goals[data-hf-tight] > #team.compact .mate .bar { width: 40px; }
/* Danger never folds: a downed teammate keeps a whole row and its DOWN label. */
#goals[data-hf-tight] > #team .mate.down { grid-column: 1 / -1; }
#goals[data-hf-tight] > #team .mate.down .nm { width: auto; overflow: visible; }

/* FOLD: goal cards show their active line. */
${FOLD} > :is(#objective, #wevent:not(:has(.meter)))${CARD} {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 8px; align-items: baseline;
}
${FOLD} > :is(#objective, #wevent:not(:has(.meter)))${CARD} > .h { display: contents; }
${FOLD} > :is(#objective, #wevent:not(:has(.meter)))${CARD} > .h > span:first-child,
${FOLD} > :is(#objective, #wevent)${CARD} > .s { display: none; }
${FOLD} > :is(#objective, #wevent:not(:has(.meter)))${CARD} > .h > span:last-child { grid-row: 1; grid-column: 2; }
${FOLD} > :is(#objective, #wevent:not(:has(.meter)))${CARD} > .t { grid-row: 1; grid-column: 1; margin: 0; font-size: 16px; white-space: nowrap; overflow: hidden; }
${FOLD} > :is(#objective, #wevent)${CARD} > :is(.bar, .hp, .grab) { grid-column: 1 / -1; }
/* Night Raid: header and the detection meter stay; the hint row only while someone hunts you. */
${FOLD} > #wevent${CARD} > .row:not(:has(.hunt)) { display: none; }
${FOLD} > #cp-link${CARD} > .s { display: none; }
${FOLD} > #spice > div${CARD} > i { display: none; }
/* Cards from other lanes: their first lines (header, count) only. */
${FOLD} > :not(#team, #spice, #objective, #wevent, #cp-link)${CARD} { max-height: 34px; overflow: hidden; }

/* CHIP: low-priority panels become small icon chips. */
#goals[data-hf-chip] > #cp-link { min-width: 0; padding: var(--p) calc(2 * var(--p)); }
#goals[data-hf-chip] > #cp-link > .s { display: none; }
#hud > #net-panel[data-hf-chip] { min-width: 0; padding: var(--p) calc(2 * var(--p)); padding-inline-start: calc(10 * var(--p)); }
#hud > #net-panel[data-hf-chip] > :is(.hd, .ft) { display: none; }
#hud > #net-panel[data-hf-chip] > .row { grid-template-columns: calc(3 * var(--p)) auto auto auto; line-height: 1.2; }
#hud > #net-panel[data-hf-chip] > .row > :nth-child(5),
#hud > #net-panel[data-hf-chip] > .row:not(:has(.bad, .poor, .rc)) { display: none; }
#hud > #net-panel[data-hf-chip]::before {
  content: ''; position: absolute; inset-inline-start: calc(2 * var(--p)); top: calc(50% - 2 * var(--p));
  width: var(--p); height: var(--p); box-shadow: ${NET_GLYPH};
}
#hud > #net-panel[data-hf-chip]:not(:has(.row .bad, .row .poor, .row .rc)) { width: calc(11 * var(--p)); height: calc(7 * var(--p)); padding: 0; }
/* HIDE: the last resort for the lowest-priority chips (network, voice, candy, pet). */
[data-hf-hide]:is(#net-panel, #vc-self, #ha-candy, #petpanel) { visibility: hidden !important; }
/* Pet panel: name and level; roles panel: the roles and revive pool, not the bonus hint. */
#petpanel[data-hf-chip] > :is(.sk, .nx) { display: none; }
#co2-panel[data-hf-chip] .bonus { display: none; }
/* First-time tip: a new tip shows in full for a few seconds, then just its title (pointer over it opens it). */
#ob-tip[data-hf-chip]:not([data-hf-hot]):not(:hover) > :not(.ob-tip-h, .ob-tip-bar) { display: none; }
#ob-tip[data-hf-chip]:not([data-hf-hot]):not(:hover) { padding-block: 4px 6px; }
#vc-self[data-hf-chip] { padding: 3px 5px; }
#vc-self[data-hf-chip] > span { display: none; }
#hud > #ha-candy[data-hf-chip][data-chip] { font-size: 0; padding-inline-start: calc(10 * var(--p)); }
#hud > #ha-candy[data-hf-chip][data-chip]::after { content: attr(data-chip); font: 10px/12px var(--label); }
#hud > #ha-candy[data-hf-chip][data-chip]::before {
  content: ''; position: absolute; inset-inline-start: calc(2 * var(--p)); top: calc(50% - var(--p));
  width: var(--p); height: var(--p); box-shadow: ${CANDY_GLYPH};
}
`;
