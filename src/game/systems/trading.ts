/**
 * Trading lane: sharing in co-op (notes/lanes/trading.md).
 * - Give a teammate gold, a gear or a relic, from the TRADE quick menu (Y, or
 *   PAUSE > TRADE) during a fight or from the shop.
 * - Shop POOLs: a player opens a pool on one of their shop offers and
 *   teammates chip gold in; when it's full the host buys the Mod for them.
 * - Co-op achievements and titles (src/data/coopAchievements.ts).
 * - LEGEND difficulty (co-op only): player-count scaling and its rewards.
 * Host-authoritative: clients send `tr` messages, the host validates,
 * rate-limits and applies them, and every client mirrors the result through
 * the snapshot's `tr` field. These are Game methods (`this` is the Game).
 */
import type { Game } from '../game';
import type { Hero } from '../hero';
import { MAX_GEARS } from '../hero';
import { MOD_BY_ID } from '../../data/mods';
import { RELIC_BY_ID, rollRelic } from '../../data/relics';
import { bestTitle, COOP_ACH_BY_ID, titleOf } from '../../data/coopAchievements';
import { save, grantAchievement } from '../save';
import { samples } from '../../audio/samples';
import { sfx } from '../../audio/sfx';
import { t } from '../../i18n';
import { checkGive, goldMoved, legendDifficulty, legendTuning, poolLeft, poolTotal, TradeLimiter, TradePools, tradeTuning, type GiveKind, type Pool } from '../trading';
import { TradeUi } from '../../ui/tradeMenu';

/** A trade on the effects list: gold (g), gear (r), relic (l), pool funded (p), chip (c), pool cancelled (x). */
export interface TradeEvent {
  seq: number;
  t: number;
  k: 'g' | 'r' | 'l' | 'p' | 'c' | 'x';
  /** Giver / chipper / pool owner, receiver (-1 for none), gold, relic or Mod id. */
  a: number;
  b: number;
  n: number;
  s: string;
}

export interface NetPool {
  id: number;
  owner: number;
  slot: number;
  mod: string;
  price: number;
  paid: number;
  mine: number;
}

/** What the UI shows, on the host straight from the heroes, on clients from the snapshot. */
export interface TradeView {
  coop: boolean;
  me: number;
  heroes: { index: number; name: string; color: string; gold: number; gears: number; relics: string[]; left: boolean; down: boolean; title: string }[];
  pools: NetPool[];
  inShop: boolean;
}

interface RunStats {
  gold: number;
  gifts: number;
  relics: number;
  pools: number;
}

interface TradeState {
  clock: number;
  seed: number;
  limiters: Map<number, TradeLimiter>;
  pools: TradePools;
  /** The open pools belong to the starting shop (its leftover gold is wiped, so no refunds). */
  poolsPre: boolean;
  events: TradeEvent[];
  seq: number;
  stats: RunStats[];
  /** Titles by peer id (from `hello`). */
  titles: Map<string, string>;
  lastMode: string;
  lastBosses: number;
  legendN: number;
  /** Team-wide feats for achievements: [bosses in co-op, 4-player clear, Legend clear 2+, Legend victory]. */
  feats: number[];
  // Client mirror.
  net: { w: number[][]; p: NetPool[]; ti: string[]; st: number[]; ft: number[] } | null;
  netKey: string;
  lastSeq: number;
  /** Bumped whenever something the menus show changes. */
  version: number;
  ui: TradeUi | null;
  achT: number;
  /** Test links: titles pinned per hero index, and actions run each step until they return true. */
  forceTitle: string[];
  later: (() => boolean)[];
}

const states = new WeakMap<Game, TradeState>();

export function tradeState(g: Game): TradeState {
  let s = states.get(g);
  if (!s) {
    s = {
      clock: 0, seed: NaN, limiters: new Map(), pools: new TradePools(), poolsPre: false, events: [], seq: 0, stats: [], titles: new Map(),
      lastMode: '', lastBosses: 0, legendN: 0, feats: [0, 0, 0, 0], net: null, netKey: '', lastSeq: 0, version: 0, ui: null, achT: 0, forceTitle: [], later: [],
    };
    states.set(g, s);
  }
  return s;
}

