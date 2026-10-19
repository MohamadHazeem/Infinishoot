/** Host-owned run awards. Event hooks do no work on clients; only the final report travels. */
import type { Game } from '../game';
import type { Hero } from '../hero';
import type { Enemy } from '../enemies';
import { heroLook, type PortraitLook } from '../../ui/portraitArt';
import { MvpScreen } from '../../ui/mvpScreen';
import { WEAPON_STEMS } from '../../audio/stems';
import { MOD_BY_ID } from '../../data/mods';
import { PASSIVES } from '../../data/passives';
import { RELIC_BY_ID } from '../../data/relics';

export const mvpTuning = { comboWindow: 2, saveRange: 3, highlights: 32, clutchHp: 0.25 };
export type MomentKind = 'boss' | 'revive' | 'legendary' | 'fusion';
export interface MvpMoment { time: number; player: number; kind: MomentKind; detail: string }
export interface MvpPlayer {
  index: number; name: string; look: PortraitLook;
  damage: number; kills: number; revives: number; saves: number; taken: number; bestCombo: number; shared: number;
  gold: number; dashes: number; clutch: number; peaceful: number; instruments: string[];
}
export interface MvpAward { id: string; player: number; value: number }
export interface MvpReport { time: number; players: MvpPlayer[]; awards: MvpAward[]; moments: MvpMoment[] }
interface Row extends MvpPlayer { combo: number; lastKill: number; seen: Set<string>; previousDamage: number; previousDashes: number; damageRef: Record<string, number> }
export interface MvpState { rows: Map<Hero, Row>; moments: MvpMoment[]; report: MvpReport | null }
export const createMvp = (): MvpState => ({ rows: new Map(), moments: [], report: null });

export function personalKill(row: { kills: number; combo: number; bestCombo: number; lastKill: number; peaceful: number }, time: number): void {
  row.peaceful = Math.max(row.peaceful, time - Math.max(0, row.lastKill));
  row.combo = time - row.lastKill <= mvpTuning.comboWindow ? row.combo + 1 : 1;
  row.bestCombo = Math.max(row.bestCombo, row.combo);
  row.lastKill = time;
  row.kills++;
}
/** One award per category, deterministic ties favor the lower roster index. No invented rescues. */
export function awardMvp(players: readonly MvpPlayer[]): MvpAward[] {
  const rules: [string, (p: MvpPlayer) => number][] = [
    ['cannon', p => p.damage], ['hoarder', p => p.gold], ['pacifist', p => Math.floor(p.peaceful)],
    ['glass', p => p.damage / Math.max(1, p.taken)], ['bodyguard', p => p.saves],
    ['speed', p => p.dashes], ['dramatic', p => p.clutch], ['encore', p => p.bestCombo],
  ];
  return rules.flatMap(([id, score]) => {
    let best: MvpPlayer | undefined, value = 0;
    for (const p of players) {
      const n = score(p);
      if (n > value || n > 0 && n === value && p.index < best!.index) { best = p; value = n; }
    }
    return best ? [{ id, player: best.index, value: Math.floor(value) }] : [];
  });
}

