import { localizeHtml } from '../i18n';
import type { Game } from '../game/game';
import { playerName } from '../game/game';
import { DIFFICULTIES, DIFF_BY_ID, type DifficultyId } from '../data/modes';
import { REGIONS, REGION_NAMES, lobbyService, regionOf, type PublicLobby } from '../net/lobbies';
import { sfx } from '../audio/sfx';

/**
 * PLAY ONLINE > BROWSE GAMES (MP lane): public lobbies from the optional online
 * service, filtered by region, difficulty and game type, refreshed every 15 s
 * while open; pick one to join it with its invite code. Without the service
 * the screen says how to turn it on (invite codes keep working).
 */
export const KIND_NAMES: Record<string, string> = { coop: 'CO-OP', pvp: 'PVP', versus: 'VERSUS', weekly: 'WEEKLY CO-OP', race: 'RACE' };
const KINDS = ['', 'coop', 'pvp', 'versus', 'weekly', 'race'];

export class LobbyBrowserUi {
  readonly screen: HTMLElement;
  private region = '';
  private difficulty = '';
  private kind = '';
  private refreshT = 0;
  private loading = false;
  private key = '';
  rows: PublicLobby[] | null = null;

  constructor(
    root: HTMLElement,
    private game: Game,
    private service = lobbyService,
  ) {
    injectCss();
    this.region = regionOf();
    const t = document.createElement('template');
    t.innerHTML = localizeHtml(`<div id="scr-mpbrowse" class="screen dim">
      <h1>BROWSE GAMES</h1>
      <p class="note lb-note"></p>
      <div class="menu row lb-filters"></div>
      <div class="scroll"><div class="lb-list"></div></div>
      <div class="menu row"><button data-nav data-act="lb-refresh">REFRESH</button><button data-nav data-act="lb-back">BACK</button></div>
    </div>`);
    this.screen = t.content.firstElementChild as HTMLElement;
    game.screens.addScreen('mpbrowse', this.screen, { columns: 3, onBack: () => this.back() });
    root.querySelector('#scr-online .mp-choice [data-act=mp-host]')?.insertAdjacentHTML('afterend', localizeHtml('<button data-nav data-act="lb-open">BROWSE GAMES</button>'));
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      switch (b?.dataset.act) {
        case 'lb-open':
          return this.open();
        case 'lb-back':
          return this.back();
        case 'lb-refresh':
          return void this.refresh();
        case 'lb-region':
          this.region = cycle(['', ...REGIONS], this.region);
          return void this.refresh();
        case 'lb-diff':
          this.difficulty = cycle(['', ...DIFFICULTIES.map((d) => d.id)], this.difficulty);
          return void this.refresh();
        case 'lb-kind':
          this.kind = cycle(KINDS, this.kind);
          return void this.refresh();
        case 'lb-join': {
          const name = root.querySelector<HTMLInputElement>('#mp-name')?.value || playerName();
          return void this.game.joinGame(name, b!.dataset.code ?? '');
        }
      }
    });
  }

  open(): void {
    this.rows = null;
    this.key = '';
    this.render();
    this.game.screens.show('mpbrowse');
    void this.refresh();
  }

  private back(): void {
    this.game.screens.showOnline(playerName());
  }

  /** While open: refresh every 15 s. */
  update(dt: number): void {
    if (this.game.screens.current !== 'mpbrowse' || !this.service.enabled) return;
    if ((this.refreshT -= dt) <= 0) void this.refresh();
  }

  async refresh(): Promise<void> {
    this.refreshT = 15;
    if (!this.service.enabled) return this.render();
    if (this.loading) return;
    this.loading = true;
    this.render();
    const rows = await this.service.list({ region: this.region, difficulty: this.difficulty, mode: this.kind });
    this.loading = false;
    this.rows = rows;
    if (this.game.screens.current === 'mpbrowse') {
      this.render();
      sfx.menuMove();
    }
  }

  render(): void {
    const s = this.screen;
    const on = this.service.enabled;
    // Only rebuild (and re-scan the menu, which resets its focus) when something changed.
    const key = `${on}|${this.region}|${this.difficulty}|${this.kind}|${this.loading}|${JSON.stringify(this.rows)}`;
    if (key === this.key) return;
    this.key = key;
    s.querySelector('.lb-note')!.innerHTML = localizeHtml(on
      ? 'Public games from hosts who switched PUBLIC on in their lobby. Pick one to join. Your region is guessed from your time zone.'
      : 'Public games need the online service. Build the game with <b>VITE_LEADERBOARD_URL</b> set (see server/leaderboard/README.md). Until then, join friends with an invite code.');
    s.querySelector('.lb-filters')!.innerHTML = localizeHtml(on
      ? `<button data-nav data-act="lb-region">REGION: ${this.region ? REGION_NAMES[this.region] : 'ANY'}</button>
         <button data-nav data-act="lb-diff">DIFFICULTY: ${this.difficulty ? DIFF_BY_ID[this.difficulty as DifficultyId].name.toUpperCase() : 'ANY'}</button>
         <button data-nav data-act="lb-kind">GAME: ${this.kind ? KIND_NAMES[this.kind] : 'ANY'}</button>`
      : '');
    const list = s.querySelector('.lb-list')!;
    const v = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
    if (!on) list.innerHTML = '';
    else if (this.loading && !this.rows) list.innerHTML = localizeHtml('<div class="lb-empty">LOOKING FOR GAMES...</div>');
    else if (!this.rows) list.innerHTML = localizeHtml('<div class="lb-empty">COULD NOT REACH THE SERVICE. TRY REFRESH.</div>');
    else if (!this.rows.length) list.innerHTML = localizeHtml('<div class="lb-empty">NO OPEN GAMES RIGHT NOW. HOST ONE AND SWITCH PUBLIC ON!</div>');
    else
      list.innerHTML = localizeHtml(this.rows
        .map((l) => {
          const old = l.version !== v;
          return `<button class="lb-row ${old ? 'locked' : ''}" ${old ? '' : 'data-nav'} data-act="${old ? '' : 'lb-join'}" data-code="${l.code}">
            <b><bdi>${esc(l.name)}</bdi></b><span>${KIND_NAMES[l.mode] ?? l.mode}</span><span>${DIFF_BY_ID[l.difficulty as DifficultyId]?.name.toUpperCase() ?? ''}</span><span>${l.region}</span><span>${l.players}/${l.max}</span>${old ? `<small>VERSION ${esc(l.version)}</small>` : ''}</button>`;
        })
        .join(''));
    if (this.game.screens.current === 'mpbrowse') this.game.screens.show('mpbrowse');
  }
}

