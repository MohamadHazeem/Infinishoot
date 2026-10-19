/**
 * Shop lane: the Mod order preview against the real damage pipeline, card
 * numbers, banish and lock (pure Hero logic, no DOM).
 */
import { ok } from './check';
import * as THREE from 'three';
import { WEAPONS } from '../src/data/weapons';
import { MOD_BY_ID } from '../src/data/mods';
import { Hero } from '../src/game/hero';
import { Rng } from '../src/core/rng';
import { createWeapon } from '../src/game/weapons';
import type { DamageEvent } from '../src/game/modTypes';
import type { Enemy } from '../src/game/enemies';
import { activeRows, diffRows, liveMods, previewRows, shopPreview, type PreviewBuild } from '../src/game/shopPreview';
import { itemMetrics, offerNumbers } from '../src/game/cardNumbers';
import { banishTuning, canBanish, offerKey } from '../src/game/banish';
import { baseStats } from '../src/game/stats';

const scene = new THREE.Scene();
const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 256 * 256) : k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
const world: any = { scene, level: 10, rng: new Rng(7), coop: false, makeCtx: () => ({}), fireRateBuff: 1, damageBuff: 1, dashCurse: 1, activeCurses: [], blast() {}, zap() {}, ignite() {}, shock() {}, goldFx() {} };
const mk = () => {
  const h = new Hero(world, 0, 'P1', '#fff', Object.keys(WEAPONS));
  h.loadoutPick = { primary: 'scatter', secondary: 'grenade', special: 'bomb' };
  h.startRun();
  return h;
};
const enemy = (patch: Partial<Enemy> = {}): Enemy => ({ x: 0, z: 0, hp: 1e9, maxHp: 1e9, burnT: 0, frozen: 0, shockT: 0, exposeT: 0, shatter: 0, elite: false, def: { boss: false }, ...patch }) as unknown as Enemy;
const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

// ---------------------------------------------------------------- preview == real pipeline
const h = mk();
h.weapons.push(createWeapon('drones', scene));
const add = (id: string, lv = 1) => {
  h.synergy.add(MOD_BY_ID[id], MOD_BY_ID[id].price);
  for (let k = 1; k < lv; k++) h.synergy.upgrade(h.synergy.slots.length - 1, 1);
};
add('hoarder');
add('momentum', 2);
add('echo');
add('kindling', 2);
add('hive_mind');
h.synergy.slots[0].st.n = 125; // Hoarder: +3
h.synergy.slots[1].st.n = 4; // Momentum x1.2 per level
h.recomputeStats();
const build: PreviewBuild = { gold: h.gold, level: 10, time: h.synergy.time, weapons: h.weapons.map((w) => ({ id: w.def.id, tags: w.tags })), critMult: 2, shockBase: 0.2 };
const stBefore = JSON.stringify(h.synergy.slots.map((s) => s.st));
const rows = previewRows(h.synergy.slots, build);
ok(JSON.stringify(h.synergy.slots.map((s) => s.st)) === stBefore, 'preview leaves the real Mod state alone');
const real = (ev: Partial<DamageEvent>, x: number) => h.synergy.damage({ e: enemy(), source: '', tags: [], dist: 5, crit: false, ...ev } as DamageEvent, x);
const check = (k: string, ev: Partial<DamageEvent>, factor = 1) => {
  const r = rows.find((x) => x.k === k)!;
  for (const x of [0, 7, 40, 333]) {
    const want = real(ev, x) * factor;
    if (!near(r.m * x + r.a, want)) return ok(false, `${k} at ${x}: preview ${r.m * x + r.a} vs real ${want}`);
  }
  ok(true, `${k} row matches the real pipeline (x${r.m} +${r.a})`);
};
check('all', {});
check('w:drones', { source: 'drones', tags: h.weapons.find((w) => w.def.id === 'drones')!.tags });
check('w:scatter', { source: 'scatter', tags: h.weapons[0].tags });
check('burn', { e: enemy({ burnT: 2 }) });
check('crit', { crit: true }, 2);
const burn = rows.find((r) => r.k === 'burn')!;
const all = rows.find((r) => r.k === 'all')!;
// Echo copies the level-2 Kindling: two slots of (1 + 0.4 * 2) on burning enemies, never compounding levels.
ok(near(burn.m / all.m, 1.8 * 1.8), `Echo + Kindling LV2 on burning: x${(burn.m / all.m).toFixed(2)} (1.8 x 1.8)`);
ok(near(rows.find((r) => r.k === 'w:drones')!.m / all.m, 2), 'Hive Mind doubles Orbit Drones only');
ok(all.a > 0 && near(all.a, 3 * 1.4), `Hoarder's +3 is multiplied by Momentum to its right (+${all.a})`);
ok(liveMods(h.synergy.slots, build).join() === 'Hoarder,Momentum', 'live Mods found by perturbing state: ' + liveMods(h.synergy.slots, build).join());

