import type { BurstOptions } from '../game/particles';
import type { NumKind, VfxEvent } from '../game/vfx';
import { ByteReader, ByteWriter, type NetBytes } from './bytes';
import { packValue, unpackValue } from './snapCodec';

/**
 * Compact binary encoding of the cosmetic effects bus (src/game/vfx.ts) for
 * co-op snapshots. One snapshot's effects become one ArrayBuffer:
 *
 *   u8 version | strings | burst templates | events...
 *
 * - Strings (colours, sound names, enemy ids, banner text) are written once
 *   per snapshot and referenced by index.
 * - Burst options are deduplicated into templates (most bursts reuse a few
 *   shapes); a burst event is then a position plus a template index. A burst
 *   with a direction carries its angle per event, so hit sparks still share
 *   their template. Identical consecutive bursts merge into one record with
 *   a repeat count (replayed as that many bursts).
 * - Positions are centimetres in an Int16 (+-327 m); an event at the same
 *   x/z as the one before it sets a flag and skips them. NaN (team-wide
 *   sounds) is the Int16 minimum.
 * - Other values are fixed point at a precision well under what a player
 *   can see (sizes 1 cm, times 1 ms, angles 0.001 rad).
 */
const VERSION = 1;

/** Event kinds (low 4 bits of the tag byte). */
const KINDS = ['b', 'r', 's', 'n', 'a', 'k', 'z', 'g', 'c', 'h'] as const;
type Kind = (typeof KINDS)[number];
const KIND_INDEX: Record<Kind, number> = Object.fromEntries(KINDS.map((k, i) => [k, i])) as Record<Kind, number>;
/** Tag bit: same x/z as the previous event. */
const SAME_POS = 16;
/** Tag bit, per kind: burst repeat count follows / sound pitch follows (else 1) / num kind != hit. */
const EXTRA = 32;

const NUM_KINDS: NumKind[] = ['hit', 'crit', 'player', 'heal', 'score'];
/** Damage-number labels like "123!" or "45 FIRE" are sent as a number plus a suffix id. */
const NUM_SUFFIXES = ['!', ' FIRE', ' SHOCK', ' FROST', ' SHIELD'];
const NUM_LABEL = /^(0|[1-9]\d{0,8})(!| FIRE| SHOCK| FROST| SHIELD)$/;
const HUD_KINDS = ['banner', 'toast', 'flash'] as const;
/** Tag for anything this codec doesn't know (a new event kind or sub-kind): sent as a generic value. */
const GENERIC = 15;
/** Burst options this codec writes field by field; any other option travels as a generic value. */
const BURST_KEYS = new Set(['count', 'color', 'color2', 'speed', 'size', 'life', 'up', 'gravity', 'drag', 'dir', 'smoke', 'debris', 'sparks', 'dust', 'scorch']);
const NAN16 = -32768;

// Burst template optional-field bits.
const B_COLOR2 = 1;
const B_UP = 2;
const B_GRAVITY = 4;
const B_DRAG = 8;
const B_DIR = 16;
const B_SMOKE = 32;
const B_DEBRIS = 64;
const B_SPARKS = 128;
const B_DUST = 256;
const B_SCORCH = 512;
const B_EXTRA = 1024;

const clamp16 = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v)));
const clampU16 = (v: number) => Math.max(0, Math.min(65535, Math.round(v)));
const qPos = (v: number) => (Number.isNaN(v) ? NAN16 : clamp16(v * 100));
const dqPos = (v: number) => (v === NAN16 ? NaN : v / 100);

/** Colours are either '#rrggbb' strings or numbers; numbers travel as the same hex string. */
function colorKey(c: unknown): string {
  if (typeof c === 'number') return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
  return String(c);
}

/** Should event `e` go to a client whose hero is at (cx, cz)? (The interest box is checked separately.) */
export function fxRelevant(e: VfxEvent, cx: number, cz: number): boolean {
  // Sounds past hearing range (32 m) and shakes past their falloff (28 m) do nothing on the client;
  // 2 m of slack covers the hero moving between snapshots.
  if (e[0] === 'a') return Number.isNaN(e[1]) || Math.hypot(e[1] - cx, e[2] - cz) <= 34;
  if (e[0] === 'k') return Math.hypot(e[1] - cx, e[2] - cz) <= 30;
  return true;
}

