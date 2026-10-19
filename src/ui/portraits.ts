import { localize, localizeHtml } from '../i18n';
/**
 * Character portraits on the HUD: the local hero's face next to the life bar
 * (its expression follows what's happening), and comic pop-ins with a speech
 * bubble when the announcer speaks, a boss enters, changes phase or talks, or
 * a teammate pings. Heroes and the announcer pop in on the left, bosses on
 * the right. Plain DOM; the art comes from portraitArt.ts.
 *
 * Other code calls `portraits.popIn(who, expression, text?, seconds)`, where
 * `who` is 'announcer', 'boss:<enemy id>' or 'hero:<player index>' (resolved
 * by the game, see systems/characters.ts). Pop-ins are local to the machine
 * that calls them; the host sends team-wide ones with `game.vfx.portrait()`.
 */
import { PORTRAIT, portraitCanvas, type Expression, type PortraitLook } from './portraitArt';
import { reduceMotion } from './hud';

export type { Expression } from './portraitArt';

export interface Speaker {
  look: PortraitLook;
  /** Name on the speech bubble. */
  name: string;
  /** Name colour. */
  color: string;
  side: 'left' | 'right';
}

export const portraitTuning = {
  /** Default pop-in time on screen (s). */
  popSeconds: 2.6,
  /** Speech bubble typing speed (characters per second). */
  typeRate: 48,
  /** Most pop-ins on one side at once (the oldest leaves first). */
  maxPerSide: 2,
  /** Seconds between HUD blinks, and how long a blink lasts. */
  blinkEvery: 3.4,
  blinkTime: 0.13,
  /** The HUD face keeps its hurt look this long after a hit. */
  hurtHold: 0.5,
  /** Exit animation (s). */
  outTime: 0.24,
};

/** What the HUD face reacts to. */
export interface HudMood {
  dead: boolean;
  hp01: number;
  /** Seconds since the hero was last hurt (Infinity = not recently). */
  sinceHurt: number;
  /** Stage cleared, boss finisher, victory. */
  won: boolean;
  /** S rank or better, a big combo, an ultimate going. */
  hype: boolean;
  /** A boss or elite is up, or the hero is charging. */
  tense: boolean;
}

/** The HUD face's expression, by priority. */
export function hudExpression(m: HudMood): Expression {
  if (m.dead) return 'hurt';
  if (m.won) return 'victorious';
  if (m.sinceHurt < portraitTuning.hurtHold) return 'hurt';
  if (m.hp01 <= 0.3) return 'shocked';
  if (m.hype) return 'grinning';
  if (m.tense) return 'determined';
  return 'neutral';
}

/** Blink schedule: true for `blinkTime` every `blinkEvery` seconds (with a double blink now and then). */
export function blinkAt(t: number): boolean {
  const T = portraitTuning;
  const k = t % (T.blinkEvery * 3);
  const p = k % T.blinkEvery;
  return p < T.blinkTime || (k > T.blinkEvery * 2 && p > 0.22 && p < 0.22 + T.blinkTime);
}

/** Characters of `text` shown `t` seconds into a pop-in. */
export function typedChars(text: string, t: number, instant = false): number {
  return instant ? text.length : Math.min(text.length, Math.floor(Math.max(0, t - 0.12) * portraitTuning.typeRate));
}

interface Pop {
  who: string;
  side: 'left' | 'right';
  el: HTMLElement;
  ctx: CanvasRenderingContext2D | null;
  txt: HTMLElement;
  text: string;
  shown: number;
  t: number;
  life: number;
  out: number;
}

