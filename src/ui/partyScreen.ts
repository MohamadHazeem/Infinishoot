import { localize, localizeHtml } from '../i18n';
import type { Game } from '../game/game';
import { partyView } from '../game/systems/party';
import { voteCounts } from '../game/lobby';
import { fmtScore } from './hud';
import { ChatBox, esc } from './lobbyScreen';

/**
 * PARTY screen (lobby lane): after an online co-op game over the party stays
 * connected. It shows the run (team stage, level, score, kills, time and each
 * player's damage) and lets everyone VOTE RESTART or vote BACK TO LOBBY; when
 * all agree, the host does it. The host can also skip the vote. LEAVE PARTY
 * goes back to the title alone. Reached from the game over screen's PARTY button.
 */
export class PartyUi {
  readonly screen: HTMLElement;
  private chat: ChatBox;

  constructor(
    private root: HTMLElement,
    private game: Game,
  ) {
    injectCss();
    const t = document.createElement('template');
    t.innerHTML = localizeHtml(`<div id="scr-party" class="screen dim">
      <h1>PARTY</h1>
      <p class="note pty-sum"></p>
      <div class="pty-rows"></div>
      <div class="menu row pty-votes"><button data-nav data-act="pty-vote" data-v="restart"></button><button data-nav data-act="pty-vote" data-v="lobby"></button></div>
      <div class="note pty-status"></div>
      <div class="menu row pty-host"><button data-nav data-act="pty-force" data-v="restart">RESTART NOW</button><button data-nav data-act="pty-force" data-v="lobby">LOBBY NOW</button></div>
      <div class="menu row"><button data-nav data-act="pty-gameover">RUN SUMMARY</button><button data-nav data-act="pty-leave">LEAVE PARTY</button></div>
    </div>`);
    this.screen = t.content.firstElementChild as HTMLElement;
    this.chat = new ChatBox(game, 'pty');
    this.screen.appendChild(this.chat.el);
    game.screens.addScreen('party', this.screen, { columns: 3, onBack: () => this.game.screens.show('gameover') });
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      switch (b?.dataset.act) {
        case 'party-open':
          return this.open();
        case 'pty-gameover':
          return this.game.screens.show('gameover');
        case 'pty-leave':
          return this.game.leaveToTitle();
        case 'pty-vote':
          return this.game.partyVote(b.dataset.v === 'lobby' ? 'lobby' : 'restart');
        case 'pty-force':
          return this.game.partyForce(b.dataset.v === 'lobby' ? 'lobby' : 'restart');
      }
    });
  }

  /** Game over screen: online co-op gets a PARTY button (first) instead of RETRY. */
  onGameOver(on: boolean): void {
    const go = this.root.querySelector<HTMLElement>('#scr-gameover');
    const row = go?.querySelector<HTMLElement>('[data-act=retry]')?.parentElement;
    if (!go || !row) return;
    let b = row.querySelector<HTMLElement>('[data-act=party-open]');
    if (!b) {
      row.insertAdjacentHTML('afterbegin', localizeHtml('<button data-nav data-act="party-open" class="continue">PARTY &#9654;</button>'));
      b = row.querySelector<HTMLElement>('[data-act=party-open]')!;
    }
    b.hidden = !on;
    row.querySelector<HTMLElement>('[data-act=retry]')!.hidden = on;
  }

  open(): void {
    for (const b of this.screen.querySelectorAll<HTMLElement>('.pty-host button')) b.hidden = this.game.role !== 'host';
    this.render(true);
    this.game.screens.show('party', 0);
  }

  render(force = false): void {
    if (!force && this.game.screens.current !== 'party') return;
    const v = partyView(this.game);
    const s = this.screen;
    const isHost = this.game.role === 'host';
    const [restart, lobby] = s.querySelectorAll<HTMLElement>('.pty-votes button');
    if (!v) {
      s.querySelector('.pty-sum')!.textContent = localize('Waiting for the host...');
      s.querySelector('.pty-rows')!.innerHTML = '';
      restart.textContent = localize('VOTE RESTART');
      lobby.textContent = localize('BACK TO LOBBY');
      this.chat.render();
      return;
    }
    s.querySelector('.pty-sum')!.textContent = localize(`STAGE ${v.stage} · TEAM LV ${v.level} · ${fmtScore(v.score)} PTS · ${v.kills.toLocaleString('en-US')} KILLS · ${clock(v.time)}`);
    const top = Math.max(1, ...v.rows.map((r) => r.dmg));
    s.querySelector('.pty-rows')!.innerHTML = localizeHtml(v.rows
      .map(
        (r, i) => `<div class="lobby-player pty-row" style="--c:${/^#[0-9a-f]{3,8}$/i.test(r.c) ? r.c : '#f4f4f4'}">
        <span class="dot"></span><b><bdi>${esc(r.n)}</bdi>${i === v.you ? ' <small class="you">YOU</small>' : ''}</b>
        <span class="hero">${esc(r.hero.toUpperCase())}${r.dead ? ' · K.O.' : ''}</span>
        <div class="bar"><div style="width:${Math.round((r.dmg / top) * 100)}%"></div></div><span class="dmg">${fmtScore(r.dmg)}</span>
        <span class="vote ${r.v}">${r.v === 'restart' ? 'RESTART' : r.v === 'lobby' ? 'LOBBY' : 'VOTING...'}</span>
      </div>`,
      )
      .join(''));
    // The buttons stay the same elements (the menu keeps its focus); only labels change.
    const n = voteCounts(v.rows.map((r) => r.v));
    const mine = v.rows[v.you]?.v ?? '';
    restart.textContent = localize(`VOTE RESTART ${n.restart}/${n.total}`);
    lobby.textContent = localize(`BACK TO LOBBY ${n.lobby}/${n.total}`);
    restart.classList.toggle('on', mine === 'restart');
    lobby.classList.toggle('on', mine === 'lobby');
    s.querySelector('.pty-status')!.textContent = localize(isHost ? 'When everyone votes the same, it happens. You can also decide now.' : 'When everyone votes the same, the host takes the party there.');
    this.chat.render();
  }

  renderChat(): void {
    if (this.game.screens.current === 'party') this.chat.render();
  }
}

