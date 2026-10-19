import { localizeHtml, localize } from '../i18n';
import type { Game } from '../game/game';
import { clock } from '../game/game';
import { isoWeek } from '../data/weekly';
import { ghostCodeSmall, readGhostCode, type Ghost } from '../game/modes/ghost';
import { ghostStore } from '../game/modes/ghostStore';
import { fetchGhostCode, fetchGhosts, ghostsOnline, uploadGhost, type GhostEntry } from '../net/ghostNet';
import { sfx } from '../audio/sfx';

/**
 * EXTRAS > GHOST RACE (modes lane): this week's best run of yours, the rival you race, and the
 * ways to swap ghosts: copy or save your code, paste or load a friend's, and (when the online
 * board is configured) upload yours or pick one from the week's board. Works offline.
 */
const CSS = `
#scr-ghostrace .gh-panel { width: min(640px, calc(100vw - 32px)); margin: 0 auto calc(3 * var(--p)); padding: calc(3 * var(--p)) calc(4 * var(--p)); background: var(--night); box-shadow: inset var(--p) var(--p) 0 0 var(--slate), inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 0 var(--ink), 0 0 0 var(--p) var(--ink); text-align: left; }
#scr-ghostrace .gh-row { display: flex; justify-content: space-between; gap: 12px; font: 16px var(--font); color: var(--white); padding: var(--p) 0; }
#scr-ghostrace .gh-row b { font: 11px var(--label); letter-spacing: 1px; color: var(--cyan); font-weight: normal; }
#scr-ghostrace .gh-row .dim { color: var(--mist); }
#scr-ghostrace textarea { display: block; box-sizing: border-box; width: 100%; height: 64px; margin-top: calc(2 * var(--p)); resize: none; background: var(--ink); color: var(--mist); border: none; outline: none; padding: calc(2 * var(--p)); font: 12px var(--label); box-shadow: 0 0 0 var(--p) var(--slate); word-break: break-all; }
#scr-ghostrace .gh-msg { min-height: 18px; margin-top: calc(2 * var(--p)); font: 14px var(--font); color: var(--lime); }
#scr-ghostrace .gh-msg.err { color: var(--red); }
#scr-ghostrace .menu.row { flex-wrap: wrap; justify-content: center; max-width: min(760px, calc(100vw - 32px)); margin: 0 auto; }
#scr-ghostrace .gh-list { display: flex; flex-direction: column; gap: var(--p); width: min(640px, calc(100vw - 32px)); margin: calc(3 * var(--p)) auto 0; }
#scr-ghostrace .gh-list button { text-align: left; }
`;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function line(g: Ghost | null): string {
  return g ? `${g.score.toLocaleString('en-US')} · STAGE ${g.stage} · ${clock(g.length)}` : '<span class="dim">NO RUN YET</span>';
}

export class GhostScreen {
  readonly el: HTMLElement;
  private file: HTMLInputElement;
  private list: GhostEntry[] = [];

