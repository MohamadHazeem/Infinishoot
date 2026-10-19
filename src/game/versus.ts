import type { Rng } from '../core/rng';

/**
 * Versus Swarm (MP lane): one player is the Overlord and runs the enemy side
 * from a top-down command view; everyone else survives as heroes. The normal
 * director's spawns are replaced by the Overlord's commands: points accrue over
 * time and buy cards (enemy groups, elites, hazards and finally the boss), each
 * with its own cooldown. Groups drop at a marked beacon (click near one) or at
 * the field edge in the clicked direction; hazards land where you click, with a
 * telegraph. Everything here is pure so the host's validation and the AI
 * Overlord are unit-tested (tests/mp.test.ts); the Game side is
 * src/game/systems/versus.ts.
 */
export const versusTuning = {
  pointsStart: 30,
  pointsPerSec: 3.2, // at 0:00... (smoke bot: ~1.6 left to the AI's spending gave 178 kills a stage, the director ~2,800)
  pointsRamp: 1, // ...rising to x(1 + ramp) by the end of the stage
  pointsMax: 200,
  /** Rate limit: seconds between commands, and at most `burstMax` in any `burstWindow` seconds. */
  minGap: 0.4,
  burstMax: 6,
  burstWindow: 5,
  /** Click within this of a beacon to drop there; a beacon with a hero this close is closed. */
  markerRadius: 6,
  markerBlock: 10,
  /** Edge drops sit this far inside the field and never closer than `edgeHeroDist` to a hero. */
  edgeInset: 5,
  edgeHeroDist: 10,
  /** Groups stop when this many enemies are alive (keeps the host fast). */
  maxAlive: 280,
  /** Hazards: meteor strikes and bullet novas. */
  meteorCount: 5,
  meteorSpread: 3.5,
  meteorRadius: 2.2,
  meteorDamage: 18, // x the stage's enemy damage scaling
  novaBullets: 18,
  novaDelay: 1,
  novaDamage: 10,
  /** AI Overlord: seconds between decisions, chance to save up for the priciest card. */
  aiThink: 1.1,
  aiSave: 0.35,
  /** Command view camera zoom (wheel zoom range is 1..2.2). */
  camZoom: 2.2,
  camPan: 22, // m/s
  /** Seconds the result banner stays before everyone goes back to the title. */
  endHold: 5,
};

export type CardKind = 'group' | 'elite' | 'hazard' | 'boss';

export interface OverlordCard {
  id: string;
  name: string;
  kind: CardKind;
  cost: number;
  /** Seconds before the card can be played again. */
  cd: number;
  /** Stage seconds before it unlocks. */
  unlockAt: number;
  /** Enemy id and how many (groups), or the elite's enemy pool. */
  enemy?: string;
  count?: number;
  pool?: string[];
  hazard?: 'meteor' | 'nova';
  color: string;
  desc: string;
}

