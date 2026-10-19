/**
 * Time lane: the pure rules (curves, near misses, votes, clutch, "so close"),
 * then the real game headless (jsdom, no WebGL): the timeline records and
 * restores the world, a solo rewind plays back and restores life, enemies,
 * bullets and the stage clock, a last stand wins or fails, a strike landing
 * beside a hero in a boss fight drops into bullet time, the death replay
 * holds the world and still ends in game over, and a clutch revive fires.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';

const R = await import('../src/game/timeRules');
const T = R.timeTuning;

// ---- curves
ok(R.rewindCurve(0) === 0 && R.rewindCurve(1) === 1 && Math.abs(R.rewindCurve(0.5) - 0.5) < 1e-9, 'rewind curve runs 0..1 through the middle');
ok(R.rewindCurve(0.1) < 0.1 && R.rewindCurve(0.9) > 0.9, 'rewind playback starts slow and eases into the stop');
ok(R.swingWeight(0) === 0 && R.swingWeight(1) < 1e-6 && R.swingWeight(0.5) > 0.99, 'bullet-time swing goes out and comes back');
ok(R.camWeight(0, 2) === 0 && R.camWeight(1, 2) === 1 && R.camWeight(2, 2) === 0 && R.camWeight(0.1, 2) < 1, 'cutscene camera eases in, holds, eases out');

// ---- rewind rules
const base = { used: 0, history: 5, pvp: false, fighting: true, dead: false };
ok(R.rewindBlock(base) === null, 'a rewind is allowed with history and a charge');
ok(R.rewindBlock({ ...base, used: T.rewindPerStage }) === 'REWIND USED THIS STAGE', 'one rewind per stage');
ok(R.rewindBlock({ ...base, history: 0.3 }) === 'NOTHING TO REWIND YET', 'too little history says so');
ok(R.rewindBlock({ ...base, pvp: true }) === 'NO REWIND IN PVP', 'no rewinds in PvP');
ok(R.rewindBlock({ ...base, fighting: false }) === '' && R.rewindBlock({ ...base, dead: true }) === '', 'menus and downed heroes: silently nothing');
ok(R.votePasses([0, 1], [0, 1]) && !R.votePasses([0], [0, 1]) && R.votePasses([0], [0]) && !R.votePasses([], []), 'a team vote needs everyone standing');
ok(R.votePasses([1], [1]), "downed heroes don't vote");

// ---- last stand / clutch rules
const st = { combo: T.standCombo, used: false, pvp: false, training: false, active: false };
ok(R.standOpens(st) && !R.standOpens({ ...st, combo: T.standCombo - 1 }) && !R.standOpens({ ...st, used: true }) && !R.standOpens({ ...st, pvp: true }), 'last stand needs the combo, once, never in PvP');
ok(R.isClutch({ helperHp01: 0.2, crowd: 0, standing: 1, players: 2 }), 'a rescuer on low life makes it clutch');
ok(R.isClutch({ helperHp01: 1, crowd: T.clutchCrowd, standing: 1, players: 2 }), 'a crowd around the downed hero makes it clutch');
ok(R.isClutch({ helperHp01: 1, crowd: 0, standing: 1, players: 3 }) && !R.isClutch({ helperHp01: 1, crowd: 0, standing: 1, players: 2 }), 'last one standing counts with 3+ players only (2 players would make every revive clutch)');

// ---- near misses
ok(R.nearMiss(0, 0, 3, 3.6, 0, 0.45) && !R.nearMiss(0, 0, 3, 2.5, 0, 0.45) && !R.nearMiss(0, 0, 3, 6, 0, 0.45), 'a strike landing just beside a hero is a near miss; inside or far is not');
ok(R.grazes(0.9, 0, 0.26, 0, 0, 0.45) && !R.grazes(0.5, 0, 0.26, 0, 0, 0.45) && !R.grazes(3, 0, 0.26, 0, 0, 0.45), 'bullets graze in a band just outside the hero');

// ---- so close
const info: import('../src/game/timeRules').DeathInfo = { bossHp01: -1, bossName: '', toBoss: -1, level: 9, xp01: 0.2, killsToLevel: -1, toBest: 99999, bestScore: 1000, standShort: -1, combo: 0, rewindLeft: false, runTime: 151, kills: 312 };
ok(R.soClose({ ...info, bossHp01: 0.12, bossName: 'King Bopper' }).text === 'KING BOPPER HAD 12% LIFE LEFT', 'so close: boss life left');
ok(R.soClose({ ...info, toBoss: 1.4 }).text === '2 SECONDS FROM THE BOSS', 'so close: seconds from the boss');
ok(R.soClose({ ...info, killsToLevel: 3 }).text === '3 KILLS FROM LEVEL 10', 'so close: kills from the next level');
ok(R.soClose({ ...info, toBest: 50, bestScore: 1000 }).text.includes('POINTS FROM YOUR BEST'), 'so close: points from the best score');
ok(R.soClose({ ...info, standShort: 4 }).text === '4 KILLS SHORT OF A LAST STAND', 'so close: a failed last stand');
ok(R.soClose({ ...info, bossHp01: 0.05, bossName: 'Rex', toBoss: 20 }).text.startsWith('REX'), 'the closest thing wins');
ok(R.soClose(info).text === 'LASTED 2:31 · 312 KILLS', 'nothing close: a plain summary');

// ---------------------------------------------------------------- the game
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
const { Team } = await import('../src/game/bullets');
const { ENEMIES } = await import('../src/data/enemies');
const { PickupType } = await import('../src/game/pickups');
const { settings } = await import('../src/game/settings');
const { unlockedWeapons } = await import('../src/game/save');
const { Timeline } = await import('../src/game/timeline');
const TS = await import('../src/game/systems/time');

const input = new Input(document.getElementById('game') as HTMLCanvasElement);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
cheats.unlockAll = true;
settings.deathReplay = true;
settings.slowMo = true;
const step = (n: number) => {
  for (let i = 0; i < n; i++) {
    game.update(1 / 60);
    if (i % 6 === 0) game.render(1, 1 / 60);
    if (game.mode === 'levelup') (game as unknown as { ui(a: string, i: number): void }).ui('pick', 0);
  }
};
const start = () => {
  settings.hero = 'rookie';
  game.applyLocalSkin();
  game.startSolo();
  if (game.mode === 'shop') game.closeShop();
  game.enemies.clear();
  game.bullets.clear();
  game.director.time = 20;
  game.xpNext = 1e9; // no level-up menus (they are history barriers)
  step(1);
};
const ts = () => TS.timeState(game);

// ---- Timeline: record and restore by itself
start();
{
  const h = game.hero;
  const tl = new Timeline(8);
  const a = game.enemies.spawn(ENEMIES.chonk, h.player.x + 5, h.player.z, game.spawnOpts({ instant: true }));
  const b = game.enemies.spawn(ENEMIES.swarmer, h.player.x - 5, h.player.z, game.spawnOpts({ instant: true }));
  game.bullets.spawn({ x: 1, z: 2, dirX: 1, dirZ: 0, speed: 9, life: 3, radius: 0.26, damage: 7, knockback: 6, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5 });
  game.pickups.spawn(PickupType.Gem, 3, 3, 4);
  const hp0 = a.hp;
  const uidB = b.uid;
  const f = tl.record(game);
  ok(f.enN >= 2 && f.buN === 1 && f.pkN >= 1, `a frame holds enemies (${f.enN}), bullets (${f.buN}) and pickups (${f.pkN})`);
  // Things change...
  a.hp = 1;
  a.x += 3;
  game.enemies.kill(b);
  const c = game.enemies.spawn(ENEMIES.zippy, 0, 9, game.spawnOpts({ instant: true }));
  game.bullets.clear();
  game.pickups.clear();
  h.player.hp = 5;
  game.score = 999;
  tl.restore(game, f, 'full');
  const back = game.enemies.list.find((e) => e.active && e.uid === uidB);
  ok(a.hp === hp0 && Math.abs(a.x - (h.player.x + 5)) < 1e-3, 'a living enemy gets its life and position back');
  ok(!!back && back.def.id === 'swarmer', 'a killed enemy comes back with its old uid');
  ok(!c.active, 'an enemy spawned since leaves quietly');
  ok(game.bullets.count === 1 && game.bullets.team[0] === Team.Enemy && game.bullets.vx[0] > 0, 'bullets come back with their velocity');
  ok(game.pickups.count >= 1, 'pickups come back');
  ok(h.player.hp > 5 && game.score === 0, 'hero life and the score come back');
  // Ring buffer wraps: capacity frames, oldest dropped.
  for (let i = 0; i < 20; i++) {
    game.runTime += 0.1;
    tl.record(game);
  }
  ok(tl.count === 8 && tl.at(7).t > tl.at(0).t && Math.abs(tl.span - 0.7) < 1e-6, `the ring keeps the last ${tl.count} frames in order (span ${tl.span.toFixed(2)} s)`);
  ok(tl.indexBack(0.3) === 4, 'indexBack finds the frame 0.3 s back');
}

// ---- Solo rewind: playback, then everything 5 s ago comes back
start();
{
  const h = game.hero;
  const p = h.player;
  cheats.god = true;
  for (let i = 0; i < 6; i++) game.enemies.spawn(ENEMIES.bopper, p.x + 8 * Math.cos(i), p.z + 8 * Math.sin(i), game.spawnOpts({ instant: true }));
  step(60 * 6);
  ok(ts().tl.span >= T.rewindSeconds - 0.11, `history covers ${ts().tl.span.toFixed(2)} s`);
  const back = ts().tl.at(ts().tl.indexBack(T.rewindSeconds));
  const want = { x: back.heroX(0), z: back.heroZ(0), time: back.team[5], score: back.team[0], kills: back.team[1] };
  p.hp = 7;
  input.pressed.add('KeyB');
  step(1);
  ok(ts().hold?.kind === 'rewind', 'REWIND (B) starts the backward playback');
  const timeAt = game.director.time;
  step(20);
  ok(game.director.time === timeAt && ts().hold?.kind === 'rewind', 'the world holds while time runs backwards');
  for (let i = 0; i < 200 && ts().hold; i++) step(1);
  ok(!ts().hold, 'the playback ends');
  ok(Math.abs(p.x - want.x) < 0.05 && Math.abs(p.z - want.z) < 0.05, 'the hero is back where it was 5 s ago');
  ok(Math.abs(game.director.time - want.time) < 0.2 && game.kills === want.kills && game.score === want.score, `the stage clock, kills and score went back (${game.director.time.toFixed(2)}/${want.time.toFixed(2)}, ${game.kills}/${want.kills}, ${game.score}/${want.score})`);
  ok(p.hp > 7 && p.invuln > 0.5, `life came back (${p.hp.toFixed(0)}) with a moment of invulnerability`);
  ok(ts().rewindsUsed === 1 && ts().tl.span < 0.2, `the rewind is spent and the history starts over (${ts().rewindsUsed}, ${ts().tl.span.toFixed(2)} s)`);
  step(70);
  input.pressed.add('KeyB');
  step(1);
  ok(!ts().hold, 'a second rewind in the same stage does nothing');
  // A new stage gives the charge back.
  game.loadStage(game.stage + 1);
  game.xpNext = 1e9;
  step(2);
  ok(ts().rewindsUsed === 0, 'a new stage gives the rewind back');
  cheats.god = false;
}

// ---- Barriers: a level-up menu clears the history
start();
{
  step(60 * 2);
  const before = ts().tl.count;
  game.mode = 'levelup';
  game.update(1 / 60);
  game.mode = 'fight';
  ok(before > 5 && ts().tl.count === 0, 'menus are history barriers (a rewind never undoes a pick)');
}

// ---- Last stand: win
start();
{
  const h = game.hero;
  const p = h.player;
  cheats.god = false;
  step(30);
  game.combo = T.standCombo + 5;
  step(1);
  p.invuln = 0;
  p.hp = 1;
  game.hurtHero(h, 999, p.x + 1, p.z, null, 'test');
  ok(!p.dead && ts().heroes[0].standT > 0 && game.mode === 'fight', 'a killing blow with a big combo opens a last stand');
  ok(p.invuln > T.standTime && game.juice.hitStop > 0, 'god mode, and the world freezes for a beat (solo)');
  for (let i = 0; i < T.standKills; i++) {
    const e = game.enemies.spawn(ENEMIES.swarmer, p.x + 3, p.z, game.spawnOpts({ instant: true }));
    game.killEnemy(e, 'buster', h);
  }
  ok(ts().heroes[0].standT === 0 && !p.dead && p.hp >= p.maxHp * T.standHeal - 1, `30 kills earn the life back (${p.hp.toFixed(0)})`);
  ok(game.combo >= T.standCombo, 'and the combo is saved');
  p.invuln = 0;
  p.hp = 1;
  game.combo = T.standCombo + 5;
  step(1);
  p.invuln = 0;
  game.hurtHero(h, 999, p.x + 1, p.z, null, 'test');
  ok(p.dead && game.mode === 'dead', 'only one last stand per stage');
}

// ---- Last stand remembers the combo from just before the hit that broke it
start();
{
  const h = game.hero;
  const p = h.player;
  game.combo = T.standCombo + 20;
  game.comboT = 5;
  step(30);
  game.combo = 0; // an earlier hit broke it...
  step(60);
  p.invuln = 0;
  p.hp = 1;
  game.hurtHero(h, 999, p.x + 1, p.z, null, 'test'); // ...and the next one would kill
  ok(!p.dead && ts().heroes[0].standT > 0 && ts().heroes[0].standCombo >= T.standCombo, `a killing blow within ${T.standMemory} s of a big combo still opens the last stand`);
  ts().heroes[0].standT = 0;
  p.hp = p.maxHp;
}

// ---- Last stand: fail -> down -> death replay -> game over
start();
{
  const h = game.hero;
  const p = h.player;
  step(60 * 3);
  game.combo = T.standCombo + 5;
  step(1);
  p.invuln = 0;
  p.hp = 1;
  game.hurtHero(h, 999, p.x + 1, p.z, null, 'test');
  ok(ts().heroes[0].standT > 0, 'last stand opened');
  step(Math.ceil((T.standTime + T.standFreeze) * 60) + 10);
  ok(p.dead && game.mode === 'dead' && ts().heroes[0].standShort > 0, `out of time: the blow lands (${ts().heroes[0].standShort} kills short)`);
  let sawReplay = false;
  let held = false;
  for (let i = 0; i < 60 * 7 && (game.screens as any).current !== 'mvp'; i++) {
    game.update(1 / 60);
    if (i % 4 === 0) game.render(1, 1 / 60);
    if (ts().hold?.kind === 'replay') {
      sawReplay = true;
      held ||= game.modeT < 1.2 && !game.gameOverShown;
    }
  }
  ok(sawReplay && held, 'the death replay plays before the game-over screen');
  ok((game.screens as any).current === 'mvp', 'and the run awards follow the replay');
  ok(ts().so.text.includes('LAST STAND') || ts().so.title.length > 0, `so close: "${ts().so.title} / ${ts().so.text}"`);
}

// ---- Death replay is skippable
start();
{
  const h = game.hero;
  const p = h.player;
  step(60 * 2);
  game.combo = 0;
  step(1);
  p.invuln = 0;
  p.hp = 1;
  game.hurtHero(h, 999, p.x + 1, p.z, null, 'test');
  for (let i = 0; i < 120 && ts().hold?.kind !== 'replay'; i++) game.update(1 / 60);
  ok(ts().hold?.kind === 'replay', 'replay running');
  input.pressed.add('Escape');
  game.update(1 / 60);
  ok(!ts().hold && p.dead, 'any button skips it (the hero stays down)');
  for (let i = 0; i < 120; i++) game.update(1 / 60);
  ok((game.screens as any).current === 'mvp', 'skipping goes straight on to run awards');
  settings.deathReplay = false;
  start();
  step(60 * 2);
  game.hero.player.invuln = 0;
  game.hero.player.hp = 1;
  game.hurtHero(game.hero, 999, 0, 0, null, 'test');
  let any = false;
  for (let i = 0; i < 200; i++) {
    game.update(1 / 60);
    any ||= !!ts().hold;
  }
  ok(!any && (game.screens as any).current === 'mvp', 'DEATH REPLAY off: straight to run awards');
  settings.deathReplay = true;
}

// ---- Bullet time: a boss strike landing just beside the hero
start();
{
  const h = game.hero;
  const p = h.player;
  cheats.god = true;
  settings.bossIntros = false;
  game.debugBoss({ now: true });
  for (let i = 0; i < 240 && !game.boss?.active; i++) step(1);
  step(30);
  game.introLeft = 0;
  ok(!!game.boss?.active, 'a boss is up');
  const t0 = game.slowMoT;
  game.strikes.push({ x: p.x + 3.6, z: p.z, r: 3, t: 0.005, dmg: 10 });
  step(3);
  ok(game.slowMoT > t0 && ts().heroes[0].btCd > 0, 'a strike landing beside the hero drops into bullet time (solo slow-mo)');
  ok(ts().view?.kind === 'bt', 'and the camera swings around the hero');
  game.strikes.push({ x: p.x + 3.6, z: p.z, r: 3, t: 0.005, dmg: 10 });
  const cd = ts().heroes[0].btCd;
  step(3);
  ok(ts().heroes[0].btCd < cd, 'rate limited: no second one right away');
  settings.slowMo = false;
  ts().heroes[0].btCd = 0;
  game.slowMoT = 0;
  game.strikes.push({ x: p.x - 3.6, z: p.z, r: 3, t: 0.005, dmg: 10 });
  step(3);
  ok(game.slowMoT === 0 && ts().heroes[0].btCd > 0, 'SKILL SLOW-MO off: the moment still happens, without slow motion');
  settings.slowMo = true;
  // A bullet ring grazing past.
  ts().heroes[0].btCd = 0;
  for (let k = 0; k < 6; k++) {
    const an = (k / 6) * Math.PI * 2;
    const r = p.radius + 0.26 + 0.3;
    game.bullets.spawn({ x: p.x + Math.cos(an) * r, z: p.z + Math.sin(an) * r, dirX: 1, dirZ: 0, speed: 0.01, life: 1, radius: 0.26, damage: 0, knockback: 0, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5 });
  }
  step(3);
  ok(ts().heroes[0].btCd > 0, 'a bullet ring grazing past (not touching) is a near miss too');
  game.bullets.clear();
  // A perfect dash in a boss fight.
  ts().heroes[0].btCd = 0;
  game.perfectDash(h);
  step(2);
  ok(ts().heroes[0].btCd > 0, 'a perfect dash during a boss fight drops into bullet time');
  // No boss: no bullet time.
  game.boss!.hp = 0;
  game.enemies.kill(game.boss!);
  game.boss = null;
  ts().heroes[0].btCd = 0;
  h.skill.dashPerfect = false;
  step(2);
  game.perfectDash(h);
  step(2);
  ok(ts().heroes[0].btCd <= 0, 'outside boss and mini-boss fights nothing happens');
  cheats.god = false;
}

// ---- Clutch revive (two heroes in one game: a revive in dire straits)
start();
{
  const h = game.hero;
  const mate = game.makeHero(1, 'Buddy', unlockedWeapons());
  mate.startRun();
  game.setHeroes([h, mate]);
  mate.player.showWhenDead = true;
  h.player.showWhenDead = true;
  mate.player.teleport(h.player.x + 1, h.player.z);
  mate.player.invuln = 0;
  if (mate.player.hurt(mate.player.hp + 1, 1, 0)) game.onHeroDown(mate);
  h.player.hp = h.player.maxHp * 0.2;
  cheats.god = true;
  let saw = false;
  for (let i = 0; i < 60 * 4 && !saw; i++) {
    mate.player.tickTimers(1 / 60);
    step(1);
    saw = ts().view?.kind === 'revive';
  }
  ok(!mate.player.dead, 'the teammate got back up');
  ok(saw, 'a revive by a rescuer on 20% life plays the clutch cutscene');
  cheats.god = false;
}

console.log('time lane: done');
