import * as THREE from 'three';
import { createRetroMaterial } from '../render/retroMaterial';
import type { PetDef } from '../data/pets';

/**
 * A pet's body: a round little bot with big eyes and flapping fins that
 * trails its hero on a soft spring and bobs. Presentation only.
 */
export class PetView {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private finL: THREE.Mesh;
  private finR: THREE.Mesh;
  private x = 0;
  private z = 0;
  private t = Math.random() * 10;
  private zapT = 0;
  private bodyMat;

  constructor(
    private scene: THREE.Scene,
    def: PetDef,
  ) {
    this.bodyMat = createRetroMaterial({ color: def.color, unlit: 0.35 });
    const dark = createRetroMaterial({ color: '#1a1c2c', unlit: 0.6 });
    const white = createRetroMaterial({ color: '#f4f4f4', unlit: 0.8 });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), this.bodyMat);
    this.body.add(shell);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.04), white);
      eye.position.set(0.09 * s, 0.04, 0.24);
      const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.02), dark);
      pupil.position.set(0.09 * s, 0.03, 0.265);
      this.body.add(eye, pupil);
    }
    const fin = () => new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.14), this.bodyMat);
    this.finL = fin();
    this.finR = fin();
    this.finL.position.set(-0.28, 0.06, 0);
    this.finR.position.set(0.28, 0.06, 0);
    this.body.add(this.finL, this.finR);
    if (def.id === 'guardian') {
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 4, 12), createRetroMaterial({ color: '#ffcd75', unlit: 1 }));
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 0.36;
      this.body.add(halo);
    }
    if (def.id === 'sparky') {
      const ant = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.03), dark);
      ant.position.y = 0.34;
      const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), createRetroMaterial({ color: '#fff35c', unlit: 1 }));
      tip.position.y = 0.47;
      this.body.add(ant, tip);
    }
    this.root.add(this.body);
    scene.add(this.root);
  }

  /** Flash for a zap. */
  zap(): void {
    this.zapT = 0.15;
  }

  /** Follow a point behind-left of the hero. */
  render(dt: number, hx: number, hz: number, facing: number, visible: boolean): void {
    this.root.visible = visible;
    if (!visible) return;
    this.t += dt;
    const tx = hx - Math.sin(facing + 0.9) * 1.1;
    const tz = hz - Math.cos(facing + 0.9) * 1.1;
    const k = 1 - Math.exp(-dt * 5);
    if (Math.hypot(tx - this.x, tz - this.z) > 12) {
      this.x = tx;
      this.z = tz;
    }
    this.x += (tx - this.x) * k;
    this.z += (tz - this.z) * k;
    this.root.position.set(this.x, 1.5 + Math.sin(this.t * 3) * 0.12, this.z);
    this.root.rotation.y = Math.atan2(hx - this.x, hz - this.z);
    const flap = Math.sin(this.t * 18) * 0.5;
    this.finL.rotation.z = flap;
    this.finR.rotation.z = -flap;
    this.zapT = Math.max(0, this.zapT - dt);
    this.bodyMat.uniforms.uFlash.value.set(1, 1, 0.6, this.zapT > 0 ? 0.8 : 0);
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