export const OVERLORD_CARDS: OverlordCard[] = [
  { id: 'swarm', name: 'Swarm Pack', kind: 'group', cost: 6, cd: 1.5, unlockAt: 0, enemy: 'swarmer', count: 10, color: '#a7f070', desc: '10 Swarmers' },
  { id: 'boppers', name: 'Bopper Gang', kind: 'group', cost: 10, cd: 2.5, unlockAt: 0, enemy: 'bopper', count: 6, color: '#ef7d57', desc: '6 Boppers that lunge' },
  { id: 'zippies', name: 'Zippy Rush', kind: 'group', cost: 12, cd: 4, unlockAt: 20, enemy: 'zippy', count: 6, color: '#73eff7', desc: '6 fast Zippies' },
  { id: 'blasters', name: 'Blaster Squad', kind: 'group', cost: 16, cd: 6, unlockAt: 40, enemy: 'shooter', count: 3, color: '#41a6f6', desc: '3 Blaster Bots that shoot' },
  { id: 'rhinos', name: 'Rhino Stampede', kind: 'group', cost: 20, cd: 8, unlockAt: 60, enemy: 'charger', count: 3, color: '#b13e53', desc: '3 Rhinos that charge' },
  { id: 'chonks', name: 'Chonk Wall', kind: 'group', cost: 22, cd: 8, unlockAt: 75, enemy: 'chonk', count: 2, color: '#5d275d', desc: '2 big Chonks' },
  { id: 'meteor', name: 'Meteor Strike', kind: 'hazard', cost: 18, cd: 10, unlockAt: 30, hazard: 'meteor', color: '#ffcd75', desc: '5 telegraphed meteors where you click' },
  { id: 'nova', name: 'Bullet Nova', kind: 'hazard', cost: 14, cd: 7, unlockAt: 50, hazard: 'nova', color: '#ff3df0', desc: 'A ring of bullets bursts where you click' },
  { id: 'elite', name: 'Elite', kind: 'elite', cost: 40, cd: 20, unlockAt: 45, pool: ['bopper', 'charger', 'chonk', 'shooter', 'zippy'], color: '#ffcd75', desc: 'One elite with a modifier and escorts' },
  { id: 'boss', name: 'Unleash the Boss', kind: 'boss', cost: 100, cd: 0, unlockAt: 150, color: '#b13e53', desc: 'The stage boss, once. At 4:00 it comes anyway.' },
];

export const CARD_BY_ID: Record<string, OverlordCard> = Object.fromEntries(OVERLORD_CARDS.map((c) => [c.id, c]));

export interface VsPoint {
  x: number;
  z: number;
}

/** What validation and the AI need to know about the field right now. */
export interface VersusWorld {
  /** Stage seconds elapsed and the stage length. */
  time: number;
  duration: number;
  /** Arena half size (the field is -half..half on both axes). */
  half: number;
  /** Living heroes. */
  heroes: VsPoint[];
  markers: VsPoint[];
  /** Enemies alive. */
  alive: number;
  /** The boss is out already (sent, or the timer ran out). */
  bossOut: boolean;
  /** Can an enemy stand here (no wall)? */
  walkable(x: number, z: number): boolean;
}

export interface OverlordCmd {
  /** Card id and the clicked ground point. */
  c: string;
  x: number;
  z: number;
}

export type CmdResult = { ok: true; card: OverlordCard; spot: VsPoint; marker: number } | { ok: false; reason: string };

/** The Overlord's purse, cooldowns and rate limit (host side; clients mirror it from snapshots). */
export class OverlordState {
  points = versusTuning.pointsStart;
  cd: Record<string, number> = {};
  bossUsed = false;
  /** Command times (stage seconds) inside the burst window. */
  recent: number[] = [];
  /** AI Overlord: the card it is saving up for ('' = pick a new one). */
  aiGoal = '';

  /** Points per second at stage time t. */
  static rate(time: number, duration: number): number {
    const t = versusTuning;
    return t.pointsPerSec * (1 + t.pointsRamp * Math.min(1, Math.max(0, time / duration)));
  }

  tick(dt: number, time: number, duration: number): void {
    this.points = Math.min(versusTuning.pointsMax, this.points + OverlordState.rate(time, duration) * dt);
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
  }

  cooldown(id: string): number {
    return this.cd[id] ?? 0;
  }

  /** Charge a validated command. */
  spend(card: OverlordCard, now: number): void {
    this.points -= card.cost;
    this.cd[card.id] = card.cd;
    if (card.kind === 'boss') this.bossUsed = true;
    this.recent.push(now);
  }
}

const dist = (a: VsPoint, b: VsPoint) => Math.hypot(a.x - b.x, a.z - b.z);

/** Six beacons on a ring halfway out, nudged off walls (the same on every machine for a given arena). */
export function markersFor(half: number, walkable: (x: number, z: number) => boolean): VsPoint[] {
  const out: VsPoint[] = [];
  for (let k = 0; k < 6; k++) {
    const a = ((k + 0.5) / 6) * Math.PI * 2;
    for (let i = 0; i < 12; i++) {
      const r = half * 0.5 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 1.5;
      const p = { x: Math.round(Math.cos(a) * r * 10) / 10, z: Math.round(Math.sin(a) * r * 10) / 10 };
      if (walkable(p.x, p.z)) {
        out.push(p);
        break;
      }
    }
  }
  return out;
}

