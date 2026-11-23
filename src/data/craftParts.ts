import type { Tag } from './tags';
import type { WeaponDef } from './weapons';

export const FRAMES = ['projector', 'orbiter', 'lobber', 'beam', 'field'] as const;
export const CORES = ['fire', 'frost', 'shock', 'explosive', 'chain'] as const;
export const MODIFIERS = ['split', 'pierce', 'bounce', 'home', 'linger'] as const;
export type Frame = (typeof FRAMES)[number];
export type Core = (typeof CORES)[number];
export type Modifier = (typeof MODIFIERS)[number];
export const PARTS = [...FRAMES, ...CORES, ...MODIFIERS];
export type Part = (typeof PARTS)[number];
export interface Recipe {
  frame: Frame;
  core: Core | null;
  mod: Modifier | null;
}
export const sockets = ['frame', 'core', 'mod'] as const;
export const craftTuning = {
  price: [7, 12, 18],
  damage: 80,
  barePower: 0.15,
  corePower: 0.46,
  dropChance: 0.45,
  coreLevel: 6,
  modLevel: 12,
};
export const FRAME: Record<
  Frame,
  { cd: number; reach: number; radius: number; power: number; tag: Tag }
> = {
  projector: { cd: 0.64, reach: 15, radius: 1.8, power: 0.83, tag: 'projectile' },
  orbiter: { cd: 0.7, reach: 7, radius: 4.35, power: 2.15, tag: 'orbit' },
  lobber: { cd: 1.55, reach: 17, radius: 3.8, power: 1.42, tag: 'explosive' },
  beam: { cd: 0.9, reach: 14, radius: 0.85, power: 1.12, tag: 'projectile' },
  field: { cd: 1.25, reach: 7, radius: 6.75, power: 1.22, tag: 'area' },
};
export const CORE_COLOR: Record<Core, string> = {
  fire: '#ef7d57',
  frost: '#73eff7',
  shock: '#ffcd75',
  explosive: '#b13e53',
  chain: '#41a6f6',
};
export const CRAFT_DEF: WeaponDef = {
  id: 'crafted',
  name: 'Workshop weapon',
  icon: '⚙',
  color: '#73eff7',
  rarity: 'rare',
  starter: false,
  tags: [],
  desc: 'Fit a frame, core and modifier at the workbench.',
  levels: [{ text: 'Powered by fitted parts.', p: {} }],
};
export function socketOf(part: Part) {
  return sockets[Math.floor(PARTS.indexOf(part) / 5)];
}
export function partPrice(part: Part) {
  return craftTuning.price[Math.floor(PARTS.indexOf(part) / 5)];
}

// Stable indices on the wire and in the discovery journal.
export const INTERACTIONS = [
  'crossfeed',
  'standing',
  'thermal',
  'induction',
  'concussion',
  'ratchet',
  'sight',
  'afterheat',
] as const;
export const Crossfeed = 1,
  Standing = 2,
  Thermal = 4,
  Induction = 8,
  Concussion = 16,
  Ratchet = 32,
  Sight = 64,
  Afterheat = 128;
export function craftInteractions(r: Recipe, has: (tag: Tag) => boolean): number {
  let mask = 0;
  if ((r.frame === 'projector' || r.frame === 'beam') && has('projectile')) mask |= Crossfeed;
  if ((r.frame === 'orbiter' || r.frame === 'lobber' || r.frame === 'field') && has('area'))
    mask |= Standing;
  if ((r.core === 'fire' || r.core === 'frost') && has('projectile')) mask |= Thermal;
  if ((r.core === 'chain' || r.core === 'shock') && (has('orbit') || has('chain')))
    mask |= Induction;
  if (r.core === 'explosive' && has('area')) mask |= Concussion;
  if ((r.mod === 'split' || r.mod === 'bounce') && has('projectile')) mask |= Ratchet;
  if ((r.mod === 'pierce' || r.mod === 'home') && has('area')) mask |= Sight;
  if (r.mod === 'linger' && (has('fire') || has('frost'))) mask |= Afterheat;
  return mask;
}
