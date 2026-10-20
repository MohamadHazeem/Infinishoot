import { localize, localizeHtml } from '../i18n';
import type { Game } from '../game/game';
import { playerName } from '../game/game';
import { persist, save } from '../game/save';
import { today } from '../data/modes';
import { addSaved, inviteBase, inviteLink, lastPlayed, parseInviteCode, removeSaved } from '../game/lobby';
import { ensureFriendCode } from '../game/systems/party';
import { copyText, esc } from './lobbyScreen';
import { sfx } from '../audio/sfx';

/**
 * EXTRAS > FRIENDS (also PLAY ONLINE > FRIENDS), lobby lane. Everything is
 * local to this PC (save.friends):
 * - YOUR FRIEND CODE: when HOST WITH MY CODE is on, hosting uses it as the
 *   room code, so friends who saved it (or your invite link) can join you any
 *   time you host.
 * - SAVED: friend codes you added (JOIN, REMOVE).
 * - RECENT: teammates from your last online runs (JOIN and SAVE when their
 *   friend code is known).
 */
export class FriendsUi {
  readonly screen: HTMLElement;
  private back: 'extras' | 'online' = 'extras';
  private msg = '';

  constructor(
    root: HTMLElement,
    private game: Game,
  ) {
    injectCss();
    const t = document.createElement('template');
    t.innerHTML = localizeHtml(`<div id="scr-friends" class="screen dim">
      <h1>FRIENDS</h1>
      <div class="fr-me"></div>
      <div class="menu row"><button data-nav data-act="fr-copy">COPY MY INVITE LINK</button><button data-nav data-act="fr-usecode"></button></div>
      <div class="section">ADD A FRIEND</div>
      <div class="fr-add"><input type="text" class="fr-name" maxlength="12" placeholder="NAME" spellcheck="false" autocomplete="off"><input type="text" class="fr-code" placeholder="CODE OR LINK" spellcheck="false" autocomplete="off"><button data-nav data-act="fr-add">SAVE</button></div>
      <div class="note fr-msg"></div>
      <div class="scroll fr-lists"></div>
      <div class="menu row"><button data-nav data-act="fr-back">BACK</button></div>
    </div>`);
    this.screen = t.content.firstElementChild as HTMLElement;
    game.screens.addScreen('friends', this.screen, { columns: 3, onBack: () => this.close() });
    root.querySelector('#scr-extras .menu [data-act=history]')?.insertAdjacentHTML('afterend', localizeHtml('<button data-nav data-act="fr-open-x">FRIENDS</button>'));
    for (const inp of this.screen.querySelectorAll('input')) inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.add();
      if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
    });
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      switch (b?.dataset.act) {
        case 'fr-open':
          return this.open('online');
        case 'fr-open-x':
          return this.open('extras');
        case 'fr-back':
          return this.close();
        case 'fr-copy':
          return void this.copy();
        case 'fr-usecode':
          save.friends.useCode = !save.friends.useCode;
          persist();
          return this.render();
        case 'fr-add':
          return this.add();
        case 'fr-join':
          return void this.join(b.dataset.code ?? '');
        case 'fr-save': {
          const r = save.friends.recent[Number(b.dataset.i)];
          const list = r ? addSaved(save.friends.saved, r.name, r.code) : null;
          if (list) {
            save.friends.saved = list;
            persist();
            this.msg = 'FRIEND SAVED.';
          }
          return this.render();
        }
        case 'fr-del':
          save.friends.saved = removeSaved(save.friends.saved, b.dataset.code ?? '');
          persist();
          this.msg = 'REMOVED.';
          return this.render();
      }
    });
  }

  open(from: 'extras' | 'online'): void {
    this.back = from;
    this.msg = '';
    ensureFriendCode();
    this.render(true);
    this.game.screens.show('friends', 0);
  }

  private close(): void {
    if (this.back === 'online') this.game.screens.showOnline(playerName());
    else this.game.screens.show('extras');
  }

  private link(): string {
    return inviteLink(inviteBase(typeof location === 'undefined' ? undefined : location), ensureFriendCode());
  }

  private async copy(): Promise<void> {
    const ok = await copyText(this.link());
    this.msg = ok ? 'INVITE LINK COPIED. IT WORKS WHENEVER YOU HOST WITH YOUR CODE.' : 'COPY FAILED: SHARE YOUR CODE INSTEAD.';
    if (ok) sfx.ui('confirm', 0.5);
    this.render();
  }

  private add(): void {
    const name = this.screen.querySelector<HTMLInputElement>('.fr-name')!;
    const code = this.screen.querySelector<HTMLInputElement>('.fr-code')!;
    const c = parseInviteCode(code.value);
    if (!c) {
      this.msg = 'THAT IS NOT A FRIEND CODE (5 LETTERS AND NUMBERS, OR AN INVITE LINK).';
      sfx.deny();
    } else if (c === save.friends.code) {
      this.msg = "THAT'S YOUR OWN CODE.";
      sfx.deny();
    } else {
      save.friends.saved = addSaved(save.friends.saved, name.value, c)!;
      persist();
      this.msg = 'FRIEND SAVED.';
      name.value = code.value = '';
      sfx.ui('confirm', 0.5);
    }
    this.render();
  }

  private async join(code: string): Promise<void> {
    const c = parseInviteCode(code);
    if (!c) return;
    this.game.screens.showOnline(playerName());
    await this.game.joinGame(playerName(), c);
  }

  render(opening = false): void {
    const s = this.screen;
    const f = save.friends;
    s.querySelector('.fr-me')!.innerHTML = localizeHtml(`<div class="code-label">YOUR FRIEND CODE</div><div class="fr-code-big"><bdi>${esc(f.code)}</bdi></div>`);
    s.querySelector('[data-act=fr-usecode]')!.textContent = localize(`HOST WITH MY CODE: ${f.useCode ? 'ON' : 'OFF'}`);
    s.querySelector('.fr-msg')!.textContent = localize(this.msg || (f.useCode ? 'Friends who save your code can join whenever you host.' : 'Hosting picks a new random code each time.'));
    const day = today();
    const saved = f.saved.length
      ? f.saved.map((x) => `<div class="fr-row"><b><bdi>${esc(x.name.toUpperCase())}</bdi></b><span><bdi>${x.code}</bdi></span><button data-nav data-act="fr-join" data-code="${x.code}">JOIN</button><button data-nav data-act="fr-del" data-code="${x.code}">REMOVE</button></div>`).join('')
      : '<div class="fr-empty">No saved codes yet. Add one above, or save a recent teammate.</div>';
    const recent = f.recent.length
      ? f.recent
          .map((r, i) => {
            const known = !!r.code && !f.saved.some((x) => x.code === r.code);
            return `<div class="fr-row"><b><bdi>${esc(r.name.toUpperCase())}</bdi></b><span>${lastPlayed(r.last, day)}${r.runs > 1 ? ` · ${r.runs} RUNS` : ''}${r.code ? ` · <bdi>${r.code}</bdi>` : ''}</span>${r.code ? `<button data-nav data-act="fr-join" data-code="${r.code}">JOIN</button>` : '<i></i>'}${known ? `<button data-nav data-act="fr-save" data-i="${i}">SAVE</button>` : '<i></i>'}</div>`;
          })
          .join('')
      : '<div class="fr-empty">Play online and your teammates show up here.</div>';
    const focus = this.focusIndex();
    s.querySelector('.fr-lists')!.innerHTML = localizeHtml(`<div class="section">SAVED</div>${saved}<div class="section">RECENT PLAYERS</div>${recent}`);
    if (!opening && this.game.screens.current === 'friends') this.game.screens.show('friends', focus);
  }

  private focusIndex(): number {
    const items = [...this.screen.querySelectorAll<HTMLElement>('[data-nav]')];
    return Math.max(0, items.findIndex((e) => e.classList.contains('focused')));
  }
}

