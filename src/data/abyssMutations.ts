import { Rng } from '../core/rng';

type Mutation =
  | { name: string; kind: 'patrol'; enemy: string; escort: string }
  | { name: string; kind: 'mine' | 'haste' | 'shell'; enemy: string }
  | { name: string; kind: 'bounty'; enemy: string; drop: 'Heart' | 'Gear' | 'Bolt' | 'Magnet' };

/** Each weekly deck deals every card once before the next shuffled deck. */
export const ABYSS_MUTATIONS: readonly Mutation[] = [
  { name: 'Picket Line', kind: 'patrol', enemy: 'shielder', escort: 'shooter' },
  { name: 'First Responders', kind: 'patrol', enemy: 'medic', escort: 'charger' },
  { name: 'Long Division', kind: 'patrol', enemy: 'splitter', escort: 'sniper' },
  { name: 'Wind-up Band', kind: 'patrol', enemy: 'spinner', escort: 'bopper' },
  { name: 'Crossfire Club', kind: 'patrol', enemy: 'burster', escort: 'shooter' },
  { name: 'Spring Patrol', kind: 'patrol', enemy: 'leaper', escort: 'zippy' },
  { name: 'Mortar Crew', kind: 'patrol', enemy: 'mortar', escort: 'shielder' },
  { name: 'Heavy Freight', kind: 'patrol', enemy: 'chonk', escort: 'medic' },
  { name: 'Spark Plugs', kind: 'mine', enemy: 'bopper' },
  { name: 'Cracked Shells', kind: 'mine', enemy: 'chonk' },
  { name: 'Firecrackers', kind: 'mine', enemy: 'shooter' },
  { name: 'Split Fuses', kind: 'mine', enemy: 'splitter' },
  { name: 'Hot Springs', kind: 'mine', enemy: 'leaper' },
  { name: 'Flash Bulbs', kind: 'mine', enemy: 'spinner' },
  { name: 'Red Wheels', kind: 'haste', enemy: 'bopper' },
  { name: 'Fast Post', kind: 'haste', enemy: 'shooter' },
  { name: 'Express Freight', kind: 'haste', enemy: 'chonk' },
  { name: 'Quick March', kind: 'haste', enemy: 'shielder' },
  { name: 'Flying Doctors', kind: 'haste', enemy: 'medic' },
  { name: 'Silver Jackets', kind: 'shell', enemy: 'zippy' },
  { name: 'Armoured Coil', kind: 'shell', enemy: 'spinner' },
  { name: 'Tin Drums', kind: 'shell', enemy: 'burster' },
  { name: 'Plated Springs', kind: 'shell', enemy: 'leaper' },
  { name: 'Copper Barrel', kind: 'shell', enemy: 'sniper' },
  { name: 'Heart Courier', kind: 'bounty', enemy: 'charger', drop: 'Heart' },
  { name: 'Pocket Change', kind: 'bounty', enemy: 'bopper', drop: 'Bolt' },
  { name: 'Spare Parts', kind: 'bounty', enemy: 'shielder', drop: 'Gear' },
  { name: 'Lodestones', kind: 'bounty', enemy: 'splitter', drop: 'Magnet' },
  { name: 'Field Hospital', kind: 'bounty', enemy: 'medic', drop: 'Heart' },
  { name: 'Gear Train', kind: 'bounty', enemy: 'spinner', drop: 'Gear' },
];

export function mutationDeck(seed: number, cycle: number): number[] {
  const rng = new Rng(seed ^ Math.imul(cycle + 1, 0x9e3779b1));
  const deck = ABYSS_MUTATIONS.map((_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
