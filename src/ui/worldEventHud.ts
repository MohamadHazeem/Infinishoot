import type { Game } from '../game/game';
import type { WorldEvent } from '../game/systems/worldEvents';
import {
  WORLD_EVENTS,
  collapseCrackAt,
  collapseFallAt,
  eclipseBurstAt,
  eventLength,
  floodLevel,
  flowerPhase,
  giantStepTime,
  worldEventTuning as T,
} from '../game/worldEvents';

/**
 * World event tracker in the HUD's goals stack (top left, under the stage
 * objective): what is happening and for how long, and on a Night Raid the
 * light meter (how visible you are), a LOUD chip while you make noise, the
 * intel count, hunters on your trail and a grab bar. An edge-of-screen arrow
 * points at the flower or the nearest intel cache. Pixel UI, CSS injected once.
 */
const CSS = `
#wevent {
  position: relative;
  min-width: 190px;
  margin-top: calc(2 * var(--p));
  padding: calc(2 * var(--p)) calc(3 * var(--p));
  --bg: var(--night);
  --hi: var(--slate);
  --lo: var(--ink);
  background-color: var(--bg);
  box-shadow:
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 0 var(--lo),
    0 calc(-1 * var(--p)) 0 0 var(--ink),
    0 var(--p) 0 0 var(--ink),
    calc(-1 * var(--p)) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink),
    0 calc(2 * var(--p)) 0 0 var(--ink);
  pointer-events: none;
  text-shadow: var(--outline);
}
#wevent .h { display: flex; justify-content: space-between; gap: 10px; font: 10px var(--label); letter-spacing: 1px; color: var(--wc, var(--orange)); }
#wevent .t { font: 20px var(--font); color: var(--white); line-height: 1.1; margin-top: 2px; }
#wevent .s { font: 13px var(--font); color: var(--mist); }
#wevent .bar { display: flex; gap: var(--p); margin-top: calc(2 * var(--p)); height: calc(3 * var(--p)); }
#wevent .bar i { flex: 1; background: var(--ink); }
#wevent .bar i.on { background: var(--wc, var(--orange)); }
#wevent .meter { display: flex; align-items: center; gap: calc(2 * var(--p)); margin-top: calc(2 * var(--p)); }
#wevent .eye { position: relative; width: calc(9 * var(--p)); height: calc(5 * var(--p)); background: var(--ink); clip-path: polygon(0 50%, 25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%); }
#wevent .eye::after { content: ''; position: absolute; left: calc(3 * var(--p)); top: var(--p); width: calc(3 * var(--p)); height: calc(3 * var(--p)); background: var(--slate); }
#wevent .eye.lit { background: var(--yellow); }
#wevent .eye.lit::after { background: var(--ink); }
#wevent .eye.seen { background: var(--red); }
#wevent .meter .bar { flex: 1; margin-top: 0; }
#wevent .meter .bar i.on { background: var(--yellow); }
#wevent .meter .bar i.hot { background: var(--orange); }
#wevent .tag { font: 12px var(--label); letter-spacing: 1px; color: var(--mist); min-width: 54px; text-align: right; }
#wevent .tag.hidden { color: var(--cyan); }
#wevent .tag.lit { color: var(--yellow); }
#wevent .row { display: flex; justify-content: space-between; gap: 8px; font: 13px var(--font); color: var(--white); margin-top: var(--p); }
#wevent .loud { color: var(--ink); background: var(--orange); padding: 0 calc(2 * var(--p)); font: 11px var(--label); letter-spacing: 1px; }
#wevent .hunt { color: var(--red); }
#wevent .grab { height: var(--p); margin-top: var(--p); background: var(--ink); }
#wevent .grab div { height: 100%; background: var(--cyan); }
#wevent.pop { animation: wevpop 0.45s steps(3); }
@keyframes wevpop { 0% { transform: translateY(calc(-2 * var(--p))) scale(1.08); } 100% { transform: none; } }
#wevptr { position: absolute; left: 0; top: 0; pointer-events: none; font: 12px var(--label); color: var(--wc, var(--cyan)); text-shadow: var(--outline); text-align: center; }
#wevptr .a { position: absolute; left: -9px; top: -9px; width: 18px; height: 18px; background: var(--wc, var(--cyan)); clip-path: polygon(0 0, 100% 50%, 0 100%, 25% 50%); }
#wevptr .m { position: absolute; left: -40px; top: 14px; width: 80px; }
`;

