/** Opt-in run handicaps. No profile bonus changes combat stats. */
export const HEAT = [
  { id: 'haste', name: 'Hot Wheels', desc: 'Enemies move 25% faster.', points: 1 },
  { id: 'armor', name: 'Heavy Metal', desc: 'Enemies have 35% more life.', points: 2 },
  { id: 'damage', name: 'Hard Knocks', desc: 'Enemies deal 25% more damage.', points: 1 },
  { id: 'crowds', name: 'Full House', desc: '25% more enemies in director waves.', points: 2 },
  { id: 'bullets', name: 'Fast Forward', desc: 'Enemy shots travel 35% faster.', points: 2 },
  { id: 'hearts', name: 'No Snacks', desc: 'Healing hearts do not drop.', points: 2 },
  { id: 'chests', name: 'Lost Cargo', desc: 'Map chests arrive half as often.', points: 1 },
  { id: 'shop', name: 'Inflation', desc: 'Shop Mods and their upgrades cost 50% more.', points: 1 },
  { id: 'dash', name: 'Heavy Boots', desc: 'Dash cooldown is 50% longer.', points: 2 },
] as const;
export type HeatId = (typeof HEAT)[number]['id'];
export function cleanHeat(raw: unknown): HeatId[] {
  return Array.isArray(raw) ? HEAT.filter((h) => raw.includes(h.id)).map((h) => h.id) : [];
}
export function heatPoints(ids: readonly string[]): number {
  return HEAT.reduce((n, h) => n + (ids.includes(h.id) ? h.points : 0), 0);
}
export const heatMultiplier = (ids: readonly string[]): number => 1 + heatPoints(ids) * 0.1;
export function boltReward(kills: number, bosses: number, heat: readonly string[]): number {
  return Math.floor(
    (Math.floor(Math.max(0, kills) / 25) + Math.max(0, bosses) * 10) * heatMultiplier(heat),
  );
}
