import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import { createRetroMaterial } from '../render/retroMaterial';
import { textures } from '../render/textures';
import { biomeTex } from '../render/biomeTextures';
import { paint, tiledBox } from '../render/geometry';
import { mergeStatic } from '../render/mergeStatic';
import { aabbFromCenter, overlapsAny, type AABB } from './collision';
import { BIOMES, type BiomeDef } from '../data/biomes';
import { biomeHazard, type HazardZone } from '../game/hazards';

/** Breakable cover: shoot it down. Solid until destroyed; pillars topple and crush what's under them. */
export interface ArenaProp {
  kind: 'crate' | 'stack' | 'pillar';
  x: number;
  z: number;
  w: number;
  d: number;
  /** Yaw of the (bottom) crate; `rot2` is the stacked crate's (stacks only). */
  rot: number;
  rot2: number;
  box: AABB;
}

/**
 * Big, open island field for survival stages. Mostly open ground for kiting,
 * with sparse clusters of cover (ruins, crates, trees, rocks) and winding
 * paths. The biome picks textures, props, sea and decorations. Seeded, so the
 * same run seed rebuilds the same stage.
 */
export interface Arena {
  group: THREE.Group;
  colliders: AABB[];
  halfSize: number;
  /** Explosive barrels: drawn and destroyed by the game, not merged into the static props. */
  barrels: { x: number; z: number; box: AABB }[];
  /** Treasure chest spots (not solid: you walk into them to open). */
  chests: { x: number; z: number; facing: number }[];
  /** Ground hazards: lava burns, ice is slippery, quicksand slows and swallows, thorns scratch (src/game/hazards.ts). */
  hazards: HazardZone[];
  /** Conveyor belts: axis-aligned strips that carry anything on them along (dx, dz). */
  conveyors: { x: number; z: number; w: number; d: number; dx: number; dz: number }[];
  /** The seed this arena was built from (interactives and objectives derive from it). */
  seed: number;
  /** Breakable cover (crates, crate stacks, toppling pillars); drawn by src/game/interactives.ts. */
  props: ArenaProp[];
  /** Jump pads: step on (x, z) to be launched to (tx, tz). */
  pads: { x: number; z: number; tx: number; tz: number }[];
  /** Turret pads: walk in to switch the turret on. */
  turrets: { x: number; z: number }[];
  /** Clear spots spread over the field for objectives (totems, shards, beacon). */
  spots: { x: number; z: number }[];
  /** Animated and lit decoration of the Neon City / Sky Fortress biomes (drawn by src/render/biomeFx.ts). */
  deco?: ArenaDeco;
}

/** Decoration data the biome effects animate; plain data, the same on every machine for a seed. */
export interface ArenaDeco {
  /** Glowing things that light the ground around them (neon signs, street lamps). */
  lights: { x: number; y: number; z: number; r: number; color: string; k: number }[];
  /** Hologram billboards: centre, height of the panel's middle, size, colour and yaw. */
  holos: { x: number; y: number; z: number; w: number; h: number; color: string; rot: number }[];
  /** Steam vents (puffs rise from them). */
  vents: { x: number; z: number }[];
  /** Flag poles: base, pole height and cloth colour. */
  flags: { x: number; z: number; h: number; color: string }[];
  /** Airships drifting around the fortress (count). */
  airships: number;
  /** Gaps in the ground (Sky Fortress), as rectangles (also in `colliders` with `gap` set). */
  gaps: AABB[];
}

export interface ArenaOptions {
  /** Number of conveyor belts (later stages). */
  conveyors?: number;
}

const HALF = 55;
const TILE = 2;
const CLEAR_CENTER = 9;

