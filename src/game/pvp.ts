import type * as THREE from 'three';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import type { Loadout } from '../data/loadout';
import { MOD_BY_ID } from '../data/mods';
import { WEAPONS } from '../data/weapons';
import { buildKey } from '../data/tracks';
import type { Hero } from './hero';
import { createWeapon } from './weapons';

/**
 * PvP: every player plays the same seeded stage on their own machine (a plain
 * solo run), then the host rebuilds everyone's hero from their HeroBuild and
 * runs a host-authoritative duel in one arena over the co-op netcode. Each hero
 * gets an invisible stand-in enemy (`pvpOwner` = its index) that the other
 * heroes' weapons hit like any enemy; Game.damage turns those hits into
 * scaled hero damage. Last hero standing wins.
 */
export const pvpTuning = {
  damageScale: 0.03, // hero damage per point of weapon damage (weapons are tuned for 10k-HP bosses); pvp2 bot duels: a level-15 mirror lasts ~17 s
  zoneStart: 42, // fallback safe ring radius (arenas set their own, PvpArenaDef.zone)
  zoneDelay: 20, // seconds before the ring starts closing
  zoneSpeed: 0.45, // metres per second it closes
  zoneMin: 6, // it holds at this radius for `suddenAfter` seconds...
  suddenAfter: 15,
  collapseSpeed: 0.25, // ...then collapses to nothing (sudden death: a round always ends)
  zoneDps: 0.08, // share of max life per second outside the ring
  zoneDpsRamp: 0.04, // more per 10 s of sudden death
  spawnRadius: 16, // heroes start on a circle this far from the centre (arenas set their own)
  /** Pending damage lands at most this often, as one hit (so it reads as hits, not a drain). */
  landEvery: 0.25,
  /** No more than this share of max life per second from opponents: the shortest possible kill is ~1 / maxDps s. */
  maxDps: 0.25,
  /** I-frames after a PvP hit (the hero-vs-enemy 0.7 s would halve every build's damage). */
  iframes: 0.2,
  /** Armor in a duel: damage / (1 + armorPct x armor) (flat armor would erase small hits). */
  armorPct: 0.04,
  /** Specials (Q/E) recharge this much slower in a duel and start each round this full. */
  specialCdMul: 1.6,
  specialStart: 0.5,
  /** Seconds of 3-2-1 at the start of a round (no damage). */
  countdown: 3,
  /** Seconds the round-end scoreboard shows before the next round. */
  roundEnd: 5,
  /** Best of 3: first to this many round wins; draws are replayed up to maxRounds. */
  roundsToWin: 2,
  maxRounds: 5,
  /** Free-for-all: the ring starts this much wider per player beyond two, capped. */
  zonePerPlayer: 2.5,
  zoneCap: 42,
  /** Thorn patches scratch heroes in a duel (share of max life every 0.5 s). */
  thornHero: 0.02,
  /** Damage over the per-hit cap carries into the next hits, up to this share of max life (a burst isn't wasted, just spread). */
  carryMax: 0.4,
  /** Per damage source multipliers in duels only (bot round robin at level 15, see notes/lanes/pvp2.md). */
  sourceMul: { grenade: 0.65, storm: 0.7, scatter: 0.85, rail: 1.1, orb: 1.3, shield: 1.5 } as Record<string, number>,
};

/** Everything needed to rebuild a hero's run on another machine. */
export interface HeroBuild {
  loadout: Loadout;
  weapons: { id: string; level: number; key: string }[];
  special: { id: string; level: number; key: string };
  passives: Record<string, number>;
  mods: { id: string; level: number }[];
  relics: string[];
  revives: number;
  /** Stage summary for the waiting screen. */
  level: number;
  dead: boolean;
}

export function exportBuild(h: Hero, level: number): HeroBuild {
  return {
    loadout: { ...h.loadoutPick },
    weapons: h.weapons.map((w) => ({ id: w.def.id, level: w.level, key: w.buildKey })),
    special: { id: h.special.id, level: h.special.level, key: h.specialBuild ? buildKey(h.specialBuild) : '' },
    passives: { ...h.passives },
    mods: h.synergy.slots.map((s) => ({ id: s.def.id, level: s.level })),
    relics: [...h.relics],
    revives: h.revivesLeft,
    level,
    dead: h.player.dead,
  };
}

