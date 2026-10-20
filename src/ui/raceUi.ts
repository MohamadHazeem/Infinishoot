import type { Game } from '../game/game';
import { localize, localizeHtml } from '../i18n';
import { save } from '../game/save';
import { loadJson } from '../core/storage';
import { sfx } from '../audio/sfx';
import { copyText, esc } from './lobbyScreen';
import { MenuNav } from './menu';
import { HEROES } from '../data/heroes';
import { DIFFICULTIES } from '../data/modes';
import { WEAPONS } from '../data/weapons';
import { SPECIALS } from '../data/specials';
import { RANK_TIERS, rankBadge, rollSeason, seasonName, tierOf, toNextTier } from '../data/ranked';
import { rankedLadder } from '../net/rankedBoard';
import {
  TOURNEY_MAX,
  TOURNEY_MIN,
  createTourney,
  decodeChallenge,
  fmtClock,
  nextMatch,
  recordWin,
  roundName,
  rowLabel,
  standings,
  type Challenge,
  type TourneyKind,
  type TurnResult,
} from '../game/raceRules';
import { playTurn, raceSay, raceSting, raceState, startChallenge, storeTourney } from '../game/systems/race';

/**
 * Race lane UI: the rival board on the HUD (race) and the score-to-beat chip
 * (challenge), the RACE RESULTS screen, EXTRAS > COMPETE (challenge codes,
 * ranked, tournament) and the TOURNAMENT bracket. Rank badges on lobby cards.
 * Plain DOM, styles injected here (pixel frames, Sweetie 16 variables only).
 */
type Tab = 'challenge' | 'ranked' | 'tourney';

export class RaceUi {
  private hud: HTMLElement;
  private results: HTMLElement;
  private compete: HTMLElement;
  private bracket: HTMLElement;
  private tab: Tab = 'challenge';
  private msg = '';
  private preview: Challenge | null = null;
  private ladder: { season: string; list: { name: string; rating: number; games: number; wins: number }[] | null; busy: boolean } = { season: '', list: null, busy: false };
  private setupKind: TourneyKind = 'race';
  private setupNames: string[] = [];
  private tmsg = '';
  private resetArmed = false;
  private hudKey = '';
  private championShown = -1;
  private competeNav: MenuNav;
  private bracketNav: MenuNav;

