import { Team } from './bullets';
import type { Enemy } from './enemies';
import type { Game } from './game';
import type { Hero } from './hero';
import { heroMechTuning } from './heroMechs';
import { SCAR_COLORS } from './scars';
import { ultTuning } from './ultimates';

/**
 * Ultimates for the mechanic heroes (registered in ULTS, src/game/ultimates.ts):
 * - Duelist, BLADE DANCE: 2.5 s untouchable; every enemy bullet within reach
 *   flies back (an automatic parry each step), nearby enemies are slashed
 *   over and over, and the parry chain jumps to full.
 * - Furnace, MELTDOWN: full heat at once, then four fire novas that grow and
 *   set everything on fire.
 * - Twin, MIRROR STORM: you and your twin spin crossfire rings and aimed fans for 3 s.
 * Damage is in "typical enemies" (30 x power), like the other ultimates.
 */
export const heroUltTuning = {
  // Blade Dance
  danceReach: 6, // bullets this close fly back
  danceSlashR: 4.5,
  danceEvery: 0.15,
  danceTargets: 4, // enemies slashed per beat
  danceDmg: 4,
  // Meltdown
  meltAt: [0.2, 0.7, 1.2, 1.7],
  meltR: [4, 6, 8, 10],
  meltDmg: [5, 5, 6, 9],
  meltBurn: 1.2, // ignite dps, x typical enemy life / 30
  // Mirror Storm
  mirrorEvery: 0.12,
  mirrorRing: 10,
  mirrorDmg: 1.6,
};

const T = 30;

function hit(
  g: Game,
  h: Hero,
  e: Enemy,
  base: number,
  dirX: number,
  dirZ: number,
  knock: number,
): void {
  g.damage(
    e,
    base * (e.def.boss ? ultTuning.bossMul : 1),
    { source: 'ult', tags: [], dirX, dirZ, knockback: knock, canCrit: true, loud: true },
    h,
  );
}

/** Duelist: Blade Dance. */
export function bladeDance(g: Game, h: Hero, dt: number, pw: number): void {
  const U = heroUltTuning;
  const sk = h.skill;
  const p = h.player;
  if (sk.ultStep === 0) {
    h.mech.chain = heroMechTuning.duelist.chainMax;
    h.mech.chainT = heroMechTuning.duelist.chainTime;
  }
  p.invuln = Math.max(p.invuln, 0.15);
  // Every enemy bullet in reach flies back at the nearest enemy.
  const b = g.bullets;
  for (let i = 0; i < b.count; i++) {
    if (b.team[i] !== Team.Enemy || Math.hypot(b.x[i] - p.x, b.z[i] - p.z) > U.danceReach) continue;
    const t = g.nearestEnemy(b.x[i], b.z[i], 16, (e) => e.pvpOwner === h.index);
    let ux = -b.vx[i];
    let uz = -b.vz[i];
    if (t) {
      ux = t.x - b.x[i];
      uz = t.z - b.z[i];
    }
    const l = Math.hypot(ux, uz) || 1;
    b.team[i] = Team.Player;
    b.vx[i] = (ux / l) * 26;
    b.vz[i] = (uz / l) * 26;
    b.damage[i] = 2 * T * pw;
    b.owner[i] = h.index;
    b.kind[i] = 13;
    b.pierce[i] = 2;
    b.clearHits(i);
    b.setColor(i, '#7df9ff');
  }
  sk.ultTick -= dt;
  if (sk.ultTick > 0) return;
  sk.ultTick += U.danceEvery;
  sk.ultStep++;
  // Slash the closest few: a crimson cut across each, alternating sides.
  const near = g
    .enemiesInRadius(p.x, p.z, U.danceSlashR, g.scratch)
    .filter((e) => e.pvpOwner < 0 && e.hp > 0);
  near.sort((a, c) => (a.x - p.x) ** 2 + (a.z - p.z) ** 2 - ((c.x - p.x) ** 2 + (c.z - p.z) ** 2));
  for (const e of near.slice(0, U.danceTargets)) {
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    hit(g, h, e, U.danceDmg * T * pw, dx / d, dz / d, 6);
    g.vfx.star(e.x, 1, e.z, 1.4, sk.ultStep % 2 ? '#b13e53' : '#ffffff', 0.1);
  }
  g.vfx.ring(p.x, p.z, 0.5, U.danceSlashR * 2, sk.ultStep % 2 ? '#b13e53' : '#f4f4f4', 0.16);
  if (sk.ultStep % 2) g.vfx.sound('parry', p.x, p.z, 1 + (sk.ultStep % 4) * 0.1);
  p.recoil = Math.max(p.recoil, 1.4);
}

