/**
 * Host migration (hostmig lane): the "migration snapshot" the host shares with
 * every client so any of them can rebuild the authoritative run if the host
 * goes away, plus the pure rules for agreeing on the new host.
 *
 * The snapshot reuses what already exists where it can: heroes travel as
 * `HeroBuild`s (src/game/pvp.ts `exportBuild`/`applyBuild`, the PvP and coop2
 * stash path) plus the few numbers a build doesn't hold; plain lane objects
 * (director, adaptive pace, style meter, run events, route map...) travel as
 * their own primitive fields (`prims`). Enemies and pickups are binary records
 * (every live one, not the interest-filtered view a client draws). The game
 * glue lives in src/game/systems/hostmig.ts.
 */
import { ENEMIES } from '../data/enemies';
import { ELITE_MOD_IDS, type EliteModId } from '../data/eliteMods';
import { ByteReader, ByteWriter, type NetBytes } from './bytes';

/** Wire version of the migration snapshot (`mig` message). */
export const MIG_VERSION = 1;

export const hostmigTuning = {
  /** Seconds between migration snapshots (plus one at once on every mode, stage or roster change). */
  every: 1.5,
  /** Host: a player whose connection dropped this recently (s) is still listed as a candidate. */
  recent: 8,
  /** Client: how long to wait for the old host to answer before electing a new one (s). 0 when it said goodbye. */
  probe: 4,
  /** Client: the old host answered a reconnect but hasn't let us back in after this long (s): elect a new one after all. */
  blip: 15,
  /** Client: how long to keep trying an elected host before skipping to the next candidate (s). */
  candidate: 16,
  /** ...up to this many times as long while its room is found but not yet reachable (it's alive). */
  aliveMul: 3,
  /** New host that skipped an unreachable candidate: how long it keeps trying to join that one instead while nobody joins it (s). */
  heal: 90,
  /** New host: how long menus wait for migrating teammates before the autopilot answers for them (s). */
  hold: 30,
};

/** Own primitive fields (numbers, booleans, strings) of a plain or class object: lane state with no nested objects. */
export type Prims = Record<string, number | boolean | string>;

const NUM_TAG = '#num:';

export function prims(o: object | null | undefined): Prims {
  const out: Prims = {};
  if (!o) return out;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'number') {
      // PeerJS's binarypack throws on integers it can't fit (Infinity counts as one): those travel as text.
      if (Number.isFinite(v) && Math.abs(v) < 2 ** 52) out[k] = v;
      else if (!Number.isNaN(v)) out[k] = NUM_TAG + v;
    } else if (typeof v === 'boolean' || typeof v === 'string') out[k] = v;
  }
  return out;
}

/** Write primitive fields back, only where the target has a field of the same type (never adds or retypes). */
export function applyPrims(o: object | null | undefined, p: unknown): void {
  if (!o || !p || typeof p !== 'object') return;
  const t = o as Record<string, unknown>;
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    if (!(k in t)) continue;
    const cur = t[k];
    if (typeof cur === 'number' && typeof v === 'string' && v.startsWith(NUM_TAG)) {
      t[k] = Number(v.slice(NUM_TAG.length));
      continue;
    }
    if (typeof cur !== typeof v || (typeof v !== 'number' && typeof v !== 'boolean' && typeof v !== 'string')) continue;
    try {
      t[k] = v;
    } catch {
      // a getter-only field
    }
  }
}

// ---------------------------------------------------------------- enemies

/** One enemy as the new host rebuilds it. */
export interface MigEnemy {
  id: string;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  speedMul: number;
  dmgMul: number;
  shield: number;
  elite: boolean;
  mod: EliteModId | null;
  phase: number;
  enraged: boolean;
  mutated: boolean;
  /** 1 the stage boss, 2 the mini-boss. */
  role: number;
}

interface EnemyLike {
  active: boolean;
  def: { id: string; hidden?: boolean };
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  speedMul: number;
  dmgMul: number;
  shield: number;
  elite: boolean;
  mod: { id: string } | null;
  phase: number;
  enraged: boolean;
  mutated: boolean;
}

const w = new ByteWriter(4096);

/**
 * Every live enemy: a def-id string table, then per enemy u16 def, cm positions
 * (i32), f32 life and max life, u16 speed and damage multipliers (x1000 / x100),
 * f32 shield, u8 flags, u8 elite modifier, u8 phase. About 25 B each.
 */
