import type { Tag } from './tags';
import type { EnemyDef, Model } from './enemies';

export type Armour = 'plated' | 'ethereal' | 'shielded' | 'swarm';
export type WeakPoint = 'back' | 'core' | 'encounter';

export const armourTuning = {
  front: 0.6, rear: 1.5, arcCos: 0.5, projectile: 0.85,
  counter: 1.4, physical: 0.65, core: 2, coreOffset: 0.82, coreRadius: 0.28,
  recharge: 4, quietCueInterval: 0.35,
};

// One assignment per silhouette, shared by veterans and biome variants.
export const familyArmour: Partial<Record<Model, Armour>> = {
  charger: 'plated', soldier: 'plated', burrower: 'plated', snowball: 'plated',
  mirror: 'ethereal', ghost: 'ethereal', jellyfish: 'ethereal',
  shielder: 'shielded', swarmer: 'swarm', bee: 'swarm', bat: 'swarm',
};

export function armourOf(def: EnemyDef, elite: boolean): Armour | undefined {
  return def.armour ?? (elite && !def.hidden && !def.boss && !def.miniboss ? 'plated' : undefined);
}

export function countersArmour(tags: readonly Tag[], armour: Armour): boolean {
  switch (armour) {
    case 'plated': return tags.includes('explosive') || tags.includes('shock');
    case 'ethereal': return tags.includes('fire') || tags.includes('frost') || tags.includes('shock');
    case 'swarm': return tags.includes('area') || tags.includes('chain');
    case 'shielded': return false; // determined by the weapon slot
  }
}

export const armourTypes = ['plated', 'ethereal', 'shielded', 'swarm'] as const;
