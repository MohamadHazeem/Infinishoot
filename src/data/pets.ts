/**
 * Pets: a little companion that floats beside your hero. Picked in
 * EXTRAS > WARDROBE; some unlock with achievements.
 */
export interface PetDef {
  id: string;
  name: string;
  desc: string;
  color: string;
  unlock?: string;
}

export const PETS: PetDef[] = [
  { id: 'none', name: 'No Pet', desc: 'Go it alone.', color: '#566c86' },
  { id: 'bit', name: 'Bit', desc: 'Fetches gems: +60% pickup range.', color: '#73eff7' },
  { id: 'guardian', name: 'Guardian', desc: 'Revives you once per run.', color: '#ffcd75', unlock: 'boss_slayer' },
  { id: 'sparky', name: 'Sparky', desc: 'Zaps the nearest enemy every 1.5 s.', color: '#fff35c', unlock: 'elite_hunter' },
];

export const PET_BY_ID = Object.fromEntries(PETS.map((p) => [p.id, p])) as Record<string, PetDef>;
