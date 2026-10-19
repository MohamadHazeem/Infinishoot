import { localizeHtml, localize } from '../i18n';
import type { Game } from '../game/game';
import { HERO_COLORS } from '../game/hero';
import { KBM, LocalLobby, SLOT_ROWS, localCoopTuning } from '../game/localCoop';
import { deviceLabel, unlockedHeroes } from '../game/systems/localCoop';
import { browserPads, padEdges, type PadSource } from '../core/padInput';
import { heroOf, heroClicks } from '../data/heroes';
import { WEAPONS } from '../data/weapons';
import { SPECIALS } from '../data/specials';
import { cheats } from '../game/game';
import { unlockedLoadout } from '../game/save';
import { settings } from '../game/settings';
import { sfx } from '../audio/sfx';
import { weeklyChallenge } from '../data/weekly';
import type { ModeId } from '../data/modes';

/**
 * LOCAL CO-OP (MP lane): the join screen (each gamepad presses A to join, the
 * keyboard presses ENTER and always takes player 1; up/down picks a row,
 * left/right changes it, A / ENTER gets ready, B / BACKSPACE leaves; the run
 * starts once 2+ players are ready) and the in-run per-player panels plus pad
 * players' aim markers and the "whose turn" tag over menus.
 */
const ROW_NAMES = ['HERO', 'LEFT CLICK', 'RIGHT CLICK', 'SPECIAL'];

export class LocalCoopUi {
  readonly screen: HTMLElement;
  private hudEl: HTMLElement;
  private turnEl: HTMLElement;
  readonly lobby: LocalLobby;
  private prev = new Map<number, boolean[]>();
  private countdown = -1;
  mode: ModeId = 'standard';
  private shown = '';
  private root: HTMLElement;

