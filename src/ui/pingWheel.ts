import { PING_KINDS } from '../game/teamPlay';

/**
 * The co-op ping wheel (src/game/teamPlay.ts drives it): six pixel-framed
 * slices around the cursor, the picked one lit. Plain DOM, injects its own CSS.
 */
const CSS = `
#ping-wheel { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 40; pointer-events: none; }
#ping-wheel[hidden] { display: none; }
#ping-wheel .pw-hub { position: absolute; left: calc(-1 * var(--p, 4px)); top: calc(-1 * var(--p, 4px)); width: calc(2 * var(--p, 4px)); height: calc(2 * var(--p, 4px)); background: var(--white); box-shadow: 0 0 0 var(--p, 4px) var(--ink); }
#ping-wheel .pw-item { position: absolute; transform: translate(-50%, -50%); padding: calc(1.5 * var(--p, 4px)) calc(2.5 * var(--p, 4px)); font: 22px var(--font); white-space: nowrap; color: var(--white); background: var(--night); box-shadow: 0 0 0 var(--p, 4px) var(--ink), inset 0 calc(-1 * var(--p, 4px)) 0 var(--ink); }
#ping-wheel .pw-item i { display: inline-block; width: calc(2 * var(--p, 4px)); height: calc(2 * var(--p, 4px)); margin-right: calc(1.5 * var(--p, 4px)); background: var(--c); vertical-align: middle; }
#ping-wheel .pw-item.on { color: var(--ink); background: var(--c); box-shadow: 0 0 0 var(--p, 4px) var(--white), inset 0 calc(-1 * var(--p, 4px)) 0 rgba(0, 0, 0, 0.25); }
#ping-wheel .pw-item.on i { background: var(--ink); }
#ping-wheel .pw-tip { position: absolute; left: 0; top: calc(16 * var(--p, 4px) + 92px); transform: translateX(-50%); font: 12px var(--label); color: var(--white); white-space: nowrap; }
`;

export class PingWheel {
  private el: HTMLElement;
  private items: HTMLElement[] = [];

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
    let html = '<div class="pw-hub"></div>';
    PING_KINDS.forEach((k, i) => {
      const a = (i / PING_KINDS.length) * Math.PI * 2; // 0 = up, clockwise
      const x = Math.round(Math.sin(a) * R * 1.25);
      const y = Math.round(-Math.cos(a) * R);
      html += `<div class="pw-item" style="left:${x}px;top:${y}px;--c:${k.color}"><i></i>${k.label.replace('!', '')}</div>`;
    });
    html += '<div class="pw-tip">RELEASE TO PING</div>';
    this.el.innerHTML = html;
    this.items = [...this.el.querySelectorAll<HTMLElement>('.pw-item')];
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

  hide(): void {
    this.el.hidden = true;
  }
}
