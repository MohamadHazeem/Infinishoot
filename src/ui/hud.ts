/**
 * In-game arcade HUD: XP bar and level, life, stage timer, score and combo,
 * kills and gold, boss bar, weapon/item loadout, dash and bomb meters,
 * banners, toasts, hurt vignette, screen flash and fade. Plain DOM.
 */
import { iconHtml } from './pixelIcons';
import type { Rarity } from '../data/rarity';
import { MAX_GEARS } from '../game/hero';
import { WEAPONS } from '../data/weapons';
import { PASSIVES } from '../data/passives';
import { sfx } from '../audio/sfx';

// ---------------------------------------------------------------- slot reels
// Shared by the level-up cards (screens.ts) and the chest reveal below. A reel
// is a strip [real item, decoy 1..n]; it starts showing decoy n and scrolls
// down one item per step until the real item lands at the top.

let motionQuery: MediaQueryList | undefined;
/** Reduced flashes also opts out of UI motion; reuse the media query instead of allocating every frame. */
/**
 * Restart a CSS animation class: take it off now and put it back next frame.
 * (The old `void el.offsetWidth` trick forced a synchronous layout of the whole
 * HUD mid-frame, on every gold pickup, toast and banner.)
 */
export function restartClass(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => el.classList.add(cls));
  else el.classList.add(cls);
}

export const reduceMotion = () => access.reduceFlash || (motionQuery ??= matchMedia('(prefers-reduced-motion: reduce)')).matches;

export const hudTuning = { goldSpeed: 14, xpSpeed: 14, damageHold: 0.22, damageCatchup: 1.4, comboBreak: 0.65 };
export const comboTier = (combo: number): number => combo >= 100 ? 4 : combo >= 50 ? 3 : combo >= 25 ? 2 : combo >= 10 ? 1 : 0;
export const comboMilestone = (before: number, after: number): boolean => after >= 10 && Math.floor(after / 10) > Math.floor(before / 10);
/** Exponential approach remains consistent at different refresh rates. */
export const approachHud = (from: number, to: number, speed: number, dt: number): number => to + (from - to) * Math.exp(-speed * Math.max(0, dt));

/** Step durations (s): fast 45 ms ticks for about `spin` seconds, ending with the slower `tail`. */
export function reelSteps(spin: number, tail: number[]): number[] {
  const rest = spin - tail.reduce((a, b) => a + b, 0);
  return [...Array<number>(Math.max(2, Math.round(rest / 0.045))).fill(0.045), ...tail];
}

/** Reel state at time t: items still to go (snapped to thirds, so it slides in chunky steps) and items passed. */
export function reelAt(steps: number[], t: number): { pos: number; passed: number } {
  let passed = 0;
  while (passed < steps.length && t >= steps[passed]) t -= steps[passed++];
  const f = passed < steps.length ? t / steps[passed] : 0;
  return { pos: Math.ceil((steps.length - passed - f) * 3) / 3, passed };
}

const REEL_POOL = [...Object.values(WEAPONS), ...Object.values(PASSIVES).filter((d) => !d.coop)];

/** n random items for a reel strip, never `not` and never the same twice in a row. */
export function decoys(n: number, not: string): { id: string; name: string; color: string; icon: string }[] {
  const out: (typeof REEL_POOL)[number][] = [];
  while (out.length < n) {
    const d = REEL_POOL[Math.floor(Math.random() * REEL_POOL.length)];
    if (d.id !== not && d.id !== out[out.length - 1]?.id) out.push(d);
  }
  return out;
}

export interface ChestItem {
  id: string;
  name: string;
  color: string;
  icon: string;
  text: string;
  rarity?: Rarity;
}
import { access, settings } from '../game/settings';

export interface HudState {
  metaLabel?: string;
  hp: number;
  maxHp: number;
  dash01: number;
  /** Dashes ready / max (Dash Cells). */
  dashStock: number;
  dashMax: number;
  bomb01: number;
  /** Short name of the special on Q/E (BOMB, STORM...). */
  special: string;
  score: number;
  combo: number;
  multiplier: number;
  combo01: number;
  stage: number;
  level: number;
  xp01: number;
  timeLeft: number; // seconds; -1 = boss fight, -2 = stage cleared
  kills: number;
  gold: number;
  /** Level-up rerolls held (max MAX_GEARS). */
  gears: number;
  /** Boss (or mini-boss) bar; `ticks` = HP fractions where phases change, `phase` = current phase. */
  boss: { name: string; hp01: number; ticks?: number[]; phase?: number; mini?: boolean } | null;
  /** Event, challenge and power-up lines under the timer. */
  spice: { text: string; kind: 'event' | 'challenge' | 'done' | 'buff' }[];
  lowHp: boolean;
}

