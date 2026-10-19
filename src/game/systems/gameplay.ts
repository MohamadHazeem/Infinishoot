/**
 * Gameplay lane (notes/lanes/gameplay.md): Game methods for the mech suit,
 * supply crates and super weapons, the rule relics, enemy mutations, weapon
 * overload, combo cash-ins, the chain-reaction finale and comeback mode.
 * Installed on Game as fields like every system. The pure rules and tuning
 * are in src/game/gameplay.ts.
 *
 * Online: the host simulates everything here. Per hero, `hero.play.net()`
 * rides the hero snapshot as `gp` (mech, super weapon, overload, comeback,
 * satellites); team state (drops and crates, mutated enemy uids, cash-in
 * uses) rides the body as `gpw`. Clients send `{t:'cash', k}` to cash in.
 * Everything that's drawn otherwise is ordinary bullets and effects.
 */
import type { Game } from '../game';
import { BULLET_KINDS } from '../game';
import { BULLET_Y, Team } from '../bullets';
import { BulletShape } from '../bulletShapes';
import { type Enemy } from '../enemies';
import { MAX_WEAPONS, type Hero } from '../hero';
import { PickupType } from '../pickups';
import { dropTuning } from '../game';
import { freezeMul } from '../bossRules';
import { settings } from '../settings';
import { PAD_CASH, PAD_CASHPICK } from '../../core/keybinds';
import { MechArsenal, SuperWeapon, createSuper } from '../weapons/super';
import {
  GP_KINDS,
  SUPERS,
  SUPER_IDS,
  canMutate,
  cashAffordable,
  cashCost,
  cashEffect,
  cashTuning,
  comebackState,
  comebackTuning,
  crateTuning,
  finaleSchedule,
  finaleTuning,
  gpPower,
  mechTuning,
  mutationTuning,
  overloadEligible,
  overloadTuning,
  registerKinds,
  relicTuning,
  type FinaleShot,
  type SuperId,
} from '../gameplay';
import { GameplayView } from '../gameplayView';
import { gameplayHud } from '../../ui/gameplayHud';

/** A mech suit or supply crate on the ground. `kind`: 'mech' or the super weapon inside. */
export interface GpDrop {
  id: number;
  kind: 'mech' | SuperId;
  x: number;
  z: number;
  /** Seconds since it appeared (crates fall for crateTuning.fall first). */
  t: number;
}

/** Team-level state for this lane (one per Game; clients keep a mirror). */
export interface GpWorld {
  drops: GpDrop[];
  nextId: number;
  crateT: number;
  mechCd: number;
  /** Cash-ins this stage (costs grow with it). */
  cashUses: number;
  stage: number;
  runTime: number;
  /** Recent kill spots (finale fireworks). */
  sites: { x: number; z: number; t: number }[];
  finale: FinaleShot[] | null;
  finaleT: number;
  finaleN: number;
  finaleScore: number;
  finaleX: number;
  finaleZ: number;
  kegStep: number;
  kegs: number;
  mutated: number;
  mutNumT: number;
  /** Client: snapshot mirror of mutated uids. */
  view: GpView | null;
}

type GpView = GameplayView;

const worlds = new WeakMap<Game, GpWorld>();

/** This game's lane state. */
export function gpWorld(g: Game): GpWorld {
  let w = worlds.get(g);
  if (!w) {
    w = { drops: [], nextId: 1, crateT: crateTuning.first, mechCd: 0, cashUses: 0, stage: g.stage, runTime: g.runTime, sites: [], finale: null, finaleT: 0, finaleN: 0, finaleScore: 0, finaleX: 0, finaleZ: 0, kegStep: -1, kegs: 0, mutated: 0, mutNumT: 0, view: null };
    worlds.set(g, w);
  }
  return w;
}

/** Register this lane's bullet kinds (once, at first use). */
function ensureKinds(): void {
  if (GP_KINDS.minigun < 0) registerKinds(BULLET_KINDS);
}

function power(g: Game): number {
  return gpPower(g.director.hpMul);
}

/** Lane features that need the normal run: not on the title, in training or in a PvP duel. */
function liveRun(g: Game): boolean {
  return g.mode !== 'title' && !g.onboarding.training && g.pvp?.phase !== 'duel' && g.pvp?.phase !== 'over';
}

// ---------------------------------------------------------------- step

/**
 * Before the weapons run: overload forces fire; the mech suit and super
 * weapons fire, then the clicks they replace see no fire input for this
 * step (so they idle and hide their beams like any weapon you stop firing):
 * the mech replaces both clicks, a super weapon the left click. Auto weapons
 * keep firing (they don't read the fire buttons). The real input comes back
 * at the start of updateGameplay.
 */
