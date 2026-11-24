import { Rng } from '../core/rng';
import { aabbFromCenter, overlapsAny, type AABB } from './collision';

export const DECK = 2.4;
export const heightTuning = { sight: 1.15, damage: 1.06 };
export interface HeightSite {
  x: number;
  z: number;
  cross: boolean;
  bridge: boolean;
}
interface Point {
  x: number;
  z: number;
}
export const along = (s: HeightSite, x: number, z: number) => (s.cross ? z - s.z : x - s.x);
export const across = (s: HeightSite, x: number, z: number) => (s.cross ? x - s.x : z - s.z);
export const siteX = (s: HeightSite, u: number, v = 0) => s.x + (s.cross ? v : u);
export const siteZ = (s: HeightSite, u: number, v = 0) => s.z + (s.cross ? u : v);
export const underpass = (s: HeightSite, u: number) => s.bridge && u >= -1 && u < 3;
const top = (u: number) => Math.min(DECK, Math.max(0, (u + 5) * (DECK / 4)));

/** One-metre cells. A bridge cell admits both floor 0 and floor DECK. A ramp has one continuous floor. */
export class HeightField {
  private readonly half: number;
  private readonly width: number;
  private readonly grid: Uint8Array;
  constructor(
    readonly sites: HeightSite[],
    half = 55,
  ) {
    this.half = Math.ceil(half);
    this.width = this.half * 2;
    this.grid = new Uint8Array(this.width * this.width);
    sites.forEach((s, i) => {
      for (let u = -5; u < 5; u++)
        for (let v = -2; v < 2; v++) this.grid[this.cell(siteX(s, u, v), siteZ(s, u, v))] = i + 1;
    });
  }

  private cell(x: number, z: number) {
    return (Math.floor(z) + this.half) * this.width + Math.floor(x) + this.half;
  }

  site(x: number, z: number): HeightSite | undefined {
    if (Math.abs(x) >= this.half || Math.abs(z) >= this.half) return;
    const id = this.grid[this.cell(x, z)];
    return id ? this.sites[id - 1] : undefined;
  }

  /** Quarter-metre tiles for bridge grating. Four sites need only 2,560 entries. */
  grateCell(x: number, z: number) {
    const s = this.site(x, z);
    if (!s?.bridge) return -1;
    const u = along(s, x, z);
    if (!underpass(s, u)) return -1;
    return (
      (this.grid[this.cell(x, z)] - 1) * 640 +
      Math.floor((u + 5) * 4) * 16 +
      Math.floor((across(s, x, z) + 2) * 4)
    );
  }

  floor(x: number, z: number, upper = false) {
    const s = this.site(x, z);
    if (!s) return 0;
    const u = along(s, x, z);
    return !upper && underpass(s, u) ? 0 : top(u);
  }

  /** Negative means a wall. Only the far end of the deck is a marked drop. */
  private transition(px: number, pz: number, y: number, x: number, z: number) {
    const from = this.site(px, pz),
      to = this.site(x, z);
    if (!from && !to) return 0;
    if (to === from && to) {
      const u = along(to, x, z);
      if (y < 0.01 && underpass(to, along(to, px, pz))) return underpass(to, u) ? 0 : -1;
      return top(u);
    }
    if (from && y > 0.4 && along(from, x, z) < 5) return -1;
    if (!to) return 0;
    const next = this.floor(x, z);
    return next <= 0.4 ? next : -1;
  }

  /** Sweep in small steps even for dashes and remote interpolation. Slide along a rejected axis. */
  move(p: Point, px: number, pz: number, y: number) {
    const dx = p.x - px,
      dz = p.z - pz;
    const span = Math.max(Math.abs(dx), Math.abs(dz));
    if (span > 6) return this.floor(p.x, p.z); // respawn, rewind or deliberate teleport
    if (span < 0.5 && !this.site(p.x, p.z) && !this.site(px, pz)) return 0;
    const n = Math.max(1, Math.ceil(span * 2));
    for (let i = 0; i < n; i++) {
      const nx = px + dx / n,
        nz = pz + dz / n;
      let next = this.transition(px, pz, y, nx, pz);
      if (next >= 0) {
        px = nx;
        y = next;
      }
      next = this.transition(px, pz, y, px, nz);
      if (next >= 0) {
        pz = nz;
        y = next;
      }
    }
    p.x = px;
    p.z = pz;
    return y;
  }

  /** Query a straight walk or sight line without moving an entity. Most rays miss every feature. */
  clear(px: number, pz: number, y: number, x: number, z: number, walking: boolean) {
    return this.trace(px, pz, y, x, z, walking) >= 0;
  }

