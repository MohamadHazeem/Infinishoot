import { WEAPONS } from '../data/weapons';
import {
  asymRoleTuning as T,
  packStations,
  squadStations,
  stationAt,
  stationIndex,
  stations,
  validRoles,
  type Station,
} from '../data/asymRoles';
import { Drones } from './weapons/drones';
import { Iaido } from './weapons/iaido';
import { Pellets } from './weapons/pellets';
import type { WeaponCtx } from './weapons/base';
import type { Enemy } from './enemies';
import type { Game } from './game';
import type { Hero } from './hero';
import { startMech } from './systems/gameplay';

/** Use the existing instanced drone weapon with its orbit centred on the commanded point.
 * All other WeaponCtx services, including damage ownership, still belong to the real hero. */
class Formation {
  x: number;
  z: number;
  readonly weapon: Drones;
  readonly ctx: WeaponCtx;
  constructor(readonly hero: Hero) {
    this.x = hero.player.x;
    this.z = hero.player.z;
    this.weapon = new Drones(WEAPONS.drones, hero.ctx.scene);
    this.weapon.level = 3;
    const anchor = this;
    const center = {
      get x() {
        return anchor.x;
      },
      get z() {
        return anchor.z;
      },
      get dead() {
        return hero.player.dead || hero.left;
      },
      rig: { root: { position: anchor } },
    };
    this.ctx = Object.create(hero.ctx, { player: { value: center } });
  }

  private lock: Enemy | undefined;
  private nextLock = 0;

  step(g: Game, dt: number, send: boolean): void {
    const p = this.hero.player;
    let range = send ? p.landDist(0, T.rallyRange) : 0;
    // A stick supplies direction only. Acquire range along that ray at 10 Hz.
    if (send && !Number.isFinite(p.aimDist) && g.runTime >= this.nextLock) {
      this.lock = markTarget(g, this.hero);
      this.nextLock = g.runTime + 0.1;
    }
    if (send && !Number.isFinite(p.aimDist) && this.lock?.targetable) {
      range = Math.min(range, Math.hypot(this.lock.x - p.x, this.lock.z - p.z));
    }
    // Put the front of the orbit through the cursor, so a small target inside the ring can be hit.
    if (send) range = Math.max(0, range - this.weapon.p.radius * this.hero.stats.areaMul);
    const dx = p.x + p.aim.x * range - this.x,
      dz = p.z + p.aim.z * range - this.z;
    const fraction = Math.min(1, (T.droneSpeed * dt) / (Math.hypot(dx, dz) || 1));
    this.x += dx * fraction;
    this.z += dz * fraction;
    this.weapon.update(dt, this.ctx);
  }
}

const sq = (n: number) => n * n;
function markTarget(g: Game, h: Hero): Enemy | undefined {
  const p = h.player;
  let best: Enemy | undefined,
    score = Infinity;
  const cursor = Number.isFinite(p.aimDist);
  const reach = p.landDist(0, T.markRange);
  for (const e of g.enemies.list) {
    if (!e.targetable || e.pvpOwner >= 0) continue;
    const dx = e.x - p.x,
      dz = e.z - p.z;
    const along = dx * p.aim.x + dz * p.aim.z;
    if (along <= 0 || along > T.markRange) continue;
    const cross = Math.abs(dx * p.aim.z - dz * p.aim.x);
    if (cross > e.radius + 1.4) continue;
    const cost = cursor ? sq(along - reach) + sq(cross) : along + 3 * cross;
    if (cost < score) {
      score = cost;
      best = e;
    }
  }
  return best;
}

/** The trail leads the whole team to a point without activating or collecting the secret. */
function trace(g: Game, h: Hero, to: { x: number; z: number }, color: string): void {
  const p = h.player;
  for (let i = 1; i <= 3; i++)
    g.vfx.ring(p.x + ((to.x - p.x) * i) / 4, p.z + ((to.z - p.z) * i) / 4, 0.18, 0.48, color, 0.8);
  g.vfx.star(to.x, 2.4, to.z, 1.5, color, 0.9);
}