/**
 * Host: encodes effect lists. Keep one per host (it reuses its buffers);
 * `encode()` returns a fresh ArrayBuffer each call.
 */
export class FxEncoder {
  private strings = new Map<string, number>();
  private stringList: string[] = [];
  private templates = new Map<string, number>();
  private tw = new ByteWriter(512);
  private tpl = new ByteWriter(64);
  private ev = new ByteWriter(4096);
  private out = new ByteWriter(4096);
  private lastX = NaN;
  private lastZ = NaN;
  // Pending burst (merged with identical followers).
  private pend = false;
  private pX = 0;
  private pY = 0;
  private pZ = 0;
  private pT = 0;
  private pDir = 0;
  private pHasDir = false;
  private pRep = 1;

  encode(events: readonly VfxEvent[], keep?: (e: VfxEvent) => boolean): ArrayBuffer {
    this.strings.clear();
    this.stringList.length = 0;
    this.templates.clear();
    this.tw.reset();
    this.ev.reset();
    this.lastX = this.lastZ = NaN;
    this.pend = false;
    for (const e of events) if (!keep || keep(e)) this.event(e);
    this.flushBurst();
    const o = this.out;
    o.reset();
    o.u8(VERSION);
    o.uv(this.stringList.length);
    for (const s of this.stringList) o.str(s);
    o.uv(this.templates.size);
    o.raw(this.tw.buf.subarray(0, this.tw.n));
    o.raw(this.ev.buf.subarray(0, this.ev.n));
    return o.bytes();
  }

  private str(s: string): number {
    let i = this.strings.get(s);
    if (i === undefined) {
      i = this.stringList.length;
      this.strings.set(s, i);
      this.stringList.push(s);
    }
    return i;
  }

  /** Position header: tag byte, then x/z unless they repeat. */
  private head(kind: Kind, x: number, z: number, extra: boolean): void {
    const qx = qPos(x);
    const qz = qPos(z);
    const same = qx === this.lastX && qz === this.lastZ;
    this.ev.u8(KIND_INDEX[kind] | (same ? SAME_POS : 0) | (extra ? EXTRA : 0));
    if (!same) {
      this.ev.i16(qx);
      this.ev.i16(qz);
      this.lastX = qx;
      this.lastZ = qz;
    }
  }

  private template(o: BurstOptions): number {
    const t = this.tpl;
    t.reset();
    let bits = 0;
    if (o.color2 !== undefined) bits |= B_COLOR2;
    if (o.up) bits |= B_UP;
    if (o.gravity !== undefined) bits |= B_GRAVITY;
    if (o.drag) bits |= B_DRAG;
    if (o.dir) bits |= B_DIR;
    if (o.smoke) bits |= B_SMOKE;
    if (o.debris) bits |= B_DEBRIS;
    if (o.sparks) bits |= B_SPARKS;
    if (o.dust) bits |= B_DUST;
    if (o.scorch !== undefined) bits |= B_SCORCH;
    let extra: Record<string, unknown> | null = null;
    for (const k in o) {
      const v = (o as unknown as Record<string, unknown>)[k];
      if (BURST_KEYS.has(k) || v === undefined) continue;
      (extra ??= {})[k] = v;
    }
    if (extra) bits |= B_EXTRA;
    t.uv(bits);
    t.uv(Math.max(0, Math.round(o.count)));
    t.uv(this.str(colorKey(o.color)));
    if (bits & B_COLOR2) t.uv(this.str(colorKey(o.color2)));
    t.u16(clampU16(o.speed[0] * 100));
    t.u16(clampU16(o.speed[1] * 100));
    t.u16(clampU16(o.size[0] * 1000));
    t.u16(clampU16(o.size[1] * 1000));
    t.u16(clampU16(o.life[0] * 1000));
    t.u16(clampU16(o.life[1] * 1000));
    if (bits & B_UP) t.i16(clamp16(o.up! * 100));
    if (bits & B_GRAVITY) t.i16(clamp16(o.gravity! * 100));
    if (bits & B_DRAG) t.u16(clampU16(o.drag! * 100));
    if (bits & B_DIR) t.u16(clampU16(o.dir!.spread * 1000));
    if (bits & B_SMOKE) t.uv(Math.round(o.smoke!));
    if (bits & B_DEBRIS) t.uv(Math.round(o.debris!));
    if (bits & B_SPARKS) t.uv(Math.round(o.sparks!));
    if (bits & B_DUST) t.uv(Math.round(o.dust!));
    if (bits & B_SCORCH) t.u16(clampU16(o.scorch! * 1000));
    if (extra) {
      const b = new Uint8Array(packValue(extra));
      t.uv(b.length);
      t.raw(b);
    }
    let key = '';
    for (let i = 0; i < t.n; i++) key += String.fromCharCode(t.buf[i]);
    let idx = this.templates.get(key);
    if (idx === undefined) {
      idx = this.templates.size;
      this.templates.set(key, idx);
      this.tw.raw(t.buf.subarray(0, t.n));
    }
    return idx;
  }

