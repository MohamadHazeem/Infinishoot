/** Run metadata is small, immutable between starts, and mirrored in host snapshots. */
import type { Game } from '../game';
import { cleanHeat, heatMultiplier, heatPoints, boltReward, type HeatId } from '../../data/heat';
import { weeklyChallenge, type WeeklyRule } from '../../data/weekly';
import { save, markCodex, persist, recordWeekly, unlockMeta } from '../save';
import { biomeForStage } from '../../data/biomes';
import type { RunSummary } from '../../ui/screens';

export class MetaRun {
  heat: HeatId[] = [];
  week = '';
  rules: WeeklyRule[] = [];
  banked = false;
  get points(): number {
    return heatPoints(this.heat);
  }
  get multiplier(): number {
    return heatMultiplier(this.heat);
  }
  has(id: HeatId): boolean {
    return this.heat.includes(id);
  }
  rule(id: WeeklyRule): boolean {
    return this.rules.includes(id);
  }
  get label(): string {
    return this.week
      ? `WEEKLY ${this.week}`
      : this.points
        ? `HEAT ${this.points} · ×${this.multiplier.toFixed(1)}`
        : '';
  }
}
export function startMeta(g: Game): void {
  const m = g.meta;
  m.banked = false;
  m.week = g.runMode === 'weekly' && !g.pvp ? weeklyChallenge().week : '';
  m.rules = m.week ? weeklyChallenge(m.week).rules.map((r) => r.id) : [];
  m.heat = m.week || g.runMode === 'daily' || g.pvp ? [] : cleanHeat(save.meta.heat);
  if (m.week) {
    g.seed = weeklyChallenge(m.week).seed;
    // Same starting hero, kit, auto-weapon pool and pet for every weekly entrant.
    for (const h of g.heroes) {
      h.setHeroDef('rookie');
      h.loadoutPick = { primary: 'buster', secondary: 'charge', special: 'bomb' };
      h.unlocked = ['drones', 'aura', 'lightning', 'discs', 'missiles', 'mines', 'nova', 'fire'];
      h.setPet('none');
    }
  }
}
export function visitMeta(g: Game): void {
  if (g.mode === 'title') return;
  markCodex(`biome:${biomeForStage(g.stage).id}`);
  markCodex(`hero:${g.hero.heroDef.id}`);
}
export function recordHeatClear(g: Game, clears = g.victories): void {
  if (!g.pvp && clears > 0 && g.meta.points > (save.meta.bestHeat[g.runMode] ?? 0)) {
    save.meta.bestHeat[g.runMode] = g.meta.points;
    unlockMeta();
    persist();
  }
}
export function bankMeta(g: Game, sum: RunSummary): number {
  if (g.meta.banked || g.pvp) return 0;
  g.meta.banked = true;
  recordHeatClear(g, sum.clears ?? g.victories);
  const bolts = boltReward(sum.kills, sum.bosses ?? g.bossesRun, g.meta.heat);
  save.meta.bolts += bolts;
  if (g.meta.week) recordWeekly(g.meta.week, sum.score, sum.stage);
  unlockMeta();
  persist();
  return bolts;
}
export function applyMetaSnapshot(g: Game, raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const m = raw as { heat?: unknown; week?: unknown; mode?: unknown; clears?: number };
  const heat = cleanHeat(m.heat);
  if (g.meta.heat.join() !== heat.join()) g.meta.heat = heat;
  const week = typeof m.week === 'string' && /^\d{4}-W\d{2}$/.test(m.week) ? m.week : '';
  if (week !== g.meta.week) {
    g.meta.week = week;
    g.meta.rules = week ? weeklyChallenge(week).rules.map((r) => r.id) : [];
  }
  g.runMode = week ? 'weekly' : 'standard';
  g.victories = Number(m.clears) || 0;
  recordHeatClear(g);
  visitMeta(g);
}