export function gameplayPreWeapons(this: Game, dt: number): void {
  ensureKinds();
  const pw = power(this);
  for (const h of this.heroes) {
    const pl = h.play;
    pl.firing = h.ctx.firing;
    pl.charging = h.ctx.charging;
    if (h.left || h.player.dead) continue;
    if (pl.overloadT > 0) {
      h.ctx.firing = pl.firing = true;
      h.ctx.charging = pl.charging = pl.overloadT % 0.7 < 0.5;
    }
    if (pl.mechT > 0) {
      const m = (pl.mechW ??= new MechArsenal()) as MechArsenal;
      m.power = pw;
      const steps = m.steps;
      m.update(dt, h.ctx);
      // Heavy footsteps: a thump per step, a slam on every stomp.
      if (m.steps !== steps) this.vfx.sound(m.steps % mechTuning.stompEvery === 0 ? 's2:mechStomp' : 's2:mechStep', h.player.x, h.player.z, 1.6);
    } else if (pl.superW) {
      const s = pl.superW as SuperWeapon;
      s.power = pw;
      s.update(dt, h.ctx);
      pl.superAmmo = s.ammo;
      pl.superT = s.t;
      if (s.done) endSuper(this, h, true);
    }
    if (pl.mechT > 0) h.ctx.firing = h.ctx.charging = false;
    else if (pl.superW) h.ctx.firing = false;
  }
}

/** Everything else, once per simulation step (solo and host). */
export function updateGameplay(this: Game, dt: number): void {
  ensureKinds();
  const W = gpWorld(this);
  for (const h of this.heroes) {
    h.ctx.firing = h.play.firing;
    h.ctx.charging = h.play.charging;
  }
  // New run or new stage: reset the team state.
  if (this.runTime < W.runTime || this.stage !== W.stage) {
    if (this.runTime < W.runTime) W.mechCd = 0;
    W.stage = this.stage;
    W.drops.length = 0;
    W.cashUses = 0;
    W.crateT = this.stage === 1 ? crateTuning.first : crateTuning.every[0] * 0.6;
    W.sites.length = 0;
    if (this.mode !== 'cleared') W.finale = null;
  }
  W.runTime = this.runTime;
  W.mechCd = Math.max(0, W.mechCd - dt);
  const live = liveRun(this);
  const fight = this.mode === 'fight' && live && this.aliveHeroes.length > 0;
  if (fight) updateCrates(this, W, dt);
  if (this.isCombatMode && live) updateDrops(this, W, dt);
  if (this.isCombatMode && live && mutationTuning.enabled) updateMutations(this, W, dt);
  for (const h of this.heroes) if (!h.left) updateHeroPlay(this, h, dt);
  updateFinale(this, W, dt);
  localCashInput(this);
  while (W.sites.length && this.runTime - W.sites[0].t > finaleTuning.keepFor) W.sites.shift();
}

/** Mech and super weapon timers, overload, comeback, relic timers and the live multipliers. */
function updateHeroPlay(g: Game, h: Hero, dt: number): void {
  const pl = h.play;
  const p = h.player;
  if (p.dead) {
    if (pl.mechT > 0) endMech(g, h, false);
    if (pl.superW) endSuper(g, h, false);
    pl.overloadT = 0;
    pl.sats.length = 0;
  }
  // Mech timer and ejection.
  if (pl.mechT > 0) {
    pl.mechT = Math.max(0, pl.mechT - dt);
    p.noDash = true;
    if (pl.mechT <= 0) endMech(g, h, true);
  }
  // Overload: check the slots now and then; the meter fills while every slot is maxed.
  if (g.stepN % 30 === h.index) pl.overloadReady = overloadEligible(h.weapons, MAX_WEAPONS);
  if (pl.overloadT > 0) {
    pl.overloadT = Math.max(0, pl.overloadT - dt);
    overloadVolley(g, h, dt);
  } else if (pl.overloadReady && g.mode === 'fight' && !p.dead) {
    pl.overload01 = Math.min(1, pl.overload01 + dt / overloadTuning.charge);
    if (pl.overload01 >= 1) startOverload(g, h);
  }
  // Comeback mode (host decides; clients mirror it).
  const cb = comebackState(p.hp, p.maxHp, h.revivesLeft, p.dead) && g.isCombatMode;
  if (cb && !pl.comeback) {
    g.vfx.num(p.x, 3, p.z, 'COMEBACK! x2 DAMAGE', 'crit');
    g.vfx.ring(p.x, p.z, 1, 8, '#ff3d5a', 0.5);
    g.vfx.sound('s2:comeback', p.x, p.z);
  }
  pl.comeback = cb;
  // Relics.
  pl.dashFireT = Math.max(0, pl.dashFireT - dt);
  if (h.hasRelic('r_orbit') && !p.dead) updateSatellites(g, h, dt);
  else pl.sats.length = 0;
  // Live multipliers (folded in by Hero.refreshLive next step).
  let dm = 1;
  let cd = 1;
  let sp = 1;
  let ar = 0;
  if (pl.comeback) dm *= comebackTuning.damageMul;
  if (pl.overloadT > 0) cd *= overloadTuning.cooldownMul;
  if (pl.dashFireT > 0) cd *= relicTuning.dashfireRateMul;
  if (h.hasRelic('r_adrenal') && p.hp < p.maxHp * relicTuning.adrenalBelow) {
    cd *= relicTuning.adrenalRateMul;
    dm *= 1 + relicTuning.adrenalDmg;
  }
  if (h.hasRelic('r_combo')) dm *= 1 + relicTuning.comboPerTier * (g.multiplier - 1);
  if (pl.mechT > 0) {
    sp *= mechTuning.speedMul;
    ar += mechTuning.armor + mechTuning.armorPerStage * g.stage;
  }
  pl.damageMul = dm;
  pl.cooldownMul = cd;
  pl.speedMul = sp;
  pl.armor = ar;
}

// ---------------------------------------------------------------- mech suit

