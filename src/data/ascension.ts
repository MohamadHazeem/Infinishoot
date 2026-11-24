/** Cumulative solo challenge rules. Level N includes every rule from 1 through N. */
import { loadJson, saveJson } from '../core/storage';

export { ASCENSIONS } from './ascension2';
export function ascensionLevel(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(20, Math.floor(n))) : 0;
}
export function ascensionRules(level: number) {
  const tier = ascensionLevel(level);
  return { tier, speed: 1, hp: 1, count: 1, damage: 1,
    chest: tier >= 19 ? 1 / 5 : tier >= 13 ? 1 / 3 : tier >= 6 ? 1 / 2 : 1,
    doubleElites: tier >= 5, noHeal: tier >= 8, attacks: Number(tier >= 7) + Number(tier >= 14) + Number(tier >= 20) };
}
export const ASCENSION_TITLES = ['BRONZE CLIMBER', 'SKY CLIMBER', 'STAR CLIMBER', 'SUMMIT LEGEND'] as const;
export const LOOP_MUTATORS = ['FAST ENEMIES', 'EXPLOSIVE DEATHS', 'MIRROR BARRAGE', 'DARKNESS'] as const;
/** Each late loop adds a modifier; repeated cycles strengthen the same four rules. */
export function loopMutators(stage: number): number[] {
  const n = Math.max(0, Math.ceil(stage / 4) - 4);
  return LOOP_MUTATORS.map((_, i) => Math.max(0, Math.ceil((n - i) / 4)));
}
export interface GauntletProfile {
  version: 1;
  unlocked: number;
  selected: number;
  victory: boolean;
  ng: boolean;
  cleared: number;
  title: number;
  badge: number;
}
export function normalizeGauntlet(raw: unknown): GauntletProfile {
  const r = raw && typeof raw === 'object' ? raw as Partial<GauntletProfile> : {};
  const unlocked = ascensionLevel(r.unlocked);
  const cleared = Math.min(unlocked, ascensionLevel(r.cleared));
  return { version: 1, unlocked, badge: Math.min(cleared, ascensionLevel(r.badge)), selected: Math.min(unlocked, ascensionLevel(r.selected)), victory: r.victory === true,
    ng: r.victory === true && r.ng === true, cleared, title: Math.max(0, Math.min(Math.floor(cleared / 5), Math.floor(Number(r.title) || 0))) };
}
export const gauntletProfile = normalizeGauntlet(loadJson('gauntlet.profile.v1', null));
export const persistGauntlet = () => saveJson('gauntlet.profile.v1', gauntletProfile);
/** Called only for an actual Omega kill in a qualifying solo run. */
export function recordAscensionVictory(level: number, hard: boolean): void {
  gauntletProfile.victory = true;
  if (hard) {
    if (level > gauntletProfile.cleared) gauntletProfile.badge = ascensionLevel(level);
    const titlesBefore = Math.floor(gauntletProfile.cleared / 5);
    gauntletProfile.cleared = Math.max(gauntletProfile.cleared, ascensionLevel(level));
    gauntletProfile.unlocked = Math.max(gauntletProfile.unlocked, Math.min(20, ascensionLevel(level) + 1));
    const titlesAfter = Math.floor(gauntletProfile.cleared / 5);
    if (titlesAfter > titlesBefore) gauntletProfile.title = titlesAfter;
  }
  persistGauntlet();
}
export const gauntletScore = (seconds: number, kills: number): number => Math.floor(Math.max(0, seconds) * Math.max(0, kills));
export function rushSlot(stage: number, rosterSize: number) {
  const n = Math.max(1, rosterSize), index = Math.max(0, Math.floor(stage) - 1);
  return { index: index % n, lap: Math.floor(index / n) + 1, shop: (index + 1) % 2 === 0 };
}