// Order matters: Hoarder moved to the end keeps its flat +3 unmultiplied.
const moved = [...h.synergy.slots.slice(1), h.synergy.slots[0]];
const after = previewRows(moved, build).find((r) => r.k === 'all')!;
ok(near(after.a, 3) && near(after.m, all.m), `moving Hoarder last: +${after.a} instead of +${all.a}`);
const d = diffRows({ critMult: 2, shockBase: 0.2 }, rows, previewRows(moved, build));
ok(d.some((x) => x.k === 'all' && x.changed), 'the move shows as a before -> after change');

// Shop preview: buy / move / upgrade / sell rows, and conditional Mods.
h.gold = 40;
h.openShop();
const sp = shopPreview(h, 0.2);
ok(sp.buy.length === h.shopOffers.length && sp.left[0] === null && !!sp.right[0] && sp.sell.length === 5, 'shop preview has a row set per action');
ok(sp.buy.every((b) => b === null), 'buy previews are empty while all 5 slots are full');
const h2 = mk();
h2.synergy.add(MOD_BY_ID.turret_mode, 6);
h2.synergy.add(MOD_BY_ID.static_cling, 5);
h2.synergy.add(MOD_BY_ID.glass_cannon, 5);
h2.recomputeStats();
const r2 = previewRows(h2.synergy.slots, { ...build, weapons: [] });
const get = (k: string) => r2.find((r) => r.k === k)!;
ok(near(get('all').m, 2), `Glass Cannon's x2 stat shows on every hit (x${get('all').m})`);
ok(near(get('still').m, 2 * 1.8), `Turret Mode only on the standing-still row (x${get('still').m})`);
ok(near(get('shock').m, 2 * 1.5), `Static Cling: shocked x(1.2 + 0.3) (x${get('shock').m})`);
ok(activeRows({ critMult: 2, shockBase: 0.2 }, r2).map((r) => r.k).join() === 'all,shock,still', 'only rows a Mod changes are shown: ' + activeRows({ critMult: 2, shockBase: 0.2 }, r2).map((r) => r.k).join());
ok(liveMods(h2.synergy.slots, build).join() === 'Turret Mode', 'Turret Mode is live (moving/still)');

