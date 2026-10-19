/** Combat weather: host simulation, lane-owned snapshot, pooled presentation. */
import * as THREE from 'three';
import type { Game } from '../game';
import type { Hero } from '../hero';
import type { Enemy } from '../enemies';
import { bossLike } from '../bossRules';
import { Team } from '../bullets';
import { settings, access } from '../settings';
import { WEATHER_EVENTS, weather2Tuning as T, isWeatherKind, exposure, weatherGust, hotTile, segmentDistance2, type WeatherKind } from '../../data/weather2';
import { createRetroMaterial, retroGlobals } from '../../render/retroMaterial';
import { commit } from '../../render/instancing';
import { postfx, MAX_HEAT } from '../../render/postfx';
import { renderQuality } from '../../render/quality';
import { t, localize } from '../../i18n';
import { ARENA_SOURCE_NAMES, ENV_SOURCES } from './arena';

if (!ENV_SOURCES.includes('weather2')) ENV_SOURCES.push('weather2');
ARENA_SOURCE_NAMES.weather2 = 'Lightning Storm';

interface Exposure { chill: number; heat: number; warm: number; sheltered: boolean; }
interface Cold { uid: number; value: number; frozen: boolean; immune: number; }
interface Prop { x: number; z: number; cooldown: number; charges: number; }
interface Strike { x: number; z: number; left: number; hit: boolean; }
export interface Weather2State {
  arena: unknown; kind: WeatherKind | null; left: number; tick: number; elapsed: number;
  nextStrike: number; spread: number; sourceCursor: number; damageTick: number;
  heroes: Exposure[]; cold: Map<Enemy, Cold>; props: Prop[]; strikes: Strike[];
  near: Enemy[]; spreadTargets: Enemy[]; visible: (x: number, z: number) => boolean; view: WeatherView | null; hud: HTMLElement | null; hudText: string;
}
const states = new WeakMap<Game, Weather2State>();
export function weather2Of(g: Game): Weather2State {
  let s = states.get(g);
  if (!s) {
    s = { arena: g.arena, kind: null, left: 0, elapsed: 0, tick: 0, nextStrike: 1, spread: 0, sourceCursor: 0, damageTick: 0,
      heroes: [], cold: new Map(), props: [], strikes: [], near: [], spreadTargets: [], visible: (x, z) => weather2Visible(g, x, z), view: null, hud: null, hudText: '' };
    states.set(g, s);
  }
  if (s.arena !== g.arena) { clear(s); s.arena = g.arena; }
  return s;
}
function clear(s: Weather2State): void {
  for (const [e, c] of s.cold) if (e.uid === c.uid && c.frozen) { e.frozen = 0; e.shatter = 0; }
  s.kind = null; s.left = s.elapsed = s.tick = s.spread = s.damageTick = 0; s.nextStrike = 1;
  s.heroes.length = s.props.length = s.strikes.length = 0; s.cold.clear();
  if (s.view) s.view.group.visible = false;
}
function heroExposure(s: Weather2State, h: Hero): Exposure {
  return s.heroes[h.index] ?? (s.heroes[h.index] = { chill: 0, heat: 0, warm: 0, sheltered: false });
}
function placeProps(g: Game, s: Weather2State): void {
  if (s.kind === 'sandstorm') return;
  for (const h of g.heroes) {
    if (h.left) continue;
    // A reachable countermeasure near every hero, including a separated co-op team.
    for (let n = 0; n < 72; n++) {
      const a = n * Math.PI / 12 + h.index;
      const x = h.player.x + Math.cos(a) * (4 + Math.floor(n / 12) * 2);
      const z = h.player.z + Math.sin(a) * (4 + Math.floor(n / 12) * 2);
      if (Math.abs(x) > g.arena.halfSize - 4 || Math.abs(z) > g.arena.halfSize - 4 || g.walls.hitCircle(x, z, s.kind === 'heatwave' ? 2.5 : 0.8)) continue;
      let hazard = false;
      for (const zone of g.arena.hazards) if (zone.kind !== 'ice' && (zone.x - x) ** 2 + (zone.z - z) ** 2 < (zone.r + 2.5) ** 2) { hazard = true; break; }
      if (hazard) continue;
      s.props.push({ x, z, cooldown: 0, charges: 0 }); break;
    }
  }
}
/** A forced link still respects WEATHER EFFECTS; biome restrictions only govern random rolls. */
export function startWeather2(g: Game, kind: WeatherKind): void {
  if (!g.authority || !settings.weatherEffects || g.pvp || g.runMode === 'raid') return;
  g.runEvents.forceEvent(kind);
  updateWeather2.call(g, 0);
}
export function updateWeather2(this: Game, dt: number): void {
  if (!this.authority) return;
  const s = weather2Of(this), ev = this.runEvents.event;
  const kind = ev && isWeatherKind(ev.id) ? ev.id : null;
  if (!settings.weatherEffects || this.mode !== 'fight' || this.pvp || this.runMode === 'raid' || !kind) {
    if (s.kind) clear(s);
    if (!settings.weatherEffects && kind) this.runEvents.event = null;
    return;
  }
  if (s.kind !== kind) {
    clear(s); s.kind = kind; s.left = ev!.t;
    placeProps(this, s);
    if (kind === 'sandstorm') this.vfx.sound('wind_gust', NaN, NaN);
  }
  s.left = ev!.t; s.elapsed += dt;
  if (kind === 'sandstorm') {
    // Bounded alternating gusts: no accumulating one-way velocity, both bullet teams affected.
    const push = weatherGust(s.elapsed) * dt;
    for (let i = 0; i < this.bullets.count; i++) this.bullets.vx[i] += push * (this.bullets.team[i] === Team.Player ? 0.65 : 1);
    return;
  }
  for (const p of s.props) p.cooldown = Math.max(0, p.cooldown - dt);
  if (kind === 'lightning') { lightning(this, s, dt); return; }
  s.tick += dt;
  if (s.tick < T.tick) return;
  const step = s.tick; s.tick = 0;
  s.damageTick += step;
  for (const h of this.heroes) {
    if (h.left || h.player.dead) continue;
    const hs = heroExposure(s, h), p = h.player;
    hs.warm = Math.max(0, hs.warm - step);
    if (kind === 'blizzard') {
      for (const prop of s.props) if (prop.cooldown <= 0 && distance2(prop, p) < 1.1 ** 2) {
        hs.warm = T.warmthSeconds; prop.cooldown = 10;
        this.vfx.sound('powerUp', p.x, p.z);
      }
      hs.sheltered = hs.warm > 0 || nearFire(this, s, p.x, p.z);
      hs.chill = exposure(hs.chill, !hs.sheltered && p.speed < 0.7, step, T.chillSeconds, T.thawSeconds);
    } else {
      hs.sheltered = cooling(this, s, p.x, p.z);
      hs.heat = exposure(hs.heat, hotTile(p.x, p.z) && !hs.sheltered, step, T.heatSeconds, T.coolSeconds);
      if (hs.heat >= 1 && s.damageTick >= 1) this.hurtHero(h, T.heatDamage * this.director.dmgMul, p.x, p.z, null, 'Heat Wave');
    }
  }
  if (s.damageTick >= 1) s.damageTick %= 1;
  if (kind === 'blizzard') chillEnemies(this, s, step);
  else spreadFire(this, s, step);
}
function distance2(a: { x: number; z: number }, b: { x: number; z: number }): number { return (a.x - b.x) ** 2 + (a.z - b.z) ** 2; }
function nearFire(g: Game, s: Weather2State, x: number, z: number): boolean {
  const r2 = T.warmthRadius ** 2;
  for (const prop of s.props) if (prop.cooldown <= 0 && (x - prop.x) ** 2 + (z - prop.z) ** 2 < r2) return true;
  for (const h of g.heroes) {
    if (h.left || h.player.dead || (x - h.player.x) ** 2 + (z - h.player.z) ** 2 > r2) continue;
    if (s.heroes[h.index]?.warm > 0) return true;
    for (const w of h.weapons) if (w.tags.includes('fire') && (!w.def.slot || h.ctx.firing || h.ctx.charging)) return true;
  }
  for (const p of g.arena.hazards) if (p.kind === 'lava' && (x - p.x) ** 2 + (z - p.z) ** 2 < (p.r + 2) ** 2) return true;
  return false;
}
/** Cooling comes from explicit water pools, the pale start plaza and the shade beside solid cover. */
export function cooling(g: Game, s: Weather2State, x: number, z: number): boolean {
  if (x * x + z * z <= 25) return true;
  for (const p of s.props) if ((x - p.x) ** 2 + (z - p.z) ** 2 < 2.5 ** 2) return true;
  for (const b of g.arena.colliders) {
    if (b.gap) continue;
    if (x > b.minX - 1.8 && x < b.maxX + 1.8 && z > b.minZ - 1.8 && z < b.maxZ + 1.8) return true;
  }
  return false;
}
function chillEnemies(g: Game, s: Weather2State, dt: number): void {
  for (const e of g.enemies.list) {
    if (!e.targetable || bossLike(e) || e.pvpOwner >= 0 || e.def.behavior === 'reaper' || e.def.hidden) continue;
    let c = s.cold.get(e);
    if (!c || c.uid !== e.uid) { c = { uid: e.uid, value: 0, frozen: false, immune: 0 }; s.cold.set(e, c); }
    c.immune = Math.max(0, c.immune - dt);
    if (c.frozen) {
      if (e.frozen <= 0 || e.burnT > 0) { e.frozen = 0; e.shatter = 0; c.frozen = false; c.value = 0; c.immune = 3; }
      continue;
    }
    c.value = exposure(c.value, e.burnT <= 0 && c.immune === 0, dt, T.freezeSeconds, 1);
    if (c.value > 0) { e.slowAmt = Math.max(e.slowT > 0 ? e.slowAmt : 0, c.value * 0.65); e.slowT = Math.max(e.slowT, T.tick + 0.1); }
    if (c.value >= 1 && e.def.speed * e.speedMul * (1 - e.slowAmt) <= T.freezeSpeed) {
      e.frozen = T.freezeHold; e.shatter = Math.max(e.shatter, 0.75); c.frozen = true;
      g.vfx.ring(e.x, e.z, e.radius, 0.8, '#73eff7', 0.3);
    }
  }
}
/** The first direct hit breaks weather ice, even when the target survives. No recursive ice chains. */
export function weather2Hit(g: Game, e: Enemy, by: Hero): void {
  const s = states.get(g), c = s?.cold.get(e);
  if (!s || s.kind !== 'blizzard' || !c?.frozen || c.uid !== e.uid || e.frozen <= 0) return;
  c.frozen = false; c.value = 0; c.immune = 3; e.frozen = e.shatter = 0;
  g.shatter(e, by);
}
function spreadFire(g: Game, s: Weather2State, dt: number): void {
  s.spread += dt;
  if (s.spread < T.spreadEvery) return;
  s.spread = 0; s.spreadTargets.length = 0;
  // Budgeted and staged: newly ignited enemies never cascade in this same tick.
  let queried = 0;
  for (let scanned = 0; scanned < g.enemies.list.length && queried < 24; scanned++) {
    s.sourceCursor %= g.enemies.list.length;
    const e = g.enemies.list[s.sourceCursor++];
    if (!e.alive || e.burnT <= 0 || e.pvpOwner >= 0) continue;
    queried++;
    const by = g.heroes[e.burnOwner] ?? g.hero;
    for (const other of g.enemiesInRadius(e.x, e.z, T.spreadRadius, s.near)) {
      if (other.burnT > 0 || other.pvpOwner >= 0 || s.spreadTargets.includes(other)) continue;
      s.spreadTargets.push(other);
      // Remember source via existing status ownership without lighting it yet.
      other.burnOwner = by.index; other.burnDps = Math.max(other.burnDps, e.burnDps * 0.65);
      if (s.spreadTargets.length >= T.spreadMax) break;
    }
    if (s.spreadTargets.length >= T.spreadMax) break;
  }
  for (const e of s.spreadTargets) g.ignite(e, e.burnDps, g.heroes[e.burnOwner] ?? g.hero);
}
function lightning(g: Game, s: Weather2State, dt: number): void {
  const b = g.bullets;
  for (const p of s.props) {
    if (p.cooldown > 0) continue;
    for (const h of g.heroes) {
      if (h.left || h.player.dead || !h.ctx.firing) continue;
      for (const w of h.weapons) {
        if ((w.def.id !== 'laser' && w.def.id !== 'rail') || w.muzzleT <= 0) continue;
        const hero = h.player, range = w.p.range;
        if (segmentDistance2(p.x, p.z, hero.x, hero.z, hero.x + hero.aim.x * range, hero.z + hero.aim.z * range) > (0.6 + w.p.width) ** 2) continue;
        p.charges = T.rodCharges; p.cooldown = 0.5;
        g.vfx.sound('powerUp', p.x, p.z); g.vfx.ring(p.x, p.z, 0.6, 2.5, '#73eff7', 0.5);
        break;
      }
      if (p.cooldown > 0) break;
    }
    if (p.cooldown > 0) continue;
    for (let i = 0; i < b.count; i++) {
      if (b.team[i] !== Team.Player || segmentDistance2(p.x, p.z, b.x[i], b.z[i], b.x[i] + b.vx[i] * dt, b.z[i] + b.vz[i] * dt) > (0.6 + b.radius[i]) ** 2) continue;
      p.charges = T.rodCharges; p.cooldown = 0.5;
      b.kill(i);
      g.vfx.sound('powerUp', p.x, p.z); g.vfx.ring(p.x, p.z, 0.6, 2.5, '#73eff7', 0.5);
      break;
    }
  }
  for (let i = s.strikes.length - 1; i >= 0; i--) {
    const strike = s.strikes[i]; strike.left -= dt;
    if (strike.left <= 0 && !strike.hit) {
      strike.hit = true;
      for (const h of g.heroes) if (!h.left && !h.player.dead && distance2(strike, h.player) < (T.strikeRadius + h.player.radius * 0.6) ** 2)
        g.hurtHero(h, T.strikeDamage * g.director.dmgMul, strike.x, strike.z, null, 'Lightning Storm');
      for (const e of g.enemiesInRadius(strike.x, strike.z, T.strikeRadius, s.near)) if (e.pvpOwner < 0) g.envHit(e, 'weather2', T.strikeFoe * g.director.hpMul);
      g.vfx.sound('zap', strike.x, strike.z);
      g.vfx.ring(strike.x, strike.z, T.strikeRadius, 1, '#ffcd75', 0.3);
    }
    if (strike.left <= -0.2) s.strikes.splice(i, 1);
  }
  s.nextStrike -= dt;
  if (s.nextStrike > 0 || s.strikes.length >= 4) return;
  s.nextStrike = T.strikeEvery;
  let x = NaN, z = NaN;
  for (const p of s.props) {
    if (!p.charges) continue;
    let nearest: Enemy | null = null, best = T.rodRange ** 2;
    for (const e of g.enemies.list) {
      if (!e.targetable || e.def.hidden || e.pvpOwner >= 0) continue;
      const d = distance2(e, p);
      if (d < best) { best = d; nearest = e; }
    }
    if (nearest) { x = nearest.x; z = nearest.z; p.charges--; break; }
  }
  if (!Number.isFinite(x)) {
    const heroes = g.heroes;
    const offset = Math.floor(g.rng.next() * heroes.length);
    for (let i = 0; i < heroes.length; i++) {
      const h = heroes[(i + offset) % heroes.length]; if (h.left || h.player.dead) continue;
      for (let k = 0; k < 12; k++) {
        const a = g.rng.next() * Math.PI * 2, d = g.rng.range(1.5, 9);
        x = h.player.x + Math.cos(a) * d; z = h.player.z + Math.sin(a) * d;
        if (Math.abs(x) < g.arena.halfSize - 3 && Math.abs(z) < g.arena.halfSize - 3 && !g.walls.hitCircle(x, z, 0.3)) break;
        x = NaN;
      }
      break;
    }
  }
  if (!Number.isFinite(x)) return;
  s.strikes.push({ x, z, left: T.strikeWarning, hit: false });
  g.vfx.sound('threatMortar', x, z);
}
/** Client-owned movement uses host exposure, just like flood wading; dashes remain a reliable escape. */
export function weather2Local(g: Game): void {
  const s = states.get(g);
  if (!s?.kind || s.arena !== g.arena || s.kind !== 'blizzard') return;
  for (const h of g.heroes) {
    if (h !== g.hero && !g.localCoop) continue;
    const p = h.player, hs = s.heroes[h.index];
    if (!hs || p.dead || p.dashing || hs.chill <= 0) continue;
    const mul = 1 - hs.chill * T.heroSlow;
    p.pos.x = p.prev.x + (p.pos.x - p.prev.x) * mul;
    p.pos.z = p.prev.z + (p.pos.z - p.prev.z) * mul;
  }
}
export function weather2Net(g: Game): unknown {
  const s = weather2Of(g);
  if (!s.kind) return null;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { k: s.kind, l: r(s.left), e: r(s.elapsed),
    h: s.heroes.map((h) => h ? [r(h.chill), r(h.heat), r(h.warm), +h.sheltered] : null),
    p: s.props.map((p) => [r(p.x), r(p.z), r(p.cooldown), p.charges]),
    s: s.strikes.map((p) => [r(p.x), r(p.z), r(p.left), +p.hit]) };
}
export function applyWeather2Net(g: Game, value: unknown): void {
  const s = weather2Of(g);
  if (!value || typeof value !== 'object') { if (s.kind) clear(s); return; }
  const n = value as { k: string; l: number; e: number; h: (number[] | null)[]; p: number[][]; s: number[][] };
  if (!isWeatherKind(n.k)) return;
  if (s.kind !== n.k) clear(s);
  s.kind = n.k; s.left = n.l; s.elapsed = n.e;
  s.heroes = n.h.map((h) => h ? { chill: h[0], heat: h[1], warm: h[2], sheltered: !!h[3] } : { chill: 0, heat: 0, warm: 0, sheltered: false });
  s.props = n.p.map((p) => ({ x: p[0], z: p[1], cooldown: p[2], charges: p[3] }));
  s.strikes = n.s.map((p) => ({ x: p[0], z: p[1], left: p[2], hit: !!p[3] }));
}

