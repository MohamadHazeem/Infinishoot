/** Director2 rules plus real-Game integration and optional seeded bot A/B report. */
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
(globalThis as any).Path2D = class {
  constructor(_d?: string) {}
};
(globalThis as any).__APP_VERSION__ = 'smoke';
(dom.window as any).Path2D = (globalThis as any).Path2D;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});
const errors: string[] = [];
process.on('uncaughtException', (e) => errors.push('uncaught ' + e.stack));

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { AdaptivePace, Director, adaptiveTuning } = await import('../src/game/director');
const { director2Events, director2State, director2Live } =
  await import('../src/game/systems/director2');
const { ENEMIES } = await import('../src/data/enemies');
const { RELICS } = await import('../src/data/relics');
const { CODEX } = await import('../src/data/codex');
const { ICON_ART } = await import('../src/data/iconArt');
const { Rng } = await import('../src/core/rng');
const { settings } = await import('../src/game/settings');
const { Team } = await import('../src/game/bullets');
const { PickupType } = await import('../src/game/pickups');
const { StaticBoxGrid } = await import('../src/core/spatialHash');
const { SnapDecoder } = await import('../src/net/snapCodec');
const { worldEventTuning } = await import('../src/game/worldEvents');
settings.autoFire = false;
worldEventTuning.enabled = false;
const a = new AdaptivePace();
a.hurt(0.35, 0.2, false);
for (let i = 0; i < 300; i++) a.step(1 / 60, 0.2, 0);
ok(
  a.pressure <= 0.79 && a.breather > 0 && a.nearDeaths === 1,
  'near-death gives a bounded six-second breather',
);
a.hurt(0.1, 0.1, false);
ok(a.nearDeaths === 1, 'repeated hits cannot perpetually refresh a breather');
let integral = 0;
for (let i = 0; i < 60 * 180; i++) {
  a.step(1 / 60, 1, i % 30 === 0 ? 1 : 0);
  integral += a.pressure / 60;
}
ok(
  a.pressure <= adaptiveTuning.max && a.pressure > 1 && integral > 180 && a.debt === 0,
  'recovery repays deferred pressure and cruising adds pressure over a full run',
);
a.hurt(1, 0, true);
ok(a.deaths === 1 && a.breather > 0, 'death telemetry triggers a fresh eligible breather');
a.reset();
ok(a.pressure === 1 && a.deaths === 0 && a.nearDeaths === 0, 'new stage resets telemetry');
const team = new AdaptivePace();
team.hurt(0.5, 0.2, false, 4);
ok(Math.abs(team.damagePerMinute - 0.5) < 1e-6, 'damage per minute normalizes for team size');
const d = new Director();
d.start(3);
d.countMul = 1.4;
d.time = 100;
const baseBoss = d.bossHpMul,
  baseHp = d.hpMul,
  baseDmg = d.dmgMul,
  count = d.targetAlive;
d.adaptive.pressure = 0.78;
ok(
  d.bossHpMul === baseBoss && d.hpMul === baseHp && d.dmgMul === baseDmg && d.targetAlive < count,
  'only count/rate changes; difficulty and boss HP stay intact',
);
d.start(2);
d.time = 47.99;
d.adaptive.breather = 6;
const req = d.update(0.1, 999, () => 0, new Rng(42));
ok(
  !req.some((r) => r.kind === 'ring' || (r.kind === 'enemy' && r.elite)),
  'near-death defers simultaneous rings and elites',
);
d.time = d.duration;
ok(
  d.update(0.1, 999, () => 0, new Rng(43)).some((r) => r.kind === 'boss'),
  'breathers never defer the stage boss',
);

