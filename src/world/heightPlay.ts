import type { Game } from '../game/game';
import type { Hero } from '../game/hero';
import type { Enemy } from '../game/enemies';
import { DECK, along, underpass } from './height';
import { arenaTuning } from '../game/interactives';
import { segDist2 } from '../game/teamMoves';

export function moveHero(
  g: Game,
  h: Hero,
  dt: number,
  advance: (this: Game, h: Hero, dt: number) => void,
) {
  const field = g.arena.heights;
  const p = h.player;
  const teammate = h !== g.hero && !h.remote && g.authority && !!(g.localCoop || g.squadRun);
  if (teammate && !p.dead && !g.toys.jumps[h.index] && (g.toys.padCd[h.index] ?? 0) <= 0 && field) {
    for (let i = 0; i < g.toys.pads.length; i++) {
      const pad = g.toys.pads[i];
      if ((p.x - pad.x) ** 2 + (p.z - pad.z) ** 2 < arenaTuning.padRadius ** 2) {
        g.startJump(h, i);
        break;
      }
    }
  }
  const jump = g.toys.jumps[h.index];
  advance.call(g, h, dt);
  if (!field) {
    h.floorY = 0;
    return;
  }
  const flight = g.toys.jumps[h.index] ?? jump;
  if (flight) {
    const k = Math.min(1, flight.t / arenaTuning.jumpTime);
    if (teammate) {
      p.pos.x = flight.fx + (flight.tx - flight.fx) * k;
      p.pos.z = flight.fz + (flight.tz - flight.fz) * k;
    }
    const from = field.floor(flight.fx, flight.fz),
      to = field.floor(flight.tx, flight.tz, true);
    h.floorY = from + (to - from) * k;
  } else {
    h.floorY = field.move(p.pos, p.prev.x, p.prev.z, h.floorY);
  }
}

export function heightDamageBlocked(
  g: Game,
  h: Hero,
  x: number,
  z: number,
  src: Enemy | null,
  cause: string,
) {
  if (src && !cause) return Math.abs(src.floorY - h.floorY) > 1.1;
  return (
    cause === 'Enemy fire' &&
    !!g.arena.heights?.site(h.player.x, h.player.z) &&
    g.bullets.separated(h, x, z)
  );
}

/** Only bridge cells have an ambiguous floor. Everything else is reconstructed from the shared seed. */
function ambiguous(g: Game, x: number, z: number) {
  const s = g.arena.heights?.site(x, z);
  return !!s && underpass(s, along(s, x, z));
}

type Floors = [number[], number[], number[]];
export function packFloors(g: Game, x: number, z: number, r: number): Floors | undefined {
  if (!g.arena.heights) return;
  let floors: Floors | undefined;
  for (const h of g.heroes) {
    if (ambiguous(g, h.player.x, h.player.z) || g.toys.jumps[h.index])
      (floors ??= [[], [], []])[0].push(h.index, Math.round(h.floorY * 100));
  }
  for (const e of g.enemies.list)
    if (
      e.active &&
      e.floorY > 1 &&
      Math.abs(e.x - x) < r &&
      Math.abs(e.z - z) < r &&
      ambiguous(g, e.x, e.z)
    )
      (floors ??= [[], [], []])[1].push(e.uid);
  const b = g.bullets;
  for (let i = 0; i < b.count; i++)
    if (
      b.floorY[i] > 1 &&
      Math.abs(b.x[i] - x) < r &&
      Math.abs(b.z[i] - z) < r &&
      ambiguous(g, b.x[i], b.z[i])
    )
      (floors ??= [[], [], []])[2].push(b.uid[i]);
  return floors;
}