function clock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function injectCss(): void {
  if (document.getElementById('party-lane-css')) return;
  const st = document.createElement('style');
  st.id = 'party-lane-css';
  st.textContent = `
#scr-party .pty-rows { display: flex; flex-direction: column; gap: calc(3 * var(--p)); width: min(640px, 92vw); margin: 8px auto; }
#scr-party .pty-row { display: grid; grid-template-columns: 12px 1fr auto 140px 70px 80px; gap: 10px; align-items: center; font-size: 22px; }
#scr-party .pty-row b { font-weight: normal; color: var(--c); text-shadow: var(--outline); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#scr-party .pty-row small.you { font: 9px var(--label); color: var(--cyan); text-shadow: none; }
#scr-party .pty-row .hero, #scr-party .pty-row .dmg { font: 10px var(--label); color: var(--mist); }
#scr-party .pty-row .bar { height: calc(3 * var(--p)); background: var(--ink); }
#scr-party .pty-row .bar div { height: 100%; background: var(--c); }
#scr-party .pty-row .vote { font: 10px var(--label); color: var(--slate); text-align: right; }
#scr-party .pty-row .vote.restart { color: var(--lime); }
#scr-party .pty-row .vote.lobby { color: var(--sky); }
#scr-party .pty-votes button.on { --bg: var(--green); --hi: var(--lime); }
#scr-party .pty-status { margin: 0; font: 10px var(--label); color: var(--mist); }
#scr-party .pty-host button { --bg: var(--plum); }
`;
  document.head.appendChild(st);
}