/** Climb into a mech suit for mechTuning.duration seconds. */
export function startMech(g: Game, h: Hero): void {
  const pl = h.play;
  const p = h.player;
  pl.mechT = mechTuning.duration;
  pl.mechStep = 0;
  pl.mechW?.dispose();
  pl.mechW = new MechArsenal();
  p.noDash = true;
  p.invuln = Math.max(p.invuln, 0.8);
  g.vfx.ring(p.x, p.z, 1, 9, '#ffb627', 0.5);
  g.vfx.star(p.x, 2, p.z, 3, '#ffffff', 0.18);
  g.vfx.burst(p.x, 1.5, p.z, { count: 30, color: '#ffb627', color2: '#ffffff', speed: [4, 10], size: [0.15, 0.35], life: [0.4, 0.8], up: 6, gravity: 12, sparks: 8 });
  g.vfx.shake(p.x, p.z, 0.6);
  g.vfx.sound('s2:mechBoot', p.x, p.z);
  g.vfx.num(p.x, 3.6, p.z, 'MECH SUIT!', 'crit');
  if (h === g.hero) g.hud.toast(`MECH SUIT: ${mechTuning.duration} SECONDS OF HEAVY METAL`, 2.5);
}

/** The mech's time is up (eject = the blast; false when the pilot went down). */
export function endMech(g: Game, h: Hero, eject: boolean): void {
  const pl = h.play;
  const p = h.player;
  pl.mechT = 0;
  pl.mechW?.dispose();
  pl.mechW = null;
  p.noDash = h.mech.id === 'duelist';
  if (!eject) return;
  g.blast(p.x, p.z, mechTuning.ejectRadius, mechTuning.ejectDmg * power(g), '#ffb627', 'mech_eject', ['explosive'], false, h);
  g.vfx.ring(p.x, p.z, 1, mechTuning.ejectRadius * 2.2, '#ffffff', 0.45);
  g.vfx.burst(p.x, 2, p.z, { count: 26, color: '#566c86', color2: '#ffb627', speed: [4, 11], size: [0.2, 0.4], life: [0.6, 1.1], up: 9, gravity: 18, debris: 12, smoke: 4 });
  g.vfx.shake(p.x, p.z, 1);
  g.vfx.flash(0.35);
  g.vfx.num(p.x, 3.2, p.z, 'EJECT!', 'crit');
  g.vfx.sound('s2:mechEject', p.x, p.z);
  p.invuln = Math.max(p.invuln, 1.2);
  p.recoil = 2;
}

// ---------------------------------------------------------------- supply crates and super weapons

function giveSuper(g: Game, h: Hero, id: SuperId): void {
  const pl = h.play;
  pl.superW?.dispose();
  const w = createSuper(id);
  pl.superW = w;
  pl.superId = id;
  pl.superAmmo = w.ammo;
  pl.superT = w.t;
  const d = SUPERS[id];
  const p = h.player;
  g.vfx.num(p.x, 3, p.z, d.name.toUpperCase() + '!', 'crit');
  g.vfx.ring(p.x, p.z, 1, 6, d.color, 0.4);
  g.vfx.burst(p.x, 1.2, p.z, { count: 20, color: d.color, color2: '#ffffff', speed: [3, 8], size: [0.12, 0.3], life: [0.3, 0.7], up: 5, gravity: 10 });
  g.vfx.sound('powerUp', p.x, p.z);
  if (h === g.hero) g.hud.toast(`${d.name.toUpperCase()}: ${d.desc.toUpperCase()}`, 2.4);
}

function endSuper(g: Game, h: Hero, spent: boolean): void {
  const pl = h.play;
  const name = pl.superId ? SUPERS[pl.superId].name.toUpperCase() : '';
  pl.superW?.dispose();
  pl.superW = null;
  pl.superId = '';
  pl.superAmmo = pl.superT = 0;
  if (spent && name) g.vfx.num(h.player.x, 2.6, h.player.z, `${name} SPENT`, 'player');
}

/** A walkable spot `near` metres from a random living hero (null if none found). */
function dropSpot(g: Game, minD: number, maxD: number): { x: number; z: number } | null {
  const alive = g.aliveHeroes;
  if (!alive.length) return null;
  const lim = g.arena.halfSize - 4;
  for (let tries = 0; tries < 30; tries++) {
    const p = alive[Math.floor(g.rng.next() * alive.length)].player;
    const a = g.rng.next() * Math.PI * 2;
    const d = g.rng.range(minD, maxD);
    const x = p.x + Math.cos(a) * d;
    const z = p.z + Math.sin(a) * d;
    if (Math.abs(x) > lim || Math.abs(z) > lim || g.walls.hitCircle(x, z, 1.4)) continue;
    return { x, z };
  }
  return null;
}

function updateCrates(g: Game, W: GpWorld, dt: number): void {
  if (g.boss && g.introLeft > 0) return;
  W.crateT -= dt;
  if (W.crateT > 0) return;
  W.crateT = g.rng.range(crateTuning.every[0], crateTuning.every[1]);
  if (W.drops.filter((d) => d.kind !== 'mech').length >= crateTuning.max) return;
  const s = dropSpot(g, crateTuning.near[0], crateTuning.near[1]);
  if (!s) return;
  spawnCrate(g, s.x, s.z, SUPER_IDS[Math.floor(g.rng.next() * SUPER_IDS.length)]);
}