export function createFieldArena(seed: number, biome: BiomeDef = BIOMES[0], opts: ArenaOptions = {}): Arena {
  const rng = new Rng(seed);
  const hazards: Arena['hazards'] = [];
  const conveyors: Arena['conveyors'] = [];
  const group = new THREE.Group();
  const colliders: AABB[] = [];
  const barrels: Arena['barrels'] = [];
  const chests: Arena['chests'] = [];
  const props: ArenaProp[] = [];
  const tex = {
    grass: biomeTex(biome.ground),
    path: biomeTex(biome.path),
    sand: biomeTex(biome.rim),
    brick: biomeTex(biome.wall),
    water: biomeTex(biome.sea.tex),
    leaves: biomeTex(biome.leaves),
    edge: biomeTex(biome.edge.tex),
  };
  const neon = biome.kind === 'neon';
  const sky = biome.kind === 'sky';
  const deco: ArenaDeco | undefined = biome.kind ? { lights: [], holos: [], vents: [], flags: [], airships: 0, gaps: [] } : undefined;

  // --- Winding dirt paths: a few random walks painted onto the tile grid ---
  const n = (HALF * 2) / TILE;
  const isPath = new Uint8Array(n * n);
  for (let w = 0; w < 5; w++) {
    let cx = rng.int(0, n - 1);
    let cz = rng.int(0, n - 1);
    let dir = rng.next() * Math.PI * 2;
    for (let s = 0; s < 70; s++) {
      for (let ox = -1; ox <= 0; ox++)
        for (let oz = -1; oz <= 0; oz++) {
          const tx = cx + ox;
          const tz = cz + oz;
          if (tx >= 0 && tz >= 0 && tx < n && tz < n) isPath[tz * n + tx] = 1;
        }
      dir += rng.range(-0.5, 0.5);
      cx = Math.max(0, Math.min(n - 1, Math.round(cx + Math.cos(dir))));
      cz = Math.max(0, Math.min(n - 1, Math.round(cz + Math.sin(dir))));
    }
  }
  // Central plaza
  for (let tz = 0; tz < n; tz++)
    for (let tx = 0; tx < n; tx++) {
      const x = -HALF + tx * TILE + TILE / 2;
      const z = -HALF + tz * TILE + TILE / 2;
      if (Math.hypot(x, z) < 5) isPath[tz * n + tx] = 1;
    }

  // Sky Fortress: chasms split the field into islands joined by plank bridges.
  const gapMask = sky ? skyGaps(rng, n) : null;
  if (gapMask) for (let i = 0; i < n * n; i++) if (gapMask[i] === GAP_BRIDGE) isPath[i] = 1;

  const grassTiles: THREE.BufferGeometry[] = [];
  const pathTiles: THREE.BufferGeometry[] = [];
  for (let tz = 0; tz < n; tz++) {
    for (let tx = 0; tx < n; tx++) {
      if (gapMask && gapMask[tz * n + tx] === GAP_VOID) continue;
      const g = new THREE.PlaneGeometry(TILE, TILE);
      g.rotateX(-Math.PI / 2);
      g.translate(-HALF + tx * TILE + TILE / 2, 0, -HALF + tz * TILE + TILE / 2);
      const v = ((tx + tz) % 2 === 0 ? 1 : 0.94) * rng.range(0.96, 1.04);
      paint(g, new THREE.Color(v, v, v));
      (isPath[tz * n + tx] ? pathTiles : grassTiles).push(g);
    }
  }
  group.add(
    new THREE.Mesh(mergeGeometries(grassTiles), createRetroMaterial({ map: tex.grass, vertexColors: true })),
    new THREE.Mesh(mergeGeometries(pathTiles), createRetroMaterial({ map: tex.path, vertexColors: true })),
  );

  // --- Island base and sea ---
  if (gapMask) skyCliffs(group, gapMask, n, tex.sand, tex.path);
  else {
    const base = new THREE.Mesh(tiledBox(HALF * 2 + 4, 1.4, HALF * 2 + 4, 2), createRetroMaterial({ map: tex.sand }));
    base.position.y = -0.72;
    group.add(base);
  }
  const seaGeo = new THREE.PlaneGeometry(400, 400, 20, 20);
  seaGeo.rotateX(-Math.PI / 2);
  const seaUv = seaGeo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < seaUv.count; i++) seaUv.setXY(i, seaUv.getX(i) * 100, seaUv.getY(i) * 100);
  const sea = new THREE.Mesh(seaGeo, createRetroMaterial({ map: tex.water, uvScroll: biome.sea.scroll, unlit: biome.sea.unlit }));
  sea.position.y = biome.sea.y ?? -0.4;
  group.add(sea);

  // Invisible boundary walls just inside the hedge line
  const T = 2;
  const B = HALF - 1;
  colliders.push(
    aabbFromCenter(0, -B - T / 2, B * 2 + 2 * T, T),
    aabbFromCenter(0, B + T / 2, B * 2 + 2 * T, T),
    aabbFromCenter(-B - T / 2, 0, T, B * 2),
    aabbFromCenter(B + T / 2, 0, T, B * 2),
  );

  // --- Hedge ring (instanced) ---
  const hedge: [number, number][] = [];
  for (let t = -HALF; t <= HALF; t += 1.6) hedge.push([t, -HALF], [t, HALF], [-HALF, t], [HALF, t]);
  const blockEdge = biome.edge.shape === 'block';
  if (gapMask) {
    // No battlements floating over a chasm's mouth.
    for (let i = hedge.length - 1; i >= 0; i--) {
      const [x, z] = hedge[i];
      const tx = Math.max(0, Math.min(n - 1, Math.floor((x + HALF) / TILE)));
      const tz = Math.max(0, Math.min(n - 1, Math.floor((z + HALF) / TILE)));
      if (gapMask[tz * n + tx] === GAP_VOID) hedge.splice(i, 1);
    }
  }
  const bushes = new THREE.InstancedMesh(blockEdge ? new THREE.BoxGeometry(1.5, 1, 1.5) : new THREE.IcosahedronGeometry(0.9, 0), createRetroMaterial({ map: tex.edge }), hedge.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const greens = biome.edge.colors.map((c) => new THREE.Color(c));
  hedge.forEach(([x, z], i) => {
    const s = rng.range(0.8, 1.25);
    q.setFromEuler(e.set(0, rng.range(0, Math.PI), 0));
    if (blockEdge) {
      // Parapet / battlement: square blocks, every other one taller (crenels).
      const tall = (Math.round((x + z) / 1.6) & 1) === 0;
      const h = sky ? (tall ? 1.5 : 0.8) : tall ? 1.1 : 0.9;
      q.identity();
      m4.compose(new THREE.Vector3(x, h / 2, z), q, new THREE.Vector3(1.08, h, 1.08));
    } else m4.compose(new THREE.Vector3(x, 0.4 * s, z), q, new THREE.Vector3(s, s * 0.85, s));
    bushes.setMatrixAt(i, m4);
    bushes.setColorAt(i, rng.pick(greens));
  });
  group.add(bushes);

  // --- Sparse cover clusters ---
  const placed: AABB[] = [];
  const lim = HALF - 5;
  if (gapMask && deco) {
    for (const r of gapRects(gapMask, n)) {
      const box: AABB = { minX: -HALF + r[0] * TILE, maxX: -HALF + (r[0] + r[2]) * TILE, minZ: -HALF + r[1] * TILE, maxZ: -HALF + (r[1] + r[3]) * TILE, gap: true };
      colliders.push(box);
      placed.push(box);
      deco.gaps.push(box);
    }
  }
  const spot = (w: number, d: number, margin: number, cx?: number, cz?: number, spread = 0): [number, number] | null => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = cx !== undefined ? cx + rng.range(-spread, spread) : rng.range(-lim, lim);
      const z = cz !== undefined ? cz + rng.range(-spread, spread) : rng.range(-lim, lim);
      if (Math.abs(x) > lim || Math.abs(z) > lim || Math.hypot(x, z) < CLEAR_CENTER) continue;
      const box = aabbFromCenter(x, z, w, d);
      if (overlapsAny(box, placed, margin)) continue;
      placed.push(box);
      return [x, z];
    }
    return null;
  };
  const solid = (mesh: THREE.Object3D, x: number, z: number, w: number, d: number) => {
    group.add(mesh);
    colliders.push(aabbFromCenter(x, z, w, d));
  };

  const brickMat = createRetroMaterial({ map: tex.brick, color: biome.wallTint });
  const capMat = createRetroMaterial({ color: biome.capColor });
  const pillarMat = createRetroMaterial({ map: tex.brick, color: biome.pillarTint });
  const trunkMat = createRetroMaterial({ color: biome.trunk });
  const snowMat = createRetroMaterial({ color: '#ffffff' });
  const flowerMat = createRetroMaterial({ color: '#ff7eb6' });
  const rockMats = biome.rockColors.map((c) => createRetroMaterial({ color: c }));
  const leafMat = createRetroMaterial({ map: tex.leaves });
  // Neon City: glowing trims, sign faces and their streaky reflections on the wet roof.
  const neonMats = neon ? NEON.map((c) => createRetroMaterial({ color: c, unlit: 1 })) : [];
  const signTex = neon ? biomeTex('neonSign') : null;
  const signMats = neon ? NEON.map((c) => createRetroMaterial({ map: signTex, color: c, unlit: 1 })) : [];
  const rippleTex = neon ? biomeTex('ripple') : null;
  const reflMats = neon
    ? NEON.map((c) => {
        const m = createRetroMaterial({ map: rippleTex, color: new THREE.Color(c).multiplyScalar(0.55), unlit: 1, transparent: true });
        m.blending = THREE.AdditiveBlending;
        m.depthWrite = false;
        return m;
      })
    : [];
  const darkMat = createRetroMaterial({ color: '#24244c' });
  /** Streaky reflection of a glowing thing at (x, z), `len` long toward the camera, on the wet ground. */
  const reflection = (x: number, z: number, w: number, len: number, ci: number) => {
    const g = new THREE.PlaneGeometry(w, len);
    g.rotateX(-Math.PI / 2);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * Math.max(1, Math.round(w)));
    const m = new THREE.Mesh(g, reflMats[ci]);
    m.position.set(x, 0.045, z + len / 2);
    m.renderOrder = 1;
    group.add(m);
  };
  /** A glowing pixel sign facing the camera (+Z): framed glyph panel, ground light and reflection. */
  const sign = (x: number, y: number, z: number, w: number, h: number, ci: number) => {
    const glyph = rng.int(0, 7);
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const u0 = (glyph % 4) / 4;
    const v0 = 0.5 - Math.floor(glyph / 4) * 0.5;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * 0.25, v0 + uv.getY(k) * 0.5);
    const panel = new THREE.Mesh(g, signMats[ci]);
    panel.position.set(x, y, z + 0.06);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, h + 0.16, 0.1), darkMat);
    frame.position.set(x, y, z);
    group.add(panel, frame);
    reflection(x, z + 0.25, w * 1.1, Math.min(4.5, y * 1.3 + h * 0.6), ci);
    deco!.lights.push({ x, y, z: z + 0.6, r: 4.5 + h * 1.4, color: NEON[ci], k: 0.6 });
  };
  const barrel = (p: [number, number]) => {
    const box = aabbFromCenter(p[0], p[1], 0.9, 0.9);
    colliders.push(box);
    barrels.push({ x: p[0], z: p[1], box });
  };

  const ruin = (cx: number, cz: number) => {
    // An L or U of short walls plus a pillar or two.
    const parts = rng.int(2, 3);
    for (let i = 0; i < parts; i++) {
      const long = rng.int(3, 5);
      const horiz = rng.chance(0.5);
      const w = horiz ? long : 1;
      const d = horiz ? 1 : long;
      const h = rng.pick([1.2, 1.6, 2.2]);
      const p = spot(w, d, 0.6, cx, cz, 4);
      if (!p) continue;
      const wall = new THREE.Mesh(tiledBox(w, h, d, 2), brickMat);
      wall.position.set(p[0], h / 2, p[1]);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.2, d + 0.2), capMat);
      cap.position.y = h / 2 + 0.1;
      wall.add(cap);
      solid(wall, p[0], p[1], w, d);
      if (neon) {
        // A neon tube along the top, and often a sign on the camera side.
        const ci = rng.int(0, NEON.length - 1);
        // Thin tubes along the top's front edge and down both front corners.
        const tube = new THREE.Mesh(new THREE.BoxGeometry(horiz ? w + 0.22 : 0.12, 0.1, horiz ? 0.12 : d + 0.22), neonMats[ci]);
        tube.position.set(p[0], h + 0.22, p[1] + (horiz ? d / 2 + 0.06 : 0));
        group.add(tube);
        for (const sx of horiz ? [-1, 1] : [0]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, h + 0.2, 0.1), neonMats[ci]);
          post.position.set(p[0] + (sx * (w + 0.16)) / 2, h / 2 + 0.1, p[1] + d / 2 + 0.08);
          group.add(post);
        }
        if (rng.chance(0.55)) sign(p[0] + (horiz ? rng.range(-w / 4, w / 4) : 0), h * 0.55, p[1] + d / 2 + 0.06, horiz ? 0.9 : 0.75, horiz ? 1.5 : 1.25, rng.int(0, NEON.length - 1));
      } else if (sky) {
        // Battlements: merlons along the top.
        const along = Math.max(w, d);
        for (let k = 0.5; k < along; k += 1) {
          if (Math.round(k - 0.5) % 2) continue;
          const mer = new THREE.Mesh(new THREE.BoxGeometry(horiz ? 0.6 : 0.9, 0.5, horiz ? 0.9 : 0.6), brickMat);
          mer.position.set(p[0] + (horiz ? k - along / 2 : 0), h + 0.45, p[1] + (horiz ? 0 : k - along / 2));
          group.add(mer);
        }
      }
    }
    if (rng.chance(0.6)) {
      const p = spot(1.4, 1.4, 1, cx, cz, 5);
      if (p) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 3, 8), pillarMat);
        pillar.position.set(p[0], 1.5, p[1]);
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 1.6), capMat);
        top.position.y = 1.65;
        pillar.add(top);
        solid(pillar, p[0], p[1], 1.2, 1.2);
        if (neon) {
          const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.12, 8), rng.pick(neonMats));
          ring.position.set(p[0], 2.2, p[1]);
          group.add(ring);
        } else if (sky) deco!.flags.push({ x: p[0], z: p[1], h: 3.3, color: rng.pick(FLAG_COLORS) });
      }
    }
  };
  const crates = (cx: number, cz: number) => {
    for (let i = rng.int(2, 4); i > 0; i--) {
      const p = spot(1.2, 1.2, 0.1, cx, cz, 2);
      if (!p) continue;
      // Crates are breakable cover: drawn and broken by src/game/interactives.ts (same rolls as before).
      const rot = rng.pick([0, 0.15, -0.1]);
      const rot2 = rng.chance(0.3) ? rng.range(-0.4, 0.4) : 0;
      const box = aabbFromCenter(p[0], p[1], 1.2, 1.2);
      colliders.push(box);
      props.push({ kind: rot2 ? 'stack' : 'crate', x: p[0], z: p[1], w: 1.2, d: 1.2, rot, rot2, box });
    }
    for (let i = rng.int(1, 3); i > 0; i--) {
      const p = spot(0.9, 0.9, 0.2, cx, cz, 2.5);
      if (p) barrel(p);
    }
  };
  const tree = (x: number, z: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const s = rng.range(1.0, 1.5);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number, rz = 0, ry = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.rotation.set(0, ry, rz);
      g.add(m);
    };
    if (biome.tree === 'round') {
      add(new THREE.CylinderGeometry(0.25, 0.35, 1.6, 6), trunkMat, 0, 0.8, 0);
      add(new THREE.IcosahedronGeometry(1.3 * s, 0), leafMat, 0, 2.2 + 0.4 * s, 0, 0, rng.range(0, Math.PI));
      add(new THREE.IcosahedronGeometry(0.85 * s, 0), leafMat, 0, 3.3 + 0.5 * s, 0);
    } else if (biome.tree === 'cactus') {
      const h = 1.8 + s;
      add(new THREE.CylinderGeometry(0.38, 0.42, h, 8), leafMat, 0, h / 2, 0);
      add(new THREE.SphereGeometry(0.38, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), leafMat, 0, h, 0);
      const side = rng.chance(0.5) ? 1 : -1;
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.6, 6), leafMat, 0.45 * side, h * 0.5, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.9, 6), leafMat, 0.72 * side, h * 0.5 + 0.4, 0);
      if (rng.chance(0.6)) {
        add(new THREE.CylinderGeometry(0.18, 0.18, 0.5, 6), leafMat, -0.42 * side, h * 0.35, 0, Math.PI / 2);
        add(new THREE.CylinderGeometry(0.18, 0.18, 0.7, 6), leafMat, -0.62 * side, h * 0.35 + 0.3, 0);
      }
      add(new THREE.IcosahedronGeometry(0.18, 0), flowerMat, 0, h + 0.38, 0);
    } else if (biome.tree === 'pine') {
      add(new THREE.CylinderGeometry(0.2, 0.28, 1.0, 6), trunkMat, 0, 0.5, 0);
      for (let k = 0; k < 3; k++) {
        const r = (1.4 - k * 0.35) * s;
        add(new THREE.ConeGeometry(r, 1.4 * s, 7), leafMat, 0, 1.3 + k * 0.95 * s, 0, 0, k * 0.4);
      }
      add(new THREE.ConeGeometry(0.35 * s, 0.5 * s, 7), snowMat, 0, 1.3 + 2.45 * s, 0);
    } else if (biome.tree === 'lamp') {
      // Neon street lamp: a pole, an arm and a glowing head (plus a hanging sign on some).
      const h = 2.6 + s * 0.6;
      const ci = rng.int(0, NEON.length - 1);
      add(new THREE.CylinderGeometry(0.1, 0.16, h, 6), trunkMat, 0, h / 2, 0);
      add(new THREE.BoxGeometry(0.9, 0.08, 0.08), trunkMat, 0.4, h - 0.05, 0);
      add(new THREE.BoxGeometry(0.42, 0.14, 0.3), neonMats[ci], 0.8, h - 0.16, 0);
      add(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 8), darkMat, 0, 0.06, 0);
      deco!.lights.push({ x: x + 0.8, y: h - 0.3, z, r: 6, color: NEON[ci], k: 0.5 });
      reflection(x + 0.8, z + 0.2, 0.7, 2.6, ci);
    } else {
      // Dead tree: a crooked trunk and a few bare branches.
      const h = 2 + s;
      add(new THREE.CylinderGeometry(0.16, 0.32, h, 6), trunkMat, 0, h / 2, 0, rng.range(-0.1, 0.1));
      for (let k = 0; k < 3; k++) {
        const a = rng.range(0, Math.PI * 2);
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 1.1, 5), trunkMat);
        b.position.set(Math.cos(a) * 0.35, h * (0.55 + k * 0.15), Math.sin(a) * 0.35);
        b.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
        g.add(b);
      }
    }
    return g;
  };
  const grove = (cx: number, cz: number) => {
    for (let i = rng.int(2, 5); i > 0; i--) {
      const p = spot(0.8, 0.8, 1.6, cx, cz, 4);
      if (!p) continue;
      solid(tree(p[0], p[1]), p[0], p[1], 0.8, 0.8);
    }
  };
  const rocks = (cx: number, cz: number) => {
    for (let i = rng.int(2, 4); i > 0; i--) {
      const r = rng.range(0.7, 1.3);
      const p = spot(r * 1.6, r * 1.6, 0.4, cx, cz, 3);
      if (!p) continue;
      if (neon) {
        // Rooftop machinery: AC units with a fan, or a glowing vending machine.
        if (rng.chance(0.6)) {
          const ac = new THREE.Mesh(new THREE.BoxGeometry(r * 1.5, 0.9, r * 1.3), rng.pick(rockMats));
          ac.position.set(p[0], 0.45, p[1]);
          const fan = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, 0.06, 10), darkMat);
          fan.position.y = 0.47;
          ac.add(fan);
          solid(ac, p[0], p[1], r * 1.5, r * 1.3);
        } else {
          const ci = rng.int(0, NEON.length - 1);
          const vm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.8), rng.pick(rockMats));
          vm.position.set(p[0], 0.95, p[1]);
          const face = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.2), neonMats[ci]);
          face.position.set(0, 0.2, 0.41);
          vm.add(face);
          solid(vm, p[0], p[1], 1.1, 0.8);
          reflection(p[0], p[1] + 0.45, 1, 2.2, ci);
          deco!.lights.push({ x: p[0], y: 1.1, z: p[1] + 0.8, r: 4.5, color: NEON[ci], k: 0.45 });
        }
        continue;
      }
      if (sky) {
        // Floating-sky crystals.
        const m = new THREE.Mesh(new THREE.OctahedronGeometry(r * 0.8, 0), rng.pick(rockMats));
        m.position.set(p[0], r * 1.1, p[1]);
        m.scale.set(0.8, 1.6, 0.8);
        m.rotation.y = rng.range(0, Math.PI);
        solid(m, p[0], p[1], r * 1.2, r * 1.2);
        continue;
      }
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rng.pick(rockMats));
      m.position.set(p[0], r * 0.6, p[1]);
      m.rotation.set(rng.range(0, 1), rng.range(0, Math.PI), 0);
      m.scale.y = rng.range(0.7, 1.2);
      solid(m, p[0], p[1], r * 1.5, r * 1.5);
    }
  };

  // Flat decoration pools (lava, frozen ponds): drawn under everything, never solid.
  if (biome.pools) {
    const poolMat = createRetroMaterial({ map: biomeTex(biome.pools.tex), unlit: biome.pools.unlit, uvScroll: biome.pools.scroll });
    for (let i = 0; i < biome.pools.count; i++) {
      const r = rng.range(2.2, 4.2);
      const c = spot(r * 2, r * 2, 1);
      if (!c) continue;
      const geo = new THREE.CircleGeometry(r, 10);
      geo.rotateX(-Math.PI / 2);
      // Wobbly edge so pools don't look like perfect discs.
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 1; k < pos.count; k++) {
        const f = rng.range(0.8, 1.1);
        pos.setX(k, pos.getX(k) * f);
        pos.setZ(k, pos.getZ(k) * f);
      }
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * r, uv.getY(k) * r);
      const m = new THREE.Mesh(geo, poolMat);
      m.position.set(c[0], 0.03, c[1]);
      group.add(m);
      if (biome.pools.tex === 'lava' || biome.pools.tex === 'ice') hazards.push({ x: c[0], z: c[1], r: r * 0.85, kind: biome.pools.tex });
    }
  }

  // Conveyor belts (later stages): scrolling strips that carry players and enemies.
  if (opts.conveyors) {
    const beltTex = textures.conveyor();
    for (let i = 0; i < opts.conveyors; i++) {
      const alongX = rng.chance(0.5);
      const len = rng.range(9, 14);
      const wid = 2.4;
      const w = alongX ? len : wid;
      const d = alongX ? wid : len;
      const c = spot(w, d, 1.5);
      if (!c) continue;
      const sign = rng.chance(0.5) ? 1 : -1;
      const dx = alongX ? sign : 0;
      const dz = alongX ? 0 : sign;
      const geo = new THREE.PlaneGeometry(wid, len);
      geo.rotateX(-Math.PI / 2);
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (wid / 2), uv.getY(k) * (len / 2));
      const mat = createRetroMaterial({ map: beltTex, unlit: 0.3, uvScroll: [0, 1.6] });
      const m = new THREE.Mesh(geo, mat);
      // Plane V runs along -Z before rotation; spin it so the chevrons point along (dx, dz).
      m.rotation.y = Math.atan2(dx, dz) + Math.PI;
      m.position.set(c[0], 0.035, c[1]);
      group.add(m);
      conveyors.push({ x: c[0], z: c[1], w, d, dx, dz });
    }
  }

  // Cluster centres spread out over the field.
  for (let i = 0; i < 26; i++) {
    const cx = rng.range(-lim, lim);
    const cz = rng.range(-lim, lim);
    if (Math.hypot(cx, cz) < CLEAR_CENTER + 3) continue;
    const [wr, wc, wt] = biome.clusters;
    const kind = rng.next() * biome.clusters.reduce((a, b) => a + b, 0);
    if (kind < wr) ruin(cx, cz);
    else if (kind < wr + wc) crates(cx, cz);
    else if (kind < wr + wc + wt) grove(cx, cz);
    else rocks(cx, cz);
  }

  // Treasure chests spread over the field, away from the start and from each other.
  for (let i = 0, tries = 0; chests.length < 6 && tries < 60; tries++) {
    const p = spot(1.2, 1.2, 1.2);
    if (!p || Math.hypot(p[0], p[1]) < 14 || chests.some((c) => Math.hypot(c.x - p[0], c.z - p[1]) < 22)) continue;
    chests.push({ x: p[0], z: p[1], facing: rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]) + rng.range(-0.3, 0.3) });
    i++;
  }

  // Loose barrel groups out in the open, so there's always one worth shooting.
  for (let i = 0; i < 10; i++) {
    const c = spot(0.9, 0.9, 0.4);
    if (!c) continue;
    barrel(c);
    for (let k = rng.int(1, 3); k > 0; k--) {
      const p = spot(0.9, 0.9, 0.15, c[0], c[1], 1.6);
      if (p) barrel(p);
    }
  }

  // --- Arena toys (placed last so the layout above stays the same for a given seed) ---
  // Biome hazard patches: quicksand in the dunes, thorn bushes in the meadow.
  const extra = biomeHazard(biome.id);
  if (extra === 'quicksand') {
    const sandMat = createRetroMaterial({ map: textures.clay(), color: '#b98a5a', unlit: 0.15, uvScroll: [0.015, 0.025] });
    const rimMat = createRetroMaterial({ color: '#f2d29a' });
    const eyeMat = createRetroMaterial({ map: textures.clay(), color: '#7a5038', unlit: 0.1, uvScroll: [-0.04, 0.03] });
    for (let i = 0; i < 4; i++) {
      const r = rng.range(2.6, 3.8);
      const c = spot(r * 2, r * 2, 1.5);
      if (!c) continue;
      const rim = new THREE.Mesh(wobblyDisc(rng, r * 1.12, 12), rimMat);
      rim.position.set(c[0], 0.025, c[1]);
      const m = new THREE.Mesh(wobblyDisc(rng, r, 12, r * 0.8), sandMat);
      m.position.set(c[0], 0.04, c[1]);
      // A darker sinking eye in the middle that swirls the other way.
      const eye = new THREE.Mesh(wobblyDisc(rng, r * 0.45, 10, r * 0.4), eyeMat);
      eye.position.set(c[0], 0.05, c[1]);
      group.add(rim, m, eye);
      hazards.push({ x: c[0], z: c[1], r: r * 0.9, kind: 'quicksand' });
    }
  } else if (extra === 'thorns') {
    const bramble = createRetroMaterial({ color: '#38b764' });
    const bramble2 = createRetroMaterial({ color: '#257179' });
    const thorn = createRetroMaterial({ color: '#ff7eb6', unlit: 0.3 });
    const soil = createRetroMaterial({ color: '#6b5a3a' });
    for (let i = 0; i < 5; i++) {
      const r = rng.range(1.8, 2.8);
      const c = spot(r * 2, r * 2, 1.2);
      if (!c) continue;
      const bed = new THREE.Mesh(wobblyDisc(rng, r * 1.05, 10), soil);
      bed.position.set(c[0], 0.03, c[1]);
      group.add(bed);
      for (let k = Math.round(r * 3.5); k > 0; k--) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng.next()) * r * 0.8;
        const s = rng.range(0.8, 1.25);
        const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 * s, 0), k % 3 ? bramble : bramble2);
        bush.position.set(c[0] + Math.cos(a) * d, 0.35 * s, c[1] + Math.sin(a) * d);
        bush.rotation.set(rng.range(0, 1), rng.range(0, 3), 0);
        group.add(bush);
        for (let t = 0; t < 4; t++) {
          const ta = rng.range(0, Math.PI * 2);
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.55 * s, 4), thorn);
          spike.position.set(bush.position.x + Math.cos(ta) * 0.5 * s, bush.position.y + rng.range(-0.05, 0.4) * s, bush.position.z + Math.sin(ta) * 0.5 * s);
          spike.rotation.set(Math.sin(ta) * 1.2, 0, -Math.cos(ta) * 1.2);
          group.add(spike);
        }
      }
      hazards.push({ x: c[0], z: c[1], r: r * 0.95, kind: 'thorns' });
    }
  }
  const inHazard = (x: number, z: number, pad: number) => hazards.some((h) => (x - h.x) ** 2 + (z - h.z) ** 2 < (h.r + pad) ** 2);

  // Toppling pillars: tall, shootable, crush whatever they fall on.
  for (let i = 0; i < 4; i++) {
    const p = spot(1.3, 1.3, 1.4);
    if (!p || Math.hypot(p[0], p[1]) < 12) continue;
    const box = aabbFromCenter(p[0], p[1], 1.2, 1.2);
    colliders.push(box);
    props.push({ kind: 'pillar', x: p[0], z: p[1], w: 1.2, d: 1.2, rot: rng.range(0, Math.PI), rot2: 0, box });
  }

  // Jump pads, each aimed at a clear landing spot 10-15 m away.
  const pads: Arena['pads'] = [];
  for (let tries = 0; pads.length < 3 && tries < 20; tries++) {
    const p = spot(1.8, 1.8, 0.8);
    if (!p || Math.hypot(p[0], p[1]) < 11 || inHazard(p[0], p[1], 1)) continue;
    for (let k = 0; k < 16; k++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(10, 15);
      const tx = p[0] + Math.cos(a) * d;
      const tz = p[1] + Math.sin(a) * d;
      if (Math.abs(tx) > lim || Math.abs(tz) > lim || inHazard(tx, tz, 0.8)) continue;
      if (overlapsAny(aabbFromCenter(tx, tz, 1.6, 1.6), placed, 0.6) || overlapsAny(aabbFromCenter(tx, tz, 1.6, 1.6), colliders, 0.4)) continue;
      pads.push({ x: p[0], z: p[1], tx, tz });
      break;
    }
  }

  // Turret pads.
  const turrets: Arena['turrets'] = [];
  for (let tries = 0; turrets.length < 2 && tries < 20; tries++) {
    const p = spot(1.8, 1.8, 1.2);
    if (!p || Math.hypot(p[0], p[1]) < 10 || inHazard(p[0], p[1], 1) || turrets.some((t) => Math.hypot(t.x - p[0], t.z - p[1]) < 25)) continue;
    turrets.push({ x: p[0], z: p[1] });
  }

  // Objective spots: spread out, away from the start.
  const spots: Arena['spots'] = [];
  for (let tries = 0; spots.length < 8 && tries < 80; tries++) {
    const p = spot(1.4, 1.4, 1.5);
    if (!p || Math.hypot(p[0], p[1]) < 12 || inHazard(p[0], p[1], 1.5) || spots.some((c) => Math.hypot(c.x - p[0], c.z - p[1]) < 14)) continue;
    spots.push({ x: p[0], z: p[1] });
  }

  // --- Neon City / Sky Fortress set dressing (after everything else, so older biomes keep their layouts) ---
  if (neon && deco) {
    // Hologram billboards on twin poles.
    for (let tries = 0; deco.holos.length < 5 && tries < 30; tries++) {
      const p = spot(3.6, 0.8, 1.6);
      if (!p || Math.hypot(p[0], p[1]) < 12) continue;
      const ci = rng.pick([0, 1, 1, 3]);
      for (const ox of [-1.4, 1.4]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.4, 6), darkMat);
        pole.position.set(p[0] + ox, 2.2, p[1]);
        group.add(pole);
      }
      colliders.push(aabbFromCenter(p[0] - 1.4, p[1], 0.4, 0.4), aabbFromCenter(p[0] + 1.4, p[1], 0.4, 0.4));
      const emitter = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 0.3), neonMats[ci]);
      emitter.position.set(p[0], 2.1, p[1]);
      group.add(emitter);
      deco.holos.push({ x: p[0], y: 3.2, z: p[1], w: 3.4, h: 2, color: NEON[ci], rot: rng.range(-0.15, 0.15) });
      deco.lights.push({ x: p[0], y: 3, z: p[1] + 1, r: 7, color: NEON[ci], k: 0.5 });
      reflection(p[0], p[1] + 0.3, 3.4, 4.5, ci);
    }
    // Steam vents: grates in the roof that puff steam.
    const grateMat = createRetroMaterial({ map: biomeTex('grate') });
    for (let tries = 0; deco.vents.length < 9 && tries < 40; tries++) {
      const p = spot(1.6, 1.6, 0.6);
      if (!p || Math.hypot(p[0], p[1]) < 6) continue;
      const g = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 1.3), grateMat);
      g.position.set(p[0], 0.06, p[1]);
      group.add(g);
      deco.vents.push({ x: p[0], z: p[1] });
    }
    // Big signs on the far parapet, and a neon tube along the whole roof edge.
    for (let x = -HALF + 8; x < HALF - 6; x += rng.range(9, 15)) sign(x, 2.2, -HALF + 0.9, 1.6, 2.4, rng.int(0, NEON.length - 1));
    const edgeTube = neonMats[1];
    for (const [x, z, w, d] of [[0, -HALF, HALF * 2, 0.12], [0, HALF, HALF * 2, 0.12], [-HALF, 0, 0.12, HALF * 2], [HALF, 0, 0.12, HALF * 2]]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), edgeTube);
      t.position.set(x, 1.18, z);
      group.add(t);
    }
    // Sign posts out on the roof.
    for (let tries = 0, k = 0; k < 10 && tries < 40; tries++) {
      const p = spot(0.6, 0.6, 1.8);
      if (!p || Math.hypot(p[0], p[1]) < 8) continue;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.2, 6), darkMat);
      pole.position.set(p[0], 1.6, p[1]);
      group.add(pole);
      colliders.push(aabbFromCenter(p[0], p[1], 0.35, 0.35));
      sign(p[0], 2.3, p[1] + 0.12, 0.8, 1.5, rng.int(0, NEON.length - 1));
      k++;
    }
    // Helipad on the central plaza: a glowing ring and an H.
    const padMat = neonMats[2];
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.7, 4, 24).rotateX(-Math.PI / 2), padMat);
    ring.position.y = 0.05;
    group.add(ring);
    for (const [x, z, w, d] of [[-0.9, 0, 0.3, 2.4], [0.9, 0, 0.3, 2.4], [0, 0, 1.8, 0.3]]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), padMat);
      bar.position.set(x, 0.05, z);
      group.add(bar);
    }
    neonSkyline(group, rng, HALF);
  }
  if (sky && deco) {
    for (let tries = 0; deco.flags.length < 12 && tries < 40; tries++) {
      const p = spot(0.6, 0.6, 1.4);
      if (!p || Math.hypot(p[0], p[1]) < 7) continue;
      colliders.push(aabbFromCenter(p[0], p[1], 0.4, 0.4));
      deco.flags.push({ x: p[0], z: p[1], h: 4.2, color: rng.pick(FLAG_COLORS) });
    }
    // Poles (the cloth is animated by src/render/biomeFx.ts).
    const poleMat = createRetroMaterial({ color: '#8a5a3c' });
    const knobMat = createRetroMaterial({ color: '#ffcd75', unlit: 0.2 });
    for (const f of deco.flags) {
      const base = f.h > 4 ? 0 : 3; // flags on pillars stand on the pillar top
      const len = f.h - base + 0.2;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, len, 6), poleMat);
      pole.position.set(f.x, base + len / 2, f.z);
      const knob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), knobMat);
      knob.position.set(f.x, f.h + 0.25, f.z);
      group.add(pole, knob);
      if (!base) {
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.25, 8), brickMat);
        foot.position.set(f.x, 0.12, f.z);
        group.add(foot);
      }
    }
    if (gapMask) skyBridges(group, gapMask, n, poleMat);
    // A layer of loose clouds drifting between the islands and the cloud sea: depth through the chasms.
    const puffGeo = new THREE.PlaneGeometry(400, 400);
    puffGeo.rotateX(-Math.PI / 2);
    const puv = puffGeo.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < puv.count; k++) puv.setXY(k, puv.getX(k) * 20, puv.getY(k) * 20);
    const puffs = new THREE.Mesh(puffGeo, createRetroMaterial({ map: biomeTex('cloudPuffs'), color: '#eef6ff', unlit: 0.6, transparent: true, alphaTest: 0.5, uvScroll: [0.03, 0.012] }));
    puffs.position.y = -6.5;
    group.add(puffs);
    skyIslets(group, rng, HALF, tex.sand, tex.grass, leafMat, trunkMat);
    deco.airships = 3;
  }

  // Hundreds of props -> one draw call per material.
  mergeStatic(group);
  return { group, colliders, halfSize: HALF, barrels, chests, hazards, conveyors, seed, props, pads, turrets, spots, deco };
}

