import { HEAT_GOALS, HEAT_MAX, HEAT_MODS, heatScoreMul, heatTotal, type HeatId } from '../data/heat';
import { HEROES } from '../data/heroes';
import { isChallenge, isoWeek, type ModeId } from '../data/modes';
import { MUTATOR_BY_ID, weeklyMutators } from '../data/mutators';
import { ROUTE_BY_ID, type RouteId } from '../data/routes';
import { cycleHeat, loadHeatPick, saveHeatPick, weeklyBest } from '../game/runMods';
import { save } from '../game/save';
import { settings } from '../game/settings';
import { MenuNav } from './menu';
import type { Screens } from './screens';

/** A route vote as one player sees it (sent to clients as {t:'route', view}). */
export interface RouteView {
  stage: number;
  biome: string;
  final: boolean;
  cards: { id: RouteId; voters: { name: string; color: string }[] }[];
  /** The card this player voted for (-1 = none yet). */
  mine: number;
  /** Seconds left to vote (-1 = no timer). */
  left: number;
  coop: boolean;
}

/**
 * RUN lane screens and HUD bits, all plain DOM in the pixel style with their own
 * injected styles (no edits to style.css):
 * - ROUTE screen after the post-boss shop (registered with Screens as 'route')
 * - HEAT screen, opened from the MODE screen (registered as 'heat')
 * - the MODE screen's HEAT button and Weekly note (Screens.modesHook)
 * - route / heat / mutator tags under the HUD stage label
 */
export class RunUi {
  private route: HTMLElement;
  private heat: HTMLElement;
  private tag: HTMLElement | null;
  private view: RouteView | null = null;
  private endsAt = 0;