/** This machine's title (the best co-op title its save holds), as an achievement id or ''. */
export function localTitle(): string {
  return bestTitle(save.achievements)?.id ?? '';
}

/** Can trading happen right now? Co-op (2+ heroes in), not PvP or Versus. */
export function tradingOn(g: Game): boolean {
  return g.coop && !g.pvp && !g.versus;
}

function ensureUi(g: Game, s: TradeState): TradeUi | null {
  if (!s.ui && typeof document !== 'undefined') s.ui = new TradeUi(g);
  return s.ui;
}

function stats(s: TradeState, i: number): RunStats {
  return (s.stats[i] ??= { gold: 0, gifts: 0, relics: 0, pools: 0 });
}

function titleFor(g: Game, s: TradeState, h: Hero): string {
  if (s.forceTitle[h.index]) return s.forceTitle[h.index];
  if (h.peerId) return s.titles.get(h.peerId) ?? '';
  return h === g.hero && g.role !== 'client' ? localTitle() : '';
}

// ---------------------------------------------------------------- per step

/** Every step on every machine: the quick-menu key, host bookkeeping (pools, LEGEND), achievements, the menus. */
export function tradingStep(this: Game, dt: number): void {
  const s = tradeState(this);
  s.clock += dt;
  ensureUi(this, s);
  if (this.role !== 'client') hostStep(this, s);
  // The TRADE quick menu: Y (rebindable) in a co-op fight.
  if (tradingOn(this) && this.isCombatMode && this.screens.current === 'none' && this.input.actionPressed('trade')) this.openTrade();
  if ((s.achT -= dt) <= 0) {
    s.achT = 0.5;
    checkTradeAchievements(this, s);
  }
  s.ui?.tick();
  if (s.later.length) s.later = s.later.filter((f) => !f());
}

function hostStep(g: Game, s: TradeState): void {
  if (g.seed !== s.seed) {
    // A new run: fresh stats, no pools, LEGEND re-scaled below.
    s.seed = g.seed;
    s.stats = [];
    s.pools.clear();
    s.legendN = 0;
    s.lastBosses = g.bossesRun;
    s.feats = [0, 0, 0, 0];
    s.version++;
  }
  // LEGEND follows the players in the run (drop-in / drop-out included).
  if (g.difficulty.id === 'legend' && g.mode !== 'title') {
    const n = g.heroes.filter((h) => !h.left).length;
    if (n !== s.legendN) {
      const d = legendDifficulty(n);
      if (g.difficulty.enemyCount > 0) g.director.countMul *= d.enemyCount / g.difficulty.enemyCount;
      g.difficulty = d;
      s.legendN = n;
    }
  }
  // Pools only live in the shop: refund when it closes, or when the offer is gone (bought, rerolled, owner left).
  if (s.pools.list.length) {
    if (g.mode !== 'shop') {
      const back = s.pools.clear();
      if (!s.poolsPre) refund(g, s, back);
      s.version++;
    } else {
      for (const p of [...s.pools.list]) {
        const o = g.heroes[p.owner];
        if (!o || o.left || o.shopOffers[p.slot]?.id !== p.mod) cancelPool(g, s, p);
      }
    }
  }
  // Team feats for achievements and LEGEND rewards.
  const coop = tradingOn(g);
  if (g.bossesRun > s.lastBosses) {
    if (coop) s.feats[0] += g.bossesRun - s.lastBosses;
    if (g.difficulty.id === 'legend') legendBounty(g);
    s.lastBosses = g.bossesRun;
  }
  if (g.mode === 'cleared' && s.lastMode !== 'cleared') {
    if (coop && g.heroes.filter((h) => !h.left).length >= 4) s.feats[1] = 1;
    if (g.difficulty.id === 'legend') {
      if (g.stage >= 2) s.feats[2] = 1;
      for (const h of g.heroes) if (!h.left) h.rerollsLeft = Math.min(MAX_GEARS, h.rerollsLeft + legendTuning.clearGears);
    }
  }
  if (g.difficulty.id === 'legend' && g.victories > 0) s.feats[3] = 1;
  s.lastMode = g.mode;
}