/** Rebuild a hero from a HeroBuild (host side), at full life. */
export function applyBuild(h: Hero, b: HeroBuild, scene: THREE.Scene): void {
  h.loadoutPick = { ...b.loadout };
  h.startRun();
  for (const wb of b.weapons) {
    if (!WEAPONS[wb.id]) continue;
    let w = h.weapons.find((x) => x.def.id === wb.id);
    if (!w) {
      w = createWeapon(wb.id, scene);
      h.weapons.push(w);
    }
    if (w.build) w.setBuildKey(wb.key);
    else w.level = Math.max(1, Math.min(wb.level, w.def.levels.length + (w.def.evolution ? 1 : 0)));
  }
  h.special.level = b.special.level;
  if (b.special.key) h.setSpecialBuild(b.special.key);
  h.passives = { ...b.passives };
  for (const m of b.mods) {
    const def = MOD_BY_ID[m.id];
    if (!def || h.synergy.full) continue;
    h.synergy.add(def, 0);
    for (let k = 1; k < m.level; k++) h.synergy.upgrade(h.synergy.slots.length - 1);
  }
  h.relics = [...b.relics];
  h.recomputeStats();
  h.revivesLeft = b.revives;
  h.player.reset(h.stats);
  h.loadoutDirty = true;
}

/** The invisible stand-in that opponents' weapons hit (never moves on its own, never hurts, never dies). */
export const PVP_TARGET: EnemyDef = {
  ...ENEMIES.swarmer,
  id: 'pvp_target',
  name: 'Opponent',
  hp: 1e9,
  speed: 0,
  radius: 0.55,
  contactDamage: 0,
  xp: 0,
  score: 0,
  knockbackResist: 1,
  hidden: true,
};

// ------------------------------------------------------------------ pvp2: formats, rounds, teams (pure)

export type PvpFormat = 'ffa' | 'teams';
/** Host's lobby choices for a PvP match. `arena`: an arena id (src/data/pvpArenas.ts) or 'rotate'. */
export interface PvpRules {
  format: PvpFormat;
  rounds: 1 | 3;
  arena: string;
}
export const DEFAULT_PVP_RULES: PvpRules = { format: 'ffa', rounds: 3, arena: 'rotate' };
/** Most players in a PvP lobby (free-for-all); co-op and Versus stay at 4. */
export const PVP_MAX_PLAYERS = 8;

export function cleanRules(x: unknown, arenaIds: readonly string[]): PvpRules {
  const o = (x ?? {}) as Partial<PvpRules>;
  return {
    format: o.format === 'teams' ? 'teams' : 'ffa',
    rounds: o.rounds === 1 ? 1 : 3,
    arena: typeof o.arena === 'string' && arenaIds.includes(o.arena) ? o.arena : 'rotate',
  };
}

/** Team id per hero index: everyone alone in free-for-all, alternating A/B (0/1) in teams. */
export function teamsFor(n: number, format: PvpFormat): number[] {
  return Array.from({ length: n }, (_, i) => (format === 'teams' ? i % 2 : i));
}

/** The round so far: `over` once at most one team has anyone standing; `team` is that team (-1 = nobody: a draw). */
export function roundState(alive: readonly number[], teams: readonly number[]): { over: boolean; team: number } {
  const left = new Set(alive.map((i) => teams[i]));
  if (left.size > 1) return { over: false, team: -1 };
  return { over: true, team: left.size ? [...left][0] : -1 };
}

/** After `round` rounds with these wins per team: is the match over, and who won (-1 = draw)? */
export function matchState(wins: readonly number[], rules: Pick<PvpRules, 'rounds'>, round: number): { over: boolean; winner: number } {
  const need = rules.rounds === 1 ? 1 : pvpTuning.roundsToWin;
  const best = Math.max(0, ...wins);
  const leaders = wins.map((w, t) => (w === best ? t : -1)).filter((t) => t >= 0);
  if (best >= need) return { over: true, winner: leaders[0] };
  const cap = rules.rounds === 1 ? 1 : pvpTuning.maxRounds;
  if (round < cap) return { over: false, winner: -1 };
  return { over: true, winner: best > 0 && leaders.length === 1 ? leaders[0] : -1 };
}

