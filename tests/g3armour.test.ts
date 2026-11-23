import './jsdomEnv';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Input } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { ENEMIES } from '../src/data/enemies';
import { armourOf, armourTuning } from '../src/data/armour';
import { armourFactor, hitsCore } from '../src/game/armour';
import { Enemy } from '../src/game/enemies';
import { netcodeState } from '../src/game/systems/netcode';
import { packEnemies, unpackEnemies } from '../src/net/codec';
import { setLanguage } from '../src/i18n';
import { installBot } from '../src/dev/bot';
import { cheats, Game, LOOP_STAGES } from '../src/game/game';
import { save } from '../src/game/save';
import { settings } from '../src/game/settings';

type BotRunner = (seconds: number) => unknown;
type Aim = 'average' | 'perfect';

// A fresh game/runner per paired observation. Only the perfect arm changes aiming:
// compensate for the arm cannon's lateral muzzle offset and sight the lit shoulder.
export async function measureArmourAim(g: Game, run: BotRunner, seed: number, aim: Aim) {
  settings.loadout = { primary: 'laser', secondary: 'charge', special: 'bomb' };
  cheats.unlockAll = true;
  g.startRun({ seed, difficulty: 'normal' });
  g.closeShop();
  g.xpNext = 1e9;
  g.director.update = () => [];
  g.enemies.clear();
  for (const w of g.hero.weapons.splice(1)) w.dispose();
  assert.equal(g.hero.weapons[0].def.id, 'laser');
  g.spawnBoss(ENEMIES.king);
  const boss = g.boss!;
  boss.x = boss.px = g.player.x;
  boss.z = boss.pz = g.player.z + 7;
  boss.state = 'move';
  boss.roarT = 0;
  // Keep phase gates and overkill out of this fixed-duration damage sample.
  boss.hp = boss.maxHp *= 10;
  const setAim = g.player.setAimPoint.bind(g.player);
  if (aim === 'perfect') g.player.setAimDir = g.player.setAimPoint = () => {
    const x = boss.x + Math.cos(boss.facing) * boss.radius * armourTuning.coreOffset;
    const z = boss.z - Math.sin(boss.facing) * boss.radius * armourTuning.coreOffset;
    const dx = x - g.player.x, dz = z - g.player.z;
    const d = Math.hypot(dx, dz);
    setAim(x - 0.38 * dz / d, z + 0.38 * dx / d);
  };
  let damage = 0, hits = 0;
  const hit = g.damage.bind(g);
  g.damage = (e, n, o, by) => {
    const result = hit(e, n, o, by);
    if (e === boss && o.source === 'laser' && result > 0) { damage += result; hits++; }
    return result;
  };
  await run(12);
  return { seed, aim, damage, hits };
}

export async function measureNormalLoop(g: Game, run: BotRunner, seed: number) {
  settings.loadout = { primary: 'buster', secondary: 'charge', special: 'bomb' };
  g.startRun({ seed, difficulty: 'normal' });
  g.closeShop();
  for (let i = 0; i < 100 && g.victories === 0 && g.stage <= LOOP_STAGES && g.mode !== 'dead'; i++) await run(15);
  return { seed, stage: g.stage, mode: g.mode, kills: g.kills, seconds: Math.round(g.runTime), clear: g.victories > 0 || g.stage > LOOP_STAGES };
}

// G3_ARMOUR_BENCH=1 npm test -- g3armour
if (process.env.G3_ARMOUR_BENCH) {
  const sample = process.env.G3_SAMPLE;
  if (!sample) {
    // Fresh process for each arm: same empty profile, pooled UIDs and RNG stream.
    for (const seed of [42, 77, 123]) for (const kind of ['loop', 'average', 'perfect']) {
      execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
        stdio: 'inherit', env: { ...process.env, G3_SAMPLE: kind, G3_SEED: String(seed) },
      });
    }
    process.exit(0);
  }
  const seed = Number(process.env.G3_SEED);
  const rolls = new Rng(seed);
  Math.random = () => rolls.next();
  Date.now = () => 1792454400000;
  const input = new Input(document.querySelector('canvas')!);
  const g = new Game(input, 16 / 9, document.querySelector('#hud')!, document.querySelector('#reticle')!);
  Object.assign(settings, { bossIntros: false, cinematics: 'off', finishers: false, pet: 'none', hero: 'rookie', tips: false, difficulty: 'normal', mode: 'standard', mouseAimAssist: false });
  installBot(g, input);
  const run = (s: number) => (window as unknown as { botRun(s: number, god: boolean): unknown }).botRun(s, false);
  console.log(JSON.stringify(await (sample === 'loop' ? measureNormalLoop(g, run, seed) : measureArmourAim(g, run, seed, sample as Aim))));
  process.exit(0);
}

