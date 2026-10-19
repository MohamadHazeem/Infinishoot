/** Elite logic, real combat hooks, snapshots, rewind and deterministic bot balance. */
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

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { Enemy } = await import('../src/game/enemies');
const { ENEMIES } = await import('../src/data/enemies');
const { ELITE_MODS, ELITE_MOD_IDS, pickEliteMod, championRoll, berserkBonus, CHAMPION_CHEST, elites2Tuning: T } = await import('../src/data/eliteMods');
const E2 = await import('../src/game/systems/elites2');
const { packEnemies, unpackEnemies } = await import('../src/net/codec');
const { SnapEncoder, SnapDecoder } = await import('../src/net/snapCodec');
const { Rng } = await import('../src/core/rng');
const { setLanguage, localize } = await import('../src/i18n');
const { settings } = await import('../src/game/settings');
const { PickupType } = await import('../src/game/pickups');
const { Timeline } = await import('../src/game/timeline');
const { installBot } = await import('../src/dev/bot');
const { updateEliteMods } = await import('../src/game/systems/combat');
settings.pet = 'none'; settings.deathReplay = false;
const seeded = new Rng(42); Math.random = () => seeded.next();
const canvas = document.getElementById('game') as HTMLCanvasElement;
const g = new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
g.startRun({ seed: 42, difficulty: 'normal' });
if (g.mode === 'shop') g.closeShop();
cheats.god = true;
function spawn(id: typeof ELITE_MOD_IDS[number], second?: typeof id) {
  const e = g.enemies.spawn(ENEMIES.bopper, 3, 0, { elite: true, eliteMod: id, instant: true });
  e.state = 'move';
  if (second) E2.makeChampion(g, e, second);
  return e;
}
function clear() { g.enemies.clear(); g.bullets.clear(); g.pickups.clear(); E2.restoreElites2(g, new Float32Array(E2.ELITES2_HISTORY_SIZE)); }
function step(seconds: number) { for (let i = 0; i < Math.round(seconds * 60); i++) E2.updateElites2.call(g, 1 / 60); }

ok(ELITE_MOD_IDS.length === 12 && ELITE_MOD_IDS.length <= 15, '12 modifiers fit both four-bit slots');
ok(!championRoll(2, 0) && championRoll(3, 0.119) && !championRoll(3, 0.12), 'champions begin at stage 3 with 12% chance');
const counts = Object.fromEntries(ELITE_MOD_IDS.map(id => [id, 0]));
for (let i = 0; i < 10000; i++) counts[pickEliteMod((i + 0.5) / 10000, false, false)]++;
const total = ELITE_MOD_IDS.reduce((n, id) => n + ELITE_MODS[id].weight, 0);
for (const id of ELITE_MOD_IDS) ok(Math.abs(counts[id] / 10000 - ELITE_MODS[id].weight / total) < 0.001, `${id} rolls at its authored weight`);
for (let i = 0; i < 100; i++) {
  const id = pickEliteMod(i / 100, true, true, 'gravity');
  if (['splitting', 'teleporting', 'gravity'].includes(id)) throw new Error('invalid modifier selection');
}
ok(true, 'both slots exclude duplicates and incompatible splitting/blinking');

// Every pair, all adjacent legacy bits, raw records AND keyframe/delta snapshots.
const enc = new SnapEncoder(), dec = new SnapDecoder();
let wireOK = true;
for (const first of ELITE_MOD_IDS) for (const second of ELITE_MOD_IDS) {
  if (first === second) continue;
  const e = spawn(first, second);
  e.familyState = 4; e.aiBits = 7; e.phaseOut = true; e.shield = 10;
  const body = packEnemies([e]);
  if (body.byteLength !== 28) wireOK = false;
  const snap = dec.decode(enc.encode({}, { en: body, enN: 1, pk: new ArrayBuffer(0), pkN: 0, bu: { b: g.bullets, idx: [] } }, {}));
  unpackEnemies(snap.en as ArrayBuffer, r => {
    if (r.eliteMod !== first || r.eliteMod2 !== second || !r.phaseOut || r.familyState !== 4 || r.ai !== 7 || !r.shield) wireOK = false;
  });
  clear();
}
ok(wireOK, 'all 132 champion pairs round-trip through delta snapshots without corrupting family/squad/shield bits');

