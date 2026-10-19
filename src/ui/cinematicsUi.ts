import { localizeHtml, localize } from '../i18n';
/**
 * Cinematics lane overlays (plain DOM + small canvases, CSS injected here):
 * the sky-fall cloud layer, the painterly ending, the legendary reveal's
 * title card, the jackpot slot machine, the FLAWLESS! confetti and the
 * playable-title hint. The game (src/game/systems/cinematics.ts) owns the
 * clocks and calls these with the time; nothing here changes game state.
 */
import { iconHtml } from './pixelIcons';
import { prompt, refreshPrompts } from './prompts';
import { paintPanel, type EndingCast } from './painterly';
import { ENDING_PANELS, bulbLit, confettiAt, endingFrame, endingTuning, flawlessTuning, reelScroll, type RevealItem } from '../game/cinematics';

let cssDone = false;
function injectCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'cinematics-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** What the sky-fall layer draws this frame. */
export interface SkyView {
  /** 0..1 how thick the clouds are (1 = white-out). */
  cover: number;
  /** Seconds into the transition (drives the cloud stream). */
  t: number;
  /** 0..1 wind streak strength. */
  wind: number;
  /** The golden route: warm gold clouds. */
  gold: boolean;
}

/** A jackpot to show: reel symbols and what it paid. */
export interface JackpotView {
  /** The three symbols the reels land on: an icon id, its colour and glyph. */
  land: { icon: string; color: string; glyph: string }[];
  title: string;
  lines: string[];
  gold: number;
}

/** Decoy reel symbols: a lucky 7, a star, a clover, a crown, a chest, a gem. */
const SYMBOLS: { icon: string; color: string; glyph: string }[] = [
  { icon: 'cn_seven', color: '#b13e53', glyph: '7' },
  { icon: 'lucky_star', color: '#ffcd75', glyph: '★' },
  { icon: 'clover', color: '#38b764', glyph: '♣' },
  { icon: 'storm_crown', color: '#ffcd75', glyph: '♛' },
  { icon: 'route_treasure', color: '#ef7d57', glyph: '▣' },
  { icon: 'cn_gem', color: '#41a6f6', glyph: '♦' },
];
/** Strip length per reel; the landing symbol sits at index TARGET. */
const STRIP = 34;
const TARGET = 30;
const BULBS = 44;

export class CineUi {
  readonly root: HTMLElement;
  /** A key, click or tap went down (the game takes it each step). */
  private skipReq = false;
  private sky: HTMLCanvasElement;
  private skyCtx: CanvasRenderingContext2D | null;
  private end: HTMLElement;
  private endCanvas: HTMLCanvasElement[] = [];
  private endPainted: number[] = [-1, -1];
  private endCast: EndingCast | null = null;
  private endShort = false;
  private reveal: HTMLElement;
  private drop: HTMLElement;
  private jack: HTMLElement;
  private reels: HTMLElement[] = [];
  private bulbs: HTMLElement[] = [];
  private bulbState: boolean[] = [];
  private coinsEl: HTMLElement;
  private coins: { el: HTMLElement; x0: number; y0: number; x1: number; y1: number; d: number }[] = [];
  private jackLanded = [false, false, false];
  private flaw: HTMLElement;
  private flawCanvas: HTMLCanvasElement;
  private flawCtx: CanvasRenderingContext2D | null;
  private hint: HTMLElement;
  private hintState = '';
  private bars: HTMLElement;