const CSS = `
#hudface {
  position: absolute;
  top: calc(6 * var(--p));
  left: 18px;
  width: 64px;
  height: 64px;
  --bg: var(--sky);
  --hi: var(--cyan);
  --lo: var(--blue);
  --ring: transparent;
  background-color: var(--bg);
  box-shadow:
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 0 var(--lo),
    0 calc(-1 * var(--p)) 0 0 var(--ink),
    0 var(--p) 0 0 var(--ink),
    calc(-1 * var(--p)) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink),
    0 calc(-2 * var(--p)) 0 0 var(--ring),
    0 calc(2 * var(--p)) 0 0 var(--ring),
    calc(-2 * var(--p)) 0 0 0 var(--ring),
    calc(2 * var(--p)) 0 0 0 var(--ring),
    calc(2 * var(--p)) calc(3 * var(--p)) 0 0 rgba(26, 28, 44, 0.55);
  pointer-events: none;
}
#hudface[hidden], .pp-pop[hidden] { display: none; }
#hudface canvas, .pp-face canvas {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}
#hudface.low { --ring: var(--red); animation: pp-ring 0.6s steps(1) infinite; }
@keyframes pp-ring { 50% { --ring: var(--orange); } }
#hudface.hit canvas { animation: shake 0.24s steps(4); }
#hudface.down canvas { filter: grayscale(1) brightness(0.8); }
#hudface.won { --bg: var(--yellow); --hi: #fff6d0; --lo: var(--orange); }
#ingame.has-face #hp,
#ingame.has-face #runinfo,
#ingame.has-face #team { left: calc(18px + 64px + 6 * var(--p)); }

.pp-pop {
  position: absolute;
  top: var(--y);
  display: flex;
  align-items: flex-start;
  gap: calc(3 * var(--p));
  pointer-events: none;
  z-index: 4;
}
.pp-pop.left { left: 18px; }
.pp-pop.right { right: 20px; flex-direction: row-reverse; }
.pp-face {
  flex: none;
  width: 64px;
  height: 64px;
  --bg: var(--night);
  --hi: var(--slate);
  --lo: var(--ink);
}
.pp-pop.right .pp-face { --bg: var(--plum); --hi: var(--red); }
.pp-bub {
  position: relative;
  max-width: 300px;
  min-width: 120px;
  margin-top: calc(2 * var(--p));
  padding: calc(2 * var(--p)) calc(4 * var(--p)) calc(3 * var(--p));
  background: var(--white);
  color: var(--ink);
  text-shadow: none;
  box-shadow:
    0 calc(-1 * var(--p)) 0 0 var(--ink),
    0 var(--p) 0 0 var(--ink),
    calc(-1 * var(--p)) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink),
    var(--p) calc(2 * var(--p)) 0 0 rgba(26, 28, 44, 0.55);
}
.pp-bub::before {
  content: '';
  position: absolute;
  top: calc(4 * var(--p));
  left: calc(-3 * var(--p));
  width: calc(2 * var(--p));
  height: calc(3 * var(--p));
  background: var(--white);
  box-shadow: calc(-1 * var(--p)) 0 0 0 var(--ink), 0 calc(-1 * var(--p)) 0 0 var(--ink), 0 var(--p) 0 0 var(--ink);
}
.pp-pop.right .pp-bub::before { left: auto; right: calc(-3 * var(--p)); box-shadow: var(--p) 0 0 0 var(--ink), 0 calc(-1 * var(--p)) 0 0 var(--ink), 0 var(--p) 0 0 var(--ink); }
.pp-nm {
  display: block;
  font: 10px var(--label);
  letter-spacing: 1px;
  color: var(--c);
  text-shadow: 1px 0 0 var(--ink), -1px 0 0 var(--ink), 0 1px 0 var(--ink), 0 -1px 0 var(--ink);
}
.pp-tx {
  display: block;
  min-height: 1em;
  font: 22px/1.05 var(--font);
  letter-spacing: 1px;
}
.pp-tx:empty { display: none; }
.pp-pop.left.in { animation: pp-in-l 0.2s steps(3) both; }
.pp-pop.right.in { animation: pp-in-r 0.2s steps(3) both; }
.pp-pop.left.out { animation: pp-in-l 0.24s steps(3) reverse both; }
.pp-pop.right.out { animation: pp-in-r 0.24s steps(3) reverse both; }
.pp-pop.again .pp-face { animation: hop 0.2s steps(2); }
@keyframes pp-in-l { from { transform: translateX(calc(-100% - 30px)); } }
@keyframes pp-in-r { from { transform: translateX(calc(100% + 30px)); } }
@media (prefers-reduced-motion: reduce) {
  .pp-pop.in, .pp-pop.out, #hudface canvas { animation: none !important; }
}
.reduce-flash .pp-pop.in, .reduce-flash .pp-pop.out, .reduce-flash #hudface canvas { animation: none !important; }
`;

/** Pop-in stacks: top of the first slot (fraction of the screen height) per side. */
const STACK_Y = { left: 0.36, right: 0.44 };
const STACK_STEP = 92; // px between stacked pop-ins

export class Portraits {
  /** Turns a `who` id into a face, name and side (set by the game). */
  resolve: (who: string) => Speaker | null = () => null;
  /** Pop-ins on/off (SETTINGS > CHARACTER POP-INS). */
  enabled = true;
  private root: HTMLElement | null = null;
  private face: HTMLElement | null = null;
  private faceCtx: CanvasRenderingContext2D | null = null;
  private faceArt: HTMLCanvasElement | null = null;
  private faceLook: PortraitLook | null = null;
  private faceExpr = '';
  private faceBlink = false;
  private faceClass = '';
  private pops: Pop[] = [];
  private free: Pop[] = [];

