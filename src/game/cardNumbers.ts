/**
 * Real numbers for level-up cards and shop Mods (shop lane): the change in an
 * item's key numbers, e.g. "DPS 70 ▸ 84" or "CRIT CHANCE 5% ▸ 13%".
 *
 * Weapons and specials go through a small single-target model per weapon
 * (damage per hit, how often it fires, how many hits a use lands), scaled by
 * the hero's live damage and recharge stats. It is an estimate meant for
 * comparing before and after, not a benchmark: it assumes every projectile,
 * beam and drone connects. Passives compare the hero's stats with and without
 * the extra level, so caps (recharge floor, crit 100%) show up honestly.
 */
import { PASSIVES } from '../data/passives';
import { SPECIALS, specialCooldown } from '../data/specials';
import { buildParams, newBuild, type Build, type Upgradable } from '../data/tracks';
import { WEAPONS } from '../data/weapons';
import type { Offer } from '../ui/screens';
import type { Hero } from './hero';
import { baseStats, type Stats } from './stats';

/** One number line on a card: label, value before (absent on new items) and after. `d` 1 = better, -1 = worse. */
export interface CardNum {
  l: string;
  a?: string;
  b: string;
  d?: 1 | -1;
}

export const cardNumTuning = {
  /** Most number lines on one card (DPS first, then what changes most). */
  maxLines: 3,
};

/** Short number: 1234, 84, 12.5, 0.35. */
export function fmtNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 100) return String(Math.round(v));
  if (a >= 10) return String(+v.toFixed(1));
  return String(+v.toFixed(2));
}

// ---------------------------------------------------------------- weapons and specials

/** What the model reads off a weapon's params. */
interface Model {
  /** Damage per second if everything connects. */
  dps?: number;
  /** One hit (or one use) and its label. */
  hit?: number;
  hitL?: string;
  /** Uses per second (rate weapons) or seconds between uses (cooldown weapons). */
  rate?: number;
  every?: number;
  /** Params this model already shows (not repeated as raw lines). */
  used: string[];
}

type ModelFn = (p: Record<string, number>, s: Stats, rcMul: number) => Model;

const TAU = Math.PI * 2;
const n = (v: number | undefined, d = 0) => (Number.isFinite(v) ? (v as number) : d);

/** Per-weapon single-target models (damage params are scaled by stats.damageMul afterwards). */
const MODELS: Record<string, ModelFn> = {
  buster: (p, s) => ({ hit: p.dmg, rate: p.rate / s.cooldownMul, dps: (p.dmg * p.rate * n(p.shots, 1)) / s.cooldownMul, used: ['dmg', 'rate'] }),
  charge: (p, s, rc) => {
    const time = Math.max(0.4, n(p.time, 1.3)) / (s.chargeSpeed * rc);
    const hit = p.dmg * 10 * s.chargeDmg; // a full charge: 1.5 + 8.5
    return { hit, hitL: 'FULL CHARGE', every: time, dps: hit / time, used: ['dmg', 'time'] };
  },
  scatter: (p, s) => ({ hit: p.dmg, rate: p.rate / s.cooldownMul, dps: (p.dmg * p.pellets * p.rate) / s.cooldownMul, used: ['dmg', 'rate'] }),
  laser: (p) => ({ hit: p.dps, hitL: 'BEAM DPS', dps: p.dps * (1 + 0.6 * (n(p.beams, 1) - 1)), used: ['dps'] }),
  orb: (p, s) => ({ hit: p.dmg, rate: p.rate / s.cooldownMul, dps: ((p.dmg / Math.max(0.05, p.tick)) * p.rate * p.life) / s.cooldownMul, used: ['dmg', 'rate'] }),
  rail: (p, s) => ({ hit: p.dmg, rate: p.rate / s.cooldownMul, dps: (p.dmg * p.rate) / s.cooldownMul, used: ['dmg', 'rate'] }),
  grenade: (p, s, rc) => cd(p.dmg * s.chargeDmg, (p.cd * s.cooldownMul) / rc, n(p.count, 1)),
  well: (p, s, rc) => {
    const every = (p.cd * s.cooldownMul) / rc;
    return { hit: p.dps, hitL: 'GRIND DPS', every, dps: (p.dps * p.life + n(p.implode)) / every, used: ['dps', 'cd'] };
  },
  shield: (p, s, rc) => ({ hit: p.dmg * s.chargeDmg, hitL: 'BASH DMG', every: (p.cd * s.cooldownMul) / rc, used: ['dmg', 'cd'] }),
  orbital: (p, s, rc) => {
    const every = (p.cd * s.cooldownMul) / rc;
    const hit = p.dmg * s.chargeDmg;
    return { hit, every, dps: (hit * n(p.count, 1) + n(p.dps) * n(p.linger) * s.chargeDmg) / every, used: ['dmg', 'cd'] };
  },
  drones: (p, s) => ({ hit: p.dmg, dps: (p.dmg * p.count * p.spin) / TAU / Math.max(0.6, s.cooldownMul), used: ['dmg'] }),
  aura: (p, s) => ({ hit: p.dmg, every: p.tick * s.cooldownMul, dps: p.dmg / (p.tick * s.cooldownMul), used: ['dmg', 'tick'] }),
  lightning: (p, s) => cd(p.dmg, p.cd * s.cooldownMul, n(p.bolts, 1)),
  discs: (p, s) => cd(p.dmg, p.cd * s.cooldownMul, n(p.count, 1)),
  missiles: (p, s) => cd(p.dmg, p.cd * s.cooldownMul, n(p.count, 1)),
  mines: (p, s) => cd(p.dmg, p.cd * s.cooldownMul, n(p.per, 1)),
  nova: (p, s) => cd(p.dmg, p.cd * s.cooldownMul, 1),
  fire: (p) => ({ hit: p.dps, hitL: 'BURN DPS', dps: p.dps, used: ['dps'] }),
  sweeper: (p, s) => ({ ...cd(p.dmg, p.cd * s.cooldownMul, n(p.beams, 1) * (n(p.sweep, 0.6) / 0.1)) }),
  pellets: (p, s) => cd(p.dmg, p.cd * s.cooldownMul, n(p.pellets, 1)),
  bouncer: (p, s) => cd(p.dmg, p.cd * s.cooldownMul, n(p.count, 1) * n(p.bounces, 1)),
  starfall: (p, s) => cd(p.dmg, p.cd * s.cooldownMul, n(p.count, 1) * (1 + 0.4 * n(p.split))),
};

