import type { BufferAttribute, InterleavedBuffer } from 'three';

/** Coalesce pending writes even if a bot, a hidden mesh or a paused tab skips the GPU draw. */
export function particleUpload(
  buffer: BufferAttribute | InterleavedBuffer,
  start: number,
  end: number,
): void {
  if (end <= start) return;
  const pending = buffer.updateRanges[0];
  if (pending) {
    end = Math.max(end, pending.start + pending.count);
    pending.start = Math.min(start, pending.start);
    pending.count = end - pending.start;
  } else buffer.addUpdateRange(start, end - start);
  buffer.needsUpdate = true;
}