// ---------------------------------------------------------------- card numbers
const s = baseStats();
const b0 = itemMetrics('weapon', 'buster', WEAPONS.buster.levels[0].p, s);
// Expected numbers follow the data (balance passes retune the Buster): base DPS = damage x rate.
const bp = WEAPONS.buster.levels[0].p;
const dps0 = bp.dmg * bp.rate;
const dps1 = (bp.dmg + WEAPONS.buster.tracks![0].ranks[0].p.dmg) * bp.rate;
ok(b0[0].l === 'DPS' && near(b0[0].v, dps0), `Buster base DPS ${dps0} (${b0[0].v})`);
const h3 = mk();
h3.loadoutPick = { primary: 'buster', secondary: 'charge', special: 'bomb' };
h3.startRun();
const heavy = offerNumbers(h3, { kind: 'track', id: 'buster', pick: 'buster|t|0', name: 'Heavy Rounds', icon: '', color: '', tag: '', text: '' });
ok(heavy[0]?.l === 'DPS' && heavy[0].a === String(dps0) && heavy[0].b === String(dps1) && heavy[0].d === 1, `Heavy Rounds card: DPS ${dps0} > ${dps1} ` + JSON.stringify(heavy));
const pc = offerNumbers(h3, { kind: 'passive', id: 'power_cell', name: '', icon: '', color: '', tag: '', text: '' });
ok(pc[0]?.l === 'DAMAGE' && pc[0].a === '+0%' && pc[0].b === '+10%', 'Power Cell card: DAMAGE +0% > +10% ' + JSON.stringify(pc));
const evo = offerNumbers(h3, { kind: 'evo', id: 'buster_evo', pick: 'buster|e|0', name: '', icon: '', color: '', tag: '', text: '' });
ok(evo.some((n) => n.l === 'DPS' && n.d === 1), 'evolution card shows a DPS gain ' + JSON.stringify(evo));
const nw = offerNumbers(h3, { kind: 'weapon', id: 'discs', name: '', icon: '', color: '', tag: 'NEW!', text: '' });
ok(nw.length === 2 && nw.every((n) => n.a === undefined), 'a new weapon shows its numbers without arrows ' + JSON.stringify(nw));
const sw = offerNumbers(h3, { kind: 'track', id: 'sp_bomb', pick: 'sp|t|2', name: '', icon: '', color: '', tag: '', text: '' });
ok(sw.some((n) => n.l === 'COOLDOWN' && n.d === 1), 'special Recharge rank lowers the cooldown ' + JSON.stringify(sw));
// Every offer a long run can show computes without throwing.
let n = 0;
for (let i = 0; i < 300; i++) {
  for (const o of h3.buildOffers()) {
    offerNumbers(h3, o);
    n++;
  }
  const o = h3.buildOffers()[0];
  h3.applyOffer(o);
}
ok(n > 0, `${n} offers numbered over 300 picks`);

// ---------------------------------------------------------------- banish
const hb = mk();
ok(hb.banishLeft === banishTuning.start, `runs start with ${banishTuning.start} banishes`);
hb.offers = hb.buildOffers();
const i = hb.offers.findIndex(canBanish);
const key = offerKey(hb.offers[i]);
const others = hb.offers.filter((_, j) => j !== i).map(offerKey);
ok(hb.banish(i) === '' && hb.banishLeft === banishTuning.start - 1 && hb.banished.has(key), 'banish spends a charge and remembers the item ' + key);
ok(offerKey(hb.offers[i]) !== key && hb.offers.filter((_, j) => j !== i).map(offerKey).join() === others.join(), 'only the banished card is redrawn');
ok(new Set(hb.offers.map(offerKey)).size === hb.offers.length, 'the redraw never repeats a card on screen');
let seen = false;
for (let k = 0; k < 300; k++) if (hb.buildOffers().some((o) => offerKey(o) === key)) seen = true;
ok(!seen, 'a banished item never comes back this run');
hb.banishLeft = 0;
ok(hb.banish(0) === 'NO BANISHES LEFT', 'no charges, no banish');
ok(!canBanish({ kind: 'evo' }) && !canBanish({ kind: 'gold' }), "evolution forks and bonus cards can't be banished");
hb.openShop(false, true);
ok(hb.banishLeft === 0, 'the starting shop gives no banish');
hb.openShop(false, false);
ok(hb.banishLeft === banishTuning.perShop, 'a stage-clear shop gives one');
hb.startRun();
ok(hb.banished.size === 0 && hb.banishLeft === banishTuning.start, 'a new run forgets banishes');

// ---------------------------------------------------------------- lock
const hl = mk();
hl.gold = 100;
hl.openShop();
const locked = hl.shopOffers[1]!;
ok(hl.toggleLock(1) === '' && hl.shopLocked[1], 'lock an offer');
for (let k = 0; k < 6; k++) hl.reroll();
ok(hl.shopOffers[1] === locked && hl.shopOffers.filter((m) => m === locked).length === 1, 'a locked offer survives rerolls in its slot');
hl.openShop();
ok(hl.shopOffers[1] === locked && hl.shopView(2).offers[1]?.locked === true, 'and carries into the next shop');
ok(hl.buy(1) === '' && !hl.shopLocked[1], 'buying it clears the lock');
hl.openShop();
ok(!hl.shopOffers.includes(locked), 'a bought Mod is not offered again');
hl.toggleLock(0);
hl.toggleLock(0);
ok(!hl.shopLocked[0], 'locking twice unlocks');
hl.toggleLock(2);
hl.startRun();
ok(hl.shopLocked.length === 0 && hl.shopOffers.length === 0, 'locks end with the run');
