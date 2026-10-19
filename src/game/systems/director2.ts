/** Director2: host-only pacing, field events, rule relics and Blink Ranger tactics.
 * Shared hooks are deliberately small; ordinary enemies, pickups and VFX already replicate.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRetroMaterial } from '../../render/retroMaterial';
import { commit } from '../../render/instancing';
import type GUI from 'lil-gui';
import { adaptiveTuning } from '../director';
import type { Game } from '../game';
import type { Hero } from '../hero';
import { director2Hooks, type Enemy } from '../enemies';
import { ENEMIES, type EnemyDef } from '../../data/enemies';
import { type EventId, STAGE_EVENTS } from '../../data/stageEvents';
import { PickupType } from '../pickups';
import { CURSE_BY_ID } from '../../data/curses';
import { Team } from '../bullets';
import { bossLike } from '../bossRules';

export const director2Tuning = {
  gardenEvery: 2.4,
  gardenWarn: 1.5,
  gardenRadius: 2.2,
  rebellionEvery: 0.8,
  rebellionHits: 12,
  rebellionRange: 5,
  gravityPull: 2.8,
  gravityRadius: 10,
  goblinEvery: 7,
  turretEvery: 1.2,
  turretRange: 12,
  eventGold: 6,
  blinkEvery: 6,
  blinkWarn: 0.9,
  blinkRange: 10,
};
export const director2Events: readonly EventId[] = [
  'garden',
  'rebellion',
  'gravity',
  'goblins',
  'blackout',
  'turrets',
];
const isOurs = (id: EventId) => director2Events.includes(id);

interface RelicState {
  kills: number;
  dashes: number;
  still: number;
  safe: number;
  relay: number;
  cold: number;
  mercy: number;
}
const relicStates = new WeakMap<Hero, RelicState>();
function relicState(h: Hero): RelicState {
  let s = relicStates.get(h);
  if (!s) {
    s = { kills: 0, dashes: 0, still: 0, safe: 10, relay: 0, cold: 0, mercy: 0 };
    relicStates.set(h, s);
  }
  return s;
}
interface Blink {
  uid: number;
  t: number;
  warn: number;
  x: number;
  z: number;
}
const blinks = new WeakMap<Enemy, Blink>();
interface Rebel {
  uid: number;
  victim: Enemy;
  victimUid: number;
  event: { t: number };
  x: number;
  z: number;
  radius: number;
  speed: number;
}
const rebels = new WeakMap<Enemy, Rebel>();
/** Redirect participating robots through the existing lure contract; no player attacks while brawling. */
export function director2Lure(e: Enemy): Rebel | null {
  const r = rebels.get(e);
  if (!r || r.uid !== e.uid || r.event.t <= 0 || !r.victim.alive || r.victim.uid !== r.victimUid)
    return null;
  r.x = r.victim.x;
  r.z = r.victim.z;
  return r;
}
interface Bloom {
  t: number;
  x: number;
  z: number;
}
interface LaneState {
  stage: number;
  time: number;
  kills: number;
  event: { id: EventId; t: number } | null;
  pulse: number;
  count: number;
  x: number;
  z: number;
  turretView: THREE.InstancedMesh | null;
  matrix: THREE.Matrix4;
  blooms: Bloom[];
  nearby: Enemy[];
  living: Hero[];
}
const states = new WeakMap<Game, LaneState>();
export function director2State(g: Game): LaneState {
  let s = states.get(g);
  if (!s) {
    s = {
      stage: g.stage,
      time: g.runTime,
      kills: g.kills,
      event: null,
      pulse: 0,
      count: 0,
      x: 0,
      z: 0,
      turretView: null,
      matrix: new THREE.Matrix4(),
      blooms: [],
      nearby: [],
      living: [],
    };
    states.set(g, s);
  }
  return s;
}