let e = spawn('phasing'); step(4.1);
ok(e.phaseOut && !e.alive && !e.targetable && e.contactDamage === 0, 'phase removes targeting and contact damage');
const hp = e.hp;
ok(g.damage(e, 9999, { source: 'nuke', fixed: true }, g.hero) === 0 && e.hp === hp, 'phase blocks even fixed/explosive damage');
e.frozen = 3; step(1);
ok(!e.phaseOut, 'phase immunity expires even when frozen');
e.reset(0, 0, {});
ok(!e.mod2 && !e.phaseOut && e.eliteHits === 0 && e.eliteRageSpeed === 1, 'pool reuse clears every modifier state');
clear();
e = spawn('mirrored');
const b = g.bullets;
b.spawn({ x: 3, z: 0, dirX: 1, dirZ: 0, speed: 40, life: 9, damage: 1000, radius: 0.2, knockback: 2, color: '#fff36b', width: 0.2, length: 0.4, team: 0, blast: 4, homing: 5, pierce: 9 });
for (let i = 1; i <= 4; i++) ok(E2.reflectEliteBullet(g, e, 0) === (i === 4), `mirror collision ${i}: fourth shot reflects`);
ok(b.team[0] === 1 && b.vx[0] === -14 && b.damage[0] === 12 && b.blast[0] === 0 && b.homing[0] === 0 && b.life[0] === 2 && b.colorOf(0) === '#ff3df0', 'reflected shot changes team, caps damage/speed/life and strips explosive/homing effects');
clear();
e = spawn('gravity');
g.player.pos.x = g.player.pos.z = g.player.vel.x = g.player.vel.z = 0;
g.groundAt(0, 0, g.player.ground);
ok(g.player.ground.pushX === T.gravityPull, 'gravity pulls the hero gently toward the elite');
b.spawn({ x: 0, z: 1, dirX: 0, dirZ: 1, speed: 10, life: 3, damage: 1, radius: 0.2, knockback: 0, color: '#fff36b', width: 0.2, length: 0.4, team: 0 });
step(0.1); ok(b.vx[0] > 0 && b.vz[0] < 10, 'gravity bends bullet velocity toward the elite');
for (let i = 0; i < 10; i++) spawn('gravity');
g.groundAt(0, 0, g.player.ground);
ok(g.player.ground.pushX <= T.gravityPull + 0.0001, 'stacked gravity stays escapable');
clear();
e = spawn('summoner'); step(5.9); ok(g.enemies.activeCount === 1, 'summoner waits six seconds'); step(0.2);
ok(g.enemies.activeCount === 3 && g.enemies.list.filter(x => x.active && x !== e).every(x => !x.elite && x.def.id === 'swarmer'), 'summoner creates two ordinary adds');
e.eliteSummonT = 0; const activeBefore = g.enemies.activeCount; const cap = T.summonCap; T.summonCap = activeBefore; step(0.02); T.summonCap = cap;
ok(g.enemies.activeCount === activeBefore, 'summoner respects population cap');
clear();
e = spawn('berserk'); const speed = e.speedMul, damage = e.dmgMul; e.hp = e.maxHp * 0.25; step(2);
ok(Math.abs(e.speedMul / speed - 1.4875) < 0.0001 && Math.abs(e.dmgMul / damage - 1.375) < 0.0001, 'berserk scales with missing life without frame compounding');
e.hp = e.maxHp; step(0.02); ok(e.speedMul === speed && e.dmgMul === damage && berserkBonus(-10, 100) === 1, 'healing removes rage and bonuses clamp safely');
clear();
e = spawn('frostbite'); step(0.02); g.player.pos.x = 3; g.player.pos.z = 0; g.player.vel.x = 6; g.player.vel.z = 0; g.groundAt(3, 0, g.player.ground);
ok(Math.abs(g.player.ground.pushX + 2.1) < 0.001, 'frost trails slow movement by 35%');
g.player.dashT = 0.2; g.groundAt(3, 0, g.player.ground);
ok(g.player.ground.pushX === 0, 'dash escapes frost without a movement penalty');
g.player.dashT = 0;
const frost = E2.elites2Net(g); ok(frost.length === 1, 'frost fields are present in lane snapshot');
E2.restoreElites2(g, new Float32Array(E2.ELITES2_HISTORY_SIZE)); E2.applyElites2Net(g, frost); g.groundAt(3, 0, g.player.ground);
ok(Math.abs(g.player.ground.pushX + 2.1) < 0.001, 'client prediction uses the same authoritative frost field');
g.enemies.kill(e); step(3.1); g.groundAt(3, 0, g.player.ground);
ok(g.player.ground.pushX === 0, 'frost expires after its owner dies');
clear();
e = spawn('vampiric', 'teleporting'); e.hp = e.maxHp / 2; e.modT = 0; const x = e.x;
updateEliteMods.call(g, 0.1); ok(e.hp > e.maxHp / 2 && e.x !== x, 'champions execute legacy regen and teleport from different slots');
clear();
e = spawn('gravity', 'frostbite'); step(0.1); e.eliteHits = 3;
const timeline = new Timeline(); const frame = timeline.record(g); const originalUid = e.uid;
g.enemies.kill(e); E2.restoreElites2(g, new Float32Array(E2.ELITES2_HISTORY_SIZE)); timeline.restore(g, frame, 'full');
e = g.enemies.list.find(x => x.active && x.uid === originalUid)!;
ok(!!e && e.mod2?.id === 'frostbite' && e.eliteHits === 3 && E2.elites2Net(g).length === 1, 'rewind restores champion identity, counters and frost gameplay');
g.killEnemy(e, 'buster', g.hero);
let chest = -1; for (let i = 0; i < g.pickups.count; i++) if (g.pickups.type[i] === PickupType.Chest) chest = i;
ok(chest >= 0 && g.pickups.value[chest] === CHAMPION_CHEST, 'champion death drops upgraded chest value');
const gold = g.hero.gold, pending = g.hero.chestsPending;
g.collect(g.hero, PickupType.Chest, CHAMPION_CHEST);
ok(g.hero.chestsPending === pending + 2 && g.hero.gold === gold + 12, 'champion chest grants two rewards and 12 gold');
setLanguage('ar');
for (const id of ELITE_MOD_IDS.slice(6)) ok(!/[a-z]{3}/i.test(localize(ELITE_MODS[id].desc)), `${id} guide translates to Arabic`);
ok(!/[a-z]{3}/i.test(localize(E2.eliteToast(e))), 'champion toast translates on receiver');
setLanguage('en');

