/** Deterministic, allocation-free encounter simulation. Only the host advances this state. */
export const raidTuning = {
  weaponDamage: 0.16,
  headHp: 4400,
  secondHp: 0.7,
  stumpSeconds: 10,
  enrage: 780,
  wipe: 900,
  fireEvery: 9,
  fireWarn: 2.4,
  fireDuration: 2.1,
  fireRange: 24,
  fireCos: 0.91,
  volleyEvery: 8,
  orbSpeed: 5,
  parryDamage: 260,
  ghostDps: 24,
  cellRecharge: 5,
  cells: 12,
  coreHp: 6000,
  cannonDamage: 500,
  ghostSpeed: 7,
};
export const HEAD_X = [-8, 0, 8] as const;
export const HEAD_Z = -5;
export const PLATE = { x: 0, z: 6 };
export const BRAZIER = { x: 0, z: 0 };
export const CELLS = [
  { x: -13, z: 12 },
  { x: 13, z: 12 },
];
export const CANNONS = [
  { x: -12, z: -1 },
  { x: 12, z: -1 },
];
export type RaidPhase = 'heads' | 'core' | 'overdrive' | 'won' | 'lost';
export interface RaidHead {
  hp: number;
  max: number;
  stump: number;
  sealed: boolean;
  copies: number;
}
export interface RaidOrb {
  live: boolean;
  reflected: boolean;
  x: number;
  z: number;
  target: number;
  life: number;
}
export interface RaidActor {
  id: number;
  x: number;
  z: number;
  alive: boolean;
  parry: boolean;
  hit: number;
  torch: number;
  cell: boolean;
  ghost: boolean;
}
export interface RaidState {
  phase: RaidPhase;
  time: number;
  phaseTime: number;
  players: number;
  scale: number;
  difficulty: number;
  racks: number[];
  heads: RaidHead[];
  core: number;
  delivered: number;
  plate: boolean;
  fireClock: number;
  fireX: number;
  fireZ: number;
  fireMode: number;
  volley: number;
  orbs: RaidOrb[];
  actors: RaidActor[];
  regrows: number;
  parries: number;
  event: number;
  eventKind: string;
}
export function raidScale(players: number): number {
  return 1 + (Math.max(1, Math.min(8, players)) - 1) * 0.7;
}
export function createRaid(players = 1, difficulty = 1): RaidState {
  // Helpers fill a minimum four-role crew; additional humans scale health, not attack density.
  const crew = Math.max(4, Math.min(8, players));
  const scale = raidScale(crew);
  return {
    phase: 'heads',
    time: 0,
    phaseTime: 0,
    players,
    scale,
    difficulty,
    heads: HEAD_X.map(() => ({
      hp: raidTuning.headHp * scale * difficulty,
      max: raidTuning.headHp * scale * difficulty,
      stump: 0,
      sealed: false,
      copies: 1,
    })),
    racks: [0, 0],
    core: raidTuning.coreHp * scale,
    delivered: 0,
    plate: false,
    fireClock: 0,
    fireX: 0,
    fireZ: 1,
    fireMode: 0,
    volley: 3,
    orbs: Array.from({ length: 24 }, () => ({
      live: false,
      reflected: false,
      x: 0,
      z: 0,
      target: 0,
      life: 0,
    })),
    actors: Array.from({ length: 8 }, (_, id) => ({
      id,
      x: (id - 1.5) * 3,
      z: 9,
      alive: id < crew,
      parry: false,
      hit: 0,
      torch: 0,
      cell: false,
      ghost: id >= players && id < 4,
    })),
    regrows: 0,
    parries: 0,
    event: 0,
    eventKind: 'intro',
  };
}
function event(s: RaidState, kind: string): void {
  s.event++;
  s.eventKind = kind;
}
export function raidHeadDamage(
  s: RaidState,
  index: number,
  damage: number,
  fire = false,
  reflected = false,
): number {
  if (s.phase !== 'heads' && s.phase !== 'overdrive') return 0;
  const h = s.heads[index];
  if (!h || h.sealed || !Number.isFinite(damage) || damage <= 0) return 0;
  if (h.stump > 0) {
    if (fire) {
      h.stump = 0;
      h.sealed = true;
      event(s, 'seal');
    }
    return 0;
  }
  if (index !== 1 && !s.plate && !s.heads[1].sealed) return 0;
  // The interceptor's plating only opens to its own reflected missiles.
  if (index === 2 && !reflected) return 0;
  const dealt = Math.min(h.hp, damage);
  h.hp -= dealt;
  if (h.hp <= 0) {
    h.stump = raidTuning.stumpSeconds;
    event(s, 'cut');
  }
  return dealt;
}
export function inFire(s: RaidState, x: number, z: number): boolean {
  const dx = x - HEAD_X[0],
    dz = z - HEAD_Z,
    d = Math.hypot(dx, dz);
  return (
    d < raidTuning.fireRange && d > 0 && (dx * s.fireX + dz * s.fireZ) / d > raidTuning.fireCos
  );
}
function near(a: { x: number; z: number }, b: { x: number; z: number }, r = 1.8): boolean {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < r * r;
}
const HEAD_POINTS = HEAD_X.map((x) => ({ x, z: HEAD_Z }));
const FIRING_POINTS = HEAD_X.map((x) => ({ x, z: 3 }));
const CORE_SAFE_RIGHT = { x: 20, z: 12 },
  CORE_SAFE_LEFT = { x: -20, z: 12 };
