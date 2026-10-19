/**
 * Mod order preview for the shop (shop lane). Slot order is the core
 * Balatro-style decision, so the shop shows what the current order does to a
 * sample hit, per weapon and per condition ("SCATTERGUN x1.86",
 * "BURNING x2.10 +3"), and what buying, moving, upgrading or selling a Mod
 * would change.
 *
 * Every number comes from the real engine: `Synergy.sandbox` runs copies of
 * the slots through the same Echo resolution, flag sums and damage pipeline
 * as a real hit, with a sandbox api (no gold, blasts, zaps or luck). The
 * pipeline is affine in the hit's amount (each slot does (x + add) * mult with
 * add and mult independent of x), so two runs at 0 and 1 give the whole
 * effect: f(x) = m * x + a.
 */
import type { Rng } from '../core/rng';
import type { Tag } from '../data/tags';
import { WEAPONS } from '../data/weapons';
import type { CardNum } from './cardNumbers';
import { statLines } from './cardNumbers';
import type { Enemy } from './enemies';
import type { Hero } from './hero';
import { economyTuning } from './hero';
import { modMaxLevel, type DamageEvent, type ModDef } from './modTypes';
import type { Player } from './player';
import { baseStats, type Stats } from './stats';
import { MAX_MOD_SLOTS, Synergy, type Slot, type SynergyHost } from './synergy';
import type { Weapon } from './weapons';

/** One preview line: key (see rowLabel), multiplier and flat add after the multipliers. */
export interface PreviewRow {
  k: string;
  m: number;
  a: number;
}

/** What the shop screen needs (plain data: it travels to co-op clients in the shop view). */
export interface ShopPreview {
  /** The current order. */
  now: PreviewRow[];
  /** After buying offer i (null: can't, e.g. slots full or sold). */
  buy: (PreviewRow[] | null)[];
  /** After moving owned Mod i left / right, upgrading it or selling it. */
  left: (PreviewRow[] | null)[];
  right: (PreviewRow[] | null)[];
  up: (PreviewRow[] | null)[];
  sell: (PreviewRow[] | null)[];
  /** Owned Mods whose numbers change during a fight (shown at their current value). */
  live: string[];
  /** Neutral factors per condition row: crits x critMult, shocked x(1 + base shock). */
  critMult: number;
  shockBase: number;
}

/** Sample hits and distances. */
export const previewTuning = {
  dist: 5, // a normal hit
  near: 2, // "within 3.5 m" row (Brawler)
  far: 10, // "beyond 8 m" row (Sniper Scope)
  /** Rows closer than this to neutral are treated as unchanged. */
  eps: 0.005,
};

export function rowLabel(k: string): string {
  if (k.startsWith('w:')) return (WEAPONS[k.slice(2)]?.name ?? k.slice(2)).toUpperCase();
  return (
    {
      all: 'EVERY HIT',
      burn: 'BURNING',
      frozen: 'FROZEN',
      shock: 'SHOCKED',
      near: 'WITHIN 3.5M',
      far: 'PROJECTILE 8M+',
      crit: 'CRITS',
      still: 'STANDING STILL',
    } as Record<string, string>
  )[k] ?? k.toUpperCase();
}

/** What a row is compared against to decide whether any Mod changes it. */
export function neutral(p: Pick<ShopPreview, 'critMult' | 'shockBase'>, k: string): number {
  return k === 'crit' ? p.critMult : k === 'shock' ? 1 + p.shockBase : 1;
}

/** The hero facts a preview needs. */
export interface PreviewBuild {
  gold: number;
  level: number;
  /** Seconds on the hero's Mod clock (Turret Mode's grace reads it). */
  time: number;
  weapons: { id: string; tags: readonly Tag[] }[];
  critMult: number;
  shockBase: number;
}

const fakeEnemy = (): Enemy =>
  ({ x: 0, z: 0, hp: 1e9, maxHp: 1e9, burnT: 0, frozen: 0, shockT: 0, exposeT: 0, shatter: 0, elite: false, def: { boss: false } }) as unknown as Enemy;

/** A SynergyHost that does nothing: blasts, zaps, gold and luck are no-ops (chance() never procs). */
function sandboxHost(b: PreviewBuild): SynergyHost {
  const stats = baseStats();
  const player = { x: 0, z: 0, hp: 100, maxHp: 100, dead: false, invuln: 0, rig: { root: { visible: true } } } as unknown as Player;
  const noop = () => {};
  return {
    player,
    stats,
    level: b.level,
    gold: b.gold,
    weapons: b.weapons.map((w) => ({ def: { id: w.id }, tags: w.tags }) as unknown as Weapon),
    rng: { chance: () => false, next: () => 0.999, range: (a: number) => a } as unknown as Rng,
    blast: noop,
    zap: noop,
    ignite: noop,
    shock: noop,
    addGold: noop,
  };
}

