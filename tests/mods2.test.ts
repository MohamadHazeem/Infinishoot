/** Mods2: real pipeline, event bridges, shop gating and host/client snapshots. */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const noop: any = new Proxy(function () {}, {
  get: (_t, k) =>
    k === 'data'
      ? new Uint8ClampedArray(4 * 64 * 64)
      : k === Symbol.toPrimitive
        ? () => 0
        : k === 'measureText'
          ? () => ({ width: 10 })
          : noop,
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, {
    get: (_t, k) =>
      k === 'createImageData' || k === 'getImageData'
        ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) })
        : k === 'canvas'
          ? this
          : noop[k as never],
  });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
for (const k of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'HTMLElement',
  'HTMLCanvasElement',
  'HTMLInputElement',
  'Event',
  'KeyboardEvent',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'innerWidth',
  'innerHeight',
  'addEventListener',
  'dispatchEvent',
  'Node',
  'MouseEvent',
  'PointerEvent',
]) {
  try {
    (globalThis as any)[k] = (dom.window as any)[k];
  } catch {
    Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true });
  }
}
(globalThis as any).Path2D = class {
  constructor(_d?: string) {}
};
(globalThis as any).__APP_VERSION__ = 'smoke';
(dom.window as any).Path2D = (globalThis as any).Path2D;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});
const errors: string[] = [];
process.on('uncaughtException', (e) => {
  console.error(e);
  process.exit(1);
});

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { unlockedWeapons } = await import('../src/game/save');
cheats.god = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
// The client's menus get their own root, so the two Screens don't share element ids.
const hudB = document.createElement('div');
document.body.appendChild(hudB);
const A = new Game(
  new Input(canvas),
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
const B = new Game(new Input(canvas), 16 / 9, hudB, document.createElement('div'));
const sent: any[] = [];
const q: [any, any][] = [];
(A as any).role = 'host';
(A as any).host = {
  send: (_id: string, m: any) => q.push([B, m]),
  broadcast: (m: any) => q.push([B, m]),
  close() {},
};
(B as any).role = 'client';
(B as any).client = { send: (m: any) => (sent.push(m), q.push([A, m])), close() {} };
const flush = () => {
  while (q.length) {
    const [g, m] = q.shift()!;
    if (g === A) A.onHostMessage('peerB', structuredClone(m));
    else B.onClientMessage(structuredClone(m));
  }
};
A.setHeroes([
  A.makeHero(0, 'Host', unlockedWeapons()),
  A.makeHero(1, 'Guest', unlockedWeapons(), 'peerB'),
]);
A.startRun();
flush();
if (A.mode === 'shop') A.closeShop();
flush();
const guest = A.heroes[1];

const { MODS2, MOD_BY_ID } = await import('../src/data/mods');
const { modDesc, modMaxLevel } = await import('../src/game/modTypes');
const { previewRows, heroBuild, rowValue } = await import('../src/game/shopPreview');
const { ICON_ART } = await import('../src/data/iconArt');
const { ENEMIES } = await import('../src/data/enemies');
const { createWeapon } = await import('../src/game/weapons');
const { endMech, startMech } = await import('../src/game/systems/gameplay');
const { Team } = await import('../src/game/bullets');
const near = (a: number, b: number) => Math.abs(a - b) < 0.001;
const h = A.hero;
const e = A.enemies.spawn(
  ENEMIES.chonk,
  h.player.x + 2,
  h.player.z,
  A.spawnOpts({ instant: true }),
);
e.hp = e.maxHp = 100000;
const ev = { e, source: 'buster', tags: [] as any[], dist: 5, crit: false };
function equip(hero: typeof h, ids: string[], lv = 1) {
  hero.synergy.reset();
  for (const id of ids) {
    hero.synergy.add(MOD_BY_ID[id]);
    for (let i = 1; i < lv; i++) hero.synergy.upgrade(hero.synergy.slots.length - 1);
  }
  hero.recomputeStats();
}
function hit(amount = 10) {
  return h.synergy.damage(ev, amount);
}
ok(
  MODS2.length === 18 && MODS2.filter((d) => d.coop).length === 6,
  '12 solo-family Mods and 6 ally Mods',
);
const art = new Set<string>();
for (const def of MODS2) {
  const icon = JSON.stringify(ICON_ART[def.id]);
  ok(
    !!icon &&
      !art.has(icon) &&
      Object.entries(ICON_ART).every(([id, paths]) => id === def.id || JSON.stringify(paths) !== icon),
    `${def.id}: unique icon`,
  );
  art.add(icon);
  ok(modDesc(def, 1) !== modDesc(def, modMaxLevel(def)), `${def.id}: level-scaled description`);
}
// Every damage preview equals the real ordered pipeline at multiple input sizes.
for (const def of MODS2) {
  equip(h, ['echo', def.id], 2);
  h.synergy.time = 20;
  const c = def.preview;
  const before = JSON.stringify(h.synergy.slots);
  const rows = previewRows(h.synergy.slots, heroBuild(h, 0.2));
  ok(JSON.stringify(h.synergy.slots) === before, `${def.id}: preview never mutates state`);
  h.synergy.nearWall = !!c?.nearWall;
  h.synergy.ownFire = !!c?.ownFire;
  if (c?.event) h.synergy.event(c.event);
  const row = rows.find((r) => r.k === (c?.label ?? 'all'))!;
  const input = { ...ev, tags: c?.tags ?? [], dist: c?.dist ?? 5 };
  for (const amount of [0, 10, 100])
    ok(
      near(row.m * amount + row.a, h.synergy.damage(input, amount)),
      `${def.id}: preview at ${amount}`,
    );
}
equip(h, ['blood_primer', 'last_word']);
const first = hit();
h.synergy.move(0, 1);
ok(near(first, 13.75) && near(hit(), 13), 'primer before multiplier is stronger (13.75 vs 13)');
ok(
  rowValue({ k: 'all', m: 1.25, a: -2.5 }).includes('−2.5'),
  'negative pipeline offsets shown in preview',
);
equip(h, ['echo', 'riposte_cell'], 2);
h.synergy.time = 10;
h.synergy.event('parry');
ok(
  hit() === 22 && h.synergy.slots[1].st.t === 12,
  'Echo + level 2 gives +12 but a single 2s window',
);
h.synergy.tick(1);
ok(hit() === 22, 'window does not tick once per Echo/level');
h.synergy.tick(1);
ok(hit() === 10, 'window expires exactly');
// Current active windows are preserved in ordinary shop rows.
h.synergy.event('parry');
ok(
  previewRows(h.synergy.slots, heroBuild(h, 0.2))[0].a === 12,
  'shop shows currently active trigger damage',
);
equip(h, ['riposte_cell', 'cash_capacitor']);
h.synergy.event('parry');
const stackedPreview = previewRows(h.synergy.slots, heroBuild(h, 0.2));
ok(stackedPreview.find(r => r.k === 'AFTER CASH-IN')?.a === 6, 'conditional preview preserves another active trigger window');
// New event hooks aggregate Echo/levels once, including cooldown-limited novas.
equip(h, ['echo', 'counterchorus'], 2);
const originalBlast = h.blast;
let blasts = 0, novaDamage = 0;
h.blast = (_x, _z, _r, damage) => { blasts++; novaDamage += damage; };
h.synergy.event('allyParry'); h.synergy.event('allyParry');
ok(blasts === 1 && novaDamage === 80, 'Echo + level 2 nova: one effect, four copies of damage, one cooldown');
h.blast = originalBlast;
// Real event call sites, including failed actions.
equip(h, ['riposte_cell', 'slipstream', 'encore', 'cash_capacitor', 'ejection_seat']);
h.skill.dashPerfect = false;
A.perfectDash(h);
ok(h.synergy.slots[1].st.t > h.synergy.time, 'perfect dash bridge');
h.skill.ult = 0;
A.tryUlt(h);
ok(h.synergy.slots[2].st.t === 0, 'unready ultimate does not trigger');
h.skill.ult = 1;
A.tryUlt(h);
ok(h.synergy.slots[2].st.t > h.synergy.time, 'ultimate bridge');
A.combo = 0;
A.gpCashIn(h, 0);
ok(h.synergy.slots[3].st.t === 0, 'failed cash-in does not trigger');
A.combo = 100;
A.gpCashIn(h, 0);
ok(h.synergy.slots[3].st.t > h.synergy.time, 'cash-in bridge');
startMech(A, h);
endMech(A, h, true);
ok(h.synergy.slots[4].st.t > h.synergy.time, 'survived mech ejection bridge');
// A real bullet parry, once per successful swing.
h.skill.parryCd = 0;
h.skill.parryT = 0;
A.bullets.spawn({
  x: h.player.x + 0.5,
  z: h.player.z,
  dirX: -1,
  dirZ: 0,
  speed: 1,
  life: 2,
  radius: 0.2,
  damage: 1,
  knockback: 0,
  team: Team.Enemy,
  color: '#ff3df0',
  width: 0.3,
  length: 0.3,
});
A.tryParry(h);
ok(h.synergy.slots[0].st.t > h.synergy.time, 'successful parry bridge');
// Own fire is a live patch query, not a tag-ownership approximation.
equip(h, ['hearth']);
const fire = createWeapon('fire', A.scene) as any;
h.weapons.push(fire);
A.mods2Position(h);
ok(!h.synergy.ownFire, 'no fire coverage before a patch exists');
fire.drop(h.player.x, h.player.z, 3, 1);
A.mods2Position(h);
ok(h.synergy.ownFire, 'own flame grants Hearth');
h.player.pos.x += 3;
A.mods2Position(h);
ok(!h.synergy.ownFire, 'leaving flame removes Hearth');
h.player.pos.x -= 3;
const { StaticBoxGrid } = await import('../src/core/spatialHash');
const originalWalls = A.walls;
A.walls = new StaticBoxGrid([{ minX: h.player.x + 1.5, maxX: h.player.x + 2.5, minZ: h.player.z - 1, maxZ: h.player.z + 1 }]);
equip(h, ['wallflower']);
A.mods2Position(h); ok(h.synergy.nearWall, 'cover within 2m grants Wallflower');
h.player.pos.x -= 5; A.mods2Position(h); ok(!h.synergy.nearWall, 'moving away from cover removes Wallflower');
h.player.pos.x += 5;
A.walls = new StaticBoxGrid([{ minX: h.player.x + 1.5, maxX: h.player.x + 2.5, minZ: h.player.z - 1, maxZ: h.player.z + 1, gap: true }]);
A.mods2Position(h); ok(!h.synergy.nearWall, 'an empty gap is not solid cover');
A.walls = originalWalls;
// Chest damage routes through the game and effects bus; reopening cannot retrigger.
equip(h, ['jack_in_box']);
e.x = h.player.x + 2;
e.z = h.player.z;
e.hp = 100000;
e.active = true;
e.state = 'move';
e.under = false;
e.roarT = 0;
A.hash.clear();
A.hash.insert(e, e.x, e.z, e.radius);
A.chests.add(h.player.x, h.player.z, 0);
const ci = A.chests.list.length - 1;
const damage0 = h.damageBy.jack_in_box ?? 0;
A.openChest(ci, h);
ok((h.damageBy.jack_in_box ?? 0) > damage0, 'map chest nova damages nearby enemies');
const damage1 = h.damageBy.jack_in_box;
A.openChest(ci, h);
ok(h.damageBy.jack_in_box === damage1, 'opened chest never pays nova twice');
// Ally gating including locked offers after a teammate leaves.
for (let n = 0; n < 40; n++) {
  guest.left = true;
  h.rollShop();
  ok(
    h.shopOffers.every((d) => !d?.coop),
    'solo roll excludes ally Mods',
  );
}
guest.left = false;
h.shopOffers = [MOD_BY_ID.pit_crew];
h.shopLocked = [true];
h.rollShop();
ok(h.shopOffers[0]?.id === 'pit_crew', 'co-op lock keeps ally Mod');
guest.left = true;
h.rollShop();
ok(
  h.shopOffers.every((d) => !d?.coop),
  'locked ally offer removed after teammate leaves',
);
guest.left = false;
Object.assign(guest.player.pos, h.player.pos);
equip(h, ['pit_crew', 'signal_flare', 'blood_bond'], 2);
equip(guest, ['counterchorus', 'wing_guard', 'standing_ovation'], 2);
h.refreshLive();
guest.refreshLive();
const cd = guest.stats.cooldownMul;
const chargeRate = guest.stats.chargeSpeed;
A.mods2Auras(guest);
A.mods2Auras(h);
ok(near(guest.stats.cooldownMul, cd / 1.24), 'Pit Crew helps other ally at +24% speed');
ok(near(guest.stats.chargeSpeed, chargeRate * 1.24), 'Pit Crew also accelerates the Charge Shot hold meter');
ok(
  near(h.stats.cooldownMul, h.statBase.cooldownMul * A.fireRateBuff),
  'Pit Crew never buffs its owner',
);
e.burnT = 3;
e.burnOwner = h.index;
ok(
  near(A.mods2Crit(e, guest), 0.3) && A.mods2Crit(e, h) === 0,
  'Signal Flare adds crit chance only to ally hits',
);
h.player.hp = 50;
guest.player.hp = 50;
A.mods2Heal(h, 10);
ok(near(guest.player.hp, 52), 'Blood Bond shares actual heal at 20%');
A.mods2Heal(h, 0);
ok(near(guest.player.hp, 52), 'no overheal sharing');
guest.player.invuln = 0;
A.mods2Event(h, 'perfectDash');
ok(near(guest.player.invuln, 0.3), 'Wing Guard grants capped i-frames');
guest.player.invuln = 0;
A.mods2Event(h, 'perfectDash');
ok(guest.player.invuln === 0, 'Wing Guard has a real cooldown');
A.mods2Event(h, 'ultimate');
ok(near(guest.synergy.damage(ev, 10), 12), 'Standing Ovation activates for a teammate ultimate');
const old = guest.damageBy.counterchorus ?? 0;
A.mods2Event(h, 'parry');
ok((guest.damageBy.counterchorus ?? 0) > old, 'Counterchorus nova is credited to its owner');
const damage2 = guest.damageBy.counterchorus;
A.mods2Event(h, 'parry');
ok(guest.damageBy.counterchorus === damage2, 'Counterchorus cooldown prevents parry spam');
guest.player.pos.x += 20;
guest.player.hp = 50;
A.mods2Heal(h, 10);
guest.refreshLive();
const farCd = guest.stats.cooldownMul;
A.mods2Auras(guest);
ok(
  guest.player.hp === 50 && guest.stats.cooldownMul === farCd,
  'out-of-range allies receive neither heal nor reload',
);
Object.assign(guest.player.pos, h.player.pos);
// Opponents in a PvP duel must never receive ally auras.
(A as any).pvp = { phase: 'duel' };
guest.refreshLive(); const duelCd = guest.stats.cooldownMul;
A.mods2Auras(guest);
ok(guest.stats.cooldownMul === duelCd && A.mods2Crit(e, guest) === 0, 'ally Mods are off in PvP duels');
(A as any).pvp = null;
// Readouts, healing and invulnerability travel through the real compact snapshot.
guest.player.invuln = 0.3;
B.onClientMessage(structuredClone(A.buildSnapshot(guest, A.vfx.drain())));
ok(B.hero.player.hp === Math.ceil(guest.player.hp), 'client mirrors shared healing');
ok(B.hero.player.invuln >= 0.3, 'client mirrors Wing Guard invulnerability');
ok(
  B.netMods.some((m: any) => m.id === 'standing_ovation' && m.ro === '6.0s'),
  'client receives active trigger readout',
);
const beforeHp = B.hero.player.hp;
B.mods2Heal(B.hero, 10);
B.mods2Event(B.hero, 'ultimate');
ok(B.hero.player.hp === beforeHp, 'client does not simulate ally effects');
// A completed real rewind activates Second Hand after the full timeline restore.
const { timeState } = await import('../src/game/systems/time');
A.role = 'solo';
A.host = null;
guest.left = true;
A.startSolo();
if (A.mode === 'shop') A.closeShop();
A.xpNext = 1e9;
equip(A.hero, ['second_hand']);
for (let i = 0; i < 400; i++) A.update(1 / 60);
A.requestRewind(A.hero);
ok(timeState(A).hold?.kind === 'rewind', 'real rewind starts');
for (let i = 0; i < 120 && timeState(A).hold; i++) A.update(1 / 60);
ok(
  timeState(A).rewindsUsed === 1 && A.hero.synergy.slots[0].st.t > A.hero.synergy.time,
  'Second Hand starts after full rewind restore',
);
ok(errors.length === 0, 'no asynchronous runtime errors');
process.exit(process.exitCode ?? 0);
