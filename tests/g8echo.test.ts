import { seedRandom } from './jsdomEnv';
import assert from 'node:assert/strict';

const { Game } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { EchoRecorder, normalizeEchoes, readEchoes, echoKey } = await import('../src/data/echoTape');
const { buildMig, restoreRun } = await import('../src/game/systems/hostmig');
const { clockScore, clockStage } = await import('../src/game/timeloop');
const { settings } = await import('../src/game/settings');
const { setLanguage } = await import('../src/i18n');
const { cheats } = await import('../src/game/game');

const make = () =>
  new Game(
    new Input(document.querySelector('canvas')!),
    16 / 9,
    document.getElementById('hud')!,
    document.getElementById('reticle')!,
  );
const g = make();
const tick = 1 / 60;
seedRandom(41);
settings.cinematics = 'off';
g.startRun({ seed: 41, difficulty: 'normal' });
g.closeShop();
const rec = new EchoRecorder();
for (let i = 0; i < 150; i++) rec.sample(2, i % 2 ? -3 : 3, 8, i % 12 === 0);
const tape = rec.finish(g.hero, 7)!;
assert.equal(tape.moves.length, 128 * 4);
assert.equal(tape.arms.at(-1)?.id, 'bomb');
assert.deepEqual(normalizeEchoes([tape, tape, tape, tape]).length, 3);
assert.deepEqual(normalizeEchoes([null, { arms: [{ id: '__proto__' }], moves: [0, 0, 0, 0] }]), []);
const damaged = normalizeEchoes([
  { ...tape, moves: [Infinity, null, 99, true], arms: [{ ...tape.arms[0], shots: 999 }] },
])[0];
assert.deepEqual(damaged.moves, [0, 0, 16, 0]);
assert.equal(damaged.arms[0].shots, 5);
assert.deepEqual(clockScore(41, 5), clockScore(41, 5));
assert.notDeepEqual(clockScore(42, 5), clockScore(41, 5));
assert.ok(Array.from({ length: 100 }, (_, i) => clockStage(i, 5)).some(Boolean));
assert.ok([1, 2, 3, 4, 6, 7, 8].every((stage) => !clockStage(41, stage)));

// A normal run records the host's actual kit and motion. A second run consumes it once.
g.debugGiveWeapon('drones');
for (let i = 0; i < 150; i++) g.update(tick);
g.endRun(true);
assert.ok(readEchoes()[0].arms.some((a) => a.id === 'drones'));
g.startRun({ seed: 42, difficulty: 'normal' });
g.closeShop();
g.loadStage(2);
g.director.time = 12;
g.update(tick);
assert.equal(g.echoes.current?.kind, 'echo');
const packet = g.buildSnapshot(g.hero, []);
const guest = make();
guest.role = 'client';
guest.clientStart(g.seed, 0, [{ name: 'Guest', skin: 'classic' }] as Parameters<
  typeof guest.clientStart
>[2]);
guest.clientStage(2, g.seed);
guest.applySnapshot(packet);
assert.deepEqual(guest.echoes.current?.weapon, g.echoes.current?.weapon);
const snapshotHistory = localStorage.getItem('infinishoot.' + echoKey);
assert.equal(guest.echoes.step(tick, true), false);
assert.equal(localStorage.getItem('infinishoot.' + echoKey), snapshotHistory);
const enemy = g.enemies.list.find((e) => e.active && e.def.name === 'Mirror Echo')!;
assert.ok(enemy.under);
const migrated = make();
migrated.role = 'client';
migrated.clientStart(g.seed, 0, [{ name: 'Pilot', skin: 'classic' }] as Parameters<
  typeof migrated.clientStart
>[2]);
migrated.clientStage(2, g.seed);
migrated.applySnapshot(packet);
restoreRun(migrated, buildMig(g));
migrated.role = 'solo';
migrated.echoes.step(tick, true);
assert.equal(migrated.echoes.current?.kind, 'echo', 'promoted pilot owns a living mirror');
assert.equal(migrated.echoes.current?.hero, tape.hero);
const beforeGold = g.hero.gold;
g.killEnemy(enemy, 'buster', g.hero);
g.echoes.killed(enemy);
assert.equal(g.hero.gold, beforeGold + 6);
g.loadStage(2);
g.director.time = 20;
g.update(tick);
assert.equal(g.echoes.current, null);

