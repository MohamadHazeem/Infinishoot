/**
 * Editing operations on a custom arena (editor lane): place, erase, rotate.
 * Pure, mutate the arena they're given, and report why something failed so the
 * editor can say it. Objects (cover, toys, markers) may not overlap each other;
 * ground pieces (hazard patches, belts) lie under anything.
 */
import { SIZE_HALF, countOf, insideArena, pieceAt, type ArenaPiece, type CustomArena } from './arenaData';
import { MAX_PIECES, PIECE_BY_ID, footprint } from './pieces';

export type PlaceResult = 'ok' | 'moved' | 'bounds' | 'max' | 'full' | 'overlap';

const ground = (p: ArenaPiece) => !!PIECE_BY_ID[p.k].round || p.k === 'belt';

function overlaps(a: ArenaPiece, b: ArenaPiece): boolean {
  const fa = footprint(a.k, a.r);
  const fb = footprint(b.k, b.r);
  return Math.abs(a.x - b.x) < (fa.w + fb.w) / 2 - 0.01 && Math.abs(a.z - b.z) < (fa.d + fb.d) / 2 - 0.01;
}

/** The first object piece (not `skip`) that `p` would overlap, or -1. Ground pieces never collide. */
export function blockerOf(a: CustomArena, p: ArenaPiece, skip = -1): number {
  if (ground(p)) return -1;
  for (let i = 0; i < a.pieces.length; i++) {
    if (i === skip) continue;
    const q = a.pieces[i];
    if (!ground(q) && overlaps(p, q)) return i;
  }
  return -1;
}

/** Place a piece. A one-only piece (the boss marker) moves instead of failing at its cap. */
export function placePiece(a: CustomArena, p: ArenaPiece): PlaceResult {
  const def = PIECE_BY_ID[p.k];
  if (!def) return 'bounds';
  if (!insideArena(p.k, p.x, p.z, p.r, SIZE_HALF[a.size])) return 'bounds';
  let moveFrom = -1;
  if (countOf(a, p.k) >= def.max) {
    if (def.max !== 1) return 'max';
    moveFrom = a.pieces.findIndex((q) => q.k === p.k);
  } else if (a.pieces.length >= MAX_PIECES) return 'full';
  if (blockerOf(a, p, moveFrom) >= 0) return 'overlap';
  if (moveFrom >= 0) {
    a.pieces[moveFrom] = { ...p };
    return 'moved';
  }
  a.pieces.push({ ...p });
  return 'ok';
}

/** Remove the topmost piece under (x, z). Returns the removed piece or null. */
export function erasePiece(a: CustomArena, x: number, z: number): ArenaPiece | null {
  const i = pieceAt(a, x, z);
  if (i < 0) return null;
  return a.pieces.splice(i, 1)[0];
}

/** Turn the piece under (x, z) a quarter (or grow a hazard). False if nothing there or it wouldn't fit turned. */
export function rotatePieceAt(a: CustomArena, x: number, z: number, dir = 1): boolean {
  const i = pieceAt(a, x, z);
  if (i < 0) return false;
  const p = a.pieces[i];
  const turned = { ...p, r: (p.r + dir + 4) % 4 };
  if (!insideArena(turned.k, turned.x, turned.z, turned.r, SIZE_HALF[a.size]) || blockerOf(a, turned, i) >= 0) return false;
  a.pieces[i] = turned;
  return true;
}

/** Change the size preset, dropping pieces that no longer fit. Returns how many were dropped. */
export function resizeArena(a: CustomArena, size: CustomArena['size']): number {
  const before = a.pieces.length;
  a.size = size;
  a.pieces = a.pieces.filter((p) => insideArena(p.k, p.x, p.z, p.r, SIZE_HALF[size]));
  return before - a.pieces.length;
}

/** Snap a world position to the editor grid: even metres with GRID on, whole metres with it off. */
export function snapPos(v: number, snap: boolean): number {
  return snap ? Math.round(v / 2) * 2 : Math.round(v);
}
