import { stationAt, stationIndex, stations, type Station } from '../data/asymRoles';
import type { Game } from '../game/game';
import { settings } from '../game/settings';
import { spectating, spectateWanted } from '../game/systems/spectate';
import { getLanguage, t } from '../i18n';
import { prompt } from './prompts';
import type { LobbyView } from './screens';

const name = (r: Station) => t('stations.' + r);
function button(label: string, choose: () => void, pressed?: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.dataset.nav = '';
  b.textContent = label;
  b.onclick = choose;
  if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
  return b;
}

function controls(
  row: HTMLElement,
  enabled: boolean,
  pick: Station,
  choose: (r: Station) => void,
  toggle?: () => void,
): void {
  if (toggle) row.append(button(t(enabled ? 'stations.on' : 'stations.off'), toggle, enabled));
  if (!enabled) return;
  const next = stations[(stationIndex(pick) + 1) % stations.length];
  const choice = button(t('stations.pick', { role: name(pick) }), () => choose(next));
  choice.title = t('stations.help.' + pick);
  row.append(choice);
  const help = document.createElement('small');
  help.textContent = choice.title;
  row.append(help);
}

export class AsymRoleHud {
  private panel?: HTMLElement;
  private role?: Station;
  private language = '';
  private wait = -1;
  private mech = false;
  private showLobby(g: Game, el: HTMLElement, v: LobbyView): void {
    let row = el.querySelector<HTMLElement>('.station-lobby');
    if (!row) {
      row = document.createElement('div');
      row.className = 'station-lobby station-options';
      el.querySelector('.lob-x')?.append(row);
    }
    row.replaceChildren();
    row.hidden = !v.code || !v.players.length || (v.kind ?? 'coop') !== 'coop';
    if (row.hidden) return;
    const a = g.asym;
    const word = v.isHost ? a.room(g) : a.lobbyWord;
    if (!v.isHost && (!word || spectateWanted(g))) {
      row.hidden = true;
      return;
    }
    const pick = v.isHost ? (g.lobby[0]?.station ?? 'gunner') : a.guestPick;
    controls(
      row,
      !!word,
      pick,
      (r) => {
        if (v.isHost) a.pick(g, '', r);
        else {
          a.guestPick = r;
          g.client?.send({ t: 'station', pick: r });
          this.showLobby(g, el, v);
        }
      },
      v.isHost
        ? () => {
            a.lobbyMode = !a.lobbyMode;
            g.refreshLobby();
          }
        : undefined,
    );
    if (word) {
      const roster = document.createElement('small');
      for (let i = 0; i < v.players.length; i++) {
        if (i) roster.append(' · ');
        const bdi = document.createElement('bdi');
        bdi.translate = false;
        bdi.textContent = v.players[i].name;
        roster.append(bdi, ' ', name(stationAt(word, i)));
      }
      row.append(roster);
    }
  }

  constructor(
    private readonly g: Game,
    private readonly root: HTMLElement,
  ) {
    const prior = g.screens.onLobby;
    g.screens.onLobby = (el, v) => {
      prior?.(el, v);
      this.showLobby(g, el, v);
    };
    g.screens.onSquadRoles = (el, redraw) => {
      const row = el.querySelector<HTMLElement>('.squad-options');
      if (
        !row ||
        !settings.squadBots ||
        !['standard', 'endless', 'bossrush'].includes(settings.mode)
      )
        return;
      const a = g.asym;
      const box = document.createElement('div');
      box.className = 'station-options';
      controls(
        box,
        a.squadMode,
        a.squadPick,
        (r) => {
          a.squadPick = r;
          redraw();
        },
        () => {
          a.squadMode = !a.squadMode;
          redraw();
        },
      );
      row.append(box);
    };
    if (!document.getElementById('station-style')) {
      const style = document.createElement('style');
      style.id = 'station-style';
      style.textContent = `.station-options {display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:calc(2 * var(--p));width:100%}
.station-options[hidden],.station-hud[hidden]{display:none}
.station-options small {flex-basis:100%;font:calc(5 * var(--p)) var(--font);text-align:center;color:var(--mist)}
.station-options button {font-size:calc(4.5 * var(--p));padding:var(--p) calc(2 * var(--p))}
.station-hud {--bg:var(--ink);--hi:var(--cyan);--lo:var(--navy);--ring:var(--ink);background:var(--bg);color:var(--white);border-inline-start:calc(2 * var(--p)) solid var(--hi);padding:var(--p) calc(2 * var(--p));font:calc(5 * var(--p)) var(--font);max-width:100%}
.station-hud strong {color:var(--cyan)}
.station-hud kbd {margin-inline:var(--p)}
.station-hud[data-role=pilot] {--hi:var(--yellow)}
.station-hud[data-role=scout] {--hi:var(--lime)}
.station-hud strong {color:var(--hi)}`;
      document.head.append(style);
    }
  }

  draw(): void {
    const g = this.g,
      a = g.asym;
    if (!a.word || !g.isCombatMode || spectating(g)) {
      if (this.panel && !this.panel.hidden) this.panel.hidden = true;
      return;
    }
    if (!this.panel) {
      this.panel = document.createElement('div');
      this.panel.className = 'station-hud';
      this.root.querySelector('#goals')?.prepend(this.panel);
    }
    const panel = this.panel;
    if (panel.hidden) panel.hidden = false;
    const h = g.hero,
      r = stationAt(a.word, h.index);
    const mech = r === 'pilot' && h.play.mechT > 0;
    const wait =
      r === 'scout' || r === 'pilot' ? Math.ceil(Math.max(0, a.readyAt[h.index] - g.runTime)) : 0;
    const lang = getLanguage();
    if (this.role === r && this.language === lang && this.wait === wait && this.mech === mech)
      return;
    this.role = r;
    this.language = lang;
    this.wait = wait;
    this.mech = mech;
    panel.dataset.role = r;
    const primary = mech
      ? 'cannons'
      : r === 'pilot'
        ? 'turret'
        : r === 'commander'
          ? 'send'
          : 'fire';
    const secondary = mech
      ? 'stomp'
      : r === 'pilot'
        ? 'mech'
        : r === 'scout'
          ? 'scan'
          : r === 'commander'
            ? 'recall'
            : 'secondary';
    panel.innerHTML =
      `<strong>${name(r)}</strong> · ${prompt('fire')}${t('stations.' + primary)} · ${prompt(mech ? 'move' : 'charge')}${t('stations.' + secondary)}` +
      (wait && !mech ? ' ' + t('stations.wait', { seconds: wait }) : '');
  }
}