/** Run the sample hits through these slots. Pure: the slots and their state are copied. */
export function previewRows(slots: readonly Slot[], b: PreviewBuild): PreviewRow[] {
  const host = sandboxHost(b);
  const syn = Synergy.sandbox(slots, host);
  // Static Mod stats (Glass Cannon's x2) multiply every hit before the slots.
  const st = baseStats();
  syn.applyStatic(st);
  const pre = st.damageMul;
  syn.time = b.time + 10; // well past Turret Mode's 1 s grace
  syn.moving = true;
  const hit = (k: string, ev: Partial<DamageEvent> & { e?: Enemy }, factor = 1): PreviewRow => {
    const full: DamageEvent = { e: ev.e ?? fakeEnemy(), source: ev.source ?? '', tags: ev.tags ?? [], dist: ev.dist ?? previewTuning.dist, crit: ev.crit ?? false };
    const f0 = syn.damage(full, 0);
    const f1 = syn.damage(full, pre);
    return { k, m: round((f1 - f0) * factor), a: round(f0 * factor) };
  };
  const rows: PreviewRow[] = [hit('all', {})];
  const seen = new Set<string>();
  for (const w of b.weapons) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    rows.push(hit('w:' + w.id, { source: w.id, tags: w.tags }));
  }
  const e = (patch: Partial<Enemy>) => Object.assign(fakeEnemy(), patch);
  rows.push(hit('burn', { e: e({ burnT: 3 }) }));
  rows.push(hit('frozen', { e: e({ frozen: 1 }) }));
  rows.push(hit('shock', { e: e({ shockT: 2 }) }, 1 + b.shockBase + syn.flags.shockMult));
  rows.push(hit('near', { dist: previewTuning.near }));
  rows.push(hit('far', { dist: previewTuning.far, tags: ['projectile'] }));
  rows.push(hit('crit', { crit: true }, b.critMult));
  // Standing still: one zero-length step with the hero not moving (Turret Mode notes the time).
  syn.moving = false;
  syn.tick(0);
  rows.push(hit('still', {}));
  return rows;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Rows that differ from neutral (always "every hit"). */
export function activeRows(p: Pick<ShopPreview, 'critMult' | 'shockBase'>, rows: PreviewRow[]): PreviewRow[] {
  const all = rows.find((r) => r.k === 'all');
  if (!all) return rows;
  return rows.filter((r) => r.k === 'all' || !same(r, all, neutral(p, r.k)));
}

function same(r: PreviewRow, all: PreviewRow, f: number): boolean {
  return Math.abs(r.m - all.m * f) < previewTuning.eps * Math.max(1, r.m) && Math.abs(r.a - all.a * f) < 0.05;
}

/** "x1.86", "x1.50 +4.5". */
export function rowValue(r: PreviewRow): string {
  const m = `x${r.m.toFixed(2)}`;
  return r.a >= 0.05 ? `${m} +${+r.a.toFixed(1)}` : m;
}

/** Before -> after for the rows that change (or that either side touches). */
export function diffRows(p: Pick<ShopPreview, 'critMult' | 'shockBase'>, before: PreviewRow[], after: PreviewRow[]): { k: string; a: PreviewRow | null; b: PreviewRow; changed: boolean }[] {
  const shown = new Set([...activeRows(p, before), ...activeRows(p, after)].map((r) => r.k));
  const out: { k: string; a: PreviewRow | null; b: PreviewRow; changed: boolean }[] = [];
  for (const r of after) {
    if (!shown.has(r.k)) continue;
    const o = before.find((x) => x.k === r.k) ?? null;
    out.push({ k: r.k, a: o, b: r, changed: !o || rowValue(o) !== rowValue(r) });
  }
  return out;
}

// ---------------------------------------------------------------- the hero's shop

/** The hero's build for previews. */
export function heroBuild(h: Hero, shockBase: number): PreviewBuild {
  return {
    gold: h.gold,
    level: h.level,
    time: h.synergy.time,
    weapons: h.weapons.map((w) => ({ id: w.def.id, tags: w.tags })),
    critMult: h.stats.critMult,
    shockBase,
  };
}

const freshSlot = (def: ModDef, paid: number): Slot => ({ def, st: { n: 0, t: 0 }, level: 1, paid });

