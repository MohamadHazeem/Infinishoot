import type { Screens } from './screens';
import { HERO_BY_ID } from '../data/heroes';
import { addToInbox, decodeGhost, encodeGhost, ghostInbox, ghostTuning, myGhost, saveInbox, type HelpGhost } from '../game/coop2';
import { fetchGhost, ghostShareEnabled, isShortCode, uploadGhost } from '../net/ghostShare';
import { settings, saveSettings } from '../game/settings';
import { sfx } from '../audio/sfx';

/**
 * EXTRAS > HELP GHOSTS (coop2 lane). When you fall at a boss your game keeps a
 * "help ghost" (your name, hero, kit and level); share it as a code or a file
 * (or a 6-character code through the online service when the build has one).
 * Friends' ghosts you add (or that your co-op teammates leave behind) wait in
 * your inbox; the next time you're at a boss or in deep trouble, one fights
 * beside you for 30 seconds.
 */
const CSS = `
#scr-ghosts .gh-panel { max-width: 720px; margin: 0 auto; text-align: left; }
#scr-ghosts .gh-sec { font: 12px var(--label); letter-spacing: 1px; color: var(--cyan); margin: calc(3 * var(--p)) 0 var(--p); }
#scr-ghosts .gh-card { font: 18px var(--font); color: var(--white); line-height: 1.2; }
#scr-ghosts .gh-card small { font: 10px var(--label); color: var(--mist); letter-spacing: 1px; }
#scr-ghosts .gh-code { width: 100%; box-sizing: border-box; text-overflow: ellipsis; font: 14px var(--label); color: var(--yellow); background: var(--ink); border: 0; padding: calc(2 * var(--p)); box-shadow: 0 0 0 var(--p) var(--slate); }
#scr-ghosts .gh-row { display: flex; flex-wrap: wrap; gap: calc(2 * var(--p)); margin-top: calc(2 * var(--p)); align-items: center; }
#scr-ghosts .gh-list { max-height: 220px; overflow-y: auto; }
#scr-ghosts .gh-item { display: flex; justify-content: space-between; align-items: center; gap: calc(2 * var(--p)); padding: var(--p) 0; }
#scr-ghosts .gh-item i { display: inline-block; width: calc(3 * var(--p)); height: calc(3 * var(--p)); background: var(--c); margin-right: calc(2 * var(--p)); box-shadow: 0 0 0 calc(0.5 * var(--p)) var(--ink); }
#scr-ghosts .gh-msg { font: 15px var(--font); color: var(--yellow); min-height: 20px; margin-top: var(--p); }
#scr-ghosts input.gh-add { flex: 1; min-width: 220px; font: 14px var(--label); background: var(--ink); color: var(--white); border: 0; padding: calc(2 * var(--p)); box-shadow: 0 0 0 var(--p) var(--slate); }
`;

function line(g: HelpGhost): string {
  const hero = HERO_BY_ID[g.hero]?.name ?? 'Hero';
  return `<i style="--c:${g.color}"></i>${g.name} <small>${hero.toUpperCase()} · LV ${g.level} · FELL TO ${g.boss.toUpperCase()} ON STAGE ${g.stage}${g.date ? ` · ${g.date}` : ''}</small>`;
}

export class GhostScreen {
  readonly el: HTMLElement;
  private msg = '';
  private short = '';
  private file: HTMLInputElement;

