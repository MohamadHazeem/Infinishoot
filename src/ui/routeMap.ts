/**
 * ROUTE MAP screen: the road taken so far, the 2-3 nodes you can pick next and a couple of
 * layers beyond, plus one choice card per option (the cards are the `data-nav` items, so keyboard,
 * gamepad and touch all work; clicking a node on the map picks it too). The Event phase reuses
 * the cards for the encounter's options. Plain DOM in the pixel style; styles live here so the
 * screen stays self-contained.
 */
import { ROUTE_NODES, type NodeKind } from '../data/routeNodes';
import { iconHtml } from './pixelIcons';

export interface RouteViewLayer {
  stage: number;
  nodes: { kind: NodeKind; col: number }[];
  /** Per node: indices of the next layer's nodes it leads to. */
  edges: number[][];
  /** The stage ends with the final boss. */
  final: boolean;
  biome: string;
}

export interface RouteView {
  phase: 'map' | 'event';
  /** The stage just cleared; the choice is for stage + 1. */
  stage: number;
  layers: RouteViewLayer[];
  /** Picked node index per stage (path[stage]). */
  path: number[];
  /** Indices into layer stage + 1 that can be picked. */
  options: number[];
  event?: { name: string; text: string; color: string; options: { label: string; desc: string; color: string }[] };
  /** Co-op vote markers (option index into `options`, or the event option). */
  votes: { name: string; color: string; option: number }[];
  /** Seconds before the vote is decided (-1: solo, no timer). */
  timeLeft: number;
  myVote: number;
  /** A client waiting for the host to resolve (the cards still vote). */
  coop: boolean;
}

