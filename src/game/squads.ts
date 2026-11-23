import { patrolDefs, patrolRoles, type PatrolRole } from '../data/enemies';
import type { Enemy, EnemyCtx } from './enemies';
import type { Game } from './game';
import type { Hero } from './hero';
import type { HazardZone } from './hazards';
import { iconHtml } from '../ui/pixelIcons';

export const patrolTuning = {
  fromStage: 2, huntStage: 3, minPower: 0.65, huntPower: 0.8, minHealth: 0.5, lateHealth: 0.35, entryTime: 4, reliefTime: 8,
  tick: 0.1, retreat: 3, commanderRange: 9, guardForward: 2.8, guardSide: 1.05,
  rallyRange: 8, rallyEvery: 5, rallyTime: 2.5,
  sniperRange: 19, sniperTell: 1.25, trapTell: 1.6, trapRadius: 1.65, trapDamage: 12, trapEvery: 6,
  stalk: 12, stalkRange: 16, stalkCall: 3,
};

const roleIcons: Record<PatrolRole, string> = {
  commander: 'storm_crown', marksman: 'sniper', bulwark: 'shield', baiter: 'magnet', hunter: 'bloodlust',
};

type Lure = NonNullable<EnemyCtx['lure']>;
export interface Order {
  unit: Enemy;
  uid: number;
  captain: Order | null;
  focus: Hero | null;
  side: number;
  x: number;
  z: number;
  speed: number;
  radius: number;
  steer: boolean;
}

export function nearestHero(g: Game, e: Enemy): Hero | null {
  let focus: Hero | null = null;
  let best = Infinity;
  for (const h of g.heroes) {
    if (h.left || h.player.dead) continue;
    const d = (h.player.x - e.x) ** 2 + (h.player.z - e.z) ** 2;
    if (d < best) { best = d; focus = h; }
  }
  return focus;
}

/** A lure on the far lip puts visible terrain between the bait and its pursuer. */
export function baitGround(zones: readonly HazardZone[], e: Enemy, h: Hero): HazardZone | null {
  let best = 24 * 24;
  let found: HazardZone | null = null;
  for (const z of zones) {
    const d = (z.x - e.x) ** 2 + (z.z - e.z) ** 2;
    if (d >= best || (h.player.x - z.x) ** 2 + (h.player.z - z.z) ** 2 > 28 ** 2) continue;
    best = d; found = z;
  }
  return found;
}

export function waypoint(o: Order, x: number, z: number, limit: number): void {
  o.x = Math.max(-limit, Math.min(limit, x));
  o.z = Math.max(-limit, Math.min(limit, z));
  o.speed = Math.min(1, Math.hypot(o.x - o.unit.x, o.z - o.unit.z) * 1.6);
  o.steer = true;
}

export function patrolCount(g: Game): number {
  let count = 0;
  for (const role of patrolRoles) count += g.enemies.countOf(patrolDefs[role].id);
  return count;
}

export class PatrolOrders {
  readonly members = new Map<Enemy, Order>();
  due = 0;
  priorLure: EnemyCtx['lure'];
  readonly lure: Lure = e => {
    const prior = this.priorLure?.(e);
    if (prior || !e.def.patrolRole) return prior ?? null;
    const o = this.members.get(e);
    return o?.uid === e.uid && o.steer ? o : null;
  };

  register(e: Enemy): Order {
    const o: Order = { unit: e, uid: e.uid, captain: null, focus: null, side: 1, x: e.x, z: e.z, radius: 0, speed: 0, steer: true };
    this.members.set(e, o);
    e.flank = 0;
    return o;
  }

  attach(o: Order, captain: Order, side: number): void {
    o.captain = captain;
    o.side = side;
    // leaderUid and slot survive rewind. Patrol orders supply their own formation steering.
    o.unit.leaderUid = captain.uid;
    o.unit.slot = side < 0 ? 1 : 2;
  }

