import { Team } from './bullets';
import type { Enemy } from './enemies';
import type { Game } from './game';
import type { Hero } from './hero';
import { SCAR_COLORS } from './scars';
import { bossLike } from './bossRules';
import { bladeDance, meltdown, mirrorStorm } from './heroUlts';
import { scrapLegion, thousandCuts } from './heroes3Ults';

/**
 * Hero ultimates: one per hero (src/data/heroes.ts `ult`), charged by damage
 * dealt and kills, fired with V / L3 / R3 / D-pad up. They run on the host in
 * update() and reach clients as bullets, enemy state and effects-bus events,
 * so every player sees everyone's ultimate.
 *
 * Damage is in "typical enemies": `power(g)` is the director's HP scaling, so
 * an ultimate stays screen-clearing at every stage. Bosses take `bossMul`.
 */
export interface UltDef {
  id: string;
  name: string;
  /** One line for the hero picker and tooltips. */
  desc: string;
  color: string;
  color2: string;
  duration: number;
  /** The hero is invulnerable while it runs. */
  invuln: boolean;
}

export const ULTS: Record<string, UltDef> = {
  barrage: {
    id: 'barrage',
    name: 'MEGA BARRAGE',
    desc: 'Bullet time: enemies crawl while you spray a spiral of buster shots for 3 s.',
    color: '#ffd23f',
    color2: '#fff36b',
    duration: 3,
    invuln: true,
  },
  stomp: {
    id: 'stomp',
    name: 'TITAN STOMP',
    desc: 'Three mech stomps that crush, stun and fling everything away; the last one heals your team.',
    color: '#ffb627',
    color2: '#a7f070',
    duration: 1.6,
    invuln: true,
  },
  blitz: {
    id: 'blitz',
    name: 'SONIC BLITZ',
    desc: 'For 3.5 s you are untouchable and 75% faster, and everything you run through gets smashed.',
    color: '#73eff7',
    color2: '#41a6f6',
    duration: 3.5,
    invuln: true,
  },
  storm: {
    id: 'storm',
    name: 'LOCK-ON STORM',
    desc: 'Locks onto up to 20 enemies, then calls a lightning strike on each (bosses take three).',
    color: '#fff35c',
    color2: '#7df9ff',
    duration: 1.4,
    invuln: false,
  },
  // Mechanic heroes (src/game/heroUlts.ts).
  dance: {
    id: 'dance',
    name: 'BLADE DANCE',
    desc: 'For 2.5 s every bullet near you flies back, the closest enemies get slashed again and again, and your parry chain is full.',
    color: '#b13e53',
    color2: '#f4f4f4',
    duration: 2.5,
    invuln: true,
  },
  meltdown: {
    id: 'meltdown',
    name: 'MELTDOWN',
    desc: 'Full heat at once, then four growing fire novas that set everything on fire.',
    color: '#ff7a2f',
    color2: '#ffcd75',
    duration: 1.9,
    invuln: true,
  },
  mirror: {
    id: 'mirror',
    name: 'MIRROR STORM',
    desc: 'You and your twin spin crossfire rings and aimed fans for 3 s.',
    color: '#73eff7',
    color2: '#f4f4f4',
    duration: 3,
    invuln: true,
  },
  // heroes3 lane (src/game/systems/heroes3.ts).
  cuts: {
    id: 'cuts',
    name: 'THOUSAND CUTS',
    desc: 'Time slows and your blade is everywhere: rapid slashes on everything around you for 3 s, then one last cut on all of them.',
    color: '#b13e53',
    color2: '#f4f4f4',
    duration: 3,
    invuln: true,
  },
  legion: {
    id: 'legion',
    name: 'SCRAP LEGION',
    desc: 'Six big mechs drop in around you and blast everything near for 9 s (fewer per Tinker in big parties).',
    color: '#ffcd75',
    color2: '#73eff7',
    duration: 1.2,
    invuln: true,
  },
};

export const ultTuning = {
  /** Charge from a hit: share of the enemy's max life dealt (capped at 1 per hit) x this x horde thinning. */
  hitGain: 0.0006,
  /** Bosses charge by the share of their life you take: a whole boss is worth this much. */
  bossGain: 0.5,
  killGain: 0.0006,
  /**
   * Like utility drops, kill and hit charge thin out as the horde grows
   * (x min(1, hordeRef / enemies the director wants alive)), so an ultimate
   * comes about once a minute at every stage instead of every few seconds late.
   */
  hordeRef: 70,
  eliteGain: 0.08,
  perfectGain: 0.03,
  parryGain: 0.01,
  bossMul: 0.35,
  // Mega Barrage
  barrageEvery: 0.05,
  barrageArms: 3,
  barrageSpin: 0.37,
  barrageDmg: 2.2,
  barrageSlow: 0.75,
  // Titan Stomp
  stompAt: [0.12, 0.62, 1.12],
  stompR: [6, 7.5, 10],
  stompDmg: [7, 7, 12],
  stompStun: 0.9,
  stompKnock: 24,
  stompHeal: 0.25,
  stompHealR: 12,
  // Sonic Blitz
  blitzSpeed: 1.75,
  blitzR: 2.3,
  blitzDmg: 5,
  blitzRehit: 0.3,
  // Lock-On Storm
  stormRange: 20,
  stormTargets: 20,
  stormAt: [0.55, 0.8, 1.05],
  stormDmg: 14,
};

