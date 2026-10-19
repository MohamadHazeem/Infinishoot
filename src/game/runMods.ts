import { loadJson, saveJson } from '../core/storage';
import { HEAT_MODS, cleanHeat, heatScoreMul, heatTotal, heatTuning, type HeatId, type HeatRanks } from '../data/heat';
import { MUTATOR_BY_ID, mutatorTuning, type MutatorId } from '../data/mutators';
import { ROUTE_BY_ID, routeTuning, type RouteId } from '../data/routes';

/** Curse-style team sums that heat and mutators add to (see Game.curseSum). */
export type ModSumKey = 'enemyHp' | 'enemySpeed' | 'enemyCount' | 'enemyDmg' | 'dmgTaken' | 'dashCd' | 'score';

/** An open route vote: the cards, each hero's vote (-1 = none yet) and seconds left (-1 = no timer). */
export interface RouteVote {
  stage: number;
  cards: RouteId[];
  votes: number[];
  left: number;
}

/**
 * Run-level rule changes from the RUN lane: the stage's route, the heat the run
 * was started with and the Weekly mutators. Pure state plus the knobs other
 * systems read; the Game methods that use it live in src/game/systems/runMods.ts.
 */
export class RunMods {
  heat: HeatRanks = {};
  mutators: MutatorId[] = [];
  /** Route of the coming / current stage (null: none). */
  route: RouteId | null = null;
  /** Host: the vote in progress. Client: the vote on screen. */
  vote: RouteVote | null = null;
  /** The stage whose route is settled, so closeShop() can carry on to the portal. */
  decidedFor = 0;
  /** Name of the curse the CURSED route took (for the stage banner). */
  routeCurse = '';

  reset(heat: HeatRanks = {}, mutators: MutatorId[] = []): void {
    this.heat = cleanHeat(heat);
    this.mutators = mutators.filter((m) => MUTATOR_BY_ID[m]);
    this.route = null;
    this.routeCurse = '';
    this.vote = null;
    this.decidedFor = 0;
  }

  rank(id: HeatId): number {
    return this.heat[id] ?? 0;
  }

  has(m: MutatorId): boolean {
    return this.mutators.includes(m);
  }

  get heatTotal(): number {
    return heatTotal(this.heat);
  }

  /** Added to the matching curse sum (enemy life, speed, count, damage, damage taken, dash cooldown, score). */
  sum(k: ModSumKey): number {
    const H = heatTuning;
    const M = mutatorTuning;
    switch (k) {
      case 'enemyHp':
        return H.hp * this.rank('hp') + (this.has('giants') ? M.giantHp : 0) + (this.has('horde') ? M.hordeHp : 0);
      case 'enemySpeed':
        return H.speed * this.rank('speed') + (this.has('giants') ? M.giantSpeed : 0) + (this.has('turbo') ? M.turboSpeed : 0);
      case 'enemyCount':
        return H.horde * this.rank('horde') + (this.has('horde') ? M.hordeCount : 0);
      case 'enemyDmg':
        return H.dmg * this.rank('dmg');
      case 'dmgTaken':
        return this.has('glass') ? M.glass - 1 : 0;
      case 'dashCd':
        return H.boots * this.rank('boots') + (this.has('turbo') ? M.turboDash : 0);
      case 'score':
        return heatScoreMul(this.heatTotal) - 1;
    }
  }

  /** Seconds between elites x this. */
  get eliteMul(): number {
    let m = 1 - heatTuning.elites * this.rank('elites');
    if (this.has('elitearmy')) m *= mutatorTuning.eliteArmy;
    if (this.route === 'elite') m *= routeTuning.eliteMul;
    if (this.route === 'treasure') m *= routeTuning.treasureEliteMul;
    return Math.max(0.2, m);
  }

  get bossHpMul(): number {
    return 1 + heatTuning.boss * this.rank('boss');
  }

  get chestEveryMul(): number {
    return this.route === 'treasure' ? routeTuning.chestEveryMul : 1;
  }

  get chestMaxAdd(): number {
    return this.route === 'treasure' ? routeTuning.chestMaxAdd : 0;
  }

