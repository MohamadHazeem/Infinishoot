/**
 * heroes3 lane: the Game side of the Ronin (melee) and the Tinker (summoner).
 * Pure state and tuning live in src/game/heroes3.ts, the clicks in
 * src/game/weapons/katana.ts, iaido.ts and beacon.ts.
 *
 * Host (update): sword hit-stop and the dash-strike's dash for local heroes,
 * the parry counter-slash, Tinker bots (built over time, follow, zap, soak
 * bullets), the beacon's Repair Field, both ultimates (Thousand Cuts, Scrap
 * Legion) and the unlock achievements. Clients get the bots through the
 * snapshot's `h3` field and dash their own Ronin themselves (`heroes3ClientStep`).
 * Everything else is weapon net state, bullets and effects-bus events.
 *
 * Wired in through small calls from src/game/systems/heroMechs.ts (update,
 * render, parry, achievements), statuses.ts (kills), netHost.ts / netClient.ts
 * and ultimates.ts.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Game } from '../game';
import type { Hero } from '../hero';
import type { Enemy } from '../enemies';
import type { Tag } from '../../data/tags';
import { Team } from '../bullets';
import { settings } from '../settings';
import { ultTuning } from '../ultimates';
import { heroHitStop } from './skill';
import { lagSteps } from './netcode';
import { heroes3Hooks, heroes3Tuning, minionCap, minionsOf, MinionKind, MinionPool, packMinions, SLASH_COLORS, SlashLog, unpackMinions, unpackSlashes, zapDamage, MAX_MINIONS } from '../heroes3';
import { createRetroMaterial } from '../../render/retroMaterial';
import { paint } from '../../render/geometry';
import { commit } from '../../render/instancing';
import type { Katana } from '../weapons/katana';
import type { Iaido } from '../weapons/iaido';
import type { Beacon } from '../weapons/beacon';

const RT = heroes3Tuning.ronin;
/** Host: a reported dash-strike path must start or end this close to where the host has the hero (m). */
const RT_PATH_REACH = 8;
const TT = heroes3Tuning.tinker;
const LT = heroes3Tuning.legion;
const TYPICAL = 30; // a typical enemy's base life (ultimates scale by it, like src/game/ultimates.ts)
const BOT_TAGS: readonly Tag[] = ['chain'];
const MECH_TAGS: Tag[] = ['explosive'];

interface H3World {
  /** The bot pool (src/game/heroes3.ts minionsOf). */
  minions: MinionPool;
  /** Per hero index: seconds to the next bot. */
  build: number[];
  /** Per hero index: next allowed zap sound / loud zap number (run time). */
  soundAt: number[];
  loudAt: number[];
  /** Per hero index: life repaired by beacons since the last number popup. */
  healAcc: number[];
  healAt: number[];
  runTime: number;
  born: number[];
  view: MinionView | null;
  gear: WeakMap<Hero, THREE.Object3D | null>;
  /** Host: recent slash marks for the snapshot; client: the newest one drawn. */
  slashes: SlashLog;
  slashSeen: number;
  slashFx: SlashFx | null;
}

// The ultimates (src/game/heroes3Ults.ts) reach the hit-stop and slow motion through these hooks.
heroes3Hooks.stop = heroHitStop;
heroes3Hooks.slowMo = (g, seconds) => {
  if (!g.online && settings.slowMo !== false) g.slowMoT = Math.max(g.slowMoT, seconds);
};
heroes3Hooks.slash = (g, x, z, a, len, c) => {
  const w = h3World(g);
  if (g.role === 'host') w.slashes.add(x, z, a, len, c, g.runTime);
  slashFx(g).spawn(x, z, a, len, c);
};

const worlds = new WeakMap<Game, H3World>();
export function h3World(g: Game): H3World {
  let w = worlds.get(g);
  if (!w) {
    w = { minions: minionsOf(g), build: [], soundAt: [], loudAt: [], healAcc: [], healAt: [], runTime: 0, born: [], view: null, gear: new WeakMap(), slashes: new SlashLog(), slashSeen: 0, slashFx: null };
    worlds.set(g, w);
  }
  return w;
}

const weaponOf = <T>(h: Hero, id: string): T | undefined => h.weapons.find((w) => w.def.id === id) as T | undefined;
const power = (g: Game) => g.director.hpMul * g.difficulty.enemyHp;
const tinkers = (g: Game) => g.heroes.filter((h) => !h.left && h.heroDef.mech === 'tinker').length;

// ---------------------------------------------------------------- host step

