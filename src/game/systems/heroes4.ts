/**
 * heroes4 lane: the Game side of the Medic (healer) and the Brawler (melee
 * grappler). Pure state and tuning live in src/game/heroes4.ts, the clicks in
 * src/game/weapons/medbeam.ts, revdrone.ts, fists.ts and grab.ts, the
 * ultimates in src/game/heroes4Ults.ts.
 *
 * Host (update): the beam's heals on teammates, the revive drone (fly, revive,
 * shield), the Medic's regeneration aura, Field Hospital zones, thrown enemies
 * (smash the crowd, walls, cover, pillars and barrels; lava and ice do the
 * rest), the Brawler's shoulder-charge dash, hit-stops and the unlock
 * counters. Hits on heroes pass through `heroes4HitCare` (shields, the 1-life
 * floor) from src/game/systems/statuses.ts hurtHero.
 * Clients get the zones and their own environmental-kill count through the
 * snapshot's `h4` field; everything else is weapon net state, enemy records
 * and effects-bus events.
 */
import * as THREE from 'three';
import type { Game } from '../game';
import type { Hero } from '../hero';
import type { Enemy } from '../enemies';
import type { Tag } from '../../data/tags';
import { Team } from '../bullets';
import { bossLike } from '../bossRules';
import { power, ultTuning } from '../ultimates';
import { heroHitStop } from './skill';
import { ENV_SOURCES } from './arena';
import { isCarried } from './coopplay';
import { heroes4Hooks, heroes4Tuning, hitAfterCare, onBeam, pickDowned } from '../heroes4';
import { hospitalPulse } from '../heroes4Ults';
import { commit } from '../../render/instancing';
import { settings } from '../settings';
import type { MedBeam } from '../weapons/medbeam';
import { DroneMode, type RevDrone } from '../weapons/revdrone';
import type { Fists } from '../weapons/fists';
import type { Grab, ThrowReq } from '../weapons/grab';

const MT = heroes4Tuning.medic;
const BT = heroes4Tuning.brawler;
const HT = heroes4Tuning.hospital;
const TYPICAL = 30;
const BOOM: Tag[] = ['explosive'];
const FIRE: Tag[] = ['fire'];
const MAX_ZONES = 8;

interface Thrown extends ThrowReq {
  by: number;
  t: number;
  lx: number;
  lz: number;
  hits: number[];
}

interface Zone {
  owner: number;
  x: number;
  z: number;
  /** Seconds left (goes negative while the 1-life floor lingers). */
  t: number;
  dur: number;
  pulseT: number;
  /** Per hero index: seconds a downed teammate has spent inside. */
  inside: number[];
}

interface H4World {
  runTime: number;
  thrown: Thrown[];
  zones: Zone[];
  /** Per hero index: dashing last step, enemies the current shoulder charge hit. */
  dashing: boolean[];
  dashHits: number[][];
  /** Per hero index: life healed by the Medic since the last number popup. */
  healAcc: number[];
  healAt: number[];
  auraT: number;
  /** Per hero index: environmental kills this run (the Wrecking Crew achievement). */
  envKills: number[];
  /** Client: this hero's environmental kills (from the snapshot). */
  myEnvKills: number;
  /** Lifesaver: the local hero dipped under 20% life this stage; earned. */
  lowStage: number;
  low: boolean;
  lifesaver: boolean;
  lastMode: string;
  savedAt: number;
  view: H4View | null;
}

const worlds = new WeakMap<Game, H4World>();
export function h4World(g: Game): H4World {
  let w = worlds.get(g);
  if (!w) {
    w = { runTime: 0, thrown: [], zones: [], dashing: [], dashHits: [], healAcc: [], healAt: [], auraT: 0, envKills: [], myEnvKills: 0, lowStage: -1, low: false, lifesaver: false, lastMode: '', savedAt: 0, view: null };
    worlds.set(g, w);
  }
  return w;
}

// The ultimates (src/game/heroes4Ults.ts) reach the hit-stop and the zones through these hooks.
heroes4Hooks.stop = heroHitStop;
heroes4Hooks.hospital = (g, h, x, z, seconds) => {
  const w = h4World(g);
  w.zones = w.zones.filter((zn) => zn.owner !== h.index);
  w.zones.push({ owner: h.index, x, z, t: seconds, dur: seconds, pulseT: 0, inside: [] });
  g.vfx.sound('fieldHospital', x, z);
  g.vfx.ring(x, z, 1, HT.radius * 2, '#a7f070', 0.5);
  g.vfx.burst(x, 0.5, z, { count: 30, color: '#a7f070', color2: '#ffffff', speed: [3, 9], size: [0.15, 0.3], life: [0.4, 0.8], up: 6, gravity: 6 });
};

