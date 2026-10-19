import { MOD_LIMITS } from './schema';
export interface ImportedFile { name: string; raw: string }
const decoder = new TextDecoder('utf-8', { fatal: true });
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of data) {
    crc ^= b;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
async function inflate(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const input = new Blob([data as Uint8Array<ArrayBuffer>]).stream();
  const reader = input.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > expected || size > MOD_LIMITS.bytes) { await reader.cancel(); throw new Error('ZIP entry exceeds its declared size'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const out = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}
/** Stored and Deflate ZIPs, read in memory only. Reject traversal, encryption, ZIP64 and zip bombs. */
export async function readModArchive(name: string, data: Uint8Array): Promise<ImportedFile[]> {
  if (data.length > MOD_LIMITS.totalBytes) throw new Error('Import exceeds 4 MiB');
  if (name.toLowerCase().endsWith('.json')) {
    if (data.length > MOD_LIMITS.bytes) throw new Error('JSON exceeds 512 KiB');
    return [{ name, raw: decoder.decode(data) }];
  }
  if (!name.toLowerCase().endsWith('.zip')) throw new Error('Choose a .json or .zip file');
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (at: number) => v.getUint16(at, true), u32 = (at: number) => v.getUint32(at, true);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === data.length) { end = i; break; }
  }
  if (end < 0) throw new Error('ZIP: missing end directory');
  const count = u16(end + 10), start = u32(end + 16), length = u32(end + 12);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || count > 128 || start + length !== end) throw new Error('ZIP: unsupported or oversized directory');
  let at = start, total = 0;
  const out: ImportedFile[] = [], names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) throw new Error('ZIP: invalid directory entry');
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16), packed = u32(at + 20), size = u32(at + 24);
    const n = u16(at + 28), extra = u16(at + 30), comment = u16(at + 32), local = u32(at + 42);
    if (at + 46 + n + extra + comment > end) throw new Error('ZIP: truncated filename');
    const file = decoder.decode(data.subarray(at + 46, at + 46 + n));
    at += 46 + n + extra + comment;
    if (!file || file.includes('\\') || file.startsWith('/') || /[\x00-\x1f:]/.test(file) || file.split('/').some(s => s === '..' || s === '.')) throw new Error('ZIP: unsafe file path');
    if (file.endsWith('/') || file.startsWith('__MACOSX/') || !file.toLowerCase().endsWith('.json')) continue;
    if (names.has(file)) throw new Error('ZIP: duplicate filename'); names.add(file);
    if ((flags & 1) || ![0, 8].includes(method) || size > MOD_LIMITS.bytes || packed > MOD_LIMITS.totalBytes || out.length >= MOD_LIMITS.files) throw new Error('ZIP: encrypted, unsupported or oversized JSON entry');
    total += size; if (total > MOD_LIMITS.totalBytes) throw new Error('ZIP: expanded data exceeds 4 MiB');
    if (local + 30 > start || u32(local) !== 0x04034b50 || u16(local + 8) !== method || u16(local + 6) !== flags) throw new Error('ZIP: invalid local header');
    const offset = local + 30 + u16(local + 26) + u16(local + 28);
    if (offset + packed > start || decoder.decode(data.subarray(local + 30, local + 30 + u16(local + 26))) !== file) throw new Error('ZIP: invalid entry bounds/name');
    const compressed = data.subarray(offset, offset + packed);
    const raw = method === 0 ? compressed : await inflate(compressed, size);
    if (raw.length !== size || crc32(raw) !== crc) throw new Error('ZIP: size/checksum mismatch');
    out.push({ name: file, raw: decoder.decode(raw) });
  }
  if (at !== end || !out.length) throw new Error('ZIP: no JSON mods or invalid directory');
  return out;
}
