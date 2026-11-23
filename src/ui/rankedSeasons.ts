import { BOARDS, isBand, isBoard, rankedSeason, seasonEnd, seasonRules, type SeasonBoard } from '../data/seasons2';
import type { Game } from '../game/game';
import { seasonBook, seasonStandings, syncSeasonHistory, wearBand, type Standing } from '../game/seasons2';
import { getLanguage, t } from '../i18n';
import { onlineServer } from '../net/onlineServer';
import { prompt } from './prompts';
import { seasonUi } from '../game/systems/season';

const css = `
#scr-ranked-season { gap:calc(2 * var(--p)); }
#scr-ranked-season h1 { font-size:clamp(calc(12 * var(--p)),5vw,calc(23 * var(--p))); margin:0; }
.rs-sheet { width:min(calc(325 * var(--p)),92vw); max-height:70vh; overflow:auto; text-align:start; background:var(--night); padding:calc(4 * var(--p)); font:calc(6 * var(--p))/1.25 var(--font); }
.rs-top,.rs-tabs,.rs-foot { display:flex; align-items:center; flex-wrap:wrap; gap:calc(3 * var(--p)); }
.rs-top { justify-content:space-between; color:var(--sky); }
.rs-top strong { color:var(--yellow); font-size:calc(11 * var(--p)); }
#scr-ranked-season button { min-width:0; font-size:calc(7 * var(--p)); padding:var(--p) calc(3 * var(--p)); }
.rs-tabs { margin-block:calc(3 * var(--p)); }
.rs-tabs [aria-pressed=true] { --bg:var(--teal); --hi:var(--sky); --lo:var(--navy); }
.rs-sheet h2 { color:var(--yellow); font:calc(8 * var(--p)) var(--display); margin:calc(2 * var(--p)) 0 var(--p); }
.rs-sheet p { margin:var(--p) 0; }
.rs-rules { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:calc(2 * var(--p)); }
.rs-rules p { border-inline-start:var(--p) solid var(--sky); background:var(--navy); padding:calc(2 * var(--p)); }
.rs-best { display:flex; flex-wrap:wrap; gap:calc(2 * var(--p)); color:var(--mist); }
.rs-best strong { color:var(--lime); }
.rs-sheet small { color:var(--mist); }
.rs-frame { --rank-color:var(--mist); display:inline-block; border:var(--p) double var(--rank-color); color:var(--rank-color); padding:0 calc(2 * var(--p)); }
.rs-frame[data-band=comet] { --rank-color:var(--yellow); border-width:calc(2 * var(--p)); }
.rs-frame[data-band=nova] { --rank-color:var(--orange); }
.rs-frame[data-band=orbit] { --rank-color:var(--sky); }
@media(max-width:600px){ .rs-rules { grid-template-columns:1fr; } }
`;
function style(): void {
  if (document.getElementById('ranked-season-css')) return;
  const el = document.createElement('style'); el.id = 'ranked-season-css'; el.textContent = css; document.head.append(el);
}
export function framedTitle(): string {
  const band = seasonBook().worn;
  if (!band) return '';
  style();
  return `<span class="rs-frame" data-band="${band}">${t('rank.' + band)}</span>`;
}
const screens = new WeakMap<Game, RankedScreen>();
export function openRankedSeason(g: Game): void {
  let screen = screens.get(g);
  if (!screen) { screen = new RankedScreen(g); screens.set(g,screen); }
  screen.open();
}

class RankedScreen {
  private el = document.createElement('div');
  private board: SeasonBoard = 'standard';
  private season = rankedSeason();
  private rows: Standing[] | null = null;
  private place = 0;
  private fetching = false;
  private generation = 0;

