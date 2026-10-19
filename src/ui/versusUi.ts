import { localizeHtml, localize } from '../i18n';
import type { Game } from '../game/game';
import { isOverlord, versusOrder } from '../game/systems/versus';
import { OVERLORD_CARDS, cardBlock, validateCommand, versusTuning, type VsPoint } from '../game/versus';
import { clock } from '../game/game';

/**
 * Versus Swarm HUD (MP lane). The Overlord gets the command view: a points
 * meter, a card-like spawn bar (number keys / Q E / LB RB pick, click or A
 * drops), a cursor that says where the drop would land (or why it can't), and
 * the field's beacons. Heroes get a small panel with the Overlord's purse.
 * Plain DOM in the HUD root, styles injected here.
 */
export class VersusUi {
  private el: HTMLElement;
  private foe: HTMLElement;
  private cards: HTMLElement[] = [];
  private marks: HTMLElement[] = [];
  private cursor: HTMLElement;
  private land: HTMLElement;
  private key = '';

  constructor(
    private root: HTMLElement,
    private game: Game,
  ) {
    injectCss();
    root.insertAdjacentHTML(
      'beforeend',
      localizeHtml(`<div id="vs-ui" hidden>
        <div class="vs-marks"></div>
        <div class="vs-land"></div>
        <div class="vs-cursor"><i></i><b></b></div>
        <div class="vs-panel px">
          <div class="vs-top"><span class="vs-title">OVERLORD</span><span class="vs-pts"></span><span class="vs-time"></span></div>
          <div class="vs-meter"><i></i></div>
          <div class="vs-cards"></div>
          <div class="vs-help">1-9 / Q E / LB RB: CARD · CLICK / A: DROP · WASD / STICK: PAN · GROUPS LAND AT A BEACON OR THE EDGE</div>
        </div>
        <div class="vs-note"></div>
      </div>
      <div id="vs-foe" class="px" hidden><b>OVERLORD</b> <span class="vs-on"></span> <span class="vs-fp"></span></div>`),
    );
    this.el = root.querySelector<HTMLElement>('#vs-ui')!;
    this.foe = root.querySelector<HTMLElement>('#vs-foe')!;
    this.cursor = this.el.querySelector<HTMLElement>('.vs-cursor')!;
    this.land = this.el.querySelector<HTMLElement>('.vs-land')!;
    const bar = this.el.querySelector<HTMLElement>('.vs-cards')!;
    bar.innerHTML = localizeHtml(OVERLORD_CARDS.map(
      (c, i) => `<button class="vs-card px" data-vs="${i}" style="--c:${c.color}" title="${c.desc}"><span class="k">${i < 9 ? i + 1 : 0}</span><b>${c.name.toUpperCase()}</b><span class="cost">${c.cost}</span><span class="st"></span><i class="cd"></i></button>`,
    ).join(''));
    this.cards = Array.from(bar.querySelectorAll<HTMLElement>('.vs-card'));
    bar.addEventListener('mousedown', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-vs]');
      if (b && this.game.versus) this.game.versus.sel = Number(b.dataset.vs);
      e.stopPropagation();
    });
  }

  render(): void {
    const g = this.game;
    const v = g.versus;
    const on = !!v && g.mode !== 'title';
    const ol = on && isOverlord(g);
    this.root.classList.toggle('vs-ol', ol);
    this.el.hidden = !ol || g.screens.current !== 'none' || !!v?.winner;
    this.foe.hidden = !on || ol || g.screens.current !== 'none' || !!v?.winner;
    if (!v || !on) return;
    if (!ol) {
      this.foe.querySelector('.vs-on')!.textContent = localize(v.overlord < 0 ? '(AI)' : (g.heroes[v.overlord]?.name ?? '').toUpperCase());
      this.foe.querySelector('.vs-fp')!.textContent = localize(`${Math.floor(v.st.points)} PTS${v.st.bossUsed ? ' · BOSS OUT' : ''}`);
      return;
    }
    const w = g.versusWorld();
    const st = v.st;
    const pts = Math.floor(st.points);
    this.el.querySelector('.vs-pts')!.textContent = localize(`${pts} PTS`);
    this.el.querySelector('.vs-time')!.textContent = localize(g.director.bossSpawned || st.bossUsed || (g.role === 'client' && g.netTimeLeft < 0) ? 'BOSS FIGHT' : `${clock(w.duration - w.time)} LEFT`);
    this.el.querySelector<HTMLElement>('.vs-meter i')!.style.width = `${Math.round((100 * st.points) / versusTuning.pointsMax)}%`;
    OVERLORD_CARDS.forEach((c, i) => {
      const b = this.cards[i];
      const why = cardBlock(st, c, w);
      b.classList.toggle('sel', i === v.sel);
      b.classList.toggle('off', !!why);
      const cd = st.cooldown(c.id);
      b.querySelector<HTMLElement>('.cd')!.style.height = c.cd > 0 && cd > 0 ? `${Math.round((100 * cd) / c.cd)}%` : '0%';
      b.querySelector('.st')!.textContent = localize(why === 'locked' ? clock(c.unlockAt) : why === 'cooldown' ? `${Math.ceil(cd)}s` : why === 'boss already out' ? 'OUT' : '');
    });
    // Where the drop would land (validated like the host does, without the rate limit).
    const card = OVERLORD_CARDS[v.sel];
    const at: VsPoint | null = g.input.device === 'kbm' ? (g.mouseAimPoint() ? { x: g.aimHit.x, z: g.aimHit.z } : null) : { x: v.camX, z: v.camZ };
    if (at) {
      const r = validateCommand(st, { c: card.id, x: at.x, z: at.z }, w, w.time, false);
      const s = this.project(at.x, at.z);
      this.cursor.style.transform = `translate(${s.x}px, ${s.y}px)`;
      // Where it would land (a beacon, the edge, or right here for hazards).
      this.land.hidden = !r.ok;
      if (r.ok) {
        const l = this.project(r.spot.x, r.spot.z);
        this.land.style.transform = `translate(${Math.max(8, Math.min(innerWidth - 8, l.x))}px, ${Math.max(8, Math.min(innerHeight - 8, l.y))}px)`;
      }
      this.cursor.classList.toggle('bad', !r.ok);
      this.cursor.querySelector('b')!.textContent = localize(r.ok ? `${card.name.toUpperCase()}${r.marker >= 0 ? ' · BEACON' : card.kind === 'hazard' ? '' : ' · EDGE'}` : r.reason.toUpperCase());
      this.cursor.hidden = false;
    } else this.cursor.hidden = this.land.hidden = true;
    // Beacons.
    const mk = `${w.markers.length}`;
    if (mk !== this.key) {
      this.key = mk;
      const box = this.el.querySelector<HTMLElement>('.vs-marks')!;
      box.innerHTML = localizeHtml(w.markers.map((_, i) => `<i class="vs-mark">${i + 1}</i>`).join(''));
      this.marks = Array.from(box.children) as HTMLElement[];
    }
    w.markers.forEach((m, i) => {
      const s = this.project(m.x, m.z);
      const el = this.marks[i];
      el.style.transform = `translate(${s.x}px, ${s.y}px)`;
      el.classList.toggle('closed', w.heroes.some((h) => Math.hypot(h.x - m.x, h.z - m.z) < versusTuning.markerBlock));
    });
    const note = this.el.querySelector<HTMLElement>('.vs-note')!;
    note.textContent = localize(v.noteT > 0 ? v.note : '');
    note.hidden = !(v.noteT > 0);
  }

  private project(x: number, z: number): { x: number; y: number } {
    const t = this.game.tmp.set(x, 0.1, z).project(this.game.cam.camera);
    return { x: ((t.x + 1) / 2) * innerWidth, y: ((1 - t.y) / 2) * innerHeight };
  }

  /** The Overlord drops the selected card at the screen centre (touch / tests). */
  dropAtFocus(): void {
    const v = this.game.versus;
    if (v) versusOrder(this.game, { c: OVERLORD_CARDS[v.sel].id, x: v.camX, z: v.camZ });
  }
}

