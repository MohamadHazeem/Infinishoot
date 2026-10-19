import { ByteReader, ByteWriter, type NetBytes } from './bytes';
import { BulletDeltaEncoder } from './bulletCodec';
import type { Bullets } from '../game/bullets';

/**
 * Leaner co-op snapshots. The host builds the same snapshot object as before
 * (systems/netHost.ts); a per-client SnapEncoder turns it into a small wire
 * message and the client's SnapDecoder turns it back into the same object.
 *
 * - Body (everything but the binary records): a compact, lossless value
 *   encoding instead of PeerJS's binarypack. Object keys and common strings
 *   come from a shared dictionary (one byte), small ints are one byte, and
 *   numbers that are exact at 2-3 decimals (everything rounded with r2) are
 *   scaled varints instead of 9-byte doubles.
 * - Unchanged since the last snapshot: top-level fields, `you` fields and
 *   each hero's fields that encode to the same bytes as last time are left
 *   out; the decoder re-decodes its copy of the last bytes.
 * - Enemy records (fixed size, keyed by the uid in their first 4 bytes) are
 *   sent as a byte mask of what changed since this client's previous record
 *   for that uid, then only those bytes. Int16 positions mostly change in
 *   the low byte, so a moving enemy costs ~10 bytes instead of 22.
 * - Pickup records (fixed size, no id) are sent as a bitmap of which of the
 *   previous snapshot's records are still there plus the new ones.
 * - Every KEYFRAME-th snapshot drops all baselines and sends everything in
 *   full, so nothing can drift for long. The data channel is reliable and
 *   ordered, which the deltas rely on.
 */
export const KEYFRAME = 40;
const VERSION = 1;

// ---------------------------------------------------------------- dictionary

/** Strings both sides know: snapshot keys and common values. Append only (the index is the wire id). */
const DICT = [
  't', 's', 'mode', 'stage', 'tl', 'boss', 'name', 'hp01', 'team', 'level', 'xp01', 'score', 'combo', 'combo01', 'kills', 'time',
  'cu', 'sev', 'sch', 'bf', 'heroes', 'i', 'x', 'z', 'vx', 'vz', 'ax', 'az', 'hp', 'mhp', 'dead', 'left', 'dash', 'inv', 'rec',
  'hf', 'rv', 'area', 'w', 'rl', 'you', 'gold', 'gears', 'special', 'bomb', 'mods', 'id', 'ro', 'lv', 'passives', 'stats',
  'moveSpeedMul', 'dashCooldownMul', 'dashCharges', 'maxHp', 'magnet', 'areaMul', 'portal', 'bx', 'ar', 'sk', 'h', 'n', 'e',
  'fight', 'levelup', 'cleared', 'transition', 'title', 'shop', 'pd', 'pa', 'ul', 'rk', 'sw', 'phase', 'state', 'kind', 'cur',
  'max', 'done', 'text', 'k', 'r', 'a', 'p', 'o', 'b', 'c', 'd', 'f', 'g', 'l', 'm', 'q', 'u', 'v', 'y', 'buster', 'charge',
];
const DICT_INDEX = new Map(DICT.map((s, i) => [s, i]));

// Value tags. 128..255 = small unsigned int (tag - 128).
const T_NULL = 0;
const T_UNDEF = 1;
const T_FALSE = 2;
const T_TRUE = 3;
const T_UINT = 4;
const T_NINT = 5;
const T_CENTI = 6;
const T_MILLI = 7;
const T_F32 = 8;
const T_F64 = 9;
const T_STR = 10;
const T_STR_REF = 11;
const T_STR_DICT = 12;
const T_ARR = 13;
const T_OBJ = 14;
const T_BIN = 15;
const T_SMALL = 128;

const MAX_SAFE = 2 ** 52;

/** Writes values; strings not in the dictionary are written once per scope and then referenced. */
class ValueWriter {
  readonly w = new ByteWriter(2048);
  private strs = new Map<string, number>();

  scope(): void {
    this.strs.clear();
  }

  str(s: string): void {
    const d = DICT_INDEX.get(s);
    if (d !== undefined) {
      this.w.u8(T_STR_DICT);
      this.w.uv(d);
      return;
    }
    const r = this.strs.get(s);
    if (r !== undefined) {
      this.w.u8(T_STR_REF);
      this.w.uv(r);
      return;
    }
    this.strs.set(s, this.strs.size);
    this.w.u8(T_STR);
    this.w.str(s);
  }

