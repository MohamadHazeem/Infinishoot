import * as THREE from 'three';

/**
 * Bullet silhouettes for evolved shots, so an evolution changes the shape of
 * what flies and not just its colour. 0 is the default gem. The shape travels
 * to online clients in the bullet record (bits 1-3 of the team byte).
 */
export const BulletShape = { Gem: 0, Star: 1, Flame: 2, Bolt: 3, Lance: 4 } as const;
export type BulletShape = (typeof BulletShape)[keyof typeof BulletShape];
export const SHAPE_COUNT = 5;

/**
 * Player bullet kind (BULLET_KINDS in game.ts) -> shape: Dragon's Breath,
 * Flare Buster and Scorch Turret spit flames; Flak Cannon and Star Cannon fire
 * spinning stars; Volt Buster crackles as a zig-zag bolt; Lance Shot is a spear.
 */
export const KIND_SHAPE: Record<number, BulletShape> = {
  3: BulletShape.Flame,
  5: BulletShape.Star,
  6: BulletShape.Flame,
  7: BulletShape.Bolt,
  8: BulletShape.Star,
  9: BulletShape.Lance,
  11: BulletShape.Flame,
};

/** Flat outline in the XZ plane (x, z pairs, +Z forward), filled. */
function flat(points: [number, number][]): THREE.BufferGeometry {
  const s = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  // ShapeGeometry lies in XY; turn it flat with +Y (shape) -> +Z (forward).
  return new THREE.ShapeGeometry(s).rotateX(Math.PI / 2);
}

/** Geometry for a shape, sized like the gem (about 1 unit across, 1 long along +Z). */
export function shapeGeometry(shape: BulletShape, halo = false): THREE.BufferGeometry {
  const k = halo ? 2 : 1;
  switch (shape) {
    case BulletShape.Star: {
      // Five-point star; spins as it flies (drawn round, ignoring the bullet's length).
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const r = (i % 2 ? 0.24 : 0.6) * k;
        pts.push([Math.sin(a) * r, Math.cos(a) * r]);
      }
      return flat(pts);
    }
    case BulletShape.Flame: {
      // A fat head at the front and a flickering tail streaming back.
      const head = new THREE.SphereGeometry(0.42 * k, 8, 6)
        .scale(1, 0.8, 1)
        .translate(0, 0, 0.12 * k);
      const tail = new THREE.ConeGeometry(0.38 * k, 0.9 * k, 7)
        .rotateX(-Math.PI / 2)
        .translate(0, 0, -0.38 * k);
      const g = mergeTwo(head, tail);
      return g;
    }
    case BulletShape.Bolt: {
      // Zig-zag lightning bolt along +Z.
      const w = 0.32 * k;
      return flat([
        [0.05 * k, 0.55 * k],
        [-w, 0.08 * k],
        [-0.02 * k, 0.12 * k],
        [-0.18 * k, -0.55 * k],
        [w, 0.0],
        [0.02 * k, -0.05 * k],
      ]);
    }
    case BulletShape.Lance: {
      // A spear: barbed arrowhead in front of a thin shaft.
      return flat([
        [0, 0.5 * k],
        [0.3 * k, 0.18 * k],
        [0.1 * k, 0.22 * k],
        [0.08 * k, -0.5 * k],
        [-0.08 * k, -0.5 * k],
        [-0.1 * k, 0.22 * k],
        [-0.3 * k, 0.18 * k],
      ]);
    }
    default:
      return new THREE.OctahedronGeometry(0.5 * k, 0);
  }
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const A = a.index ? a.toNonIndexed() : a;
  const B = b.index ? b.toNonIndexed() : b;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const x = A.getAttribute(name) as THREE.BufferAttribute;
    const y = B.getAttribute(name) as THREE.BufferAttribute;
    const arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array, 0);
    arr.set(y.array as Float32Array, x.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, x.itemSize));
  }
  return out;
}

/** Per-frame transform tweaks: stars spin and are round, flames flicker, bolts jitter. */
export function shapeSpin(shape: number, age: number, id: number): number {
  if (shape === BulletShape.Star) return age * 14 + id;
  if (shape === BulletShape.Bolt) return Math.sin(age * 60 + id) * 0.25;
  return 0;
}
