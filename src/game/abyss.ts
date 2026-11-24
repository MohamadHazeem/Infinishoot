import type { Game } from './game';
import type { Enemy } from './enemies';
import { PickupType } from './pickups';
import { ABYSS_MUTATIONS as cards, mutationDeck } from '../data/abyssMutations';
import { ENEMIES } from '../data/enemies';
import { isoWeek } from '../data/weekly';
import { gauntletProfile } from '../data/ascension';
import { loadJson, saveJson } from '../core/storage';
import { save, saveLock } from './save';
import { onlineServer } from '../net/onlineServer';
import { localize, t } from '../i18n';
import { assistedRun, hasCasualOptions } from './systems/assists';

export const FLOOR_SECONDS = 45;
export const abyssUnlocked = () => gauntletProfile.victory || save.achievements.includes('victory');
const STORE = 'abyss.records.v1';
// Spawn and kill hooks visit at most the cards for that family, including pooled respawns.
const byEnemy: Record<string, number[]> = Object.create(null);
cards.forEach((card, i) => (byEnemy[card.enemy] ??= []).push(i));
const PILOT = 'abyss.pilot.v1';
const validPilot = (v: unknown): v is string => typeof v === 'string' && /^[A-F0-9]{6}$/.test(v);
const positive = (n: unknown) =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : 0;
export function abyssRecords(raw = loadJson<unknown>(STORE, null), week = isoWeek()) {
  const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const weekly = p.week === week ? positive(p.weekly) : 0;
  return { best: Math.max(weekly, positive(p.best)), weekly, week };
}

const byGame = new WeakMap<Game, Descent>();
export function endAbyss(g: Game) {
  byGame.get(g)?.detach();
  byGame.delete(g);
}
export function beginAbyss(g: Game, practice = () => false, week = isoWeek()) {
  endAbyss(g);
  if (g.runMode === 'abyss' && g.role === 'solo') byGame.set(g, new Descent(g, practice, week));
}
export function abyss(g: Game) {
  return byGame.get(g);
}