const weaponOf = <T>(h: Hero, id: string): T | undefined => h.weapons.find((w) => w.def.id === id) as T | undefined;

// ---------------------------------------------------------------- host step

/** Host step, after the heroes' weapons (called from updateHeroMechs). */
export function updateHeroes4(g: Game, dt: number): void {
  const w = h4World(g);
  if (g.runTime < w.runTime - 0.5 || g.mode === 'title') {
    w.thrown.length = 0;
    w.zones.length = 0;
    w.envKills.length = 0;
    w.dashHits.length = 0;
    w.dashing.length = 0;
  }
  w.runTime = g.runTime;
  if (!g.heroes.some((h) => h.heroDef.mech === 'medic' || h.heroDef.mech === 'brawler') && !w.thrown.length && !w.zones.length) return;
  const fighting = g.isCombatMode;
  w.auraT -= dt;
  const auraTick = w.auraT <= 0;
  if (auraTick) w.auraT += 0.25;
  for (const h of g.heroes) {
    if (h.left) continue;
    const mech = h.heroDef.mech;
    if (mech === 'medic') medicStep(g, w, h, dt, fighting && auraTick);
    else if (mech === 'brawler') brawlerStep(g, w, h);
  }
  stepThrown(g, w, dt);
  stepZones(g, w, dt);
  healNumbers(g, w);
}

function medicStep(g: Game, w: H4World, h: Hero, dt: number, aura: boolean): void {
  const p = h.player;
  // The beam heals teammates it passes through.
  const beam = weaponOf<MedBeam>(h, 'medbeam');
  if (beam?.on && beam.ticked) {
    for (const o of g.heroes) {
      if (o === h || o.left || o.player.dead) continue;
      if (!onBeam(o.player.x, o.player.z, o.player.radius, beam.ox, beam.oz, beam.angle, beam.len, beam.halfW)) continue;
      w.healAcc[o.index] = (w.healAcc[o.index] ?? 0) + o.player.heal(beam.p.heal);
    }
  }
  // Teammates near the Medic regenerate.
  if (aura && !p.dead)
    for (const o of g.heroes) {
      if (o === h || o.left || o.player.dead) continue;
      if ((o.player.x - p.x) ** 2 + (o.player.z - p.z) ** 2 > MT.auraR * MT.auraR) continue;
      w.healAcc[o.index] = (w.healAcc[o.index] ?? 0) + o.player.heal(MT.auraRegen * 0.25);
    }
  const d = weaponOf<RevDrone>(h, 'revdrone');
  if (d) droneStep(g, w, h, d, dt);
}

function droneStep(g: Game, w: H4World, h: Hero, d: RevDrone, dt: number): void {
  const p = h.player;
  if (d.req) {
    d.req = false;
    // Whom to help: a downed teammate near the cursor, else a shield for the teammate at the cursor (else the Medic).
    const reach = d.p.range;
    const ax = p.x + p.aim.x * p.landDist(0, reach);
    const az = p.z + p.aim.z * p.landDist(0, reach);
    const downed = pickDowned(
      g.heroes.map((o) => ({ x: o.player.x, z: o.player.z, ok: o !== h && !o.left && o.player.dead && !isCarried(g, o), o })),
      p.x,
      p.z,
      ax,
      az,
      reach,
    );
    if (downed) d.launchRevive(downed.o.index, h.ctx);
    else {
      let pick = h;
      let bd = MT.aimPick * MT.aimPick;
      for (const o of g.heroes) {
        if (o === h || o.left || o.player.dead) continue;
        const dd = (o.player.x - ax) ** 2 + (o.player.z - az) ** 2;
        if (dd < bd) {
          bd = dd;
          pick = o;
        }
      }
      d.launchShield(pick.index, h.ctx);
      const tp = pick.player;
      g.vfx.ring(tp.x, tp.z, 0.6, 3, '#73eff7', 0.3);
      g.vfx.num(tp.x, 2.6, tp.z, 'SHIELD', 'heal');
      if (d.p.patch > 0) w.healAcc[pick.index] = (w.healAcc[pick.index] ?? 0) + tp.heal(d.p.patch);
    }
  }
  const t = g.heroes[d.target];
  if (d.mode === DroneMode.Idle) return;
  if (!t || t.left) {
    d.endShield(h.ctx);
    return;
  }
  const tp = t.player;
  if (d.mode === DroneMode.Shield) {
    if (tp.dead) {
      d.endShield(h.ctx);
      return;
    }
    const a = g.runTime * 4;
    d.x = tp.x + Math.cos(a) * MT.shieldOrbit;
    d.z = tp.z + Math.sin(a) * MT.shieldOrbit;
    d.bx = tp.x;
    d.bz = tp.z;
    return;
  }
  // Revive: fly there, hover, pick them up.
  if (!tp.dead || isCarried(g, t)) {
    d.endShield(h.ctx);
    return;
  }
  d.bx = tp.x;
  d.bz = tp.z;
  if (d.mode === DroneMode.Flying) {
    const dx = tp.x - d.x;
    const dz = tp.z - d.z;
    const dist = Math.hypot(dx, dz);
    const step = MT.droneSpeed * dt;
    if (dist <= step + 0.3) {
      d.x = tp.x;
      d.z = tp.z;
      d.mode = DroneMode.Reviving;
      d.prog = 0;
      g.vfx.ring(tp.x, tp.z, 0.5, 3.5, d.evoColor, 0.3);
      g.vfx.sound('heal', tp.x, tp.z);
    } else {
      d.x += (dx / dist) * step;
      d.z += (dz / dist) * step;
    }
    return;
  }
  d.x = tp.x;
  d.z = tp.z;
  d.prog = Math.min(1, d.prog + dt / Math.max(0.2, d.p.reviveTime));
  if (g.stepN % 8 === 0) g.vfx.burst(tp.x, 0.4, tp.z, { count: 3, color: d.evoColor, color2: '#ffffff', speed: [0.5, 2], size: [0.12, 0.22], life: [0.4, 0.7], up: 4, gravity: -2 });
  if (d.prog < 1) return;
  // Up you get.
  const phoenix = d.p.burst > 0;
  g.reviveHero(t, Math.min(1, d.p.reviveHp));
  tp.heal(d.p.patch);
  tp.invuln = Math.max(tp.invuln, phoenix ? 3 : 2);
  g.vfx.num(tp.x, 3, tp.z, 'DRONE REVIVE!', 'heal');
  g.vfx.sound('droneRevive', tp.x, tp.z);
  if (phoenix) phoenixBurst(g, h, tp.x, tp.z);
  d.endShield(null);
}

