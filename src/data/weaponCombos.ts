/**
 * Weapon combos: owning both weapons of a pair unlocks a bonus effect.
 * Weapons check `ctx.combos.has(id)`.
 */
export interface WeaponComboDef {
  id: string;
  name: string;
  weapons: [string, string];
  desc: string;
  color: string;
}

export const WEAPON_COMBOS: WeaponComboDef[] = [
  { id: 'superconductor', name: 'Superconductor', weapons: ['nova', 'lightning'], desc: 'Chain Zap jumps 2 more times and hits frozen enemies twice as hard.', color: '#7df9ff' },
  { id: 'firestorm', name: 'Firestorm', weapons: ['fire', 'missiles'], desc: 'Seeker Pod blasts set enemies on fire.', color: '#ff7a2f' },
  { id: 'tesla_drones', name: 'Tesla Drones', weapons: ['drones', 'aura'], desc: 'Orbit Drones shock what they hit.', color: '#3de0c8' },
  { id: 'cryo_mines', name: 'Cryo Mines', weapons: ['mines', 'nova'], desc: 'Pop Mine blasts freeze survivors.', color: '#9fe8ff' },
  { id: 'ricochet', name: 'Ricochet', weapons: ['buster', 'discs'], desc: 'Buster shots pierce 1 more enemy.', color: '#ff3df0' },
  { id: 'napalm_mines', name: 'Napalm Mines', weapons: ['mines', 'fire'], desc: 'Pop Mine blasts set enemies on fire.', color: '#ff9f3d' },
];

/** Combos active for a set of owned weapon ids. */
export function activeCombos(owned: readonly string[]): WeaponComboDef[] {
  return WEAPON_COMBOS.filter((c) => owned.includes(c.weapons[0]) && owned.includes(c.weapons[1]));
}
