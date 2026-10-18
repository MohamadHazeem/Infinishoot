import type { AABB } from '../world/collision';

/**
 * Uniform-grid spatial hash for dynamic circles on the XZ plane.
 * Cleared and refilled every simulation step; bucket arrays are reused so
 * steady-state operation allocates nothing.
 */
export class SpatialHash<T> {
  private buckets = new Map<number, T[]>();
  private used: T[][] = [];
  private inv: number;

  constructor(readonly cellSize = 2) {
    this.inv = 1 / cellSize;
  }

  private key(cx: number, cz: number): number {
    // Pack two signed 16-bit cell coords into one number.
    return ((cx + 32768) << 16) | (cz + 32768);
  }

  clear(): void {
    for (const b of this.used) b.length = 0;
    this.used.length = 0;
  }

  insert(item: T, x: number, z: number, r: number): void {
    const x0 = Math.floor((x - r) * this.inv);
    const x1 = Math.floor((x + r) * this.inv);
    const z0 = Math.floor((z - r) * this.inv);
    const z1 = Math.floor((z + r) * this.inv);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let b = this.buckets.get(k);
        if (!b) {
          b = [];
          this.buckets.set(k, b);
        }
        if (b.length === 0) this.used.push(b);
        b.push(item);
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
        const b = this.buckets.get(this.key(cx, cz));
        if (b) for (let i = 0; i < b.length; i++) fn(b[i]);
      }
    }
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
          const k = ((cx + 32768) << 16) | (cz + 32768);
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
        const list = this.cells.get(((gx + 32768) << 16) | (gz + 32768));
        if (!list) continue;
        for (const b of list) {
          const cx = Math.max(b.minX, Math.min(x, b.maxX));
          const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
          if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
        }
      }
    }
    return false;
  }
}
