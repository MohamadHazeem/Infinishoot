import * as THREE from 'three';
import { Rng } from '../core/rng';
import { createRetroMaterial } from '../render/retroMaterial';
import { mergeStatic } from '../render/mergeStatic';

/**
 * Boss arenas: when a boss lands, the ground around it is dressed for that
 * boss, then cleaned up after the fight. Purely cosmetic and built locally on
 * every machine from the boss id and where it was first seen, so co-op needs
 * no messages. Nothing here is solid: the dressing never blocks an escape.
 *   king   a royal arena: carpet ring with a gold border, short banner posts
 *   rex    cracked ground, scattered bones and a rib cage
 *   queen  honeycomb floor with honey puddles and wax lumps
 *   omega  a tech platform: concentric glowing rings, grid lines and pylons
 */
export const bossDressingTuning = {
  /** Radius of the dressed area (m). */
  radius: 11,
  /** Seconds to rise when the boss lands, and to sink after it dies. */
  rise: 1.2,
  sink: 1.6,
  /** Seconds without a boss before the dressing goes. */
  linger: 1.5,
};

export interface Dressing {
  id: string;
  /** Flat floor pieces: grow out from the centre. */
  floor: THREE.Group;
  /** Upright pieces: rise out of the ground. */
  props: THREE.Group;
  /** Optional pieces that turn slowly (Omega's rings). */
  spin: THREE.Object3D | null;
}

type Blocked = (x: number, z: number, r: number) => boolean;

function flat(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, z: number, y: number, rot = 0): THREE.Mesh {
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = rot;
  return m;
}