const CSS = `#weather2 { padding: calc(3 * var(--p)); max-width: calc(95 * var(--p)); background: var(--night); color: var(--white); --hi: var(--slate); --lo: var(--ink); box-shadow: inset var(--p) var(--p) var(--hi), inset calc(-1 * var(--p)) calc(-1 * var(--p)) var(--lo), 0 0 0 var(--p) var(--ink); font: calc(7 * var(--p))/1.15 var(--font); white-space: pre-line; pointer-events: none; } #weather2::first-line { color: var(--yellow); font-family: var(--display); } [lang=ar] #weather2 { font-size: calc(5 * var(--p)); line-height: 1.65; }`;
function hud(g: Game, s: Weather2State, live: boolean): void {
  if (!s.hud && live) {
    const root = document.getElementById('goals'); if (!root) return;
    if (!document.getElementById('weather2-css')) { const style = document.createElement('style'); style.id = 'weather2-css'; style.textContent = CSS; document.head.append(style); }
    s.hud = document.createElement('div'); s.hud.id = 'weather2'; s.hud.setAttribute('role', 'status'); root.append(s.hud);
  }
  if (!s.hud) return;
  s.hud.hidden = !live;
  if (!live || !s.kind) return;
  const hs = s.heroes[g.hero.index];
  let detail = t(`weather2.${s.kind}.hint`);
  if (s.kind === 'blizzard') detail += '\n' + (hs?.sheltered ? t('weather2.warm') : t('weather2.chill', { value: Math.round((hs?.chill ?? 0) * 100) }));
  if (s.kind === 'heatwave') detail += '\n' + (hs?.sheltered ? t('weather2.cool') : t('weather2.heat', { value: Math.round((hs?.heat ?? 0) * 100) }));
  if (s.kind === 'lightning') { let n = 0; for (const p of s.props) n += p.charges; detail += '\n' + t('weather2.charges', { value: n }); }
  const text = `${localize(WEATHER_EVENTS[s.kind].name)}  ${Math.ceil(s.left)}\n${detail}`;
  if (text !== s.hudText) { s.hud.textContent = text; s.hudText = text; }
}

