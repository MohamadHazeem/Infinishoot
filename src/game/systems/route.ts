/**
 * Route map flow: after each stage's shop the team picks the road to the next stage
 * (src/game/route.ts lays the map out, src/ui/routeMap.ts draws it), then the picked node
 * modifies that stage: spawn tuning, rewards at the clear, an encounter before it.
 * These are Game methods (`this` is the Game), installed on the class as fields.
 *
 * Solo and host only decide; clients get the map state in 'route' messages and vote with 'rvote'.
 * The map is open while the game sits in mode 'shop' (everyone's shop is done), so the world
 * stays frozen exactly like the shop.
 */
import type { Game } from '../game';
import { LOOP_STAGES, xpForLevel } from '../game';
import { ENEMIES } from '../../data/enemies';
import { CURSES } from '../../data/curses';
import { biomeForStage } from '../../data/biomes';
import { directorTuning } from '../director';
import { economyTuning, MAX_GEARS, type Hero } from '../hero';
import { HIDDEN_NODES, ROUTE_EVENTS, ROUTE_NODES, eventTuning, routeTuning, type EventEffect, type NodeKind } from '../../data/routeNodes';
import { pacifistTuning } from '../modes/pacifist';
import { routeChoices, routeEdges, routeEventFor, routeLayer, routeTally, routeWindow } from '../route';
import type { RouteView } from '../../ui/routeMap';
import { samples } from '../../audio/samples';
import { sfx } from '../../audio/sfx';

export interface RouteRun {
  /** The route map is used this run (standard and daily solo, co-op; not endless, boss rush or PvP). */
  on: boolean;
  /** Picked node index per stage: path[stage] (stage 1 is the start, index 0). */
  path: number[];
  open: boolean;
  phase: 'map' | 'event';
  /** Map phase: indices into the next layer that can be picked. */
  options: number[];
  /** Vote per hero index (-1 = none). */
  votes: number[];
  /** Co-op: seconds left to vote. */
  t: number;
  /** Event phase: index into ROUTE_EVENTS. */
  event: number;
  /** The decided option, shown for a moment before the screen moves on (-1 = undecided). */
  decided: number;
  hold: number;
  /** Elite Hunt: director time of the next extra elite. */
  nextElite: number;
  /** Mode last step, to catch the stage clear. */
  lastMode: string;
  /** Last whole second broadcast to clients. */
  sentT: number;
  /** Test links: the current stage plays as this node. */
  force: NodeKind | null;
  /** routeKind cache (it runs per spawn and per step): stage, node index, kind. */
  cStage: number;
  cIdx: number;
  cKind: NodeKind;
}

export function newRouteRun(): RouteRun {
  return { on: false, path: [0, 0], open: false, phase: 'map', options: [], votes: [], t: 0, event: 0, decided: -1, hold: 0, nextElite: routeTuning.eliteOffset, lastMode: '', sentT: -1, force: null, cStage: -1, cIdx: -1, cKind: 'start' };
}

/** New run: the start node, and whether this mode uses the map. */
export function routeReset(this: Game): void {
  this.route = newRouteRun();
  this.route.on = !this.pvp && (this.runMode === 'standard' || this.runMode === 'daily');
}

/** The node kind the current stage was reached through ('start' when there's none). */
export function routeKind(this: Game, stage = this.stage): NodeKind {
  const r = this.route;
  if (r.force && stage === this.stage) return r.force;
  if (!r.on || stage <= 1 || r.path[stage] === undefined) return 'start';
  if (r.cStage !== stage || r.cIdx !== r.path[stage]) {
    r.cStage = stage;
    r.cIdx = r.path[stage];
    r.cKind = routeLayer(this.seed, stage, LOOP_STAGES).nodes[r.cIdx]?.kind ?? 'start';
  }
  return r.cKind;
}

/** The current node's share of a curse-style modifier (added into curseSum). */
export function routeMod(this: Game, k: string): number {
  const kind = this.routeKind();
  const T = routeTuning;
  if (kind === 'hard') return k === 'enemyHp' ? T.hardHp : k === 'enemyDmg' ? T.hardDmg : k === 'enemyCount' ? T.hardCount : k === 'score' ? T.hardScore : 0;
  if (kind === 'elite') return k === 'enemyHp' ? T.eliteHp : 0;
  if (kind === 'treasure') return k === 'enemyCount' ? T.treasureCount : 0;
  if (kind === 'pacifist') return k === 'enemyCount' ? pacifistTuning.count : 0; // modes lane
  return 0;
}

/** Merchant Road: the shop after this stage is the secret merchant. */
export function routeSecretShop(this: Game): boolean {
  return !this.preShop && this.routeKind() === 'shop';
}