/** A supply crate starts falling onto (x, z); it lands after crateTuning.fall seconds. */
export function spawnCrate(g: Game, x: number, z: number, kind: SuperId): GpDrop {
  const W = gpWorld(g);
  const d: GpDrop = { id: W.nextId++, kind, x, z, t: 0 };
  W.drops.push(d);
  g.vfx.toast('SUPPLY DROP INCOMING!', 2);
  g.vfx.sound('s2:crateDrop', x, z);
  g.vfx.ring(x, z, 1, 4, '#ff7a2f', 0.6);
  return d;
}

/** A mech suit lies at (x, z) for mechTuning.dropLife seconds. */
export function spawnMechDrop(g: Game, x: number, z: number): GpDrop {
  const W = gpWorld(g);
  const d: GpDrop = { id: W.nextId++, kind: 'mech', x, z, t: crateTuning.fall };
  W.drops.push(d);
  W.mechCd = mechTuning.dropCooldown;
  g.vfx.toast('A MECH SUIT DROPPED!', 2.4);
  g.vfx.sound('s2:mechDrop', x, z);
  g.vfx.ring(x, z, 1, 6, '#ffb627', 0.6);
  g.vfx.burst(x, 1, z, { count: 24, color: '#ffb627', color2: '#ffffff', speed: [3, 7], size: [0.15, 0.3], life: [0.5, 0.9], up: 8, gravity: 12 });
  return d;
}

/** Falling crates mark their spot with flare smoke and land with a thump; heroes walk in to take them. */
function updateDrops(g: Game, W: GpWorld, dt: number): void {
  const fall = crateTuning.fall;
  for (let i = W.drops.length - 1; i >= 0; i--) {
    const d = W.drops[i];
    const before = d.t;
    d.t += dt;
    const crate = d.kind !== 'mech';
    if (crate && d.t < fall) {
      // Flare: red smoke rising from the landing spot.
      if (Math.floor(d.t * 6) !== Math.floor(before * 6)) g.vfx.burst(d.x, 0.2, d.z, { count: 2, color: '#ff5e3a', color2: '#ffcd75', speed: [0.3, 1], size: [0.3, 0.55], life: [0.8, 1.4], up: 3, drag: 1.5 });
      continue;
    }
    if (crate && before < fall) {
      g.vfx.shake(d.x, d.z, 0.4);
      g.vfx.ring(d.x, d.z, 1, 5, '#ffcd75', 0.4);
      g.vfx.burst(d.x, 0.3, d.z, { count: 10, color: '#d9c49c', color2: '#ffffff', speed: [2, 5], size: [0.2, 0.4], life: [0.3, 0.6], up: 2, dust: 10, scorch: 0 });
      g.vfx.sound('s2:crateLand', d.x, d.z);
    }
    const life = crate ? fall + crateTuning.life : fall + mechTuning.dropLife;
    if (d.t > life) {
      g.vfx.burst(d.x, 0.6, d.z, { count: 10, color: '#94b0c2', color2: '#ffffff', speed: [1, 4], size: [0.15, 0.3], life: [0.3, 0.6], up: 3 });
      W.drops.splice(i, 1);
      continue;
    }
    let taker: Hero | null = null;
    for (const h of g.aliveHeroes) {
      if (Math.hypot(h.player.x - d.x, h.player.z - d.z) > crateTuning.grab) continue;
      if (d.kind === 'mech' && h.play.mechT > 0) continue;
      taker = h;
      break;
    }
    if (!taker) continue;
    W.drops.splice(i, 1);
    if (d.kind === 'mech') startMech(g, taker);
    else giveSuper(g, taker, d.kind);
    g.vfx.burst(d.x, 0.8, d.z, { count: 16, color: '#ffcd75', color2: '#b8653a', speed: [2, 6], size: [0.15, 0.3], life: [0.3, 0.6], up: 5, gravity: 12, debris: 4 });
  }
}

// ---------------------------------------------------------------- enemy mutations

function updateMutations(g: Game, W: GpWorld, dt: number): void {
  const T = mutationTuning;
  W.mutNumT -= dt;
  let alive = 0;
  for (const e of g.enemies.list) if (e.active && e.mutated) alive++;
  for (const e of g.enemies.list) {
    if (!e.active || e.state === 'spawning') continue;
    if (e.mutated) {
      if (g.mode !== 'fight' || e.frozen > 0 || !e.alive) continue;
      e.mutT -= dt;
      if (e.mutT <= 0) {
        e.mutT = T.spitEvery * g.rng.range(0.8, 1.2);
        spit(g, e);
      }
      continue;
    }
    e.mutAge += dt;
    if (e.mutAge < T.after || alive >= T.maxAlive || !canMutate(e)) continue;
    mutate(g, W, e);
    alive++;
  }
  W.mutated = alive;
}

