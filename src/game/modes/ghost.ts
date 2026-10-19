/**
 * Ghost racing (modes lane): a compact recording of a Weekly Challenge run (hero position and
 * facing at 10 Hz, stage starts and clears, boss kills, level-ups, death, and the score once a
 * second) that another player can race. Your best ghost per week is kept; it exports as a share
 * code (text) or a file, and uploads to the optional online board when one is configured. During
 * a weekly run the rival ghost runs beside you as a see-through hero with a live delta.
 *
 * Pure: recording, the binary format, codes, and the "how far ahead am I" maths. The Game side
 * is src/game/systems/modes.ts, the drawing src/render/modesView.ts, the screen src/ui/ghostScreen.ts.
 *
 * Format (version 1): "ISG" 1, then strings week, name, hero, then varints score, stage, length
 * (deciseconds), the samples (count, then zigzag dx, dz in decimetres from the previous sample and a
 * facing byte), the events (count, then varint deciseconds since the last event, a type byte and a
 * zigzag value) and the score track (count, then varint increments, one per second).
 * Codes are "ISG1." + base64url, or "ISG1z." + base64url of the deflated bytes (smaller, async).
 */

export const ghostTuning = {
  /** Samples per second. */
  hz: 10,
  /** Score samples per second. */
  scoreHz: 1,
  /** Longest recording kept (seconds of play; about an hour). */
  maxSeconds: 3600,
  /** Ghost opacity. */
  alpha: 0.55,
};

export const GhostEv = { StageStart: 1, StageClear: 2, Boss: 3, Level: 4, Death: 5 } as const;
export type GhostEv = (typeof GhostEv)[keyof typeof GhostEv];

export interface GhostEvent {
  /** Run time (seconds of play). */
  t: number;
  type: GhostEv;
  value: number;
}

export interface Ghost {
  week: string;
  name: string;
  hero: string;
  score: number;
  stage: number;
  /** Seconds of play recorded. */
  length: number;
  /** x, z (metres, 0.1 m steps) and facing (radians) per sample, at `ghostTuning.hz`. */
  xs: number[];
  zs: number[];
  fs: number[];
  events: GhostEvent[];
  /** Score at each whole second. */
  scores: number[];
}

export function emptyGhost(week: string, name: string, hero: string): Ghost {
  return { week, name, hero, score: 0, stage: 1, length: 0, xs: [], zs: [], fs: [], events: [], scores: [] };
}

// ------------------------------------------------------------------ recording

/** Records one run. Call `step` every simulation step with the run time. */
export class GhostRecorder {
  readonly g: Ghost;
  private nextSample = 0;
  private nextScore = 0;

  constructor(week: string, name: string, hero: string) {
    this.g = emptyGhost(week, name, hero);
  }

  step(t: number, x: number, z: number, facing: number, score: number, stage: number): void {
    const g = this.g;
    if (t > ghostTuning.maxSeconds) return;
    const dt = 1 / ghostTuning.hz;
    while (t >= this.nextSample) {
      g.xs.push(Math.round(x * 10) / 10);
      g.zs.push(Math.round(z * 10) / 10);
      g.fs.push(facing);
      this.nextSample += dt;
    }
    while (t >= this.nextScore) {
      g.scores.push(Math.floor(score));
      this.nextScore += 1 / ghostTuning.scoreHz;
    }
    g.length = Math.max(g.length, t);
    g.score = Math.max(g.score, Math.floor(score));
    g.stage = Math.max(g.stage, stage);
  }

  event(t: number, type: GhostEv, value: number): void {
    if (t > ghostTuning.maxSeconds) return;
    this.g.events.push({ t, type, value });
  }

  /** The finished run's final score and stage. */
  finish(score: number, stage: number, t: number): Ghost {
    this.g.score = Math.max(this.g.score, Math.floor(score));
    this.g.stage = Math.max(this.g.stage, stage);
    this.g.length = Math.max(this.g.length, Math.min(t, ghostTuning.maxSeconds));
    return this.g;
  }
}

/** Which of two ghosts of the same week is the better run (score, then stage, then faster). */
export function betterGhost(a: Ghost | null, b: Ghost | null): Ghost | null {
  if (!a) return b;
  if (!b) return a;
  if (a.score !== b.score) return a.score > b.score ? a : b;
  if (a.stage !== b.stage) return a.stage > b.stage ? a : b;
  return a.length <= b.length ? a : b;
}

// ------------------------------------------------------------------ playback

export interface GhostPose {
  x: number;
  z: number;
  facing: number;
  /** On this stage and alive. */
  visible: boolean;
  stage: number;
}