/** Phoenix Drone: a healing fire burst round a revived teammate. */
function phoenixBurst(g: Game, h: Hero, x: number, z: number): void {
  const pw = power(g);
  for (const o of g.heroes) {
    if (o.left || o.player.dead) continue;
    if ((o.player.x - x) ** 2 + (o.player.z - z) ** 2 > MT.phoenixR * MT.phoenixR) continue;
    o.player.heal(o.player.maxHp * MT.phoenixHeal);
  }
  for (const e of g.enemiesInRadius(x, z, MT.phoenixR, g.scratch).slice()) {
    if (e.pvpOwner >= 0 || e.hp <= 0) continue;
    g.damage(e, MT.phoenixBurn * TYPICAL * pw * (bossLike(e) ? ultTuning.bossMul : 1), { source: 'revdrone', tags: FIRE, dirX: e.x - x, dirZ: e.z - z, knockback: 8, canCrit: true, loud: true }, h);
  }
  g.vfx.ring(x, z, 1, MT.phoenixR * 2, '#ef7d57', 0.4);
  g.vfx.burst(x, 0.6, z, { count: 30, color: '#ef7d57', color2: '#ffcd75', speed: [4, 10], size: [0.18, 0.35], life: [0.4, 0.8], up: 8, gravity: 8 });
}

