/**
 * Firstten lane: FIRST STEPS goals, next-try advice, early XP, tip ordering, save migration,
 * and in the real game (jsdom, no WebGL) the first chest, guided heads-ups, helpers and the game-over card.
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

const { CODEX_TABS, codexEntries, codexCount, isCodexKey } = await import('../src/data/arsenal');

const F = await import('../src/game/firstten');
const { tipInsertAt } = await import('../src/game/tips');
const { xpForLevel, cheats } = await import('../src/game/game');
const { save, normalize } = await import('../src/game/save');
const { settings } = await import('../src/game/settings');
const { ACHIEVEMENTS } = await import('../src/data/meta');
const { SKINS } = await import('../src/data/skins');
const { MOD_BY_ID } = await import('../src/data/mods');
const { ENEMIES } = await import('../src/data/enemies');

// ---------------------------------------------------------------- pure rules
{
  ok(xpForLevel(1) < 6 && xpForLevel(2) < 15 && xpForLevel(4) === Math.round(6 + 8 * 3 + 1.4 * 9), `first levels are cheaper, later ones unchanged (lv1 ${xpForLevel(1)}, lv2 ${xpForLevel(2)}, lv3 ${xpForLevel(3)})`);
  ok(F.isGuided(0, true, 'standard') && F.isGuided(2, true, 'standard') && !F.isGuided(3, true, 'standard'), 'the first 3 runs are guided');
  ok(!F.isGuided(0, false, 'standard') && !F.isGuided(0, true, 'endless'), 'online and other modes are never guided');
  ok(F.FIRST_SHOP.every((id) => !!MOD_BY_ID[id] && !MOD_BY_ID[id].cursed), 'the first starting shop only offers real, uncursed Mods');
  ok(ACHIEVEMENTS.some((a) => a.id === F.FIRST_TEN_REWARD.achievement) && SKINS.some((s) => s.id === F.FIRST_TEN_REWARD.skin && s.unlock === F.FIRST_TEN_REWARD.achievement), 'the checklist reward is an achievement that unlocks the Star Cadet skin');

  const s = F.freshFirstTen();
  ok(F.tickGoals(s, ['run', 'chest']).length === 2 && F.tickGoals(s, ['run']).length === 0, 'goals tick once');
  ok(!F.allGoalsDone(s) && F.checklistVisible(s), 'two goals is not done; the checklist shows');
  F.tickGoals(s, F.GOALS.map((g) => g.id));
  ok(F.allGoalsDone(s), 'all goals done');

  ok(F.normalizeFirstTen(undefined, 0).hidden === false && F.normalizeFirstTen(undefined, 12).hidden === true, 'old saves: new players see the checklist, veterans (5+ runs) start with it hidden');
  const n = F.normalizeFirstTen({ done: ['run', 'bogus', 'run'], hidden: 0, claimed: true, seen: ['levelup', 3] }, 0);
  ok(n.done.join() === 'run' && n.claimed && n.seen.join() === 'levelup', 'normalize drops junk and duplicates');
  const v = normalize({ version: 4, lifetime: { runs: 9, kills: 10, elites: 0, bosses: 0, bestStage: 1, bestLevel: 3, playTime: 0 } });
  ok(!!v.firstten && v.firstten.hidden, 'a v4 save without the field loads (veteran: hidden)');
  ok(normalize(null).firstten.done.length === 0 && !normalize(null).firstten.hidden, 'a fresh save gets an empty checklist');

  const keys = { dash: 'SPACE', parry: 'C', special: 'Q' };
  const base = { stage: 1, stageTime: 120, level: 8, dashes: 20, boss: false, runs: 1, keys };
  const rhino = F.nextTryFor({ ...base, cause: 'Rhino' });
  ok(rhino.tip.includes('Rhino') && rhino.tip.includes('SPACE'), `killed by a Rhino: "${rhino.tip}"`);
  ok(F.nextTryFor({ ...base, cause: 'Enemy fire' }).tip.includes('parried back (C)'), 'enemy fire: dash or parry');
  ok(F.nextTryFor({ ...base, cause: 'King Bopper', boss: true }).why === 'behavior:boss', 'a boss: telegraph advice');
  ok(F.nextTryFor({ ...base, cause: 'Swarmer', stageTime: 40, dashes: 0 }).why === 'early-nodash', 'died early without dashing: dash advice wins');
  ok(F.nextTryFor({ ...base, cause: 'Unknown thing', level: 3, stageTime: 150 }).why === 'low-level', 'unknown cause, low level: grab XP');
  ok(F.nextTryFor({ ...base, cause: 'Swarmer', runs: 0 }).cheer.includes('FIRST RUN'), 'the first run gets its own cheer');
  ok(F.nextTryFor({ ...base, cause: 'Swarmer', stage: 3 }).cheer.includes('STAGE 3'), 'a later stage is celebrated');
  const behaviors = new Set(Object.values(ENEMIES).filter((d) => d.minMinute >= 0 || d.boss).map((d) => d.behavior));
  const missing = [...behaviors].filter((b) => F.nextTryFor({ ...base, cause: Object.values(ENEMIES).find((d) => d.behavior === b)!.name }).why === 'default');
  ok(missing.length === 0, `every spawning enemy behaviour has advice (missing: ${missing.join(',') || 'none'})`);

  // Tip order: telegraphs before trivia, same priority keeps arrival order.
  ok(tipInsertAt('boss', ['style', 'gear']) === 0 && tipInsertAt('style', ['boss', 'gear']) === 2 && tipInsertAt('elite', ['boss', 'chest', 'style']) === 1, 'tips are queued by priority');
}

// ---------------------------------------------------------------- the real game
const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { installBot } = await import('../src/dev/bot');
save.lifetime.runs = 0;
save.firstten = F.freshFirstTen();
save.tips = [];
settings.tips = true;
const input = new Input(document.getElementById('game') as HTMLCanvasElement);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const ft = game.firstten;
installBot(game, input);
const botStep = (globalThis as any).window.botStep as () => void;
const step = (n: number) => {
  for (let i = 0; i < n; i++) game.update(1 / 60);
};
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);

ok(!$('#scr-title .ft-list')!.hidden && $('#scr-title .ft-list')!.textContent!.includes('0/8'), 'a fresh save shows FIRST STEPS 0/8 on the title');
game.screens.show('modes');
ok(!$('#scr-modes .ft-quick')!.hidden, 'PLAY SOLO offers QUICK START to a new player');

settings.mode = 'standard';
settings.difficulty = 'normal';
game.startSolo();
step(1);
ok(ft.guided, 'the first solo Standard run is guided');
ok(game.mode === 'shop' && game.hero.shopOffers[0]?.id === F.FIRST_SHOP[0] && !!$('#scr-shop .ft-pick') && !$('#scr-shop .ft-help')!.hidden, 'first starting shop: simple Mods, GOOD FIRST PICK and the helper strip');
ok(save.tips.includes('shop'), 'the helper replaces the shop tip (no pile-up)');
const before = game.hero.shopOffers.map((m) => m?.id).join();
(game as unknown as { ui(a: string, i: number): void }).ui('sreroll', 0);
ok(game.hero.shopOffers.map((m) => m?.id).join() !== before, 'a reroll still rolls the normal pool');
game.closeShop();
step(2);
ok($('#scr-shop .ft-pick') === null, 'the badge goes away with the shop');
cheats.god = true;
const p = game.hero.player;
let chestAt = -1;
let chestDist = -1;
let ringToast = false;
let eliteToast = false;
const hudToast = game.hud.toast.bind(game.hud);
game.hud.toast = (m: string, s?: number) => {
  if (m.includes('SURROUNDED')) ringToast = true;
  if (m.includes('ELITE IS COMING')) eliteToast = true;
  hudToast(m, s);
};
for (let i = 0; i < 60 * 50 && game.director.time < 48; i++) {
  botStep(); // the dev bot plays (and picks the first card)
  if (chestAt < 0 && game.chests.closedCount > 0) {
    chestAt = game.director.time;
        chestDist = Math.hypot(game.chests.list[0].x - p.x, game.chests.list[0].z - p.z);
  }
}
ok(chestAt >= F.firstTenTuning.firstChestAt && chestAt < F.firstTenTuning.firstChestAt + 0.5, `the first chest lands at ${chestAt.toFixed(1)} s`);
ok(chestDist > 3 && chestDist < 10, `and it lands in view, ${chestDist.toFixed(1)} m from the hero`);
ok(game.level >= 2, `level 2 within 48 s of a guided run (level ${game.level})`);
ok(ringToast, 'the first swarm ring tells a new player to use the special');
ok(eliteToast, 'a heads-up before the first elite');
ok(!!$('#scr-levelup.ft-first') === false, 'the level-up helper strip is gone once the menu closes');
ok(save.firstten.seen.includes('levelup') && save.tips.includes('levelup'), 'the first level-up showed its helper (and it replaces the level-up tip)');

// Tips never pile up: the second in-fight tip waits for the gap after the first.
{
  const ob = game.onboarding as unknown as { tip: { id: string } | null; queue: string[]; closeTip(): void; want(id: string): void };
  ob.closeTip();
  ob.queue.length = 0;
  save.tips = save.tips.filter((t) => t !== 'style' && t !== 'gear' && t !== 'boss');
  ob.want('style');
  ob.want('gear');
  ob.want('boss');
  ok(ob.queue[0] === 'boss', 'a boss tip jumps ahead of trivia');
  let first = '', second = '';
  let t1 = -1, t2 = -1;
  for (let i = 0; i < 60 * 30 && !second; i++) {
    botStep();
    const id = ob.tip?.id ?? '';
    if (id && !first) (first = id), (t1 = i);
    else if (id && first && id !== first && !second) (second = id), (t2 = i);
  }
  ok(first === 'boss' && !!second, `tips show one at a time (${first} then ${second})`);
  ok(t2 - t1 >= 60 * F.firstTenTuning.tipGap, `with a gap between them (${((t2 - t1) / 60).toFixed(1)} s apart)`);
}

// Goals tick in the run, with a toast.
game.level = Math.max(game.level, 5);
for (let i = 0; i < 31; i++) botStep();
ok(save.firstten.done.includes('level5'), 'REACH LEVEL 5 ticks during the run');

// Death: the NEXT TRY card, RETRY on top.
settings.deathReplay = false;
cheats.god = false;
const h = game.hero;
h.revivesLeft = 0;
p.invuln = 0;
h.lastHitBy = 'Rhino';
h.dashes = 10;
if (p.hurt(p.hp + 1, 0, 1)) game.onHeroDown(h);
for (let i = 0; i < 60 * 8 && !['gameover', 'mvp'].includes(game.screens.current); i++) game.update(1 / 60);
ok(['gameover', 'mvp'].includes(game.screens.current), 'the run ends on game over');
if (game.screens.current === 'mvp') game.screens.show('gameover'); // the MVP awards come first; CONTINUE leads to game over
const next = $('#scr-gameover .ft-next')!;
ok(!next.hidden && next.textContent!.includes('Rhino') && next.textContent!.includes('FIRST RUN'), 'game over: an encouraging line and the Rhino tip');
ok(next.nextElementSibling?.querySelector('[data-act=retry]') !== null, 'RETRY sits right under the card');
ok(save.firstten.done.includes('run'), 'PLAY A RUN ticks at game over');

// All goals: the reward.
save.firstten.done = F.GOALS.filter((g) => g.id !== 'coop').map((g) => g.id);
game.leaveToTitle();
ok($('#scr-title .ft-list')!.textContent!.includes('7/8'), 'the title shows the progress');
(ft as unknown as { tick(ids: string[], inRun: boolean): void }).tick(['coop'], false);
ok(save.achievements.includes('graduate'), 'finishing every goal grants Graduate (Star Cadet armour)');
game.screens.show('title');
ok($('#scr-title .ft-list')!.textContent!.includes('ALL DONE'), 'the title celebrates once');
$('#scr-title [data-act=ft-claim]')!.click();
ok(save.firstten.claimed && $('#scr-title .ft-list')!.hidden, 'AWESOME! closes it for good');
