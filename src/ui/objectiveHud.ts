import type { Objective } from '../game/objectives';

/**
 * Stage objective tracker (top left, under the gold) plus an edge-of-screen
 * arrow toward the nearest objective target. Plain DOM in the pixel UI style;
 * its styles are injected once so the lane needs no edits to style.css.
 */
const CSS = `
#objective {
  position: absolute;
  top: calc(19 * var(--p) + 30px);
  left: 18px;
  min-width: 190px;
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
#objective .h {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font: 10px var(--label);
  letter-spacing: 1px;
  color: var(--yellow);
}
#objective .t {
  font: 20px var(--font);
  color: var(--white);
  line-height: 1.1;
  margin-top: 2px;
}
#objective .s {
  font: 13px var(--font);
  color: var(--mist);
}
#objective .bar {
  display: flex;
  gap: var(--p);
  margin-top: calc(2 * var(--p));
  height: calc(3 * var(--p));
}
#objective .bar i {
  flex: 1;
  background: var(--ink);
}
#objective .bar i.on {
  background: var(--yellow);
}
#objective .hp {
  margin-top: var(--p);
  height: var(--p);
  background: var(--ink);
}
#objective .hp div {
  height: 100%;
  background: var(--cyan);
}
#objective.done { --bg: var(--teal); --hi: var(--green); }
#objective.done .h, #objective.done .s { color: var(--lime); }
#objective.done .bar i { background: var(--lime); }
#objective.failed { --bg: var(--plum); --hi: var(--red); }
#objective.failed .h, #objective.failed .s { color: var(--orange); }
#objective.pop { animation: objpop 0.45s steps(3); }
@keyframes objpop {
  0% { transform: translateY(calc(-2 * var(--p))) scale(1.08); }
  100% { transform: none; }
}
#objptr {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  font: 12px var(--label);
  color: var(--yellow);
  text-shadow: var(--outline);
  text-align: center;
}
#objptr .a {
  position: absolute;
  left: -9px;
  top: -9px;
  width: 18px;
  height: 18px;
  background: var(--yellow);
  clip-path: polygon(0 0, 100% 50%, 0 100%, 25% 50%);
}
#objptr .m {
  position: absolute;
  left: -40px;
  top: 14px;
  width: 80px;
}
`;

export class ObjectiveHud {
  private el: HTMLElement | null = null;
  private ptr: HTMLElement | null = null;
  private last = '';
  private lastState = '';

  private mount(): boolean {
    if (this.el) return true;
    const root = document.getElementById('ingame');
    if (!root) return false;
    if (!document.getElementById('objective-css')) {
      const st = document.createElement('style');
      st.id = 'objective-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.id = 'objective';
    this.el.hidden = true;
    this.ptr = document.createElement('div');
    this.ptr.id = 'objptr';
    this.ptr.hidden = true;
    this.ptr.innerHTML = '<div class="a"></div><div class="m"></div>';
    root.append(this.el, this.ptr);
    return true;
  }

  /** Called every frame; only touches the DOM when something changed. */
  update(o: Objective | null, ptr: { x: number; y: number; ang: number; dist: number } | null): void {
    if (!this.mount()) return;
    const el = this.el!;
    const p = this.ptr!;
    if (!o) {
      el.hidden = true;
      p.hidden = true;
      this.last = '';
      return;
    }
    const segs = o.kind === 'beacon' ? 10 : o.kind === 'envkills' ? 10 : o.max;
    const on = Math.floor((Math.min(o.cur, o.max) / Math.max(1, o.max)) * segs + 1e-6);
    const hp = o.kind === 'beacon' && o.active ? Math.round(o.hp) : -1;
    const sub = o.state === 'done' ? 'COMPLETE! CHEST + GOLD' : o.state === 'failed' ? 'FAILED' : o.hint;
    const key = `${o.kind}|${o.state}|${o.count}|${sub}|${on}|${hp}`;
    if (key !== this.last) {
      this.last = key;
      let bar = '';
      for (let i = 0; i < segs; i++) bar += `<i class="${i < on ? 'on' : ''}"></i>`;
      el.innerHTML =
        `<div class="h"><span>★ OBJECTIVE</span><span>${o.count}</span></div>` +
        `<div class="t">${o.title}</div><div class="s">${sub}</div><div class="bar">${bar}</div>` +
        (hp >= 0 ? `<div class="hp"><div style="width:${hp}%"></div></div>` : '');
      el.className = o.state === 'active' ? '' : o.state;
      if (o.state !== this.lastState && this.lastState) {
        el.classList.add('pop');
      }
      this.lastState = o.state;
    }
    el.hidden = false;
    if (ptr && o.active) {
      p.hidden = false;
      p.style.transform = `translate(${Math.round(ptr.x)}px, ${Math.round(ptr.y)}px)`;
      (p.firstElementChild as HTMLElement).style.transform = `rotate(${ptr.ang}rad)`;
      const m = p.lastElementChild as HTMLElement;
      const txt = `${ptr.dist}M`;
      if (m.textContent !== txt) m.textContent = txt;
    } else p.hidden = true;
  }
}
