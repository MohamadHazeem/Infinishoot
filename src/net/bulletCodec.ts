import { ByteReader, ByteWriter, type NetBytes } from './bytes';
import { BULLET_COLORS } from './codec';
import type { Bullets } from '../game/bullets';

/**
 * Bullets on the wire (netcode lane). Most bullets fly in a straight line, so
 * the client can move them itself: the host sends a bullet once when it
 * appears, then only when it stops matching what the client predicts (homing,
 * bounces, wind, a correction for rounding) and when it goes away.
 *
 * Every bullet has a uid (Bullets.uid). The host keeps, per client, what it
 * last told that client about each bullet (quantised position and velocity at
 * a bullet-clock time) and predicts where the client now draws it. The
 * bullet clock is `Bullets.simTime` (seconds the pool has been integrated), so
 * hit-stops, menus and slow motion don't break the prediction; each snapshot
 * carries it and the client nudges its untouched bullets by any difference
 * between its own clock and the host's.
 *
 * Message (`bd`): u8 flags (1 = reset: drop every bullet first), uv bullet
 * clock (ms), uv count + records [sv uid delta, u8 kind (0 new, 1 position,
 * 2 position + velocity), i16 x, i16 z (cm), (kinds 0, 2) i16 vx, i16 vz
 * (1/20 m/s), (kind 0) u8 width, u8 length, u8 colour, u8 team/shape/owner,
 * u16 life (ms)], uv count + removed uids (sv deltas).
 *
 * Old format: 14 bytes per bullet per snapshot. Now: ~17 bytes once, ~6 for
 * a correction, ~1 to remove.
 */

export const bulletNetTuning = {
  /** Resend a bullet when the client's predicted position is off by more than this (m). */
  posTol: 0.06,
  /** Resend position and velocity when the velocity changed by more than this (m/s). */
  velTol: 0.06,
};

const NEW = 0;
const POS = 1;
const POSVEL = 2;
const CAP = 2048;

const q16 = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * 100)));
const qv = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * 20)));
const BULLET_HEX = BULLET_COLORS.map((c) => parseInt(c.slice(1), 16));

/** Host: one per client (kept by the snapshot encoder, reset on keyframes). */
export class BulletDeltaEncoder {
  private slotOf = new Map<number, number>();
  private free: number[] = [];
  private uidOf = new Uint32Array(CAP);
  private qx = new Float64Array(CAP);
  private qz = new Float64Array(CAP);
  private qvx = new Float64Array(CAP);
  private qvz = new Float64Array(CAP);
  private t0 = new Float64Array(CAP);
  private seen = new Uint32Array(CAP);
  private gen = 0;
  private used = 0;
  private needReset = true;
  // Reused per snapshot.
  private recIdx: number[] = [];
  private recKind: number[] = [];
  private gone: number[] = [];
  private sweep = (slot: number, uid: number): void => {
    if (this.seen[slot] === this.gen) return;
    this.gone.push(uid);
    this.slotOf.delete(uid);
    this.free.push(slot);
  };

  /** Next snapshot starts from nothing (keyframe or a new client). */
  reset(): void {
    this.slotOf.clear();
    this.free.length = 0;
    this.used = 0;
    this.needReset = true;
  }

  private alloc(): number {
    if (this.free.length) return this.free.pop()!;
    return this.used < CAP ? this.used++ : -1;
  }

  /** Bullets `idx` (indices into the pool) are what this client should see now. */
  encode(b: Bullets, idx: readonly number[], w: ByteWriter): void {
    const T = bulletNetTuning;
    const btMs = Math.round(b.simTime * 1000);
    this.gen = (this.gen + 1) >>> 0 || 1;
    this.recIdx.length = this.recKind.length = this.gone.length = 0;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const uid = b.uid[i];
      let slot = this.slotOf.get(uid);
      if (slot === undefined) {
        slot = this.alloc();
        if (slot < 0) continue; // more bullets than we track: skip it this time
        this.slotOf.set(uid, slot);
        this.uidOf[slot] = uid;
        this.store(slot, b, i, btMs, true);
        this.seen[slot] = this.gen;
        this.recIdx.push(i);
        this.recKind.push(NEW);
        continue;
      }
      this.seen[slot] = this.gen;
      const dt = (btMs - this.t0[slot]) / 1000;
      const px = this.qx[slot] + this.qvx[slot] * dt;
      const pz = this.qz[slot] + this.qvz[slot] * dt;
      const velChanged = Math.abs(b.vx[i] - this.qvx[slot]) > T.velTol || Math.abs(b.vz[i] - this.qvz[slot]) > T.velTol;
      if (velChanged || Math.abs(px - b.x[i]) > T.posTol || Math.abs(pz - b.z[i]) > T.posTol) {
        this.store(slot, b, i, btMs, velChanged);
        this.recIdx.push(i);
        this.recKind.push(velChanged ? POSVEL : POS);
      }
    }
    this.slotOf.forEach(this.sweep);
    w.u8(this.needReset ? 1 : 0);
    this.needReset = false;
    w.uv(btMs);
    w.uv(this.recIdx.length);
    let prev = 0;
    for (let k = 0; k < this.recIdx.length; k++) {
      const i = this.recIdx[k];
      const kind = this.recKind[k];
      w.sv(b.uid[i] - prev);
      prev = b.uid[i];
      w.u8(kind);
      w.i16(q16(b.x[i]));
      w.i16(q16(b.z[i]));
      if (kind === POS) continue;
      w.i16(qv(b.vx[i]));
      w.i16(qv(b.vz[i]));
      if (kind !== NEW) continue;
      w.u8(Math.min(255, Math.round(b.width[i] * 100)));
      w.u8(Math.min(255, Math.round(b.length[i] * 50)));
      const c = BULLET_HEX.indexOf(b.colorHex(i));
      w.u8(c < 0 ? 0 : c);
      // Bit 0: team; bits 1-3: the silhouette (src/game/bulletShapes.ts); bits 4-6: the owner hero (weapon skins; 8 heroes).
      w.u8((b.team[i] & 1) | ((b.shape[i] & 7) << 1) | ((b.owner[i] & 7) << 4));
      w.u16(Math.min(65535, Math.round(Math.max(0, b.life[i]) * 1000)));
    }
    w.uv(this.gone.length);
    prev = 0;
    for (const uid of this.gone) {
      w.sv(uid - prev);
      prev = uid;
    }
  }

  /** What the client now has: the quantised values it decoded. */
  private store(slot: number, b: Bullets, i: number, btMs: number, vel: boolean): void {
    this.qx[slot] = q16(b.x[i]) / 100;
    this.qz[slot] = q16(b.z[i]) / 100;
    // A position-only correction leaves the client's velocity as it was.
    if (vel) {
      this.qvx[slot] = qv(b.vx[i]) / 20;
      this.qvz[slot] = qv(b.vz[i]) / 20;
    }
    this.t0[slot] = btMs;
  }

  /** Bullets this client is known to have (tests). */
  get known(): number {
    return this.slotOf.size;
  }
}