/** Called after the classic event clock, once per host simulation step. */
export function updateDirector2(this: Game, dt: number): void {
  if (!this.authority) return;
  const s = director2State(this);
  if (s.stage !== this.stage || s.time > this.runTime) {
    s.event = null;
    s.blooms.length = 0;
    s.kills = this.kills;
    if (s.time > this.runTime) for (const h of this.heroes) relicStates.delete(h);
    s.stage = this.stage;
  }
  s.time = this.runTime;
  if (this.pvp || this.versus || this.onboarding.training || this.modes.holster) return;
  s.living.length = 0;
  let weakest = 1;
  let players = 0;
  for (const h of this.heroes) {
    if (h.left) continue;
    players++;
    if (!h.player.dead) s.living.push(h);
    weakest = Math.min(weakest, h.player.dead ? 0 : h.player.hp / Math.max(1, h.player.maxHp));
    const r = relicState(h);
    r.safe += dt;
    r.relay = Math.max(0, r.relay - dt);
    r.cold = Math.max(0, r.cold - dt);
    r.mercy = Math.max(0, r.mercy - dt);
    r.still =
      !h.player.dead && !h.player.dashing && Math.hypot(h.player.vel.x, h.player.vel.z) < 0.3
        ? r.still + dt
        : 0;
  }
  if (!this.director.bossSpawned)
    this.director.adaptive.step(dt, weakest, this.kills - s.kills, players);
  else {
    this.director.adaptive.pressure = 1;
    this.director.adaptive.breather = 0;
  }
  s.kills = this.kills;
  blinkStep(this, s, dt);
  eventStep(this, s, dt);
}

/** Actual damage, after armor/caps and successful Player.hurt; includes lethal hits before revives. */
export function director2Hurt(this: Game, h: Hero, damage: number): void {
  if (!this.authority || this.pvp || this.versus || this.onboarding.training) return;
  const p = h.player;
  let present = 0;
  for (const mate of this.heroes) if (!mate.left) present++;
  this.director.adaptive.hurt(
    damage / Math.max(1, p.maxHp),
    p.hp / Math.max(1, p.maxHp),
    p.dead,
    present,
  );
  const s = relicState(h);
  if (!p.dead && h.hasRelic('r_capacitor')) h.bombCharge = Math.min(1, h.bombCharge + 0.15);
  if (h.hasRelic('r_pacemaker') && s.safe >= 10) {
    const b = this.bullets;
    for (let i = 0; i < b.count; i++)
      if (b.team[i] === Team.Enemy && (b.x[i] - p.x) ** 2 + (b.z[i] - p.z) ** 2 < 16) b.kill(i--);
    this.vfx.ring(p.x, p.z, 0.5, 8, '#73eff7', 0.4);
    this.vfx.sound('powerUp', p.x, p.z);
  }
  s.safe = 0;
}

/** Pure live modifiers; recomputed from base stats each step, so they never compound. */
export function director2Live(h: Hero): void {
  const s = relicState(h);
  if (h.hasRelic('r_anchor') && s.still >= 1) {
    h.stats.armor += 4;
    h.stats.cooldownMul *= 0.85;
  }
  if (h.hasRelic('r_glassclock')) {
    if (h.player.hp >= h.player.maxHp - 0.01) h.stats.cooldownMul *= 0.8;
    else h.stats.damageMul *= 0.9;
  }
  if (h.hasRelic('r_reserve') && h.bombCharge >= 1) {
    h.stats.magnet *= 2;
    h.stats.damageMul *= 1.15;
  }
}

