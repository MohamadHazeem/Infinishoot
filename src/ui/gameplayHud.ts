import { prompt } from './prompts';
import { iconHtml } from './pixelIcons';

/**
 * Gameplay lane HUD: the power panel next to the DASH/SPECIAL/ULT tanks (mech
 * suit timer, super weapon ammo, overload meter), the combo cash-in panel
 * under the combo counter, and comeback mode (the game view turns monochrome
 * red and a COMEBACK! line shows under the timer). Plain DOM in the pixel UI
 * style; the CSS is injected once so style.css doesn't grow. Only touches the
 * DOM when what it shows changes.
 */
const CSS = `
#gp-power, #gp-cash {
  position: absolute;
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
  box-sizing: border-box;
}
#gp-power[hidden], #gp-cash[hidden], #gp-comeback[hidden] { display: none; }
#gp-power {
  left: calc(50% + 140px);
  bottom: 22px;
  width: 232px;
  padding: calc(2 * var(--p)) calc(3 * var(--p));
  display: flex;
  flex-direction: column;
  gap: calc(2 * var(--p));
}
#gp-power .row { display: flex; gap: calc(2 * var(--p)); align-items: center; }
#gp-power .row .ic { width: 24px; height: 24px; flex: none; }
#gp-power .row .ic .px-icon { width: 24px; height: 24px; image-rendering: pixelated; display: block; }
#gp-power .row .ic .glyph { font: 20px/24px var(--font); color: var(--c); text-align: center; }
#gp-power .row .m { flex: 1; min-width: 0; }
#gp-power .row .h span { white-space: nowrap; }
#gp-power .row .h { display: flex; justify-content: space-between; align-items: baseline; font: 10px var(--label); letter-spacing: 1px; color: var(--c); }
#gp-power .row .h b { font: 16px var(--font); font-weight: normal; color: var(--white); }
#gp-power .bar { display: flex; gap: var(--p); margin-top: var(--p); height: calc(3 * var(--p)); }
#gp-power .bar i { flex: 1; background: var(--ink); }
#gp-power .bar i.on { background: var(--c); }
#gp-power .row.low .bar i.on { animation: flash 0.4s steps(1) infinite; }
#gp-power .row.full { animation: hop 0.5s steps(2) infinite; }
#gp-power .row.fire .bar i.on { background: var(--white); }
.reduce-flash #gp-power .row.low .bar i.on, .reduce-flash #gp-power .row.full { animation: none; }
#gp-cash {
  right: 20px;
  top: calc(24 * var(--p) + 104px);
  width: 196px;
  padding: calc(2 * var(--p)) calc(3 * var(--p));
}
#gp-cash .h { display: flex; justify-content: space-between; align-items: center; font: 10px var(--label); letter-spacing: 1px; color: var(--yellow); }
#gp-cash .t { display: flex; justify-content: space-between; align-items: center; font: 16px/1.15 var(--font); color: var(--slate); }
#gp-cash .t.ok { color: var(--c); }
#gp-cash .t .cur { width: 12px; display: inline-block; color: var(--white); }
#gp-cash .t.sel .cur { animation: flash 0.6s steps(1) infinite; }
#gp-cash .t .cost { font: 10px var(--label); letter-spacing: 1px; }
#gp-cash .f { margin-top: 2px; font: 9px var(--label); letter-spacing: 1px; color: var(--mist); display: flex; align-items: center; gap: 4px; justify-content: flex-end; }
#gp-cash.ready { --hi: var(--yellow); }
.reduce-flash #gp-cash .t.sel .cur { animation: none; }
#gp-comeback {
  position: absolute;
  left: 50%;
  top: calc(8 * var(--p) + 96px);
  transform: translateX(-50%);
  font: 34px var(--display);
  letter-spacing: 2px;
  color: var(--white);
  text-shadow: var(--outline);
  pointer-events: none;
  animation: flash 0.5s steps(1) infinite;
  white-space: nowrap;
}
#gp-comeback small { display: block; text-align: center; font: 10px var(--label); color: var(--yellow); letter-spacing: 1px; }
.reduce-flash #gp-comeback { animation: none; }
body.gp-comeback #game { filter: grayscale(1) sepia(1) saturate(8) hue-rotate(-48deg) brightness(0.78) contrast(1.3); }
body.gp-comeback.gp-calm #game { filter: grayscale(1) sepia(1) saturate(4) hue-rotate(-48deg) brightness(0.9); }
`;

export interface GpHudState {
  show: boolean;
  /** Mech time left 0..1 (-1 = not piloting) and seconds. */
  mech: number;
  mechT: number;
  super: { id: string; name: string; color: string; glyph: string; ammo01: number; t: number; flamer: boolean; ammo: number } | null;
  /** Overload: 0..1 meter while every slot is maxed, -(0..1] while it fires, -2 = not ready. */
  overload: number;
  comeback: boolean;
  reduceFlash: boolean;
  combo: number;
  tiers: { name: string; color: string; cost: number }[];
  afford: boolean[];
  sel: number;
  minCost: number;
}