/** Damage scale: what a typical enemy's life grows by (stage, minute, players, difficulty). */
export function power(g: Game): number {
  return g.director.hpMul * g.difficulty.enemyHp;
}

/** Charge earned by a hit dealing `dealt` to an enemy with `maxHp` life. */
export function ultHitGain(dealt: number, maxHp: number, boss: boolean, horde = 0): number {
  const frac = Math.min(1, dealt / Math.max(1, maxHp));
  return boss ? frac * ultTuning.bossGain : frac * ultTuning.hitGain * hordeThin(horde);
}

export function ultKillGain(elite: boolean, boss: boolean, horde = 0): number {
  return boss ? 0 : elite ? ultTuning.eliteGain : ultTuning.killGain * hordeThin(horde);
}

/** 1 for small hordes, smaller as the director wants more enemies alive. */
export function hordeThin(horde: number): number {
  return Math.min(1, ultTuning.hordeRef / Math.max(1, horde));
}

export function ultOf(h: Hero): UltDef {
  return ULTS[h.heroDef.ult] ?? ULTS.barrage;
}

const T = 30; // a typical enemy's base life

function hitUlt(g: Game, h: Hero, e: Enemy, base: number, dirX: number, dirZ: number, knock: number): void {
  const dmg = base * (e.def.boss ? ultTuning.bossMul : 1);
  g.damage(e, dmg, { source: 'ult', tags: [], dirX, dirZ, knockback: knock, canCrit: true, loud: true }, h);
}

/** First frame: the big announcement. */
export function startUlt(g: Game, h: Hero): void {
  const def = ultOf(h);
  const p = h.player;
  const sk = h.skill;
  sk.ultT = def.duration;
  sk.ultTick = sk.ultStep = 0;
  sk.ultX = p.x;
  sk.ultZ = p.z;
  sk.ultA = Math.atan2(p.aim.z, p.aim.x);
  sk.ultTargets.length = 0;
  sk.ultHitAt.clear();
  if (def.invuln) p.invuln = Math.max(p.invuln, def.duration + 0.2);
  g.vfx.ring(p.x, p.z, 1, 14, def.color, 0.5);
  g.vfx.ring(p.x, p.z, 0.6, 9, '#f4f4f4', 0.35);
  g.vfx.burst(p.x, 1, p.z, { count: 36, color: def.color, color2: '#ffffff', speed: [5, 13], size: [0.18, 0.36], life: [0.35, 0.7], up: 6, gravity: 10 });
  g.vfx.star(p.x, 1.4, p.z, 4, def.color, 0.25);
  g.vfx.num(p.x, 3.4, p.z, `${def.name}!`, 'score');
  g.vfx.shake(p.x, p.z, 0.6);
  if (h === g.hero) g.input.rumble(1, 1, 380);
  // Enemy bullets near the hero are wiped so the moment reads cleanly.
  const b = g.bullets;
  for (let i = 0; i < b.count; i++) if (b.team[i] === Team.Enemy && Math.hypot(b.x[i] - p.x, b.z[i] - p.z) < 9) b.kill(i--);
  if (def.id === 'storm') lockOn(g, h);
}

function lockOn(g: Game, h: Hero): void {
  const p = h.player;
  const list = g.enemiesInRadius(p.x, p.z, ultTuning.stormRange, g.scratch).filter((e) => e.pvpOwner < 0);
  // Bosses and elites first, then the toughest.
  list.sort((a, b) => (b.def.boss ? 2 : b.elite ? 1 : 0) - (a.def.boss ? 2 : a.elite ? 1 : 0) || b.hp - a.hp);
  const sk = h.skill;
  for (const e of list) {
    if (sk.ultTargets.length >= ultTuning.stormTargets) break;
    sk.ultTargets.push(e);
    g.vfx.ring(e.x, e.z, e.radius + 0.9, -0.5, '#fff35c', 0.55);
    g.vfx.star(e.x, 1.8 * e.scale, e.z, 1.1, '#fff35c', 0.5);
  }
  g.vfx.sound('telegraph', p.x, p.z);
}

