import './jsdomEnv';
import assert from 'node:assert/strict';
import { Input } from '../src/core/input';
import { Game } from '../src/game/game';
import { ENEMIES } from '../src/data/enemies';
import { MOD_BY_ID } from '../src/data/mods';
import { applyBuildCurves, addAuraBonus, KillHealWindow, softBonus } from '../src/data/passives';
import { baseStats, type Stats } from '../src/game/stats';
import { offerNumbers } from '../src/game/cardNumbers';
import { buildParams, hasOverdriveDamage, newBuild, overdriveBonus, overdriveStep, parseBuild } from '../src/data/tracks';
import { createWeapon } from '../src/game/weapons';
import { WEAPONS } from '../src/data/weapons';
import { setLanguage, localize } from '../src/i18n';
import { modDesc } from '../src/game/modTypes';
import type { Offer } from '../src/ui/screens';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const base = baseStats();
const stacked: [keyof Stats, number][] = [
  ['damageMul', 0.1], ['chargeDmg', 0.2], ['cooldownMul', -0.08], ['chargeSpeed', 0.15],
  ['critChance', 0.08], ['critMult', 0.3], ['areaMul', 0.1], ['specialCooldownMul', -0.12],
  ['dashCooldownMul', -0.1], ['killHeal', 0.05], ['armor', 1], ['moveSpeedMul', 0.08],
];
for (const [key, step] of stacked) {
  const result = (rank: number) => {
    const s = baseStats();
    s[key] += step * rank;
    applyBuildCurves(s, 1, 1);
    return (s[key] - base[key]) / step;
  };
  near(result(-1), -1);
  near(result(3), 3);
  const fourth = result(4) - result(3);
  const fifth = result(5) - result(4);
  assert.ok(fourth < 1 && fifth < fourth && fifth > 0, key);
}
near(addAuraBonus(softBonus(0.5, 0.3, 0.85), 0.2, 0.3, 0.85), softBonus(0.7, 0.3, 0.85));

const window = new KillHealWindow();
const heals: { time: number; gain: number }[] = [];
for (let i = 0; i < 700; i++) {
  const time = i / 200;
  const gain = window.grant(time, i % 211 === 0 ? 2 : 0.015, 100);
  heals.push({ time, gain });
  assert.ok(heals.reduce((n, h) => n + (time - h.time < 1 ? h.gain : 0), 0) <= 3 + 1e-8);
}
near(window.grant(0, 8, 40), 1.2);
near(window.grant(0.99999, 8, 40), 0);
near(window.grant(1, 8, 500), 3);

const weapon = WEAPONS.buster;
const expected = [8, 7, 6, 5, 4, 3, 2, 2, 0];
for (const [i, pct] of expected.entries()) near(overdriveStep(i + 1) * 100, pct);
near(overdriveBonus(500), 0.37);
const old = parseBuild('0:4,4,4:35', weapon);
assert.equal(old.od, 8);
near(buildParams({ dmg: 100 }, {}, { ...newBuild({}), od: 99 }).dmg, 137);
near(buildParams({ implode: 100 }, {}, old).implode, 137);
assert.equal(hasOverdriveDamage(WEAPONS.revdrone.levels[0].p), false);

const game = new Game(new Input(document.querySelector('canvas')!), 16 / 9, document.querySelector('#hud')!, document.querySelector('#reticle')!);
game.startRun({ seed: 42, difficulty: 'normal' });
if (game.mode === 'shop') game.closeShop();
const h = game.hero;
const pick = (kind: Offer['kind'], id: string, key?: string): Offer => ({ kind, id, pick: key, color: '', icon: '', name: '', tag: '', text: '' });
h.passives = { power_cell: 4, vampire: 3 };
h.relics = ['r_fang', 'r_mercy'];
h.recomputeStats();
const card = pick('passive', 'power_cell');
const line = offerNumbers(h, card)[0];
assert.deepEqual([line.a, line.b], ['+38%', '+45%']);
h.applyOffer(card);
near(h.stats.damageMul, 1 + softBonus(0.5, 0.3, 0.85));
for (const ref of ['sp', h.weapons[0].def.id]) {
  const build = ref === 'sp' ? h.specialBuild! : h.weapons[0].build!;
  build.od = 7;
  h.applyOffer(pick('overdrive', ref, ref + '|od'));
  h.applyOffer(pick('overdrive', ref, ref + '|od'));
  assert.equal(build.od, 8);
}
h.weapons[0].overdrive();
assert.equal(h.weapons[0].build!.od, 8);
assert.equal(JSON.parse(JSON.stringify(h.weapons[0].build)).od, 8);
h.player.hp = 10;
for (let i = 0; i < 100; i++) {
  const e = game.enemies.spawn(ENEMIES.bopper, 4, 4, { instant: true });
  game.killEnemy(e, 'buster', h);
}
near(h.player.hp, 13);
near(h.player.heal(10), 10);