/** Flat disc with a wobbly edge (hazard patches); uvScale tiles its texture. */
function wobblyDisc(rng: Rng, r: number, segments: number, uvScale = 0): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(r, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let k = 1; k < pos.count; k++) {
    const f = rng.range(0.82, 1.08);
    pos.setX(k, pos.getX(k) * f);
    pos.setZ(k, pos.getZ(k) * f);
  }
  if (uvScale) {
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * uvScale, uv.getY(k) * uvScale);
  }
  return geo;
}

/** Neon tube colours: pink, cyan, yellow, violet, mint. */
export const NEON = ['#ff4fd8', '#4ff2ff', '#ffe95e', '#9a7aff', '#5effa0'];
/** Sky Fortress banner colours. */
const FLAG_COLORS = ['#ff4d5e', '#4fc3ff', '#ffcd75', '#a7f070', '#ff7eb6'];

/** Sky Fortress gap mask cells. */
export const GAP_VOID = 1;
export const GAP_BRIDGE = 2;

/**
 * Sky Fortress chasms on the tile grid (0 ground, 1 void, 2 bridge): one
 * channel along each axis, 2 tiles (4 m) wide and 16-28 m off centre, split
 * the field into four islands; every channel half has a 3-tile plank bridge
 * (long halves get two), so the islands always connect; plus a few small
 * pits. The centre stays solid ground. Pure, for tests.
 */
