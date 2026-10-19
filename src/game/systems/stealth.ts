/**
 * Night Raid (world-events lane): a stealth stage. Enemies start unaware and
 * patrol around where they spawned; they notice a hero who is lit (lamp pools,
 * searchlight beams, muzzle flashes) and close, or who makes noise (left-click
 * fire, dashes, specials), or who hits them. A noticed enemy first turns
 * suspicious ("?", walks to where it saw you), then alert ("!", hunts you) and
 * shouts to the others near it; it calms down if it loses you for a while.
 * Auto weapons, pets and turrets hold fire at unaware enemies (worldHooks.hidden),
 * and the right click is quiet, so a careful team can sneak. Three intel caches
 * pay gold and score (double if no hunter is close) and a chest each when all
 * are taken. The boss ends it: everything hears everything.
 *
 * The host decides awareness per enemy; clients get the suspicious/alert ones
 * near their hero (`aw`: host uid, state) and compute their own light meter.
 */
import type { Game } from '../game';
import type { Enemy } from '../enemies';
import type { Hero } from '../hero';
import { bossLike } from '../bossRules';
import { PickupType } from '../pickups';
import { isSpecialRunning } from '../specials';
import { hash01, lightAt, sightRange, stealthLayout, worldEventTuning as T, type StealthLayout } from '../worldEvents';

/** Awareness: 0 unaware (patrols), 1 suspicious (investigates), 2 alert (hunts). */
export type AwareLevel = 0 | 1 | 2;

interface Aware {
  uid: number;
  st: StealthState;
  s: AwareLevel;
  sus: number;
  alertT: number;
  hx: number;
  hz: number;
  wx: number;
  wz: number;
  wt: number;
  wn: number;
  lx: number;
  lz: number;
}

export interface StealthState {
  active: boolean;
  layout: StealthLayout;
  /** Caches taken (bit mask) and grab progress per cache (s). */
  got: number;
  grab: number[];
  /** Enemies hunting the team right now. */
  alerts: number;
  /** Host: per hero index, visibility 0..1 and noise radius (m). */
  vis: number[];
  noise: number[];
  /** Alerts that spread to neighbours next step. */
  pending: Enemy[];
  bannerT: number;
  soundT: number;
  popN: number;
  /** Client: host uid -> awareness of the enemies near this machine's hero. */
  netAw: Map<number, AwareLevel>;
  /** This machine's hero: light meter 0..1, noise radius, best grab progress 0..1. */
  meter: number;
  loud: number;
  grabP: number;
  extra: { x: number; z: number; r: number }[];
  extraFor: unknown;
}

const AWARE = new WeakMap<Enemy, Aware>();
const LOUD = new Set(['scatter', 'rail']);
const lure = { x: 0, z: 0, radius: 0, speed: 1 };
const near: Enemy[] = [];

export function newStealth(p: number[]): StealthState {
  const layout = stealthLayout(p);
  return { active: true, layout, got: 0, grab: layout.caches.map(() => 0), alerts: 0, vis: [], noise: [], pending: [], bannerT: 0, soundT: 0, popN: 0, netAw: new Map(), meter: 0, loud: 0, grabP: 0, extra: [], extraFor: null };
}

/** Is this enemy unaware on a live stealth stage? (Auto weapons skip it.) */
export function stealthHidden(e: Enemy): boolean {
  const a = AWARE.get(e);
  return !!a && a.uid === e.uid && a.st.active && a.s < 2;
}

/** Awareness of an enemy as this machine knows it (host: its own table; client: the snapshot). */
export function awareOf(g: Game, st: StealthState, e: Enemy, hostUid = -1): AwareLevel {
  if (!st.active) return 2;
  if (g.role === 'client') return st.netAw.get(hostUid) ?? 0;
  const a = AWARE.get(e);
  return a && a.uid === e.uid && a.st === st ? a.s : 0;
}