// A real beam tick on a live target cannot draw from a second pool after a kill burst.
const beam = createWeapon('medbeam', game.scene);
const target = game.enemies.spawn(ENEMIES.bopper, h.player.x + 4, h.player.z, { instant: true });
target.state = 'move';
target.hp = target.maxHp = 10000;
game.hash.insert(target, target.x, target.z, target.radius);
h.player.setAimDir(1, 0);
h.ctx.firing = true;
h.ctx.soundSource = beam;
beam.update(1 / 60, h.ctx);
assert.ok(target.hp < 10000, 'beam damaged the target');
near(h.player.hp, 23);
game.runTime += 1;
beam.update(0.2, h.ctx);
assert.ok(h.player.hp > 23 && h.player.hp <= 26);
h.ctx.soundSource = null;
beam.dispose();

const mate = game.makeHero(1, 'Mate', []);
mate.passives = { rally_banner: 5 };
mate.recomputeStats();
mate.player.teleport(h.player.x, h.player.z);
game.setHeroes([h, mate]);
h.stats.damageMul *= 2;
game.applyTeamAuras(h, 0);
near(h.stats.damageMul, h.equipmentStats.damageMul + 1 + softBonus(1, 0.3, 0.85));
game.setHeroes([h]);
h.refreshLive();

const enemy = game.enemies.spawn(ENEMIES.bopper, 4, 4, { instant: true });
const ev = { e: enemy, crit: false, dist: 10, source: 'buster', tags: [] };
for (const id of ['glass_cannon', 'momentum', 'echo', 'collector', 'midas']) h.synergy.add(MOD_BY_ID[id]);
h.gold = 50;
for (let i = 0; i < 20; i++) { game.level++; h.synergy.levelUp(); }
assert.equal(h.synergy.slots[1].st.n, 8);
h.synergy.upgrade(1);
h.synergy.upgrade(3);
const product = 2 * 1.8 * 3 * 3 * 3;
near(h.synergy.damage(ev, 200), 100 * softBonus(product, 5, 8));
assert.equal(game.buildSnapshot(h, []).modHit, Math.round(100 * softBonus(product, 5, 8)));
h.synergy.slots[1].st.n = 100;
near(h.synergy.damage(ev, 200), 100 * softBonus(product, 5, 8));

// The status pipeline supplies the reaction's base damage and applies native
// shock afterwards. Equipment behind either status still shares the hit ceiling.
h.synergy.reset();
for (const id of ['glass_cannon', 'static_cling', 'overloader', 'shatterpoint']) {
  h.synergy.add(MOD_BY_ID[id]);
}
enemy.shockT = 1;
for (const source of ['shatter', 'overload']) {
  const amount = h.synergy.damage({ ...ev, source, tags: ['explosive'] }, 100 * 2 * 3);
  near(amount * 1.5, 100 * 1.2 * softBonus(2 * 3 * 1.25, 5, 8));
}
h.recomputeStats();
await setLanguage('ar');
assert.ok(!/[a-z]/i.test(localize(modDesc(MOD_BY_ID.momentum, 2)).replaceAll('x', '')));
assert.ok(!/[a-z]/i.test(localize('+7% base damage · rank 2/8')));
game.pause();
assert.ok(document.querySelector('#scr-pause .pause-info')?.textContent?.includes('إحصاءات العتاد الفعلية'));
await setLanguage('en');
console.log('Gate 2 build curves, ordered hit ceiling, Overdrive, rolling kill healing, cards and Arabic pause totals passed.');