function brawlerStep(g: Game, w: H4World, h: Hero): void {
  const p = h.player;
  const f = weaponOf<Fists>(h, 'fists');
  if (f) {
    if (f.hayHits > 0) heroHitStop(g, h, BT.hayStop);
    if (f.hits > 0 && h === g.hero) g.juice.kick(p.aim.x, p.aim.z, f.step === 2 ? 2.2 : 0.9);
  }
  const gr = weaponOf<Grab>(h, 'grab');
  if (gr) {
    for (const r of gr.throws) w.thrown.push({ ...r, by: h.index, t: 0, lx: r.e.x, lz: r.e.z, hits: [] });
    gr.throws.length = 0;
    if (gr.upHit) heroHitStop(g, h, 0.07);
  }
  // The dash is a shoulder charge.
  const was = w.dashing[h.index] ?? false;
  const now = p.dashing && !p.dead;
  w.dashing[h.index] = now;
  if (!now) return;
  const hits = (w.dashHits[h.index] ??= []);
  if (!was) hits.length = 0;
  const vl = Math.hypot(p.vel.x, p.vel.z) || 1;
  const dx = p.vel.x / vl;
  const dz = p.vel.z / vl;
  let n = 0;
  for (const e of g.enemiesInRadius(p.x, p.z, BT.chargeR + 1, g.scratch).slice()) {
    if (e.pvpOwner === h.index || e.hp <= 0 || hits.includes(e.uid)) continue;
    if ((e.x - p.x) ** 2 + (e.z - p.z) ** 2 > (BT.chargeR + e.radius) ** 2) continue;
    hits.push(e.uid);
    const ox = e.x - p.x;
    const oz = e.z - p.z;
    const ol = Math.hypot(ox, oz) || 1;
    // Bowled forward and to the side.
    const kx = dx * 0.75 + (ox / ol) * 0.55;
    const kz = dz * 0.75 + (oz / ol) * 0.55;
    const kl = Math.hypot(kx, kz) || 1;
    g.damage(e, BT.chargeDmg, { source: 'shoulder', tags: ['area'], dirX: kx / kl, dirZ: kz / kl, knockback: 0, canCrit: true, loud: n < 3 }, h);
    if (e.active && !bossLike(e)) {
      const kb = BT.chargeKnock * h.stats.knockbackMul * (e.elite ? 0.55 : 1);
      e.kx = (kx / kl) * kb;
      e.kz = (kz / kl) * kb;
    }
    e.squash(-8);
    n++;
  }
  if (n > 0) {
    g.vfx.star(p.x + dx, 1, p.z + dz, 1.4, '#ffcd75', 0.1);
    g.vfx.sound('hitMetal', p.x, p.z, 0.8);
    g.vfx.shake(p.x, p.z, 0.15);
  }
  // Shoulder through cover: crates crack, pillars topple.
  const fx = p.x + dx * 0.8;
  const fz = p.z + dz * 0.8;
  if (g.hitToys(fx, fz, 0.5, BT.toyDmg * 0.5, h.index, dx * 10, dz * 10)) g.vfx.star(fx, 1, fz, 1.2, '#ffffff', 0.1);
  const bi = g.barrels.hitTest(fx, fz, 0.5);
  if (bi >= 0) g.barrels.hit(bi, 3, h.index);
}

// ---------------------------------------------------------------- thrown enemies

function stepThrown(g: Game, w: H4World, dt: number): void {
  for (let i = 0; i < w.thrown.length; i++) {
    const r = w.thrown[i];
    const e = r.e;
    const by = g.heroes[r.by] ?? g.hero;
    if (!e.active || e.uid !== r.uid || e.hp <= 0) {
      w.thrown.splice(i--, 1);
      continue;
    }
    // Did it stop short last step (a wall, cover)? The enemy update resolves walls; we see the result.
    const moved = Math.hypot(e.x - r.lx, e.z - r.lz);
    if (r.t > 0.03 && moved < r.speed * dt * 0.3) {
      crash(g, r, by);
      w.thrown.splice(i--, 1);
      continue;
    }
    r.t += dt;
    r.lx = e.x;
    r.lz = e.z;
    if (r.t >= r.flight) {
      land(g, r, by);
      w.thrown.splice(i--, 1);
      continue;
    }
    // Keep it flying: a fast knockback counts as "knocked into" lava, thorns and ice (src/game/hazards.ts).
    e.kx = r.dirX * r.speed;
    e.kz = r.dirZ * r.speed;
    e.vx = e.vz = 0;
    e.slowT = Math.max(e.slowT, 0.1);
    e.slowAmt = 1;
    // Smash everything on the way.
    for (const o of g.enemiesInRadius(e.x, e.z, e.radius + BT.throwHitR + 1, g.scratch).slice()) {
      if (o === e || o.hp <= 0 || o.pvpOwner >= 0 || r.hits.includes(o.uid)) continue;
      if ((o.x - e.x) ** 2 + (o.z - e.z) ** 2 > (o.radius + e.radius + BT.throwHitR) ** 2) continue;
      r.hits.push(o.uid);
      const ox = o.x - e.x;
      const oz = o.z - e.z;
      const ol = Math.hypot(ox, oz) || 1;
      const kx = r.dirX * 0.6 + (ox / ol) * 0.7;
      const kz = r.dirZ * 0.6 + (oz / ol) * 0.7;
      const kl = Math.hypot(kx, kz) || 1;
      g.damage(o, r.dmg, { source: 'grab', dirX: kx / kl, dirZ: kz / kl, knockback: 0, canCrit: true, loud: r.hits.length <= 3 }, by);
      if (o.active && !bossLike(o)) {
        const kb = BT.throwKnock * by.stats.knockbackMul * (o.elite ? 0.55 : 1);
        o.kx = (kx / kl) * kb;
        o.kz = (kz / kl) * kb;
      }
      o.squash(-9);
      g.vfx.star(o.x, 1, o.z, 1.2, '#ffffff', 0.08);
      if (r.hits.length === 3) g.vfx.num(o.x, 2.8, o.z, 'STRIKE!', 'crit');
    }
    const bi = g.barrels.hitTest(e.x, e.z, e.radius + 0.3);
    if (bi >= 0) g.barrels.hit(bi, 3, r.by);
    if (g.stepN % 3 === 0) g.vfx.burst(e.x, 0.8, e.z, { count: 2, color: '#f2e2b8', color2: '#ffffff', speed: [0.3, 1.5], size: [0.2, 0.35], life: [0.2, 0.35], drag: 4 });
  }
}

