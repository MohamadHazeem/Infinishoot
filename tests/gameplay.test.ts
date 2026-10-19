/**
 * Gameplay lane: pure rules (overload eligibility, cash-in costs, comeback
 * line, mutation candidates, finale order, kinds) and a solo Game (jsdom, no
 * WebGL) that pilots a mech, grabs a supply crate, mutates enemies, fires an
 * overload, cashes in the combo, goes into comeback mode, plays the finale
 * and uses the new relics.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop),
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, { get: (_t, k) => (k === 'createImageData' || k === 'getImageData' ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) }) : k === 'canvas' ? this : noop[k as never]) });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent']) {
  try { (globalThis as any)[k] = (dom.window as any)[k]; } catch { Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true }); }
}
(globalThis as any).Path2D = (dom.window as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'test';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});

// Deterministic Math.random (crits, drop and spawn rolls): without it a few checks flaked (a cash-in BOMB with no
// enemy in reach, a kill that didn't roll its blast). The game's own seeded RNG already covers the rest.
let rs = 0x9e3779b9;
Math.random = () => {
  rs = (Math.imul(rs ^ (rs >>> 15), 1 | rs) + 0x6d2b79f5) | 0;
  return ((rs ^ (rs >>> 14)) >>> 0) / 4294967296;
};
const GP = await import('../src/game/gameplay');
const SYS = await import('../src/game/systems/gameplay');
const { Input } = await import('../src/core/input');
const { Game, cheats, BULLET_KINDS } = await import('../src/game/game');
const { ENEMIES } = await import('../src/data/enemies');
const { RELICS } = await import('../src/data/relics');
const { WEAPONS } = await import('../src/data/weapons');
const { codexEntries: arsenalEntries } = (await import('../src/data/arsenal')) as any;
const { settings } = await import('../src/game/settings');
const { Team } = await import('../src/game/bullets');
const { PickupType } = await import('../src/game/pickups');
const { binds } = await import('../src/core/keybinds');

// ---------------------------------------------------------------- pure rules

const tiers = GP.cashTuning.tiers;
ok(GP.cashCost(tiers[0], 0) === 40 && GP.cashCost(tiers[0], 1) === 60 && GP.cashCost(tiers[2], 2) === 338, 'cash-in costs grow x1.5 per use in a stage');
ok(JSON.stringify(GP.cashAffordable(90, 0)) === '[true,true,false]', 'cash-in: what 90 combo affords');
const fx0 = GP.cashEffect(40);
const fx1 = GP.cashEffect(400);
ok(fx1.heal > fx0.heal && fx1.radius > fx0.radius && fx1.coins > fx0.coins && fx1.heal <= GP.cashTuning.healMax && fx1.radius <= GP.cashTuning.bombRadiusMax, 'cash-in effects grow with the combo, capped');
ok(GP.comebackState(1, 100, 0, false) && GP.comebackState(10, 100, 0, false) && !GP.comebackState(11, 100, 0, false), 'comeback: at or under 10% of max life');
ok(!GP.comebackState(1, 100, 1, false) && !GP.comebackState(1, 100, 0, true), 'comeback: never with a revive left or when down');
ok(GP.comebackState(1, 5, 0, false), 'comeback: the line is at least 1 life');
const subj = (def: any, mutated = false, pvpOwner = -1) => ({ def: { behavior: 'chase', ...def }, mutated, pvpOwner });
ok(GP.canMutate(subj({ id: 'bopper' })), 'mutation: normal enemies can mutate');
ok(!GP.canMutate(subj({ id: 'king', boss: true })) && !GP.canMutate(subj({ id: 'prince', miniboss: true })) && !GP.canMutate(subj({ id: 'reaper' })), 'mutation: never bosses, mini-bosses or the Reaper');
ok(!GP.canMutate(subj({ id: 'golden', treasure: {} })) && !GP.canMutate(subj({ id: 'x', behavior: 'egg' })) && !GP.canMutate(subj({ id: 'pvp', hidden: true })) && !GP.canMutate(subj({ id: 'b' }, true)) && !GP.canMutate(subj({ id: 'b' }, false, 0)), 'mutation: never the Goldbug, eggs, stand-ins, twice or PvP proxies');
const sites = Array.from({ length: 200 }, (_, i) => ({ x: i * 0.5, z: 0 }));
const sched = GP.finaleSchedule(sites, 0, 0);
ok(sched.length === GP.finaleTuning.maxSites, `finale: at most ${GP.finaleTuning.maxSites} detonations (${sched.length})`);
ok(sched.every((s, i) => i === 0 || s.t >= sched[i - 1].t) && sched[sched.length - 1].t <= GP.finaleTuning.maxTime + 1e-6, 'finale: rolls outward in time order within maxTime');
ok(sched[0].x <= sched[sched.length - 1].x, 'finale: nearest goes first');
const tight = GP.finaleSchedule(Array.from({ length: 20 }, () => ({ x: 1, z: 1 })), 0, 0);
ok(tight[19].t - tight[0].t > 0.3, 'finale: a tight crowd still rolls (min gap)');
ok(GP.gpPower(1) === 1 && GP.gpPower(8) > 4 && GP.gpPower(8) < 8, 'power grows with enemy life, slower than it');

// Net round trip of the per-hero state.
const hp = new GP.HeroPlay();
hp.mechT = 12.3;
hp.superId = 'railgun';
hp.superAmmo = 7;
hp.superT = 9.5;
hp.overload01 = 0.4;
hp.comeback = true;
hp.overloadReady = true;
hp.sats.push({ a: 1.5, t: 0 }, { a: 3, t: 0 });
const hp2 = new GP.HeroPlay();
hp2.setNet(structuredClone(hp.net()));
ok(hp2.mechT === 12.3 && hp2.superId === 'railgun' && hp2.superAmmo === 7 && hp2.comeback && hp2.overloadReady && hp2.sats.length === 2 && hp2.overload01 === 0.4, 'HeroPlay net round trip');

// Relics, icons and the Arsenal.
const mine = ['r_dashfire', 'r_orbit', 'r_nova', 'r_adrenal', 'r_keg', 'r_combo'];
ok(mine.every((id) => RELICS.some((r) => r.id === id && (r.rarity === 'rare' || r.rarity === 'legendary'))), '6 new rare/legendary relics');
const ICON = (await import('../src/data/iconArt')).ICON_ART;
ok(mine.every((id) => ICON[id]?.length) && ['gp_minigun', 'gp_railgun', 'gp_flamer', 'gp_mech'].every((id) => ICON[id]?.length), 'icons for the relics, super weapons and the mech');
if (typeof arsenalEntries === 'function') ok(mine.every((id) => arsenalEntries().some((e: any) => e.key === `r:${id}`)), 'relics show in the Arsenal');
ok(binds.cash[0] === 'KeyX' && binds.cashpick[0] === 'KeyZ', 'cash-in keys X / Z');

// ---------------------------------------------------------------- a solo game

cheats.god = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const g = new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
settings.autoFire = true;
g.startSolo();
if (g.mode === 'shop') g.closeShop();
g.xpNext = 1e12;
const h = g.hero;
const p = h.player;
/** Steps the game; chests and level-ups from the test's own kills are waved through so it stays in the fight. */
const step = (n: number) => {
  for (let i = 0; i < n; i++) {
    h.pendingLevels = h.chestsPending = 0;
    if (g.mode === 'levelup') {
      g.screens.show('none');
      g.mode = 'fight';
    }
    g.update(1 / 60);
  }
};
const ring = (id: string, n: number, r: number, opts: any = {}) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(g.enemies.spawn(ENEMIES[id], p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, g.spawnOpts({ instant: true, ...opts })));
  }
  return out;
};
const clear = () => {
  for (const e of g.enemies.list) if (e.active) g.enemies.kill(e);
};
step(10);
ok(GP.GP_KINDS.minigun >= 0 && BULLET_KINDS[GP.GP_KINDS.missile].source === 'mech' && BULLET_KINDS[GP.GP_KINDS.flamer].tags?.includes('fire'), 'lane bullet kinds registered into BULLET_KINDS');
ok(g.sourceName('mech') === 'Mech Suit' && g.sourceName('railgun') === 'Railgun' && g.sourceName('r_keg') === 'Powder Keg', 'damage breakdown names');

