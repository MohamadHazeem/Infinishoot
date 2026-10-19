/**
 * World lane hazards that run on the host (solo and online host): the Toy
 * Factory's crusher stamps. Pads come from the arena (same seed, same pads on
 * every machine); the slam timing follows the stage clock (director time), so
 * clients animate the presses from their synced timer (src/world/worldRender.ts)
 * and receive the slam effects on the effects bus. Called from updateHazards.
 */
import type { Game } from '../game';
import { crusherSlammed, crusherPhase, crusherTuning, hazardTuning } from '../hazards';
import { SCAR_COLORS } from '../scars';

const lastT = new WeakMap<Game, { arena: unknown; t: number }>();

/** Stage clock the crushers run on (host): the director's time while fighting. */
export function crusherClock(game: Game): number {
  return game.director.time;
}

export function updateWorldHazards(this: Game, dt: number): void {
  void dt;
  const zones = this.arena.hazards;
  let st = lastT.get(this);
  const t = crusherClock(this);
  if (!st || st.arena !== this.arena || t < st.t) {
    st = { arena: this.arena, t };
    lastT.set(this, st);
    return;
  }
  const t0 = st.t;
  st.t = t;
  if (this.mode !== 'fight' || this.pvp?.phase === 'duel') return;
  const C = crusherTuning;
  const warnAt = 1 - C.warn / C.period;
  for (let i = 0, k = 0; i < zones.length; i++) {
    const z = zones[i];
    if (z.kind !== 'crusher') continue;
    const idx = k++;
    // Telegraph: a red danger zone with a closing ring (replayed on clients).
    const p0 = crusherPhase(t0, idx);
    const p1 = crusherPhase(t, idx);
    if (p0 < warnAt && p1 >= warnAt) this.vfx.zone(z.x, z.z, z.r, C.warn);
    if (!crusherSlammed(t0, t, idx)) continue;
    slam(this, z.x, z.z, z.r);
  }
}

function slam(game: Game, x: number, z: number, r: number): void {
  const C = crusherTuning;
  game.vfx.sound('bossSlam', x, z, 1.5);
  game.vfx.shake(x, z, 0.35);
  game.vfx.ring(x, z, r * 0.8, 3.2, '#ffcd3a', 0.3);
  game.vfx.burst(x, 0.3, z, { count: 16, color: '#f4f4f4', color2: '#ffcd3a', speed: [3, 8], size: [0.15, 0.32], life: [0.3, 0.6], up: 3, gravity: 10, drag: 2 });
  game.vfx.scar(x, z, r * 0.9, SCAR_COLORS.crater, 4);
  // Enemies on the pad are flattened (elites and the Reaper lose a share of their life).
  for (const e of game.enemies.list) {
    if (!e.alive || e.def.boss || e.pvpOwner >= 0 || e.hopY > 0) continue;
    if ((e.x - x) ** 2 + (e.z - z) ** 2 > (r + e.radius * 0.5) ** 2) continue;
    const tough = e.elite || e.def.behavior === 'reaper';
    if (!tough) game.vfx.num(e.x, 1.4, e.z, 'SQUASH!', 'crit');
    game.envHit(e, 'crusher', tough ? e.maxHp * Math.max(C.eliteFrac, hazardTuning.eliteFrac) : e.hp + e.shield + 1);
  }
  // Heroes on the pad get bopped (a dash or a jump dodges it).
  for (const h of game.aliveHeroes) {
    const p = h.player;
    if (p.dashing || game.toys.jumps[h.index]) continue;
    if ((p.x - x) ** 2 + (p.z - z) ** 2 > r * r) continue;
    game.hurtHero(h, C.heroDmg * game.director.dmgMul, x, z, null, 'Crusher');
  }
}
