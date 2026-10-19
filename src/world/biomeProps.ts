import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Rng } from '../core/rng';
import { paint } from '../render/geometry';
import { commit } from '../render/instancing';
import { createRetroMaterial } from '../render/retroMaterial';
import type { AABB } from './collision';

/**
 * Props for the loop-2 biomes and the remixes, built for createFieldArena
 * (src/world/fieldArena.ts). Static props are plain meshes that the arena
 * merges per material; animated scenery (gears, floating islets) comes back
 * as `ArenaAnim` instanced meshes that src/world/worldRender.ts moves each
 * frame. Everything takes the arena's rng so the same seed rebuilds the same
 * stage on every machine.
 */

/** One animated decoration set: instances of one mesh that spin or bob. */
export interface ArenaAnim {
  mesh: THREE.InstancedMesh;
  kind: 'spin' | 'bob';
  items: { x: number; y: number; z: number; yaw: number; scale: number; speed: number; phase: number }[];
}

const CREAM = new THREE.Color('#fff6e8');
/**
 * Floor colour for play-mat floors: one soft colour per 2x2-tile mat, from a
 * hash (no rng, so the seeded layout is unchanged), times the checker shade.
 */
export function tileTint(colors: readonly string[], tx: number, tz: number, v: number): THREE.Color {
  const h = (Math.imul((tx >> 1) + 7, 73856093) ^ Math.imul((tz >> 1) + 3, 19349663)) >>> 0;
  return new THREE.Color(colors[(h >>> 3) % colors.length]).lerp(CREAM, 0.4).multiplyScalar(v);
}

/** The edge-ring piece: a leafy bush, a glossy ball (gumballs) or a round cloud puff. */
export function edgeGeometry(shape: 'bush' | 'ball' | 'cloud' = 'bush'): THREE.BufferGeometry {
  if (shape === 'ball') return new THREE.SphereGeometry(0.9, 10, 7);
  if (shape === 'cloud') return new THREE.IcosahedronGeometry(0.9, 1);
  return new THREE.IcosahedronGeometry(0.9, 0);
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

/**
 * A ruin wall made of toy building blocks: courses of 1- and 2-stud-long
 * bricks in bond, studs on the top course. Local origin at the wall's foot.
 */
export function buildBlockWall(rng: Rng, w: number, h: number, d: number, mats: THREE.Material[]): THREE.Group {
  const g = new THREE.Group();
  const alongX = w >= d;
  const len = alongX ? w : d;
  const thick = alongX ? d : w;
  const rows = Math.max(2, Math.round(h / 0.6));
  const bh = 0.6;
  // Bricks are baked per colour here (one mesh per colour per wall), so the arena merge stays cheap.
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    geo.translate(x, y, z);
    const list = byMat.get(mat) ?? [];
    list.push(geo);
    byMat.set(mat, list);
  };
  for (let r = 0; r < rows; r++) {
    let t = -len / 2;
    // Running bond: every other course starts with a half brick.
    let first = r % 2 === 1;
    while (t < len / 2 - 0.01) {
      const want = first ? 0.5 : rng.chance(0.6) ? 1 : 1.5;
      first = false;
      const bl = Math.min(want, len / 2 - t);
      const c = t + bl / 2;
      const mat = rng.pick(mats);
      add(new THREE.BoxGeometry(alongX ? bl - 0.04 : thick - 0.04, bh - 0.03, alongX ? thick - 0.04 : bl - 0.04), mat, alongX ? c : 0, r * bh + bh / 2, alongX ? 0 : c);
      if (r === rows - 1) {
        // Studs along the top, one every half metre.
        for (let k = 0.25; k < bl; k += 0.5) {
          const along = t + k;
          add(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 6), mat, alongX ? along : 0, rows * bh + 0.08, alongX ? 0 : along);
        }
      }
      t += bl;
    }
  }
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos);
    for (const x of geos) x.dispose();
    if (merged) g.add(new THREE.Mesh(merged, mat));
  }
  return g;
}

