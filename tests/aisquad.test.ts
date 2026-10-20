/** Squad decisions and complete offline co-op integration, including a 3-bot smoke run. */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const noop: any = new Proxy(function () {}, {
  get: (_t, k) =>
    k === 'data'
      ? new Uint8ClampedArray(4 * 64 * 64)
      : k === Symbol.toPrimitive
        ? () => 0
        : k === 'measureText'
          ? () => ({ width: 10 })
          : noop,
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, {
    get: (_t, k) =>
      k === 'createImageData' || k === 'getImageData'
        ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) })
        : k === 'canvas'
          ? this
          : noop[k as never],
  });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
for (const k of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'HTMLElement',
  'HTMLCanvasElement',
  'HTMLInputElement',
  'Event',
  'KeyboardEvent',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'innerWidth',
  'innerHeight',
  'addEventListener',
  'dispatchEvent',
  'Node',
  'MouseEvent',
  'PointerEvent',
]) {
  try {
    (globalThis as any)[k] = (dom.window as any)[k];
  } catch {
    Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true });
  }
}
(globalThis as any).Path2D = (dom.window as any).Path2D = class {
  constructor(_d?: string) {}
};
(globalThis as any).__APP_VERSION__ = 'test';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});

const { Game, cheats, OWNED_CHEST } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { settings } = await import('../src/game/settings');
const { squadCount, squadPickIndex, squadWantsPickup } = await import('../src/game/aisquadBrain');
const { squadStep, squadDebug, squadOrder, squadPing } =
  await import('../src/game/systems/aisquad');