  constructor(private game: Game) {
    if (!document.getElementById('ghostrace-css')) {
      const st = document.createElement('style');
      st.id = 'ghostrace-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.id = 'scr-ghostrace';
    this.el.className = 'screen dim';
    this.file = document.createElement('input');
    this.file.type = 'file';
    this.file.accept = '.isghost,.txt,text/plain';
    this.file.hidden = true;
    game.screens.addScreen('ghostrace', this.el, { columns: 3, onBack: () => game.screens.show('extras') });
    // EXTRAS > GHOST RACE, after RUN HISTORY.
    const after = document.querySelector('#scr-extras [data-act=history]');
    if (after && !document.querySelector('#scr-extras [data-act=gr-open]')) {
      after.insertAdjacentHTML('afterend', localizeHtml('<button data-nav data-act="gr-open">GHOST RACE</button>'));
      document.querySelector('#scr-extras [data-act=gr-open]')?.addEventListener('click', () => this.open());
    }
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-gh]');
      if (b) void this.act(b.dataset.gh!, b.dataset.id);
    });
  }

  private get week(): string {
    return this.game.meta.week || isoWeek();
  }

  open(): void {
    this.render();
    this.game.screens.show('ghostrace');
  }

  private msg(text: string, ok = true): void {
    const m = this.el.querySelector<HTMLElement>('.gh-msg');
    if (!m) return;
    m.textContent = localize(text);
    m.classList.toggle('err', !ok);
  }

  render(): void {
    const week = this.week;
    const mine = ghostStore.mine(week);
    const rival = ghostStore.rival();
    const rivalText = rival ? `<bdi>${esc(rival.name.toUpperCase())}</bdi> · ${line(rival)}${rival.week !== week ? ` <span class="dim">(${esc(rival.week)})</span>` : ''}` : '<span class="dim">YOUR OWN BEST</span>';
    const online = ghostsOnline
      ? `<button data-nav data-gh="upload">UPLOAD MINE</button><button data-nav data-gh="browse">BROWSE ONLINE</button>`
      : '';
    this.el.innerHTML = localizeHtml(`<h1>GHOST RACE</h1>
      <p class="note">Race a friend's Weekly Challenge run: their ghost runs beside you, with a live score and time delta.</p>
      <div class="gh-panel">
        <div class="gh-row"><b>THIS WEEK</b><span>${esc(week)}</span></div>
        <div class="gh-row"><b>YOUR BEST</b><span>${line(mine)}</span></div>
        <div class="gh-row"><b>YOU RACE</b><span>${rivalText}</span></div>
        <textarea class="gh-code" spellcheck="false" placeholder="Paste a friend's ghost code here (it starts with ISG1)"></textarea>
        <div class="gh-msg"></div>
      </div>
      <div class="menu row">
        <button data-nav data-gh="copy">COPY MY CODE</button>
        <button data-nav data-gh="save">SAVE FILE</button>
        <button data-nav data-gh="paste">RACE PASTED CODE</button>
        <button data-nav data-gh="load">LOAD FILE</button>
        <button data-nav data-gh="mine">RACE MY BEST</button>
        ${online}
        <button data-nav data-gh="back">BACK</button>
      </div>
      <div class="gh-list">${this.list.map((e, i) => `<button data-nav data-gh="pick" data-id="${i}">#${i + 1} <bdi>${esc(e.name.toUpperCase())}</bdi> · ${e.score.toLocaleString('en-US')} · STAGE ${e.stage} · ${clock(e.time)}</button>`).join('')}</div>`);
    this.el.append(this.file);
    if (this.game.screens.current === 'ghostrace') this.game.screens.show('ghostrace'); // re-scan the buttons
  }

  private race(g: Ghost): void {
    ghostStore.setRival(g);
    this.render();
    this.msg(g.week === this.week ? `RACING ${g.name.toUpperCase()} IN THIS WEEK'S CHALLENGE` : `SAVED. ${g.name.toUpperCase()}'S GHOST IS FROM ${g.week}: IT SHOWS IN THAT WEEK'S CHALLENGE`);
    sfx.powerUp();
  }

  private async act(a: string, id?: string): Promise<void> {
    const week = this.week;
    const mine = ghostStore.mine(week);
    switch (a) {
      case 'back':
        return this.game.screens.show('extras');
      case 'copy':
      case 'save': {
        if (!mine) return this.msg('PLAY THIS WEEK\'S CHALLENGE FIRST: YOUR GHOST IS RECORDED AS YOU PLAY', false);
        const code = await ghostCodeSmall(mine);
        const ta = this.el.querySelector<HTMLTextAreaElement>('.gh-code');
        if (ta) ta.value = code;
        if (a === 'copy') {
          try {
            await navigator.clipboard.writeText(code);
            return this.msg(`COPIED (${code.length.toLocaleString('en-US')} CHARACTERS). SEND IT TO A FRIEND`);
          } catch {
            ta?.select();
            return this.msg('THE CODE IS IN THE BOX: SELECT IT AND COPY');
          }
        }
        const url = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `InfiniShoot-ghost-${week}.isghost`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return this.msg(`SAVED InfiniShoot-ghost-${week}.isghost`);
      }
      case 'paste': {
        const text = this.el.querySelector<HTMLTextAreaElement>('.gh-code')?.value ?? '';
        try {
          return this.race(await readGhostCode(text));
        } catch (err) {
          return this.msg((err as Error).message.toUpperCase(), false);
        }
      }
      case 'load':
        this.file.value = '';
        this.file.onchange = () => {
          const f = this.file.files?.[0];
          if (!f) return;
          void f.text().then(async (text) => {
            try {
              this.race(await readGhostCode(text));
            } catch (err) {
              this.msg((err as Error).message.toUpperCase(), false);
            }
          });
        };
        return this.file.click();
      case 'mine':
        ghostStore.setRival(null);
        this.render();
        return this.msg(mine ? 'RACING YOUR OWN BEST RUN' : 'NO RIVAL: PLAY A WEEKLY RUN TO MAKE YOUR FIRST GHOST');
      case 'upload': {
        if (!mine) return this.msg('NO RUN THIS WEEK YET', false);
        const rank = await uploadGhost({ week, name: mine.name, score: mine.score, stage: mine.stage, time: mine.length, code: await ghostCodeSmall(mine) });
        return this.msg(rank === null ? 'COULD NOT REACH THE BOARD: SHARE THE CODE INSTEAD' : rank ? `UPLOADED: #${rank} THIS WEEK` : 'UPLOADED, BUT IT MISSED THE TOP 10', rank !== null);
      }
      case 'browse': {
        const list = await fetchGhosts(week);
        if (!list) return this.msg('COULD NOT REACH THE BOARD', false);
        this.list = list;
        this.render();
        return this.msg(list.length ? 'PICK A GHOST TO RACE' : 'NO GHOSTS ON THE BOARD YET THIS WEEK');
      }
      case 'pick': {
        const e = this.list[Number(id)];
        if (!e) return;
        const code = await fetchGhostCode(week, e.id);
        if (!code) return this.msg('THAT GHOST IS GONE', false);
        try {
          return this.race(await readGhostCode(code));
        } catch (err) {
          return this.msg((err as Error).message.toUpperCase(), false);
        }
      }
    }
  }
}
