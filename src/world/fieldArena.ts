import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import { createRetroMaterial } from '../render/retroMaterial';
import { textures } from '../render/textures';
import { biomeTextures } from '../render/biomeTextures';
import { paint, tiledBox } from '../render/geometry';
import { mergeStatic } from '../render/mergeStatic';
import { aabbFromCenter, overlapsAny, type AABB } from './collision';
import { BIOMES, type BiomeDef } from '../data/biomes';
import { biomeHazard, crusherTuning, windTuning, type HazardZone } from '../game/hazards';
import { buildBlockWall, buildBlossom, buildDecor, buildRock, buildToyTree, buildUnderside, edgeGeometry, tileTint, type ArenaAnim } from './biomeProps';

type AnyTex = keyof typeof textures | keyof typeof biomeTextures;
/** A texture by key from either texture set. */
export function biomeTex(key: AnyTex): THREE.Texture {
  return key in biomeTextures ? biomeTextures[key as keyof typeof biomeTextures]() : textures[key as keyof typeof textures]();
}

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
  /** Conveyor belts (and Sky Ruins wind lanes): axis-aligned strips that carry anything on them along (dx, dz) at `speed` m/s (default CONVEYOR_SPEED). */
  conveyors: { x: number; z: number; w: number; d: number; dx: number; dz: number; speed?: number; kind?: 'belt' | 'wind' }[];
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
  /** Cosmetic scenery animated locally each frame (spinning gears, bobbing islets): src/world/worldRender.ts. */
  anim: ArenaAnim[];
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

  const grassTiles: THREE.BufferGeometry[] = [];
  const pathTiles: THREE.BufferGeometry[] = [];
  for (let tz = 0; tz < n; tz++) {
    for (let tx = 0; tx < n; tx++) {
      const g = new THREE.PlaneGeometry(TILE, TILE);
      g.rotateX(-Math.PI / 2);
      g.translate(-HALF + tx * TILE + TILE / 2, 0, -HALF + tz * TILE + TILE / 2);
      const v = ((tx + tz) % 2 === 0 ? 1 : 0.94) * rng.range(0.96, 1.04);
      // Play-mat floors pick a colour per tile from a hash (no rng: the seeded layout stays the same).
      paint(g, biome.tileColors && !isPath[tz * n + tx] ? tileTint(biome.tileColors, tx, tz, v) : new THREE.Color(v, v, v));
      (isPath[tz * n + tx] ? pathTiles : grassTiles).push(g);
    }
  }
  group.add(
    new THREE.Mesh(mergeGeometries(grassTiles), createRetroMaterial({ map: tex.grass, vertexColors: true, color: biome.groundTint })),
    new THREE.Mesh(mergeGeometries(pathTiles), createRetroMaterial({ map: tex.path, vertexColors: true, color: biome.pathTint })),
  );

  // --- Island base and sea ---
  const depth = biome.depth ?? 1.4;
  const base = new THREE.Mesh(tiledBox(HALF * 2 + 4, depth, HALF * 2 + 4, 2), createRetroMaterial({ map: tex.sand }));
  base.position.y = -depth / 2 - 0.02;
  group.add(base);
  // Floating islands hang rocky roots under their cliffs (own rng: the layout below stays the same).
  if (depth > 3) buildUnderside(group, new Rng(seed ^ 0x5eed0f), HALF + 2, depth, tex.sand);
  const seaGeo = new THREE.PlaneGeometry(400, 400, 20, 20);
  seaGeo.rotateX(-Math.PI / 2);
  const seaUv = seaGeo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < seaUv.count; i++) seaUv.setXY(i, seaUv.getX(i) * 100, seaUv.getY(i) * 100);
  const sea = new THREE.Mesh(seaGeo, createRetroMaterial({ map: tex.water, uvScroll: biome.sea.scroll, unlit: biome.sea.unlit, color: biome.sea.tint }));
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
  const bushes = new THREE.InstancedMesh(edgeGeometry(biome.edge.shape), createRetroMaterial({ map: tex.edge }), hedge.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const greens = biome.edge.colors.map((c) => new THREE.Color(c));
  hedge.forEach(([x, z], i) => {
    const s = rng.range(0.8, 1.25);
    q.setFromEuler(e.set(0, rng.range(0, Math.PI), 0));
    if (biome.edge.shape === 'cloud') m4.compose(new THREE.Vector3(x, 0.15 * s, z), q, new THREE.Vector3(s * 1.5, s * 0.7, s * 1.5));
    else m4.compose(new THREE.Vector3(x, 0.4 * s, z), q, new THREE.Vector3(s, s * 0.85, s));
    bushes.setMatrixAt(i, m4);
    bushes.setColorAt(i, rng.pick(greens));
  });
  group.add(bushes);

  // --- Sparse cover clusters ---
  const placed: AABB[] = [];
  const lim = HALF - 5;
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
  const rockTex = biome.rock === 'block' ? biomeTextures.abcBlock() : null;
  // Crystals glow faintly (they light up night remixes).
  const rockMats = biome.rockColors.map((c) => createRetroMaterial({ color: c, map: rockTex, unlit: biome.rock === 'crystal' ? 0.55 : 0 }));
  const leafMat = createRetroMaterial({ map: tex.leaves, color: biome.leafTint });
  const blockTex = biome.wallStyle === 'blocks' || biome.tree === 'toy' ? biomeTextures.blockFace() : null;
  const blockMats = (biome.blockColors ?? []).map((c) => createRetroMaterial({ map: blockTex, color: c }));
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
      if (biome.wallStyle === 'blocks' && blockMats.length) {
        // Toy Factory: a wall of stacked building blocks with studs on top.
        const wall = buildBlockWall(rng, w, h, d, blockMats);
        wall.position.set(p[0], 0, p[1]);
        solid(wall, p[0], p[1], w, d);
        continue;
      }
      const wall = new THREE.Mesh(tiledBox(w, h, d, 2), brickMat);
      wall.position.set(p[0], h / 2, p[1]);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.2, d + 0.2), capMat);
      cap.position.y = h / 2 + 0.1;
      wall.add(cap);
      solid(wall, p[0], p[1], w, d);
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
    } else if (biome.tree === 'toy') {
      buildToyTree(g, rng, s, blockMats.length ? blockMats : [leafMat], trunkMat);
    } else if (biome.tree === 'blossom') {
      buildBlossom(g, rng, s, leafMat, trunkMat, capMat);
    } else if (biome.tree === 'pine') {
      add(new THREE.CylinderGeometry(0.2, 0.28, 1.0, 6), trunkMat, 0, 0.5, 0);
      for (let k = 0; k < 3; k++) {
        const r = (1.4 - k * 0.35) * s;
        add(new THREE.ConeGeometry(r, 1.4 * s, 7), leafMat, 0, 1.3 + k * 0.95 * s, 0, 0, k * 0.4);
      }
      add(new THREE.ConeGeometry(0.35 * s, 0.5 * s, 7), snowMat, 0, 1.3 + 2.45 * s, 0);
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
      if (biome.rock && biome.rock !== 'stone') {
        solid(buildRock(biome.rock, rng, r, p[0], p[1], rockMats, capMat, trunkMat), p[0], p[1], r * 1.5, r * 1.5);
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
  const belts = biome.belts ?? opts.conveyors ?? 0;
  if (belts) {
    const beltTex = textures.conveyor();
    for (let i = 0; i < belts; i++) {
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
  } else if (extra === 'crusher') {
    // Toy Factory crusher stamps: striped pads; the press itself is drawn by src/world/worldRender.ts.
    const padMat = createRetroMaterial({ map: biomeTextures.stampPad(), unlit: 0.15 });
    const R = crusherTuning.radius;
    for (let i = 0; i < crusherTuning.count; i++) {
      const c = spot(R * 2 + 1, R * 2 + 1, 2);
      if (!c || Math.hypot(c[0], c[1]) < 13) continue;
      const geo = new THREE.PlaneGeometry(R * 2.1, R * 2.1);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, padMat);
      m.position.set(c[0], 0.03, c[1]);
      group.add(m);
      hazards.push({ x: c[0], z: c[1], r: R, kind: 'crusher' });
    }
  }
  // Sky Ruins wind lanes: wide strips where the wind pushes heroes and enemies along.
  if (biome.windLanes) {
    const streak = biomeTextures.windStreak();
    for (let i = 0; i < biome.windLanes; i++) {
      const alongX = rng.chance(0.5);
      const len = rng.range(16, 24);
      const wid = windTuning.width;
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
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (wid / 3), uv.getY(k) * (len / 3));
      const m = new THREE.Mesh(geo, createRetroMaterial({ map: streak, unlit: 0.6, alphaTest: 0.5, transparent: true, uvScroll: [0, 1.4] }));
      m.rotation.y = Math.atan2(dx, dz) + Math.PI;
      m.position.set(c[0], 0.05, c[1]);
      m.renderOrder = 1;
      group.add(m);
      conveyors.push({ x: c[0], z: c[1], w, d, dx, dz, speed: windTuning.speed, kind: 'wind' });
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

  // Hundreds of props -> one draw call per material.
  mergeStatic(group);
  // Animated scenery stays out of the merge (and off the layout rng).
  const anim = biome.decor ? buildDecor(biome.decor, group, new Rng(seed ^ 0xdec0), HALF, colliders) : [];
  return { group, colliders, halfSize: HALF, barrels, chests, hazards, conveyors, seed, props, pads, turrets, spots, anim };
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