/** Mutate an enemy now: more life, faster, harder hits, bigger and spiky, lime glow, and it spits. */
export function mutate(g: Game, W: GpWorld, e: Enemy): void {
  const T = mutationTuning;
  e.mutated = true;
  e.maxHp = Math.round(e.maxHp * T.hpMul);
  e.hp = Math.round(e.hp * T.hpMul);
  e.speedMul *= T.speedMul;
  e.dmgMul *= T.dmgMul;
  e.scale *= T.scale;
  e.radius = e.def.radius * e.scale;
  e.mutT = T.spitEvery * g.rng.range(0.5, 1);
  e.flash = 0.3;
  e.squash(8);
  g.vfx.ring(e.x, e.z, e.radius, 4, '#a7f070', 0.4);
  g.vfx.burst(e.x, e.radius + 0.3, e.z, { count: 12, color: '#a7f070', color2: '#38b764', speed: [2, 6], size: [0.12, 0.28], life: [0.3, 0.6], up: 4, gravity: 10 });
  if (W.mutNumT <= 0 || e.elite) {
    W.mutNumT = 0.6;
    g.vfx.num(e.x, 2.2 * e.scale, e.z, 'MUTATED!', 'player');
    g.vfx.sound('swarmScreech', e.x, e.z, 1.3);
  }
}

/** A mutant's extra attack: a ring of spit. */
function spit(g: Game, e: Enemy): void {
  const T = mutationTuning;
  const n = T.spitShots;
  const a0 = g.rng.next() * Math.PI * 2;
  const dmg = Math.max(2, e.def.contactDamage * T.spitDmg);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    g.enemyCtx.fireBullet(e, Math.cos(a), Math.sin(a), T.spitSpeed, dmg);
  }
  g.vfx.burst(e.x, e.radius, e.z, { count: 6, color: '#a7f070', color2: '#38b764', speed: [2, 4], size: [0.12, 0.22], life: [0.2, 0.4], up: 2 });
}

// ---------------------------------------------------------------- overload

function startOverload(g: Game, h: Hero): void {
  const pl = h.play;
  const p = h.player;
  pl.overload01 = 0;
  pl.overloadT = overloadTuning.duration;
  pl.volleyT = 0;
  g.vfx.banner('OVERLOAD!', `${h.name.toUpperCase()} FIRES EVERYTHING`, 1.6);
  g.vfx.sound('legendary', p.x, p.z);
  g.vfx.flash(0.4);
  g.vfx.shake(p.x, p.z, 0.7);
  g.vfx.ring(p.x, p.z, 1, 16, '#3dffb0', 0.6);
  // The special goes off too.
  h.bombCharge = 1;
  g.tryBomb(h);
}

const VOLLEY_COLORS = ['#3dffb0', '#7df9ff', '#ffd23f', '#ffffff', '#ffb627'];

/** The barrage: a spinning spiral of stars from the hero. */
function overloadVolley(g: Game, h: Hero, dt: number): void {
  const pl = h.play;
  const p = h.player;
  if (p.dead) return;
  const T = overloadTuning;
  pl.volleyT -= dt;
  if (pl.volleyT > 0) return;
  pl.volleyT += T.volleyEvery;
  const dmg = T.volleyDmg * power(g);
  for (let k = 0; k < T.volleyShots; k++) {
    const a = pl.volleyA + (k / T.volleyShots) * Math.PI * 2;
    g.bullets.spawn({ x: p.x + Math.cos(a) * 0.8, z: p.z + Math.sin(a) * 0.8, dirX: Math.cos(a), dirZ: Math.sin(a), speed: T.volleySpeed, life: 1.2, radius: 0.3, damage: dmg, knockback: 4, team: Team.Player, color: VOLLEY_COLORS[(k + Math.floor(pl.volleyA * 3)) % VOLLEY_COLORS.length], width: 0.45, length: 0.45, pierce: 2, owner: h.index, kind: GP_KINDS.overload, shape: BulletShape.Star });
  }
  pl.volleyA += 0.37;
  if (Math.floor(pl.overloadT * 4) !== Math.floor((pl.overloadT + dt) * 4)) g.vfx.sound('w:shoot', p.x, p.z, 1.4);
}

// ---------------------------------------------------------------- relics

/** Satellite Rounds: while you fire, rounds gather in orbit and launch at the nearest enemy. */
function updateSatellites(g: Game, h: Hero, dt: number): void {
  const pl = h.play;
  const p = h.player;
  const T = relicTuning;
  if (h.ctx.firing && g.isCombatMode) {
    pl.satT -= dt;
    if (pl.satT <= 0 && pl.sats.length < T.orbitMax) {
      pl.satT = T.orbitEvery * h.stats.cooldownMul;
      pl.sats.push({ a: g.rng.next() * Math.PI * 2, t: 0 });
    }
  }
  for (let i = pl.sats.length - 1; i >= 0; i--) {
    const s = pl.sats[i];
    s.t += dt;
    if (s.t < T.orbitTime) continue;
    pl.sats.splice(i, 1);
    const a = g.runTime * 6 + s.a;
    const x = p.x + Math.cos(a) * T.orbitRadius;
    const z = p.z + Math.sin(a) * T.orbitRadius;
    const t = h.ctx.nearest(x, z, 18);
    let dx = t ? t.x - x : p.aim.x;
    let dz = t ? t.z - z : p.aim.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    g.bullets.spawn({ x, z, dirX: dx, dirZ: dz, speed: 30, life: 0.9, radius: 0.28, damage: T.orbitDmg * power(g), knockback: 4, team: Team.Player, color: '#7df9ff', width: 0.36, length: 0.9, pierce: 2, owner: h.index, kind: GP_KINDS.orbit });
    g.vfx.star(x, BULLET_Y, z, 0.8, '#7df9ff', 0.08);
  }
}