export function skyGaps(rng: Rng, n: number): Uint8Array {
  const m = new Uint8Array(n * n);
  const mid = Math.floor(n / 2);
  const off = () => (rng.chance(0.5) ? 1 : -1) * rng.int(8, 13);
  const cx = mid + off();
  const cz = mid + off();
  for (let t = 0; t < n; t++) {
    m[t * n + cx] = m[t * n + cx + 1] = GAP_VOID;
    m[cz * n + t] = m[(cz + 1) * n + t] = GAP_VOID;
  }
  // Bridge starts per channel half: rows/cols [lo, hi] keep 2 tiles clear of the crossing and the field edge.
  const bridge = (cross: number, set: (t: number) => void) => {
    for (const [lo, hi] of [[2, cross - 4], [cross + 3, n - 5]]) {
      if (hi < lo) continue;
      const a = rng.int(lo, hi);
      for (let k = 0; k < 3; k++) set(a + k);
      if (hi - lo >= 16) {
        const b = a - lo > hi - a ? rng.int(lo, Math.max(lo, a - 8)) : rng.int(Math.min(hi, a + 8), hi);
        if (Math.abs(b - a) >= 6) for (let k = 0; k < 3; k++) set(b + k);
      }
    }
  };
  bridge(cz, (t) => (m[t * n + cx] = m[t * n + cx + 1] = GAP_BRIDGE));
  bridge(cx, (t) => (m[cz * n + t] = m[(cz + 1) * n + t] = GAP_BRIDGE));
  // A few square pits, well clear of the channels, the edge and the centre.
  for (let p = 0, tries = 0; p < 4 && tries < 60; tries++) {
    const w = rng.int(2, 3);
    const d = rng.int(2, 3);
    const x0 = rng.int(4, n - 4 - w);
    const z0 = rng.int(4, n - 4 - d);
    if (Math.hypot(x0 + w / 2 - mid, z0 + d / 2 - mid) < 10) continue;
    let clear = true;
    for (let z = z0 - 3; z < z0 + d + 3 && clear; z++) for (let x = x0 - 3; x < x0 + w + 3 && clear; x++) if (m[z * n + x]) clear = false;
    if (!clear) continue;
    for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) m[z * n + x] = GAP_VOID;
    p++;
  }
  return m;
}