/** Is the next round the deciding one (someone is a win away from taking the match, or it's the last allowed)? */
export function finalRound(wins: readonly number[], rules: Pick<PvpRules, 'rounds'>, round: number): boolean {
  if (rules.rounds === 1) return true;
  if (round + 1 >= pvpTuning.maxRounds) return true;
  return wins.filter((w) => w === pvpTuning.roundsToWin - 1).length >= 2;
}

/** Ring start radius for an arena and a player count. */
export function zoneStartFor(arenaZone: number, players: number): number {
  return Math.min(pvpTuning.zoneCap, arenaZone + Math.max(0, players - 2) * pvpTuning.zonePerPlayer);
}

/** Ring radius `t` seconds into a round: waits, closes to zoneMin, holds, then collapses. */
export function zoneRadius(t: number, start: number): number {
  const T = pvpTuning;
  if (t <= T.zoneDelay) return start;
  const closeT = Math.max(0, start - T.zoneMin) / T.zoneSpeed;
  const k = t - T.zoneDelay;
  if (k <= closeT) return start - k * T.zoneSpeed;
  const hold = k - closeT;
  if (hold <= T.suddenAfter) return T.zoneMin;
  return Math.max(0, T.zoneMin - (hold - T.suddenAfter) * T.collapseSpeed);
}

/** Seconds into a round when sudden death (the collapse) starts. */
export function suddenDeathAt(start: number): number {
  const T = pvpTuning;
  return T.zoneDelay + Math.max(0, start - T.zoneMin) / T.zoneSpeed + T.suddenAfter;
}

/** Ring damage per second (share of max life) `t` seconds into a round. */
export function zoneDpsAt(t: number, start: number): number {
  const over = t - suddenDeathAt(start);
  return pvpTuning.zoneDps + (over > 0 ? (over / 10) * pvpTuning.zoneDpsRamp : 0);
}

/** Arena id for a round: the host's pick, or rotate through the list starting from the seed. */
export function arenaForRound(rules: Pick<PvpRules, 'arena'>, ids: readonly string[], seed: number, round: number): string {
  if (rules.arena !== 'rotate' && ids.includes(rules.arena)) return rules.arena;
  return ids[((seed >>> 0) + round - 1) % ids.length];
}

/**
 * Spawn spots: free-for-all spreads everyone evenly on the circle; teams start
 * on opposite sides (A west, B east), teammates side by side.
 */
export function spawnPoints(teams: readonly number[], format: PvpFormat, r: number): { x: number; z: number; ax: number; az: number }[] {
  const n = teams.length;
  const out: { x: number; z: number; ax: number; az: number }[] = [];
  for (let i = 0; i < n; i++) {
    let a: number;
    if (format === 'teams') {
      const mates = teams.map((t, k) => (t === teams[i] ? k : -1)).filter((k) => k >= 0);
      const slot = mates.indexOf(i);
      const spread = 0.42;
      a = (teams[i] === 0 ? Math.PI : 0) + (slot - (mates.length - 1) / 2) * spread;
    } else a = (i / n) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    out.push({ x, z, ax: -Math.cos(a), az: -Math.sin(a) });
  }
  return out;
}

/** The share of pending duel damage that lands now: armor shrinks it, maxDps caps it per landing. */
export function pvpLanding(pending: number, armor: number, maxHp: number): number {
  const T = pvpTuning;
  return Math.min(pending / (1 + T.armorPct * Math.max(0, armor)), maxHp * T.maxDps * T.landEvery);
}

/** Pending damage left after `landed` lands (pre-armor), capped at carryMax of max life. */
export function pvpCarry(pending: number, landed: number, armor: number, maxHp: number): number {
  const T = pvpTuning;
  return Math.min(Math.max(0, pending - landed * (1 + T.armorPct * Math.max(0, armor))), maxHp * T.carryMax);
}

/** Is enemy `e` a duel stand-in that hero `i` must not hit or aim at (its own, or a teammate's)? */
export function pvpFriendly(teams: readonly number[] | null | undefined, owner: number, i: number): boolean {
  if (owner < 0) return false;
  if (owner === i) return true;
  return !!teams && teams[owner] !== undefined && teams[owner] === teams[i];
}