const CSS = `
#scr-route { gap: 12px; }
#scr-route h1 { font-size: 52px; }
#scr-route .rt-sub { font: 14px var(--label); color: var(--mist); text-shadow: var(--outline); letter-spacing: 1px; margin-top: -6px; }
#scr-route .rt-map {
  position: relative; width: min(92vw, 880px); height: calc(36 * var(--p) + 150px); flex: none;
  --bg: var(--ink); --hi: var(--night); --lo: var(--ink);
  background-color: rgba(26, 28, 44, 0.72);
}
#scr-route.ev .rt-map { opacity: 0.55; }
#scr-route .rt-field { position: absolute; left: 0; right: 0; top: 78px; bottom: 26px; }
#scr-route .rt-map svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
#scr-route .rt-map line { stroke: var(--slate); stroke-width: 3; stroke-dasharray: 6 6; vector-effect: non-scaling-stroke; shape-rendering: crispEdges; }
#scr-route .rt-map line.taken { stroke: var(--yellow); stroke-dasharray: none; stroke-width: 5; }
#scr-route .rt-map line.open { stroke: var(--white); stroke-dasharray: 9 6; stroke-width: 4; animation: rt-march 0.6s steps(3) infinite; }
@keyframes rt-march { to { stroke-dashoffset: -15; } }
#scr-route .rt-col { position: absolute; top: 4px; transform: translateX(-50%); font: 12px var(--label); color: var(--mist); text-shadow: var(--outline); white-space: nowrap; text-align: center; line-height: 1.25; }
#scr-route .rt-col.now { color: var(--yellow); }
#scr-route .rt-col b { display: block; font: 18px var(--display); color: inherit; letter-spacing: 1px; }
#scr-route .rt-col.final b::after { content: ' ★'; color: var(--red); }
#scr-route .rn {
  position: absolute; width: 36px; height: 36px; transform: translate(-50%, -50%);
  display: grid; place-items: center; --bg: var(--night); --hi: var(--slate); --lo: var(--ink); opacity: 0.55;
}
#scr-route .rn img, #scr-route .rn .glyph { width: 24px; height: 24px; }
#scr-route .rn.past { opacity: 0.35; }
#scr-route .rn.taken { opacity: 1; --ring: var(--yellow); }
#scr-route .rn.here { opacity: 1; --ring: var(--white); }
#scr-route .rn.opt { opacity: 1; width: 44px; height: 44px; --bg: var(--c); --hi: var(--white); --ring: var(--ink); cursor: pointer; animation: rt-bob 0.8s steps(2) infinite; }
#scr-route .rn.lit { --ring: var(--white); animation: rt-bob 0.4s steps(2) infinite; z-index: 2; }
#scr-route .rn.chosen { --ring: var(--yellow); animation: none; }
@keyframes rt-bob { 50% { translate: 0 calc(-1 * var(--p)); } }
#scr-route .rn .vt { position: absolute; bottom: calc(-4 * var(--p)); left: 50%; transform: translateX(-50%); display: flex; gap: 2px; }
#scr-route .vt i { width: calc(3 * var(--p)); height: calc(3 * var(--p)); background: var(--c); box-shadow: 0 0 0 var(--p) var(--ink); }
#scr-route .rt-cards { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; }
#scr-route button.rc {
  width: 236px; min-height: 172px; padding: 12px 14px 14px; display: flex; flex-direction: column; align-items: center; gap: 6px;
  --bg: var(--night); --hi: var(--slate); --lo: var(--ink); text-align: center; animation: rt-deal 0.24s steps(3) both;
}
#scr-route button.rc:nth-child(2) { animation-delay: 0.06s; }
#scr-route button.rc:nth-child(3) { animation-delay: 0.12s; }
@keyframes rt-deal { from { translate: 0 calc(8 * var(--p)); opacity: 0; } }
#scr-route button.rc.focused { --bg: var(--navy); --hi: var(--c); --lo: var(--ink); --ring: var(--white); }
#scr-route button.rc.mine { --ring: var(--yellow); }
#scr-route .rc .ic { width: 64px; height: 64px; display: grid; place-items: center; --bg: var(--c); --hi: var(--white); --lo: var(--ink); }
#scr-route .rc .ic img, #scr-route .rc .ic .glyph { width: 48px; height: 48px; }
#scr-route .rc .nm { font: 30px var(--display); color: var(--white); letter-spacing: 1px; text-shadow: var(--outline), 0 calc(2 * var(--o)) 0 var(--c), 0 calc(3 * var(--o)) 0 var(--ink); line-height: 1; margin-bottom: 4px; }
#scr-route .rc .sh { font: 20px var(--font); color: var(--white); line-height: 1.05; }
#scr-route .rc ul { margin: 2px 0 0; padding: 0; list-style: none; font: 18px var(--font); color: var(--mist); line-height: 1.05; text-shadow: none; }
#scr-route .rc li::before { content: '▸ '; color: var(--c); }
#scr-route .rc .vt { display: flex; gap: 4px; min-height: calc(4 * var(--p)); margin-top: auto; }
#scr-route .rc .vt i { width: auto; height: auto; padding: 0 4px; font: 12px var(--label); font-style: normal; color: var(--ink); text-shadow: none; }
#scr-route .rt-ev { max-width: 640px; text-align: center; }
#scr-route .rt-ev b { display: block; font: 40px var(--display); color: var(--white); text-shadow: var(--outline), 0 calc(2 * var(--o)) 0 var(--c), 0 calc(3 * var(--o)) 0 var(--ink); letter-spacing: 1px; }
#scr-route .rt-ev span { font: 22px var(--font); color: var(--white); text-shadow: var(--outline); }
#scr-route .rt-status { font: 22px var(--font); color: var(--yellow); text-shadow: var(--outline); min-height: 26px; }
#scr-route:has(button.rc[data-ri="0"].focused) .rn[data-o="0"],
#scr-route:has(button.rc[data-ri="1"].focused) .rn[data-o="1"],
#scr-route:has(button.rc[data-ri="2"].focused) .rn[data-o="2"] { --ring: var(--white); animation-duration: 0.4s; z-index: 2; }
@media (max-height: 760px) {
  #scr-route { gap: 8px; padding-top: 10px; }
  #scr-route h1 { font-size: 44px; }
  #scr-route .rt-map { height: calc(30 * var(--p) + 124px); }
  #scr-route button.rc { min-height: 150px; width: 220px; padding: 8px 12px 10px; }
  #scr-route .rc .ic { width: 52px; height: 52px; }
  #scr-route .rc ul { font-size: 16px; }
}
`;

