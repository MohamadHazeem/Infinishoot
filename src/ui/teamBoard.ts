import type { Game } from '../game/game';
import { playerName } from '../game/game';
import { settings, saveSettings } from '../game/settings';
import { weeklyChallenge } from '../data/weekly';
import { cleanTeam, localTeamBest, teamBoard, type TeamEntry } from '../net/teamboard';
import { esc } from './lobbyBrowser';

/**
 * WEEKLY CO-OP board (MP lane): this ISO week's shared seed and two rules (the
 * same Weekly Challenge every team plays, src/data/weekly.ts), the team name
 * the host plays under, this machine's best team result and, with the online
 * service, the week's top teams.
 */
export class TeamBoardUi {
  readonly screen: HTMLElement;
  private back: 'online' | 'localcoop' = 'online';
  private rows: TeamEntry[] | null = null;

  constructor(
    root: HTMLElement,
    private game: Game,
    private service = teamBoard,
  ) {
    const t = document.createElement('template');
    t.innerHTML = `<div id="scr-teamboard" class="screen dim">
      <h1>WEEKLY CO-OP</h1>
      <p class="note tb-rules"></p>
      <label class="field">TEAM NAME <input id="tb-team" type="text" maxlength="16" spellcheck="false" autocomplete="off"></label>
      <div class="tb-best"></div>
      <div class="section">TEAM BOARD</div>
      <div class="scroll"><div class="tb-list hiscores"></div></div>
      <div class="menu row"><button data-nav data-act="tb-back">BACK</button></div>
    </div>`;
    this.screen = t.content.firstElementChild as HTMLElement;
    game.screens.addScreen('teamboard', this.screen, { onBack: () => this.close() });
    root.querySelector('#scr-online .mp-choice [data-act=lb-open]')?.insertAdjacentHTML('afterend', '<button data-nav data-act="tb-open">WEEKLY CO-OP</button>');
    const field = this.screen.querySelector<HTMLInputElement>('#tb-team')!;
    field.addEventListener('change', () => {
      settings.teamName = cleanTeam(field.value);
      field.value = settings.teamName;
      saveSettings();
    });
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (b?.dataset.act === 'tb-open') this.open(b.closest('#scr-localcoop') ? 'localcoop' : 'online');
      else if (b?.dataset.act === 'tb-back') this.close();
    });
  }

  open(back: 'online' | 'localcoop' = 'online'): void {
    this.back = back;
    this.rows = null;
    this.render();
    this.game.screens.show('teamboard');
    const w = weeklyChallenge();
    void this.service.top(w.week).then((r) => {
      this.rows = r;
      if (this.game.screens.current === 'teamboard') this.render();
    });
  }

  private close(): void {
    if (this.back === 'localcoop') this.game.screens.show('localcoop');
    else this.game.screens.showOnline(playerName());
  }

  render(): void {
    const w = weeklyChallenge();
    const s = this.screen;
    s.querySelector('.tb-rules')!.innerHTML = `Week <b>${w.week}</b>: the same seed and rules for every team. ${w.rules.map((r) => `<b>${r.name.toUpperCase()}</b> ${r.desc}`).join(' ')} Everyone starts as the Rookie. Host a game with GAME: WEEKLY, or play it in LOCAL CO-OP.`;
    s.querySelector<HTMLInputElement>('#tb-team')!.value = teamNameOf(this.game);
    const best = localTeamBest(w.week);
    s.querySelector('.tb-best')!.innerHTML = best
      ? `<div class="note">YOUR TEAM'S BEST THIS WEEK: <b>${best.score.toLocaleString('en-US')}</b> · STAGE ${best.stage} · ${esc(best.team)} (${best.members.map(esc).join(', ')})</div>`
      : '<div class="note">NO TEAM RESULT THIS WEEK YET.</div>';
    const list = s.querySelector('.tb-list')!;
    if (!this.service.enabled) list.innerHTML = '<div class="note">The global team board needs the online service (VITE_LEADERBOARD_URL, see server/leaderboard/README.md). Your best is kept on this PC.</div>';
    else if (!this.rows) list.innerHTML = '<div class="note">LOADING...</div>';
    else if (!this.rows.length) list.innerHTML = '<div class="note">NO TEAMS YET THIS WEEK. BE THE FIRST!</div>';
    else
      list.innerHTML = `<ol>${this.rows
        .map((r) => `<li><b>${esc(r.team)}</b> <span>${r.members.map(esc).join(', ')}</span> <em>${r.score.toLocaleString('en-US')}</em> <small>ST ${r.stage}</small></li>`)
        .join('')}</ol>`;
  }
}

/** The team name this machine plays under (its own setting, else "<name>'s Team"). */
export function teamNameOf(_g: Game): string {
  return settings.teamName ? cleanTeam(settings.teamName) : cleanTeam(`${playerName()}'s Team`);
}
