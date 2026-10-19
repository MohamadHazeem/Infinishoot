import { pushCircleOut, type AABB } from '../world/collision';

/**
 * Cell coords packed into one small integer map key. Must stay a V8 Smi (31-bit
 * signed): `(cx + 32768) << 16` overflowed into a heap number, so every bucket
 * lookup allocated. 15 bits per axis wrap after 32768 cells (65 km at 2 m).
 */
export function cellKey(cx: number, cz: number): number {
  return ((cx & 0x7fff) << 15) | (cz & 0x7fff);
}

/**
 * Uniform-grid spatial hash for dynamic circles on the XZ plane.
 * Cleared and refilled every simulation step; bucket arrays are reused so
 * steady-state operation allocates nothing.
 */
/** One hash cell. Lazily emptied: a bucket from an older generation counts as empty. */
interface Bucket<T> {
  items: T[];
  n: number;
  gen: number;
}

export class SpatialHash<T> {
  private buckets = new Map<number, Bucket<T>>();
  /** Bumped by clear(); buckets are reused, so steady state allocates nothing (`length = 0` dropped their storage). */
  private gen = 1;
  private inv: number;

  constructor(readonly cellSize = 2) {
    this.inv = 1 / cellSize;
  }

  clear(): void {
    this.gen++;
  }

  insert(item: T, x: number, z: number, r: number): void {
    const x0 = Math.floor((x - r) * this.inv);
    const x1 = Math.floor((x + r) * this.inv);
    const z0 = Math.floor((z - r) * this.inv);
    const z1 = Math.floor((z + r) * this.inv);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = cellKey(cx, cz);
        let b = this.buckets.get(k);
        if (!b) {
          b = { items: [], n: 0, gen: this.gen };
          this.buckets.set(k, b);
        } else if (b.gen !== this.gen) {
          b.gen = this.gen;
          b.n = 0;
        }
        b.items[b.n++] = item;
      }
    }
  }

  /**
   * Calls `fn` for every item in cells overlapping the query circle. Items
   * spanning several cells may be visited more than once; callers that care
   * should dedupe (e.g. with a per-step stamp).
   */
  query(x: number, z: number, r: number, fn: (item: T) => void): void {
    const x0 = Math.floor((x - r) * this.inv);
    const x1 = Math.floor((x + r) * this.inv);
    const z0 = Math.floor((z - r) * this.inv);
    const z1 = Math.floor((z + r) * this.inv);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const b = this.buckets.get(cellKey(cx, cz));
        if (b && b.gen === this.gen) for (let i = 0; i < b.n; i++) fn(b.items[i]);
      }
    }
  }

  /**
   * Like `query` without a callback (no closure per call in hot loops): fills
   * `out` with the items of the overlapped cells, duplicates included, and
   * returns how many it wrote. `out` keeps its length; read `out[0..n)`.
   */
  queryInto(x: number, z: number, r: number, out: T[]): number {
    const x0 = Math.floor((x - r) * this.inv);
    const x1 = Math.floor((x + r) * this.inv);
    const z0 = Math.floor((z - r) * this.inv);
    const z1 = Math.floor((z + r) * this.inv);
    let n = 0;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const b = this.buckets.get(cellKey(cx, cz));
        if (b && b.gen === this.gen) for (let i = 0; i < b.n; i++) out[n++] = b.items[i];
      }
    }
    return n;
  }
}

/** Static grid of wall boxes for fast point/circle queries (bullets). Built once per arena. */
export class StaticBoxGrid {
  private cells = new Map<number, AABB[]>();
  private inv: number;

  constructor(
    readonly boxes: AABB[],
    readonly cellSize = 4,
  ) {
    this.inv = 1 / cellSize;
    for (const b of boxes) {
      for (let cx = Math.floor(b.minX * this.inv); cx <= Math.floor(b.maxX * this.inv); cx++) {
        for (let cz = Math.floor(b.minZ * this.inv); cz <= Math.floor(b.maxZ * this.inv); cz++) {
          const k = cellKey(cx, cz);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(b);
        }
      }
    }
  }

  /** True if the circle overlaps any box. */
  hitCircle(x: number, z: number, r: number): boolean {
    // Every cell the circle's bounds touch, so big circles near a cell edge still see their neighbours' boxes.
    for (let gx = Math.floor((x - r) * this.inv); gx <= Math.floor((x + r) * this.inv); gx++) {
      for (let gz = Math.floor((z - r) * this.inv); gz <= Math.floor((z + r) * this.inv); gz++) {
        const list = this.cells.get(cellKey(gx, gz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          const cx = Math.max(b.minX, Math.min(x, b.maxX));
          const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
          if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
        }
      }
    }
    return false;
  }

  private near: AABB[] = [];

  /**
   * Push a circle out of the boxes near it (same result as resolveCircleVsBoxes
   * over the whole list, but only looks at the cells the circle touches).
   * Mutates `pos`; returns true if it touched a box.
   */
  resolveCircle(pos: { x: number; z: number }, r: number): boolean {
    let hit = false;
    const near = this.near;
    for (let iter = 0; iter < 2; iter++) {
      let n = 0;
      for (let gx = Math.floor((pos.x - r) * this.inv); gx <= Math.floor((pos.x + r) * this.inv); gx++) {
        for (let gz = Math.floor((pos.z - r) * this.inv); gz <= Math.floor((pos.z + r) * this.inv); gz++) {
          const list = this.cells.get(cellKey(gx, gz));
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const b = list[i];
            let dup = false;
            for (let j = 0; j < n; j++) if (near[j] === b) dup = true;
            if (!dup) near[n++] = b;
          }
        }
      }
      if (n === 0) break;
      if (pushCircleOut(pos, r, near, n)) hit = true;
    }
    return hit;
  }
}