  constructor(parent: HTMLElement) {
    injectCss();
    this.root = document.createElement('div');
    this.root.id = 'cine';
    this.root.innerHTML =
      localizeHtml(`<canvas class="cn-sky" width="320" height="180" hidden></canvas>` +
      `<div class="cn-bars" hidden><i></i><i></i></div>` +
      `<div class="cn-end" hidden><div class="cn-paint"><canvas></canvas><canvas></canvas></div><div class="cn-cap px"></div><div class="cn-title"><div class="t">THE END?</div><div class="s"></div><div class="c"></div></div><div class="cn-skip">SKIP ▸</div></div>` +
      `<div class="cn-reveal" hidden><div class="cn-card px"><div class="lbl"></div><div class="nm"></div><div class="tx"></div></div><div class="cn-skip">SKIP ▸</div></div>` +
      `<div class="cn-drop" hidden></div>` +
      `<div class="cn-jack" hidden><div class="cn-bulbs"></div><div class="cn-cab px"><div class="cn-marq">JACKPOT</div><div class="cn-reels"></div><div class="cn-pay"><div class="t"></div><div class="l"></div></div></div><div class="cn-coins"></div><div class="cn-skip">SKIP ▸</div></div>` +
      `<div class="cn-flaw" hidden><canvas width="320" height="180"></canvas><div class="cn-stamp"><div class="t">FLAWLESS!</div><div class="s"></div></div></div>` +
      `<div class="cn-tp" hidden></div>`);
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    this.sky = q<HTMLCanvasElement>('.cn-sky');
    this.skyCtx = this.sky.getContext('2d');
    this.bars = q('.cn-bars');
    this.end = q('.cn-end');
    this.endCanvas = Array.from(this.end.querySelectorAll('canvas'));
    this.reveal = q('.cn-reveal');
    this.drop = q('.cn-drop');
    this.jack = q('.cn-jack');
    this.coinsEl = q('.cn-coins');
    this.flaw = q('.cn-flaw');
    this.flawCanvas = this.flaw.querySelector('canvas')!;
    this.flawCtx = this.flawCanvas.getContext('2d');
    this.hint = q('.cn-tp');
    const reelsEl = q('.cn-reels');
    for (let i = 0; i < 3; i++) {
      const r = document.createElement('div');
      r.className = 'cn-reel';
      r.innerHTML = localizeHtml('<div class="strip"></div>');
      reelsEl.appendChild(r);
      this.reels.push(r.querySelector('.strip')!);
    }
    const bulbsEl = q('.cn-bulbs');
    for (let i = 0; i < BULBS; i++) {
      const b = document.createElement('i');
      const [x, y] = bulbPos(i, BULBS);
      b.style.left = `${x * 100}%`;
      b.style.top = `${y * 100}%`;
      bulbsEl.appendChild(b);
      this.bulbs.push(b);
      this.bulbState.push(false);
    }
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.skipReq = true;
    });
    window.addEventListener('pointerdown', () => (this.skipReq = true));
  }

  /** Did the player press anything since the last call? */
  takeSkip(): boolean {
    const s = this.skipReq;
    this.skipReq = false;
    return s;
  }

  /** Something blocking is on screen: clicks go to it, not the menus underneath. */
  setBlocking(on: boolean): void {
    this.root.classList.toggle('block', on);
  }

  letterbox(on: boolean): void {
    if (this.bars.hidden === !on) return;
    this.bars.hidden = !on;
  }

  // ---------------------------------------------------------------- sky fall

  skyfall(v: SkyView | null): void {
    this.sky.hidden = !v;
    if (!v || !this.skyCtx) return;
    const ctx = this.skyCtx;
    ctx.imageSmoothingEnabled = false;
    const W = 320;
    const H = 180;
    ctx.clearRect(0, 0, W, H);
    const light = v.gold ? '#ffcd75' : '#f4f4f4';
    const mid = v.gold ? '#ef7d57' : '#94b0c2';
    const dark = v.gold ? '#b13e53' : '#566c86';
    // White-out at the cut.
    const out = Math.max(0, Math.min(1, (v.cover - 0.75) / 0.25));
    if (out > 0) {
      ctx.globalAlpha = out;
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, W, H);
    }
    // Puffs stream toward the camera from the middle of the screen.
    const n = 46;
    for (let i = 0; i < n; i++) {
      const h1 = frac(Math.sin(i * 91.17) * 4375.5);
      const h2 = frac(Math.sin(i * 47.31) * 9127.1);
      if (h1 >= v.cover * 1.25) continue;
      const z = 1 - frac(v.t * 0.9 + h2);
      if (z < 0.06) continue;
      const a = h1 * Math.PI * 2 * 7.3;
      const r0 = 0.5 + h2 * 0.5;
      const x = W / 2 + (Math.cos(a) * r0 * W * 0.5) / (z * 1.6);
      const y = H / 2 + (Math.sin(a) * r0 * H * 0.6) / (z * 1.6);
      const s = (12 + h1 * 20) / z;
      if (s > 420) continue;
      // Keep the falling hero in the clear: far puffs never sit over the middle of the screen (the white-out does).
      if (v.cover < 0.95 && z > 0.3 && Math.hypot((x - W / 2) / W, (y - H / 2) / H) < 0.2) continue;
      // Far puffs fade in; near ones stay solid until they're past the camera.
      ctx.globalAlpha = Math.min(1, (1 - z) * 4);
      const spr = puffSprite(v.gold, light, mid, dark);
      ctx.drawImage(spr, Math.round(x - s), Math.round(y - s * 0.62), Math.round(s * 2), Math.round(s * 1.25));
    }
    // Wind streaks racing out to the edges.
    if (v.wind > 0) {
      ctx.globalAlpha = 0.55 * v.wind;
      ctx.fillStyle = light;
      for (let i = 0; i < 28; i++) {
        const a = frac(Math.sin(i * 13.7) * 999.1) * Math.PI * 2;
        const k = frac(v.t * 2.6 + frac(Math.sin(i * 7.1) * 311.7));
        const r = 30 + k * 190;
        const len = 8 + k * 30;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        for (let d = 0; d < len; d += 1.5) ctx.fillRect(Math.round(W / 2 + ca * (r + d)), Math.round(H / 2 + sa * (r + d) * 0.6), 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- ending

  endingStart(cast: EndingCast, short: boolean): void {
    this.endCast = cast;
    this.endShort = short;
    this.endPainted = [-1, -1];
    this.end.hidden = false;
    this.end.classList.remove('card');
    this.end.querySelector('.cn-title .s')!.textContent = localize(`LOOP ${cast.loop + 1} BEGINS · EVERYTHING HITS HARDER`);
    this.end.querySelector('.cn-title .c')!.textContent = localize(`INFINISHOOT · THANKS FOR PLAYING · v${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''}`);
    this.ensurePanel(0, 0);
  }

  /** Paint panel i into canvas slot (i % 2) if it isn't there yet. */
  private ensurePanel(i: number, slot: number): void {
    if (!this.endCast || i >= ENDING_PANELS.length || this.endPainted[slot] === i) return;
    paintPanel(this.endCanvas[slot], i, this.endCast);
    this.endPainted[slot] = i;
  }

  endingDraw(t: number): void {
    if (this.end.hidden) return;
    const f = endingFrame(t, this.endShort);
    const slot = f.panel % 2;
    this.ensurePanel(f.panel, slot);
    // Paint the next panel early (one panel per frame at most), so the cross-fade never waits.
    if (f.k > 0.15) this.ensurePanel(f.panel + 1, 1 - slot);
    const cur = this.endCanvas[slot];
    const next = this.endCanvas[1 - slot];
    const z = 1 + endingTuning.zoom * f.k;
    const pan = (f.panel % 2 ? -1 : 1) * f.k * 1.5;
    cur.style.opacity = String(1 - f.fade);
    cur.style.transform = `scale(${z.toFixed(4)}) translateX(${pan.toFixed(2)}%)`;
    cur.style.zIndex = '1';
    next.style.opacity = String(f.fade);
    next.style.transform = 'scale(1)';
    next.style.zIndex = '0';
    const panel = ENDING_PANELS[f.panel];
    const cap = this.end.querySelector<HTMLElement>('.cn-cap')!;
    const show = panel.caption && f.k > 0.08 && f.fade < 0.6;
    if (cap.textContent !== panel.caption) cap.textContent = localize(panel.caption);
    cap.classList.toggle('on', !!show);
    this.end.classList.toggle('card', panel.id === 'end' && f.k > 0.05);
  }

  endingStop(): void {
    this.end.hidden = true;
    this.endCast = null;
  }

  // ---------------------------------------------------------------- legendary reveal

  revealShow(item: RevealItem, k: number, land: number, drop: { x: number; y: number } | null, short: boolean): void {
    this.reveal.hidden = false;
    const card = this.reveal.querySelector<HTMLElement>('.cn-card')!;
    if (card.dataset.key !== item.key) {
      card.dataset.key = item.key;
      card.querySelector('.lbl')!.textContent = localize(item.label);
      const nm = card.querySelector<HTMLElement>('.nm')!;
      nm.textContent = localize(item.name.toUpperCase());
      nm.style.color = item.color;
      card.querySelector('.tx')!.textContent = localize(item.text);
      this.drop.innerHTML = localizeHtml(iconHtml(item.icon, item.color, item.glyph));
      this.drop.style.setProperty('--c', item.color);
    }
    card.classList.toggle('on', k >= land);
    this.reveal.classList.toggle('short', short);
    this.drop.hidden = !drop || k >= land + 0.05;
    if (drop) this.drop.style.transform = `translate(${Math.round(drop.x)}px, ${Math.round(drop.y)}px)`;
  }

  revealHide(): void {
    this.reveal.hidden = true;
    this.drop.hidden = true;
    const card = this.reveal.querySelector<HTMLElement>('.cn-card')!;
    card.dataset.key = '';
    card.classList.remove('on');
  }

  // ---------------------------------------------------------------- jackpot

  jackpotStart(v: JackpotView, goldTarget: { x: number; y: number } | null): void {
    this.jack.hidden = false;
    this.jack.classList.remove('win');
    this.jackLanded = [false, false, false];
    this.reels.forEach((strip, i) => {
      const cells: string[] = [];
      for (let k = 0; k < STRIP; k++) {
        const s = k === TARGET ? v.land[i] : SYMBOLS[(k * 7 + i * 3) % SYMBOLS.length];
        cells.push(`<div class="cell">${symbolHtml(s)}</div>`);
      }
      strip.innerHTML = localizeHtml(cells.join(''));
    });
    this.jack.querySelector('.cn-pay .t')!.textContent = localize(v.title);
    this.jack.querySelector('.cn-pay .l')!.innerHTML = localizeHtml(v.lines.map((l) => `<div>${l}</div>`).join(''));
    // Coins for a gold pile: from the reels to the HUD gold counter.
    this.coinsEl.innerHTML = '';
    this.coins = [];
    if (v.gold > 0) {
      const w = innerWidth;
      const h = innerHeight;
      const to = goldTarget ?? { x: 40, y: 40 };
      for (let i = 0; i < 34; i++) {
        const el = document.createElement('i');
        this.coinsEl.appendChild(el);
        this.coins.push({ el, x0: w / 2 + (frac(Math.sin(i * 3.1) * 77.7) - 0.5) * 260, y0: h * 0.5 + (frac(Math.sin(i * 5.3) * 31.3) - 0.5) * 80, x1: to.x, y1: to.y, d: i * 0.025 });
      }
    }
  }

  /** t: seconds in; stops: when each reel lands; returns the reels that just landed (for sounds). */
  jackpotDraw(t: number, stops: [number, number, number], len: number): { landed: number[]; ticks: boolean } {
    const landed: number[] = [];
    let ticks = false;
    if (this.jack.hidden) return { landed, ticks };
    const cell = this.reels[0].parentElement?.clientHeight ? this.reels[0].parentElement!.clientHeight / 3 : 72;
    this.reels.forEach((strip, i) => {
      const pos = reelScroll(t, stops[i], TARGET);
      // Centre row: symbol `pos` sits in the middle of the 3-row window.
      strip.style.transform = `translateY(${(-(pos - 1) * cell).toFixed(1)}px)`;
      if (t >= stops[i] && !this.jackLanded[i]) {
        this.jackLanded[i] = true;
        landed.push(i);
      }
      if (t < stops[i] && Math.floor(pos * 2) !== Math.floor(reelScroll(Math.max(0, t - 1 / 60), stops[i], TARGET) * 2)) ticks = true;
    });
    const win = t >= stops[2];
    this.jack.classList.toggle('win', win);
    for (let i = 0; i < BULBS; i++) {
      const on = bulbLit(i, BULBS, t, win);
      if (on !== this.bulbState[i]) {
        this.bulbState[i] = on;
        this.bulbs[i].classList.toggle('on', on);
      }
    }
    // Coins fly once the last reel lands.
    for (const c of this.coins) {
      const k = Math.max(0, Math.min(1, (t - stops[2] - 0.15 - c.d) / 0.55));
      const e = k * k;
      const x = c.x0 + (c.x1 - c.x0) * e;
      const y = c.y0 + (c.y1 - c.y0) * e - Math.sin(k * Math.PI) * 120;
      c.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      c.el.style.opacity = k <= 0 || k >= 1 ? '0' : '1';
    }
    this.jack.classList.toggle('out', t > len - 0.25);
    return { landed, ticks };
  }

  jackpotStop(): void {
    this.jack.hidden = true;
    this.coinsEl.innerHTML = '';
    this.coins = [];
  }

  // ---------------------------------------------------------------- flawless

  flawlessStart(sub: string): void {
    this.flaw.hidden = false;
    this.flaw.querySelector('.cn-stamp .s')!.textContent = localize(sub);
    const st = this.flaw.querySelector<HTMLElement>('.cn-stamp')!;
    st.classList.remove('go');
    void st.offsetWidth;
    st.classList.add('go');
  }

  flawlessDraw(t: number, calm: boolean): void {
    if (this.flaw.hidden || !this.flawCtx) return;
    const ctx = this.flawCtx;
    ctx.clearRect(0, 0, 320, 180);
    const colors = ['#ffcd75', '#b13e53', '#73eff7', '#a7f070', '#41a6f6', '#f4f4f4'];
    const n = calm ? 50 : flawlessTuning.confetti;
    for (let i = 0; i < n; i++) {
      const c = confettiAt(i, t);
      if (c.y > 1.05 || c.x < -0.05 || c.x > 1.05) continue;
      ctx.fillStyle = colors[c.hue];
      const wide = Math.abs(Math.cos(c.spin)) > 0.5;
      ctx.fillRect(Math.round(c.x * 320), Math.round(c.y * 180), wide ? 3 : 1, wide ? 1 : 3);
    }
    this.flaw.classList.toggle('out', t > flawlessTuning.time - 0.4);
  }

  flawlessStop(): void {
    this.flaw.hidden = true;
  }

  // ---------------------------------------------------------------- playable title

  /** 'idle' shows how to take the hero, 'playing' that it's yours; '' hides it. */
  titleHint(state: '' | 'idle' | 'playing'): void {
    if (state === this.hintState) return;
    this.hintState = state;
    this.hint.hidden = !state;
    if (!state) return;
    this.hint.classList.toggle('on', state === 'playing');
    this.hint.innerHTML =
      localizeHtml(state === 'idle'
        ? `${prompt('move')} TAKE THE HERO`
        : `YOU'RE PLAYING · NOTHING IS SAVED · MENU: ↑↓ ${prompt('confirm')}`);
    refreshPrompts(this.hint);
  }

  /** Hide everything (new run, title). */
  reset(): void {
    this.skyfall(null);
    this.endingStop();
    this.revealHide();
    this.jackpotStop();
    this.flawlessStop();
    this.letterbox(false);
    this.setBlocking(false);
  }
}

function frac(v: number): number {
  return v - Math.floor(v);
}

const sprites: Record<string, HTMLCanvasElement> = {};

/** One chunky cloud puff (32x20 pixels, pixel circles lit from the top), drawn once per palette and scaled up crisp. */
function puffSprite(gold: boolean, light: string, mid: string, dark: string): HTMLCanvasElement {
  const key = gold ? 'gold' : 'white';
  const have = sprites[key];
  if (have) return have;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 20;
  const ctx = c.getContext('2d');
  sprites[key] = c;
  if (!ctx) return c;
  const disc = (cx: number, cy: number, r: number, col: string) => {
    ctx.fillStyle = col;
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.round(Math.sqrt(r * r - dy * dy));
      ctx.fillRect(cx - w, cy + dy, w * 2, 1);
    }
  };
  disc(16, 12, 7, dark);
  disc(8, 12, 6, dark);
  disc(24, 12, 6, dark);
  disc(9, 10, 6, mid);
  disc(23, 10, 6, mid);
  disc(16, 9, 7, mid);
  disc(14, 7, 5, light);
  disc(21, 8, 4, light);
  disc(8, 9, 3, light);
  return c;
}

/** Bulb i of n around the screen edge (fractions of the screen). */
function bulbPos(i: number, n: number): [number, number] {
  const k = (i / n) * 4;
  const side = Math.floor(k);
  const f = k - side;
  const m = 0.02;
  if (side === 0) return [m + f * (1 - 2 * m), m];
  if (side === 1) return [1 - m, m + f * (1 - 2 * m)];
  if (side === 2) return [1 - m - f * (1 - 2 * m), 1 - m];
  return [m, 1 - m - f * (1 - 2 * m)];
}

function symbolHtml(s: { icon: string; color: string; glyph: string }): string {
  if (s.icon === 'cn_coin') return '<span class="coin"></span>';
  return iconHtml(s.icon, s.color, s.glyph, 'px-icon cn-sym');
}

declare const __APP_VERSION__: string;

const CSS = `
#cine { position: absolute; inset: 0; pointer-events: none; z-index: 12; }
#cine.block { pointer-events: auto; }
#cine [hidden] { display: none !important; }
#cine .cn-skip { position: absolute; right: calc(6 * var(--p)); bottom: calc(5 * var(--p)); font: 16px var(--label); color: var(--white); text-shadow: var(--outline); animation: cn-blink 1s steps(2) infinite; }
@keyframes cn-blink { 50% { opacity: 0.35; } }
body.cn-cine #ingame, body.cn-cine #reticle { visibility: hidden !important; }

/* Sky fall: a low-res canvas, upscaled crisp. */
#cine .cn-sky { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; }

/* Letterbox bars. */
#cine .cn-bars i { position: absolute; left: 0; right: 0; height: 9vh; background: var(--ink); animation: cn-bar 0.24s steps(4) both; }
#cine .cn-bars i:first-child { top: 0; }
#cine .cn-bars i:last-child { bottom: 0; }
@keyframes cn-bar { from { height: 0; } }

/* Painterly ending. */
#cine .cn-end { position: absolute; inset: 0; background: var(--ink); display: flex; align-items: center; justify-content: center; }
#cine .cn-paint { position: relative; z-index: 0; isolation: isolate; width: min(100vw, 177.7vh); height: min(56.25vw, 100vh); overflow: hidden; }
#cine .cn-paint canvas { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: auto; transform-origin: 50% 50%; }
#cine .cn-cap { position: absolute; z-index: 3; left: 50%; bottom: calc(10 * var(--p)); transform: translateX(-50%); padding: calc(2 * var(--p)) calc(5 * var(--p)); font: 30px var(--font); color: var(--yellow); letter-spacing: 1px; white-space: nowrap; opacity: 0; transition: opacity 0.4s steps(4); }
#cine .cn-cap.on { opacity: 1; }
#cine .cn-title { position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(3 * var(--p)); opacity: 0; pointer-events: none; }
#cine .cn-end.card .cn-title { opacity: 1; animation: cn-pop 0.5s steps(5) both; }
#cine .cn-end.card .cn-cap { opacity: 0; }
#cine .cn-title .t { font: 120px var(--display); color: var(--white); text-shadow: var(--outline), 0 calc(2 * var(--p)) 0 var(--plum); letter-spacing: 4px; }
#cine .cn-title .s { font: 28px var(--font); color: var(--yellow); text-shadow: var(--outline); }
#cine .cn-title .c { font: 14px var(--label); color: var(--white); text-shadow: var(--outline); opacity: 0.85; margin-top: calc(6 * var(--p)); }
@keyframes cn-pop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }

/* Legendary reveal: title card under the hero. */
#cine .cn-reveal { position: absolute; inset: 0; }
#cine .cn-card { --bg: var(--ink); --hi: var(--plum); --lo: #000; --ring: var(--yellow); position: absolute; left: 50%; top: 68%; transform: translate(-50%, 0) scale(0.2); padding: calc(3 * var(--p)) calc(8 * var(--p)); text-align: center; opacity: 0; transition: transform 0.25s steps(5), opacity 0.2s steps(3); }
#cine .cn-card.on { transform: translate(-50%, 0) scale(1); opacity: 1; }
#cine .cn-card .lbl { font: 16px var(--label); color: var(--yellow); letter-spacing: 2px; }
#cine .cn-card .nm { font: 56px var(--display); text-shadow: var(--outline); line-height: 1; margin: calc(var(--p)) 0; }
#cine .cn-card .tx { font: 20px var(--font); color: var(--white); max-width: 36em; }
#cine .cn-drop { position: absolute; left: 0; top: 0; margin: -36px 0 0 -36px; filter: drop-shadow(0 0 0 var(--c, #fff)); }
#cine .cn-drop .px-icon { width: 72px; height: 72px; image-rendering: pixelated; animation: cn-spin 0.5s steps(4) infinite; }
@keyframes cn-spin { 50% { transform: scaleX(0.6); } }

/* Jackpot slot machine. */
#cine .cn-jack { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background-color: rgba(26, 28, 44, 0.6); background-image: repeating-conic-gradient(rgba(26, 28, 44, 0.45) 0 25%, transparent 0 50%); background-size: calc(2 * var(--p)) calc(2 * var(--p)); animation: cn-in 0.2s steps(3) both; }
#cine .cn-jack.out { opacity: 0; transition: opacity 0.25s steps(3); }
@keyframes cn-in { from { opacity: 0; } }
#cine .cn-bulbs i { position: absolute; width: calc(4 * var(--p)); height: calc(4 * var(--p)); margin: calc(-2 * var(--p)) 0 0 calc(-2 * var(--p)); background: var(--plum); box-shadow: 0 0 0 var(--p) var(--ink); }
#cine .cn-bulbs i.on { background: var(--yellow); box-shadow: 0 0 0 var(--p) var(--ink), 0 0 0 calc(2 * var(--p)) var(--orange); }
#cine .cn-jack.win .cn-bulbs i.on { background: var(--white); }
#cine .cn-cab { --bg: var(--red); --hi: var(--orange); --lo: var(--plum); --ring: var(--yellow); padding: calc(4 * var(--p)) calc(6 * var(--p)) calc(5 * var(--p)); display: flex; flex-direction: column; align-items: center; gap: calc(3 * var(--p)); }
#cine .cn-marq { font: 64px var(--display); color: var(--yellow); text-shadow: var(--outline), 0 calc(var(--p)) 0 var(--plum); letter-spacing: 6px; line-height: 1; }
#cine .cn-jack.win .cn-marq { animation: cn-flash 0.25s steps(2) infinite; }
@keyframes cn-flash { 50% { color: var(--white); } }
#cine .cn-reels { display: flex; gap: calc(3 * var(--p)); }
#cine .cn-reel { --bg: var(--white); --hi: #fff; --lo: var(--mist); position: relative; width: 112px; height: 240px; overflow: hidden; background: var(--white); box-shadow: inset 0 0 0 var(--p) var(--ink), 0 0 0 var(--p) var(--ink), 0 0 0 calc(2 * var(--p)) var(--yellow); }
#cine .cn-reel::after { content: ''; position: absolute; left: 0; right: 0; top: 33.3%; height: 33.3%; box-shadow: inset 0 var(--p) 0 var(--red), inset 0 calc(-1 * var(--p)) 0 var(--red); pointer-events: none; }
#cine .cn-reel .strip { position: absolute; left: 0; right: 0; top: 0; }
#cine .cn-reel .cell { height: 80px; display: flex; align-items: center; justify-content: center; }
#cine .cn-reel .cn-sym, #cine .cn-reel .coin { width: 72px; height: 72px; image-rendering: pixelated; }
#cine .cn-reel .glyph { font: 72px var(--display); color: var(--red); text-shadow: var(--outline); }
#cine .cn-reel .coin { display: block; background: var(--coin) center / contain no-repeat; }
#cine .cn-pay { text-align: center; min-height: 64px; opacity: 0; }
#cine .cn-jack.win .cn-pay { opacity: 1; animation: cn-pop 0.35s steps(4) both; }
#cine .cn-pay .t { font: 40px var(--display); color: var(--white); text-shadow: var(--outline); }
#cine .cn-pay .l { font: 20px var(--font); color: var(--yellow); text-shadow: var(--outline); }
#cine .cn-coins i { position: absolute; left: 0; top: 0; width: 24px; height: 24px; margin: -12px 0 0 -12px; background: var(--coin) center / contain no-repeat; image-rendering: pixelated; opacity: 0; }

/* FLAWLESS! confetti and stamp. */
#cine .cn-flaw { position: absolute; inset: 0; }
#cine .cn-flaw.out { opacity: 0; transition: opacity 0.4s steps(4); }
#cine .cn-flaw canvas { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; }
#cine .cn-stamp { position: absolute; left: 50%; top: 70%; transform: translate(-50%, -50%) rotate(-6deg); text-align: center; }
#cine .cn-stamp.go { animation: cn-stamp 0.45s steps(5) both; }
@keyframes cn-stamp { 0% { transform: translate(-50%, -50%) rotate(-6deg) scale(3); opacity: 0; } 60% { transform: translate(-50%, -50%) rotate(-6deg) scale(0.92); opacity: 1; } 100% { transform: translate(-50%, -50%) rotate(-6deg) scale(1); } }
#cine .cn-stamp .t { font: 96px var(--display); color: var(--yellow); text-shadow: var(--outline), 0 calc(2 * var(--p)) 0 var(--orange), 0 calc(3 * var(--p)) 0 var(--ink); letter-spacing: 4px; line-height: 1; }
#cine .cn-stamp .s { font: 22px var(--font); color: var(--white); text-shadow: var(--outline); }

/* Playable title hint (bottom right, under the demo hero). */
#cine .cn-tp { position: absolute; right: calc(6 * var(--p)); bottom: calc(14 * var(--p)); font: 14px var(--label); color: var(--white); text-shadow: var(--outline); opacity: 0.8; }
#cine .cn-tp.on { color: var(--yellow); opacity: 1; }
#cine .cn-tp kbd { font: inherit; }

.reduce-flash #cine .cn-skip, .reduce-flash #cine .cn-jack.win .cn-marq, .reduce-flash #cine .cn-drop .px-icon { animation: none !important; }
.reduce-flash #cine .cn-stamp.go { animation-duration: 0.01s; }
`;
