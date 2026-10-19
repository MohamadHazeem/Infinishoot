/**
 * Crowd spacing (readability lane). Enemies.update applies these after its
 * soft separation so a swarm stays a crowd of readable bodies instead of one
 * blob, and never stands on top of a hero (the hero must stay visible).
 * Bosses, the Reaper and hidden PvP stand-ins skip all of it.
 */
export const crowdTuning = {
  /** Soft separation speed per unit of overlap (m/s); was a fixed 7. */
  push: 12,
  /** Jammed enemies (summed overlap with their neighbours) chase slower: wanted speed / (1 + overlap * jam). */
  jam: 2,
  /** Two enemies may overlap until their centres are this fraction of their radii sum apart; closer is corrected outright. */
  hardGap: 0.72,
  /** Share of a hard overlap fixed per step (each enemy of the pair fixes its own half). */
  hardFix: 0.5,
  /**
   * Enemies keep their centre at least this fraction of (enemy + hero radius)
   * away from every living hero. Below 1 so contact damage (which needs
   * distance < enemy + hero radius) still lands.
   */
  heroGap: 0.8,
};

/** Push `e` out of the heroes' personal space (positional, no velocity change). Returns true if it moved. */
export function keepOffHeroes(e: { x: number; z: number; radius: number }, targets: readonly { x: number; z: number; radius: number; alive: boolean }[]): boolean {
  let moved = false;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!t.alive) continue;
    const ox = e.x - t.x;
    const oz = e.z - t.z;
    const min = (e.radius + t.radius) * crowdTuning.heroGap;
    const d2 = ox * ox + oz * oz;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2);
    if (d < 1e-4) {
      e.x = t.x + min; // dead centre: any side will do
    } else {
      e.x = t.x + (ox / d) * min;
      e.z = t.z + (oz / d) * min;
    }
    moved = true;
  }
  return moved;
}
