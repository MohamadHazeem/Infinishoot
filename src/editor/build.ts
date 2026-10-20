/**
 * Custom arena -> playable Arena (editor lane). The island field, biome look,
 * cover, crates, barrels, pillars, quicksand/thorn patches and jump pads come
 * from the normal generator's authored-layout API (src/world/fieldArena.ts,
 * the same path PvP arenas use), so pieces look and behave exactly like the
 * generated ones. On top of that this adds what that API has no call for: lava,
 * ice and water patches in any biome, conveyor belts, turret pads, chest spots,
 * a fence for the smaller size presets and flat decals for the boss and enemy
 * gate markers. Same data + seed = same arena on every co-op machine; the seed
 * only varies looks (rock shapes, tree sizes).
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { biomeByKey } from '../data/biomes';
import { createFieldArena, type Arena, type ArenaLayoutApi } from '../world/fieldArena';
import { aabbFromCenter, overlapsAny, type AABB } from '../world/collision';
import { createRetroMaterial } from '../render/retroMaterial';
import { biomeTex } from '../render/biomeTextures';
import { textures } from '../render/textures';
import { tiledBox } from '../render/geometry';
import { mergeStatic } from '../render/mergeStatic';
import type { HazardKind } from '../game/hazards';
import { SIZE_HALF, beltOf, hazardRadius, padTarget, type CustomArena } from './arenaData';
import { dirOf, footprint } from './pieces';

/** Game-side hazard radius as a share of the drawn patch (the soft rim doesn't hurt). */
export const HAZARD_FRAC = 0.9;
/** Objective spots generated for stage objectives (totems, shards, beacon). */
const SPOTS = 8;

/** Lay out the solid and generator-backed pieces through the authored-layout API. */
export function layoutPieces(a: CustomArena, api: ArenaLayoutApi): void {
  for (const p of a.pieces) {
    const f = footprint(p.k, p.r);
    switch (p.k) {
      case 'wall':
        api.wall(p.x, p.z, f.w, f.d, 1.6);
        break;
      case 'longwall':
        api.wall(p.x, p.z, f.w, f.d, 2.2);
        break;
      case 'block':
        api.wall(p.x, p.z, f.w, f.d, 1.2);
        break;
      case 'pillar':
        api.pillar(p.x, p.z);
        break;
      case 'topple':
        api.topple(p.x, p.z);
        break;
      case 'rock':
        api.rock(p.x, p.z, 1.1);
        break;
      case 'tree':
        api.tree(p.x, p.z);
        break;
      case 'crate':
        api.crate(p.x, p.z, false);
        break;
      case 'stack':
        api.crate(p.x, p.z, true);
        break;
      case 'barrel':
        api.barrel(p.x, p.z);
        break;
      case 'sand':
        api.patch('quicksand', p.x, p.z, hazardRadius(p));
        break;
      case 'thorns':
        api.patch('thorns', p.x, p.z, hazardRadius(p));
        break;
      case 'pad': {
        const t = padTarget(p);
        api.pad(p.x, p.z, t.x, t.z);
        break;
      }
    }
  }
}

function disc(rng: Rng, r: number, uv: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, 14);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let k = 1; k < pos.count; k++) {
    const f = rng.range(0.9, 1.06);
    pos.setX(k, pos.getX(k) * f);
    pos.setZ(k, pos.getZ(k) * f);
  }
  const u = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let k = 0; k < u.count; k++) u.setXY(k, u.getX(k) * uv, u.getY(k) * uv);
  return g;
}

function flat(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rotY = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  return m;
}