/** A thrown enemy slammed into a wall or cover: the cover takes the hit (pillars topple), the enemy takes more. */
function crash(g: Game, r: Thrown, by: Hero): void {
  const e = r.e;
  const hx = e.x + r.dirX * (e.radius + 0.35);
  const hz = e.z + r.dirZ * (e.radius + 0.35);
  g.hitToys(hx, hz, 0.45, BT.toyDmg, r.by, r.dirX * r.speed, r.dirZ * r.speed);
  g.vfx.num(e.x, 2.4, e.z, 'SLAM!', 'crit');
  g.vfx.star(hx, 1.1, hz, 1.8, '#ffcd75', 0.12);
  g.vfx.burst(hx, 1, hz, { count: 12, color: '#f2e2b8', color2: '#ffcd75', speed: [3, 8], size: [0.15, 0.3], life: [0.25, 0.5], up: 4, gravity: 12 });
  g.vfx.sound('impact', hx, hz, 1.2);
  g.vfx.shake(hx, hz, 0.3);
  e.kx = -r.dirX * 3;
  e.kz = -r.dirZ * 3;
  g.damage(e, r.dmg * BT.wallDmg, { source: 'grab', dirX: -r.dirX, dirZ: -r.dirZ, knockback: 0, canCrit: true, loud: true }, by);
  impact(g, r, by, e.x, e.z);
}

/** A thrown enemy lands. */
function land(g: Game, r: Thrown, by: Hero): void {
  const e = r.e;
  g.vfx.burst(e.x, 0.3, e.z, { count: 10, color: '#f2e2b8', color2: '#ffffff', speed: [2, 5], size: [0.15, 0.3], life: [0.3, 0.5], up: 3, gravity: 10, dust: 4 });
  g.vfx.sound('impact', e.x, e.z, 1.5);
  g.damage(e, r.dmg * BT.landDmg, { source: 'grab', dirX: r.dirX, dirZ: r.dirZ, knockback: 0, canCrit: true, loud: true }, by);
  impact(g, r, by, e.x, e.z);
}

/** Splash round the impact; Piledriver blows up. */
function impact(g: Game, r: Thrown, by: Hero, x: number, z: number): void {
  if (r.boom) {
    g.blast(x, z, BT.boomR, r.dmg, '#b13e53', 'grab', BOOM, false, by);
    for (const o of g.enemiesInRadius(x, z, BT.boomR, g.scratch)) {
      if (!o.active || o.hp <= 0 || bossLike(o) || o.pvpOwner >= 0) continue;
      const dx = o.x - x;
      const dz = o.z - z;
      const d = Math.hypot(dx, dz) || 1;
      o.kx = (dx / d) * BT.throwKnock;
      o.kz = (dz / d) * BT.throwKnock;
    }
    g.blastToys(x, z, BT.boomR, BT.toyDmg, r.by);
    return;
  }
  for (const o of g.enemiesInRadius(x, z, r.splash, g.scratch).slice()) {
    if (o === r.e || o.hp <= 0 || o.pvpOwner >= 0 || r.hits.includes(o.uid)) continue;
    const dx = o.x - x;
    const dz = o.z - z;
    const d = Math.hypot(dx, dz) || 1;
    g.damage(o, r.dmg * 0.5, { source: 'grab', dirX: dx / d, dirZ: dz / d, knockback: 0, canCrit: true, loud: false }, by);
    if (o.active && !bossLike(o)) {
      o.kx = (dx / d) * BT.throwKnock * 0.6;
      o.kz = (dz / d) * BT.throwKnock * 0.6;
    }
  }
  g.vfx.ring(x, z, 0.4, r.splash * 2, '#ffcd75', 0.22);
}

// ---------------------------------------------------------------- Field Hospital