export function director2Dash(this: Game, h: Hero): void {
  if (!this.authority || this.pvp) return;
  const s = relicState(h);
  const p = h.player;
  s.dashes++;
  if (h.hasRelic('r_backbeat') && s.dashes % 3 === 0)
    h.bombCharge = Math.min(1, h.bombCharge + 0.12);
  if (h.hasRelic('r_relay') && s.relay <= 0) {
    s.relay = 6;
    const solo = this.heroes.filter((o) => !o.left).length === 1;
    for (const o of this.heroes)
      if (
        !o.left &&
        !o.player.dead &&
        (solo || o !== h) &&
        Math.hypot(o.player.x - p.x, o.player.z - p.z) <= 7
      ) {
        const n = o.player.heal(solo ? 4 : 8);
        if (n > 0) this.vfx.num(o.player.x, 2, o.player.z, `+${Math.round(n)}`, 'heal');
      }
    this.vfx.ring(p.x, p.z, 1, 14, '#38b764', 0.4);
  }
  if (h.hasRelic('r_coldsnap') && s.cold <= 0) {
    s.cold = 4;
    for (const e of this.enemiesInRadius(p.x, p.z, 3, director2State(this).nearby))
      if (!bossLike(e) && e.def.behavior !== 'reaper') e.frozen = Math.max(e.frozen, 1);
    this.vfx.ring(p.x, p.z, 1, 6, '#73eff7', 0.35);
    this.vfx.sound('powerUp', p.x, p.z);
  }
  if (h.hasRelic('r_cinder') && s.dashes % 2 === 0) {
    this.strikes.push({
      x: p.x,
      z: p.z,
      r: 3,
      t: 0.8,
      dmg: 0,
      foe: 35 * this.director.hpMul,
      cause: 'Cinder Receipt',
      by: h.index,
    });
    this.vfx.ring(p.x, p.z, 0.5, 6, '#ef7d57', 0.8);
  }
}

export function director2Kill(this: Game, e: Enemy, by: Hero | null): void {
  if (!this.authority || !by || by.player.dead || e.def.hidden || this.pvp) return;
  const s = relicState(by);
  s.kills++;
  if (by.hasRelic('r_mercy') && s.kills % 12 === 0 && s.mercy <= 0) {
    s.mercy = 6;
    if (by.player.hp < by.player.maxHp * 0.5) {
      const n = by.player.heal(8);
      this.vfx.num(by.player.x, 2, by.player.z, `+${Math.round(n)}`, 'heal');
    } else {
      by.gold += 2;
      this.goldFx(by, 2);
    }
  }
  if (by.hasRelic('r_salvage') && e.elite) this.pickups.spawn(PickupType.Gear, e.x, e.z, 1);
  if (by.hasRelic('r_jackpot') && s.kills % 40 === 0) {
    by.bombCharge = 1;
    this.vfx.num(by.player.x, 2.5, by.player.z, 'SPECIAL READY!', 'crit');
    this.vfx.sound('powerUp', by.player.x, by.player.z);
  }
}

function tracer(g: Game, x: number, z: number, tx: number, tz: number, color: string): void {
  for (let i = 1; i <= 4; i++)
    g.vfx.star(x + ((tx - x) * i) / 4, 1, z + ((tz - z) * i) / 4, 0.35, color, 0.18);
}

function reward(g: Game): void {
  const gold = director2Tuning.eventGold + g.stage * 2;
  for (const h of g.heroes) if (!h.left) h.gold += gold;
  g.score += 500 * g.stage;
  g.vfx.toast(`EVENT COMPLETE • +${gold} GOLD EACH`, 2);
  g.vfx.sound('jingle', NaN, NaN);
}

