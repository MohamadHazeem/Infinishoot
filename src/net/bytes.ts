/**
 * Growable byte writer and a matching reader for the compact network
 * encodings (src/net/fxCodec.ts, src/net/snapCodec.ts). Little endian,
 * LEB128 varints, zigzag for signed varints. A writer is reused between
 * messages (`reset()`); `bytes()` copies out exactly what was written.
 */
export type NetBytes = ArrayBuffer | ArrayBufferView;

const enc = new TextEncoder();
const dec = new TextDecoder();

export class ByteWriter {
  buf: Uint8Array;
  view: DataView;
  n = 0;

  constructor(size = 1024) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }

  reset(): void {
    this.n = 0;
  }

  private need(k: number): void {
    if (this.n + k <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.n + k) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
    this.view = new DataView(b.buffer);
  }

  u8(v: number): void {
    this.need(1);
    this.buf[this.n++] = v & 255;
  }
  u16(v: number): void {
    this.need(2);
    this.view.setUint16(this.n, v, true);
    this.n += 2;
  }
  i16(v: number): void {
    this.need(2);
    this.view.setInt16(this.n, v, true);
    this.n += 2;
  }
  f32(v: number): void {
    this.need(4);
    this.view.setFloat32(this.n, v, true);
    this.n += 4;
  }
  f64(v: number): void {
    this.need(8);
    this.view.setFloat64(this.n, v, true);
    this.n += 8;
  }
  /** Unsigned LEB128 (up to 2^53). */
  uv(v: number): void {
    this.need(8);
    while (v >= 128) {
      this.buf[this.n++] = (v % 128) | 128;
      v = Math.floor(v / 128);
    }
    this.buf[this.n++] = v;
  }
  /** Signed varint (zigzag). */
  sv(v: number): void {
    this.uv(v < 0 ? -v * 2 - 1 : v * 2);
  }
  str(s: string): void {
    // ASCII fast path; anything else goes through TextEncoder.
    let ascii = true;
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) ascii = false;
    if (ascii) {
      this.uv(s.length);
      this.need(s.length);
      for (let i = 0; i < s.length; i++) this.buf[this.n++] = s.charCodeAt(i);
      return;
    }
    const b = enc.encode(s);
    this.uv(b.length);
    this.raw(b);
  }
  raw(b: Uint8Array): void {
    this.need(b.length);
    this.buf.set(b, this.n);
    this.n += b.length;
  }
  /** A fresh ArrayBuffer holding what was written. */
  bytes(): ArrayBuffer {
    return this.buf.slice(0, this.n).buffer;
  }
}

export class ByteReader {
  readonly buf: Uint8Array;
  readonly view: DataView;
  o = 0;

  constructor(b: NetBytes) {
    this.buf = ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b);
    this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
  }

  get more(): boolean {
    return this.o < this.buf.length;
  }
  u8(): number {
    if (this.o >= this.buf.length) throw new RangeError('net: read past end');
    return this.buf[this.o++];
  }
  u16(): number {
    const v = this.view.getUint16(this.o, true);
    this.o += 2;
    return v;
  }
  i16(): number {
    const v = this.view.getInt16(this.o, true);
    this.o += 2;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.o, true);
    this.o += 4;
    return v;
  }
  f64(): number {
    const v = this.view.getFloat64(this.o, true);
    this.o += 8;
    return v;
  }
  uv(): number {
    let v = 0;
    let m = 1;
    for (;;) {
      const b = this.u8();
      v += (b & 127) * m;
      if (b < 128) return v;
      m *= 128;
    }
  }
  sv(): number {
    const u = this.uv();
    return u % 2 ? -(u + 1) / 2 : u / 2;
  }
  str(): string {
    const len = this.uv();
    const end = this.o + len;
    if (end > this.buf.length) throw new RangeError('net: string past end');
    let s = '';
    let ascii = true;
    for (let i = this.o; i < end; i++) if (this.buf[i] > 127) ascii = false;
    if (ascii) {
      for (let i = this.o; i < end; i++) s += String.fromCharCode(this.buf[i]);
    } else s = dec.decode(this.buf.subarray(this.o, end));
    this.o = end;
    return s;
  }
  raw(len: number): Uint8Array {
    const b = this.buf.subarray(this.o, this.o + len);
    this.o += len;
    return b;
  }
}