/** LEGEND: every hero rolls one more relic per boss, with extra luck. */
function legendBounty(g: Game): void {
  for (const h of g.heroes) {
    if (h.left) continue;
    const r = rollRelic(h.relics, h.stats.luck + legendTuning.relicLuck, () => g.rng.next());
    if (!r) continue;
    h.relics.push(r.id);
    h.recomputeStats();
    h.loadoutDirty = true;
    const msg = `LEGEND BOUNTY: ${r.name.toUpperCase()} - ${r.desc}`;
    if (h === g.hero) g.hud.toast(msg, 4);
    else g.tell(h, { t: 'toast', msg });
  }
}

function refund(g: Game, s: TradeState, back: [number, number][]): void {
  for (const [i, n] of back) {
    const h = g.heroes[i];
    if (h) h.gold += n;
  }
  if (back.length) refreshShops(g, back.map(([i]) => i));
  s.version++;
}

function cancelPool(g: Game, s: TradeState, p: Pool, quiet = false): void {
  const back = s.pools.close(p);
  if (s.poolsPre && g.mode !== 'shop') return;
  refund(g, s, back);
  if (!quiet) pushEvent(g, s, 'x', p.owner, -1, poolTotal(p), p.mod);
}

/** Re-send the shop to these heroes (if they're still shopping) so their gold and the pools are current. */
function refreshShops(g: Game, who: number[]): void {
  if (g.mode !== 'shop') return;
  for (const i of new Set(who)) {
    const h = g.heroes[i];
    if (h && !h.left && !h.shopDone) g.presentShop(h);
  }
}

function pushEvent(g: Game, s: TradeState, k: TradeEvent['k'], a: number, b: number, n: number, str: string): void {
  const e: TradeEvent = { seq: ++s.seq, t: s.clock, k, a, b, n, s: str };
  s.events.push(e);
  s.events = s.events.filter((x) => s.clock - x.t < tradeTuning.eventLife);
  s.version++;
  showEvent(g, e);
}

// ---------------------------------------------------------------- actions

/** A trade from this machine's player: applied on the host, sent there from clients. */
export function tradeAct(this: Game, m: { a: 'give'; k: GiveKind; to: number; n?: number; id?: string } | { a: 'pool'; i: number } | { a: 'chip'; p: number; n: number } | { a: 'unpool'; p: number }): void {
  if (this.role === 'client') {
    this.client?.send({ t: 'tr', ...m });
    return;
  }
  this.tradeMessage(this.hero, { t: 'tr', ...m });
}