// Mech suit.
g.director.time = 5;
const speed0 = h.stats.moveSpeedMul;
const armor0 = h.stats.armor;
SYS.startMech(g, h);
step(60); // Buster rounds already in flight land first
const busterBefore = h.damageBy.buster ?? 0;
ring('chonk', 8, 5);
step(150);
ok(h.play.mechT > 0 && p.noDash, 'mech suit: piloting, no dashing');
ok(h.stats.moveSpeedMul < speed0 * 0.8 && h.stats.armor >= armor0 + GP.mechTuning.armor, `mech suit: slower (${speed0.toFixed(2)} -> ${h.stats.moveSpeedMul.toFixed(2)}) and armoured (+${h.stats.armor - armor0})`);
ok((h.damageBy.mech ?? 0) > 0, `mech suit: cannons/missiles/stomps deal damage (${Math.round(h.damageBy.mech ?? 0)})`);
ok((h.damageBy.buster ?? 0) === busterBefore, 'mech suit: the Buster (left click) is idle');
clear();
ring('chonk', 6, 2.5);
h.play.mechT = 0.05;
step(4);
ok(h.play.mechT === 0 && !p.noDash && (h.damageBy.mech_eject ?? 0) > 0 && p.invuln > 0, 'mech suit: ejects with a blast and i-frames');
clear();