/** Toy Factory "trees": a ring-stacker, a wind-up robot or a spinning top, in block colours. */
export function buildToyTree(g: THREE.Group, rng: Rng, s: number, mats: THREE.Material[], white: THREE.Material): void {
  const kind = rng.int(0, 2);
  if (kind === 0) {
    // Baby ring stacker: base, post, rings getting smaller, a ball on top.
    g.add(mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.3, 12), rng.pick(mats), 0, 0.15, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 2.6 * s, 8), white, 0, 1.3 * s, 0));
    const n = 4;
    for (let k = 0; k < n; k++) {
      const r = (0.78 - k * 0.12) * s;
      g.add(mesh(new THREE.TorusGeometry(r, 0.24 * s, 6, 12), mats[(k + rng.int(0, 3)) % mats.length], 0, 0.5 + k * 0.48 * s, 0, Math.PI / 2));
    }
    g.add(mesh(new THREE.SphereGeometry(0.32 * s, 10, 7), rng.pick(mats), 0, 0.5 + n * 0.48 * s + 0.1, 0));
  } else if (kind === 1) {
    // Wind-up robot: boxy body and head, antenna, feet and the key on its back.
    const body = rng.pick(mats);
    const head = rng.pick(mats);
    const k = s * 0.9;
    for (const sx of [-0.28, 0.28]) g.add(mesh(new THREE.BoxGeometry(0.34 * k, 0.4 * k, 0.5 * k), white, sx * k, 0.2 * k, 0.05));
    g.add(mesh(new THREE.BoxGeometry(1.0 * k, 1.1 * k, 0.75 * k), body, 0, 0.95 * k, 0));
    g.add(mesh(new THREE.BoxGeometry(0.8 * k, 0.6 * k, 0.65 * k), head, 0, 1.85 * k, 0));
    for (const sx of [-0.18, 0.18]) g.add(mesh(new THREE.BoxGeometry(0.16 * k, 0.16 * k, 0.05), white, sx * k, 1.9 * k, 0.34 * k));
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5 * k, 6), white, 0, 2.35 * k, 0));
    g.add(mesh(new THREE.SphereGeometry(0.13 * k, 8, 6), head, 0, 2.62 * k, 0));
    for (const sx of [-0.62, 0.62]) g.add(mesh(new THREE.BoxGeometry(0.22 * k, 0.6 * k, 0.3 * k), head, sx * k, 1.0 * k, 0, 0, 0, sx * 0.4));
    // The key: a shaft and two flat wings.
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4 * k, 6), white, 0, 1.0 * k, -0.55 * k, Math.PI / 2));
    for (const sx of [-0.22, 0.22]) g.add(mesh(new THREE.CylinderGeometry(0.2 * k, 0.2 * k, 0.07, 10), white, sx * k, 1.0 * k, -0.78 * k, 0, 0, Math.PI / 2));
    g.rotation.y = rng.range(0, Math.PI * 2);
  } else {
    // Spinning top resting on its point, with a handle.
    const m = rng.pick(mats);
    g.add(mesh(new THREE.ConeGeometry(0.85 * s, 1.0 * s, 12), m, 0, 0.5 * s, 0, Math.PI));
    g.add(mesh(new THREE.CylinderGeometry(0.9 * s, 0.85 * s, 0.35 * s, 12), rng.pick(mats), 0, 1.15 * s, 0));
    g.add(mesh(new THREE.ConeGeometry(0.85 * s, 0.5 * s, 12), m, 0, 1.55 * s, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.7 * s, 6), white, 0, 2.0 * s, 0));
    g.rotation.z = rng.range(-0.12, 0.12);
  }
}

/** Sky Ruins blossom tree: a pale bent trunk, a cloud of blossom and a gold ring. */
export function buildBlossom(g: THREE.Group, rng: Rng, s: number, leaf: THREE.Material, trunk: THREE.Material, gold: THREE.Material): void {
  const lean = rng.range(-0.25, 0.25);
  g.add(mesh(new THREE.CylinderGeometry(0.18, 0.3, 1.6, 7), trunk, 0, 0.8, 0, 0, 0, lean));
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.1, 7), trunk, -Math.sin(lean) * 1.2, 1.9, 0, 0, 0, -lean * 1.4));
  g.add(mesh(new THREE.TorusGeometry(0.24, 0.06, 4, 10), gold, 0, 0.5, 0, Math.PI / 2));
  const cx = -Math.sin(lean) * 1.5;
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + rng.range(0, 0.6);
    const r = (0.8 + rng.range(0, 0.35)) * s;
    g.add(mesh(new THREE.IcosahedronGeometry(r, 1), leaf, cx + Math.cos(a) * 0.6 * s, 2.6 + 0.4 * s + rng.range(-0.1, 0.3), Math.sin(a) * 0.6 * s));
  }
  g.add(mesh(new THREE.IcosahedronGeometry(0.75 * s, 1), leaf, cx, 3.2 + 0.6 * s, 0));
}