/** Host: a trade request from hero `h` (the local player's or a client's). */
export function tradeMessage(this: Game, h: Hero, m: Record<string, unknown>): void {
  const s = tradeState(this);
  const err = (msg: string) => {
    if (h === this.hero) {
      this.hud.toast(msg);
      sfx.deny();
    } else this.tell(h, { t: 'toast', msg });
  };
  if (!tradingOn(this) || h.left) return err('NO ONE TO TRADE WITH');
  const shop = this.mode === 'shop';
  if (!shop && !this.isCombatMode) return err('NOT NOW');
  let lim = s.limiters.get(h.index);
  if (!lim) s.limiters.set(h.index, (lim = new TradeLimiter()));
  if (!lim.allow(s.clock)) return err('SLOW DOWN');
  const a = String(m.a);
  if (a === 'give') {
    const k = (['gold', 'gear', 'relic'] as const).find((x) => x === m.k);
    const to = this.heroes[Number(m.to)];
    if (!k) return;
    const id = String(m.id ?? '');
    const e = checkGive(wallet(h), to && wallet(to), k, Number(m.n), id, MAX_GEARS);
    if (e) return err(e);
    const st = stats(s, h.index);
    if (k === 'gold') {
      const n = goldMoved(h.gold, Number(m.n));
      h.gold -= n;
      to.gold += n;
      st.gold += n;
      pushEvent(this, s, 'g', h.index, to.index, n, '');
    } else if (k === 'gear') {
      h.rerollsLeft--;
      to.rerollsLeft++;
      pushEvent(this, s, 'r', h.index, to.index, 1, '');
    } else {
      h.relics = h.relics.filter((r) => r !== id);
      to.relics.push(id);
      h.recomputeStats();
      to.recomputeStats();
      h.loadoutDirty = to.loadoutDirty = true;
      st.relics++;
      pushEvent(this, s, 'l', h.index, to.index, 0, id);
    }
    st.gifts++;
    giveFx(this, h, to, k);
    refreshShops(this, [h.index, to.index]);
    return;
  }
  if (!shop) return err('POOLS ARE FOR THE SHOP');
  if (a === 'pool') {
    const i = Number(m.i);
    const mod = h.shopOffers[i];
    if (!mod) return err('SOLD OUT');
    if (h.shopDone) return err('YOU ALREADY LEFT THE SHOP');
    if (h.synergy.full) return err('MOD SLOTS FULL: SELL ONE FIRST');
    const p = s.pools.open(h.index, i, mod.id, h.price(mod));
    if (typeof p === 'string') return err(p);
    if (s.pools.list.length === 1) s.poolsPre = this.preShop;
    s.version++;
    this.vfx.toast(`${h.name.toUpperCase()} STARTED A POOL: ${mod.name.toUpperCase()}`, 2.5);
    refreshShops(this, this.heroes.map((x) => x.index));
    return;
  }
  const p = s.pools.get(Number(m.p));
  if (!p) return err('THAT POOL IS CLOSED');
  if (a === 'unpool') {
    if (p.owner !== h.index) return err("THAT ISN'T YOUR POOL");
    cancelPool(this, s, p);
    return;
  }
  if (a === 'chip') {
    const n = s.pools.chip(p, h.index, Number(m.n), h.gold);
    if (n <= 0) return err(h.gold < 1 ? 'NOT ENOUGH GOLD' : 'THAT POOL IS FULL');
    h.gold -= n;
    if (p.owner !== h.index) stats(s, h.index).gold += n;
    pushEvent(this, s, 'c', h.index, p.owner, n, p.mod);
    if (poolLeft(p) <= 0) completePool(this, s, p);
    else refreshShops(this, [h.index]);
  }
}

/** A full pool: the owner gets the gold and the host buys the Mod for them. */
function completePool(g: Game, s: TradeState, p: Pool): void {
  const o = g.heroes[p.owner];
  const total = poolTotal(p);
  if (!o || o.left) return cancelPool(g, s, p);
  s.pools.close(p);
  o.gold += total;
  const err = o.buy(p.slot);
  if (err) {
    o.gold -= total;
    refund(g, s, p.paid.map((v, i) => [i, v] as [number, number]).filter(([, v]) => v > 0));
    pushEvent(g, s, 'x', p.owner, -1, total, p.mod);
    return;
  }
  p.paid.forEach((v, i) => {
    if (v > 0 || i === p.owner) stats(s, i).pools++;
  });
  pushEvent(g, s, 'p', p.owner, -1, total, p.mod);
  g.shopFx(o, 'buy', p.slot);
  refreshShops(g, g.heroes.map((x) => x.index));
}

function wallet(h: Hero) {
  return { index: h.index, gold: h.gold, gears: h.rerollsLeft, relics: h.relics, left: h.left };
}

/** Coins fly from giver to receiver: a gold burst on both and a number over the receiver (seen by everyone). */
function giveFx(g: Game, from: Hero, to: Hero, k: GiveKind): void {
  if (g.mode === 'shop') return;
  const a = from.player;
  const b = to.player;
  const color = k === 'gold' ? '#ffcd75' : k === 'gear' ? '#94b0c2' : '#b13e53';
  g.vfx.burst(a.x, 1.2, a.z, { count: 8, color, color2: '#f4f4f4', speed: [2, 5], size: [0.1, 0.2], life: [0.3, 0.5], up: 5, gravity: 10 });
  g.vfx.burst(b.x, 1.4, b.z, { count: 12, color, color2: '#ffffff', speed: [1.5, 4], size: [0.1, 0.22], life: [0.35, 0.6], up: 6, gravity: 12 });
  g.vfx.ring(b.x, b.z, 0.5, 2.2, color, 0.35);
}

