/**
 * RUN lane: routes between stages, heat and Weekly mutators.
 * These are Game methods (`this` is the Game), installed on the class as fields,
 * e.g. `offerRoutes = RunModsSys.offerRoutes;`. State and knobs: src/game/runMods.ts.
 *
 * Route flow (host or solo): the post-boss shop closes -> closeShop() asks
 * offerRoutes() -> a vote opens (the world stays frozen in mode 'shop') ->
 * every player votes (co-op: a timer, majority, ties go to the host) ->
 * applyRoute() -> closeShop() again, which now carries on to the portal or
 * the next Endless wave. Daily and Weekly take the first rolled route without
 * a vote; Boss Rush and PvP have none. Clients get {t:'route', view} to vote
 * on and {t:'route', done} once it's decided, and vote through ui('route', i).
 */
import type { Game } from '../game';
import { LOOP_STAGES } from '../game';
import { CURSES } from '../../data/curses';
import { ENEMIES } from '../../data/enemies';
import { heatTuning, HEAT_GOALS, type HeatRanks } from '../../data/heat';
import { isChallenge, isoWeek } from '../../data/modes';
import { mutatorTuning, weeklyMutators } from '../../data/mutators';
import { ROUTE_BY_ID, isRouteId, rollRoutes, routeTuning, tallyVotes, type RouteId } from '../../data/routes';
import { biomeForStage } from '../../data/biomes';
import { MAX_GEARS, type Hero } from '../hero';
import { type Enemy } from '../enemies';
import { PickupType } from '../pickups';
import { loadHeatPick, runModsTest, submitWeekly } from '../runMods';
import { recordHeat, save } from '../save';
import { isSpecialRunning } from '../specials';
import { type RunSummary } from '../../ui/screens';
import type { RouteView } from '../../ui/runUi';

/** New run (solo or host): heat from this machine's pick, mutators from the week, no route yet. */
export function runModsStart(this: Game): void {
  const noHeat = !!this.pvp || isChallenge(this.runMode);
  const T = runModsTest;
  this.runMods.reset(T.heat ?? (noHeat ? {} : loadHeatPick()), T.mutators ?? (this.runMode === 'weekly' ? weeklyMutators(isoWeek(this.runDate)) : []));
  this.runMods.route = T.route;
  this.runUi.setTags(this.runMods.tagLines());
}

/** Client: the run's heat arrived in the host's `start` message. */
export function runModsClientStart(this: Game, heat: unknown): void {
  this.runMods.reset(heat as HeatRanks);
  this.runUi.setTags(this.runMods.tagLines());
}

/** Before a stage (or Endless wave) starts: push the route, heat and mutator knobs into the director and events. */
export function runModsStage(this: Game): void {
  const rm = this.runMods;
  this.director.mods.elite = rm.eliteMul;
  this.director.mods.bossHp = rm.bossHpMul;
  this.runEvents.mods = rm.eventMods;
  if (rm.has('gearhead')) for (const h of this.heroes) if (!h.left) h.rerollsLeft = Math.min(MAX_GEARS, h.rerollsLeft + mutatorTuning.gearsPerStage);
  this.runUi.setTags(rm.tagLines());
}

/** Every simulation step, before weapons fire: One-Armed takes the right click and doubles special recharge. */
export function runModsStep(this: Game, dt: number): void {
  if (!this.runMods.has('onearm')) return;
  for (const h of this.heroes) {
    if (h.left || h.player.dead) continue;
    h.ctx.charging = false;
    if (h.bombT >= 0 || isSpecialRunning(h)) continue;
    h.bombCharge = Math.min(1, h.bombCharge + (dt * (mutatorTuning.onearmCharge - 1)) / h.specialCooldown);
  }
}