  num(v: number): void {
    const w = this.w;
    if (Number.isInteger(v) && Math.abs(v) < MAX_SAFE) {
      if (v >= 0 && v < 128) w.u8(T_SMALL + v);
      else if (v >= 0) {
        w.u8(T_UINT);
        w.uv(v);
      } else {
        w.u8(T_NINT);
        w.uv(-v);
      }
      return;
    }
    if (Number.isFinite(v) && Math.abs(v) < 2 ** 40) {
      const c = Math.round(v * 100);
      if (c / 100 === v) {
        w.u8(T_CENTI);
        w.sv(c);
        return;
      }
      const m = Math.round(v * 1000);
      if (m / 1000 === v) {
        w.u8(T_MILLI);
        w.sv(m);
        return;
      }
    }
    if (Math.fround(v) === v || Number.isNaN(v)) {
      w.u8(T_F32);
      w.f32(v);
      return;
    }
    w.u8(T_F64);
    w.f64(v);
  }

  value(v: unknown): void {
    const w = this.w;
    if (v === null) w.u8(T_NULL);
    else if (v === undefined) w.u8(T_UNDEF);
    else if (v === false) w.u8(T_FALSE);
    else if (v === true) w.u8(T_TRUE);
    else if (typeof v === 'number') this.num(v);
    else if (typeof v === 'string') this.str(v);
    else if (Array.isArray(v)) {
      w.u8(T_ARR);
      w.uv(v.length);
      for (const x of v) this.value(x);
    } else if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
      const b = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      w.u8(T_BIN);
      w.uv(b.length);
      w.raw(b);
    } else if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      let n = 0;
      for (const k in o) if (o[k] !== undefined) n++;
      w.u8(T_OBJ);
      w.uv(n);
      for (const k in o) {
        if (o[k] === undefined) continue;
        this.str(k);
        this.value(o[k]);
      }
    } else w.u8(T_NULL);
  }
}

class ValueReader {
  private strs: string[] = [];
  constructor(readonly r: ByteReader) {}

  scope(): void {
    this.strs.length = 0;
  }

  value(): unknown {
    const r = this.r;
    const tag = r.u8();
    if (tag >= T_SMALL) return tag - T_SMALL;
    switch (tag) {
      case T_NULL:
        return null;
      case T_UNDEF:
        return undefined;
      case T_FALSE:
        return false;
      case T_TRUE:
        return true;
      case T_UINT:
        return r.uv();
      case T_NINT:
        return -r.uv();
      case T_CENTI:
        return r.sv() / 100;
      case T_MILLI:
        return r.sv() / 1000;
      case T_F32:
        return r.f32();
      case T_F64:
        return r.f64();
      case T_STR: {
        const s = r.str();
        this.strs.push(s);
        return s;
      }
      case T_STR_REF:
        return this.strs[r.uv()] ?? '';
      case T_STR_DICT:
        return DICT[r.uv()] ?? '';
      case T_ARR: {
        const n = r.uv();
        const a: unknown[] = new Array(n);
        for (let i = 0; i < n; i++) a[i] = this.value();
        return a;
      }
      case T_OBJ: {
        const n = r.uv();
        const o: Record<string, unknown> = {};
        for (let i = 0; i < n; i++) {
          const k = String(this.value());
          o[k] = this.value();
        }
        return o;
      }
      case T_BIN: {
        const n = r.uv();
        return r.raw(n).slice().buffer;
      }
      default:
        throw new RangeError(`net: bad value tag ${tag}`);
    }
  }
}

/** Lossless compact encoding of a JSON-like value (plus ArrayBuffers). */
export function packValue(v: unknown): ArrayBuffer {
  const vw = new ValueWriter();
  vw.value(v);
  return vw.w.bytes();
}

export function unpackValue(b: NetBytes): unknown {
  return new ValueReader(new ByteReader(b)).value();
}

// ---------------------------------------------------------------- sticky objects

/**
 * Fields of `obj` whose encoding matches `cache` are skipped. Wire: uv count,
 * then key + value bytes. Each value has its own string scope so cached
 * bytes can be decoded on their own later.
 */