  constructor(private g: Game) {
    style();
    this.el.id = 'scr-ranked-season'; this.el.className = 'screen dim';
    g.screens.addScreen('ranked-season', this.el, { onBack: () => seasonUi(g).open() });
    this.el.onclick = e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      if (b.dataset.back !== undefined) { seasonUi(g).open(); return; }
      if (isBand(b.dataset.band)) { wearBand(b.dataset.band); this.render(); return; }
      if (isBoard(b.dataset.board)) this.board = b.dataset.board;
      if (b.dataset.season) this.season = Math.max(1, Math.min(rankedSeason(), this.season + Number(b.dataset.season)));
      void this.load();
    };
  }

  open(): void {
    this.season = Math.max(1, rankedSeason());
    this.g.screens.show('ranked-season');
    void this.load();
  }
  private async load(): Promise<void> {
    const generation = ++this.generation;
    this.fetching = !!onlineServer; this.rows = null; this.place = 0;
    this.render();
    if (!onlineServer) return;
    const [rows, personal] = await Promise.all([seasonStandings(this.season,this.board), syncSeasonHistory()]);
    if (generation !== this.generation || this.g.screens.current !== 'ranked-season') return;
    this.rows = rows;
    this.place = personal?.find(p => p.season === this.season && p.board === this.board)?.rank ?? 0;
    this.fetching = false;
    this.render();
  }

  private render(): void {
    const book = seasonBook(), current = rankedSeason(), rules = seasonRules(this.season);
    const best = book.boards.find(b => b.season === this.season && b.board === this.board)?.runs ?? [];
    const date = new Intl.DateTimeFormat(getLanguage(), { dateStyle: 'medium', timeZone: 'UTC' }).format(seasonEnd(this.season));
    const num = (v: number) => v.toLocaleString(getLanguage());
    const tabs = BOARDS.map(b => `<button data-nav data-board="${b}" aria-pressed="${b === this.board}">${t('rank.'+b)}</button>`).join('');
    const standings = this.rows?.map(r => `<p>${t('rank.row',{ rank:num(r.rank),id:'<bdi dir="ltr">'+r.pilot+'</bdi>',points:num(r.points) })}</p>`).join('') ||
      `<p>${t(this.fetching ? 'rank.loading' : this.rows ? 'rank.empty' : 'rank.offline')}</p>`;
    const trophies = book.awards.map(a => `<p>${t('rank.earned',{n:a.season,mode:t('rank.'+a.board),rank:a.rank})}
      <button class="rs-frame" data-nav data-band="${a.band}">${t(book.worn === a.band ? 'rank.remove' : 'rank.wear',{title:t('rank.'+a.band)})}</button></p>`).join('');
    const oldScroll = this.el.querySelector('.rs-sheet')?.scrollTop ?? 0;
    this.el.innerHTML = `<h1>${t('rank.title')}</h1>
      <div class="rs-sheet px">
        <div class="rs-top"><strong>${t('rank.season',{n:this.season})}</strong><span>${t(this.season < current ? 'rank.closed':'rank.until',{date})}</span></div>
        <nav class="rs-tabs">${tabs}</nav>
        <h2>${t('rank.rules')}</h2><div class="rs-rules">${Object.values(rules).map(r => '<p>'+t('rank.'+r)+'</p>').join('')}</div>
        <h2>${t('rank.local')}</h2><div class="rs-best"><strong>${t('rank.progress',{ n:best.length,points:num(best.reduce((v,r) => v+r.points,0)) })}</strong>${best.map(r=>'<bdi>'+num(r.points)+'</bdi>').join(' · ')}</div>
        <p>${t('rank.how')}</p><small>${t('rank.eligible')}</small>
        <h2>${t('rank.board')}</h2>${this.place ? '<strong>'+t('rank.place',{n:this.place})+'</strong>' : ''}${standings}
        <h2>${t('rank.prizes')}</h2><p>${t('rank.bands')}</p>${trophies}
      </div><div class="rs-foot">
        ${this.season > 1 ? '<button data-nav data-season="-1">'+t('rank.older')+'</button>':''}
        ${this.season < current ? '<button data-nav data-season="1">'+t('rank.newer')+'</button>':''}
        <button data-nav data-back>${prompt('back')} ${t('rank.track')}</button></div>`;
    this.g.screens.refreshNav();
    this.el.querySelector('.rs-sheet')!.scrollTop = oldScroll;
  }
}