/** A cooldown weapon: `hits` hits of `hit` every `every` seconds. */
function cd(hit: number, every: number, hits: number): Model {
  return { hit, every, dps: (hit * hits) / Math.max(0.05, every), used: ['dmg', 'cd'] };
}

/** Specials: damage per hit, cooldown and how many hits one use makes. */
const SPECIAL_MODELS: Record<string, (p: Record<string, number>) => { hit: number; hitL?: string; extra?: [string, number][] }> = {
  bomb: (p) => ({ hit: p.dmg }),
  storm: (p) => ({ hit: p.dmg, hitL: 'BOLT DMG', extra: [['STRIKES', p.rate * p.dur]] }),
  blizzard: (p) => ({ hit: p.dmg, extra: [['FREEZE', p.freeze]] }),
  meteor: (p) => ({ hit: p.dmg, extra: [['METEORS', p.count]] }),
  blackhole: (p) => ({ hit: p.implode, hitL: 'COLLAPSE', extra: [['GRIND DPS', p.dps]] }),
};

/** Raw params worth a line when they change, in priority order (others are cosmetic or in the text). */
const PARAM_LABEL: [string, string][] = [
  ['shots', 'SHOTS'],
  ['pellets', 'PELLETS'],
  ['count', 'COUNT'],
  ['beams', 'BEAMS'],
  ['bolts', 'BOLTS'],
  ['per', 'PER DROP'],
  ['pierce', 'PIERCE'],
  ['chains', 'CHAINS'],
  ['zaps', 'ZAPS'],
  ['bounces', 'BOUNCES'],
  ['split', 'SPLITS'],
  ['bomblets', 'BOMBLETS'],
  ['radius', 'AREA'],
  ['blast', 'BLAST'],
  ['area', 'AREA'],
  ['range', 'RANGE'],
  ['width', 'WIDTH'],
  ['arc', 'ARC'],
  ['spread', 'SPREAD'],
  ['size', 'SIZE'],
  ['life', 'LASTS'],
  ['dur', 'LASTS'],
  ['freeze', 'FREEZE'],
  ['shatter', 'FROZEN DMG'],
  ['slow', 'SLOW'],
  ['pull', 'PULL'],
  ['implode', 'COLLAPSE'],
  ['hp', 'SHIELD HP'],
  ['knock', 'KNOCKBACK'],
  ['max', 'MAX OUT'],
  ['linger', 'LINGER'],
];
/** Lower is better for these. */
const LOWER_BETTER = new Set(['RELOAD', 'COOLDOWN', 'CHARGE TIME', 'SPREAD']);

interface Metric {
  l: string;
  v: number;
  /** Suffix for display ("s", "/s"). */
  u?: string;
}