/** Merge void cells into rectangles [tx, tz, w, d] (row runs, extended down while identical). Pure, for tests. */
export function gapRects(m: Uint8Array, n: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  let open = new Map<string, [number, number, number, number]>();
  for (let z = 0; z <= n; z++) {
    const next = new Map<string, [number, number, number, number]>();
    if (z < n) {
      for (let x = 0; x < n; ) {
        if (m[z * n + x] !== GAP_VOID) {
          x++;
          continue;
        }
        const x0 = x;
        while (x < n && m[z * n + x] === GAP_VOID) x++;
        const key = `${x0},${x - x0}`;
        const r = open.get(key);
        if (r) {
          r[3]++;
          open.delete(key);
          next.set(key, r);
        } else next.set(key, [x0, z, x - x0, 1]);
      }
    }
    for (const r of open.values()) out.push(r);
    open = next;
  }
  return out;
}

/** Cell of the gap mask grown by a one-tile rim ring; outside that is open sky. */
function skyCell(m: Uint8Array, n: number, tx: number, tz: number): number {
  if (tx < -1 || tz < -1 || tx > n || tz > n) return GAP_VOID;
  const cx = Math.max(0, Math.min(n - 1, tx));
  const cz = Math.max(0, Math.min(n - 1, tz));
  if (tx === cx && tz === cz) return m[tz * n + tx];
  // Rim ring: open where a chasm runs out to the edge.
  return m[cz * n + cx] === GAP_VOID ? GAP_VOID : 0;
}