/** Client: per connection. */
export class BulletDeltaDecoder {
  private index = new Map<number, number>();
  private lastBt = NaN;
  private lastSim = 0;

  reset(): void {
    this.lastBt = NaN;
  }

  decode(buf: NetBytes, b: Bullets): void {
    const r = new ByteReader(buf);
    const flags = r.u8();
    const bt = r.uv() / 1000;
    if (flags & 1) b.clear();
    // Bring the bullets we kept to the host's bullet clock (records below are exact at it).
    if (Number.isFinite(this.lastBt) && !(flags & 1)) {
      const err = bt - this.lastBt - (b.simTime - this.lastSim);
      if (err !== 0 && Math.abs(err) < 0.5) {
        for (let i = 0; i < b.count; i++) {
          b.x[i] += b.vx[i] * err;
          b.z[i] += b.vz[i] * err;
          b.life[i] -= err;
        }
      }
    }
    this.lastBt = bt;
    this.lastSim = b.simTime;
    const index = this.index;
    index.clear();
    for (let i = 0; i < b.count; i++) index.set(b.uid[i], i);
    const n = r.uv();
    let uid = 0;
    for (let k = 0; k < n; k++) {
      uid += r.sv();
      const kind = r.u8();
      const x = r.i16() / 100;
      const z = r.i16() / 100;
      let i = index.get(uid);
      if (kind === POS) {
        if (i !== undefined) {
          b.x[i] = b.px[i] = x;
          b.z[i] = b.pz[i] = z;
        }
        continue;
      }
      const vx = r.i16() / 20;
      const vz = r.i16() / 20;
      if (kind === POSVEL) {
        if (i !== undefined) {
          b.x[i] = b.px[i] = x;
          b.z[i] = b.pz[i] = z;
          b.vx[i] = vx;
          b.vz[i] = vz;
        }
        continue;
      }
      const width = r.u8() / 100;
      const length = r.u8() / 50;
      const color = BULLET_COLORS[r.u8()] ?? BULLET_COLORS[0];
      const bits = r.u8();
      const life = r.u16() / 1000;
      if (i !== undefined) {
        // Already have it (shouldn't happen): the host's word wins.
        b.x[i] = b.px[i] = x;
        b.z[i] = b.pz[i] = z;
        b.vx[i] = vx;
        b.vz[i] = vz;
        b.life[i] = life;
        continue;
      }
      const sp = Math.hypot(vx, vz);
      const before = b.count;
      b.spawn({
        x,
        z,
        dirX: sp > 0 ? vx / sp : 0,
        dirZ: sp > 0 ? vz / sp : 0,
        speed: sp,
        life,
        radius: 0.2,
        damage: 0,
        knockback: 0,
        team: bits & 1 ? 1 : 0,
        shape: (bits >> 1) & 7,
        owner: (bits >> 4) & 7,
        color,
        width,
        length,
      });
      if (b.count === before) continue; // pool full
      i = before;
      b.uid[i] = uid;
      b.vx[i] = vx;
      b.vz[i] = vz;
      b.age[i] = 1; // already in flight: skip the spawn pop-in
      index.set(uid, i);
    }
    const gone = r.uv();
    uid = 0;
    for (let k = 0; k < gone; k++) {
      uid += r.sv();
      const i = index.get(uid);
      if (i === undefined || i >= b.count || b.uid[i] !== uid) continue;
      const last = b.count - 1;
      b.kill(i);
      index.delete(uid);
      if (i !== last) index.set(b.uid[i], i);
    }
  }
}
