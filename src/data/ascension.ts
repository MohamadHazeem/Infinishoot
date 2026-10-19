/** Cumulative solo challenge rules. Level N includes every rule from 1 through N. */
import { loadJson, saveJson } from '../core/storage';

export const ASCENSIONS = [
  { name: 'Quick Feet', desc: 'Enemy movement +10%.', speed: 0.1 },
  { name: 'Reinforced', desc: 'Enemy life +15%.', hp: 0.15 },
  { name: 'Crowded', desc: 'Enemy count +15%.', count: 0.15 },
  { name: 'Hard Knocks', desc: 'Enemy damage +10%.', damage: 0.1 },
  { name: 'Double Trouble', desc: 'Elite modifier effects doubled.', doubleElites: true },
  { name: 'Lost Cargo', desc: 'Map chests arrive half as often.', chest: 0.5 },
  { name: 'Encore', desc: 'Bosses add a telegraphed bullet ring every 8 seconds.', attacks: 1 },
  { name: 'No Breather', desc: 'No automatic healing between stages.', noHeal: true },
  { name: 'Quicker Feet', desc: 'Enemy movement +10%.', speed: 0.1 },
  { name: 'Heavy Armour', desc: 'Enemy life +20%.', hp: 0.2 },
  { name: 'Overflow', desc: 'Enemy count +20%.', count: 0.2 },
  { name: 'Harder Knocks', desc: 'Enemy damage +15%.', damage: 0.15 },
  { name: 'Supply Drought', desc: 'Map chests arrive one third as often.', chest: 1 / 3 },
  { name: 'Double Encore', desc: 'Boss bonus rings have 16 bullets instead of 8.', attacks: 1 },
  { name: 'Overclocked', desc: 'Enemy movement +10%.', speed: 0.1 },
  { name: 'Fortified', desc: 'Enemy life +25%.', hp: 0.25 },
  { name: 'Packed House', desc: 'Enemy count +25%.', count: 0.25 },
  { name: 'Crushing Blows', desc: 'Enemy damage +20%.', damage: 0.2 },
  { name: 'Last Supplies', desc: 'Map chest cadence halves again.', chest: 0.5 },
  { name: 'Summit', desc: 'Enemy life +30%; boss bonus rings have 24 bullets.', hp: 0.3, attacks: 1 },
] as const;
export function ascensionLevel(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(20, Math.floor(n))) : 0;
}
export function ascensionRules(level: number) {
  const out = { speed: 1, hp: 1, count: 1, damage: 1, chest: 1, doubleElites: false, noHeal: false, attacks: 0 };
  for (const r of ASCENSIONS.slice(0, ascensionLevel(level))) {
    if ('speed' in r) out.speed += r.speed;
    if ('hp' in r) out.hp += r.hp;
    if ('count' in r) out.count += r.count;
    if ('damage' in r) out.damage += r.damage;
    if ('chest' in r) out.chest = Math.min(out.chest, r.chest); // A19 halves the A13 cadence below
    if ('doubleElites' in r) out.doubleElites = true;
    if ('noHeal' in r) out.noHeal = true;
    if ('attacks' in r) out.attacks += r.attacks;
  }
  if (level >= 19) out.chest *= 0.5;
  return out;
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
}
export function normalizeGauntlet(raw: unknown): GauntletProfile {
  const r = raw && typeof raw === 'object' ? raw as Partial<GauntletProfile> : {};
  const unlocked = ascensionLevel(r.unlocked);
  const cleared = Math.min(unlocked, ascensionLevel(r.cleared));
  return { version: 1, unlocked, selected: Math.min(unlocked, ascensionLevel(r.selected)), victory: r.victory === true,
    ng: r.victory === true && r.ng === true, cleared, title: Math.max(0, Math.min(Math.floor(cleared / 5), Math.floor(Number(r.title) || 0))) };
}
export const gauntletProfile = normalizeGauntlet(loadJson('gauntlet.profile.v1', null));
export const persistGauntlet = () => saveJson('gauntlet.profile.v1', gauntletProfile);
/** Called only for an actual Omega kill in a qualifying solo run. */
export function recordAscensionVictory(level: number, hard: boolean): void {
  gauntletProfile.victory = true;
  if (hard) {
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