/** Host step, after the heroes' weapons (called from updateHeroMechs). */
export function updateHeroes3(g: Game, dt: number): void {
  const w = h3World(g);
  // A new run (or the title) clears the bots.
  if (g.runTime < w.runTime - 0.5 || g.mode === 'title') {
    w.minions.clear();
    w.build.length = 0;
  }
  w.runTime = g.runTime;
  const fighting = g.mode === 'fight' && g.isCombatMode;
  const nT = tinkers(g);
  for (const h of g.heroes) {
    if (h.left) continue;
    const p = h.player;
    const id = h.heroDef.mech;
    if (id === 'ronin') roninStep(g, h);
    if (id !== 'tinker') continue;
    // Build a bot every few seconds, up to the cap.
    if (fighting && !p.dead) {
      w.build[h.index] = (w.build[h.index] ?? 1) - dt;
      if (w.build[h.index] <= 0) {
        w.build[h.index] = TT.buildEvery * h.stats.cooldownMul;
        if (w.minions.countOf(h.index, MinionKind.Bot) < minionCap(g.level, nT)) buildBot(g, h);
      }
    }
    // Repair Field: heals heroes standing in the Tinker's beacon.
    const bc = weaponOf<Beacon>(h, 'beacon');
    if (bc?.active && fighting) repairField(g, h, bc, dt);
  }
  stepMinions(g, w, dt);
}

function roninStep(g: Game, h: Hero): void {
  const p = h.player;
  const k = weaponOf<Katana>(h, 'katana');
  if (k) {
    if (k.cleaveHits > 0) heroHitStop(g, h, RT.cleaveStop);
    if (k.hits > 0 && h === g.hero) g.juice.kick(p.aim.x, p.aim.z, k.step === 2 ? 2.4 : 1.1);
  }
  const s = weaponOf<Iaido>(h, 'iaido');
  if (!s) return;
  // A connected client dashes its own Ronin and reports the path (`iai`, heroes3StrikeMsg); an autopilot hero has no client.
  s.clientDriven = g.role === 'host' && !!h.remote && !!h.peerId;
  if (s.stopReq > 0) heroHitStop(g, h, s.stopReq);
  // The dash itself: local heroes here; a client dashes its own hero (heroes3ClientStep).
  if (s.lunge.want && !h.remote && !p.dead) {
    p.lunge(s.lunge.dirX, s.lunge.dirZ, s.lunge.time, s.lunge.speed);
    if (h === g.hero) g.juice.kick(s.lunge.dirX, s.lunge.dirZ, 3);
  }
}

const clientLast = { x: 0, z: 0 };
/** Client: the dash-strike in progress per game (reported to the host when the dash ends). */
const clientStrikes = new WeakMap<Game, { focus: number; sx: number; sz: number; t: number }>();
/** Client: dash-strikes reported to the host (the coop script reads it). */
export const heroes3ClientStats = { strikes: 0 };
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Host: a client's Ronin finished a dash-strike on its own screen: [focus, start, end] of the path it
 * travelled. The strike is judged here (recharge, focus, length, a start near where the host has the
 * hero) and cut along that path, against enemies where the client saw them (lag compensation).
 */
export function heroes3StrikeMsg(g: Game, h: Hero, m: Record<string, unknown>): void {
  const s = weaponOf<Iaido>(h, 'iaido');
  const p = h.player;
  if (!s || p.dead || !g.isCombatMode || !h.remote) return;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
  const focus = n(m.f);
  const sx = n(m.sx);
  const sz = n(m.sz);
  const ex = n(m.ex);
  const ez = n(m.ez);
  if (![focus, sx, sz, ex, ez].every(Number.isFinite) || focus < RT.focusMin || focus > 1.01) return;
  // The path starts about where the host has had this hero lately (its smoothed position trails the reports).
  if (Math.hypot(sx - p.x, sz - p.z) > RT_PATH_REACH && Math.hypot(ex - p.x, ez - p.z) > RT_PATH_REACH) return;
  // The cut comes the client's cut delay after its dash ended, less the time this report spent getting here.
  s.remoteStrike({ focus: Math.min(1, focus), sx, sz, ex, ez, cutIn: RT.cutDelay - lagSteps(g, h.index) / 60 });
}

/** Client: its own Ronin's dash-strike, from its own right click (the host judges the hits). */
export function heroes3ClientStep(g: Game, dt: number, control: boolean, charging: boolean): void {
  const h = g.hero;
  if (h.heroDef.mech !== 'ronin' || !g.isCombatMode) return;
  const s = weaponOf<Iaido>(h, 'iaido');
  if (!s) return;
  // A teleport (jump pad, new stage, toys) drops the focus instead of dashing off from the new spot.
  const p = h.player;
  if ((p.x - clientLast.x) ** 2 + (p.z - clientLast.z) ** 2 > 16 && !p.dashing) s.predFocus = 0;
  clientLast.x = p.x;
  clientLast.z = p.z;
  const focus = s.predFocus;
  const dist = s.predict(dt, control && charging && !h.player.dead);
  if (dist > 0 && !h.player.dead) {
    const a = h.player.aim;
    h.player.lunge(a.x, a.z, dist / RT.dashSpeed, RT.dashSpeed);
    g.juice.kick(a.x, a.z, 3);
    clientStrikes.set(g, { focus, sx: p.x, sz: p.z, t: 0 });
  }
  // The dash is over (or cut short): tell the host the path this hero travelled.
  const c = clientStrikes.get(g);
  if (c && (c.t += dt) > 0.02 && !p.dashing) {
    clientStrikes.delete(g);
    if (!p.dead) {
      g.client?.send({ t: 'iai', f: r2(c.focus), sx: r2(c.sx), sz: r2(c.sz), ex: r2(p.x), ez: r2(p.z) });
      heroes3ClientStats.strikes++;
    }
  }
}

