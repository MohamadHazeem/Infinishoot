import { Rng } from '../core/rng';

/**
 * Co-op that needs teamwork (pure logic, no Game or rendering; the Game side is
 * src/game/systems/coopplay.ts). Four co-op stage objectives that only roll with
 * 2+ players, carrying downed teammates, the buddy tether and co-op banter.
 *
 *   door    TWO-SWITCH DOOR: two heroes hold two switches at once to open a vault
 *   escort  ESCORT THE CORE: a slow core rolls to a beacon while a hero is near; enemies go for it
 *   zones   HOLD TWO ZONES: a hero in each ring at the same time charges them
 *   bomb    CARRY THE BOMB: one hero carries it (slowly) to a sealed bunker, or the boss, and it blows
 */
export type CoopObjKind = 'door' | 'escort' | 'zones' | 'bomb';
export const COOP_OBJECTIVE_KINDS: readonly CoopObjKind[] = ['door', 'escort', 'zones', 'bomb'];

export function isCoopKind(kind: string): kind is CoopObjKind {
  return (COOP_OBJECTIVE_KINDS as readonly string[]).includes(kind);
}

export const coopObjTuning = {
  /** Share of co-op stages that roll a co-op objective instead of the solo one. */
  chance: 0.6,
  // Two-switch door
  switchRadius: 1.5, // stand this close to a switch to hold it
  switchGap: 7.5, // switches stand this far either side of the vault (15 m apart: one hero can't hold both)
  holdTime: 1.2, // both held this long opens the vault
  // Escort the core
  escortMin: 26, // start-to-beacon distance range (m)
  escortMax: 46,
  escortSpeed: 1.7, // m/s while a hero is near
  escortRadius: 6, // a hero this close keeps it rolling
  coreHp: 100,
  coreHit: 1.9, // enemies this close chew on it
  coreDrain: 2.5, // life per second per enemy
  coreDrainMax: 5,
  coreRegen: 1.5, // while nothing is chewing on it
  coreArrive: 1.6, // close enough to the beacon
  // Hold two zones
  zoneRadius: 3.6,
  zoneGapMin: 16,
  zoneGapMax: 30,
  zoneTime: 25, // seconds with both held
  zoneDecay: 0.5, // progress lost per second while not enough zones are held
  zoneContested: 0.5, // progress speed while enemies stand in a held zone
  // Carry the bomb
  bombGapMin: 22,
  bombGapMax: 42,
  bombPick: 1.5, // walk over it to pick it up
  bombSpeed: 0.65, // carrier's move speed
  bombPlant: 2.8, // this close to the bunker (or boss + its radius) plants it
  bombFuse: 2.5, // seconds from planting to the blast
  bombBossFrac: 0.12, // share of a boss's max life the blast takes (and its shield)
  bombBlast: 5, // enemies in this radius take the blast too
  bombBlastDmg: 60, // + 25 per stage
  bombBlastPerStage: 25,
};

export const carryTuning = {
  pickRange: 1.9, // walk this close to a downed teammate, then press INTERACT
  speed: 0.6, // carrier's move speed
  dropAhead: 0.9, // put down this far in front
  lift: 1.25, // drawn this high over the carrier
};

export const tetherTuning = {
  range: 7, // a link forms within this distance...
  breakRange: 7.8, // ...and snaps beyond this one
  ramp: 20, // seconds linked to reach the full bonus
  base: 0.25, // share of the full bonus as soon as a link forms
  damage: 0.12, // full damage bonus (+12%)
  regen: 1.0, // full regen bonus (life per second)
  decay: 4, // link time lost per second while unlinked
  snapMin: 2, // a link must have lasted this long to show the snap effect
};

export const banterTuning = {
  gap: 5, // seconds between any two banter lines (whole team)
  perHero: 9, // seconds between lines from the same hero
  perLine: 22, // seconds before the same hero says the same line again
  behindRange: 3.6, // enemies this close behind a teammate
  behindCount: 2, // at least this many (or one elite)
  behindCallRange: 16, // the caller must be this close to the teammate
  behindEvery: 0.5, // host check interval (s)
  saveRange: 3.2, // a kill this close to a hurt teammate is a save
  saveHp: 0.4, // ...when they are under this share of life
  groupUpSpread: 14, // a pinger whose teammates are this far (on average) asks to group up
  onMyWayDist: 6, // a teammate this far away replies "On my way!"
  onMyWayDelay: 1.1,
  greatShotRange: 26,
  switchWait: 3, // alone on a switch this long: "Group up!"
};