/** What an item or upgrade belongs to: a click, the special, an auto weapon, a passive item or a bonus. */
export type Slot = 'left' | 'right' | 'special' | 'auto' | 'item' | 'bonus';

export const SLOT_LABEL: Record<Slot, string> = {
  left: 'LEFT CLICK',
  right: 'RIGHT CLICK',
  special: 'SPECIAL Q/E',
  auto: 'AUTO WEAPON',
  item: 'ITEM',
  bonus: 'BONUS',
};

// Tiny pixel pictograms for the slot ribbon: '#' = outline, 'o' = lit part.
const PICTO: Record<Slot, string[]> = {
  left: ['.#####.', '#oo#..#', '#oo#..#', '#######', '#.....#', '#.....#', '#.....#', '.#####.'],
  right: ['.#####.', '#..#oo#', '#..#oo#', '#######', '#.....#', '#.....#', '#.....#', '.#####.'],
  special: ['#######', '#.....#', '#.ooo.#', '#.o.o.#', '#.o.o.#', '#.ooo.#', '#...o.#', '#######'],
  auto: ['...#...', '.#####.', '##ooo##', '#oo.oo#', '#oo.oo#', '##ooo##', '.#####.', '...#...'],
  item: ['..###..', '...#...', '..###..', '.#ooo#.', '#ooooo#', '#ooooo#', '#ooooo#', '.#####.'],
  bonus: ['.#####.', '##ooo##', '#oo#oo#', '#o###o#', '#oo#oo#', '##ooo##', '.#####.', '.......'],
};

