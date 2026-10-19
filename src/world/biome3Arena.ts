import * as THREE from 'three';
import { access } from '../game/settings';
let motionQuery: MediaQueryList | undefined;
export function biome3Calm(): boolean {
  return (
    access.reduceFlash ||
    (typeof matchMedia === 'function' &&
      (motionQuery ??= matchMedia('(prefers-reduced-motion: reduce)')).matches)
  );
}
import { Rng } from '../core/rng';
import { createRetroMaterial } from '../render/retroMaterial';
import { paint } from '../render/geometry';
import type { Arena } from './fieldArena';
import type { ArenaAnim } from './biomeProps';

/** Independent seed stream: old arenas consume exactly the same random numbers. */
export function addBiome3Arena(
  id: string,
  seed: number,
  group: THREE.Group,
  hazards: Arena['hazards'],
  conveyors: Arena['conveyors'],
): void {
  if (id !== 'candy' && id !== 'ruins') return;
  const rng = new Rng(seed ^ 0xca7d3);
  const mat = createRetroMaterial({ vertexColors: true });
  const add = (geo: THREE.BufferGeometry, c: string, x: number, y: number, z: number) => {
    paint(geo, c);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    group.add(m);
  };
  if (id === 'candy') {
    // Two continuous, shallow chocolate streams with a clear starting plaza.
    for (const side of [-1, 1])
      for (let i = -11; i <= 11; i++) {
        const z = i * 4.3,
          x = side * (16 + Math.sin(i * 0.43 + (seed % 7)) * 5);
        hazards.push({ kind: 'chocolate', x, z, r: 2.8 });
        add(new THREE.CircleGeometry(2.9, 12).rotateX(-Math.PI / 2), '#704133', x, 0.035, z);
        add(new THREE.BoxGeometry(1.3, 0.025, 0.14), '#ba7954', x + 0.5, 0.06, z);
      }
    // Candy cane boundary fence and gumdrop hills outside the play space.
    for (let i = -9; i <= 9; i++)
      for (const side of [-1, 1]) {
        const x = i * 5.5,
          z = side * 54;
        add(new THREE.CylinderGeometry(0.18, 0.18, 2.6, 6), '#f4f4f4', x, 1.3, z);
        for (let k = 0; k < 4; k++)
          add(new THREE.CylinderGeometry(0.19, 0.19, 0.22, 6), '#ff5e8a', x, 0.3 + k * 0.6, z);
        add(new THREE.TorusGeometry(0.42, 0.18, 5, 8, Math.PI), '#ff7eb6', x + 0.42, 2.55, z);
        if (i < 9) add(new THREE.BoxGeometry(5.5, 0.14, 0.14), '#f4f4f4', x + 2.75, 0.9, z);
        const color = ['#ff7eb6', '#a7f070', '#73eff7', '#ffcd75'][rng.int(0, 3)];
        add(
          new THREE.SphereGeometry(rng.range(3, 6), 8, 5).scale(1, 1.2, 1),
          color,
          x,
          -1.6,
          side * 64,
        );
      }
  } else {
    // Slow, broad currents use the existing host/client conveyor movement path.
    for (const side of [-1, 1]) {
      conveyors.push({
        x: side * 17,
        z: 0,
        w: 9,
        d: 100,
        dx: 0,
        dz: side,
        speed: 0.85,
        kind: 'wind',
      });
      for (let z = -44; z <= 44; z += 8)
        for (const wing of [-1, 1]) {
          const geo = new THREE.BoxGeometry(1.1, 0.02, 0.09).rotateY(wing * side * 0.6);
          add(geo, '#73bfbe', side * 17 + wing * 0.45, 0.04, z);
        }
    }
    // Broken pale caustic loops, a static low-contrast floor pattern (no flashing).
    for (let i = 0; i < 100; i++) {
      const x = rng.range(-50, 50),
        z = rng.range(-50, 50);
      add(
        new THREE.TorusGeometry(rng.range(0.7, 2), 0.035, 3, 6, Math.PI * 1.4).rotateX(
          -Math.PI / 2,
        ),
        '#9ddbd1',
        x,
        0.045,
        z,
      );
    }
  }
}

/** The existing tree collider surrounds these lollipops / coral branches. */
export function biome3Tree(id: string, g: THREE.Group, scale: number): boolean {
  if (id !== 'candy' && id !== 'ruins') return false;
  const mat = createRetroMaterial({ vertexColors: true });
  const add = (geo: THREE.BufferGeometry, c: string, x: number, y: number, z = 0) => {
    paint(geo, c);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
  };
  if (id === 'candy') {
    const colors = ['#ff7eb6', '#73eff7', '#a7f070', '#ffcd75'];
    const c = colors[Math.abs(Math.floor(g.position.x * 7 + g.position.z * 3)) % 4];
    add(new THREE.CylinderGeometry(0.16, 0.2, 2.8, 6), '#f4f4f4', 0, 1.4);
    add(
      new THREE.CylinderGeometry(1.1 * scale, 1.1 * scale, 0.4, 16).rotateX(Math.PI / 2),
      c,
      0,
      3,
    );
    add(new THREE.TorusGeometry(0.67 * scale, 0.12, 5, 16), '#f4f4f4', 0, 3, 0.23);
    add(new THREE.SphereGeometry(0.24, 6, 5), '#f4f4f4', 0, 3, 0.24);
  } else {
    for (let j = -1; j <= 1; j++) {
      const c = j === 0 ? '#ef7d57' : '#b13e83';
      add(
        new THREE.CylinderGeometry(0.15, 0.3, 2.2 * scale, 6).rotateZ(j * 0.35),
        c,
        j * 0.65,
        1.1 * scale,
      );
      add(new THREE.SphereGeometry(0.3, 6, 4), '#ffcd75', j * 1.05, 2.2 * scale);
      add(
        new THREE.CylinderGeometry(0.12, 0.19, 1, 5).rotateZ(-j * 0.8 - 0.6),
        c,
        j * 0.7 + 0.3,
        1.5,
      );
    }
  }
  return true;
}

/** Kelp uses the existing instanced scenery animator; no new render loop. */
export function biome3Kelp(id: string, seed: number, group: THREE.Group): ArenaAnim[] {
  if (id !== 'ruins') return [];
  const rng = new Rng(seed ^ 0x5ea);
  const mesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.25, 2.8, 4).translate(0, 1.4, 0),
    createRetroMaterial({ color: '#38b764' }),
    70,
  );
  mesh.frustumCulled = false;
  group.add(mesh);
  const items = Array.from({ length: 70 }, () => ({
    x: rng.range(-51, 51),
    y: -0.25,
    z: rng.range(-51, 51),
    yaw: rng.range(0, 6.28),
    scale: rng.range(0.7, 1.3),
    speed: rng.range(0.6, 1),
    phase: rng.range(0, 6.28),
  }));
  return [{ mesh, kind: 'kelp', items }];
}