// Supply crate -> super weapon.
const W = SYS.gpWorld(g);
SYS.spawnCrate(g, p.x, p.z, 'minigun');
step(30);
ok(W.drops.length === 1 && h.play.superId === '', 'crate: falling, not grabbable yet');
step(Math.ceil(GP.crateTuning.fall * 60));
ok(h.play.superId === 'minigun' && W.drops.length === 0, 'crate: landed and grabbed: minigun');
step(45); // Buster rounds already in flight land first
const ammo0 = h.play.superAmmo;
const bust1 = h.damageBy.buster ?? 0;
ring('chonk', 16, 4); // all round: the test's aim follows the (still) mouse
step(90);
ok(h.play.superAmmo < ammo0 && (h.damageBy.minigun ?? 0) > 0 && (h.damageBy.buster ?? 0) === bust1, `minigun fires instead of the left click (${ammo0} -> ${Math.round(h.play.superAmmo)} rounds, minigun ${Math.round(h.damageBy.minigun ?? 0)}, buster +${Math.round((h.damageBy.buster ?? 0) - bust1)})`);
(h.play.superW as any).ammo = 0;
step(2);
ok(h.play.superId === '' && !h.play.superW, 'super weapon: gone when its ammo runs out');
clear();
for (const id of ['railgun', 'flamer'] as const) {
  SYS.spawnCrate(g, p.x, p.z, id);
  step(Math.ceil(GP.crateTuning.fall * 60) + 5);
  ring('chonk', 6, 5);
  step(60);
  ok(h.play.superId === id && (h.damageBy[id] ?? 0) > 0, `${id}: grabbed and dealing damage (${Math.round(h.damageBy[id] ?? 0)})`);
  clear();
  (h.play.superW as any).ammo = 0;
  step(2);
}

// Mutations.
GP.mutationTuning.after = 1;
const [m] = ring('bopper', 1, 7);
const hp0 = m.maxHp;
const sc0 = m.scale;
step(80);
ok(m.mutated && m.maxHp >= hp0 * 2 && m.scale > sc0, `mutation: after ${GP.mutationTuning.after} s alive: x${(m.maxHp / hp0).toFixed(1)} life, bigger`);
const enemyBullets = () => { let n = 0; for (let i = 0; i < g.bullets.count; i++) if (g.bullets.team[i] === Team.Enemy) n++; return n; };
let spat = false;
for (let i = 0; i < 6 * 60 && !spat; i++) {
  step(1);
  spat = enemyBullets() >= 3;
}
ok(spat, 'mutation: mutants spit rings of bullets');
const boss = g.enemies.spawn(ENEMIES.king, p.x + 15, p.z, g.spawnOpts({ instant: true }));
step(90);
ok(!boss.mutated, 'mutation: bosses never mutate');
const gems0 = g.pickups.count;
g.killEnemy(m, 'buster', h);
ok(g.pickups.count > gems0, 'mutation: a mutant drops extra XP');
g.enemies.kill(boss);
g.boss = null;
GP.mutationTuning.after = 40;
clear();

