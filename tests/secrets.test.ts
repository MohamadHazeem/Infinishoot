/** Secret room input, once-only rewards, save compatibility and real snapshot integration. */
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

const D = await import('../src/data/secrets');
const S = await import('../src/game/systems/secrets');
const { ENEMIES, BOSS_ORDER } = await import('../src/data/enemies');
const { CODEX, rewardAvailable } = await import('../src/data/codex');
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { save, normalize, unlockedWeapons } = await import('../src/game/save');
const { settings } = await import('../src/game/settings');
const { nightTuning } = await import('../src/render/biomeLook');
const { RELIC_BY_ID } = await import('../src/data/relics');
const { rushRoster } = await import('../src/game/systems/gauntlet');
const { updateFamily } = await import('../src/game/systems/enemyFamilies');

let count = 0, deterministic = true;
const kinds = new Set<string>();
for (let seed = 0; seed < 1000; seed++) {
  const a = D.secretPlan(seed, 2);
  deterministic &&= a === D.secretPlan(seed, 2);
  if (a) { count++; kinds.add(a); }
}
ok(deterministic, 'deterministic secret rolls');
ok(count > 300 && count < 460 && kinds.size === 4, '38% room roll covers all four puzzles');
ok(D.secretSequence(0, 0) === 1 && D.secretSequence(1, 2) === 2 && D.secretSequence(2, 1) === 3, 'left right middle opens the relay');
ok(D.secretSequence(2, 2) === 0 && D.secretSequence(2, 0) === 1, 'wrong order resets, first plate restarts');
ok(D.secretBeat(0) && D.secretBeat(0.75) && !D.secretBeat(0.375) && D.secretBeat(-0.01), 'beat windows wrap and reject off-beat shots');
ok(D.KONAMI.reduce((n, k) => D.konamiStep(n, k), 0) === 10 && D.konamiStep(5, 'KeyX') === 0, 'full cosmetic code and wrong-input reset');
ok(!rushRoster().some(d => d.secret), 'Boss Rush cannot reveal discovery-only bosses');
ok(D.SECRET_BOSSES.every(id => ENEMIES[id].boss && ENEMIES[id].minMinute === -1 && !BOSS_ORDER.includes(id)), 'hidden bosses never enter ordinary rotation');
ok(D.SECRET_BOSSES.every(id => CODEX.some(c => c.id === `enemy:${id}` && c.kind === 'SECRET')), 'both bosses have SECRET codex entries');
ok(rewardAvailable('secret_skin', { achievements: ['secret_code'], bestHeat: {}, weekly: [] }), 'old code unlocks cosmetic only');
const migrated = normalize({ version: 4, achievements: ['secret_room'], meta: { rewards: ['secret_skin'], codex: ['secret:relay'] } });
ok(migrated.achievements.includes('secret_room') && migrated.meta.rewards.includes('secret_skin') && migrated.meta.codex.includes('secret:relay'), 'existing extensible save fields preserve discoveries without a format change');