/** Neon City signs and lamps light you up too. */
function extraLights(g: Game, st: StealthState): StealthState['extra'] {
  if (st.extraFor !== g.arena) {
    st.extraFor = g.arena;
    st.extra = (g.arena.deco?.lights ?? []).map((l) => ({ x: l.x, z: l.z, r: Math.min(5, l.r * 0.5) }));
  }
  return st.extra;
}

/** How visible a hero is: the light where they stand, plus a muzzle flash while firing. */
export function heroVisibility(g: Game, st: StealthState, t: number, h: Hero, firing: boolean): number {
  const p = h.player;
  return Math.min(1, lightAt(st.layout, t, p.x, p.z, extraLights(g, st)) + (firing ? 0.3 : 0));
}

/** How far a hero's noise carries right now (m; 0 = silent). The right click is quiet. */
export function heroNoise(h: Hero, firing: boolean): number {
  const p = h.player;
  if (p.dead || h.left) return 0;
  let n = 0;
  if (firing) {
    const primary = h.weapons.find((w) => w.def.slot === 'primary')?.def.id ?? '';
    n = LOUD.has(primary) ? T.noiseLoud : T.noiseFire;
  }
  if (p.dashing) n = Math.max(n, T.noiseDash);
  if (h.bombT >= 0 || isSpecialRunning(h)) n = Math.max(n, T.noiseSpecial);
  return n;
}

function aware(e: Enemy, st: StealthState): Aware {
  let a = AWARE.get(e);
  if (!a || a.uid !== e.uid || a.st !== st) {
    a = { uid: e.uid, st, s: 0, sus: 0, alertT: 0, hx: e.x, hz: e.z, wx: e.x, wz: e.z, wt: 99, wn: 0, lx: e.x, lz: e.z };
    AWARE.set(e, a);
  }
  return a;
}

function alert(g: Game, st: StealthState, e: Enemy, a: Aware, pop: boolean): void {
  if (a.s === 2) {
    a.alertT = T.alertTime;
    return;
  }
  a.s = 2;
  a.sus = 1;
  a.alertT = T.alertTime;
  st.pending.push(e);
  if (pop && st.popN < 6) {
    st.popN++;
    g.vfx.num(e.x, 2.8, e.z, '!', 'crit');
  }
  if (st.soundT <= 0) {
    st.soundT = 0.6;
    g.vfx.sound('telegraph', e.x, e.z, 1.3);
  }
  if (st.bannerT <= 0) {
    st.bannerT = 12;
    g.vfx.toast("YOU'VE BEEN SPOTTED!", 2);
  }
}

