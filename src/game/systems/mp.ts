/**
 * MP lane wiring: Versus Swarm, shared-screen local co-op, the public lobby
 * browser and the weekly co-op team board. Game methods (`this` is the Game),
 * installed on the class as fields; per-Game UI and lobby state lives in a
 * WeakMap so Game only gains the `versus` and `localCoop` fields.
 *   mpTick   - every update (any role): Versus input/result, local co-op menu turns, join screen, lobby heartbeat
 *   mpFrame  - every render: Versus / local co-op cameras and HUDs
 *   mpReset  - back to the title (leaveToTitle)
 */
import type { Game } from '../game';
import { versusCamera, versusTick, versusClientMessage, isOverlord } from './versus';
import { localCoopCamera, localCoopTick } from './localCoop';
import { VersusUi } from '../../ui/versusUi';
import { LocalCoopUi } from '../../ui/localCoopUi';
import { LobbyBrowserUi, KIND_NAMES, esc } from '../../ui/lobbyBrowser';
import { TeamBoardUi, teamNameOf } from '../../ui/teamBoard';
import { lobbyService, lobbyTuning, lobbyToken, regionOf, type LobbyMode } from '../../net/lobbies';
import { recordTeamBest, teamBoard } from '../../net/teamboard';
import { settings, saveSettings } from '../settings';
import type { LobbyView, RunSummary } from '../../ui/screens';
import { leaderboardEnabled } from '../../net/leaderboard';
import { HERO_COLORS } from '../hero';

interface MpState {
  versusUi: VersusUi;
  localUi: LocalCoopUi;
  browser: LobbyBrowserUi;
  board: TeamBoardUi;
  /** Versus: the lobby peer id of the Overlord ('' = the host, 'AI' = the AI Overlord). */
  overlordPeer: string;
  /** Public listing of this machine's hosted lobby. */
  token: string;
  listed: string;
  sentKey: string;
  sentT: number;
  listStatus: string;
  /** Clients: the host's weekly team name (from the lobby). */
  team: string;
}

const states = new WeakMap<Game, MpState>();

export function mpState(g: Game): MpState | undefined {
  return states.get(g);
}

/** Build the MP lane's screens and HUD pieces (Game constructor). */
export function installMp(g: Game, root: HTMLElement): void {
  const st: MpState = {
    versusUi: new VersusUi(root, g),
    localUi: new LocalCoopUi(root, g),
    browser: new LobbyBrowserUi(root, g),
    board: null as unknown as TeamBoardUi,
    overlordPeer: '',
    token: '', // made on first listing (no Math.random at start-up: tests seed it)
    listed: '',
    sentKey: '',
    sentT: 0,
    listStatus: '',
    team: '',
  };
  st.board = new TeamBoardUi(root, g);
  root.querySelector('#scr-online .mp-choice [data-act=tb-open]')?.insertAdjacentHTML('afterend', '<button data-nav data-act="vs-practice">VERSUS VS AI</button>');
  states.set(g, st);
  g.screens.onLobby = (el, v) => renderLobbyExtras(g, el, v);
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    switch (b?.dataset.act) {
      case 'vs-practice':
        return g.versusSolo();
      case 'mp-ol':
        st.overlordPeer = b.dataset.peer ?? '';
        return g.refreshLobby();
      case 'mp-public':
        settings.lobbyPublic = !settings.lobbyPublic;
        saveSettings();
        st.sentKey = '';
        if (!settings.lobbyPublic) unlist(g, st);
        return g.refreshLobby();
    }
  });
}

/** Versus: the Overlord's hero index for the host's lobby (-1 = AI). */
export function versusOverlordIndex(g: Game): number {
  const st = states.get(g);
  if (!st || st.overlordPeer === 'AI') return -1;
  const i = g.lobby.findIndex((p) => p.peerId === st.overlordPeer);
  return i >= 0 ? i : 0;
}

/** Extra lobby fields the host broadcasts (Versus Overlord, weekly team, public listing). */
export function mpLobbyExtra(this: Game): Record<string, unknown> {
  const st = states.get(this);
  if (!st) return {};
  const ol = versusOverlordIndex(this);
  return { mp: { ol: ol < 0 ? 'AI' : this.lobby[ol]?.name ?? '', team: teamNameOf(this), pub: settings.lobbyPublic } };
}