function stepZones(g: Game, w: H4World, dt: number): void {
  const pw = power(g);
  const b = g.bullets;
  for (let i = 0; i < w.zones.length; i++) {
    const zn = w.zones[i];
    zn.t -= dt;
    if (zn.t < -HT.floorGrace) {
      w.zones.splice(i--, 1);
      continue;
    }
    if (zn.t <= 0) continue;
    const owner = g.heroes[zn.owner] ?? g.hero;
    const r2 = HT.radius * HT.radius;
    for (const o of g.heroes) {
      if (o.left) continue;
      const p = o.player;
      if ((p.x - zn.x) ** 2 + (p.z - zn.z) ** 2 > r2) {
        zn.inside[o.index] = 0;
        continue;
      }
      if (p.dead) {
        if (isCarried(g, o)) continue;
        zn.inside[o.index] = (zn.inside[o.index] ?? 0) + dt;
        if (zn.inside[o.index] >= HT.reviveAfter) {
          zn.inside[o.index] = 0;
          g.reviveHero(o, 0.35);
          g.vfx.num(p.x, 3, p.z, 'BACK ON YOUR FEET!', 'heal');
        }
        continue;
      }
      w.healAcc[o.index] = (w.healAcc[o.index] ?? 0) + p.heal(p.maxHp * HT.healPerSec * dt);
    }
    // Enemy shots fizzle inside the ward.
    if (g.stepN % 2 === 0)
      for (let k = 0; k < b.count; k++) {
        if (b.team[k] !== Team.Enemy) continue;
        if ((b.x[k] - zn.x) ** 2 + (b.z[k] - zn.z) ** 2 > r2) continue;
        if (k % 3 === 0) g.vfx.star(b.x[k], 1, b.z[k], 0.5, '#a7f070', 0.08);
        b.kill(k--);
      }
    zn.pulseT -= dt;
    if (zn.pulseT <= 0) {
      zn.pulseT += HT.pulse;
      hospitalPulse(g, owner, zn.x, zn.z, pw);
      g.vfx.ring(zn.x, zn.z, HT.radius * 0.3, HT.radius * 1.9, '#a7f070', 0.25);
    }
  }
}

/** Is this spot under a Field Hospital (open, or its 1-life floor lingering)? */
function inZone(w: H4World, x: number, z: number): boolean {
  for (const zn of w.zones) if ((x - zn.x) ** 2 + (z - zn.z) ** 2 <= HT.radius * HT.radius) return true;
  return false;
}

function healNumbers(g: Game, w: H4World): void {
  for (const o of g.heroes) {
    const acc = w.healAcc[o.index] ?? 0;
    if (acc >= 2 && g.runTime >= (w.healAt[o.index] ?? 0)) {
      w.healAt[o.index] = g.runTime + 0.8;
      w.healAcc[o.index] = 0;
      g.vfx.num(o.player.x, 2.5, o.player.z, `+${Math.round(acc)}`, 'heal');
    }
  }
}

// ---------------------------------------------------------------- hooks

/**
 * Before a hit lands on a hero (src/game/systems/statuses.ts hurtHero): a
 * revive-drone shield blocks it (Guardian Drone zaps the attacker), Field
 * Hospital keeps the hero at 1 life. Returns the damage that still lands (0 = none).
 */
export function heroes4HitCare(g: Game, h: Hero, dmg: number, src: Enemy | null): number {
  const w = worlds.get(g);
  let shield: RevDrone | null = null;
  let medic: Hero | null = null;
  for (const o of g.heroes) {
    if (o.heroDef.mech !== 'medic' || o.left) continue;
    const d = weaponOf<RevDrone>(o, 'revdrone');
    if (d && d.mode === DroneMode.Shield && d.target === h.index && d.hits > 0) {
      shield = d;
      medic = o;
      break;
    }
  }
  if (!shield && !w?.zones.length) return dmg;
  const p = h.player;
  const r = hitAfterCare(dmg, p.hp, shield ? shield.hits : 0, !!w && inZone(w, p.x, p.z));
  if (r.blocked && shield && medic) {
    shield.hits--;
    p.invuln = Math.max(p.invuln, 0.5);
    g.vfx.ring(p.x, p.z, 0.8, 3, '#73eff7', 0.25);
    g.vfx.star(p.x, 1.2, p.z, 1.6, '#73eff7', 0.12);
    g.vfx.num(p.x, 2.6, p.z, 'BLOCKED', 'heal');
    g.vfx.sound('block', p.x, p.z);
    if (shield.p.zap > 0 && src?.active) guardianZap(g, medic, src);
  } else if (r.saved && w && g.runTime >= w.savedAt) {
    w.savedAt = g.runTime + 0.6;
    g.vfx.num(p.x, 2.8, p.z, 'SAVED!', 'heal');
    g.vfx.ring(p.x, p.z, 0.6, 2.5, '#a7f070', 0.25);
  }
  return r.dmg;
}

function guardianZap(g: Game, medic: Hero, src: Enemy): void {
  const dmg = MT.guardianDmg * TYPICAL * power(g);
  for (const e of g.enemiesInRadius(src.x, src.z, MT.guardianR, g.scratch).slice()) {
    if (e.pvpOwner >= 0 || e.hp <= 0) continue;
    g.damage(e, dmg * (bossLike(e) ? ultTuning.bossMul : 1) * (e === src ? 1 : 0.5), { source: 'revdrone', tags: ['shock', 'chain'], canCrit: true, loud: e === src }, medic);
    g.vfx.star(e.x, 1, e.z, 1, '#ffcd75', 0.08);
  }
  g.vfx.sound('w:minionZap', src.x, src.z, 0.8);
}

