import { Rng } from '../core/rng';
import { weeklySeed } from './modes';

/**
 * Weekly Challenge mutators: two per ISO week, picked from the week's seed, so
 * everyone plays the same twisted rules that week. Behaviour lives in
 * src/game/systems/runMods.ts; the numbers in `mutatorTuning`.
 */
export type MutatorId = 'mitosis' | 'onearm' | 'glass' | 'giants' | 'goldrain' | 'horde' | 'turbo' | 'elitearmy' | 'gearhead';

export interface MutatorDef {
  id: MutatorId;
  name: string;
  desc: string;
  icon: string;
  color: string;
}

export const mutatorTuning = {
  perWeek: 2,
  mitosisCount: 2, // swarmers each slain enemy bursts into
  onearmCharge: 2, // special recharge speed x this
  glass: 2, // damage dealt and taken x this
  giantScale: 1.35,
  giantHp: 0.6,
  giantSpeed: -0.15,
  goldRain: 3, // gold drop chance x this
  hordeCount: 0.5,
  hordeHp: -0.35,
  turboSpeed: 0.25,
  turboDash: -0.3, // dash recharge time
  eliteArmy: 0.5, // seconds between elites x this
  gearsPerStage: 2,
};

export const MUTATORS: MutatorDef[] = [
  { id: 'mitosis', name: 'Mitosis', desc: 'Every slain enemy bursts into two Swarmers.', icon: '⁘', color: '#a7f070' },
  { id: 'onearm', name: 'One-Armed', desc: 'No right click. Specials recharge twice as fast.', icon: '✋', color: '#ef7d57' },
  { id: 'glass', name: 'Glass World', desc: 'Everyone deals and takes double damage.', icon: '◇', color: '#73eff7' },
  { id: 'giants', name: 'Giants', desc: 'Enemies are bigger, with 60% more life, and a bit slower.', icon: '▲', color: '#f4f4f4' },
  { id: 'goldrain', name: 'Gold Rain', desc: 'Enemies drop three times the gold.', icon: '●', color: '#ffcd75' },
  { id: 'horde', name: 'Horde', desc: '50% more enemies, with 35% less life.', icon: '☠', color: '#94b0c2' },
  { id: 'turbo', name: 'Turbo', desc: 'Enemies move 25% faster; your dash recharges 30% faster.', icon: '»', color: '#41a6f6' },
  { id: 'elitearmy', name: 'Elite Army', desc: 'Elites arrive twice as often.', icon: '♛', color: '#ef7d57' },
  { id: 'gearhead', name: 'Gear Head', desc: 'Two free gears every stage, but no hearts drop.', icon: '⚙', color: '#38b764' },
];

export const MUTATOR_BY_ID = Object.fromEntries(MUTATORS.map((m) => [m.id, m])) as Record<MutatorId, MutatorDef>;

/** This week's mutators: a pure function of the ISO week ("2026-W43"). */
export function weeklyMutators(week: string): MutatorId[] {
  const rng = new Rng(weeklySeed(week) ^ 0x6d757461);
  const pool = MUTATORS.map((m) => m.id);
  const out: MutatorId[] = [];
  while (out.length < mutatorTuning.perWeek && pool.length) out.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
  return out;
}

export function isMutatorId(id: unknown): id is MutatorId {
  return typeof id === 'string' && id in MUTATOR_BY_ID;
}