cheats.god = true; settings.bossIntros = false; settings.finishers = false;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const A = mk(), B = mk();
const queue: [any, any][] = [];
(A as any).role = 'host';
(A as any).host = { send: (_id: string, m: any) => queue.push([B, m]), broadcast: (m: any) => queue.push([B, m]), close() {} };
(B as any).role = 'client';
(B as any).client = { send: (m: any) => queue.push([A, m]), close() {} };
const flush = () => { while (queue.length) { const [g, m] = queue.shift()!; if (g === A) A.onHostMessage('peerB', structuredClone(m)); else B.onClientMessage(structuredClone(m)); } };
A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons()), A.makeHero(1, 'Guest', [], 'peerB')]);
A.seed = 42; A.startRun(); flush(); if (A.mode === 'shop') A.closeShop(); flush();
A.xpNext = B.xpNext = 1e12;
function step(n = 1) { for (let i = 0; i < n; i++) { A.update(1 / 60); flush(); B.update(1 / 60); flush(); } }
function room(kind: string) {
  S.clearSecrets(A);
  S.secretsLinks(A, new URLSearchParams(`secret=${kind}`));
  const r = S.secretsState(A).room;
  if (!r) throw new Error('No walkable secret footprint for QA');
  A.heroes[1].player.teleport(r.x + 15, r.z + 15);
  return r;
}
function fire(x: number, z: number, dt = 0.01, hero = A.hero) {
  const p = hero.player, len = Math.hypot(x - p.x, z - p.z);
  p.aim.x = (x - p.x) / len; p.aim.z = (z - p.z) / len;
  hero.ctx.firing = true; S.secretsState(A).cooldown[hero.index] = 0;
  S.updateSecrets(A, dt); hero.ctx.firing = false;
}
let r = room('plates');
r.open = false;
fire(r.x, r.z + 4);
ok(r.open, 'host-accepted aimed fire reveals cracked relay');
A.hero.player.teleport(r.x - 3, r.z);
S.updateSecrets(A, 0.01); S.updateSecrets(A, 0.01);
ok(r.progress === 1, 'standing on a plate advances only on entry');
A.hero.player.teleport(r.x + 3, r.z); S.updateSecrets(A, 0.01);
A.hero.player.teleport(r.x, r.z); S.updateSecrets(A, 0.01);
ok(r.done && A.heroes.every(h => h.relics.some(id => ['rare', 'legendary'].includes(RELIC_BY_ID[id].rarity))), 'ordered plates award a rare-or-better relic to every teammate');
const rewards = A.heroes.map(h => h.relics.length);
S.updateSecrets(A, 1); S.updateSecrets(A, 1);
ok(A.heroes.every((h, i) => h.relics.length === rewards[i]), 'finished rooms cannot pay twice');
step(10);
ok(S.secretsState(B).room?.done && B.hero.relics.length === A.heroes[1].relics.length, 'binary host snapshot carries completion and each hero relic');
ok(save.achievements.includes('secret_room') && save.meta.rewards.includes('secret_skin'), 'room achievement and cosmetic are banked');
A.hero.player.teleport(r.x, r.z - 4); S.updateSecrets(A, 0.01);
ok(save.meta.codex.includes('secret:developers'), 'developer terminal unlocks its lore');

r = room('runes');
A.hero.player.teleport(r.x, r.z + 5);
r.clock = 0.375; fire(r.x - 3, r.z);
ok(r.progress === 0, 'off-beat rune shots cannot advance');
for (const j of [0, 2]) { r.clock = 0; fire(r.x + (j - 1) * 3, r.z); }
const mate = A.heroes[1]; mate.player.teleport(r.x, r.z + 5);
mate.player.aim.x = -3 / Math.hypot(3, 5); mate.player.aim.z = -5 / Math.hypot(3, 5);
mate.ctx.firing = true; S.secretsState(A).cooldown[1] = 0;
r.clock = 0; fire(r.x, r.z); mate.ctx.firing = false;
ok(r.done, 'final rune succeeds even if a teammate shoots a wrong rune in the same step');

r = room('braziers'); A.hero.player.teleport(r.x, r.z + 5);
fire(r.x - 3, r.z); ok(r.mask === 0, 'ordinary shots need elemental attunement');
A.hero.player.teleport(r.x - 4, r.z + 3); S.updateSecrets(A, 1.6);
A.hero.player.teleport(r.x, r.z + 5);
for (let j = 0; j < 3; j++) fire(r.x + (j - 1) * 3, r.z);
ok(r.done, 'free relay pad makes fire puzzle solvable by the starter loadout');

r = room('ice'); A.hero.player.teleport(r.x, r.z + 5); S.updateSecrets(A, 0.01);
S.applySecretsNet(B, structuredClone(S.secretsNet(A)));
ok(A.walls.hitCircle(r.x, r.z, 0.4) && B.walls.hitCircle(r.x, r.z, 0.4), 'unfrozen water blocks movement on host and client');
A.hero.player.teleport(r.x - 4, r.z + 3); S.updateSecrets(A, 1.6);
A.hero.player.teleport(r.x, r.z + 5); fire(r.x, r.z + 1.5);
S.applySecretsNet(B, structuredClone(S.secretsNet(A)));
ok(r.ice > 0 && !A.walls.hitCircle(r.x, r.z, 0.4) && !B.walls.hitCircle(r.x, r.z, 0.4), 'freezing opens the bridge on both machines');
A.hero.player.teleport(r.x, r.z); r.ice = 0.01; S.updateSecrets(A, 0.02);
S.applySecretsNet(B, structuredClone(S.secretsNet(A)));
ok(!A.walls.hitCircle(r.x, r.z, 0.4) && !B.walls.hitCircle(r.x, r.z, 0.4), 'expiring ice never encloses a crossing hero on either machine');
r.ice = 3;
A.hero.player.teleport(r.x, r.z - 3); S.updateSecrets(A, 0.01);
ok(r.done, 'crossing frozen water claims reward');
S.clearSecrets(A); S.clearSecrets(B);
ok(!A.walls.hitCircle(r.x, r.z, 0.4) && !B.walls.hitCircle(r.x, r.z, 0.4), 'stage cleanup removes lane-owned colliders');

