import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRetroMaterial, type RetroMaterial } from './retroMaterial';
import type { HeroRig } from '../game/heroModel';

/**
 * Hero accessories (graphics lane): an antenna, a cap, a scarf and a crown,
 * built from primitives and attached to the hero rig (head or body), so they
 * follow every animation, get the merged outline and x-ray of
 * src/render/rigOverlay.ts (5 rig parts in all, inside MAX_RIG_PARTS) and
 * show in photo mode. Every accessory is created once per rig and toggled by
 * visibility (the overlay hides invisible parts), and is coloured through
 * vertex colours baked from the hero's current colours (`paintAccessories`),
 * by role: main (the accent colour), shade (a darker accent), dark (the
 * suit), metal (gold) and gem.
 */
export type AccessoryId = 'antenna' | 'cap' | 'scarf' | 'crown';
const ROLE = { main: 0, shade: 1, dark: 2, metal: 3, gem: 4 } as const;
type Role = keyof typeof ROLE;

interface AccState {
  mat: RetroMaterial;
  meshes: Record<AccessoryId, THREE.Mesh[]>;
  tail: THREE.Group;
  antenna: THREE.Mesh;
  shown: AccessoryId | 'none';
  /** Last colours baked (skip re-baking when nothing changed). */
  key: string;
  phase: number;
}

const states = new WeakMap<HeroRig, AccState>();

function part(g: THREE.BufferGeometry, role: Role): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  const count = n.getAttribute('position').count;
  n.setAttribute('role', new THREE.BufferAttribute(new Float32Array(count).fill(ROLE[role]), 1));
  n.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  return n;
}

function mesh(parts: THREE.BufferGeometry[], mat: THREE.Material, name: string): THREE.Mesh {
  const g = mergeGeometries(parts)!;
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  m.visible = false;
  return m;
}

/** Create the accessory meshes on a rig (once). */
function ensure(rig: HeroRig): AccState {
  let st = states.get(rig);
  if (st) return st;
  const mat = createRetroMaterial({ vertexColors: true });
  rig.materials.push(mat);

  // Antenna: a thin rod with a ball, leaning off the helmet top (it sways as the hero moves).
  const antenna = mesh(
    [
      part(new THREE.CylinderGeometry(0.06, 0.08, 0.06, 6).translate(0, 0.03, 0), 'dark'),
      part(new THREE.CylinderGeometry(0.022, 0.028, 0.42, 5).translate(0, 0.24, 0), 'metal'),
      part(new THREE.SphereGeometry(0.085, 7, 5).translate(0, 0.48, 0), 'main'),
    ],
    mat,
    'accAntenna',
  );
  antenna.position.set(0.14, 0.4, -0.06);
  antenna.rotation.z = -0.3;
  rig.head.add(antenna);

  // Cap: a dome over the helmet and a bill that points forward.
  const dome = new THREE.SphereGeometry(0.455, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.88, 1);
  const cap = mesh(
    [
      part(dome.rotateX(-0.22).translate(0, 0.06, -0.02), 'main'),
      part(new THREE.BoxGeometry(0.44, 0.05, 0.3).rotateX(0.12).translate(0, 0.15, 0.4), 'shade'),
      part(new THREE.SphereGeometry(0.05, 5, 4).translate(0, 0.5, -0.1), 'shade'),
      part(new THREE.BoxGeometry(0.14, 0.1, 0.03).translate(0, 0.3, 0.38).rotateX(-0.25), 'metal'),
    ],
    mat,
    'accCap',
  );
  rig.head.add(cap);

  // Crown: a gold band with five points and gems.
  const pts: THREE.BufferGeometry[] = [part(new THREE.CylinderGeometry(0.25, 0.23, 0.15, 10).translate(0, 0.48, 0), 'metal')];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    pts.push(part(new THREE.ConeGeometry(0.065, 0.16, 4).translate(Math.sin(a) * 0.21, 0.63, Math.cos(a) * 0.21), 'metal'));
    pts.push(part(new THREE.BoxGeometry(0.06, 0.06, 0.03).translate(0, 0.48, 0.245).rotateY(a), i === 0 ? 'gem' : 'main'));
  }
  const crown = mesh(pts, mat, 'accCrown');
  crown.rotation.x = -0.12;
  rig.head.add(crown);

  // Scarf: a thick wrap round the neck with a knot at the back, plus a tail that flutters.
  const wrap = mesh(
    [
      part(new THREE.TorusGeometry(0.26, 0.085, 5, 12).rotateX(Math.PI / 2).translate(0, 1.24, 0), 'main'),
      part(new THREE.BoxGeometry(0.16, 0.14, 0.1).translate(0, 1.22, -0.27), 'shade'),
    ],
    mat,
    'accScarf',
  );
  rig.body.add(wrap);
  const tail = new THREE.Group();
  tail.position.set(0.05, 1.2, -0.3);
  const tailMesh = mesh(
    [part(new THREE.BoxGeometry(0.15, 0.46, 0.05).translate(0, -0.23, 0), 'main'), part(new THREE.BoxGeometry(0.155, 0.06, 0.055).translate(0, -0.42, 0), 'shade')],
    mat,
    'accScarfTail',
  );
  tail.add(tailMesh);
  rig.body.add(tail);

  st = { mat, meshes: { antenna: [antenna], cap: [cap], crown: [crown], scarf: [wrap, tailMesh] }, tail, antenna, shown: 'none', key: '', phase: Math.random() * 10 };
  states.set(rig, st);
  return st;
}