/** Sky Fortress island edges: the rim ring tops, and cliff faces wherever ground meets open sky. */
function skyCliffs(group: THREE.Group, m: Uint8Array, n: number, cliff: THREE.Texture, planks: THREE.Texture): void {
  const rim: THREE.BufferGeometry[] = [];
  const faces: THREE.BufferGeometry[] = [];
  const plank: THREE.BufferGeometry[] = [];
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let tz = -1; tz <= n; tz++)
    for (let tx = -1; tx <= n; tx++) {
      const c = skyCell(m, n, tx, tz);
      if (c === GAP_VOID) continue;
      const x = -HALF + tx * TILE + TILE / 2;
      const z = -HALF + tz * TILE + TILE / 2;
      const ring = tx < 0 || tz < 0 || tx >= n || tz >= n;
      if (ring) {
        const g = new THREE.PlaneGeometry(TILE, TILE);
        g.rotateX(-Math.PI / 2);
        g.translate(x, 0, z);
        rim.push(g);
      }
      for (const [dx, dz] of DIRS) {
        if (skyCell(m, n, tx + dx, tz + dz) !== GAP_VOID) continue;
        const bridge = c === GAP_BRIDGE;
        // Shallow slabs: looking down a chasm you see the clouds far below, not a pit.
        const depth = bridge ? 0.4 : ring || tx + dx < 0 || tz + dz < 0 || tx + dx >= n || tz + dz >= n ? 3.6 : 2.4;
        const g = new THREE.PlaneGeometry(TILE, depth);
        const uv = g.getAttribute('uv') as THREE.BufferAttribute;
        for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (1 - uv.getY(k)) * (depth / TILE));
        g.rotateY(Math.atan2(dx, dz));
        g.translate(x + (dx * TILE) / 2, -depth / 2 + 0.01, z + (dz * TILE) / 2);
        (bridge ? plank : faces).push(g);
      }
    }
  const add = (geos: THREE.BufferGeometry[], map: THREE.Texture, color = '#ffffff') => {
    if (!geos.length) return;
    const g = mergeGeometries(geos);
    // Cliffs darken with depth (vertex colours), so chasms read as deep.
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) col.fill(Math.max(0.4, 1 + pos.getY(k) * 0.17), k * 3, k * 3 + 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    group.add(new THREE.Mesh(g, createRetroMaterial({ map, color, vertexColors: true })));
  };
  add(rim, cliff, '#d8d0f0');
  add(faces, cliff);
  add(plank, planks, '#b07a50');
}

