/**
 * Share codes for custom arenas (editor lane).
 *
 * Binary body (all strings ASCII ids except the UTF-8 name):
 *   u8 version (1) · u8 size index · str name · str biome · u8 waves index ·
 *   u8 foe count + str foes · u8 time/10 · str boss · str difficulty ·
 *   u8 flags (night, rain, wind, events, rings) · u8 heat count + str heat ·
 *   u16 piece count · per piece 3 bytes: [kind << 2 | rotation][x + 128][z + 128]
 *   then a CRC-32 of everything before it (4 bytes, big-endian).
 * str = u8 byte length + bytes.
 *
 * A code is "ISA1." + base64url(body), or "ISA1z." + base64url(deflate-raw(body))
 * when that is shorter (needs CompressionStream). Decoding checks the prefix,
 * caps the inflated size, verifies the CRC, bounds-checks every read and then
 * runs normalizeArena, so a bad or hostile code is rejected or cleaned, never
 * trusted. Network start messages carry the plain base64url body (sync).
 */
import { SIZES, WAVE_IDS, normalizeArena, type CustomArena } from './arenaData';
import { PIECE_ORDER } from './pieces';

export const CODE_PREFIX = 'ISA1.';
export const CODE_PREFIX_Z = 'ISA1z.';
/** Longest body (bytes) a code may decode to: 320 pieces x 3 plus rules, with room. */
export const MAX_BODY = 4096;
/** Longest code text accepted for import. */
export const MAX_CODE = 8192;

export class ArenaCodeError extends Error {
  constructor(readonly reason: 'prefix' | 'base64' | 'size' | 'checksum' | 'format' | 'inflate') {
    super(`bad arena code: ${reason}`);
  }
}

// ------------------------------------------------------------------ crc / base64

