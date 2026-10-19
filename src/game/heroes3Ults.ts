/**
 * heroes3 lane: the Ronin's and the Tinker's ultimates (registered in ULTS,
 * src/game/ultimates.ts). Kept apart from src/game/systems/heroes3.ts so the
 * ultimates stay importable headless (no audio or UI imports).
 * - Ronin, THOUSAND CUTS: time slows, rapid slashes land on everything within
 *   11 m for 3 s (round-robin over the closest 12), then one last cut on all of them.
 * - Tinker, SCRAP LEGION: big mechs drop in around the Tinker one by one and
 *   fight for 9 s (they live in the bot pool; fewer per Tinker in big parties).
 * Damage is in "typical enemies" (30 x power), like the other ultimates.
 */
import type { Game } from './game';
import type { Hero } from './hero';
import { heroes3Hooks, heroes3Tuning, legionCount, minionsOf, MinionKind } from './heroes3';
import { ultTuning } from './ultimates';

const CT = heroes3Tuning.cuts;
const LT = heroes3Tuning.legion;
const TYPICAL = 30;

/** Ronin: THOUSAND CUTS. Time slows; slashes land on everything around, then one last sheathe cut. */
export function thousandCuts(g: Game, h: Hero, dt: number, pw: number): void {
  const sk = h.skill;
  const p = h.player;
  if (sk.ultStep === 0 && sk.ultTick === 0) {
    sk.ultTick = 0.0001;
    heroes3Hooks.slowMo(g, CT.slowMo);
    g.vfx.flash(0.25);
  }
  p.invuln = Math.max(p.invuln, 0.15);
  // Everything nearby crawls.
  if (g.stepN % 6 === 0)
    for (const e of g.enemiesInRadius(p.x, p.z, CT.range + 4, g.scratch)) {
      if (e.def.behavior === 'reaper') continue;
      e.slowT = Math.max(e.slowT, 0.2);
      e.slowAmt = Math.max(e.slowAmt, CT.slow);
    }
  sk.ultTick -= dt;
  while (sk.ultTick <= 0 && sk.ultT > 0) {
    sk.ultTick += CT.every;
    sk.ultStep++;
    const list = g.enemiesInRadius(p.x, p.z, CT.range, g.scratch).filter((e) => e.pvpOwner < 0 && e.hp > 0);
    if (!list.length) break;
    // Round-robin over the closest, so crowds all get cut and lone enemies get cut a lot.
    list.sort((a, c) => (a.x - p.x) ** 2 + (a.z - p.z) ** 2 - ((c.x - p.x) ** 2 + (c.z - p.z) ** 2));
    const e = list[sk.ultStep % Math.min(list.length, 12)];
    const a = g.rng.next() * Math.PI;
    g.damage(e, CT.dmg * TYPICAL * pw * (e.def.boss ? ultTuning.bossMul : 1), { source: 'ult', tags: [], dirX: Math.cos(a), dirZ: Math.sin(a), knockback: 3, canCrit: true, loud: true }, h);
    if (!sk.ultTargets.includes(e)) sk.ultTargets.push(e);
    // A slash streak across the target, alternating white and crimson.
    const y = 1 * e.scale;
    heroes3Hooks.slash(g, e.x, e.z, a, 2.6 + e.radius * 2, sk.ultStep % 3 === 0 ? 1 : 0);
    g.vfx.burst(e.x, y, e.z, { count: 4, color: sk.ultStep % 2 ? '#ffffff' : '#b13e53', color2: '#f4f4f4', speed: [8, 14], size: [0.07, 0.13], life: [0.06, 0.12], dir: { x: Math.cos(a), z: Math.sin(a), spread: 0.2 } });
    g.vfx.star(e.x, y, e.z, 1.2, '#ffffff', 0.07);
    if (sk.ultStep % 2) g.vfx.sound('swordSlash', e.x, e.z, 0.9 + (sk.ultStep % 5) * 0.06);
  }
  p.recoil = Math.max(p.recoil, 1.2);
  if (sk.ultT > 0) return;
  // The sheathe: every enemy cut takes one more, heavy cut at once.
  let n = 0;
  for (const e of sk.ultTargets) {
    if (!e.active || e.hp <= 0) continue;
    g.damage(e, CT.finale * TYPICAL * pw * (e.def.boss ? ultTuning.bossMul : 1), { source: 'ult', tags: [], canCrit: true, loud: n++ < 6 }, h);
    if (n < 10) {
      g.vfx.star(e.x, 1, e.z, 2, '#b13e53', 0.14);
      // A crimson X on each.
      heroes3Hooks.slash(g, e.x, e.z, Math.PI / 4, 3.4 + e.radius * 2, 1);
      heroes3Hooks.slash(g, e.x, e.z, -Math.PI / 4, 3.4 + e.radius * 2, 1);
    }
  }
  g.vfx.ring(p.x, p.z, 1, CT.range * 2, '#f4f4f4', 0.3);
  g.vfx.num(p.x, 3.4, p.z, 'SHEATHE', 'score');
  g.vfx.sound('swordCombo', p.x, p.z, 0.8);
  g.vfx.shake(p.x, p.z, 0.8);
  g.vfx.flash(0.3);
  if (n > 0) heroes3Hooks.stop(g, h, 0.12);
}

/** Tinker: SCRAP LEGION. Big mechs drop in around the Tinker, one after another, and fight for `life` seconds. */
export function scrapLegion(g: Game, h: Hero, age: number): void {
  const sk = h.skill;
  const p = h.player;
  const pool = minionsOf(g);
  const n = legionCount(g.heroes.filter((o) => !o.left).length);
  while (sk.ultStep < n && age >= sk.ultStep * LT.stagger) {
    const k = sk.ultStep++;
    const a = Math.atan2(p.aim.z, p.aim.x) + (k / n) * Math.PI * 2;
    const x = p.x + Math.cos(a) * 3;
    const z = p.z + Math.sin(a) * 3;
    if (pool.spawn(h.index, MinionKind.Mech, x, z, LT.life) < 0) break;
    g.vfx.ring(x, z, 0.5, 4, '#ffcd75', 0.3);
    g.vfx.burst(x, 0.3, z, { count: 18, color: '#f2e2b8', color2: '#ffcd75', speed: [3, 8], size: [0.2, 0.4], life: [0.3, 0.6], up: 4, gravity: 14, dust: 6 });
    g.vfx.shake(x, z, 0.35);
    g.vfx.sound('summon', x, z, 0.75);
    g.vfx.sound('impact', x, z, 2);
  }
}
