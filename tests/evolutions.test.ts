/** Weapon evolutions: data, Weapon.evolve(), level-up offers and chests. */
import { ok } from './check';
import * as THREE from 'three';
import { WEAPONS } from '../src/data/weapons';
import { PASSIVES } from '../src/data/passives';
import { createWeapon } from '../src/game/weapons';
import { Hero } from '../src/game/hero';
import { Rng } from '../src/core/rng';

const scene = new THREE.Scene();
for (const d of Object.values(WEAPONS)) {
  ok(!!d.evo && !!PASSIVES[d.evo.passive], `${d.id} has evo with valid passive ${d.evo?.passive}`);
  const last = d.levels[d.levels.length - 1].p;
  ok(Object.keys(last).sort().join() === Object.keys(d.evo!.p).sort().join(), `${d.id} evo params match level params`);
  const w = createWeapon(d.id, scene);
  w.evolve(); ok(!w.evolved && w.level === 1, `${d.id} cannot evolve before max`);
  while (!w.maxed) w.levelUp();
  w.evolve(); ok(w.evolved && w.level === d.levels.length + 1 && w.p === d.evo!.p && w.name === d.evo!.name, `${d.id} evolves to ${w.name}`);
  w.levelUp(); ok(w.level === d.levels.length + 1, `${d.id} levelUp after evolve is a no-op`);
}
const passives = new Set(Object.values(WEAPONS).map((d) => d.evo!.passive));
ok(passives.size === Object.keys(WEAPONS).length, 'each weapon has a distinct partner passive');

// Hero offers / chests with a minimal fake world (and a no-op canvas).
const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 256 * 256) : k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
const world: any = { scene, level: 10, rng: new Rng(1), makeCtx: () => ({}) };
const h = new Hero(world, 0, 'P1', '#fff', Object.keys(WEAPONS));
h.startRun();
const buster = h.weapons[0];
while (!buster.maxed) buster.levelUp();
ok(!h.buildOffers().some((o) => o.kind === 'evolve'), 'no evolve offer without partner passive');
h.passives.power_cell = 1;
const offers = h.buildOffers();
ok(offers[0].kind === 'evolve' && offers[0].id === 'buster' && offers.length === 3, 'evolve offer first: ' + offers.map((o) => o.name).join(', '));
h.applyOffer(offers[0]);
ok(buster.evolved, 'applyOffer evolves');
ok(h.loadout()[0].evo === true && h.loadout()[0].name === 'Giga Buster', 'loadout marks evolved');
ok(!h.buildOffers().some((o) => o.kind === 'evolve'), 'no repeat evolve offer');
// chest path
h.weapons.push(createWeapon('drones', scene));
const dr = h.weapons[1]; while (!dr.maxed) dr.levelUp();
h.passives.armor = 1;
const item = h.chestItem();
ok(item.evolved === true && dr.evolved && item.name === 'Aegis Swarm', 'chest evolves ready weapon');
// hint text
h.weapons.push(createWeapon('aura', scene));
const au = h.weapons[2]; while (au.level < au.def.levels.length - 1) au.levelUp();
const all = [...Array(40)].flatMap(() => h.buildOffers());
const auraCard = all.find((o) => o.id === 'aura');
ok(!!auraCard && auraCard.text.includes('Evolves with Big Bang'), 'max-level card hints partner: ' + auraCard?.text);
const bbCard = all.find((o) => o.id === 'big_bang');
ok(!!bbCard && bbCard.text.includes('Evolves Zap Field'), 'passive card hints weapon: ' + bbCard?.text);
