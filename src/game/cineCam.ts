/**
 * Crowd-aware camera framing (graphics lane): when the screen is nearly
 * empty the camera tilts lower and moves a little closer (a more cinematic
 * three-quarter view), and pulls back up to the usual high angle as the
 * fight fills the screen. Layered on top of the smart camera's zoom in
 * src/game/cameraRig.ts (`cine`), off with DYNAMIC CAMERA, faded out by the
 * mouse-wheel zoom. Aim stays exact: the cursor is projected through
 * whatever camera is drawn. Pure maths here (tests/graphics.test.ts).
 */
export const cineTuning = {
  /** Degrees the camera pitch drops at full tilt (58 -> 47), and how much closer it gets. */
  pitchDrop: 11,
  closer: 0.1,
  /** Enemies in view: full tilt at or below `calm`, none from `busy`. */
  calm: 4,
  busy: 22,
  /** Ease rates per second: settle into the low view slowly, rise quickly when it gets busy. */
  inRate: 0.35,
  outRate: 2.2,
  /** Wheel zoom: tilt fades from `zoomFrom` to zero at `zoomTo` (a zoomed-out player wants the overview). */
  zoomFrom: 1.15,
  zoomTo: 1.6,
  /** Co-op cap (teammates need the high view to stay framed). */
  coopMax: 0.5,
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Tilt target 0..1 from what the camera sees. */
export function cineTarget(near: number, boss: boolean, wheelZoom: number, coop: boolean): number {
  const t = cineTuning;
  if (boss) return 0;
  const calm = 1 - clamp01((near - t.calm) / Math.max(1, t.busy - t.calm));
  const zoomK = 1 - clamp01((wheelZoom - t.zoomFrom) / Math.max(0.01, t.zoomTo - t.zoomFrom));
  const k = calm * calm * (3 - 2 * calm) * zoomK;
  return coop ? Math.min(t.coopMax, k) : k;
}

/** Ease the shown tilt toward its target. */
export function easeCine(cur: number, target: number, dt: number): number {
  const t = cineTuning;
  const rate = target > cur ? t.inRate : t.outRate;
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

/** Pitch (degrees) and distance multiplier for a tilt amount. */
export function cinePose(basePitch: number, tilt: number): { pitch: number; dist: number } {
  const k = clamp01(tilt);
  return { pitch: basePitch - cineTuning.pitchDrop * k, dist: 1 - cineTuning.closer * k };
}