/** A stage just loaded (host/solo): node effects that start with the stage. */
export function routeStageStart(this: Game): void {
  const r = this.route;
  r.nextElite = routeTuning.eliteOffset;
  r.lastMode = this.mode;
  const kind = this.routeKind();
  if (kind === 'start') return;
  const def = ROUTE_NODES[kind];
  this.vfx.toast(`${def.name.toUpperCase()}: ${def.short.toUpperCase()}`, 3.5);
  if (kind === 'treasure') {
    for (let i = 0; i < routeTuning.treasureChests; i++) this.routeChest();
    this.chestT = routeTuning.treasureChestT;
    this.routeGears(routeTuning.treasureGears);
  }
}

/** A chest at a random walkable spot (as the timed chests do). */
export function routeChest(this: Game): void {
  const lim = this.arena.halfSize - 5;
  for (let tries = 0; tries < 30; tries++) {
    const x = this.rng.range(-lim, lim);
    const z = this.rng.range(-lim, lim);
    if (this.walls.hitCircle(x, z, 1.2) || Math.hypot(x, z) < 4) continue;
    const facing = this.rng.range(0, Math.PI * 2);
    this.chests.add(x, z, facing);
    this.host?.broadcast({ t: 'chestspawn', x, z, f: facing });
    this.vfx.ring(x, z, 1, 6, '#ffcd75', 0.6);
    return;
  }
}

export function routeGears(this: Game, n: number): void {
  for (const h of this.heroes) if (!h.left) h.rerollsLeft = Math.min(MAX_GEARS, h.rerollsLeft + n);
}

/** Per step (host/solo, before the menu freeze): votes, Elite Hunt spawns, stage-clear rewards. */
export function updateRoute(this: Game, dt: number): void {
  const r = this.route;
  if (!r.on || this.role === 'client' || this.paused) return;
  if (this.mode === 'fight' && !this.director.bossSpawned && this.routeKind() === 'elite' && this.director.time >= r.nextElite) {
    r.nextElite += directorTuning.eliteEvery;
    const pool = Object.values(ENEMIES).filter((d) => d.minMinute >= 0 && d.minMinute <= 2 + this.stage && (d.minStage ?? 1) <= this.stage && d.behavior !== 'spawner' && d.id !== 'swarmer' && !d.boss && !d.hidden);
    if (pool.length) this.spawnEnemy(this.rng.pick(pool), true);
  }
  if (this.mode === 'cleared' && r.lastMode !== 'cleared') this.routeClearRewards();
  r.lastMode = this.mode;
  if (!r.open) return;
  if (r.decided >= 0) {
    r.hold -= dt;
    if (r.hold <= 0) this.routeAdvance();
    return;
  }
  const coop = this.heroes.length > 1;
  if (coop) r.t -= dt;
  const voters = this.heroes.filter((h) => !h.left).length;
  const votes = this.heroes.map((h, i) => (h.left ? -1 : r.votes[i] ?? -1));
  const pick = routeTally(votes, voters, this.local, coop && r.t <= 0);
  if (pick >= 0) this.routeDecide(pick);
  else if (coop && Math.ceil(r.t) !== r.sentT) {
    r.sentT = Math.ceil(r.t);
    this.routeShow(true);
  }
}

/** Node rewards paid at the stage clear (the clear's own gold is already in). */
export function routeClearRewards(this: Game): void {
  const kind = this.routeKind();
  const T = routeTuning;
  if (kind === 'elite') {
    this.vfx.toast('ELITE HUNT CLEARED: BONUS RELIC!', 3);
    this.grantRelics();
  } else if (kind === 'shop') {
    for (const h of this.heroes) if (!h.left) h.gold += T.shopGold;
    this.vfx.toast(`MERCHANT ROAD: +${T.shopGold} GOLD`, 3);
  } else if (kind === 'hard') {
    for (const h of this.heroes) if (!h.left) h.gold += economyTuning.clearGold + h.interest + T.hardGold;
    this.vfx.toast('DANGER ZONE CLEARED: DOUBLE GOLD!', 3);
    this.vfx.sound('coin', NaN, NaN);
  }
}

/** Test links: open an encounter (ROUTE_EVENTS id) right away. */
export function routeTestEvent(this: Game, id: string): void {
  const i = ROUTE_EVENTS.findIndex((e) => e.id === id);
  const r = this.route;
  r.on = true;
  r.open = true;
  r.phase = 'event';
  r.event = Math.max(0, i);
  this.mode = 'shop';
  this.routeBeginVote();
}