function row(g: Game, h: Hero): Row {
  let r = g.mvp.rows.get(h);
  if (!r) {
    r = { index: g.mvp.rows.size, name: h.name, look: heroLook(h.heroDef.id, h.skin, h.color), damage: 0, kills: 0, revives: 0,
      saves: 0, taken: 0, bestCombo: 0, shared: 0, gold: 0, dashes: 0, clutch: 0, peaceful: 0, instruments: [],
      combo: 0, lastKill: g.runTime, seen: new Set(), previousDamage: 0, previousDashes: 0, damageRef: h.damageBy };
    g.mvp.rows.set(h, r);
  }
  return r;
}
export function addMoment(state: MvpState, moment: MvpMoment): void {
  // Keep boss finishes and clutch rescues ahead of repeated loot when a very long run fills the reel.
  if (state.moments.length >= mvpTuning.highlights) {
    const loot = state.moments.findIndex(m => m.kind === 'legendary' || m.kind === 'fusion');
    if (loot < 0 && (moment.kind === 'legendary' || moment.kind === 'fusion')) return;
    state.moments.splice(loot < 0 ? 0 : loot, 1);
  }
  state.moments.push(moment);
}
function moment(g: Game, h: Hero, kind: MomentKind, detail = ''): void {
  addMoment(g.mvp, { time: Math.floor(g.runTime), player: row(g, h).index, kind, detail });
}
export function mvpKill(this: Game, e: Enemy, by: Hero | null): void {
  if (!by || this.role === 'client' || this.pvp || this.mvp.report) return;
  const r = row(this, by);
  personalKill(r, this.runTime);
  // Downed heroes cannot take damage; this credits stopping an attack over their rescue space.
  if (e.state === 'windup' || e.state === 'attack') {
    for (const ally of this.heroes) {
      if (ally === by || ally.left || !ally.player.dead) continue;
      const range = mvpTuning.saveRange + e.radius;
      if ((e.x - ally.player.x) ** 2 + (e.z - ally.player.z) ** 2 <= range * range) { r.saves++; break; }
    }
  }
  if (e.def.boss || e.def.miniboss) moment(this, by, 'boss', e.def.name);
}
export function mvpHurt(this: Game, h: Hero, amount: number): void {
  if (this.role === 'client' || this.pvp || this.mvp.report) return;
  const r = row(this, h);
  r.taken += Math.max(0, amount);
  r.combo = 0;
}
export function mvpRevive(this: Game, rescued: Hero, helpers: readonly Hero[]): void {
  if (this.role === 'client' || this.pvp || this.mvp.report) return;
  let standing = 0;
  for (const h of this.heroes) if (!h.left && !h.player.dead && h !== rescued) standing++;
  for (const h of helpers) {
    const r = row(this, h);
    r.revives++;
    if (standing === 1 || h.player.hp / h.player.maxHp <= mvpTuning.clutchHp) {
      r.clutch++;
      moment(this, h, 'revive', rescued.name);
    }
  }
}
export function mvpShared(this: Game, h: Hero, amount: number): void {
  if (this.role !== 'client' && !this.pvp && !this.mvp.report) row(this, h).shared += Math.max(0, amount);
}
function discover(g: Game, h: Hero, r: Row, id: string, name: string, rarity?: string, fusion = false): void {
  if (r.seen.has(id)) return;
  r.seen.add(id);
  if (fusion || rarity === 'legendary') moment(g, h, fusion ? 'fusion' : 'legendary', name);
}
function syncTotals(r: Row, h: Hero): void {
  // Rejoining can rebuild this same Hero and replace its damage ledger.
  if (r.damageRef !== h.damageBy) { r.previousDamage = r.previousDashes = 0; r.damageRef = h.damageBy; }
  r.gold = h.gold;
  r.dashes += Math.max(0, h.dashes - r.previousDashes);
  r.previousDashes = h.dashes;
  let damage = 0;
  for (const id in h.damageBy) damage += h.damageBy[id];
  r.damage += Math.max(0, damage - r.previousDamage);
  r.previousDamage = damage;
}
/** A quarter-second inventory scan catches level-up, chest, shop and fusion acquisitions alike. */
export function mvpStep(this: Game, force = false): void {
  if (this.role === 'client' || this.pvp || this.mode === 'title' || this.mvp.report || !force && this.stepN % 15) return;
  for (const h of this.heroes) {
    const r = row(this, h);
    r.name = h.name;
    syncTotals(r, h);
    if (h.left) continue;
    r.peaceful = Math.max(r.peaceful, this.runTime - r.lastKill);
    for (const w of h.weapons) {
      discover(this, h, r, w.def.id, w.name, w.def.rarity, !!w.def.fusion);
      const instrument = WEAPON_STEMS[w.def.id]?.patch;
      if (instrument && !r.instruments.includes(instrument)) r.instruments.push(instrument);
    }
    for (const id in h.passives) if (h.passives[id]) discover(this, h, r, id, PASSIVES[id].name, PASSIVES[id].rarity);
    for (const sl of h.synergy.slots) discover(this, h, r, sl.def.id, sl.def.name, MOD_BY_ID[sl.def.id]?.rarity);
    for (const id of h.relics) if (RELIC_BY_ID[id]) discover(this, h, r, id, RELIC_BY_ID[id].name, RELIC_BY_ID[id].rarity);
  }
}
export function mvpFinish(this: Game): MvpReport {
  if (this.mvp.report) return this.mvp.report;
  this.mvpStep(true);
  const players: MvpPlayer[] = [];
  for (const [h, r] of this.mvp.rows) {
    syncTotals(r, h); // include the final hits of departed players too
    const { combo: _combo, lastKill: _lastKill, seen: _seen, previousDamage: _damage, previousDashes: _dashes, damageRef: _ref, ...p } = r;
    players.push({ ...p, instruments: [...r.instruments] });
  }
  players.sort((a, b) => a.index - b.index);
  return this.mvp.report = { time: Math.floor(this.runTime), players, awards: awardMvp(players), moments: [...this.mvp.moments] };
}
const views = new WeakMap<Game, MvpScreen>();
export function showMvp(this: Game, report: MvpReport): void {
  let view = views.get(this);
  if (!view) { view = new MvpScreen(this.screens); views.set(this, view); }
  view.show(report);
}

/** Deterministic visual fixture, only invoked by an explicit ?test&mvp link. Does not bank a run. */
export function mvpDemo(g: Game, count: number): MvpReport {
  const names = ['VOLT', 'NOVA', 'ACE', 'ROOK', 'LUNA', 'REX', 'MINT', 'BEAT'];
  const models = ['rookie', 'bulwark', 'ace', 'dash'];
  const patches = ['triangle', 'bell', 'pluck', 'square', 'wide', 'sawtooth', 'sine', 'bell'];
  const players = Array.from({ length: Math.max(1, Math.min(8, count)) }, (_, i): MvpPlayer => ({
    index: i, name: names[i], look: heroLook(models[i % 4], g.hero.skin), damage: 98500 - i * 6100,
    kills: 632 - i * 45, revives: i === 1 ? 4 : i % 3, saves: i === 2 ? 9 : i % 2, taken: 120 + i * 32,
    bestCombo: 68 + i * 19, shared: i * 12, gold: 32 + i * 11, dashes: 72 + i * 14,
    clutch: i === 1 ? 3 : 0, peaceful: 14 + i * 9, instruments: [patches[i], patches[(i + 2) % 8]],
  }));
  return { time: 784, players, awards: awardMvp(players), moments: [
    { time: 94, player: 0, kind: 'legendary', detail: 'Chain Zap' },
    ...(players.length > 1 ? [{ time: 241, player: 1, kind: 'revive' as const, detail: names[0] }] : []),
    { time: 428, player: 0, kind: 'fusion', detail: 'Storm Drones' },
    { time: 781, player: players.length - 1, kind: 'boss', detail: 'Omega Overlord' },
  ] };
}
