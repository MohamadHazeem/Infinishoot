/** Axis-aligned box on the XZ plane. Gameplay is 2D; Y is presentation only. */
export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** A gap in the ground (Sky Fortress): blocks walking but bullets fly over it. */
  gap?: boolean;
}

export function aabbFromCenter(x: number, z: number, w: number, d: number): AABB {
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
}

/**
 * Push a circle out of every overlapping box. Mutates `pos`.
 * Brute force over the whole list; hot paths use `StaticBoxGrid.resolveCircle`.
 */
export function resolveCircleVsBoxes(pos: { x: number; z: number }, r: number, boxes: AABB[]): boolean {
  let hit = false;
  for (let iter = 0; iter < 2; iter++) if (pushCircleOut(pos, r, boxes, boxes.length)) hit = true;
  return hit;
}

/** One pass of the circle push-out over `boxes[0..n)`. Mutates `pos`; true if any box overlapped. */
export function pushCircleOut(pos: { x: number; z: number }, r: number, boxes: AABB[], n: number): boolean {
  let hit = false;
  let x = pos.x;
  let z = pos.z;
  for (let i = 0; i < n; i++) {
    const b = boxes[i];
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - cx;
    const dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    hit = true;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      x = cx + (dx / d) * r;
      z = cz + (dz / d) * r;
    } else {
      // Centre inside the box: push out along the shallowest axis.
      const left = x - b.minX;
      const right = b.maxX - x;
      const top = z - b.minZ;
      const bottom = b.maxZ - z;
      const m = Math.min(left, right, top, bottom);
      if (m === left) x = b.minX - r;
      else if (m === right) x = b.maxX + r;
      else if (m === top) z = b.minZ - r;
      else z = b.maxZ + r;
    }
  }
  if (hit) {
    pos.x = x;
    pos.z = z;
  }
  return hit;
}

export function overlapsAny(box: AABB, boxes: AABB[], pad = 0): boolean {
  return boxes.some(
    (b) =>
      box.minX - pad < b.maxX && box.maxX + pad > b.minX && box.minZ - pad < b.maxZ && box.maxZ + pad > b.minZ,
  );
}
