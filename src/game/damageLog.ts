// Host-side hit history. Only a personal down sends a packet, never a combat snapshot.
import { ENEMIES, type EnemyDef } from '../data/enemies';
import type { Game } from './game';
import type { Hero } from './hero';
import type { Enemy } from './enemies';
import type { Timeline } from './timeline';
import { timeTuning } from './timeRules';
import { t } from '../i18n';

export type Attack = 'contact' | 'attack' | 'bullet' | 'shockwave' | 'volatile' | 'hazard';
export interface Hit {
  at: number;
  source: string; // Catalog ID; display names are resolved in the recipient's language.
  attack: Attack;
  amount: number; // After mitigation, before clamping remaining life to zero.
  before: number;
  after: number;
  warned: boolean;
  dash: boolean;
}

export class DamageLog {
  private slots: Hit[] = [];
  private next = 0;
  push(hit: Hit): void {
    this.slots[this.next] = hit;
    this.next = (this.next + 1) % 20;
  }
  get latest(): Hit | undefined { return this.slots[(this.next + 19) % 20]; }
  hits(): Hit[] {
    return this.slots.slice(this.next).concat(this.slots.slice(0, this.next));
  }
  clear(): void {
    this.slots.length = 0;
    this.next = 0;
  }
}

export function recapHits(hits: readonly Hit[]) {
  const fatal = hits.at(-1);
  if (!fatal || fatal.after !== 0) return;
  const timeline = hits.filter(h => h.at >= fatal.at - 10 && h.at <= fatal.at);
  // Rank actual life lost: overkill on a nearly empty bar should not eclipse the earlier hit.
  let breaking = fatal;
  for (const h of timeline) {
    if (h.at >= fatal.at - 5 && h.before - h.after > breaking.before - breaking.after) breaking = h;
  }
  return { fatal, breaking, timeline };
}

const byName = new Map(Object.values(ENEMIES).map(d => [d.name, d]));
// name, warning before impact, lesson, optional enemy portrait.
export const hazards: Record<string, readonly [string, boolean, string, string?]> = {
  lava: ['Lava', false, 'fire'], burning_ground: ['Burning ground', false, 'fire'],
  heat_wave: ['Heat Wave', true, 'heat'], lightning_storm: ['Lightning Storm', true, 'zone'],
  lightning: ['Lightning', true, 'zone'], crusher: ['Crusher', true, 'zone'],
  ground_strike: ['Ground strike', true, 'zone'], meteor: ['Meteor', true, 'zone'],
  meteor_garden: ['Meteor Garden', true, 'zone'], cinder_receipt: ['Cinder Receipt', true, 'zone'],
  explosive_deaths: ['Explosive deaths', true, 'zone'], lava_bomb: ['Lava Bomb', true, 'zone'],
  void: ['The Void', true, 'floor'], chasm: ['The Chasm', true, 'floor'],
  colossus: ['The Colossus', true, 'zone'], overlord: ['The Overlord', true, 'zone'],
  titan_arm: ["The Titan's arm", true, 'titan', 'titan'], titan_eye: ["The Titan's eye beam", true, 'beam', 'titan'],
  laser_grid: ["Glitch DJ's laser grid", true, 'grid', 'glitch'], punch: ["Boxer Jack's punch", true, 'line', 'boxer'],
  tentacle: ['Kraken tentacle', true, 'zone', 'kraken'], mirror_plasma: ['Mirror plasma', true, 'shot', 'mirror'],
  ring: ['The ring', false, 'ring'], ring_of_fire: ['The ring of fire', false, 'ring'],
  thorns: ['Thorns', false, 'thorns'], enemy_fire: ['Enemy fire', false, 'shot'],
  opponent: ['Opponent', false, 'shot'], unknown: ['Unknown', false, 'space'],
};
const hazardByName = new Map(Object.entries(hazards).map(([id, row]) => [row[0], id]));

const logs = new WeakMap<Hero, DamageLog>();
const packets = new WeakMap<Hero, DeathPacket>();
export function resetDamageLog(h: Hero): void { logs.delete(h); packets.delete(h); }
export function forgetRewoundDamage(h: Hero, since: number): void {
  const log = logs.get(h);
  if (!log?.latest || log.latest.at <= since) return;
  const kept = log.hits().filter(hit => hit.at <= since);
  log.clear();
  for (const hit of kept) log.push(hit);
  packets.delete(h);
}

/** A late remote parry refunded this exact hit on the host. */
export function refundBulletHit(h: Hero, at: number): void {
  const log = logs.get(h);
  if (!log) return;
  const hits = log.hits();
  const i = hits.findIndex(hit => hit.attack === 'bullet' && hit.at === at);
  if (i < 0) return;
  hits.splice(i, 1);
  log.clear();
  for (const hit of hits) log.push(hit);
}

