import * as THREE from 'three';
import { Rng } from '../core/rng';
import { createRetroMaterial } from '../render/retroMaterial';
import { viewCull } from '../render/viewCull';
import { DECK, along, underpass, siteX, siteZ, type HeightField, type HeightSite } from './height';
import type { Game } from '../game/game';

/** A single static mesh. Each box contributes its visible faces to the stage buffer directly. */
export function buildHeightRoutes(group: THREE.Group, field: HeightField, seed: number) {
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  const tint = new THREE.Color();
  const grates = new Map<HeightSite, { start: number; indices: number[] }>();
  // A box vertex uses bit 0 for +U, bit 1 for +Y and bit 2 for +V.
  const faces = [
    [0, 4, 6, 2],
    [1, 3, 7, 5],
    [2, 6, 7, 3],
    [0, 1, 5, 4],
    [0, 2, 3, 1],
    [4, 5, 7, 6],
  ];
  for (const s of field.sites) {
    const part = (
      u: number,
      v: number,
      y: number,
      length: number,
      width: number,
      height: number,
      color: string,
      slope = false,
    ) => {
      tint.set(color);
      for (const face of faces) {
        const base = positions.length / 3;
        for (const vertex of face) {
          const du = vertex & 1 ? length / 2 : -length / 2;
          const dv = vertex & 4 ? width / 2 : -width / 2;
          const lift = slope && vertex & 2 && vertex & 1 ? DECK : 0;
          positions.push(
            siteX(s, u + du, v + dv),
            y + (vertex & 2 ? height / 2 : -height / 2) + lift,
            siteZ(s, u + du, v + dv),
          );
          colors.push(tint.r, tint.g, tint.b);
        }
        if (s.cross) indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
        else indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    };
    part(-3, 0, 0, 4, 4, 0.08, '#41a6a4', true);
    for (let u = -4.5; u < -1; u += 0.8)
      part(u, 0, ((u + 5) * DECK) / 4 + 0.05, 0.16, 3.5, 0.08, '#a7f070');
    const start = s.bridge ? 3 : -1;
    part((start + 5) / 2, 0, DECK / 2, 5 - start, 4, DECK, '#496478');
    part((start + 5) / 2, 0, DECK - 0.13, 5 - start, 4.05, 0.26, '#73c6be');
    if (s.bridge) {
      // Open grating leaves the crossing hero and enemy-shot outlines visible below.
      for (const side of [-1, 1]) {
        part(1, side * 1.68, DECK - 0.14, 4, 0.62, 0.28, '#41a6a4');
        part(1, side * 1.94, DECK - 0.38, 4, 0.12, 0.14, '#ffcd75');
      }
      const start = indices.length;
      for (let u = -0.82; u < 3; u += 0.56) part(u, 0, DECK - 0.09, 0.19, 3.4, 0.18, '#94b0c2');
      grates.set(s, { start, indices: indices.slice(start) });
    }
    for (const side of [-1, 1]) {
      for (const u of [-1, 1.7, 4.6]) {
        part(u, side * 1.95, DECK + 0.22, 0.22, 0.24, 0.46, '#36536a');
        part(u, side * 1.95, DECK + 0.48, 0.27, 0.27, 0.1, '#ffcd75');
      }
      part(1.8, side * 1.95, DECK + 0.35, 5.6, 0.1, 0.1, '#94b0c2');
    }
    // Twin gold chevrons mark the open drop and the matching pad landing.
    for (const u of [3.6, 4.3])
      for (const sign of [-1, 1])
        for (let i = 0; i < 3; i++)
          part(u - i * 0.13, sign * i * 0.25, DECK + 0.03, 0.25, 0.29, 0.05, '#ffcd75');
  }
  // Three consumes Math.random for UUIDs. Isolate these synchronous cosmetic allocations from combat replays.
  const gameplayRandom = Math.random,
    visualRandom = new Rng(seed ^ 0x56acb31);
  try {
    Math.random = () => visualRandom.next();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const routes = new THREE.Mesh(
      geometry,
      createRetroMaterial({ vertexColors: true, unlit: 0.37 }),
    );
    group.add(routes);
    const index = geometry.index!;
    let open: HeightSite | undefined;
    return (x: number, z: number, y: number) => {
      // The combined mesh spans the arena even when all individual routes are offscreen.
      routes.visible = false;
      for (const site of field.sites) {
        if (viewCull.sphere(site.x, DECK / 2, site.z, 5.8)) {
          routes.visible = true;
          break;
        }
      }
      let next = field.site(x, z);
      if (next && (y > 1 || !underpass(next, along(next, x, z)))) next = undefined;
      if (next === open) return;
      if (open) {
        const r = grates.get(open)!;
        index.array.set(r.indices, r.start);
        index.addUpdateRange(r.start, r.indices.length);
      }
      if (next) {
        const r = grates.get(next)!;
        index.array.fill(0, r.start, r.start + r.indices.length);
        index.addUpdateRange(r.start, r.indices.length);
      }
      index.needsUpdate = true;
      open = next;
    };
  } finally {
    Math.random = gameplayRandom;
  }
}

const footMarkers = new WeakMap<Game, THREE.Object3D>();
export function drawFloors(g: Game) {
  for (const h of g.heroes) {
    if (h.left) continue;
    h.player.rig.root.position.y += h.floorY;
    h.floorShadow.position.y = 0.02 + h.floorY;
  }
  const h = g.hero;
  if (!h) return;
  g.arena.heightCutaway?.(h.player.x, h.player.z, h.floorY);
  if (!h.floorY) return;
  let marker = footMarkers.get(g);
  if (!marker) {
    // The local readability ring is scene-owned and draws above the terrain.
    marker = g.scene.children.find(
      (o) => o.renderOrder === 90 && (o as THREE.Mesh).geometry?.type === 'RingGeometry',
    );
    if (marker) footMarkers.set(g, marker);
  }
  if (marker) marker.position.y = h.floorY + 0.09;
}