function put(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

/** Build the dressing for a boss (`id` is its enemy def id) centred on (cx, cz). Returns null for unknown bosses. */
export function buildDressing(id: string, cx: number, cz: number, blocked: Blocked, seed = 1): Dressing | null {
  const R = bossDressingTuning.radius;
  const rng = new Rng(((Math.round(cx * 10) * 73856093) ^ (Math.round(cz * 10) * 19349663) ^ seed) >>> 0);
  const floor = new THREE.Group();
  const props = new THREE.Group();
  let spin: THREE.Object3D | null = null;
  /** World spot (cx + x, cz + z) clear of walls? */
  const clear = (x: number, z: number, r: number) => !blocked(cx + x, cz + z, r);

  if (id === 'king') {
    const carpet = createRetroMaterial({ color: '#b13e53', unlit: 0.15 });
    const gold = createRetroMaterial({ color: '#ffcd75', unlit: 0.2 });
    const stone = createRetroMaterial({ color: '#f4f4f4' });
    floor.add(flat(new THREE.RingGeometry(R - 1.6, R, 40), carpet, 0, 0, 0.045));
    floor.add(flat(new THREE.RingGeometry(R, R + 0.35, 40), gold, 0, 0, 0.046));
    floor.add(flat(new THREE.RingGeometry(R - 1.95, R - 1.6, 40), gold, 0, 0, 0.046));
    // Crown emblem in the middle: a gold ring with five points.
    floor.add(flat(new THREE.RingGeometry(1.6, 2.1, 24), gold, 0, 0, 0.047));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      floor.add(flat(new THREE.CircleGeometry(0.55, 3), gold, Math.cos(a) * 2.5, Math.sin(a) * 2.5, 0.047, -a));
    }
    // Banner posts round the ring (short: decoration, not cover).
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.15;
      const x = Math.cos(a) * (R + 1.2);
      const z = Math.sin(a) * (R + 1.2);
      if (!clear(x, z, 0.8)) continue;
      props.add(put(new THREE.CylinderGeometry(0.35, 0.42, 1.6, 8), stone, x, 0.8, z));
      props.add(put(new THREE.BoxGeometry(0.9, 0.22, 0.9), gold, x, 1.7, z));
      props.add(put(new THREE.BoxGeometry(0.08, 1.1, 0.7), carpet, x, 2.4, z, 0, -a));
    }
  } else if (id === 'rex') {
    const crack = createRetroMaterial({ color: '#333c57' });
    const crackHot = createRetroMaterial({ color: '#ef7d57', unlit: 0.8 });
    const bone = createRetroMaterial({ color: '#f4ead8' });
    // Cracks radiating out from the landing spot, glowing a little at the core.
    for (let k = 0; k < 9; k++) {
      let a = (k / 9) * Math.PI * 2 + rng.range(-0.2, 0.2);
      let x = 0;
      let z = 0;
      for (let s = 0; s < 5; s++) {
        const len = rng.range(1.4, 2.6);
        const nx = x + Math.cos(a) * len;
        const nz = z + Math.sin(a) * len;
        const w = 0.32 - s * 0.05;
        const g = new THREE.PlaneGeometry(w, len);
        floor.add(flat(g, s < 2 ? crackHot : crack, (x + nx) / 2, (z + nz) / 2, 0.045 + s * 0.0005, -a + Math.PI / 2));
        x = nx;
        z = nz;
        a += rng.range(-0.5, 0.5);
      }
    }
    // Bones: a shaft with knobbly ends, scattered.
    for (let k = 0; k < 14; k++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(3, R + 1);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (!clear(x, z, 0.6)) continue;
      const L = rng.range(0.8, 1.5);
      const b = new THREE.Group();
      b.position.set(x, 0.13, z);
      b.rotation.y = rng.range(0, Math.PI);
      b.add(put(new THREE.CylinderGeometry(0.09, 0.09, L, 6), bone, 0, 0, 0, 0, 0, Math.PI / 2));
      for (const sgn of [-1, 1]) b.add(put(new THREE.SphereGeometry(0.16, 6, 4), bone, (sgn * L) / 2, 0, 0));
      props.add(b);
    }
    // A big rib cage half buried at the edge.
    for (let tries = 0; tries < 6; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const x = Math.cos(a) * (R - 1);
      const z = Math.sin(a) * (R - 1);
      if (!clear(x, z, 2.2)) continue;
      for (let k = 0; k < 4; k++) {
        const rib = new THREE.TorusGeometry(1.2 - k * 0.12, 0.1, 4, 10, Math.PI);
        props.add(put(rib, bone, x + Math.cos(a + Math.PI / 2) * (k - 1.5) * 0.55, 0, z + Math.sin(a + Math.PI / 2) * (k - 1.5) * 0.55, 0, -a + Math.PI / 2, 0));
      }
      props.add(put(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 6), bone, x, 0.1, z, Math.PI / 2, -a));
      break;
    }
  } else if (id === 'queen') {
    const wax = createRetroMaterial({ color: '#ffcd75', unlit: 0.1 });
    const waxDark = createRetroMaterial({ color: '#e0a040', unlit: 0.1 });
    const honey = createRetroMaterial({ color: '#ffb627', unlit: 0.45, uvScroll: [0, 0] });
    // Honeycomb: hexagon rings on a hex grid, thinning out toward the edge.
    const s = 1.25;
    for (let q = -9; q <= 9; q++)
      for (let r = -9; r <= 9; r++) {
        const x = s * 1.5 * q;
        const z = s * Math.sqrt(3) * (r + q / 2);
        const d = Math.hypot(x, z);
        if (d > R || rng.next() < (d / R) * 0.55) continue;
        floor.add(flat(new THREE.RingGeometry(s * 0.72, s * 0.98, 6), (q + r) % 3 ? wax : waxDark, x, z, 0.045, Math.PI / 6));
        if (rng.chance(0.18)) floor.add(flat(new THREE.CircleGeometry(s * 0.7, 6), honey, x, z, 0.044, Math.PI / 6));
      }
    // Wax lumps round the edge.
    for (let k = 0; k < 8; k++) {
      const a = rng.range(0, Math.PI * 2);
      const x = Math.cos(a) * rng.range(R - 2, R + 1.5);
      const z = Math.sin(a) * rng.range(R - 2, R + 1.5);
      if (!clear(x, z, 0.9)) continue;
      const lump = new THREE.SphereGeometry(rng.range(0.5, 0.9), 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      lump.scale(1, 0.8, 1);
      props.add(put(lump, rng.chance(0.5) ? wax : waxDark, x, 0, z));
    }
  } else if (id === 'omega') {
    const plate = createRetroMaterial({ color: '#333c57' });
    const line = createRetroMaterial({ color: '#41a6f6', unlit: 0.85 });
    const glow = createRetroMaterial({ color: '#73eff7', unlit: 1 });
    const steel = createRetroMaterial({ color: '#566c86' });
    floor.add(flat(new THREE.CircleGeometry(R - 0.5, 8), plate, 0, 0, 0.042, Math.PI / 8));
    floor.add(flat(new THREE.RingGeometry(R - 0.5, R, 8), line, 0, 0, 0.044, Math.PI / 8));
    // Grid lines across the octagon.
    for (let k = -3; k <= 3; k++) {
      const L = 2 * Math.sqrt(Math.max(0, (R - 1) ** 2 - (k * 3) ** 2));
      floor.add(flat(new THREE.PlaneGeometry(0.08, L), line, k * 3, 0, 0.043));
      floor.add(flat(new THREE.PlaneGeometry(L, 0.08), line, 0, k * 3, 0.043));
    }
    // Concentric rings that turn (own mesh, not merged).
    const rings = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const r = 2.5 + k * 2.6;
      const arc = new THREE.RingGeometry(r, r + 0.3, 32, 1, 0, Math.PI * (1.2 + k * 0.2));
      arc.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(arc, glow);
      m.position.y = 0.05 + k * 0.001;
      m.rotation.y = k * 2;
      rings.add(m);
    }
    spin = rings;
    // Four emitter pylons at the corners.
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * (R + 0.8);
      const z = Math.sin(a) * (R + 0.8);
      if (!clear(x, z, 0.9)) continue;
      props.add(put(new THREE.CylinderGeometry(0.45, 0.7, 2.2, 6), steel, x, 1.1, z));
      props.add(put(new THREE.OctahedronGeometry(0.45, 0), glow, x, 2.7, z));
    }
  } else return null;

  mergeStatic(floor);
  mergeStatic(props);
  if (spin) floor.add(spin);
  for (const g of [floor, props]) g.traverse((o) => ((o as THREE.Mesh).frustumCulled = false));
  return { id, floor, props, spin };
}