  constructor(
    root: HTMLElement,
    private game: Game,
    public pads: PadSource = browserPads,
  ) {
    injectCss();
    this.root = root;
    this.lobby = new LocalLobby(
      () => unlockedHeroes(),
      () => (cheats.unlockAll ? undefined : unlockedLoadout()),
    );
    const t = document.createElement('template');
    t.innerHTML = localizeHtml(`<div id="scr-localcoop" class="screen dim">
      <h1>LOCAL CO-OP</h1>
      <p class="note">2-4 players on this PC. Press <b>A</b> on a gamepad (or <b>ENTER</b> on the keyboard: player 1) to join.
      Up / down picks a row, left / right changes it, <b>A</b> / ENTER when ready, <b>B</b> / BACKSPACE to leave. <b>Y</b> / M switches the mode.</p>
      <div class="lc-mode"></div>
      <div class="lc-slots"></div>
      <div class="msg lc-status"></div>
      <div class="menu row"><button class="lc-back" data-act="lc-back">BACK</button></div>
    </div>`);
    this.screen = t.content.firstElementChild as HTMLElement;
    game.screens.addScreen('localcoop', this.screen, {});
    root.querySelector('#scr-title [data-act=online]')?.insertAdjacentHTML('afterend', localizeHtml('<button data-nav data-act="lc-open">LOCAL CO-OP</button>'));
    root.insertAdjacentHTML('beforeend', localizeHtml('<div id="lc-hud" hidden></div><div id="lc-turn" class="px" hidden></div>'));
    this.hudEl = root.querySelector<HTMLElement>('#lc-hud')!;
    this.turnEl = root.querySelector<HTMLElement>('#lc-turn')!;
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      const act = b?.dataset.act;
      if (act === 'lc-open') this.open();
      else if (act === 'lc-back') this.close();
      else if (act === 'lc-mode') this.toggleMode();
      else if (act === 'lc-nav' && b) {
        const pad = Number(b.dataset.pad);
        const s = this.lobby.slots[this.lobby.slotOf(pad)];
        if (s && !s.ready) s.row = Number(b.dataset.row ?? s.row);
        this.lobby.nav(pad, 0, Number(b.dataset.dv ?? 0));
        this.renderScreen();
      } else if (act === 'lc-ready' && b) {
        this.lobby.toggleReady(Number(b.dataset.pad));
        this.renderScreen();
      }
    });
  }

  open(): void {
    this.lobby.slots = [];
    this.countdown = -1;
    // Seed the pad edges, so the A press that opened the screen doesn't also join.
    this.prev.clear();
    padEdges(this.pads, this.prev);
    this.game.input.usePad(-2); // pads only reach this screen through padEdges
    this.game.screens.show('localcoop');
    this.renderScreen();
  }

  close(): void {
    this.game.input.usePad(-1);
    this.game.screens.show('title');
  }

  private toggleMode(): void {
    this.mode = this.mode === 'weekly' ? 'standard' : 'weekly';
    sfx.menuMove();
    this.renderScreen();
  }

  /** Every update while the join screen is open: keyboard and pad joins, edits, ready and the countdown. */
  update(dt: number): void {
    if (this.game.screens.current !== 'localcoop') return;
    const input = this.game.input;
    const L = this.lobby;
    let changed = false;
    const key = (...c: string[]) => c.some((k) => input.keyPressed(k));
    // Keyboard: player 1.
    const kb = L.slotOf(KBM);
    if (key('Escape') && kb < 0) return this.close();
    if (key('Enter', 'Space')) {
      if (kb < 0) L.join(KBM, { hero: settings.hero, loadout: settings.loadout });
      else L.toggleReady(KBM);
      changed = true;
    }
    if (kb >= 0) {
      if (key('Backspace', 'Escape')) (L.leave(KBM), (changed = true));
      const dr = (key('ArrowDown', 'KeyS') ? 1 : 0) - (key('ArrowUp', 'KeyW') ? 1 : 0);
      const dv = (key('ArrowRight', 'KeyD') ? 1 : 0) - (key('ArrowLeft', 'KeyA') ? 1 : 0);
      if (dr || dv) (L.nav(KBM, dr, dv), (changed = true));
    }
    if (key('KeyM')) this.toggleMode();
    // Pads.
    for (const p of padEdges(this.pads, this.prev)) {
      const has = L.slotOf(p.index) >= 0;
      const pr = (b: number) => p.pressed.includes(b);
      if (!has) {
        if (pr(0) || pr(9)) {
          if (L.join(p.index) >= 0) sfx.menuSelect();
          changed = true;
        } else if (pr(1) && !L.slots.length) return this.close();
        continue;
      }
      if (pr(0) || pr(9)) (L.toggleReady(p.index), (changed = true));
      if (pr(1)) (L.leave(p.index), (changed = true));
      if (pr(3)) this.toggleMode();
      const dr = (pr(13) ? 1 : 0) - (pr(12) ? 1 : 0);
      const dv = (pr(15) ? 1 : 0) - (pr(14) ? 1 : 0);
      if (dr || dv) (L.nav(p.index, dr, dv), (changed = true));
    }
    if (changed) {
      sfx.menuMove();
      this.renderScreen();
    }
    if (L.canStart) {
      if (this.countdown < 0) this.countdown = localCoopTuning.countdown;
      this.countdown -= dt;
      this.status(`STARTING IN ${Math.max(0, Math.ceil(this.countdown))}...`);
      if (this.countdown <= 0) {
        this.countdown = -1;
        this.game.localCoopStart(L.slots, this.mode, this.pads);
      }
    } else if (this.countdown >= 0 || changed) {
      this.countdown = -1;
      this.status(L.slots.length < 2 ? 'WAITING FOR PLAYERS: 2 OR MORE' : 'WAITING UNTIL EVERYONE IS READY');
    }
  }

  private status(s: string): void {
    const el = this.screen.querySelector('.lc-status')!;
    if (el.textContent !== s) el.textContent = localize(s);
  }

  renderScreen(): void {
    const L = this.lobby;
    const w = weeklyChallenge();
    this.screen.querySelector('.lc-mode')!.innerHTML = localizeHtml(`<button class="lc-modebtn ${this.mode === 'weekly' ? 'on' : ''}" data-act="lc-mode">MODE: ${this.mode === 'weekly' ? `WEEKLY CO-OP ${w.week}` : 'STANDARD'}</button>${
      this.mode === 'weekly' ? `<span class="lc-rules">${w.rules.map((r) => r.name.toUpperCase()).join(' + ')} · ROOKIE KIT FOR EVERYONE</span>` : ''
    }`);
    const cells: string[] = [];
    for (let i = 0; i < localCoopTuning.maxPlayers; i++) {
      const s = L.slots[i];
      const c = HERO_COLORS[i];
      if (!s) {
        cells.push(`<div class="lc-slot px empty" style="--c:${c}"><b>P${i + 1}</b><span>PRESS A TO JOIN${i === 0 ? '<br>OR ENTER' : ''}</span></div>`);
        continue;
      }
      const hero = heroOf(s.hero);
      const clicks = heroClicks(hero, s.loadout);
      const fixed = (r: number) => (r === 1 && !!hero.clicks?.primary) || (r === 2 && !!hero.clicks?.secondary);
      const val = [hero.name, WEAPONS[clicks.primary]?.name, WEAPONS[clicks.secondary]?.name, SPECIALS[s.loadout.special]?.name];
      const rows = SLOT_ROWS.map(
        (_, r) =>
          `<div class="lc-row ${r === s.row && !s.ready ? 'on' : ''}"><small>${ROW_NAMES[r]}</small><button ${fixed(r) ? 'disabled' : ''} data-act="lc-nav" data-pad="${s.pad}" data-row="${r}" data-dv="-1">&#9664;</button><span>${(val[r] ?? '').toUpperCase()}</span><button ${fixed(r) ? 'disabled' : ''} data-act="lc-nav" data-pad="${s.pad}" data-row="${r}" data-dv="1">&#9654;</button></div>`,
      ).join('');
      cells.push(`<div class="lc-slot px ${s.ready ? 'ready' : ''}" style="--c:${c}">
        <b>P${i + 1}</b><em>${s.pad === KBM ? 'KEYBOARD + MOUSE' : `GAMEPAD ${s.pad + 1}`}</em>${rows}
        <button class="lc-readybtn" data-act="lc-ready" data-pad="${s.pad}">${s.ready ? 'READY!' : 'NOT READY'}</button></div>`);
    }
    this.screen.querySelector('.lc-slots')!.innerHTML = localizeHtml(cells.join(''));
    if (!this.screen.querySelector('.lc-status')!.textContent) this.status('WAITING FOR PLAYERS: 2 OR MORE');
  }

  /** In-run: per-player panels, pad aim markers and the menu turn tag. */
  render(): void {
    const g = this.game;
    const lc = g.localCoop;
    const on = !!lc && g.mode !== 'title';
    this.root.classList.toggle('lc-on', on);
    this.hudEl.hidden = !on || g.screens.current !== 'none';
    const turn = on && (g.screens.current === 'levelup' || g.screens.current === 'shop') && lc!.turn >= 0;
    this.turnEl.hidden = !turn;
    if (!on || !lc) return;
    if (turn) {
      const h = g.heroes[lc.turn];
      const txt = `P${lc.turn + 1} · ${deviceLabel(g, lc.turn)}: ${g.mode === 'shop' ? 'YOUR SHOP' : 'YOUR PICK'}`;
      if (this.turnEl.textContent !== txt) this.turnEl.textContent = localize(txt);
      this.turnEl.style.setProperty('--c', h?.color ?? '#fff');
    }
    if (this.hudEl.hidden) return;
    const key = g.heroes.map((h) => h.index).join();
    if (key !== this.shown) {
      this.shown = key;
      this.hudEl.innerHTML = localizeHtml(g.heroes
        .map(
          (h, i) =>
            `<div class="lc-p px" style="--c:${h.color}"><b>P${i + 1}</b><small>${deviceLabel(g, i)}</small><div class="lc-bar"><i></i></div><div class="lc-sp"><i></i></div><span class="lc-st"></span></div><i class="lc-aim" style="--c:${h.color}"></i>`,
        )
        .join(''));
    }
    const panels = this.hudEl.querySelectorAll<HTMLElement>('.lc-p');
    const aims = this.hudEl.querySelectorAll<HTMLElement>('.lc-aim');
    g.heroes.forEach((h, i) => {
      const el = panels[i];
      if (!el) return;
      const p = h.player;
      el.querySelector<HTMLElement>('.lc-bar i')!.style.width = `${Math.round(100 * Math.max(0, p.hp / p.maxHp))}%`;
      el.querySelector<HTMLElement>('.lc-sp i')!.style.width = `${Math.round(100 * h.bombCharge)}%`;
      const st = p.dead ? 'DOWN' : `${Math.ceil(p.hp)}`;
      const s = el.querySelector('.lc-st')!;
      if (s.textContent !== st) s.textContent = st;
      el.classList.toggle('down', p.dead);
      // Pad players' aim: a marker a few metres out along their aim.
      const a = aims[i];
      const isPad = lc.slots[i] && lc.slots[i].pad !== KBM;
      if (!isPad || p.dead) {
        a.hidden = true;
        return;
      }
      const r = p.rig.root.position;
      const t = g.tmp.set(r.x + p.aim.x * 4, 1, r.z + p.aim.z * 4).project(g.cam.camera);
      a.hidden = false;
      a.style.transform = `translate(${((t.x + 1) / 2) * innerWidth}px, ${((1 - t.y) / 2) * innerHeight}px)`;
    });
  }
}