async function checkArmour(): Promise<void> {
  const charger = new Enemy(ENEMIES.charger);
  charger.reset(2, -3, { instant: true });
  charger.facing = 0;
  const front = { source: 'buster', dirX: 0, dirZ: -1 };
  assert.equal(armourFactor(charger, ['projectile'], front), 0.6);
  assert.equal(armourFactor(charger, ['projectile'], { ...front, dirZ: 1 }), 1.5);
  assert.equal(armourFactor(charger, ['projectile'], { ...front, dirX: 1, dirZ: 0 }), 0.85);
  assert.equal(armourFactor(charger, ['projectile', 'explosive'], front), 1.4);
  assert.equal(armourFactor(charger, ['shock'], front), 1.4);
  assert.equal(armourOf(ENEMIES.v_charger, false), 'plated');
  assert.equal(armourOf(ENEMIES.bopper, true), 'plated');
  assert.equal(armourOf(ENEMIES.bopper, false), undefined);
  assert.equal(armourFactor(new Enemy(ENEMIES.ghost), ['projectile'], front), 0.65);
  for (const tag of ['shock', 'frost', 'fire'] as const) assert.equal(armourFactor(new Enemy(ENEMIES.ghost), [tag], front), 1.4);
  for (const tag of ['chain', 'area'] as const) assert.equal(armourFactor(new Enemy(ENEMIES.swarmer), [tag], front), 1.4);
  for (const def of Object.values(ENEMIES).filter(d => d.boss)) assert.equal(def.weakPoint, def.hidden ? 'encounter' : 'core', def.id);

  const core = new Enemy(ENEMIES.king);
  core.reset(-3, 8, { instant: true });
  core.facing = Math.PI / 2;
  const line = { source: 'laser', dirX: 3, dirZ: 0, hx: core.x - core.radius, hz: core.z - armourTuning.coreOffset * core.radius };
  assert.equal(armourFactor(core, ['projectile'], line), 2);
  assert.equal(hitsCore(core, { ...line, hz: core.z }), false);
  assert.equal(hitsCore(core, { ...line, dirX: 0 }), false);
  assert.equal(hitsCore(core, { source: 'burn' }), false);

  const input = new Input(document.querySelector('canvas')!);
  const g = new Game(input, 16 / 9, document.querySelector('#hud')!, document.querySelector('#reticle')!);
  g.startRun({ seed: 42, difficulty: 'normal' });
  g.closeShop();
  const target = g.enemies.spawn(ENEMIES.shielder, 6, 6, { instant: true });
  target.hp = target.maxHp = 5000;
  target.facing = 0;
  g.hero.stats.damageMul = 1;
  g.vfx.recording = true;
  const hit = (source: string, fixed = false) => g.damage(target, 100, { ...front, source, loud: true, noStatus: true, fixed }, g.hero);
  assert.equal(hit('buster'), 15);
  assert(g.vfx.drain().some(e => e[0] === 'n' && e[4] === '15 SHIELD' && e[6] === g.hero.index));
  assert.equal(hit('charge', true), 100);
  assert.equal(target.familyState, 0);
  g.role = 'client';
  assert.equal(hit('charge'), 0);
  assert.equal(target.familyState, 0);
  g.role = 'host';
  assert.equal(hit('charge'), 100);
  assert.equal(target.familyState, 1);
  assert(g.vfx.drain().some(e => e[0] === 'n' && e[4] === 'SHIELD BROKEN!'));
  unpackEnemies(packEnemies([target]), r => assert.equal(r.familyState, 1));
  assert.equal(hit('buster'), 100);
  target.tickT = 0.001;
  g.enemies.update(1 / 60, g.enemyCtx);
  assert.equal(target.familyState, 0);
  target.facing = 0;
  assert.equal(hit('buster'), 15);
  // A guest Buster round met the socket at its accepted historical position.
  const mate = g.makeHero(1, 'Guest', [], 'peer-b');
  g.setHeroes([g.hero, mate]);
  g.onHostMessage('peer-b', { t: 'i', x: 0, z: 0, ax: 0, az: 1, vx: 0, vz: 0, f: true });
  mate.stats.damageMul = 1;
  const moving = g.enemies.spawn(ENEMIES.shooter, 0, 4, { instant: true });
  moving.hp = moving.maxHp = 1000;
  moving.facing = 0;
  const net = netcodeState(g);
  net.history.record(50, [moving]);
  moving.x = 2;
  net.history.record(51, [moving]);
  net.lag[mate.index] = 1;
  const oldLine = { source: 'buster', dirX: 0, dirZ: 1, hx: moving.radius * armourTuning.coreOffset, hz: 3, noStatus: true };
  assert.equal(g.damage(moving, 100, oldLine, mate), 200);
  assert.equal(g.damage(moving, 100, { ...oldLine, source: 'laser' }, mate), 100);
  target.def = ENEMIES.swarmer;
  g.damage(target, 100, { source: 'zap', tags: ['chain'], noStatus: true, loud: true }, g.hero);
  assert(g.vfx.drain().some(e => e[0] === 'n' && e[4] === '140 SHOCK'));
  target.reset(0, 0, { instant: true });
  assert.equal(target.armourCueAt, -Infinity);
  assert.equal(target.familyState, 0);

  for (const lang of ['en', 'ar'] as const) {
    await setLanguage(lang);
    save.discovered = ['w:lightning'];
    g.screens.show('arsenal');
    const gear = document.querySelector('#scr-arsenal .ob-cx:not(.unseen)');
    assert(gear?.textContent?.includes(lang === 'en' ? 'Strong against' : 'فعّال ضد'));
    assert(!document.querySelector('#scr-arsenal .unseen .armour-hint'));
    g.screens.show('codex');
    assert(document.querySelector('#scr-codex .meta-grid')?.textContent?.includes(lang === 'en' ? 'copper vents' : 'النحاسية'));
    g.screens.showLevelUp([{ id: 'lightning', slot: 'auto', kind: 'weapon', name: 'Lightning', text: '', icon: 'ϟ', tag: '', color: '#fff' }], '', 0, []);
    assert(document.querySelector('#scr-levelup .card')?.textContent?.replace(/[\u2066-\u2069]/g, '').includes(lang === 'en' ? 'Strong against Plated · Ethereal · Swarm' : 'فعّال ضد مصفّح · طيفي · أسراب'));
  }
  console.log('Armour arcs, counters, cores, fixed hits, shield recharge and snapshots, feedback and EN/AR cards passed.');
}

if (!process.argv[1] || process.argv[1] === fileURLToPath(import.meta.url)) {
  await checkArmour();
  process.exit(0);
}