const shots = new WeakMap<Game, { uid: Uint32Array; def: (EnemyDef | undefined)[]; warned: Uint8Array }>();
export function rememberShot(g: Game, slot: number, e: Enemy): void {
  if (slot >= g.bullets.count) return;
  let s = shots.get(g);
  if (!s) shots.set(g, s = { uid: new Uint32Array(8192), def: [], warned: new Uint8Array(8192) });
  const uid = g.bullets.uid[slot], i = uid % s.uid.length;
  s.uid[i] = uid; s.def[i] = e.def;
  s.warned[i] = Number(e.state === 'windup' || (e.state === 'attack' && (e.def.shoot || e.def.boss || e.def.miniboss)));
}

// Carry the exact bullet slot through existing hurtHero observers without passing the shooter
// as a melee attacker (which would trigger thorns and vampiric contact effects).
const impacts = new WeakMap<Game, number>();
export function hurtFromBullet(g: Game, h: Hero, i: number): void {
  const b = g.bullets;
  impacts.set(g, i);
  try { g.hurtHero(h, b.damage[i], b.px[i], b.pz[i], null, 'Enemy fire'); }
  finally { impacts.delete(g); }
}

export function recordHit(g: Game, h: Hero, before: number, amount: number, src: Enemy | null, cause: string): void {
  if (!g.authority) return;
  let def = src?.def ?? byName.get(cause);
  let source = def?.id ?? hazardByName.get(cause) ?? 'unknown';
  let attack: Attack = src && !cause ? 'contact' : def ? 'attack' : 'hazard';
  let warned = src ? (cause !== '' || (src.state === 'attack' && !!(def?.charge || def?.lunge || def?.dive || src.action === 'charge'))) :
    def ? (def.behavior !== 'slug') : hazards[source][1];
  if (!def && cause.endsWith("'s shockwave")) {
    def = byName.get(cause.slice(0, -"'s shockwave".length));
    if (def) { source = def.id; attack = 'shockwave'; warned = true; }
  } else if (cause.startsWith('Volatile ')) {
    def = byName.get(cause.slice(9));
    if (def) { source = def.id; attack = 'volatile'; warned = true; }
  } else if (g.runMode === 'raid' && cause === t('raid.title')) {
    source = 'hydra'; attack = 'attack'; warned = true;
  } else if (source === 'unknown' && g.pvp) source = 'opponent';
  if (cause === 'Enemy fire' || cause === 'Mirror plasma') {
    attack = 'bullet';
    const slot = impacts.get(g), s = shots.get(g);
    if (slot !== undefined && s) {
      const uid = g.bullets.uid[slot], n = uid % s.uid.length;
      if (uid === s.uid[n] && s.def[n]) { source = s.def[n]!.id; warned = !!s.warned[n]; }
    }
  }
  let log = logs.get(h);
  if (!log) logs.set(h, log = new DamageLog());
  log.push({ at: g.runTime, source, attack, before, after: h.player.hp, amount, warned,
    dash: !h.player.noDash && h.player.dashStock >= 1 && !h.player.dashing });
}

// Death-only projection from the time lane's actual history. Each frame is a small,
// hero-centred pixel map. The camera's world offset keeps its grid stable across frames.
export interface MapFrame { ms: number; x: number; z: number; hp: number; dots: string }
export interface DeathPacket { seat: number; hits: Hit[]; frames: MapFrame[] }
export const mapWidth = 160, mapHeight = 88;
const scale = 4;
function mapFrame(t: number, x: number, z: number, hp: number, start: number,
  visit: (dot: (kind: number, x: number, z: number, size: number) => void) => void): MapFrame {
  const points: number[][] = [[], [], []];
  const dot = (kind: number, wx: number, wz: number, size: number) => {
    const dx = Math.round((wx - x) * scale), dz = Math.round((wz - z) * scale);
    if (Math.abs(dx) >= mapWidth / 2 || Math.abs(dz) >= mapHeight / 2) return;
    // Nearest first within each category. A crowded room cannot hide nearby shots or warnings.
    points[kind].push((dx + mapWidth / 2) | ((dz + mapHeight / 2) << 8) | (Math.min(31, Math.max(1, Math.round(size * scale))) << 16));
  };
  visit(dot);
  const dist = (p: number) => ((p & 255) - mapWidth / 2) ** 2 + (((p >> 8) & 255) - mapHeight / 2) ** 2;
  let bytes = '';
  for (let kind = 0; kind < 3; kind++) {
    points[kind].sort((a, b) => dist(a) - dist(b));
    for (const p of points[kind].slice(0, kind === 2 ? 4 : 12)) {
      bytes += String.fromCharCode(p & 255, (p >> 8) & 255, (kind << 5) | (p >> 16));
    }
  }
  return { ms: Math.max(0, Math.round((t - start) * 1000)), x: Math.round(x * scale), z: Math.round(z * scale),
    hp: Math.ceil(hp), dots: btoa(bytes) };
}