/** Dash hook (Game.onDash): Trigger Dash fires a ring of rounds and speeds your weapons up. */
export function gpOnDash(this: Game, h: Hero): void {
  if (!h.hasRelic('r_dashfire') || !this.authority) return;
  ensureKinds();
  const T = relicTuning;
  const p = h.player;
  h.play.dashFireT = T.dashfireRapid;
  for (let k = 0; k < T.dashfireShots; k++) {
    const a = (k / T.dashfireShots) * Math.PI * 2;
    this.bullets.spawn({ x: p.x, z: p.z, dirX: Math.cos(a), dirZ: Math.sin(a), speed: 26, life: 0.6, radius: 0.24, damage: T.dashfireDmg * power(this), knockback: 5, team: Team.Player, color: '#fff36b', width: 0.3, length: 0.8, pierce: 1, owner: h.index, kind: GP_KINDS.dashfire });
  }
  this.vfx.ring(p.x, p.z, 1, 5, '#fff36b', 0.25);
  this.vfx.sound('w:shoot', p.x, p.z, 0.8);
}

/** Kill hook (Game.killEnemy): mutant rewards, mech drops, kill spots, Nova Heart and Powder Keg. */
export function gpOnKill(this: Game, e: Enemy, source: string, by: Hero | null): void {
  const W = gpWorld(this);
  W.sites.push({ x: e.x, z: e.z, t: this.runTime });
  if (W.sites.length > 400) W.sites.shift();
  if (e.mutated) {
    const extra = mutationTuning.rewardMul - 1;
    this.pickups.spawn(PickupType.Gem, e.x, e.z, e.def.xp * (e.elite ? 10 : 1) * dropTuning.xpMul * extra);
    this.score += e.def.score * this.multiplier * extra;
  }
  if (!liveRun(this) || e.def.hidden) return;
  // Mech suit drops: rare, never two at once or while someone pilots one.
  if (W.mechCd <= 0 && !W.drops.some((d) => d.kind === 'mech') && !this.heroes.some((h) => h.play.mechT > 0)) {
    const thin = Math.min(1, dropTuning.dropRef / Math.max(1, this.director.targetAlive));
    const chance = e.elite ? mechTuning.eliteChance : mechTuning.dropChance * thin;
    if (this.rng.chance(chance) && !this.walls.hitCircle(e.x, e.z, 1)) spawnMechDrop(this, e.x, e.z);
  }
  if (!by || by.player.dead) return;
  const T = relicTuning;
  if (by.hasRelic('r_nova') && ++by.play.novaKills % T.novaEvery === 0) {
    const p = by.player;
    this.blast(p.x, p.z, T.novaRadius, T.novaDmg * power(this), '#73eff7', 'r_nova', ['frost'], true, by);
    for (const t of this.enemiesInRadius(p.x, p.z, T.novaRadius, this.scratch)) if (t.active) t.frozen = Math.max(t.frozen, T.novaFreeze * freezeMul(t));
    this.vfx.ring(p.x, p.z, 1, T.novaRadius * 2, '#9fe8ff', 0.35);
  }
  if (by.hasRelic('r_keg') && source !== 'r_keg' && this.rng.chance(T.kegChance)) {
    if (W.kegStep !== this.stepN) {
      W.kegStep = this.stepN;
      W.kegs = 0;
    }
    if (W.kegs++ < T.kegPerStep) this.blast(e.x, e.z, T.kegRadius, T.kegDmg * power(this), '#ff7a2f', 'r_keg', ['explosive'], false, by);
  }
}

/** Lane bullets that blast where they end (mech missiles). True when handled. */
export function gpBulletBlast(g: Game, i: number): boolean {
  const b = g.bullets;
  if (b.kind[i] !== GP_KINDS.missile || GP_KINDS.missile < 0) return false;
  const by = g.heroes[b.owner[i]] ?? g.hero;
  g.blast(b.x[i], b.z[i], b.blast[i], b.damage[i], '#ffb627', 'mech', ['explosive'], false, by);
  return true;
}

// ---------------------------------------------------------------- combo cash-in

/** Spend the team combo on cash-in tier k (host). Returns '' or why not. */
export function gpCashIn(this: Game, h: Hero, k: number): string {
  const W = gpWorld(this);
  const tier = cashTuning.tiers[k];
  if (!tier || h.player.dead || !this.isCombatMode || !liveRun(this)) return 'NO';
  const cost = cashCost(tier, W.cashUses);
  if (this.combo < cost) {
    if (h === this.hero) this.vfx.sound('deny', NaN, NaN);
    return 'NOT ENOUGH COMBO';
  }
  const combo = this.combo;
  this.combo = 0;
  this.comboT = 0;
  this.runEvents.onComboBreak();
  W.cashUses++;
  const fx = cashEffect(combo);
  const p = h.player;
  if (tier.id === 'heal') {
    for (const o of this.aliveHeroes) {
      const healed = o.player.heal(o.player.maxHp * fx.heal);
      if (healed > 0) this.vfx.num(o.player.x, 2.4, o.player.z, `+${Math.round(healed)}`, 'heal');
      this.vfx.burst(o.player.x, 1, o.player.z, { count: 14, color: '#ff5e7a', color2: '#ffffff', speed: [2, 5], size: [0.15, 0.3], life: [0.4, 0.7], up: 4 });
    }
    this.vfx.sound('heal', p.x, p.z);
  } else if (tier.id === 'bomb') {
    this.blast(p.x, p.z, fx.radius, fx.dmg * power(this), '#ffb627', 'cashbomb', ['explosive'], false, h);
    const b = this.bullets;
    for (let i = 0; i < b.count; i++) if (b.team[i] === Team.Enemy && Math.hypot(b.x[i] - p.x, b.z[i] - p.z) < fx.radius) b.kill(i--);
    this.vfx.ring(p.x, p.z, 1, fx.radius * 2, '#ffffff', 0.4);
    this.vfx.shake(p.x, p.z, 0.8);
    this.vfx.flash(0.3);
  } else {
    for (let i = 0; i < fx.coins; i++) {
      const a = (i / fx.coins) * Math.PI * 2 + this.rng.next();
      const d = this.rng.range(1.2, 3.5);
      this.pickups.spawn(PickupType.Bolt, p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 1);
    }
    this.vfx.burst(p.x, 2.5, p.z, { count: 20, color: '#ffcd75', color2: '#ffb627', speed: [2, 6], size: [0.15, 0.3], life: [0.5, 0.9], up: 7, gravity: 14 });
    this.vfx.sound('coin', p.x, p.z);
  }
  this.vfx.num(p.x, 3.4, p.z, `${combo} COMBO → ${tier.name}!`, 'score');
  this.vfx.sound('jingle', p.x, p.z);
  return '';
}