/** After the shop: open the map. False when the route isn't used (the caller opens the portal). */
export function openRoute(this: Game): boolean {
  const r = this.route;
  if (!r.on || this.role === 'client' || this.pvp) return false;
  if (r.open) return true;
  r.open = true;
  r.phase = 'map';
  r.options = routeChoices(this.seed, this.stage, r.path[this.stage] ?? 0, LOOP_STAGES);
  this.routeBeginVote();
  return true;
}

export function routeBeginVote(this: Game): void {
  const r = this.route;
  r.votes = this.heroes.map(() => -1);
  r.t = routeTuning.voteTime;
  r.sentT = -1;
  r.decided = -1;
  this.routeShow();
}

/** This machine's pick on the route screen. */
export function routePick(this: Game, i: number): void {
  if (this.role === 'client') {
    this.client?.send({ t: 'rvote', i });
    this.routeLocalVote = i;
    sfx.menuSelect();
    return;
  }
  this.routeVote(this.hero, i);
}

export function routeVote(this: Game, h: Hero, i: number): void {
  const r = this.route;
  if (!r.open || r.decided >= 0 || !Number.isInteger(i) || i < 0 || i >= this.routeOptionCount()) return;
  r.votes[h.index] = i;
  if (h === this.hero) sfx.menuSelect();
  this.routeShow();
}

export function routeOptionCount(this: Game): number {
  const r = this.route;
  return r.phase === 'map' ? r.options.length : ROUTE_EVENTS[r.event].options.length;
}

/** The vote is in: show it for a moment, then move on. */
export function routeDecide(this: Game, pick: number): void {
  const r = this.route;
  r.decided = pick;
  r.hold = 0.55;
  r.votes = r.votes.map(() => -1);
  r.votes[this.local] = pick; // highlights the result on every screen
  if (r.phase === 'map') r.path[this.stage + 1] = r.options[pick];
  playRouteSample();
  this.routeShow();
}

/** Apply the decided option and go on: an encounter, or the portal. */
export function routeAdvance(this: Game): void {
  const r = this.route;
  const pick = r.decided;
  r.decided = -1;
  if (r.phase === 'map') {
    const kind = this.routeKind(this.stage + 1);
    if (kind === 'rest') this.routeRest();
    if (kind === 'arcade' && this.modesArcade()) return; // modes lane: the bonus mini-game, then the portal
    if (kind === 'event') {
      r.phase = 'event';
      r.event = routeEventFor(this.seed, this.stage + 1);
      this.routeBeginVote();
      return;
    }
  } else this.routeEventEffect(ROUTE_EVENTS[r.event].options[pick].effect);
  this.closeRoute();
}

export function closeRoute(this: Game): void {
  const r = this.route;
  r.open = false;
  if (this.screens.current === 'route') this.screens.show('none');
  this.host?.broadcast({ t: 'route', open: false });
  this.openPortal();
  const def = ROUTE_NODES[this.routeKind(this.stage + 1)];
  this.vfx.toast(`NEXT: ${def.name.toUpperCase()}`, 2.5);
}

/** Campfire: full heal, everyone up, a free reroll. */
export function routeRest(this: Game): void {
  for (const h of this.heroes) {
    if (h.left) continue;
    if (h.player.dead) this.reviveHero(h, 1, false);
    h.player.heal(h.player.maxHp);
  }
  this.routeGears(routeTuning.restGears);
  this.vfx.toast('CAMPFIRE: FULL HEAL, +1 REROLL', 3);
  this.vfx.sound('heal', NaN, NaN);
}

/** Tell one hero something on their own screen. */
function note(g: Game, h: Hero, msg: string): void {
  if (h === g.hero) g.hud.toast(msg, 3);
  else g.tell(h, { t: 'toast', msg });
}

