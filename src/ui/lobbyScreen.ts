import type { Game } from '../game/game';
import { playerName } from '../game/game';
import type { LobbyView } from './screens';
import { heroOf } from '../data/heroes';
import { skinOf } from '../data/skins';
import { metaSkin } from '../data/codex';
import { PET_BY_ID } from '../data/pets';
import { chatTuning, inviteBase, inviteLink, parseInviteCode, pingBand, QUICK_CHAT } from '../game/lobby';
import { chatLog, lobbyX } from '../game/systems/party';
import { sfx } from '../audio/sfx';
import { titleChip } from './coopTitle';

/**
 * PLAY ONLINE lobby, lobby lane (notes/lanes/lobby.md): player cards (hero,
 * profile level, best stage, cosmetics, ping, READY), KICK for the host, the
 * READY toggle and its countdown, COPY INVITE LINK, and the chat panel.
 * Drawn on top of the base lobby (Screens.setLobby) through the `onLobby` hook.
 */
export class LobbyUi {
  private last: LobbyView | null = null;
  private box: HTMLElement | null = null;
  readonly chat: ChatBox;

  constructor(
    private root: HTMLElement,
    private game: Game,
  ) {
    injectCss();
    this.chat = new ChatBox(game, 'lob');
    const online = root.querySelector<HTMLElement>('#scr-online');
    // Joining: the code field takes a pasted invite link as well (the desktop app can't open links).
    const code = online?.querySelector<HTMLInputElement>('#mp-code');
    if (code) {
      code.removeAttribute('maxlength');
      code.placeholder = 'CODE';
      code.title = 'Type a code or paste an invite link';
      code.addEventListener('input', () => {
        if (code.value.length <= 5) return;
        const c = parseInviteCode(code.value);
        code.value = c ?? code.value.slice(0, 5);
      });
    }
    online?.querySelector('.mp-choice [data-act=mp-host]')?.insertAdjacentHTML('afterend', '<button data-nav data-act="fr-open">FRIENDS</button>');
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      switch (b?.dataset.act) {
        case 'lob-ready':
          return this.game.lobbyReady();
        case 'lob-kick':
          return this.game.lobbyKick(Number(b.dataset.i));
        case 'lob-invite':
          return void this.copyInvite();
      }
    });
  }

  /** After Screens.setLobby. */
  render(el: HTMLElement, v: LobbyView): void {
    this.last = v;
    const inLobby = v.code !== '' || v.players.length > 0;
    if (!this.box) {
      el.querySelector('.lobby .players')?.insertAdjacentHTML('afterend', '<div class="lob-x"><div class="menu row lob-acts"></div><div class="menu row lob-kicks"></div><div class="note lob-status"></div></div>');
      this.box = el.querySelector<HTMLElement>('.lob-x');
      el.appendChild(this.chat.el);
    }
    this.chat.el.hidden = !inLobby || !v.players.length;
    el.classList.toggle('lob-in', inLobby && v.players.length > 0);
    if (!inLobby || !v.players.length) {
      this.box!.hidden = true;
      return;
    }
    this.box!.hidden = false;
    const link = v.isHost && v.code ? this.link(v.code) : '';
    this.box!.querySelector('.lob-acts')!.innerHTML =
      `<button data-nav data-act="lob-ready" class="lob-readybtn"></button>` +
      (link ? `<button data-nav data-act="lob-invite">COPY INVITE LINK</button>` : '');
    // KICK buttons live here, not on the cards: cards redraw every ping, buttons only when the player list changes.
    this.box!.querySelector('.lob-kicks')!.innerHTML = v.isHost ? v.players.map((p, i) => (i > 0 ? `<button data-nav data-act="lob-kick" data-i="${i}" class="lob-kick">KICK ${esc(p.name.toUpperCase())}</button>` : '')).join('') : '';
    this.renderCards();
    this.chat.render();
  }

  private link(code: string): string {
    return inviteLink(inviteBase(typeof location === 'undefined' ? undefined : location), code);
  }

  /** Player cards, READY state and the countdown line (also on every `lbx`). */
  renderCards(): void {
    const v = this.last;
    const el = this.root.querySelector<HTMLElement>('#scr-online .lobby .players');
    if (!v || !el || (!v.code && !v.players.length)) return;
    const x = lobbyX(this.game);
    el.innerHTML = v.players
      .map((p, i) => {
        const c = x?.p[i];
        const hero = c?.hero ? heroOf(c.hero).name : '';
        const skin = c?.skin ? (metaSkin(c.skin) ?? skinOf(c.skin)).name : '';
        const pet = c?.pet && c.pet !== 'none' ? PET_BY_ID[c.pet]?.name ?? '' : '';
        const prof = c?.prof;
        const ping = i === 0 ? '<span class="ping host">HOST</span>' : c && c.ping >= 0 ? `<span class="ping ${pingBand(c.ping)}">${c.ping} MS</span>` : '<span class="ping">... MS</span>';
        const tags = x && x.you === i ? '<small class="you">YOU</small>' : '';
        return `<div class="lobby-player lob-card ${c?.ready ? 'ready' : ''}" style="--c:${p.color}">
          <div class="lob-top"><span class="dot"></span><b>${esc(p.name)}</b>${tags}${titleChip((p as { title?: string }).title ?? '')}<span class="lob-flag">${c?.ready ? 'READY' : 'NOT READY'}</span></div>
          <div class="lob-line">${esc(hero.toUpperCase())}${prof ? ` · LV ${prof.lv} · BEST STAGE ${prof.best || '-'}` : ''}</div>
          ${p.kit ? `<div class="lob-line kit">${esc(p.kit)}</div>` : ''}
          <div class="lob-line cos">${esc([skin, pet].filter(Boolean).join(' · ').toUpperCase())}${ping}</div>
        </div>`;
      })
      .join('');
    // READY button and status line.
    const me = x && x.you >= 0 ? x.p[x.you] : null;
    const btn = this.box?.querySelector<HTMLElement>('.lob-readybtn');
    if (btn) {
      btn.textContent = me?.ready ? 'READY ✓' : 'READY UP';
      btn.classList.toggle('on', !!me?.ready);
    }
    const n = x ? x.p.filter((c) => c.ready).length : 0;
    const total = v.players.length;
    const status = this.box?.querySelector<HTMLElement>('.lob-status');
    if (status)
      status.textContent =
        x && x.cd >= 0
          ? `EVERYONE IS READY · STARTING IN ${x.cd}...`
          : total < 2
            ? v.isHost
              ? 'Share the code or the invite link. START GAME plays now.'
              : ''
            : `${n}/${total} READY · the run starts when everyone is ready${v.isHost ? ' (or START GAME now)' : ''}`;
    this.root.querySelector('#scr-online')?.classList.toggle('lob-counting', !!x && x.cd >= 0);
  }

  renderChat(): void {
    this.chat.render();
  }

  private async copyInvite(): Promise<void> {
    const code = this.last?.code;
    if (!code) return;
    const url = this.link(code);
    const ok = await copyText(url);
    this.game.hud.toast(ok ? 'INVITE LINK COPIED!' : 'COPY FAILED: SHARE THE CODE INSTEAD', 2.5);
    if (ok) sfx.ui('confirm', 0.5);
  }

  /** `?join=CODE` in the address: straight to joining that game. */
  checkInviteUrl(): void {
    if (typeof location === 'undefined') return;
    const q = new URLSearchParams(location.search);
    const code = parseInviteCode(`?join=${q.get('join') ?? ''}`);
    if (!code) return;
    try {
      q.delete('join');
      const rest = q.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    } catch {
      // file:// or sandboxed pages may refuse; joining still works.
    }
    this.game.screens.showOnline(playerName());
    const input = this.root.querySelector<HTMLInputElement>('#mp-code');
    if (input) input.value = code;
    void this.game.joinGame(playerName(), code);
  }
}