function buildBot(g: Game, h: Hero): void {
  const w = h3World(g);
  const p = h.player;
  // Assembled at the Tinker's back.
  const a = Math.atan2(p.aim.z, p.aim.x) + Math.PI + (g.rng.next() - 0.5) * 1.6;
  const x = p.x + Math.cos(a) * 1.3;
  const z = p.z + Math.sin(a) * 1.3;
  if (w.minions.spawn(h.index, MinionKind.Bot, x, z) < 0) return;
  g.vfx.sound('summon', x, z);
  g.vfx.burst(x, 0.5, z, { count: 10, color: '#ffcd75', color2: '#73eff7', speed: [1.5, 4], size: [0.1, 0.2], life: [0.25, 0.5], up: 4, gravity: 10 });
  g.vfx.ring(x, z, 0.3, 1.6, '#ffcd75', 0.25);
}

function repairField(g: Game, h: Hero, bc: Beacon, dt: number): void {
  const w = h3World(g);
  const r = bc.fieldR;
  const heal = bc.p.heal;
  for (const o of g.heroes) {
    if (o.left || o.player.dead) continue;
    if ((o.player.x - bc.x) ** 2 + (o.player.z - bc.z) ** 2 > r * r) continue;
    const got = o.player.heal(heal * dt);
    w.healAcc[o.index] = (w.healAcc[o.index] ?? 0) + got;
  }
  for (const o of g.heroes) {
    const acc = w.healAcc[o.index] ?? 0;
    if (acc >= 1 && g.runTime >= (w.healAt[o.index] ?? 0)) {
      w.healAt[o.index] = g.runTime + 1;
      w.healAcc[o.index] = 0;
      g.vfx.num(o.player.x, 2.5, o.player.z, `+${Math.round(acc)}`, 'heal');
    }
  }
  void h;
}

/** Is this spot inside a Repair Field of `owner`'s beacon? Returns the bot zap-speed boost (0 = no). */
function fieldBoost(g: Game, owner: number, x: number, z: number): number {
  const h = g.heroes[owner];
  const bc = h && weaponOf<Beacon>(h, 'beacon');
  if (!bc?.active) return 0;
  const r = bc.fieldR;
  return (x - bc.x) ** 2 + (z - bc.z) ** 2 <= r * r ? bc.p.boost : 0;
}

/** Per owner: skip that hero's own PvP stand-in (cached, no allocation per retarget). */
const skipOwn: ((e: Enemy) => boolean)[] = [];
const seen = (owner: number) => (skipOwn[owner] ??= (e: Enemy) => e.pvpOwner === owner);