  /** Direct dev spawns, rewind and a newly elected host can rebuild from live pooled actors. */
  reconcile(g: Game, count: number): void {
    for (const o of this.members.values()) {
      const e = o.unit;
      if (!e.active || e.uid !== o.uid || !e.def.patrolRole) this.members.delete(e);
    }
    if (this.members.size === count) return;
    for (const e of g.enemies.list) {
      if (e.active && e.def.patrolRole && !this.members.has(e)) this.register(e);
    }
    for (const o of this.members.values()) {
      const e = o.unit;
      if (e.def.patrolRole === 'hunter' || e.def.patrolRole === 'commander' || e.familyFled) continue;
      if (o.captain && this.members.get(o.captain.unit) === o.captain) continue;
      let captain: Order | null = null;
      let best = Infinity;
      for (const c of this.members.values()) {
        if (c.unit.def.patrolRole !== 'commander' || (e.leaderUid && c.uid !== e.leaderUid)) continue;
        const d = (e.x - c.unit.x) ** 2 + (e.z - c.unit.z) ** 2;
        if (d < best) { best = d; captain = c; }
      }
      if (captain) {
        let side = 1;
        // Migration omits slots. Put the first guard on the left and the second on the right.
        if (e.slot) side = e.slot === 1 ? -1 : 1;
        else if (e.def.patrolRole === 'bulwark') {
          side = -1;
          for (const m of this.members.values()) if (m.captain === captain && m.unit.def.patrolRole === 'bulwark' && m.side < 0) side = 1;
        }
        this.attach(o, captain, side);
      }
    }
  }
}

const orders = new WeakMap<Game, PatrolOrders>();
export function ordersFor(g: Game): PatrolOrders {
  let state = orders.get(g);
  if (!state) orders.set(g, state = new PatrolOrders());
  return state;
}

interface Badge { el: HTMLElement; role?: PatrolRole; x: number; y: number }
const badges = new WeakMap<Game, Badge[]>();
/** Mirror the same markings from ordinary snapshot positions. A stalking hunter's fangs
 * stay inside the viewport when its body leaves it, even with audio or sound arrows off. */
export function updatePatrolBadges(g: Game): void {
  if (g.stepN % 6) return;
  let pool = badges.get(g);
  let live = 0;
  if (g.isCombatMode && g.screens.current === 'none' && !g.photo?.active && patrolCount(g)) {
    if (!pool) badges.set(g, pool = []);
    for (const e of g.enemies.list) {
      const role = e.def.patrolRole;
      if (!e.active || !role) continue;
      const v = g.tmp.set(e.x, e.hopY + e.radius * 3.2 + 0.3, e.z).project(g.cam.camera);
      if (role === 'hunter' && e.familyState === 1) {
        // Behind a perspective camera, the projected bearing is reversed.
        if (v.z > 1) { v.x *= -1; v.y *= -1; }
        const central = Math.abs(v.x) < Math.abs(v.y) * 0.46;
        const clamp = Math.max(1, Math.abs(v.x) / 0.91, Math.abs(v.y) / (central ? 0.62 : 0.77));
        v.x /= clamp; v.y /= clamp;
      } else if (v.z > 1 || Math.abs(v.x) > 0.97 || Math.abs(v.y) > 0.94) continue;
      let badge = pool[live++];
      if (!badge) {
        const el = document.createElement('div');
        el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;line-height:0;z-index:2';
        document.getElementById('ingame')?.appendChild(el);
        pool.push(badge = { el, x: NaN, y: NaN });
      }
      if (badge.role !== role) {
        badge.role = role;
        badge.el.innerHTML = iconHtml(roleIcons[role], e.def.accentColor);
        const img = badge.el.firstElementChild as HTMLElement;
        img.style.cssText = 'width:calc(8 * var(--p));height:calc(8 * var(--p));image-rendering:pixelated';
      }
      const x = Math.round((1 + v.x) * innerWidth / 2), y = Math.round((1 - v.y) * innerHeight / 2);
      if (badge.x !== x || badge.y !== y) {
        badge.x = x; badge.y = y;
        badge.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
      }
      badge.el.hidden = false;
    }
  }
  if (pool) for (let i = live; i < pool.length; i++) pool[i].el.hidden = true;
}