const ids = [
  'r_backbeat',
  'r_relay',
  'r_capacitor',
  'r_mercy',
  'r_anchor',
  'r_glassclock',
  'r_salvage',
  'r_coldsnap',
  'r_reserve',
  'r_jackpot',
  'r_cinder',
  'r_pacemaker',
];
ok(
  ids.every((id) => RELICS.some((r) => r.id === id && r.rarity && r.desc) && ICON_ART[id]),
  'all twelve relics have descriptions, rarity and unique icon art',
);
ok(
  new Set(ids.map((id) => JSON.stringify(ICON_ART[id]))).size === 12,
  'new relic icon silhouettes are distinct',
);
for (const id of ['bastion', 'blinksniper', 'bombcourier']) {
  ok(
    ENEMIES[id].weight > 0 && !!ENEMIES[id].material && CODEX.some((c) => c.id === `enemy:${id}`),
    `${id} has director eligibility, hit material and codex entry`,
  );
}
const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new Input(canvas);
const g = new Game(
  input,
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
const start = () => {
  g.startRun({ seed: 912, difficulty: 'normal' });
  if (g.mode === 'shop') g.closeShop();
  g.xpNext = 1e9;
  g.update(1 / 60);
};
start();
const h = g.hero,
  p = h.player;
h.relics.push(...ids);
h.recomputeStats();
p.hp = 10;
g.collect(h, PickupType.Heart, 6);
ok(p.hp === 16, 'Meteor Garden hearts heal their six-life value');
g.collect(h, PickupType.Heart, 1);
ok(p.hp === 46, 'ordinary hearts still heal thirty life');
p.hp = 40;
h.bombCharge = 0;
for (let i = 0; i < 3; i++) g.director2Dash(h);
ok(
  Math.abs(h.bombCharge - 0.12) < 1e-6 && p.hp === 44,
  'third dash restores charge; relay heals once during its cooldown',
);
ok(
  g.strikes.some((s) => s.cause === 'Cinder Receipt' && s.dmg === 0),
  'every second dash schedules an enemy-only Cinder blast',
);
const oldHp = p.hp;
g.updateStrikes(1);
ok(p.hp === oldHp, 'zero-damage friendly strikes cannot inflict the minimum one-point hero hit');
p.hp = p.maxHp;
h.bombCharge = 1;
h.refreshLive();
const fullDamage = h.stats.damageMul,
  fullCd = h.stats.cooldownMul,
  fullMagnet = h.stats.magnet;
p.hp = p.maxHp - 10;
h.bombCharge = 0;
h.refreshLive();
ok(
  fullDamage > h.stats.damageMul &&
    fullCd < h.stats.cooldownMul &&
    fullMagnet === h.stats.magnet * 2,
  'Glass Clock and Reserve Dynamo switch correctly at their thresholds',
);
for (let i = 0; i < 70; i++) g.updateDirector2(1 / 60);
h.refreshLive();
const anchored = h.stats.armor;
p.vel.x = 3;
g.updateDirector2(1 / 60);
h.refreshLive();
ok(anchored - h.stats.armor === 4, 'Anchor Badge starts after one second and stops on movement');
p.vel.x = 0;
const foe = g.enemies.spawn(ENEMIES.bopper, p.x + 1, p.z, { instant: true });
const king = g.enemies.spawn(ENEMIES.king, p.x + 2, p.z, { instant: true });
foe.state = king.state = 'move';
g.hash.clear();
g.hash.insert(foe, foe.x, foe.z, foe.radius);
g.hash.insert(king, king.x, king.z, king.radius);
g.updateDirector2(5);
g.director2Dash(h);
ok(foe.frozen > 0 && king.frozen === 0, 'Cold Snap freezes regular enemies but never bosses');
g.enemies.clear();
g.bullets.spawn({
  x: p.x + 1,
  z: p.z,
  dirX: 1,
  dirZ: 0,
  speed: 1,
  life: 10,
  radius: 0.2,
  damage: 5,
  team: Team.Enemy,
  color: '#ff3df0',
});
g.updateDirector2(11);
h.bombCharge = 0;
g.director2Hurt(h, 10);
ok(
  g.bullets.count === 0 && h.bombCharge === 0.15,
  'Pacemaker clears nearby enemy bullets and Pain Capacitor charges on hurt',
);
const dummy = g.enemies.spawn(ENEMIES.bopper, p.x + 2, p.z, { instant: true });
p.hp = 20;
for (let i = 0; i < 12; i++) g.director2Kill(dummy, h);
ok(p.hp === 28, 'Mercy Coin heals below half health');
for (let i = 0; i < 12; i++) g.director2Kill(dummy, h);
ok(p.hp === 28, 'Mercy Coin cannot multiply its reward during a kill burst');
g.updateDirector2(6.1);
p.hp = p.maxHp;
const gold = h.gold;
for (let i = 0; i < 12; i++) g.director2Kill(dummy, h);
ok(h.gold === gold + 2, 'Mercy Coin pays gold above half health');
h.bombCharge = 0;
for (let i = 0; i < 4; i++) g.director2Kill(dummy, h);
ok(h.bombCharge === 1, 'Forty Winks refills on the fortieth kill');
dummy.elite = true;
const pickups = g.pickups.count;
g.director2Kill(dummy, h);
ok(
  g.pickups.count === pickups + 1 && g.pickups.type[g.pickups.count - 1] === PickupType.Gear,
  'Salvage Permit drops a gear on elite kills',
);
// End-state objects retain their final timer so rewards cannot double-pay.
for (const id of director2Events) {
  g.enemies.clear();
  g.pickups.clear();
  g.strikes.length = 0;
  g.runEvents.forceEvent(id);
  g.updateDirector2(0.01);
  const eventGold = h.gold;
  for (let i = 0; i < 30 * 60; i++) {
    g.runEvents.update(1 / 60, 0, false);
    g.updateDirector2(1 / 60);
  }
  ok(h.gold === eventGold + 8 && !g.runEvents.event, `${id} expires and pays exactly once`);
}
g.runEvents.forceEvent('gravity');
g.updateDirector2(0.01);
const s = director2State(g);
const tug = g.enemies.spawn(ENEMIES.bopper, s.x + 4, s.z, { instant: true });
tug.state = 'move';
g.walls = new StaticBoxGrid([]);
const xBefore = tug.x;
g.updateDirector2(0.1);
ok(tug.x < xBefore, 'Gravity Storm gathers regular enemies');
g.runEvents.forceEvent('rebellion');
const robot = g.enemies.spawn(ENEMIES.bopper, p.x + 1, p.z, { instant: true });
const victim = g.enemies.spawn(ENEMIES.chonk, p.x + 2, p.z, { instant: true });
g.hash.clear();
for (const e of [robot, victim]) g.hash.insert(e, e.x, e.z, e.radius);
robot.state = victim.state = 'move';
const life = victim.hp;
g.updateDirector2(0.1);
ok(victim.hp < life, 'Robot Rebellion causes robots to damage nearby enemies');
// Blink wind-up and freeze interaction: no invisible relocation during the freeze.
g.runEvents.event = null;
g.updateDirector2(0.01);
g.enemies.clear();
g.hash.clear();
const blink = g.enemies.spawn(ENEMIES.blinksniper, p.x + 8, p.z, { instant: true });
blink.state = 'move';
blink.timerA = 20;
g.updateDirector2(9);
const beforeBlinkX = blink.x,
  beforeBlinkZ = blink.z;
blink.frozen = 1;
g.updateDirector2(2);
ok(blink.x === beforeBlinkX && blink.z === beforeBlinkZ, 'frozen Blink Rangers cannot teleport');
blink.frozen = 0;
g.updateDirector2(1.1);
g.updateDirector2(0.5);
ok(
  blink.x === beforeBlinkX && blink.z === beforeBlinkZ,
  'blink waits for its destination telegraph',
);
g.updateDirector2(0.5);
ok(
  Math.hypot(blink.x - beforeBlinkX, blink.z - beforeBlinkZ) > 3 && blink.timerA === 0.6,
  'blink lands away from the hero and gives a fresh aim delay',
);
// Meteor Garden obeys existing no-heart run rules rather than bypassing Famine.
g.curses.push('c_famine'); g.pickups.clear();
g.runEvents.forceEvent('garden'); g.updateDirector2(0.01); g.updateDirector2(1.7);
ok(g.pickups.count > 0 && Array.from(g.pickups.type.slice(0, g.pickups.count)).every((t) => t !== PickupType.Heart), 'Meteor Garden substitutes coins when hearts are forbidden');
g.curses.length = 0;
g.runEvents.event = null;
// Complete snapshot codec path, including new enemy identifiers and relic inventory.
g.director.adaptive.pressure = 0.91;
const snapshot = g.buildSnapshot(h, []);
const decoded = new SnapDecoder().decode(snapshot);
ok(
  !!decoded && JSON.stringify(decoded.d2) === JSON.stringify(g.director2Net()),
  'd2 pressure survives the snapshot codec',
);
const client = new Game(
  new Input(canvas),
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
(client as any).role = 'client';
client.applySnapshot(snapshot);
ok(
  [...client.netEnemies.values()].some((e) => e.def.id === 'blinksniper') &&
    client.hero.relics.includes('r_backbeat'),
  'new enemy IDs and relics reach a real client through snapshots',
);
client.applyDirector2Net(decoded!.d2);
ok(client.director.adaptive.pressure === 0.91, 'client mirrors host pressure');
client.applyDirector2Net([NaN, 1, 2, 3, 0, 0]);
ok(client.director.adaptive.pressure === 0.91, 'malformed telemetry cannot poison client state');
const clientKills = client.kills;
client.updateDirector2(10);
ok(
  client.kills === clientKills && client.director.adaptive.pressure === 0.91,
  'client never runs authoritative director logic',
);
start();
h.relics.push('r_backbeat');
h.bombCharge = 0;
g.director2Dash(h);
ok(h.bombCharge === 0, 'a new run clears relic counters');
// Delayed relic blasts must credit the guest who left them, never the host by default.
const guest = g.makeHero(1, 'Guest', []);
g.setHeroes([h, guest]);
guest.relics.push('r_cinder');
g.enemies.clear();
g.hash.clear();
g.strikes.length = 0;
const creditFoe = g.enemies.spawn(ENEMIES.chonk, guest.player.x + 1, guest.player.z, {
  instant: true,
});
creditFoe.state = 'move';
creditFoe.hp = creditFoe.maxHp = 10000;
g.hash.insert(creditFoe, creditFoe.x, creditFoe.z, creditFoe.radius);
g.director2Dash(guest);
g.director2Dash(guest);
g.updateStrikes(1);
ok((guest.damageBy.meteor ?? 0) > 0, 'a guest receives credit for their delayed Cinder blast');
guest.left = true;
g.director.adaptive.reset();
g.director2Hurt(h, h.player.maxHp * 0.25);
ok(g.director.adaptive.damagePerMinute === 1, 'departed teammates do not dilute incoming-damage telemetry');
g.setHeroes([h]);
// Isolated lane CPU cost, independent of the software renderer / other browser jobs.
if (process.env.DIRECTOR2_MICRO) {
  start(); g.enemies.clear(); g.runEvents.event = null;
  for (let i = 0; i < 200; i++) {
    const e = g.enemies.spawn(ENEMIES[i < 3 ? 'blinksniper' : 'bopper'], p.x + 8 + i % 20, p.z + Math.floor(i / 20), { instant: true });
    e.state = 'move';
  }
  for (let i = 0; i < 1000; i++) g.updateDirector2(1 / 60);
  const t = performance.now();
  for (let i = 0; i < 20000; i++) g.updateDirector2(1 / 60);
  console.log('DIRECTOR2_MICRO_MS', ((performance.now() - t) / 20000).toFixed(4));
}
// Real bot A/B: same content, loadout and seeded arena, adaptive pacing disabled/enabled.
if (process.env.DIRECTOR2_BALANCE) {
  const { installBot } = await import('../src/dev/bot');
  const { save } = await import('../src/game/save');
  save.achievements.push(
    'first_steps',
    'boss_slayer',
    'elite_hunter',
    'stage_3',
    'maxed',
    'evolved',
  );
  installBot(g, input);
  const bot = (window as any).botRun;
  const reports: unknown[] = [];
  for (const enabled of [false, true])
    for (const seed of [42, 912, 731]) {
      adaptiveTuning.enabled = enabled;
      settings.hero = 'rookie';
      settings.pet = 'sparky';
      g.runMode = 'standard';
      g.startRun({ seed, difficulty: 'normal' });
      if (g.mode === 'shop') g.closeShop();
      let pressureArea = 0,
        targetArea = 0,
        seconds = 0,
        minAfterSpike = 1;
      const history: number[] = [];
      for (let sec = 0; sec < 240 && g.mode !== 'dead'; sec++) {
        // A reproducible near-death at 40 s tests the same spike in both cohorts.
        if (sec === 40) {
          p.hp = p.maxHp * 0.4;
          p.invuln = 0;
          g.hurtHero(h, p.maxHp * 0.25, p.x - 1, p.z, null, 'A/B spike');
        }
        bot(1, false);
        pressureArea += g.director.adaptive.pressure;
        targetArea += g.director.targetAlive;
        seconds++;
        if (sec >= 40 && sec < 46)
          minAfterSpike = Math.min(minAfterSpike, g.director.adaptive.pressure);
        if (sec % 30 === 0) history.push(Math.round(g.director.adaptive.pressure * 1000) / 1000);
      }
      reports.push({
        enabled,
        seed,
        seconds,
        kills: g.kills,
        stage: g.stage,
        hp: Math.round(p.hp),
        meanPressure: +(pressureArea / seconds).toFixed(3),
        meanTarget: +(targetArea / seconds).toFixed(1),
        minAfterSpike: +minAfterSpike.toFixed(3),
        history,
      });
    }
  console.log('DIRECTOR2_BALANCE', JSON.stringify(reports));
  adaptiveTuning.enabled = true;
}
ok(errors.length === 0, `no runtime errors: ${errors.join('; ')}`);