/** Per step while the ultimate runs (host). */
export function updateUlt(g: Game, h: Hero, dt: number): void {
  const sk = h.skill;
  const def = ultOf(h);
  const age = def.duration - sk.ultT;
  sk.ultT = Math.max(0, sk.ultT - dt);
  const pw = power(g);
  switch (def.id) {
    case 'barrage':
      barrage(g, h, dt, pw);
      break;
    case 'stomp':
      while (sk.ultStep < ultTuning.stompAt.length && age >= ultTuning.stompAt[sk.ultStep]) stomp(g, h, sk.ultStep++, pw);
      break;
    case 'blitz':
      blitz(g, h, dt, pw);
      break;
    case 'storm':
      while (sk.ultStep < ultTuning.stormAt.length && age >= ultTuning.stormAt[sk.ultStep]) strike(g, h, sk.ultStep++, pw);
      break;
    case 'dance':
      bladeDance(g, h, dt, pw);
      break;
    case 'meltdown':
      meltdown(g, h, age, pw);
      break;
    case 'mirror':
      mirrorStorm(g, h, dt, pw);
      break;
    case 'cuts':
      thousandCuts(g, h, dt, pw);
      break;
    case 'legion':
      scrapLegion(g, h, age);
      break;
  }
  if (sk.ultT <= 0) endUlt(g, h);
}

export function endUlt(g: Game, h: Hero): void {
  h.skill.ultT = 0;
  h.skill.ultTargets.length = 0;
  if (h === g.hero) h.player.ultSpeed = 1;
}

function barrage(g: Game, h: Hero, dt: number, pw: number): void {
  const sk = h.skill;
  const p = h.player;
  const U = ultTuning;
  // Bullet time: everything nearby crawls.
  sk.ultTick -= dt;
  if (sk.ultTick <= 0) {
    for (const e of g.enemiesInRadius(p.x, p.z, 24, g.scratch)) {
      if (e.def.behavior === 'reaper') continue;
      e.slowT = Math.max(e.slowT, 0.25);
      e.slowAmt = Math.max(e.slowAmt, U.barrageSlow);
    }
  }
  while (sk.ultTick <= 0) {
    sk.ultTick += U.barrageEvery;
    sk.ultStep++;
    sk.ultA += U.barrageSpin;
    for (let k = 0; k < U.barrageArms; k++) {
      const a = sk.ultA + (k * Math.PI * 2) / U.barrageArms;
      fire(g, h, Math.cos(a), Math.sin(a), U.barrageDmg * T * pw);
    }
    // Every few shots a fan straight down your aim.
    if (sk.ultStep % 3 === 0) {
      const base = Math.atan2(p.aim.z, p.aim.x);
      for (let k = -2; k <= 2; k++) fire(g, h, Math.cos(base + k * 0.12), Math.sin(base + k * 0.12), U.barrageDmg * T * pw);
      g.vfx.sound('w:shoot', p.x, p.z);
    }
  }
  p.recoil = Math.max(p.recoil, 1.5);
}

function fire(g: Game, h: Hero, dx: number, dz: number, dmg: number): void {
  const p = h.player;
  g.bullets.spawn({
    x: p.x + dx * 0.8,
    z: p.z + dz * 0.8,
    dirX: dx,
    dirZ: dz,
    speed: 26,
    life: 0.85,
    radius: 0.36,
    damage: dmg,
    knockback: 5,
    team: Team.Player,
    color: '#ffd23f',
    width: 0.55,
    length: 1.1,
    pierce: 1,
    owner: h.index,
    kind: 14,
  });
}

