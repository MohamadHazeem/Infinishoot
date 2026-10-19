/**
 * heroes3 lane: pure state and tuning for the Ronin (melee) and the Tinker
 * (summoner). The Game side is src/game/systems/heroes3.ts; the click weapons
 * are src/game/weapons/katana.ts, iaido.ts and beacon.ts.
 *
 * - Ronin: a 3-hit sword combo (arcs in front, the third hit cleaves), sword
 *   waves at higher ranks, a focused dash-strike that cuts everything it
 *   passes (and again a beat later), a counter-slash on every landed parry.
 * - Tinker: little robots assemble every few seconds up to a cap that grows
 *   with the team level (and shrinks per Tinker in big parties), follow the
 *   Tinker and zap nearby enemies; Scrap Legion drops big temporary mechs.
 */
import type { Game } from './game';
import type { Hero } from './hero';

export const heroes3Tuning = {
  ronin: {
    comboReset: 0.75, // seconds without a swing before the combo starts over
    cleaveRecover: 1.35, // x swing interval after the cleave
    cleaveReach: 0.6, // extra reach on the cleave (m)
    cleaveArc: 1.5, // x arc on the cleave (Crimson Edge: all the way round)
    cleaveKnock: 1.8, // x knockback on the cleave
    cleaveStagger: 0.35, // s of heavy slow on non-bosses the cleave hits
    cleaveStop: 0.06, // hit-stop when the cleave lands (s)
    waveSpeed: 20,
    waveLife: 0.42, // s (Tempest Blade: x2)
    waveWidth: 1.1, // half-width of a wave at size 1 (m)
    waveHits: 8, // enemies one wave can cut
    counterR: 3.8, // the parry counter-slash: radius (m)...
    counterDmg: 3.5, // ...damage (x the katana's)...
    counterKnock: 18,
    counterStop: 0.09,
    focusMin: 0.15, // the dash-strike needs this much focus
    dashSpeed: 34, // m/s
    passDmg: [0.5, 1], // x dmg on the pass, at no / full focus
    cutDmg: [1, 3], // x dmg on the delayed cut, at no / full focus
    cutDelay: 0.22, // s after the dash ends
    cutStop: 0.08,
    phantomDelay: 0.45, // Phantom Step: the afterimage's second cut...
    phantomDmg: 0.6, // ...at this x the cut damage
    phantomRefund: 0.4, // share of the recharge given back per kill
    raijinHops: 2,
    raijinDmg: 0.5, // x the cut damage per lightning hop
    closeKill: 2.5, // Point Blank achievement: kills this close count (m)
  },
  tinker: {
    buildEvery: 4.5, // s between new bots (x stats.cooldownMul)
    capBase: 3, // bots at team level 1...
    capEvery: 5, // ...+1 every this many levels...
    capMax: 6, // ...up to this many per Tinker
    teamBudget: 24, // bots the whole team may field (8 Tinkers: 3 each)
    speed: 8.5,
    aggro: 9, // a bot looks for enemies this far from itself (m)
    leash: 13, // and gives up past this far from its Tinker
    zapRange: 4.5,
    zapEvery: 0.75,
    bigZap: 1.3, // bots zap this much faster at bosses and elites (they swarm big targets)
    zapDmg: 10, // + zapPerLevel x team level, then the Tinker's damage stats
    zapPerLevel: 1,
    hp: 3, // enemy bullets a bot can soak
    regen: 0.25, // hp per second inside a Repair Field
    formation: 2.2, // idle bots trail this far behind
  },
  cuts: {
    // Thousand Cuts (Ronin ultimate)
    range: 11,
    every: 0.07,
    dmg: 2.2, // x typical enemy life
    finale: 4, // the final sheathe cut on everything slashed
    slow: 0.8,
    slowMo: 0.6, // solo: real slow motion at the start (s)
  },
  legion: {
    // Scrap Legion (Tinker ultimate)
    count: 6, // mechs for up to `fullTeam` players...
    fullTeam: 3, // ...then fewer per Tinker (min 2)
    life: 9,
    zapEvery: 0.5,
    range: 9,
    dmg: 1.4, // x typical enemy life per shot (bosses take ultTuning.bossMul)
    blast: 1.6, // splash radius (m)
    stagger: 0.14, // s between drops
  },
};

