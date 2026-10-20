import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';
import { Rng } from '../src/core/rng';

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

const M = await import('../src/game/architect/model');
const S = await import('../src/game/systems/architect');
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { settings } = await import('../src/game/settings');
const { ENEMIES } = await import('../src/data/enemies');
const { save, saveLock, unlockedWeapons } = await import('../src/game/save');
const { rewardAvailable, META_SKINS, CODEX } = await import('../src/data/codex');
const { installBot } = await import('../src/dev/bot');
const { setLanguage, localize } = await import('../src/i18n');

ok(M.architectEligible(12, 'standard', false, true), 'third Omega unlocks the Architect');
for (const stage of [4, 8, 16]) ok(!M.architectEligible(stage, 'standard', false, true), `stage ${stage} keeps its existing ending`);
ok(!M.architectEligible(12, 'bossrush', false, true) && !M.architectEligible(12, 'standard', true, true) && !M.architectEligible(12, 'standard', false, false), 'rush, PvP and non-Omega clears cannot unlock the true boss');
for (let n = 1; n <= 8; n++) ok(M.architectHp(n) === Math.round(M.architectTuning.hp * (1 + (n - 1) * 0.65)), `${n}-player health scales once at arrival`);
ok(M.hpGate(1, -999, 100, false) === 66 && M.hpGate(2, -999, 100, false) === 33 && M.hpGate(3, -999, 100, false) === 10, 'overkill cannot skip either phase or the final pulse');
ok(M.hpGate(3, -999, 100, true) === 0, 'heart can die once the desperation gate has opened');
for (const layout of [0, 1, 2]) {
  let safe = true;
  for (let x = -17; x <= 17; x++) safe &&= M.tileAt(x, 0, layout) && M.tileAt(0, x, layout);
  ok(safe, `layout ${layout} always has a connected central cross`);
}
ok(!M.tileAt(16, 16, 1) && !M.tileAt(8, 12, 2) && M.tileAt(16, 16, 2), 'layouts rearrange actual walkable floor');
const d = M.emptyDanger(); Object.assign(d, { kind: 2, r: 1, warn: 1.6, life: 1, age: 1.5 });
ok(!M.dangerHits(d, 0, 0), 'warnings never deal damage'); d.age = 1.7;
ok(M.dangerHits(d, 15, 0) && !M.dangerHits(d, 0, 3), 'laser uses its drawn line width');
Object.assign(d, { kind: 4, age: 2.6, warn: 1.6 });
ok(M.dangerHits(d, 16, -3) && !M.dangerHits(d, 10, -3), 'final pulse hits its moving band, not the whole arena');
ok(M.activeCore([0, 0.5, 1]) === 1 && M.activeCore([0, 0, 0]) === 3, 'cores open strictly in order');