/** Furnace: Meltdown. */
export function meltdown(g: Game, h: Hero, age: number, pw: number): void {
  const U = heroUltTuning;
  const sk = h.skill;
  const p = h.player;
  h.mech.heat = 1;
  while (sk.ultStep < U.meltAt.length && age >= U.meltAt[sk.ultStep]) {
    const i = sk.ultStep++;
    const r = U.meltR[i];
    for (const e of g.enemiesInRadius(p.x, p.z, r, g.scratch).slice()) {
      if (e.pvpOwner >= 0) continue;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      hit(g, h, e, U.meltDmg[i] * T * pw, dx / d, dz / d, 10);
      if (e.active && e.hp > 0) g.ignite(e, U.meltBurn * T * pw * 0.1, h);
    }
    const last = i === U.meltAt.length - 1;
    g.vfx.ring(p.x, p.z, 1, r * 2, last ? '#ffcd75' : '#ff7a2f', 0.4);
    g.vfx.ring(p.x, p.z, 0.8, r * 1.6, '#b13e53', 0.3);
    g.vfx.burst(p.x, 0.5, p.z, {
      count: last ? 50 : 30,
      color: '#ff7a2f',
      color2: '#ffcd75',
      speed: [r, r * 2],
      size: [0.2, 0.45],
      life: [0.3, 0.6],
      up: 4,
      drag: 2,
      smoke: last ? 6 : 2,
    });
    g.vfx.scar(p.x, p.z, r * 0.45, SCAR_COLORS.scorch, 14);
    g.vfx.sound('explode', p.x, p.z);
    g.vfx.shake(p.x, p.z, last ? 0.9 : 0.5);
    if (last) g.vfx.flash(0.35);
  }
}

/** Twin: Mirror Storm. */
export function mirrorStorm(g: Game, h: Hero, dt: number, pw: number): void {
  const U = heroUltTuning;
  const sk = h.skill;
  const p = h.player;
  sk.ultTick -= dt;
  while (sk.ultTick <= 0) {
    sk.ultTick += U.mirrorEvery;
    sk.ultStep++;
    const tw = h.mech.twin;
    const from: [number, number][] = [[p.x, p.z]];
    if (tw) from.push([tw.x, tw.z]);
    const spin = sk.ultStep * 0.31;
    for (const [x, z] of from) {
      if (sk.ultStep % 2) {
        // A spinning ring, mirrored: the twin's turns the other way.
        for (let k = 0; k < U.mirrorRing; k++) {
          const a = (x === p.x ? spin : -spin) + (k * Math.PI * 2) / U.mirrorRing;
          shot(g, h, x, z, Math.cos(a), Math.sin(a), U.mirrorDmg * T * pw);
        }
      } else {
        const base = Math.atan2(p.aim.z, p.aim.x);
        for (let k = -2; k <= 2; k++)
          shot(
            g,
            h,
            x,
            z,
            Math.cos(base + k * 0.14),
            Math.sin(base + k * 0.14),
            U.mirrorDmg * T * pw,
          );
      }
    }
    if (sk.ultStep % 3 === 0) g.vfx.sound('w:shoot', p.x, p.z);
  }
  p.recoil = Math.max(p.recoil, 1.2);
}

function shot(g: Game, h: Hero, x: number, z: number, dx: number, dz: number, dmg: number): void {
  g.bullets.spawn({
    x: x + dx * 0.7,
    z: z + dz * 0.7,
    dirX: dx,
    dirZ: dz,
    speed: 24,
    life: 0.8,
    radius: 0.32,
    damage: dmg,
    knockback: 4,
    team: Team.Player,
    color: '#7df9ff',
    width: 0.45,
    length: 0.9,
    pierce: 1,
    owner: h.index,
    kind: 14,
  });
}