  trace(px: number, pz: number, y: number, x: number, z: number, walking: boolean) {
    const dx = x - px,
      dz = z - pz;
    const minX = Math.min(px, x),
      maxX = Math.max(px, x),
      minZ = Math.min(pz, z),
      maxZ = Math.max(pz, z);
    let near = false;
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i],
        w = s.cross ? 2 : 5,
        d = s.cross ? 5 : 2;
      if (maxX >= s.x - w && minX <= s.x + w && maxZ >= s.z - d && minZ <= s.z + d) {
        near = true;
        break;
      }
    }
    if (!near) return 0;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) * 2));
    for (let i = 0; i < n; i++) {
      const nx = px + dx / n,
        nz = pz + dz / n;
      y = walking ? this.transition(px, pz, y, nx, nz) : this.shot(px, pz, y, nx, nz);
      if (y < 0) return -1;
      px = nx;
      pz = nz;
    }
    return y;
  }

  /** Shots follow open ramps and drop off exposed edges. A solid uphill face absorbs the shot. */
  shot(px: number, pz: number, y: number, x: number, z: number) {
    const to = this.site(x, z);
    if (!to) return 0;
    const from = this.site(px, pz);
    const next = this.floor(x, z, y > DECK * 0.5);
    if (from === to && y > 0 && along(to, px, pz) < -1) return next;
    return next > y + 0.65 ? -1 : next;
  }

  /** End distance and floor of each part of a shot or charge warning, including its first solid wall. */
  telegraphBands(
    x: number,
    z: number,
    dx: number,
    dz: number,
    y: number,
    length: number,
    walking: boolean,
    out: Float32Array,
  ) {
    let count = 0,
      px = x,
      pz = z,
      distance = 0;
    while (distance < length) {
      const nextDistance = Math.min(distance + 0.25, length);
      const nx = x + dx * nextDistance,
        nz = z + dz * nextDistance;
      const next = walking ? this.transition(px, pz, y, nx, nz) : this.shot(px, pz, y, nx, nz);
      if (Math.abs(next - y) > 0.001) {
        out[count++] = (distance + nextDistance) * 0.5;
        out[count++] = y;
        if (next < 0) return count;
      }
      y = next;
      px = nx;
      pz = nz;
      distance = nextDistance;
    }
    out[count++] = length;
    out[count++] = y;
    return count;
  }
}

/** Place after the old layout, using its reservations and a separate random stream. */
export function planHeights(seed: number, half: number, reserved: AABB[]) {
  const rng = new Rng(seed ^ 0x76524d50);
  const sites: HeightSite[] = [];
  const limit = half - 8,
    count = rng.int(2, 4);
  const occupied = reserved.slice();
  occupied.push(aabbFromCenter(0, 0, 18, 18));
  for (let i = 0; i < count; i++) {
    const cross = rng.chance(0.5);
    const reserve = (x: number, z: number) => {
      if (x * x + z * z < 24 * 24) return false;
      // Keep a kiting lane between neighbouring structures, even when their narrow sides face.
      if (sites.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 16 * 16)) return false;
      // One square of approach space for the ramp, landing lip and lower passage.
      const box = aabbFromCenter(
        x + (cross ? 0 : 1.5),
        z + (cross ? 1.5 : 0),
        cross ? 5 : 16,
        cross ? 16 : 5,
      );
      if (overlapsAny(box, occupied, 0.35)) return false;
      occupied.push(box);
      sites.push({ x, z, cross, bridge: i % 2 === 0 });
      return true;
    };
    let found = false;
    for (let k = 0; k < 256 && !found; k++) {
      const r = k < 80 ? Math.min(limit, 25 + 4 * i) : limit;
      found = reserve(rng.int(-r, r), rng.int(-r, r));
    }
    for (let z = -limit; z <= limit && !found; z++)
      for (let x = -limit; x <= limit && !found; x++) found = reserve(x, z);
  }
  return new HeightField(sites, half);
}

/** Follow an approach around the retaining wall, then turn onto the ramp once aligned. */
export function rampWaypoint(s: HeightSite, x: number, z: number, floor: number, out: Point) {
  const u = along(s, x, z),
    v = across(s, x, z);
  let nextU = 3.8,
    nextV = 0;
  if (floor < 0.1 && !(u < -4.6 && Math.abs(v) < 1.35)) {
    nextU = -5.7;
    if (u >= -5.3) {
      nextV = v < 0 ? -3.1 : 3.1;
      if (Math.abs(v) < 2.65) nextU = u;
    }
  }
  out.x = siteX(s, nextU, nextV);
  out.z = siteZ(s, nextU, nextV);
}