const R = heroes3Tuning.ronin;

/** Smallest difference between two angles (radians, 0..PI). */
export function angleGap(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d < -Math.PI) d += Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  return Math.abs(d);
}

/**
 * Is a target at offset (dx, dz) with radius r inside a sword arc of `reach`
 * centred on angle a0 spanning `arcDeg` degrees? Point-blank targets always count.
 */
export function inSwordArc(dx: number, dz: number, r: number, a0: number, arcDeg: number, reach: number): boolean {
  const d = Math.hypot(dx, dz);
  if (d - r > reach) return false;
  if (d < 0.9 || arcDeg >= 359) return true;
  const half = (arcDeg * Math.PI) / 360;
  return angleGap(Math.atan2(dz, dx), a0) <= half + Math.atan2(r, d);
}

/** Combo step after `step` (-1 = none), given the seconds since the last swing. */
export function nextComboStep(step: number, idle: number): number {
  return step < 0 || step >= 2 || idle > R.comboReset ? 0 : step + 1;
}

/** Katana swing for combo step k: reach, arc (deg) and damage multiplier. */
export function swingShape(p: Record<string, number>, k: number, area: number, crimson: boolean): { reach: number; arc: number; mul: number } {
  const cleave = k === 2;
  return {
    reach: (p.reach + (cleave ? R.cleaveReach : 0)) * Math.sqrt(area),
    arc: cleave ? (crimson ? 360 : Math.min(360, p.arc * R.cleaveArc)) : p.arc,
    mul: cleave ? p.cleave : 1,
  };
}

/** Does this swing throw a sword wave? (`wave` 1: the cleave only; 2+: every swing.) */
export function swingWaves(wave: number, k: number): boolean {
  return wave >= 2 || (wave >= 1 && k === 2);
}

/** Dash-strike: distance (m) and the pass / delayed-cut damage multipliers for a focus 0..1. */
export function iaidoStrike(p: Record<string, number>, focus: number): { dist: number; pass: number; cut: number } {
  const f = Math.max(0, Math.min(1, focus));
  return {
    dist: p.dist * (0.45 + 0.55 * f),
    pass: R.passDmg[0] + (R.passDmg[1] - R.passDmg[0]) * f,
    cut: R.cutDmg[0] + (R.cutDmg[1] - R.cutDmg[0]) * f,
  };
}

/** Distance from point (px, pz) to the segment (ax, az)-(bx, bz). */
export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2)) : 0;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

const T = heroes3Tuning.tinker;

/** Bots one Tinker may field at this team level, with `tinkers` Tinkers in the party. */
export function minionCap(level: number, tinkers: number): number {
  const cap = Math.min(T.capMax, T.capBase + Math.floor(Math.max(0, level - 1) / T.capEvery));
  const share = Math.max(1, Math.floor(T.teamBudget / Math.max(1, tinkers)));
  return Math.min(cap, share);
}

/** Scrap Legion mechs per cast for a party of `players`. */
export function legionCount(players: number): number {
  const L = heroes3Tuning.legion;
  return Math.max(2, Math.round(L.count * Math.min(1, L.fullTeam / Math.max(1, players))));
}

/** A bot's zap damage (before the Tinker's damage stats) at this team level. */
export function zapDamage(level: number): number {
  return T.zapDmg + T.zapPerLevel * Math.max(1, level);
}

// ---------------------------------------------------------------- bots

export const MAX_MINIONS = 64;
/** Bot kinds: a little zapper bot, or a Scrap Legion mech. */
export const MinionKind = { Bot: 0, Mech: 1 } as const;
export type MinionKind = (typeof MinionKind)[keyof typeof MinionKind];

/**
 * Every Tinker's bots in one fixed pool (slots stay put, so clients can follow
 * them by slot). Host-simulated; clients mirror the slots from the snapshot.
 */