/** Rock-like cover for the new biomes and remixes, centred on (x, z). */
export function buildRock(
  style: 'block' | 'column' | 'basalt' | 'pumpkin' | 'crystal',
  rng: Rng,
  r: number,
  x: number,
  z: number,
  mats: THREE.Material[],
  accent: THREE.Material,
  stem: THREE.Material,
): THREE.Object3D {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  if (style === 'block') {
    // Wooden alphabet blocks: one big, sometimes a smaller one on top.
    const a = r * 1.35;
    g.add(mesh(new THREE.BoxGeometry(a, a, a), rng.pick(mats), 0, a / 2, 0, 0, rng.range(-0.5, 0.5)));
    if (rng.chance(0.55)) {
      const b = a * 0.62;
      g.add(mesh(new THREE.BoxGeometry(b, b, b), rng.pick(mats), rng.range(-0.15, 0.15), a + b / 2, rng.range(-0.15, 0.15), 0, rng.range(0, 1.5)));
    }
  } else if (style === 'column') {
    // A broken marble column on its plinth, a drum fallen beside it.
    const h = r * rng.range(1.4, 2.8);
    const m = rng.pick(mats);
    g.add(mesh(new THREE.BoxGeometry(r * 1.4, 0.3, r * 1.4), m, 0, 0.15, 0));
    g.add(mesh(new THREE.CylinderGeometry(r * 0.48, r * 0.55, h, 10), m, 0, 0.3 + h / 2, 0, rng.range(-0.06, 0.06)));
    g.add(mesh(new THREE.TorusGeometry(r * 0.52, 0.07, 4, 12), accent, 0, 0.55, 0, Math.PI / 2));
    if (rng.chance(0.6)) {
      const a = rng.range(0, Math.PI * 2);
      g.add(mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, r * 0.9, 10), m, Math.cos(a) * r * 0.9, r * 0.45, Math.sin(a) * r * 0.9, Math.PI / 2, a));
    }
  } else if (style === 'basalt') {
    // Hexagonal basalt columns packed together.
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + rng.range(0, 0.4);
      const d = k === 0 ? 0 : r * 0.42;
      const h = r * rng.range(0.9, 2.2);
      g.add(mesh(new THREE.CylinderGeometry(r * 0.32, r * 0.34, h, 6), rng.pick(mats), Math.cos(a) * d, h / 2, Math.sin(a) * d, 0, rng.range(0, 1)));
    }
  } else if (style === 'pumpkin') {
    // A fat ribbed pumpkin with a stem (two lobes rings make the ribs read).
    const m = rng.pick(mats);
    const p = new THREE.SphereGeometry(r * 0.75, 10, 6);
    p.scale(1, 0.72, 1);
    g.add(mesh(p, m, 0, r * 0.55, 0));
    for (let k = 0; k < 4; k++) {
      const q = new THREE.SphereGeometry(r * 0.42, 8, 5);
      q.scale(0.7, 1.05, 1.25);
      const a = (k / 4) * Math.PI * 2 + 0.4;
      g.add(mesh(q, m, Math.cos(a) * r * 0.42, r * 0.55, Math.sin(a) * r * 0.42, 0, -a));
    }
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.12, r * 0.45, 5), stem, 0.05, r * 1.0, 0, 0, 0, 0.3));
  } else {
    // Crystal cluster: tall glowing points leaning out.
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + rng.range(0, 0.8);
      const h = r * rng.range(1.2, 2.4) * (k === 0 ? 1.3 : 1);
      const c = new THREE.ConeGeometry(r * 0.32, h, 5);
      const lean = k === 0 ? 0 : 0.35;
      g.add(mesh(c, rng.pick(mats), Math.cos(a) * r * 0.3 * (k ? 1 : 0), h / 2 - 0.1, Math.sin(a) * r * 0.3 * (k ? 1 : 0), Math.sin(a) * lean, 0, -Math.cos(a) * lean));
    }
  }
  return g;
}

/** Rocky roots hanging under a floating island's cliffs (static, merged with the arena). */
export function buildUnderside(group: THREE.Group, rng: Rng, edge: number, depth: number, tex: THREE.Texture): void {
  const mat = createRetroMaterial({ map: tex, color: '#d8c0a8' });
  const geos: THREE.BufferGeometry[] = [];
  for (let side = 0; side < 4; side++) {
    for (let t = -edge + 6; t < edge - 4; t += rng.range(7, 13)) {
      const r = rng.range(3, 6.5);
      const h = rng.range(6, 15);
      const c = new THREE.ConeGeometry(r, h, 6);
      c.rotateX(Math.PI);
      const inset = edge - r * 0.8;
      const [x, z] = side === 0 ? [t, -inset] : side === 1 ? [t, inset] : side === 2 ? [-inset, t] : [inset, t];
      c.translate(x, -depth - h / 2 + 0.5, z);
      geos.push(c);
    }
  }
  const merged = mergeGeometries(geos);
  if (merged) group.add(new THREE.Mesh(merged, mat));
}