r = room('plates');
const s = S.secretsState(A);
s.bugs = 2; A.hero.player.teleport(r.x + 6, r.z + 7); fire(r.x + 6, r.z + 3);
ok(!A.boss, 'two Goldbugs cannot awaken the king');
const bug = A.enemies.spawn(ENEMIES.golden, r.x, r.z, { instant: true });
A.killEnemy(bug, 'buster', A.hero);
ok(s.bugs === 3, 'actual Goldbug kill counts toward the run gate');
fire(r.x + 6, r.z + 3);
ok(A.boss?.def.id === 'golden_king' && S.secretsHolding(A), 'third Goldbug and statue fire awaken secret boss');
const clock = A.director.time;
step(8);
ok(A.boss?.def.id === 'golden_king' && B.netBoss?.name === 'Golden King' && A.director.time === clock, 'secret boss mirrors while normal director clock waits');
A.killEnemy(A.boss!, 'buster', A.hero); step(3);
ok(!A.boss && A.mode === 'fight' && save.achievements.includes('secret_golden'), 'Golden King reward does not prematurely clear the stage');
fire(r.x + 6, r.z + 3); ok(!A.boss, 'Golden King is once per run');

nightTuning.every = 1;
s.stageTime = A.director.duration;
A.enemies.clear(); A.director.bossSpawned = true; A.damagedThisStage = false;
A.boss = A.enemies.spawn(ENEMIES.king, A.hero.player.x + 9, A.hero.player.z, { instant: true });
A.killEnemy(A.boss, 'buster', A.hero); S.updateSecrets(A, 0.01);
ok(A.boss?.def.id === 'shadow_hero', 'flawless night stage boss kill starts reflection encore');
const shadow = A.boss!;
shadow.roarT = 0.5;
updateFamily(shadow, 0.6, A.enemyCtx, 1, 0, 8, 3);
ok(shadow.roarT === 0, 'mirror boss entrance/phase immunity expires');
const copyIds = [];
for (let i = 0; i <= A.hero.weapons.length; i++) copyIds.push(S.shadowWeapon(shadow, A.hero)?.def.id);
ok(copyIds.length === A.hero.weapons.length + 1 && copyIds.every(Boolean), 'reflection cycles every held weapon and the special with capped enemy patterns');
step(12); ok(B.netBoss?.name === 'Shadow Hero', 'reflection is mirrored as a real boss');
settings.finishers = true;
A.killEnemy(shadow, 'buster', A.hero);
ok(shadow.active && A.finisherHold(0.01), 'secret boss killing blow plays the shared finisher first');
A.finisherHold(4);
for (let i = 0; i < 600 && A.mode === 'fight'; i++) step();
settings.finishers = false;
ok(A.mode === 'cleared' && save.achievements.includes('secret_shadow'), `reflection defeat awards achievement then allows stage clear (${A.mode})`);
S.resetSecrets(A);
ok(S.secretsState(A).bugs === 0 && S.secretsState(A).bosses === 0 && S.secretsState(A).receipts === 0, 'new run resets all run-only secrets');
A.loadStage(1); flush(); S.updateSecrets(A, 0.01);
const gates = S.secretsState(A);
A.boss = A.enemies.spawn(ENEMIES.king, 9, 0, { instant: true });
A.killEnemy(A.boss, 'buster', A.hero);
ok(!gates.pendingShadow, 'skipping directly to a night boss is not a full flawless stage');
gates.stageTime = A.director.duration; A.damagedThisStage = true;
A.boss = A.enemies.spawn(ENEMIES.king, 9, 0, { instant: true });
A.killEnemy(A.boss, 'buster', A.hero);
ok(!gates.pendingShadow, 'a damaged night stage cannot summon the reflection');
A.mode = 'title'; S.renderSecrets(A);
const beforeCode = A.hero.weapons.length;
for (const code of D.KONAMI) window.dispatchEvent(new KeyboardEvent('keydown', { code }));
ok(save.achievements.includes('secret_code') && A.hero.weapons.length === beforeCode, 'title keyboard sequence unlocks its cosmetic without changing the build');
console.log('Secret discoveries, rewards, bosses and co-op snapshots passed.');
process.exit(process.exitCode ?? 0);
