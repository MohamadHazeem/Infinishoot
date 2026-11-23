import { BIOME_BY_ID } from '../data/biomes';
import { ISLANDS, legCount, ports, type Island, type Passage } from '../data/islands';
import type { Game } from '../game/game';
import type { Chart, Voyage } from '../game/overworld';
import { getLanguage, localize, onLanguageChange, t } from '../i18n';
import { rivalName } from './nemesisUi';
import { prompt } from './prompts';

const name = (i: number) => localize(BIOME_BY_ID[ISLANDS[i].id].name);
const paint = (d: string, color: string) => `<path d="${d}" fill="var(--${color})"/>`;
const rect = (x: number, y: number, w: number, h: number, color: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="var(--${color})"/>`;

/** Pixel landmarks are drawn at chart resolution and reused for the selected port's seal. */
const art: Record<Island['id'], [string, string]> = {
  meadow: [
    'lime',
    paint('M-8 0v-4h2v-4h2v-4h3v4h2v4h2v4z', 'green') +
      rect(-3, 0, 2, 3, 'plum') +
      rect(4, -4, 4, 4, 'yellow') +
      rect(5, -3, 2, 2, 'orange'),
  ],
  dunes: [
    'yellow',
    paint('M-9 1v-2h2v-3h2v-3h2v-4h2v4h2v3h2v3h2v2z', 'orange') +
      paint('M-1-11v4h2v3h2v3h2v2h-6z', 'red') +
      rect(6, -3, 2, 5, 'green'),
  ],
  peaks: [
    'cyan',
    paint('M-10 2v-3h2v-3h2v-4h2v-4h2v4h2v4h2v3h2v3z', 'blue') +
      paint('M-6-4v-4h2v-4h2v4h2v4h-3v-2h-1v2z', 'white') +
      paint('M1 2v-4h2v-4h2v-3h2v4h2v4h2v3z', 'sky'),
  ],
  neon: [
    'sky',
    rect(-8, -6, 4, 8, 'plum') +
      rect(-3, -13, 6, 15, 'navy') +
      rect(4, -8, 4, 10, 'plum') +
      rect(-2, -11, 2, 6, 'cyan') +
      rect(5, -6, 2, 2, 'orange') +
      rect(-7, -4, 2, 2, 'yellow'),
  ],
  factory: [
    'orange',
    rect(-7, -6, 14, 8, 'red') +
      rect(-6, -11, 3, 6, 'night') +
      rect(-6, -11, 3, 2, 'white') +
      paint('M-1-6v-3h3v3h2v-3h3v3z', 'orange') +
      rect(-4, -4, 2, 2, 'yellow') +
      rect(1, -4, 2, 2, 'yellow'),
  ],
  candy: [
    'lime',
    rect(-5, -7, 2, 9, 'white') +
      paint('M-9-11h2v-2h5v2h2v5h-2v2h-5v-2h-2z', 'red') +
      rect(-7, -10, 4, 2, 'orange') +
      rect(4, -5, 2, 8, 'white') +
      rect(2, -8, 6, 5, 'plum') +
      rect(3, -8, 3, 2, 'white'),
  ],
  ruins: [
    'teal',
    rect(-8, -8, 15, 2, 'mist') +
      rect(-9, -6, 17, 2, 'sky') +
      rect(-7, -4, 3, 7, 'white') +
      rect(0, -4, 3, 6, 'mist') +
      rect(5, -1, 3, 4, 'mist') +
      rect(-9, 2, 18, 2, 'slate'),
  ],
  magma: [
    'orange',
    paint('M-10 3v-3h3v-3h2v-4h2v-3h6v3h2v4h2v3h3v3z', 'plum') +
      paint('M-3-10h6v3h-2v5h3v4h-3v-3h-3v-6h-1z', 'orange') +
      rect(-1, -14, 2, 2, 'yellow') +
      rect(3, -16, 2, 2, 'red'),
  ],
  sky: [
    'white',
    rect(-8, -7, 4, 9, 'mist') +
      rect(3, -9, 5, 11, 'mist') +
      rect(-4, -4, 8, 6, 'slate') +
      rect(-2, -12, 4, 10, 'white') +
      rect(-3, -13, 6, 2, 'blue') +
      rect(-2, -15, 4, 2, 'yellow') +
      rect(-6, -7, 2, 2, 'navy'),
  ],
};
function islandArt(island: Island, free: boolean) {
  const [grass, landmark] = art[island.id];
  const port =
    free && 'port' in island
      ? paint('M-14 0v-4h2v-2h5v2h2v4z', 'ink') +
        rect(
          -12,
          -4,
          6,
          2,
          island.port === 'market' ? 'orange' : island.port === 'rest' ? 'lime' : 'yellow',
        ) +
        rect(-11, -2, 4, 3, 'white') +
        rect(-10, -1, 2, 2, 'blue')
      : '';
  return (
    paint('M-14 2h3v-3h5v-1h13v2h5v2h3v5h-4v2h-5v2h-12v-2h-5v-2h-3z', 'navy') +
    paint('M-14 0h3v-2h6v-2h11v2h6v2h3v4h-4v2h-5v2H-6V6h-5V4h-3z', 'slate') +
    paint('M-14 0h4v-2h5v-2h11v2h6v2h3v2h-4v2h-5v2H-6V4h-5V2h-3z', grass) +
    landmark +
    port +
    (free
      ? rect(9, -12, 1, 13, 'white') +
        paint('M10-12h8v2h-2v2h-6z', 'lime') +
        rect(-10, 0, 3, 2, 'yellow')
      : '')
  );
}

function chartArt(cleared: number): string {
  let waves = '';
  for (let y = 8; y < 144; y += 13)
    for (let x = (y * 13) % 21; x < 240; x += 31) {
      waves += paint(`M${x} ${y}h3v-1h2v1h3v1h-8z`, (x + y) % 3 ? 'blue' : 'sky');
    }
  const shelf = paint(
    'M0 119h11v-7h11v-2h24v4h17v3h32v-6h19v-6h25v-6h14v5h15v6h25v10h-19v-4h-18v-5h-20v5h-21v6h-12v5H67v-4H40v-5H21v6H0z',
    'blue',
  );
  const islets = [
    [11, 64],
    [16, 66],
    [218, 127],
    [225, 128],
    [93, 19],
  ]
    .map(
      ([x, y]) =>
        `<g transform="translate(${x} ${y})">${paint('M-3 1v-2h2v-2h2v2h2v2z', 'teal')}${rect(-4, 1, 8, 1, 'sky')}</g>`,
    )
    .join('');
  const b = ISLANDS[Math.min(cleared, ISLANDS.length - 1)];
  const boat = `<g transform="translate(${b.x - 15} ${b.y + 10})">${paint('M-5 0h11l-3 3h-6z', 'orange')}${rect(0, -9, 1, 9, 'ink')}${paint('M-1-8v7h-5z', 'white')}${paint('M1-6v5h4z', 'yellow')}</g>`;
  const lanes = ISLANDS.slice(1)
    .map((b, i) => {
      const a = ISLANDS[i];
      return `<path d="M${a.x} ${a.y}L${b.x} ${b.y}" fill="none" stroke="var(--${i < cleared ? 'cyan' : 'slate'})" stroke-width="2" stroke-dasharray="3 3"/>`;
    })
    .join('');
  const ferry =
    cleared >= 3
      ? '<path d="M129 101v27h62v-17" fill="none" stroke="var(--yellow)" stroke-dasharray="2 3"/>'
      : '';
  const compass =
    '<g transform="translate(216 22)">' +
    paint('M0-12l3 9 8 3-8 3-3 9-3-9-8-3 8-3z', 'sky') +
    paint('M0-12v12h-4z', 'yellow') +
    paint('M0 0h4l-4 12z', 'white') +
    '</g>';
  return `<svg viewBox="0 0 240 144" aria-hidden="true" shape-rendering="crispEdges">${rect(0, 0, 240, 144, 'navy')}${shelf}${waves}${islets}${lanes}${ferry}${compass}${ISLANDS.map((s, i) => `<g transform="translate(${s.x} ${s.y})">${islandArt(s, i < cleared)}</g>`).join('')}${boat}</svg>`;
}

export class OverworldUi {
  onOpen = () => {};
  private index = 0;
  private passage: Passage = 'coast';
  private readonly el = document.createElement('div');

  constructor(
    private g: Game,
    root: HTMLElement,
    private chart: () => Chart,
    private voyage: () => Voyage | null,
    private launch: (i: number, via: Passage) => void,
    back: () => void,
  ) {
    installCss();
    this.el.id = 'scr-overworld';
    this.el.className = 'screen dim';
    this.el.innerHTML = '<h1></h1>';
    g.screens.addScreen('overworld', this.el, { onBack: back });
    const entry = document.createElement('button');
    entry.dataset.nav = '';
    entry.dataset.campaign = '';
    entry.onclick = () => this.onOpen();
    root.querySelector('#scr-play .menu-launch')?.prepend(entry);
    const lobbyEntry = entry.cloneNode(false) as HTMLButtonElement;
    lobbyEntry.onclick = () => this.onOpen();
    root.querySelector('[data-act="mp-start"]')?.after(lobbyEntry);
    lobbyEntry.hidden = true;
    const lobby = g.screens.onLobby;
    g.screens.onLobby = (el, v) => {
      lobby?.(el, v);
      lobbyEntry.hidden = !(v.isHost && v.code && (v.kind ?? 'coop') === 'coop');
    };
    const label = () => {
      entry.textContent = lobbyEntry.textContent = t('chart.entry');
    };
    label();
    const show = g.screens.onShow;
    g.screens.onShow = (screen) => {
      show?.(screen);
      if (screen === 'overworld') this.draw();
    };
    onLanguageChange(() => {
      label();
      if (g.screens.current === 'overworld') this.draw();
    });
    this.el.onclick = (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button');
      if (!b || b.disabled) return;
      if (b.dataset.island !== undefined) this.select(Number(b.dataset.island));
      else if (b.dataset.passage) this.passage = b.dataset.passage as Passage;
      else if (b.hasAttribute('data-sail')) {
        this.launch(this.index, this.passage);
        return;
      } else if (b.hasAttribute('data-back')) {
        back();
        return;
      }
      const focus = [...this.el.querySelectorAll('[data-nav]')].indexOf(b);
      this.draw();
      g.screens.refreshNav(focus);
    };
  }
  select(index: number) {
    this.index = index;
    this.passage = 'coast';
  }
  private draw() {
    const c = this.chart(),
      v = this.voyage(),
      count = c.log.length,
      i = this.index,
      s = ISLANDS[i];
    const free = i < count,
      locked = i > count,
      guest = !this.g.authority;
    const status = t(locked ? 'chart.unreached' : free ? 'chart.free' : 'chart.frontier');
    const rival = c.hunts[s.id]?.stories[0],
      reaction = c.log[i - 1];
    const state =
      count === ISLANDS.length
        ? t('chart.complete')
        : v?.won
          ? t('chart.raised', { island: name(v.index) })
          : t('chart.title');
    const routes = ports(count, s);
    const nav = (via: Passage) =>
      `<button data-nav data-passage="${via}" aria-pressed="${this.passage === via}">${t('chart.' + via)}</button>`;
    this.el.innerHTML = `<div class="ow-wrap">
      <header><div><small>${t('chart.entry')}</small><h1>${state}</h1></div>
        <div class="ow-count"><b>${t('chart.count', { n: count, total: ISLANDS.length })}</b><div aria-hidden="true">${ISLANDS.map((_, j) => `<i class="${j < count ? 'ow-lit' : ''}"></i>`).join('')}</div></div></header>
      <div class="ow-main"><div class="ow-sea px">${chartArt(count)}
        ${ISLANDS.map((b, j) => `<button data-nav data-island="${j}" aria-label="${name(j)} · ${t(j < count ? 'chart.free' : j === count ? 'chart.frontier' : 'chart.unreached')}" title="${name(j)}" aria-pressed="${i === j}" style="left:${(b.x / 240) * 100}%;top:${(b.y / 144) * 100}%">${(j + 1).toLocaleString(getLanguage())}</button>`).join('')}</div>
      <section class="ow-card px"><div class="ow-stamp"><svg viewBox="-24 -22 48 36" aria-hidden="true" shape-rendering="crispEdges">${islandArt(s, free)}</svg><small>${status}</small></div>
        <h2>${name(i)}</h2><p>${t('chart.' + s.id)}</p>
        ${locked ? `<p class="ow-info">${t('chart.unlock', { island: name(i - 1) })}</p>` : `<p class="ow-info">${t('chart.legs' + legCount(s, this.passage))}</p>`}
        ${'port' in s ? `<p class="ow-port">${t((free ? 'chart.open.' : 'chart.reward.') + s.port)}</p>` : ''}
        ${rival ? `<p class="ow-rival">${t('chart.rival', { rival: rivalName(rival) })}</p>` : ''}
        ${reaction && !locked ? `<p>${t('chart.dispatch.' + reaction)}</p>` : ''}
        ${!locked && routes.length > 1 && !guest ? `<div class="ow-routes">${routes.map(nav).join('')}</div><p>${t('chart.via.' + this.passage)}</p>` : ''}
        ${guest ? `<p>${t('chart.guest')}</p>` : !locked ? `<button data-nav data-sail class="continue">${prompt('confirm')} ${t('chart.sail')}</button>` : ''}
      </section></div><footer><button data-nav data-back>${prompt('back')} ${t('text.back_1dd26f')}</button>${this.g.role === 'solo' ? `<span>${t('chart.coop')}</span>` : ''}</footer></div>`;
  }
}
function installCss() {
  if (document.getElementById('overworld-style')) return;
  const css = document.createElement('style');
  css.id = 'overworld-style';
  css.textContent = `
#scr-overworld { background:var(--ink); padding:calc(6 * var(--p)); }
.ow-wrap { width:min(100%,calc(372 * var(--p))); }
.ow-wrap header,.ow-wrap footer,.ow-stamp { display:flex; align-items:center; justify-content:space-between; gap:calc(6 * var(--p)); }
.ow-wrap header { margin-block-end:calc(7 * var(--p)); }
.ow-wrap small,.ow-count b { font:calc(4.5 * var(--p)) var(--label); color:var(--cyan); }
#scr-overworld h1 { font:calc(18 * var(--p))/1 var(--display); text-align:start; color:var(--white); }
.ow-count div { display:flex; gap:var(--p); margin-top:calc(2 * var(--p)); }
.ow-count i { width:calc(4 * var(--p)); height:calc(2 * var(--p)); background:var(--slate); }
.ow-count .ow-lit { background:var(--lime); }
.ow-main { display:grid; grid-template-columns:minmax(0,2fr) minmax(0,1fr); gap:calc(6 * var(--p)); align-items:stretch; }
.ow-sea { align-self:center; position:relative; aspect-ratio:5/3; --bg:var(--navy); --lo:var(--blue); --hi:var(--sky); }
.ow-sea svg { display:block; width:100%; height:100%; }
#scr-overworld .ow-sea button { position:absolute; width:13%; height:20%; transform:translate(-50%,-60%); background:transparent; border:0; box-shadow:none; padding:0; display:flex; align-items:end; justify-content:center; font:calc(4 * var(--p)) var(--label); color:var(--white); }
#scr-overworld .ow-sea button[aria-pressed=true] { outline:var(--p) dashed var(--yellow); }
#scr-overworld .ow-sea button.focused { outline:var(--p) solid var(--white); }
.ow-card { --bg:var(--night); --hi:var(--slate); --lo:var(--navy); padding:calc(5 * var(--p)); display:flex; flex-direction:column; gap:calc(2 * var(--p)); text-align:start; }
.ow-stamp { justify-content:start; gap:calc(3 * var(--p)); }
.ow-stamp svg { width:calc(26 * var(--p)); background:var(--navy); }
.ow-card h2 { font:calc(12 * var(--p))/1 var(--display); color:var(--yellow); margin:0; }
.ow-card p,.ow-wrap footer span { margin:0; font:calc(6.7 * var(--p))/1.06 var(--font); }
.ow-card .ow-info { color:var(--cyan); }
.ow-card .ow-port { color:var(--lime); }
.ow-card .ow-rival { color:var(--orange); }
.ow-routes { display:flex; flex-wrap:wrap; gap:calc(2 * var(--p)); margin-block:var(--p); }
#scr-overworld .ow-routes button,#scr-overworld footer button { font:calc(5.5 * var(--p)) var(--font); padding:var(--p) calc(2 * var(--p)); }
#scr-overworld .ow-routes [aria-pressed=true] { --bg:var(--teal); --hi:var(--cyan); }
#scr-overworld [data-sail] { margin-block-start:auto; font:calc(8 * var(--p)) var(--display); padding:calc(2 * var(--p)); }
.ow-wrap footer { margin-block-start:calc(6 * var(--p)); }
.ow-wrap footer span { color:var(--mist); text-align:end; }
[dir=rtl] #scr-overworld :is(h1,h2,p,small,b,button,footer span) { font-family:inherit; letter-spacing:0; line-height:1.45; }
@media(max-width:760px) and (orientation:portrait) { .ow-main { grid-template-columns:1fr; } }
@media(max-height:520px) { #scr-overworld { --p:2px; } }
`;
  document.head.append(css);
}