/** Everything the shop's preview panel can show, computed on the host. */
export function shopPreview(h: Hero, shockBase: number): ShopPreview {
  const b = heroBuild(h, shockBase);
  const slots = h.synergy.slots;
  const rows = (s: Slot[], gold = b.gold) => previewRows(s, { ...b, gold });
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= slots.length) return null;
    const s = [...slots];
    [s[i], s[j]] = [s[j], s[i]];
    return rows(s);
  };
  return {
    now: rows(slots),
    buy: h.shopOffers.map((m) => {
      if (!m || slots.length >= MAX_MOD_SLOTS) return null;
      const price = h.price(m);
      return rows([...slots, freshSlot(m, price)], b.gold - price);
    }),
    left: slots.map((_, i) => swap(i, i - 1)),
    right: slots.map((_, i) => swap(i, i + 1)),
    up: slots.map((s, i) => (s.level < modMaxLevel(s.def) ? rows(slots.map((x, j) => (j === i ? { ...x, level: x.level + 1 } : x)), b.gold - h.upgradeCost(s.def, s.level)) : null)),
    sell: slots.map((s, i) => rows(slots.filter((_, j) => j !== i), b.gold + h.sellPrice(s.paid))),
    live: liveMods(slots, b),
    critMult: b.critMult,
    shockBase,
  };
}

/**
 * Owned damage Mods whose number moves during a fight: their factor changes
 * when the counters, gold or clock move (Bloodlust, Momentum, Hoarder,
 * Collector, Midas, Turret Mode...). Found by perturbing the state, not by id.
 */
export function liveMods(slots: readonly Slot[], b: PreviewBuild): string[] {
  const out: string[] = [];
  const api = (gold: number, time: number, moving: boolean): Synergy => {
    const syn = Synergy.sandbox(slots, sandboxHost({ ...b, gold }));
    syn.time = time;
    syn.moving = moving;
    return syn;
  };
  for (const s of slots) {
    const dmg = s.def.dmg;
    if (!dmg) continue;
    const ev: DamageEvent = { e: fakeEnemy(), source: '', tags: [], dist: previewTuning.dist, crit: false };
    const f = (r: { add?: number; mult?: number } | void) => `${r?.add ?? 0}|${r?.mult ?? 1}`;
    const base = f(dmg(ev, api(b.gold, b.time + 10, true), { ...s.st }));
    const moved = [
      f(dmg(ev, api(b.gold, b.time + 10, true), { n: s.st.n + 40, t: s.st.t })),
      f(dmg(ev, api(b.gold + 25, b.time + 10, true), { ...s.st })),
      f(dmg(ev, api(b.gold, b.time + 10, true), { n: s.st.n, t: b.time + 10 })),
    ];
    if (moved.some((m) => m !== base)) out.push(s.def.name);
  }
  return out;
}

/**
 * Non-damage effects of buying a Mod on this build: economy flags (interest,
 * prices) and static stats (life, recharge, crit), as card lines. Damage
 * changes come from the preview rows instead.
 */
export function modOfferNumbers(h: Hero, def: ModDef): CardNum[] {
  if (h.synergy.full) return [];
  const before = Synergy.sandbox(h.synergy.slots, sandboxHost(heroBuild(h, 0)));
  const after = Synergy.sandbox([...h.synergy.slots, freshSlot(def, def.price)], sandboxHost(heroBuild(h, 0)));
  const out: CardNum[] = [];
  const num = (l: string, a: number, b: number, fmt: (v: number) => string, lowerBetter = false) => {
    if (fmt(a) === fmt(b)) return;
    out.push({ l, a: fmt(a), b: fmt(b), d: b > a !== lowerBetter ? 1 : -1 });
  };
  const fa = before.flags;
  const fb = after.flags;
  num('INTEREST CAP', economyTuning.interestCap + fa.interestCap, economyTuning.interestCap + fb.interestCap, String);
  num('INTEREST', Math.max(2, economyTuning.interestPer - fa.interestPer), Math.max(2, economyTuning.interestPer - fb.interestPer), (v) => `1 PER ${v}`, true);
  num('SHOP PRICES', -Math.min(0.5, fa.shopDiscount), -Math.min(0.5, fb.shopDiscount), (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`, true);
  num('FREE REROLLS', fa.freeRerolls, fb.freeRerolls, String);
  num('GOLD PICKUPS', fa.goldMul, fb.goldMul, (v) => `+${Math.round(v * 100)}%`);
  num('ENEMY LIFE', fa.enemyHp, fb.enemyHp, (v) => `+${Math.round(v * 100)}%`, true);
  const sa = h.statsWithPassives(h.passives, before);
  const sb = h.statsWithPassives(h.passives, after);
  // Damage is in the preview rows; the rest of the static stats show here.
  out.push(...statLines(sa, sb).filter((l) => l.l !== 'DAMAGE'));
  return out.slice(0, 3);
}

/** Stats with an extra Mod applied, for tests and tooling. */
export function statsWithMod(h: Hero, def: ModDef): Stats {
  return h.statsWithPassives(h.passives, Synergy.sandbox([...h.synergy.slots, freshSlot(def, def.price)], sandboxHost(heroBuild(h, 0))));
}