// Overload.
ok(!GP.overloadEligible(h.weapons, 4), 'overload: not with a starting kit');
for (const w of h.weapons) {
  if (w.build) {
    (w.def.tracks ?? []).forEach((t, k) => { for (let r = 0; r < t.ranks.length; r++) w.addRank(k); });
    w.evolve(0);
  } else while (!w.maxed) w.levelUp();
}
ok(!GP.overloadEligible(h.weapons, 4), 'overload: clicks maxed but no auto weapons yet');
for (const id of ['drones', 'aura', 'lightning']) for (let i = 0; i < WEAPONS[id].levels.length; i++) g.debugGiveWeapon(id);
ok(!GP.overloadEligible(h.weapons, 4), 'overload: three maxed auto weapons are not enough');
g.debugGiveWeapon('discs');
ok(!GP.overloadEligible(h.weapons, 4), 'overload: a level-1 fourth weapon is not enough');
while (!h.weapons.find((w) => w.def.id === 'discs')!.maxed) g.debugGiveWeapon('discs');
ok(GP.overloadEligible(h.weapons, 4), 'overload: all six slots maxed');
step(31);
ok(h.play.overloadReady && h.play.overload01 > 0, 'overload: the meter fills');
h.play.overload01 = 0.999;
const cd0 = h.stats.cooldownMul;
step(30);
let volley = 0;
for (let i = 0; i < g.bullets.count; i++) if (g.bullets.kind[i] === GP.GP_KINDS.overload) volley++;
ok(h.play.overloadT > 0 && volley > 8 && h.stats.cooldownMul < cd0 * 0.5, `overload: fires a barrage (${volley} stars) and weapons speed up (x${(h.stats.cooldownMul / cd0).toFixed(2)})`);
for (let i = 0; i < 900 && h.play.overloadT > 0; i++) step(1); // hit-stops from crits pause the clock
ok(h.play.overloadT < 1e-3 && h.play.overload01 < 0.5, `overload: ends and the meter starts over (${h.play.overloadT.toFixed(2)}, ${h.play.overload01.toFixed(2)})`);
clear();

// Combo cash-in.
g.combo = 100;
g.comboT = 10;
p.hp = 30;
ok(g.gpCashIn(h, 0) === '' && g.combo === 0 && p.hp > 30, 'cash-in: HEAL spends the combo and heals');
g.combo = 50;
ok(g.gpCashIn(h, 0) !== '' && g.combo === 50, 'cash-in: the second heal this stage costs more (60)');
g.combo = 300;
ring('bopper', 6, 3);
step(2);
g.combo = 300;
g.comboT = 10; // the heal's cash-in emptied the combo timer too
const bombDmg0 = h.damageBy.cashbomb ?? 0;
// Through the key (Z/X), inside the simulation step like a player's press.
h.play.cashSel = 1;
(g.input as any).pressed.add('KeyX');
for (let i = 0; i < 30 && g.combo > 0; i++) step(1);
ok(g.combo < 50 && (h.damageBy.cashbomb ?? 0) > bombDmg0, `cash-in: BOMB blasts around you (${Math.round(h.damageBy.cashbomb ?? 0)})`);
g.combo = 1000;
g.comboT = 10;
const coins0 = (() => { let n = 0; for (let i = 0; i < g.pickups.count; i++) if (g.pickups.type[i] === PickupType.Bolt) n++; return n; })();
g.gpCashIn(h, 2);
let coins1 = 0;
for (let i = 0; i < g.pickups.count; i++) if (g.pickups.type[i] === PickupType.Bolt) coins1++;
ok(coins1 - coins0 >= 10, `cash-in: GOLD RAIN drops coins (${coins1 - coins0})`);
(g.input as any).pressed.add('KeyX');
g.combo = 5000;
g.comboT = 10;
h.play.cashSel = 0;
step(1);
ok(g.combo === 0, 'cash-in: the X key cashes in the selected tier');
clear();