/** Show one accessory (or none). Creates the meshes the first time one is worn. */
export function wearAccessory(rig: HeroRig, id: AccessoryId | 'none'): void {
  if (id === 'none' && !states.has(rig)) return;
  const st = ensure(rig);
  st.shown = id;
  for (const [k, list] of Object.entries(st.meshes)) for (const m of list) m.visible = k === id;
}

/** Bake the hero's colours into the accessories' vertex colours. */
export function paintAccessories(rig: HeroRig): void {
  const st = states.get(rig);
  if (!st) return;
  const accent = rig.mats.accent.uniforms.uColor.value;
  const suit = rig.mats.suit.uniforms.uColor.value;
  const gem = rig.mats.red.uniforms.uColor.value;
  const key = accent.getHexString() + suit.getHexString() + gem.getHexString();
  if (key === st.key) return;
  st.key = key;
  const cols = [accent.clone(), accent.clone().multiplyScalar(0.62), suit.clone(), new THREE.Color('#ffcd75'), gem.clone()];
  // A suit-dark scarf or crown gem on a dark accent would vanish: lift very dark mains a little.
  if (cols[0].r + cols[0].g + cols[0].b < 0.3) cols[0].lerp(new THREE.Color('#566c86'), 0.5);
  for (const list of Object.values(st.meshes))
    for (const m of list) {
      const role = m.geometry.getAttribute('role') as THREE.BufferAttribute;
      const col = m.geometry.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < role.count; i++) {
        const c = cols[role.getX(i)] ?? cols[0];
        col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
    }
}

/** Per frame: the scarf tail streams back with speed and flutters; the antenna sways. */
export function animateAccessories(rig: HeroRig, dt: number): void {
  const st = states.get(rig);
  if (!st || st.shown === 'none') return;
  st.phase += dt;
  const sp = rig.anim.speed;
  const dash = rig.anim.dash;
  if (st.shown === 'scarf') {
    const stream = Math.min(1.35, 0.15 + sp * 0.85 + dash * 0.6);
    st.tail.rotation.x = -stream + Math.sin(st.phase * (6 + sp * 10)) * (0.08 + sp * 0.14);
    st.tail.rotation.z = Math.sin(st.phase * 4.3) * (0.06 + sp * 0.1);
  } else if (st.shown === 'antenna') {
    st.antenna.rotation.z = -0.3 + Math.sin(st.phase * 7) * (0.05 + sp * 0.12);
    st.antenna.rotation.x = -sp * 0.35 - dash * 0.4;
  }
}

/** Rig meshes the accessories add (tests: the merged overlay must stay within its part budget). */
export function accessoryMeshCount(): number {
  return 5;
}
