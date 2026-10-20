/** Offline squad decisions. Intent is reused; expensive sensing is staggered at 10 Hz. */
import type { Game } from './game';
import { MAX_GEARS, type Hero } from './hero';
import { Team } from './bullets';
import type { Offer } from '../ui/screens';
import { Autopilot, type PilotIntent } from './autopilot';
import { PickupType } from './pickups';
import { OWNED_CHEST, REVIVE_RANGE } from './game';
import { coopPlayState, coopObjectiveTarget } from './systems/coopplay';
import { roleOf } from '../data/coopRoles';

export const squadTuning = {
  thinkEvery: 6,
  leash: 9,
  spread: 7,
  follow: 3.5,
  lootRange: 7,
  pingTime: 8,
  dangerRadius: 6,
  unstuckAfter: 1.2,
};
export type SquadOrder = 'follow' | 'spread' | 'hold' | 'boss';
export const SQUAD_ORDERS: readonly SquadOrder[] = ['follow', 'spread', 'hold', 'boss'];
export interface SquadCommand {
  order: SquadOrder;
  x: number;
  z: number;
  ping: 'go' | 'danger' | '';
  px: number;
  pz: number;
  until: number;
}
export function squadCount(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(3, Math.floor(n))) : 0;
}

/** Stable per-hero plan: evolve first, then role-aligned gear and loadout ranks. */
export function squadPickIndex(offers: readonly Offer[], hero: string, hp = 1): number {
  const role = roleOf(hero);
  let best = 0,
    score = -Infinity;
  for (let i = 0; i < offers.length; i++) {
    const o = offers[i];
    let s = {
      fusion: 100,
      evo: 95,
      evolve: 95,
      track: 50,
      weapon: 40,
      special: 38,
      passive: 32,
      overdrive: 30,
      heal: 0,
      gold: -5,
    }[o.kind];
    if (o.kind === 'heal' && hp < 0.35) s = 80;
    if (o.kind === 'weapon' && (o.level ?? 0) > 0) s += 8;
    if (o.partner?.haveWeapon || o.partner?.haveItem) s += 15;
    if (o.kind === 'track') {
      if (o.slot === (role === 'healer' ? 'special' : role === 'tank' ? 'right' : 'left')) s += 8;
      // Consistently favour one track/fork per hero instead of spreading every rank.
      if (o.pick?.endsWith(`|${hero.length % 2}`)) s += 4;
    }
    if (o.kind === 'passive') {
      const preferred =
        role === 'tank'
          ? /armor|life|regen/
          : role === 'healer'
            ? /medic|revive|rally|battery/
            : role === 'support'
              ? /speed|magnet|cool|rapid/
              : /power|crit|rapid/;
      if (preferred.test(o.id)) s += 24;
    }
    if (s > score) {
      score = s;
      best = i;
    }
  }
  return best;
}

/** Ownership and need checks before a bot even considers chasing a pickup. */
export function squadWantsPickup(
  type: number,
  value: number,
  heroIndex: number,
  hp: number,
  gears: number,
): boolean {
  if (type === PickupType.Chest && value >= OWNED_CHEST) return value - OWNED_CHEST === heroIndex;
  if (type === PickupType.Heart) return hp < 0.8;
  if (type === PickupType.Gear) return gears < MAX_GEARS;
  return true;
}

export class SquadBrain {
  readonly pilot = new Autopilot();
  readonly intent: PilotIntent = {
    mx: 0,
    mz: 0,
    target: null,
    charge: false,
    dash: false,
    special: false,
    ult: false,
    parry: false,
    cash: -1,
  };
  private point = { x: 0, z: 0 };
  private lastX = NaN;
  private lastZ = NaN;
  private stuck = 0;
  private ticks = 0;

