/**
 * Breakable static cover (fixes lane): ruin walls, ruin pillars, trees and
 * rocks are merged into a few meshes (src/render/mergeStatic.ts), which
 * records each one's triangle range. Rampage Rex (and Rex Jr.) charging into
 * one smashes it for real: its triangles collapse, its collider goes and the
 * wall grid is rebuilt, with debris, dust and a crash.
 *
 * Co-op: the host broadcasts `{ t: 'cover', i, s }` (index into this arena's
 * cover list, which every machine builds in the same seeded order, and the
 * arena stage); clients hide the same prop and drop its collider. Effects go
 * through the vfx bus as usual.
 */
import type { Game } from './game';
import type { Arena } from '../world/fieldArena';
import type { AABB } from '../world/collision';
import { StaticBoxGrid } from '../core/spatialHash';
import { hideMergedRanges, type MergedRange } from '../render/mergeStatic';
import { SCAR_COLORS } from './scars';

export const coverTuning = {
  /** Extra reach (m) beyond the charger's radius that smashes cover. */
  reach: 0.4,
  /** Cover bigger than this (longest side, m) never breaks. */
  maxSize: 6,
};

interface CoverState {
  arena: Arena | null;
  boxes: AABB[];
  ranges: (MergedRange[] | undefined)[];
  broken: boolean[];
}

const states = new WeakMap<Game, CoverState>();

/** This arena's breakable cover, built lazily in the seeded collider order (same on every machine). */
function coverOf(g: Game): CoverState {
  let s = states.get(g);
  if (!s) {
    s = { arena: null, boxes: [], ranges: [], broken: [] };
    states.set(g, s);
  }
  if (s.arena !== g.arena) {
    s.arena = g.arena;
    const map = g.arena.group.userData.coverRanges as Map<unknown, MergedRange[]> | undefined;
    s.boxes = map ? g.arena.colliders.filter((b) => map.has(b)) : [];
    s.ranges = s.boxes.map((b) => map?.get(b));
    s.broken = s.boxes.map(() => false);
  }
  return s;
}

/** Index of an unbroken cover box overlapping the circle, or -1. */
export function coverAt(boxes: AABB[], broken: boolean[], x: number, z: number, r: number, maxSize = coverTuning.maxSize): number {
  for (let i = 0; i < boxes.length; i++) {
    if (broken[i]) continue;
    const b = boxes[i];
    if (Math.max(b.maxX - b.minX, b.maxZ - b.minZ) > maxSize) continue;
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return i;
  }
  return -1;
}

/** Hide cover i and drop its collider (every machine). Returns its box, or null if already gone. */
function breakLocal(g: Game, s: CoverState, i: number): AABB | null {
  if (i < 0 || i >= s.boxes.length || s.broken[i]) return null;
  s.broken[i] = true;
  const box = s.boxes[i];
  const r = s.ranges[i];
  if (r) hideMergedRanges(r);
  const k = g.arena.colliders.indexOf(box);
  if (k >= 0) {
    g.arena.colliders.splice(k, 1);
    g.walls = new StaticBoxGrid(g.arena.colliders);
  }
  return box;
}

/** Host/solo: a charging boss at (x, z) with radius r smashes any cover it touches. Returns how many broke. */
export function smashCover(g: Game, x: number, z: number, r: number): number {
  if (!g.authority) return 0;
  const s = coverOf(g);
  let n = 0;
  for (let guard = 0; guard < 4; guard++) {
    const i = coverAt(s.boxes, s.broken, x, z, r + coverTuning.reach);
    if (i < 0) break;
    const box = breakLocal(g, s, i);
    if (!box) break;
    n++;
    g.host?.broadcast({ t: 'cover', i, s: g.arenaStage });
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    const size = Math.max(box.maxX - box.minX, box.maxZ - box.minZ);
    g.vfx.burst(cx, 1, cz, { count: 18 + Math.round(size * 4), color: '#94b0c2', color2: '#566c86', speed: [4, 11], size: [0.25, 0.55], life: [0.5, 0.9], up: 8, gravity: 18, debris: 8 });
    g.vfx.burst(cx, 0.8, cz, { count: 8, color: '#c2c3c7', color2: '#f4f4f4', speed: [1, 3], size: [0.5, 0.9], life: [0.6, 1.1], up: 2, drag: 3, smoke: 6, scorch: 0 });
    g.vfx.scar(cx, cz, Math.min(2.4, 0.6 + size * 0.35), SCAR_COLORS.crater, 12);
    g.vfx.num(cx, 2.6, cz, 'CRASH!', 'crit');
    g.vfx.sound('coverBreak', cx, cz, 1.6);
    g.vfx.sound('impact', cx, cz, 0.6);
    g.vfx.shake(cx, cz, 0.5);
  }
  return n;
}

/** Client: the host smashed cover i on arena stage `stage`. */
export function onCoverMsg(g: Game, m: Record<string, unknown>): void {
  if (Number(m.s) !== g.arenaStage) return;
  breakLocal(g, coverOf(g), Number(m.i));
}

/** Tests and debug: how many breakable covers this arena has, and how many are broken. */
export function coverStats(g: Game): { total: number; broken: number } {
  const s = coverOf(g);
  return { total: s.boxes.length, broken: s.broken.filter(Boolean).length };
}