const SEGS = 10;
/** Header colour per event (palette variables that read on the dark panel). */
const HUD_COLOR: Record<string, string> = { collapse: 'var(--orange)', flood: 'var(--sky)', split: 'var(--yellow)', giant: 'var(--mist)', eclipse: 'var(--cyan)', flower: 'var(--lime)', volcano: 'var(--orange)', stealth: 'var(--cyan)' };

export class WorldEventHud {
  private el: HTMLElement | null = null;
  private ptr: HTMLElement | null = null;
  private last = '';
  private lastKind = '';
  private tmp = { x: 0, y: 0, z: 0 };

  private mount(): boolean {
    if (this.el) return true;
    const root = document.getElementById('ingame');
    if (!root) return false;
    if (!document.getElementById('wevent-css')) {
      const st = document.createElement('style');
      st.id = 'wevent-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.id = 'wevent';
    this.el.hidden = true;
    this.ptr = document.createElement('div');
    this.ptr.id = 'wevptr';
    this.ptr.hidden = true;
    this.ptr.innerHTML = '<div class="a"></div><div class="m"></div>';
    const goals = document.getElementById('goals');
    if (goals) goals.insertBefore(this.el, document.getElementById('spice'));
    else root.append(this.el);
    root.append(this.ptr);
    return true;
  }

  update(g: Game, ev: WorldEvent | null): void {
    if (!this.mount()) return;
    const el = this.el!;
    const show = !!ev && g.isCombatMode && !(ev.done && ev.kind !== 'stealth') && !(ev.kind === 'stealth' && ev.done);
    if (!show || !ev) {
      el.hidden = true;
      this.ptr!.hidden = true;
      this.last = '';
      this.lastKind = '';
      return;
    }
    const html = ev.kind === 'stealth' ? this.stealthHtml(g, ev) : this.eventHtml(ev);
    if (html !== this.last) {
      this.last = html;
      el.innerHTML = html;
      el.style.setProperty('--wc', HUD_COLOR[ev.kind] ?? 'var(--orange)');
      if (this.lastKind !== ev.kind) {
        el.classList.remove('pop');
        void el.offsetWidth;
        el.classList.add('pop');
        this.lastKind = ev.kind;
      }
    }
    el.hidden = false;
    this.pointer(g, ev);
  }

  private eventHtml(ev: WorldEvent): string {
    const t = ev.t;
    const len = eventLength(ev.kind);
    const def = WORLD_EVENTS[ev.kind];
    let sub = def.sub;
    let left = Math.max(0, len - t);
    switch (ev.kind) {
      case 'collapse': {
        let pending = 0;
        let cracking = false;
        for (let i = 0; i + 2 < ev.p.length; i += 3) {
          const w = ev.p[i + 2];
          if (t < collapseFallAt(w)) pending++;
          if (t >= collapseCrackAt(w) && t < collapseFallAt(w)) cracking = true;
        }
        sub = cracking ? 'CRACKS! GET OFF THEM!' : pending ? `${pending} SECTIONS STILL CRACKING` : 'THE HOLES STAY: WATCH YOUR STEP';
        break;
      }
      case 'split':
        sub = t < T.splitWarn ? `CHASM OPENS IN ${Math.ceil(T.splitWarn - t)}` : 'CROSS AT THE BRIDGES';
        left = Math.max(0, T.splitWarn - t);
        break;
      case 'flood': {
        const lv = floodLevel(t);
        sub = t < T.floodWarn ? 'THE WATER IS RISING' : lv >= 1 ? 'SLOW IN WATER · SHOCK SPREADS · FIRE GOES OUT' : t > T.floodWarn + T.floodRise ? 'DRAINING' : 'THE WATER IS RISING';
        break;
      }
      case 'giant': {
        let n = 0;
        for (let i = 0; i < T.giantSteps; i++) if (giantStepTime(i) > t) n++;
        sub = n ? `MIND ITS FEET · ${n} STEPS TO GO` : 'IT WALKS AWAY';
        break;
      }
      case 'eclipse':
        sub = t < T.eclipseFade ? 'DARKNESS FALLS' : 'ENEMIES MOVE FASTER IN THE DARK';
        left = Math.max(0, eclipseBurstAt() - t);
        break;
      case 'flower': {
        const ph = flowerPhase(t);
        sub = ph.bloom ? 'IN BLOOM: STAND IN THE RING TO HEAL' : ph.wilt > 0 ? 'WILTING' : 'GROWING... GET CLOSE';
        break;
      }
      case 'volcano':
        sub = t < T.volcanoWarn ? 'THE GROUND RUMBLES' : t < T.volcanoWarn + T.volcanoLen ? 'DODGE THE RED CIRCLES' : 'THE ERUPTION ENDS';
        break;
    }
    const on = Math.round((left / Math.max(1, len)) * SEGS);
    let bar = '';
    for (let i = 0; i < SEGS; i++) bar += `<i class="${i < on ? 'on' : ''}"></i>`;
    return `<div class="h"><span>★ WORLD EVENT</span><span>${Math.ceil(left)}S</span></div><div class="t">${def.name.replace(/!$/, '')}</div><div class="s">${sub}</div><div class="bar">${bar}</div>`;
  }

  private stealthHtml(g: Game, ev: WorldEvent): string {
    const st = ev.stealth!;
    const v = st.meter;
    const on = Math.round(v * 8);
    let bar = '';
    for (let i = 0; i < 8; i++) bar += `<i class="${i < on ? (i >= 5 ? 'hot' : 'on') : ''}"></i>`;
    const lit = v > 0.45;
    const tag = st.loud > 0 ? '' : lit ? '<span class="tag lit">LIT</span>' : '<span class="tag hidden">HIDDEN</span>';
    const loud = st.loud > 0 ? '<span class="loud">LOUD</span>' : '';
    const n = st.layout.caches.length;
    let got = 0;
    for (let i = 0; i < n; i++) if (st.got & (1 << i)) got++;
    const hunt = st.alerts > 0 ? `<span class="hunt">! ${st.alerts} HUNTING YOU</span>` : '<span>UNSEEN</span>';
    const grab = st.grabP > 0 ? `<div class="grab"><div style="width:${Math.round(st.grabP * 100)}%"></div></div>` : '';
    void g;
    return (
      `<div class="h"><span>◐ NIGHT RAID</span><span>INTEL ${got}/${n}</span></div>` +
      `<div class="meter"><div class="eye ${st.alerts > 0 ? 'seen' : lit ? 'lit' : ''}"></div><div class="bar">${bar}</div>${tag}${loud}</div>` +
      `<div class="row">${hunt}<span>${got >= n ? 'INTEL SECURED' : 'GRAB THE INTEL'}</span></div>${grab}`
    );
  }

  /** Edge arrow toward the flower (while it grows or blooms) or the nearest intel cache. */
  private pointer(g: Game, ev: WorldEvent): void {
    const p = this.ptr!;
    let tx = NaN;
    let tz = NaN;
    if (ev.kind === 'flower' && ev.t < T.flowerGrow + T.flowerBloom) [tx, tz] = ev.p;
    else if (ev.kind === 'stealth' && ev.stealth) {
      const me = g.hero.player;
      let bd = Infinity;
      ev.stealth.layout.caches.forEach((c, i) => {
        if (ev.stealth!.got & (1 << i)) return;
        const d = Math.hypot(c.x - me.x, c.z - me.z);
        if (d < bd) {
          bd = d;
          tx = c.x;
          tz = c.z;
        }
      });
    }
    if (Number.isNaN(tx)) {
      p.hidden = true;
      return;
    }
    const v = g.tmp.set(tx, 1, tz).project(g.cam.camera);
    const sx = ((v.x + 1) / 2) * innerWidth;
    const sy = ((1 - v.y) / 2) * innerHeight;
    if (v.z <= 1 && sx > 10 && sx < innerWidth - 10 && sy > 10 && sy < innerHeight - 10) {
      p.hidden = true;
      return;
    }
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    let dx = sx - cx;
    let dy = sy - cy;
    if (v.z > 1) {
      dx = -dx;
      dy = -dy;
    }
    const m = 130;
    const k = Math.min((innerWidth / 2 - m) / Math.max(1, Math.abs(dx)), (innerHeight / 2 - m * 0.7) / Math.max(1, Math.abs(dy)));
    const x = cx + dx * k;
    const y = cy + dy * k;
    p.hidden = false;
    p.style.setProperty('--wc', HUD_COLOR[ev.kind]);
    p.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    (p.firstElementChild as HTMLElement).style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    const me = g.hero.player;
    const txt = `${Math.round(Math.hypot(tx - me.x, tz - me.z))}M`;
    const lab = p.lastElementChild as HTMLElement;
    if (lab.textContent !== txt) lab.textContent = txt;
    void this.tmp;
  }
}
