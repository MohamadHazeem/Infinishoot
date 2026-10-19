import type { AchievementDef } from './meta';

/**
 * Co-op achievements (trading lane). Each one also earns a co-op title, shown
 * on your player card in the lobby, the in-run team panel and the TRADE menu;
 * the best title you hold (highest rank) is the one shown. Appended to
 * ACHIEVEMENTS at the bottom of src/data/meta.ts, so they show on UNLOCKS and
 * save like any other achievement. Granted in src/game/systems/trading.ts
 * (`checkTradeAchievements`) from this machine's own co-op run.
 */
export interface CoopAchievementDef extends AchievementDef {
  /** The title it earns. */
  title: string;
  /** Higher ranks win when picking the title to show. */
  rank: number;
  /** Title chip colour (Sweetie 16). */
  color: string;
}

export const COOP_ACHIEVEMENTS: CoopAchievementDef[] = [
  { id: 'co_gift', name: 'Sharing Is Caring', desc: 'Give a teammate gold, a gear or a relic', title: 'GOOD SPORT', rank: 1, color: '#a7f070' },
  { id: 'co_buddy', name: 'Better Together', desc: 'Defeat a boss in co-op', title: 'BUDDY', rank: 2, color: '#73eff7' },
  { id: 'co_heirloom', name: 'Heirloom', desc: 'Give a teammate one of your relics', title: 'HEIRLOOM KEEPER', rank: 3, color: '#b13e53' },
  { id: 'co_pool', name: 'Crowdfunded', desc: 'Complete a team pool in the shop', title: 'FUNDRAISER', rank: 4, color: '#ffcd75' },
  { id: 'co_patron', name: 'Patron', desc: 'Give teammates 150 gold in one run', title: 'PATRON', rank: 5, color: '#ef7d57' },
  { id: 'co_squad', name: 'Full Squad', desc: 'Clear a stage in co-op with 4 players', title: 'SQUAD LEADER', rank: 6, color: '#41a6f6' },
  { id: 'co_legend', name: 'Living Legend', desc: 'Clear stage 2 on Legend', title: 'LEGEND', rank: 8, color: '#ffcd75' },
  { id: 'co_mythic', name: 'Mythic', desc: 'Defeat the final boss on Legend', title: 'MYTHIC', rank: 10, color: '#f4f4f4' },
];

export const COOP_ACH_BY_ID = Object.fromEntries(COOP_ACHIEVEMENTS.map((a) => [a.id, a])) as Record<string, CoopAchievementDef>;

/** The title to show for a save's achievements: the highest-ranked co-op one, or null. */
export function bestTitle(achieved: readonly string[]): CoopAchievementDef | null {
  let best: CoopAchievementDef | null = null;
  for (const id of achieved) {
    const a = COOP_ACH_BY_ID[id];
    if (a && (!best || a.rank > best.rank)) best = a;
  }
  return best;
}

/** A title from the network: only known titles, by achievement id (so a client can't send markup). */
export function titleOf(id: unknown): CoopAchievementDef | null {
  return typeof id === 'string' ? COOP_ACH_BY_ID[id] ?? null : null;
}
