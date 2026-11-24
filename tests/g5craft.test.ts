// CRAFT_BENCH=run|probe CRAFT_SEED=42 npm test -- g5craft
import { pathToFileURL } from 'node:url';
import type { EnemyDef } from '../src/data/enemies';
import type { Game as GameType } from '../src/game/game';
import type { Weapon } from '../src/game/weapons/base';

type Runner = (seconds: number) => unknown;
export function measureRun(g: GameType, run: Runner) {
  let mask = 0;
  for (let i = 0; i < 1600 && g.mode !== 'dead' && g.mode !== 'title' && !g.victories; i++) {
    run(1);
    const w = g.hero.weapons.find((item) => item.def.id === 'crafted') as
      (Weapon & { discoveries: number }) | undefined;
    mask |= w?.discoveries ?? 0;
  }
  return {
    clear: !!g.victories,
    stage: g.stage,
    level: g.level,
    kills: g.kills,
    seconds: Math.round(g.runTime),
    distinct: mask.toString(2).split('1').length - 1,
  };
}
export function medianDistinct(runs: ReadonlyArray<ReturnType<typeof measureRun>>): number | null {
  if (!runs.length) return null;
  const counts = runs.map((run) => run.distinct).sort((a, b) => a - b);
  return (counts[Math.floor((counts.length - 1) / 2)] + counts[Math.floor(counts.length / 2)]) / 2;
}

export function measureWeapon(game: GameType, run: Runner, weapon: Weapon, target: EnemyDef) {
  const h = game.hero;
  const start = game.runTime,
    damage = h.damageBy[weapon.def.id] ?? 0;
  game.xpNext = 1e9;
  game.director.update = () => [];
  game.enemies.clear();
  h.weapons.push(weapon);
  for (let i = 0; i < 30 && game.mode !== 'dead'; i++) {
    for (let n = game.enemies.list.filter((e) => e.active).length; n < 12; n++) {
      const a = game.rng.next() * Math.PI * 2;
      const e = game.enemies.spawn(
        target,
        h.player.x + Math.cos(a) * 7,
        h.player.z + Math.sin(a) * 7,
        { instant: true },
      );
      e.hp = e.maxHp = 2500;
    }
    run(1);
  }
  const seconds = game.runTime - start;
  return {
    seconds,
    dps: Math.round(((h.damageBy[weapon.def.id] ?? 0) - damage) / Math.max(1, seconds)),
  };
}