async function post(
  body: object,
): Promise<{ ticket?: string; pilot?: string; floor?: number } | null> {
  try {
    const r = await fetch(onlineServer + '/abyss', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export function mutationText(id: number) {
  const m = cards[id];
  const enemy = localize(ENEMIES[m.enemy].name);
  switch (m.kind) {
    case 'patrol':
      return t('abyss.patrol', { enemy, escort: localize(ENEMIES[m.escort].name) });
    case 'bounty':
      return t('abyss.bounty', { enemy, drop: t('abyss.drop.' + m.drop) });
    default:
      return t('abyss.' + m.kind, { enemy });
  }
}

/** Only the authority owns a descent. The weekly roster and counters are rebuilt at floor boundaries. */
class Descent {
  readonly stacks = new Uint16Array(cards.length);
  private readonly kills = new Uint32Array(cards.length);
  private deck: number[] = [];
  floor = 0;
  current = 0;
  elapsed = 0;
  private patrols: number[] = [];
  private nextPatrol = 0;
  private ticket?: ReturnType<typeof post>;
  private practice: boolean;
  readonly detach: () => void;
  constructor(
    g: Game,
    private readonly practiceNow: () => boolean,
    readonly week: string,
  ) {
    const pool = g.enemies,
      spawn = pool.spawn;
    pool.spawn = (def, x, z, opts) => {
      const e = spawn.call(pool, def, x, z, opts);
      this.spawn(e);
      return e;
    };
    this.detach = () => {
      pool.spawn = spawn;
    };
    this.practice =
      this.practiceNow() ||
      saveLock.on ||
      hasCasualOptions() ||
      g.squadRun ||
      (typeof location !== 'undefined' && new URLSearchParams(location.search).has('test'));
  }

  enter(g: Game) {
    const floor = g.stage;
    if (this.floor === floor) return;
    const cycle = Math.floor((floor - 1) / cards.length);
    this.deck = mutationDeck(g.seed, cycle);
    this.stacks.fill(cycle);
    for (let i = 0; i <= (floor - 1) % cards.length; i++) this.stacks[this.deck[i]]++;
    this.current = this.deck[(floor - 1) % cards.length];
    this.floor = floor;
    this.elapsed = 0;
    this.nextPatrol = 0;
    this.patrols = this.deck.filter((i) => this.stacks[i] && cards[i].kind === 'patrol');
    if (this.practice || this.practiceNow() || assistedRun(g) || saveLock.on) return;
    const p = abyssRecords();
    p.best = Math.max(p.best, floor);
    if (p.week === this.week) p.weekly = Math.max(p.weekly, floor);
    saveJson(STORE, p);
    if (this.ticket && floor > 1 && p.week === this.week)
      void this.ticket.then(async (session) => {
        if (!session?.ticket || !validPilot(session.pilot)) return;
        const claim = await post({ ticket: session.ticket, floor });
        if (claim?.floor === floor && abyssRecords().weekly === floor && isoWeek() === this.week)
          saveJson(PILOT, { week: this.week, floor, pilot: session.pilot });
      });
  }

  tick(g: Game, dt: number) {
    if (!this.practice && (this.practiceNow() || assistedRun(g) || saveLock.on))
      this.practice = true;
    if (this.floor === 1 && !this.practice && onlineServer && !this.ticket)
      this.ticket = post({ start: this.week });
    this.elapsed += dt;
    if (this.elapsed >= FLOOR_SECONDS) {
      g.loadStage(this.floor + 1);
      return;
    }
    // Space formations across the floor and leave at least five seconds before the exit.
    const id = this.patrols[this.nextPatrol];
    if (id === undefined || this.elapsed < ((this.nextPatrol + 1) * 40) / (this.patrols.length + 1))
      return;
    this.nextPatrol++;
    const m = cards[id];
    if (m.kind !== 'patrol') return;
    for (let i = 0; i < Math.min(3, this.stacks[id]); i++) {
      g.spawnEnemy(ENEMIES[m.enemy]);
      g.spawnEnemy(ENEMIES[m.escort]);
    }
  }

  private spawn(e: Enemy) {
    const ids = byEnemy[e.def.id];
    if (!ids) return;
    for (const i of ids) {
      const m = cards[i],
        count = this.stacks[i];
      if (!count) continue;
      if (m.kind === 'shell') e.shield += Math.ceil(e.maxHp * 0.25 * count);
      if (m.kind === 'haste') e.speedMul *= 1 + Math.min(0.5, 0.1 * count);
    }
  }

  kill(g: Game, e: Enemy) {
    const ids = byEnemy[e.def.id];
    if (!ids) return;
    for (const i of ids) {
      const m = cards[i],
        count = this.stacks[i];
      if (!count) continue;
      if (m.kind === 'mine') warnedScrap(g, e, Math.min(3.5, 1.7 + count * 0.3));
      if (m.kind === 'bounty' && ++this.kills[i] % Math.max(2, 9 - count) === 0)
        g.pickups.spawn(PickupType[m.drop], e.x, e.z, 1);
    }
  }
}
export function warnedScrap(g: Game, e: Enemy, r: number) {
  if (g.strikes.length >= 12) return;
  g.vfx.zone(e.x, e.z, r, 1.25);
  g.vfx.sound('fuseTick', e.x, e.z);
  g.strikes.push({ x: e.x, z: e.z, r, t: 1.25, dmg: 12, cause: 'Hot Scrap' });
}

export function abyssExtras(g: Game) {
  const d = g.runMode === 'abyss' && abyss(g);
  return d
    ? cards.flatMap((m, i) =>
        d.stacks[i]
          ? [
              {
                id: 'abyss',
                name: localize(m.name) + ' ×' + d.stacks[i],
                desc: mutationText(i),
                icon: '◆',
                color: '#41a6f6',
              },
            ]
          : [],
      )
    : [];
}

export async function abyssBoard(): Promise<string> {
  const p = abyssRecords();
  let local = t('abyss.records', { week: p.week, floor: p.weekly, best: p.best });
  if (!onlineServer) return local;
  const own = loadJson<{ week?: string; floor?: number; pilot?: string } | null>(PILOT, null);
  if (own?.week === p.week && own.floor === p.weekly && validPilot(own.pilot))
    local += '\n' + t('abyss.yourPilot', { pilot: own.pilot });
  try {
    const r = await fetch(onlineServer + '/abyss', {
      credentials: 'omit',
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw Error();
    const body = await r.json();
    if (body.week !== p.week || !Array.isArray(body.rows)) throw Error();
    const lines = body.rows
      .filter(
        (v: { floor: number; pilot: string }) => v && positive(v.floor) && validPilot(v.pilot),
      )
      .map((v: { floor: number; pilot: string }) =>
        t('abyss.first', { floor: v.floor, pilot: v.pilot }),
      );
    return [local, t('abyss.world'), ...(lines.length ? lines : [t('abyss.empty')])].join('\n');
  } catch {
    return local + '\n' + t('abyss.offline');
  }
}
