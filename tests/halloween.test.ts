import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';
import {
  seasonAt,
  seasonalStage,
  normalizeSeason,
  buyCandyCosmetic,
  HALLOWEEN_COSMETICS,
} from '../src/data/seasons';
import { normalize, save, resetSave, exportFile, importFile } from '../src/game/save';
import { ENEMIES } from '../src/data/enemies';
import { biomeForStage } from '../src/data/biomes';
import { phaseGate } from '../src/game/bosses';
import {
  HalloweenState,
  selectSeason,
  dropCandy,
  halloweenStep,
  halloweenNet,
  applyHalloweenNet,
  halloweenKill,
  resetHalloween,
  pumpkinBrain,
  addHalloweenVine,
  applyVineGrab,
  cleanHalloweenLook,
} from '../src/game/systems/halloween';
for (const [date, expected] of [
  ['2026-10-14T23:59:59Z', false],
  ['2026-10-15T00:00:00Z', true],
  ['2026-11-07T23:59:59Z', true],
  ['2026-11-08T00:00:00Z', false],
]) {
  ok(!!seasonAt(new Date(date as string)) === expected, `UTC seasonal boundary ${date}`);
}
ok(
  seasonAt(new Date('2026-03-01'), 'halloween')?.id === 'halloween',
  'force season outside calendar window',
);
ok(!seasonAt(new Date('2026-10-31'), 'off'), 'explicit off overrides calendar');
ok(!seasonAt(new Date('invalid')), 'invalid date has no event');
for (let stage = 1; stage <= 16; stage++)
  ok(
    !!seasonalStage(stage, 'halloween') === (stage % 4 === 2),
    `one Haunted stage per loop: ${stage}`,
  );
ok(!seasonalStage(2, null), 'inactive session never remixes stage');
const old = normalize({ version: 4, lifetime: { kills: 42 } });
ok(
  old.version >= 5 && old.lifetime.kills === 42 && old.seasonal.candy === 0,
  'v4 migrates with stats intact and empty seasonal wallet',
);
const wallet = normalizeSeason({
  candy: 100.7,
  owned: ['bat_pet', 'bat_pet', 'fake'],
  equipped: ['bat_pet', 'ghost_trail'],
});
ok(
  wallet.candy === 100 && wallet.owned.length === 1 && wallet.equipped.join() === 'bat_pet',
  'wallet sanitizes and only equips owned cosmetics',
);
ok(!buyCandyCosmetic(wallet, 'ghost_trail', false), 'out-of-season purchases blocked');
ok(
  buyCandyCosmetic(wallet, 'ghost_trail', true) && wallet.candy === 55,
  'purchase deducts exact candy',
);
ok(
  !buyCandyCosmetic(wallet, 'ghost_trail', true) && wallet.candy === 55,
  'duplicate purchase is idempotent',
);
ok(!buyCandyCosmetic(wallet, 'unknown', true), 'unknown cosmetic rejected');
ok(
  normalizeSeason({ candy: Infinity }).candy === 0 && normalizeSeason({ candy: -2 }).candy === 0,
  'invalid balances rejected',
);
ok(
  cleanHalloweenLook('fake,bat_pet,bat_pet') === 'bat_pet',
  'network look accepts only known cosmetic ids',
);
resetSave();
save.seasonal = wallet;
importFile(exportFile());
ok(
  save.seasonal.owned.includes('ghost_trail') && save.seasonal.candy === 55,
  'save export/import retains permanent purchases',
);
const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window as unknown as Record<string, unknown>;
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
// Any crash must fail the test (a rejected top-level await can otherwise exit 0 silently).
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { settings } = await import('../src/game/settings');

const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () =>
  new Game(
    new Input(canvas),
    16 / 9,
    document.getElementById('hud')!,
    document.getElementById('reticle')!,
  );

