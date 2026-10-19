/** A tiny, lazy, cosmetic scene on camera layer 5. No actors enter the simulation. */
import * as THREE from 'three';
import { createRetroMaterial } from '../../render/retroMaterial';
import { createHero } from '../heroModel';
import { introBeat } from '../../data/story';

export class StoryWorld {
  readonly root = new THREE.Group();
  private readonly hero = createHero('#41a6f6');
  private readonly swarm: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  constructor(scene: THREE.Scene) {
    const mat = (color: string) => createRetroMaterial({ color });
    const grass = mat('#a7f070'),
      stone = mat('#5d275d'),
      sand = mat('#ffcd75');
    const sea = new THREE.Mesh(new THREE.BoxGeometry(150, 0.3, 150), mat('#3b5dc9'));
    sea.position.y = -4;
    this.root.add(sea);
    const rock = new THREE.CylinderGeometry(5, 2.5, 4, 7);
    const top = new THREE.CylinderGeometry(5.1, 5.1, 0.4, 7);
    const treeGeo = new THREE.ConeGeometry(1.1, 3, 5);
    for (let i = 0; i < 7; i++) {
      const x = i === 0 ? 0 : Math.cos(i * 2.4) * (9 + i * 2),
        z = i === 0 ? 0 : Math.sin(i * 2.4) * (9 + i * 2);
      const base = new THREE.Mesh(rock, stone);
      base.position.set(x, -2, z);
      this.root.add(base);
      const cap = new THREE.Mesh(top, i % 3 === 1 ? sand : grass);
      cap.position.set(x, 0.1, z);
      this.root.add(cap);
      for (let j = 0; j < 3; j++) {
        const tree = new THREE.Mesh(treeGeo, grass);
        tree.position.set(x - 2 + j * 2, 1.7, z - 2);
        this.root.add(tree);
      }
    }
    this.swarm = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.45, 0),
      mat('#b13e53'),
      48,
    );
    this.root.add(this.swarm, this.hero.root);
    this.root.traverse((o) => o.layers.set(5));
    this.root.visible = false;
    scene.add(this.root);
  }
  draw(camera: THREE.PerspectiveCamera, time: number, calm: boolean): void {
    this.root.visible = true;
    camera.layers.set(5);
    const beat = introBeat(time),
      u = calm ? 0.65 : (time % 3) / 3;
    if (beat === 0) {
      camera.position.set(24 - u * 14, 20, 26 - u * 7);
      camera.lookAt(0, 0, 0);
    } else if (beat === 1) {
      camera.position.set(14 - u * 3, 10, 19);
      camera.lookAt(0, 1, 0);
    } else {
      camera.position.set(7, 5, 11);
      camera.lookAt(0, 1.5, 0);
    }
    this.hero.root.visible = beat === 2;
    this.hero.root.position.y = calm ? 0.4 : 0.4 + Math.max(0, 1 - u * 1.7) ** 2 * 13;
    this.hero.body.rotation.x = !calm && u > 0.6 && u < 0.85 ? 0.25 : 0;
    this.swarm.visible = beat === 1;
    if (beat === 1) {
      for (let i = 0; i < 48; i++) {
        const a = i * 2.4,
          r = 5 + (i % 9);
        this.dummy.position.set(Math.cos(a) * r, -2 + u * 7 + (i % 4) * 0.4, Math.sin(a) * r);
        this.dummy.updateMatrix();
        this.swarm.setMatrixAt(i, this.dummy.matrix);
      }
      this.swarm.instanceMatrix.needsUpdate = true;
    }
    camera.updateMatrixWorld();
  }
  hide(camera: THREE.PerspectiveCamera): void {
    this.root.visible = false;
    camera.layers.set(0);
  }
}