function stomp(g: Game, h: Hero, i: number, pw: number): void {
  const U = ultTuning;
  const p = h.player;
  const r = U.stompR[i];
  const last = i === U.stompAt.length - 1;
  for (const e of g.enemiesInRadius(p.x, p.z, r, g.scratch).slice()) {
    if (e.pvpOwner >= 0) continue;
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    hitUlt(g, h, e, U.stompDmg[i] * T * pw, dx / d, dz / d, U.stompKnock);
    if (e.active && !bossLike(e) && e.def.behavior !== 'reaper') e.frozen = Math.max(e.frozen, U.stompStun);
  }
  const b = g.bullets;
  for (let k = 0; k < b.count; k++) if (b.team[k] === Team.Enemy && Math.hypot(b.x[k] - p.x, b.z[k] - p.z) < r) b.kill(k--);
  p.bounce(last ? -14 : -9);
  g.vfx.ring(p.x, p.z, 1.2, r * 1.3, last ? '#ffcd75' : '#ffb627', 0.4);
  g.vfx.ring(p.x, p.z, 0.8, r, '#f4f4f4', 0.25);
  g.vfx.burst(p.x, 0.3, p.z, { count: last ? 46 : 28, color: '#f2e2b8', color2: '#ffb627', speed: [4, 12], size: [0.2, 0.45], life: [0.3, 0.7], up: 5, gravity: 14, drag: 1.5 });
  g.vfx.scar(p.x, p.z, 2.4 + i, SCAR_COLORS.crater, 16);
  g.vfx.shake(p.x, p.z, last ? 1 : 0.65);
  g.vfx.sound('explode', p.x, p.z);
  g.vfx.sound('impact', p.x, p.z, 3);
  if (h === g.hero) g.input.rumble(0.9, 0.6, 180);
  if (!last) return;
  // Healing nova: the team around you gets patched up.
  g.vfx.ring(p.x, p.z, 1, U.stompHealR, '#a7f070', 0.6);
  for (const o of g.heroes) {
    if (o.left || o.player.dead) continue;
    if (Math.hypot(o.player.x - p.x, o.player.z - p.z) > U.stompHealR) continue;
    const healed = o.player.heal(o.player.maxHp * U.stompHeal);
    if (healed > 0) g.vfx.num(o.player.x, 2.6, o.player.z, `+${Math.round(healed)}`, 'heal');
    g.vfx.burst(o.player.x, 1, o.player.z, { count: 14, color: '#a7f070', color2: '#ffffff', speed: [1, 4], size: [0.15, 0.3], life: [0.4, 0.8], up: 5, gravity: -2 });
  }
  g.vfx.sound('heal', p.x, p.z);
}

function blitz(g: Game, h: Hero, dt: number, pw: number): void {
  const U = ultTuning;
  const sk = h.skill;
  const p = h.player;
  if (h === g.hero) p.ultSpeed = U.blitzSpeed;
  p.invuln = Math.max(p.invuln, 0.15);
  sk.ultTick -= dt;
  if (sk.ultTick > 0) return;
  sk.ultTick += 0.05;
  sk.ultStep++;
  const now = g.runTime;
  for (const e of g.enemiesInRadius(p.x, p.z, U.blitzR, g.scratch).slice()) {
    if (e.pvpOwner >= 0 || (sk.ultHitAt.get(e.uid) ?? -1) > now) continue;
    sk.ultHitAt.set(e.uid, now + U.blitzRehit);
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    hitUlt(g, h, e, U.blitzDmg * T * pw, dx / d, dz / d, 16);
  }
  // Afterimages.
  g.vfx.burst(p.x, 0.9, p.z, { count: 3, color: '#73eff7', color2: '#41a6f6', speed: [0.2, 1.2], size: [0.3, 0.5], life: [0.2, 0.35], drag: 6 });
  if (sk.ultStep % 4 === 0) g.vfx.ring(p.x, p.z, 0.8, 2.6, '#73eff7', 0.25);
  if (sk.ultStep % 6 === 0) g.vfx.sound('dash', p.x, p.z);
}

function strike(g: Game, h: Hero, wave: number, pw: number): void {
  const U = ultTuning;
  const sk = h.skill;
  let any = false;
  for (const e of sk.ultTargets) {
    if (!e.active || e.hp <= 0) continue;
    // Waves 2 and 3 only hit bosses and elites.
    if (wave > 0 && !e.def.boss && !e.elite) continue;
    any = true;
    hitUlt(g, h, e, U.stormDmg * T * pw, 0, 0, 0);
    const y = 1.2 * e.scale;
    g.vfx.star(e.x, y, e.z, 2.2, '#fff35c', 0.16);
    g.vfx.burst(e.x, 6, e.z, { count: 10, color: '#fff35c', color2: '#7df9ff', speed: [0.5, 2], size: [0.18, 0.32], life: [0.12, 0.22], up: -26, gravity: 0 });
    g.vfx.burst(e.x, 0.3, e.z, { count: 8, color: '#7df9ff', color2: '#ffffff', speed: [3, 8], size: [0.12, 0.24], life: [0.2, 0.4], up: 4, gravity: 12 });
    g.vfx.ring(e.x, e.z, 0.6, 3, '#7df9ff', 0.22);
    g.vfx.scar(e.x, e.z, 1.2, SCAR_COLORS.scorch, 10);
  }
  if (!any) return;
  const p = h.player;
  g.vfx.sound('w:zap', p.x, p.z);
  g.vfx.sound('explode', p.x, p.z);
  g.vfx.shake(p.x, p.z, wave === 0 ? 0.7 : 0.4);
  g.vfx.flash(wave === 0 ? 0.35 : 0.15);
}
