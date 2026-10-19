/**
 * Cinematics lane: the pure rules (sky-fall timeline, fall and leap curves,
 * cloud cover, arena assembly, the ending's panels, jackpot payouts and
 * reels, confetti, the reveal policy), and in the real game (jsdom, no
 * WebGL): the sky-fall transition (stage loads at the cut, bounded, skippable,
 * old fade when OFF), the arena assembling and being put back exactly, the
 * painterly ending holding solo VICTORY, the legendary reveal (first of a
 * run, per-save memory, solo hold), golden chests and their payout, the
 * flawless clear with its golden portal and bonus, and the playable title.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';
import {
  ENDING_PANELS,
  assemblyDelay,
  bulbLit,
  cloudCover,
  confettiAt,
  endingFrame,
  endingLength,
  fallHeight,
  goldenGold,
  jackpotPlan,
  jackpotTuning as jackTune0,
  leapPose,
  reelScroll,
  reelTimes,
  riseOffset,
  skyPhase,
  skyTimes,
  skyfallTuning,
} from '../src/game/cinematics';
import { Rng } from '../src/core/rng';

// ---------------------------------------------------------------- pure rules
{
  for (const lv of ['full', 'short'] as const) {
    const T = skyTimes(lv);
    ok(T.cut > 0 && T.cut < T.land && T.land < T.len && T.len <= 4, `${lv} sky fall: leap, fall and touchdown in order, at most 4 s (${T.len} s)`);
    ok(skyPhase(T.cut * 0.5, T).phase === 'leap' && skyPhase(T.cut + 0.01, T).phase === 'fall' && skyPhase(T.land + 0.01, T).phase === 'land' && skyPhase(T.len, T).phase === 'done', `${lv}: phases follow the clock`);
  }
  ok(skyTimes('short').len < skyTimes('full').len, 'the short sky fall is shorter');
  ok(fallHeight(0, 50) === 50 && fallHeight(1, 50) === 0, 'the fall starts at the top and lands at 0');
  let down = true;
  for (let u = 0; u < 1; u += 0.05) if (fallHeight(u + 0.05, 50) > fallHeight(u, 50)) down = false;
  ok(down, 'the hero only ever falls');
  ok(fallHeight(0.1, 50) - fallHeight(0.2, 50) > fallHeight(0.8, 50) - fallHeight(0.9, 50), 'fastest out of the portal');
  const l0 = leapPose(0);
  const l1 = leapPose(1);
  ok(l0.along === 0 && l1.along === 1 && l0.scale === 1 && l1.scale < 0.1, 'the leap goes all the way into the portal and shrinks into it');
  ok(leapPose(0.4).y > 1, 'the leap arcs up');
  ok(cloudCover(0) === 1 && cloudCover(0.05) === 1 && cloudCover(0.3) < 1 && cloudCover(0.9) === 0, 'a white-out at the cut, clear air before touchdown');
  const T = skyTimes('full');
  ok(assemblyDelay(0, T) < assemblyDelay(30, T) && assemblyDelay(60, T) <= T.len - skyfallTuning.tileRise + 1e-9, 'the arena assembles outward from the landing spot and is done by the end');
  ok(assemblyDelay(0, T) > T.cut, 'nothing assembles before the new stage exists');
  ok(riseOffset(-1, 2, 0.4) === -2 && riseOffset(0.4, 2, 0.4) === 0 && riseOffset(0.2, 2, 0.4) > -2, 'tiles rise from below and settle exactly at 0');

  // Ending.
  for (const short of [false, true]) {
    const len = endingLength(short);
    ok(len > 4 && len < 16, `ending ${short ? '(short) ' : ''}lasts ${len.toFixed(1)} s`);
    const seen = new Set<number>();
    let last = 0;
    let mono = true;
    for (let t = 0; t < len; t += 0.05) {
      const f = endingFrame(t, short);
      seen.add(f.panel);
      if (f.panel < last) mono = false;
      last = f.panel;
      if (f.fade < 0 || f.fade > 1 || f.k < 0 || f.k > 1) mono = false;
    }
    ok(seen.size === ENDING_PANELS.length && mono, `every panel shows, in order (${[...seen].join(',')})`);
    ok(endingFrame(len + 0.01, short).done, 'done after its length');
  }
  ok(endingLength(true) < endingLength(false), 'the short ending is shorter');
  ok(ENDING_PANELS[ENDING_PANELS.length - 1].id === 'end', 'it ends on THE END? card');

  // Jackpot.
  const rng = new Rng(7);
  let gold = 0;
  let items = 0;
  for (let i = 0; i < 400; i++) {
    const p = jackpotPlan(rng, 3);
    if (p.kind === 'gold') {
      gold++;
      if (p.gold <= 0) items = -9999;
    } else if (p.items >= 2) items++;
  }
  ok(gold > 80 && items > 120, `jackpots pay a gold pile or several items (${gold} / ${items} of 400)`);
  const a = jackpotPlan(new Rng(99), 2);
  const b = jackpotPlan(new Rng(99), 2);
  ok(JSON.stringify(a) === JSON.stringify(b), 'the payout comes from the seeded RNG (same seed, same jackpot)');
  const share = jackTune0.goldShare;
  jackTune0.goldShare = 1;
  ok(jackpotPlan(new Rng(1), 5).gold > jackpotPlan(new Rng(1), 1).gold, 'the gold pile grows with the stage');
  jackTune0.goldShare = share;
  for (const short of [false, true]) {
    const r = reelTimes(short);
    ok(r.stops[0] < r.stops[1] && r.stops[1] < r.stops[2] && r.stops[2] < r.len, `reels stop left to right before the end (${short ? 'short' : 'full'})`);
    let mono2 = true;
    for (let t = 0; t <= r.stops[2] + 0.2; t += 1 / 60) if (reelScroll(t + 1 / 60, r.stops[2], 30) < reelScroll(t, r.stops[2], 30) - 1e-9) mono2 = false;
    ok(mono2 && Math.abs(reelScroll(r.stops[2], r.stops[2], 30) - 30) < 1e-9 && Math.abs(reelScroll(r.stops[2] - 1e-4, r.stops[2], 30) - 30) < 0.01, 'a reel spins forward and eases exactly onto its symbol');
  }
  let lit = 0;
  for (let i = 0; i < 44; i++) if (bulbLit(i, 44, 0.5, false)) lit++;
  ok(lit > 2 && lit < 20, `frame lights chase (${lit}/44 lit)`);
  ok(goldenGold(4) > goldenGold(1), 'the golden route pays more later');
  let inside = 0;
  for (let i = 0; i < 100; i++) {
    const c = confettiAt(i, 0.8);
    if (c.x > -0.1 && c.x < 1.1 && c.y < 1.05) inside++;
  }
  ok(inside > 60, `confetti flies up into the screen (${inside}/100)`);
}

// ---------------------------------------------------------------- the real game (jsdom)
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

const THREE = await import('three');
const { Input } = await import('../src/core/input');
const { Game, cheats, LOOP_STAGES } = await import('../src/game/game');
const { settings } = await import('../src/game/settings');
const { ArenaAssembly } = await import('../src/game/cineWorld');
const { cineState, debugEnding, debugFlawless, debugGainWindow, debugJackpotChest, debugSkyfall, legendaryOwned } = await import('../src/game/systems/cinematics');
const { jackpotTuning, resetRevealed, revealedBefore, titlePlayTuning } = await import('../src/game/cinematics');
const { navLock, titlePlayState } = await import('../src/game/titlePlay');
const { attractRunning } = await import('../src/game/systems/attract');
const { save } = await import('../src/game/save');
const { WEAPONS } = await import('../src/data/weapons');

const input = new Input(document.getElementById('game') as HTMLCanvasElement);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
cheats.unlockAll = true;
cheats.god = true;
settings.bossIntros = false;
settings.deathReplay = false;
resetRevealed();
const s = cineState(game);
const step = (n: number, pick = true) => {
  for (let i = 0; i < n; i++) {
    game.update(1 / 60);
    if (pick && game.mode === 'levelup') (game as unknown as { ui(a: string, i: number): void }).ui('pick', 0);
  }
};
const fresh = () => {
  game.startSolo();
  if (game.mode === 'shop') game.closeShop();
  game.xpNext = 1e12;
  step(2);
};
const key = (code: string) => {
  window.dispatchEvent(new (window as any).KeyboardEvent('keydown', { code }));
  window.dispatchEvent(new (window as any).KeyboardEvent('keyup', { code }));
};

// Arena assembly: every tile and prop goes down, then back exactly where it was.
{
  fresh();
  const group = game.arena.group;
  const snap = () => {
    const out: number[] = [];
    for (const c of group.children) {
      out.push(c.position.y);
      const m = c as InstanceType<typeof THREE.Mesh>;
      const pos = m.isMesh ? (m.geometry.getAttribute('position') as InstanceType<typeof THREE.BufferAttribute> | undefined) : undefined;
      if (pos) for (let i = 0; i < pos.array.length; i += 97) out.push(pos.array[i]);
    }
    return out.join(',');
  };
  const before = snap();
  const asm = new ArenaAssembly();
  const T = skyTimes('full');
  asm.start(group, 0, 0, T);
  const counts = asm.debugCounts();
  ok(counts.ground >= 1 && counts.props >= 3, `the assembly finds the ground tiles and standing pieces (${counts.ground} ground meshes, ${counts.tiles} tiles, ${counts.props} props)`);
  asm.update(T.cut + 0.05);
  ok(snap() !== before, 'before its wave reaches them the arena is taken apart');
  asm.update(assemblyDelay(0, T) + 0.2);
  ok(!asm.done, 'mid-wave it is still assembling');
  asm.update(T.len + 1);
  ok(asm.done && snap() === before, 'by the end everything is back exactly');
  asm.start(group, 0, 0, T);
  asm.update(T.cut + 0.5);
  asm.finish();
  ok(snap() === before, 'finishing early (a skip) also puts everything back');
}

// Sky fall: the portal leads into a 3-4 s fall; the stage loads at the cut.
{
  fresh();
  settings.cinematics = 'full';
  const stage = game.stage;
  debugSkyfall(game);
  const T = skyTimes('full');
  step(Math.floor(T.cut * 60) - 3);
  ok(game.mode === 'transition' && game.stage === stage, 'during the leap the old stage is still there');
  step(6);
  ok(game.stage === stage + 1 && game.mode === 'transition', 'at the cut the next stage is built (behind the white-out)');
  step(Math.ceil((T.land - T.cut) * 60) - 4);
  const live = () => (game.particles as unknown as { alive: number }).alive;
  const parts = live();
  game.renderCinematics(1 / 60); // touchdown effects are cosmetic, from the render side
  step(6);
  game.renderCinematics(1 / 60);
  ok(s.sky?.landed === true && live() > parts, `touchdown kicks up dust (${parts} -> ${live()} particles)`);
  step(Math.ceil((T.len - T.land) * 60) + 2);
  ok(game.mode === 'fight' && !s.sky, `the fight starts after ${T.len} s, with nothing left playing`);
  ok(game.modeT < 1.2, 'the fight clock starts like after the old fade');

  // Skippable.
  debugSkyfall(game);
  step(45);
  key('Space');
  step(3);
  ok(game.mode === 'fight' && game.stage === stage + 2, 'a key press skips straight into the next stage');

  // SHORT and OFF.
  settings.cinematics = 'short';
  debugSkyfall(game);
  let n = 0;
  while (game.mode === 'transition' && n < 600) {
    step(1);
    n++;
  }
  ok(n <= Math.ceil(skyTimes('short').len * 60) + 2, `SHORT: ${(n / 60).toFixed(2)} s`);
  settings.cinematics = 'off';
  debugSkyfall(game);
  n = 0;
  while (game.mode === 'transition' && n < 600) {
    step(1);
    n++;
  }
  ok(n <= 52 && !s.sky, `OFF: the old 0.8 s fade (${(n / 60).toFixed(2)} s)`);
  settings.cinematics = 'full';
}

// The ending: plays on the final boss's VICTORY, holds solo, then the shop as usual.
{
  fresh();
  game.loadStage(LOOP_STAGES);
  step(2);
  game.stageClear();
  ok(game.mode === 'cleared', 'test setup: the final boss stage is clear');
  step(Math.ceil(1.7 * 60));
  ok(!!s.end, 'the painterly ending starts after VICTORY');
  ok(!document.querySelector('#cine .cn-end')!.hasAttribute('hidden'), 'its overlay is up');
  const t0 = game.modeT;
  step(120);
  ok(game.mode === 'cleared' && game.modeT === t0, 'solo: the world holds while it plays');
  key('Enter');
  step(2);
  ok(!s.end, 'any key skips it');
  step(60);
  ok(game.mode === 'shop', 'then the shop opens as usual');
  // Plays to its end without a skip, bounded.
  debugEnding(game);
  let n = 0;
  while (s.end && n < 2000) {
    step(1, false);
    n++;
  }
  ok(n > 4 * 60 && n < 16 * 60, `unskipped it ends on its own (${(n / 60).toFixed(1)} s)`);
}

// Legendary reveal: the first legendary of a run, and anything never revealed before.
{
  fresh();
  resetRevealed();
  step(10);
  const star = WEAPONS.starfall ? 'starfall' : Object.values(WEAPONS).find((w) => !w.slot && w.rarity === 'legendary')!.id;
  const fusion = Object.values(WEAPONS).find((w) => w.fusion)!.id;
  game.debugGiveWeapon(fusion);
  step(8);
  ok(!s.reveal, `a legendary that arrives outside a pick, chest or jackpot (debug, scripts) plays nothing (${fusion})`);
  game.debugGiveWeapon(star);
  debugGainWindow(game); // what closing the level-up menu does
  step(8);
  ok(!!s.reveal && s.reveal.item.key === `w:${star}`, `gaining ${star} from a pick plays the reveal`);
  ok(revealedBefore(`w:${star}`), 'and remembers it on this machine');
  const x = game.enemies.list.find((e) => e.active)?.x;
  const t0 = game.runTime;
  step(60);
  ok(game.runTime === t0 && (x === undefined || game.enemies.list.find((e) => e.active)?.x === x), 'solo: the world pauses briefly');
  step(200);
  ok(!s.reveal && game.runTime > t0, 'then the run goes on');
  // Second legendary of the run, already seen before: no cinematic.
  game.hero.passives.vampire = 1;
  game.hero.recomputeStats();
  debugGainWindow(game);
  resetRevealed();
  (await import('../src/game/cinematics')).markRevealed('p:vampire');
  step(8);
  ok(!s.reveal, 'a later legendary you have revealed before plays nothing');
  ok(legendaryOwned(game.hero).some((r) => r.key === 'p:vampire'), 'legendary items count');
  // New run: its first legendary always plays.
  fresh();
  step(10);
  game.debugGiveWeapon(star);
  debugGainWindow(game);
  step(8);
  ok(!!s.reveal, 'the first legendary of a new run plays again, even if seen before');
  step(30);
  key('Space');
  step(30);
  ok(!s.reveal, 'skippable');
}

// Jackpot chest: golden chests roll on the host's seeded RNG and pay out.
{
  fresh();
  const old = jackpotTuning.chance;
  jackpotTuning.chance = 1;
  game.chestT = 1e6;
  step(2);
  ok(s.chests.length === 1, 'a chest spawn can roll a golden chest');
  game.chestT = 1e6;
  step(2);
  ok(s.chests.length === 1 && game.chests.list.length >= 1, `at most ${jackpotTuning.perStage} a stage; the rest are normal chests`);
  jackpotTuning.chance = old;
  s.chests = [];
  jackpotTuning.goldShare = 1;
  const gold = game.hero.gold;
  debugJackpotChest(game, game.hero.player.x, game.hero.player.z);
  step(2);
  ok(game.hero.gold > gold, `walking into it pays a gold pile (+${game.hero.gold - gold})`);
  ok(!!s.jack && !document.querySelector('#cine .cn-jack')!.hasAttribute('hidden'), 'and spins the slot machine');
  const t0 = game.runTime;
  step(60);
  ok(game.runTime === t0, 'solo: the world holds while the reels spin');
  key('Space');
  step(2);
  key('Space');
  step(30);
  ok(!s.jack, 'two presses land the reels and close it');
  jackpotTuning.goldShare = 0;
  const lv = JSON.stringify(game.hero.passives) + game.hero.weapons.map((w) => w.level).join();
  const g2 = game.hero.gold;
  debugJackpotChest(game, game.hero.player.x, game.hero.player.z);
  step(2);
  ok(JSON.stringify(game.hero.passives) + game.hero.weapons.map((w) => w.level).join() !== lv || game.hero.gold > g2, 'the item jackpot pays several chest items');
  jackpotTuning.goldShare = 0.4;
  step(400);
}

// Flawless: confetti, FLAWLESS!, a golden portal, a bonus at the next stage.
{
  fresh();
  const stage = game.stage;
  debugFlawless(game, true);
  step(2);
  ok(!!s.flaw, 'a clear without a hit plays the FLAWLESS! moment');
  ok(game.mode === 'portal' && !!s.portal?.active, 'a golden portal opens next to the normal one');
  ok(Math.hypot(s.portal!.x - game.portal.x, s.portal!.z - game.portal.z) > 1.5, 'apart from it');
  const gold = game.hero.gold;
  const chests = game.chests.list.length;
  game.hero.player.teleport(s.portal!.x, s.portal!.z);
  step(40);
  ok(game.mode === 'transition' && s.goldenRide, 'stepping in takes the golden route');
  step(Math.ceil(skyTimes('full').len * 60) + 5);
  ok(game.stage === stage + 1 && game.mode === 'fight', 'into the next stage');
  ok(game.hero.gold > gold && game.chests.list.length > chests, `with bonus gold (+${game.hero.gold - gold}) and a treasure chest`);
  // A hit means no golden portal.
  game.damagedThisStage = true;
  game.stageClear();
  game.preShop = false;
  game.openPortal();
  step(4);
  ok(!s.portal?.active, 'a stage with a hit gets no golden portal');
}

// Playable title: moving takes the demo hero, idle hands it back; menus keep the arrows.
{
  game.leaveToTitle();
  step(10, false);
  ok(navLock.move, 'on the title, WASD and the stick belong to the demo hero');
  window.dispatchEvent(new (window as any).KeyboardEvent('keydown', { code: 'KeyD' }));
  step(30, false);
  const tp = titlePlayState(game);
  ok(tp.controlled && attractRunning(game), 'pressing a move key takes the hero (and starts the demo at once)');
  const x0 = game.hero.player.x;
  step(40, false);
  ok(game.hero.player.x > x0 + 1, `the hero runs where you steer (${(game.hero.player.x - x0).toFixed(1)} m)`);
  ok(game.screens.current === 'title', 'the menu stays on the title');
  window.dispatchEvent(new (window as any).KeyboardEvent('keyup', { code: 'KeyD' }));
  const ach = save.achievements.length;
  step(Math.ceil(titlePlayTuning.idle * 60) + 10, false);
  ok(!tp.controlled, 'idle: the bot takes over again');
  ok(save.achievements.length === ach, 'nothing is saved or counted');
  // Arrow keys still move the menu.
  const nav = document.querySelector('#scr-title .focused')?.textContent;
  key('ArrowDown');
  step(2, false);
  ok(document.querySelector('#scr-title .focused')?.textContent !== nav, 'the arrow keys still navigate the menu');
  key('KeyS');
  const nav2 = document.querySelector('#scr-title .focused')?.textContent;
  step(2, false);
  ok(document.querySelector('#scr-title .focused')?.textContent === nav2, 'S moves the hero, not the menu');
  game.startSolo();
  step(2);
  ok(!navLock.move, 'in a run the menus get WASD back');
}