function writeSticky(vw: ValueWriter, obj: Record<string, unknown>, cache: Map<string, Uint8Array>, nested: Record<string, 'obj' | 'arr'>, caches: (path: string) => Map<string, Uint8Array>, path: string, tmp: ValueWriter): void {
  const keys: string[] = [];
  for (const k in obj) keys.push(k);
  // Keys that vanished are sent as undefined so the decoder forgets them.
  for (const k of cache.keys()) if (!(k in obj)) keys.push(k);
  const countAt = vw.w.n;
  vw.w.u8(0); // patched below (count < 128 assumed; checked)
  let n = 0;
  for (const k of keys) {
    const v = obj[k];
    const kind = nested[k];
    if (kind === 'obj' && v && typeof v === 'object' && !Array.isArray(v)) {
      vw.scope();
      vw.str(k);
      vw.w.u8(1); // nested sticky object
      writeSticky(vw, v as Record<string, unknown>, caches(`${path}.${k}`), {}, caches, `${path}.${k}`, tmp);
      cache.delete(k);
      n++;
      continue;
    }
    if (kind === 'arr' && Array.isArray(v)) {
      vw.scope();
      vw.str(k);
      vw.w.u8(2); // array of sticky objects
      vw.w.uv(v.length);
      v.forEach((item, i) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          vw.w.u8(1);
          writeSticky(vw, item as Record<string, unknown>, caches(`${path}.${k}.${i}`), {}, caches, `${path}.${k}.${i}`, tmp);
        } else {
          vw.w.u8(0);
          vw.scope();
          vw.value(item);
        }
      });
      cache.delete(k);
      n++;
      continue;
    }
    tmp.w.reset();
    tmp.scope();
    tmp.value(v);
    const bytes = tmp.w.buf.subarray(0, tmp.w.n);
    const prev = cache.get(k);
    if (prev && sameBytes(prev, bytes)) continue;
    if (v === undefined && !prev) continue;
    if (v === undefined) cache.delete(k);
    else cache.set(k, bytes.slice());
    vw.scope();
    vw.str(k);
    vw.w.u8(0); // plain value
    vw.w.raw(bytes);
    n++;
  }
  if (n > 127) throw new RangeError('net: sticky object has too many fields');
  vw.w.buf[countAt] = n;
}

function readSticky(vr: ValueReader, cache: Map<string, Uint8Array>, caches: (path: string) => Map<string, Uint8Array>, path: string): Record<string, unknown> {
  const r = vr.r;
  const n = r.u8();
  const seen = new Set<string>();
  const out: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    vr.scope();
    const k = String(vr.value());
    seen.add(k);
    const mode = r.u8();
    if (mode === 1) {
      out[k] = readSticky(vr, caches(`${path}.${k}`), caches, `${path}.${k}`);
      cache.delete(k);
    } else if (mode === 2) {
      const len = r.uv();
      const a: unknown[] = [];
      for (let j = 0; j < len; j++) {
        if (r.u8() === 1) a.push(readSticky(vr, caches(`${path}.${k}.${j}`), caches, `${path}.${k}.${j}`));
        else {
          vr.scope();
          a.push(vr.value());
        }
      }
      out[k] = a;
      cache.delete(k);
    } else {
      const start = r.o;
      vr.scope();
      const v = vr.value();
      if (v === undefined) cache.delete(k);
      else {
        cache.set(k, r.buf.slice(start, r.o));
        out[k] = v;
      }
    }
  }
  // Unchanged fields: decode the bytes kept from the last time they changed.
  for (const [k, bytes] of cache) {
    if (seen.has(k)) continue;
    const sub = new ValueReader(new ByteReader(bytes));
    out[k] = sub.value();
  }
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------------------------------------------------------------- keyed record deltas

/** Fixed-size records keyed by a Uint32 (little endian) at offset 0. */
export class KeyedDeltaEncoder {
  private base = new Map<number, Uint8Array>();
  private next = new Map<number, Uint8Array>();
  private order: number[] = [];

  reset(): void {
    this.base.clear();
  }

  encode(records: NetBytes, size: number, w: ByteWriter): void {
    const src = asBytes(records);
    const n = size > 0 ? Math.floor(src.length / size) : 0;
    w.u8(size);
    w.uv(n);
    if (!n) {
      this.base.clear();
      return;
    }
    const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
    const order = this.order;
    order.length = n;
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => dv.getUint32(a * size, true) - dv.getUint32(b * size, true));
    const maskBytes = Math.ceil((size - 4) / 8);
    let prevKey = 0;
    const next = this.next;
    next.clear();
    for (const i of order) {
      const o = i * size;
      const key = dv.getUint32(o, true);
      const rec = src.subarray(o, o + size);
      const b = this.base.get(key);
      w.uv((key - prevKey) * 2 + (b ? 1 : 0));
      prevKey = key;
      if (!b) w.raw(rec.subarray(4));
      else {
        const at = w.n;
        for (let m = 0; m < maskBytes; m++) w.u8(0);
        for (let j = 4; j < size; j++) {
          if (rec[j] === b[j]) continue;
          w.buf[at + ((j - 4) >> 3)] |= 1 << ((j - 4) & 7);
          w.u8(rec[j]);
        }
      }
      // Reuse the old baseline array when we can.
      const keep = b ?? new Uint8Array(size);
      keep.set(rec);
      next.set(key, keep);
    }
    this.next = this.base;
    this.base = next;
  }
}