function scan(g: Game, h: Hero): void {
  const p = h.player;
  const target = markTarget(g, h);
  if (target) g.expose(target);
  let closest: Enemy | undefined,
    distance = sq(T.revealRange);
  for (const e of g.enemies.list) {
    if (!e.elite || !e.targetable) continue;
    const d = sq(e.x - p.x) + sq(e.z - p.z);
    if (d < distance) {
      distance = d;
      closest = e;
    }
  }
  g.vfx.ring(p.x, p.z, 0.3, 3.2, '#73eff7', 0.4);
  if (closest) trace(g, h, closest, '#73eff7');
  const room = g.biomeRules.room;
  if (room?.phase === 'sealed' && sq(room.x - p.x) + sq(room.z - p.z) <= sq(T.revealRange))
    trace(g, h, room, '#ffcd75');
}

export class AsymRoles {
  squadMode = false;
  squadPick: Station = 'gunner';
  readonly couchPicks = new Map<number, Station>();
  lobbyMode = false;
  guestPick: Station = 'gunner';
  lobbyWord = 0;
  word = 0;
  // Slots survive peer reclaims and host promotion. A new run always clears them.
  readonly readyAt = new Float64Array(8);
  private readonly turrets: (Pellets | undefined)[] = [];
  private readonly drones: (Formation | undefined)[] = [];
  private packet: number[] = [];
  private packetStep = -1;

  reset(): void {
    this.word = 0;
    this.readyAt.fill(0);
    this.turrets.length = 0;
    for (const formation of this.drones) formation?.weapon.dispose();
    this.drones.length = 0;
    this.packetStep = -1;
    this.packet = [];
  }

  start(g: Game): void {
    this.reset();
    if (g.heroes.length < 2 || g.pvp) return;
    if (g.squadRun && this.squadMode) this.word = packStations(squadStations(this.squadPick));
    if (g.localCoop && g.runMode === 'standard') {
      const picks = g.localCoop.slots.map((s) => this.couchPicks.get(s.pad) ?? 'gunner');
      if (picks.some((r) => r !== 'gunner')) this.word = packStations(picks);
    }
    if (g.role === 'host' && g.lobbyKind === 'coop') this.word = this.room(g);
  }

  room(g: Game): number {
    return this.lobbyMode && g.lobbyKind === 'coop'
      ? packStations(g.lobby.map((e) => e.station ?? 'gunner'))
      : 0;
  }

  pick(g: Game, from: string, pick: unknown): void {
    if (
      !this.lobbyMode ||
      g.lobbyKind !== 'coop' ||
      g.mode !== 'title' ||
      !stations.includes(pick as Station)
    )
      return;
    const seat = g.lobby.find((e) => e.peerId === from);
    if (!seat || seat.station === pick) return;
    seat.station = stations[stationIndex(pick)];
    g.refreshLobby();
  }

  private formation(h: Hero): Formation {
    let f = this.drones[h.index];
    if (f?.hero !== h) {
      f?.weapon.dispose();
      this.drones[h.index] = f = new Formation(h);
    }
    return f;
  }

  /** Apply once after refreshLive. Movement on the guest uses the regular host stat snapshot. */
  stats(h: Hero): void {
    if (stationAt(this.word, h.index) === 'scout') {
      h.stats.moveSpeedMul *= T.scoutSpeed;
      h.stats.reviveSpeed += T.reviveSpeed;
    }
  }

  /** The director's spawn options are also used by bosses and Titan parts.
   * Support-only crews get a little less life to cut through. Never increase a threat's damage or speed. */
  enemyHealth(g: Game): number {
    let support = false;
    for (const h of g.heroes) {
      if (h.left || h.player.dead) continue;
      const r = stationAt(this.word, h.index);
      if (r === 'pilot') return 1;
      if (r !== 'gunner') support = true;
    }
    return support ? T.supportHp : 1;
  }

