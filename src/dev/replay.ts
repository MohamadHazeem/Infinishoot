/** Versioned, gzip-friendly event tape. Numeric chunks avoid per-step input allocations. */
export const REPLAY_VERSION = 1;
export const CHUNK = 16384;
export class Tape {
  chunks: Float64Array[] = [];
  length = 0;
  push(n: number): void {
    const c = Math.floor(this.length / CHUNK);
    if (!this.chunks[c]) this.chunks[c] = new Float64Array(CHUNK);
    this.chunks[c][this.length++ % CHUNK] = n;
  }
  at(i: number): number {
    if (!Number.isInteger(i) || i < 0 || i >= this.length) throw new Error(`Truncated replay at ${i}`);
    return this.chunks[Math.floor(i / CHUNK)][i % CHUNK];
  }
  json(): number[][] { return this.chunks.map((c, i) => Array.from(c.subarray(0, Math.min(CHUNK, this.length - i * CHUNK)))); }
  static from(chunks: number[][]): Tape {
    const t = new Tape();
    for (const c of chunks) {
      if (!Array.isArray(c) || c.length > CHUNK) throw new Error('Invalid replay chunk');
      for (const n of c) { if (!Number.isFinite(n)) throw new Error('Invalid replay number'); t.push(n); }
    }
    return t;
  }
}
export interface ReplayFile {
  version: number;
  header: Record<string, any>;
  strings: string[];
  data: number[][];
  steps: number;
  complete: boolean;
  crash?: string;
  hash?: number;
  checks?: Record<number, string>;
}
export function parseReplay(text: string): ReplayFile {
  if (text.length > 128 * 1024 * 1024) throw new Error('Replay exceeds 128 MiB');
  const r = JSON.parse(text) as ReplayFile;
  if (r.version !== REPLAY_VERSION) throw new Error('Unsupported replay version');
  if (!r.header || !Number.isFinite(r.header.seed) || !Array.isArray(r.strings) || !r.strings.every(s => typeof s === 'string') || !Array.isArray(r.data) || !Number.isInteger(r.steps) || r.steps < 0) throw new Error('Invalid replay header');
  Tape.from(r.data);
  return r;
}
/** FNV-1a over quantized simulation values, stable across JSON serialization. */
export function hashNumber(hash: number, n: number): number {
  const v = Math.round(n * 1e5);
  hash = Math.imul(hash ^ (v | 0), 16777619);
  return Math.imul(hash ^ (Math.floor(v / 4294967296) | 0), 16777619) >>> 0;
}
export function outsideTolerance(actual: number, baseline: number, relative = 0.25, absolute = 5): boolean {
  return !Number.isFinite(actual) || Math.abs(actual - baseline) > Math.max(absolute, Math.abs(baseline) * relative);
}