  /** Called with g.local temporarily pointing at this bot, as in drop-out autopilot. */
  decide(g: Game, h: Hero, command: SquadCommand): PilotIntent {
    const p = h.player,
      out = this.intent;
    Object.assign(out, this.pilot.decide(g));
    const leader = g.heroes[0].player;
    let target: { x: number; z: number } | null = null;
    let stop = 1.1;
    // Revives override orders, including HOLD. One nearest bot rescues; others keep fighting.
    let down: Hero | null = null,
      dd = Infinity;
    for (const a of g.heroes) {
      if (!a.player.dead || a.left) continue;
      const d = Math.hypot(a.player.x - p.x, a.player.z - p.z);
      if (d < dd) {
        dd = d;
        down = a;
      }
    }
    if (down) {
      let closest = true;
      for (const other of g.heroes)
        if (other !== h && !other.left && !other.player.dead) {
          const d = Math.hypot(other.player.x - down.player.x, other.player.z - down.player.z);
          if (other.index === 0 && d >= REVIVE_RANGE) continue;
          if (d < dd - 0.2 || (Math.abs(d - dd) <= 0.2 && other.index < h.index)) {
            closest = false;
            break;
          }
        }
      if (closest) {
        target = down.player;
        stop = REVIVE_RANGE * 0.5;
        out.dash = false;
      }
    }
    const objective = coopPlayState(g);
    const focusBoss = command.order === 'boss' && g.boss?.alive;
    if (
      !target &&
      command.ping === 'go' &&
      g.runTime < command.until &&
      objective.bomb.by !== h.index
    ) {
      this.point.x = command.px;
      this.point.z = command.pz;
      target = this.point;
      stop = 1.5;
    }
    if (
      !target &&
      (!focusBoss || objective.bomb.by === h.index) &&
      g.toys.objective.active &&
      objective.lay &&
      command.order !== 'hold' &&
      (Math.hypot(leader.x - objective.lay.a.x, leader.z - objective.lay.a.z) < 22 ||
        objective.bomb.by === h.index)
    ) {
      if (objective.kind === 'door' || objective.kind === 'zones') {
        const L = objective.lay;
        // Occupy the opposite pad to the leader; additional bots split between pads.
        const leaderAtA =
          Math.hypot(leader.x - L.a.x, leader.z - L.a.z) <
          Math.hypot(leader.x - L.b.x, leader.z - L.b.z);
        target = h.index % 2 === 1 ? (leaderAtA ? L.b : L.a) : leaderAtA ? L.a : L.b;
      } else target = coopObjectiveTarget(g);
      stop = 0.65;
    }
    if (!target && !focusBoss && command.order !== 'hold') {
      let best = squadTuning.lootRange;
      for (let i = 0; i < g.pickups.count; i++) {
        const drops = g.pickups;
        if (
          !squadWantsPickup(drops.type[i], drops.value[i], h.index, p.hp / p.maxHp, h.rerollsLeft)
        )
          continue;
        const x = drops.x[i],
          z = drops.z[i];
        if (Math.hypot(x - leader.x, z - leader.z) > squadTuning.leash) continue;
        const d = Math.hypot(x - p.x, z - p.z);
        // Yield unowned loot to a closer teammate (and hearts to an injured human nearby).
        if (
          drops.type[i] === PickupType.Heart &&
          leader.hp < leader.maxHp * 0.65 &&
          Math.hypot(x - leader.x, z - leader.z) < 6
        )
          continue;
        let closer = false;
        for (const other of g.heroes)
          if (
            other !== h &&
            !other.left &&
            !other.player.dead &&
            Math.hypot(x - other.player.x, z - other.player.z) + 0.3 < d
          ) {
            if (drops.type[i] !== PickupType.Chest || drops.value[i] < OWNED_CHEST) closer = true;
          }
        if (!closer && d < best) {
          best = d;
          this.point.x = x;
          this.point.z = z;
          target = this.point;
          stop = 0.4;
        }
      }
    }
    if (!target) {
      const radius = command.order === 'spread' ? squadTuning.spread : squadTuning.follow;
      const a = ((h.index - 1) * Math.PI * 2) / 3;
      this.point.x = (command.order === 'hold' ? command.x : leader.x) + Math.cos(a) * radius;
      this.point.z = (command.order === 'hold' ? command.z : leader.z) + Math.sin(a) * radius;
      target = this.point;
      stop = 1.5;
      if (
        command.order === 'boss' &&
        g.boss?.alive &&
        Math.hypot(g.boss.x - leader.x, g.boss.z - leader.z) < 22
      ) {
        this.point.x = g.boss.x + Math.cos(a + g.runTime * 0.15) * 8;
        this.point.z = g.boss.z + Math.sin(a + g.runTime * 0.15) * 8;
        out.target = g.boss;
      }
    }
    // Portal travel belongs to the human; bots keep accompanying them.
    const dx = target.x - p.x,
      dz = target.z - p.z,
      d = Math.hypot(dx, dz);
    out.mx = d > stop ? dx / d : 0;
    out.mz = d > stop ? dz / d : 0;
    // Immediate hazards take precedence over orders/revives. Autopilot handles bullets;
    // only borrow its escape vector when there really is a nearby threat.
    let danger = false;
    for (const e of g.enemies.list)
      if (e.alive && Math.hypot(e.x - p.x, e.z - p.z) < 2.6) {
        danger = true;
        break;
      }
    if (danger && !(down && d < stop)) {
      out.mx += this.pilot.out.mx;
      out.mz += this.pilot.out.mz;
    }
    for (let i = 0; i < g.bullets.count; i++) {
      if (g.bullets.team[i] !== Team.Enemy) continue;
      this.avoid(p.x, p.z, g.bullets.x[i], g.bullets.z[i], 1.8, out);
    }
    for (const strike of g.strikes) this.avoid(p.x, p.z, strike.x, strike.z, strike.r + 1, out);
    for (const zone of g.enemies.zones) this.avoid(p.x, p.z, zone.x, zone.z, zone.r + 0.7, out);
    if (command.ping === 'danger' && g.runTime < command.until)
      this.avoid(p.x, p.z, command.px, command.pz, squadTuning.dangerRadius, out);
    // Short wall-following detours: do not teleport or walk through colliders.
    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.stuck = d > stop && moved < 0.06 ? this.stuck + squadTuning.thinkEvery / 60 : 0;
    this.lastX = p.x;
    this.lastZ = p.z;
    if (this.stuck > squadTuning.unstuckAfter) {
      const side = Math.floor(this.stuck / 2) % 2 ? -1 : 1;
      out.mx = (-dz / (d || 1)) * side;
      out.mz = (dx / (d || 1)) * side;
      out.dash = true;
    }
    // Autopilot's original charge clock assumes 60 Hz; squad sensing runs at 10 Hz.
    out.charge =
      !!out.target &&
      ((this.ticks * squadTuning.thinkEvery) / 60) % 1.6 < 1.4 &&
      g.mode !== 'portal';
    this.ticks++;
    return out;
  }

  private avoid(
    x: number,
    z: number,
    tx: number,
    tz: number,
    radius: number,
    out: PilotIntent,
  ): void {
    const dx = x - tx,
      dz = z - tz,
      d = Math.hypot(dx, dz);
    if (d >= radius) return;
    const a = this.ticks % 2 ? 1 : -1;
    out.mx += d > 0.01 ? (dx / d) * 4 : a * 4;
    out.mz += d > 0.01 ? (dz / d) * 4 : 1;
    out.dash = true;
  }
}