/** An enemy died (host): ELITE HUNT bonus drops, Volatile heat blasts, Mitosis splits. */
export function runModsKill(this: Game, e: Enemy): void {
  const rm = this.runMods;
  const def = e.def;
  if (def.hidden || e.pvpOwner >= 0) return;
  const big = !!def.boss || !!def.miniboss || def.id === 'reaper';
  if (e.elite && rm.route === 'elite') {
    for (let i = 0; i < routeTuning.eliteGears; i++) this.pickups.spawn(PickupType.Gear, e.x, e.z);
    for (let i = 0; i < routeTuning.eliteGold; i++) this.pickups.spawn(PickupType.Bolt, e.x, e.z, 1);
  }
  const vol = rm.rank('volatile');
  if (vol > 0 && !big && this.rng.chance(heatTuning.volatile * vol)) {
    const r = heatTuning.volatileR * Math.min(1.6, e.scale);
    this.strikes.push({ x: e.x, z: e.z, r, t: heatTuning.volatileFuse, dmg: heatTuning.volatileDmg * this.director.dmgMul * this.difficulty.enemyDmg, cause: `Volatile ${def.name}` });
    this.vfx.zone(e.x, e.z, r, heatTuning.volatileFuse);
  }
  if (rm.has('mitosis') && !big && !def.split && def.id !== 'swarmer' && def.id !== 'golden' && !def.treasure) {
    for (let i = 0; i < mutatorTuning.mitosisCount; i++) {
      const a = (i / mutatorTuning.mitosisCount) * Math.PI * 2 + this.rng.next();
      this.enemyCtx.spawnChild(ENEMIES.swarmer.id, e.x + Math.cos(a) * 0.8, e.z + Math.sin(a) * 0.8, e);
    }
  }
}

// ---------------------------------------------------------------- routes

/**
 * Called by closeShop() after the post-boss shop. Returns true while a route vote is
 * open (closeShop stops there and is called again once it's decided).
 */
export function offerRoutes(this: Game): boolean {
  const rm = this.runMods;
  const next = this.stage + 1;
  if (rm.decidedFor === next || this.role === 'client' || this.pvp || this.runMode === 'bossrush') return false;
  if (rm.vote) {
    // Called again while voting (a player left): maybe everyone left has voted now.
    // Either way closeShop stops here: resolveVote() calls it again itself.
    if (this.heroes.every((h, i) => h.left || rm.vote!.votes[i] >= 0)) resolveVote.call(this);
    return true;
  }
  const cards = rollRoutes(this.seed, next, next % LOOP_STAGES === 0);
  if (isChallenge(this.runMode)) {
    // Daily and Weekly: the seed picks the route, the same for everyone.
    this.applyRoute(cards[0], next);
    return false;
  }
  rm.vote = { stage: next, cards, votes: this.heroes.map(() => -1), left: this.coop ? routeTuning.voteSeconds : -1 };
  this.vfx.sound('jingle', NaN, NaN);
  this.presentRoutes();
  return true;
}

/** Show the vote to every player (again after each vote, so everyone sees who picked what). */
export function presentRoutes(this: Game): void {
  for (const h of this.heroes) {
    if (h.left) continue;
    const view = this.routeView(h);
    if (!view) continue;
    if (h === this.hero) this.runUi.showRoutes(view);
    else this.tell(h, { t: 'route', view });
  }
}

export function routeView(this: Game, h: Hero): RouteView | null {
  const v = this.runMods.vote;
  if (!v) return null;
  const k = this.heroes.indexOf(h);
  return {
    stage: v.stage,
    biome: biomeForStage(v.stage).name,
    final: v.stage % LOOP_STAGES === 0,
    cards: v.cards.map((id, i) => ({ id, voters: this.heroes.filter((x, j) => !x.left && v.votes[j] === i).map((x) => ({ name: x.name, color: x.color })) })),
    mine: v.votes[k] ?? -1,
    left: v.left,
    coop: this.heroes.filter((x) => !x.left).length > 1,
  };
}

/** A player picks a route card (host authority; clients arrive through ui('route', i)). */
export function routeVote(this: Game, h: Hero, i: number): void {
  const v = this.runMods.vote;
  if (!v || this.role === 'client' || !(i >= 0 && i < v.cards.length)) return;
  v.votes[this.heroes.indexOf(h)] = i;
  if (this.heroes.every((x, j) => x.left || v.votes[j] >= 0)) resolveVote.call(this);
  else this.presentRoutes();
}