function stepMinions(g: Game, w: H3World, dt: number): void {
  const m = w.minions;
  const b = g.bullets;
  const soak = g.stepN % 2 === 0;
  for (let i = 0; i < m.top; i++) {
    if (!m.alive[i]) continue;
    const o = g.heroes[m.owner[i]];
    if (!o || o.left) {
      m.free(i);
      continue;
    }
    m.age[i] += dt;
    m.zapT[i] = Math.max(0, m.zapT[i] - dt);
    if (m.life[i] > 0 && (m.life[i] -= dt) <= 0) {
      popMinion(g, i, true);
      continue;
    }
    const mech = m.kind[i] === MinionKind.Mech;
    const p = o.player;
    let x = m.x[i];
    let z = m.z[i];
    // Far behind (a new stage, a teleport): jump back to the Tinker.
    if ((x - p.x) ** 2 + (z - p.z) ** 2 > 400) {
      x = m.x[i] = p.x + (g.rng.next() - 0.5) * 3;
      z = m.z[i] = p.z + (g.rng.next() - 0.5) * 3;
      m.target[i] = null;
    }
    // Keep the target honest (pooled enemies: same uid), drop it past the leash.
    let t = m.target[i] as Enemy | null;
    if (t && (!t.active || t.uid !== m.targetUid[i] || t.hp <= 0 || !t.alive || (t.x - p.x) ** 2 + (t.z - p.z) ** 2 > (TT.leash + t.radius) ** 2)) t = m.target[i] = null;
    if (!t && (g.stepN + i) % 12 === 0) {
      // A boss near the Tinker comes first (bots would otherwise spend a boss fight on its adds).
      const boss = g.boss;
      t = boss && boss.alive && boss.hp > 0 && (boss.x - p.x) ** 2 + (boss.z - p.z) ** 2 < (TT.leash + boss.radius) ** 2 ? boss : g.nearestEnemy(x, z, mech ? LT.range : TT.aggro, seen(o.index));
      m.target[i] = t;
      m.targetUid[i] = t ? t.uid : -1;
    }
    // Where it wants to be: in zap range of its target, else trailing the Tinker.
    let tx: number;
    let tz: number;
    const range = mech ? LT.range * 0.6 : TT.zapRange * 0.75;
    if (t && (t.x - x) ** 2 + (t.z - z) ** 2 > range * range) {
      tx = t.x;
      tz = t.z;
    } else if (t) {
      tx = x;
      tz = z;
    } else {
      const n = 6;
      const slot = (i % n) / (n - 1) - 0.5;
      const back = Math.atan2(p.aim.z, p.aim.x) + Math.PI + slot * 2.2;
      const r = TT.formation * (mech ? 1.8 : 1) + (i % 2) * 0.6;
      tx = p.x + Math.cos(back) * r;
      tz = p.z + Math.sin(back) * r;
    }
    let dx = tx - x;
    let dz = tz - z;
    const d = Math.hypot(dx, dz);
    const speed = mech ? 6 : TT.speed;
    let vx = 0;
    let vz = 0;
    if (d > 0.3) {
      vx = (dx / d) * speed * Math.min(1, d / 1.5);
      vz = (dz / d) * speed * Math.min(1, d / 1.5);
    }
    // Personal space from other bots.
    for (let j = 0; j < m.top; j++) {
      if (j === i || !m.alive[j]) continue;
      const ex = x - m.x[j];
      const ez = z - m.z[j];
      const rr = (mech || m.kind[j] === MinionKind.Mech ? 1.6 : 0.85) ** 2;
      const d2 = ex * ex + ez * ez;
      if (d2 < rr && d2 > 1e-6) {
        const k = (Math.sqrt(rr) - Math.sqrt(d2)) * 8;
        const l = Math.sqrt(d2);
        vx += (ex / l) * k;
        vz += (ez / l) * k;
      }
    }
    const ks = 1 - Math.exp(-10 * dt);
    m.vx[i] += (vx - m.vx[i]) * ks;
    m.vz[i] += (vz - m.vz[i]) * ks;
    x = m.x[i] += m.vx[i] * dt;
    z = m.z[i] += m.vz[i] * dt;
    if (t) m.face[i] = Math.atan2(t.z - z, t.x - x);
    else if (m.vx[i] ** 2 + m.vz[i] ** 2 > 0.5) m.face[i] = Math.atan2(m.vz[i], m.vx[i]);
    // Zap.
    const boost = mech ? 0 : fieldBoost(g, o.index, x, z);
    m.zapCd[i] -= dt * (1 + boost);
    if (t && m.zapCd[i] <= 0 && !p.dead && g.isCombatMode) {
      const zr = mech ? LT.range : TT.zapRange;
      dx = t.x - x;
      dz = t.z - z;
      if (dx * dx + dz * dz <= (zr + t.radius) ** 2) zap(g, w, o, i, t, mech);
    }
    if (mech) continue;
    // Bots soak enemy bullets (and break after a few).
    if (boost > 0) m.hp[i] = Math.min(TT.hp, m.hp[i] + TT.regen * dt);
    if (soak) {
      for (let k = 0; k < b.count; k++) {
        if (b.team[k] !== Team.Enemy) continue;
        const ex = b.x[k] - x;
        const ez = b.z[k] - z;
        const rr = 0.42 + b.radius[k];
        if (ex * ex + ez * ez > rr * rr) continue;
        b.kill(k--);
        g.vfx.star(x, 0.7, z, 0.6, '#ffffff', 0.08);
        if ((m.hp[i] -= 1) <= 0) break;
      }
      if (m.hp[i] <= 0) popMinion(g, i, false);
    }
  }
}

