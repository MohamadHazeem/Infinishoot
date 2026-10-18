/**
 * Rarity tiers shared by level-up cards (weapons, items) and shop Mods.
 * `weight` scales how often a tier is offered; each point of Luck multiplies
 * a tier's weight by (1 + luck * `luck`), so luck only lifts the rarer tiers.
 */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export const RARITY: Record<Rarity, { label: string; color: string; weight: number; luck: number }> = {
  common: { label: 'COMMON', color: '#94b0c2', weight: 1, luck: 0 },
  uncommon: { label: 'UNCOMMON', color: '#38b764', weight: 0.6, luck: 0.15 },
  rare: { label: 'RARE', color: '#41a6f6', weight: 0.3, luck: 0.3 },
  legendary: { label: 'LEGENDARY', color: '#ffcd75', weight: 0.045, luck: 0.6 },
};

export function rarityWeight(r: Rarity, luck: number): number {
  return RARITY[r].weight * (1 + luck * RARITY[r].luck);
}