  constructor(
    private screens: Screens,
    root: HTMLElement,
    private actions: { vote(i: number): void },
  ) {
    injectCss();
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="scr-route" class="screen dim" hidden>
  <h1>PICK A ROUTE</h1>
  <div class="note route-sub"></div>
  <div class="route-cards"></div>
  <div class="note route-foot"></div>
</div>
<div id="scr-heat" class="screen dim" hidden>
  <h1>HEAT</h1>
  <div class="note heat-intro">Optional rules that make every run harder. More heat, more score. Beat the final boss at a milestone to earn a cosmetic. Heat never gives stats.</div>
  <div class="heat-grid"></div>
  <div class="heat-sum"></div>
  <div class="heat-goals"></div>
  <div class="menu row">
    <button data-nav data-act="heat-reset">RESET</button>
    <button data-nav data-act="heat-done" class="continue">DONE</button>
  </div>
</div>`,
    );
    this.route = root.querySelector<HTMLElement>('#scr-route')!;
    this.heat = root.querySelector<HTMLElement>('#scr-heat')!;
    screens.addScreen('route', this.route, new MenuNav(this.route, { horizontal: true }));
    screens.addScreen('heat', this.heat, new MenuNav(this.heat, { columns: 2, onBack: () => screens.show('modes') }), () => this.renderHeat());
    screens.modesHook = (el, mode) => this.renderModesExtra(el, mode);
    // The HUD tag lives under the stage label (the HUD is built before us).
    const timer = root.querySelector('#timer');
    timer?.insertAdjacentHTML('beforeend', '<div class="runtag"></div>');
    this.tag = root.querySelector<HTMLElement>('#timer .runtag');

    this.route.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-route]');
      if (b) this.actions.vote(Number(b.dataset.route));
    });
    this.heat.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-heat], [data-act]');
      if (!b) return;
      if (b.dataset.heat) saveHeatPick(cycleHeat(loadHeatPick(), b.dataset.heat as HeatId));
      else if (b.dataset.act === 'heat-reset') saveHeatPick({});
      else if (b.dataset.act === 'heat-done') return screens.show('modes');
      this.renderHeat();
    });
    root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act=heat-open]')) screens.show('heat');
    });
    // Number keys vote too.
    window.addEventListener('keydown', (e) => {
      if (this.screens.current !== 'route' || !this.view) return;
      const k = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (k >= 0 && k < this.view.cards.length) this.actions.vote(k);
    });
    const t = setInterval(() => this.tickFoot(), 250) as unknown as { unref?: () => void };
    t.unref?.(); // headless tests (Node) may exit while it runs
  }

  // ---------------------------------------------------------------- route vote

  showRoutes(v: RouteView): void {
    const first = this.screens.current !== 'route';
    this.view = v;
    this.endsAt = v.left >= 0 ? performance.now() + v.left * 1000 : 0;
    this.route.querySelector('.route-sub')!.textContent = `NEXT: STAGE ${v.stage} · ${v.biome.toUpperCase()}${v.final ? ' · FINAL BOSS' : ''}`;
    this.route.querySelector('.route-cards')!.innerHTML = v.cards
      .map((c, i) => {
        const d = ROUTE_BY_ID[c.id];
        const dots = c.voters.map((p) => `<i style="--vc:${p.color}" title="${p.name}"></i>`).join('');
        return `<button data-nav data-route="${i}" class="route-card ${v.mine === i ? 'mine' : ''}" style="--rc:${d.color}">
  <span class="rk">${i + 1}</span>
  <span class="ri">${d.icon}</span>
  <b>${d.name.toUpperCase()}</b>
  <small>${d.desc}</small>
  <span class="rv">${dots}${v.mine === i ? '<em>YOUR VOTE</em>' : ''}</span>
</button>`;
      })
      .join('');
    this.tickFoot();
    if (first) this.screens.show('route', Math.max(0, v.mine));
    else this.screens.refresh('route');
  }

  private tickFoot(): void {
    const v = this.view;
    if (!v || this.screens.current !== 'route') return;
    const foot = this.route.querySelector('.route-foot')!;
    if (!v.coop) {
      foot.textContent = 'THE ROUTE SHAPES THE NEXT STAGE. PICK WITH 1-3 OR CLICK.';
      return;
    }
    const s = Math.max(0, Math.ceil((this.endsAt - performance.now()) / 1000));
    foot.textContent = `${v.mine >= 0 ? 'VOTED. ' : ''}MAJORITY WINS, TIES GO TO THE HOST · ${s} S`;
  }

  // ---------------------------------------------------------------- HUD tags

  setTags(lines: { text: string; color: string }[][]): void {
    if (!this.tag) return;
    this.tag.innerHTML = lines.map((l) => `<div>${l.map((p) => `<span style="color:${p.color}">${p.text}</span>`).join(' · ')}</div>`).join('');
  }

  // ---------------------------------------------------------------- MODE screen extras and HEAT screen

  private renderModesExtra(el: HTMLElement, mode: ModeId): void {
    const box = el.querySelector<HTMLElement>('.modes-extra');
    if (!box) return;
    const challenge = isChallenge(mode);
    const r = loadHeatPick();
    const t = heatTotal(r);
    const hero = HEROES.find((x) => x.id === settings.hero) ?? HEROES[0];
    const best = save.heat[hero.id] ?? 0;
    box.innerHTML = `<button data-nav data-act="heat-open" class="diff heat-open ${t > 0 && !challenge ? 'on' : ''}" ${challenge ? 'disabled' : ''}>HEAT ${challenge ? 'OFF' : t} <small>${challenge ? 'CHALLENGES USE FIXED RULES' : `SCORE x${heatScoreMul(t).toFixed(2)} · BEST CLEARED ${best}`}</small></button>`;
    if (mode === 'weekly') {
      const week = isoWeek();
      const muts = weeklyMutators(week).map((m) => MUTATOR_BY_ID[m]);
      const b = weeklyBest(week);
      el.querySelector('.mode-note')!.innerHTML =
        `THIS WEEK (${week}): ${muts.map((m) => `<span style="color:${m.color}">${m.icon} ${m.name.toUpperCase()}</span>`).join(' + ')} · ${b ? `YOUR BEST: ${b.toLocaleString('en-US')}` : 'NO RUN YET'}` +
        `<small class="mut-desc">${muts.map((m) => m.desc.toUpperCase()).join('<br>')}</small>`;
    }
  }

  private renderHeat(): void {
    const r = loadHeatPick();
    const t = heatTotal(r);
    this.heat.querySelector('.heat-grid')!.innerHTML = HEAT_MODS.map((d) => {
      const rank = r[d.id] ?? 0;
      const pips = Array.from({ length: d.max }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
      return `<button data-nav data-heat="${d.id}" class="heat-mod ${rank ? 'on' : ''}">
  <span class="hi">${d.icon}</span><b>${d.name.toUpperCase()}</b><span class="pips">${pips}</span>
  <small>${d.desc(Math.max(1, rank))}</small><span class="hh">+${d.heat}/RANK</span>
</button>`;
    }).join('');
    const hero = HEROES.find((x) => x.id === settings.hero) ?? HEROES[0];
    const best = save.heat[hero.id] ?? 0;
    this.heat.querySelector('.heat-sum')!.innerHTML = `HEAT <b>${t}</b> / ${HEAT_MAX} · SCORE <b>x${heatScoreMul(t).toFixed(2)}</b> · BEST CLEARED WITH ${hero.name.toUpperCase()}: <b>${best}</b>`;
    this.heat.querySelector('.heat-goals')!.innerHTML = HEAT_GOALS.map((g) => {
      const got = save.achievements.includes(g.achievement);
      return `<span class="${got ? 'got' : ''}">${got ? '✓' : '○'} HEAT ${g.heat}: ${g.reward.toUpperCase()}</span>`;
    }).join('');
    this.screens.refresh('heat');
  }
}

let cssDone = false;
function injectCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

const CSS = `
#timer .runtag {
  display: grid;
  justify-items: center;
  gap: 3px;
  margin-top: 5px;
  font: 10px var(--label);
  letter-spacing: 1px;
  text-shadow: var(--outline);
  white-space: nowrap;
}
#timer .runtag:empty { display: none; }

.route-cards {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 24px;
}
.screen button.route-card {
  --bg: var(--night);
  --hi: var(--slate);
  --lo: var(--ink);
  display: grid;
  grid-template-rows: auto auto auto 1fr auto;
  justify-items: center;
  gap: 8px;
  width: 260px;
  min-height: 250px;
  padding: 18px 16px 14px;
  text-align: center;
}
.screen button.route-card.focused {
  --bg: var(--navy);
  --hi: var(--blue);
  --lo: var(--ink);
  --ring: var(--white);
}
.screen button.route-card.mine {
  --ring: var(--yellow);
}
.route-card .rk {
  position: absolute;
  top: calc(2 * var(--p));
  left: calc(3 * var(--p));
  font: 11px var(--label);
  color: var(--mist);
}
.route-card .ri {
  font: 52px var(--display);
  line-height: 1;
  color: var(--rc);
}
.route-card b {
  font: 34px var(--display);
  letter-spacing: 1px;
  color: var(--rc);
}
.route-card small {
  font-size: 19px;
  line-height: 1.2;
  color: var(--white);
}
.route-card .rv {
  display: flex;
  gap: 6px;
  align-items: center;
  min-height: 14px;
}
.route-card .rv i {
  width: calc(3 * var(--p));
  height: calc(3 * var(--p));
  background: var(--vc);
  box-shadow: 0 0 0 var(--p) var(--ink);
}
.route-card .rv em {
  font: normal 10px var(--label);
  color: var(--yellow);
}
#scr-route .route-foot {
  font: 12px var(--label);
  letter-spacing: 1px;
  color: var(--cyan);
}