/** Every kill: environmental kills count toward the Wrecking Crew achievement for the hero credited. */
export function heroes4OnKill(g: Game, _e: Enemy, source: string, by: Hero | null): void {
  if (!by || !ENV_SOURCES.includes(source)) return;
  const w = h4World(g);
  w.envKills[by.index] = (w.envKills[by.index] ?? 0) + 1;
}

/** Achievements that unlock the Medic and the Brawler (appended to heroMechAchievements). */
export function heroes4Achievements(g: Game): [string, boolean][] {
  const w = h4World(g);
  const env = g.authority ? (w.envKills[g.hero.index] ?? 0) : w.myEnvKills;
  return [
    ['lifesaver', w.lifesaver],
    ['wrecking_crew', env >= BT.envKills],
  ];
}

/** Lifesaver bookkeeping, every machine: a dip under 20% life, then the stage cleared alive. */
function trackLifesaver(g: Game, w: H4World): void {
  const p = g.hero.player;
  if (g.stage !== w.lowStage) {
    w.lowStage = g.stage;
    w.low = false;
  }
  if (g.mode === 'fight' && !p.dead && p.hp > 0 && p.hp < p.maxHp * MT.lowLife) w.low = true;
  if (g.mode === 'cleared' && w.lastMode !== 'cleared' && w.low && !p.dead && !w.lifesaver) {
    w.lifesaver = true;
    g.checkAchievements();
  }
  w.lastMode = g.mode;
}

// ---------------------------------------------------------------- network

/** Snapshot field `h4`: `z` the open Field Hospitals [owner, x, z, t, dur], `ek` this client's environmental kills. */
export function heroes4Net(g: Game, forHero: Hero): { z?: number[]; ek?: number } | undefined {
  const w = worlds.get(g);
  if (!w) return undefined;
  const ek = w.envKills[forHero.index] ?? 0;
  if (!w.zones.length && !ek) return undefined;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const z: number[] = [];
  for (const zn of w.zones) z.push(zn.owner, r1(zn.x), r1(zn.z), r1(zn.t), zn.dur);
  return { z: z.length ? z : undefined, ek: ek || undefined };
}

/** Client: mirror the zones and this hero's environmental kills. */
export function applyHeroes4Net(g: Game, data: unknown): void {
  const w = h4World(g);
  const d = (data ?? {}) as { z?: unknown; ek?: unknown };
  w.myEnvKills = typeof d.ek === 'number' ? d.ek : w.myEnvKills;
  const a = Array.isArray(d.z) ? (d.z as number[]) : [];
  w.zones.length = 0;
  for (let k = 0; k + 4 < a.length; k += 5) w.zones.push({ owner: a[k], x: a[k + 1], z: a[k + 2], t: a[k + 3], dur: a[k + 4], pulseT: 0, inside: [] });
}

// ---------------------------------------------------------------- drawing

