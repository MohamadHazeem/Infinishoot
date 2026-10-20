/**
 * Arena editor pieces (editor lane): everything a player can place on a custom
 * arena. Footprints are in metres before rotation (odd quarter turns swap w and
 * d); the arena builder (src/editor/build.ts) and the collider/validity code
 * (src/editor/arenaData.ts) both read them, so what you see in the editor is
 * what blocks you in the game.
 *
 * PIECE_ORDER is the wire order of share codes and start messages: append new
 * pieces at the end, never reorder or remove (old codes would decode wrong).
 */
export type PieceId =
  | 'wall' | 'longwall' | 'block' | 'pillar' | 'topple' | 'rock' | 'tree' | 'crate' | 'stack' | 'barrel'
  | 'lava' | 'ice' | 'sand' | 'thorns' | 'water'
  | 'turret' | 'pad' | 'belt'
  | 'hero' | 'boss' | 'chest' | 'gate';

export type PieceGroup = 'cover' | 'hazard' | 'toy' | 'marker';

export interface PieceDef {
  id: PieceId;
  group: PieceGroup;
  /** Footprint (metres) at rotation 0; round hazards use `radius` instead. */
  w: number;
  d: number;
  /** Blocks movement and bullets (a collider). */
  solid?: boolean;
  /** Breakable or explosive cover (drawn by the interactives / barrels). */
  breakable?: boolean;
  /** Round ground patch: rotation picks the radius (HAZARD_RADII). */
  round?: boolean;
  /** Rotation is a direction (pads, belts, gates) rather than a footprint turn. */
  directed?: boolean;
  /** Most of these on one arena. */
  max: number;
  /** Editor colour (Sweetie 16) and a two-letter tag for the palette and map. */
  color: string;
  tag: string;
}

/** Radius (metres) of a round hazard for rotation 0..3. */
export const HAZARD_RADII = [2, 3, 4, 5] as const;
/** Jump pads land this far along their direction. */
export const PAD_RANGE = 12;
/** Conveyor belts: length along the direction, width across. */
export const BELT_LEN = 10;
export const BELT_WIDE = 2.4;
/** Every piece together. Keeps start messages and share codes small. */
export const MAX_PIECES = 320;

export const PIECES: PieceDef[] = [
  { id: 'wall', group: 'cover', w: 4, d: 1, solid: true, max: 120, color: '#a7f070', tag: 'WL' },
  { id: 'longwall', group: 'cover', w: 8, d: 1, solid: true, max: 60, color: '#38b764', tag: 'LW' },
  { id: 'block', group: 'cover', w: 2, d: 2, solid: true, max: 80, color: '#94b0c2', tag: 'BK' },
  { id: 'pillar', group: 'cover', w: 1.2, d: 1.2, solid: true, max: 60, color: '#f4f4f4', tag: 'PL' },
  { id: 'topple', group: 'cover', w: 1.2, d: 1.2, solid: true, breakable: true, max: 12, color: '#ffcd75', tag: 'TP' },
  { id: 'rock', group: 'cover', w: 1.65, d: 1.65, solid: true, max: 80, color: '#566c86', tag: 'RK' },
  { id: 'tree', group: 'cover', w: 0.8, d: 0.8, solid: true, max: 80, color: '#257179', tag: 'TR' },
  { id: 'crate', group: 'cover', w: 1.2, d: 1.2, solid: true, breakable: true, max: 60, color: '#ef7d57', tag: 'CR' },
  { id: 'stack', group: 'cover', w: 1.2, d: 1.2, solid: true, breakable: true, max: 40, color: '#b13e53', tag: 'ST' },
  { id: 'barrel', group: 'cover', w: 0.9, d: 0.9, solid: true, breakable: true, max: 40, color: '#ff4d5e', tag: 'BR' },
  { id: 'lava', group: 'hazard', w: 0, d: 0, round: true, max: 16, color: '#ef7d57', tag: 'LV' },
  { id: 'ice', group: 'hazard', w: 0, d: 0, round: true, max: 16, color: '#73eff7', tag: 'IC' },
  { id: 'sand', group: 'hazard', w: 0, d: 0, round: true, max: 16, color: '#ffcd75', tag: 'QS' },
  { id: 'thorns', group: 'hazard', w: 0, d: 0, round: true, max: 16, color: '#38b764', tag: 'TH' },
  { id: 'water', group: 'hazard', w: 0, d: 0, round: true, max: 16, color: '#41a6f6', tag: 'WA' },
  { id: 'turret', group: 'toy', w: 1.8, d: 1.8, max: 6, color: '#94b0c2', tag: 'TU' },
  { id: 'pad', group: 'toy', w: 1.8, d: 1.8, directed: true, max: 8, color: '#41a6f6', tag: 'JP' },
  { id: 'belt', group: 'toy', w: BELT_LEN, d: BELT_WIDE, directed: true, max: 8, color: '#566c86', tag: 'CB' },
  { id: 'hero', group: 'marker', w: 1.4, d: 1.4, max: 8, color: '#3b5dc9', tag: 'P' },
  { id: 'boss', group: 'marker', w: 3, d: 3, max: 1, color: '#b13e53', tag: 'B' },
  { id: 'chest', group: 'marker', w: 1.2, d: 1.2, max: 8, color: '#ffcd75', tag: 'CH' },
  { id: 'gate', group: 'marker', w: 1.6, d: 1.6, directed: true, max: 6, color: '#5d275d', tag: 'EG' },
];

export const PIECE_BY_ID = Object.fromEntries(PIECES.map((p) => [p.id, p])) as Record<PieceId, PieceDef>;
/** Wire order (share codes, start messages). Append only. */
export const PIECE_ORDER: PieceId[] = ['wall', 'longwall', 'block', 'pillar', 'topple', 'rock', 'tree', 'crate', 'stack', 'barrel', 'lava', 'ice', 'sand', 'thorns', 'water', 'turret', 'pad', 'belt', 'hero', 'boss', 'chest', 'gate'];

/** Unit direction for a directed piece's rotation: 0 = +X (east), 1 = +Z (south on screen), 2 = -X, 3 = -Z. */
export function dirOf(r: number): { x: number; z: number } {
  const k = ((r % 4) + 4) % 4;
  return { x: k === 0 ? 1 : k === 2 ? -1 : 0, z: k === 1 ? 1 : k === 3 ? -1 : 0 };
}

/** Footprint (w along X, d along Z) of a piece at a rotation. Round pieces report their diameter. */
export function footprint(id: PieceId, r: number): { w: number; d: number } {
  const def = PIECE_BY_ID[id];
  if (def.round) {
    const R = HAZARD_RADII[((r % 4) + 4) % 4];
    return { w: R * 2, d: R * 2 };
  }
  return r % 2 ? { w: def.d, d: def.w } : { w: def.w, d: def.d };
}
