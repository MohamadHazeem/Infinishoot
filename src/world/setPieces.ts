import * as THREE from 'three';
import { Rng } from '../core/rng';
import { machines, MACHINE_KINDS, SET_PIECES } from '../data/setPieces';
import { commit } from '../render/instancing';
import { createRetroMaterial } from '../render/retroMaterial';
import { aabbFromCenter, overlapsAny, type AABB } from './collision';
import type { Arena } from './fieldArena';

export interface PlacedPiece {
  plan: number;
  x: number;
  z: number;
  turn: number;
}
export interface MachineState extends PlacedPiece {
  phase: 'ready' | 'warning' | 'active' | 'cooldown';
  owner: number;
  time: number; // remaining until the next pulse or phase
  pulse: number; // number of pulses already fired
  occupied: boolean;
}
const DX = [1, 0, -1, 0],
  DZ = [0, 1, 0, -1];
export function worldX(p: PlacedPiece, x: number, z: number) {
  return p.x + x * DX[p.turn] - z * DZ[p.turn];
}
export function worldZ(p: PlacedPiece, x: number, z: number) {
  return p.z + x * DZ[p.turn] + z * DX[p.turn];
}
export function localX(p: PlacedPiece, x: number, z: number) {
  return (x - p.x) * DX[p.turn] + (z - p.z) * DZ[p.turn];
}
export function localZ(p: PlacedPiece, x: number, z: number) {
  return (z - p.z) * DX[p.turn] - (x - p.x) * DZ[p.turn];
}

export function placePieces(arena: Arena, island: readonly number[]): PlacedPiece[] {
  const rng = new Rng(arena.seed ^ 0x47415445);
  const occupied: AABB[] = arena.colliders.slice();
  const reserve = (x: number, z: number, r: number) =>
    occupied.push(aabbFromCenter(x, z, r * 2, r * 2));
  reserve(0, 0, 10); // Keep the starting plaza clear for the team and its first dash.
  for (const point of [...arena.chests, ...arena.spots, ...arena.turrets, ...arena.pads])
    reserve(point.x, point.z, 1.45);
  for (const pad of arena.pads) reserve(pad.tx, pad.tz, 1.5);
  for (const h of arena.hazards) reserve(h.x, h.z, h.r);
  for (const c of arena.conveyors) occupied.push(aabbFromCenter(c.x, c.z, c.w, c.d));
  for (let i = 0; i + 1 < island.length; i += 2) reserve(island[i], island[i + 1], 3);
  for (const s of arena.heights?.sites ?? [])
    occupied.push(aabbFromCenter(s.x, s.z, s.cross ? 4 : 10, s.cross ? 10 : 4));
  const pieces: PlacedPiece[] = [];
  const kinds = MACHINE_KINDS.slice();
  while (kinds.length) {
    const kind = kinds.splice(rng.int(0, kinds.length - 1), 1)[0];
    const options = SET_PIECES.filter((p) => p.kind === kind);
    const plan = SET_PIECES.indexOf(rng.pick(options)),
      turn = rng.int(0, 3);
    for (let attempt = 0; attempt < 500; attempt++) {
      const a = rng.range(0, Math.PI * 2);
      // Spread landmarks from the middle approach out into the wings of the field.
      const r =
        attempt < 100
          ? rng.range(17 + 4 * pieces.length, 24 + 5 * pieces.length)
          : rng.range(12, arena.halfSize - 6);
      const x = Math.round(Math.cos(a) * r),
        z = Math.round(Math.sin(a) * r);
      if (Math.max(Math.abs(x), Math.abs(z)) + 4.2 >= arena.halfSize) continue;
      const foot = aabbFromCenter(x, z, 8.4, 8.4);
      if (overlapsAny(foot, occupied, 0.45)) continue;
      pieces.push({ plan, turn, x, z });
      occupied.push(foot);
      break;
    }
  }
  return pieces;
}

function architecture(p: PlacedPiece, visit: (token: string, x: number, z: number) => void) {
  SET_PIECES[p.plan].rows.forEach((row, z) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== ' ') visit(row[x], x - 3, z - 3);
  });
}

