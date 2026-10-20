/**
 * Sample arenas (editor lane): starting points in the editor's NEW menu and
 * the `&arena=demo` / `&arena=fortress` test links. Built through
 * normalizeArena like anything else; a unit test checks they're valid.
 */
import { defaultRules, normalizeArena, type ArenaPiece, type CustomArena } from './arenaData';
import type { PieceId } from './pieces';

const P = (k: PieceId, x: number, z: number, r = 0): ArenaPiece => ({ k, x, z, r });

/** Four copies of a piece turned around the centre (r follows the turn for directed pieces). */
function quad(k: PieceId, x: number, z: number, r = 0, turnR = true): ArenaPiece[] {
  return [P(k, x, z, r), P(k, -z, x, turnR ? (r + 1) % 4 : r), P(k, -x, -z, turnR ? (r + 2) % 4 : r), P(k, z, -x, turnR ? (r + 3) % 4 : r)];
}

export const SAMPLE_IDS = ['demo', 'fortress', 'pit'] as const;
export type SampleId = (typeof SAMPLE_IDS)[number];

export function sampleArena(id: SampleId): CustomArena {
  switch (id) {
    case 'demo':
      return normalizeArena({
        v: 1,
        name: 'SUNNY PLAZA',
        size: 'm',
        rules: { ...defaultRules(), biome: 'meadow', time: 180 },
        pieces: [
          P('hero', 0, 6), P('hero', -3, 6), P('hero', 3, 6), P('hero', 0, 9),
          P('boss', 0, -20),
          ...quad('wall', 10, 10, 0, true),
          ...quad('block', 16, 4, 0, false),
          P('longwall', -14, -12), P('longwall', 14, -12),
          P('pillar', -6, -6), P('pillar', 6, -6), P('topple', -6, 14), P('topple', 6, 14),
          P('lava', -20, -6, 1), P('ice', 20, -6, 1), P('water', -22, 18, 2), P('sand', 22, 18, 0), P('thorns', 0, 24, 0),
          P('belt', -26, 0, 3), P('belt', 26, 0, 1),
          P('pad', -28, -26, 0), P('pad', 28, -26, 2),
          P('turret', -12, 2), P('turret', 12, 2),
          P('chest', -28, 28), P('chest', 28, 28), P('chest', 5, -30),
          P('gate', 0, -31, 1), P('gate', -31, -16, 0), P('gate', 31, -16, 2),
          P('crate', 8, 20), P('stack', 10, 20), P('barrel', 12, 21), P('barrel', 6, 22),
          P('tree', -10, 22), P('tree', -13, 24), P('tree', -8, 26),
          P('rock', 18, -24), P('rock', 21, -22), P('rock', -18, -24),
        ],
      });
    case 'fortress':
      return normalizeArena({
        v: 1,
        name: 'WINDY KEEP',
        size: 's',
        rules: { ...defaultRules(), biome: 'sky', time: 150, waves: 'shooters', boss: 'gale', night: true, wind: true },
        pieces: [
          P('hero', -2, 14), P('hero', 2, 14),
          P('boss', 0, -8),
          ...quad('wall', 7, 7, 0, true),
          ...quad('pillar', 13, 0, 0, false),
          P('longwall', 0, 4),
          P('crate', -16, 16), P('stack', 16, 16), P('barrel', -16, -16), P('barrel', 16, -16),
          P('pad', -18, 6, 3), P('pad', 18, 6, 3),
          P('chest', -18, -14), P('chest', 18, -14),
          P('gate', -20, 0, 0), P('gate', 20, 0, 2),
        ],
      });
    case 'pit':
      return normalizeArena({
        v: 1,
        name: 'LAVA PIT',
        size: 'm',
        rules: { ...defaultRules(), biome: 'magma', time: 210, waves: 'brutes', boss: 'rex', rings: false },
        pieces: [
          P('hero', 0, 18), P('hero', -3, 20), P('hero', 3, 20),
          P('boss', 0, -2),
          ...quad('lava', 0, 12, 2, false),
          ...quad('lava', 12, 12, 1, false),
          ...quad('rock', 24, 6, 0, false),
          ...quad('barrel', 6, 20, 0, false),
          ...quad('wall', 20, 20, 0, true),
          P('belt', -26, 0, 1), P('belt', 26, 0, 3),
          P('turret', 0, 26),
          P('chest', -24, 26), P('chest', 24, -26),
        ],
      });
  }
}
