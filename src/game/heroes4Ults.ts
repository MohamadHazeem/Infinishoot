/**
 * heroes4 lane: the Medic's and the Brawler's ultimates (registered in ULTS,
 * src/game/ultimates.ts). Kept apart from src/game/systems/heroes4.ts so the
 * ultimates stay importable headless (no audio or UI imports).
 * - Medic, FIELD HOSPITAL: a big zone where the Medic stands. Allies inside
 *   heal fast, enemy bullets entering it fizzle, nobody inside can drop below
 *   1 life, downed teammates inside get back up, and every pulse sterilises
 *   (damages and slows) the enemies inside. The zone itself lives in the
 *   system (it drives the 1-life floor and the snapshot).
 * - Brawler, WRECKING BALL: a ground pound, then the Brawler spins through
 *   the arena for 4 s, faster, untouchable, pulling enemies in and launching
 *   everything it hits (into lava, thorns, walls and pillars).
 * Damage is in "typical enemies" (30 x power), like the other ultimates.
 */
import type { Game } from './game';
import type { Hero } from './hero';
import { bossLike } from './bossRules';
import { heroes4Hooks, heroes4Tuning } from './heroes4';
import { ultTuning } from './ultimates';

const HT = heroes4Tuning.hospital;
const WT = heroes4Tuning.wrecking;
const TYPICAL = 30;

/** Medic: FIELD HOSPITAL. The zone opens on the first step; the system runs it. */
export function fieldHospital(g: Game, h: Hero, duration: number): void {
  const sk = h.skill;
  if (sk.ultStep > 0) return;
  sk.ultStep = 1;
  heroes4Hooks.hospital(g, h, sk.ultX, sk.ultZ, duration);
}

/** One pulse of Field Hospital on the enemies inside (called by the system every `pulse` s). */
export function hospitalPulse(g: Game, h: Hero, x: number, z: number, pw: number): number {
  let n = 0;
  for (const e of g.enemiesInRadius(x, z, HT.radius, g.scratch).slice()) {
    if (e.pvpOwner >= 0 || e.hp <= 0) continue;
    const dx = e.x - x;
    const dz = e.z - z;
    const d = Math.hypot(dx, dz) || 1;
    g.damage(e, HT.pulseDmg * TYPICAL * pw * (e.def.boss ? ultTuning.bossMul : 1), { source: 'ult', tags: [], dirX: dx / d, dirZ: dz / d, knockback: 4, canCrit: true, loud: n < 4 }, h);
    if (e.active && e.def.behavior !== 'reaper') {
      e.slowT = Math.max(e.slowT, HT.pulse + 0.1);
      e.slowAmt = Math.max(e.slowAmt, HT.slow);
    }
    n++;
  }
  return n;
}

/** Brawler: WRECKING BALL. A ground pound, then a spinning rampage. */
export function wreckingBall(g: Game, h: Hero, dt: number, pw: number): void {
  const sk = h.skill;
  const p = h.player;
  if (h === g.hero) p.ultSpeed = WT.speed;
  p.invuln = Math.max(p.invuln, 0.15);
  const now = g.runTime;
  if (sk.ultStep === 0) {
    sk.ultStep = 1;
    // The opening ground pound.
    for (const e of g.enemiesInRadius(p.x, p.z, WT.poundR, g.scratch).slice()) {
      if (e.pvpOwner >= 0 || e.hp <= 0) continue;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      g.damage(e, WT.poundDmg * TYPICAL * pw * (e.def.boss ? ultTuning.bossMul : 1), { source: 'ult', tags: [], dirX: dx / d, dirZ: dz / d, knockback: 0, canCrit: true, loud: true }, h);
      launch(e, dx / d, dz / d, WT.knock * 0.8);
    }
    g.vfx.ring(p.x, p.z, 1, WT.poundR * 2, '#ffcd75', 0.35);
    g.vfx.burst(p.x, 0.3, p.z, { count: 26, color: '#f2e2b8', color2: '#ffcd75', speed: [4, 10], size: [0.2, 0.45], life: [0.3, 0.7], up: 5, gravity: 14, dust: 8 });
    g.vfx.scar(p.x, p.z, 2.4, '#333c57', 12);
    g.vfx.shake(p.x, p.z, 0.8);
    g.vfx.sound('wreckingBall', p.x, p.z);
    heroes4Hooks.stop(g, h, 0.08);
    return;
  }
  sk.ultTick -= dt;
  // Enemies around drift into the spin.
  if (g.stepN % 3 === 0)
    for (const e of g.enemiesInRadius(p.x, p.z, WT.pullR, g.scratch)) {
      if (e.pvpOwner >= 0 || bossLike(e) || e.def.behavior === 'reaper') continue;
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < WT.r) continue;
      e.x += (dx / d) * WT.pull * dt * 3;
      e.z += (dz / d) * WT.pull * dt * 3;
    }
  if (sk.ultTick > 0) return;
  sk.ultTick += 0.05;
  sk.ultStep++;
  let n = 0;
  for (const e of g.enemiesInRadius(p.x, p.z, WT.r, g.scratch).slice()) {
    if (e.pvpOwner >= 0 || e.hp <= 0 || (sk.ultHitAt.get(e.uid) ?? -1) > now) continue;
    sk.ultHitAt.set(e.uid, now + WT.rehit);
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    // Launched along the spin (a tangent kick plus out), so they scatter like pins.
    const tx = -dz / d;
    const tz = dx / d;
    g.damage(e, WT.dmg * TYPICAL * pw * (e.def.boss ? ultTuning.bossMul : 1), { source: 'ult', tags: [], dirX: dx / d, dirZ: dz / d, knockback: 0, canCrit: true, loud: n < 4 }, h);
    launch(e, dx / d * 0.7 + tx * 0.7, dz / d * 0.7 + tz * 0.7, WT.knock);
    e.squash(-10);
    n++;
  }
  // Smash cover and barrels in the way.
  g.blastToys(p.x, p.z, WT.r * 0.8, 40, h.index);
  const bi = g.barrels.hitTest(p.x, p.z, WT.r * 0.8);
  if (bi >= 0) g.barrels.hit(bi, 3, h.index);
  if (n > 0 && sk.ultStep % 2 === 0) g.vfx.sound('hitMetal', p.x, p.z, 0.8);
  // A whirl of dust and sparks.
  if (sk.ultStep % 2 === 0) g.vfx.burst(p.x, 0.5, p.z, { count: 4, color: '#f2e2b8', color2: '#ef7d57', speed: [3, 7], size: [0.2, 0.4], life: [0.25, 0.45], up: 2, drag: 2 });
  if (sk.ultStep % 5 === 0) g.vfx.ring(p.x, p.z, 0.8, WT.r * 2, '#ef7d57', 0.2);
  if (sk.ultStep % 8 === 0) g.vfx.sound('w:throw', p.x, p.z);
}

function launch(e: { active: boolean; def: { boss?: boolean; behavior: string }; kx: number; kz: number; elite: boolean } & Parameters<typeof bossLike>[0], dx: number, dz: number, k: number): void {
  if (!e.active || bossLike(e) || e.def.behavior === 'reaper') return;
  const l = Math.hypot(dx, dz) || 1;
  const kb = k * (e.elite ? 0.5 : 1);
  e.kx = (dx / l) * kb;
  e.kz = (dz / l) * kb;
}
