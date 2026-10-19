/**
 * Boss finishers: the killing blow on a stage boss (and Omega) freezes the
 * frame, the screen splits into two comic panels over ink bursts and focus
 * lines (the hero striking on the left, the boss reeling on the right), a
 * big K.O. title slams in, then the panels clear and the normal boss death
 * (explosion chain, kill-cam, victory) plays.
 *
 * The overlay is local presentation drawn into a low-res canvas (one canvas
 * pixel = several screen pixels, palette colours only, no smoothing) plus a
 * DOM title. The host starts it with a team-wide effects event and holds the
 * boss's death until it ends (src/game/systems/characters.ts), so every
 * machine sees the same beat. Any key, click or pad button skips it.
 * Reduce flashes / reduced motion: no white flash, no shake or slams, a
 * shorter calm version.
 */
import { PORTRAIT, portraitCanvas, type Expression, type PortraitLook } from '../ui/portraitArt';

export const finisherTuning = {
  /** Total length (s), and the calm (reduced motion) version. */
  length: 2.1,
  calmLength: 1.5,
  /** Freeze-frame before the panels. */
  freeze: 0.14,
  /** Panels slam in over this long. */
  panelIn: 0.2,
  /** When the hit lands. */
  strike: 0.36,
  /** When the K.O. title slams in. */
  title: 0.5,
  /** Exit wipe at the end. */
  out: 0.3,
  /** Presses before this are ignored (the killing click may still be held). */
  minSkip: 0.3,
  /** Screen shake on the hit (canvas pixels, scaled by the shake setting). */
  shake: 3,
};

export interface FinisherFrame {
  /** 0..1 dim of the frozen world (freeze-frame). */
  freeze: number;
  /** 0..1 panels in (stepped), then 1 until the exit. */
  panel: number;
  /** Seconds since the hit landed (-1 before). */
  sinceHit: number;
  title: boolean;
  /** 0..1 exit wipe. */
  out: number;
  done: boolean;
}

export function finisherLength(calm: boolean): number {
  return calm ? finisherTuning.calmLength : finisherTuning.length;
}

/** Where the finisher is at time `t` (calm = reduced motion: no slams, panels appear at once). */
export function finisherFrame(t: number, calm: boolean, out: FinisherFrame = { freeze: 0, panel: 0, sinceHit: -1, title: false, out: 0, done: false }): FinisherFrame {
  const T = finisherTuning;
  const len = finisherLength(calm);
  const k = (v: number) => Math.max(0, Math.min(1, v));
  const steps = (v: number, n: number) => (calm ? (v > 0 ? 1 : 0) : Math.ceil(k(v) * n) / n);
  const freeze = calm ? 0.06 : T.freeze;
  const strike = calm ? 0.2 : T.strike;
  out.freeze = k(t / Math.max(0.01, freeze));
  out.panel = t < freeze ? 0 : steps((t - freeze) / T.panelIn, 4);
  out.sinceHit = t >= strike ? t - strike : -1;
  out.title = t >= (calm ? 0.3 : T.title) && t < len - T.out * 0.5;
  out.out = t <= len - T.out ? 0 : steps((t - (len - T.out)) / T.out, 3);
  out.done = t >= len;
  return out;
}

/** Spiky ink-burst radius around a centre: `spikes` points, `r` base, `amp` spike depth (0..1), turned by `rot`. */
export function burstRadius(angle: number, spikes: number, r: number, amp: number, rot = 0): number {
  const u = ((angle + rot) / (Math.PI * 2)) * spikes;
  const f = u - Math.floor(u);
  const tri = 1 - Math.abs(f * 2 - 1); // 0 at the notches, 1 at the tips
  return r * (1 - amp + amp * tri * 2);
}

/** The panel seam's x at row y (canvas pixels): a diagonal leaning left toward the bottom. */
export function seamX(y: number, w: number, h: number): number {
  return w * (0.57 - 0.14 * (y / Math.max(1, h)));
}

/**
 * Manga focus lines: is the pixel at angle `a`, distance `r` on a line?
 * `bins` lines round the circle (about half drawn), each starting somewhere
 * between `minR` and `minR + spanR` and widening outward. `seed` reshuffles.
 */