export function pieceColliders(p: PlacedPiece, boxes: AABB[]): AABB[] {
  const relays: AABB[] = [];
  const post = (x: number, z: number, size: number) => {
    const box = aabbFromCenter(worldX(p, x, z), worldZ(p, x, z), size, size);
    boxes.push(box);
    return box;
  };
  architecture(p, (token, x, z) => {
    if (token === 'A') {
      post(x - 1.18, z, 0.55);
      post(x + 1.18, z, 0.55);
    }
    if (token === '#') post(x, z, 0.96);
    if (token === 'T' || token === '*') relays.push(post(x, z, token === 'T' ? 0.85 : 0.42));
  });
  return relays;
}

export function bridgeGap(p: PlacedPiece): AABB {
  return { ...aabbFromCenter(p.x, p.z, p.turn % 2 ? 3.6 : 2.2, p.turn % 2 ? 2.2 : 3.6), gap: true };
}

function batch(group: THREE.Group, geometry: THREE.BufferGeometry, capacity: number) {
  const mesh = new THREE.InstancedMesh(geometry, createRetroMaterial({ unlit: 0.52 }), capacity);
  mesh.count = 0;
  mesh.name = 'Island machinery';
  geometry.addEventListener('dispose', () => mesh.dispose());
  group.add(mesh);
  return mesh;
}

/** Arena-owned batches. Idle frames do no geometry work. The five footprints
 * fit in three draws even while multiple devices are firing. */
export class SetPieceView {
  private boxes: THREE.InstancedMesh;
  private drums: THREE.InstancedMesh;
  private tips: THREE.InstancedMesh;
  private matrix = new THREE.Matrix4();
  private tint = new THREE.Color();
  constructor(group: THREE.Group) {
    this.boxes = batch(group, new THREE.BoxGeometry(), 640);
    this.drums = batch(group, new THREE.CylinderGeometry(0.5, 0.5, 1, 8), 200);
    this.tips = batch(group, new THREE.ConeGeometry(0.5, 1, 4), 96);
  }