settings.mode = 'standard'; settings.difficulty = 'normal'; settings.bossIntros = false; settings.finishers = false;
settings.cinematics = 'off'; settings.autoFire = false; cheats.god = true; saveLock.on = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const g = mk();
const start = () => { g.startSolo(); g.startRun({ seed: 42, difficulty: 'normal' }); if (g.mode === 'shop') g.closeShop(); g.loadStage(12); g.mode = 'fight'; g.screens.show('none'); g.xpNext = 1e12; };
start();
// Observe the real Omega, then use the real kill path and stage-clear hook.
g.director.bossSpawned = true; g.spawnBoss(ENEMIES.omega); S.updateArchitect(g, 0);
const catchFinisher = g.finisherCatch; g.finisherCatch = () => false;
g.killEnemy(g.boss!, 'buster', g.hero); g.stageClear();
let s = S.architectState(g);
ok(s.active && g.boss?.def.id === 'architect' && g.mode === 'fight' && g.victories === 0, 'Omega death starts the Architect before victory, shop or looping');
const original = g.arena; const originalCols = original.colliders;
S.updateArchitect(g, 3.1); g.boss!.roarT = 0;
const b = g.boss!;
g.damage(b, 1e9, { source: 'test', fixed: true, noStatus: true }, g.hero);
ok(s.phase === 2 && b.hp === b.maxHp * 0.66, 'real overkill enters echo phase at 66%');
S.updateArchitect(g, 2.1);
g.damage(b, 1e9, { source: 'test', fixed: true, noStatus: true }, g.hero);
ok(s.phase === 3 && b.under && s.coreUids.every(Boolean), 'phase three creates three sealed-core targets');
S.updateArchitect(g, 2.1);
const cores = s.coreUids.map(uid => g.enemies.list.find(e => e.active && e.uid === uid)!);
const sealedHp = cores[1].hp;
g.damage(cores[1], 1e9, { source: 'test', fixed: true }, g.hero);
g.damage(b, 1e9, { source: 'test', fixed: true }, g.hero);
ok(cores[1].hp === sealedHp && b.hp > 0, 'AoE, fixed damage and Nuke cannot bypass sealed cores or body');
// Exercise the real compact snapshot with all targets, arena geometry and state fields.
const client = mk(); client.role = 'client'; client.clientStart(g.seed, 0, [{ name: 'Client', skin: 'blue' }]); client.clientStage(12, g.seed);
client.applySnapshot(g.buildSnapshot(g.hero, []));
const cs = S.architectState(client);
ok(cs.phase === 3 && cs.coreUids.join() === s.coreUids.join() && client.arena.colliders.length === g.arena.colliders.length, 'real host snapshot mirrors phase, core identities and collision');
ok(client.netEnemies.get(s.coreUids[1])?.under === true, 'client cannot aim at a later sealed core');
cs.layout = 1; cs.layoutTime = 3; client.player.pos.x = client.player.pos.z = 16;
const clientHp = client.player.hp; S.architectLocalStep(client);
ok(!M.tileAt(client.player.x, client.player.z, 1) && client.player.hp === clientHp, 'client leaves fall damage and landing to the host');
s.layout = 1; s.layoutTime = 3; g.player.pos.x = g.player.pos.z = 16; S.updateArchitect(g, 1 / 60);
client.applySnapshot(g.buildSnapshot(g.hero, []));
ok(M.tileAt(client.player.x, client.player.z, 1) && cs.rescues[0][0] > 0, 'host landing revision corrects the locally controlled hero through snapshots');
s.layout = 0;
for (let i = 0; i < 3; i++) {
  g.damage(cores[i], 1e9, { source: 'test', fixed: true, noStatus: true }, g.hero);
  S.updateArchitect(g, 1 / 60);
  ok(s.core === i + 1, `destroying core ${i + 1} exposes exactly its successor`);
}
ok(!b.under && Math.abs(b.hp / b.maxHp - 0.105) < 0.00001, 'three cores leave 10.5% heart health');
g.damage(b, 1e9, { source: 'test', fixed: true, noStatus: true }, g.hero);
ok(s.desperate && b.hp === b.maxHp * 0.1 && s.dangers.filter(d => d.kind === 4).length === 4, '10% overkill triggers four warned final pulses');
const heldHp = b.hp;
g.damage(b, 1e9, { source: 'test', fixed: true }, g.hero);
ok(b.hp === heldHp, 'heart cannot die while the final pulse is running');
for (let i = 0; i < 480; i++) S.updateArchitect(g, 1 / 60);
ok(s.desperationDone, 'desperation eventually unlocks the final hit');
settings.finishers = true; g.finisherCatch = catchFinisher;
g.damage(b, 1e9, { source: 'test', fixed: true, noStatus: true }, g.hero);
ok(b.active && b.hp === 0 && g.finisherHold(0), 'final blow holds for the shared portrait finisher');
g.finisherHold(4); settings.finishers = false;
s.preview = false; saveLock.on = false;
// Do not bank the run in this isolated flow assertion.
let ended = 0; const endRun = g.endRun; g.endRun = () => { ended++; };
g.stageClear(); g.stageClear();
ok(s.done && !s.active && ended === 1 && g.victories === 1 && g.mode === 'dead', 'true ending ends and rewards the run exactly once');
ok(save.achievements.includes('true_ending') && save.meta.rewards.includes('architect_skin') && save.meta.codex.includes('enemy:architect') && save.discovered.includes('story:boss:architect'), 'real completion grants the achievement, cosmetic, codex and story chapter');
saveLock.on = true;
client.applySnapshot(g.buildSnapshot(g.hero, []));
ok(S.architectState(client).done, 'ending survives ordinary snapshot sync');
S.architectEndingStep(g, 1 / 60);
ok(g.screens.current === 'architect-ending' && document.getElementById('scr-architect-ending')?.textContent?.includes('TRUE ENDING'), 'ending uses a registered navigable screen');
await setLanguage('ar'); S.architectEndingStep(g, 1 / 60);
ok(document.getElementById('scr-architect-ending')?.textContent?.includes('النهاية الحقيقية'), 'visible ending switches language in place');
const entry = CODEX.find(e => e.id === 'enemy:architect');
ok(!!entry && !/[a-z]{3}/i.test(localize(entry.text)), 'hidden boss has a translated codex entry');
await setLanguage('en');
S.clearArchitect(g); S.clearArchitect(client);
ok(!S.architectState(g).active && g.arena.group.visible && g.arena.colliders !== originalCols, 'reset restores the previous arena and removes the encounter field');
g.endRun = endRun;
ok(rewardAvailable('architect_skin', { achievements: ['true_ending'], bestHeat: {}, weekly: [] }) && META_SKINS.some(x => x.id === 'architect_skin'), 'true ending unlocks an existing-schema co-op cosmetic');