// Exercise the actual host builder and client apply hook, including a delta and trail expiry.
clear(); e = spawn('phasing', 'frostbite'); step(0.1);
const client = new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
client.startRun({ seed: 42, difficulty: 'normal' }); if (client.mode === 'shop') client.closeShop();
client.role = 'client';
client.applySnapshot(g.buildSnapshot(g.hero, []));
const mirrored = client.netEnemies.get(e.uid)!;
ok(mirrored?.mod2?.id === 'frostbite' && E2.elites2Net(client).length === 1, 'real host/client snapshot carries champion and frost fields');
e.phaseOut = true; client.applySnapshot(g.buildSnapshot(g.hero, []));
ok(mirrored.phaseOut && !mirrored.targetable, 'phase transition reaches existing client enemy through a delta');
E2.restoreElites2(g, new Float32Array(E2.ELITES2_HISTORY_SIZE)); client.applySnapshot(g.buildSnapshot(g.hero, []));
ok(E2.elites2Net(client).length === 0, 'empty frost snapshot removes client slow zones');
const beforeAge = mirrored.eliteAge; E2.updateElites2.call(client, 10);
ok(mirrored.eliteAge === beforeAge, 'client never runs elite gameplay timers or spawns');
client.role = 'solo';

// Fixed seed, stage-3 kit and real Autopilot: compare isolated elite encounters.
installBot(g, g.input);
const times: Record<string, number> = {};
for (const id of ['shielded', 'fast', ...ELITE_MOD_IDS.slice(6)] as typeof ELITE_MOD_IDS) {
  const runRng = new Rng(42); Math.random = () => runRng.next();
  g.startRun({ seed: 42, difficulty: 'normal' }); if (g.mode === 'shop') g.closeShop();
  g.loadStage(3); g.mode = 'fight'; g.screens.show('none');
  g.xpNext = 1e9;
  // Keep the encounter isolated; no director waves, boss, pickups or world-event interference.
  g.director.update = () => []; g.updateWorldEvent = () => {}; g.updateChestSpawns = () => {};
  clear();
  for (let i = 0; i < 3; i++) { g.debugGiveWeapon('drones'); g.debugGiveWeapon('aura'); }
  e = g.enemies.spawn(ENEMIES.bopper, g.player.x + 5, g.player.z, g.spawnOpts({ elite: true, eliteMod: id, instant: true })); e.state = 'move';
  const uid = e.uid; const start = g.runTime;
  for (let n = 0; n < 3600 && e.active && e.uid === uid; n++) (window as any).botStep();
  times[id] = Math.round((g.runTime - start) * 10) / 10;
  ok(!e.active || e.uid !== uid, `bot kills ${id} elite within 60 seconds`);
}
console.log('ELITES2_BOT_SECONDS', JSON.stringify(times));
ok(Math.max(...Object.values(times)) <= Math.max(times.shielded, times.fast) * 2.5, 'new elite kill times remain in the existing elite range');
process.exit(process.exitCode ?? 0);