export function readFloors(g: Game, wire: unknown) {
  const field = g.arena.heights;
  if (!field) return;
  const floors =
    Array.isArray(wire) && wire.length === 3 && wire.every(Array.isArray)
      ? (wire as Floors)
      : undefined;
  for (const h of g.heroes) {
    // This machine predicts its own movement. A reconnect starts from the host's floor.
    const p = h.player;
    if (h !== g.hero || !ambiguous(g, p.x, p.z)) h.floorY = field.floor(p.x, p.z);
  }
  if (floors)
    for (let i = 0; i < floors[0].length; i += 2) {
      const h = g.heroes[floors[0][i]];
      const y = floors[0][i + 1] / 100;
      if (h && y >= 0 && y <= DECK && (h !== g.hero || ambiguous(g, h.player.x, h.player.z)))
        h.floorY = y;
    }
  for (const [uid, e] of g.netEnemies)
    e.floorY = field.floor(e.x, e.z, !!floors?.[1].includes(uid));
  const b = g.bullets;
  for (let i = 0; i < b.count; i++)
    b.floorY[i] = field.floor(b.x[i], b.z[i], !!floors?.[2].includes(b.uid[i]));
}

export function heightLink(g: Game, q: URLSearchParams) {
  const s = g.arena.heights?.sites[0];
  if (!s || !q.has('height')) return;
  const u = q.get('height') === 'under' ? 1 : q.get('height') === 'deck' ? 3.8 : -6;
  g.player.teleport(s.x + (s.cross ? 0 : u), s.z + (s.cross ? u : 0));
  g.hero.floorY = u > 3 ? DECK : 0;
}

/** Both bot pilots, boss escape checks and allies already query the wall grid for a clear path.
 * Annotate each new stage/destructible-cover grid when installed, leaving its broad phase intact. */
export function terrainSight(g: Game, walls: import('../core/spatialHash').StaticBoxGrid) {
  const field = g.arena?.heights;
  if (!field) return walls;
  const clear = walls.segmentClear;
  walls.segmentClear = function (x, z, tx, tz, pad = 0, fromFloor?: number) {
    if (!clear.call(this, x, z, tx, tz, pad)) return false;
    if (fromFloor !== undefined) return field.clear(x, z, fromFloor, tx, tz, false);
    const p = g.heroes?.length ? g.player : undefined;
    const walking = !!p && Math.abs(p.x - x) < 0.4 && Math.abs(p.z - z) < 0.4;
    return field.clear(x, z, walking ? g.hero.floorY : field.floor(x, z), tx, tz, walking);
  };
  return walls;
}

export function portalFloor(g: Game, px: number, pz: number, proposal: { x: number; z: number }) {
  const f = g.arena.heights;
  if (!f) return proposal;
  const hero = g.heroes.find((h) => h.player.x === px && h.player.z === pz);
  const jump = hero && g.toys.jumps[hero.index];
  const deckLanding =
    jump && f.site(jump.tx, jump.tz)?.bridge && f.floor(jump.tx, jump.tz, true) === DECK;
  // A portal can open in mid-flight. The first point where the hero can steer is the landing.
  if (jump && deckLanding) {
    px = jump.tx;
    pz = jump.tz;
  }
  const y = deckLanding ? DECK : (hero?.floorY ?? f.floor(px, pz));
  const reachable = (x: number, z: number) =>
    f.floor(x, z) < 0.1 &&
    f.clear(px, pz, y, x, z, true) &&
    g.walls.segmentClear(px, pz, x, z, 0.4) &&
    !g.walls.hitCircle(x, z, 1.8) &&
    (!deckLanding ||
      g.toys.pads.every(
        (p) => segDist2(p.x, p.z, px, pz, x, z) > (arenaTuning.padRadius + 0.4) ** 2,
      ));
  if (reachable(proposal.x, proposal.z)) return proposal;
  for (const r of [6, 4, 8, 2.5])
    for (let i = 0; i < 16; i++) {
      const x = px + r * Math.cos((i * Math.PI) / 8),
        z = pz + r * Math.sin((i * Math.PI) / 8);
      if (Math.max(Math.abs(x), Math.abs(z)) <= g.arena.halfSize - 4 && reachable(x, z))
        return { x, z };
    }
  return { x: px, z: pz };
}