export type BanterLine = 'nicesave' | 'behind' | 'thanks' | 'groupup' | 'onmyway' | 'greatshot';
export const BANTER_LINES: readonly BanterLine[] = ['nicesave', 'behind', 'thanks', 'groupup', 'onmyway', 'greatshot'];
/** Heroes with recorded banter (public/audio/banter_<hero>_<line>.mp3); others borrow the Rookie's. */
export const BANTER_HEROES: ReadonlySet<string> = new Set(['rookie', 'bulwark', 'dash', 'ace', 'duelist', 'furnace', 'twin', 'ronin', 'tinker']);
export const BANTER_TEXT: Readonly<Record<BanterLine, string>> = {
  nicesave: 'Nice save!',
  behind: 'Behind you!',
  thanks: 'Thanks for the revive!',
  groupup: 'Group up!',
  onmyway: 'On my way!',
  greatshot: 'Great shot!',
};

export function banterSample(heroId: string, line: BanterLine): string {
  return `banter_${BANTER_HEROES.has(heroId) ? heroId : 'rookie'}_${line}`;
}

/** Effects-bus cue for a banter line (played by src/audio/voices.ts on every machine). */
export function banterCue(heroId: string, line: BanterLine): string {
  return `v:t:${BANTER_HEROES.has(heroId) ? heroId : 'rookie'}:${line}`;
}

/** Host-side banter cooldowns: who may say what, when. */
export class BanterBrain {
  private last = -Infinity;
  private byHero = new Map<number, number>();
  private byLine = new Map<string, number>();

  reset(): void {
    this.last = -Infinity;
    this.byHero.clear();
    this.byLine.clear();
  }

  can(hero: number, line: BanterLine, now: number): boolean {
    const T = banterTuning;
    if (now - this.last < T.gap) return false;
    if (now - (this.byHero.get(hero) ?? -Infinity) < T.perHero) return false;
    return now - (this.byLine.get(hero + ':' + line) ?? -Infinity) >= T.perLine;
  }

  /** Try to say it: true if it may (and the cooldowns start). */
  say(hero: number, line: BanterLine, now: number): boolean {
    if (!this.can(hero, line, now)) return false;
    this.last = now;
    this.byHero.set(hero, now);
    this.byLine.set(hero + ':' + line, now);
    return true;
  }
}

// ---------------------------------------------------------------- tether

/** One step of a hero's link time: grows while linked, drains fast when not. */
export function linkStep(t: number, linked: boolean, dt: number): number {
  return linked ? Math.min(tetherTuning.ramp * 2, t + dt) : Math.max(0, t - tetherTuning.decay * dt);
}

/** 0..1 strength of a link that has lasted t seconds (0 when unlinked). */
export function linkStrength(t: number): number {
  if (t <= 0) return 0;
  const T = tetherTuning;
  return T.base + (1 - T.base) * Math.min(1, t / T.ramp);
}

export function tetherBonus(t: number): { damage: number; regen: number } {
  const k = linkStrength(t);
  return { damage: tetherTuning.damage * k, regen: tetherTuning.regen * k };
}

/** Hysteresis: a pair links within `range` and stays linked up to `breakRange`. */
export function pairLinked(dist: number, wasLinked: boolean): boolean {
  return dist <= (wasLinked ? tetherTuning.breakRange : tetherTuning.range);
}

// ---------------------------------------------------------------- objectives

/** Which co-op objective a stage offers, or null for the usual solo one (seeded: every machine agrees). */
export function pickCoopObjective(seed: number, stage: number): CoopObjKind | null {
  const rng = new Rng((seed ^ Math.imul(stage + 11, 0x45d9f3b) ^ 0xc0091a) >>> 0);
  rng.next();
  if (!rng.chance(coopObjTuning.chance)) return null;
  return rng.pick(COOP_OBJECTIVE_KINDS as CoopObjKind[]);
}

