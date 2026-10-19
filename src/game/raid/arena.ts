import { commit } from '../../render/instancing';
import * as THREE from 'three';
import type { Arena } from '../../world/fieldArena';
import { aabbFromCenter } from '../../world/collision';
import { createRetroMaterial } from '../../render/retroMaterial';
import { mergeStatic } from '../../render/mergeStatic';
import { HEAD_X, HEAD_Z, PLATE, CELLS, CANNONS, raidTuning, type RaidState } from './encounter';
let materials = new Map<string, THREE.ShaderMaterial>();
function material(color: string): THREE.ShaderMaterial {
  let m = materials.get(color);
  if (!m) {
    m = createRetroMaterial({ color });
    materials.set(color, m);
  }
  return m;
}
const C = ['#ef7d57', '#73eff7', '#ffcd75'];
function box(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: string,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function ring(parent: THREE.Object3D, x: number, z: number, r: number, color: string): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(r - 0.22, r, 32),
    createRetroMaterial({ color, side: THREE.DoubleSide }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.07, z);
  parent.add(m);
  return m;
}
/** A purpose-built collision-free objective floor, with solid perimeter and engine plinth. */
export function createRaidArena(seed: number): Arena {
  materials = new Map();
  const group = new THREE.Group();
  group.name = 'HYDRA ENGINE / DRYDOCK';
  box(group, 0, -0.5, 0, 54, 1, 46, '#333c57');
  for (let x = -24; x <= 24; x += 4)
    for (let z = -20; z <= 20; z += 4)
      box(group, x, 0.005, z, 3.85, 0.02, 3.85, (x + z) % 8 === 0 ? '#566c86' : '#333c57');
  const colliders = [
    aabbFromCenter(-28, 0, 2, 50),
    aabbFromCenter(28, 0, 2, 50),
    aabbFromCenter(0, -24, 58, 2),
    aabbFromCenter(0, 24, 58, 2),
    aabbFromCenter(0, -14, 17, 10),
  ];
  for (const side of [-1, 1]) {
    box(group, side * 27, 0.7, 0, 1, 1.4, 46, '#29366f');
    for (let z = -20; z < 22; z += 4) {
      box(group, side * 26.5, 0.8, z, 0.6, 1.6, 1, '#ffcd75');
    }
  }
  box(group, 0, 0.4, -14, 18, 0.8, 12, '#29366f');
  ring(group, PLATE.x, PLATE.z, 2.4, C[1]);
  box(group, 0, 0.08, 6, 3.2, 0.15, 3.2, '#257179');
  box(group, 0, 0.3, 0, 1.5, 0.6, 1.5, '#b13e53');
  box(group, 0, 0.8, 0, 0.6, 0.5, 0.6, '#ffcd75');
  for (let i = 0; i < 2; i++) {
    const c = CANNONS[i],
      b = CELLS[i];
    ring(group, c.x, c.z, 2, '#ffcd75');
    box(group, c.x, 0.6, c.z, 2, 1.2, 2, '#3b5dc9');
    box(group, c.x, 1.3, c.z - 1.2, 0.9, 0.9, 3, '#94b0c2');
    ring(group, b.x, b.z, 2, '#a7f070');
    box(group, b.x, 0.2, b.z, 2.6, 0.4, 2.6, '#257179');
    for (let z = 2; z < 12; z += 2) box(group, c.x, 0.04, z, 0.4, 0.05, 0.8, '#73eff7');
  }
  mergeStatic(group);
  return {
    group,
    colliders,
    halfSize: 27,
    barrels: [],
    chests: [],
    hazards: [],
    conveyors: [],
    seed,
    props: [],
    pads: [],
    turrets: [],
    spots: [],
    anim: [],
  };
}
export class RaidView {
  readonly root = new THREE.Group();
  private heads: THREE.Group[][] = [];
  private stumps: THREE.Mesh[] = [];
  private ghosts: THREE.Group[] = [];
  private cells: THREE.Mesh[] = [];
  private orbs: THREE.InstancedMesh;
  private matrix = new THREE.Matrix4();
  private pink = new THREE.Color('#ff3df0');
  private cyan = new THREE.Color('#73eff7');
  private shields: THREE.Mesh[] = [];
  private racks: THREE.Mesh[] = [];
  private beam: THREE.Mesh;
  private heart: THREE.Mesh;
  private plate: THREE.Mesh;
  constructor(scene: THREE.Scene) {
    materials = new Map();
    scene.add(this.root);
    // Huge riveted torso and three articulated necks: the floor targets stay at readable ground height.
    box(this.root, 0, 3, -14, 12, 6, 7, '#29366f');
    box(this.root, 0, 5.2, -10.4, 9, 2, 0.5, '#3b5dc9');
    for (let x = -5; x <= 5; x += 2) box(this.root, x, 3, -10.35, 0.5, 0.5, 0.4, '#ffcd75');
    this.heart = box(this.root, 0, 3.5, -10, 3, 3, 0.8, '#b13e53');
    for (let i = 0; i < 3; i++) {
      const x = HEAD_X[i];
      for (let k = 0; k < 4; k++)
        box(this.root, (x * (k + 1)) / 4, 2.8 + k * 0.3, -12 + k * 1.8, 2.1, 1.8, 2.4, '#566c86');
      this.stumps.push(box(this.root, x, 0.4, HEAD_Z, 2.5, 0.8, 2.5, '#ef7d57'));
      const copies: THREE.Group[] = [];
      for (let j = 0; j < 4; j++) {
        const head = new THREE.Group();
        this.root.add(head);
        copies.push(head);
        box(head, 0, 0, 0, 3.3, 2.6, 3, '#3b5dc9');
        box(head, 0, -0.7, 1.5, 3.6, 1.1, 2.5, C[i]);
        box(head, 0, 0.3, 2, 2.5, 0.5, 0.5, '#1a1c2c');
        for (const side of [-1, 1]) {
          box(head, side * 1.25, 0.7, 1.45, 0.6, 0.55, 0.4, C[i]);
          box(head, side * 1.5, 1.7, -0.5, 0.55, 1.5, 0.55, '#ffcd75');
        }
        for (let tooth = -1; tooth <= 1; tooth++)
          box(head, tooth, -0.2, 2.5, 0.35, 0.6, 0.4, '#f4f4f4');
      }
      for (const m of copies) mergeStatic(m);
      this.heads.push(copies);
    }
    for (let i = 0; i < 8; i++) {
      const ghost = new THREE.Group();
      this.root.add(ghost);
      this.ghosts.push(ghost);
      box(ghost, 0, 0.9, 0, 0.8, 1.2, 0.6, '#257179');
      box(ghost, 0, 1.7, 0, 0.9, 0.7, 0.8, '#73eff7');
      box(ghost, 0, 1.7, 0.45, 0.65, 0.25, 0.1, '#29366f');
      ring(ghost, 0, 0, 0.7, '#73eff7');
      mergeStatic(ghost);
      this.cells.push(box(this.root, 0, 0, 0, 0.6, 0.9, 0.6, '#a7f070'));
    }
    this.orbs = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.45),
      createRetroMaterial({ color: '#ffffff', unlit: 1 }),
      24,
    );
    this.orbs.frustumCulled = false;
    this.root.add(this.orbs);
    for (const x of [-8, 8]) this.shields.push(ring(this.root, x, HEAD_Z, 3, '#73eff7'));
    for (const p of CELLS) this.racks.push(box(this.root, p.x, 0.8, p.z, 0.7, 1.2, 0.7, '#a7f070'));
    const geom = new THREE.CircleGeometry(
      raidTuning.fireRange,
      32,
      -Math.acos(raidTuning.fireCos),
      2 * Math.acos(raidTuning.fireCos),
    );
    this.beam = new THREE.Mesh(
      geom,
      createRetroMaterial({ color: '#ef7d57', transparent: true, side: THREE.DoubleSide }),
    );
    this.beam.rotation.x = -Math.PI / 2;
    this.root.add(this.beam);
    const bm = this.beam.material as THREE.ShaderMaterial;
    bm.depthWrite = false;
    bm.uniforms.uRaidAlpha = { value: 0.25 };
    bm.fragmentShader =
      'uniform float uRaidAlpha;\n' +
      bm.fragmentShader.replace('vec4(col, base.a)', 'vec4(col, base.a * uRaidAlpha)');
    this.plate = ring(this.root, PLATE.x, PLATE.z, 2.6, '#a7f070');
  }
  render(s: RaidState | null, visible: boolean): void {
    this.root.visible = visible && !!s;
    if (!s || !visible) return;
    this.plate.visible = s.plate;
    this.heart.scale.setScalar(s.phase === 'core' ? 1.3 : 0.7);
    for (let i = 0; i < 3; i++) {
      const h = s.heads[i];
      this.stumps[i].visible = h.stump > 0;
      for (let j = 0; j < 4; j++) {
        const m = this.heads[i][j];
        m.visible =
          !h.sealed && h.stump <= 0 && j < h.copies && s.phase !== 'core' && s.phase !== 'won';
        m.position.set(HEAD_X[i] + (j - (h.copies - 1) / 2) * 1.8, 2.5, HEAD_Z);
        m.scale.setScalar(h.copies === 1 ? 1 : 0.62);
      }
    }
    for (let i = 0; i < 8; i++) {
      const a = s.actors[i];
      this.ghosts[i].visible = a.alive && a.ghost;
      this.ghosts[i].position.set(a.x, 0, a.z);
      this.cells[i].visible = a.cell && a.alive;
      this.cells[i].position.set(a.x, 2.6, a.z);
    }
    let count = 0;
    for (const o of s.orbs)
      if (o.live) {
        this.matrix.makeTranslation(o.x, 1.1, o.z);
        this.orbs.setMatrixAt(count, this.matrix);
        this.orbs.setColorAt(count++, o.reflected ? this.cyan : this.pink);
      }
    this.orbs.count = count;
    commit(this.orbs.instanceMatrix, count);
    if (this.orbs.instanceColor) commit(this.orbs.instanceColor, count);
    for (let i = 0; i < 2; i++) {
      this.shields[i].visible =
        !s.plate && !s.heads[1].sealed && s.heads[i * 2].stump <= 0 && !s.heads[i * 2].sealed;
      this.racks[i].visible = s.phase === 'core' && s.racks[i] <= 0;
    }
    this.beam.visible = s.fireMode > 0;
    this.beam.position.set(-8, 0.1, HEAD_Z);
    this.beam.rotation.z = Math.atan2(-s.fireZ, s.fireX);
    (this.beam.material as THREE.ShaderMaterial).uniforms.uRaidAlpha.value =
      s.fireMode === 2 ? 0.65 : 0.25;
  }
}
