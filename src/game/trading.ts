/**
 * Trading lane, pure logic (no Game access, unit-tested in tests/trading.test.ts):
 * what one co-op player may give another (gold, gears, relics), the per-player
 * rate limit, shop pools (teammates chip gold into one Mod for someone) and
 * LEGEND's player-count scaling. The Game side is src/game/systems/trading.ts.
 */
import { DIFF_BY_ID, type DifficultyDef } from '../data/modes';

export const tradeTuning = {
  /** Gold buttons in the TRADE menu (plus GIVE HALF). */
  goldSteps: [5, 25],
  /** Pool chip buttons (plus CHIP THE REST). */
  chipSteps: [5, 25],
  /** Seconds between two trades from one player, and at most `burst` trades per `burstWindow` seconds. */
  minGap: 0.25,
  burst: 6,
  burstWindow: 5,
  /** Open pools per player (one Mod at a time) and per shop. */
  poolsPerHero: 1,
  maxPools: 8,
  /** Trade events stay in the snapshot this long (s) so every client sees them once. */
  eventLife: 2,
  /** Gold given in one run for the Patron achievement. */
  patronGold: 150,
};

export type GiveKind = 'gold' | 'gear' | 'relic';

/** What a give looks at on each side (a Hero, or a test stand-in). */
export interface Wallet {
  index: number;
  gold: number;
  gears: number;
  relics: readonly string[];
  left?: boolean;
}

/** Why a give is refused, or '' if it's fine. `maxGears` is MAX_GEARS (passed in so this stays pure). */
export function checkGive(from: Wallet, to: Wallet | undefined, kind: GiveKind, amount: number, relic: string, maxGears: number): string {
  if (!to || to.left) return 'THAT PLAYER IS GONE';
  if (to.index === from.index) return "YOU CAN'T TRADE WITH YOURSELF";
  if (kind === 'gold') {
    if (!(amount >= 1) || !Number.isFinite(amount)) return 'NOTHING TO GIVE';
    if (from.gold < 1) return 'NOT ENOUGH GOLD';
    return '';
  }
  if (kind === 'gear') {
    if (from.gears < 1) return 'NO GEARS TO GIVE';
    if (to.gears >= maxGears) return 'THEIR GEAR BAG IS FULL';
    return '';
  }
  if (kind === 'relic') {
    if (!from.relics.includes(relic)) return "YOU DON'T HAVE THAT RELIC";
    if (to.relics.includes(relic)) return 'THEY ALREADY HAVE IT';
    return '';
  }
  return 'NOTHING TO GIVE';
}

/** Gold actually moved by a give of `amount`: whole coins, at most what the giver holds. */
export function goldMoved(gold: number, amount: number): number {
  return Math.max(0, Math.min(Math.floor(gold), Math.floor(amount)));
}

/** Per-player rate limit on the host: a minimum gap plus a burst cap. `now` in seconds. */
export class TradeLimiter {
  private log: number[] = [];

  allow(now: number): boolean {
    const last = this.log[this.log.length - 1];
    if (last !== undefined && now - last < tradeTuning.minGap) return false;
    this.log = this.log.filter((t) => now - t < tradeTuning.burstWindow);
    if (this.log.length >= tradeTuning.burst) return false;
    this.log.push(now);
    return true;
  }
}

// ---------------------------------------------------------------- pools

/** One shop pool: teammates chip gold toward `owner`'s offer in shop slot `slot`. */
export interface Pool {
  id: number;
  owner: number;
  slot: number;
  mod: string;
  price: number;
  /** Gold held so far, by hero index. */
  paid: number[];
}

export function poolTotal(p: Pool): number {
  let n = 0;
  for (const v of p.paid) n += v || 0;
  return n;
}

export function poolLeft(p: Pool): number {
  return Math.max(0, p.price - poolTotal(p));
}

/** The pools of one shop visit. Gold taken from chippers sits in the pool until it is spent or refunded. */
export class TradePools {
  list: Pool[] = [];
  private nextId = 1;

  open(owner: number, slot: number, mod: string, price: number): Pool | string {
    if (this.list.filter((p) => p.owner === owner).length >= tradeTuning.poolsPerHero) return 'YOU ALREADY HAVE A POOL OPEN';
    if (this.list.length >= tradeTuning.maxPools) return 'TOO MANY POOLS OPEN';
    if (!(price > 0)) return 'NOTHING TO POOL FOR';
    const p: Pool = { id: this.nextId++, owner, slot, mod, price, paid: [] };
    this.list.push(p);
    return p;
  }

  get(id: number): Pool | undefined {
    return this.list.find((p) => p.id === id);
  }

  /** Chip in: takes up to `want`, never more than what's left or what the hero holds. Returns the gold taken. */
  chip(p: Pool, hero: number, want: number, has: number): number {
    const n = Math.max(0, Math.min(Math.floor(want), Math.floor(has), poolLeft(p)));
    if (n > 0) p.paid[hero] = (p.paid[hero] ?? 0) + n;
    return n;
  }

  /** Close a pool: its gold goes back to who paid it, as [hero, gold] pairs. */
  close(p: Pool): [number, number][] {
    this.list = this.list.filter((x) => x !== p);
    const out: [number, number][] = [];
    p.paid.forEach((v, i) => {
      if (v > 0) out.push([i, v]);
    });
    return out;
  }

  /** Drop every pool (the shop closed): the refunds. */
  clear(): [number, number][] {
    const out: [number, number][] = [];
    for (const p of [...this.list]) out.push(...this.close(p));
    return out;
  }
}

// ---------------------------------------------------------------- LEGEND

/**
 * LEGEND scaling by players in the run, on top of the director's usual co-op
 * scaling (+45% HP / +50% count per extra player, x0.9 co-op ease). Index =
 * players (2, 3, 4; more use the last). Tuned with autopilot bot runs
 * (notes/lanes/trading.md): bigger teams get a little less extra HP because
 * the director already scales them, but more damage, since four heroes
 * revive each other easily.
 */
export const legendTuning = {
  hp: [0, 0, 2.3, 2.2, 2.1],
  dmg: [0, 0, 1.75, 1.85, 1.95],
  count: [0, 0, 1.35, 1.3, 1.25],
  score: 3,
  /** Boss bounty: each hero rolls one more relic per boss, with this much extra luck. */
  relicLuck: 1.5,
  /** Gears given to every hero at each stage clear. */
  clearGears: 1,
};

/** LEGEND's numbers for a team of `players` (a fresh def, same id). */
export function legendDifficulty(players: number): DifficultyDef {
  const base = DIFF_BY_ID.legend;
  const t = legendTuning;
  const i = Math.max(2, Math.min(t.hp.length - 1, Math.round(players)));
  return { ...base, enemyHp: t.hp[i], enemyDmg: t.dmg[i], enemyCount: t.count[i], score: t.score };
}

/** May this run use LEGEND? Online co-op runs only, with 2+ players. */
export function legendAllowed(players: number, kind: string, pvp: boolean): boolean {
  return players >= 2 && kind === 'coop' && !pvp;
}