export function routeEventEffect(this: Game, effect: EventEffect): void {
  const E = eventTuning;
  const live = this.heroes.filter((h) => !h.left);
  switch (effect) {
    case 'bloodRelic':
      for (const h of live) h.player.hp = Math.max(1, Math.round(h.player.hp * (1 - E.bloodCost)));
      this.vfx.sound('ominous', NaN, NaN);
      this.grantRelics();
      break;
    case 'gamble':
      for (const h of live) {
        if (h.gold < E.gambleCost) {
          note(this, h, 'NOT ENOUGH GOLD TO BET');
          continue;
        }
        h.gold -= E.gambleCost;
        const win = this.rng.chance(0.5);
        if (win) h.gold += E.gambleWin;
        note(this, h, win ? `JACKPOT! +${E.gambleWin} GOLD` : `YOU LOST ${E.gambleCost} GOLD`);
      }
      this.vfx.sound('coin', NaN, NaN);
      break;
    case 'idolCurse': {
      const left = CURSES.filter((c) => !this.curses.includes(c.id));
      if (left.length) {
        const c = this.rng.pick(left);
        this.curses.push(c.id);
        this.vfx.toast(`CURSED: ${c.name.toUpperCase()}`, 3);
      }
      for (const h of live) {
        h.gold += E.idolGold;
        h.recomputeStats();
      }
      this.vfx.sound('ominous', NaN, NaN);
      break;
    }
    case 'springHeal':
      for (const h of live) h.player.heal(h.player.maxHp);
      this.vfx.sound('heal', NaN, NaN);
      break;
    case 'springGear':
      this.routeGears(E.springGears);
      this.vfx.sound('gear', NaN, NaN);
      break;
    case 'sparXp':
      this.gainXp(Math.max(0, xpForLevel(this.level) - this.xp));
      break;
    case 'restHalf':
      for (const h of live) h.player.heal(h.player.maxHp * 0.5);
      this.vfx.sound('heal', NaN, NaN);
      break;
    case 'tithe':
      for (const h of live) {
        if (h.gold < E.titheCost) {
          note(this, h, 'NOT ENOUGH GOLD FOR THE TITHE');
          continue;
        }
        h.gold -= E.titheCost;
        h.rerollsLeft = Math.min(MAX_GEARS, h.rerollsLeft + E.titheGears);
        note(this, h, `+${E.titheGears} REROLL GEARS`);
      }
      break;
    case 'nothing':
      break;
  }
}

function playRouteSample(): void {
  samples.play('route_select', { bus: 'ui', gain: 0.8 });
}

/** The view for this machine (host/solo), then draw it here and send it to the clients. */
export function routeShow(this: Game, statusOnly = false): void {
  const r = this.route;
  const coop = this.heroes.length > 1;
  const net = { t: 'route', open: true, phase: r.phase, stage: this.stage, seed: this.seed, path: r.path, options: r.options, votes: r.votes, tl: coop ? r.t : -1, ev: r.event, so: statusOnly, dec: r.decided >= 0 };
  this.host?.broadcast(net);
  this.screens.showRoute(this.routeViewFrom(net, r.votes[this.local] ?? -1), statusOnly);
}

/** Map state as sent over the wire -> the screen's view model (same code on host and clients). */
export function routeViewFrom(this: Game, m: { phase: string; stage: number; seed: number; path: number[]; options: number[]; votes: number[]; tl: number; ev: number }, myVote: number): RouteView {
  const stages = routeWindow(m.stage, routeTuning.behind, routeTuning.ahead);
  const layers = stages.map((s) => {
    const layer = routeLayer(m.seed, s, LOOP_STAGES);
    // Hidden roads (the Pacifist road) read ??? until they are the road taken.
    const nodes = layer.nodes.map((n, i) => (HIDDEN_NODES.includes(n.kind) && m.path[s] !== i ? { ...n, kind: 'secret' as NodeKind } : n));
    return { stage: s, nodes, edges: routeEdges(layer, routeLayer(m.seed, s + 1, LOOP_STAGES)), final: s % LOOP_STAGES === 0, biome: biomeForStage(s).name };
  });
  const ev = m.phase === 'event' ? ROUTE_EVENTS[m.ev] : undefined;
  return {
    phase: m.phase === 'event' ? 'event' : 'map',
    stage: m.stage,
    layers,
    path: m.path,
    options: m.options,
    event: ev && { name: ev.name, text: ev.text, color: ev.color, options: ev.options },
    votes: this.heroes.flatMap((h, i) => (m.votes[i] >= 0 && !h.left ? [{ name: h.name, color: h.color, option: m.votes[i] }] : [])),
    timeLeft: m.tl,
    myVote,
    coop: this.heroes.length > 1,
  };
}

/** Client: the host's 'route' message. */
export function routeFromNet(this: Game, m: Record<string, unknown>): void {
  if (!m.open) {
    this.routeLocalVote = -1;
    if (this.screens.current === 'route') this.screens.show('none');
    return;
  }
  const net = {
    phase: String(m.phase ?? 'map'),
    stage: Number(m.stage) || this.stage,
    seed: Number(m.seed) >>> 0,
    path: (m.path as number[]) ?? [],
    options: (m.options as number[]) ?? [],
    votes: (m.votes as number[]) ?? [],
    tl: Number(m.tl ?? -1),
    ev: Number(m.ev) || 0,
  };
  if (m.dec) playRouteSample();
  if (net.phase !== this.routeNetPhase) this.routeLocalVote = -1;
  this.routeNetPhase = net.phase;
  const mine = net.votes[this.local] ?? -1;
  this.screens.showRoute(this.routeViewFrom(net, mine >= 0 ? mine : this.routeLocalVote), !!m.so && this.screens.current === 'route');
}
