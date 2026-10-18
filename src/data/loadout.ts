import { SPECIALS } from './specials';
import { WEAPONS } from './weapons';

/** What a player brings into a run: left click, right click and Q/E special. Fixed for the whole run. */
export interface Loadout {
  primary: string;
  secondary: string;
  special: string;
}

export type LoadoutSlot = keyof Loadout;

export const DEFAULT_LOADOUT: Loadout = { primary: 'buster', secondary: 'charge', special: 'bomb' };

/** Item ids that can go in a slot. */
export function loadoutOptions(slot: LoadoutSlot): string[] {
  if (slot === 'special') return Object.keys(SPECIALS);
  return Object.values(WEAPONS)
    .filter((d) => d.slot === slot)
    .map((d) => d.id);
}

/** A loadout with every slot holding a real item (unknown or still-locked ids fall back to the default). */
export function validLoadout(l?: Partial<Loadout> | null, unlocked?: string[]): Loadout {
  const out = { ...DEFAULT_LOADOUT };
  for (const slot of Object.keys(out) as LoadoutSlot[]) {
    const id = l?.[slot];
    if (typeof id === 'string' && loadoutOptions(slot).includes(id) && (!unlocked || unlocked.includes(id))) out[slot] = id;
  }
  return out;
}