const SEGS = 10;

function bar(k: number): string {
  const on = Math.max(0, Math.min(SEGS, Math.ceil(k * SEGS - 1e-6)));
  let s = '';
  for (let i = 0; i < SEGS; i++) s += `<i class="${i < on ? 'on' : ''}"></i>`;
  return `<div class="bar">${s}</div>`;
}

class GameplayHud {
  private power: HTMLElement | null = null;
  private cash: HTMLElement | null = null;
  private cb: HTMLElement | null = null;
  private lastPower = '';
  private lastCash = '';
  private lastCb = '';

  private mount(): boolean {
    if (this.power) return true;
    const root = document.getElementById('ingame');
    if (!root) return false;
    if (!document.getElementById('gp-css')) {
      const st = document.createElement('style');
      st.id = 'gp-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.power = document.createElement('div');
    this.power.id = 'gp-power';
    this.power.hidden = true;
    this.cash = document.createElement('div');
    this.cash.id = 'gp-cash';
    this.cash.hidden = true;
    this.cb = document.createElement('div');
    this.cb.id = 'gp-comeback';
    this.cb.hidden = true;
    this.cb.innerHTML = 'COMEBACK!<small>x2 DAMAGE UNTIL YOU HEAL</small>';
    root.append(this.power, this.cash, this.cb);
    return true;
  }

  update(s: GpHudState): void {
    if (!this.mount()) return;
    this.updatePower(s);
    this.updateCash(s);
    const cbKey = `${s.comeback}|${s.reduceFlash}`;
    if (cbKey !== this.lastCb) {
      this.lastCb = cbKey;
      this.cb!.hidden = !s.comeback;
      document.body.classList.toggle('gp-comeback', s.comeback);
      document.body.classList.toggle('gp-calm', s.reduceFlash);
    }
  }

  private updatePower(s: GpHudState): void {
    const el = this.power!;
    const rows: string[] = [];
    if (!s.show) {
      if (this.lastPower) {
        this.lastPower = '';
        el.hidden = true;
      }
      return;
    }
    const row = (cls: string, c: string, icon: string, head: string, b: string) => `<div class="row ${cls}" style="--c:${c}"><span class="ic">${icon}</span><div class="m">${head}${b}</div></div>`;
    if (s.mech >= 0) rows.push(row(s.mechT < 5 ? 'low' : '', 'var(--yellow)', iconHtml('gp_mech', '#ffcd75', '♜'), `<div class="h"><span>MECH SUIT</span><b>${Math.ceil(s.mechT)}s</b></div>`, bar(s.mech)));
    if (s.super) {
      const left = s.super.flamer ? `FUEL ${Math.ceil(s.super.ammo)}s` : `${Math.ceil(s.super.ammo)}`;
      const name = s.super.t < 5 ? `${s.super.name.toUpperCase()} ${Math.ceil(s.super.t)}s` : s.super.name.toUpperCase();
      rows.push(row(s.super.ammo01 < 0.2 || s.super.t < 3 ? 'low' : '', s.super.color, iconHtml('gp_' + s.super.id, s.super.color, s.super.glyph), `<div class="h"><span>${name}</span><b>${left}</b></div>`, bar(s.super.ammo01)));
    }
    if (s.overload > -2) {
      const firing = s.overload < 0;
      const k = firing ? -s.overload : s.overload;
      rows.push(row(firing ? 'fire full' : k >= 0.95 ? 'full' : '', 'var(--lime)', `<span class="glyph">✷</span>`, `<div class="h"><span>${firing ? 'OVERLOAD!' : 'OVERLOAD'}</span><b>${firing ? 'FIRE!' : Math.floor(k * 100) + '%'}</b></div>`, bar(k)));
    }
    const key = rows.join('');
    if (key === this.lastPower) return;
    this.lastPower = key;
    el.innerHTML = key;
    el.hidden = !rows.length;
  }

  private updateCash(s: GpHudState): void {
    const el = this.cash!;
    const visible = s.show && s.combo >= s.minCost;
    const key = visible ? `${s.combo >= s.tiers[s.sel]?.cost}|${s.sel}|${s.afford.join()}|${s.tiers.map((t) => t.cost).join()}` : '';
    if (key === this.lastCash) return;
    this.lastCash = key;
    if (!visible) {
      el.hidden = true;
      return;
    }
    const rows = s.tiers
      .map((t, i) => `<div class="t ${s.afford[i] ? 'ok' : ''} ${i === s.sel ? 'sel' : ''}" style="--c:${t.color}"><span><span class="cur">${i === s.sel ? '▶' : ''}</span>${t.name}</span><span class="cost">${t.cost}</span></div>`)
      .join('');
    el.className = s.afford[s.sel] ? 'ready' : '';
    el.innerHTML = `<div class="h"><span>CASH IN COMBO</span>${prompt('cash')}</div>${rows}<div class="f">${prompt('cashpick')} SWITCH · RESETS COMBO</div>`;
    el.hidden = false;
  }
}

export const gameplayHud = new GameplayHud();