  constructor(
    private root: HTMLElement,
    private game: Game,
  ) {
    injectCss();
    root.insertAdjacentHTML('beforeend', localizeHtml('<div id="race-hud" class="px" hidden><div class="rc-top"></div><div class="rc-rows"></div></div>'));
    this.hud = root.querySelector<HTMLElement>('#race-hud')!;

    const make = (html: string) => {
      const t = document.createElement('template');
      t.innerHTML = localizeHtml(html);
      return t.content.firstElementChild as HTMLElement;
    };
    this.results = make(`<div id="scr-raceres" class="screen dim">
      <h1>RACE RESULTS</h1>
      <div class="note rr-sub"></div>
      <div class="rr-list"></div>
      <div class="rr-rating"></div>
      <div class="menu row"><button data-nav data-act="rr-title">BACK TO TITLE</button></div>
    </div>`);
    game.screens.addScreen('raceres', this.results, { columns: 1, onBack: () => this.leaveResults() });

    this.compete = make(`<div id="scr-compete" class="screen dim">
      <h1>COMPETE</h1>
      <div class="menu row cp-tabs"><button data-nav data-act="cp-tab" data-tab="challenge">CHALLENGE A FRIEND</button><button data-nav data-act="cp-tab" data-tab="ranked">RANKED</button><button data-nav data-act="cp-tab" data-tab="tourney">TOURNAMENT</button></div>
      <div class="cp-body"></div>
      <div class="note cp-msg"></div>
      <div class="menu row"><button data-nav data-act="cp-back">BACK</button></div>
    </div>`);
    this.competeNav = new MenuNav(this.compete, { columns: 3, onBack: () => game.screens.show('extras') });
    game.screens.addScreen('compete', this.compete, this.competeNav);

    this.bracket = make(`<div id="scr-tourney" class="screen dim">
      <h1>TOURNAMENT</h1>
      <div class="tn-body"></div>
      <div class="note tn-msg"></div>
      <div class="menu row tn-foot"></div>
    </div>`);
    this.bracketNav = new MenuNav(this.bracket, { columns: 4, onBack: () => this.openCompete('tourney') });
    game.screens.addScreen('tourney', this.bracket, this.bracketNav);

    root.querySelector('#scr-extras .menu [data-act=history]')?.insertAdjacentHTML('beforebegin', localizeHtml('<button data-nav data-act="cp-open">COMPETE</button>'));

    for (const el of [this.compete, this.bracket])
      el.addEventListener('keydown', (e) => {
        const t = e.target as HTMLElement;
        if (t.tagName !== 'INPUT') return;
        e.stopPropagation();
        if (e.key === 'Escape') t.blur();
        if (e.key === 'Enter') {
          if (t.classList.contains('cp-code')) this.readCode();
          else t.blur();
        }
      });
    this.compete.addEventListener('input', (e) => {
      if ((e.target as HTMLElement).classList.contains('cp-code')) {
        this.preview = null;
        this.msg = '';
      }
    });
    this.bracket.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.i !== undefined) this.setupNames[Number(t.dataset.i)] = t.value;
    });

    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      switch (b?.dataset.act) {
        case 'cp-open':
          return this.openCompete();
        case 'cp-back':
          return game.screens.show('extras');
        case 'cp-tab':
          this.tab = (b.dataset.tab as Tab) ?? 'challenge';
          this.msg = '';
          return this.renderCompete();
        case 'cp-read':
          return this.readCode();
        case 'cp-play':
          if (this.preview) startChallenge(game, this.preview);
          return;
        case 'cp-copylast':
          return void this.copy(loadJson<string>('challenge.last', ''), 'compete');
        case 'go-chal':
          return void this.copy(raceState(game)?.lastCode ?? '', 'gameover');
        case 'cp-ladder':
          return void this.loadLadder(true);
        case 'tn-open':
          return this.openTourney();
        case 'rr-title':
          return this.leaveResults();
        case 'tn-kind':
          this.setupKind = b.dataset.kind === 'pvp' ? 'pvp' : 'race';
          return this.renderTourney();
        case 'tn-start':
          return this.startTourney();
        case 'tn-play': {
          const nm = this.tourney && nextMatch(this.tourney);
          if (nm) playTurn(game, nm.round, nm.match, b.dataset.side === 'b' ? 'b' : 'a');
          return;
        }
        case 'tn-win': {
          const t = this.tourney;
          const nm = t && nextMatch(t);
          if (!t || !nm) return;
          const w = b.dataset.side === 'b' ? nm.m.b : nm.m.a;
          recordWin(t, nm.round, nm.match, w);
          storeTourney(game);
          this.tmsg = `<bdi>${esc(t.names[w].toUpperCase())}</bdi> WINS THE MATCH.`;
          sfx.ui('confirm', 0.5);
          return this.renderTourney();
        }
        case 'tn-reset': {
          const st = raceState(game);
          if (!st) return;
          if (st.tourney && st.tourney.champion < 0 && !this.resetArmed) {
            this.resetArmed = true;
            this.tmsg = 'PRESS NEW TOURNAMENT AGAIN TO THROW THIS BRACKET AWAY.';
            return this.renderTourney();
          }
          this.setupNames = st.tourney ? [...st.tourney.names] : this.setupNames;
          st.tourney = null;
          storeTourney(game);
          this.resetArmed = false;
          this.tmsg = '';
          return this.renderTourney();
        }
        case 'tn-back':
          return this.openCompete('tourney');
      }
    });
  }

  private get tourney() {
    return raceState(this.game)?.tourney ?? null;
  }

  // ---------------------------------------------------------------- HUD

  /** Rival board (race) or the score to beat (challenge). Cheap: rebuilt only when the text changes. */
  renderHud(): void {
    const g = this.game;
    const R = g.race;
    const st = raceState(g);
    const chal = st?.chal;
    const on = g.screens.current === 'none' && g.mode !== 'title' && ((!!R && R.phase === 'run' && R.net !== 'local') || !!chal || (!!R && R.net === 'local' && R.phase === 'run'));
    this.hud.hidden = !on;
    if (!on) return;
    let top = '';
    let rows = '';
    if (R) {
      const left = Math.max(0, R.limit - R.clock);
      top = `<b>RACE</b><span class="${left < 60 ? 'hot' : ''}">${fmtClock(left)} LEFT</span>`;
      const order = R.net === 'local' ? R.rows.map((row) => ({ row, place: 1 })) : standings(R.rows);
      rows = order
        .map(({ row, place }) => {
          const me = row === R.rows[R.you];
          const w = Math.round((Math.min(2, row.p) / 2) * 100);
          return `<div class="rc-row ${me ? 'me' : ''} s-${row.s}" style="--c:${row.c}"><span class="pl">${R.net === 'local' ? '' : place}</span><span class="nm"><bdi>${esc(row.n)}</bdi></span><span class="lb">${localize(rowLabel(row))}</span><span class="bar"><i style="width:${w}%"></i><u></u></span></div>`;
        })
        .join('');
    } else if (chal) {
      const mine = Math.floor(g.score * g.meta.multiplier);
      const w = Math.round(Math.min(1, mine / Math.max(1, chal.score)) * 100);
      top = `<b>CHALLENGE</b><span>STAGE ${chal.stage}</span>`;
      rows = `<div class="rc-row" style="--c:#ffcd75"><span class="pl"></span><span class="nm"><bdi>${esc(chal.name)}</bdi></span><span class="lb">${chal.score.toLocaleString('en-US')}</span></div>
        <div class="rc-row me ${st!.chalPassed ? 's-done' : ''}" style="--c:${g.hero.color}"><span class="pl"></span><span class="nm">YOU</span><span class="lb">${mine.toLocaleString('en-US')}</span><span class="bar"><i style="width:${w}%"></i></span></div>`;
    }
    const key = top + rows;
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.querySelector('.rc-top')!.innerHTML = localizeHtml(top);
    this.hud.querySelector('.rc-rows')!.innerHTML = localizeHtml(rows);
  }

  // ---------------------------------------------------------------- results

  /** `waiting`: you're done (or down) but others still race: live board. */
  showResults(waiting: boolean): void {
    const g = this.game;
    const R = g.race;
    if (!R) return;
    const list = R.final ?? standings(R.rows);
    this.results.querySelector('h1')!.textContent = localize(waiting ? 'WAITING FOR THE RACE' : 'RACE RESULTS');
    const winner = list[0];
    this.results.querySelector('.rr-sub')!.innerHTML = localizeHtml(
      waiting ? `${fmtClock(Math.max(0, R.limit - R.clock))} LEFT · THE OTHERS ARE STILL RACING` : winner?.row.s === 'done' ? `<bdi>${esc(winner.row.n.toUpperCase())}</bdi> BEAT THE BOSS FIRST` : 'TIME! FURTHEST RACER WINS',
    );
    this.results.querySelector('.rr-list')!.innerHTML = localizeHtml(list
      .map(({ row, place }, i) => {
        const me = row === R.rows[R.you];
        return `<div class="rr-row px ${me ? 'me' : ''} ${!waiting && i === 0 ? 'win' : ''}" style="--c:${row.c}"><span class="pl">${place}</span><span class="nm"><bdi>${esc(row.n)}</bdi>${me ? ' <small>YOU</small>' : ''}</span>${row.r >= 0 ? rankBadge(row.r, false) : '<span></span>'}<span class="lb">${localize(rowLabel(row))}</span><span class="lv">LV ${row.lv}</span></div>`;
      })
      .join(''));
    const rt = R.rating;
    this.results.querySelector('.rr-rating')!.innerHTML = localizeHtml(rt
      ? `${rankBadge(rt.after)} <span class="${rt.delta >= 0 ? 'up' : 'down'}">${rt.delta >= 0 ? '+' : ''}${rt.delta}</span>${rt.tierUp ? ' <b class="up">RANK UP!</b>' : rt.tierDown ? ' <b class="down">RANK DOWN</b>' : ''}`
      : '');
    this.results.querySelector<HTMLElement>('[data-act=rr-title]')!.textContent = localize(waiting ? 'LEAVE RACE' : 'BACK TO TITLE');
    if (g.screens.current !== 'raceres') g.screens.show('raceres', 0);
  }

  private leaveResults(): void {
    const R = this.game.race;
    if (R && R.phase === 'run' && R.net === 'client') this.game.client?.send({ t: 'rcp', row: { ...R.rows[R.you], s: 'left' } });
    this.game.leaveToTitle();
  }

  // ---------------------------------------------------------------- game over: challenge a friend

  onGameOver(): void {
    const g = this.game;
    const st = raceState(g);
    const go = this.root.querySelector<HTMLElement>('#scr-gameover');
    const row = go?.querySelector<HTMLElement>('[data-act=retry]')?.parentElement;
    if (!st || !go || !row) return;
    let b = row.querySelector<HTMLElement>('[data-act=go-chal]');
    if (!b) {
      row.insertAdjacentHTML('beforeend', localizeHtml('<button data-nav data-act="go-chal">CHALLENGE A FRIEND</button>'));
      b = row.querySelector<HTMLElement>('[data-act=go-chal]')!;
    }
    b.hidden = !st.lastCode;
    let line = go.querySelector<HTMLElement>('.go-chal-line');
    if (!line) {
      row.insertAdjacentHTML('afterend', localizeHtml('<div class="note go-chal-line"></div>'));
      line = go.querySelector<HTMLElement>('.go-chal-line')!;
    }
    const c = st.lastChal;
    const mine = st.lastSum?.score ?? 0;
    let text = '';
    if (c) {
      const beat = mine > c.score;
      text = beat ? `YOU BEAT <bdi>${esc(c.name.toUpperCase())}</bdi> BY ${(mine - c.score).toLocaleString('en-US')}! SEND THEM YOUR CODE.` : `<bdi>${esc(c.name.toUpperCase())}</bdi> STAYS AHEAD BY ${(c.score - mine).toLocaleString('en-US')}. RETRY THE SAME SETUP FROM EXTRAS > COMPETE.`;
      line.className = `note go-chal-line ${beat ? 'win' : 'lose'}`;
      if (beat) {
        raceSay('vo_victory', 'Victory!');
        raceSting('victory_fanfare');
      }
    } else if (st.lastHeat) text = 'HEAT RUNS CAN\'T MAKE CHALLENGE CODES.';
    line.innerHTML = localizeHtml(text);
    line.hidden = !text;
  }

  private async copy(code: string, where: 'compete' | 'gameover'): Promise<void> {
    if (!code) return;
    const ok = await copyText(code);
    const text = ok ? `CHALLENGE CODE COPIED: <bdi>${esc(code)}</bdi>` : `COPY FAILED. YOUR CODE: <bdi>${esc(code)}</bdi>`;
    if (ok) sfx.ui('confirm', 0.5);
    if (where === 'gameover') {
      const line = this.root.querySelector<HTMLElement>('#scr-gameover .go-chal-line');
      if (line) {
        line.hidden = false;
        line.className = 'note go-chal-line code';
        line.innerHTML = localizeHtml(text);
      }
    } else {
      this.msg = text;
      this.renderCompete();
    }
  }

  // ---------------------------------------------------------------- COMPETE

  openCompete(tab?: Tab): void {
    if (tab) this.tab = tab;
    this.msg = '';
    rollSeason(save.ranked);
    this.renderCompete();
    this.game.screens.show('compete', 0);
  }

  private readCode(): void {
    const inp = this.compete.querySelector<HTMLInputElement>('.cp-code');
    try {
      this.preview = decodeChallenge(inp?.value ?? '');
      this.msg = '';
      sfx.ui('confirm', 0.5);
    } catch (err) {
      this.preview = null;
      this.msg = (err as Error).message;
      sfx.deny();
    }
    this.renderCompete(inp?.value);
  }

  private renderCompete(code?: string): void {
    const el = this.compete;
    for (const b of el.querySelectorAll<HTMLElement>('[data-act=cp-tab]')) b.classList.toggle('on', b.dataset.tab === this.tab);
    const body = el.querySelector<HTMLElement>('.cp-body')!;
    const keep = code ?? el.querySelector<HTMLInputElement>('.cp-code')?.value ?? '';
    if (this.tab === 'challenge') {
      const last = loadJson<string>('challenge.last', '');
      const p = this.preview;
      body.innerHTML = localizeHtml(`
        <p class="note">Finish a solo run (Standard, Endless or Boss Rush, no heat), press CHALLENGE A FRIEND on the game over screen and send the code. Your friend pastes it here to play your exact seed, mode, difficulty, hero and loadout with your score to beat.</p>
        <div class="cp-paste"><input type="text" class="cp-code" placeholder="PASTE A CODE (IS1...)" spellcheck="false" autocomplete="off"><button data-nav data-act="cp-read">READ CODE</button></div>
        ${p ? `<div class="cp-card px"><div class="who"><b><bdi>${esc(p.name.toUpperCase())}</bdi></b> SCORED <b class="sc">${p.score.toLocaleString('en-US')}</b> (STAGE ${p.stage})</div>
          <div class="kit">${esc(modeName(p.mode))} · ${esc(diffName(p.difficulty))} · ${esc(heroName(p.hero))}</div>
          <div class="kit">${esc(itemName(p.loadout.primary))} / ${esc(itemName(p.loadout.secondary))} / ${esc(itemName(p.loadout.special))}</div>
          <div class="menu row"><button data-nav data-act="cp-play" class="continue">ACCEPT CHALLENGE</button></div></div>` : ''}
        ${last ? `<div class="section">YOUR LAST CODE</div><div class="cp-last"><code><bdi>${esc(last)}</bdi></code><button data-nav data-act="cp-copylast">COPY</button></div>` : ''}`);
      const inp = body.querySelector<HTMLInputElement>('.cp-code');
      if (inp) inp.value = keep;
    } else if (this.tab === 'ranked') {
      const r = save.ranked;
      const t = tierOf(r.rating);
      const nx = toNextTier(r.rating);
      const lo = t.min;
      const hi = nx.next?.min ?? lo + 1;
      const pct = nx.next ? Math.round(((r.rating - lo) / (hi - lo)) * 100) : 100;
      const ladder = rankedLadder.enabled;
      if (ladder && this.ladder.season !== r.season && !this.ladder.busy) void this.loadLadder(false);
      body.innerHTML = localizeHtml(`
        <div class="rk-me px" style="--rk:${t.color}">
          <div class="rk-big">${rankBadge(r.rating, false)}</div>
          <div class="rk-info"><div class="rk-name">${t.name.toUpperCase()} <b>${r.rating}</b></div>
            <div class="rk-bar"><i style="width:${pct}%"></i></div>
            <div class="rk-sub">${nx.next ? `${nx.need} POINTS TO ${nx.next.name.toUpperCase()}` : 'TOP TIER'} · SEASON ${seasonName(r.season).toUpperCase()} · ${r.games} GAMES · ${r.wins} WINS · PEAK ${r.peak}</div></div>
        </div>
        <p class="note">Online RACE and PVP results move your rating (Elo: beating stronger players moves it more; your first 10 games of a season count extra). Each month is a new season: your rating moves halfway back to 1000.</p>
        <div class="rk-tiers">${RANK_TIERS.map((x) => `<span class="${x.id === t.id ? 'on' : ''}">${rankBadge(Math.max(x.min, 1), false)}<small>${x.name.toUpperCase()} ${x.min || ''}${x.min ? '+' : ''}</small></span>`).join('')}</div>
        ${r.history.length ? `<div class="section">PAST SEASONS</div><table class="rk-hist">${r.history.slice(0, 6).map((h) => `<tr><td>${seasonName(h.season).toUpperCase()}</td><td>${rankBadge(h.rating)}</td><td>PEAK ${h.peak}</td><td>${h.games} GAMES · ${h.wins} WINS</td></tr>`).join('')}</table>` : ''}
        <div class="section">ONLINE LADDER</div>
        ${ladder ? this.ladderHtml() : '<p class="note">The shared ladder needs the online service (a build with VITE_LEADERBOARD_URL). Your rating is kept on this PC.</p>'}`);
    } else {
      const t = this.tourney;
      const nm = t && nextMatch(t);
      body.innerHTML = localizeHtml(`
        <p class="note">A bracket for ${TOURNEY_MIN} to ${TOURNEY_MAX} friends. RACE ON THIS PC: players take turns on the same seed per match (furthest wins, then fastest, then score). ONLINE MATCHES: play each match as a PVP or RACE in an online lobby; results between the two names are recorded automatically, or record the winner by hand.</p>
        <div class="cp-card px">${t ? (t.champion >= 0 ? `CHAMPION: <b><bdi>${esc(t.names[t.champion].toUpperCase())}</bdi></b>` : nm ? `${roundName(t, nm.round)}: <b><bdi>${esc(t.names[nm.m.a].toUpperCase())}</bdi></b> VS <b><bdi>${esc(t.names[nm.m.b].toUpperCase())}</bdi></b>` : 'IN PROGRESS') : 'NO TOURNAMENT RUNNING'}
          <div class="menu row"><button data-nav data-act="tn-open" class="continue">${t ? 'OPEN BRACKET' : 'NEW TOURNAMENT'}</button></div></div>`);
    }
    el.querySelector('.cp-msg')!.innerHTML = localizeHtml(this.msg);
    if (this.game.screens.current === 'compete') this.competeNav.refresh(Math.min(this.competeNav.focus, 99));
  }

  private ladderHtml(): string {
    const l = this.ladder.list;
    if (this.ladder.busy) return '<p class="note">LOADING...</p>';
    if (!l) return '<p class="note">COULD NOT REACH THE LADDER. <button data-nav data-act="cp-ladder">RETRY</button></p>';
    if (!l.length) return '<p class="note">NOBODY ON THIS SEASON\'S LADDER YET. PLAY A RANKED MATCH!</p>';
    return `<table class="rk-hist">${l.slice(0, 20).map((e, i) => `<tr><td>${i + 1}</td><td><bdi>${esc(e.name)}</bdi></td><td>${rankBadge(e.rating)}</td><td>${e.games} GAMES</td></tr>`).join('')}</table>`;
  }

  private async loadLadder(force: boolean): Promise<void> {
    const season = save.ranked.season;
    if (this.ladder.busy || (!force && this.ladder.season === season)) return;
    this.ladder = { season, list: null, busy: true };
    const list = await rankedLadder.top(season);
    this.ladder = { season, list, busy: false };
    if (this.game.screens.current === 'compete' && this.tab === 'ranked') this.renderCompete();
  }

  // ---------------------------------------------------------------- TOURNAMENT

  openTourney(after?: { turn: { name: string; r: TurnResult }; won: number | null }): void {
    this.resetArmed = false;
    this.tmsg = '';
    const t = this.tourney;
    if (after && t) {
      const r = after.turn.r;
      this.tmsg = `<bdi>${esc(after.turn.name.toUpperCase())}</bdi>: ${r.p >= 2 ? `BOSS DOWN IN ${fmtClock(r.t)}` : rowLabel({ n: '', c: '', p: r.p, s: 'run', t: r.t, b: -1, lv: 1, r: -1 })} · ${r.score.toLocaleString('en-US')} POINTS.`;
      if (after.won !== null && after.won >= 0) {
        this.tmsg += ` <bdi>${esc(t.names[after.won].toUpperCase())}</bdi> WINS THE MATCH!`;
        if (t.champion < 0) raceSting('victory_fanfare');
      }
    }
    if (!t && !this.setupNames.length) this.setupNames = [this.game.hero.name || 'Player 1', '', '', '', '', '', '', ''];
    this.renderTourney();
    this.game.screens.show('tourney', 0);
  }

  private startTourney(): void {
    const st = raceState(this.game);
    if (!st) return;
    try {
      st.tourney = createTourney(this.setupNames, this.setupKind, (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0);
      storeTourney(this.game);
      this.tmsg = 'LET THE GAMES BEGIN!';
      raceSay('vo_ready', 'Ready?');
    } catch (err) {
      this.tmsg = (err as Error).message;
      sfx.deny();
    }
    this.renderTourney();
  }

  renderTourney(): void {
    const el = this.bracket;
    const t = this.tourney;
    const body = el.querySelector<HTMLElement>('.tn-body')!;
    const foot = el.querySelector<HTMLElement>('.tn-foot')!;
    if (!t) {
      while (this.setupNames.length < TOURNEY_MAX) this.setupNames.push('');
      body.innerHTML = localizeHtml(`
        <div class="section">PLAYERS (${TOURNEY_MIN}-${TOURNEY_MAX}, IN SEED ORDER)</div>
        <div class="tn-names">${this.setupNames.map((_, i) => `<input type="text" maxlength="12" data-i="${i}" placeholder="PLAYER ${i + 1}" spellcheck="false" autocomplete="off">`).join('')}</div>
        <div class="section">MATCHES</div>
        <div class="menu row"><button data-nav data-act="tn-kind" data-kind="race" class="diff ${this.setupKind === 'race' ? 'on' : ''}">RACE ON THIS PC</button><button data-nav data-act="tn-kind" data-kind="pvp" class="diff ${this.setupKind === 'pvp' ? 'on' : ''}">ONLINE MATCHES</button></div>
        <p class="note">${this.setupKind === 'race' ? 'Hot seat: both players of a match play the same seed in turn (Medium, your current loadout). One stage each: beat the boss fastest, or get furthest before the clock runs out.' : 'Play each match as an online PVP or RACE lobby. Results between the two players are recorded here automatically (same names), or press who won.'}</p>`);
      body.querySelectorAll<HTMLInputElement>('.tn-names input').forEach((inp, i) => (inp.value = this.setupNames[i] ?? ''));
      foot.innerHTML = localizeHtml('<button data-nav data-act="tn-start" class="continue">START TOURNAMENT</button><button data-nav data-act="tn-back">BACK</button>');
    } else {
      const nm = nextMatch(t);
      const cols = t.rounds
        .map((round, r) => {
          const ms = round
            .map((m, i) => {
              const cur = nm && nm.round === r && nm.match === i;
              const slot = (p: number, res?: TurnResult) => {
                const name = p >= 0 ? esc(t.names[p]) : p === -1 ? localize('BYE') : '...';
                const cls = p < 0 ? 'tbd' : m.w === p ? 'won' : m.w >= 0 ? 'lost' : '';
                const tag = res ? `<small>${res.p >= 2 ? fmtClock(res.t) : `${Math.round(Math.min(res.p, 2) * 50)}%`}</small>` : '';
                return `<div class="tn-slot ${cls}"><bdi>${name}</bdi>${tag}</div>`;
              };
              return `<div class="tn-match px ${cur ? 'cur' : ''}">${slot(m.a, m.ra)}${slot(m.b, m.rb)}</div>`;
            })
            .join('');
          return `<div class="tn-col"><div class="tn-round">${roundName(t, r)}</div><div class="tn-ms">${ms}</div></div>`;
        })
        .join('');
      const champ = t.champion >= 0 ? `<div class="tn-col tn-champ"><div class="tn-round">CHAMPION</div><div class="tn-trophy px"><i></i><b><bdi>${esc(t.names[t.champion].toUpperCase())}</bdi></b></div></div>` : '';
      let status = '';
      let acts = '';
      if (t.champion >= 0) status = `<bdi>${esc(t.names[t.champion].toUpperCase())}</bdi> WINS THE TOURNAMENT!`;
      else if (nm) {
        const a = t.names[nm.m.a];
        const b = t.names[nm.m.b];
        status = `${roundName(t, nm.round)}: <bdi>${esc(a.toUpperCase())}</bdi> VS <bdi>${esc(b.toUpperCase())}</bdi>`;
        if (t.kind === 'race') {
          const side = nm.m.ra ? 'b' : 'a';
          acts = `<button data-nav data-act="tn-play" data-side="${side}" class="continue">PLAY: <bdi>${esc((side === 'a' ? a : b).toUpperCase())}</bdi>'S TURN</button>`;
        } else acts = `<button data-nav data-act="tn-win" data-side="a"><bdi>${esc(a.toUpperCase())}</bdi> WON</button><button data-nav data-act="tn-win" data-side="b"><bdi>${esc(b.toUpperCase())}</bdi> WON</button>`;
      }
      body.innerHTML = localizeHtml(`<div class="tn-status">${status}</div><div class="tn-grid">${cols}${champ}</div>`);
      foot.innerHTML = localizeHtml(`${acts}<button data-nav data-act="tn-reset">NEW TOURNAMENT</button><button data-nav data-act="tn-back">BACK</button>`);
      if (t.champion >= 0 && this.championShown !== t.champion + t.seed) {
        this.championShown = t.champion + t.seed;
        raceSting('trophy');
        window.setTimeout(() => raceSay('vo_victory', 'Victory!'), 900);
      }
    }
    el.querySelector('.tn-msg')!.innerHTML = localizeHtml(this.tmsg);
    if (this.game.screens.current === 'tourney') this.bracketNav.refresh(Math.min(this.bracketNav.focus, 99));
  }

  // ---------------------------------------------------------------- lobby badges

  /** Rank badge on each lobby card (host and clients), from the `rkl` list. */
  decorateLobby(): void {
    const st = raceState(this.game);
    if (!st) return;
    const cards = this.root.querySelectorAll<HTMLElement>('#scr-online .lobby .players .lobby-player');
    const ranks = st.lobbyRanks;
    cards.forEach((card, i) => {
      const r = ranks[i]?.r ?? -1;
      const want = r >= 0 ? String(r) : '';
      const had = card.querySelector<HTMLElement>('.rk-badge');
      if ((had?.dataset.r ?? '') === want) return;
      had?.remove();
      if (!want) return;
      const top = card.querySelector('.lob-top') ?? card;
      top.insertAdjacentHTML('beforeend', localizeHtml(rankBadge(r, false).replace('<span class="rk-badge', `<span data-r="${want}" class="rk-badge`)));
    });
  }
}