// ---------------------------------------------------------------- what each screen sees

/** Sounds and messages for one trade event, on whichever machine sees it. */
function showEvent(g: Game, e: TradeEvent): void {
  const me = g.local;
  const name = (i: number) => (g.heroes[i]?.name ?? '?').toUpperCase();
  const mine = e.a === me || e.b === me;
  if (mine || e.k === 'p') {
    if (!samples.play('coin_transfer', { bus: 'sfx', gain: 0.9, priority: 6, cooldown: 0.1 })) sfx.coin();
  }
  let msg = '';
  if (e.k === 'g' || e.k === 'r' || e.k === 'l') {
    const what = e.k === 'g' ? t('trading.what_gold', { n: e.n }) : e.k === 'r' ? t('trading.what_gear') : (RELIC_BY_ID[e.s]?.name ?? e.s).toUpperCase();
    if (e.b === me) msg = t('trading.got', { who: name(e.a), what });
    else if (e.a === me) msg = t('trading.sent', { who: name(e.b), what });
  } else if (e.k === 'c') {
    if (e.b === me && e.a !== me) msg = t('trading.chipped', { who: name(e.a), n: e.n });
  } else if (e.k === 'p') {
    msg = t('trading.funded', { who: name(e.a), mod: (MOD_BY_ID[e.s]?.name ?? e.s).toUpperCase() });
  } else if (e.k === 'x') {
    if (e.a !== me) msg = t('trading.cancelled', { who: name(e.a) });
  }
  if (msg) g.hud.toast(msg, 2.4);
}

/** The host's snapshot field `tr` (null outside co-op, so it costs nothing). */
export function tradingNet(this: Game, forHero: Hero): unknown {
  if (!tradingOn(this)) return null;
  const s = tradeState(this);
  const st = s.stats[forHero.index];
  return {
    w: this.heroes.map((h) => [h.gold, h.rerollsLeft]),
    p: s.pools.list.map((p) => [p.id, p.owner, p.slot, p.mod, p.price, poolTotal(p), p.paid[forHero.index] ?? 0]),
    ti: this.heroes.map((h) => titleFor(this, s, h)),
    e: s.events.filter((e) => s.clock - e.t < tradeTuning.eventLife).map((e) => [e.seq, e.k, e.a, e.b, e.n, e.s]),
    st: st ? [st.gold, st.gifts, st.relics, st.pools] : [0, 0, 0, 0],
    ft: s.feats,
  };
}

/** Client: mirror the host's `tr` field. */
export function applyTradingNet(this: Game, v: unknown): void {
  const s = tradeState(this);
  if (!v || typeof v !== 'object') {
    if (s.net) {
      s.net = null;
      s.version++;
    }
    return;
  }
  const o = v as Record<string, unknown>;
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  const p = arr(o.p).map((r) => {
    const a = arr(r);
    return { id: Number(a[0]), owner: Number(a[1]), slot: Number(a[2]), mod: String(a[3]), price: Number(a[4]), paid: Number(a[5]), mine: Number(a[6]) };
  });
  const net = { w: arr(o.w).map((x) => arr(x).map(Number)), p, ti: arr(o.ti).map((x) => (titleOf(x) ? String(x) : '')), st: arr(o.st).map(Number), ft: arr(o.ft).map(Number) };
  const key = JSON.stringify([net.w, net.p, net.ti]);
  if (key !== s.netKey) {
    s.netKey = key;
    s.version++;
  }
  s.net = net;
  const evs = arr(o.e).map((x) => arr(x));
  const top = evs.reduce((m, e) => Math.max(m, Number(e[0])), 0);
  if (top && top < s.lastSeq) s.lastSeq = 0; // a new host
  for (const e of evs) {
    const seq = Number(e[0]);
    if (seq <= s.lastSeq) continue;
    s.lastSeq = seq;
    const k = String(e[1]) as TradeEvent['k'];
    if (!['g', 'r', 'l', 'p', 'c', 'x'].includes(k)) continue;
    showEvent(this, { seq, t: 0, k, a: Number(e[2]), b: Number(e[3]), n: Number(e[4]), s: String(e[5] ?? '') });
  }
}