/** The ghost's stage at run time t (from its stage-start events). */
export function ghostStageAt(g: Ghost, t: number): number {
  let s = 1;
  for (const e of g.events) {
    if (e.t > t) break;
    if (e.type === GhostEv.StageStart) s = e.value;
  }
  return s;
}

function angLerp(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** Where the ghost is at run time t (interpolated between samples). */
export function ghostPose(g: Ghost, t: number, out: GhostPose = { x: 0, z: 0, facing: 0, visible: false, stage: 1 }): GhostPose {
  const n = g.xs.length;
  out.stage = ghostStageAt(g, t);
  if (!n) {
    out.visible = false;
    return out;
  }
  const f = Math.max(0, t * ghostTuning.hz);
  const i = Math.min(n - 1, Math.floor(f));
  const j = Math.min(n - 1, i + 1);
  const k = Math.min(1, f - i);
  // A teleport (stage change) between samples: don't slide across the map.
  const jump = Math.hypot(g.xs[j] - g.xs[i], g.zs[j] - g.zs[i]) > 4;
  out.x = jump ? g.xs[i] : g.xs[i] + (g.xs[j] - g.xs[i]) * k;
  out.z = jump ? g.zs[i] : g.zs[i] + (g.zs[j] - g.zs[i]) * k;
  out.facing = angLerp(g.fs[i], g.fs[j], k);
  const dead = g.events.some((e) => e.type === GhostEv.Death && e.t <= t);
  out.visible = t <= g.length && !dead;
  return out;
}

/** The ghost's score at run time t. */
export function ghostScoreAt(g: Ghost, t: number): number {
  const s = g.scores;
  if (!s.length) return 0;
  const f = Math.max(0, t * ghostTuning.scoreHz);
  const i = Math.min(s.length - 1, Math.floor(f));
  const j = Math.min(s.length - 1, i + 1);
  return s[i] + (s[j] - s[i]) * Math.min(1, f - i);
}

/** When the ghost first reached `score` (seconds), or Infinity if it never did. */
export function ghostTimeForScore(g: Ghost, score: number): number {
  const s = g.scores;
  if (!s.length || score > s[s.length - 1]) return Infinity;
  if (score <= s[0]) return 0;
  // Scores never go down: binary search the first sample at or over it, then interpolate.
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (s[m] >= score) hi = m;
    else lo = m + 1;
  }
  const a = s[lo - 1];
  const b = s[lo];
  const k = b > a ? (score - a) / (b - a) : 1;
  return (lo - 1 + k) / ghostTuning.scoreHz;
}

/**
 * The race at run time t with your score: `score` = points ahead (negative: behind); `seconds` =
 * how much sooner you got to your current score than the ghost did (negative: later). When the
 * ghost never reached your score, `seconds` is how long you've been past its whole run (null if
 * there is nothing to compare yet).
 */
export function ghostDelta(g: Ghost, t: number, myScore: number): { score: number; seconds: number | null } {
  const score = Math.round(myScore - ghostScoreAt(g, t));
  if (myScore <= 0) return { score, seconds: null };
  const tg = ghostTimeForScore(g, myScore);
  const seconds = Number.isFinite(tg) ? tg - t : Math.max(0, g.length - t);
  return { score, seconds: Math.round(seconds * 10) / 10 };
}

// ------------------------------------------------------------------ binary format