export function focusLine(a: number, r: number, bins: number, minR: number, spanR: number, seed: number): boolean {
  const u = ((a + Math.PI) / (Math.PI * 2)) * bins;
  const b = Math.floor(u);
  if (hash01(b * 7 + seed * 131) < 0.45) return false;
  const start = minR + hash01(b + seed * 13) * spanR;
  if (r < start) return false;
  return u - b < 0.18 + 0.45 * Math.min(1, (r - start) / (spanR + 8));
}

/** Small stable hash 0..1 for focus-line bins. */
export function hash01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export interface FinisherCast {
  hero: PortraitLook;
  heroName: string;
  heroColor: string;
  boss: PortraitLook;
  bossName: string;
  bossColor: string;
  bossAccent: string;
  /** The final boss: FINAL K.O. */
  omega: boolean;
  /** Boss position on screen (0..1), for the freeze-frame focus lines. */
  focus: { x: number; y: number } | null;
  calm: boolean;
  flashes: boolean;
  /** Shake setting multiplier (0 = off). */
  shake: number;
}

// ---------------------------------------------------------------- colours

const hexInt = (h: string): number => parseInt(h.slice(1, 7), 16) || 0;
function mix(a: number, b: number, t: number): number {
  const m = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
/** 0xRRGGBB -> little-endian ABGR for a Uint32Array over ImageData. */
const abgr = (c: number, a = 255) => ((a << 24) | ((c & 255) << 16) | (c & 0xff00) | ((c >> 16) & 255)) >>> 0;
const INK = 0x1a1c2c;
const WHITE = 0xf4f4f4;
const YELLOW = 0xffcd75;

/** Pixel tables shared between finishers (rebuilt on resize). */
interface Tables {
  w: number;
  h: number;
  /** Angle and distance from the hero burst centre and the boss burst centre. */
  ha: Float32Array;
  hr: Float32Array;
  ba: Float32Array;
  br: Float32Array;
  /** Angle and distance from the freeze-frame focus. */
  fa: Float32Array;
  fr: Float32Array;
}

/** The overlay: canvas panels plus the DOM title and captions. */
export class FinisherView {
  /** Seconds in (-1 = not playing). */
  t = -1;
  /** The local player skipped. */
  onSkip: (() => void) | null = null;
  /** Fired once at the hit and at the whoosh (sounds are played by the caller). */
  onCue: ((cue: 'whoosh' | 'hit') => void) | null = null;
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private title: HTMLElement;
  private capL: HTMLElement;
  private capR: HTMLElement;
  private img: ImageData | null = null;
  private buf: Uint32Array | null = null;
  private tables: Tables | null = null;
  private cast: FinisherCast | null = null;
  private frame: FinisherFrame = finisherFrame(0, false);
  private px = 4;
  private cues = 0;
  private padDown = false;
  private flashSil: HTMLCanvasElement | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'finisher';
    this.root.hidden = true;
    this.root.innerHTML = `<canvas></canvas><div class="fin-cap l"></div><div class="fin-cap r"></div><div class="fin-title"><div class="t"></div><div class="s"></div></div><div class="fin-skip">SKIP ▸</div>`;
    parent.appendChild(this.root);
    this.canvas = this.root.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d');
    this.title = this.root.querySelector('.fin-title')!;
    this.capL = this.root.querySelector('.fin-cap.l')!;
    this.capR = this.root.querySelector('.fin-cap.r')!;
    injectCss();
    const skip = (ev: Event) => {
      if (this.t < finisherTuning.minSkip) return;
      if (ev instanceof KeyboardEvent && (ev.code === 'Escape' || ev.repeat)) return;
      this.skip();
    };
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
  }

  get active(): boolean {
    return this.t >= 0;
  }

  get length(): number {
    return this.cast ? finisherLength(this.cast.calm) : finisherTuning.length;
  }

  start(cast: FinisherCast): void {
    this.cast = cast;
    this.t = 0;
    this.cues = 0;
    this.flashSil = null;
    this.padDown = anyPadButton();
    this.resize();
    const ko = cast.omega ? 'FINAL K.O.!' : 'K.O.!';
    this.title.querySelector('.t')!.textContent = ko;
    this.title.querySelector('.s')!.textContent = cast.omega ? `${cast.bossName.toUpperCase()} FALLS!` : `${cast.bossName.toUpperCase()} DEFEATED!`;
    this.title.classList.remove('show');
    this.capL.textContent = cast.heroName.toUpperCase();
    this.capR.textContent = cast.bossName.toUpperCase();
    this.capL.style.setProperty('--c', cast.heroColor);
    this.capR.style.setProperty('--c', cast.bossColor);
    this.root.classList.toggle('calm', cast.calm);
    this.root.classList.remove('out');
    this.root.hidden = false;
    this.root.parentElement?.classList.add('cinematic', 'finishing');
  }

  /** Jump to the exit wipe. */
  skip(): void {
    if (this.t < 0) return;
    const to = this.length - finisherTuning.out;
    if (this.t >= to) return;
    this.t = to;
    this.cues = 2;
    this.onSkip?.();
  }

  stop(): void {
    this.t = -1;
    this.cast = null;
    this.root.hidden = true;
    this.title.classList.remove('show');
    this.canvas.style.transform = '';
    this.root.parentElement?.classList.remove('cinematic', 'finishing');
  }

  /** Advance and draw. Returns true on the frame it finishes. */
  update(dt: number): boolean {
    if (this.t < 0 || !this.cast) return false;
    const pad = anyPadButton();
    if (pad && !this.padDown && this.t > finisherTuning.minSkip) this.skip();
    this.padDown = pad;
    this.t += dt;
    const cast = this.cast;
    const f = finisherFrame(this.t, cast.calm, this.frame);
    if (f.done) {
      this.stop();
      return true;
    }
    if (this.cues === 0 && f.panel > 0) {
      this.cues = 1;
      this.onCue?.('whoosh');
    }
    if (this.cues === 1 && f.sinceHit >= 0) {
      this.cues = 2;
      this.onCue?.('hit');
    }
    this.title.classList.toggle('show', f.title);
    this.root.classList.toggle('out', f.out > 0);
    this.root.classList.toggle('panels', f.panel >= 1 && f.out === 0);
    // Shake on the hit (whole canvas, whole canvas pixels).
    let sx = 0;
    let sy = 0;
    if (!cast.calm && cast.shake > 0 && f.sinceHit >= 0 && f.sinceHit < 0.3) {
      const a = Math.round((1 - f.sinceHit / 0.3) * finisherTuning.shake * cast.shake);
      sx = (Math.floor(f.sinceHit * 40) % 2 ? 1 : -1) * a;
      sy = (Math.floor(f.sinceHit * 30) % 2 ? -1 : 1) * Math.round(a / 2);
    }
    this.canvas.style.transform = sx || sy ? `translate(${sx * this.px}px, ${sy * this.px}px)` : '';
    this.draw(f, cast);
    return false;
  }

  private resize(): void {
    const w = Math.max(320, window.innerWidth || 1280);
    const h = Math.max(180, window.innerHeight || 720);
    this.px = Math.max(2, Math.round(Math.min(w / 320, h / 180)));
    const W = Math.ceil(w / this.px);
    const H = Math.ceil(h / this.px);
    if (this.canvas.width !== W || this.canvas.height !== H || !this.img) {
      this.canvas.width = W;
      this.canvas.height = H;
      this.img = this.ctx?.createImageData(W, H) ?? null;
      this.buf = this.img ? new Uint32Array(this.img.data.buffer) : null;
    }
    this.canvas.style.width = `${W * this.px}px`;
    this.canvas.style.height = `${H * this.px}px`;
    const c = this.cast!;
    const fx = c.focus ? c.focus.x * W : W * 0.5;
    const fy = c.focus ? c.focus.y * H : H * 0.5;
    let t = this.tables;
    if (!t || t.w !== W || t.h !== H) {
      const n = W * H;
      t = { w: W, h: H, ha: new Float32Array(n), hr: new Float32Array(n), ba: new Float32Array(n), br: new Float32Array(n), fa: new Float32Array(n), fr: new Float32Array(n) };
      this.tables = t;
      const [hx, hy] = this.heroCentre(W, H);
      const [bx, by] = this.bossCentre(W, H);
      for (let y = 0, i = 0; y < H; y++) {
        for (let x = 0; x < W; x++, i++) {
          t.ha[i] = Math.atan2(y - hy, x - hx);
          t.hr[i] = Math.hypot(x - hx, y - hy);
          t.ba[i] = Math.atan2(y - by, x - bx);
          t.br[i] = Math.hypot(x - bx, y - by);
        }
      }
    }
    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i++) {
        t.fa[i] = Math.atan2(y - fy, x - fx);
        t.fr[i] = Math.hypot(x - fx, y - fy);
      }
    }
  }

  private scale(H: number): number {
    return Math.max(2, Math.floor((H * 0.6) / PORTRAIT));
  }
  private heroCentre(W: number, H: number): [number, number] {
    return [Math.round(W * 0.27), Math.round(H * 0.5)];
  }
  private bossCentre(W: number, H: number): [number, number] {
    return [Math.round(W * 0.75), Math.round(H * 0.48)];
  }

  private draw(f: FinisherFrame, c: FinisherCast): void {
    const buf = this.buf;
    const t = this.tables;
    if (!buf || !t || !this.ctx || !this.img) return;
    const W = t.w;
    const H = t.h;
    const time = this.t;
    const ink = abgr(INK);
    const white = abgr(WHITE);
    const heroBase = hexInt(c.heroColor);
    const bossBase = hexInt(c.bossColor);
    const bossAcc = hexInt(c.bossAccent);
    // Hero side: a bright tint of the hero colour, darker focus lines, an accent burst.
    const hBg = abgr(mix(heroBase, 0xfff6d0, 0.62));
    const hLine = abgr(mix(heroBase, 0xfff6d0, 0.25));
    const hBurst = abgr(mix(heroBase, 0xfff6d0, 0.85));
    const hBurstIn = abgr(YELLOW);
    // Boss side: dark, with lines in the boss colour and a white impact star.
    const bBg = abgr(mix(bossBase, INK, 0.72));
    const bLine = abgr(mix(bossBase, INK, 0.35));
    const bBurst = abgr(mix(bossAcc, 0xfff6d0, 0.2));
    const dim = abgr(INK, 150);
    const clear = 0;
    const slide = (1 - f.panel) * W * 0.62 + f.out * W * 0.7;
    const gut = 2;
    const hit = f.sinceHit;
    const flash = c.flashes && !c.calm && hit >= 0 && hit < 0.06;
    const starR = hit < 0 ? 0 : hit < 0.12 ? (hit / 0.12) * H * 0.42 : Math.max(H * 0.22, H * 0.42 - (hit - 0.12) * H * 0.3);
    const rot = time * 0.6;
    const spin = Math.floor(time * 10); // focus lines flicker in steps
    const bins = 150;
    const [hx] = this.heroCentre(W, H);
    const [bx] = this.bossCentre(W, H);
    // Strike beam: from the hero's arm to the boss's face, while it lands.
    const beamOn = hit >= -0.12 && hit < 0.16 && !c.calm;
    const s = this.scale(H);
    const ax = hx + s * 12;
    const ay = H * 0.5 + s * 9;
    const [bcx, bcy] = this.bossCentre(W, H);
    const dx = bcx - ax;
    const dy = bcy - ay;
    const dl = Math.hypot(dx, dy) || 1;
    const nx = -dy / dl;
    const ny = dx / dl;
    const beamW = hit < 0 ? 2 : Math.max(1, 6 - hit * 30);
    const beamLen = hit < 0 ? Math.min(1, (hit + 0.12) / 0.12) * dl : dl;
    for (let y = 0, i = 0; y < H; y++) {
      const seam = seamX(y, W, H);
      for (let x = 0; x < W; x++, i++) {
        let col = clear;
        // Freeze-frame: dim the world with an ink screen and focus lines on the boss.
        if (f.panel < 1 || f.out > 0) {
          const lines = f.out === 0 && focusLine(t.fa[i], t.fr[i], 200, H * 0.3, H * 0.45, spin);
          col = lines ? ink : ((x ^ y) & 1) === 0 && f.freeze > 0.5 && f.out < 0.5 ? dim : clear;
        }
        // Panels (slid in from their sides).
        const lx = x + slide; // left panel content coordinate
        const rx = x - slide;
        if (lx < seam - gut) {
          col = this.heroPixel(y * W + Math.min(W - 1, Math.round(lx)), t, rot, spin, bins, hBg, hLine, hBurst, hBurstIn, ink);
        } else if (lx < seam - gut + 1 && f.panel > 0) col = ink;
        if (rx > seam + gut) {
          const ii = y * W + Math.max(0, Math.round(rx));
          const r = t.br[ii];
          const a = t.ba[ii];
          let p = bBg;
          if (focusLine(a, r, bins, H * 0.2, H * 0.35, spin + 50)) p = bLine;
          if (starR > 0) {
            const R = burstRadius(a, 14, starR, 0.42, -rot * 2);
            if (r < R - 2) p = r < R * 0.55 ? white : abgr(YELLOW);
            else if (r < R) p = ink;
          } else {
            const R = burstRadius(a, 9, H * 0.36, 0.3, rot);
            if (r < R - 1) p = abgr(mix(bossBase, INK, 0.55));
            else if (r < R) p = bBurst;
          }
          // Halftone in the far corner.
          if (((x & 3) === 0 && (y & 3) === 0) || ((x & 3) === 2 && (y & 3) === 2)) if (rx - seam > W * 0.3 && y > H * 0.62) p = ink;
          col = p;
        } else if (rx > seam + gut - 1 && f.panel > 0) col = ink;
        // Gutter between the panels.
        if (f.panel > 0 && f.out === 0 && lx >= seam - gut + 1 && rx <= seam + gut - 1) col = white;
        // Screen frame
        if (f.panel > 0 && f.out === 0 && (x < 2 || y < 2 || x >= W - 2 || y >= H - 2)) col = x === 0 || y === 0 || x === W - 1 || y === H - 1 ? ink : white;
        // Beam
        if (beamOn) {
          const qx = x - ax;
          const qy = y - ay;
          const along = (qx * dx + qy * dy) / dl;
          if (along > 0 && along < beamLen) {
            const d = Math.abs(qx * nx + qy * ny);
            if (d < beamW) col = d < beamW - 1.5 ? white : abgr(YELLOW);
            else if (d < beamW + 1) col = ink;
          }
        }
        if (flash) col = white;
        buf[i] = col;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
    if (flash || f.panel <= 0) return;
    // Portraits, positioned with the panels.
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    const size = PORTRAIT * s;
    const [, hy] = this.heroCentre(W, H);
    const [, by] = this.bossCentre(W, H);
    const lunge = !c.calm && hit >= -0.1 && hit < 0.25 ? s * 3 : 0;
    const heroExpr: Expression = hit < 0 ? 'determined' : hit < 0.9 ? 'grinning' : 'victorious';
    const bossExpr: Expression = hit < 0 ? 'shocked' : 'hurt';
    const shakeB = !c.calm && hit >= 0 && hit < 0.4 ? (Math.floor(hit * 30) % 2 ? s : -s) : 0;
    const hxo = Math.round(hx - size / 2 - slide + lunge);
    const bxo = Math.round(bx - size / 2 + slide + shakeB);
    ctx.save();
    // Clip each portrait to its own panel.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(seamX(0, W, H) - gut - slide, 0);
    ctx.lineTo(seamX(H, W, H) - gut - slide, H);
    ctx.lineTo(0, H);
    ctx.clip();
    ctx.drawImage(portraitCanvas(c.hero, heroExpr), hxo, Math.round(hy - size / 2), size, size);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(W, 0);
    ctx.lineTo(seamX(0, W, H) + gut + slide, 0);
    ctx.lineTo(seamX(H, W, H) + gut + slide, H);
    ctx.lineTo(W, H);
    ctx.clip();
    const bossArt = portraitCanvas(c.boss, bossExpr);
    const whiteOut = c.flashes && !c.calm && hit >= 0 && hit < 0.1;
    ctx.drawImage(whiteOut ? this.silhouette(bossArt) : bossArt, bxo, Math.round(by - size / 2), size, size);
    ctx.restore();
  }

  private heroPixel(i: number, t: Tables, rot: number, spin: number, bins: number, bg: number, line: number, burst: number, burstIn: number, ink: number): number {
    const r = t.hr[i];
    const a = t.ha[i];
    const H = t.h;
    const R = burstRadius(a, 11, H * 0.4, 0.34, rot);
    if (r < R * 0.82) return burstIn;
    if (r < R - 1) return burst;
    if (r < R) return ink;
    if (focusLine(a, r, bins, H * 0.42, H * 0.3, spin + 90)) return line;
    return bg;
  }

  /** A white silhouette of a portrait (the hit flash), made once per finisher. */
  private silhouette(art: HTMLCanvasElement): HTMLCanvasElement {
    if (this.flashSil) return this.flashSil;
    const c = document.createElement('canvas');
    c.width = c.height = PORTRAIT;
    const x = c.getContext('2d');
    if (x) {
      x.drawImage(art, 0, 0);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = '#f4f4f4';
      x.fillRect(0, 0, PORTRAIT, PORTRAIT);
    }
    this.flashSil = c;
    return c;
  }
}

function anyPadButton(): boolean {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p) for (const b of p.buttons) if (b.pressed) return true;
  return false;
}