  private flushBurst(): void {
    if (!this.pend) return;
    this.pend = false;
    this.head('b', this.pX, this.pZ, this.pRep > 1);
    const w = this.ev;
    if (this.pRep > 1) w.uv(this.pRep);
    w.i16(this.pY);
    w.uv(this.pT);
    if (this.pHasDir) w.i16(this.pDir);
  }

  /** Event kinds (and sub-kinds) with a compact encoding here. */
  private known(e: VfxEvent): boolean {
    const k = e[0] as string;
    if (k === 'n') return NUM_KINDS.includes(e[5] as NumKind);
    if (k === 'h') return (HUD_KINDS as readonly string[]).includes(e[1] as string);
    return k in KIND_INDEX;
  }

  private event(e: VfxEvent): void {
    const w = this.ev;
    if (e[0] === 'b') {
      const o = e[4];
      const t = this.template(o);
      const y = clamp16(e[2] * 100);
      const dir = o.dir ? clamp16(Math.atan2(o.dir.z, o.dir.x) * 1000) : 0;
      if (this.pend && this.pT === t && this.pX === e[1] && this.pZ === e[3] && this.pY === y && this.pDir === dir && this.pRep < 1000) {
        this.pRep++;
        return;
      }
      this.flushBurst();
      this.pend = true;
      this.pX = e[1];
      this.pZ = e[3];
      this.pY = y;
      this.pT = t;
      this.pDir = dir;
      this.pHasDir = !!o.dir;
      this.pRep = 1;
      return;
    }
    this.flushBurst();
    if (!this.known(e)) {
      // Not something this codec was written for: send it whole (lossless, just less compact).
      const b = new Uint8Array(packValue(e));
      w.u8(GENERIC);
      w.uv(b.length);
      w.raw(b);
      return;
    }
    switch (e[0]) {
      case 'r':
        this.head('r', e[1], e[2], false);
        w.u16(clampU16(e[3] * 100));
        w.i16(clamp16(e[4] * 100));
        w.uv(this.str(colorKey(e[5])));
        w.u16(clampU16(e[6] * 1000));
        break;
      case 's':
        this.head('s', e[1], e[3], false);
        w.i16(clamp16(e[2] * 100));
        w.u16(clampU16(e[4] * 100));
        w.uv(this.str(colorKey(e[5])));
        w.u16(clampU16(e[6] * 1000));
        break;
      case 'n': {
        const kind = Math.max(0, NUM_KINDS.indexOf(e[5]));
        this.head('n', e[1], e[3], kind !== 0);
        w.i16(clamp16(e[2] * 100));
        // Value byte: low 3 bits = kind, high bits = value type.
        const v = e[4];
        let type = 3;
        let m: RegExpExecArray | null = null;
        if (typeof v === 'number') {
          if (Number.isInteger(v) && Math.abs(v) < 2 ** 31) type = v >= 0 ? 0 : 1;
          else type = 2;
        } else if ((m = NUM_LABEL.exec(v))) type = 4 + NUM_SUFFIXES.indexOf(m[2]);
        if (kind !== 0) w.u8(kind);
        w.u8(type);
        if (type === 0) w.uv(v as number);
        else if (type === 1) w.uv(-(v as number));
        else if (type === 2) w.f64(v as number);
        else if (type === 3) w.uv(this.str(v as string));
        else w.uv(Number(m![1]));
        break;
      }
      case 'a': {
        const pitch = clampU16(e[4] * 1000);
        this.head('a', e[1], e[2], pitch !== 1000);
        w.uv(this.str(e[3]));
        if (pitch !== 1000) w.u16(pitch);
        break;
      }
      case 'k':
        this.head('k', e[1], e[2], false);
        w.u16(clampU16(e[3] * 1000));
        break;
      case 'z':
        this.head('z', e[1], e[2], false);
        w.u16(clampU16(e[3] * 100));
        w.u16(clampU16(e[4] * 1000));
        break;
      case 'g':
        this.head('g', e[1], e[2], false);
        w.u16(clampU16(e[3] * 100));
        w.uv(this.str(colorKey(e[4])));
        w.u16(clampU16(e[5] * 100));
        break;
      case 'c':
        this.head('c', e[1], e[2], false);
        w.i16(clamp16(e[3] * 100));
        w.uv(this.str(e[4]));
        w.u16(clampU16(e[5] * 100));
        w.i16(clamp16(e[6] * 1000));
        w.i16(clamp16(e[7] * 100));
        w.i16(clamp16(e[8] * 100));
        break;
      case 'h':
        w.u8(KIND_INDEX.h);
        w.u8(Math.max(0, HUD_KINDS.indexOf(e[1])));
        w.uv(this.str(e[2]));
        w.uv(this.str(e[3]));
        w.u16(clampU16(e[4] * 100));
        break;
    }
  }
}

