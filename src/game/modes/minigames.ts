/**
 * Bonus mini-games between stages (modes lane): a 20-second game for gold, played on the real
 * field with the real controls right after the team picks the Bonus Arcade road on the route map.
 *   Shooting Gallery  targets pop up around you: aim and click (one shot every 0.28 s). Gold
 *                     targets pay more, bomb targets cost gold.
 *   Coin Dash         coins rain onto the field in waves and fade after a few seconds: run them down.
 *   Whack-a-Bot       bots pop out of nine holes: stomp them (walk or dash onto them) before they
 *                     duck. Red bots are bombs.
 * Co-op: everyone plays at once and each hero earns their own gold. Pure and seeded: the host
 * steps it (src/game/systems/modes.ts applies the gold and effects), clients draw the snapshot.
 */
import { Rng } from '../../core/rng';

export type MiniKind = 'gallery' | 'coins' | 'whack';
export const MINI_KINDS: readonly MiniKind[] = ['gallery', 'coins', 'whack'];

export interface MiniDef {
  id: MiniKind;
  name: string;
  how: string;
  color: string;
}

export const MINI_GAMES: Record<MiniKind, MiniDef> = {
  gallery: { id: 'gallery', name: 'SHOOTING GALLERY', how: 'AIM AND CLICK THE TARGETS · GOLD PAYS MORE · DON\'T SHOOT THE BOMBS', color: '#ef7d57' },
  coins: { id: 'coins', name: 'COIN DASH', how: 'GRAB THE COINS BEFORE THEY FADE · BIG COINS PAY 4', color: '#ffcd75' },
  whack: { id: 'whack', name: 'WHACK-A-BOT', how: 'STOMP THE BOTS BEFORE THEY DUCK · RED BOTS ARE BOMBS', color: '#38b764' },
};

export const miniTuning = {
  intro: 2.5,
  play: 20,
  outro: 3,
  /** Gold values grow x(1 + stageMul per stage after the first). */
  stageMul: 0.15,
  /** Spawn areas are ellipses this much shorter front to back (to stay on screen). */
  depth: 0.6,
  // Shooting gallery
  galleryEvery: 0.55,
  galleryUp: 1.8, // seconds a target stays up (including its rise)
  galleryRise: 0.25,
  galleryR: 0.85, // hit radius
  galleryMin: 5,
  galleryMax: 13,
  galleryRange: 26,
  galleryShot: 0.28, // seconds between shots
  galleryMax2: 7, // most targets up at once
  goldShare: 0.12,
  bombShare: 0.14,
  targetValue: 1,
  goldValue: 3,
  bombCost: 2,
  // Coin dash
  coinEvery: 2,
  coinWave: 4,
  coinLife: 4,
  coinR: 0.95,
  coinArea: 12,
  bigShare: 0.08,
  coinValue: 1,
  bigValue: 4,
  // Whack-a-bot
  holeGap: 4.4,
  whackEvery: 0.45,
  whackUpMin: 0.9,
  whackUpMax: 1.45,
  whackRise: 0.18,
  whackR: 1.15,
  whackValue: 1,
  whackBomb: 0.18,
};

/** Item kinds: 0 normal, 1 golden / big, 2 bomb. */
export interface MiniItem {
  id: number;
  kind: 0 | 1 | 2;
  x: number;
  z: number;
  age: number;
  life: number;
  /** Hero who hit or took it (-1 = still up). */
  by: number;
  /** Seconds since it was hit (for the pop animation). */
  hitT: number;
}

/** 0 intro (countdown), 1 play, 2 results. */
export type MiniPhase = 0 | 1 | 2;

export interface MiniGame {
  kind: MiniKind;
  phase: MiniPhase;
  /** Seconds into the current phase. */
  t: number;
  cx: number;
  cz: number;
  stage: number;
  items: MiniItem[];
  /** Gold each hero earned (by hero index). */
  gold: number[];
  /** Hits / grabs each hero made. */
  hits: number[];
  holes: { x: number; z: number }[];
  shotCd: number[];
  spawnT: number;
  nextId: number;
  rng: Rng;
}

