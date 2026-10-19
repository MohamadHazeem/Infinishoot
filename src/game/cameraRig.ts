import * as THREE from 'three';
import { retroGlobals } from '../render/retroMaterial';
import { camDirTuning, easeZoom, killCamWeight } from './animMath';
import { cinePose, easeCine } from './cineCam';

/**
 * Fixed-angle 3/4 top-down follow camera. Never rotates (no yaw) so screen
 * directions always map to the same world directions. Leads slightly toward
 * where the player is aiming. On top of the mouse-wheel zoom it zooms itself
 * (out as the swarm grows or crowds the screen edge, slightly in when calm),
 * frames co-op teammates, and plays a kill-cam on boss kills. The inputs come
 * from Game.cameraDirector (src/game/systems/camera.ts) every frame.
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
  /** Dynamic camera (auto zoom and kill-cam); off = the plain follow camera. */
  dynamic = true;
  /** Auto-zoom target (camDirTuning.autoMin..autoMax) and its smoothed value. */
  auto = 1;
  private autoShown = 1;
  /** Co-op framing: focus offset from the local hero and zoom to keep the team in view. */
  private teamX = 0;
  private teamZ = 0;
  private teamZoom = 1;
  private team = { x: 0, z: 0, zoom: 1 };
  /** Kill-cam clock (-1 = off) and where it looks. */
  private killT = -1;
  private killX = 0;
  private killZ = 0;
  /** Crowd framing (graphics lane, src/game/cineCam.ts): target tilt 0..1 (lower, closer camera when the screen is calm) and its eased value. */
  cine = 0;
  cineShown = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(cameraTuning.fov, aspect, 0.5, 120);
  }

  /** Mouse wheel: positive = zoom out. */
  wheel(notches: number): void {
    const t = cameraTuning;
    this.zoom = Math.min(t.zoomMax, Math.max(1, this.zoom * (1 + t.zoomStep * notches)));
  }

  /** Co-op framing target for this frame (see animMath.teamFrame). */
  frameTeam(x: number, z: number, zoom: number): void {
    this.team.x = x;
    this.team.z = z;
    this.team.zoom = zoom;
  }

  /** Boss kill: swing to (x, z), zoom in, hold through the slow motion, then come back. */
  killCam(x: number, z: number): void {
    if (!this.dynamic) return;
    this.killT = 0;
    this.killX = x;
    this.killZ = z;
  }

  /** 0..1 while a kill-cam plays. */
  get killWeight(): number {
    return this.killT < 0 ? 0 : killCamWeight(this.killT, camDirTuning.killCamTime);
  }

  /** Drop transient camera moves (new stage, back to the title). */
  resetDirector(): void {
    this.killT = -1;
    this.cine = 0;
    this.auto = this.autoShown = 1;
    this.teamX = this.teamZ = 0;
    this.teamZoom = 1;
    this.team.x = this.team.z = 0;
    this.team.zoom = 1;
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
    // Smart camera: auto zoom, co-op framing and the boss kill-cam.
    const dt = Math.min(frameDt, 0.1);
    this.autoShown = easeZoom(this.autoShown, this.dynamic ? this.auto : 1, dt);
    const tk = 1 - Math.exp(-3 * dt);
    this.teamX += (this.team.x - this.teamX) * tk;
    this.teamZ += (this.team.z - this.teamZ) * tk;
    this.teamZoom = easeZoom(this.teamZoom, this.team.zoom, dt * 2);
    let w = 0;
    if (this.killT >= 0) {
      this.killT += dt;
      if (this.killT >= camDirTuning.killCamTime || !this.dynamic) this.killT = -1;
      else w = killCamWeight(this.killT, camDirTuning.killCamTime);
    }
    this.desired.copy(target).add(lead);
    this.desired.x += this.teamX;
    this.desired.z += this.teamZ;
    if (w > 0) {
      this.desired.x += (this.killX - this.desired.x) * w;
      this.desired.z += (this.killZ - this.desired.z) * w;
    }
    const want = Math.min(t.zoomMax, Math.max(0.5, this.zoom * this.autoShown * this.teamZoom)) * (1 + (camDirTuning.killCamZoom - 1) * w);
    if (!this.initialized) {
      this.focus.copy(this.desired);
      this.initialized = true;
    } else {
      this.focus.lerp(this.desired, 1 - Math.exp(-t.follow * frameDt));
    }
    if (Math.abs(this.zoomShown - want) > 0.001) {
      this.zoomShown += (want - this.zoomShown) * (1 - Math.exp(-(w > 0 ? 6 : 10) * frameDt));
      this.camera.far = 120 * this.zoomShown;
      this.camera.updateProjectionMatrix();
      const fz = Math.max(1, this.zoomShown); // zooming in never pulls the fog closer
      retroGlobals.uFogNear.value = this.fogNear * fz;
      retroGlobals.uFogFar.value = this.fogFar * fz;
    }
    this.cineShown = easeCine(this.cineShown, this.dynamic ? this.cine * (1 - w) : 0, dt);
    const cine = cinePose(t.pitchDeg, this.cineShown);
    const pitch = THREE.MathUtils.degToRad(cine.pitch);
    const dist = t.distance * this.zoomShown * cine.dist;
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
