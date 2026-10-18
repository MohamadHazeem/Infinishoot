import * as THREE from 'three';
import { retroGlobals } from '../render/retroMaterial';

/**
 * Fixed-angle 3/4 top-down follow camera. Never rotates (no yaw) so screen
 * directions always map to the same world directions. Leads slightly toward
 * where the player is aiming.
 */
export const cameraTuning = {
  pitchDeg: 58,
  distance: 25,
  fov: 34,
  follow: 7, // follow smoothing (higher = tighter)
  lookAhead: 0.22, // fraction of cursor offset to lead by (mouse)
  lookAheadMax: 4,
  padLookAhead: 3, // units to lead along stick aim (gamepad)
  zoomMax: 2.2, // mouse wheel zooms out up to this many times the distance
  zoomStep: 0.12, // per wheel notch
};

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private focus = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private initialized = false;
  /** Wheel zoom target (1 = default distance) and the smoothed value in use. */
  zoom = 1;
  private zoomShown = 1;
  // Fog distances at zoom 1; zooming out pushes the fog back so the view stays clear.
  private fogNear = retroGlobals.uFogNear.value;
  private fogFar = retroGlobals.uFogFar.value;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(cameraTuning.fov, aspect, 0.5, 120);
  }

  /** Mouse wheel: positive = zoom out. */
  wheel(notches: number): void {
    const t = cameraTuning;
    this.zoom = Math.min(t.zoomMax, Math.max(1, this.zoom * (1 + t.zoomStep * notches)));
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param target player position (interpolated)
   * @param lead world-space offset to lead toward (already clamped)
   * @param shake screen-shake offset; translates the camera without rotating it
   */
  update(target: THREE.Vector3, lead: THREE.Vector3, frameDt: number, shake = { x: 0, z: 0 }): void {
    const t = cameraTuning;
    // `fov` is the vertical FOV at 16:9. Narrower windows widen it so every
    // player sees at least the same horizontal slice of the arena.
    const minAspect = 16 / 9;
    const aspect = this.camera.aspect;
    const vfov =
      aspect >= minAspect
        ? t.fov
        : THREE.MathUtils.radToDeg(
            2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(t.fov) / 2) * (minAspect / aspect)),
          );
    if (this.camera.fov !== vfov) {
      this.camera.fov = vfov;
      this.camera.updateProjectionMatrix();
    }
    this.desired.copy(target).add(lead);
    if (!this.initialized) {
      this.focus.copy(this.desired);
      this.initialized = true;
    } else {
      this.focus.lerp(this.desired, 1 - Math.exp(-t.follow * frameDt));
    }
    if (Math.abs(this.zoomShown - this.zoom) > 0.001) {
      this.zoomShown += (this.zoom - this.zoomShown) * (1 - Math.exp(-10 * frameDt));
      this.camera.far = 120 * this.zoomShown;
      this.camera.updateProjectionMatrix();
      retroGlobals.uFogNear.value = this.fogNear * this.zoomShown;
      retroGlobals.uFogFar.value = this.fogFar * this.zoomShown;
    }
    const pitch = THREE.MathUtils.degToRad(t.pitchDeg);
    const dist = t.distance * this.zoomShown;
    this.camera.position.set(
      this.focus.x,
      this.focus.y + Math.sin(pitch) * dist,
      this.focus.z + Math.cos(pitch) * dist,
    );
    this.camera.lookAt(this.focus);
    this.camera.position.x += shake.x;
    this.camera.position.z += shake.z;
  }
}