  draw(pieces: MachineState[], visible: number, stone: string) {
    const dark = '#293956',
      trim = '#ffdb92',
      ivory = '#f2eadb';
    this.boxes.count = this.drums.count = this.tips.count = 0;
    for (let n = 0; n < pieces.length; n++) {
      if (!(visible & (1 << n))) continue;
      const p = pieces[n];
      const kind = SET_PIECES[p.plan].kind,
        ink = machines[kind].color;
      const warning = p.phase === 'warning',
        active = p.phase === 'active',
        spent = p.phase === 'cooldown';
      const lamp = warning ? '#fff7b1' : spent ? '#52617a' : ink;
      const draw = (
        mesh: THREE.InstancedMesh,
        x: number,
        y: number,
        z: number,
        w: number,
        h: number,
        d: number,
        color: string,
      ) => {
        const odd = p.turn % 2;
        this.matrix
          .makeScale(odd ? d : w, h, odd ? w : d)
          .setPosition(worldX(p, x, z), y, worldZ(p, x, z));
        mesh.setMatrixAt(mesh.count, this.matrix);
        mesh.setColorAt(mesh.count++, this.tint.set(color));
      };
      const box = draw.bind(null, this.boxes),
        drum = draw.bind(null, this.drums),
        tip = draw.bind(null, this.tips);
      architecture(p, (token, x, z) => {
        if (token === '.') box(x, 0.055, z, 0.78, 0.1, 0.7, stone);
        if (token === '#') {
          const h = (x + z) % 2 ? 0.68 : 0.93;
          box(x, h / 2, z, 0.98, h, 0.92, stone);
          box(x, h + 0.07, z, 0.99, 0.14, 0.96, ivory);
        }
        if (token === 'T' || token === '*') {
          const tower = token === 'T',
            w = tower ? 0.94 : 0.46,
            h = tower ? 1.5 : 0.9;
          drum(x, 0.15, z, w * 1.2, 0.3, w * 1.2, dark);
          drum(x, h / 2, z, w, h, w, stone);
          drum(x, h, z, w * 1.18, 0.18, w * 1.18, trim);
          tip(x, h + 0.3, z, w, 0.49, w, lamp);
        }
        if (token === 'A') {
          for (const side of [-1.18, 1.18]) {
            box(x + side, 1.0, z, 0.56, 2, 0.57, stone);
            box(x + side, 0.42, z, 0.64, 0.24, 0.62, trim);
          }
          box(x, 2.03, z, 3.05, 0.38, 0.66, dark);
          box(x, 2.26, z, 2.9, 0.17, 0.69, ink);
          box(x, 2.08, z, 0.54, 0.47, 0.72, ivory);
        }
      });
      // The amber bordered treadle and raised chevron are shared across machines.
      box(0, 0.08, 2.65, 2.75, 0.15, 1.32, dark);
      box(0, 0.17, 2.65, 2.5, 0.08, 1.1, spent ? stone : trim);
      box(0, 0.23, 2.65, 2.15, 0.07, 0.85, dark);
      for (let i = -2; i <= 2; i++)
        box(i * 0.23, 0.28, 2.44 + Math.abs(i) * 0.16, 0.26, 0.075, 0.22, lamp);
      if (kind === 'spikes') {
        box(0, 0.08, 0, 3.35, 0.16, 3.35, dark);
        for (const x of [-1, 0, 1])
          for (const z of [-1, 0, 1]) {
            drum(x, 0.2, z, 0.78, 0.13, 0.78, warning ? lamp : stone);
            const h = active ? 1.55 : warning ? 0.38 : 0.18;
            tip(x, 0.25 + h / 2, z, 0.58, h, 0.58, active ? ivory : ink);
          }
      } else if (kind === 'bridge') {
        box(0, 0.06, 0, 3.3, 0.12, 4.1, dark);
        for (const x of [-0.76, 0, 0.76]) box(x, 0.14, 0, 0.22, 0.11, 3.86, '#ef7d57');
        for (const x of [-1.4, 1.4]) box(x, 0.24, 0, 0.45, 0.36, 4.55, stone);
        for (let i = -3; i <= 3; i++) {
          if (active && Math.abs(i) < 3) continue;
          box(0, 0.35, i * 0.59, 2.6, 0.22, 0.52, warning ? lamp : i % 2 ? '#dda55c' : '#f5c878');
        }
      } else if (kind === 'barrels') {
        for (let i = 0; i < 3; i++) {
          const z = 1.5 - i * 1.6;
          box(0, 0.08, z, 1.25, 0.16, 1.35, dark);
          if (spent || (active && i < p.pulse)) continue;
          drum(0, 0.65, z, 0.88, 1.1, 0.88, '#df584e');
          for (const y of [0.32, 1.01]) drum(0, y, z, 0.97, 0.16, 0.97, trim);
          drum(0, 1.27, z, 0.34, 0.18, 0.34, lamp);
        }
      } else if (kind === 'flood') {
        for (const x of [-1.35, 1.35]) {
          box(x, 0.7, -2, 0.49, 1.4, 0.8, stone);
          drum(x, 1.4, -2, 0.65, 0.24, 0.65, trim);
        }
        box(0, active ? 1.1 : 0.55, -2, 2.5, 0.95, 0.39, lamp);
        for (let i = 0; i < 4; i++) {
          const wave = active && i === p.pulse - 1;
          box(
            0,
            wave ? 0.4 : 0.06,
            -1.6 + i * 1.2,
            2.85,
            wave ? 0.8 : 0.1,
            wave ? 0.75 : 0.24,
            wave ? '#b8fbff' : '#4994bb',
          );
        }
      } else {
        drum(0, 0.11, 0, 2.45, 0.21, 2.45, dark);
        drum(0, 0.43, 0, 0.86, 0.66, 0.86, stone);
        for (const x of [-0.46, 0.46]) {
          box(x, 0.96, 0, 0.21, 0.98, 0.34, trim);
          drum(x, 1.52, 0, 0.42, 0.22, 0.42, lamp);
        }
        tip(0, 1.23, 0, 0.65, 0.9, 0.65, lamp);
      }
    }
    for (const mesh of [this.boxes, this.drums, this.tips]) {
      mesh.visible = mesh.count > 0;
      if (!mesh.visible) continue;
      commit(mesh.instanceMatrix, mesh.count);
      if (mesh.instanceColor) commit(mesh.instanceColor, mesh.count);
      mesh.computeBoundingSphere();
    }
  }
}