export function coopObjectiveMax(kind: CoopObjKind): number {
  switch (kind) {
    case 'door':
      return 2;
    case 'escort':
      return 100;
    case 'zones':
      return coopObjTuning.zoneTime;
    case 'bomb':
      return 1;
  }
}

/** Where a co-op objective's pieces stand. a/b: switches or zones; v: vault / bunker; s/e: escort start and beacon; bomb: the bomb's spot. */
export interface CoopLayout {
  a: { x: number; z: number };
  b: { x: number; z: number };
  v: { x: number; z: number };
}

/**
 * Lay out a co-op objective on the arena's objective spots. `clear(x, z, r)` says
 * whether a circle is free ground. Returns null when it doesn't fit (the stage
 * keeps its solo objective).
 *   door: v = vault, a/b = switches either side
 *   escort: a = core start, b = beacon
 *   zones: a/b = the two zones (v = their midpoint)
 *   bomb: a = bomb, v = sealed bunker
 */
export function layoutCoop(kind: CoopObjKind, spots: readonly { x: number; z: number }[], clear: (x: number, z: number, r: number) => boolean, seed: number): CoopLayout | null {
  const T = coopObjTuning;
  const rng = new Rng((seed ^ 0x5eed7) >>> 0);
  const list = spots.filter((s) => clear(s.x, s.z, 1.2));
  if (!list.length) return null;
  const dist = (p: { x: number; z: number }, q: { x: number; z: number }) => Math.hypot(p.x - q.x, p.z - q.z);
  const pairIn = (min: number, max: number, ra: number, rb: number) => {
    for (const p of list) for (const q of list) if (p !== q && dist(p, q) >= min && dist(p, q) <= max && clear(p.x, p.z, ra) && clear(q.x, q.z, rb)) return [p, q] as const;
    return null;
  };
  if (kind === 'door') {
    // The spot nearest the middle that fits a vault with a switch either side.
    const sorted = [...list].sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));
    for (const v of sorted) {
      if (!clear(v.x, v.z, 2.2)) continue;
      const a0 = rng.range(0, Math.PI);
      for (let k = 0; k < 8; k++) {
        const ang = a0 + (k * Math.PI) / 8;
        const dx = Math.cos(ang) * T.switchGap;
        const dz = Math.sin(ang) * T.switchGap;
        const a = { x: v.x + dx, z: v.z + dz };
        const b = { x: v.x - dx, z: v.z - dz };
        if (Math.abs(a.x) > 50 || Math.abs(a.z) > 50 || Math.abs(b.x) > 50 || Math.abs(b.z) > 50) continue;
        if (clear(a.x, a.z, 1.4) && clear(b.x, b.z, 1.4)) return { a, b, v: { x: v.x, z: v.z } };
      }
    }
    return null;
  }
  if (kind === 'escort') {
    const pq = pairIn(T.escortMin, T.escortMax, 1.4, 1.4);
    if (!pq) return null;
    // Start at the end nearer the middle, so the walk leads out into the field.
    const [p, q] = Math.hypot(pq[0].x, pq[0].z) <= Math.hypot(pq[1].x, pq[1].z) ? pq : [pq[1], pq[0]];
    return { a: { x: p.x, z: p.z }, b: { x: q.x, z: q.z }, v: { x: q.x, z: q.z } };
  }
  if (kind === 'zones') {
    const pq = pairIn(T.zoneGapMin, T.zoneGapMax, 2.5, 2.5) ?? pairIn(T.zoneGapMin, T.zoneGapMax + 12, 1.4, 1.4);
    if (!pq) return null;
    const [p, q] = pq;
    return { a: { x: p.x, z: p.z }, b: { x: q.x, z: q.z }, v: { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 } };
  }
  const pq = pairIn(T.bombGapMin, T.bombGapMax, 1.2, 2.2);
  if (!pq) return null;
  const [p, q] = pq;
  return { a: { x: p.x, z: p.z }, b: { x: p.x, z: p.z }, v: { x: q.x, z: q.z } };
}

/** How many pieces must be held at once with `team` heroes in the run (a lone hero still can finish). */
export function needHeld(team: number): number {
  return Math.max(1, Math.min(2, team));
}

/** Door: hold timer step. Returns the new timer; >= holdTime opens it. */
export function doorStep(hold: number, held: number, need: number, dt: number): number {
  return held >= need ? hold + dt : Math.max(0, hold - dt * 2);
}

