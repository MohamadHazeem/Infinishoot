/** Offline squads use the local co-op authority path: role=solo, several real Heroes, no peers. */
import type { Game } from '../game';
import type { Hero } from '../hero';
import type { Input } from '../../core/input';
import { economyTuning } from '../hero';
import {
  SquadBrain,
  squadCount,
  squadPickIndex,
  squadTuning,
  SQUAD_ORDERS,
  type SquadOrder,
  type SquadCommand,
} from '../aisquadBrain';
import { HEROES, heroOf } from '../../data/heroes';
import { DEFAULT_LOADOUT } from '../../data/loadout';
import { unlockedHeroes } from './localCoop';
import { unlockedWeapons } from '../save';
import { settings, saveSettings } from '../settings';
import { timeState } from './time';
import { t, localize } from '../../i18n';
import { prompt } from '../../ui/prompts';

interface SquadState {
  brains: Map<Hero, SquadBrain>;
  bots: Hero[];
  command: SquadCommand;
  input: { move: { x: number; y: number } };
  seed: number;
  stage: number;
  hud: HTMLElement | null;
  hudText: string;
}
const states = new WeakMap<Game, SquadState>();
function state(g: Game): SquadState {
  let s = states.get(g);
  if (!s) {
    s = {
      brains: new Map(),
      bots: [],
      command: { order: 'follow', x: 0, z: 0, ping: '', px: 0, pz: 0, until: 0 },
      input: { move: { x: 0, y: 0 } },
      seed: -1,
      stage: -1,
      hud: null,
      hudText: '',
    };
    states.set(g, s);
  }
  return s;
}

export function resetSquad(this: Game): void {
  this.squadRun = false;
  const s = states.get(this);
  if (!s) return;
  s.brains.clear();
  s.bots.length = 0;
  s.hud?.remove();
  s.hud = null;
  s.hudText = '';
}

/** Called only from startSolo, after leaveToTitle and before startRun builds/scales the stage. */
export function startSquad(this: Game): void {
  const count = squadCount(settings.squadBots);
  // Competitive/challenge modes keep their authored solo rules and scoreboards.
  if (
    !count ||
    this.role !== 'solo' ||
    this.localCoop ||
    this.pvp ||
    !['standard', 'endless', 'bossrush'].includes(this.runMode)
  )
    return;
  const s = state(this);
  s.brains.clear();
  s.bots.length = 0;
  s.command.order = 'follow';
  s.command.ping = '';
  s.seed = -1;
  const available = unlockedHeroes();
  const heroes = [this.hero];
  for (let i = 1; i <= count; i++) {
    const pick =
      typeof settings.squadHeroes === 'string' ? settings.squadHeroes.split(',')[i - 1] : 'random';
    const id =
      pick && available.includes(pick)
        ? pick
        : (available[(Math.floor(Math.random() * available.length) + i) % available.length] ??
          'rookie');
    const h = this.makeHero(
      i,
      `${t('squad.bot')} ${i} · ${localize(heroOf(id).name)}`,
      unlockedWeapons(),
      '',
      undefined,
      'none',
      id,
    );
    h.loadoutPick = { ...DEFAULT_LOADOUT }; // heroClicks supplies each hero's signature weapons
    s.brains.set(h, new SquadBrain());
    s.bots.push(h);
    heroes.push(h);
  }
  this.setHeroes(heroes);
  this.squadRun = true;
}

