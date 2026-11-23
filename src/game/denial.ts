import * as THREE from 'three';
import type { Game } from './game';
import type { Enemy } from './enemies';
import { ThreatGlyphs } from './enemyBulletView';
import { Zone, zoneFor, zoneTuning as T, type ZoneKind } from '../data/patterns';

export interface DenialZone {
  kind: ZoneKind;
  x: number;
  z: number;
  yaw: number;
  age: number;
  damage: number;
  cause: string;
  hit: number;
  nextTick: number;
}
export type DenialNet = [ZoneKind, number, number, number, number][];
const TAU = Math.PI * 2;
const SIZE = 15;
export function zoneRadius(k: ZoneKind, progress: number): number {
  return k === Zone.Ring ? T.ringR * (1 - 0.8 * progress) : k === Zone.Mine ? T.mineR : T.poolR;
}

/** Signed clearance from the damaging footprint in metres. Negative is inside. */
export function zoneClearance(q: DenialZone, x: number, z: number, age: number): number {
  const dx = x - q.x,
    dz = z - q.z;
  const u = Math.cos(q.yaw) * dx - Math.sin(q.yaw) * dz,
    v = Math.sin(q.yaw) * dx + Math.cos(q.yaw) * dz;
  const progress = Math.max(0, Math.min(1, (age - T.tell[q.kind]) / T.duration[q.kind]));
  if (q.kind === Zone.Wall) {
    const along = v - T.sweep * (progress * 2 - 1);
    return Math.max(T.gapHalf - Math.abs(u), Math.abs(u) - T.wallHalf, Math.abs(along) - T.band);
  }
  const r = Math.hypot(dx, dz),
    radius = zoneRadius(q.kind, progress);
  if (q.kind === Zone.Ring) {
    // A 60-degree opening along local +Z. Signed distance to its two edges.
    return Math.max(Math.abs(r - radius) - T.band, v * 0.5 - Math.abs(u) * Math.sqrt(0.75));
  }
  return r - radius;
}

const zoneGlyph = `
void main() {
  vec2 p = (vUvP-0.5)*${SIZE.toFixed(1)};
  float k = glyphData.x, progress = max(0.0,glyphData.y);
  bool tell = glyphData.y < 0.0;
  float r = length(p), a = atan(p.x,p.y);
  float d, detail = 0.0;
  if (k < 2.5) {
    float radius = k < 1.5 ? ${T.poolR.toFixed(2)} : ${T.mineR};
    d = r-radius;
    if (k < 1.5) detail = step(abs(r-radius*0.56),0.065);
    else {
      // Four cross arms and a clockwise fuse that burns down to the hub.
      detail = max(step(max(min(abs(p.x),abs(p.y))-0.13,r-0.66),0.0),
        step(abs(r-0.91),0.13)*step(fract(1.0+a/6.2831853),-glyphData.y));
    }
  } else if (k < 3.5) {
    float along = p.y-${T.sweep.toFixed(1)}*(2.0*progress-1.0);
    d = max(max(${T.gapHalf}-abs(p.x),abs(p.x)-${T.wallHalf}),abs(along)-${T.band});
    if (tell && abs(p.y)<${T.sweep.toFixed(1)} && abs(abs(p.x)-${T.gapHalf})<0.07) detail=1.0;
  } else {
    d = max(abs(r-${T.ringR}*(1.0-0.8*progress))-${T.band},0.5*p.y-0.8660254*abs(p.x));
  }
  bool edge = abs(d) < 0.09;
  if (tell && k < 2.5 && cos(a*14.0)<-0.25) edge=false;
  if (detail>0.5 || edge) outColor = vec4(tell ? vec3(1.0,0.81,0.84) : uColor,1.0);
  else if (abs(d)<0.17) outColor=vec4(0.102,0.110,0.173,0.95);
  else if (d<0.0) outColor=vec4(uColor,tell ? 0.10 : (k<2.5 ? 0.25 : 0.87));
  else discard;
}`;

/** Two scene-local slots. BossField carries their state through the same snapshots as shockwaves. */
export class Denial {
  readonly slots: DenialZone[] = Array.from({ length: T.cap }, () => ({
    kind: Zone.Pool,
    x: 0,
    z: 0,
    yaw: 0,
    age: -1,
    damage: 0,
    cause: '',
    hit: 0,
    nextTick: 0,
  }));
  private glyphs: ThreatGlyphs;
  private matrix = new THREE.Matrix4();
  private cooldown = 0;
  private scale = new THREE.Vector3(SIZE, 1, SIZE);