const modeName = (m: string) => ({ standard: 'STANDARD', endless: 'ENDLESS', bossrush: 'BOSS RUSH' })[m] ?? m.toUpperCase();
const diffName = (d: string) => (DIFFICULTIES.find((x) => x.id === d)?.name ?? d).toUpperCase();
const heroName = (h: string) => (HEROES.find((x) => x.id === h)?.name ?? h).toUpperCase();
const itemName = (id: string) => (WEAPONS[id]?.name ?? SPECIALS[id]?.name ?? id).toUpperCase();

function injectCss(): void {
  if (document.getElementById('race-css')) return;
  const st = document.createElement('style');
  st.id = 'race-css';
  st.textContent = `
#race-hud {
  --bg: var(--ink); --hi: var(--night); --lo: var(--ink); --ring: transparent;
  position: absolute; right: 18px; top: calc(66 * var(--p)); width: 236px; padding: 5px 8px 6px;
  color: var(--white); font: 15px var(--font); line-height: 1; pointer-events: none; zoom: var(--ui, 1);
}
#race-hud .rc-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; font: 9px var(--label); color: var(--mist); }
#race-hud .rc-top b { font-weight: normal; color: var(--yellow); letter-spacing: 1px; }
#race-hud .rc-top .hot { color: var(--orange); animation: rcblink 0.6s steps(2) infinite; }
@keyframes rcblink { 50% { color: var(--white); } }
#race-hud .rc-row { display: grid; grid-template-columns: 12px 1fr auto; column-gap: 4px; align-items: baseline; padding: 2px 0; }
#race-hud .rc-row .pl { font: 13px var(--display); color: var(--mist); }
#race-hud .rc-row .nm { color: var(--c); overflow: hidden; white-space: nowrap; text-overflow: clip; }
#race-hud .rc-row .lb { font: 8px var(--label); color: var(--mist); }
#race-hud .rc-row .bar { grid-column: 2 / 4; position: relative; height: calc(1 * var(--p)); background: var(--night); margin-top: 2px; }
#race-hud .rc-row .bar i { display: block; height: 100%; background: var(--c); }
#race-hud .rc-row .bar u { position: absolute; left: 50%; top: -2px; bottom: -2px; width: 2px; background: var(--slate); }
#race-hud .rc-row.me .nm { color: var(--white); }
#race-hud .rc-row.me .pl { color: var(--yellow); }
#race-hud .rc-row.s-done .lb { color: var(--lime); }
#race-hud .rc-row.s-ko .nm, #race-hud .rc-row.s-left .nm { color: var(--slate); text-decoration: line-through; }
#race-hud .rc-row.s-boss .lb { color: var(--orange); }

#scr-raceres .rr-list { display: flex; flex-direction: column; gap: calc(2 * var(--p)); width: min(620px, calc(100vw - 32px)); margin: 8px auto; }
#scr-raceres .rr-row {
  --bg: var(--night); --hi: var(--slate); --lo: var(--ink); --ring: transparent;
  display: grid; grid-template-columns: 34px 1fr 30px auto 52px; gap: 8px; align-items: center; padding: 6px 10px; font: 20px var(--font); color: var(--white);
  border-left: calc(2 * var(--p)) solid var(--c);
}
#scr-raceres .rr-row .pl { font: 30px var(--display); color: var(--mist); }
#scr-raceres .rr-row .lb { font: 10px var(--label); color: var(--mist); text-align: right; }
#scr-raceres .rr-row .lv { font: 10px var(--label); color: var(--slate); text-align: right; }
#scr-raceres .rr-row small { font: 9px var(--label); color: var(--cyan); }
#scr-raceres .rr-row.me { --hi: var(--sky); }
#scr-raceres .rr-row.win { --ring: var(--yellow); --hi: var(--yellow); }
#scr-raceres .rr-row.win .pl { color: var(--yellow); }
#scr-raceres .rr-rating { min-height: 30px; display: flex; gap: 10px; justify-content: center; align-items: center; font: 26px var(--display); }
#scr-raceres .up { color: var(--lime); font-weight: normal; }
#scr-raceres .down { color: var(--red); font-weight: normal; }

.rk-badge { display: inline-flex; align-items: center; gap: 4px; vertical-align: middle; }
.rk-badge i {
  display: inline-grid; place-items: center; min-width: 22px; height: 18px; padding: 0 3px; font: 13px var(--display); font-style: normal;
  color: var(--ink); background: var(--rk); box-shadow: 0 0 0 2px var(--ink), inset -2px -2px 0 rgba(26, 28, 44, 0.35), inset 2px 2px 0 rgba(244, 244, 244, 0.45);
}
.rk-badge b { font: 10px var(--label); font-weight: normal; color: var(--rk); }
.rk-legend i { animation: rkshine 1.2s steps(2) infinite; }
@keyframes rkshine { 50% { background: var(--yellow); } }
.lob-card .rk-badge { margin-left: 6px; }

#scr-compete .cp-tabs .on, #scr-tourney .on { --hi: var(--yellow); color: var(--yellow); }
#scr-compete .cp-body { width: min(760px, calc(100vw - 32px)); margin: 0 auto; max-height: 56vh; overflow-y: auto; }
#scr-compete .cp-paste, #scr-compete .cp-last { display: flex; gap: 8px; justify-content: center; align-items: center; margin: 8px 0; flex-wrap: wrap; }
#scr-compete .cp-code { width: min(460px, 70vw); font: 18px var(--font); padding: 6px 8px; background: var(--ink); color: var(--white); border: 0; box-shadow: 0 0 0 3px var(--slate); }
#scr-compete code { font: 16px var(--font); color: var(--cyan); word-break: break-all; }
#scr-compete .cp-card { --bg: var(--night); --hi: var(--slate); --lo: var(--ink); padding: 10px 14px; margin: 10px auto; text-align: center; font: 20px var(--font); color: var(--white); }
#scr-compete .cp-card b { color: var(--yellow); font-weight: normal; }
#scr-compete .cp-card .kit { font: 10px var(--label); color: var(--mist); margin-top: 4px; }
#scr-compete .rk-me { --bg: var(--night); --hi: var(--rk); --lo: var(--ink); display: flex; gap: 16px; align-items: center; padding: 12px 16px; margin: 6px auto 10px; }
#scr-compete .rk-big .rk-badge i { min-width: 64px; height: 52px; font-size: 40px; box-shadow: 0 0 0 3px var(--ink), inset -4px -4px 0 rgba(26, 28, 44, 0.35), inset 4px 4px 0 rgba(244, 244, 244, 0.45); }
#scr-compete .rk-info { flex: 1; text-align: left; }
#scr-compete .rk-name { font: 30px var(--display); color: var(--rk); }
#scr-compete .rk-name b { color: var(--white); font-weight: normal; }
#scr-compete .rk-bar { height: calc(2 * var(--p)); background: var(--ink); margin: 6px 0; }
#scr-compete .rk-bar i { display: block; height: 100%; background: var(--rk); }
#scr-compete .rk-sub { font: 9px var(--label); color: var(--mist); }
#scr-compete .rk-tiers { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin: 8px 0; }
#scr-compete .rk-tiers span { display: flex; flex-direction: column; align-items: center; gap: 4px; opacity: 0.75; }
#scr-compete .rk-tiers span.on { opacity: 1; }
#scr-compete .rk-tiers small { font: 8px var(--label); color: var(--mist); }
#scr-compete .rk-hist { margin: 4px auto; font: 16px var(--font); color: var(--white); border-spacing: 12px 3px; }
#scr-compete .rk-hist td { font-size: 15px; }

#scr-tourney .tn-names { display: grid; grid-template-columns: repeat(4, minmax(110px, 160px)); gap: 8px; justify-content: center; margin: 6px 0 10px; }
#scr-tourney .tn-names input { font: 18px var(--font); padding: 5px 7px; background: var(--ink); color: var(--white); border: 0; box-shadow: 0 0 0 3px var(--slate); min-width: 0; }
#scr-tourney .section { margin: 10px 0 6px; }
#scr-tourney .tn-names + .section + .menu { margin-top: 4px; }
#scr-tourney .tn-status { font: 24px var(--display); color: var(--yellow); margin: 2px 0 8px; }
#scr-tourney .tn-grid { display: flex; gap: 14px; justify-content: center; align-items: stretch; overflow-x: auto; max-width: calc(100vw - 32px); margin: 0 auto; }
#scr-tourney .tn-col { display: flex; flex-direction: column; min-width: 132px; }
#scr-tourney .tn-round { font: 9px var(--label); color: var(--mist); margin-bottom: 6px; }
#scr-tourney .tn-ms { flex: 1; display: flex; flex-direction: column; justify-content: space-around; gap: 10px; }
#scr-tourney .tn-match { --bg: var(--night); --hi: var(--slate); --lo: var(--ink); padding: 4px 6px; }
#scr-tourney .tn-match.cur { --hi: var(--yellow); --ring: var(--yellow); }
#scr-tourney .tn-slot { display: flex; justify-content: space-between; gap: 6px; font: 18px var(--font); color: var(--white); padding: 1px 0; }
#scr-tourney .tn-slot + .tn-slot { border-top: 2px solid var(--ink); }
#scr-tourney .tn-slot small { font: 8px var(--label); color: var(--mist); align-self: center; }
#scr-tourney .tn-slot.won { color: var(--lime); }
#scr-tourney .tn-slot.lost { color: var(--slate); text-decoration: line-through; }
#scr-tourney .tn-slot.tbd { color: var(--slate); }
#scr-tourney .tn-champ .tn-trophy { --bg: var(--plum); --hi: var(--yellow); --lo: var(--ink); --ring: var(--yellow); padding: 10px; display: flex; flex-direction: column; align-items: center; gap: 6px; margin: auto 0; }
#scr-tourney .tn-trophy i {
  width: 30px; height: 30px; background: var(--yellow);
  clip-path: polygon(0 0, 100% 0, 100% 30%, 75% 60%, 60% 60%, 60% 80%, 80% 80%, 80% 100%, 20% 100%, 20% 80%, 40% 80%, 40% 60%, 25% 60%, 0 30%);
  animation: rkshine 0.8s steps(2) infinite;
}
#scr-tourney .tn-trophy b { font: 24px var(--display); color: var(--yellow); font-weight: normal; }

#scr-gameover .go-chal-line { margin: 4px 0; }
#scr-gameover .go-chal-line.win { color: var(--lime); }
#scr-gameover .go-chal-line.lose { color: var(--orange); }
#scr-gameover .go-chal-line.code { color: var(--cyan); word-break: break-all; }
@media (max-width: 700px) {
  #scr-tourney .tn-names { grid-template-columns: repeat(2, minmax(110px, 1fr)); }
  #scr-raceres .rr-row { grid-template-columns: 28px 1fr auto; }
  #scr-raceres .rr-row .rk-badge, #scr-raceres .rr-row .lv { display: none; }
}
`;
  document.head.appendChild(st);
}