function zap(g: Game, w: H3World, o: Hero, i: number, t: Enemy, mech: boolean): void {
  const m = w.minions;
  const loud = g.runTime >= (w.loudAt[o.index] ?? 0);
  if (loud) w.loudAt[o.index] = g.runTime + 0.3;
  if (mech) {
    m.zapCd[i] = LT.zapEvery;
    const dmg = LT.dmg * TYPICAL * power(g) * (t.def.boss ? ultTuning.bossMul : 1);
    g.damage(t, dmg, { source: 'ult', tags: MECH_TAGS, dirX: t.x - m.x[i], dirZ: t.z - m.z[i], knockback: 8, canCrit: true, loud }, o);
    g.blast(t.x, t.z, LT.blast, dmg * 0.35, '#ffcd75', 'ult', MECH_TAGS, true, o);
  } else {
    m.zapCd[i] = (TT.zapEvery * o.stats.cooldownMul) / (t.def.boss || t.elite ? TT.bigZap : 1);
    g.damage(t, zapDamage(g.level), { source: 'minion', tags: BOT_TAGS, dirX: t.x - m.x[i], dirZ: t.z - m.z[i], knockback: 2, canCrit: true, loud }, o);
  }
  m.zapT[i] = 0.15;
  m.zx[i] = t.x;
  m.zz[i] = t.z;
  if (g.runTime >= (w.soundAt[o.index] ?? 0)) {
    w.soundAt[o.index] = g.runTime + (mech ? 0.15 : 0.22);
    g.vfx.sound(mech ? 'explode' : 'minionZap', m.x[i], m.z[i], mech ? 1.3 : 0.9 + g.rng.next() * 0.3);
  }
}

function popMinion(g: Game, i: number, expired: boolean): void {
  const m = h3World(g).minions;
  const x = m.x[i];
  const z = m.z[i];
  const mech = m.kind[i] === MinionKind.Mech;
  m.free(i);
  g.vfx.burst(x, 0.5, z, { count: mech ? 16 : 8, color: '#566c86', color2: '#ffcd75', speed: [2, 6], size: [0.1, 0.25], life: [0.3, 0.6], up: 4, gravity: 12, debris: mech ? 4 : 2 });
  if (!expired) g.vfx.sound('hitMetal', x, z, 1.2);
}

// ---------------------------------------------------------------- hooks

/** A parry landed (onParryLanded): the Ronin answers with a counter-slash all around. */
export function heroes3Parry(g: Game, h: Hero): void {
  if (h.heroDef.mech !== 'ronin') return;
  const p = h.player;
  const k = weaponOf<Katana>(h, 'katana');
  const base = (k?.p.dmg ?? 27) * RT.counterDmg;
  let n = 0;
  for (const e of g.enemiesInRadius(p.x, p.z, RT.counterR, g.scratch).slice()) {
    if (e.pvpOwner === h.index || e.hp <= 0) continue;
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    g.damage(e, base, { source: 'katana', dirX: dx / d, dirZ: dz / d, knockback: RT.counterKnock, canCrit: true, loud: n++ < 4 }, h);
    e.squash(-10);
  }
  g.vfx.ring(p.x, p.z, 0.6, RT.counterR * 2.2, '#f4f4f4', 0.22);
  g.vfx.ring(p.x, p.z, 0.4, RT.counterR * 1.7, '#b13e53', 0.3);
  // Four cuts fanned round the Ronin.
  const a0 = Math.atan2(p.aim.z, p.aim.x);
  for (let k = 0; k < 4; k++) {
    const a = a0 + (k * Math.PI) / 2 + 0.4;
    heroes3Hooks.slash(g, p.x + Math.cos(a) * 1.8, p.z + Math.sin(a) * 1.8, a + Math.PI / 2, RT.counterR, k % 2 ? 1 : 0);
  }
  g.vfx.burst(p.x, 1, p.z, { count: 20, color: '#ffffff', color2: '#73eff7', speed: [8, 15], size: [0.06, 0.14], life: [0.08, 0.18], drag: 2 });
  g.vfx.num(p.x, 3.1, p.z, 'COUNTER!', 'crit');
  g.vfx.sound('swordCombo', p.x, p.z, 1.1);
  g.vfx.shake(p.x, p.z, 0.3);
  if (n > 0) heroHitStop(g, h, RT.counterStop);
}

/** Every kill: the Point Blank count (kills close to the hero who made them). */
export function heroes3OnKill(g: Game, e: Enemy, by: Hero | null): void {
  if (!by || by.left) return;
  const p = by.player;
  if ((e.x - p.x) ** 2 + (e.z - p.z) ** 2 <= RT.closeKill * RT.closeKill) by.mech.closeKills++;
  void g;
}

/** Achievements that unlock the Ronin and the Tinker (appended to heroMechAchievements). */
export function heroes3Achievements(g: Game): [string, boolean][] {
  const h = g.hero;
  const autos = h.weapons.filter((w) => !w.def.slot && w.level >= 5).length;
  return [
    ['point_blank', h.mech.closeKills >= 150],
    ['workshop', autos >= 4],
  ];
}

// ---------------------------------------------------------------- network

/**
 * Snapshot field `h3`: `m` the bots near this client (when a Tinker plays),
 * `ck` this client's close kills (the Point Blank achievement is checked on
 * each player's own machine). Undefined when there is nothing to say.
 */