/** Co-op vote timer (runs while the world is frozen in the shop). */
export function routeTick(this: Game, dt: number): void {
  const v = this.runMods.vote;
  if (!v || v.left < 0 || this.role === 'client') return;
  v.left -= dt;
  if (v.left <= 0) resolveVote.call(this);
}

function resolveVote(this: Game): void {
  const v = this.runMods.vote;
  if (!v) return;
  this.runMods.vote = null;
  const id = v.cards[tallyVotes(v.votes, v.cards.length, this.local)];
  this.applyRoute(id, v.stage);
  if (this.screens.current === 'route') this.screens.show('none');
  this.closeShop();
}

/** The route for `stage` is settled: tell everyone, and the CURSED route takes its curse and hands out relics now. */
export function applyRoute(this: Game, id: RouteId, stage: number): void {
  const rm = this.runMods;
  const def = ROUTE_BY_ID[id];
  rm.route = id;
  rm.routeCurse = '';
  rm.decidedFor = stage;
  for (const h of this.heroes) if (!h.left) this.tell(h, { t: 'route', done: id });
  this.runUi.setTags(rm.tagLines());
  this.vfx.sound(id === 'cursed' ? 'ominous' : 'jingle', NaN, NaN);
  this.vfx.toast(`${def.icon} ${def.name.toUpperCase()} ROUTE: ${def.desc.toUpperCase()}`, 4);
  if (id !== 'cursed') return;
  const left = CURSES.filter((c) => !this.curses.includes(c.id));
  if (left.length) {
    const c = this.rng.pick(left);
    this.curses.push(c.id);
    rm.routeCurse = c.name;
    this.director.countMul = (1 + this.curseSum('enemyCount')) * this.difficulty.enemyCount;
    for (const h of this.heroes) h.recomputeStats();
  }
  this.score += routeTuning.cursedScore * stage;
  this.grantRelics();
}

/** "TREASURE ROUTE" (plus the curse taken) for stage banners; '' without a route. */
export function routeLine(this: Game): string {
  const r = this.runMods.route;
  if (!r) return '';
  const curse = r === 'cursed' && this.runMods.routeCurse ? `: ${this.runMods.routeCurse.toUpperCase()}` : '';
  return `${ROUTE_BY_ID[r].name.toUpperCase()} ROUTE${curse}`;
}

/** Client: a route vote to show, or the decided route. */
export function clientRoute(this: Game, m: Record<string, unknown>): void {
  if (m.view) this.runUi.showRoutes(m.view as RouteView);
  if (isRouteId(m.done)) {
    this.runMods.route = m.done;
    if (this.screens.current === 'route') this.screens.show('none');
    this.runUi.setTags(this.runMods.tagLines());
  }
}

// ---------------------------------------------------------------- end of run

/**
 * Heat milestones for checkAchievements (this machine's save): a run counts as cleared once
 * the final boss falls. Records the best heat cleared with this hero and returns the
 * cosmetic achievements' conditions.
 */
export function heatWants(this: Game): [string, boolean][] {
  const heat = this.runMods.heatTotal;
  const won = this.victories > 0 && this.role !== 'client' && heat > 0;
  if (won && recordHeat(this.hero.heroDef.id, heat)) this.hud.toast(`NEW BEST HEAT FOR ${this.hero.heroDef.name.toUpperCase()}: ${heat}`, 4);
  return HEAT_GOALS.map((g) => [g.achievement, won && heat >= g.heat]);
}

/** Weekly best (like the Daily's). */
export function runModsBank(this: Game, sum: RunSummary): void {
  if (this.runMode === 'weekly' && this.role !== 'client' && submitWeekly(isoWeek(this.runDate), sum.score)) this.hud.toast('NEW BEST FOR THIS WEEK\'S CHALLENGE!', 4);
}

/** Best heat cleared with a hero (for the MODE and HEAT screens). */
export function bestHeat(hero: string): number {
  return save.heat[hero] ?? 0;
}
