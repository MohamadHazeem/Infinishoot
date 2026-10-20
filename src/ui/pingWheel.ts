import { SQUAD_ORDERS } from '../game/aisquadBrain';
import { orderLabel } from '../game/systems/aisquad';
import { t } from '../i18n';
import { localizeHtml } from '../i18n';
import { PING_KINDS } from '../game/teamPlay';
import { emoteWheel, emoteWheelKey } from '../game/systems/season';

/**
 * The co-op ping wheel (src/game/teamPlay.ts drives it): six pixel-framed
 * slices around the cursor, the picked one lit. Two pages: PINGS and EMOTES
 * (coop2 lane), switched with Tab, the mouse wheel or LB / RB while it's open.
 * Plain DOM, injects its own CSS.
 */
const CSS = `
#ping-wheel { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 40; pointer-events: none; }
#ping-wheel[hidden] { display: none; }
#ping-wheel .pw-hub { position: absolute; left: calc(-1 * var(--p, 4px)); top: calc(-1 * var(--p, 4px)); width: calc(2 * var(--p, 4px)); height: calc(2 * var(--p, 4px)); background: var(--white); box-shadow: 0 0 0 var(--p, 4px) var(--ink); }
#ping-wheel .pw-item { position: absolute; transform: translate(-50%, -50%); padding: calc(1.5 * var(--p, 4px)) calc(2.5 * var(--p, 4px)); font: 22px var(--font); white-space: nowrap; color: var(--white); background: var(--night); box-shadow: 0 0 0 var(--p, 4px) var(--ink), inset 0 calc(-1 * var(--p, 4px)) 0 var(--ink); }
#ping-wheel .pw-item i { display: inline-block; width: calc(2 * var(--p, 4px)); height: calc(2 * var(--p, 4px)); margin-right: calc(1.5 * var(--p, 4px)); background: var(--c); vertical-align: middle; }
#ping-wheel .pw-item.on { color: var(--ink); background: var(--c); box-shadow: 0 0 0 var(--p, 4px) var(--white), inset 0 calc(-1 * var(--p, 4px)) 0 var(--slate); }
#ping-wheel .pw-item.on i { background: var(--ink); }
#ping-wheel .pw-tip { position: absolute; left: 0; top: calc(16 * var(--p, 4px) + 92px); transform: translateX(-50%); font: 12px var(--label); color: var(--white); white-space: nowrap; }
#ping-wheel .pw-tabs { position: absolute; left: 0; top: calc(-16 * var(--p, 4px) - 96px); transform: translateX(-50%); display: flex; gap: calc(2 * var(--p, 4px)); font: 12px var(--label); white-space: nowrap; }
#ping-wheel .pw-tabs span { padding: var(--p, 4px) calc(2 * var(--p, 4px)); color: var(--mist); background: var(--ink); }
#ping-wheel .pw-tabs span.on { color: var(--ink); background: var(--yellow); }
#ping-wheel .pw-tabs span[hidden], #ping-wheel .pw-item[hidden] { display: none; }
`;

export class PingWheel {
  private el: HTMLElement;
  private items: HTMLElement[] = [];
  private pages: HTMLElement[][] = [];
  private tabs: HTMLElement[] = [];
  page = 0;
  /** Which season emote (if any) this wheel was built with (src/game/systems/season.ts). */
  readonly key = emoteWheelKey();

  constructor() {
    if (!document.getElementById('ping-wheel-css')) {
      const st = document.createElement('style');
      st.id = 'ping-wheel-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.id = 'ping-wheel';
    this.el.hidden = true;
    const R = 110;
    let html = `<div class="pw-hub"></div><div class="pw-tabs"><span>PINGS</span><span>EMOTES</span><span>${t('squad.orders')}</span></div>`;
    const pages = [PING_KINDS.map((k) => ({ label: k.label.replace('!', ''), color: k.color })), emoteWheel().map((e) => ({ label: e.label, color: e.color })), SQUAD_ORDERS.map((o) => ({ label: orderLabel(o), color: '#73eff7' }))];
    pages.forEach((items, pg) =>
      items.forEach((k, i) => {
        const a = (i / items.length) * Math.PI * 2; // 0 = up, clockwise
        const x = Math.round(Math.sin(a) * R * 1.25);
        const y = Math.round(-Math.cos(a) * R);
        html += `<div class="pw-item" data-pg="${pg}" style="left:${x}px;top:${y}px;--c:${k.color}"><i></i>${k.label}</div>`;
      }),
    );
    html += '<div class="pw-tip">RELEASE TO SEND · TAB / WHEEL / LB RB: PAGE</div>';
    this.el.innerHTML = localizeHtml(html);
    this.pages = [0, 1, 2].map((pg) => [...this.el.querySelectorAll<HTMLElement>(`.pw-item[data-pg="${pg}"]`)]);
    this.tabs = [...this.el.querySelectorAll<HTMLElement>('.pw-tabs span')];
    this.setPage(0);
    document.body.appendChild(this.el);
  }

  show(x: number, y: number): void {
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    this.el.hidden = false;
    this.select(-1);
  }

  select(i: number): void {
    this.items.forEach((it, k) => it.classList.toggle('on', k === i));
  }

  squad(on: boolean): void {
    this.tabs[2].hidden = !on;
    if (!on && this.page === 2) this.setPage(0);
  }

  /** Show pings, emotes or squad orders. */
  setPage(p: number): void {
    this.page = p;
    this.items = this.pages[p] ?? [];
    this.pages.forEach((items, k) => items.forEach((it) => (it.hidden = k !== p)));
    this.tabs.forEach((t, k) => t.classList.toggle('on', k === p));
    this.select(-1);
  }

  hide(): void {
    this.el.hidden = true;
  }

  destroy(): void {
    this.el.remove();
  }
}