function eventStep(g: Game, s: LaneState, dt: number): void {
  const ev = g.runEvents.event;
  if (ev !== s.event) {
    // Only a normally completed timer pays; force/replacement and stage resets cannot farm rewards.
    if (s.event && isOurs(s.event.id) && s.event.t <= 0) reward(g);
    if (s.event && s.event !== ev) s.event.t = 0;
    s.event = ev;
    s.pulse = 0;
    s.count = 0;
    s.blooms.length = 0;
    const p = s.living[0]?.player;
    if (p) {
      s.x = p.x;
      s.z = p.z;
    }
  }
  if (!ev || !isOurs(ev.id) || !s.living.length) return;
  const T = director2Tuning;
  // Blooms become hearts only after the warned meteor has landed.
  for (let i = s.blooms.length - 1; i >= 0; i--) {
    const b = s.blooms[i];
    b.t -= dt;
    if (b.t <= 0) {
      const noHearts = g.meta.has('hearts') || g.curses.some((id) => CURSE_BY_ID[id]?.noHearts);
      g.pickups.spawn(noHearts ? PickupType.Bolt : PickupType.Heart, b.x, b.z, noHearts ? 1 : 6);
      s.blooms.splice(i, 1);
    }
  }
  if (ev.id === 'gravity') {
    for (const e of g.enemies.list) {
      if (!e.alive || bossLike(e) || e.def.behavior === 'reaper' || e.def.hidden) continue;
      const dx = s.x - e.x,
        dz = s.z - e.z;
      const d = Math.hypot(dx, dz);
      if (d > 1 && d < T.gravityRadius) {
        const x = e.x + (dx / d) * T.gravityPull * dt;
        const z = e.z + (dz / d) * T.gravityPull * dt;
        if (!g.walls.hitCircle(x, z, e.radius)) {
          e.x = x;
          e.z = z;
        }
      }
    }
  }
  s.pulse -= dt;
  if (s.pulse > 0) return;
  const p = s.living[s.count % s.living.length].player;
  s.count++;
  switch (ev.id) {
    case 'garden': {
      s.pulse = T.gardenEvery;
      const a = g.rng.next() * Math.PI * 2;
      const x = p.x + Math.cos(a) * 5,
        z = p.z + Math.sin(a) * 5;
      if (g.walls.hitCircle(x, z, T.gardenRadius)) break;
      g.strikes.push({
        x,
        z,
        r: T.gardenRadius,
        t: T.gardenWarn,
        dmg: 14 * g.director.dmgMul,
        foe: 45 * g.director.hpMul,
        cause: 'Meteor Garden',
      });
      s.blooms.push({ x, z, t: T.gardenWarn + 0.1 });
      g.vfx.zone(x, z, T.gardenRadius, T.gardenWarn);
      g.vfx.sound('threatMortar', x, z);
      break;
    }
    case 'rebellion': {
      s.pulse = T.rebellionEvery;
      let hits = 0;
      // Capped robots query the existing spatial hash, never an all-pairs scan.
      for (const e of g.enemies.list) {
        if (!e.alive || e.frozen > 0 || e.def.death !== 'robot' || bossLike(e) || e.def.hidden)
          continue;
        const others = g.enemiesInRadius(e.x, e.z, T.rebellionRange, s.nearby);
        const target = others.find(
          (o) => o !== e && !bossLike(o) && o.def.behavior !== 'reaper' && !o.def.hidden,
        );
        if (!target) continue;
        let rebel = rebels.get(e);
        if (!rebel || rebel.uid !== e.uid) {
          rebel = {
            uid: e.uid,
            victim: target,
            victimUid: target.uid,
            event: ev,
            x: target.x,
            z: target.z,
            radius: target.radius,
            speed: 0.6,
          };
          rebels.set(e, rebel);
        } else {
          rebel.victim = target;
          rebel.victimUid = target.uid;
          rebel.event = ev;
        }
        e.state = 'move';
        e.t = 0;
        e.facing = Math.atan2(target.x - e.x, target.z - e.z);
        tracer(g, e.x, e.z, target.x, target.z, '#a7f070');
        g.damage(
          target,
          12 * g.director.hpMul,
          { source: 'rebellion', fixed: true, noStatus: true },
          g.hero,
        );
        if (++hits >= T.rebellionHits) break;
      }
      break;
    }
    case 'gravity':
      s.pulse = 1;
      g.vfx.ring(s.x, s.z, T.gravityRadius * 2, 0.05, '#b13e53', 1);
      g.vfx.star(s.x, 0.6, s.z, 1.6, '#73eff7', 0.7);
      break;
    case 'goblins':
      s.pulse = T.goblinEvery;
      if (s.count <= 3) g.spawnEnemy(ENEMIES.golden);
      break;
    case 'blackout':
      s.pulse = 7;
      if (s.count <= 2) g.spawnEnemy(ENEMIES.blinksniper);
      // Cyan beacons retain landmarks and telegraph contrast in darkness.
      g.vfx.ring(p.x, p.z, 1, 12, '#73eff7', 1);
      break;
    case 'turrets': {
      s.pulse = T.turretEvery;
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3;
        const x = s.x + Math.cos(a) * 5,
          z = s.z + Math.sin(a) * 5;
        if (g.walls.hitCircle(x, z, 0.6)) continue;
        g.vfx.ring(x, z, 1.6, 1.6, '#38b764', T.turretEvery);
        g.vfx.star(x, 1, z, 1.3, '#ffcd75', T.turretEvery);
        const target = g.nearestEnemy(x, z, T.turretRange);
        if (target) {
          tracer(g, x, z, target.x, target.z, '#ffcd75');
          g.damage(
            target,
            30 * g.director.hpMul,
            { source: 'party_turret', fixed: true, noStatus: true },
            g.hero,
          );
          g.vfx.sound('w:shoot', x, z, 0.8);
        }
      }
      break;
    }
  }
}