export class MinionPool {
  readonly alive = new Uint8Array(MAX_MINIONS);
  readonly owner = new Int8Array(MAX_MINIONS);
  readonly kind = new Uint8Array(MAX_MINIONS);
  readonly x = new Float32Array(MAX_MINIONS);
  readonly z = new Float32Array(MAX_MINIONS);
  readonly vx = new Float32Array(MAX_MINIONS);
  readonly vz = new Float32Array(MAX_MINIONS);
  readonly hp = new Float32Array(MAX_MINIONS);
  /** Seconds until the next zap. */
  readonly zapCd = new Float32Array(MAX_MINIONS);
  /** Seconds a zap stays drawn, and where it hit. */
  readonly zapT = new Float32Array(MAX_MINIONS);
  readonly zx = new Float32Array(MAX_MINIONS);
  readonly zz = new Float32Array(MAX_MINIONS);
  /** Seconds left (mechs), -1 = until destroyed. */
  readonly life = new Float32Array(MAX_MINIONS);
  /** Seconds since it was built (drop-in and assembly animation). */
  readonly age = new Float32Array(MAX_MINIONS);
  readonly face = new Float32Array(MAX_MINIONS);
  /** Current target (pooled enemies: check the uid too). */
  readonly target: ({ uid: number } | null)[] = new Array(MAX_MINIONS).fill(null);
  readonly targetUid = new Int32Array(MAX_MINIONS);
  /** Highest slot in use + 1 (loops stop here). */
  top = 0;

  spawn(owner: number, kind: MinionKind, x: number, z: number, life = -1): number {
    for (let i = 0; i < MAX_MINIONS; i++) {
      if (this.alive[i]) continue;
      this.alive[i] = 1;
      this.owner[i] = owner;
      this.kind[i] = kind;
      this.x[i] = x;
      this.z[i] = z;
      this.vx[i] = this.vz[i] = 0;
      this.hp[i] = kind === MinionKind.Mech ? 99 : T.hp;
      this.zapCd[i] = 0.3 + (i % 5) * 0.1;
      this.zapT[i] = 0;
      this.life[i] = life;
      this.age[i] = 0;
      this.target[i] = null;
      this.targetUid[i] = -1;
      this.top = Math.max(this.top, i + 1);
      return i;
    }
    return -1;
  }

  free(i: number): void {
    this.alive[i] = 0;
    this.target[i] = null;
    while (this.top > 0 && !this.alive[this.top - 1]) this.top--;
  }

  countOf(owner: number, kind: MinionKind): number {
    let n = 0;
    for (let i = 0; i < this.top; i++) if (this.alive[i] && this.owner[i] === owner && this.kind[i] === kind) n++;
    return n;
  }

  clear(): void {
    this.alive.fill(0);
    this.target.fill(null);
    this.top = 0;
  }

  get count(): number {
    let n = 0;
    for (let i = 0; i < this.top; i++) n += this.alive[i];
    return n;
  }
}

/** Snapshot form: [slot, flags, x*10, z*10, zx*10, zz*10] per bot near a client (flags: owner | kind<<4 | zapping<<5). */
export function packMinions(m: MinionPool, near: (x: number, z: number) => boolean, out: number[]): number[] {
  out.length = 0;
  for (let i = 0; i < m.top; i++) {
    if (!m.alive[i] || !near(m.x[i], m.z[i])) continue;
    const zap = m.zapT[i] > 0 ? 1 : 0;
    out.push(i, (m.owner[i] & 15) | (m.kind[i] << 4) | (zap << 5), Math.round(m.x[i] * 10), Math.round(m.z[i] * 10), zap ? Math.round(m.zx[i] * 10) : 0, zap ? Math.round(m.zz[i] * 10) : 0);
  }
  return out;
}

/** Client: mirror the snapshot into the pool (slots not listed are gone). Returns the slots that just appeared. */
export function unpackMinions(m: MinionPool, a: readonly number[], born: number[]): void {
  born.length = 0;
  const seen = new Uint8Array(MAX_MINIONS);
  for (let k = 0; k + 5 < a.length; k += 6) {
    const i = a[k];
    if (!(i >= 0 && i < MAX_MINIONS)) continue;
    seen[i] = 1;
    const f = a[k + 1];
    const x = a[k + 2] / 10;
    const z = a[k + 3] / 10;
    if (!m.alive[i]) {
      m.alive[i] = 1;
      m.x[i] = x;
      m.z[i] = z;
      m.age[i] = 0;
      born.push(i);
    }
    m.owner[i] = f & 15;
    m.kind[i] = (f >> 4) & 1;
    // The drawn bot glides to the synced spot (render); vx/vz carry the target here.
    m.vx[i] = x;
    m.vz[i] = z;
    if (f & 32) {
      m.zapT[i] = 0.12;
      m.zx[i] = a[k + 4] / 10;
      m.zz[i] = a[k + 5] / 10;
    }
    m.top = Math.max(m.top, i + 1);
  }
  for (let i = 0; i < m.top; i++) if (m.alive[i] && !seen[i]) m.alive[i] = 0;
  while (m.top > 0 && !m.alive[m.top - 1]) m.top--;
}