/** Host step: who sees and hears whom, alerts spreading, patrol targets, the caches. */
export function updateStealth(g: Game, st: StealthState, t: number, dt: number): void {
  st.active = true;
  st.bannerT -= dt;
  st.soundT -= dt;
  st.popN = 0;
  const heroes = g.heroes;
  for (let i = 0; i < heroes.length; i++) {
    const h = heroes[i];
    const live = !h.player.dead && !h.left;
    const firing = live && h.ctx.firing;
    st.vis[i] = live ? heroVisibility(g, st, t, h, firing) : 0;
    st.noise[i] = live ? heroNoise(h, firing) : 0;
  }
  const me = g.hero.index;
  st.meter = st.vis[me] ?? 0;
  st.loud = st.noise[me] ?? 0;

  // Alerts from last step shout to their neighbours (a wave, one hop per step).
  const spread = st.pending.splice(0, 40);
  for (const e of spread) {
    if (!e.active) continue;
    for (const o of g.enemiesInRadius(e.x, e.z, T.spread, near)) {
      if (o === e) continue;
      const a = aware(o, st);
      if (a.s < 2) {
        a.lx = e.x;
        a.lz = e.z;
        alert(g, st, o, a, false);
      }
    }
  }

  let alerts = 0;
  for (const e of g.enemies.list) {
    if (!e.alive || e.pvpOwner >= 0) continue;
    const a = aware(e, st);
    if (bossLike(e) || e.def.behavior === 'reaper' || e.def.hidden) {
      a.s = 2;
      continue;
    }
    a.wt += dt;
    // Hit: it knows.
    if (e.flash > 0 && e.hp < e.maxHp && a.s < 2) {
      teamNearest(g, e, a);
      alert(g, st, e, a, true);
    }
    let seen = 0;
    for (let i = 0; i < heroes.length; i++) {
      const h = heroes[i];
      if (h.player.dead || h.left) continue;
      const dx = h.player.x - e.x;
      const dz = h.player.z - e.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < st.noise[i]) {
        a.lx = h.player.x;
        a.lz = h.player.z;
        alert(g, st, e, a, true);
        seen = 1;
        break;
      }
      const range = sightRange(st.vis[i], e.elite);
      if (d < range) {
        seen = Math.max(seen, 1.6 - d / range);
        a.lx = h.player.x;
        a.lz = h.player.z;
      }
    }
    if (a.s === 2) {
      if (seen > 0) a.alertT = T.alertTime;
      else if ((a.alertT -= dt) <= 0) {
        a.s = 1;
        a.sus = 0.6;
      }
    } else if (seen > 0) {
      a.sus += T.notice * dt * seen;
      if (a.sus >= 1) alert(g, st, e, a, true);
      else a.s = 1;
    } else if ((a.sus -= 0.2 * dt) <= 0) {
      a.sus = 0;
      a.s = 0;
    }
    if (a.s === 2) alerts++;
  }
  st.alerts = alerts;
  updateCaches(g, st, dt);
}

function teamNearest(g: Game, e: Enemy, a: Aware): void {
  let bd = Infinity;
  for (const h of g.aliveHeroes) {
    const d = (h.player.x - e.x) ** 2 + (h.player.z - e.z) ** 2;
    if (d < bd) {
      bd = d;
      a.lx = h.player.x;
      a.lz = h.player.z;
    }
  }
}

/** Where an unaware or suspicious enemy walks (EnemyCtx.lure); null = it hunts. */
export function stealthLure(g: Game, st: StealthState, e: Enemy): typeof lure | null {
  if (!st.active || g.role === 'client') return null;
  const a = AWARE.get(e);
  if (!a || a.uid !== e.uid || a.st !== st || a.s === 2) return null;
  if (a.s === 1) {
    lure.x = a.lx;
    lure.z = a.lz;
    lure.speed = T.searchSpeed;
    return lure;
  }
  // Patrol: stroll between points around where it spawned.
  if (a.wt > 6 || (e.x - a.wx) ** 2 + (e.z - a.wz) ** 2 < 1) {
    a.wt = 0;
    a.wn++;
    const k = hash01(e.uid * 131 + a.wn * 7);
    const ang = k * Math.PI * 2;
    const r = 2 + hash01(e.uid * 17 + a.wn) * 6;
    const lim = g.arena.halfSize - 3;
    a.wx = Math.max(-lim, Math.min(lim, a.hx + Math.cos(ang) * r));
    a.wz = Math.max(-lim, Math.min(lim, a.hz + Math.sin(ang) * r));
  }
  lure.x = a.wx;
  lure.z = a.wz;
  lure.speed = T.patrolSpeed;
  return lure;
}

function updateCaches(g: Game, st: StealthState, dt: number): void {
  const cs = st.layout.caches;
  let best = 0;
  for (let i = 0; i < cs.length; i++) {
    if (st.got & (1 << i)) continue;
    const c = cs[i];
    const on = g.aliveHeroes.some((h) => Math.hypot(h.player.x - c.x, h.player.z - c.z) < T.cacheR);
    st.grab[i] = on ? st.grab[i] + dt : Math.max(0, st.grab[i] - dt * 0.5);
    best = Math.max(best, st.grab[i] / T.cacheTime);
    if (st.grab[i] >= T.cacheTime) takeCache(g, st, i);
  }
  st.grabP = Math.min(1, best);
}