/** A blink never interrupts a shot's aim line. Destination glows for 0.9 s; landing starts a fresh aim. */
function blinkStep(g: Game, state: LaneState, dt: number): void {
  const T = director2Tuning;
  for (const e of g.enemies.list) {
    if (!e.alive || e.def.director2 !== 'blink') continue;
    let s = blinks.get(e);
    if (!s || s.uid !== e.uid) {
      s = { uid: e.uid, t: T.blinkEvery + (e.uid % 3), warn: 0, x: 0, z: 0 };
      blinks.set(e, s);
    }
    // A frozen telegraph expires visually: cancel it and warn afresh after thawing.
    if (e.frozen > 0) {
      if (s.warn > 0) {
        s.warn = 0;
        s.t = 1;
      }
      continue;
    }
    if (s.warn > 0) {
      s.warn -= dt;
      if (s.warn <= 0 && e.state === 'move' && !g.walls.hitCircle(s.x, s.z, e.radius)) {
        g.vfx.ring(e.x, e.z, 2, 0.1, '#73eff7', 0.25);
        e.x = e.px = s.x;
        e.z = e.pz = s.z;
        e.vx = e.vz = 0;
        e.hasCover = false;
        e.timerA = 0.6;
        g.vfx.ring(e.x, e.z, 0.1, 3, '#73eff7', 0.3);
      }
      continue;
    }
    s.t -= dt;
    if (s.t > 0 || e.state !== 'move' || !state.living.length) continue;
    s.t = T.blinkEvery;
    const p = state.living[e.uid % state.living.length].player;
    const a = Math.atan2(e.z - p.z, e.x - p.x) + Math.PI * 0.65;
    s.x = p.x + Math.cos(a) * T.blinkRange;
    s.z = p.z + Math.sin(a) * T.blinkRange;
    if (g.walls.hitCircle(s.x, s.z, e.radius)) continue;
    s.warn = T.blinkWarn;
    e.timerA = Math.max(e.timerA, T.blinkWarn + 0.2);
    g.vfx.ring(s.x, s.z, 0.2, 2.5, '#73eff7', T.blinkWarn);
    g.vfx.sound('threatSniper', s.x, s.z);
  }
}

/** Distinct merged silhouettes; the original instanced material and base gait remain shared. */
export function director2Model(
  def: EnemyDef,
  add: (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number) => void,
): void {
  const r = def.radius;
  if (def.director2 === 'bastion') {
    for (const side of [-1, 1])
      add(
        new THREE.BoxGeometry(r * 0.6, r * 2.8, r * 0.3),
        def.bodyColor,
        side * r * 1.15,
        r * 1.4,
        r * 0.9,
      );
    add(new THREE.BoxGeometry(r * 2.8, r * 0.35, r * 0.4), def.accentColor, 0, r * 2.8, r * 0.9);
  } else if (def.director2 === 'blink') {
    add(new THREE.TorusGeometry(r * 1.3, r * 0.16, 4, 8), def.accentColor, 0, r * 1.6, -r * 0.6);
    add(new THREE.BoxGeometry(r * 0.3, r * 0.3, r * 2.6), '#94b0c2', r * 0.6, r * 1.2, r * 1.2);
  } else if (def.director2 === 'courier') {
    add(new THREE.BoxGeometry(r * 1.6, r * 1.5, r * 1.2), '#333c57', 0, r * 1.6, -r * 0.8);
    for (const side of [-1, 1])
      add(
        new THREE.CylinderGeometry(r * 0.3, r * 0.3, r * 1.8, 6),
        def.accentColor,
        side * r * 0.65,
        r * 1.8,
        -r * 0.8,
      );
  }
}