export function heroes3Net(g: Game, forHero: Hero, interest: number): { m?: number[]; ck?: number; s?: number[] } | undefined {
  const w = h3World(g);
  const ck = forHero.mech.closeKills;
  const bots = w.minions.top > 0 || g.heroes.some((h) => h.heroDef.mech === 'tinker');
  const cx = forHero.player.x;
  const cz = forHero.player.z;
  const near = (x: number, z: number) => Math.abs(x - cx) < interest && Math.abs(z - cz) < interest;
  const s = w.slashes.list.length ? w.slashes.pack(near, g.runTime) : [];
  if (!bots && !ck && !s.length) return undefined;
  return { m: bots ? packMinions(w.minions, near, []) : undefined, ck: ck || undefined, s: s.length ? s : undefined };
}

/** Client: mirror the bots and this hero's close kills. */
export function applyHeroes3Net(g: Game, data: unknown): void {
  const w = h3World(g);
  const d = (data ?? {}) as { m?: unknown; ck?: unknown; s?: unknown };
  if (typeof d.ck === 'number') g.hero.mech.closeKills = d.ck;
  if (Array.isArray(d.s)) w.slashSeen = unpackSlashes(d.s as number[], w.slashSeen, (x, z, a, len, c) => slashFx(g).spawn(x, z, a, len, c));
  if (!Array.isArray(d.m)) {
    if (w.minions.top) w.minions.clear();
    return;
  }
  unpackMinions(w.minions, d.m as number[], w.born);
  for (const i of w.born) g.particles.burst(w.minions.x[i], 0.5, w.minions.z[i], { count: 6, color: '#ffcd75', color2: '#73eff7', speed: [1, 3], size: [0.1, 0.2], life: [0.2, 0.4], up: 3, gravity: 8 });
}

// ---------------------------------------------------------------- drawing

/** Bots and mechs as instanced vertex-coloured meshes, plus their zap beams. */
class MinionView {
  readonly bots: THREE.InstancedMesh;
  readonly mechs: THREE.InstancedMesh;
  readonly beams: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private white = new THREE.Color('#ffffff');