/** Menu automation is independent of movement and runs while the world is frozen. */
export function squadStep(this: Game): void {
  if (!this.squadRun || this.role !== 'solo') return;
  const s = state(this);
  if (s.seed !== this.seed) {
    s.seed = this.seed;
    s.command.order = 'follow';
    s.command.ping = '';
    for (const h of s.bots) s.brains.set(h, new SquadBrain());
  }
  if (s.stage !== this.stage) {
    s.stage = this.stage;
    s.command.order = 'follow';
    s.command.ping = '';
  }
  for (const h of s.bots) {
    if (h.left) continue;
    if (this.mode === 'levelup' && h.needsPick && h.offers.length)
      this.heroAction(
        h,
        'pick',
        squadPickIndex(h.offers, h.heroDef.id, h.player.hp / h.player.maxHp),
        1,
      );
    if (this.mode === 'shop' && !h.shopDone) {
      if (h.relicOffers.length) this.heroAction(h, 'relic', 0, 1);
      if (
        !h.shopHealed &&
        !h.player.dead &&
        h.player.hp < h.player.maxHp * 0.65 &&
        h.gold >= economyTuning.healCost
      )
        this.heroAction(h, 'heal', 0, 1);
      // Buy useful, affordable Mods with this hero's gold. No shared-pool spending.
      for (let buys = 0; buys < 5 && !h.synergy.full; buys++) {
        let best = -1,
          score = -Infinity;
        for (let i = 0; i < h.shopOffers.length; i++) {
          const m = h.shopOffers[i];
          if (!m || m.cursed || h.price(m) > h.gold) continue;
          let value = 5 - h.price(m) * 0.1;
          if (m.synergy?.length) {
            let matches = 0;
            for (const w of h.weapons)
              for (const tag of m.synergy) if (w.tags.includes(tag)) matches++;
            if (!matches) continue;
            value += matches * 3;
          }
          if (m.coop) value += 2;
          if (value > score) {
            best = i;
            score = value;
          }
        }
        if (best < 0) break;
        this.heroAction(h, 'buy', best, 1);
      }
      for (let i = 0; i < h.synergy.slots.length; i++) {
        const slot = h.synergy.slots[i];
        if (h.synergy.canUpgrade(i) && h.upgradeCost(slot.def, slot.level) <= h.gold)
          this.heroAction(h, 'mup', i, 1);
      }
      this.heroAction(h, 'done', 0, 1);
    }
    // Bots follow the human's route/encounter choice, never outvote them.
    if (
      this.route.open &&
      this.route.decided < 0 &&
      (this.route.votes[0] ?? -1) >= 0 &&
      this.route.votes[h.index] !== this.route.votes[0]
    )
      this.routeVote(h, this.route.votes[0]);
    const vote = timeState(this).vote;
    if (vote && !h.player.dead && !vote.yes.includes(h.index)) this.requestRewind(h);
  }
  if (!s.hud) {
    s.hud = document.createElement('div');
    s.hud.className = 'squad-status';
    document.getElementById('goals')?.append(s.hud);
    squadCss();
  }
  s.hud.hidden = !this.isCombatMode || this.mode === 'title';
  if (this.stepN % 15 !== 0 && s.hudText) return;
  const text = `${t('squad.title')} · ${orderLabel(s.command.order)} · ${prompt('ping')} ${t('squad.orders')}`;
  if (text !== s.hudText) {
    s.hud.innerHTML = text;
    s.hudText = text;
  }
}

/** Game.updateHero branch. Common stats, synergy, roles and footsteps still run afterwards. */
export function squadHeroUpdate(g: Game, h: Hero, dt: number, control: boolean): boolean {
  if (!g.squadRun || g.role !== 'solo') return false;
  const s = state(g),
    brain = s.brains.get(h);
  if (!brain) return false;
  const p = h.player;
  if (p.dead || !control) {
    p.update(dt, null, g.arena.colliders, false);
    h.ctx.firing = h.ctx.charging = false;
    return true;
  }
  if (g.stepN % squadTuning.thinkEvery === h.index % squadTuning.thinkEvery) {
    const was = g.local;
    try {
      g.local = h.index;
      brain.decide(g, h, s.command);
    } finally {
      g.local = was;
    }
  }
  const o = brain.intent,
    length = Math.hypot(o.mx, o.mz);
  s.input.move.x = length > 0.01 ? o.mx / Math.max(1, length) : 0;
  s.input.move.y = length > 0.01 ? o.mz / Math.max(1, length) : 0;
  if (o.target) p.setAimPoint(o.target.x, o.target.z);
  g.groundAt(p.x, p.z, p.ground);
  if (p.update(dt, s.input as Input, g.arena.colliders, o.dash)) g.onDash(h);
  h.ctx.firing = !!o.target;
  h.ctx.charging = o.charge;
  if (o.special) g.tryBomb(h);
  if (o.parry) g.tryParry(h);
  // Match a human ultimate immediately; otherwise use the brain's combat decision.
  if (o.ult || (g.hero.skill.ult < 1 && g.hero.skill.ultT > 0)) g.tryUlt(h);
  if (o.special || o.ult || (o.target && g.stepN % 120 === h.index)) g.tryTeamMove(h);
  if (o.cash >= 0) g.gpCashIn(h, o.cash);
  // One-shot actions must not repeat during the five cached movement frames.
  o.dash = o.special = o.ult = o.parry = false;
  o.cash = -1;
  return true;
}

