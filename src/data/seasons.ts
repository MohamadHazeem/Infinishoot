/** UTC calendar windows; the host freezes its selection for the whole session. */
export interface SeasonDef {
  id: string;
  name: string;
  from: number;
  through: number;
  stageInLoop: number;
  biome: string;
  boss: string;
}
export const SEASONS: readonly SeasonDef[] = [
  {
    id: 'halloween',
    name: 'Halloween',
    from: 1015,
    through: 1107,
    stageInLoop: 2,
    biome: 'meadow:haunted',
    boss: 'pumpking',
  },
];
export function seasonAt(date = new Date(), force?: string | null): SeasonDef | null {
  if (force === 'off') return null;
  const forced = SEASONS.find((s) => s.id === force);
  if (forced) return forced;
  const day = (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  return (
    SEASONS.find((s) =>
      s.from <= s.through ? day >= s.from && day <= s.through : day >= s.from || day <= s.through,
    ) ?? null
  );
}
/** Separate from pure biome rotation so calendar changes never alter a running host session. */
export const seasonSession: { id: string | null } = { id: null };
export function seasonalStage(stage: number, id = seasonSession.id): SeasonDef | null {
  return (
    SEASONS.find(
      (s) => s.id === id && ((Math.max(1, Math.floor(stage)) - 1) % 4) + 1 === s.stageInLoop,
    ) ?? null
  );
}
export const HALLOWEEN_COSMETICS = [
  {
    id: 'pumpkin_helmet',
    name: 'Pumpkin Helmet',
    cost: 35,
    desc: 'A grinning jack-o’-lantern helmet.',
    color: '#ef7d57',
  },
  {
    id: 'bat_pet',
    name: 'Bat Pet',
    cost: 55,
    desc: 'A tiny bat friend. Cosmetic only.',
    color: '#b13e53',
  },
  {
    id: 'ghost_trail',
    name: 'Ghost Trail',
    cost: 45,
    desc: 'A little procession of friendly spirits.',
    color: '#73eff7',
  },
] as const;
export interface SeasonSave {
  candy: number;
  owned: string[];
  equipped: string[];
}
export function normalizeSeason(raw: unknown): SeasonSave {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SeasonSave>;
  const owned = Array.isArray(r.owned)
    ? [...new Set(r.owned.filter((id) => HALLOWEEN_COSMETICS.some((c) => c.id === id)))]
    : [];
  return {
    candy: Number.isFinite(r.candy) ? Math.min(999999, Math.max(0, Math.floor(r.candy!))) : 0,
    owned,
    equipped: Array.isArray(r.equipped)
      ? [...new Set(r.equipped.filter((id) => owned.includes(id)))]
      : [],
  };
}
export function buyCandyCosmetic(wallet: SeasonSave, id: string, active: boolean): boolean {
  const item = HALLOWEEN_COSMETICS.find((c) => c.id === id);
  if (!active || !item || wallet.owned.includes(id) || wallet.candy < item.cost) return false;
  wallet.candy -= item.cost;
  wallet.owned.push(id);
  return true;
}
export const halloweenTuning = {
  candyCap: 64,
  dropEvery: 5,
  pickupRadius: 2.2,
  witchEvery: 24,
  swarmEvery: 18,
  seedCount: 5,
  vineRadius: 2.3,
  vineWarning: 1.15,
  spinRadius: 5,
  spinWarning: 1.35,
};