/** Zones: progress step (seconds of max). */
export function zonesStep(cur: number, held: number, need: number, contested: boolean, dt: number): number {
  const T = coopObjTuning;
  if (held >= need) return Math.min(T.zoneTime, cur + dt * (contested ? T.zoneContested : 1));
  return Math.max(0, cur - T.zoneDecay * dt);
}

/** Escort: core life step. Returns the new life (0 = destroyed). */
export function coreStep(hp: number, chewing: number, dt: number): number {
  const T = coopObjTuning;
  if (chewing > 0) return Math.max(0, hp - T.coreDrain * Math.min(chewing, T.coreDrainMax) * dt);
  return Math.min(T.coreHp, hp + T.coreRegen * dt);
}

/** Escort progress in percent of the start-to-beacon distance. */
export function escortPercent(sx: number, sz: number, ex: number, ez: number, x: number, z: number): number {
  const total = Math.hypot(ex - sx, ez - sz) || 1;
  return Math.max(0, Math.min(100, (1 - Math.hypot(ex - x, ez - z) / total) * 100));
}

/**
 * Steer the core toward (tx, tz): straight if free, else the nearest free
 * heading, trying the `side` it detoured to last first (so it follows a wall
 * instead of dithering). `blocked(x, z)` tests the next spot. Returns the new
 * position and the side it turned to (0 = straight on).
 */
export function steerCore(x: number, z: number, tx: number, tz: number, step: number, blocked: (x: number, z: number) => boolean, side = 1): { x: number; z: number; side: number } {
  const d = Math.hypot(tx - x, tz - z);
  if (d < 1e-6) return { x, z, side: 0 };
  const s = Math.min(step, d);
  const base = Math.atan2(tz - z, tx - x);
  const pref = side < 0 ? -1 : 1;
  if (!blocked(x + Math.cos(base) * s, z + Math.sin(base) * s)) return { x: x + Math.cos(base) * s, z: z + Math.sin(base) * s, side };
  // The remembered side first, all the way round to backing off, then the other side.
  for (const sgn of [pref, -pref]) {
    for (const off of STEER_OFFSETS) {
      const a = base + off * sgn;
      const nx = x + Math.cos(a) * s;
      const nz = z + Math.sin(a) * s;
      if (!blocked(nx, nz)) return { x: nx, z: nz, side: sgn };
    }
  }
  return { x, z, side };
}
const STEER_OFFSETS = [0.4, 0.8, 1.2, 1.6, 2.0, 2.4];

/** Objective HUD lines for the co-op kinds (see Objective in src/game/objectives.ts). */
export function coopTitle(kind: CoopObjKind): string {
  switch (kind) {
    case 'door':
      return 'OPEN THE VAULT TOGETHER';
    case 'escort':
      return 'ESCORT THE CORE';
    case 'zones':
      return 'HOLD BOTH ZONES';
    case 'bomb':
      return 'CARRY THE BOMB';
  }
}

export function coopCount(kind: CoopObjKind, cur: number, max: number): string {
  switch (kind) {
    case 'door':
      return `${Math.floor(cur)}/2 ON`;
    case 'escort':
      return `${Math.floor(cur)}%`;
    case 'zones':
      return `${Math.floor(cur)}/${max} S`;
    case 'bomb':
      return cur >= max ? 'BOOM' : 'TEAM';
  }
}

/** `charging` and `attacked` are the Objective's flags: door both held; escort rolling / under attack; zones charging; bomb carried / planted. */
export function coopHint(kind: CoopObjKind, cur: number, charging: boolean, attacked: boolean, boss: boolean): string {
  switch (kind) {
    case 'door':
      return cur >= 2 ? 'Hold them!' : cur === 1 ? 'Need a buddy on the other switch!' : 'One hero on each switch';
    case 'escort':
      return attacked ? 'Keep enemies off the core!' : charging ? 'Keep it rolling!' : 'Stay near the core to move it';
    case 'zones':
      return charging ? 'Hold both zones!' : 'One hero in each zone';
    case 'bomb':
      return attacked ? 'Get clear of the blast!' : charging ? (boss ? 'Carry it to the boss!' : 'Carry it to the bunker!') : 'Pick it up, cover the carrier';
  }
}