export class KeyedDeltaDecoder {
  private base = new Map<number, Uint8Array>();

  reset(): void {
    this.base.clear();
  }

  /** Returns the full records (same layout the host packed). */
  decode(r: ByteReader): ArrayBuffer {
    const size = r.u8();
    const n = r.uv();
    const out = new Uint8Array(n * size);
    const next = new Map<number, Uint8Array>();
    const maskBytes = Math.ceil((size - 4) / 8);
    let key = 0;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const head = r.uv();
      key += Math.floor(head / 2);
      const rec = new Uint8Array(size);
      new DataView(rec.buffer).setUint32(0, key, true);
      if (head % 2 === 0) rec.set(r.raw(size - 4), 4);
      else {
        const b = this.base.get(key);
        const mask = r.raw(maskBytes);
        if (b) rec.set(b);
        for (let j = 4; j < size; j++) if (mask[(j - 4) >> 3] & (1 << ((j - 4) & 7))) rec[j] = r.u8();
        if (!b) continue; // no baseline (shouldn't happen): drop it until the next keyframe
      }
      next.set(key, rec);
      out.set(rec, k * size);
      k++;
    }
    this.base = next;
    return out.slice(0, k * size).buffer;
  }
}

// ---------------------------------------------------------------- record set deltas

/** Fixed-size records without ids: which of the last list survive, plus the new ones. */
export class SetDeltaEncoder {
  private prev = new Uint8Array(0);
  private prevN = 0;
  private size = 0;
  private hashes = new Map<number, number[]>();

  reset(): void {
    this.prevN = 0;
  }

  encode(records: NetBytes, size: number, w: ByteWriter): void {
    const src = asBytes(records);
    const n = size > 0 ? Math.floor(src.length / size) : 0;
    if (size !== this.size) this.prevN = 0;
    w.u8(size);
    const prevN = this.prevN;
    w.uv(prevN);
    // Index the previous records by content.
    const hashes = this.hashes;
    hashes.clear();
    for (let i = 0; i < prevN; i++) {
      const h = hashRec(this.prev, i * size, size);
      const list = hashes.get(h);
      if (list) list.push(i);
      else hashes.set(h, [i]);
    }
    const kept = new Uint8Array(Math.ceil(prevN / 8));
    const fresh: number[] = [];
    for (let i = 0; i < n; i++) {
      const list = hashes.get(hashRec(src, i * size, size));
      let hit = -1;
      if (list) {
        for (let q = 0; q < list.length; q++) {
          const j = list[q];
          if (j >= 0 && !(kept[j >> 3] & (1 << (j & 7))) && sameRec(this.prev, j * size, src, i * size, size)) {
            hit = j;
            list[q] = -1;
            break;
          }
        }
      }
      if (hit >= 0) kept[hit >> 3] |= 1 << (hit & 7);
      else fresh.push(i);
    }
    w.raw(kept);
    w.uv(fresh.length);
    for (const i of fresh) w.raw(src.subarray(i * size, i * size + size));
    // The new baseline is what the decoder will rebuild: kept (in old order), then fresh.
    const next = new Uint8Array(n * size);
    let k = 0;
    for (let j = 0; j < prevN; j++) if (kept[j >> 3] & (1 << (j & 7))) next.set(this.prev.subarray(j * size, j * size + size), k++ * size);
    for (const i of fresh) next.set(src.subarray(i * size, i * size + size), k++ * size);
    this.prev = next;
    this.prevN = k;
    this.size = size;
  }
}

export class SetDeltaDecoder {
  private prev = new Uint8Array(0);
  private prevN = 0;

  reset(): void {
    this.prevN = 0;
  }

  decode(r: ByteReader): ArrayBuffer {
    const size = r.u8();
    const prevN = r.uv();
    const kept = r.raw(Math.ceil(prevN / 8));
    const nNew = r.uv();
    // A baseline mismatch can only mean a lost message; keep what we can.
    const usable = prevN === this.prevN;
    let nKept = 0;
    if (usable) for (let j = 0; j < prevN; j++) if (kept[j >> 3] & (1 << (j & 7))) nKept++;
    const out = new Uint8Array((nKept + nNew) * size);
    let k = 0;
    if (usable) for (let j = 0; j < prevN; j++) if (kept[j >> 3] & (1 << (j & 7))) out.set(this.prev.subarray(j * size, j * size + size), k++ * size);
    for (let i = 0; i < nNew; i++) out.set(r.raw(size), k++ * size);
    this.prev = out;
    this.prevN = k;
    return out.buffer;
  }
}