/** Inline pixel SVG for a slot's pictogram. */
export function slotPicto(slot: Slot): string {
  const rows = PICTO[slot];
  let rects = '';
  rows.forEach((r, y) =>
    [...r].forEach((c, x) => {
      if (c === '#') rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="currentColor"/>`;
      else if (c === 'o') rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="currentColor" opacity=".55"/>`;
    }),
  );
  return `<svg class="picto" viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

export interface LoadoutItem {
  /** Item id (picks its pixel icon). */
  id: string;
  icon: string;
  color: string;
  level: number;
  max: boolean;
  /** Weapon evolved (shown instead of MAX). */
  evo?: boolean;
  name: string;
  rarity?: Rarity;
  /** What it does (pause-screen tooltip). */
  desc?: string;
  kind: 'weapon' | 'passive';
  /** Which slot it fills (colour tag in the HUD, label in tooltips). */
  slot?: Slot;
}

/** Minimap input: world positions on the XZ plane; the arena spans -half..half on both axes. */
export interface MinimapView {
  half: number;
  me: { x: number; z: number; color: string };
  mates: { x: number; z: number; color: string; down: boolean }[];
  boss: { x: number; z: number } | null;
  elites: { x: number; z: number }[];
  chests: { x: number; z: number }[];
  portal: { x: number; z: number } | null;
}

/** Co-op name tag: screen position over the teammate's head, plus distance (m) for the off-screen edge pointer. */
export interface TeamTag {
  x: number;
  y: number;
  name: string;
  color: string;
  down: boolean;
  revive01: number;
  onScreen: boolean;
  dist?: number;
}

/** Minimap size in canvas pixels; each one is drawn as one UI pixel (--p). */
const MM = 48;
// Tiny sprites for the minimap: '#' = colour, 'w' = white, 'k' = ink. Each gets a 1px ink outline.
const MM_ME = ['###', '###', '###'];
const MM_X = ['#.#', '.#.', '#.#'];
const MM_SKULL = ['.###.', '#k#k#', '#####', '.#.#.'];
const MM_RING = ['.###.', '#...#', '#...#', '#...#', '.###.'];
const MM_DOT = ['##', '##'];

export const fmtScore = (n: number) => Math.floor(n).toLocaleString('en-US');
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Hud {
  private root: HTMLElement;
  private q: <T extends HTMLElement>(s: string) => T;
  private els: Record<string, HTMLElement> = {};
  private lastHp = -1;
  private lastLevel = -1;
  private lastMaxHp = -1;
  private trailHp = 1;
  private trailHold = 0;
  private shownGold = 0;
  private shownXp = 0;
  private xpSparkT = 0;
  private comboPop = 1;
  private comboShake = 0;
  private comboBreakT = 0;
  private shownScore = 0;
  private lastCombo = 0;
  private lastMult = 1;
  private bannerT = 0;
  private toastT = 0;
  private hurtV = 0;
  private flashV = 0;
  private lastText: Record<string, string> = {};

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="ingame">
         <div id="xpbar"><div class="fill"></div><i class="spark" aria-hidden="true"></i><div class="lv"></div></div>
         <div id="hp"><div class="bar"><div class="chunk"></div><div class="fill"></div></div><div class="num"></div></div>
         <div id="runinfo"><span class="kills"></span><span class="gold"></span><span class="gears"></span></div>
         <div id="timer"><div class="clock"></div><div class="stage"></div></div>
         <div id="spice"></div>
         <button id="pausebtn" title="Pause (Esc)" aria-label="Pause">II</button>
         <div id="bossbar" hidden><div class="name"></div><div class="bar"><div class="fill"></div><div class="ticks"></div></div><div class="ph"></div></div>
         <div id="toast"></div>
         <div id="chestreveal" hidden></div>
         <div id="score">0</div>
         <div id="combo"><div class="mult">x1</div><div class="num"></div><div class="cbar"><div></div></div></div>
         <div id="loadout"><div class="row weapons"></div><div class="row passives"></div></div>
         <div id="mods"></div>
         <div id="team"></div>
         <div id="ebars"></div>
         <div id="tags"></div>
         <canvas id="minimap" width="${MM}" height="${MM}" hidden></canvas>
         <div id="downed" hidden><div class="t">YOU'RE DOWN</div><div class="bar"></div><div class="s"></div><div class="h">A TEAMMATE MUST STAND NEXT TO YOU</div></div>
         <div id="meters">
           <div id="dashpip" class="pip"><span>DASH</span></div>
           <div id="bombpip" class="pip"><span>BOMB</span></div>
         </div>
         <div id="banner"><div class="t"></div><div class="s"></div></div>
         <div id="chestptr" hidden><i class="arrow"></i>${iconHtml('world_chest', '#ffcd75', '')}<span class="m"></span></div>
       </div>
       <div id="vignette"></div>
       <div id="flash"></div>
       <div id="fade"></div>`,
    );
    this.q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
    this.root = this.q('#ingame');
    const pause = this.q('#pausebtn');
    pause.addEventListener('mousedown', (e) => e.stopPropagation());
    pause.addEventListener('click', () => this.onPause?.());
  }

  /** Edge-of-screen pointer to the nearest closed chest (null hides it). */
  setChestPointer(p: { x: number; y: number; angle: number; dist: number } | null): void {
    const el = this.el('#chestptr');
    el.hidden = !p;
    if (!p) return;
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
    // Snap the arrow to 8 directions so it stays a clean pixel sprite.
    const snapped = Math.round(p.angle / 45) * 45;
    (el.querySelector('.arrow') as HTMLElement).style.transform = `rotate(${snapped}deg) translateX(30px)`;
    this.text('#chestptr .m', `${Math.round(p.dist)}m`);
  }

  /** Called when the on-screen pause button is clicked. */
  onPause: (() => void) | null = null;
  private lastGold = -1;

  private el(sel: string): HTMLElement {
    return (this.els[sel] ??= this.q(sel));
  }

  /** Set text only when it changed (avoids layout churn every frame). */
  private text(sel: string, v: string): void {
    if (this.lastText[sel] === v) return;
    this.lastText[sel] = v;
    this.el(sel).textContent = v;
  }

  setVisible(v: boolean): void {
    this.root.hidden = !v;
  }

  showBanner(title: string, sub = '', seconds = 1.6): void {
    const b = this.el('#banner');
    b.querySelector('.t')!.textContent = title;
    b.querySelector('.s')!.innerHTML = sub;
    restartClass(b, 'show');
    this.bannerT = seconds;
  }

  /** Small message under the timer (elite incoming, achievements, ...). */
  toast(msg: string, seconds = 2.2): void {
    const t = this.el('#toast');
    t.textContent = msg;
    restartClass(t, 'show');
    this.toastT = seconds;
  }

  private chest: { item: ChestItem; rarity: Rarity; steps: number[]; end: number; t: number; passed: number; landed: boolean } | null = null;

  /** Chest item reveal under the timer: the name rolls like a slot reel and lands on the item. Replaces any open one. */
  chestReveal(item: ChestItem): void {
    const rarity = item.rarity ?? 'common';
    const legend = rarity === 'legendary';
    const steps = reduceMotion() ? [] : reelSteps(legend ? 1.4 : 0.75, legend ? [0.08, 0.12, 0.18, 0.26, 0.36] : [0.08, 0.12, 0.18]);
    const el = this.el('#chestreveal');
    el.className = '';
    el.innerHTML =
      `<div class="icon">${iconHtml('world_chest', '#ffcd75', '')}</div><div class="body"><div class="lbl">TREASURE!</div>` +
      `<div class="reel"><div class="strip">${[item, ...decoys(steps.length, item.id)].map((d) => `<div>${d.name}</div>`).join('')}</div></div>` +
      `<div class="txt">${item.text}</div></div>`;
    el.hidden = true;
    void el.offsetWidth; // restart the pop-in
    el.hidden = false;
    this.chest = { item, rarity, steps, end: steps.reduce((a, b) => a + b, 0), t: 0, passed: 0, landed: false };
  }

  private updateChest(dt: number): void {
    const c = this.chest;
    if (!c) return;
    c.t += dt;
    const el = this.el('#chestreveal');
    if (!c.landed) {
      const { pos, passed } = reelAt(c.steps, c.t);
      el.querySelector<HTMLElement>('.strip')!.style.setProperty('--k', String(pos));
      if (passed > c.passed && passed < c.steps.length) sfx.reelTick();
      c.passed = passed;
      if (passed >= c.steps.length) {
        c.landed = true;
        el.classList.add('landed', `r-${c.rarity}`);
        el.querySelector('.icon')!.innerHTML = iconHtml(c.item.id, c.item.color, c.item.icon);
        sfx.reelLand(c.rarity);
        if (c.rarity === 'legendary') sfx.legendary();
      }
    }
    if (c.t > c.end + 1.9) el.classList.add('out');
    if (c.t > c.end + 2.2) {
      el.hidden = true;
      this.chest = null;
    }
  }

  hurt(): void {
    this.hurtV = 1;
  }

  flash(amount = 1): void {
    this.flashV = Math.max(this.flashV, amount * (access.reduceFlash ? 0.15 : 1));
  }

  setFade(v: number): void {
    this.el('#fade').style.opacity = String(v);
  }

  resetScore(): void {
    this.shownScore = 0;
    this.lastHp = -1;
    this.lastLevel = -1;
    this.lastMaxHp = -1;
    this.lastGold = -1;
    this.lastCombo = 0;
    this.lastMult = 1;
    this.comboBreakT = this.comboShake = this.xpSparkT = 0;
    this.comboPop = 1;
    this.text('#combo .mult', 'x1');
    this.el('#combo .mult').dataset.tier = '1';
    this.el('#combo').classList.remove('broken');
  }

  setLoadout(items: LoadoutItem[]): void {
    const html = (kind: LoadoutItem['kind']) =>
      items
        .filter((i) => i.kind === kind)
        .map(
          (i) =>
            `<div class="slot ${i.max ? 'max' : ''} ${i.evo ? 'evo' : ''} r-${i.rarity ?? 'common'} ${i.slot ? 's-' + i.slot : ''}" style="--c:${i.color}" title="${i.name}${i.slot ? ' (' + SLOT_LABEL[i.slot] + ')' : ''}">${iconHtml(i.id, i.color, i.icon)}<i>${i.evo ? 'EVO' : i.max ? 'MAX' : i.level}</i></div>`,
        )
        .join('');
    this.el('#loadout .weapons').innerHTML = html('weapon');
    this.el('#loadout .passives').innerHTML = html('passive');
  }

  private lastMods = '';
  private lastTeam = '';
  private tagEls: { el: HTMLElement; nm: HTMLElement; rv: HTMLElement; arrow: HTMLElement; label: string; rvPct: number; dir: number; color: string }[] = [];

  /**
   * Co-op: teammate life bars (top-left) and floating name tags. Off-screen
   * teammates get an edge pointer in their colour with name and distance; a
   * downed teammate's tag carries a revive progress bar.
   */
  setTeam(team: { name: string; color: string; hp01: number; down: boolean; left: boolean }[], tags: TeamTag[]): void {
    const html = team
      .map(
        (t) =>
          `<div class="mate ${t.down ? 'down' : ''} ${t.left ? 'left' : ''}" style="--c:${t.color}"><span class="nm">${t.name}${t.left ? ' (left)' : t.down ? ' DOWN' : ''}</span><div class="bar"><div style="width:${Math.round(t.hp01 * 100)}%"></div></div></div>`,
      )
      .join('');
    if (html !== this.lastTeam) {
      this.lastTeam = html;
      this.el('#team').innerHTML = html;
    }
    const root = this.el('#tags');
    while (this.tagEls.length < tags.length) {
      const el = document.createElement('div');
      el.className = 'tag';
      el.innerHTML = '<div class="rv"><span></span><div class="bar"></div></div><div class="nm"></div><i class="arrow"></i>';
      root.appendChild(el);
      this.tagEls.push({ el, nm: el.querySelector('.nm')!, rv: el.querySelector('.rv span')!, arrow: el.querySelector('.arrow')!, label: '', rvPct: -1, dir: 99, color: '' });
    }
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    this.tagEls.forEach((d, i) => {
      const t = tags[i];
      d.el.style.display = t ? '' : 'none';
      if (!t) return;
      if (d.color !== t.color) d.el.style.setProperty('--c', (d.color = t.color));
      const edge = !t.onScreen;
      if (edge) {
        // Pin to a rectangle inset from the screen edge, along the line from the centre (wider inset left/right for the name).
        const dx = t.x - cx;
        const dy = t.y - cy;
        const k = Math.min((cx - 90) / Math.abs(dx || 1e-6), (cy - 64) / Math.abs(dy || 1e-6));
        d.el.style.transform = `translate(${Math.round(cx + dx * k)}px, ${Math.round(cy + dy * k)}px) translate(-50%, -50%)`;
        // 8 directions keep the arrow a clean sprite; it sits on that side of the tag.
        const dir = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
        if (dir !== d.dir) {
          d.dir = dir;
          const a = (dir * Math.PI) / 4;
          d.arrow.style.cssText = `--ax:${Math.round(Math.cos(a))};--ay:${Math.round(Math.sin(a))};--ang:${dir * 45}deg`;
        }
      } else {
        d.el.style.transform = `translate(${Math.round(t.x)}px, ${Math.round(t.y)}px) translate(-50%, -100%)`;
      }
      d.el.classList.toggle('edge', edge);
      d.el.classList.toggle('down', t.down);
      const label = edge && t.dist !== undefined ? `${t.name} ${Math.round(t.dist)}m` : t.name;
      if (d.label !== label) d.nm.textContent = d.label = label;
      // Revive progress: whole percent, so the DOM only changes when it moves.
      const pct = t.down ? Math.floor(Math.max(0, Math.min(1, t.revive01)) * 100) : -1;
      if (pct !== d.rvPct) {
        d.rvPct = pct;
        d.el.style.setProperty('--rv', String(Math.max(0, pct) / 100));
        d.el.classList.toggle('rev', pct > 0);
        d.rv.textContent = pct > 0 ? `REVIVING ${pct}%` : 'REVIVE ME!';
      }
    });
  }

  private lastDowned = -2;

  /** Local player downed in co-op: centre panel with the revive progress (null hides it). */
  setDowned(state: { revive01: number } | null): void {
    const pct = state ? Math.floor(Math.max(0, Math.min(1, state.revive01)) * 100) : -1;
    if (pct === this.lastDowned) return;
    this.lastDowned = pct;
    const el = this.el('#downed');
    el.hidden = !state;
    if (!state) return;
    el.style.setProperty('--rv', String(pct / 100));
    el.classList.toggle('rev', pct > 0);
    this.text('#downed .s', pct > 0 ? `REVIVING ${pct}%` : 'WAITING FOR HELP');
  }

  private mmG: CanvasRenderingContext2D | null = null;
  private mmT = -1e9;

  /** Minimap of the arena (bottom-right, above the Mods). Call every frame; redraws at ~15 Hz. null hides it. */
  setMinimap(m: MinimapView | null): void {
    const cv = this.el('#minimap') as HTMLCanvasElement;
    if (cv.hidden !== !m) {
      cv.hidden = !m;
      this.mmT = -1e9;
    }
    const now = performance.now();
    if (!m || now - this.mmT < 66) return;
    this.mmT = now;
    const g = (this.mmG ??= cv.getContext('2d')!);
    const k = MM / (2 * m.half);
    const at = (v: number) => Math.max(0, Math.min(MM - 1, Math.floor((v + m.half) * k)));
    // Sprite centred on a world point: ink outline first, then the pixels.
    const put = (rows: string[], x: number, z: number, color: string) => {
      const ox = at(x) - (rows[0].length >> 1);
      const oy = at(z) - (rows.length >> 1);
      g.fillStyle = '#1a1c2c';
      rows.forEach((r, y) => [...r].forEach((c, x2) => c !== '.' && g.fillRect(ox + x2 - 1, oy + y - 1, 3, 3)));
      rows.forEach((r, y) =>
        [...r].forEach((c, x2) => {
          if (c === '.' || c === 'k') return;
          g.fillStyle = c === 'w' ? '#f4f4f4' : color;
          g.fillRect(ox + x2, oy + y, 1, 1);
        }),
      );
    };
    g.clearRect(0, 0, MM, MM);
    g.fillStyle = '#333c57';
    for (let i = 1; i < 4; i++) {
      g.fillRect((MM * i) / 4, 0, 1, MM);
      g.fillRect(0, (MM * i) / 4, MM, 1);
    }
    const blink = Math.floor(now / 250) % 2 === 0;
    for (const c of m.chests) put(MM_DOT, c.x, c.z, '#ffcd75');
    if (m.portal) put(MM_RING, m.portal.x, m.portal.z, blink ? '#73eff7' : '#41a6f6');
    for (const e of m.elites) put(MM_DOT, e.x, e.z, '#ef7d57');
    if (m.boss) put(MM_SKULL, m.boss.x, m.boss.z, '#b13e53');
    for (const t of m.mates) put(t.down ? MM_X : MM_ME, t.x, t.z, t.down ? (blink ? '#b13e53' : '#f4f4f4') : t.color);
    put(MM_ME, m.me.x, m.me.z, blink ? '#f4f4f4' : m.me.color);
  }

  private ebars: { el: HTMLElement; fill: HTMLElement; trail: HTMLElement; hp: number; hitT: number; shown: boolean }[] = [];

  /**
   * Floating health bars over elites. x/y are screen pixels of the bar's
   * bottom centre; call every frame (an empty list hides them all).
   */
  setEliteBars(bars: { x: number; y: number; hp01: number; onScreen: boolean }[]): void {
    const now = performance.now();
    while (this.ebars.length < bars.length) {
      const el = document.createElement('div');
      el.className = 'ebar';
      el.style.display = 'none';
      el.innerHTML = '<i></i><div class="bar"><b class="trail"></b><b class="fill"></b></div>';
      this.el('#ebars').appendChild(el);
      this.ebars.push({ el, fill: el.querySelector('.fill')!, trail: el.querySelector('.trail')!, hp: -1, hitT: -1e9, shown: false });
    }
    this.ebars.forEach((b, i) => {
      const t = bars[i];
      const show = !!t && t.onScreen;
      if (show !== b.shown) {
        b.shown = show;
        b.el.style.display = show ? '' : 'none';
      }
      if (!show) {
        b.hp = -1;
        return;
      }
      b.el.style.transform = `translate(${Math.round(t.x)}px, ${Math.round(t.y)}px) translate(-50%, -100%)`;
      // Whole UI pixels only (16 across the bar); any drop flashes and leaves a white trail.
      const hp = Math.ceil(Math.max(0, Math.min(1, t.hp01)) * 16) / 16;
      if (hp < b.hp) b.hitT = now;
      // Snap (no trail) when shown fresh, healed, or the slot moved to another elite.
      b.el.classList.toggle('snap', hp > b.hp);
      b.el.classList.toggle('hit', now - b.hitT < 90);
      if (hp !== b.hp) {
        b.hp = hp;
        b.fill.style.transform = b.trail.style.transform = `scaleX(${hp})`;
      }
    });
  }

  /** Owned Mods, bottom-right, with live readouts (only rebuilt when the markup changes). */
  setMods(mods: { id: string; icon: string; color: string; name: string; readout: string; cursed: boolean }[]): void {
    const html = mods
      .map(
        (m) =>
          `<div class="mod ${m.cursed ? 'cursed' : ''}" style="--c:${m.color}" title="${m.name}">${iconHtml(m.id, m.color, m.icon)}${m.readout ? `<i>${m.readout}</i>` : ''}</div>`,
      )
      .join('');
    if (html === this.lastMods) return;
    this.lastMods = html;
    this.el('#mods').innerHTML = html;
  }

  update(s: HudState, dt: number): void {
    const still = reduceMotion();
    // XP: snap on level changes, otherwise ease the fill and its pixel sparkle together.
    const xp = Math.max(0, Math.min(1, s.xp01));
    if (xp > this.shownXp + 0.001) this.xpSparkT = 0.25;
    else this.xpSparkT = Math.max(0, this.xpSparkT - dt);
    this.shownXp = still || s.level !== this.lastLevel ? xp : approachHud(this.shownXp, xp, hudTuning.xpSpeed, dt);
    this.el('#xpbar .fill').style.transform = `scaleX(${this.shownXp})`;
    this.el('#xpbar .spark').style.left = `${this.shownXp * 100}%`;
    this.el('#xpbar .spark').hidden = still || this.xpSparkT <= 0 || this.shownXp <= 0;
    if (s.level !== this.lastLevel) {
      this.text('#xpbar .lv', `LV ${s.level}`);
      if (this.lastLevel > 0) {
        const bar = this.el('#xpbar');
        restartClass(bar, 'up');
      }
      this.lastLevel = s.level;
    }

    // Life
    const hp01 = Math.max(0, Math.min(1, s.hp / Math.max(1, s.maxHp)));
    if (s.hp !== this.lastHp || s.maxHp !== this.lastMaxHp) {
      const k = hp01;
      if (this.lastHp < 0 || s.maxHp !== this.lastMaxHp || s.hp >= this.lastHp || still) this.trailHp = k;
      else this.trailHold = hudTuning.damageHold;
      const fill = this.el('#hp .fill');
      fill.style.width = `${k * 100}%`;
      fill.classList.toggle('low', k <= 0.3);
      this.text('#hp .num', `${Math.max(0, Math.ceil(s.hp))}/${Math.round(s.maxHp)}`);
      if (s.hp < this.lastHp - 0.5) {
        const bar = fill.parentElement!;
        restartClass(bar, 'hurt');
      }
      this.lastHp = s.hp;
      this.lastMaxHp = s.maxHp;
    }
    this.trailHold = Math.max(0, this.trailHold - dt);
    if (still) this.trailHp = hp01;
    else if (this.trailHold <= 0) this.trailHp = Math.max(hp01, this.trailHp - dt * hudTuning.damageCatchup);
    this.el('#hp .chunk').style.transform = `scaleX(${this.trailHp})`;
    this.el('#hp').classList.toggle('low', s.lowHp);
    this.text('#runinfo .kills', `☠ ${s.kills}`);
    this.shownGold = still || this.lastGold < 0 || s.gold < this.shownGold ? s.gold : approachHud(this.shownGold, s.gold, hudTuning.goldSpeed, dt);
    if (Math.abs(s.gold - this.shownGold) < 0.5) this.shownGold = s.gold;
    this.text('#runinfo .gold', `● ${Math.floor(this.shownGold)}`);
    this.text('#runinfo .gears', `⚙ ${s.gears}/${MAX_GEARS}`);
    if (s.gold !== this.lastGold) {
      if (s.gold > this.lastGold && this.lastGold >= 0) {
        const g = this.el('#runinfo .gold');
        restartClass(g, 'bump');
      }
      this.lastGold = s.gold;
    }

    // Timer / boss
    this.text('#timer .clock', s.timeLeft >= 0 ? fmtClock(s.timeLeft) : s.timeLeft === -1 ? 'BOSS!' : 'CLEAR!');
    this.el('#timer').classList.toggle('urgent', s.timeLeft >= 0 && s.timeLeft <= 10);
    this.text('#timer .stage', `STAGE ${s.stage}${s.metaLabel ? " · " + s.metaLabel : ""}`);
    const bb = this.el('#bossbar');
    bb.hidden = !s.boss;
    if (s.boss) {
      this.text('#bossbar .name', (s.boss.mini ? 'MINI-BOSS · ' : '') + s.boss.name.toUpperCase());
      this.el('#bossbar .fill').style.transform = `scaleX(${s.boss.hp01})`;
      // Phase ticks on the bar and pips for the phases reached.
      const ticks = (s.boss.ticks ?? []).map((t) => `<i style="left:${(t * 100).toFixed(1)}%"></i>`).join('');
      if (this.lastText['#bossbar .ticks'] !== ticks) {
        this.lastText['#bossbar .ticks'] = ticks;
        this.el('#bossbar .ticks').innerHTML = ticks;
      }
      const n = (s.boss.ticks?.length ?? 0) + 1;
      const ph = s.boss.phase ?? 1;
      this.text('#bossbar .ph', n > 1 ? `PHASE ${ph} / ${n}` : '');
      bb.classList.toggle('mini', !!s.boss.mini);
    }

    const spice = s.spice.map((l) => `<div class="${l.kind}">${l.text}</div>`).join('');
    if (this.lastText['#spice'] !== spice) {
      this.lastText['#spice'] = spice;
      this.el('#spice').innerHTML = spice;
    }

    // Score counts up quickly toward the real value.
    this.shownScore += (s.score - this.shownScore) * Math.min(1, dt * 12);
    if (Math.abs(s.score - this.shownScore) < 1) this.shownScore = s.score;
    this.text('#score', fmtScore(this.shownScore));

    // Combo: increment pops use local ages, with no forced layout reads in the kill hot path.
    const combo = this.el('#combo');
    this.comboPop += dt;
    this.comboShake = Math.max(0, this.comboShake - dt);
    this.comboBreakT = Math.max(0, this.comboBreakT - dt);
    if (s.combo !== this.lastCombo) {
      if (s.combo < this.lastCombo && this.lastCombo > 1) {
        this.comboBreakT = hudTuning.comboBreak;
        this.text('#combo .num', `${this.lastCombo} COMBO LOST`);
      }
      if (s.combo > 1) {
        this.comboBreakT = 0;
        this.text('#combo .num', `${s.combo} COMBO`);
        if (s.combo > this.lastCombo) {
          this.comboPop = 0;
          if (comboMilestone(this.lastCombo, s.combo)) this.comboShake = 0.3;
        }
        combo.dataset.heat = String(comboTier(s.combo));
      }
      this.lastCombo = s.combo;
    }
    combo.classList.toggle('on', s.combo > 1 || this.comboBreakT > 0);
    combo.classList.toggle('broken', this.comboBreakT > 0);
    if (this.comboBreakT <= 0 && s.multiplier !== this.lastMult) {
      this.text('#combo .mult', `x${s.multiplier}`);
      this.el('#combo .mult').dataset.tier = String(Math.min(s.multiplier, 8));
      this.lastMult = s.multiplier;
    }
    const pop = still ? 1 : 1 + Math.max(0, 1 - this.comboPop / 0.18) * 0.22;
    const shake = still ? 0 : this.comboShake > 0 ? Math.round(Math.sin(this.comboShake * 90) * this.comboShake * 14 * settings.shake) : 0;
    combo.style.transform = `translateX(${shake}px) scale(${pop})`;
    this.el('#combo .cbar div').style.transform = `scaleX(${s.combo01})`;

    // Meters
    const dash = this.el('#dashpip');
    dash.style.setProperty('--k', String(s.dash01));
    dash.classList.toggle('ready', s.dash01 >= 1);
    this.text('#dashpip span', s.dashMax > 1 ? `DASH ${s.dashStock}` : 'DASH');
    const bomb = this.el('#bombpip');
    bomb.style.setProperty('--k', String(s.bomb01));
    bomb.classList.toggle('ready', s.bomb01 >= 1);
    this.text('#bombpip span', s.special);

    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.el('#banner').classList.remove('show');
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.el('#toast').classList.remove('show');
    }
    this.updateChest(dt);

    // Vignette: hurt pulse plus a heartbeat when low on life.
    this.hurtV = Math.max(0, this.hurtV - dt * 2.5);
    const beat = s.lowHp ? still ? 0.16 : 0.25 + 0.2 * Math.max(0, Math.sin(performance.now() / 180)) : 0;
    this.el('#vignette').style.opacity = String(Math.max(this.hurtV, beat));
    this.flashV = Math.max(0, this.flashV - dt * 4);
    this.el('#flash').style.opacity = String(this.flashV);
  }
}