/** Build the playable arena for a custom layout. */
export function buildCustomArena(a: CustomArena, seed: number): Arena {
  const biome = biomeByKey(a.rules.biome);
  const half = SIZE_HALF[a.size];
  const arena = createFieldArena(seed, biome, { layout: (api) => layoutPieces(a, api) });
  const rng = new Rng((seed ^ 0x5eed1e) >>> 0);
  const extra = new THREE.Group();
  const lavaMat = createRetroMaterial({ map: biomeTex('lava'), unlit: 1, uvScroll: [0.03, 0.02] });
  const iceMat = createRetroMaterial({ map: biomeTex('ice'), unlit: 0.3 });
  const waterMat = createRetroMaterial({ map: biomeTex('water'), unlit: 0.35, uvScroll: [0.02, 0.01] });
  const rimMat = createRetroMaterial({ color: '#333c57' });
  const water: { x: number; z: number; r: number }[] = [];

  for (const p of a.pieces) {
    const R = hazardRadius(p);
    if (p.k === 'lava' || p.k === 'ice' || p.k === 'water') {
      extra.add(flat(disc(rng, R * 1.06, 0), rimMat, p.x, 0.025, p.z));
      extra.add(flat(disc(rng, R, R * 0.8), p.k === 'lava' ? lavaMat : p.k === 'ice' ? iceMat : waterMat, p.x, 0.035, p.z));
      if (p.k === 'water') water.push({ x: p.x, z: p.z, r: R * HAZARD_FRAC });
      else arena.hazards.push({ x: p.x, z: p.z, r: R * HAZARD_FRAC, kind: p.k });
    } else if (p.k === 'belt') {
      const b = beltOf(p);
      const len = Math.max(b.w, b.d);
      const wid = Math.min(b.w, b.d);
      const geo = new THREE.PlaneGeometry(wid, len);
      geo.rotateX(-Math.PI / 2);
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (wid / 2), uv.getY(k) * (len / 2));
      const mat = createRetroMaterial({ map: textures.conveyor(), unlit: 0.3, uvScroll: [0, 1.6] });
      // Same orientation rule as the generator: chevrons point along (dx, dz).
      extra.add(flat(geo, mat, b.x, 0.035, b.z, Math.atan2(b.dx, b.dz) + Math.PI));
      arena.conveyors.push(b);
    } else if (p.k === 'turret') {
      arena.turrets.push({ x: p.x, z: p.z });
    } else if (p.k === 'chest') {
      arena.chests.push({ x: p.x, z: p.z, facing: (p.r * Math.PI) / 2 });
    }
  }
  // Water last: hazard lookups return the first zone, so ponds never hide lava or ice under them.
  for (const w of water) arena.hazards.push({ x: w.x, z: w.z, r: w.r, kind: 'water' as HazardKind });

  // Marker decals: a red ring where the boss lands, violet portals where enemies pour in.
  const bossMat = createRetroMaterial({ color: '#b13e53', unlit: 0.6 });
  const gateMat = createRetroMaterial({ color: '#5d275d', unlit: 0.5 });
  const gateGlow = createRetroMaterial({ color: '#b13e53', unlit: 1 });
  for (const p of a.pieces) {
    if (p.k === 'boss') {
      extra.add(flat(new THREE.RingGeometry(2.6, 3, 24).rotateX(-Math.PI / 2), bossMat, p.x, 0.04, p.z));
      extra.add(flat(new THREE.RingGeometry(1.2, 1.4, 4).rotateX(-Math.PI / 2), bossMat, p.x, 0.04, p.z, Math.PI / 4));
    } else if (p.k === 'gate') {
      extra.add(flat(new THREE.CircleGeometry(0.95, 10).rotateX(-Math.PI / 2), gateMat, p.x, 0.04, p.z));
      const d = dirOf(p.r);
      const arrow = new THREE.CircleGeometry(0.42, 3).rotateX(-Math.PI / 2);
      extra.add(flat(arrow, gateGlow, p.x + d.x * 0.35, 0.05, p.z + d.z * 0.35, Math.atan2(d.x, d.z) - Math.PI / 2));
    }
  }

  // Smaller presets: a fence of the biome's wall at the edge (not cover: Rex can't smash a way out).
  if (half < SIZE_HALF.xl) {
    const brick = createRetroMaterial({ map: biomeTex(biome.wall), color: biome.wallTint });
    const cap = createRetroMaterial({ color: biome.capColor });
    const h = 1.3;
    const L = half * 2;
    for (const [x, z, w, d] of [[0, -half + 0.5, L, 1], [0, half - 0.5, L, 1], [-half + 0.5, 0, 1, L - 2], [half - 0.5, 0, 1, L - 2]] as const) {
      const m = new THREE.Mesh(tiledBox(w, h, d, 2), brick);
      m.position.set(x, h / 2, z);
      const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.2, d + 0.2), cap);
      top.position.y = h / 2 + 0.1;
      m.add(top);
      extra.add(m);
      arena.colliders.push(aabbFromCenter(x, z, w, d));
    }
  }

  mergeStatic(extra);
  arena.group.add(extra);

  // Objective spots: open ground spread out over the arena, away from the hero spawns.
  const heroes = a.pieces.filter((p) => p.k === 'hero');
  const solid: AABB[] = arena.colliders;
  const lim = half - 4;
  for (let tries = 0; arena.spots.length < SPOTS && tries < 160; tries++) {
    const x = Math.round(rng.range(-lim, lim));
    const z = Math.round(rng.range(-lim, lim));
    if (overlapsAny(aabbFromCenter(x, z, 1.4, 1.4), solid, 1.5)) continue;
    if (arena.hazards.some((hz) => (hz.x - x) ** 2 + (hz.z - z) ** 2 < (hz.r + 1.5) ** 2)) continue;
    if (heroes.some((h) => Math.hypot(h.x - x, h.z - z) < Math.min(10, half * 0.35))) continue;
    if (arena.spots.some((s) => Math.hypot(s.x - x, s.z - z) < Math.min(12, half * 0.4))) continue;
    arena.spots.push({ x, z });
  }
  arena.halfSize = half;
  return arena;
}
