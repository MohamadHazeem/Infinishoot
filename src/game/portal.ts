import * as THREE from 'three';
import { createRetroMaterial } from '../render/retroMaterial';
import { music } from '../audio/music';

/** Swirly exit portal that appears after a stage is cleared. */
export class Portal {
  readonly root = new THREE.Group();
  active = false;
  x = 0;
  z = 0;
  age = 0;
  private ring: THREE.Mesh;
  private ring2: THREE.Mesh;
  private core: THREE.Mesh;
  private coreMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.16, 6, 20), createRetroMaterial({ color: '#ff3df0', unlit: 0.6 }));
    this.ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.09, 5, 16), createRetroMaterial({ color: '#4fc3ff', unlit: 0.8 }));
    this.coreMat = new THREE.MeshBasicMaterial({
      color: '#b98cff',
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.core = new THREE.Mesh(new THREE.CircleGeometry(1.0, 20), this.coreMat);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.3, 1.5, 0.2, 12),
      createRetroMaterial({ color: '#fff4c9' }),
    );
    base.position.y = 0.1;
    const spin = new THREE.Group();
    spin.position.y = 1.5;
    spin.add(this.ring, this.ring2, this.core);
    this.root.add(base, spin);
    this.root.visible = false;
    scene.add(this.root);
  }

  open(x: number, z: number): void {
    this.active = true;
    this.x = x;
    this.z = z;
    this.age = 0;
    this.root.position.set(x, 0, z);
    this.root.visible = true;
  }

  close(): void {
    this.active = false;
    this.root.visible = false;
  }

  render(dt: number): void {
    if (!this.active) return;
    this.age += dt;
    const pop = Math.min(1, this.age * 3);
    const s = pop * (1 + Math.sin(this.age * 6) * 0.04 + music.pulse * 0.07);
    this.root.scale.setScalar(s);
    this.ring.rotation.z = this.age * 2;
    this.ring2.rotation.z = -this.age * 3.5;
    this.ring2.rotation.y = Math.sin(this.age * 2) * 0.5;
    this.coreMat.opacity = 0.55 + Math.sin(this.age * 9) * 0.2;
  }
}