  constructor(private screens: Screens) {
    if (!document.getElementById('gh-css')) {
      const st = document.createElement('style');
      st.id = 'gh-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.id = 'scr-ghosts';
    this.el.className = 'screen dim';
    screens.addScreen('ghosts', this.el, { onBack: () => screens.show('extras') });
    document.querySelector('#scr-extras [data-act=history]')?.insertAdjacentHTML('beforebegin', '<button data-nav data-act="gh-open">HELP GHOSTS</button>');
    document.querySelector('#scr-extras [data-act=gh-open]')?.addEventListener('click', () => this.open());
    this.file = document.createElement('input');
    this.file.type = 'file';
    this.file.accept = '.json,.txt,application/json,text/plain';
    this.file.hidden = true;
    this.file.addEventListener('change', () => void this.loadFile());
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-gh]');
      if (b) void this.act(b.dataset.gh ?? '', Number(b.dataset.i));
    });
  }

  get isOpen(): boolean {
    return this.screens.current === 'ghosts';
  }

  open(focus = 0): void {
    this.render();
    this.screens.show('ghosts', focus);
  }

  private render(): void {
    const mine = myGhost();
    const inbox = ghostInbox();
    const code = mine ? encodeGhost(mine) : '';
    this.el.innerHTML = `
      <h1>HELP GHOSTS</h1>
      <div class="gh-panel">
        <p class="note">Fall at a boss and your game keeps a help ghost. Send it to a friend: the next time they're at a boss or in deep trouble, your ghost fights beside them for ${ghostTuning.duration} seconds. Co-op teammates who fall at a boss leave theirs automatically.</p>
        <div class="gh-sec">YOUR GHOST</div>
        ${mine ? `<div class="gh-card">${line(mine)}</div><input class="gh-code" readonly value="${this.short || code}"><div class="gh-row"><button data-nav data-gh="copy">COPY CODE</button><button data-nav data-gh="save">SAVE FILE</button>${ghostShareEnabled ? '<button data-nav data-gh="upload">SHORT CODE</button>' : ''}</div>` : '<div class="gh-card"><small>NONE YET: FALL AT A BOSS TO LEAVE ONE.</small></div>'}
        <div class="gh-sec">GHOSTS THAT WILL HELP YOU (${inbox.length}/${ghostTuning.inboxMax})</div>
        <div class="gh-list">${inbox.length ? inbox.map((g, i) => `<div class="gh-item"><div class="gh-card">${line(g)}</div><button data-nav data-gh="remove" data-i="${i}">REMOVE</button></div>`).join('') : '<div class="gh-card"><small>NO GHOSTS YET: ADD A FRIEND\'S CODE BELOW.</small></div>'}</div>
        <div class="gh-sec">ADD A FRIEND'S GHOST</div>
        <div class="gh-row"><input class="gh-add" type="text" spellcheck="false" autocomplete="off" placeholder="${ghostShareEnabled ? 'GHOST1-... OR A 6-LETTER CODE' : 'GHOST1-...'}"><button data-nav data-gh="add">ADD</button><button data-nav data-gh="load">LOAD FILE</button></div>
        <div class="gh-msg">${this.msg}</div>
        <div class="menu row"><button data-nav data-gh="toggle">GHOSTS IN MY RUNS: ${settings.helpGhosts !== false ? 'ON' : 'OFF'}</button><button data-nav data-gh="back">BACK</button></div>
      </div>`;
    this.el.appendChild(this.file);
  }

  private say(msg: string, ok = true): void {
    this.msg = msg;
    if (!ok) sfx.deny();
    const focus = [...this.el.querySelectorAll('[data-nav]')].findIndex((x) => x.classList.contains('focused'));
    this.open(Math.max(0, focus));
  }

  private async act(a: string, i: number): Promise<void> {
    const mine = myGhost();
    switch (a) {
      case 'copy': {
        const code = this.short || (mine ? encodeGhost(mine) : '');
        if (!code) return;
        try {
          await navigator.clipboard?.writeText(code);
          this.say('CODE COPIED: SEND IT TO A FRIEND');
        } catch {
          this.el.querySelector<HTMLInputElement>('.gh-code')?.select();
          this.say('SELECT THE CODE AND COPY IT (CTRL+C)');
        }
        return;
      }
      case 'save': {
        if (!mine) return;
        const blob = new Blob([JSON.stringify(mine, null, 1)], { type: 'application/json' });
        const a2 = document.createElement('a');
        a2.href = URL.createObjectURL(blob);
        a2.download = `InfiniShoot-ghost-${mine.name.replace(/[^A-Za-z0-9]/g, '') || 'friend'}.json`;
        a2.click();
        setTimeout(() => URL.revokeObjectURL(a2.href), 2000);
        this.say('GHOST FILE SAVED');
        return;
      }
      case 'upload': {
        if (!mine) return;
        this.say('UPLOADING...');
        const code = await uploadGhost(mine);
        if (code) {
          this.short = code;
          this.say(`SHORT CODE ${code}: GOOD FOR 30 DAYS`);
        } else this.say('COULD NOT REACH THE SERVER: USE THE LONG CODE', false);
        return;
      }
      case 'remove': {
        const list = ghostInbox();
        list.splice(i, 1);
        saveInbox(list);
        this.say('REMOVED');
        return;
      }
      case 'add': {
        const raw = this.el.querySelector<HTMLInputElement>('.gh-add')?.value ?? '';
        let g = decodeGhost(raw);
        if (!g && isShortCode(raw)) {
          this.say('LOOKING IT UP...');
          g = await fetchGhost(raw);
        }
        if (!g) return this.say("THAT'S NOT A GHOST CODE", false);
        this.say(addToInbox(g) ? `${g.name.toUpperCase()} WILL COME TO HELP` : 'THAT GHOST IS ALREADY HERE', true);
        return;
      }
      case 'load':
        this.file.value = '';
        this.file.click();
        return;
      case 'toggle':
        settings.helpGhosts = settings.helpGhosts === false;
        saveSettings();
        this.say(settings.helpGhosts ? 'GHOSTS WILL HELP IN YOUR RUNS' : 'GHOSTS STAY AWAY');
        return;
      case 'back':
        this.msg = '';
        this.screens.show('extras');
        return;
    }
  }

  private async loadFile(): Promise<void> {
    const f = this.file.files?.[0];
    if (!f) return;
    const g = decodeGhost(await f.text());
    if (!g) return this.say("THAT FILE ISN'T A GHOST", false);
    this.say(addToInbox(g) ? `${g.name.toUpperCase()} WILL COME TO HELP` : 'THAT GHOST IS ALREADY HERE');
  }
}