/** Solo / host: the local hero's cash-in keys (switch tier, cash in). */
function localCashInput(g: Game): void {
  const h = g.hero;
  if (!h || g.paused || g.screens.current !== 'none' || !g.isCombatMode || h.player.dead) return;
  const input = g.input;
  if (input.actionPressed('cashpick') || PAD_CASHPICK.some((b) => input.padButtonPressed(b))) h.play.cashSel = (h.play.cashSel + 1) % cashTuning.tiers.length;
  if (input.actionPressed('cash') || PAD_CASH.some((b) => input.padButtonPressed(b))) g.gpCashIn(h, h.play.cashSel);
}

/** Client: the cash-in keys go to the host. */
export function gameplayClientInput(this: Game, control: boolean): void {
  if (!control) return;
  const input = this.input;
  const pl = this.hero.play;
  if (input.actionPressed('cashpick') || PAD_CASHPICK.some((b) => input.padButtonPressed(b))) pl.cashSel = (pl.cashSel + 1) % cashTuning.tiers.length;
  if (input.actionPressed('cash') || PAD_CASH.some((b) => input.padButtonPressed(b))) this.client?.send({ t: 'cash', k: pl.cashSel });
}

// ---------------------------------------------------------------- chain-reaction finale

/**
 * Stage clear hook (Game.stageClear, called before the leftover horde is
 * removed): every enemy still standing, every recent kill spot and every
 * corpse still flying goes off in a rolling chain of fireworks outward from
 * the last kill (the boss). Cosmetic plus a little score.
 */
export function gpFinale(this: Game): void {
  if (!liveRun(this)) return;
  const W = gpWorld(this);
  const sites: { x: number; z: number }[] = [];
  for (const e of this.enemies.list) if (e.active && !e.def.hidden && e.pvpOwner < 0) sites.push({ x: e.x, z: e.z });
  for (const c of this.enemies.corpses.list) sites.push({ x: c.x, z: c.z });
  for (const s of W.sites) sites.push({ x: s.x, z: s.z });
  const last = W.sites[W.sites.length - 1] ?? this.hero.player;
  W.finale = finaleSchedule(sites, last.x, last.z);
  W.finaleT = 0;
  W.finaleN = 0;
  W.finaleScore = 0;
  W.finaleX = last.x;
  W.finaleZ = last.z;
  if (W.finale.length) this.vfx.num(last.x, 4, last.z, 'CHAIN REACTION!', 'crit');
}

const FIREWORK = [['#ffd23f', '#ff5e3a'], ['#7df9ff', '#ffffff'], ['#3dffb0', '#ffd23f'], ['#ffb627', '#ffffff'], ['#a7f070', '#73eff7'], ['#ef7d57', '#ffcd75']];

function updateFinale(g: Game, W: GpWorld, dt: number): void {
  const list = W.finale;
  if (!list) return;
  W.finaleT += dt;
  while (W.finaleN < list.length && list[W.finaleN].t <= W.finaleT) {
    const s = list[W.finaleN];
    const [c1, c2] = FIREWORK[W.finaleN % FIREWORK.length];
    g.vfx.burst(s.x, 1.2, s.z, { count: 10, color: c1, color2: c2, speed: [4, 9], size: [0.15, 0.3], life: [0.5, 0.9], up: 7, gravity: 10, drag: 1, sparks: 3 });
    g.vfx.star(s.x, 1.2, s.z, 1.4, c1, 0.12);
    if (W.finaleN % 3 === 0) g.vfx.ring(s.x, s.z, 0.5, 3, c2, 0.3);
    if (W.finaleN % 4 === 0) g.vfx.sound('explode', s.x, s.z, 0.8 + (W.finaleN % 5) * 0.12);
    const pts = finaleTuning.scorePer * g.stage;
    g.score += pts;
    W.finaleScore += pts;
    W.finaleN++;
  }
  if (W.finaleN >= list.length) {
    if (W.finaleScore > 0) g.vfx.num(W.finaleX, 3.4, W.finaleZ, `CHAIN x${list.length} +${W.finaleScore.toLocaleString('en-US')}`, 'score');
    W.finale = null;
  }
}