// Eight live heroes: every hit bit and parry exemption belongs to the host.
for (const count of [2, 8]) {
  g.setHeroes(Array.from({ length: count }, (_, i) => g.makeHero(i, `Hero${i}`, unlockedWeapons())));
  g.startRun({ seed: 42, difficulty: 'normal' }); if (g.mode === 'shop') g.closeShop();
  S.startArchitect(g, true); const team = S.architectState(g);
  ok(g.boss!.maxHp === M.architectHp(count), `${count}-hero encounter uses the intended team HP`);
  for (const h of g.heroes) { h.player.pos.x = 0; h.player.pos.z = 0; h.player.invuln = 0; h.skill.parryT = 1; }
  Object.assign(team.dangers[0], { kind: 1, x: 0, z: 0, r: 3, warn: 0, life: 1, age: 0, hit: 0 });
  S.updateArchitect(g, 1 / 60);
  ok(team.dangers[0].hit === (1 << count) - 1, `${count} simultaneous parries consume each player's own danger bit`);
  S.clearArchitect(g);
}
g.setHeroes([g.makeHero(0, 'Bot', unlockedWeapons())]);

// Standing still through the finale loses a full-life hero under the normal per-hit cap.
start(); S.architectLinks(g, new URLSearchParams('architect&architectpulse'));
cheats.god = false; g.hero.pet = 'none'; g.hero.revivesLeft = 0;
g.player.teleport(0, 0); g.player.invuln = 0;
for (let i = 0; i < 480 && !g.player.dead; i++) {
  g.player.invuln = Math.max(0, g.player.invuln - 1 / 60);
  S.updateArchitect(g, 1 / 60);
}
ok(g.player.dead, 'four separated final pulses require evasion under ordinary damage caps');
cheats.god = true; S.clearArchitect(g);

// Fixed seed, substantial late-run kit. The bot uses normal weapons and controls; only incoming damage is disabled.
const nativeRandom = Math.random, botRandom = new Rng(42); Math.random = () => botRandom.next();
settings.cinematics = 'off'; settings.loadout = { primary: 'scatter', secondary: 'grenade', special: 'storm' }; start();
for (const id of ['drones', 'missiles', 'lightning', 'fire']) for (let i = 0; i < 6; i++) g.debugGiveWeapon(id);
g.hero.passives = {}; g.hero.recomputeStats();
g.level = 40; g.xpNext = 1e12;
// This fixed level-40 kit is far weaker than a real stage-12 build, so the pacing band is checked at the lane's
// reference life (450,000); the shipped life is tuned to the stage-12 power curve (balance2, architectTuning.hp).
const shippedHp = M.architectTuning.hp; M.architectTuning.hp = 450000;
S.startArchitect(g, true); installBot(g, g.input);
const report = (window as any).botRun(300, true);
M.architectTuning.hp = shippedHp;
Math.random = nativeRandom;
s = S.architectState(g);
console.log('Architect god-bot report:', JSON.stringify({ ...report, encounterSeconds: s.time, phase: s.phase, hp: s.hp, core: s.core }));
ok(s.done, 'god bot clears all three phases, ordered cores and desperation');
ok(s.time >= 120 && s.time <= 240, `god bot encounter lasts 2–4 minutes (${s.time.toFixed(1)}s)`);
process.exit(process.exitCode ?? 0);
