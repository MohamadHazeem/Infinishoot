import { localizeHtml } from '../i18n';
import type { NetLevel } from '../net/netQuality';

/**
 * Network HUD (netcode lane):
 * - the NETWORK panel (SETTINGS > NETWORK STATS): each player's ping, packet
 *   loss and snapshot rate, plus this client's playout buffer and jitter;
 * - a signal-bars warning over any teammate whose connection is poor or bad,
 *   or who is reconnecting (shown online for everyone, whatever the setting);
 * - the CONNECTION LOST banner while this client reconnects.
 * Plain DOM, CSS injected once, the DOM only changes when what it shows does.
 */
const CSS = `
#net-panel, .net-tag, #net-lost {
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
  color: var(--white);
}
#net-panel {
  position: absolute;
  left: 20px;
  top: 42%;
  zoom: var(--ui, 1);
  padding: calc(2 * var(--p)) calc(3 * var(--p));
  font: 10px var(--label);
  letter-spacing: 1px;
  min-width: calc(62 * var(--p));
}
#net-panel[hidden], #net-lost[hidden] { display: none; }
#net-panel .hd { color: var(--cyan); margin-bottom: calc(1.5 * var(--p)); }
#net-panel .row { display: grid; grid-template-columns: calc(3 * var(--p)) 1fr auto auto auto; align-items: center; gap: calc(2 * var(--p)); line-height: 1.5; }
#net-panel .row i.c { width: calc(2 * var(--p)); height: calc(2 * var(--p)); background: var(--hc); box-shadow: 0 0 0 calc(0.5 * var(--p)) var(--ink); }
#net-panel .nm { white-space: nowrap; overflow: hidden; text-overflow: clip; max-width: calc(30 * var(--p)); }
#net-panel .nm small { color: var(--mist); font-size: 8px; margin-left: var(--p); }
#net-panel .v { font: 15px var(--font); letter-spacing: 0; text-align: right; min-width: calc(9 * var(--p)); }
#net-panel .v small { font: 8px var(--label); color: var(--mist); margin-left: 1px; }
#net-panel .good { color: var(--lime); }
#net-panel .poor { color: var(--yellow); }
#net-panel .bad { color: var(--red); }
#net-panel .rc { color: var(--orange); }
#net-panel .ft { margin-top: calc(1.5 * var(--p)); color: var(--mist); font-size: 8px; }
#net-tags { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.net-tag {
  position: absolute;
  transform: translate(-50%, -100%);
  zoom: var(--ui, 1);
  display: flex; align-items: center; gap: calc(1.5 * var(--p));
  padding: var(--p) calc(2 * var(--p));
  font: 9px var(--label);
  letter-spacing: 1px;
  white-space: nowrap;
}
.net-tag.poor { --bg: var(--ink); color: var(--yellow); }
.net-tag.bad { --bg: var(--plum); color: var(--white); }
.net-tag.rc { --bg: var(--ink); color: var(--orange); animation: net-blink 1s steps(2) infinite; }
.net-bars { display: inline-flex; align-items: flex-end; gap: calc(0.5 * var(--p)); height: calc(4 * var(--p)); }
.net-bars b { width: var(--p); background: var(--slate); }
.net-bars b:nth-child(1) { height: var(--p); }
.net-bars b:nth-child(2) { height: calc(2 * var(--p)); }
.net-bars b:nth-child(3) { height: calc(3 * var(--p)); }
.net-bars b:nth-child(4) { height: calc(4 * var(--p)); }
.net-bars b.on { background: currentColor; }
#net-lost {
  position: absolute;
  left: 50%;
  top: 22%;
  transform: translateX(-50%);
  zoom: var(--ui, 1);
  --bg: var(--plum);
  --hi: var(--red);
  padding: calc(3 * var(--p)) calc(6 * var(--p));
  text-align: center;
  font: 12px var(--label);
  letter-spacing: 2px;
}
#net-lost b { display: block; font: 26px var(--display); letter-spacing: 2px; font-weight: normal; color: var(--yellow); animation: net-blink 1.2s steps(2) infinite; }
#net-lost small { display: block; font: 13px var(--font); letter-spacing: 0; color: var(--mist); }
@keyframes net-blink { 50% { opacity: 0.55; } }
.reduce-flash .net-tag.rc, .reduce-flash #net-lost b { animation: none; }
`;

export interface NetRow {
  name: string;
  color: string;
  /** Round trip (ms); 0 = this is the host's own row or not measured. */
  rtt: number;
  /** Packet loss estimate (%). */
  loss: number;
  /** Snapshots per second this player receives (0 = host / unknown). */
  rate: number;
  you: boolean;
  host: boolean;
  /** Reconnecting: seconds left on autopilot; -1 = not responding; 0 = fine. */
  rc: number;
  level: NetLevel;
}

export interface NetTag {
  key: string;
  x: number;
  y: number;
  level: NetLevel | 'rc';
  text: string;
}