  constructor(private scene: THREE.Scene) {
    const part = (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number) => paint((g.index ? g.toNonIndexed() : g).translate(x, y, z), color);
    // A chunky little helper bot (top-down the head reads first: yellow with a cyan visor).
    const bot = mergeGeometries([
      part(new THREE.BoxGeometry(0.13, 0.22, 0.16), '#333c57', -0.14, 0.11, 0),
      part(new THREE.BoxGeometry(0.13, 0.22, 0.16), '#333c57', 0.14, 0.11, 0),
      part(new THREE.BoxGeometry(0.5, 0.36, 0.42), '#ef7d57', 0, 0.4, 0),
      part(new THREE.BoxGeometry(0.26, 0.16, 0.05), '#ffcd75', 0, 0.4, 0.22),
      part(new THREE.BoxGeometry(0.1, 0.26, 0.1), '#566c86', -0.31, 0.4, 0.04),
      part(new THREE.BoxGeometry(0.1, 0.26, 0.1), '#566c86', 0.31, 0.4, 0.04),
      part(new THREE.BoxGeometry(0.46, 0.32, 0.4), '#ffcd75', 0, 0.76, 0),
      part(new THREE.BoxGeometry(0.36, 0.12, 0.06), '#73eff7', 0, 0.79, 0.2),
      part(new THREE.BoxGeometry(0.06, 0.06, 0.04), '#f4f4f4', -0.08, 0.81, 0.235),
      part(new THREE.BoxGeometry(0.47, 0.06, 0.41), '#ef7d57', 0, 0.93, 0),
      part(new THREE.CylinderGeometry(0.02, 0.02, 0.24, 4), '#333c57', 0, 1.06, 0),
      part(new THREE.OctahedronGeometry(0.08, 0), '#b13e53', 0, 1.21, 0),
    ])!;
    // A Scrap Legion mech: steel legs, an orange hull with a cyan cockpit, twin arm cannons and a yellow warning stripe.
    const mech = mergeGeometries([
      part(new THREE.BoxGeometry(0.34, 0.9, 0.42), '#566c86', -0.42, 0.45, 0),
      part(new THREE.BoxGeometry(0.34, 0.9, 0.42), '#566c86', 0.42, 0.45, 0),
      part(new THREE.BoxGeometry(0.46, 0.14, 0.64), '#333c57', -0.42, 0.07, 0.08),
      part(new THREE.BoxGeometry(0.46, 0.14, 0.64), '#333c57', 0.42, 0.07, 0.08),
      part(new THREE.BoxGeometry(1.4, 0.9, 1.0), '#ef7d57', 0, 1.33, 0),
      part(new THREE.BoxGeometry(1.42, 0.16, 1.02), '#ffcd75', 0, 1.05, 0),
      part(new THREE.BoxGeometry(0.8, 0.5, 0.7), '#ef7d57', 0, 1.98, 0.05),
      part(new THREE.BoxGeometry(0.62, 0.22, 0.08), '#73eff7', 0, 2.02, 0.42),
      part(new THREE.BoxGeometry(0.3, 0.3, 0.06), '#ffcd75', 0, 1.35, 0.52),
      part(new THREE.CylinderGeometry(0.17, 0.17, 1.0, 8).rotateX(Math.PI / 2), '#333c57', -0.95, 1.4, 0.35),
      part(new THREE.CylinderGeometry(0.17, 0.17, 1.0, 8).rotateX(Math.PI / 2), '#333c57', 0.95, 1.4, 0.35),
      part(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 8).rotateX(Math.PI / 2), '#ffcd75', -0.95, 1.4, 0.86),
      part(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 8).rotateX(Math.PI / 2), '#ffcd75', 0.95, 1.4, 0.86),
      part(new THREE.BoxGeometry(0.34, 0.5, 0.4), '#566c86', -0.95, 1.4, -0.15),
      part(new THREE.BoxGeometry(0.34, 0.5, 0.4), '#566c86', 0.95, 1.4, -0.15),
      part(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 4), '#333c57', 0.3, 2.45, -0.15),
      part(new THREE.OctahedronGeometry(0.1, 0), '#b13e53', 0.3, 2.73, -0.15),
    ])!;
    this.bots = new THREE.InstancedMesh(bot, createRetroMaterial({ vertexColors: true }), MAX_MINIONS);
    this.mechs = new THREE.InstancedMesh(mech, createRetroMaterial({ vertexColors: true }), 24);
    this.beams = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.06, 0.06).translate(0.5, 0, 0), new THREE.MeshBasicMaterial({ color: '#fff35c', transparent: true, opacity: 0.9, depthWrite: false }), MAX_MINIONS);
    for (const m of [this.bots, this.mechs, this.beams]) {
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
    }
    for (let i = 0; i < MAX_MINIONS; i++) this.bots.setColorAt(i, this.white);
    for (let i = 0; i < 24; i++) this.mechs.setColorAt(i, this.white);
  }

  draw(g: Game, m: MinionPool, frameDt: number, client: boolean): void {
    const t = g.animTime;
    let nb = 0;
    let nm = 0;
    let nz = 0;
    const k = 1 - Math.exp(-15 * frameDt);
    const show = g.mode !== 'title';
    for (let i = 0; i < m.top && show; i++) {
      if (!m.alive[i]) continue;
      if (client) {
        // Glide to the synced spot; face where it moves or zaps.
        const ox = m.x[i];
        const oz = m.z[i];
        m.x[i] += (m.vx[i] - m.x[i]) * k;
        m.z[i] += (m.vz[i] - m.z[i]) * k;
        m.age[i] += frameDt;
        m.zapT[i] = Math.max(0, m.zapT[i] - frameDt);
        const mx = m.x[i] - ox;
        const mz = m.z[i] - oz;
        if (m.zapT[i] > 0) m.face[i] = Math.atan2(m.zz[i] - m.z[i], m.zx[i] - m.x[i]);
        else if (mx * mx + mz * mz > 1e-5) m.face[i] = Math.atan2(mz, mx);
      }
      const mech = m.kind[i] === MinionKind.Mech;
      const age = m.age[i];
      // Bots pop together (overshoot); mechs drop from the sky and land with a squash.
      let sc = 1;
      let y = 0;
      if (mech) {
        y = Math.max(0, 0.35 - age) * 30;
        sc = age < 0.5 && y === 0 ? 1 + Math.sin((age - 0.35) * 40) * 0.12 : 1;
      } else sc = age < 0.35 ? Math.sin((age / 0.35) * 2.2) * 1.15 : 1;
      const hop = Math.abs(Math.sin(t * 13 + i * 1.7)) * (mech ? 0.05 : 0.09);
      this.q.setFromEuler(this.e.set(0, Math.PI / 2 - m.face[i], Math.sin(t * 13 + i) * 0.06));
      this.m4.compose(this.v.set(m.x[i], y + hop, m.z[i]), this.q, this.s.set(sc, sc * (1 + hop), sc));
      const owner = g.heroes[m.owner[i]];
      this.c.set(owner?.color ?? '#ffffff').lerp(this.white, 0.85); // a hint of the owner's colour (co-op)
      if (mech && nm < 24) {
        this.mechs.setMatrixAt(nm, this.m4);
        this.mechs.setColorAt(nm++, this.c);
      } else if (!mech) {
        this.bots.setMatrixAt(nb, this.m4);
        this.bots.setColorAt(nb++, this.c);
      }
      if (m.zapT[i] > 0) {
        const fy = mech ? 1.45 : 0.8;
        const dx = m.zx[i] - m.x[i];
        const dz = m.zz[i] - m.z[i];
        const len = Math.hypot(dx, dz);
        if (len > 0.2) {
          this.q.setFromEuler(this.e.set(0, -Math.atan2(dz, dx), Math.atan2(-(fy - 0.8), len), 'YZX'));
          const j = 1 + Math.random() * (mech ? 2.5 : 1.2);
          this.m4.compose(this.v.set(m.x[i], fy + y, m.z[i]), this.q, this.s.set(len, j, j));
          this.beams.setMatrixAt(nz++, this.m4);
        }
      }
    }
    this.bots.count = nb;
    this.mechs.count = nm;
    this.beams.count = nz;
    commit(this.bots.instanceMatrix, nb);
    commit(this.mechs.instanceMatrix, nm);
    commit(this.beams.instanceMatrix, nz);
    if (this.bots.instanceColor) commit(this.bots.instanceColor, nb);
    if (this.mechs.instanceColor) commit(this.mechs.instanceColor, nm);
  }

  dispose(): void {
    for (const m of [this.bots, this.mechs, this.beams]) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}