/** The lobby screen's MP rows: Overlord pick (Versus), team name and rules (Weekly), PUBLIC (host). */
function renderLobbyExtras(g: Game, el: HTMLElement, v: LobbyView): void {
  const st = states.get(g);
  let box = el.querySelector<HTMLElement>('.mp-x');
  if (!box) {
    el.querySelector('.mp-kind-note')?.insertAdjacentHTML('afterend', '<div class="mp-x"></div>');
    box = el.querySelector<HTMLElement>('.mp-x')!;
  }
  if (!st || (!v.code && !v.players.length)) {
    box.innerHTML = '';
    return;
  }
  const x = (v.extra ?? {}) as { ol?: string; team?: string; pub?: boolean };
  if (x.team) st.team = x.team;
  const parts: string[] = [];
  if (v.kind === 'versus') {
    if (v.isHost) {
      const opts = [...g.lobby.map((p, i) => ({ peer: p.peerId, name: p.name, color: HERO_COLORS[i] })), { peer: 'AI', name: 'AI', color: '#b13e53' }];
      const cur = versusOverlordIndex(g) < 0 ? 'AI' : g.lobby[versusOverlordIndex(g)]?.peerId;
      parts.push(`<div class="section">OVERLORD</div><div class="menu row diff-row">${opts.map((o) => `<button data-nav data-act="mp-ol" data-peer="${esc(o.peer)}" class="diff ${o.peer === cur ? 'on' : ''}">${esc(o.name.toUpperCase())}</button>`).join('')}</div>`);
    } else parts.push(`<div class="note">OVERLORD: <b>${esc((x.ol ?? '').toUpperCase())}</b></div>`);
  }
  if (v.kind === 'weekly') parts.push(`<div class="note">TEAM: <b>${esc(x.team ?? '')}</b> · <button data-nav data-act="tb-open">WEEKLY CO-OP BOARD</button></div>`);
  if (v.isHost) {
    const svc = lobbyService.enabled;
    parts.push(
      `<div class="menu row"><button data-nav data-act="mp-public" class="diff ${settings.lobbyPublic ? 'on' : ''}">PUBLIC: ${settings.lobbyPublic ? 'ON' : 'OFF'}</button></div>` +
        `<div class="note">${!svc ? 'PUBLIC games need the online service (VITE_LEADERBOARD_URL). Share the code instead.' : settings.lobbyPublic ? st.listStatus || 'Listing in BROWSE GAMES...' : 'Turn PUBLIC on to list this game in BROWSE GAMES.'}</div>`,
    );
  }
  box.innerHTML = parts.join('');
}

/** Every update, before the role split (any role). */
export function mpTick(this: Game, dt: number): void {
  const st = states.get(this);
  versusTick.call(this, dt);
  localCoopTick.call(this);
  if (!st) return;
  st.localUi.update(dt);
  st.browser.update(dt);
  heartbeat(this, st, dt);
}

/** Every render frame: cameras (before the camera rig updates) and the MP HUDs. */
export function mpFrame(this: Game, _frameDt: number): void {
  versusCamera(this);
  localCoopCamera(this);
  const st = states.get(this);
  if (!st) return;
  st.versusUi.render();
  st.localUi.render();
}

/** Back to the title: no Versus match, no local co-op pads, no public listing. */
export function mpReset(this: Game): void {
  this.versus = null;
  this.localCoop = null;
  this.input.usePad(-1);
  const st = states.get(this);
  if (st) unlist(this, st);
}

/** Client: MP lane messages from the host. */
export function mpClientMessage(this: Game, m: Record<string, unknown>): boolean {
  return versusClientMessage.call(this, m);
}

/** Host: keep a PUBLIC lobby listed while it is open (heartbeat), unlist it when the game starts. */
function heartbeat(g: Game, st: MpState, dt: number): void {
  st.sentT -= dt;
  const open = g.role === 'host' && !!g.host?.code && g.mode === 'title' && !g.pvp && settings.lobbyPublic && lobbyService.enabled;
  if (!open) {
    if (st.listed && g.mode !== 'title') unlist(g, st);
    return;
  }
  const kind = g.lobbyKind as LobbyMode;
  const entry = { code: g.host!.code, name: g.netName || g.lobby[0]?.name || 'Player', players: g.lobby.length, max: kind === 'race' ? 8 : 4, mode: kind, difficulty: g.lobbyDifficulty().id, region: regionOf(), version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '' };
  const key = JSON.stringify(entry);
  const due = st.sentT <= 0 || (key !== st.sentKey && st.sentT <= lobbyTuning.heartbeat - lobbyTuning.minResend);
  if (!due) return;
  st.sentT = lobbyTuning.heartbeat;
  st.sentKey = key;
  st.token ||= lobbyToken();
  st.listed = entry.code;
  void lobbyService.register(entry, st.token).then((err) => {
    const s = err ? `Could not list the game (${err}).` : `Listed in BROWSE GAMES as ${KIND_NAMES[kind]} · ${entry.region}.`;
    if (s !== st.listStatus) {
      st.listStatus = s;
      if (g.role === 'host' && g.mode === 'title') g.refreshLobby();
    }
  });
}

function unlist(_g: Game, st: MpState): void {
  if (!st.listed) return;
  void lobbyService.close(st.listed, st.token);
  st.listed = '';
  st.sentKey = '';
  st.listStatus = '';
}

/**
 * Run banked (bankAndShow, every machine): a weekly co-op run (2+ heroes,
 * online or local) records the team's best on this machine, and the host (or
 * the local co-op PC) posts it to the team board.
 */
export function mpRunBanked(this: Game, sum: RunSummary): void {
  if (!this.meta.week || this.heroes.filter((h) => !h.left).length < 2 || this.pvp || this.versus) return;
  const members = this.heroes.filter((h) => h.name).map((h) => h.name);
  const team = this.role === 'client' ? states.get(this)?.team || 'Team' : teamNameOf(this);
  const score = Math.floor(sum.score);
  if (recordTeamBest(this.meta.week, { team, members, score, stage: sum.stage, date: new Date().toISOString().slice(0, 10) })) this.hud.toast('NEW TEAM BEST FOR THIS WEEK!', 4);
  if (this.role === 'client' || !(leaderboardEnabled || teamBoard.enabled)) return;
  void teamBoard.submit(this.meta.week, { team, members, score, stage: sum.stage, kills: sum.kills, time: sum.time }).then((r) => {
    if (r) this.hud.toast(`TEAM BOARD RANK #${r}!`, 4);
  });
}

export { isOverlord };