let styled = false;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class RouteMapView {
  private view: RouteView | null = null;

  /** `onPick(i)`: index into the view's options (map) or the event's options. */
  constructor(
    private readonly el: HTMLElement,
    private readonly onPick: (i: number) => void,
  ) {
    if (!styled) {
      styled = true;
      const s = document.createElement('style');
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-ri]');
      if (!t || !this.view) return;
      this.onPick(Number(t.dataset.ri));
    });
  }

  render(v: RouteView): void {
    this.view = v;
    this.el.classList.toggle('ev', v.phase === 'event');
    const next = v.stage + 1;
    const title = v.phase === 'event' ? 'ENCOUNTER' : 'ROUTE MAP';
    const sub = v.phase === 'event' ? `ON THE WAY TO STAGE ${next}` : `CHOOSE THE ROAD TO STAGE ${next}`;
    this.el.innerHTML = `<h1>${title}</h1><div class="rt-sub">${sub}</div>${this.mapHtml(v)}${v.phase === 'event' ? this.eventHtml(v) : ''}<div class="rt-cards">${this.cardsHtml(v)}</div><div class="rt-status">${this.statusText(v)}</div>`;
  }

  /** Only the countdown line changes between votes. */
  setStatus(v: RouteView): void {
    this.view = v;
    const s = this.el.querySelector('.rt-status');
    if (s) s.textContent = this.statusText(v);
  }

  private statusText(v: RouteView): string {
    if (v.timeLeft < 0) return v.phase === 'event' ? 'MAKE YOUR CHOICE' : 'PICK YOUR NEXT STOP';
    const t = Math.max(0, Math.ceil(v.timeLeft));
    return v.myVote < 0 ? `VOTE NOW · DECIDED IN ${t}` : `VOTED · WAITING FOR THE TEAM · ${t}`;
  }

  private mapHtml(v: RouteView): string {
    const L = v.layers.length;
    const x = (k: number) => ((k + 0.5) / L) * 100;
    // Rows 0..4 below the stage labels.
    const y = (col: number) => (col / 4) * 100;
    const lines: string[] = [];
    const nodes: string[] = [];
    const heads: string[] = [];
    v.layers.forEach((layer, k) => {
      const s = layer.stage;
      const picked = v.path[s];
      const isNext = s === v.stage + 1;
      heads.push(`<div class="rt-col${s === v.stage ? ' now' : ''}${layer.final ? ' final' : ''}" style="left:${x(k)}%"><b>STAGE ${s}</b>${esc(layer.biome.toUpperCase())}</div>`);
      const nextLayer = v.layers[k + 1];
      if (nextLayer) {
        layer.edges.forEach((to, i) => {
          for (const j of to) {
            const taken = picked === i && v.path[s + 1] === j;
            const open = s === v.stage && picked === i && v.phase === 'map' && v.options.includes(j);
            if (s < v.stage && !taken) continue; // roads not taken behind you fade out
            lines.push(`<line x1="${x(k)}%" y1="${y(layer.nodes[i].col)}%" x2="${x(k + 1)}%" y2="${y(nextLayer.nodes[j].col)}%" class="${taken ? 'taken' : open ? 'open' : ''}"/>`);
          }
        });
      }
      layer.nodes.forEach((n, i) => {
        const def = ROUTE_NODES[n.kind];
        const opt = isNext && v.phase === 'map' ? v.options.indexOf(i) : -1;
        let cls = '';
        if (s <= v.stage) cls = picked === i ? (s === v.stage ? 'here' : 'taken') : 'past';
        else if (isNext && v.phase === 'event' && picked === i) cls = 'chosen opt';
        else if (opt >= 0) cls = `opt${v.myVote === opt ? ' lit' : ''}`;
        const votes = opt >= 0 ? v.votes.filter((vt) => vt.option === opt) : [];
        const vt = votes.length ? `<span class="vt">${votes.map((vt) => `<i style="--c:${vt.color}"></i>`).join('')}</span>` : '';
        nodes.push(
          `<span class="rn px ${cls}" ${opt >= 0 ? `data-ri="${opt}" data-o="${opt}"` : ''} style="left:${x(k)}%;top:${y(n.col)}%;--c:${def.color}" title="${esc(def.name)}">${iconHtml(def.icon, opt >= 0 || cls.includes('chosen') ? '#f4f4f4' : def.color, def.glyph)}${vt}</span>`,
        );
      });
    });
    return `<div class="rt-map px">${heads.join('')}<div class="rt-field"><svg aria-hidden="true">${lines.join('')}</svg>${nodes.join('')}</div></div>`;
  }

  private eventHtml(v: RouteView): string {
    const e = v.event!;
    return `<div class="rt-ev" style="--c:${e.color}"><b>${esc(e.name.toUpperCase())}</b><span>${esc(e.text)}</span></div>`;
  }

  private voteChips(v: RouteView, i: number): string {
    if (v.timeLeft < 0) return '';
    return `<span class="vt">${v.votes
      .filter((vt) => vt.option === i)
      .map((vt) => `<i style="--c:${vt.color}">${esc(vt.name.toUpperCase().slice(0, 8))}</i>`)
      .join('')}</span>`;
  }

  private cardsHtml(v: RouteView): string {
    if (v.phase === 'event') {
      return v.event!.options
        .map(
          (o, i) =>
            `<button class="rc${v.myVote === i ? ' mine' : ''}" data-nav data-ri="${i}" style="--c:${o.color}"><span class="nm">${esc(o.label)}</span><span class="sh">${esc(o.desc)}</span>${this.voteChips(v, i)}</button>`,
        )
        .join('');
    }
    const layer = v.layers.find((l) => l.stage === v.stage + 1);
    return v.options
      .map((idx, i) => {
        const n = layer?.nodes[idx];
        if (!n) return '';
        const def = ROUTE_NODES[n.kind];
        return `<button class="rc${v.myVote === i ? ' mine' : ''}" data-nav data-ri="${i}" style="--c:${def.color}"><span class="ic px">${iconHtml(def.icon, '#f4f4f4', def.glyph)}</span><span class="nm">${esc(def.name.toUpperCase())}</span><span class="sh">${esc(def.short)}</span><ul>${def.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>${this.voteChips(v, i)}</button>`;
      })
      .join('');
  }
}