/** The Medic's aura rings and Field Hospital wards (instanced, every machine). */
class H4View {
  readonly auras: THREE.InstancedMesh;
  readonly discs: THREE.InstancedMesh;
  readonly rings: THREE.InstancedMesh;
  readonly crosses: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private scene: THREE.Scene) {
    const glow = (color: string, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    // A dashed ring (8 segments) for the aura, so it reads as "range", not as a wall.
    const dash: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) dash.push(new THREE.RingGeometry(0.96, 1, 4, 1, (i / 8) * Math.PI * 2, (Math.PI * 2) / 16).rotateX(-Math.PI / 2));
    const auraGeo = mergeFlat(dash);
    for (const g of dash) g.dispose();
    this.auras = new THREE.InstancedMesh(auraGeo, glow('#a7f070', 0.35), 8);
    this.discs = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2), glow('#a7f070', 0.22), MAX_ZONES);
    this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.94, 1, 40, 1).rotateX(-Math.PI / 2), glow('#f4f4f4', 0.7), MAX_ZONES);
    // A big flat plus hovering over each ward (the camera looks down, so it lies flat and turns slowly).
    const cross = mergeFlat([new THREE.BoxGeometry(1.5, 0.18, 0.46), new THREE.BoxGeometry(0.46, 0.18, 1.5)]);
    this.crosses = new THREE.InstancedMesh(cross, glow('#a7f070', 0.9), MAX_ZONES);
    for (const m of [this.auras, this.discs, this.rings, this.crosses]) {
      m.frustumCulled = false;
      m.count = 0;
      m.renderOrder = 1;
      scene.add(m);
    }
  }

  draw(g: Game, w: H4World): void {
    const t = g.animTime;
    let na = 0;
    if (g.heroes.length > 1)
      for (const h of g.heroes) {
        if (h.heroDef.mech !== 'medic' || h.left || h.player.dead || na >= 8) continue;
        const pos = h.player.rig.root.position;
        this.q.setFromAxisAngle(this.up, t * 0.4);
        this.m4.compose(this.v.set(pos.x, 0.06, pos.z), this.q, this.s.set(MT.auraR, 1, MT.auraR));
        this.auras.setMatrixAt(na++, this.m4);
      }
    let nz = 0;
    let nc = 0;
    for (const zn of w.zones) {
      if (nz >= MAX_ZONES) break;
      // Opens with a pop, closes by shrinking away (the floor lingers a moment).
      const open = Math.min(1, (zn.dur - zn.t) / 0.25);
      const close = zn.t > 0 ? 1 : Math.max(0, 1 + zn.t / HT.floorGrace);
      const r = HT.radius * open * (0.6 + 0.4 * close);
      this.q.identity();
      this.m4.compose(this.v.set(zn.x, 0.05, zn.z), this.q, this.s.set(r, 1, r));
      this.discs.setMatrixAt(nz, this.m4);
      this.q.setFromAxisAngle(this.up, -t * 0.8);
      const rr = r * (1 + Math.sin(t * 6) * 0.015);
      this.m4.compose(this.v.set(zn.x, 0.08, zn.z), this.q, this.s.set(rr, 1, rr));
      this.rings.setMatrixAt(nz++, this.m4);
      const bob = Math.sin(t * 2.5) * 0.2;
      const cs = 1.4 * open * close;
      this.q.setFromAxisAngle(this.up, t * 0.7);
      this.m4.compose(this.v.set(zn.x, 3.6 + bob, zn.z), this.q, this.s.set(cs, cs, cs));
      this.crosses.setMatrixAt(nc++, this.m4);
      // Rising sparkles inside the ward (local, cosmetic).
      if (zn.t > 0 && !g.paused && Math.random() < 0.5) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * HT.radius;
        g.particles.burst(zn.x + Math.cos(a) * d, 0.2, zn.z + Math.sin(a) * d, { count: 1, color: '#a7f070', color2: '#ffffff', speed: [0.2, 0.6], size: [0.12, 0.22], life: [0.6, 1], up: 3, drag: 1 });
      }
    }
    (this.discs.material as THREE.MeshBasicMaterial).opacity = settings.reduceFlash ? 0.16 : 0.22 + Math.sin(t * 4) * 0.03;
    this.auras.count = na;
    this.discs.count = this.rings.count = nz;
    this.crosses.count = nc;
    this.auras.visible = na > 0;
    this.discs.visible = this.rings.visible = nz > 0;
    this.crosses.visible = nc > 0;
    commit(this.auras.instanceMatrix, na);
    commit(this.discs.instanceMatrix, nz);
    commit(this.rings.instanceMatrix, nz);
    commit(this.crosses.instanceMatrix, nc);
  }

  dispose(): void {
    for (const m of [this.auras, this.discs, this.rings, this.crosses]) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}

/** Merge non-indexed position-only geometries (no attribute mismatch worries). */
function mergeFlat(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g).getAttribute('position').array as Float32Array);
  const out = new Float32Array(parts.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of parts) {
    out.set(a, o);
    o += a.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  return g;
}

/** Draw the auras and wards, spin a Wrecking Ball, track Lifesaver. Every machine. */
export function renderHeroes4(g: Game, frameDt: number): void {
  const w = h4World(g);
  if (g.mode !== 'title') trackLifesaver(g, w);
  const any = w.zones.length > 0 || g.heroes.some((h) => h.heroDef.mech === 'medic' || h.heroDef.mech === 'brawler');
  if (!any && !w.view) return;
  if (!w.view || w.view.discs.parent !== g.scene) {
    w.view?.dispose();
    w.view = new H4View(g.scene);
  }
  if (!g.authority && !g.paused) for (const zn of w.zones) zn.t -= frameDt; // smooth between snapshots
  w.view.draw(g, w);
  // Wrecking Ball: the Brawler spins (every machine, from the synced ultimate timer).
  for (const h of g.heroes) {
    if (h.heroDef.mech !== 'brawler' || h.player.dead) continue;
    if (h.skill.ultT > 0 && h.heroDef.ult === 'wrecking') {
      const rig = h.player.rig;
      rig.body.rotation.y = g.animTime * 22;
      rig.armR.rotation.order = rig.armL.rotation.order = 'YXZ';
      rig.armR.rotation.z = -1.3;
      rig.armL.rotation.z = 1.3;
    }
  }
}