/** The field-edge point in the direction of (x, z) from the middle, slid along the edge off walls and away from heroes. */
export function edgePoint(w: VersusWorld, x: number, z: number): VsPoint | null {
  const t = versusTuning;
  const base = Math.abs(x) + Math.abs(z) < 0.01 ? 0 : Math.atan2(z, x);
  const r = w.half - t.edgeInset;
  for (let i = 0; i < 13; i++) {
    const a = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.09;
    // Square field: push the ring point out to the square's edge.
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    const k = r / Math.max(Math.abs(cx), Math.abs(cz));
    const p = { x: cx * k, z: cz * k };
    if (!w.walkable(p.x, p.z)) continue;
    if (w.heroes.some((h) => dist(h, p) < t.edgeHeroDist)) continue;
    return p;
  }
  return null;
}

/** Nearest beacon to a point, if within markerRadius (-1 = none). */
export function markerAt(w: VersusWorld, x: number, z: number): number {
  let best = -1;
  let bd = versusTuning.markerRadius;
  w.markers.forEach((m, i) => {
    const d = Math.hypot(m.x - x, m.z - z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

export function markerOpen(w: VersusWorld, i: number): boolean {
  const m = w.markers[i];
  return !!m && !w.heroes.some((h) => dist(h, m) < versusTuning.markerBlock);
}

/** Card state without placement: why it can't be played now (or '' if it can). */
export function cardBlock(st: OverlordState, card: OverlordCard, w: VersusWorld): string {
  if (w.time < card.unlockAt) return 'locked';
  if (card.kind === 'boss' && (st.bossUsed || w.bossOut)) return 'boss already out';
  if (st.cooldown(card.id) > 0) return 'cooldown';
  if (st.points < card.cost) return 'not enough points';
  if ((card.kind === 'group' || card.kind === 'elite') && w.alive >= versusTuning.maxAlive) return 'field is full';
  return '';
}

/** Host-side check of one Overlord command (also used by the Overlord's own screen for the cursor preview). */
export function validateCommand(st: OverlordState, cmd: Partial<OverlordCmd>, w: VersusWorld, now: number, rateLimit = true): CmdResult {
  const t = versusTuning;
  const card = CARD_BY_ID[String(cmd?.c ?? '')];
  if (!card) return { ok: false, reason: 'unknown card' };
  const x = Number(cmd.x);
  const z = Number(cmd.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: 'bad spot' };
  if (rateLimit) {
    st.recent = st.recent.filter((r) => now - r < t.burstWindow && r <= now);
    const last = st.recent[st.recent.length - 1];
    if ((last !== undefined && now - last < t.minGap) || st.recent.length >= t.burstMax) return { ok: false, reason: 'too fast' };
  }
  const block = cardBlock(st, card, w);
  if (block) return { ok: false, reason: block };
  const lim = w.half - 1;
  if (card.kind === 'hazard') return { ok: true, card, spot: { x: Math.max(-lim, Math.min(lim, x)), z: Math.max(-lim, Math.min(lim, z)) }, marker: -1 };
  const m = markerAt(w, x, z);
  if (m >= 0) return markerOpen(w, m) ? { ok: true, card, spot: { ...w.markers[m] }, marker: m } : { ok: false, reason: 'beacon blocked by a hero' };
  const e = edgePoint(w, x, z);
  return e ? { ok: true, card, spot: e, marker: -1 } : { ok: false, reason: 'no room at that edge' };
}

/**
 * The AI Overlord's next command, or null to wait. It saves up for its
 * priciest card now and then, sends the boss as soon as it can, drops groups
 * at the open beacon nearest the heroes (or the edge toward them) and aims
 * hazards a little ahead of a hero.
 */
export function aiOverlordPick(st: OverlordState, w: VersusWorld, rng: Rng, heroVel: VsPoint[] = []): OverlordCmd | null {
  if (!w.heroes.length) return null;
  const usable = OVERLORD_CARDS.filter((c) => !cardBlock(st, c, w));
  const boss = usable.find((c) => c.kind === 'boss');
  const cx = w.heroes.reduce((a, h) => a + h.x, 0) / w.heroes.length;
  const cz = w.heroes.reduce((a, h) => a + h.z, 0) / w.heroes.length;
  const place = (card: OverlordCard): OverlordCmd => {
    if (card.kind === 'hazard') {
      const i = Math.floor(rng.next() * w.heroes.length);
      const v = heroVel[i] ?? { x: 0, z: 0 };
      return { c: card.id, x: w.heroes[i].x + v.x * 0.8, z: w.heroes[i].z + v.z * 0.8 };
    }
    let best = -1;
    let bd = Infinity;
    w.markers.forEach((m, i) => {
      const d = Math.hypot(m.x - cx, m.z - cz);
      if (markerOpen(w, i) && d < bd && d < 32) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0 && rng.chance(0.6)) return { c: card.id, x: w.markers[best].x, z: w.markers[best].z };
    const a = Math.hypot(cx, cz) < 3 ? rng.range(0, Math.PI * 2) : Math.atan2(cz, cx) + rng.range(-0.6, 0.6);
    return { c: card.id, x: Math.cos(a) * w.half, z: Math.sin(a) * w.half };
  };
  if (boss) return place(boss);
  // Once the boss card unlocks, everything goes into it.
  const bossCard = OVERLORD_CARDS.find((c) => c.kind === 'boss');
  if (bossCard && w.time >= bossCard.unlockAt && !st.bossUsed && !w.bossOut) return null;
  // Otherwise it saves for a goal card (any unlocked one, so pricey cards get played too)...
  const unlocked = OVERLORD_CARDS.filter((c) => c.kind !== 'boss' && w.time >= c.unlockAt);
  if (!unlocked.length) return null;
  if (!unlocked.some((c) => c.id === st.aiGoal)) st.aiGoal = unlocked[Math.floor(rng.next() * unlocked.length)].id;
  const goal = CARD_BY_ID[st.aiGoal];
  if (!cardBlock(st, goal, w)) {
    st.aiGoal = '';
    return place(goal);
  }
  // ...and meanwhile spends what it can spare: freely while the goal cools down, a cheap card now and then while saving.
  const saving = cardBlock(st, goal, w) === 'not enough points';
  if (rng.chance(saving ? 1 - versusTuning.aiSave * 0.4 : versusTuning.aiSave)) return null;
  const spare = usable.filter((c) => !saving || (c.cost <= 10 && st.points - c.cost >= goal.cost * 0.5));
  return spare.length ? place(spare[Math.floor(rng.next() * spare.length)]) : null;
}

/** Snapshot field for clients: [overlord index, points, boss used, winner code, cooldown tenths per card]. */
export function packOverlord(st: OverlordState, overlord: number, winner: '' | 'heroes' | 'overlord'): number[] {
  return [overlord, Math.floor(st.points), st.bossUsed ? 1 : 0, winner === 'heroes' ? 1 : winner === 'overlord' ? 2 : 0, ...OVERLORD_CARDS.map((c) => Math.ceil(st.cooldown(c.id) * 10))];
}

export function unpackOverlord(raw: unknown, st: OverlordState): { overlord: number; winner: '' | 'heroes' | 'overlord' } | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const a = raw.map(Number);
  st.points = a[1];
  st.bossUsed = a[2] === 1;
  OVERLORD_CARDS.forEach((c, i) => (st.cd[c.id] = (a[4 + i] ?? 0) / 10));
  return { overlord: a[0], winner: a[3] === 1 ? 'heroes' : a[3] === 2 ? 'overlord' : '' };
}