/** Rope rails along the sides of the Sky Fortress bridges (decoration, not solid). */
function skyBridges(group: THREE.Group, m: Uint8Array, n: number, mat: THREE.Material): void {
  for (let tz = 0; tz < n; tz++)
    for (let tx = 0; tx < n; tx++) {
      if (m[tz * n + tx] !== GAP_BRIDGE) continue;
      const x = -HALF + tx * TILE + TILE / 2;
      const z = -HALF + tz * TILE + TILE / 2;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (skyCell(m, n, tx + dx, tz + dz) !== GAP_VOID) continue;
        const ex = x + (dx * TILE) / 2 - dx * 0.15;
        const ez = z + (dz * TILE) / 2 - dz * 0.15;
        const rail = new THREE.Mesh(new THREE.BoxGeometry(dz ? TILE : 0.08, 0.08, dx ? TILE : 0.08), mat);
        rail.position.set(ex, 0.75, ez);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.8, 5), mat);
        post.position.set(ex - (dz ? TILE / 2 : 0), 0.4, ez - (dx ? TILE / 2 : 0));
        group.add(rail, post);
      }
    }
}

/** Little floating islands drifting in the distance around the fortress (static backdrop). */
function skyIslets(group: THREE.Group, rng: Rng, half: number, cliff: THREE.Texture, grass: THREE.Texture, leaf: THREE.Material, trunk: THREE.Material): void {
  const rock = createRetroMaterial({ map: cliff });
  const top = createRetroMaterial({ map: grass });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const d = half + rng.range(16, 42);
    const r = rng.range(2.5, 6);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    // Keep the camera side low so islets never cover the field.
    const y = z > half ? rng.range(-9, -5) : rng.range(-6, 1);
    const body = new THREE.Mesh(new THREE.ConeGeometry(r, r * 1.6, 6), rock);
    body.rotation.x = Math.PI;
    body.position.set(x, y - r * 0.8, z);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.95, 0.4, 6), top);
    cap.position.set(x, y + 0.2, z);
    group.add(body, cap);
    if (rng.chance(0.6)) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.4, 6), trunk);
      t.position.set(x, y + 1.1, z);
      const l = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), leaf);
      l.position.set(x, y + 2.3, z);
      group.add(t, l);
    }
  }
}