#scr-modes {
  gap: 14px;
}
/* Tall menus scroll instead of squashing notes into the rows below. */
#scr-modes > *,
#scr-heat > * {
  flex-shrink: 0;
}
#scr-modes .mut-desc {
  display: block;
  margin-top: 4px;
  font: 10px var(--label);
  letter-spacing: 1px;
  line-height: 1.6;
  color: var(--mist);
}
#scr-modes .mode-grid {
  grid-template-columns: repeat(auto-fit, minmax(168px, 178px));
  width: min(1000px, 96vw);
  gap: 12px;
}
#scr-modes button.mode {
  min-height: 112px;
}
#scr-modes button.mode b {
  font-size: 23px;
}
#scr-modes button.mode small {
  font-size: 16px;
}
#scr-modes .modes-extra {
  display: contents;
}
#scr-modes h1 {
  font-size: 60px;
}
.screen button.heat-open {
  display: grid;
  justify-items: center;
  gap: 2px;
  font-size: 26px;
  padding: 8px 22px 10px;
}
.screen button.heat-open small {
  font: 10px var(--label);
  letter-spacing: 1px;
  color: var(--mist);
}
.screen button.heat-open:disabled {
  color: var(--slate);
}

.heat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 380px));
  gap: 10px 16px;
  width: min(780px, 96vw);
}
@media (max-width: 640px) {
  .heat-grid { grid-template-columns: 1fr; }
}
.screen button.heat-mod {
  --bg: var(--night);
  --hi: var(--slate);
  --lo: var(--ink);
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-areas: 'icon name pips' 'icon desc hh';
  align-items: center;
  column-gap: 12px;
  row-gap: 0;
  padding: 5px 12px 7px;
  text-align: left;
}
#scr-heat h1 {
  font-size: 56px;
}
#scr-heat {
  gap: 12px;
}
.screen button.heat-mod.focused {
  --bg: var(--navy);
  --hi: var(--blue);
  --ring: var(--white);
}
.screen button.heat-mod.on {
  --hi: var(--orange);
  --lo: var(--red);
}
.heat-mod .hi {
  grid-area: icon;
  font: 34px var(--display);
  color: var(--orange);
  width: 32px;
  text-align: center;
}
.heat-mod b {
  grid-area: name;
  font-size: 24px;
}
.heat-mod .pips {
  grid-area: pips;
  display: flex;
  gap: 4px;
}
.heat-mod .pips i {
  width: calc(3 * var(--p));
  height: calc(3 * var(--p));
  background: var(--ink);
  box-shadow: inset 0 0 0 var(--p) var(--slate);
}
.heat-mod .pips i.on {
  background: var(--orange);
  box-shadow: inset 0 0 0 var(--p) var(--yellow);
}
.heat-mod small {
  grid-area: desc;
  font-size: 17px;
  color: var(--mist);
}
.heat-mod.on small {
  color: var(--white);
}
.heat-mod .hh {
  grid-area: hh;
  justify-self: end;
  font: 9px var(--label);
  letter-spacing: 1px;
  color: var(--slate);
}
#scr-heat .heat-sum {
  font-size: 24px;
  color: var(--white);
  text-shadow: var(--outline);
}
#scr-heat .heat-sum b {
  color: var(--orange);
  font-weight: normal;
}
#scr-heat .heat-goals {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 22px;
  font: 11px var(--label);
  letter-spacing: 1px;
  color: var(--mist);
}
#scr-heat .heat-goals .got {
  color: var(--lime);
}
#scr-heat .heat-intro {
  max-width: 780px;
  font-size: 18px;
  line-height: 1.25;
}
`;