/** Small debug snapshot. Events and all visible effects use sev / the existing effects bus. */
export function director2Net(this: Game): number[] {
  const a = this.director.adaptive;
  const s = director2State(this);
  return [
    Math.round(a.pressure * 1000) / 1000,
    Math.round(a.breather * 10) / 10,
    a.nearDeaths,
    a.deaths,
    s.x,
    s.z,
  ];
}
export function applyDirector2Net(this: Game, value: unknown): void {
  if (
    !Array.isArray(value) ||
    value.length !== 6 ||
    !value.every((v) => typeof v === 'number' && Number.isFinite(v))
  )
    return;
  const a = this.director.adaptive;
  [a.pressure, a.breather, a.nearDeaths, a.deaths] = value;
  const s = director2State(this);
  s.x = value[4];
  s.z = value[5];
}

/** Existing test-link event/relic/spawn options work; one switch supports identical-seed A/B bots. */
export function director2Links(g: Game, q: URLSearchParams): void {
  if (q.has('d2event')) {
    const id = q.get('d2event') as EventId;
    if (STAGE_EVENTS[id] && isOurs(id)) g.runEvents.forceEvent(id);
  }
}

/** Friendly event sentries: three pooled instances, no draw-time gameplay or per-frame objects. */
export function renderDirector2(this: Game): void {
  const s = director2State(this);
  const id = this.role === 'client' ? this.netEvent?.[0] : this.runEvents.event?.id;
  const show = id === 'turrets' && this.isCombatMode;
  if (!show) {
    if (s.turretView) s.turretView.count = 0;
    return;
  }
  if (!s.turretView) {
    const parts = [
      new THREE.CylinderGeometry(0.6, 0.8, 0.25, 6).translate(0, 0.13, 0),
      new THREE.BoxGeometry(0.8, 0.65, 0.8).translate(0, 0.6, 0),
      new THREE.BoxGeometry(0.25, 0.25, 1.2).translate(0, 0.82, 0.65),
    ];
    const colors = ['#333c57', '#38b764', '#ffcd75'];
    for (let i = 0; i < parts.length; i++) {
      const c = new THREE.Color(colors[i]);
      const data = new Float32Array(parts[i].getAttribute('position').count * 3);
      for (let k = 0; k < data.length; k += 3) {
        data[k] = c.r;
        data[k + 1] = c.g;
        data[k + 2] = c.b;
      }
      parts[i].setAttribute('color', new THREE.BufferAttribute(data, 3));
    }
    const geo = mergeGeometries(parts)!;
    for (const part of parts) part.dispose();
    s.turretView = new THREE.InstancedMesh(geo, createRetroMaterial({ vertexColors: true }), 3);
    s.turretView.frustumCulled = false;
    s.turretView.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(s.turretView);
  }
  let count = 0;
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    const x = s.x + Math.cos(a) * 5,
      z = s.z + Math.sin(a) * 5;
    if (this.walls.hitCircle(x, z, 0.6)) continue;
    s.matrix.makeRotationY(Math.PI / 2 - a);
    s.matrix.setPosition(x, 0, z);
    s.turretView.setMatrixAt(count++, s.matrix);
  }
  s.turretView.count = count;
  commit(s.turretView.instanceMatrix, count);
}

export function addDirector2Debug(gui: GUI, g: Game): void {
  const f = gui.addFolder('Adaptive pacing').close();
  for (const key of Object.keys(adaptiveTuning) as (keyof typeof adaptiveTuning)[])
    f.add(adaptiveTuning, key);
  for (const key of [
    'pressure',
    'damagePerMinute',
    'killsPerSecond',
    'breather',
    'debt',
    'nearDeaths',
    'deaths',
  ] as const)
    f.add(g.director.adaptive, key).listen().disable();
  const events = f.addFolder('Events and Blink Ranger').close();
  for (const key of Object.keys(director2Tuning) as (keyof typeof director2Tuning)[])
    events.add(director2Tuning, key);
}

// Install only when the Game loads this lane; pure enemy/Hero imports stay browser-free.
director2Hooks.model = director2Model;
director2Hooks.lure = director2Lure;