export function packMigEnemies(list: readonly EnemyLike[], boss: unknown, mini: unknown): ArrayBuffer {
  const ids: string[] = [];
  const idx = new Map<string, number>();
  const live = list.filter((e) => e.active && !e.def.hidden);
  for (const e of live) if (!idx.has(e.def.id)) idx.set(e.def.id, ids.push(e.def.id) - 1);
  w.reset();
  w.uv(ids.length);
  for (const id of ids) w.str(id);
  w.uv(live.length);
  for (const e of live) {
    w.u16(idx.get(e.def.id)!);
    w.sv(Math.round(e.x * 100));
    w.sv(Math.round(e.z * 100));
    w.f32(Math.max(0, e.hp));
    w.f32(Math.max(1, e.maxHp));
    w.u16(Math.max(0, Math.min(65535, Math.round(e.speedMul * 1000))));
    w.u16(Math.max(0, Math.min(65535, Math.round(e.dmgMul * 100))));
    w.f32(Math.max(0, e.shield));
    const role = e === boss ? 1 : e === mini ? 2 : 0;
    w.u8((e.elite ? 1 : 0) | (e.enraged ? 2 : 0) | (e.mutated ? 4 : 0) | (role << 3));
    w.u8(e.mod ? ELITE_MOD_IDS.indexOf(e.mod.id as EliteModId) + 1 : 0);
    w.u8(Math.max(0, Math.min(255, e.phase)));
  }
  return w.bytes();
}

export function unpackMigEnemies(b: NetBytes): MigEnemy[] {
  const r = new ByteReader(b);
  const ids: string[] = [];
  for (let n = r.uv(), i = 0; i < n; i++) ids.push(r.str());
  const out: MigEnemy[] = [];
  for (let n = r.uv(), i = 0; i < n; i++) {
    const id = ids[r.u16()] ?? '';
    const x = r.sv() / 100;
    const z = r.sv() / 100;
    const hp = r.f32();
    const maxHp = r.f32();
    const speedMul = r.u16() / 1000;
    const dmgMul = r.u16() / 100;
    const shield = r.f32();
    const f = r.u8();
    const m = r.u8();
    const phase = r.u8();
    out.push({ id, x, z, hp, maxHp, speedMul, dmgMul, shield, elite: !!(f & 1), enraged: !!(f & 2), mutated: !!(f & 4), role: (f >> 3) & 3, mod: m > 0 ? (ELITE_MOD_IDS[m - 1] ?? null) : null, phase: Math.max(1, phase) });
  }
  return out;
}

/** Enemy defs this build knows (a migration snapshot from a different content set skips the rest). */
export function knownEnemy(id: string): boolean {
  return !!ENEMIES[id];
}

// ---------------------------------------------------------------- pickups

interface PickupsLike {
  count: number;
  x: Float32Array;
  z: Float32Array;
  value: Float32Array;
  type: Uint8Array;
}

/** Every pickup on the ground: u8 type, cm positions, f32 value (gem XP, gold, chest owner...). */
export function packMigPickups(p: PickupsLike): ArrayBuffer {
  w.reset();
  w.uv(p.count);
  for (let i = 0; i < p.count; i++) {
    w.u8(p.type[i]);
    w.sv(Math.round(p.x[i] * 100));
    w.sv(Math.round(p.z[i] * 100));
    w.f32(p.value[i]);
  }
  return w.bytes();
}

export function unpackMigPickups(b: NetBytes): { type: number; x: number; z: number; value: number }[] {
  const r = new ByteReader(b);
  const out: { type: number; x: number; z: number; value: number }[] = [];
  for (let n = r.uv(), i = 0; i < n; i++) {
    const type = r.u8();
    const x = r.sv() / 100;
    const z = r.sv() / 100;
    out.push({ type, x, z, value: r.f32() });
  }
  return out;
}

// ---------------------------------------------------------------- electing the new host

/**
 * The new host: the lowest join order (hero index) among the players the old
 * host still had connected (`cands`, its own index left out), skipping anyone
 * this machine already failed to reach. Every client runs this on the same
 * snapshot, so they agree without talking to each other. -1: nobody left.
 */
export function electHost(cands: readonly number[], oldHost: number, skip: ReadonlySet<number>): number {
  let best = -1;
  for (const i of cands) if (i !== oldHost && !skip.has(i) && (best < 0 || i < best)) best = i;
  return best;
}

/** The run's base invite code (a migrated room "ABCDE-M1H2" -> "ABCDE"). */
export function baseCode(code: string): string {
  return code.toUpperCase().replace(/-M\d+H\d+$/, '').replace(/[^A-Z0-9]/g, '').slice(0, 5);
}