function asBytes(b: NetBytes): Uint8Array {
  return ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b);
}

function hashRec(b: Uint8Array, o: number, size: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < size; i++) h = Math.imul(h ^ b[o + i], 0x01000193);
  return h >>> 0;
}

function sameRec(a: Uint8Array, ao: number, b: Uint8Array, bo: number, size: number): boolean {
  for (let i = 0; i < size; i++) if (a[ao + i] !== b[bo + i]) return false;
  return true;
}

// ---------------------------------------------------------------- snapshots

/** Snapshot fields that get per-field "unchanged" treatment one level down. */
const NESTED: Record<string, 'obj' | 'arr'> = { you: 'obj', heroes: 'arr' };

/** Binary record fields: [snapshot key, record count key]. */
export interface SnapRecords {
  /** Packed enemy records (fixed size, uid first) and how many. */
  en: ArrayBuffer;
  enN: number;
  /** Packed pickup records (fixed size) and how many. */
  pk: ArrayBuffer;
  pkN: number;
  /** Bullets this client sees (indices into the pool): sent as deltas in `bd` (src/net/bulletCodec.ts). */
  bu?: { b: Bullets; idx: readonly number[] };
}

/** Host: one per client. */
export class SnapEncoder {
  private n = 0;
  private caches = new Map<string, Map<string, Uint8Array>>();
  private vw = new ValueWriter();
  private tmp = new ValueWriter();
  private en = new KeyedDeltaEncoder();
  private pk = new SetDeltaEncoder();
  private bu = new BulletDeltaEncoder();
  private rw = new ByteWriter(4096);

  private cache = (path: string): Map<string, Uint8Array> => {
    let c = this.caches.get(path);
    if (!c) this.caches.set(path, (c = new Map()));
    return c;
  };

  /**
   * `body`: the snapshot fields (no binary records); `recs`: enemy and pickup
   * records. Other fields of the wire message (bullets, effects) go in `extra`.
   */
  encode(body: Record<string, unknown>, recs: SnapRecords, extra: Record<string, unknown>): Record<string, unknown> {
    const key = this.n % KEYFRAME === 0;
    this.n++;
    if (key) {
      this.caches.clear();
      this.en.reset();
      this.pk.reset();
      this.bu.reset();
    }
    const vw = this.vw;
    vw.w.reset();
    vw.w.u8(VERSION);
    writeSticky(vw, body, this.cache(''), NESTED, this.cache, '', this.tmp);
    const rw = this.rw;
    rw.reset();
    this.en.encode(recs.en, recs.enN ? Math.round(recs.en.byteLength / recs.enN) : 0, rw);
    const en = rw.bytes();
    rw.reset();
    this.pk.encode(recs.pk, recs.pkN ? Math.round(recs.pk.byteLength / recs.pkN) : 0, rw);
    const pk = rw.bytes();
    if (!recs.bu) return { t: 's', b: vw.w.bytes(), en, pk, ...extra };
    rw.reset();
    this.bu.encode(recs.bu.b, recs.bu.idx, rw);
    return { t: 's', b: vw.w.bytes(), en, pk, bd: rw.bytes(), ...extra };
  }
}

/** Client: one per connection to the host. */
export class SnapDecoder {
  private caches = new Map<string, Map<string, Uint8Array>>();
  private en = new KeyedDeltaDecoder();
  private pk = new SetDeltaDecoder();

  private cache = (path: string): Map<string, Uint8Array> => {
    let c = this.caches.get(path);
    if (!c) this.caches.set(path, (c = new Map()));
    return c;
  };

  reset(): void {
    this.caches.clear();
    this.en.reset();
    this.pk.reset();
  }

  /** Wire message -> the snapshot object the host built (with full `en` / `pk` records). */
  decode(m: Record<string, unknown>): Record<string, unknown> {
    const r = new ByteReader(m.b as NetBytes);
    if (r.u8() !== VERSION) throw new Error('net: snapshot version mismatch');
    const s = readSticky(new ValueReader(r), this.cache(''), this.cache, '');
    s.t = 's';
    s.en = this.en.decode(new ByteReader(m.en as NetBytes));
    s.pk = this.pk.decode(new ByteReader(m.pk as NetBytes));
    for (const k in m) if (k !== 'b' && k !== 'en' && k !== 'pk' && k !== 't') s[k] = m[k];
    return s;
  }
}
