import { ENEMIES, type EnemyDef } from '../data/enemies';
import type { Bullets } from '../game/bullets';
import { ELITE_MOD_IDS, type EliteModId } from '../data/eliteMods';
import { BOSS_ACTIONS, type BossAction, type Enemy, type EnemyState } from '../game/enemies';
import type { Pickups } from '../game/pickups';

/**
 * Compact binary records for the per-client world snapshot. Positions are
 * fixed-point (centimetres in an Int16), angles fit in an Int8.
 */
const DEF_IDS = Object.keys(ENEMIES);
const DEF_INDEX = new Map(DEF_IDS.map((id, i) => [id, i]));
const STATES: EnemyState[] = ['spawning', 'move', 'windup', 'attack', 'recover'];
const STATE_INDEX = new Map(STATES.map((s, i) => [s, i]));

const ENEMY_BYTES = 22;
const BULLET_BYTES = 14;
const PICKUP_BYTES = 8;

const q16 = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * 100)));
const qAng = (a: number) => Math.round((Math.atan2(Math.sin(a), Math.cos(a)) / Math.PI) * 127);
const dqAng = (v: number) => (v / 127) * Math.PI;

export function defById(i: number): EnemyDef | undefined {
  return ENEMIES[DEF_IDS[i]];
}

// ---------------------------------------------------------------- enemies

export function packEnemies(list: Enemy[]): ArrayBuffer {
  const buf = new ArrayBuffer(list.length * ENEMY_BYTES);
  const v = new DataView(buf);
  let o = 0;
  for (const e of list) {
    v.setUint32(o, e.uid, true);
    v.setUint8(o + 4, DEF_INDEX.get(e.def.id) ?? 0);
    v.setUint8(o + 5, STATE_INDEX.get(e.state) ?? 1);
    // Bits 5-7: the boss action.
    const flags = (e.elite ? 1 : 0) | (e.frozen > 0 ? 2 : 0) | (e.burnT > 0 ? 4 : 0) | (e.shockT > 0 ? 8 : 0) | (e.flash > 0 ? 16 : 0) | (Math.max(0, BOSS_ACTIONS.indexOf(e.action)) << 5);
    v.setUint8(o + 6, flags);
    v.setUint8(o + 7, Math.max(0, Math.min(255, Math.round(e.t * 50))));
    v.setInt16(o + 8, q16(e.x), true);
    v.setInt16(o + 10, q16(e.z), true);
    v.setInt8(o + 12, qAng(e.facing));
    v.setInt8(o + 13, Math.max(-127, Math.min(127, Math.round(e.sq * 100))));
    v.setUint8(o + 14, Math.max(0, Math.min(255, Math.round(e.hopY * 40))));
    v.setInt8(o + 15, qAng(Math.atan2(e.lungeX, e.lungeZ)));
    v.setInt16(o + 16, q16(e.targetX), true);
    v.setInt16(o + 18, q16(e.targetZ), true);
    // Elite modifier (index + 1, 0 = none) and shield-up flag (bit 7).
    v.setUint8(o + 20, (e.mod ? ELITE_MOD_IDS.indexOf(e.mod.id) + 1 : 0) | (e.shield > 0 ? 0x80 : 0));
    o += ENEMY_BYTES;
  }
  return buf;
}

export interface EnemyRecord {
  uid: number;
  def: EnemyDef;
  state: EnemyState;
  elite: boolean;
  /** Elite modifier, if any. */
  eliteMod: EliteModId | null;
  /** Shielded elite with its shield still up. */
  shield: boolean;
  frozen: boolean;
  burn: boolean;
  shock: boolean;
  flash: boolean;
  /** Boss attack (drives client-side telegraphs). */
  action: BossAction;
  t: number;
  x: number;
  z: number;
  facing: number;
  sq: number;
  hopY: number;
  lunge: number;
  targetX: number;
  targetZ: number;
}

