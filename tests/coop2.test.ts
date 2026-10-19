/**
 * Coop2 lane, pure rules: the buy-back split, automatic picks for joiners,
 * the team-ultimate window, the emote rate limit, role bonuses, the help-ghost
 * share code (round trip, tampering, files, cleaning) and the inbox; then a
 * solo run where a ghost from the inbox turns up at the boss, fights (damage
 * credited to 'ghost') and fades after its time.
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

const R = await import('../src/game/coop2');
const { roleBonus, bonusText, roleOf } = await import('../src/data/coopRoles');

// ---- Buy-back split
const sum = (a: number[] | null) => (a ?? []).reduce((x, y) => x + y, 0);
ok(JSON.stringify(R.splitCost([30, 30, 30], 18)) === '[6,6,6]', 'even split');
const s1 = R.splitCost([2, 50, 50], 24);
ok(!!s1 && s1[0] === 2 && sum(s1) === 24 && s1[1] === 11 && s1[2] === 11, `a short player pays what they have, the rest split (${JSON.stringify(s1)})`);
const s2 = R.splitCost([10, 10, 10], 20);
ok(!!s2 && sum(s2) === 20 && Math.max(...s2) - Math.min(...s2) <= 1, `odd coins spread one each (${JSON.stringify(s2)})`);
ok(R.splitCost([5, 5], 11) === null, "can't buy when the team can't pay");
ok(JSON.stringify(R.splitCost([0, 40], 30)) === '[0,30]', 'a broke player pays nothing');
ok(sum(R.splitCost([7, 3, 100, 1], 40)) === 40, 'four players, uneven gold');
ok(JSON.stringify(R.splitCost([4, 4], 0)) === '[0,0]', 'free is free');
ok(R.poolCost(1) === R.poolTuning.costBase + R.poolTuning.costPerStage, 'buy-back cost grows with the stage');

// ---- Joiners
ok(R.autoPickCount(1) === 0 && R.autoPickCount(13) === Math.round(12 * R.joinTuning.fairShare), 'auto picks follow the team level');
ok(R.autoPickCount(500) === R.joinTuning.maxAutoPicks, 'auto picks are capped');
ok(R.autoPickIndex([{ kind: 'gold' }, { kind: 'passive' }, { kind: 'track' }] as never) === 2, 'auto pick prefers loadout ranks');
ok(R.autoPickIndex([{ kind: 'heal' }, { kind: 'evo' }, { kind: 'track' }] as never) === 1, 'and takes an evolution first');
const pid = R.coopPlayerId();
ok(/^[a-z0-9]{12}$/.test(pid) && R.coopPlayerId() === pid, 'a stable player id is kept');

// ---- Team ultimate window
const W = R.teamUltTuning.window;
ok(R.teamUltDue([10, 10.5], 11, -Infinity), 'two ultimates 0.5 s apart combine');
ok(!R.teamUltDue([10, 10 + W + 0.1], 10 + W + 0.1, -Infinity), `ultimates more than ${W} s apart don't`);
ok(!R.teamUltDue([10, -Infinity], 10.2, -Infinity), "a hero who hasn't fired blocks it");
ok(!R.teamUltDue([10, 10.5], 11, 10.6), 'one set of ultimates combines once');
ok(!R.teamUltDue([10], 10, -Infinity), 'solo never combines');
ok(R.teamUltDue([5, 5.2, 6.9], 7, -Infinity), 'three heroes within the window');
ok(R.teamUltDamage(3) > 3 * R.teamUltDamage(1) - 1e-9, 'bigger than the sum of its parts');

// ---- Emote limiter
const lim = new R.EmoteLimiter();
const T = R.emoteTuning;
ok(lim.allow(0) && !lim.allow(T.minGap * 0.5), 'emotes need a gap');
let n = 1;
for (let t = T.minGap; t < T.burstWindow; t += T.minGap) if (lim.allow(t)) n++;
ok(n === T.burst, `at most ${T.burst} per ${T.burstWindow} s (${n})`);
ok(lim.allow(T.burstWindow + 0.01), 'and they come back after the window');
ok(R.emoteOf('wave')?.id === 'wave' && R.emoteOf('boo') === null && R.EMOTES.length === 6, 'six emotes, unknown ones rejected');
ok(R.EMOTES.every((e) => e.glyph.length === 8 && e.glyph.every((r) => r.length === 8)), 'every emote has an 8x8 glyph');

// ---- Roles
ok(roleOf('bulwark') === 'tank' && roleOf('ace') === 'damage' && roleOf('rookie') === 'healer' && roleOf('dash') === 'support' && roleOf('nobody') === 'support', 'heroes have roles');
ok(roleBonus(['tank']).scale === 0 && roleBonus(['tank', 'tank']).scale === 0, 'one role: no bonus');
const b2 = roleBonus(['tank', 'damage']);
ok(b2.scale === 1 && b2.armor === 1 && b2.damageMul > 0 && b2.regen === 0, '2 roles: their gifts at x1');
const b4 = roleBonus(['tank', 'healer', 'damage', 'support']);
ok(b4.scale === 2 && b4.armor === 2 && b4.moveSpeedMul > 0 && b4.regen > 0, 'a full party: every gift at x2');
ok(roleBonus(['tank', 'healer', 'damage']).scale === 1.5, '3 roles: x1.5');
ok(bonusText(b2).includes('ARMOR') && bonusText(roleBonus([])) === '', 'bonus text');

// ---- Help ghost codes
const g = { v: 1 as const, name: 'Mia', hero: 'twin', color: '#a7f070', look: 'AB-12', level: 23, stage: 3, boss: 'Hive Queen', kit: ['laser', 'well', 'meteor', 'drones'], date: '2026-10-19' };
const code = R.encodeGhost(g);
ok(code.startsWith('GHOST1-') && code.length < 200, `share code (${code.length} chars)`);
ok(JSON.stringify(R.decodeGhost(code)) === JSON.stringify(g), 'round trip');
ok(JSON.stringify(R.decodeGhost('  ghost1-' + code.slice(7) + '\n')) === JSON.stringify(g), 'pasted with spaces and a lower-case prefix');
const bad = code.slice(0, -3) + (code.endsWith('A') ? 'B' : 'A') + code.slice(-2);
ok(R.decodeGhost(bad) === null, 'a changed code fails its checksum');
ok(R.decodeGhost('hello') === null && R.decodeGhost('GHOST1-') === null && R.decodeGhost('GHOST1-!!!!') === null, 'junk is rejected');
ok(JSON.stringify(R.decodeGhost(JSON.stringify(g))) === JSON.stringify(g), 'a ghost file (JSON) loads');
const dirty = R.cleanGhost({ name: '<b>Evil</b>"name', hero: '../x', color: 'red', level: 5, stage: 2, boss: '<script>', kit: ['ok_1', 'BAD!', 5], date: 'x' });
ok(!!dirty && !/[<>"]/.test(dirty.name + dirty.boss) && dirty.color === '#73eff7' && dirty.kit.every((k) => /^[a-z0-9_]+$/.test(k)) && dirty.date === '', `outside ghosts are cleaned (${JSON.stringify(dirty)})`);
ok(R.cleanGhost({ name: 'x', level: 0, stage: 1 }) === null && R.cleanGhost(null) === null, 'invalid ghosts are refused');
const g2 = { ...g, name: 'Bo' };

// ---- Inbox
R.saveInbox([]);
ok(R.addToInbox(g) && !R.addToInbox(g) && R.addToInbox(g2), 'the inbox keeps one of each');
ok(R.ghostInbox().length === 2 && R.ghostInbox()[0].name === 'Bo', 'newest first');
ok(R.takeFromInbox()?.name === 'Mia' && R.ghostInbox().length === 1, 'the oldest helps first');
for (let i = 0; i < 10; i++) R.addToInbox({ ...g, name: `F${i}` });
ok(R.ghostInbox().length === R.ghostTuning.inboxMax, `the inbox holds ${R.ghostTuning.inboxMax}`);
R.saveMyGhost(g);
ok(R.myGhost()?.name === 'Mia', 'your own ghost is kept to share');

// ---- A ghost helps at a solo boss
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { ENEMIES } = await import('../src/data/enemies');
const { settings } = await import('../src/game/settings');
const C2 = await import('../src/game/systems/coop2');
settings.deathReplay = false;
settings.bossIntros = false;
settings.helpGhosts = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
game.startRun();
if (game.mode === 'shop') game.closeShop();
cheats.god = true;
game.xpNext = 1e9;
R.saveInbox([g]);
const st = C2.coop2Debug(game);
for (let i = 0; i < 60; i++) game.update(1 / 60);
ok(!st.ghost, 'no ghost before the boss (life is fine)');
game.debugSkipToBoss();
for (let i = 0; i < 60 * 10 && !st.ghost; i++) game.update(1 / 60);
ok(!!st.ghost && st.ghost.g.name === 'Mia' && R.ghostInbox().length === 0, 'at the boss, the ghost from the inbox comes to help');
for (let i = 0; i < 12; i++) game.enemies.spawn(ENEMIES.swarmer, game.player.x + 3 + (i % 4), game.player.z + 2 + Math.floor(i / 4), { ...game.spawnOpts(), instant: true });
for (let i = 0; i < 60 * 6; i++) {
  game.update(1 / 60);
  if (i % 10 === 0) game.render(1, 1 / 60);
}
ok((game.hero.damageBy.ghost ?? 0) > 0, `the ghost's hits are credited to 'ghost' (${Math.round(game.hero.damageBy.ghost ?? 0)})`);
ok(game.sourceName('ghost') === 'Help Ghost' && game.sourceName('teamult') === 'Team Ultimate', 'damage breakdown names');
for (let i = 0; i < 60 * (R.ghostTuning.duration + 1) && st.ghost; i++) game.update(1 / 60);
ok(!st.ghost, 'it fades after its time');
game.startRun();
if (game.mode === 'shop') game.closeShop();
for (let i = 0; i < 30; i++) game.update(1 / 60);
ok(st.ghostsUsed === 0, 'a new run can have a ghost again');

// ---- Recording your own ghost when you fall at a boss
R.saveMyGhost({ ...g, name: 'Old' });
game.debugSkipToBoss();
for (let i = 0; i < 60 * 8 && !(game.boss && game.introLeft <= 0); i++) game.update(1 / 60);
cheats.god = false;
const h = game.hero;
h.revivesLeft = 0;
h.petState.reviveUsed = true;
h.phoenixUsed = true;
h.player.invuln = 0;
if (h.player.hurt(h.player.hp + 1, 1, 0)) game.onHeroDown(h);
for (let i = 0; i < 5; i++) game.update(1 / 60);
ok(game.mode === 'dead' && R.myGhost()?.name === h.name.slice(0, 12) && R.myGhost()?.boss === game.boss?.def.name, `falling at a boss records your help ghost (${JSON.stringify(R.myGhost())})`);

console.log('coop2 checks done');