/** What one hero does this step (index matches `gold`). */
export interface MiniHero {
  x: number;
  z: number;
  radius: number;
  aimX: number;
  aimZ: number;
  firing: boolean;
  alive: boolean;
}

export type MiniEventType = 'hit' | 'bomb' | 'shot' | 'grab' | 'whack' | 'spawn';

export interface MiniEvent {
  type: MiniEventType;
  hero: number;
  x: number;
  z: number;
  gold: number;
  kind: 0 | 1 | 2;
  /** Shots: where the tracer ends. */
  tx?: number;
  tz?: number;
}

function seedOf(seed: number, stage: number, salt: number): number {
  let h = (seed ^ Math.imul(stage + 3, 0x9e3779b1) ^ Math.imul(salt, 0x7feb352d)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

/** Which mini-game the arcade before `stage` plays (seeded: same on every machine). */
export function miniKindFor(seed: number, stage: number): MiniKind {
  return MINI_KINDS[seedOf(seed, stage, 11) % MINI_KINDS.length];
}

/** A gold value at this stage. */
export function miniValue(base: number, stage: number): number {
  return Math.max(1, Math.round(base * (1 + miniTuning.stageMul * Math.max(0, stage - 1))));
}

/**
 * A new game centred on (cx, cz). `blocked(x, z, r)` rejects spots inside walls.
 * `heroes` is the team size (gold and hit counters per hero index).
 */
export function newMiniGame(kind: MiniKind, seed: number, stage: number, cx: number, cz: number, heroes: number, blocked: (x: number, z: number, r: number) => boolean = () => false): MiniGame {
  const mg: MiniGame = {
    kind,
    phase: 0,
    t: 0,
    cx,
    cz,
    stage,
    items: [],
    gold: new Array(heroes).fill(0),
    hits: new Array(heroes).fill(0),
    holes: [],
    shotCd: new Array(heroes).fill(0),
    spawnT: 0,
    nextId: 1,
    rng: new Rng(seedOf(seed, stage, 23)),
  };
  if (kind === 'whack') {
    const g = miniTuning.holeGap;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      let x = cx + i * g;
      let z = cz + j * g;
      // Nudge a hole off a wall toward the centre (the centre spot is always the hero's own).
      for (let k = 0; k < 4 && blocked(x, z, 0.9); k++) {
        x += (cx - x) * 0.35;
        z += (cz - z) * 0.35;
      }
      mg.holes.push({ x, z });
    }
  }
  return mg;
}

/** Seconds left in the play phase (the intro counts down to it). */
export function miniLeft(mg: MiniGame): number {
  if (mg.phase === 0) return miniTuning.play;
  if (mg.phase === 1) return Math.max(0, miniTuning.play - mg.t);
  return 0;
}

/** True once the results have been shown. */
export function miniOver(mg: MiniGame): boolean {
  return mg.phase === 2 && mg.t >= miniTuning.outro;
}

function spot(mg: MiniGame, minR: number, maxR: number, blocked: (x: number, z: number, r: number) => boolean, avoid: number): { x: number; z: number } {
  for (let k = 0; k < 12; k++) {
    const a = mg.rng.next() * Math.PI * 2;
    const r = minR + (maxR - minR) * Math.sqrt(mg.rng.next());
    // An ellipse squashed front to back: the camera sees more of the field sideways.
    const x = mg.cx + Math.cos(a) * r;
    const z = mg.cz + Math.sin(a) * r * miniTuning.depth;
    if (blocked(x, z, 0.8)) continue;
    if (mg.items.some((it) => it.by < 0 && Math.hypot(it.x - x, it.z - z) < avoid)) continue;
    return { x, z };
  }
  return { x: mg.cx + (mg.rng.next() - 0.5) * minR, z: mg.cz + (mg.rng.next() - 0.5) * minR };
}

function add(mg: MiniGame, kind: 0 | 1 | 2, x: number, z: number, life: number, out: MiniEvent[]): void {
  mg.items.push({ id: mg.nextId++, kind, x, z, age: 0, life, by: -1, hitT: 0 });
  out.push({ type: 'spawn', hero: -1, x, z, gold: 0, kind });
}

/** Credit `gold` (can be negative) to hero i, never below the gold they made in this game. */
function pay(mg: MiniGame, i: number, gold: number): number {
  const before = mg.gold[i] ?? 0;
  const after = Math.max(0, before + gold);
  mg.gold[i] = after;
  return after - before;
}

/**
 * One step. Returns what happened (gold is already counted in `mg.gold`; the caller pays it out).
 * Deterministic for the same inputs.
 */
export function miniStep(mg: MiniGame, dt: number, heroes: readonly MiniHero[], blocked: (x: number, z: number, r: number) => boolean = () => false, out: MiniEvent[] = []): MiniEvent[] {
  const T = miniTuning;
  out.length = 0;
  mg.t += dt;
  if (mg.phase === 0) {
    if (mg.t >= T.intro) {
      mg.phase = 1;
      mg.t = 0;
      mg.spawnT = 0;
    }
    return out;
  }
  if (mg.phase === 2) {
    for (const it of mg.items) it.hitT += dt;
    return out;
  }
  if (mg.t >= T.play) {
    mg.phase = 2;
    mg.t = 0;
    for (const it of mg.items) if (it.by < 0) it.by = -2; // left over: duck away
    return out;
  }
  // Age, retire and spawn.
  for (const it of mg.items) {
    it.age += dt;
    if (it.by !== -1) it.hitT += dt;
  }
  for (let i = mg.items.length - 1; i >= 0; i--) {
    const it = mg.items[i];
    if ((it.by === -1 && it.age >= it.life) || (it.by !== -1 && it.hitT > 0.6)) mg.items.splice(i, 1);
  }
  mg.spawnT -= dt;
  const up = mg.items.filter((it) => it.by === -1).length;
  if (mg.kind === 'gallery') {
    if (mg.spawnT <= 0 && up < T.galleryMax2) {
      mg.spawnT = T.galleryEvery * (0.75 + mg.rng.next() * 0.5);
      const p = spot(mg, T.galleryMin, T.galleryMax, blocked, 2.2);
      const r = mg.rng.next();
      add(mg, r < T.bombShare ? 2 : r < T.bombShare + T.goldShare ? 1 : 0, p.x, p.z, T.galleryUp, out);
    }
  } else if (mg.kind === 'coins') {
    if (mg.spawnT <= 0) {
      mg.spawnT = T.coinEvery;
      for (let k = 0; k < T.coinWave; k++) {
        const p = spot(mg, 1.5, T.coinArea, blocked, 1.2);
        add(mg, mg.rng.next() < T.bigShare ? 1 : 0, p.x, p.z, T.coinLife * (0.8 + mg.rng.next() * 0.4), out);
      }
    }
  } else if (mg.spawnT <= 0) {
    mg.spawnT = T.whackEvery * (0.7 + mg.rng.next() * 0.6);
    const free = mg.holes.filter((h) => !mg.items.some((it) => it.by === -1 && it.x === h.x && it.z === h.z));
    if (free.length) {
      const h = free[Math.floor(mg.rng.next() * free.length)];
      add(mg, mg.rng.next() < T.whackBomb ? 2 : 0, h.x, h.z, T.whackUpMin + (T.whackUpMax - T.whackUpMin) * mg.rng.next(), out);
    }
  }
  // Heroes act.
  for (let i = 0; i < heroes.length; i++) {
    const h = heroes[i];
    if (!h.alive) continue;
    mg.shotCd[i] = Math.max(0, (mg.shotCd[i] ?? 0) - dt);
    if (mg.kind === 'gallery') {
      if (!h.firing || mg.shotCd[i] > 0) continue;
      mg.shotCd[i] = T.galleryShot;
      const al = Math.hypot(h.aimX, h.aimZ) || 1;
      const ax = h.aimX / al;
      const az = h.aimZ / al;
      let best: MiniItem | null = null;
      let bd = T.galleryRange;
      for (const it of mg.items) {
        if (it.by !== -1 || it.age < T.galleryRise * 0.6) continue;
        const dx = it.x - h.x;
        const dz = it.z - h.z;
        const along = dx * ax + dz * az;
        if (along <= 0 || along >= bd) continue;
        const side = Math.abs(dx * az - dz * ax);
        if (side > T.galleryR) continue;
        bd = along;
        best = it;
      }
      if (!best) {
        out.push({ type: 'shot', hero: i, x: h.x, z: h.z, gold: 0, kind: 0, tx: h.x + ax * 12, tz: h.z + az * 12 });
        continue;
      }
      best.by = i;
      best.hitT = 0;
      const gold = best.kind === 2 ? pay(mg, i, -miniValue(T.bombCost, mg.stage)) : pay(mg, i, miniValue(best.kind === 1 ? T.goldValue : T.targetValue, mg.stage));
      if (best.kind !== 2) mg.hits[i]++;
      out.push({ type: best.kind === 2 ? 'bomb' : 'hit', hero: i, x: best.x, z: best.z, gold, kind: best.kind, tx: best.x, tz: best.z });
    } else {
      const reach = (mg.kind === 'coins' ? T.coinR : T.whackR) + h.radius;
      for (const it of mg.items) {
        if (it.by !== -1) continue;
        if (mg.kind === 'whack' && it.age < T.whackRise * 0.5) continue;
        if ((it.x - h.x) ** 2 + (it.z - h.z) ** 2 > reach * reach) continue;
        it.by = i;
        it.hitT = 0;
        let gold: number;
        if (mg.kind === 'coins') gold = pay(mg, i, miniValue(it.kind === 1 ? T.bigValue : T.coinValue, mg.stage));
        else gold = it.kind === 2 ? pay(mg, i, -miniValue(T.bombCost, mg.stage)) : pay(mg, i, miniValue(T.whackValue, mg.stage));
        if (it.kind !== 2) mg.hits[i]++;
        out.push({ type: mg.kind === 'coins' ? 'grab' : it.kind === 2 ? 'bomb' : 'whack', hero: i, x: it.x, z: it.z, gold, kind: it.kind });
      }
    }
  }
  return out;
}

/** Snapshot form (clients draw it): [kind, phase, t, cx, cz, gold[], hits[], items flat (id, kind, x, z, age, life, by, hitT), stage, holes flat]. */
export function miniNet(mg: MiniGame): unknown[] {
  const r = (v: number) => Math.round(v * 100) / 100;
  const flat: number[] = [];
  for (const it of mg.items) flat.push(it.id, it.kind, r(it.x), r(it.z), r(it.age), r(it.life), it.by, r(it.hitT));
  const holes = mg.holes.flatMap((h) => [r(h.x), r(h.z)]);
  return [MINI_KINDS.indexOf(mg.kind), mg.phase, r(mg.t), r(mg.cx), r(mg.cz), mg.gold.slice(), mg.hits.slice(), flat, mg.stage, holes];
}

/** Client: rebuild the drawable state from `miniNet` (null if malformed). */
export function miniFromNet(a: unknown, prev: MiniGame | null): MiniGame | null {
  if (!Array.isArray(a) || a.length < 8) return null;
  const kind = MINI_KINDS[Number(a[0])] ?? 'gallery';
  const mg: MiniGame = prev && prev.kind === kind ? prev : newMiniGame(kind, 0, Number(a[8]) || 1, Number(a[3]) || 0, Number(a[4]) || 0, 0);
  mg.phase = (Number(a[1]) as MiniPhase) || 0;
  mg.t = Number(a[2]) || 0;
  mg.cx = Number(a[3]) || 0;
  mg.cz = Number(a[4]) || 0;
  mg.gold = (a[5] as number[]) ?? [];
  mg.hits = (a[6] as number[]) ?? [];
  mg.stage = Number(a[8]) || 1;
  const holes = (a[9] as number[]) ?? [];
  mg.holes.length = 0;
  for (let k = 0; k + 1 < holes.length; k += 2) mg.holes.push({ x: holes[k], z: holes[k + 1] });
  const flat = (a[7] as number[]) ?? [];
  mg.items.length = 0;
  for (let k = 0; k + 7 < flat.length; k += 8) {
    mg.items.push({ id: flat[k], kind: flat[k + 1] as 0 | 1 | 2, x: flat[k + 2], z: flat[k + 3], age: flat[k + 4], life: flat[k + 5], by: flat[k + 6], hitT: flat[k + 7] });
  }
  return mg;
}