interface Template {
  o: BurstOptions;
  dir: { x: number; z: number; spread: number } | null;
}

/**
 * Client: replay an encoded effects buffer. `each` gets one event at a time;
 * the tuples and burst options are reused between calls (use them before
 * returning, don't keep them).
 */
export function decodeFx(buf: NetBytes, each: (e: VfxEvent) => void): void {
  const r = new ByteReader(buf);
  if (!r.more || r.u8() !== VERSION) return;
  const strings: string[] = [];
  for (let n = r.uv(); n > 0; n--) strings.push(r.str());
  const templates: Template[] = [];
  for (let n = r.uv(); n > 0; n--) {
    const bits = r.uv();
    const o: BurstOptions = { count: r.uv(), color: strings[r.uv()] ?? '#ffffff', speed: [0, 0], size: [0, 0], life: [0, 0] };
    if (bits & B_COLOR2) o.color2 = strings[r.uv()] ?? '#ffffff';
    o.speed = [r.u16() / 100, r.u16() / 100];
    o.size = [r.u16() / 1000, r.u16() / 1000];
    o.life = [r.u16() / 1000, r.u16() / 1000];
    if (bits & B_UP) o.up = r.i16() / 100;
    if (bits & B_GRAVITY) o.gravity = r.i16() / 100;
    if (bits & B_DRAG) o.drag = r.u16() / 100;
    let dir: Template['dir'] = null;
    if (bits & B_DIR) o.dir = dir = { x: 1, z: 0, spread: r.u16() / 1000 };
    if (bits & B_SMOKE) o.smoke = r.uv();
    if (bits & B_DEBRIS) o.debris = r.uv();
    if (bits & B_SPARKS) o.sparks = r.uv();
    if (bits & B_DUST) o.dust = r.uv();
    if (bits & B_SCORCH) o.scorch = r.u16() / 1000;
    if (bits & B_EXTRA) Object.assign(o, unpackValue(r.raw(r.uv())));
    templates.push({ o, dir });
  }
  const s = (i: number) => strings[i] ?? '';
  let x = NaN;
  let z = NaN;
  const T = scratch;
  while (r.more) {
    const tag = r.u8();
    if (tag === GENERIC) {
      each(unpackValue(r.raw(r.uv())) as VfxEvent);
      continue;
    }
    const kind = KINDS[tag & 15];
    if (!kind) return; // unknown tag: the rest can't be parsed
    if (kind !== 'h' && !(tag & SAME_POS)) {
      x = dqPos(r.i16());
      z = dqPos(r.i16());
    }
    const extra = (tag & EXTRA) !== 0;
    switch (kind) {
      case 'b': {
        const rep = extra ? r.uv() : 1;
        const y = r.i16() / 100;
        const t = templates[r.uv()];
        const a = t?.dir ? r.i16() / 1000 : 0;
        if (!t) return;
        if (t.dir) {
          t.dir.x = Math.cos(a);
          t.dir.z = Math.sin(a);
        }
        const e = T.b;
        e[1] = x;
        e[2] = y;
        e[3] = z;
        e[4] = t.o;
        for (let k = 0; k < rep; k++) each(e);
        break;
      }
      case 'r': {
        const e = T.r;
        e[1] = x;
        e[2] = z;
        e[3] = r.u16() / 100;
        e[4] = r.i16() / 100;
        e[5] = s(r.uv());
        e[6] = r.u16() / 1000;
        each(e);
        break;
      }
      case 's': {
        const e = T.s;
        e[1] = x;
        e[2] = r.i16() / 100;
        e[3] = z;
        e[4] = r.u16() / 100;
        e[5] = s(r.uv());
        e[6] = r.u16() / 1000;
        each(e);
        break;
      }
      case 'n': {
        const e = T.n;
        e[1] = x;
        e[2] = r.i16() / 100;
        e[3] = z;
        e[5] = NUM_KINDS[extra ? r.u8() : 0] ?? 'hit';
        const type = r.u8();
        if (type === 0) e[4] = r.uv();
        else if (type === 1) e[4] = -r.uv();
        else if (type === 2) e[4] = r.f64();
        else if (type === 3) e[4] = s(r.uv());
        else e[4] = `${r.uv()}${NUM_SUFFIXES[type - 4] ?? ''}`;
        each(e);
        break;
      }
      case 'a': {
        const e = T.a;
        e[1] = x;
        e[2] = z;
        e[3] = s(r.uv());
        e[4] = extra ? r.u16() / 1000 : 1;
        each(e);
        break;
      }
      case 'k': {
        const e = T.k;
        e[1] = x;
        e[2] = z;
        e[3] = r.u16() / 1000;
        each(e);
        break;
      }
      case 'z': {
        const e = T.z;
        e[1] = x;
        e[2] = z;
        e[3] = r.u16() / 100;
        e[4] = r.u16() / 1000;
        each(e);
        break;
      }
      case 'g': {
        const e = T.g;
        e[1] = x;
        e[2] = z;
        e[3] = r.u16() / 100;
        e[4] = s(r.uv());
        e[5] = r.u16() / 100;
        each(e);
        break;
      }
      case 'c': {
        const e = T.c;
        e[1] = x;
        e[2] = z;
        e[3] = r.i16() / 100;
        e[4] = s(r.uv());
        e[5] = r.u16() / 100;
        e[6] = r.i16() / 1000;
        e[7] = r.i16() / 100;
        e[8] = r.i16() / 100;
        each(e);
        break;
      }
      case 'h': {
        const e = T.h;
        e[1] = HUD_KINDS[r.u8()] ?? 'toast';
        e[2] = s(r.uv());
        e[3] = s(r.uv());
        e[4] = r.u16() / 100;
        each(e);
        break;
      }
    }
  }
}