// Comeback.
h.revivesLeft = 0;
p.hp = 1;
step(12); // past any hit-stop: the live stats refresh in the simulation step
const dm1 = h.stats.damageMul;
ok(h.comeback && h.play.comeback, 'comeback: on at 1 life with no revives (hero.comeback)');
p.heal(p.maxHp);
step(12);
ok(!h.comeback && h.stats.damageMul < dm1 / 1.5, `comeback: off after healing (damage x${(dm1 / h.stats.damageMul).toFixed(2)} while on)`);

// Relics.
h.relics.push('r_dashfire', 'r_orbit', 'r_nova', 'r_keg', 'r_combo', 'r_adrenal');
h.recomputeStats();
g.onDash(h);
let ring1 = 0;
for (let i = 0; i < g.bullets.count; i++) if (g.bullets.kind[i] === GP.GP_KINDS.dashfire) ring1++;
ok(ring1 === GP.relicTuning.dashfireShots && h.play.dashFireT > 0, 'Trigger Dash: a ring of rounds and a fire-rate burst on dash');
step(40);
ok(h.play.sats.length > 0, `Satellite Rounds: rounds gather in orbit while firing (${h.play.sats.length})`);
ring('chonk', 4, 10);
step(90);
let orbit = 0;
for (let i = 0; i < g.bullets.count; i++) if (g.bullets.kind[i] === GP.GP_KINDS.orbit) orbit++;
ok(orbit > 0 || (h.damageBy.r_orbit ?? 0) > 0, 'Satellite Rounds: they launch');
clear();
const kills = ring('bopper', 12, 2);
step(2); // in the spatial hash
const nova0 = h.damageBy.r_nova ?? 0;
GP.relicTuning.kegChance = 1;
for (const e of kills.slice(0, 10)) if (e.active) g.killEnemy(e, 'buster', h);
ok(h.play.novaKills >= 10 && (h.damageBy.r_nova ?? 0) + (h.damageBy.r_keg ?? 0) > nova0, `Nova Heart / Powder Keg: kills set off blasts (${h.play.novaKills}, ${Math.round(h.damageBy.r_nova ?? 0)}, ${Math.round(h.damageBy.r_keg ?? 0)})`);
GP.relicTuning.kegChance = 0.2;
clear();
g.combo = 1500;
g.comboT = 10;
step(12);
ok(h.play.damageMul >= 1 + GP.relicTuning.comboPerTier * 7 - 1e-6, `Combo Engine: x8 multiplier = x${h.play.damageMul.toFixed(2)} damage`);
g.combo = 0;
p.hp = p.maxHp * 0.3;
step(12);
ok(h.play.cooldownMul < 1 && h.play.damageMul > 1, 'Adrenal Gland: faster and harder below half life');
p.heal(p.maxHp);
h.relics = [];
h.recomputeStats();

// Mech drops from kills.
GP.mechTuning.eliteChance = 1;
W.mechCd = 0;
const [el] = ring('bopper', 1, 4, { elite: true });
g.killEnemy(el, 'buster', h);
ok(W.drops.some((d) => d.kind === 'mech'), 'mech suit: drops from an elite');
GP.mechTuning.eliteChance = 0.04;
p.pos.x = W.drops[0].x;
p.pos.z = W.drops[0].z;
step(12); // past the elite kill's hit-stop
if (!(h.play.mechT > 0)) console.log('debug drop', JSON.stringify(W.drops), p.x, p.z, g.mode, h.play.mechT);
ok(h.play.mechT > 0, 'mech suit: walk into the drop to climb in');
h.play.mechT = 0.01;
step(3);
clear();

// Chain-reaction finale on stage clear.
ring('bopper', 25, 6);
const score0 = g.score;
g.stageClear();
ok(W.finale !== null && W.finale.length >= 25, `finale: ${W.finale?.length} detonations queued`);
step(Math.ceil((GP.finaleTuning.maxTime + 0.1) * 60));
if (W.finale) console.log('debug finale', W.finaleT, W.finaleN, W.finale.length, g.mode, g.modeT);
ok(W.finale === null && g.score > score0, 'finale: the chain plays out and pays a little score');
process.exit(process.exitCode ?? 0);