/** Copy to the clipboard, with the old textarea fallback (http pages, older Electron). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.('copy') ?? false;
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * The chat panel (lobby and party screens): log, QUICK CHAT phrases (pad
 * friendly) and a text field. SAY focuses the field when it's empty; Enter
 * sends, Esc leaves the field.
 */
export class ChatBox {
  readonly el: HTMLElement;
  private log: HTMLElement;
  private input: HTMLInputElement;

  constructor(
    private game: Game,
    kind: string,
  ) {
    const t = document.createElement('template');
    t.innerHTML = `<div class="lob-chat ${kind}-chat">
      <div class="lob-chat-title">CHAT</div>
      <div class="lob-log"></div>
      <div class="lob-quick">${QUICK_CHAT.map((q, i) => `<button data-nav data-act="chat-quick" data-q="${i}">${esc(q)}</button>`).join('')}</div>
      <div class="lob-say"><input type="text" class="lob-input" maxlength="${chatTuning.maxLen}" placeholder="TYPE HERE..." spellcheck="false" autocomplete="off"><button data-nav data-act="chat-say">SAY</button></div>
    </div>`;
    this.el = t.content.firstElementChild as HTMLElement;
    this.log = this.el.querySelector('.lob-log')!;
    this.input = this.el.querySelector('.lob-input')!;
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (b?.dataset.act === 'chat-quick') this.game.lobbyChat(Number(b.dataset.q));
      else if (b?.dataset.act === 'chat-say') {
        if (this.input.value.trim()) this.send();
        else this.input.focus();
      }
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.send();
      } else if (e.key === 'Escape') this.input.blur();
    });
  }

  private send(): void {
    const s = this.input.value.trim();
    if (!s) return;
    this.game.lobbyChat(s);
    this.input.value = '';
  }

  render(): void {
    const lines = chatLog(this.game).slice(-8);
    this.log.innerHTML = lines.length
      ? lines.map((l) => (l.sys ? `<div class="sys">${esc(l.s)}</div>` : `<div><b style="color:${safeColor(l.c)}">${esc(l.n)}:</b> ${esc(l.s)}</div>`)).join('')
      : '<div class="sys">Say hi! Quick chat works on a gamepad.</div>';
    this.log.scrollTop = this.log.scrollHeight;
  }
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function safeColor(c: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#f4f4f4';
}