/** Key numbers of a weapon or special for these params (DPS first). */
export function itemMetrics(kind: 'weapon' | 'special', id: string, p: Record<string, number>, s: Stats, rcMul = 1): Metric[] {
  const out: Metric[] = [];
  const used = new Set<string>();
  if (kind === 'special') {
    const m = SPECIAL_MODELS[id]?.(p) ?? { hit: n(p.dmg) };
    out.push({ l: m.hitL ?? 'DMG', v: m.hit * s.damageMul });
    out.push({ l: 'COOLDOWN', v: specialCooldown(p, s.specialCooldownMul), u: 's' });
    for (const [l, v] of m.extra ?? []) out.push({ l, v });
    used.add('dmg').add('implode').add('dps').add('charge').add('rate').add('dur').add('freeze').add('count');
  } else {
    const m = (MODELS[id] ?? ((pp) => (pp.cd ? cd(n(pp.dmg ?? pp.dps), pp.cd * s.cooldownMul, 1) : { hit: n(pp.dmg ?? pp.dps), used: ['dmg', 'dps'] })))(p, s, rcMul);
    if (m.dps !== undefined) out.push({ l: 'DPS', v: m.dps * s.damageMul });
    if (m.hit !== undefined) out.push({ l: m.hitL ?? 'DMG', v: m.hit * s.damageMul });
    if (m.rate !== undefined) out.push({ l: 'FIRE RATE', v: m.rate, u: '/s' });
    if (m.every !== undefined) out.push({ l: id === 'charge' ? 'CHARGE TIME' : 'RELOAD', v: m.every, u: 's' });
    for (const k of m.used) used.add(k);
  }
  for (const [k, l] of PARAM_LABEL) if (k in p && !used.has(k) && !out.some((o) => o.l === l)) out.push({ l, v: p[k] });
  return out;
}

const show = (m: Metric) => fmtNum(m.v) + (m.u ?? '');

/** Before -> after lines: the changed metrics (DPS first), or the main numbers of a new item. */
export function metricLines(before: Metric[] | null, after: Metric[]): CardNum[] {
  if (!before) return after.slice(0, 2).map((m) => ({ l: m.l, b: show(m) }));
  const lines: CardNum[] = [];
  for (const m of after) {
    const o = before.find((x) => x.l === m.l);
    if (!o || show(o) === show(m)) continue;
    const up = m.v > o.v !== LOWER_BETTER.has(m.l);
    lines.push({ l: m.l, a: show(o), b: show(m), d: up ? 1 : -1 });
  }
  return lines.slice(0, cardNumTuning.maxLines);
}

// ---------------------------------------------------------------- stats (passives, Mods)

/** How each stat reads on a card. */
const STAT_FMT: Partial<Record<keyof Stats, [string, (v: number) => string, boolean?]>> = {
  damageMul: ['DAMAGE', (v) => pct(v - 1)],
  cooldownMul: ['RECHARGE', (v) => pct(1 - v, true), true],
  areaMul: ['AREA', (v) => pct(v - 1)],
  critChance: ['CRIT CHANCE', (v) => `${Math.round(v * 100)}%`],
  critMult: ['CRIT DMG', (v) => `x${fmtNum(v)}`],
  knockbackMul: ['KNOCKBACK', (v) => pct(v - 1)],
  maxHp: ['MAX LIFE', (v) => String(Math.round(v))],
  armor: ['ARMOR', (v) => fmtNum(v)],
  regen: ['REGEN', (v) => `${fmtNum(v)}/s`],
  moveSpeedMul: ['MOVE SPEED', (v) => pct(v - 1)],
  dashCooldownMul: ['DASH COOLDOWN', (v) => pct(v - 1)],
  magnet: ['PICKUP RANGE', (v) => `x${fmtNum(v)}`],
  xpMul: ['XP', (v) => pct(v - 1)],
  chargeSpeed: ['CHARGE SPEED', (v) => pct(v - 1)],
  chargeDmg: ['RIGHT-CLICK DMG', (v) => pct(v - 1)],
  luck: ['LUCK', (v) => fmtNum(v)],
  killHeal: ['LIFE PER KILL', (v) => fmtNum(v)],
  specialCooldownMul: ['SPECIAL COOLDOWN', (v) => pct(v - 1)],
  dashCharges: ['DASHES', (v) => String(v)],
  thorns: ['THORNS', (v) => fmtNum(v)],
  dashZap: ['DASH SHOCK', (v) => fmtNum(v)],
  freezeChance: ['FREEZE CHANCE', (v) => `${fmtNum(v * 100)}%`],
  teamHeal: ['TEAM HEAL', (v) => `${fmtNum(v)}/s`],
  teamDmgAura: ['TEAM DAMAGE', (v) => pct(v)],
  reviveSpeed: ['REVIVE SPEED', (v) => pct(v)],
  reviveHp: ['REVIVE LIFE', (v) => pct(v)],
  nearMateArmor: ['TEAM ARMOR', (v) => fmtNum(v)],
  rerolls: ['GEARS', (v) => String(v)],
  revives: ['REVIVES', (v) => String(v)],
};
/** Stats where a lower number is the upgrade. */
const STAT_LOWER = new Set<keyof Stats>(['cooldownMul', 'dashCooldownMul', 'specialCooldownMul']);