  step(g: Game, dt: number): void {
    if (!this.word || !g.authority || !g.isCombatMode || g.modes.holster) return;
    for (const h of g.heroes) {
      if (h.left || h.player.dead) continue;
      const i = h.index,
        r = stationAt(this.word, i);
      if (r === 'gunner' || h.play.mechT > 0) continue;
      const squadBot = g.squadRun && i > 0;
      if (r === 'pilot') {
        if (h.ctx.charging && g.runTime >= this.readyAt[i]) {
          startMech(g, h);
          this.readyAt[i] = g.runTime + T.pilotCycle;
        } else if (h.ctx.firing && !h.play.superW) {
          const turret = (this.turrets[i] ??= new Pellets(WEAPONS.pellets));
          turret.level = Math.min(WEAPONS.pellets.levels.length, g.stage + 1);
          turret.update(dt, h.ctx);
        }
      } else if (r === 'scout') {
        if ((h.ctx.charging || squadBot) && g.runTime >= this.readyAt[i]) {
          scan(g, h);
          this.readyAt[i] = g.runTime + T.scanEvery;
        }
      } else {
        // The squad brain pulses secondary to charge a gun. Its aim target is the
        // commander's rally order. With no target the formation guards its owner.
        this.formation(h).step(g, dt, h.ctx.firing && (squadBot || !h.ctx.charging));
      }
    }
  }

  /** Remote Ronin normally predicts a charged dash locally before the host sees release. */
  clientInput(h: Hero): void {
    if (h.heroDef.mech !== 'ronin' || !this.replaces(h, 'secondary')) return;
    for (const w of h.weapons) if (w instanceof Iaido) w.predFocus = 0;
  }

  replaces(h: Hero, slot?: string): boolean {
    if (!slot || !this.word) return false;
    const role = stationAt(this.word, h.index);
    return role === 'pilot' || role === 'commander' || (role === 'scout' && slot === 'secondary');
  }

  /** Full compact team state is included in each delta baseline for drop-in and migration.
   * Rows follow the seat mask. Only a Commander costs coordinates and an orbit phase. */
  snapshot(g: Game): number[] | undefined {
    if (!this.word) return;
    if (g.stepN === this.packetStep) return this.packet;
    this.packetStep = g.stepN;
    const packet = [this.word];
    for (const h of g.heroes) {
      const r = stationAt(this.word, h.index);
      if (r === 'commander') {
        const f = this.drones[h.index];
        packet.push(
          Math.round((f?.x ?? h.player.x) * 10),
          Math.round((f?.z ?? h.player.z) * 10),
          Math.round(((f?.weapon.net()[0] ?? 0) % (2 * Math.PI)) * 100),
        );
      } else if (r !== 'gunner')
        packet.push(Math.ceil(Math.max(0, this.readyAt[h.index] - g.runTime)));
    }
    return (this.packet = packet);
  }

  mirror(g: Game, data: unknown): void {
    const word = Array.isArray(data) ? validRoles(data[0]) : 0;
    if (word !== this.word) this.reset();
    if (!word || !Array.isArray(data)) return;
    this.word = word;
    let k = 1;
    for (const h of g.heroes) {
      const r = stationAt(word, h.index);
      if (r === 'commander') {
        const x = data[k++],
          z = data[k++],
          angle = data[k++];
        if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(angle)) continue;
        const f = this.formation(h);
        f.x = x / 10;
        f.z = z / 10;
        f.weapon.setNet([angle / 100, h.stats.areaMul]);
      } else if (r !== 'gunner') {
        const seconds = data[k++];
        if (Number.isFinite(seconds))
          this.readyAt[h.index] = g.runTime + Math.min(T.pilotCycle, Math.max(0, seconds));
      }
    }
  }

  render(): void {
    for (const f of this.drones) if (f) f.weapon.render(1, f.ctx);
  }
}