let CRC: Uint32Array | null = null;
export function crc32(b: Uint8Array, n = b.length): number {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[i] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < n; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function b64url(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < b.length) s += B64[(n >> 6) & 63];
    if (i + 2 < b.length) s += B64[n & 63];
  }
  return s;
}
export function unb64url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new ArenaCodeError('base64');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = B64.indexOf(s[i]);
    const b = B64.indexOf(s[i + 1]);
    const c = i + 2 < s.length ? B64.indexOf(s[i + 2]) : 0;
    const d = i + 3 < s.length ? B64.indexOf(s[i + 3]) : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = (n >> 16) & 255;
    if (i + 2 < s.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < s.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

// ------------------------------------------------------------------ body

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

/** The binary body (with its CRC) of a normalised arena. */
export function packArena(raw: CustomArena): Uint8Array {
  const a = normalizeArena(raw);
  const bytes: number[] = [];
  const str = (s: string) => {
    const b = enc.encode(s).subarray(0, 255);
    bytes.push(b.length, ...b);
  };
  const r = a.rules;
  bytes.push(1, SIZES.findIndex((s) => s.id === a.size));
  str(a.name);
  str(r.biome);
  bytes.push(WAVE_IDS.indexOf(r.waves));
  bytes.push(r.foes.length);
  for (const f of r.foes) str(f);
  bytes.push(Math.round(r.time / 10));
  str(r.boss);
  str(r.difficulty);
  bytes.push((+r.night) | (+r.rain << 1) | (+r.wind << 2) | (+r.events << 3) | (+r.rings << 4));
  bytes.push(r.heat.length);
  for (const h of r.heat) str(h);
  bytes.push(a.pieces.length >> 8, a.pieces.length & 255);
  for (const p of a.pieces) bytes.push((PIECE_ORDER.indexOf(p.k) << 2) | (p.r & 3), p.x + 128, p.z + 128);
  const out = new Uint8Array(bytes.length + 4);
  out.set(bytes);
  const c = crc32(out, bytes.length);
  out[bytes.length] = c >>> 24;
  out[bytes.length + 1] = (c >>> 16) & 255;
  out[bytes.length + 2] = (c >>> 8) & 255;
  out[bytes.length + 3] = c & 255;
  return out;
}

/** Body -> arena. Throws ArenaCodeError on a bad checksum or a truncated/garbled body. */
export function unpackArena(b: Uint8Array): CustomArena {
  if (b.length < 8 || b.length > MAX_BODY) throw new ArenaCodeError('size');
  const n = b.length - 4;
  const want = ((b[n] << 24) | (b[n + 1] << 16) | (b[n + 2] << 8) | b[n + 3]) >>> 0;
  if (crc32(b, n) !== want) throw new ArenaCodeError('checksum');
  let o = 0;
  const u8 = () => {
    if (o >= n) throw new ArenaCodeError('format');
    return b[o++];
  };
  const str = () => {
    const len = u8();
    if (o + len > n) throw new ArenaCodeError('format');
    const s = dec.decode(b.subarray(o, o + len));
    o += len;
    return s;
  };
  if (u8() !== 1) throw new ArenaCodeError('format');
  const size = SIZES[u8()]?.id;
  const name = str();
  const biome = str();
  const waves = WAVE_IDS[u8()];
  const foes: string[] = [];
  for (let i = u8(); i > 0; i--) foes.push(str());
  const time = u8() * 10;
  const boss = str();
  const difficulty = str();
  const f = u8();
  const heat: string[] = [];
  for (let i = u8(); i > 0; i--) heat.push(str());
  const count = (u8() << 8) | u8();
  if (o + count * 3 !== n) throw new ArenaCodeError('format');
  const pieces: { k: string; x: number; z: number; r: number }[] = [];
  for (let i = 0; i < count; i++) {
    const kr = u8();
    const k = PIECE_ORDER[kr >> 2];
    if (!k) throw new ArenaCodeError('format');
    pieces.push({ k, r: kr & 3, x: u8() - 128, z: u8() - 128 });
  }
  return normalizeArena({
    v: 1,
    name,
    size,
    pieces,
    rules: { biome, waves, foes, time, boss, difficulty, night: !!(f & 1), rain: !!(f & 2), wind: !!(f & 4), events: !!(f & 8), rings: !!(f & 16), heat },
  });
}

// ------------------------------------------------------------------ codes

/** Plain (uncompressed) code: sync, used by the network start message too. */
export function arenaCode(a: CustomArena): string {
  return CODE_PREFIX + b64url(packArena(a));
}

async function pipe(b: Uint8Array, stream: CompressionStream | DecompressionStream, cap = Infinity): Promise<Uint8Array> {
  const reader = new Blob([b as BlobPart]).stream().pipeThrough(stream).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      throw new ArenaCodeError('size');
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Shortest code: deflated when CompressionStream exists and it helps. */
export async function arenaCodeSmall(a: CustomArena): Promise<string> {
  const raw = packArena(a);
  const plain = CODE_PREFIX + b64url(raw);
  if (typeof CompressionStream === 'undefined') return plain;
  try {
    const z = CODE_PREFIX_Z + b64url(await pipe(raw, new CompressionStream('deflate-raw')));
    return z.length < plain.length ? z : plain;
  } catch {
    return plain;
  }
}

/** Pull the code out of pasted text (whitespace and line breaks from chat apps are ignored). */
function extract(text: string): string {
  if (text.length > MAX_CODE * 2) throw new ArenaCodeError('size');
  const s = text.replace(/\s+/g, '');
  const i = s.indexOf('ISA1');
  if (i < 0) throw new ArenaCodeError('prefix');
  const code = s.slice(i).match(/^ISA1z?\.[A-Za-z0-9_-]*/)?.[0];
  if (!code) throw new ArenaCodeError('prefix');
  if (code.length > MAX_CODE) throw new ArenaCodeError('size');
  return code;
}

/** Plain codes only (sync). Throws ArenaCodeError. */
export function readArenaCodeSync(text: string): CustomArena {
  const code = extract(text);
  if (code.startsWith(CODE_PREFIX_Z)) throw new ArenaCodeError('inflate');
  return unpackArena(unb64url(code.slice(CODE_PREFIX.length)));
}

/** Any code (plain or deflated). Throws ArenaCodeError. */
export async function readArenaCode(text: string): Promise<CustomArena> {
  const code = extract(text);
  if (!code.startsWith(CODE_PREFIX_Z)) return unpackArena(unb64url(code.slice(CODE_PREFIX.length)));
  if (typeof DecompressionStream === 'undefined') throw new ArenaCodeError('inflate');
  let body: Uint8Array;
  try {
    body = await pipe(unb64url(code.slice(CODE_PREFIX_Z.length)), new DecompressionStream('deflate-raw'), MAX_BODY);
  } catch (e) {
    throw e instanceof ArenaCodeError ? e : new ArenaCodeError('inflate');
  }
  return unpackArena(body);
}