/** Reused decode tuples, one per kind. */
const scratch = {
  b: ['b', 0, 0, 0, { count: 0, color: '#fff', speed: [0, 0], size: [0, 0], life: [0, 0] }] as Extract<VfxEvent, ['b', ...unknown[]]>,
  r: ['r', 0, 0, 0, 0, '', 0] as Extract<VfxEvent, ['r', ...unknown[]]>,
  s: ['s', 0, 0, 0, 0, '', 0] as Extract<VfxEvent, ['s', ...unknown[]]>,
  n: ['n', 0, 0, 0, 0, 'hit'] as Extract<VfxEvent, ['n', ...unknown[]]>,
  a: ['a', 0, 0, '', 1] as Extract<VfxEvent, ['a', ...unknown[]]>,
  k: ['k', 0, 0, 0] as Extract<VfxEvent, ['k', ...unknown[]]>,
  z: ['z', 0, 0, 0, 0] as Extract<VfxEvent, ['z', ...unknown[]]>,
  g: ['g', 0, 0, 0, '', 0] as Extract<VfxEvent, ['g', ...unknown[]]>,
  c: ['c', 0, 0, 0, '', 0, 0, 0, 0] as Extract<VfxEvent, ['c', ...unknown[]]>,
  h: ['h', 'toast', '', '', 0] as Extract<VfxEvent, ['h', ...unknown[]]>,
};