function injectCss(): void {
  if (document.getElementById('localcoop-css')) return;
  const st = document.createElement('style');
  st.id = 'localcoop-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const CSS = `
/* The title menu got a LOCAL CO-OP button: tighten it a little on short screens so SETTINGS stays in view. */
@media (max-height: 820px) {
  #scr-title > .menu:not(.row) { gap: 12px; }
  #scr-title > .menu:not(.row) > button { padding-top: 8px; padding-bottom: 10px; }
}
#scr-localcoop .lc-slots { display: grid; grid-template-columns: repeat(4, minmax(150px, 220px)); gap: calc(4 * var(--p)); justify-content: center; margin: 10px 0; }
@media (max-width: 760px) { #scr-localcoop .lc-slots { grid-template-columns: repeat(2, minmax(140px, 1fr)); } }
#scr-localcoop .lc-slot { --bg: var(--night); --hi: var(--slate); --lo: var(--ink); --ring: var(--c); display: flex; flex-direction: column; gap: 4px; padding: 10px 8px; min-height: 210px; }
#scr-localcoop .lc-slot > b { font: 30px var(--display); color: var(--c); line-height: 1; }
#scr-localcoop .lc-slot > em { font: 9px var(--label); font-style: normal; color: var(--mist); }
#scr-localcoop .lc-slot.empty { --ring: transparent; --bg: var(--ink); justify-content: center; align-items: center; text-align: center; color: var(--slate); font: 11px var(--label); }
#scr-localcoop .lc-slot.ready { --hi: var(--green); }
#scr-localcoop .lc-row { display: grid; grid-template-columns: 22px 1fr 22px; align-items: center; gap: 2px; }
#scr-localcoop .lc-row small { grid-column: 1 / 4; font: 8px var(--label); color: var(--mist); }
#scr-localcoop .lc-row span { text-align: center; font: 15px var(--font); color: var(--white); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#scr-localcoop .lc-row.on span { color: var(--yellow); }
#scr-localcoop .lc-row.on small { color: var(--yellow); }
#scr-localcoop .lc-row button { padding: 0; min-width: 0; height: 20px; font-size: 10px; }
#scr-localcoop .lc-readybtn { margin-top: auto; font-size: 16px; }
#scr-localcoop .lc-slot.ready .lc-readybtn { --bg: var(--green); color: var(--ink); }
#scr-localcoop .lc-mode { display: flex; gap: 12px; align-items: center; justify-content: center; }
#scr-localcoop .lc-modebtn.on { --bg: var(--plum); }
#scr-localcoop .lc-rules { font: 10px var(--label); color: var(--yellow); }
#lc-hud { position: absolute; inset: 0; pointer-events: none; }
/* Player panels: a column on the right, under the score and combo. */
#lc-hud .lc-p { --bg: var(--ink); --hi: var(--night); --lo: var(--ink); --ring: var(--c); position: absolute; right: 18px; width: 150px; padding: 4px 6px; display: grid; grid-template-columns: auto 1fr auto; gap: 2px 6px; align-items: center; }
#lc-hud .lc-p:nth-of-type(1) { top: 180px; }
#lc-hud .lc-p:nth-of-type(2) { top: 232px; }
#lc-hud .lc-p:nth-of-type(3) { top: 284px; }
#lc-hud .lc-p:nth-of-type(4) { top: 336px; }
/* The co-op teammate list would repeat the panels. */
.lc-on #team { display: none !important; }
#lc-hud .lc-p b { font: 18px var(--display); color: var(--c); line-height: 1; }
#lc-hud .lc-p small { font: 7px var(--label); color: var(--mist); grid-column: 2 / 4; }
#lc-hud .lc-bar, #lc-hud .lc-sp { grid-column: 1 / 4; height: calc(2 * var(--p)); background: var(--night); }
#lc-hud .lc-sp { height: var(--p); }
#lc-hud .lc-bar i, #lc-hud .lc-sp i { display: block; height: 100%; background: var(--lime); }
#lc-hud .lc-sp i { background: var(--plum); }
#lc-hud .lc-st { position: absolute; right: 6px; top: 3px; font: 13px var(--display); color: var(--white); }
#lc-hud .lc-p.down { --ring: var(--red); }
#lc-hud .lc-p.down .lc-st { color: var(--red); }
#lc-hud .lc-aim { position: absolute; left: -6px; top: -6px; width: 12px; height: 12px; background: var(--c); box-shadow: 0 0 0 3px var(--ink); transform-origin: center; }
#lc-turn { --bg: var(--ink); --hi: var(--night); --lo: var(--ink); --ring: var(--c); position: absolute; top: calc(4 * var(--p)); left: 50%; transform: translateX(-50%); padding: 4px 14px; font: 22px var(--display); color: var(--c); z-index: 30; pointer-events: none; }
`;
