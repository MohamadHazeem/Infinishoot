/**
 * Smoke test: runs the real game headlessly (jsdom, no WebGL) with the
 * autoplay bot through every mode, difficulty and hero, then a mortal run
 * to game over, and fails on any runtime error. `npm run smoke`.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window as unknown as Record<string, unknown>;
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
// Any crash must fail the test (a rejected top-level await can otherwise exit 0 silently).
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});

const errors: string[] = [];
process.on('uncaughtException', (e) => errors.push('uncaught ' + e.stack));

const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { installBot } = await import('../src/dev/bot');
const { settings } = await import('../src/game/settings');
const { save } = await import('../src/game/save');

const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new Input(canvas);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
installBot(game, input);
const botRun = (globalThis as any).window.botRun as (s: number, god?: boolean) => Record<string, unknown>;
// Unlock everything so all heroes/difficulties/weapons get exercised.
save.achievements.push('boss_slayer', 'elite_hunter', 'speedster', 'stage_3', 'hard_stage3', 'first_steps', 'maxed', 'evolved', 'exterminator', 'arsenal', 'riposte', 'immovable', 'double_trouble');

const runs: [string, string, string, number][] = [
  ['standard', 'normal', 'rookie', 900],
  ['endless', 'hard', 'bulwark', 600],
  ['bossrush', 'nightmare', 'dash', 400],
  ['daily', 'easy', 'ace', 300],
  // Mechanic heroes (src/game/heroMechs.ts): parry-on-dash, heat aura, mirror twin.
  ['standard', 'normal', 'duelist', 240],
  ['endless', 'easy', 'furnace', 240],
  ['standard', 'hard', 'twin', 240],
];
for (const [mode, diff, hero, secs] of runs) {
  settings.mode = mode;
  settings.difficulty = diff;
  settings.hero = hero;
  // The Twin's clone copies the left click: give it a beam weapon so the clone's own weapon instance runs too.
  settings.loadout = { ...settings.loadout, primary: hero === 'twin' ? 'laser' : 'buster' };
  settings.pet = hero === 'rookie' ? 'sparky' : hero === 'dash' ? 'bit' : 'guardian';
  game.applyLocalSkin();
  try {
    game.startSolo();
    const t0 = Date.now();
    const r = botRun(secs, true);
    console.log(mode, diff, hero, JSON.stringify({ stage: r.stage, mode: r.mode, level: r.level, kills: r.kills, weapons: r.weapons, avgMs: r.avgMs, worstMs: r.worstMs, curses: game.curses, relics: game.hero.relics, route: game.route.on ? game.route.path.slice(2).map((_, k) => game.routeKind(k + 2)).join(',') : '-', wall: Date.now() - t0 }));
    // Route map: every stage after the first was reached through a picked node.
    if (mode === 'standard' && r.stage >= 2 && game.route.path[r.stage] === undefined) errors.push(`route: no node picked for stage ${r.stage}`);
    // Pause screen + extras screens render without throwing.
    game.pause();
    game.resume();
  } catch (e) {
    errors.push(mode + ': ' + (e as Error).stack?.split('\n').slice(0, 14).join('\n'));
  }
}
// The training field with the bot at the controls (onboarding lane): runs without errors and leaves cleanly.
try {
  game.onboarding.startTraining();
  const tr = botRun(40, false);
  console.log('training', JSON.stringify({ step: game.onboarding.training?.step, mode: tr.mode, screen: (game.screens as any).current }));
  game.onboarding.endTraining(false);
} catch (e) {
  errors.push('training: ' + (e as Error).stack?.split('\n').slice(0, 14).join('\n'));
}
// Modes lane: a rhythm stage, the Pacifist road, the three mini-games and a weekly run racing a ghost.
try {
  const { modesForce } = await import('../src/game/systems/modes');
  const { demoGhost } = await import('../src/dev/modesLinks');
  const { ghostStore } = await import('../src/game/modes/ghostStore');
  settings.mode = 'standard';
  settings.difficulty = 'normal';
  settings.hero = 'rookie';
  game.applyLocalSkin();
  modesForce.rhythm = true;
  game.startSolo();
  const r1 = botRun(90, true);
  const onBeat = game.modes.onBeat[0] ?? 0;
  const rhythm = game.modes.rhythm;
  modesForce.rhythm = null;
  game.route.force = 'pacifist';
  game.loadStage(2);
  const gold0 = game.hero.gold;
  const r2 = botRun(126, true);
  const pac = { kills: game.modes.pacKills[0], gold: game.hero.gold - gold0, stage: game.stage, mode: game.mode };
  game.route.force = null;
  const mini: Record<string, number> = {};
  for (const k of ['gallery', 'coins', 'whack'] as const) {
    if (game.mode === 'dead' || game.mode === 'title') break;
    const g0 = game.hero.gold;
    game.startMiniGame(k);
    botRun(26.5, true);
    mini[k] = game.hero.gold - g0;
  }
  settings.mode = 'weekly';
  game.startSolo();
  ghostStore.setRival(demoGhost(game.meta.week, 0, game.hero.player.x, game.hero.player.z));
  game.modes.stage = 0;
  botRun(45, true);
  const raced = !!game.modes.rival && !!game.modes.rec;
  const week = game.meta.week;
  game.quitRun();
  const kept = ghostStore.mine(week);
  console.log('modes', JSON.stringify({ rhythm, onBeat, r1: r1.mode, pacifist: pac, r2: r2.mode, mini, raced, ghost: kept ? `${kept.xs.length} samples` : 'none' }));
  if (!rhythm) errors.push('modes: the forced rhythm stage did not start');
  if (pac.kills !== 0) errors.push('modes: the bot killed on the Pacifist road');
  if (!raced || !kept) errors.push('modes: the weekly run did not record or race a ghost');
  if (Object.values(mini).some((v) => !(v > 0))) errors.push('modes: a mini-game paid nothing to the bot ' + JSON.stringify(mini));
  settings.mode = 'standard';
} catch (e) {
  errors.push('modes: ' + (e as Error).stack?.split('\n').slice(0, 14).join('\n'));
}
// MP lane: Versus Swarm vs the AI Overlord, then local co-op (the bot on the keyboard plus two fake pads walking in circles).
try {
  const { fakePads } = await import('../src/dev/mpLinks');
  const { KBM } = await import('../src/game/localCoop');
  game.versusSolo();
  const vr = botRun(260, true);
  console.log('versus', JSON.stringify({ mode: vr.mode, kills: vr.kills, level: vr.level, alive: game.enemies.activeCount, purse: Math.round(game.versus?.st.points ?? -1), boss: game.versus?.st.bossUsed, winner: game.versus?.winner, avgMs: vr.avgMs }));
  if (game.mode !== 'title' && !game.versus) errors.push('versus: the match state went missing');
  if (vr.kills < 20) errors.push(`versus: the AI Overlord sent almost nothing (${vr.kills} kills)`);
  game.leaveToTitle();
  const slot = (pad: number, hero: string, primary: string) => ({ pad, hero, loadout: { ...settings.loadout, primary }, ready: true, row: 0 });
  game.localCoopStart([slot(KBM, 'rookie', 'buster'), slot(0, 'bulwark', 'scatter'), slot(1, 'ace', 'laser')], 'standard', fakePads(2));
  const lr = botRun(300, true);
  console.log('localcoop', JSON.stringify({ mode: lr.mode, stage: lr.stage, level: lr.level, kills: lr.kills, heroes: game.heroes.length, moved: game.heroes.map((h) => Math.round(Math.hypot(h.player.x, h.player.z))), avgMs: lr.avgMs }));
  if (game.heroes.length !== 3 || !game.localCoop) errors.push('localcoop: the run lost its local heroes');
  game.leaveToTitle();
} catch (e) {
  errors.push('mp: ' + (e as Error).stack?.split('\n').slice(0, 14).join('\n'));
}
// Race lane: a hot-seat tournament turn played to the boss, then a friend's challenge.
try {
  const { raceState, playTurn, startChallenge } = await import('../src/game/systems/race');
  const { createTourney, decodeChallenge, encodeChallenge } = await import('../src/game/raceRules');
  const rs = raceState(game)!;
  rs.tourney = createTourney(['Ann', 'Bo', 'Cy', 'Di'], 'race', 5);
  playTurn(game, 0, 0, 'a');
  const tr = botRun(330, true);
  const res = rs.tourney.rounds[0][0].ra;
  console.log('race', JSON.stringify({ stage: tr.stage, kills: tr.kills, turn: res, screen: game.screens.current, avgMs: tr.avgMs }));
  if (!res) errors.push('race: the hot-seat turn never ended');
  else if (res.p < 1) errors.push(`race: the bot never reached the boss in a race turn (${JSON.stringify(res)})`);
  game.leaveToTitle();
  startChallenge(game, decodeChallenge(encodeChallenge({ seed: 99, mode: 'standard', difficulty: 'normal', hero: 'rookie', loadout: { ...settings.loadout }, score: 5000, stage: 1, name: 'Lina' })));
  const cr = botRun(40, true);
  if (game.seed !== 99 || !rs.chal) errors.push('race: the challenge lost its seed or target');
  console.log('challenge', JSON.stringify({ score: game.score, passed: rs.chalPassed, avgMs: cr.avgMs }));
  rs.tourney = null;
  game.leaveToTitle();
} catch (e) {
  errors.push('race: ' + (e as Error).stack?.split('\n').slice(0, 14).join('\n'));
}
// A mortal run: die, game over, run history.
settings.mode = 'standard';
settings.difficulty = 'nightmare';
game.startSolo();
const rr = botRun(900, false);
console.log('mortal', JSON.stringify({ stage: rr.stage, mode: rr.mode, t: rr.t, kills: rr.kills }));
// The bot can outlive the time budget (it parries well), so finish the run off deterministically.
if (game.mode !== 'dead') {
  const p = game.hero.player;
  game.hero.revivesLeft = 0;
  game.hero.petState.reviveUsed = true; // the Guardian pet's one revive would pick the hero straight back up
  p.invuln = 0;
  if (p.hurt(p.hp + 1, 0, 1)) game.onHeroDown(game.hero);
}
for (let i = 0; i < 400; i++) game.update(1 / 60);
ok(game.screens.current === 'mvp', 'death opens the solo MVP report');
(document.querySelector('#scr-mvp button') as HTMLButtonElement).click();
const goScreen = (game.screens as any).current;
console.log('after death: screen', goScreen, 'last cause', save.history[0]?.cause, 'label', save.history[0]?.label);
for (const s of ['extras', 'jukebox', 'wardrobe', 'modes', 'controls', 'history', 'bestiary', 'settings', 'codex', 'ghosts']) {
  try { (game.screens as any).show(s); } catch (e) { errors.push('screen ' + s + ': ' + (e as Error).stack); }
}
console.log('history', save.history.length, 'seen', save.seen.length);
ok(rr.mode === 'dead' || rr.mode === 'fight', 'mortal run plays out');
ok(goScreen === 'gameover' && save.history.length > 0, 'death shows game over and records the run');
ok(errors.length === 0, 'no runtime errors' + (errors.length ? ':\n' + errors.slice(0, 5).join('\n') : ''));
process.exit(process.exitCode ?? 0);
