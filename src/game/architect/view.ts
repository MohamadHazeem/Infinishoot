import * as THREE from 'three';
import { createRetroMaterial } from '../../render/retroMaterial';
import { commit } from '../../render/instancing';
import { enemyGeometry } from '../enemies';
import { ENEMIES } from '../../data/enemies';
import { access } from '../settings';
import { reduceMotion } from '../../ui/hud';
import { architectTuning as T, corePosition, missingTile, wallPose, type ArchitectState } from './model';

const M = new THREE.Object3D(), C = new THREE.Color();
const P = { x: 0, z: 0 }, W = { x: 0, z: 0, w: 0, d: 0 };
const TAU = Math.PI * 2;
function mesh(geometry: THREE.BufferGeometry, color: string, unlit = 0.35): THREE.Mesh {
  return new THREE.Mesh(geometry, createRetroMaterial({ color, unlit }));
}
/** 81 floor pieces and bounded warning pools. No new objects in draw(). */
export class ArchitectView {
  readonly root = new THREE.Group();
  private floor = new THREE.InstancedMesh(new THREE.BoxGeometry(3.88, 0.55, 3.88), createRetroMaterial({ color: '#ffffff', unlit: 0.25 }), 81);
  private walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), createRetroMaterial({ color: '#41a6f6', unlit: 0.25 }), 4);
  private rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.9, 1, 48), createRetroMaterial({ color: '#ffffff', unlit: 1, side: THREE.DoubleSide }), T.hazardCap + 6);
  private lines = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.05, 1), createRetroMaterial({ color: '#ffffff', unlit: 1 }), T.hazardCap * 3);
  private body = new THREE.Group();
  private shell = mesh(new THREE.OctahedronGeometry(3.2), '#41a6f6', 0.65);
  private heart = mesh(new THREE.OctahedronGeometry(1.45), '#73eff7', 0.8);
  private crown = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.6), createRetroMaterial({ color: '#ffcd75', unlit: 0.6 }), 8);
  private cores: THREE.Mesh[] = [];
  private halos: THREE.Mesh[] = [];
  private echoes: THREE.Mesh[] = [];
  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    // An opaque dark void hides the old terrain; the encounter owns its floating platform.
    const voidFloor = mesh(new THREE.PlaneGeometry(140, 140), '#1a1c2c', 1);
    voidFloor.rotation.x = -Math.PI / 2; voidFloor.position.y = -3;
    this.root.add(voidFloor, this.floor, this.walls, this.rings, this.lines, this.body);
    this.body.position.set(0, 3.7, -3);
    this.body.add(this.shell, this.heart, this.crown);
    const rim = mesh(new THREE.TorusGeometry(4.1, 0.12, 4, 40), '#41a6f6', 0.7);
    rim.rotation.x = Math.PI / 2; this.body.add(rim);
    for (let i = 0; i < 3; i++) {
      const core = mesh(new THREE.OctahedronGeometry(1.2), '#73eff7', 0.85);
      const halo = mesh(new THREE.TorusGeometry(1.6, 0.08, 4, 24), '#ffcd75', 1);
      halo.rotation.x = Math.PI / 2;
      this.root.add(core, halo); this.cores.push(core); this.halos.push(halo);
    }
    for (const id of ['king', 'rex', 'queen', 'glitch']) {
      const echo = new THREE.Mesh(enemyGeometry(ENEMIES[id]), createRetroMaterial({ color: '#73eff7', unlit: 0.7 }));
      echo.scale.setScalar(1.9); this.root.add(echo); this.echoes.push(echo);
    }
    for (const m of [this.floor, this.walls, this.rings, this.lines, this.crown]) {
      m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.root.visible = false;
  }
  hide(): void { this.root.visible = false; }
  draw(s: ArchitectState): void {
    this.root.visible = s.active;
    if (!s.active) return;
    const calm = reduceMotion();
    const time = calm ? 0 : s.time;
    const warning = s.layoutTime < T.warning;
    const lift = warning && !calm ? Math.sin(s.layoutTime / T.warning * Math.PI) * 2.8 : 0;
    let n = 0;
    for (let row = -4; row <= 4; row++) for (let col = -4; col <= 4; col++) {
      const missing = missingTile(col, row, s.layout);
      if (missing && !warning) continue;
      M.position.set(col * 4, (missing ? lift : 0) - 0.2, row * 4);
      M.rotation.set(0, 0, 0); M.scale.set(1, 1, 1); M.updateMatrix();
      this.floor.setMatrixAt(n, M.matrix);
      C.set(missing ? '#ffcd75' : Math.abs(col) <= 1 || Math.abs(row) <= 1 ? '#29366f' : (row + col) % 2 ? '#333c57' : '#566c86');
      this.floor.setColorAt(n++, C);
    }
    this.floor.count = n; commit(this.floor.instanceMatrix, n); commit(this.floor.instanceColor!, n);
    this.walls.count = s.phase === 1 ? 4 : 0;
    if (s.phase === 1) for (let i = 0; i < 4; i++) {
      wallPose(i, s.layout, W);
      M.position.set(W.x, 1.1 + lift * 2, W.z); M.scale.set(W.w, 2.1, W.d); M.updateMatrix(); this.walls.setMatrixAt(i, M.matrix);
    }
    commit(this.walls.instanceMatrix, this.walls.count);
    this.body.rotation.y = time * 0.18;
    this.body.scale.setScalar(s.phase === 3 ? 1.35 : 1);
    this.shell.rotation.set(time * 0.15, time * 0.21, Math.PI / 4);
    this.shell.scale.setScalar(s.phase === 3 ? 0.8 : 1);
    this.heart.position.y = s.phase === 3 ? -1.6 : 0;
    this.heart.rotation.set(0, -time * 0.5, Math.PI / 4);
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8 + time * 0.2;
      M.position.set(Math.cos(a) * 3.4, 1.4 + Math.sin(a * 2) * 0.65, Math.sin(a) * 3.4);
      M.rotation.set(a, a, 0); M.scale.set(0.7, s.phase === 3 ? 1.8 : 1, 0.7); M.updateMatrix(); this.crown.setMatrixAt(i, M.matrix);
    }
    commit(this.crown.instanceMatrix, 8);
    for (let i = 0; i < 3; i++) {
      corePosition(i, s.time, P);
      const core = this.cores[i], halo = this.halos[i];
      core.visible = halo.visible = s.phase === 3 && s.coreHp[i] > 0;
      core.position.set(P.x, 1.25, P.z); core.rotation.set(time * 0.3, time, 0);
      halo.position.set(P.x, 0.16, P.z);
      const open = s.core === i;
      (core.material as ReturnType<typeof createRetroMaterial>).uniforms.uColor.value.set(open ? '#ffcd75' : '#566c86');
      halo.visible &&= open;
    }
    for (let i = 0; i < 4; i++) {
      const echo = this.echoes[i];
      echo.visible = s.phase === 2 && s.echoTime > 0 && (i === s.echo || i === (s.echo + 1) % 4);
      echo.position.set(i === s.echo ? -8 : 8, 0.4 + (calm ? 0 : Math.sin(time * 3) * 0.15), -7);
      echo.rotation.y = Math.PI;
    }
    let nr = 0, nl = 0;
    for (const d of s.dangers) {
      if (!d.kind) continue;
      const armed = d.age >= d.warn;
      const color = armed ? access.colorblind ? '#f4f4f4' : '#ff3df0' : '#ffcd75';
      M.rotation.set(0, 0, 0);
      if (d.kind === 2) {
        M.position.set(d.x, 0.12, d.z); M.rotation.y = -Math.atan2(d.dz, d.dx);
        M.scale.set(38, 1, armed ? d.r * 2 : 0.12); M.updateMatrix();
        this.lines.setMatrixAt(nl, M.matrix); this.lines.setColorAt(nl++, C.set(color));
        // Both edges show the full damage width during the warning.
        if (!armed) for (let sign = -1; sign <= 1; sign += 2) {
          M.position.set(d.x - d.dz * d.r * sign, 0.12, d.z + d.dx * d.r * sign);
          M.updateMatrix(); this.lines.setMatrixAt(nl, M.matrix); this.lines.setColorAt(nl++, C.set(color));
        }
      } else {
        const radius = d.kind === 4 ? armed ? Math.max(0.2, (d.age - d.warn) * T.desperationSpeed) : 2 + (d.age / d.warn) * 2 : d.r;
        M.position.set(d.x, 0.14, d.z); M.rotation.x = -Math.PI / 2; M.scale.set(radius, radius, 1); M.updateMatrix();
        this.rings.setMatrixAt(nr, M.matrix); this.rings.setColorAt(nr++, C.set(color));
      }
    }
    // Ground reticle makes the high floating body's actual shooting target unambiguous.
    M.position.set(0, 0.15, -3); M.rotation.set(-Math.PI / 2, 0, 0); M.scale.set(2.3, 2.3, 1); M.updateMatrix();
    this.rings.setMatrixAt(nr, M.matrix); this.rings.setColorAt(nr++, C.set(s.phase < 3 || s.core === 3 ? '#73eff7' : '#566c86'));
    this.rings.count = nr; this.lines.count = nl;
    commit(this.rings.instanceMatrix, nr); commit(this.rings.instanceColor!, nr);
    commit(this.lines.instanceMatrix, nl); if (nl) commit(this.lines.instanceColor!, nl);
  }
}