function cycle(list: string[], cur: string): string {
  return list[(list.indexOf(cur) + 1) % list.length];
}

export function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function injectCss(): void {
  if (document.getElementById('lobbybrowser-css')) return;
  const st = document.createElement('style');
  st.id = 'lobbybrowser-css';
  st.textContent = `
#scr-mpbrowse .lb-list { display: flex; flex-direction: column; gap: calc(3 * var(--p)); width: min(720px, 92vw); margin: 0 auto; }
#scr-mpbrowse .lb-row { display: grid; grid-template-columns: 1fr 110px 90px 40px 44px; gap: 8px; align-items: center; text-align: left; font-size: 18px; padding: 6px 12px; }
#scr-mpbrowse .lb-row b { font-weight: normal; color: var(--yellow); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#scr-mpbrowse .lb-row span { font: 11px var(--label); color: var(--mist); }
#scr-mpbrowse .lb-row small { grid-column: 1 / 6; font: 9px var(--label); color: var(--red); }
#scr-mpbrowse .lb-empty { text-align: center; font: 12px var(--label); color: var(--mist); padding: 20px; }
.mp-x { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-top: 4px; }
.mp-x .note { margin: 0; }
.mp-x input { width: 200px; text-align: center; }
`;
  document.head.appendChild(st);
}
