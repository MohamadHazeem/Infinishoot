import './jsdomEnv';
import assert from 'node:assert/strict';
import { craftTuning } from '../src/data/craftParts';
import { FUSION_BY_ID, childParams } from '../src/data/fusions';
import { MOD_BY_ID } from '../src/data/mods';
import { rarityWeight } from '../src/data/rarity';
import { WEAPONS } from '../src/data/weapons';

assert.deepEqual([craftTuning.dropChance, craftTuning.coreLevel, craftTuning.modLevel], [0.2, 6, 12]);

const lightning = WEAPONS.lightning;
assert.equal(rarityWeight(lightning.rarity, 0), 0.6);

// Count the first target as well as each subsequent hop, before stats or armour.
const storm = FUSION_BY_ID.storm_drones;
const arc = childParams(lightning, storm.children.find(part => part.weapon === 'lightning')!);
const fullVolley = arc.bolts * (1 + arc.chains) * arc.dmg / arc.cd;
assert.ok(Math.abs(fullVolley - 6228.75) < 0.01);
assert.deepEqual(storm.rider.zap, { on: 'drones', chance: 0.3, hops: 3, dmg: 30, gap: 0.2 });

// The opening 15 gold buys any two of these three complementary Mods.
const prices = ['quick_draw', 'pyromaniac', 'hair_trigger'].map(id => MOD_BY_ID[id].price);
assert.deepEqual(prices, [4, 5, 7]);
const { Game } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { economyTuning } = await import('../src/game/hero');
const { shapeHand } = await import('../src/game/ruleCards');
const purse = economyTuning.startGold;
assert.ok(prices[1] + prices[2] <= purse && prices[0] + prices[1] + prices[2] > purse);

const game = new Game(new Input(document.querySelector('canvas')!), 16 / 9,
  document.getElementById('hud')!, document.getElementById('reticle')!);
game.startRun({ seed: 42, difficulty: 'normal' });
game.closeShop();
game.stage = 3;
const hero = game.hero;
hero.chestsPending = 1;
hero.play.ruleId = 'tithe'; // Measure the ordinary two-card hand without a second rule draw.
hero.offers = hero.buildOffers();
shapeHand(game, hero);
assert.equal(hero.offers.length, 2);
assert.equal(hero.offers[0].id, 'crafted', 'a treasure frame survives the stage-three trim');

// Sweep the first draw across evenly spaced points in the real draft. The Charge
// tracks provide a fixed reference even when adding equipment changes the pool.
hero.chestsPending = 0;
hero.unlocked = ['drones'];
function firstDrawWeights() {
  const counts = { buster: 0, charge: 0, drones: 0 };
  const original = hero.rng.next;
  const steps = 2048;
  try {
    for (let i = 0; i < steps; i++) {
      hero.rng.next = () => (i + 0.5) / steps;
      const first = hero.buildOffers()[0];
      if (first.pick?.startsWith('buster|t|')) counts.buster++;
      if (first.pick?.startsWith('charge|t|')) counts.charge++;
      if (first.id === 'drones') counts.drones++;
    }
  } finally {
    hero.rng.next = original;
  }
  return counts;
}
const empty = firstDrawWeights();
assert.ok(Math.abs(empty.buster / empty.charge - 1 / 3) < 0.01);
assert.ok(Math.abs(empty.drones / empty.charge - 2.4 / 12) < 0.01);
for (const id of ['lightning', 'prism', 'discs']) game.debugGiveWeapon(id);
assert.equal(hero.weapons.filter(w => !w.def.slot).length, 3);
const lastSlot = firstDrawWeights();
assert.ok(Math.abs(lastSlot.drones / lastSlot.charge - 0.6 / 12) < 0.01);