const host = mk();
const client = mk();
settings.mode = 'standard';
settings.bossIntros = false;
settings.bossFinishers = false;
host.startSolo();
host.closeShop();
selectSeason.call(host, 'halloween');
host.loadStage(2);
ok(biomeForStage(2).variant === 'haunted', 'session selects haunted biome');
host.spawnBoss(ENEMIES.rex);
ok(host.boss?.def.id === 'pumpking', 'Haunted stage spawns PUMPKING');
const boss = host.boss!;
boss.roarT = 0;
boss.state = 'move';
boss.timerA = 0;
for (const phase of [1, 2, 3]) {
  boss.phase = phase;
  boss.state = 'move';
  boss.timerA = 0;
  boss.step = phase === 3 ? 3 : phase === 2 ? 2 : 0;
  pumpkinBrain(boss, 1 / 60, host.enemyCtx, 1, 0, 10, 2);
  ok(boss.state === 'windup', `phase ${phase} telegraphs its move`);
  ok(
    boss.action === (phase === 3 ? 'spiral' : phase === 2 ? 'rain' : 'volley'),
    `phase ${phase} attack rotation`,
  );
}
boss.phase = 1;
boss.hp = 0;
ok(phaseGate(boss) === 2 && boss.hp > 0, 'burst damage cannot skip PUMPKING phases');
boss.phase = 2;
boss.hp = 0;
ok(phaseGate(boss) === 3 && boss.hp > 0, 'final phase is gated');
boss.phase = 3;
client.onClientMessage({
  t: 'start',
  season: 'halloween',
  seed: host.seed,
  you: 0,
  players: [{ name: 'Client' }],
});
client.onClientMessage({ t: 'stage', season: 'halloween', seed: host.seed, stage: 2 });
client.applySnapshot(host.buildSnapshot(host.hero, []));
ok(
  client.enemies.list.some((e) => e.active && e.def.id === 'pumpking' && e.phase === 3),
  'PUMPKING model and phase travel through real snapshots',
);
ok(
  host.arena.colliders.length === client.arena.colliders.length,
  'host and client generate the same Haunted arena',
);
const count = host.enemies.activeCount;
host.bossDuel = { uid: boss.uid, x: 0, z: 0, r: 10, r0: 10, r1: 8, t: 0 };
host.enemyCtx.spawnChild('pumpkin', 0, 0, boss);
ok(host.enemies.activeCount === count, 'PUMPKING respects the final duel summon restriction');
host.bossDuel = null;
resetHalloween.call(host);
host.director.bossSpawned = true;
const before = save.seasonal.candy;
dropCandy.call(host, host.hero.player.x, host.hero.player.z, 3);
halloweenStep.call(host, 1 / 60);
ok(
  host.halloween.earned === 3 && save.seasonal.candy === before + 3,
  'host collection banks candy immediately',
);
const net = halloweenNet.call(host);
client.role = 'client';
client.halloween = new HalloweenState();
applyHalloweenNet.call(client, net);
const after = save.seasonal.candy;
applyHalloweenNet.call(client, net);
ok(
  client.halloween.earned === 3 && save.seasonal.candy === after,
  'duplicate snapshots cannot award candy twice',
);
const earned = host.halloween.earned;
host.clearWorld();
ok(host.halloween.earned === earned, 'stage transitions retain cumulative candy receipt');
resetHalloween.call(host);
ok(host.halloween.earned === 0, 'new runs reset cumulative candy receipt');
for (let i = 0; i < 100; i++) dropCandy.call(host, i, i, 1);
ok(host.halloween.drops.filter((d) => d.value).length === 64, 'candy pickup pool is bounded');
host.clearWorld();
const e = host.enemies.spawn(ENEMIES.pumpkin, 0, 0, { instant: true });
const bullets = host.bullets.count;
halloweenKill.call(host, e);
ok(host.bullets.count === bullets + 5, 'pumpkin death bursts five seed bullets');
addHalloweenVine.call(host, 0, 0);
ok(
  host.halloween.vines.some((v) => v.t > 1),
  'vines have a full warning interval',
);
const grab = host.halloween.grabs[0];
grab.x = 0;
grab.z = 0;
grab.t = 1.2;
host.hero.player.pos.x = 3;
host.hero.player.pos.z = 0;
applyVineGrab(host, 0, 1 / 60);
ok(Math.abs(host.hero.player.x - 0.65) < 0.001, 'vine grab constrains movement');
host.hero.player.dashT = 0.2;
applyVineGrab(host, 0, 1 / 60);
ok(grab.t === 0, 'dash breaks vine grab');
const ghost = host.enemies.spawn(ENEMIES.ghost, 0, 0, { instant: true });
ghost.state = 'move';
ok(ghost.def.behavior === 'ghost' && ghost.targetable, 'fading ghosts remain targetable');
const snap = host.buildSnapshot(host.hero, []);
client.applySnapshot(snap);
ok(client.halloween.season === 'halloween', 'real snapshot codec carries Halloween state');
ok(
  HALLOWEEN_COSMETICS.every((c) => !('stats' in c)),
  'seasonal rewards never grant combat power',
);
console.log('Halloween integration complete');