function injectCss(): void {
  if (document.getElementById('lobby-lane-css')) return;
  const st = document.createElement('style');
  st.id = 'lobby-lane-css';
  st.textContent = `
#scr-online .players { gap: calc(3 * var(--p)); }
#scr-online.lob-in > p.note { display: none; }
#scr-online.lob-in .code-big { font-size: 60px; margin: 0; }
#scr-online.lob-in .lobby .players { max-width: 560px; margin-left: auto; margin-right: auto; }
.lob-card { flex-direction: column; align-items: stretch; gap: 2px; width: 250px; padding: 6px 12px 8px; font-size: 20px; text-align: left; }
.lob-card.ready { --ring: var(--lime); }
.lob-card .lob-top { display: flex; align-items: center; gap: 8px; }
.lob-card .lob-top b { font-weight: normal; color: var(--c, var(--white)); text-shadow: var(--outline); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lob-card .lob-top small.you { font: 10px var(--label); color: var(--cyan); }
.lob-card .lob-flag { margin-left: auto; font: 9px var(--label); color: var(--slate); }
.lob-card.ready .lob-flag { color: var(--lime); }
.lob-card .lob-line { font: 10px var(--label); color: var(--mist); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lob-card .lob-line.kit { color: var(--yellow); }
.lob-card .lob-line.cos { display: flex; gap: 8px; }
.lob-card .ping { margin-left: auto; color: var(--slate); }
.lob-card .ping.good { color: var(--lime); }
.lob-card .ping.ok { color: var(--yellow); }
.lob-card .ping.bad { color: var(--red); }
.lob-card .ping.host { color: var(--cyan); }
.lob-kicks:empty { display: none; }
.screen button.lob-kick { font-size: 14px; padding: 4px 10px; --bg: var(--red); --hi: var(--orange); }
.lob-x { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-top: 10px; }
.lob-x[hidden] { display: none; }
.lob-x .lob-status { margin: 0; font: 11px var(--label); color: var(--mist); }
#scr-online.lob-counting .lob-status { color: var(--lime); animation: lob-blink 0.6s steps(2) infinite; }
@keyframes lob-blink { 50% { opacity: 0.4; } }
.screen button.lob-readybtn.on { --bg: var(--green); --hi: var(--lime); }
.lob-chat { --bg: var(--ink); --hi: var(--night); --lo: var(--ink); position: absolute; right: 12px; top: 96px; width: 240px; display: flex; flex-direction: column; gap: 6px; padding: 10px; background: var(--ink);
  box-shadow: inset var(--p) var(--p) 0 0 var(--night), 0 calc(-1 * var(--p)) 0 0 var(--slate), 0 var(--p) 0 0 var(--slate), calc(-1 * var(--p)) 0 0 0 var(--slate), var(--p) 0 0 0 var(--slate); z-index: 2; }
.lob-chat[hidden] { display: none; }
.lob-chat-title { font: 11px var(--label); letter-spacing: 3px; color: var(--cyan); }
.lob-log { height: 150px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; font-size: 18px; color: var(--white); text-align: left; word-break: break-word; }
.lob-log b { font-weight: normal; }
.lob-log .sys { font: 10px var(--label); color: var(--slate); }
.lob-quick { display: flex; flex-wrap: wrap; gap: 6px; }
.screen .lob-quick button { font-size: 14px; padding: 2px 8px; }
.lob-say { display: flex; gap: 6px; }
.lob-say input { flex: 1; min-width: 0; font: 18px var(--font); padding: 4px 8px; color: var(--ink); background: var(--white); border: 0; outline: none; box-shadow: inset 0 0 0 var(--p) var(--mist); }
.lob-say input:focus { box-shadow: inset 0 0 0 var(--p) var(--yellow); }
.screen .lob-say button { font-size: 16px; padding: 2px 12px; }
@media (max-width: 1240px) {
  .lob-chat { position: static; width: min(520px, 92vw); margin: 8px auto 0; }
  .lob-log { height: 72px; }
}
`;
  document.head.appendChild(st);
}