function pct(v: number, faster = false): string {
  const p = Math.round(v * 100);
  if (faster) return p ? `${p}% FASTER` : '+0%';
  return `${p >= 0 ? '+' : ''}${p}%`;
}

/** Lines for every stat that differs between two stat sets (or only `keys`). */
export function statLines(before: Stats, after: Stats, keys?: (keyof Stats)[]): CardNum[] {
  const out: CardNum[] = [];
  for (const k of keys ?? (Object.keys(after) as (keyof Stats)[])) {
    const f = STAT_FMT[k];
    if (!f) continue;
    const a = f[1](before[k]);
    const b = f[1](after[k]);
    if (a === b && !keys) continue;
    const up = after[k] > before[k] !== STAT_LOWER.has(k);
    out.push({ l: f[0], a, b, d: a === b ? undefined : up ? 1 : -1 });
  }
  return out;
}

// ---------------------------------------------------------------- level-up offers

/** The numbers a level-up card shows for this hero (host side; they travel with the offer). */
export function offerNumbers(h: Hero, o: Offer): CardNum[] {
  try {
    return offerNumbersUnsafe(h, o);
  } catch {
    return []; // a malformed offer never breaks the level-up screen
  }
}

function offerNumbersUnsafe(h: Hero, o: Offer): CardNum[] {
  const s = h.stats ?? baseStats();
  if (o.kind === 'passive') {
    const def = PASSIVES[o.id];
    if (!def) return [];
    const now = h.statsWithPassives(h.passives);
    const next = h.statsWithPassives({ ...h.passives, [o.id]: (h.passives[o.id] ?? 0) + 1 });
    return statLines(now, next, Object.keys(def.add) as (keyof Stats)[]).slice(0, cardNumTuning.maxLines);
  }
  if (o.kind === 'track' || o.kind === 'evo' || o.kind === 'overdrive') {
    const [ref, what, k] = (o.pick ?? '').split('|');
    const special = ref === 'sp';
    const w = special ? null : h.weapons.find((x) => x.def.id === ref);
    const def: (Upgradable & { levels: { p: Record<string, number> }[] }) | undefined = special ? h.specialDef : w?.def;
    const b: Build | null | undefined = special ? h.specialBuild : w?.build;
    if (!def || !b) return [];
    const next: Build = { ranks: [...b.ranks], evo: b.evo, od: b.od };
    const i = Number(k);
    if (what === 't') next.ranks[i] = Math.min(def.tracks?.[i]?.ranks.length ?? 0, next.ranks[i] + 1);
    else if (what === 'e') next.evo = i;
    else next.od++;
    const id = special ? h.specialDef.id : ref;
    const kind = special ? 'special' : 'weapon';
    const rc = 1 + h.synergy.flags.chargeSpeed;
    return metricLines(itemMetrics(kind, id, buildParams(def.levels[0].p, def, b), s, rc), itemMetrics(kind, id, buildParams(def.levels[0].p, def, next), s, rc));
  }
  if (o.kind === 'weapon') {
    const id = o.id.replace(/_evo$/, '');
    const def = WEAPONS[id];
    if (!def) return [];
    const w = h.weapons.find((x) => x.def.id === id);
    const rc = 1 + h.synergy.flags.chargeSpeed;
    if (!w) return metricLines(null, itemMetrics('weapon', id, def.tracks ? buildParams(def.levels[0].p, def, newBuild(def)) : def.levels[0].p, s, rc));
    const next = def.levels[w.level];
    if (!next) return [];
    return metricLines(itemMetrics('weapon', id, w.p, s, rc), itemMetrics('weapon', id, next.p, s, rc));
  }
  if (o.kind === 'evolve') {
    const w = h.weapons.find((x) => x.def.id === o.id);
    const evo = w?.def.evolution;
    if (!w || !evo) return [];
    return metricLines(itemMetrics('weapon', o.id, w.p, s), itemMetrics('weapon', o.id, evo.p, s));
  }
  if (o.kind === 'special') {
    const def = SPECIALS[h.special.id];
    const lv = h.special.level;
    if (!def?.levels[lv]) return [];
    return metricLines(itemMetrics('special', def.id, def.levels[lv - 1].p, s), itemMetrics('special', def.id, def.levels[lv].p, s));
  }
  return [];
}
