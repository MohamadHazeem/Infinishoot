/**
 * Auto-weapon evolutions (partner item): data, Weapon.evolve(), level-up
 * offers, and that chests never evolve. Loadout weapons evolve through their
 * upgrade trees instead (src/data/tracks.ts).
 */
import { ok } from './check';
import * as THREE from 'three';
import { WEAPONS } from '../src/data/weapons';
import { PASSIVES } from '../src/data/passives';
import { createWeapon } from '../src/game/weapons';
import { Hero } from '../src/game/hero';
import { Rng } from '../src/core/rng';

const scene = new THREE.Scene();
const evolving = Object.values(WEAPONS).filter((d) => d.evolution);
ok(evolving.length >= 11, `${evolving.length} auto weapons have a partner evolution`);
for (const d of evolving) {
  const evo = d.evolution!;
  ok(!d.slot && !d.tracks, `${d.id} is an auto weapon without upgrade tracks`);
  ok(!!PASSIVES[evo.passive], `${d.id} partner item ${evo.passive} exists`);
  const last = d.levels[d.levels.length - 1].p;
  ok(Object.keys(last).sort().join() === Object.keys(evo.p).sort().join(), `${d.id} evolution params match its level params`);
  const w = createWeapon(d.id, scene);
  w.evolve();
  ok(!w.evolved && w.level === 1, `${d.id} cannot evolve before max`);
  while (!w.maxed) w.levelUp();
  w.evolve();
  ok(w.evolved && w.level === d.levels.length + 1 && w.p === evo.p && w.name === evo.name && w.color === evo.color, `${d.id} evolves to ${w.name}`);
  w.levelUp();
  ok(w.level === d.levels.length + 1, `${d.id} levelUp after evolving is a no-op`);
}
const partners = new Set(evolving.map((d) => d.evolution!.passive));
ok(partners.size === evolving.length, 'each auto weapon has its own partner item');

// Hero offers with a minimal fake world (and a no-op canvas for textures).
const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 256 * 256) : k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
const world: any = { scene, level: 10, rng: new Rng(1), coop: false, makeCtx: () => ({}), fireRateBuff: 1, damageBuff: 1, dashCurse: 1, activeCurses: [] };
const h = new Hero(world, 0, 'P1', '#fff', Object.keys(WEAPONS));
h.startRun();
h.weapons.push(createWeapon('drones', scene));
const dr = h.weapons[h.weapons.length - 1];
while (!dr.maxed) dr.levelUp();
const has = () => h.buildOffers().some((o) => o.kind === 'evolve');
ok(!has(), 'no evolve offer without the partner item');
h.passives.armor = 1;
const offers = h.buildOffers();
const evo = offers.find((o) => o.kind === 'evolve');
ok(!!evo && evo.id === 'drones' && evo.rarity === 'legendary' && offers.length <= 3, 'evolve offer appears: ' + offers.map((o) => o.name).join(', '));
h.applyOffer(evo!);
ok(dr.evolved && dr.name === 'Aegis Swarm', 'picking it evolves the weapon');
ok(h.loadout().some((i) => i.evo && i.name === 'Aegis Swarm'), 'loadout marks it evolved');
ok(!has(), 'no repeat evolve offer');
// Chests never evolve (Mansour's rule: evolutions are a level-up choice).
h.weapons.push(createWeapon('aura', scene));
const au = h.weapons[h.weapons.length - 1];
while (!au.maxed) au.levelUp();
h.passives.big_bang = 1;
for (let i = 0; i < 30; i++) h.chestItem();
ok(!au.evolved, 'chests never evolve a weapon');