/** Every game's bot pool (host: simulated; clients: mirrored). */
const pools = new WeakMap<object, MinionPool>();
export function minionsOf(g: object): MinionPool {
  let m = pools.get(g);
  if (!m) pools.set(g, (m = new MinionPool()));
  return m;
}

/**
 * Game services the ultimates need without importing the systems layer (tests
 * import the ultimates headless): set by src/game/systems/heroes3.ts.
 */
export const heroes3Hooks = {
  /** A hero's big-hit hit-stop (systems/skill.ts heroHitStop). */
  stop: (_g: Game, _h: Hero, _seconds: number): void => {},
  /** Real slow motion for a solo world when the setting allows it. */
  slowMo: (_g: Game, _seconds: number): void => {},
  /** A sword slash mark across (x, z) at angle `a`, `len` m long, colour index into SLASH_COLORS (drawn on every machine). */
  slash: (_g: Game, _x: number, _z: number, _a: number, _len: number, _c: number): void => {},
};

/** Slash mark colours: white, crimson, cyan, gold. */
export const SLASH_COLORS = ['#ffffff', '#b13e53', '#73eff7', '#ffcd75'];

/**
 * Recent slash marks on the host, for the snapshot: clients draw the ones they
 * haven't seen yet (by sequence number). Marks live 0.4 s here.
 */
export class SlashLog {
  seq = 0;
  readonly list: { seq: number; x: number; z: number; a: number; len: number; c: number; at: number }[] = [];

  add(x: number, z: number, a: number, len: number, c: number, now: number): void {
    this.list.push({ seq: ++this.seq, x, z, a, len, c, at: now });
    while (this.list.length && (now - this.list[0].at > 0.4 || this.list.length > 48)) this.list.shift();
  }

  /** [seq, x*10, z*10, angle*100, len*10, colour] for marks younger than 0.3 s near a client. */
  pack(near: (x: number, z: number) => boolean, now: number): number[] {
    const out: number[] = [];
    for (const s of this.list) if (now - s.at < 0.3 && near(s.x, s.z)) out.push(s.seq, Math.round(s.x * 10), Math.round(s.z * 10), Math.round(s.a * 100), Math.round(s.len * 10), s.c);
    return out;
  }

  clear(): void {
    this.list.length = 0;
  }
}

/** Client: the marks in `a` newer than `last`; returns the newest sequence number seen. */
export function unpackSlashes(a: readonly number[], last: number, add: (x: number, z: number, angle: number, len: number, c: number) => void): number {
  let top = last;
  for (let k = 0; k + 5 < a.length; k += 6) {
    const seq = a[k];
    if (seq <= last) continue;
    top = Math.max(top, seq);
    add(a[k + 1] / 10, a[k + 2] / 10, a[k + 3] / 100, a[k + 4] / 10, a[k + 5]);
  }
  return top;
}

/**
 * Autopilot (dev bot, co-op drop-out autopilot): a Ronin circles a boss at
 * sword reach instead of the ranged heroes' 8 m, so the melee kit gets used.
 */
export function pilotHeroes3(mech: string | undefined, px: number, pz: number, mv: { mx: number; mz: number }, boss: { x: number; z: number; radius: number } | null): void {
  if (mech !== 'ronin' || !boss) return;
  const dx = px - boss.x;
  const dz = pz - boss.z;
  const d = Math.hypot(dx, dz) || 1;
  const want = (boss.radius + 2 - d) * 0.6;
  mv.mx = mv.mx * 0.25 + (-dz / d) * 0.8 + (dx / d) * want;
  mv.mz = mv.mz * 0.25 + (dx / d) * 0.8 + (dz / d) * want;
}
