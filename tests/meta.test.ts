import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';
import { HEAT, cleanHeat, heatPoints, heatMultiplier, boltReward } from '../src/data/heat';
import { isoWeek, weeklyChallenge, WEEKLY_RULES } from '../src/data/weekly';
import {
  normalize,
  save,
  resetSave,
  recordWeekly,
  unlockedLoadout,
  buyMeta,
  unlockMeta,
  importFile,
  exportFile,
  markSeen,
} from '../src/game/save';
import { rewardAvailable, META_KITS, META_REWARDS, CODEX } from '../src/data/codex';
import { validLoadout } from '../src/data/loadout';
import { jackpotTuning } from '../src/game/cinematics';

ok(HEAT.length === 9 && heatPoints(HEAT.map((h) => h.id)) === 14, 'nine heat toggles total 14');
ok(
  cleanHeat(['haste', 'haste', 'fake']).join() === 'haste',
  'heat deduplicates and ignores unknown ids',
);
ok(
  heatMultiplier([]) === 1 && heatMultiplier(['armor', 'hearts']) === 1.4,
  'heat multiplies score and reward by 10% per point',
);
ok(
  boltReward(250, 2, ['armor', 'hearts']) === 42 && boltReward(0, 0, []) === 0,
  'Bolts reward kills and bosses, not instant retries',
);
for (const [date, week] of [
  ['2021-01-01', '2020-W53'],
  ['2021-01-04', '2021-W01'],
  ['2024-12-30', '2025-W01'],
  ['2026-10-18', '2026-W42'],
  ['2026-10-19', '2026-W43'],
]) {
  ok(isoWeek(new Date(date + 'T12:00:00Z')) === week, `ISO week ${date} -> ${week}`);
}
const coverage = new Set<string>();
for (let i = 1; i <= 52; i++) {
  const week = `2026-W${String(i).padStart(2, '0')}`;
  const w = weeklyChallenge(week);
  ok(
    w.seed === weeklyChallenge(week).seed &&
      w.rules[0].id !== w.rules[1].id &&
      w.board === `weekly-${week}`,
    `deterministic distinct rules ${week}`,
  );
  w.rules.forEach((r) => coverage.add(r.id));
}
ok(coverage.size === WEEKLY_RULES.length, 'all weekly rules rotate through the year');
const old = normalize({
  version: 1,
  bolts: 99999,
  upgrades: { damage: 10 },
  achievements: ['first_steps'],
  seen: ['bopper'],
  lifetime: { kills: 400 },
});
ok(
  old.version === 4 && old.lifetime.kills === 400 && old.achievements.includes('first_steps'),
  'v1 stats and achievements migrate',
);
ok(
  old.meta.bolts === 0 && old.meta.heat.length === 0 && old.meta.codex.includes('enemy:bopper'),
  'legacy power currency is not imported; guide migrates into codex',
);
const bad = normalize({
  meta: {
    heat: ['shop', 'shop', 'fake'],
    bolts: -3,
    bestHeat: { standard: Infinity, bossrush: 99 },
    weekly: [null, { week: '<bad>', score: 1, stage: 1 }],
    rewards: ['nope'],
    codex: ['nope'],
    theme: 'mint',
  },
});
ok(
  bad.meta.bolts === 0 &&
    bad.meta.heat.join() === 'shop' &&
    bad.meta.bestHeat.bossrush === 14 &&
    !bad.meta.weekly.length &&
    !bad.meta.theme,
  'malformed optional metadata safely normalizes',
);
resetSave();
recordWeekly('2026-W43', 6000, 2);
recordWeekly('2026-W43', 2000, 1);
recordWeekly('2026-W42', 3000, 2);
ok(
  save.meta.weekly.length === 2 && save.meta.weekly[0].score === 6000,
  'weekly best never replaced by a worse attempt',
);
unlockMeta();
ok(
  save.meta.rewards.includes('weekly_kit') && !save.meta.rewards.includes('heat_kit'),
  'weekly unlock is a sidegrade kit',
);
save.meta.bestHeat.standard = 4;
unlockMeta();
for (const kit of Object.values(META_KITS))
  ok(
    JSON.stringify(validLoadout(kit, unlockedLoadout())) === JSON.stringify(kit),
    'meta starting kit has valid unlocked slots',
  );
ok(!buyMeta('sunset'), 'cannot buy cosmetics without Bolts');
save.meta.bolts = 100;
ok(
  buyMeta('sunset') && save.meta.bolts === 40 && !buyMeta('sunset'),
  'cosmetic purchase charged once',
);
markSeen('bopper');
markSeen('bopper');
ok(save.meta.codex.filter((c) => c === 'enemy:bopper').length === 1, 'encounters are idempotent');
const exported = exportFile();
resetSave();
importFile(exported);
ok(
  save.meta.bolts === 40 &&
    save.meta.rewards.includes('sunset') &&
    save.meta.weekly[0].score === 6000,
  'save export/import preserves meta progression',
);
ok(
  !rewardAvailable('unknown', { achievements: [], bestHeat: {}, weekly: [] }),
  'unknown rewards remain locked',
);
ok(
  META_REWARDS.every((r) => !('stats' in r)) &&
    new Set(CODEX.map((c) => c.id)).size === CODEX.length,
  'rewards have no stats and lore ids are unique',
);
resetSave();