  constructor(scene: THREE.Scene) {
    this.glyphs = new ThreatGlyphs(scene, T.cap, 102, zoneGlyph);
  }
  clear(): void {
    for (const q of this.slots) q.age = -1;
    this.cooldown = 0;
    this.glyphs.begin(false);
  }
  place(kind: ZoneKind, x: number, z: number, yaw: number, damage: number, cause: string): boolean {
    for (const q of this.slots) {
      if (q.age >= 0) continue;
      q.kind = kind;
      q.x = x;
      q.z = z;
      q.yaw = yaw;
      q.age = q.hit = 0;
      q.damage = damage;
      q.cause = cause;
      q.nextTick = T.tell[kind];
      return true;
    }
    return false;
  }
  windup(g: Game, e: Enemy): void {
    if (!g.authority || this.cooldown > 0 || g.mode !== 'fight' || !(e.elite || e.def.miniboss))
      return;
    const kind = zoneFor(g.stage);
    if (!kind) return;
    let target,
      best = 14 * 14;
    for (const h of g.heroes) {
      const d = (h.player.x - e.x) ** 2 + (h.player.z - e.z) ** 2;
      if (!h.left && !h.player.dead && d < best) {
        target = h.player;
        best = d;
      }
    }
    if (!target) return;
    // Pick an open escape from the actual target (including gaps/cover). Skip boxed-in targets.
    const bearing = Math.atan2(e.x - target.x, e.z - target.z);
    for (let i = 0; i < 8; i++) {
      const yaw = bearing + (i * TAU) / 8,
        dx = Math.sin(yaw),
        dz = Math.cos(yaw);
      if (
        !g.walls.segmentClear(
          target.x,
          target.z,
          target.x + dx * 3.4,
          target.z + dz * 3.4,
          target.radius,
        )
      )
        continue;
      const x = target.x + (kind === Zone.Wall ? dx * 2.6 : 0);
      const z = target.z + (kind === Zone.Wall ? dz * 2.6 : 0);
      if (
        this.place(
          kind,
          x,
          z,
          kind === Zone.Wall ? yaw - Math.PI / 2 : yaw,
          8 * e.dmgMul,
          e.def.name,
        )
      ) {
        this.cooldown = T.interval;
        g.vfx.sound('threatMortar', x, z);
      }
      return;
    }
  }
  advance(dt: number, g?: Game): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (const q of this.slots) {
      if (q.age < 0) continue;
      q.age += dt;
      if (q.age >= T.tell[q.kind] + T.duration[q.kind]) {
        q.age = -1;
        continue;
      }
      if (!g || q.age < q.nextTick) continue;
      for (const h of g.heroes) {
        if (h.left || h.player.dead || h.player.invuln > 0 || q.hit & (1 << h.index)) continue;
        if (zoneClearance(q, h.player.x, h.player.z, q.age) >= h.player.radius * 0.65) continue;
        g.hurtHero(h, q.damage, q.x, q.z, null, q.cause);
        if (q.kind !== Zone.Pool) q.hit |= 1 << h.index;
      }
      if (q.kind === Zone.Pool) q.nextTick = q.age + 0.8;
    }
  }
  pack(): DenialNet | undefined {
    let rows: DenialNet | undefined;
    for (const q of this.slots)
      if (q.age >= 0) (rows ??= []).push([q.kind, q.x, q.z, q.yaw, Math.round(q.age * 100) / 100]);
    return rows;
  }
  unpack(rows?: DenialNet): void {
    this.clear();
    if (!rows) return;
    for (let i = 0; i < Math.min(rows.length, this.slots.length); i++) {
      const [k, x, z, yaw, age] = rows[i];
      if (!(k >= Zone.Pool && k <= Zone.Ring) || !Number.isFinite(age)) continue;
      const q = this.slots[i];
      q.kind = k;
      q.x = x;
      q.z = z;
      q.yaw = yaw;
      q.age = age;
      q.damage = 0;
    }
  }
  render(highContrast: boolean): void {
    this.glyphs.begin(highContrast);
    for (const q of this.slots) {
      if (q.age < 0) continue;
      this.matrix.makeRotationY(q.yaw);
      this.matrix.scale(this.scale);
      this.matrix.setPosition(q.x, 0.16, q.z);
      const t = q.age - T.tell[q.kind];
      this.glyphs.add(this.matrix, q.kind, t / (t < 0 ? T.tell[q.kind] : T.duration[q.kind]));
    }
    this.glyphs.end();
  }
}