/** Fixed-capacity mesh pools, created once only after the first weather event. */
class WeatherView {
  group = new THREE.Group();
  private m = new THREE.Matrix4();
  private color = new THREE.Color();
  private rings: THREE.InstancedMesh;
  private objects: THREE.InstancedMesh;
  private flames: THREE.InstancedMesh;
  private pools: THREE.InstancedMesh;
  private tiles: THREE.InstancedMesh;
  private arena: unknown = null;
  private dynamic: THREE.InstancedMesh[];
  constructor(g: Game) {
    const ring = new THREE.RingGeometry(0.91, 1, 32); ring.rotateX(-Math.PI / 2);
    const pool = new THREE.CircleGeometry(1, 32); pool.rotateX(-Math.PI / 2);
    const tile = new THREE.PlaneGeometry(T.tile - 0.08, T.tile - 0.08); tile.rotateX(-Math.PI / 2);
    this.rings = this.mesh(ring, 40, true); this.objects = this.mesh(new THREE.BoxGeometry(1, 1, 1), 24, true);
    this.flames = this.mesh(new THREE.OctahedronGeometry(1), 24, true); this.pools = this.mesh(pool, 24, true);
    this.tiles = this.mesh(tile, 2048, false);
    this.dynamic = [this.rings, this.objects, this.flames, this.pools];
    g.scene.add(this.group);
  }
  private mesh(geometry: THREE.BufferGeometry, count: number, unlit: boolean): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, createRetroMaterial({ unlit: unlit ? 1 : 0 }), count);
    mesh.frustumCulled = false; mesh.count = 0; this.group.add(mesh); return mesh;
  }
  private put(mesh: THREE.InstancedMesh, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string): void {
    if (mesh.count >= mesh.instanceMatrix.count) return;
    const i = mesh.count++; this.m.makeScale(sx, sy, sz).setPosition(x, y, z); mesh.setMatrixAt(i, this.m);
    this.color.set(color); mesh.setColorAt(i, this.color);
  }
  render(g: Game, s: Weather2State): void {
    this.group.visible = true;
    this.rings.count = this.objects.count = this.flames.count = this.pools.count = 0;
    if (this.arena !== g.arena) {
      this.arena = g.arena; this.tiles.count = 0;
      for (let x = -g.arena.halfSize + T.tile; x < g.arena.halfSize - T.tile; x += T.tile) for (let z = -g.arena.halfSize + T.tile; z < g.arena.halfSize - T.tile; z += T.tile) {
        const cx = Math.floor(x / T.tile) * T.tile + T.tile / 2, cz = Math.floor(z / T.tile) * T.tile + T.tile / 2;
        if (!hotTile(cx, cz) || g.walls.hitCircle(cx, cz, 0.4)) continue;
        let lava = false;
        for (const h of g.arena.hazards) if (h.kind === 'lava' && (cx - h.x) ** 2 + (cz - h.z) ** 2 < (h.r + 1.5) ** 2) { lava = true; break; }
        if (!lava) this.put(this.tiles, cx, 0.045, cz, 1, 1, 1, '#333c57');
      }
      commit(this.tiles.instanceMatrix, this.tiles.count); if (this.tiles.instanceColor) commit(this.tiles.instanceColor, this.tiles.count);
    }
    this.tiles.visible = s.kind === 'heatwave';
    for (const p of s.props) {
      if (s.kind === 'heatwave') {
        this.put(this.pools, p.x, 0.07, p.z, 2.5, 1, 2.5, '#257179');
        this.put(this.rings, p.x, 0.08, p.z, 2.5, 1, 2.5, '#73eff7');
      } else if (s.kind === 'blizzard' && p.cooldown <= 0) {
        this.put(this.objects, p.x, 0.3, p.z, 0.8, 0.6, 0.8, '#566c86');
        this.put(this.flames, p.x, 1, p.z, 0.45, 0.8, 0.45, '#ffcd75');
        this.put(this.rings, p.x, 0.065, p.z, T.warmthRadius, 1, T.warmthRadius, '#ef7d57');
      } else if (s.kind === 'lightning') {
        this.put(this.objects, p.x, 1, p.z, 0.22, 2, 0.22, '#94b0c2');
        this.put(this.flames, p.x, 2.2, p.z, 0.45, 0.65, 0.45, p.charges ? '#73eff7' : '#ffcd75');
        this.put(this.rings, p.x, 0.06, p.z, 1, 1, 1, p.charges ? '#73eff7' : '#ffcd75');
      }
    }
    for (const strike of s.strikes) {
      const r = T.strikeRadius;
      if (!strike.hit) {
        this.put(this.rings, strike.x, 0.09, strike.z, r, 1, r, '#ff0044');
        const k = Math.max(0.08, strike.left / T.strikeWarning);
        this.put(this.rings, strike.x, 0.095, strike.z, r * k, 1, r * k, '#ffcd75');
        this.put(this.objects, strike.x, 0.08, strike.z, 1, 0.04, 0.18, '#ffcd75');
        this.put(this.objects, strike.x, 0.08, strike.z, 0.18, 0.04, 1, '#ffcd75');
      } else this.put(this.objects, strike.x, 6, strike.z, access.reduceFlash ? 0.12 : 0.3, 12, access.reduceFlash ? 0.12 : 0.3, '#ffcd75');
    }
    if (s.kind === 'blizzard') for (const h of g.heroes) if (s.heroes[h.index]?.warm > 0 && !h.player.dead) {
      this.put(this.rings, h.player.x, 0.08, h.player.z, T.warmthRadius, 1, T.warmthRadius, '#ef7d57');
      this.put(this.flames, h.player.x, 2.4, h.player.z, 0.18, 0.3, 0.18, '#ffcd75');
    }
    for (const mesh of this.dynamic) {
      commit(mesh.instanceMatrix, mesh.count); if (mesh.instanceColor) commit(mesh.instanceColor, mesh.count);
    }
  }
}
/** Body culling also removes the otherwise visible blob shadows outside the sand veil. */
export function weather2Visible(g: Game, x: number, z: number): boolean {
  const s = states.get(g);
  if (!s || s.arena !== g.arena || s.kind !== 'sandstorm' || g.mode === 'title') return true;
  for (const h of g.heroes) if (!h.left && !h.player.dead && (x - h.player.x) ** 2 + (z - h.player.z) ** 2 <= T.silhouette ** 2) return true;
  return false;
}
export function prepareWeather2(g: Game): void {
  const s = weather2Of(g);
  g.enemies.bodyVisible = s.kind === 'sandstorm' ? s.visible : null;
}
export function renderWeather2(g: Game): void {
  const s = weather2Of(g);
  const live = !!s.kind && s.arena === g.arena && (g.mode === 'fight' || g.mode === 'levelup');
  const p = g.hero.player;
  retroGlobals.uWeatherSight.value.set(p.x, p.z, T.sight, live && s.kind === 'sandstorm' ? T.silhouette : 0);
  let visibleHeroes = 0;
  if (live && s.kind === 'sandstorm') for (const h of g.heroes) {
    if (h.left || h.player.dead || visibleHeroes >= 8) continue;
    retroGlobals.uWeatherHeroes.value[visibleHeroes++].set(h.player.x, h.player.z);
  }
  retroGlobals.uWeatherHeroCount.value = visibleHeroes;
  hud(g, s, live);
  if (!live) { if (s.view) s.view.group.visible = false; return; }
  if (!s.view) s.view = new WeatherView(g);
  s.view.render(g, s);
  if (s.kind === 'heatwave' && postfx.distortion && renderQuality.distortion && settings.weather && !settings.reduceScreenEffects && !access.reduceFlash && postfx.heatCount < MAX_HEAT) {
    const i = postfx.heatCount++ * 4;
    postfx.heat[i] = 0.5; postfx.heat[i + 1] = 0.5; postfx.heat[i + 2] = 0.75; postfx.heat[i + 3] = 0.35;
  }
}
export function weather2Links(g: Game, q: URLSearchParams): void {
  if (q.has('weatheroff')) settings.weatherEffects = false;
  const kind = q.get('weather') ?? '';
  if (isWeatherKind(kind)) startWeather2(g, kind);
}