export function squadOrder(g: Game, order: SquadOrder): void {
  if (!g.squadRun || !SQUAD_ORDERS.includes(order)) return;
  const c = state(g).command;
  c.order = order;
  c.x = g.heroes[0].player.x;
  c.z = g.heroes[0].player.z;
  c.ping = '';
  g.hud.toast(`${t('squad.orders')}: ${orderLabel(order)}`, 2);
}
export function squadPing(g: Game, x: number, z: number, kind?: string): void {
  if (!g.squadRun || (kind && !['go', 'danger', 'help', 'chest'].includes(kind))) return;
  const c = state(g).command;
  c.ping = kind === 'danger' ? 'danger' : 'go';
  c.px = x;
  c.pz = z;
  c.until = g.runTime + squadTuning.pingTime;
}
export function orderLabel(order: SquadOrder): string {
  return t(`squad.${order}`);
}
export function squadDebug(g: Game): SquadState {
  return state(g);
}

/** MODE screen extension; navigable buttons reuse its existing MenuNav. */
export function renderSquadOptions(el: HTMLElement, refresh: () => void): void {
  squadCss();
  let row = el.querySelector<HTMLElement>('.squad-options');
  if (!row) {
    row = document.createElement('div');
    row.className = 'squad-options';
    el.querySelector('.hero-note')?.after(row);
  }
  const active = ['standard', 'endless', 'bossrush'].includes(settings.mode);
  const count = squadCount(settings.squadBots);
  const picks = typeof settings.squadHeroes === 'string' ? settings.squadHeroes.split(',') : [];
  row.replaceChildren();
  const countButton = document.createElement('button');
  countButton.dataset.nav = '';
  countButton.textContent = t('squad.count', { count: active ? count : 0 });
  countButton.disabled = !active;
  countButton.onclick = () => {
    settings.squadBots = (count + 1) % 4;
    saveSettings();
    renderSquadOptions(el, refresh);
    refresh();
  };
  row.append(countButton);
  if (!active) {
    const note = document.createElement('span');
    note.textContent = t('squad.modes');
    row.append(note);
  }
  const unlocked = ['random', ...unlockedHeroes()];
  for (let i = 0; active && i < count; i++) {
    const id = unlocked.includes(picks[i]) ? picks[i] : 'random';
    const button = document.createElement('button');
    button.dataset.nav = '';
    button.textContent = t('squad.pick', {
      slot: i + 1,
      hero: id === 'random' ? t('squad.random') : localize(HEROES.find((h) => h.id === id)!.name),
    });
    button.onclick = () => {
      picks[i] = unlocked[(unlocked.indexOf(id) + 1) % unlocked.length];
      settings.squadHeroes = Array.from({ length: 3 }, (_, k) => picks[k] || 'random').join(',');
      saveSettings();
      renderSquadOptions(el, refresh);
      refresh();
    };
    row.append(button);
  }
}
function squadCss(): void {
  if (document.getElementById('squad-css')) return;
  const style = document.createElement('style');
  style.id = 'squad-css';
  style.textContent = `.squad-options { display:flex; flex-wrap:wrap; justify-content:center; align-items:center; gap:calc(2 * var(--p)); margin-block:var(--p); }
.squad-options button { font-size:calc(4.5 * var(--p)); padding:var(--p) calc(2 * var(--p)); }
.squad-options span { font:calc(3 * var(--p)) var(--label); color:var(--mist); }
.squad-status { max-width:75vw; font:calc(3 * var(--p)) var(--label); color:var(--cyan); background:var(--ink); padding:var(--p) calc(2 * var(--p)); }
.squad-status[hidden] { display:none; }`;
  document.head.append(style);
}