const BAIT = { x: -15, z: 3 },
  PARRY_POINT = { x: 8, z: 4 },
  DODGE = { x: -21, z: -7 };
export interface RaidIntent {
  x: number;
  z: number;
  head: number;
  parry: boolean;
}
/** Role-aware movement shared by real autopilot and help ghosts. Writes into a caller-owned object. */
export function raidPilot(s: RaidState, a: RaidActor, out: RaidIntent): void {
  out.parry = false;
  out.head = -1;
  const side = a.id % 2;
  let target = PLATE;
  if (s.phase === 'core') target = a.cell ? CANNONS[side] : CELLS[side];
  else {
    let stump = -1;
    for (let i = 0; i < 3; i++)
      if (s.heads[i].stump > 0) {
        stump = i;
        break;
      }
    if (stump >= 0 && a.id % 4 === 3) {
      target = a.torch > 0 ? HEAD_POINTS[stump] : BRAZIER;
    } else if (a.id % 4 === 0 && !s.heads[0].sealed) {
      target = BAIT;
      out.head = 0;
    } else if (a.id % 4 === 1 && !s.heads[1].sealed) {
      target = PLATE;
      out.head = 1;
    } else if (!s.heads[2].sealed) {
      target = PARRY_POINT;
      out.head = 2;
    } else {
      for (let i = 0; i < 3; i++)
        if (!s.heads[i].sealed && s.heads[i].stump <= 0) {
          out.head = i;
          break;
        }
      target = FIRING_POINTS[Math.max(0, out.head)];
    }
    for (const o of s.orbs) if (o.live && !o.reflected && near(a, o, 3.5)) out.parry = true;
    // Bait direction locks for the entire warning; leave the cone during its cast.
    if (s.fireMode > 0 && a.id % 4 === 0) target = DODGE;
  }
  if (s.phase === 'core' && s.fireMode > 0) target = s.fireX < 0 ? CORE_SAFE_RIGHT : CORE_SAFE_LEFT;
  out.x = target.x;
  out.z = target.z;
}
export function stepRaid(s: RaidState, dt: number): void {
  if (s.phase === 'won' || s.phase === 'lost' || dt <= 0) return;
  s.time += dt;
  s.phaseTime += dt;
  if (s.time >= raidTuning.enrage && s.time - dt < raidTuning.enrage) event(s, 'enrage');
  let humanAlive = false;
  for (const a of s.actors)
    if (a.alive && !a.ghost) {
      humanAlive = true;
      break;
    }
  if (s.time >= raidTuning.wipe || !humanAlive) {
    s.phase = 'lost';
    event(s, 'lost');
    return;
  }
  s.plate = false;
  for (let i = 0; i < 2; i++) s.racks[i] = Math.max(0, s.racks[i] - dt);
  for (const a of s.actors) {
    a.hit = 0;
    if (!a.alive) {
      a.cell = false;
      continue;
    }
    if (near(a, PLATE, 2.4)) s.plate = true;
    a.torch = Math.max(0, a.torch - dt);
    if (near(a, BRAZIER)) a.torch = 14;
    for (let i = 0; i < 3; i++) {
      const h = s.heads[i];
      if (h.stump > 0 && a.torch > 0 && Math.hypot(a.x - HEAD_X[i], a.z - HEAD_Z) < 2.8)
        raidHeadDamage(s, i, 1, true);
    }
    if (s.phase === 'core' && s.core > 0) {
      if (!a.cell) {
        for (let i = 0; i < 2; i++)
          if (s.racks[i] <= 0 && near(a, CELLS[i])) {
            a.cell = true;
            s.racks[i] = raidTuning.cellRecharge;
            break;
          }
      } else if (a.cell && (near(a, CANNONS[0]) || near(a, CANNONS[1]))) {
        a.cell = false;
        s.delivered++;
        s.core =
          s.delivered >= raidTuning.cells
            ? 0
            : Math.max(0, s.core - raidTuning.cannonDamage * s.scale);
        event(s, 'cannon');
      }
    }
  }
  for (const h of s.heads)
    if (h.stump > 0) {
      h.stump -= dt;
      if (h.stump <= 0) {
        h.stump = 0;
        h.copies = Math.min(4, h.copies * 2);
        h.hp = h.max * 0.45;
        s.regrows++;
        event(s, 'regrow');
      }
    }
  if (
    (s.phase === 'heads' || s.phase === 'overdrive') &&
    s.heads[0].sealed &&
    s.heads[1].sealed &&
    s.heads[2].sealed
  ) {
    s.phase = s.phase === 'heads' ? 'core' : 'won';
    s.phaseTime = 0;
    event(s, s.phase);
    for (const o of s.orbs) o.live = false;
    s.fireClock = s.fireMode = 0;
    return;
  }
  if (s.phase === 'core' && s.core <= 0) {
    s.phase = 'overdrive';
    s.phaseTime = 0;
    for (const h of s.heads) {
      h.hp = h.max * raidTuning.secondHp;
      h.stump = 0;
      h.sealed = false;
      h.copies = 1;
    }
    for (const a of s.actors) a.cell = false;
    event(s, 'overdrive');
  }
  const angry = s.phase === 'overdrive' || s.time >= raidTuning.enrage;
  const rate = s.time >= raidTuning.enrage ? 1.8 : angry ? 1.3 : 1;
  s.fireClock += dt * rate;
  s.fireMode = 0;
  if ((!s.heads[0].sealed && s.heads[0].stump <= 0) || s.phase === 'core') {
    const start = raidTuning.fireEvery - raidTuning.fireWarn - raidTuning.fireDuration;
    if (s.fireClock >= start && s.fireClock - dt * rate < start) {
      let bait: RaidActor | undefined,
        best = Infinity;
      for (const a of s.actors)
        if (a.alive) {
          const d = Math.hypot(a.x + 8, a.z - HEAD_Z);
          if (d < best) {
            best = d;
            bait = a;
          }
        }
      if (bait) {
        const d = Math.hypot(bait.x + 8, bait.z - HEAD_Z) || 1;
        s.fireX = (bait.x + 8) / d;
        s.fireZ = (bait.z - HEAD_Z) / d;
      }
      event(s, 'fire');
    }
    if (s.fireClock >= start)
      s.fireMode = s.fireClock < raidTuning.fireEvery - raidTuning.fireDuration ? 1 : 2;
    if (s.fireMode === 2)
      for (const a of s.actors)
        if (a.alive && inFire(s, a.x, a.z))
          a.hit += dt * (s.time >= raidTuning.enrage ? 48 : angry ? 30 : 18);
  }
  if (s.fireMode === 2)
    for (let i = 0; i < 3; i++)
      if (s.heads[i].stump > 0 && inFire(s, HEAD_X[i], HEAD_Z)) raidHeadDamage(s, i, 1, true);
  if (s.fireClock >= raidTuning.fireEvery) s.fireClock = 0;
  s.volley -= dt * rate;
  if (s.volley <= 0 && ((!s.heads[2].sealed && s.heads[2].stump <= 0) || s.phase === 'core')) {
    s.volley = raidTuning.volleyEvery;
    for (const a of s.actors)
      if (a.alive && a.id % 4 >= 2) {
        const o = s.orbs.find((o) => !o.live);
        if (!o) break;
        o.live = true;
        o.reflected = false;
        o.x = 8;
        o.z = HEAD_Z;
        o.target = a.id;
        o.life = 10;
      }
    event(s, 'volley');
  }
  for (const o of s.orbs)
    if (o.live) {
      const a = s.actors[o.target];
      o.life -= dt;
      if ((!a?.alive && !o.reflected) || o.life <= 0) {
        o.live = false;
        continue;
      }
      const dx = (o.reflected ? 8 : a.x) - o.x,
        dz = (o.reflected ? HEAD_Z : a.z) - o.z,
        d = Math.hypot(dx, dz) || 1;
      if (o.reflected) {
        if (d < 0.8) {
          o.live = false;
          raidHeadDamage(s, 2, raidTuning.parryDamage * s.scale, false, true);
        } else {
          o.x += (dx / d) * raidTuning.orbSpeed * 2 * dt;
          o.z += (dz / d) * raidTuning.orbSpeed * 2 * dt;
        }
      } else if (a.parry && d < 3.5) {
        o.reflected = true;
        o.life = 6;
        s.parries++;
        event(s, 'parry');
      } else if (d < 0.8) {
        o.live = false;
        a.hit += 18;
      } else {
        o.x += (dx / d) * raidTuning.orbSpeed * dt;
        o.z += (dz / d) * raidTuning.orbSpeed * dt;
      }
    }
}