class Writer {
  private buf = new Uint8Array(1024);
  n = 0;
  private room(k: number): void {
    if (this.n + k <= this.buf.length) return;
    const b = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
    b.set(this.buf);
    this.buf = b;
  }
  byte(v: number): void {
    this.room(1);
    this.buf[this.n++] = v & 255;
  }
  uv(v: number): void {
    let x = Math.max(0, Math.floor(v));
    while (x >= 128) {
      this.byte((x % 128) | 128);
      x = Math.floor(x / 128);
    }
    this.byte(x);
  }
  sv(v: number): void {
    const x = Math.round(v);
    this.uv(x >= 0 ? x * 2 : -x * 2 - 1);
  }
  str(s: string): void {
    const b = new TextEncoder().encode(s.slice(0, 40));
    this.uv(b.length);
    this.room(b.length);
    this.buf.set(b, this.n);
    this.n += b.length;
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

class Reader {
  i = 0;
  constructor(private b: Uint8Array) {}
  byte(): number {
    if (this.i >= this.b.length) throw new Error('ghost data is cut short');
    return this.b[this.i++];
  }
  uv(): number {
    let x = 0;
    let mul = 1;
    for (let k = 0; k < 8; k++) {
      const c = this.byte();
      x += (c & 127) * mul;
      if (c < 128) return x;
      mul *= 128;
    }
    throw new Error('bad ghost number');
  }
  sv(): number {
    const u = this.uv();
    return u % 2 ? -(u + 1) / 2 : u / 2;
  }
  str(): string {
    const n = this.uv();
    if (n > 200 || this.i + n > this.b.length) throw new Error('bad ghost text');
    const s = new TextDecoder().decode(this.b.subarray(this.i, this.i + n));
    this.i += n;
    return s;
  }
}

const TAU = Math.PI * 2;

export function encodeGhost(g: Ghost): Uint8Array {
  const w = new Writer();
  for (const c of 'ISG') w.byte(c.charCodeAt(0));
  w.byte(1);
  w.str(g.week);
  w.str(g.name);
  w.str(g.hero);
  w.uv(g.score);
  w.uv(g.stage);
  w.uv(Math.round(g.length * 10));
  const n = g.xs.length;
  w.uv(n);
  let px = 0;
  let pz = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.round(g.xs[i] * 10);
    const z = Math.round(g.zs[i] * 10);
    w.sv(x - px);
    w.sv(z - pz);
    px = x;
    pz = z;
    w.byte(Math.round(((((g.fs[i] % TAU) + TAU) % TAU) / TAU) * 256) & 255);
  }
  w.uv(g.events.length);
  let pt = 0;
  for (const e of g.events) {
    const t = Math.round(e.t * 10);
    w.uv(Math.max(0, t - pt));
    pt = Math.max(pt, t);
    w.byte(e.type);
    w.sv(e.value);
  }
  w.uv(g.scores.length);
  let ps = 0;
  for (const s of g.scores) {
    w.sv(s - ps);
    ps = s;
  }
  return w.done();
}

export function decodeGhost(b: Uint8Array): Ghost {
  const r = new Reader(b);
  const magic = String.fromCharCode(r.byte(), r.byte(), r.byte());
  if (magic !== 'ISG') throw new Error('not a ghost');
  const ver = r.byte();
  if (ver !== 1) throw new Error(`ghost version ${ver} is newer than this game`);
  const g = emptyGhost(r.str(), r.str(), r.str());
  g.score = r.uv();
  g.stage = r.uv();
  g.length = r.uv() / 10;
  const n = r.uv();
  if (n > ghostTuning.maxSeconds * ghostTuning.hz + 10) throw new Error('ghost too long');
  let px = 0;
  let pz = 0;
  for (let i = 0; i < n; i++) {
    px += r.sv();
    pz += r.sv();
    g.xs.push(px / 10);
    g.zs.push(pz / 10);
    g.fs.push((r.byte() / 256) * TAU);
  }
  const ne = r.uv();
  let t = 0;
  for (let i = 0; i < ne; i++) {
    t += r.uv();
    g.events.push({ t: t / 10, type: r.byte() as GhostEv, value: r.sv() });
  }
  const ns = r.uv();
  let s = 0;
  for (let i = 0; i < ns; i++) {
    s += r.sv();
    g.scores.push(s);
  }
  return g;
}

// ------------------------------------------------------------------ codes

function b64url(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Plain share code (synchronous). */
export function ghostCode(g: Ghost): string {
  return 'ISG1.' + b64url(encodeGhost(g));
}

async function pipe(b: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  void w.write(b as Uint8Array<ArrayBuffer>);
  void w.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** Smaller share code (deflated) when the browser can compress; else the plain one. */
export async function ghostCodeSmall(g: Ghost): Promise<string> {
  const raw = encodeGhost(g);
  if (typeof CompressionStream === 'undefined') return 'ISG1.' + b64url(raw);
  try {
    return 'ISG1z.' + b64url(await pipe(raw, new CompressionStream('deflate-raw')));
  } catch {
    return 'ISG1.' + b64url(raw);
  }
}

/** Read a share code (either form; whitespace and a file's surrounding text are ignored). Throws with a readable message. */
export async function readGhostCode(text: string): Promise<Ghost> {
  const m = /ISG1(z?)\.([A-Za-z0-9_-]+)/.exec(text.replace(/\s+/g, ''));
  if (!m) throw new Error('That is not a ghost code (they start with ISG1)');
  const bytes = unb64url(m[2]);
  if (!m[1]) return decodeGhost(bytes);
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open packed ghost codes');
  return decodeGhost(await pipe(bytes, new DecompressionStream('deflate-raw')));
}

/** Read a plain (unpacked) code synchronously (null when it isn't one). */
export function readGhostCodeSync(text: string): Ghost | null {
  const m = /ISG1\.([A-Za-z0-9_-]+)/.exec(text.replace(/\s+/g, ''));
  if (!m) return null;
  try {
    return decodeGhost(unb64url(m[1]));
  } catch {
    return null;
  }
}

/** "+12.3 s" / "-4.0 s". */
export function signed(v: number, digits = 1): string {
  const s = Math.abs(v).toFixed(digits);
  return v >= 0 ? `+${s}` : `-${s}`;
}