// ---------------------------------------------------------------- online

/** Per hero, in the hero snapshot (`gp`). */
export function gpHeroNet(this: Game, h: Hero): number[] {
  return h.play.net();
}

export function applyGpHeroNet(this: Game, h: Hero, a: unknown): void {
  if (!Array.isArray(a)) return;
  h.play.setNet(a as number[]);
  if (h === this.hero) h.player.noDash = h.play.mechT > 0 || h.mech.id === 'duelist';
}

/** Team state for one client: drops and crates, mutated enemies, cash-in uses. */
export function gameplayNet(this: Game, forHero: Hero): Record<string, unknown> {
  const W = gpWorld(this);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const mu: number[] = [];
  const cx = forHero.player.x;
  const cz = forHero.player.z;
  for (const e of this.enemies.list) if (e.active && e.mutated && Math.abs(e.x - cx) < 50 && Math.abs(e.z - cz) < 50) mu.push(e.uid);
  return {
    d: W.drops.map((d) => [d.id, d.kind === 'mech' ? 0 : SUPER_IDS.indexOf(d.kind) + 1, r2(d.x), r2(d.z), r2(d.t)]),
    mu,
    cu: W.cashUses,
  };
}

export function applyGameplayNet(this: Game, s: unknown): void {
  if (!s || typeof s !== 'object') return;
  const W = gpWorld(this);
  const o = s as { d?: number[][]; mu?: number[]; cu?: number };
  W.drops = (o.d ?? []).map(([id, k, x, z, t]) => ({ id, kind: k === 0 ? 'mech' : (SUPER_IDS[k - 1] ?? 'minigun'), x, z, t }));
  W.cashUses = o.cu ?? 0;
  const mu = new Set(o.mu ?? []);
  for (const [uid, e] of this.netEnemies) {
    const m = mu.has(uid);
    if (m && !e.mutated) {
      e.mutated = true;
      e.scale *= mutationTuning.scale;
      e.radius = e.def.radius * e.scale;
    }
  }
}

// ---------------------------------------------------------------- render

/** Meshes (mech bodies, drops, satellites, mutant spikes, hero auras) and the HUD. */
export function renderGameplay(this: Game, alpha: number, netA: number, rdt: number): void {
  const W = gpWorld(this);
  W.view ??= new GameplayView(this.scene);
  const client = this.role === 'client';
  W.view.render(this, W.drops, client ? netA : alpha, rdt);
  // HUD: the local hero's mech, super weapon, overload and the cash-in panel.
  const h = this.hero;
  const pl = h.play;
  const tiers = cashTuning.tiers.map((t) => ({ name: t.name, color: t.color, cost: cashCost(t, W.cashUses) }));
  const show = this.isCombatMode && this.mode !== 'title' && !h.player.dead;
  gameplayHud.update({
    show,
    mech: pl.mechT > 0 ? pl.mechT / mechTuning.duration : -1,
    mechT: pl.mechT,
    super: pl.superId ? { id: pl.superId, glyph: SUPERS[pl.superId].glyph, name: SUPERS[pl.superId].name, color: SUPERS[pl.superId].color, ammo01: pl.superAmmo / SUPERS[pl.superId].ammo, t: pl.superT, flamer: pl.superId === 'flamer', ammo: pl.superAmmo } : null,
    overload: pl.overloadT > 0 ? -pl.overloadT / overloadTuning.duration : pl.overloadReady ? pl.overload01 : -2,
    comeback: show && pl.comeback,
    reduceFlash: settings.reduceFlash || settings.reduceScreenEffects,
    combo: this.combo,
    tiers,
    afford: cashAffordable(this.combo, W.cashUses),
    sel: pl.cashSel,
    minCost: Math.min(...tiers.map((t) => t.cost)),
  });
}

// ---------------------------------------------------------------- autopilot

/**
 * The autoplay brain's take on this lane (src/game/autopilot.ts): walk to a
 * landed supply crate or mech suit nearby, and cash the combo in: heal when
 * hurt, a bomb when crowded, else gold rain once it's affordable.
 * Returns the cash-in tier to use this step (-1 = none) and may bend the move.
 */
export function pilotGameplay(g: Game, move: { mx: number; mz: number }, crowded: boolean): number {
  const h = g.hero;
  const p = h.player;
  if (g.mode === 'fight' && !g.boss) {
    let best: GpDrop | null = null;
    let bd = 30;
    for (const d of gpWorld(g).drops) {
      if (d.kind !== 'mech' && d.t < crateTuning.fall) continue;
      if (d.kind === 'mech' && h.play.mechT > 0) continue;
      const dist = Math.hypot(d.x - p.x, d.z - p.z);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    if (best) {
      const l = Math.hypot(move.mx, move.mz) || 1;
      move.mx = ((best.x - p.x) / bd) * 1.6 + (move.mx / l) * 0.5;
      move.mz = ((best.z - p.z) / bd) * 1.6 + (move.mz / l) * 0.5;
    }
  }
  if (!g.isCombatMode || p.dead) return -1;
  const uses = gpWorld(g).cashUses;
  const [heal, bomb, gold] = cashTuning.tiers.map((t) => g.combo >= cashCost(t, uses));
  if (heal && p.hp < p.maxHp * 0.45) return 0;
  if (bomb && crowded) return 1;
  if (gold) return 2;
  return -1;
}
