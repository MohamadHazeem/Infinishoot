import * as THREE from 'three';

export interface CinematicKeyframe {
  /** Seconds from the beginning; strictly increasing, first frame at zero. */
  time: number;
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fov?: number;
  /** Hard cut when this keyframe is reached; otherwise ease into it. */
  cut?: boolean;
}

/** Local presentation only. Apply after the follow rig, never in gameplay update. */
export class CinematicCamera {
  private frames: readonly CinematicKeyframe[] = [];
  private elapsed = 0;
  private look = new THREE.Vector3();
  private savedPosition = new THREE.Vector3();
  private savedQuaternion = new THREE.Quaternion();
  private savedFov = 50;
  active = false;
  constructor(readonly camera: THREE.PerspectiveCamera) {}

  play(frames: readonly CinematicKeyframe[]): void {
    if (!frames.length || frames[0].time !== 0) throw new Error('Cinematic track must start at zero');
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (!Number.isFinite(f.time) || (i > 0 && f.time <= frames[i - 1].time)
        || ![...f.position, ...f.target].every(Number.isFinite)
        || (f.fov !== undefined && (!Number.isFinite(f.fov) || f.fov < 10 || f.fov > 120))) throw new Error('Invalid cinematic keyframe');
    }
    if (!this.active) {
      this.savedPosition.copy(this.camera.position); this.savedQuaternion.copy(this.camera.quaternion); this.savedFov = this.camera.fov;
    }
    // Own the track so caller edits cannot invalidate it while playing.
    this.frames = frames.map(f => ({ ...f, position: [...f.position], target: [...f.target], fov: f.fov ?? this.savedFov }));
    this.elapsed = 0; this.active = true; this.seek(0);
  }

  /** Seek/hold is useful for story panels and deterministic screenshots. */
  seek(seconds: number, reducedMotion = false): void {
    if (!this.active) return;
    const fs = this.frames;
    this.elapsed = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, fs[fs.length - 1].time));
    let i = 0;
    while (i + 1 < fs.length && fs[i + 1].time <= this.elapsed) i++;
    const a = fs[i], b = fs[Math.min(i + 1, fs.length - 1)];
    const u = b.time === a.time || b.cut || reducedMotion ? 0 : (this.elapsed - a.time) / (b.time - a.time);
    const k = u * u * (3 - 2 * u);
    this.camera.position.set(a.position[0] + (b.position[0] - a.position[0]) * k, a.position[1] + (b.position[1] - a.position[1]) * k, a.position[2] + (b.position[2] - a.position[2]) * k);
    this.look.set(a.target[0] + (b.target[0] - a.target[0]) * k, a.target[1] + (b.target[1] - a.target[1]) * k, a.target[2] + (b.target[2] - a.target[2]) * k);
    this.camera.lookAt(this.look);
    const fov = a.fov! + (b.fov! - a.fov!) * k;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld();
  }
  /** Returns true at the end, holding the final pose until stop() or another track. */
  update(dt: number, reducedMotion = false): boolean {
    if (!this.active) return true;
    this.seek(this.elapsed + Math.max(0, Number.isFinite(dt) ? dt : 0), reducedMotion);
    return this.elapsed >= this.frames[this.frames.length - 1].time;
  }
  stop(restore = true): void {
    if (!this.active) return;
    this.active = false; this.frames = [];
    if (restore) {
      this.camera.position.copy(this.savedPosition); this.camera.quaternion.copy(this.savedQuaternion); this.camera.fov = this.savedFov;
      this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
    }
  }
}