async function main() {
  const { seedRandom } = await import('./jsdomEnv');
  const { Game } = await import('../src/game/game');
  const { Input } = await import('../src/core/input');
  const { ENEMIES } = await import('../src/data/enemies');
  const { settings } = await import('../src/game/settings');
  const { installBot } = await import('../src/dev/bot');
  const { createWeapon } = await import('../src/game/weapons');
  const { equippedCraft, fitPart, recordDiscoveries, readJournal, normalizeJournal } =
    await import('../src/game/crafting');
  const { PARTS, FRAMES, CORES, MODIFIERS, socketOf, craftTuning, craftInteractions } =
    await import('../src/data/craftParts');
  const { Crafted } = await import('../src/game/weapons/crafted');
  const assert = (await import('node:assert/strict')).default;
  const seed = Number(process.env.CRAFT_SEED ?? 42);
  seedRandom(seed);
  Object.assign(settings, {
    hero: 'rookie',
    pet: 'none',
    mode: 'standard',
    difficulty: 'normal',
    loadout: { primary: 'buster', secondary: 'charge', special: 'bomb' },
    cinematics: 'off',
    bossIntros: false,
    finishers: false,
    tips: false,
  });
  const input = new Input(document.getElementById('game') as HTMLCanvasElement);
  const g = new Game(
    input,
    16 / 9,
    document.getElementById('hud')!,
    document.getElementById('reticle')!,
  );
  installBot(g, input);
  // A build policy only selects real offers and spends the hero's real gold.
  // The supplied runner retains all movement, aiming, survival and other picks.
  function craftingShopper(game: GameType, plan: string[]) {
    const shop = game.openShop.bind(game);
    game.openShop = (...args) => {
      shop(...args);
      if (game.mode === 'shop')
        for (const id of plan) {
          const part = PARTS.find((p) => p === id);
          if (part && equippedCraft(game.hero)?.recipe[socketOf(part)] !== part)
            game.ui('craft', PARTS.indexOf(part));
        }
    };
    const act = game.heroAction.bind(game);
    game.heroAction = (hero, action, index, direction) => {
      if (action === 'pick' && hero.chestsPending) {
        const i = hero.offers.findIndex(
          (o) => o.id === 'crafted' && !!o.pick && (!equippedCraft(hero) || plan.includes(o.pick)),
        );
        if (i >= 0) index = i;
      }
      act(hero, action, index, direction);
    };
  }
  if (process.env.CRAFT_BENCH === 'run' && process.env.CRAFT_KIT)
    craftingShopper(g, process.env.CRAFT_KIT.split(','));
  g.startRun({ seed, difficulty: 'normal' });
  if (g.mode === 'shop') g.closeShop();

  const bot = (window as any).botRun;
  if (process.env.CRAFT_BENCH === 'run') {
    console.log(
      seed,
      measureRun(g, (s) => bot(s, false)),
      equippedCraft(g.hero)?.buildKey,
    );
    process.exit(0);
  }
  if (process.env.CRAFT_BENCH === 'probe') {
    const kit = process.env.CRAFT_KIT;
    const w = createWeapon(kit ? 'crafted' : 'nova', g.scene);
    if (w instanceof Crafted) w.setBuildKey(kit!.split(',').join('/') + '/0');
    else {
      w.level = w.def.levels.length;
      w.evolve();
    }
    console.log(
      seed,
      measureWeapon(g, (s) => bot(s, true), w, ENEMIES.chonk),
    );
    process.exit(0);
  }

  const { applyBuild, exportBuild } = await import('../src/game/pvp');
  const { setLanguage, t } = await import('../src/i18n');
  const h = g.hero;
  assert.equal(fitPart(h, 'fire'), false);
  h.chestsPending = 1;
  const offered = h.buildOffers().find((o) => o.id === 'crafted')!;
  assert.ok(offered && FRAMES.includes(offered.pick as (typeof FRAMES)[number]));
  h.applyOffer(offered);
  assert.equal(equippedCraft(h)?.recipe.frame, offered.pick);
  h.chestsPending = 0;
  assert.equal(
    h.buildOffers().some((o) => o.id === 'crafted'),
    false,
  );
  const normalDrop = craftTuning.dropChance;
  craftTuning.dropChance = 1;
  assert.ok(CORES.includes(h.chestItem().id as (typeof CORES)[number]));
  assert.ok(MODIFIERS.includes(h.chestItem().id as (typeof MODIFIERS)[number]));
  craftTuning.dropChance = normalDrop;

  const w = equippedCraft(h)!;
  // At the thresholds, a gear pays for exactly one empty socket. Else it is the ordinary reroll.
  const { PickupType } = await import('../src/game/pickups');
  const { MAX_GEARS } = await import('../src/game/hero');
  w.configure({ frame: 'projector', core: null, mod: null });
  h.rerollsLeft = 0;
  g.level = craftTuning.coreLevel - 1;
  g.collect(h, PickupType.Gear, 1);
  assert.equal(h.rerollsLeft, 1);
  assert.equal(w.recipe.core, null);
  g.level++;
  g.collect(h, PickupType.Gear, 1);
  assert.equal(h.rerollsLeft, 1);
  assert.ok(w.recipe.core);
  h.rerollsLeft = MAX_GEARS;
  g.level = craftTuning.modLevel;
  g.collect(h, PickupType.Gear, 1);
  assert.ok(w.recipe.mod);
  assert.equal(h.rerollsLeft, MAX_GEARS);
  w.configure({ frame: 'projector', core: 'fire', mod: 'split' });
  const mirror = createWeapon('crafted', g.scene) as InstanceType<typeof Crafted>;
  for (const frame of FRAMES)
    for (const core of CORES)
      for (const mod of MODIFIERS) {
        w.configure({ frame, core, mod });
        assert.ok(w.tags.includes(core));
        assert.equal(
          craftInteractions(w.recipe, () => false),
          0,
          'a chassis cannot be its own tag partner',
        );
        mirror.setBuildKey(w.buildKey);
        assert.deepEqual(mirror.recipe, { frame, core, mod });
      }
  assert.equal(
    craftInteractions({ frame: 'lobber', core: 'explosive', mod: 'home' }, (t) => t === 'area'),
    2 | 16 | 64,
  );
  assert.equal(
    craftInteractions(
      { frame: 'field', core: 'shock', mod: 'linger' },
      (t) => t === 'orbit' || t === 'fire',
    ),
    8 | 128,
  );
  for (const part of PARTS) {
    fitPart(h, part);
    assert.equal(w.recipe[socketOf(part)], part);
  }
  assert.equal(h.weapons.filter((x) => !x.def.slot).length, 1);
  w.configure({ frame: 'beam', core: 'fire', mod: 'split' });
  h.player.teleport(0, 0);
  const enemy = g.enemies.spawn(ENEMIES.chonk, 6, 0, { instant: true });
  enemy.state = 'move';
  enemy.hp = enemy.maxHp = 1e5;
  enemy.exposeT = 10;
  g.hash.clear();
  g.hash.insert(enemy, enemy.x, enemy.z, enemy.radius);
  for (let i = 0; i < 100 && !w.net().length; i++) w.update(1 / 60, h.ctx);
  const visual = w.net();
  assert.ok(visual.length);
  mirror.setNet(visual);
  assert.deepEqual(mirror.net(), visual);
  mirror.update(0, h.ctx);
  assert.deepEqual(mirror.net(), [], 'promoting a client cannot simulate a visual-only shot');
  for (let i = 0; i < 30; i++) w.update(1 / 60, h.ctx);
  assert.ok(enemy.hp < 1e5 && enemy.burnT > 0);
  assert.equal(w.discoveries, 1 | 4 | 32, 'three distinct synergies actually triggered on a hit');
  // A duel hit requires the targeted pilot to remain inside the visible mark.
  // Hold aim and report a bystander inside the beam to exercise splash filtering.
  for (const dodge of [false, true]) {
    const duel = createWeapon('crafted', g.scene) as InstanceType<typeof Crafted>;
    duel.configure({ frame: 'beam', core: 'shock', mod: 'pierce' });
    const target = Object.assign(Object.create(enemy), { pvpOwner: 1, x: 6, z: 0 });
    const other = Object.assign(Object.create(enemy), {
      uid: enemy.uid + 1,
      pvpOwner: 2,
      x: 8,
      z: 0,
    });
    const victims: number[] = [];
    let marked = false;
    const ctx: typeof h.ctx = {
      ...h.ctx,
      nearest: () => (marked ? null : target),
      inRadius: (_x, _z, _r, out) => {
        out.length = 0;
        out.push(target, other);
        return out;
      },
      fx: {
        ...h.ctx.fx,
        ring: (_x, _z, _s, grow, _color, life) => {
          if (grow < 1 && life! >= 0.6) marked = true;
        },
      },
      damage: (e) => {
        victims.push(e.pvpOwner);
        return 1;
      },
    };
    for (let i = 0; i < 70 && !marked; i++) duel.update(1 / 60, ctx);
    assert.ok(marked);
    for (let i = 0; i < 25; i++) duel.update(1 / 60, ctx);
    assert.deepEqual(victims, []);
    if (dodge) target.x += 3;
    for (let i = 0; i < 20; i++) duel.update(1 / 60, ctx);
    assert.deepEqual(victims, dodge ? [] : [1]);
    duel.dispose();
  }
  const before = w.buildKey;
  const copied = g.makeHero(1, 'Guest', []);
  applyBuild(copied, exportBuild(h, 4), g.scene);
  assert.equal(
    equippedCraft(copied)?.buildKey,
    before,
    'migration and duel restore sockets and this run’s discoveries',
  );
  g.syncWeapons(copied, [[w.def.id, w.level, w.ready, w.buildKey, ...w.net()]]);
  assert.equal(equippedCraft(copied)?.buildKey, before);
  assert.deepEqual(equippedCraft(copied)?.net(), w.net());

  const { observeDiscoveries } = await import('../src/game/crafting');
  mirror.dispose();
  assert.deepEqual(normalizeJournal({ crossfeed: -1, ratchet: 1e18, thermal: 0, bogus: 42 }), {
    thermal: 0,
  });
  assert.deepEqual(readJournal(), {}, 'equipping another hero does not write their discoveries');
  observeDiscoveries(g);
  assert.deepEqual(readJournal(), { crossfeed: seed, thermal: seed, ratchet: seed });
  assert.deepEqual(recordDiscoveries(w.discoveries, 0), [], 'first finding keeps the original run');
  g.mode = 'shop';
  h.openShop(false, true);
  h.gold = 50;
  g.presentShop(h);
  document.querySelector<HTMLElement>('#scr-shop [data-act="workbench"]')!.click();
  assert.equal(g.screens.current, 'workbench');
  document.querySelector<HTMLElement>('#scr-workbench [data-tab="1"]')!.click();
  document.querySelector<HTMLElement>('#scr-workbench [data-part="6"]')!.click();
  assert.equal(h.gold, 38);
  assert.equal(w.recipe.core, 'frost');
  g.ui('craft', 6);
  assert.equal(h.gold, 38, 'duplicate action cannot double-charge');
  h.gold = 0;
  g.ui('craft', 14);
  g.ui('craft', -1);
  assert.equal(w.recipe.mod, 'split');
  h.shopDone = true;
  h.gold = 99;
  g.ui('craft', 14);
  assert.equal(h.gold, 99, 'shop closes individually in co-op');
  await setLanguage('ar');
  g.screens.discoveryUi.openBook(true);
  const book = document.getElementById('scr-discoveries')!;
  assert.ok(
    book.textContent?.replace(/[\u2066-\u2069]/g, '').includes(t('craft.spent', { seed })),
    book.textContent ?? '',
  );
  assert.ok(!book.textContent?.includes(t('craft.induction.tip')), 'unfound recipes stay hidden');
  g.screens.show('none');
  copied.startRun();
  for (const id of ['drones', 'aura', 'nova', 'lightning'])
    copied.weapons.push(createWeapon(id, g.scene));
  assert.equal(fitPart(copied, 'beam'), false, 'fitting a frame respects the four auto slots');
  h.startRun();
  assert.equal(equippedCraft(h), undefined);
  assert.equal(medianDistinct([]), null);
  console.log(
    '125 recipes, treasure, purchases, combat, HUD, snapshot, migration, discovery ownership and Arabic journal passed',
  );
  process.exit(0);
}
// run-tests.mjs imports its entry with node -e. Other benchmark modules can
// import the measurement helpers without creating a Game or touching the DOM.
if (!process.argv[1] || import.meta.url === pathToFileURL(process.argv[1]).href) await main();