/** Neon City skyline: towers of lit windows around the roof, low on the camera side so they never hide the fight. */
function neonSkyline(group: THREE.Group, rng: Rng, half: number): void {
  const win = createRetroMaterial({ map: biomeTex('windows'), unlit: 0.55 });
  const roofMat = createRetroMaterial({ color: '#1e1e40' });
  const blink = createRetroMaterial({ color: '#ff4d5e', unlit: 1 });
  const towers: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2 + rng.range(-0.05, 0.05);
    const d = half + rng.range(9, 30);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const w = rng.range(6, 12);
    const dd = rng.range(6, 12);
    // Camera side (+Z): rooftops below ours; far side: tall towers.
    const top = z > half * 0.6 ? rng.range(-8, -2) : z > -half * 0.4 ? rng.range(-4, 6) : rng.range(4, 22);
    const h = top + 30;
    const g = tiledBox(w, h, dd, 3);
    g.translate(x, top - h / 2, z);
    towers.push(g);
    const r = new THREE.Mesh(new THREE.BoxGeometry(w - 0.6, 0.3, dd - 0.6), roofMat);
    r.position.set(x, top + 0.15, z);
    group.add(r);
    if (top > 6 && rng.chance(0.6)) {
      const ant = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 0.2), roofMat);
      ant.position.set(x, top + 1.5, z);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), blink);
      lamp.position.set(x, top + 3.1, z);
      group.add(ant, lamp);
    }
  }
  group.add(new THREE.Mesh(mergeGeometries(towers), win));
}