  private mount(): boolean {
    if (this.root) return true;
    if (typeof document === 'undefined') return false;
    const root = document.getElementById('ingame');
    if (!root) return false;
    if (!document.getElementById('portraits-css')) {
      const st = document.createElement('style');
      st.id = 'portraits-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.root = root;
    this.face = document.createElement('div');
    this.face.id = 'hudface';
    this.face.hidden = true;
    const c = document.createElement('canvas');
    c.width = c.height = PORTRAIT;
    this.face.appendChild(c);
    this.faceCtx = c.getContext('2d');
    root.appendChild(this.face);
    return true;
  }

  /** The local hero's face next to the life bar (null hides it). */
  setHud(look: PortraitLook | null, expr: Expression, blink: boolean, cls: string): void {
    if (!this.mount() || !this.face) return;
    const show = !!look;
    if (this.face.hidden === show) {
      this.face.hidden = !show;
      this.root!.classList.toggle('has-face', show);
    }
    if (!look) return;
    blink = blink && (expr === 'neutral' || expr === 'determined');
    // Only look the art up when something changed (no per-frame string keys).
    if (look === this.faceLook && expr === this.faceExpr && blink === this.faceBlink) return this.setClass(cls);
    this.faceLook = look;
    this.faceExpr = expr;
    this.faceBlink = blink;
    const art = portraitCanvas(look, expr, blink);
    if (art !== this.faceArt && this.faceCtx) {
      this.faceArt = art;
      this.faceCtx.clearRect(0, 0, PORTRAIT, PORTRAIT);
      this.faceCtx.drawImage(art, 0, 0);
    }
    this.setClass(cls);
  }

  private setClass(cls: string): void {
    if (cls !== this.faceClass && this.face) {
      this.faceClass = cls;
      this.face.className = cls;
    }
  }

  /**
   * Show a character with a line of text for a few seconds. The same speaker
   * again updates its pop-in in place instead of stacking a second one.
   */
  popIn(who: string, expression: Expression = 'neutral', text = '', seconds = portraitTuning.popSeconds): void {
    if (!this.enabled || !this.mount()) return;
    const sp = this.resolve(who);
    if (!sp) return;
    let p = this.pops.find((x) => x.who === who && x.out < 0);
    if (p) {
      p.el.classList.remove('again');
      void p.el.offsetWidth;
      p.el.classList.add('again');
    } else {
      const same = this.pops.filter((x) => x.side === sp.side && x.out < 0);
      if (same.length >= portraitTuning.maxPerSide) this.leave(same[0]);
      p = this.take(sp.side);
      p.who = who;
      p.side = sp.side;
      p.el.className = `pp-pop ${sp.side} in`;
      p.el.hidden = false;
      this.pops.push(p);
    }
    p.t = 0;
    p.out = -1;
    p.life = Math.max(0.6, seconds);
    p.text = localize(text);
    p.shown = -1;
    const nm = p.el.querySelector<HTMLElement>('.pp-nm')!;
    nm.textContent = localize(sp.name.toUpperCase());
    nm.style.setProperty('--c', sp.color);
    if (p.ctx) {
      p.ctx.clearRect(0, 0, PORTRAIT, PORTRAIT);
      p.ctx.drawImage(portraitCanvas(sp.look, expression), 0, 0);
    }
    this.layout();
  }

  /** Is a pop-in from this speaker on screen? */
  showing(who: string): boolean {
    return this.pops.some((p) => p.who === who && p.out < 0);
  }

  /** Advance pop-ins (typing, timers, exits). */
  update(dt: number): void {
    if (!this.pops.length) return;
    const instant = reduceMotion();
    let moved = false;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      if (p.out >= 0) {
        p.out += dt;
        if (p.out >= portraitTuning.outTime || instant) {
          p.el.hidden = true;
          this.pops.splice(i, 1);
          this.free.push(p);
          moved = true;
        }
        continue;
      }
      const n = typedChars(p.text, p.t, instant);
      if (n !== p.shown) {
        p.shown = n;
        p.txt.textContent = localize(p.text.slice(0, n));
      }
      if (p.t >= p.life) this.leave(p);
    }
    if (moved) this.layout();
  }

  /** Remove every pop-in now (new run, back to the title). */
  clear(): void {
    for (const p of this.pops) {
      p.el.hidden = true;
      this.free.push(p);
    }
    this.pops.length = 0;
  }

  private leave(p: Pop): void {
    if (p.out >= 0) return;
    p.out = 0;
    p.el.classList.remove('in', 'again');
    p.el.classList.add('out');
  }

  private layout(): void {
    for (const side of ['left', 'right'] as const) {
      let k = 0;
      for (const p of this.pops) {
        if (p.side !== side) continue;
        p.el.style.setProperty('--y', `calc(${(STACK_Y[side] * 100).toFixed(0)}vh + ${k * STACK_STEP}px)`);
        if (p.out < 0) k++;
      }
    }
  }

  private take(side: 'left' | 'right'): Pop {
    const p = this.free.pop();
    if (p) return p;
    const el = document.createElement('div');
    el.className = `pp-pop ${side}`;
    el.innerHTML = localizeHtml(`<div class="pp-face px"><canvas width="${PORTRAIT}" height="${PORTRAIT}"></canvas></div><div class="pp-bub"><b class="pp-nm"></b><span class="pp-tx"></span></div>`);
    this.root!.appendChild(el);
    return {
      who: '',
      side,
      el,
      ctx: el.querySelector('canvas')!.getContext('2d'),
      txt: el.querySelector<HTMLElement>('.pp-tx')!,
      text: '',
      shown: -1,
      t: 0,
      life: 0,
      out: -1,
    };
  }
}

/** The one portrait layer (HUD face and pop-ins). */
export const portraits = new Portraits();