// Real Game integration: rule effects and host snapshot round-trip.
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
const { ENEMIES } = await import('../src/data/enemies');
const { MOD_BY_ID } = await import('../src/data/mods');
const { PickupType } = await import('../src/game/pickups');
const { bankMeta } = await import('../src/game/systems/meta');
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
settings.difficulty = 'normal';
host.startSolo();
host.closeShop();
const base = host.spawnOpts();
const dash = host.hero.stats.dashCooldownMul;
const mod = Object.values(MOD_BY_ID)[0];
const price = host.hero.price(mod);
save.meta.heat = HEAT.map((h) => h.id);
host.startSolo();
host.closeShop();
const hot = host.spawnOpts();
ok(
  Math.abs(hot.hpMul! / base.hpMul! - 1.35) < 1e-9 &&
    Math.abs(hot.speedMul! / base.speedMul! - 1.25) < 1e-9 &&
    Math.abs(hot.dmgMul! / base.dmgMul! - 1.25) < 1e-9,
  'heat changes authoritative spawn stats',
);
ok(
  host.director.countMul === 1.25 && Math.abs(host.hero.stats.dashCooldownMul / dash - 1.5) < 1e-9,
  'crowd and dash heat active',
);
ok(
  host.hero.price(mod) === Math.round(price * 1.5),
  'shop heat applies to the actual charged Mod price',
);
host.hero.player.hp = 50;
host.collect(host.hero, PickupType.Heart, 1);
ok(host.hero.player.hp === 50, 'no-snacks ignores hearts from any source');
// A spawn can roll into a golden jackpot chest (seeded per run); keep these plain so the count is exact.
jackpotTuning.chance = 0;
host.updateChestSpawns(30);
ok(host.chests.closedCount === 0, 'lost cargo does not spawn a chest at normal cadence');
host.updateChestSpawns(30);
ok(host.chests.closedCount === 1, `lost cargo spawns a chest at twice normal cadence (${host.chests.closedCount} closed, chestT ${host.chestT}, seed ${host.seed})`);
host.score = 1000;
ok(host.summary(host.hero).score === 2400, 'all accumulated score is multiplied once at summary');
client.role = 'client';
client.clientStart(host.seed, 0, [{ name: 'Test', skin: 'weekly_skin' }]);
ok(
  client.hero.skin.id === 'weekly_skin',
  'meta skin resolves on a client without owning that cosmetic',
);
client.clientStage(1, host.seed);
client.applySnapshot(host.buildSnapshot(host.hero, []));
ok(
  client.meta.points === 14 && client.summary(client.hero).score === 2400,
  'host heat and score round-trip to a client without double multiplication',
);
const sum = host.summary(host.hero);
sum.clears = 1;
sum.bosses = 4;
sum.kills = 250;
const bolts = bankMeta(host, sum);
ok(
  bolts === 120 && save.meta.bestHeat.standard === 14 && bankMeta(host, sum) === 0,
  'clear records best heat and banks rewards once',
);
settings.mode = 'weekly';
settings.hero = 'ace';
settings.loadout = META_KITS.weekly_kit;
settings.pet = 'sparky';
host.startSolo();
host.closeShop();
ok(
  host.meta.heat.length === 0 &&
    host.seed === weeklyChallenge().seed &&
    host.difficulty.id === 'normal',
  'weekly ignores saved heat and fixes seed/difficulty',
);
ok(
  host.hero.heroDef.id === 'rookie' &&
    host.hero.pet === 'none' &&
    host.hero.weapons[0].def.id === 'buster' &&
    host.hero.weapons[1].def.id === 'charge',
  'weekly fixes hero, weapons and pet',
);
host.meta.rules = ['right'];
let primaryTicks = 0,
  secondaryTicks = 0;
host.hero.weapons[0].update = () => {
  primaryTicks++;
};
host.hero.weapons[1].update = () => {
  secondaryTicks++;
};
host.simulate(1 / 60, false);
ok(
  primaryTicks === 0 && secondaryTicks === 1,
  'right-only week suppresses the primary weapon simulation',
);
host.meta.rules = ['elites'];
host.clearWorld();
host.spawnEnemy(ENEMIES.bopper);
ok(
  host.enemies.list.some((e) => e.active && e.elite),
  'elite parade converts normal director spawns',
);
host.meta.rules = ['glass'];
cheats.god = false;
host.hero.revivesLeft = 0;
host.hero.player.invuln = 0;
host.hero.player.hp = host.hero.player.maxHp;
host.hurtHero(host.hero, 1, 1, 0);
ok(host.hero.player.dead, 'one-hit week bypasses the normal max-hit cap');
settings.mode = 'standard';
settings.hero = 'rookie';
settings.pet = 'none';
host.startSolo();
ok(
  host.meta.rules.length === 0 && host.meta.heat.length === HEAT.length,
  'next ordinary run clears weekly rules and restores selected heat',
);
for (const name of ['heat', 'weekly', 'codex', 'rewards'] as const) {
  host.screens.show(name);
  ok(
    !!document.querySelector(`#scr-${name}:not([hidden]) [data-nav]`),
    `${name} screen renders navigable controls`,
  );
}
process.exit(process.exitCode ?? 0);
