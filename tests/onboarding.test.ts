/**
 * Onboarding lane: codex data, unlock progress, tips rules, the run recorder,
 * save migration, and in the real game (jsdom, no WebGL) the TRAINING field
 * end to end, first-time tips, codex discovery and the game-over extras.
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
const { closestUnlocks, unlockProgress } = await import('../src/data/unlockProgress');
const { TIPS, tipWanted, tipTime } = await import('../src/game/tips');
const { RunRecorder, stageDps } = await import('../src/game/runRecap');
const { save, importFile, exportFile } = await import('../src/game/save');
const { WEAPONS } = await import('../src/data/weapons');
const { MODS } = await import('../src/data/mods');

// ---------------------------------------------------------------- codex data
{
  const all = codexEntries();
  const keys = new Set(all.map((e) => e.key));
  ok(keys.size === all.length, `codex keys are unique (${all.length} entries)`);
  ok(CODEX_TABS.every((t) => codexCount(t.id, []).total > 0), 'every codex tab has entries');
  ok(codexCount('weapons', []).total === Object.keys(WEAPONS).length, 'codex lists every weapon');
  ok(codexCount('mods', []).total === MODS.length, 'codex lists every Mod');
  ok(codexCount('statuses', []).total === 7, 'codex lists the 7 statuses and combos');
  ok(codexCount('evolutions', []).total >= 30, `codex lists loadout and auto evolutions (${codexCount('evolutions', []).total})`);
  ok(codexCount('weapons', ['w:buster', 'w:drones', 'm:echo']).have === 2, 'codex counts discovered per tab');
  ok(isCodexKey('e:buster:1') && isCodexKey('e:drones:auto') && isCodexKey('s:napalm') && !isCodexKey('w:nope'), 'codex key scheme');
  ok(all.every((e) => e.name && e.desc && e.icon), 'every codex entry has a name, text and icon');
}

// ---------------------------------------------------------------- unlock progress
{
  const run = { stage: 2, dashes: 40, weapons: 3, bosses: 1, mode: 'standard', difficulty: 'normal' };
  const L = { kills: 250, elites: 18, bosses: 1, bestStage: 2 };
  const list = unlockProgress(L, run, ['boss_slayer', 'stage_2']);
  const rail = list.find((p) => p.id === 'elite_slayer')!;
  ok(rail.label === 'Rail Driver' && rail.cur === 18 && rail.max === 25 && rail.unit === 'elites', 'elite slayer reads "Rail Driver: 18/25 elites"');
  ok(!list.some((p) => p.id === 'boss_slayer'), 'done achievements are left out');
  ok(!list.some((p) => p.id === 'hard_stage3' || p.id === 'endless_5'), 'mode feats only show for that mode');
  const top = closestUnlocks(L, run, ['boss_slayer', 'stage_2'], 3);
  ok(top.length === 3 && top[0].frac >= top[1].frac && top[1].frac >= top[2].frac, 'closest unlocks sorted by progress');
  ok(top[0].id === 'first_steps', `closest is First Steps at 250/300 (got ${top[0].id})`);
}

// ---------------------------------------------------------------- tips
{
  ok(tipWanted('elite', true, [], []) && !tipWanted('elite', false, [], []), 'tips off in settings: none');
  ok(!tipWanted('elite', true, ['elite'], []) && !tipWanted('elite', true, [], ['elite']), 'a tip shows once (seen or queued)');
  ok(Object.values(TIPS).every((t) => tipTime(t) >= 5 && tipTime(t) <= 10 && t.text().length > 20), 'tip texts and times');
}

// ---------------------------------------------------------------- run recorder
{
  const r = new RunRecorder();
  const s = (stage: number, time: number, extra: Partial<Parameters<typeof r.sample>[0]> = {}) =>
    r.sample({ stage, level: stage * 5, kills: time * 2, time, damage: time * 100, gold: 0, preShop: false, boss: false, ...extra });
  r.sample({ stage: 1, level: 1, kills: 0, time: 0, damage: 0, gold: 15, preShop: true, boss: false });
  r.sample({ stage: 1, level: 1, kills: 0, time: 0, damage: 0, gold: 3, preShop: true, boss: false });
  s(1, 0, { gold: 0 });
  s(1, 100, { gold: 10 });
  s(1, 120, { gold: 4 }); // spent 6: not income
  s(1, 200, { gold: 9, boss: true });
  s(1, 230, { gold: 9, boss: false });
  s(2, 260, { gold: 20 });
  s(2, 300, { gold: 20, boss: true });
  ok(r.stages.length === 2, 'recorder opens a row per stage');
  const [a, b] = r.stages;
  ok(a.gold === 15, `gold counts income only, not the free starting gold (got ${a.gold})`);
  ok(a.bossTime === 30 && a.time === 230 && a.kills === 460, `stage 1 boss 30 s, time and kills (got ${a.bossTime}, ${a.time}, ${a.kills})`);
  ok(b.bossTime === -1 && b.time === 40 && b.gold === 11, 'stage 2 counts from its own start; boss not beaten yet');
  ok(Math.round(stageDps(a)) === 100, 'dps over a stage');
}

// ---------------------------------------------------------------- save migration
{
  importFile(JSON.stringify({ game: 'InfiniShoot', save: { version: 3, achievements: ['first_steps'], seen: [], history: [], lifetime: { runs: 4, kills: 900 } } }));
  ok(Array.isArray(save.tips) && Array.isArray(save.discovered) && save.training.offered === false && save.achievements.includes('first_steps'), 'a v3 save loads with empty tips, codex and training');
  save.tips = ['boss'];
  save.discovered = ['w:buster'];
  save.training = { offered: true, done: true };
  const text = exportFile();
  importFile(text);
  ok(save.tips[0] === 'boss' && save.discovered[0] === 'w:buster' && save.training.done, 'v4 fields survive save to file and back');
  ok(JSON.parse(text).save.version === 4, 'save version 4');
}

// ---------------------------------------------------------------- in the game
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { Team } = await import('../src/game/bullets');
const { ENEMIES } = await import('../src/data/enemies');
const { settings } = await import('../src/game/settings');
const { TRAINING_STEPS } = await import('../src/game/training');

// A fresh profile for the in-game checks.
save.lifetime.runs = 0;
save.training = { offered: false, done: false };
save.tips = [];
save.discovered = [];
settings.tips = true;

const input = new Input(document.getElementById('game') as HTMLCanvasElement);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const ob = game.onboarding;
const ui = (a: string, i = 0) => (game as unknown as { ui(a: string, i: number): void }).ui(a, i);
const step = (n: number) => {
  for (let i = 0; i < n; i++) game.update(1 / 60);
};
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);

ok(save.training.offered && !$('#scr-title .ob-offer')!.hidden, 'a fresh save is offered training on the title once');
game.screens.show('title');
ok($('#scr-title .ob-offer')!.hidden, 'the offer does not come back');
ok(!!$('#scr-title [data-act=ob-training]') && !!$('#scr-extras [data-act=ob-codex]') && !!$('#scr-settings [data-act=ob-tips]'), 'TRAINING, CODEX and TIPS buttons are in their menus');

// ---------------------------------------------------------------- training, step by step
const godBefore = cheats.god;
ob.startTraining();
const t = ob.training!;
ok(!!t && game.mode === 'fight' && cheats.god, 'training starts a safe run');
ok(!$('#ob-train')!.hidden && $('#ob-train')!.textContent!.includes('MOVE'), 'the training prompt shows step 1');
const h = game.hero;
const p = h.player;
const waitStep = (id: string, act: () => void, max = 600) => {
  for (let i = 0; i < max && ob.training?.current.id === id; i++) {
    act();
    game.update(1 / 60);
  }
  return ob.training?.current.id !== id;
};
const near = (n: number) => {
  for (let i = 0; i < game.bullets.count; i++) if (game.bullets.team[i] === Team.Enemy && Math.hypot(game.bullets.x[i] - p.x, game.bullets.z[i] - p.z) < n) return true;
  return false;
};
const passed: string[] = [];
const check = (id: string, act: () => void) => {
  const done = waitStep(id, act);
  if (done) passed.push(id);
  ok(done, `training step ${id} completes by doing it`);
};
let k = 0;
check('move', () => {
  p.pos.x += 0.12;
  k++;
});
ok(game.enemies.activeCount === 0 || ob.training!.current.id === 'fire', 'the director spawns nothing in training');
check('fire', () => {
  for (const e of ob.training!.bots) if (e.active) game.killEnemy(e, 'buster', h);
});
check('right', () => {
  for (const e of ob.training!.bots) if (e.active) game.expose(e);
});
check('dash', () => {
  if (near(2.5)) game.onDash(h);
});
check('parry', () => {
  if (near(1.4)) game.tryParry(h);
});
check('special', () => game.tryBomb(h));
check('ult', () => game.tryUlt(h));
check('levelup', () => {
  if (game.mode === 'levelup' && game.screens.canPick(0)) ui('pick', 0);
  else if (game.mode === 'levelup') (game.screens as any).lockUntil = 0;
});
ok(game.mode === 'fight', 'the level-up card closes back to the field');
// The last step finishes training: walk into the chest.
for (let i = 0; i < 400 && game.screens.current !== 'training'; i++) {
  const c = game.chests.list.find((x) => x.openT < 0);
  if (c) {
    p.pos.x = p.prev.x = c.x;
    p.pos.z = p.prev.z = c.z;
  }
  game.update(1 / 60);
}
ok(passed.length === TRAINING_STEPS.length - 1 && game.screens.current === 'training' && save.training.done, `all ${TRAINING_STEPS.length} steps done, "you're ready" shows`);
const hpBefore = p.hp;
step(30);
ok(game.paused && p.hp === hpBefore, 'the world waits behind the ready screen');
(document.querySelector('[data-act=ob-title]') as HTMLElement).click();
ok(game.mode === 'title' && !ob.training && cheats.god === godBefore && $('#ob-train')!.hidden, 'leaving training restores god mode and hides the prompt');
const runsBefore = save.lifetime.runs;
ob.startTraining(3);
ok(ob.training!.current.id === 'dash', 'training can start at a later step (test links)');
game.quitRun();
ok(game.mode === 'title' && !ob.training && save.lifetime.runs === runsBefore, 'quitting training banks no run');

// ---------------------------------------------------------------- first-time tips and discovery
settings.mode = 'standard';
game.startSolo();
step(30);
ok(save.tips.includes('shop') && !$('#ob-tip')!.hidden, 'the starting shop shows the shop tip');
game.closeShop();
step(30);
ok($('#ob-tip')!.hidden, 'a menu tip closes with its menu');
game.debugSpawnElite('charger', 'shielded');
step(40);
ok(save.tips.includes('elite') && $('#ob-tip')!.textContent!.includes('ELITE'), 'the first elite shows its tip');
const tipCount = save.tips.length;
settings.tips = false;
const e2 = game.enemies.spawn(ENEMIES.swarmer, p.x + 3, p.z, game.spawnOpts());
game.expose(e2);
step(40);
ok(save.tips.length === tipCount, 'TIPS OFF: no new tips');
settings.tips = true;
game.expose(e2);
step(40);
ob.closeTip();
step(20);
ok(save.tips.includes('exposed') && $('#ob-tip')!.textContent!.includes('EXPOSED'), 'tips come back when turned on (queued behind the one showing)');
ok(save.discovered.includes(`w:${h.loadoutPick.primary}`) && save.discovered.includes(`sp:${h.special.id}`) && save.discovered.includes('s:expose'), 'owned loadout and seen statuses are discovered');
(document.querySelector('[data-act=ob-tip-x]') as HTMLElement).click();
ok($('#ob-tip')!.hidden, 'the tip closes with its X');

// ---------------------------------------------------------------- game over: unlocks, recap, build card data
game.gainXp(game.xpNext * 3);
for (let i = 0; i < 200; i++) {
  if (game.mode === 'levelup' && h.needsPick) ui('pick', 0);
  game.update(1 / 60);
}
step(120);
cheats.god = false;
p.invuln = 0;
h.revivesLeft = 0;
if (p.hurt(p.hp + 1, 0, 1)) game.onHeroDown(h);
step(360); // the death replay (time lane, ~5 s) plays before the game-over screen
ok(game.screens.current === 'gameover', 'the run ends on the game-over screen');
ok(!!$('#scr-gameover .ob-unlocks') && $('#scr-gameover .ob-unlocks')!.querySelectorAll('.ob-ul').length === 3, 'game over shows the 3 closest unlocks');
ok($('#scr-gameover .ob-recap tr:nth-child(2) .st')?.textContent === 'ST 1', 'game over shows the stage timeline');
ok(!!$('#scr-gameover [data-act=ob-card]'), 'BUILD CARD button on game over');
ok(game.screens.current === 'gameover' && (game.screens as any).nav('gameover').focus === 0, 'RETRY keeps the first focus');

// ---------------------------------------------------------------- codex screen
game.screens.show('arsenal');
ok($('#scr-arsenal .ob-count')!.textContent!.includes('DISCOVERED') && document.querySelectorAll('#scr-arsenal .ob-cx').length > 0, 'the codex screen renders');
ok(document.querySelectorAll('#scr-arsenal .ob-cx:not(.unseen)').length > 0 && document.querySelectorAll('#scr-arsenal .ob-cx.unseen').length > 0, 'discovered and ??? entries');
(document.querySelector('#scr-arsenal [data-tab=statuses]') as HTMLElement).click();
ok($('#scr-arsenal .ob-count')!.textContent!.endsWith('/ 7 DISCOVERED'), 'codex tabs switch');
process.exit(process.exitCode ?? 0);