function takeCache(g: Game, st: StealthState, i: number): void {
  const c = st.layout.caches[i];
  st.got |= 1 << i;
  let hunted = false;
  for (const e of g.enemiesInRadius(c.x, c.z, 14, near)) if (AWARE.get(e)?.s === 2) hunted = true;
  const mul = hunted ? 1 : T.ghostMul;
  const gold = Math.round((6 + 2 * g.stage) * mul);
  g.score += 600 * g.stage * mul;
  for (const h of g.heroes) {
    if (h.left) continue;
    h.gold += gold;
    if (!h.player.dead) g.vfx.num(h.player.x, 2.8, h.player.z, `+${gold}●`, 'score');
  }
  const n = countBits(st.got);
  const all = n >= st.layout.caches.length;
  g.vfx.toast(`INTEL ${n}/${st.layout.caches.length} · +${gold} GOLD${hunted ? '' : ' · GHOST BONUS x2'}`, 2.6);
  g.vfx.sound('chest', c.x, c.z);
  g.vfx.ring(c.x, c.z, 1, 7, '#73eff7', 0.5);
  g.vfx.burst(c.x, 1.2, c.z, { count: 20, color: '#73eff7', color2: '#f4f4f4', speed: [2, 6], size: [0.15, 0.3], life: [0.4, 0.8], up: 6, gravity: 10 });
  if (all) {
    const team = g.heroes.filter((h) => !h.left);
    team.forEach((_h, k) => g.pickups.spawn(PickupType.Chest, c.x + (k - (team.length - 1) / 2) * 0.9, c.z + 1.2));
    g.vfx.banner('INTEL SECURED!', 'A TREASURE CHEST EACH', 2);
    g.vfx.sound('stageClear', NaN, NaN);
  }
}

function countBits(n: number): number {
  let c = 0;
  for (; n; n &= n - 1) c++;
  return c;
}

/** Snapshot fields for one client: caches, hunters, grab progress and awareness near their hero. */
export function stealthNet(g: Game, st: StealthState, forHero: Hero): Record<string, unknown> {
  const aw: number[] = [];
  const px = forHero.player.x;
  const pz = forHero.player.z;
  if (st.active) {
    for (const e of g.enemies.list) {
      if (!e.alive || aw.length >= 160) continue;
      if (Math.abs(e.x - px) > 26 || Math.abs(e.z - pz) > 26) continue;
      const a = AWARE.get(e);
      if (a && a.uid === e.uid && a.st === st && a.s > 0) aw.push(e.uid, a.s);
    }
  }
  let gp = 0;
  const cs = st.layout.caches;
  for (let i = 0; i < cs.length; i++) if (!(st.got & (1 << i)) && Math.hypot(cs[i].x - px, cs[i].z - pz) < T.cacheR + 0.5) gp = Math.max(gp, st.grab[i] / T.cacheTime);
  return { g: st.got, a: st.alerts, gp: Math.round(Math.min(1, gp) * 100) / 100, aw };
}

export function applyStealthNet(_g: Game, st: StealthState, m: Record<string, unknown>): void {
  st.active = !m.d;
  st.got = Number(m.g) || 0;
  st.alerts = Number(m.a) || 0;
  st.grabP = Number(m.gp) || 0;
  st.netAw.clear();
  const aw = (m.aw as number[]) ?? [];
  for (let i = 0; i + 1 < aw.length; i += 2) st.netAw.set(aw[i], aw[i + 1] as AwareLevel);
}

/** Client: this machine's light meter (instant feedback, the host still decides who saw what). */
export function stealthLocal(g: Game, st: StealthState, t: number): void {
  const h = g.hero;
  const firing = h.player.recoil > 0.05;
  st.meter = h.player.dead ? 0 : heroVisibility(g, st, t, h, firing);
  st.loud = heroNoise(h, firing);
}