export function captureDeath(g: Game, h: Hero, tl: Timeline): void {
  if (!g.authority || !h.player.dead) return;
  const hits = logs.get(h)?.hits() ?? [];
  if (!recapHits(hits)) return; // E.g. a disconnect or a test that directly sets the dead flag.
  const end = g.runTime, cutoff = end - 5;
  const frames: MapFrame[] = [];
  let start = end;
  // Use the previous 10 Hz sample at the exact five-second boundary (sample-and-hold).
  let first = 0;
  while (first + 1 < tl.count && tl.at(first + 1).t <= cutoff) first++;
  for (let i = first; i < tl.count; i++) {
    const f = tl.at(i);
    if (f.t < cutoff - 1 / timeTuning.recordHz - 1e-5 || f.t >= end || h.index >= f.heroN) continue;
    if (!frames.length) start = Math.max(cutoff, f.t);
    if (frames.length && f.t - start < (frames.at(-1)!.ms + 190) / 1000) continue;
    frames.push(mapFrame(f.t, f.heroX(h.index), f.heroZ(h.index), f.heroHp(h.index), start, dot => f.visitThreats(dot)));
  }
  frames.push(mapFrame(end, h.player.x, h.player.z, h.player.hp, start, dot => {
    for (const e of g.enemies.list) if (e.active && e.pvpOwner < 0) dot(0, e.x, e.z, e.radius);
    for (let i = 0; i < g.bullets.count; i++) if (g.bullets.team[i] === 1) dot(1, g.bullets.x[i], g.bullets.z[i], g.bullets.radius[i]);
    for (const s of g.strikes) if (s.dmg > 0) dot(2, s.x, s.z, s.r);
  }));
  const packet = { seat: h.index, hits, frames };
  packets.set(h, packet);
}

const sent = new WeakMap<DeathPacket, string>();
export function confirmDeath(g: Game, h: Hero): void {
  const packet = packets.get(h);
  if (g.role !== 'host' || !h.peerId || !packet || sent.get(packet) === h.peerId) return;
  sent.set(packet, h.peerId);
  g.tell(h, { t: 'deathRecap', packet });
}
/** A reconnected client has a fresh peer id and a fresh Hero. Recover its earlier down in its private result message. */
export function deathForReconnect(h: Hero): DeathPacket | undefined {
  const packet = packets.get(h);
  return h.player.dead && packet && sent.get(packet) !== h.peerId ? packet : undefined;
}
export function receiveDeath(h: Hero, packet: DeathPacket): void {
  if (packet?.seat !== h.index || !Array.isArray(packet.hits) || packet.hits.length > 20
    || !Array.isArray(packet.frames) || packet.frames.length > 28) return;
  if (!packet.hits.every(hit => hit && typeof hit.source === 'string' && (Object.hasOwn(ENEMIES, hit.source) || Object.hasOwn(hazards, hit.source))
    && typeof hit.dash === 'boolean' && typeof hit.warned === 'boolean'
    && ['attack', 'bullet', 'contact', 'shockwave', 'volatile', 'hazard'].includes(hit.attack)
    && [hit.at, hit.amount, hit.before, hit.after].every(n => Number.isFinite(n) && n >= 0))) return;
  if (!packet.frames.every((f, i) => f && [f.ms, f.hp, f.x, f.z].every(Number.isFinite)
    && f.ms >= 0 && f.ms <= 5001 && (i ? f.ms >= packet.frames[i - 1].ms : f.ms === 0)
    && typeof f.dots === 'string' && f.dots.length <= 112 && /^(?:[A-Za-z0-9+/]{4})*$/.test(f.dots))) return;
  if (recapHits(packet.hits)) packets.set(h, packet);
}
export function personalDeaths(g: Game, down: boolean): DeathPacket[] {
  if (!down) return [];
  const heroes = g.localCoop && !g.squadRun ? g.heroes : [g.hero];
  return heroes.flatMap(h => {
    const packet = packets.get(h);
    return packet && (g.role === 'client' || h.player.dead) ? [packet] : [];
  });
}
function telemetrySource(hit: Hit): string {
  if (hit.attack === 'shockwave') return hit.source + '_shockwave';
  if (hit.attack === 'volatile') return 'volatile_' + hit.source;
  return hit.source;
}
export function telemetryDeath(h: Hero) {
  const data = recapHits(packets.get(h)?.hits ?? logs.get(h)?.hits() ?? []);
  if (!data) return {};
  const { fatal, breaking } = data;
  return {
    deathCause: [telemetrySource(fatal), fatal.attack] as [string, Attack],
    breaking: [telemetrySource(breaking), breaking.amount, breaking.before, Math.round((fatal.at - breaking.at) * 10) / 10] as [string, number, number, number],
  };
}