function injectCss(): void {
  if (document.getElementById('friends-lane-css')) return;
  const st = document.createElement('style');
  st.id = 'friends-lane-css';
  st.textContent = `
#scr-friends .fr-me { text-align: center; }
#scr-friends .fr-code-big { font-family: var(--display); font-size: 56px; letter-spacing: 10px; color: var(--yellow); user-select: text; text-shadow: var(--outline), 0 4px 0 var(--orange), 0 7px 0 var(--ink); }
#scr-friends .fr-add { display: flex; gap: 10px; align-items: center; }
#scr-friends .fr-add input { font: 22px var(--font); padding: 6px 10px; width: 170px; color: var(--ink); background: var(--white); border: 0; outline: none; text-transform: uppercase; box-shadow: inset 0 0 0 var(--p) var(--mist); }
#scr-friends .fr-add input:focus { box-shadow: inset 0 0 0 var(--p) var(--yellow); }
#scr-friends .fr-msg { margin: 0; font: 10px var(--label); color: var(--mist); }
#scr-friends .fr-lists { width: min(640px, 92vw); max-height: 42vh; display: flex; flex-direction: column; gap: 6px; }
#scr-friends .fr-row { display: grid; grid-template-columns: 1fr auto 90px 110px; gap: 10px; align-items: center; font-size: 22px; padding: 2px 6px; background: var(--ink); }
#scr-friends .fr-row b { font-weight: normal; color: var(--white); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#scr-friends .fr-row span { font: 10px var(--label); color: var(--mist); }
#scr-friends .fr-row button { font-size: 16px; padding: 2px 8px; }
#scr-friends .fr-empty { font: 10px var(--label); color: var(--slate); padding: 6px; }
`;
  document.head.appendChild(st);
}
