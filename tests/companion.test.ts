/**
 * Companion lane: growing pets, the TEAM meter, team moves and high-five
 * revives. Pure logic first, then a host Game and a client Game wired
 * together in-process (jsdom, no WebGL) to check the host-authoritative
 * behaviour and that clients mirror it through the snapshot.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';
import { PETS, PET_BY_ID, PET_MAX_LEVEL, petRanks, petSkillAt, rankOf } from '../src/data/pets';
import { TeamMeter, TEAM_MOVES, teamTuning, linkedCount, segDist2, teamScale, moveTime } from '../src/game/teamMoves';

// ------------------------------------------------------------------ pure logic

for (const p of PETS) {
  if (p.id === 'none') continue;
  ok(p.tree.length === PET_MAX_LEVEL, `${p.id}: a skill for every level`);
  ok(p.tree.includes('revive'), `${p.id}: learns a revive`);
}
ok(PET_BY_ID.guardian.tree[0] === 'revive', 'Guardian still revives from level 1');
ok(PET_BY_ID.bit.tree[0] === 'fetch' && PET_BY_ID.sparky.tree[0] === 'zap', 'Bit fetches and Sparky zaps from level 1');
const sr = petRanks(PET_BY_ID.sparky, 5);
ok(sr.zap === 3 && sr.taunt === 1 && sr.revive === 1 && sr.fetch === 0, 'Sparky L5 ranks: zap 3, taunt 1, revive 1');
ok(petRanks(PET_BY_ID.bit, 1).fetch === 1 && petRanks(PET_BY_ID.bit, 99).fetch === 2, 'ranks clamp to the tree');
ok(petSkillAt(PET_BY_ID.bit, 4) === 'revive' && petSkillAt(PET_BY_ID.bit, 6) === null && petSkillAt(PET_BY_ID.none, 1) === null, 'skill learned per level');
ok(rankOf([1, 2, 3], 0) === 1 && rankOf([1, 2, 3], 9) === 3, 'rankOf clamps');

ok(linkedCount([0, 3], [0, 0], 2, 6) === 2 && linkedCount([0, 30], [0, 0], 2, 6) === 1, 'two heroes link within range');
ok(linkedCount([0, 5, 10, 40], [0, 0, 0, 0], 4, 6) === 3, 'a chain of three links, the far one does not');
ok(linkedCount([], [], 0, 6) === 0, 'no heroes, no link');
ok(Math.abs(segDist2(5, 2, 0, 0, 10, 0) - 4) < 1e-9 && Math.abs(segDist2(-3, 4, 0, 0, 10, 0) - 25) < 1e-9, 'point-segment distance');
ok(teamScale(2) === 1 && teamScale(4) > teamScale(3), 'moves scale with more heroes');

const m = new TeamMeter();
for (let i = 0; i < 60; i++) m.update(1 / 60, 2, true);
ok(m.charge === 0 && m.linkT > 0.9, 'no charge before the link time');
let filled = false;
for (let i = 0; i < 60 * 30 && !filled; i++) filled = m.update(1 / 60, 2, true);
ok(filled && m.ready, 'meter fills while linked in combat');
const t2 = (teamTuning.chargeTime + teamTuning.linkTime) * 60;
const m3 = new TeamMeter();
let n2 = 0;
let n3 = 0;
for (let i = 0; i < t2 * 2 && !m3.ready; i++, n3++) m3.update(1 / 60, 3, true);
const m2 = new TeamMeter();
for (let i = 0; i < t2 * 2 && !m2.ready; i++, n2++) m2.update(1 / 60, 2, true);
ok(n3 < n2, `three heroes charge faster (${n3} vs ${n2} steps)`);
const m0 = new TeamMeter();
for (let i = 0; i < 600; i++) m0.update(1 / 60, 2, false);
ok(m0.charge === 0, 'no charge out of combat');
m0.update(1 / 60, 1, true);
ok(m0.linkT === 0, 'splitting up resets the link');
ok(m.consume() === 'beam' && m.charge === 0 && m.next === 1, 'consume runs the next move and rotates');
m.charge = 1;
ok(m.consume() === 'nova', 'then Team Nova');
m.charge = 1;
ok(m.consume() === 'meteor' && m.next === 0, 'then Meteor Call, then back to the beam');
ok(m.add(0.5) === false && m.add(0.6) === true, 'high-five bonus can fill the meter');
ok(TEAM_MOVES.every((x) => moveTime(x.id) > 0.5), 'every move runs for a moment');

// ------------------------------------------------------------------ in-game, host + client

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
(globalThis as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'smoke';
(dom.window as any).Path2D = (globalThis as any).Path2D;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});
const errors: string[] = [];
process.on('uncaughtException', (e) => errors.push('uncaught ' + e.stack));

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { unlockedWeapons } = await import('../src/game/save');
const { ENEMIES } = await import('../src/data/enemies');
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const A = mk();
const B = mk();
const q: [any, any][] = [];
(A as any).role = 'host';
(A as any).host = { send: (_id: string, msg: any) => q.push([B, msg]), broadcast: (msg: any) => q.push([B, msg]), close() {} };
(B as any).role = 'client';
(B as any).client = { send: (msg: any) => q.push([A, msg]), close() {} };
const flush = () => {
  while (q.length) {
    const [g, msg] = q.shift()!;
    if (g === A) A.onHostMessage('peerB', structuredClone(msg));
    else B.onClientMessage(structuredClone(msg));
  }
};
cheats.god = false;
A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons(), '', 'classic', 'sparky'), A.makeHero(1, 'Guest', [], 'peerB', 'classic', 'bit')]);
A.startRun();
flush();
if (A.mode === 'shop') A.closeShop();
flush();
const step = (n: number) => {
  for (let i = 0; i < n; i++) {
    A.update(1 / 60);
    flush();
    B.update(1 / 60);
    flush();
  }
};
const [hA, gA] = A.heroes;
// Keep everyone alive and still: no level-up menus, no chasing hordes.
A.xpNext = 1e12;
const clearEnemies = () => {
  for (const e of A.enemies.list) if (e.active) A.enemies.kill(e);
};
const god = (on: boolean) => {
  for (const h of A.heroes) h.player.invuln = on ? 99 : 0;
};
step(5);
clearEnemies();
ok(B.heroes.length === 2 && B.heroes[0].pet === 'sparky' && B.heroes[1].pet === 'bit', 'client knows both pets');
ok(hA.petState.level === 1 && gA.petState.level === 1, 'pets start at level 1');
const magnet1 = gA.stats.magnet;

// Stage clear: pets level up, client mirrors it.
A.stageClear();
step(10);
ok(hA.petState.level === 2 && gA.petState.level === 2, 'pets level up on stage clear');
ok(hA.petState.ranks.taunt === 1 && gA.petState.ranks.zap === 1, 'Sparky learned Taunt, Bit learned Zap');
ok(B.heroes[0].petState.level === 2 && B.heroes[1].petState.level === 2 && B.heroes[1].petState.ranks.zap === 1, 'client mirrors pet levels and skills');
for (let i = 0; i < 3; i++) A.stageClear();
ok(gA.petState.level === 5 && gA.petState.ranks.fetch === 2 && gA.stats.magnet > magnet1, 'Bit at level 5: Fetch II widens pickup range');
A.stageClear();
ok(gA.petState.level === 5, 'level caps at 5');
// Back into the fight.
A.mode = 'fight';
A.modeT = 0;
A.director.bossSpawned = false;
A.boss = null;
step(5);
ok(B.heroes[1].petState.level === 5 && B.heroes[1].petState.reviveReady && B.heroes[1].petState.shieldReady, 'client sees revive and shield ready');

// Zap: Sparky (rank 2 now) hits nearby enemies; the zap counter reaches the client.
clearEnemies();
hA.player.teleport(0, 0);
gA.player.teleport(1.5, 0);
step(2);
god(true);
const zapsBefore = B.heroes[0].petState.zaps;
const foe = A.enemies.spawn(ENEMIES.chonk, 4, 0, { instant: true, hpMul: 1000 });
const hp0 = foe.hp;
step(100);
ok(foe.hp < hp0, 'pet zap damages an enemy');
ok(B.heroes[0].petState.zaps !== zapsBefore, 'zap counter mirrors to the client');

// Shield blocks one big hit; Revive gets the hero back up once.
god(false);
const sh = gA.petState;
ok(sh.shieldReady, 'Bit shield is up');
gA.player.invuln = 0;
const hpBefore = gA.player.hp;
A.hurtHero(gA, gA.player.maxHp * 0.3, gA.player.x + 1, gA.player.z);
ok(gA.player.hp === hpBefore && !sh.shieldReady, 'shield blocks a big hit and is spent');
step(3);
ok(!B.heroes[1].petState.shieldReady, 'client sees the shield spent');
gA.revivesLeft = 0;
gA.phoenixUsed = true;
for (let k = 0; k < 5 && !sh.reviveUsed; k++) {
  gA.player.invuln = 0;
  gA.player.hp = 1;
  A.hurtHero(gA, 999, gA.player.x + 1, gA.player.z);
}
ok(sh.reviveUsed && !gA.player.dead && gA.player.hp > gA.player.maxHp * 0.5, 'pet revive brings the guest back once');
step(3);
ok(B.heroes[1].petState.reviveUsed && !B.heroes[1].player.dead, 'client sees the revive');

// TEAM meter: two heroes together near enemies charge it.
clearEnemies();
god(true);
const cs = A.companionState();
cs.meter.reset();
hA.player.teleport(0, 0);
gA.player.teleport(2, 0);
B.hero.player.teleport(2, 0);
for (let i = 0; i < 6; i++) A.enemies.spawn(ENEMIES.chonk, 9 + i * 0.5, 4, { instant: true, hpMul: 1000 });
for (const e of A.enemies.list) if (e.active) e.speedMul = 0;
step(60 * 4);
ok(cs.meter.linked === 2 && cs.meter.charge > 0, `meter charges with two heroes close in combat (${cs.meter.charge.toFixed(2)})`);
ok(Math.abs(B.companionState().meter.charge - cs.meter.charge) < 0.1, 'client mirrors the meter');
// Split up: charging stops.
gA.player.teleport(30, 30);
B.hero.player.teleport(30, 30);
step(30);
const held = cs.meter.charge;
step(60);
ok(cs.meter.linked === 1 && cs.meter.charge === held, 'apart, the meter holds');

// Fire: the guest presses the team button (message to the host).
gA.player.teleport(2, 0);
B.hero.player.teleport(2, 0);
step(10);
cs.meter.charge = 1;
step(2);
const before = A.enemies.list.filter((e) => e.active).reduce((a, e) => a + e.hp, 0);
B.client!.send({ t: 'team' });
flush();
ok(!!cs.move && cs.move.id === 'beam' && cs.meter.charge === 0 && cs.move.by === 1, 'the guest fires Unity Beam through the host');
// The beams meet where the guest aims; aim them at the crowd (headless aim is arbitrary).
if (cs.move) {
  cs.move.x = 10;
  cs.move.z = 4;
}
step(3);
ok(B.companionState().move?.id === 'beam', 'client mirrors the running move');
step(90);
const after = A.enemies.list.filter((e) => e.active).reduce((a, e) => a + e.hp, 0);
ok(after < before, 'team move damages enemies');
ok(!cs.move, 'move ends');
// Nova and Meteor run too.
for (const id of ['nova', 'meteor']) {
  cs.meter.charge = 1;
  A.tryTeamMove(hA);
  ok(cs.move?.id === id, `${id} fires next`);
  step(60 * 3);
  ok(!cs.move, `${id} ends`);
}
// Alone: no move.
gA.player.teleport(40, 40);
B.hero.player.teleport(40, 40);
step(5);
cs.meter.charge = 1;
ok(!A.tryTeamMove(hA) && cs.meter.charge === 1, 'no team move without a teammate close');

// High-five revive: the host revives the downed guest, both heal, the meter gets a bonus.
clearEnemies();
god(false);
cs.meter.charge = 0;
gA.player.teleport(1, 0);
B.hero.player.teleport(1, 0);
hA.player.teleport(0, 0);
step(10);
gA.revivesLeft = 0;
for (let k = 0; k < 5 && !gA.player.dead; k++) {
  gA.player.invuln = 0;
  gA.player.hp = 1;
  A.hurtHero(gA, 999, gA.player.x + 1, gA.player.z);
}
ok(gA.player.dead, 'guest is down (pet revive already spent)');
hA.player.hp = hA.player.maxHp * 0.5;
const hostHp = hA.player.hp;
step(60 * 4);
ok(!gA.player.dead, 'teammate revives the guest');
ok(hA.player.hp > hostHp, 'high-five heals the rescuer');
ok(cs.meter.charge >= teamTuning.highFiveBonus - 0.01, 'high-five adds to the TEAM meter');

// Solo: no team meter.
const S = mk();
S.setHeroes([S.makeHero(0, 'Solo', unlockedWeapons(), '', 'classic', 'guardian')]);
S.startRun();
if (S.mode === 'shop') S.closeShop();
for (let i = 0; i < 30; i++) S.update(1 / 60);
ok(S.companionState().meter.linked === 0 && !S.tryTeamMove(S.hero), 'solo: no team meter or moves');
ok(S.hero.petState.reviveReady, 'solo Guardian has its revive from the start');

// Fetch: Bit pulls gems from beyond the magnet's reach.
const F = mk();
F.setHeroes([F.makeHero(0, 'Fetch', unlockedWeapons(), '', 'classic', 'bit')]);
F.startRun();
if (F.mode === 'shop') F.closeShop();
F.xpNext = 1e12;
for (const e of F.enemies.list) if (e.active) F.enemies.kill(e);
const fp = F.hero.player;
fp.teleport(0, 0);
const { PickupType } = await import('../src/game/pickups');
F.pickups.clear();
for (let i = 0; i < 4; i++) F.pickups.spawn(PickupType.Gem, Math.cos(i) * 8, Math.sin(i) * 8, 1);
ok(F.hero.stats.magnet * 3.2 < 7, 'gems start beyond the magnet range');
for (let i = 0; i < 60 * 4; i++) {
  for (const e of F.enemies.list) if (e.active) F.enemies.kill(e);
  F.update(1 / 60);
}
ok(F.pickups.count === 0 && F.hero.petState.fetches > 0, `Bit fetched the far gems (${F.pickups.count} left)`);

ok(errors.length === 0, 'no runtime errors' + (errors.length ? ':\n' + errors.slice(0, 3).join('\n') : ''));
process.exit(process.exitCode ?? 0);