export interface NetView {
  panel: boolean;
  rows: NetRow[];
  /** This client's playout buffer (ms) and jitter (ms), or null on the host. */
  buffer: { delay: number; jitter: number } | null;
  tags: NetTag[];
  /** Reconnect banner: seconds left, or null. */
  lost: { secs: number; tries: number } | null;
}

const BARS: Record<NetLevel | 'rc', number> = { good: 4, poor: 2, bad: 1, rc: 0 };

export function barsHtml(level: NetLevel | 'rc'): string {
  const n = BARS[level];
  return `<span class="net-bars">${[0, 1, 2, 3].map((i) => `<b${i < n ? ' class="on"' : ''}></b>`).join('')}</span>`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export class NetOverlay {
  private panel: HTMLElement;
  private tags: HTMLElement;
  private lost: HTMLElement;
  private tagEls = new Map<string, HTMLElement>();
  private panelKey = '';
  private lostKey = '';
  private shown = false;

  constructor(root: HTMLElement = document.getElementById('hud') ?? document.body) {
    if (!document.getElementById('net-css')) {
      const st = document.createElement('style');
      st.id = 'net-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.panel = document.createElement('div');
    this.panel.id = 'net-panel';
    this.panel.hidden = true;
    this.tags = document.createElement('div');
    this.tags.id = 'net-tags';
    this.lost = document.createElement('div');
    this.lost.id = 'net-lost';
    this.lost.hidden = true;
    root.append(this.panel, this.tags, this.lost);
  }

  /** Nothing online to show: hide it all (cheap when already hidden). */
  idle(): void {
    if (!this.shown) return;
    this.shown = false;
    this.panel.hidden = true;
    this.lost.hidden = true;
    this.panelKey = this.lostKey = '';
    for (const el of this.tagEls.values()) el.remove();
    this.tagEls.clear();
  }

  render(v: NetView): void {
    this.shown = true;
    // Panel
    const key = v.panel ? JSON.stringify([v.rows, v.buffer && [Math.round(v.buffer.delay / 5), Math.round(v.buffer.jitter / 5)]]) : '';
    if (key !== this.panelKey) {
      this.panelKey = key;
      this.panel.hidden = !v.panel;
      if (v.panel) {
        const rows = v.rows
          .map((r) => {
            const lvl = r.rc ? 'rc' : r.level;
            const ping = r.host ? 'HOST' : r.rc > 0 ? `${r.rc}S` : r.rc < 0 ? '...' : r.rtt > 0 ? `${Math.round(r.rtt)}<small>MS</small>` : '--';
            return `<div class="row"><i class="c" style="--hc:${r.color}"></i><span class="nm"><bdi>${esc(r.name.toUpperCase().slice(0, 10))}</bdi>${r.you ? '<small>YOU</small>' : ''}</span><span class="v ${lvl}">${ping}</span><span class="v ${r.loss >= 2 ? (r.loss >= 6 ? 'bad' : 'poor') : ''}">${r.host ? '' : `${Math.round(r.loss)}<small>%</small>`}</span><span class="v">${r.host || !r.rate ? '' : `${Math.round(r.rate)}<small>/S</small>`}</span></div>`;
          })
          .join('');
        const ft = v.buffer ? `<div class="ft">BUFFER ${Math.round(v.buffer.delay)} MS · JITTER ${Math.round(v.buffer.jitter)} MS</div>` : '';
        this.panel.innerHTML = localizeHtml(`<div class="hd">NETWORK · PING · LOSS · SNAPS</div>${rows}${ft}`);
      }
    }
    // Tags over teammates
    const seen = new Set<string>();
    for (const t of v.tags) {
      seen.add(t.key);
      let el = this.tagEls.get(t.key);
      if (!el) {
        el = document.createElement('div');
        el.className = 'net-tag';
        this.tags.appendChild(el);
        this.tagEls.set(t.key, el);
      }
      const html = `${barsHtml(t.level)}${esc(t.text)}`;
      if (el.dataset.h !== html) {
        el.dataset.h = html;
        el.innerHTML = localizeHtml(html);
        el.className = `net-tag ${t.level}`;
      }
      el.style.left = `${Math.round(t.x)}px`;
      el.style.top = `${Math.round(t.y)}px`;
    }
    for (const [k, el] of this.tagEls) {
      if (seen.has(k)) continue;
      el.remove();
      this.tagEls.delete(k);
    }
    // Reconnect banner
    const lk = v.lost ? `${v.lost.secs}|${v.lost.tries}` : '';
    if (lk !== this.lostKey) {
      this.lostKey = lk;
      this.lost.hidden = !v.lost;
      if (v.lost) this.lost.innerHTML = localizeHtml(`CONNECTION LOST<b>RECONNECTING... ${v.lost.secs}S</b><small>YOUR HERO IS ON AUTOPILOT · TRY ${v.lost.tries}</small>`);
    }
  }
}