export function unpackEnemies(buf: ArrayBuffer, each: (r: EnemyRecord) => void): void {
  const v = new DataView(buf);
  const r = {} as EnemyRecord;
  for (let o = 0; o + ENEMY_BYTES <= buf.byteLength; o += ENEMY_BYTES) {
    const def = defById(v.getUint8(o + 4));
    if (!def) continue;
    const flags = v.getUint8(o + 6);
    r.uid = v.getUint32(o, true);
    r.def = def;
    r.state = STATES[v.getUint8(o + 5)] ?? 'move';
    r.elite = !!(flags & 1);
    r.frozen = !!(flags & 2);
    r.burn = !!(flags & 4);
    r.shock = !!(flags & 8);
    r.flash = !!(flags & 16);
    const em = v.getUint8(o + 20);
    r.eliteMod = r.elite ? (ELITE_MOD_IDS[(em & 0x7f) - 1] ?? null) : null;
    r.shield = r.elite && !!(em & 0x80);
    r.action = BOSS_ACTIONS[flags >> 5] ?? 'ring';
    r.t = v.getUint8(o + 7) / 50;
    r.x = v.getInt16(o + 8, true) / 100;
    r.z = v.getInt16(o + 10, true) / 100;
    r.facing = dqAng(v.getInt8(o + 12));
    r.sq = v.getInt8(o + 13) / 100;
    r.hopY = v.getUint8(o + 14) / 40;
    r.lunge = dqAng(v.getInt8(o + 15));
    r.targetX = v.getInt16(o + 16, true) / 100;
    r.targetZ = v.getInt16(o + 18, true) / 100;
    each(r);
  }
}

// ---------------------------------------------------------------- bullets

const BULLET_COLORS = ['#fff36b', '#ff7a2f', '#ff3df0'];

export function packBullets(b: Bullets, idx: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(idx.length * BULLET_BYTES);
  const v = new DataView(buf);
  let o = 0;
  for (const i of idx) {
    v.setInt16(o, q16(b.x[i]), true);
    v.setInt16(o + 2, q16(b.z[i]), true);
    v.setInt16(o + 4, Math.round(b.vx[i] * 10), true);
    v.setInt16(o + 6, Math.round(b.vz[i] * 10), true);
    v.setUint8(o + 8, Math.min(255, Math.round(b.width[i] * 100)));
    v.setUint8(o + 9, Math.min(255, Math.round(b.length[i] * 50)));
    const c = BULLET_COLORS.indexOf(b.colorOf(i));
    v.setUint8(o + 10, c < 0 ? 0 : c);
    v.setUint8(o + 11, b.team[i]);
    v.setUint16(o + 12, Math.min(65535, Math.round(Math.max(0, b.life[i]) * 1000)), true);
    o += BULLET_BYTES;
  }
  return buf;
}

/** Client: replace all bullets with the snapshot (they then fly on locally until the next one). */
export function unpackBullets(buf: ArrayBuffer, b: Bullets): void {
  const v = new DataView(buf);
  b.clear();
  for (let o = 0; o + BULLET_BYTES <= buf.byteLength; o += BULLET_BYTES) {
    const vx = v.getInt16(o + 4, true) / 10;
    const vz = v.getInt16(o + 6, true) / 10;
    const sp = Math.hypot(vx, vz) || 1;
    b.spawn({
      x: v.getInt16(o, true) / 100,
      z: v.getInt16(o + 2, true) / 100,
      dirX: vx / sp,
      dirZ: vz / sp,
      speed: sp,
      life: v.getUint16(o + 12, true) / 1000,
      radius: 0.2,
      damage: 0,
      knockback: 0,
      team: v.getUint8(o + 11) === 1 ? 1 : 0,
      color: BULLET_COLORS[v.getUint8(o + 10)] ?? BULLET_COLORS[0],
      width: v.getUint8(o + 8) / 100,
      length: v.getUint8(o + 9) / 50,
    });
    // Already in flight: skip the spawn pop-in.
    b.age[b.count - 1] = 1;
  }
}

// ---------------------------------------------------------------- pickups

export function packPickups(p: Pickups, idx: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(idx.length * PICKUP_BYTES);
  const v = new DataView(buf);
  let o = 0;
  for (const i of idx) {
    v.setUint8(o, p.type[i]);
    v.setUint8(o + 1, 0);
    v.setUint16(o + 2, Math.min(65535, Math.round(p.value[i])), true);
    v.setInt16(o + 4, q16(p.x[i]), true);
    v.setInt16(o + 6, q16(p.z[i]), true);
    o += PICKUP_BYTES;
  }
  return buf;
}

export function unpackPickups(buf: ArrayBuffer, p: Pickups): void {
  const v = new DataView(buf);
  const n = Math.floor(buf.byteLength / PICKUP_BYTES);
  p.setFromNet(n, (i) => {
    const o = i * PICKUP_BYTES;
    return [v.getUint8(o), v.getInt16(o + 4, true) / 100, v.getInt16(o + 6, true) / 100, v.getUint16(o + 2, true)];
  });
}