/** Host: remember a player's title from their `hello` (known title ids only). */
export function tradingHello(this: Game, from: string, m: Record<string, unknown>): void {
  const s = tradeState(this);
  const ti = titleOf(m.title);
  if (ti) s.titles.set(from, ti.id);
  else s.titles.delete(from);
}

/** A lobby player's title, by peer id ('' is the host itself). */
export function lobbyTitle(this: Game, peerId: string): string {
  if (!peerId) return localTitle();
  return tradeState(this).titles.get(peerId) ?? '';
}

/** Everything the TRADE menu and the shop's pool panel draw. */
export function tradeView(this: Game): TradeView {
  const s = tradeState(this);
  const coop = tradingOn(this);
  const net = this.role === 'client' ? s.net : null;
  const heroes = this.heroes.map((h) => {
    const w = net?.w[h.index];
    return {
      index: h.index,
      name: h.name,
      color: h.color,
      gold: h === this.hero ? h.gold : w ? w[0] : h.gold,
      gears: h === this.hero ? h.rerollsLeft : w ? w[1] : h.rerollsLeft,
      relics: h.relics.filter((r) => RELIC_BY_ID[r]),
      left: h.left,
      down: h.player.dead,
      title: net ? net.ti[h.index] ?? '' : titleFor(this, s, h),
    };
  });
  const pools: NetPool[] = net
    ? net.p
    : s.pools.list.map((p) => ({ id: p.id, owner: p.owner, slot: p.slot, mod: p.mod, price: p.price, paid: poolTotal(p), mine: p.paid[this.local] ?? 0 }));
  return { coop, me: this.local, heroes, pools, inShop: this.mode === 'shop' || this.screens.current === 'shop' };
}

/** Bumped when the menus need a redraw. */
export function tradeVersion(g: Game): number {
  return tradeState(g).version;
}

/** Open the TRADE quick menu (co-op fights; the shop opens it too). Online the world keeps running behind it. */
export function openTrade(this: Game): void {
  if (!tradingOn(this)) return;
  const s = tradeState(this);
  if (this.isCombatMode) this.paused = true;
  ensureUi(this, s)?.open();
}

// ---------------------------------------------------------------- achievements and titles

function checkTradeAchievements(g: Game, s: TradeState): void {
  if (g.mode === 'title' || g.pvp) return;
  const st = g.role === 'client' ? s.net?.st ?? [] : (() => {
    const x = s.stats[g.local];
    return x ? [x.gold, x.gifts, x.relics, x.pools] : [];
  })();
  const ft = g.role === 'client' ? s.net?.ft ?? [] : s.feats;
  const want: [string, boolean][] = [
    ['co_gift', (st[1] ?? 0) > 0],
    ['co_heirloom', (st[2] ?? 0) > 0],
    ['co_pool', (st[3] ?? 0) > 0],
    ['co_patron', (st[0] ?? 0) >= tradeTuning.patronGold],
    ['co_buddy', (ft[0] ?? 0) > 0],
    ['co_squad', (ft[1] ?? 0) > 0],
    ['co_legend', (ft[2] ?? 0) > 0],
    ['co_mythic', (ft[3] ?? 0) > 0],
  ];
  for (const [id, ok] of want) {
    if (!ok) continue;
    const def = grantAchievement(id);
    if (!def) continue;
    g.newAchievements.push(id);
    const ti = COOP_ACH_BY_ID[id];
    g.hud.toast(`★ ${def.name} - ${t('trading.title_earned', { title: ti?.title ?? '' })}`, 4);
    sfx.powerUp();
    s.version++;
  }
}

/** Debug and tests: the lane's state. */
export function tradingDebug(g: Game): TradeState {
  return tradeState(g);
}