g.echoes.preview('clock');
const clock = g.echoes.clock;
const advance = (frames: number) => {
  for (let i = 0; i < frames; i++) clock.step(g, tick, true);
};
const initialHP = g.player.hp,
  initialGold = g.hero.gold;
const start = { x: g.player.x, z: g.player.z };
advance(125);
const spawns = () => g.strikes.map(({ x, z, r, dmg }) => [x, z, r, dmg]);
const wave = spawns();
assert.ok(wave.length > 30);
guest.applySnapshot(g.buildSnapshot(g.hero, []));
assert.equal(guest.echoes.current?.kind, 'clock');
g.player.teleport(5, -3);
g.player.hp = 1;
g.player.invuln = 0;
cheats.god = false;
g.hurtHero(g.hero, 99, 0, 0, null, 'Clock pulse');
advance(1);
assert.equal(clock.view.attempt, 2);
assert.equal(g.mode, 'fight');
assert.equal(g.player.hp, initialHP);
assert.deepEqual(g.player.pos, start);
assert.equal(g.hero.gold, initialGold);
assert.equal(g.strikes.length, 0);
guest.player.teleport(8, 8);
guest.applySnapshot(g.buildSnapshot(g.hero, []));
assert.deepEqual(guest.player.pos, start, 'client predicted pose reseated on new attempt');
advance(125);
assert.deepEqual(spawns(), wave, 'same clock offsets, radii, positions and damage');
assert.ok(clock.view.ghost);
await setLanguage('ar');
g.echoes.hud.draw(clock.view, tick);
assert.match(document.querySelector('.echo-panel')!.textContent!, /ممر الساعة/);
const skip = document.querySelector<HTMLButtonElement>('.echo-panel button')!;
assert.equal(skip.hidden, false);
skip.click();
g.echoes.hud.draw(clock.view, tick);
assert.equal(skip.hidden, true);
await setLanguage('en');
guest.applySnapshot(g.buildSnapshot(g.hero, []));
restoreRun(guest, buildMig(g));
guest.role = 'solo';
guest.echoes.step(tick, true);
assert.equal(guest.echoes.clock.view.attempt, 2);
assert.ok(guest.echoes.clock.elapsed > 2);
assert.ok(guest.echoes.clock.view.ghost, 'previous route survives promotion');

// A teammate's death rewinds the whole party. No-hit means the whole team.
const mate = g.makeHero(1, 'Mate', []);
g.setHeroes([g.hero, mate]);
mate.player.hp = 1;
mate.player.invuln = 0;
advance(1);
g.hurtHero(mate, 40, 0, 0, null, 'Clock pulse');
advance(1);
assert.equal(clock.view.attempt, 3);
assert.equal(mate.player.dead, false);
g.damagedThisStage = true;
clock.elapsed = 60 - tick;
advance(1);
assert.equal(clock.view.attempt, 4);
g.damagedThisStage = true;
clock.elapsed = 60 - tick;
advance(1);
assert.equal(clock.view.attempt, 5);
g.damagedThisStage = true;
clock.elapsed = 60 - tick;
advance(1);
assert.equal(clock.active, false);
assert.equal(clock.won, false);
assert.equal(g.mode, 'cleared');

g.setHeroes([g.hero]);
g.loadStage(3);
g.echoes.preview('clock');
clock.elapsed = 60 - tick;
advance(1);
assert.ok(clock.won);
assert.equal(g.mode, 'cleared');
const paid = g.hero.gold;
advance(10);
assert.equal(g.hero.gold, paid);
g.loadStage(3);
g.echoes.preview('clock');
clock.view.attempt = 5;
g.hero.revivesLeft = 0;
g.hero.petState.reviveUsed = true;
g.player.invuln = 0;
g.player.hp = 1;
g.hurtHero(g.hero, 40, 0, 0, null, 'Clock pulse');
assert.equal(g.mode, 'dead', 'the final lethal hit follows normal run death');
console.log(
  'ok   Echo recorder, normalized store, host mirror, seeded clock, team rewind and five-attempt limit',
);