function injectCss(): void {
  if (document.getElementById('versus-css')) return;
  const st = document.createElement('style');
  st.id = 'versus-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const CSS = `
/* Versus Swarm: the Overlord's command view hides the hero HUD. */
.vs-ol #hp, .vs-ol #meters, .vs-ol #loadout, .vs-ol #mods, .vs-ol #downed, .vs-ol #chestptr, .vs-ol #xpbar, .vs-ol #runinfo .gold, .vs-ol #runinfo .gears, .vs-ol #combo, .vs-ol #goals, .vs-ol #team { display: none !important; }
#vs-ui { position: absolute; inset: 0; pointer-events: none; z-index: 6; }
#vs-ui .vs-panel {
  --bg: var(--ink); --hi: var(--plum); --lo: var(--ink); --ring: var(--red);
  position: absolute; left: 50%; bottom: calc(5 * var(--p)); transform: translateX(-50%);
  padding: 8px 10px 6px; pointer-events: auto; width: max-content; max-width: calc(100vw - 24px);
}
#vs-ui .vs-top { display: flex; gap: 14px; align-items: baseline; font: 22px var(--display); color: var(--white); }
#vs-ui .vs-title { color: var(--red); font: 12px var(--label); }
#vs-ui .vs-pts { color: var(--yellow); }
#vs-ui .vs-time { margin-left: auto; font: 11px var(--label); color: var(--mist); }
#vs-ui .vs-meter { height: calc(2 * var(--p)); background: var(--night); margin: 4px 0 6px; }
#vs-ui .vs-meter i { display: block; height: 100%; background: var(--yellow); }
#vs-ui .vs-cards { display: flex; gap: calc(2 * var(--p)); flex-wrap: wrap; justify-content: center; }
#vs-ui .vs-card {
  --bg: var(--night); --hi: var(--slate); --lo: var(--ink);
  position: relative; width: 80px; min-height: 64px; padding: 14px 4px 4px; overflow: hidden; background-color: var(--bg);
  font: 15px var(--font); color: var(--white); line-height: 1; text-align: center; cursor: pointer;
  border-top: calc(var(--p)) solid var(--c);
}
#vs-ui .vs-card b { display: block; font-weight: normal; min-height: 30px; }
#vs-ui .vs-card .k { position: absolute; left: 4px; top: 3px; font: 9px var(--label); color: var(--mist); }
#vs-ui .vs-card .cost { position: absolute; right: 4px; top: 2px; font: 13px var(--display); color: var(--yellow); }
#vs-ui .vs-card .st { display: block; font: 9px var(--label); color: var(--orange); min-height: 9px; }
#vs-ui .vs-card .cd { position: absolute; left: 0; right: 0; bottom: 0; background: rgba(26, 28, 44, 0.7); pointer-events: none; }
#vs-ui .vs-card.off { color: var(--slate); }
#vs-ui .vs-card.off .cost { color: var(--slate); }
#vs-ui .vs-card.sel { --ring: var(--yellow); --hi: var(--c); }
#vs-ui .vs-help { margin-top: 6px; font: 8px var(--label); color: var(--mist); text-align: center; }
#vs-ui .vs-note { position: absolute; left: 50%; bottom: calc(52 * var(--p)); transform: translateX(-50%); font: 22px var(--display); color: var(--orange); text-shadow: var(--outline); }
#vs-ui .vs-cursor { position: absolute; left: 0; top: 0; }
#vs-ui .vs-land { position: absolute; left: -7px; top: -7px; width: 14px; height: 14px; background: var(--red); box-shadow: 0 0 0 3px var(--ink); animation: vsland 0.5s steps(2) infinite; }
@keyframes vsland { 50% { background: var(--yellow); } }
#vs-ui .vs-cursor i { position: absolute; left: -10px; top: -10px; width: 20px; height: 20px; box-shadow: inset 0 0 0 3px var(--yellow), 0 0 0 3px var(--ink); }
#vs-ui .vs-cursor b { position: absolute; left: 16px; top: -8px; white-space: nowrap; font: 11px var(--label); color: var(--yellow); text-shadow: var(--outline); }
#vs-ui .vs-cursor.bad i { box-shadow: inset 0 0 0 3px var(--red), 0 0 0 3px var(--ink); }
#vs-ui .vs-cursor.bad b { color: var(--red); }
#vs-ui .vs-mark {
  position: absolute; left: -13px; top: -13px; width: 26px; height: 26px; display: grid; place-items: center;
  font: 20px var(--display); font-style: normal; color: var(--ink); background: var(--lime); box-shadow: 0 0 0 3px var(--ink), 0 0 0 6px var(--green);
}
#vs-ui .vs-mark.closed { background: var(--slate); color: var(--night); }
#vs-foe {
  --bg: var(--ink); --hi: var(--plum); --lo: var(--ink); --ring: var(--red);
  position: absolute; top: calc(30 * var(--p)); right: 18px; padding: 4px 10px; font: 16px var(--font); color: var(--white);
}
#vs-foe b { font: 10px var(--label); color: var(--red); font-weight: normal; }
#vs-foe .vs-fp { color: var(--yellow); }
`;