/** A cog wheel lying in the XY plane, `teeth` teeth, extruded `thick` deep (centred). */
function gearGeometry(r: number, teeth: number, thick: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const n = teeth * 4;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = i % 4 < 2 ? r : r * 0.82;
    if (i === 0) shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, r * 0.25, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -thick / 2);
  return g;
}

/** A small floating islet: an upside-down rock cone with a grassy top and a stump of ruin. Vertex-coloured. */
function isletGeometry(): THREE.BufferGeometry {
  const rock = new THREE.ConeGeometry(1, 2.2, 7);
  rock.rotateX(Math.PI);
  rock.translate(0, -1.1, 0);
  paint(rock, '#c89a72');
  const top = new THREE.CylinderGeometry(1.05, 1.0, 0.25, 7);
  top.translate(0, 0.1, 0);
  paint(top, '#8ee0b0');
  const col = new THREE.CylinderGeometry(0.16, 0.18, 0.9, 8);
  col.translate(0.35, 0.65, -0.2);
  paint(col, '#fbf6ea');
  const parts = [rock, top, col].map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute('uv');
    return ng;
  });
  return mergeGeometries(parts)!;
}

/**
 * Animated scenery outside the play area: big gears half-sunk in the factory's
 * ball pit, or small islets floating round the sky island. Local and cosmetic.
 */
export function buildDecor(kind: 'gears' | 'islets', group: THREE.Group, rng: Rng, half: number, colliders: AABB[]): ArenaAnim[] {
  void colliders;
  const items: ArenaAnim['items'] = [];
  if (kind === 'gears') {
    const n = 10;
    const mesh = new THREE.InstancedMesh(gearGeometry(1, 12, 0.5), createRetroMaterial({}), n);
    const cols = ['#ffcd3a', '#ff5a4a', '#3b8cff', '#38c868', '#94b0c2'];
    for (let i = 0; i < n; i++) {
      const side = i % 4;
      const t = rng.range(-half + 8, half - 8);
      const out = half + rng.range(4, 9);
      const [x, z] = side === 0 ? [t, -out] : side === 1 ? [t, out] : side === 2 ? [-out, t] : [out, t];
      const scale = rng.range(2.4, 4.2);
      // Stand the gear up facing the field.
      const yaw = side < 2 ? 0 : Math.PI / 2;
      items.push({ x, y: scale * 0.35, z, yaw, scale, speed: (rng.chance(0.5) ? 1 : -1) * rng.range(0.25, 0.6), phase: rng.range(0, 6) });
      mesh.setColorAt(i, new THREE.Color(rng.pick(cols)));
    }
    return [finish(group, mesh, 'spin', items)];
  }
  const n = 12;
  const mesh = new THREE.InstancedMesh(isletGeometry(), createRetroMaterial({ vertexColors: true }), n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const d = half + rng.range(10, 26);
    // Square-ish ring round the square island.
    const k = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    items.push({ x: (Math.cos(a) / k) * d, y: rng.range(-4, 1.5), z: (Math.sin(a) / k) * d, yaw: rng.range(0, 6), scale: rng.range(1.5, 3.5), speed: rng.range(0.4, 0.8), phase: rng.range(0, 6) });
    mesh.setColorAt(i, new THREE.Color(1, 1, 1));
  }
  return [finish(group, mesh, 'bob', items)];
}

function finish(group: THREE.Group, mesh: THREE.InstancedMesh, kind: ArenaAnim['kind'], items: ArenaAnim['items']): ArenaAnim {
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const a: ArenaAnim = { mesh, kind, items };
  if (mesh.instanceColor) commit(mesh.instanceColor, items.length);
  poseAnim(a, 0);
  group.add(mesh);
  return a;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const sc = new THREE.Vector3();

/** Pose animated scenery at time `t` (seconds). */
export function poseAnim(a: ArenaAnim, t: number): void {
  for (let i = 0; i < a.items.length; i++) {
    const it = a.items[i];
    if (a.kind === 'spin') {
      e.set(0, it.yaw, it.phase + t * it.speed, 'YXZ');
      v.set(it.x, it.y, it.z);
    } else {
      e.set(Math.sin(t * 0.3 + it.phase) * 0.05, it.yaw + t * 0.03 * it.speed, Math.cos(t * 0.27 + it.phase) * 0.05);
      v.set(it.x, it.y + Math.sin(t * it.speed + it.phase) * 0.45, it.z);
    }
    q.setFromEuler(e);
    m4.compose(v, q, sc.setScalar(it.scale));
    a.mesh.setMatrixAt(i, m4);
  }
  commit(a.mesh.instanceMatrix, a.items.length);
}
