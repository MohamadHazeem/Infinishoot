import * as THREE from 'three';

/**
 * Per-instance view culling for the big instanced pools (enemies, grass).
 * Instanced meshes draw every instance they are given, so things off screen
 * still cost vertex work; pools that know their instance positions skip them
 * with `viewCull.sphere()` before writing the instance.
 *
 * `update(camera)` runs at the start of Game.render with last frame's camera
 * (the camera moves after the pools are written), so tests use a margin.
 */
const frustum = new THREE.Frustum();
const m = new THREE.Matrix4();
const s = new THREE.Sphere();

export const viewCull = {
  /** False until a camera was set (then every test passes). */
  ready: false,
  /** Extra metres added to every radius: last frame's camera, motion, poses. */
  margin: 2.5,
  update(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(m);
    this.ready = true;
  },
  /** True if a sphere at (x, y, z) of radius r may be on screen. */
  sphere(x: number, y: number, z: number, r: number): boolean {
    if (!this.ready) return true;
    s.center.set(x, y, z);
    s.radius = r + this.margin;
    return frustum.intersectsSphere(s);
  },
};
