/** Local, silent canvas highlights. Frames are JPEG-encoded off the main thread by the
 * browser; WebM encoding only runs on an explicit save. No screen/microphone permission. */
export const clipsTuning = { seconds: 15, fps: 20, width: 480, height: 270, jpeg: 0.65, postroll: 3, highlights: 8, ringBytes: 12 * 1024 * 1024, archiveBytes: 64 * 1024 * 1024 };
export type HighlightKind = 'boss' | 'combo' | 'revive' | 'legendary' | 'team' | 'flawless' | 'manual';
export interface ClipFrame { time: number; blob: Blob }
export interface Highlight { id: number; kind: HighlightKind; stage: number; time: number; frames: ClipFrame[]; end: number; ready: boolean }

/** Bounded by time, count AND bytes, including unusually noisy/large browser JPEGs. */
export class FrameRing {
  private slots: (ClipFrame | undefined)[];
  private head = 0;
  count = 0;
  bytes = 0;
  constructor(readonly capacity = clipsTuning.fps * clipsTuning.seconds + 1, readonly maxBytes = clipsTuning.ringBytes, readonly seconds = clipsTuning.seconds) { this.slots = new Array(capacity); }
  clear(): void { this.slots.fill(undefined); this.head = this.count = this.bytes = 0; }
  private shift(): void { const f = this.slots[this.head]!; this.bytes -= f.blob.size; this.slots[this.head] = undefined; this.head = (this.head + 1) % this.capacity; this.count--; }
  push(frame: ClipFrame): void {
    if (frame.blob.size > this.maxBytes || this.capacity < 1) return;
    while (this.count && (this.count === this.capacity || this.bytes + frame.blob.size > this.maxBytes || this.slots[this.head]!.time < frame.time - this.seconds)) this.shift();
    this.slots[(this.head + this.count++) % this.capacity] = frame;
    this.bytes += frame.blob.size;
  }
  snapshot(): ClipFrame[] { return Array.from({ length: this.count }, (_, i) => this.slots[(this.head + i) % this.capacity]!); }
}
export function clipsAllowed(enabled: boolean, quality: number, visible: boolean): boolean { return enabled && quality > 1 && visible; }
/** One mark per crossing, rearmed only after the combo breaks below 500. */
export class ComboTrigger {
  private above = false;
  check(combo: number): boolean { const hit = combo >= 500; const fire = hit && !this.above; this.above = hit; return fire; }
  reset(): void { this.above = false; }
}
export function clipMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
}
export class HighlightRecorder {
  readonly ring = new FrameRing();
  readonly highlights: Highlight[] = [];
  readonly combo = new ComboTrigger();
  recording = false;
  failed = false;
  exporting = false;
  onChange: (() => void) | null = null;
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D;
  private clock = 0;
  private next = 0;
  private busy = false;
  private generation = 0;
  private sequence = 0;
  private abort?: AbortController;
  private support?: boolean;
  private lastMarks = new Map<HighlightKind, number>();
  get supported(): boolean { return this.support ??= !!clipMime() && typeof HTMLCanvasElement !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream && typeof createImageBitmap === 'function'; }
  reset(): void {
    this.abort?.abort(); this.generation++; this.busy = false; this.recording = false; this.failed = false;
    this.ring.clear(); this.highlights.length = 0; this.combo.reset(); this.lastMarks.clear(); this.clock = this.next = 0; this.onChange?.();
  }
  stop(clear = false): void {
    if (this.recording) { this.recording = false; this.generation++; this.busy = false; this.flush(); }
    if (clear) this.ring.clear();
  }
  flush(): void { let changed = false; for (const h of this.highlights) if (!h.ready) { h.ready = true; changed = true; } if (changed) this.onChange?.(); }
  /** Called immediately AFTER WebGL submission, before its drawing buffer is discarded. */
  capture(source: HTMLCanvasElement, dt: number): void {
    if (this.failed || !this.supported) return;
    this.recording = true;
    this.clock += Math.min(Math.max(dt, 0), 0.1);
    if (this.busy || this.clock + 1e-6 < this.next) return;
    this.next = this.clock + 1 / clipsTuning.fps;
    try {
      if (!this.canvas) {
        this.canvas = document.createElement('canvas'); this.canvas.width = clipsTuning.width; this.canvas.height = clipsTuning.height;
        this.ctx = this.canvas.getContext('2d', { alpha: false }) ?? undefined;
      }
      if (!this.ctx) throw new Error('Canvas unavailable');
      // Letterbox ultrawide/portrait views instead of stretching them.
      const scale = Math.min(this.canvas.width / source.width, this.canvas.height / source.height);
      const w = source.width * scale, h = source.height * scale;
      this.ctx.fillStyle = '#1a1c2c'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(source, (this.canvas.width - w) / 2, (this.canvas.height - h) / 2, w, h);
      this.busy = true;
      const generation = this.generation, time = this.clock;
      this.canvas.toBlob(blob => {
        if (generation !== this.generation) return;
        this.busy = false;
        if (blob) this.addFrame({ time, blob });
        else { this.failed = true; this.stop(true); }
      }, 'image/jpeg', clipsTuning.jpeg);
    } catch { this.failed = true; this.stop(true); }
  }
  /** Public for deterministic frame/retention tests. */
  addFrame(frame: ClipFrame): void {
    this.ring.push(frame);
    let changed = false, pending = false;
    for (const h of this.highlights) {
      if (h.ready) continue;
      pending = true;
      if (!h.frames.length || frame.time > h.frames[h.frames.length - 1].time) h.frames.push(frame);
      while (h.frames.length > 1 && h.frames[0].time < frame.time - clipsTuning.seconds) h.frames.shift();
      if (frame.time >= h.end) { h.ready = true; changed = true; }
    }
    if (pending) this.trim();
    if (changed) this.onChange?.();
  }
  mark(kind: HighlightKind, stage: number, time: number, immediate = false): Highlight | undefined {
    if (!this.recording || !this.ring.count || this.clock - (this.lastMarks.get(kind) ?? -Infinity) < 3) return;
    this.lastMarks.set(kind, this.clock);
    const h: Highlight = { id: ++this.sequence, kind, stage, time, frames: this.ring.snapshot(), end: this.clock + clipsTuning.postroll, ready: immediate };
    this.highlights.push(h); this.trim(); this.onChange?.(); return h;
  }
  private trim(): void {
    // Conservative accounting double-counts shared frames; actual resident bytes are lower.
    let bytes = 0;
    for (const h of this.highlights) for (const f of h.frames) bytes += f.blob.size;
    while (this.highlights.length > clipsTuning.highlights || bytes > clipsTuning.archiveBytes) {
      const old = this.highlights.shift()!; for (const f of old.frames) bytes -= f.blob.size;
    }
  }
  async save(h: Highlight): Promise<void> {
    if (this.exporting || !h.frames.length) throw new Error('Export busy or empty');
    this.exporting = true; this.abort = new AbortController(); this.onChange?.();
    try {
      const blob = await encodeClip(h.frames.slice(), this.abort.signal);
      if (this.abort.signal.aborted) throw new Error('Export cancelled');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `InfiniShoot-${h.kind}-stage${h.stage}-${h.id}.webm`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally { this.exporting = false; this.abort = undefined; this.onChange?.(); }
  }
}

/** Real-time encode keeps native browser video encoding dependency-free. Only one
 * decoded bitmap is resident. Tab hiding aborts rather than producing a broken clip. */
export async function encodeClip(frames: readonly ClipFrame[], signal?: AbortSignal): Promise<Blob> {
  const mimeType = clipMime();
  if (!mimeType || !frames.length) throw new Error('WebM unavailable');
  const canvas = document.createElement('canvas'); canvas.width = clipsTuning.width; canvas.height = clipsTuning.height;
  const ctx = canvas.getContext('2d', { alpha: false }); if (!ctx) throw new Error('Canvas unavailable');
  const stream = canvas.captureStream(clipsTuning.fps);
  let recorder: MediaRecorder | undefined;
  const chunks: Blob[] = [];
  let failure: Error | undefined;
  const hidden = () => { if (document.hidden) failure = new Error('Keep the game visible while saving'); };
  document.addEventListener('visibilitychange', hidden);
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 900_000 });
    const stopped = new Promise<void>(resolve => {
      recorder!.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder!.onerror = () => { failure = new Error('Video encoding failed'); };
      recorder!.onstop = () => resolve();
    });
    let started = 0;
    for (const f of frames) {
      if (signal?.aborted || document.hidden || failure) throw failure ?? new Error('Export cancelled');
      const bitmap = await createImageBitmap(f.blob);
      try {
        if (started) await new Promise(resolve => setTimeout(resolve, Math.max(0, started + (f.time - frames[0].time) * 1000 - performance.now())));
        if (signal?.aborted || failure) throw failure ?? new Error('Export cancelled');
        ctx.drawImage(bitmap, 0, 0);
        if (!started) { recorder.start(); started = performance.now(); }
      } finally { bitmap.close(); }
    }
    await new Promise(resolve => setTimeout(resolve, 1000 / clipsTuning.fps));
    if (failure || signal?.aborted) throw failure ?? new Error('Export cancelled');
    recorder.stop(); await stopped;
    if (!chunks.length) throw new Error('Empty recording');
    return new Blob(chunks, { type: mimeType });
  } finally {
    document.removeEventListener('visibilitychange', hidden);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    for (const track of stream.getTracks()) track.stop();
  }
}
