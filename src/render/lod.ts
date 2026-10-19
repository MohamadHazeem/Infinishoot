import * as THREE from 'three';

/**
 * Presentation LOD for big co-op teams (eightp lane). Nothing here touches
 * gameplay or the effects wire: it only decides how much of an effect this
 * machine draws.
 *
 *  - Particle bursts away from the local hero thin out with distance and with
 *    the number of heroes (8 heroes' weapons would otherwise fill the
 *    particle pool with effects you can barely see), never below `minMul`.
 *    Bursts near you keep full detail; solo and 2-player games are untouched.
 *  - Hero overlays (merged outline hull and x-ray, src/render/rigOverlay.ts)
 *    are drawn with frustum culling off; teammates off screen skip them, which
 *    saves 3 draw calls per hidden teammate.
 */
export const lodTuning = {
  /** Full particle detail within this distance of the local hero (m). */
  near: 14,
  /** Detail falls to farMul at this distance (m). */
  far: 42,
  farMul: 0.45,
  /** Away from you, each hero past two thins effects by this much more. */
  perHero: 0.07,
  /** Never thinner than this. */
  minMul: 0.25,
  /** Teams this size and up use the distance falloff (2-player games keep every particle). */
  fromHeroes: 3,
  /** NDC margin for "on screen" (overlays of heroes just past the edge stay on). */
  screenMargin: 1.25,
};

/** Updated every rendered frame by src/game/systems/eightp.ts. */
export const lodState = { x: 0, z: 0, heroes: 1 };

/** Particle count multiplier for a burst at (x, z). */
export function particleLod(x: number, z: number): number {
  const T = lodTuning;
  const s = lodState;
  if (s.heroes < T.fromHeroes) return 1;
  const d = Math.hypot(x - s.x, z - s.z);
  if (d <= T.near) return 1;
  const k = Math.min(1, (d - T.near) / (T.far - T.near));
  const byDist = 1 - k * (1 - T.farMul);
  const byTeam = 1 / (1 + T.perHero * Math.max(0, s.heroes - 2));
  return Math.max(T.minMul, byDist * byTeam);
}

const v = new THREE.Vector3();

/** Is a point (a hero's chest height) inside the camera view, with a margin? */
export function onScreen(camera: THREE.Camera, x: number, y: number, z: number, margin = lodTuning.screenMargin): boolean {
  v.set(x, y, z).project(camera);
  return v.z < 1 && Math.abs(v.x) < margin && Math.abs(v.y) < margin;
}