/** Sword slash marks: thin bright blades that shoot out across a spot and thin away (Thousand Cuts, counter-slash). */
class SlashFx {
  readonly mesh: THREE.InstancedMesh;
  private x = new Float32Array(48);
  private z = new Float32Array(48);
  private a = new Float32Array(48);
  private len = new Float32Array(48);
  private t = new Float32Array(48);
  private c = new Uint8Array(48);
  private n = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private colors = SLASH_COLORS.map((c) => new THREE.Color(c));
  static readonly LIFE = 0.24;

  constructor(private scene: THREE.Scene) {
    // A flat diamond, long on X.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0, 0, 0.5, 0.5, 0, 0, -0.5, 0, 0, 0.5, 0, 0, 0, 0, -0.5], 3));
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }), 48);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.count = 0;
    for (let i = 0; i < 48; i++) this.mesh.setColorAt(i, this.colors[0]);
    scene.add(this.mesh);
  }

  spawn(x: number, z: number, a: number, len: number, c: number): void {
    const i = this.n < 48 ? this.n++ : 0;
    this.x[i] = x;
    this.z[i] = z;
    this.a[i] = a;
    this.len[i] = len;
    this.t[i] = 0;
    this.c[i] = c;
  }

  draw(dt: number): void {
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = settings.reduceFlash ? 0.55 : 0.95; // REDUCE FLASHING: softer marks
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      // Drawn at its age, then aged: every mark shows for at least one frame, however slow the frames.
      if (this.t[i] >= SlashFx.LIFE) continue;
      // Keep live marks packed at the front.
      if (k !== i) {
        this.x[k] = this.x[i];
        this.z[k] = this.z[i];
        this.a[k] = this.a[i];
        this.len[k] = this.len[i];
        this.t[k] = this.t[i];
        this.c[k] = this.c[i];
      }
      const t = this.t[k];
      const grow = Math.min(1, t / 0.05);
      const thin = 1 - t / SlashFx.LIFE;
      this.q.setFromAxisAngle(this.up, -this.a[k]);
      this.m4.compose(this.v.set(this.x[k], 1 + k * 0.002, this.z[k]), this.q, this.s.set(this.len[k] * (0.4 + 0.6 * grow), 1, 0.55 * thin + 0.04));
      this.mesh.setMatrixAt(k, this.m4);
      this.mesh.setColorAt(k, this.colors[this.c[k]] ?? this.colors[0]);
      this.t[k] += dt;
      k++;
    }
    this.n = k;
    this.mesh.count = k;
    commit(this.mesh.instanceMatrix, k);
    if (this.mesh.instanceColor) commit(this.mesh.instanceColor, k);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

function slashFx(g: Game): SlashFx {
  const w = h3World(g);
  if (!w.slashFx || w.slashFx.mesh.parent !== g.scene) {
    w.slashFx?.dispose();
    w.slashFx = new SlashFx(g.scene);
  }
  return w.slashFx;
}

/** Draw the bots, the slash marks and the heroes' moving gear (the Tinker's backpack cog). Every machine. */
export function renderHeroes3(g: Game, frameDt: number): void {
  const w = h3World(g);
  if (w.slashFx || g.heroes.some((h) => h.heroDef.mech === 'ronin')) slashFx(g).draw(g.paused ? 0 : frameDt);
  if (!w.view && (w.minions.top || g.heroes.some((h) => h.heroDef.mech === 'tinker'))) w.view = new MinionView(g.scene);
  if (w.view) {
    if (w.view.bots.parent !== g.scene) {
      w.view.dispose();
      w.view = new MinionView(g.scene);
    }
    w.view.draw(g, w.minions, frameDt, !g.authority);
  }
  for (const h of g.heroes) {
    if (h.heroDef.mech !== 'tinker') continue;
    let cog = w.gear.get(h);
    if (cog === undefined || (cog && !cog.parent)) {
      cog = h.player.rig.body.getObjectByName('cog') ?? null;
      w.gear.set(h, cog);
    }
    if (cog) cog.rotation.z = g.animTime * 3;
  }
}
