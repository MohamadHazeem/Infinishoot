/**
 * Hero skins: colour sets unlocked by achievements. In solo the skin also
 * paints the armour; in co-op the armour keeps the player's colour (so
 * teammates stay easy to tell apart) and the skin paints everything else.
 */
export interface SkinDef {
  id: string;
  name: string;
  /** Achievement that unlocks it (none = always available). */
  unlock?: string;
  armor: string;
  accent: string;
  suit: string;
  hair: string;
  gem: string;
  /** Eye colour on the painted face. */
  iris: string;
}

export const SKINS: SkinDef[] = [
  { id: 'classic', name: 'Classic', armor: '#2f7bff', accent: '#ffd23f', suit: '#2b2f4a', hair: '#5a3a22', gem: '#ff3d5a', iris: '#2a9d4b' },
  { id: 'crimson', name: 'Crimson', unlock: 'first_steps', armor: '#e8364f', accent: '#f4f4f4', suit: '#29213a', hair: '#1a1c2c', gem: '#ffd23f', iris: '#b13e53' },
  { id: 'forest', name: 'Forest Ranger', unlock: 'boss_slayer', armor: '#38b764', accent: '#a7f070', suit: '#3b2a1e', hair: '#a86a3c', gem: '#ffcd75', iris: '#257179' },
  { id: 'gold', name: 'Gold Rush', unlock: 'elite_hunter', armor: '#ffb627', accent: '#fff4c9', suit: '#5d275d', hair: '#ef7d57', gem: '#41a6f6', iris: '#b5651d' },
  { id: 'shadow', name: 'Shadow', unlock: 'exterminator', armor: '#333c57', accent: '#b13e53', suit: '#1a1c2c', hair: '#f4f4f4', gem: '#73eff7', iris: '#b13e53' },
  { id: 'ice', name: 'Ice Runner', unlock: 'speedster', armor: '#73eff7', accent: '#f4f4f4', suit: '#29366f', hair: '#41a6f6', gem: '#3b5dc9', iris: '#3b5dc9' },
  { id: 'candy', name: 'Candy Pop', unlock: 'arsenal', armor: '#ff7eb6', accent: '#73eff7', suit: '#5d275d', hair: '#ffcd75', gem: '#a7f070', iris: '#d43d8f' },
  { id: 'prism', name: 'Prism', unlock: 'evolved', armor: '#f4f4f4', accent: '#ff3df0', suit: '#3b5dc9', hair: '#73eff7', gem: '#ffd23f', iris: '#7d3dff' },
  { id: 'magma', name: 'Magma Core', unlock: 'stage_3', armor: '#ff5d3a', accent: '#ffd23f', suit: '#1a1c2c', hair: '#b13e53', gem: '#ffcd75', iris: '#ff7a2f' },
  // Heat milestones (src/data/heat.ts).
  { id: 'ember', name: 'Ember', unlock: 'heat_4', armor: '#ef7d57', accent: '#333c57', suit: '#5d275d', hair: '#ffcd75', gem: '#73eff7', iris: '#ef7d57' },
  { id: 'inferno', name: 'Inferno', unlock: 'heat_10', armor: '#b13e53', accent: '#ffcd75', suit: '#1a1c2c', hair: '#ef7d57', gem: '#ffcd75', iris: '#ffcd75' },
  { id: 'solar', name: 'Solar', unlock: 'heat_20', armor: '#ffcd75', accent: '#ef7d57', suit: '#f4f4f4', hair: '#b13e53', gem: '#3b5dc9', iris: '#b13e53' },
];

export const SKIN_BY_ID = Object.fromEntries(SKINS.map((s) => [s.id, s])) as Record<string, SkinDef>;

export function skinOf(id: string | undefined): SkinDef {
  return SKIN_BY_ID[id ?? ''] ?? SKINS[0];
}
