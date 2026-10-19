import type { EnemyDef } from '../../data/enemies';
/** Invisible, stationary weapon hit targets. Their health lives in the raid snapshot. */
export function raidDefs(): Record<string, EnemyDef> {
  const defs = Object.fromEntries(
    ['furnace', 'aegis', 'interceptor'].map((role, i) => [
      `hydra_${i}`,
      {
        id: `hydra_${i}`,
        name: `Hydra ${role}`,
        hidden: true,
        behavior: 'chase',
        model: 'bopper',
        hp: 1e7,
        speed: 0,
        radius: 2,
        bodyColor: '#3b5dc9',
        accentColor: '#ffcd75',
        contactDamage: 0,
        knockbackResist: 1,
        xp: 0,
        score: 0,
        minMinute: -1,
        weight: 0,
        titanPart: 'plate',
        material: 'metal',
      } as EnemyDef,
    ]),
  );
  defs.hydra = { ...defs.hydra_0, id: 'hydra', name: 'The Hydra Engine', model: 'rex' };
  return defs;
}
