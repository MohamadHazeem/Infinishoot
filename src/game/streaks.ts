import type * as THREE from 'three';
import { trails, TrailStyle } from './trails';

/**
 * Motion streaks behind fast things (discs, missiles, bounce drones, charge
 * shots). Weapons add a piece from where a thing was drawn last frame to
 * where it is now; the pieces are glowing ribbon segments (src/game/trails.ts)
 * that join up into a trail and taper away. Cosmetic and local: weapons and
 * bullets add them from render(), so every machine draws its own from synced
 * positions.
 */
class Streaks {
  /** Off for players who turn effects down (LOW quality). */
  get enabled(): boolean {
    return trails.enabled;
  }
  set enabled(v: boolean) {
    trails.enabled = v;
  }

  attach(scene: THREE.Scene): void {
    trails.attach(scene);
  }

  /** A streak from (x0, z0) to (x1, z1) at height y. */
  add(x0: number, z0: number, x1: number, z1: number, y: number, width: number, color: THREE.ColorRepresentation, life = 0.18): void {
    // A bit wider and longer-lived than the old box slivers: a ribbon reads as a trail.
    trails.ribbon(x0, z0, x1, z1, y, width, color, life * 1.3, TrailStyle.Glow);
  }

  render(dt: number): void {
    trails.render(dt);
  }

  clear(): void {
    trails.clear();
  }
}

export const streaks = new Streaks();
