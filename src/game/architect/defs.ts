import type { EnemyDef } from '../../data/enemies';
/** Static hidden target proxies use the existing titanpart brain; this lane draws them. */
const target: EnemyDef = {
  id: 'architect_core', name: 'Architect Core', behavior: 'titanpart', model: 'omega', hidden: true,
  titanPart: 'eye', hp: 1000, speed: 0, radius: 1.4, bodyColor: '#73eff7', accentColor: '#ffcd75',
  contactDamage: 0, knockbackResist: 1, xp: 0, score: 4000, minMinute: -1, weight: 0, material: 'shield', death: 'shards',
};
export const architectDefs: Record<string, EnemyDef> = {
  architect_core: target,
  architect: { ...target, id: 'architect', name: 'The Architect', title: 'THE MIND BEHIND THE OVERLORD',
    titanPart: undefined, boss: true, secret: true, phases: [0.66, 0.33], radius: 2.1, hp: 450000,
    bodyColor: '#29366f', accentColor: '#73eff7', xp: 800, score: 150000 },
};
