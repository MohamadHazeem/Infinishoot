/**
 * Trials: pure medal/progression rules plus real Game lifecycle, authored setups and co-op snapshots.
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

const { TRIALS, TRIAL_BY_ID, TRIAL_TIER_POINTS, medalFor, normalizeTrialRecords, recordTrial, trialPoints, trialUnlocked } = await import('../src/data/trials');
const { ENEMIES } = await import('../src/data/enemies');
const { WEAPONS } = await import('../src/data/weapons');
const { HEROES } = await import('../src/data/heroes');
const { allBiomeKeys, biomeForce } = await import('../src/data/biomes');
const { en } = await import('../src/i18n/en');
const { ar } = await import('../src/i18n/ar');
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { startTrial, trialsState, tickTrial, finishTrial, trialsNet, applyTrialsNet, acceptTrialStart, PUZZLE_ORDER } = await import('../src/game/systems/trials');
const { save, saveLock } = await import('../src/game/save');
const { Team } = await import('../src/game/bullets');
const { PickupType } = await import('../src/game/pickups');
const { coopPlayState } = await import('../src/game/systems/coopplay');
const { worldEventOf } = await import('../src/game/systems/worldEvents');
const { SnapEncoder, SnapDecoder } = await import('../src/net/snapCodec');
const { settings } = await import('../src/game/settings');
ok(TRIALS.length === 24 && new Set(TRIALS.map(d => d.id)).size === 24, '24 unique authored trials');
for (const d of TRIALS) {
  ok(d.seconds >= 60 && d.seconds <= 180 && d.target > 0, `${d.id}: short bounded objective`);
  ok(HEROES.some(h => h.id === d.hero) && allBiomeKeys().includes(d.biome), `${d.id}: valid hero and biome`);
  ok(d.kit.every(id => !!WEAPONS[id]) && d.foes.every(id => !!ENEMIES[id]) && (d.bosses ?? []).every(id => ENEMIES[id]?.boss), `${d.id}: valid kit and roster`);
  ok(!!en[`trials.${d.id}.name` as keyof typeof en] && !!ar[`trials.${d.id}.desc` as keyof typeof ar], `${d.id}: bilingual copy`);
  const lower = ['time', 'damage'].includes(d.metric);
  ok(d.medals.every((v, i) => i === 0 || (lower ? v <= d.medals[i - 1] : v >= d.medals[i - 1])), `${d.id}: ordered medal targets`);
}
const result = (patch = {}) => ({ time: 40, damage: 0, kills: 100, combo: 70, progress: 1, success: true, medal: 3 as const, ...patch });
ok(medalFor(TRIAL_BY_ID.king, result()) === 3, 'gold threshold inclusive');
ok(medalFor(TRIAL_BY_ID.king, result({ time: 40.1 })) === 2, 'time medals ordered lower is better');
ok(medalFor(TRIAL_BY_ID.combo, result({ combo: 35, progress: 90 })) === 2, 'combo medals ordered higher is better');
ok(medalFor(TRIAL_BY_ID.clean, result({ damage: 1 })) === 0, 'no-hit is a hard fail');
ok(medalFor(TRIAL_BY_ID.king, result({ success: false })) === 0, 'failure cannot medal');
ok(medalFor(TRIAL_BY_ID.king, result({ progress: 0 })) === 0, 'incomplete objective cannot medal');
ok(medalFor(TRIAL_BY_ID.king, result({ damage: -1 })) === 0, 'negative counters cannot medal');
ok(medalFor(TRIAL_BY_ID.king, result({ time: NaN })) === 0, 'invalid measurement cannot medal');
const records = normalizeTrialRecords({ king: { medal: 2, time: 55, value: 55 }, nope: { medal: 3, time: 0, value: 0 }, buster: { medal: 9, time: 1, value: 0 } });
ok(Object.keys(records).length === 1 && trialPoints(records) === 2, 'storage drops invalid and unknown records');
ok(recordTrial(records, TRIAL_BY_ID.king, result()) === 100 && records.king.time === 40, 'one medal improvement grants 100 XP');
ok(recordTrial(records, TRIAL_BY_ID.king, result({ time: 39 })) === 0 && records.king.time === 39, 'faster replay improves best without farming XP');
ok(recordTrial(records, TRIAL_BY_ID.king, result({ time: 60 })) === 0 && records.king.time === 39, 'weaker replay preserves best');
for (const d of TRIALS.slice(0, 6)) records[d.id] = { medal: 3, time: 40, value: 0 };
ok(trialPoints(records) === 18 && trialUnlocked(TRIAL_BY_ID.mech, records) && !trialUnlocked(TRIAL_BY_ID.queen, records), 'tier thresholds reachable entirely with solo medals');
ok(TRIAL_TIER_POINTS.join() === '0,6,18,36', 'tier tuning is explicit');

save.training.offered = true;
settings.autoFire = false;
const g = new Game(new Input(document.getElementById('game') as HTMLCanvasElement), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
ok(!!document.querySelector('#scr-modes .tl-entry') && !!document.querySelector('#scr-online .tl-entry'), 'trial selection is reachable from modes and online lobby');
const step = (n: number) => { for (let i = 0; i < n; i++) g.update(1 / 60); };
cheats.god = true;
for (const d of TRIALS.filter(d => !d.players)) {
  ok(startTrial(g, d.id, true), `${d.id}: launches`);
  ok(g.mode === 'fight' && g.screens.current === 'none', `${d.id}: skips shop and starts fight`);
  ok(g.hero.weapons.map(w => w.def.id).join() === d.kit.join(), `${d.id}: exact fixed kit`);
  step(3);
  ok(!trialsState(g).run!.result, `${d.id}: does not finish immediately`);
  if (d.goal === 'puzzle') {
    const pads = trialsState(g).run!.pads;
    ok(pads.length === 6 && pads.every((p, i) => pads.every((o, j) => i === j || Math.hypot(p.x - o.x, p.z - o.z) > 3)), 'puzzle pads are distinct and reachable');
    g.hero.player.teleport(pads[0].x, pads[0].z); tickTrial(g, .1);
    g.hero.player.teleport(pads[1].x, pads[1].z); tickTrial(g, .1);
    ok(trialsState(g).run!.progress === 0, 'wrong puzzle pad resets the sequence');
    for (const index of PUZZLE_ORDER) { const p = pads[index]; g.hero.player.teleport(p.x, p.z); tickTrial(g, 1); }
    ok(trialsState(g).run!.result?.success, 'puzzle completes only by walking ordered pads');
  }
  if (d.goal === 'stealth') ok(!!worldEventOf(g)?.stealth, 'night uses the real stealth system');
  if (d.goal === 'escort') ok(coopPlayState(g).kind === 'escort', 'escort uses the real damageable core');
}
startTrial(g, 'rush', true);
for (let i = 0; i < 3; i++) { g.enemies.kill(g.boss!); tickTrial(g, 1); }
ok(trialsState(g).run!.result?.success && trialsState(g).run!.bosses === 3, 'three-boss sequence completes without a normal stage transition');
startTrial(g, 'parry', true);
const p = g.hero.player;
g.bullets.spawn({ x: p.x + 1, z: p.z, dirX: -1, dirZ: 0, speed: 6, life: 3, radius: 0.26, damage: 8, knockback: 1, team: Team.Enemy, color: '#ff3df0', width: .5, length: .5 });
g.tryParry(g.hero);
ok(trialsState(g).run!.parries === 1, 'counts actual reflected shots, not attempts');
g.hero.skill.parryCd = 0; g.tryParry(g.hero);
ok(trialsState(g).run!.parries === 1, 'whiff does not increment shot count');
startTrial(g, 'gems', true);
g.collect(g.hero, PickupType.Gem, 9); g.collect(g.hero, PickupType.Heart, 30);
ok(trialsState(g).run!.gems === 1 && g.level === 1, 'counts gem pickups rather than gem XP; fixed level');
startTrial(g, 'environment', true);
const enemy = g.enemies.spawn(ENEMIES.bopper, 3, 3, g.spawnOpts({ instant: true }));
const hp = enemy.hp;
g.damage(enemy, 999, { source: 'buster' }, g.hero);
ok(enemy.hp === hp, 'direct damage cannot steal environmental kills');
g.damage(enemy, 999, { source: 'barrel' }, g.hero);
ok(enemy.hp < hp, 'barrels still damage foes');
startTrial(g, 'buster', true);
g.hero.bombCharge = 1; g.hero.skill.ult = 1;
step(1);
ok(g.hero.bombCharge < .01 && g.hero.skill.ult < .01, 'special and ultimate are suppressed');
cheats.god = false;
g.hero.player.invuln = 0; g.hurtHero(g.hero, 10, 2, 2);
const taken = trialsState(g).run!.damage;
g.hero.player.heal(100); tickTrial(g, 1);
ok(taken > 0 && trialsState(g).run!.damage === taken, 'healing never erases damage taken');
startTrial(g, 'rex', true);
g.hero.player.invuln = 0; g.hurtHero(g.hero, 1, 2, 2); tickTrial(g, .1);
ok(trialsState(g).run!.result?.medal === 0 && g.screens.current === 'trialresult', 'no-hit fails into retry card');
const before = save.profile.xp;
startTrial(g, 'buster', true); tickTrial(g, 90);
ok(trialsState(g).run!.result?.medal === 3 && save.profile.xp === before, 'practice completion never banks progression');
startTrial(g, 'buster'); tickTrial(g, 90);
ok(trialsState(g).run!.result?.medal === 3 && save.profile.xp === before + 300, 'normal gold banks three medal increments');
finishTrial(g, true);
ok(save.profile.xp === before + 300, 'banking is idempotent');
const oldBiome = trialsState(g).oldBiome;
g.leaveToTitle();
ok(!trialsState(g).run && biomeForce.key === oldBiome, 'leaving cleans up trial and restores biome');
g.startSolo();
ok(g.mode === 'shop', 'ordinary runs keep their starting shop after a trial');
g.closeShop();

// Actual host/client transport, including the generic snapshot codec.
const client = new Game(new Input(document.getElementById('game') as HTMLCanvasElement), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const queue: any[] = [];
(g as any).host = { send: (_id: string, m: any) => queue.push(m), broadcast: (m: any) => queue.push(m), close() {} };
g.role = 'host'; client.role = 'client';
(client as any).client = { send() {}, close() {} };
g.setHeroes([g.hero, g.makeHero(1, 'Guest', [], 'guest')]);
cheats.god = true;
ok(startTrial(g, 'pair-core', true), 'pair trial starts with exactly two players');
while (queue.length) client.onClientMessage(structuredClone(queue.shift()));
for (let i = 0; i < 30; i++) { g.update(1 / 60); while (queue.length) client.onClientMessage(structuredClone(queue.shift())); client.update(1 / 60); }
ok(trialsState(client).run?.def.id === 'pair-core' && client.hero.heroDef.id === 'rookie', 'start and snapshots mirror pair trial and hero');
const packet = trialsNet(g)!;
const codec = new SnapEncoder(), decoder = new SnapDecoder();
const packed = codec.encode({ trial: packet }, {}, {});
const decoded = decoder.decode(packed);
ok(!!decoded, 'trial snapshot survives generic codec');
applyTrialsNet(client, packet);
ok(trialsState(client).run!.time > 0, 'client HUD follows authoritative clock');
g.stepN = 1; // Deliberately finish between snapshot send ticks.
finishTrial(g, true);
for (let i = 0; i < 6; i++) { g.update(1 / 60); while (queue.length) client.onClientMessage(structuredClone(queue.shift())); client.update(1 / 60); }
ok(client.screens.current === 'trialresult', 'frozen results keep sending snapshots between network ticks');
const clientRecord = trialsState(client).records['pair-core'];
applyTrialsNet(client, trialsNet(g));
ok(trialsState(client).records['pair-core'] === clientRecord, 'duplicate result does not re-bank');
acceptTrialStart(client, null);
ok(!trialsState(client).run, 'ordinary start clears old client trial');
// Unlocked records do not bypass the exact player requirement.
g.role = 'solo';
ok(!startTrial(g, 'buster', true), 'solo trial rejects a two-player roster');
saveLock.on = false;
console.log('trials: authored setups, medals, progression, lifecycle and co-op passed');
process.exit(process.exitCode ?? 0);