  /** Mod prices in the shop. */
  get priceMul(): number {
    return (1 + heatTuning.purse * this.rank('purse')) * (this.route === 'shop' ? routeTuning.priceMul : 1);
  }

  get clearGold(): number {
    return this.route === 'shop' ? routeTuning.clearGold : 0;
  }

  get relicLuck(): number {
    return this.route === 'elite' ? routeTuning.relicLuck : 0;
  }

  /** I-frames after a hit x this. */
  get iframeMul(): number {
    return Math.max(0.2, 1 - heatTuning.iframes * this.rank('iframes'));
  }

  get noLevelHeal(): boolean {
    return this.rank('hunger') >= 1;
  }

  get noHearts(): boolean {
    return this.rank('hunger') >= 2 || this.has('gearhead');
  }

  /** Team damage dealt x this. */
  get damageMul(): number {
    return this.has('glass') ? mutatorTuning.glass : 1;
  }

  /** Kill gold drop chance x this. */
  get goldMul(): number {
    return this.has('goldrain') ? mutatorTuning.goldRain : 1;
  }

  /** Size of normal enemies (bosses keep theirs). */
  get enemyScale(): number {
    return this.has('giants') ? mutatorTuning.giantScale : 1;
  }

  /** Stage events this stage, challenge reward multiplier and when the challenge starts. */
  get eventMods(): { events: number; rewardMul: number; challengeAt: number } {
    return this.route === 'event'
      ? { events: routeTuning.events, rewardMul: routeTuning.rewardMul, challengeAt: routeTuning.challengeAt }
      : { events: 1, rewardMul: 1, challengeAt: 18 };
  }

  /** HUD tag under the stage label: route and heat on one line, Weekly mutators on another. */
  tagLines(): { text: string; color: string }[][] {
    const top: { text: string; color: string }[] = [];
    const r = this.route ? ROUTE_BY_ID[this.route] : null;
    if (r) top.push({ text: `${r.icon} ${r.name.toUpperCase()}`, color: r.color });
    if (this.heatTotal > 0) top.push({ text: `HEAT ${this.heatTotal}`, color: '#ef7d57' });
    const muts = this.mutators.map((m) => ({ text: `${MUTATOR_BY_ID[m].icon} ${MUTATOR_BY_ID[m].name.toUpperCase()}`, color: MUTATOR_BY_ID[m].color }));
    return [top, muts].filter((l) => l.length);
  }
}

/** Test links (src/dev/testLinks.ts): force heat, mutators or a route for the next run, without touching storage. */
export const runModsTest: { heat: HeatRanks | null; mutators: MutatorId[] | null; route: RouteId | null } = { heat: null, mutators: null, route: null };

// ---------------------------------------------------------------- per-machine storage

const HEAT_KEY = 'heat.v1';

/** The heat ranks this machine last picked on the MODE screen. */
export function loadHeatPick(): HeatRanks {
  return cleanHeat(loadJson<unknown>(HEAT_KEY, {}));
}

export function saveHeatPick(r: HeatRanks): void {
  saveJson(HEAT_KEY, cleanHeat(r));
}

/** Click on a heat modifier: one rank up, wrapping to 0 after the max. */
export function cycleHeat(r: HeatRanks, id: HeatId): HeatRanks {
  const d = HEAT_MODS.find((x) => x.id === id);
  if (!d) return r;
  const next = ((r[id] ?? 0) + 1) % (d.max + 1);
  return cleanHeat({ ...r, [id]: next });
}

const WEEKLY_KEY = 'weekly.v1';

/** Best Weekly Challenge score for an ISO week (0 = none yet). */
export function weeklyBest(week: string): number {
  const d = loadJson<{ week: string; score: number }>(WEEKLY_KEY, { week: '', score: 0 });
  return d.week === week ? d.score : 0;
}

/** Record a Weekly Challenge run; true if it beat this week's best. */
export function submitWeekly(week: string, score: number): boolean {
  if (score <= weeklyBest(week)) return false;
  saveJson(WEEKLY_KEY, { week, score });
  return true;
}