const { PickupType } = await import('../src/game/pickups');
const { forceCoopObjective, coopPlayState } = await import('../src/game/systems/coopplay');
const { wheelSlice } = await import('../src/game/teamPlay');
const { meta2State } = await import('../src/game/systems/meta2');
const { tradingDebug } = await import('../src/game/systems/trading');
const { save } = await import('../src/game/save');
const { installBot } = await import('../src/dev/bot');
const input = new Input(document.getElementById('game') as HTMLCanvasElement);
const g = new Game(
  input,
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
cheats.unlockAll = true;
settings.tips = false;
settings.bossIntros = false;
settings.finishers = false;
settings.squadBots = 3;
settings.squadHeroes = 'rookie,bulwark,ace';
settings.mode = 'standard';
g.startSolo();
ok(
  g.squadRun && g.role === 'solo' && !g.host && !g.client && g.heroes.length === 4,
  'four authoritative heroes, no peers or transport',
);
ok(g.director.players === 4 && g.coop, 'normal co-op scaling and passives enabled');
ok(
  g.heroes
    .slice(1)
    .map((h) => h.heroDef.id)
    .join(',') === 'rookie,bulwark,ace',
  'explicit hero picks retained',
);
ok(
  g.heroes.slice(1).every((h) => h.name.includes('BOT') && !h.peerId && h.player.showWhenDead),
  'BOT tags and downed bodies',
);
ok(g.summary(g.hero).squad === 3 && g.runLabel.includes('SQUAD'), 'run explicitly marked squad');
const { MODS } = await import('../src/data/mods');
for (const bot of g.heroes.slice(1))
  bot.shopOffers = [MODS.find((m) => !m.cursed && !m.synergy?.length && m.price <= 10)!];
const humanGold = g.hero.gold;
squadStep.call(g);
ok(
  g.heroes.slice(1).every((h) => h.shopDone && h.synergy.slots.length > 0),
  'bots shop and finish starting shop automatically',
);
ok(
  g.hero.gold === humanGold && !g.hero.shopDone,
  'bot purchases leave player wallet and menu alone',
);
g.heroAction(g.hero, 'done', 0, 1);
ok(g.mode === 'fight', 'human can finish shop without waiting for bots');

g.gainXp(g.xpNext);
ok(
  g.heroes.every((h) => h.pendingLevels === 1),
  'team XP grants every hero one pick',
);
g.openLevelUp();
squadStep.call(g);
ok(
  g.heroes.slice(1).every((h) => !h.needsPick) && g.hero.needsPick,
  'bots resolve their own offers only',
);
g.heroAction(g.hero, 'pick', 0, 1);
ok(g.mode === 'fight', 'level-up resumes after human choice');

ok(
  squadCount(12) === 3 && squadCount(-2) === 0 && squadCount(NaN) === 0 && squadCount(2.9) === 2,
  'squad size validated',
);
const offers = [
  { kind: 'gold', id: 'gold' },
  { kind: 'track', id: 'buster' },
  { kind: 'evo', id: 'buster' },
] as any;
ok(squadPickIndex(offers, 'ace') === 2, 'build prioritizes evolution');
ok(
  squadPickIndex(
    [
      { kind: 'passive', id: 'armor' },
      { kind: 'passive', id: 'power_cell' },
    ] as any,
    'bulwark',
  ) === 0,
  'tank chooses armor',
);
ok(
  squadPickIndex(
    [
      { kind: 'passive', id: 'armor' },
      { kind: 'passive', id: 'power_cell' },
    ] as any,
    'ace',
  ) === 1,
  'damage hero chooses damage',
);
ok(
  !squadWantsPickup(PickupType.Chest, OWNED_CHEST, 1, 0.2, 0),
  'bot does not chase human-owned boss chest',
);
ok(squadWantsPickup(PickupType.Chest, OWNED_CHEST + 1, 1, 1, 0), 'bot claims its own boss chest');
ok(
  !squadWantsPickup(PickupType.Heart, 1, 1, 1, 0) && !squadWantsPickup(PickupType.Gear, 1, 1, 1, 5),
  'full life and full gears leave pickups',
);
ok(
  wheelSlice(0, -100, 28, 4) === 0 &&
    wheelSlice(100, 0, 28, 4) === 1 &&
    wheelSlice(0, 100, 28, 4) === 2 &&
    wheelSlice(-100, 0, 28, 4) === 3,
  'four squad order slices',
);

// Clear combat clutter and walls for deterministic movement and rescue tests.
g.enemies.clear();
g.bullets.clear();
g.pickups.clear();
g.strikes.length = 0;
g.arena.colliders.length = 0;
g.toys.objective.state = 'done';
g.hero.player.teleport(0, 0);
for (let i = 1; i < 4; i++) g.heroes[i].player.teleport(i * 7, 0);
const h = g.heroes[1];
const decide = () => {
  const old = g.local;
  g.local = h.index;
  try {
    return squadDebug(g).brains.get(h)!.decide(g, h, squadDebug(g).command);
  } finally {
    g.local = old;
  }
};
squadOrder(g, 'follow');
ok(decide().mx < 0, 'follow brings distant bot toward human');
squadOrder(g, 'hold');
const heldX = squadDebug(g).command.x;
g.hero.player.teleport(30, 0);
ok(squadDebug(g).command.x === heldX && decide().mx < 0, 'hold anchor stays where order was given');
squadPing(g, 15, 0, 'go');
ok(decide().mx > 0, 'go ping overrides hold temporarily');
squadPing(g, h.player.x - 1, h.player.z, 'danger');
ok(decide().mx > 0, 'danger ping pushes away');
g.runTime += 9;
squadOrder(g, 'follow');
g.hero.player.teleport(0, 0);
g.strikes.push({ x: h.player.x + 0.5, z: h.player.z, r: 3, t: 1, dmg: 20 });
ok(decide().mx < 0 && decide().dash, 'telegraphed strike triggers escape and dash');
g.strikes.length = 0;

// A downed human gets a real proximity revive, with the same timer as co-op.
g.hero.player.dead = true;
g.hero.player.hp = 0;
for (let i = 1; i < 4; i++) g.heroes[i].player.teleport(4 + i * 3, 0);
for (let step = 0; step < 600 && g.hero.player.dead; step++) {
  g.stepN++;
  for (const bot of g.heroes.slice(1)) g.updateHero(bot, 1 / 60, true);
  g.updateRevives(1 / 60);
}
ok(
  !g.hero.player.dead && g.hero.player.hp > 0,
  'bots travel to and revive downed human through normal revive rules',
);

// Abilities use normal meters and authority, and sensing retains the original charge rhythm.
const { ENEMIES } = await import('../src/data/enemies');
g.hero.player.teleport(0, 0);
h.player.teleport(1, 0);
const foe = g.enemies.spawn(ENEMIES.chonk, h.player.x + 0.8, h.player.z, {
  instant: true,
  hpMul: 1000,
});
foe.state = 'move';
h.bombCharge = 1;
h.skill.ult = 1;
const meter = g.companionState();
meter.meter.charge = 1;
meter.move = null;
g.stepN = 121;
g.updateHero(h, 1 / 60, true);
ok(h.bombCharge < 1 && h.skill.ult < 1, 'bot spends special and ultimate meters in combat');
ok(
  meter.meter.charge === 0 && !!meter.move,
  'bot activates a charged team move with nearby allies',
);
ok(g.local === 0 && g.hero.index === 0, 'brain view restores human control after sensing');
let releases = 0;
for (let i = 0; i < 16; i++) if (!decide().charge) releases++;
ok(releases >= 1 && releases <= 3, '10 Hz thinking still releases right click every 1.6 seconds');
g.enemies.clear();
g.bullets.clear();
g.strikes.length = 0;
h.skill.reset();
h.bombT = -1;
meter.move = null;

// Cooperate on both pads, then pick up and plant a bomb through normal objective logic.
forceCoopObjective(g, 'door');
let obj = coopPlayState(g);
if (!obj.lay) throw new Error('missing door layout');
g.hero.player.teleport(obj.lay.a.x, obj.lay.a.z);
h.player.teleport(obj.lay.b.x + 4, obj.lay.b.z);
squadOrder(g, 'follow');
let intent = decide();
ok(intent.mx < 0, 'bot approaches opposite objective pad');
forceCoopObjective(g, 'bomb');
obj = coopPlayState(g);
if (!obj.lay) throw new Error('missing bomb layout');
g.hero.player.teleport(obj.lay.a.x + 5, obj.lay.a.z);
h.player.teleport(obj.bomb.x, obj.bomb.z);
for (const other of g.heroes.slice(2)) other.player.teleport(40, 40);
g.updateArena(1 / 60);
ok(obj.bomb.by === h.index, 'bot picks up objective bomb by proximity');
h.player.teleport(obj.lay.v.x, obj.lay.v.z);
g.updateArena(1 / 60);
ok(obj.bomb.fuse >= 0 && obj.bomb.by < 0, 'bot plants carried bomb at bunker');

// Real-player co-op achievement counters and trade titles exclude bots.
const tally = meta2State(g);
const oldCoop = tally.local.coopStages ?? 0;
g.stage++;
g.meta2Frame(1);
ok(
  (tally.local.coopStages ?? 0) === oldCoop,
  'squad stage does not progress real co-op stage achievements',
);
tradingDebug(g).feats = [1, 1, 1, 1];
g.tradingStep(1);
ok(
  !save.achievements.includes('co_squad') && !save.achievements.includes('co_buddy'),
  'bots cannot grant real co-op titles',
);

// End-to-end smoke: dev autopilot drives player 1 alongside three independently built bots.
g.startSolo();
installBot(g, input);
const report = (window as any).botRun(360, true);
console.log(
  'squad smoke',
  JSON.stringify({
    stage: report.stage,
    level: report.level,
    kills: report.kills,
    avgMs: report.avgMs,
  }),
);
ok(
  report.kills > 20 && report.level > 1,
  'dev bot plus three bots fights and levels through real update loop',
);
ok(report.stage >= 2, 'squad clears a boss, shops, follows route vote and reaches another stage');
ok(
  g.heroes.slice(1).every((h) => Object.values(h.damageBy).some((d) => d > 0)),
  'every squad bot participates in combat',
);
ok(
  g.heroes
    .slice(1)
    .some(
      (h) =>
        h.weapons.length > 2 ||
        Object.keys(h.passives).length > 0 ||
        h.weapons.some((w) => w.level > 1),
    ),
  'bots develop builds during smoke run',
);
const coopRunsBefore = save.profile.stats.coopRuns ?? 0;
g.meta2Bank(g.summary(g.hero));
ok(
  (save.profile.stats.coopRuns ?? 0) === coopRunsBefore && !save.achievements.includes('m2_coop'),
  'banked squad run cannot earn real co-op run achievement',
);
g.quitRun();
ok(!g.squadRun && g.heroes.length === 1, 'quitting banks and removes the offline squad');
g.leaveToTitle();
ok(
  !g.squadRun && g.heroes.length === 1 && squadDebug(g).brains.size === 0,
  'leaving removes bots and squad state',
);
settings.squadBots = 0;
g.startSolo();
ok(!g.squadRun && g.heroes.length === 1, 'zero bots preserves solo');
settings.squadBots = 3;
settings.mode = 'daily';
g.startSolo();
ok(!g.squadRun && g.heroes.length === 1, 'competitive daily stays solo');
g.leaveToTitle();
console.log('aisquad checks complete');
process.exit(process.exitCode ?? 0);