const CSS = `
#finisher {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 6;
}
#finisher[hidden] { display: none; }
#finisher.panels { background: var(--ink); }
#finisher canvas {
  position: absolute;
  left: 0;
  top: 0;
  image-rendering: pixelated;
}
#finisher .fin-title {
  position: absolute;
  left: 0;
  right: 0;
  top: 54%;
  text-align: center;
  visibility: hidden;
}
#finisher .fin-title.show { visibility: visible; animation: fin-slam 0.32s steps(4) both; }
#finisher.calm .fin-title.show { animation: none; }
#finisher.out .fin-title { animation: fin-out 0.2s steps(2) both; }
#finisher .fin-title .t {
  font-family: var(--display);
  font-size: clamp(90px, 17vw, 220px);
  line-height: 0.85;
  color: var(--yellow);
  letter-spacing: 4px;
  text-shadow:
    var(--outline),
    0 8px 0 var(--orange),
    0 13px 0 var(--red),
    0 18px 0 var(--ink);
}
#finisher .fin-title .s {
  display: inline-block;
  margin-top: 18px;
  padding: 4px 16px;
  font: 28px var(--font);
  letter-spacing: 2px;
  color: var(--ink);
  text-shadow: none;
  background: var(--white);
  box-shadow: 0 0 0 var(--p) var(--ink), calc(2 * var(--p)) calc(2 * var(--p)) 0 var(--p) var(--ink);
}
#finisher .fin-cap {
  position: absolute;
  padding: 3px 12px;
  font: 22px var(--display);
  letter-spacing: 2px;
  color: var(--ink);
  text-shadow: none;
  visibility: hidden;
  background: var(--yellow);
  box-shadow: 0 0 0 var(--p) var(--ink), var(--p) var(--p) 0 var(--p) var(--ink);
  border-left: calc(2 * var(--p)) solid var(--c);
}
#finisher .fin-cap.l { left: 4vw; top: 6vh; }
#finisher .fin-cap.r { right: 4vw; bottom: 7vh; }
#finisher.panels .fin-cap { visibility: visible; animation: fin-cap 0.2s steps(2) both; }
#finisher.calm .fin-cap { animation: none; }
#finisher .fin-skip {
  position: absolute;
  right: 3vw;
  top: 3vh;
  font: 10px var(--label);
  letter-spacing: 2px;
  color: var(--white);
  text-shadow: 1px 0 0 var(--ink), -1px 0 0 var(--ink), 0 1px 0 var(--ink), 0 -1px 0 var(--ink);
}
.finishing #ingame { visibility: hidden; }
@keyframes fin-slam {
  from { transform: scale(2.6) rotate(-8deg); opacity: 0; }
  60% { transform: scale(0.9) rotate(2deg); opacity: 1; }
}
@keyframes fin-out { to { transform: scale(1.2); opacity: 0; } }
@keyframes fin-cap { from { transform: translateY(calc(-3 * var(--p))); } }
`;

function injectCss(): void {
  if (typeof document === 'undefined' || document.getElementById('finisher-css')) return;
  const st = document.createElement('style');
  st.id = 'finisher-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}
