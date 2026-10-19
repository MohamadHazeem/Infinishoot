/**
 * Weapon fusion (src/data/fusions.ts, src/game/fusion.ts, src/game/weapons/fusion.ts):
 * data coverage, ready checks, card placement, the fuse itself and net state.
 */
import { ok } from './check';
import * as THREE from 'three';
import { FUSIONS, FUSION_BY_ID, childParams, fusionFor, readyFusions } from '../src/data/fusions';
import { WEAPONS } from '../src/data/weapons';
import { ICON_ART } from '../src/data/iconArt';
import { fusionCard, fuseWeapons, placeFusion } from '../src/game/fusion';
import { createWeapon } from '../src/game/weapons';
import { FusionWeapon } from '../src/game/weapons/fusion';
import { Hero } from '../src/game/hero';
import { Rng } from '../src/core/rng';
import type { Offer } from '../src/ui/screens';

const scene = new THREE.Scene();
const autos = Object.values(WEAPONS).filter((d) => !d.slot && !d.fusion);

// Data.
ok(FUSIONS.length >= 10, `${FUSIONS.length} fusions`);
ok(new Set(FUSIONS.map((f) => f.id)).size === FUSIONS.length, 'fusion ids are unique');
const covered = new Set(FUSIONS.flatMap((f) => f.parts));
ok(autos.every((d) => covered.has(d.id)), 'every auto weapon is part of a fusion: ' + autos.filter((d) => !covered.has(d.id)).map((d) => d.id).join(','));
const pairs = new Set(FUSIONS.map((f) => [...f.parts].sort().join('+')));
ok(pairs.size === FUSIONS.length, 'no two fusions share a pair');
for (const f of FUSIONS) {
  const d = WEAPONS[f.id];
  ok(!!d && d.fusion?.join() === f.parts.join() && d.rarity === 'legendary' && !d.starter && !d.slot, `${f.id} has a weapon def`);
  ok(f.parts.every((p) => WEAPONS[p] && !WEAPONS[p].slot && !WEAPONS[p].fusion), `${f.id} fuses two auto weapons`);
  ok(f.children.every((c) => f.parts.includes(c.weapon)), `${f.id} children are its parts`);
  ok(!!ICON_ART[f.id], `${f.id} has an icon`);
  ok(!!d.feel && d.feel.knock > 0, `${f.id} has feel`);
  ok(fusionFor(f.parts[1], f.parts[0]) === f, `${f.id} found either way round`);
  // Stronger than the parts: each child runs at least its part's evolved numbers.
  for (const c of f.children) {
    const part = WEAPONS[c.weapon];
    const evo = part.evolution!.p;
    const p = childParams(part, c);
    ok(Object.keys(evo).every((k) => k in p), `${f.id}/${c.weapon} keeps the evolved param set`);
    const key = 'dmg' in p ? 'dmg' : 'dps';
    ok(p[key] >= evo[key] * 1.09, `${f.id}/${c.weapon} hits harder than the evolved part (${evo[key]} -> ${p[key].toFixed(1)})`);
  }
  // Rider hooks name a part that is actually running.
  for (const r of Object.values(f.rider)) if (typeof r === 'object' && r) ok(f.children.some((c) => c.weapon === (r as { on: string }).on), `${f.id} rider hooks a running part`);
  if (f.rider.napalm) ok(f.children.some((c) => c.weapon === 'fire'), `${f.id} napalm has a fire child`);
}

// Ready checks.
ok(readyFusions([{ id: 'drones', maxed: true }, { id: 'lightning', maxed: true }])[0]?.id === 'storm_drones', 'two maxed parts are ready');
ok(readyFusions([{ id: 'drones', maxed: true }, { id: 'lightning', maxed: false }]).length === 0, 'not before both are maxed');
ok(readyFusions([{ id: 'storm_drones', maxed: true }, { id: 'lightning', maxed: true }]).length === 0, 'fusions never fuse again');

// Card placement: never pushes out an evolution choice.
const c = (kind: Offer['kind'], name: string): Offer => ({ kind, id: name, name, icon: '', color: '', tag: '', text: '' });
const card = fusionCard(FUSION_BY_ID.storm_drones);
ok(card.kind === 'fusion' && card.rarity === 'legendary' && card.fuses?.join() === 'drones,lightning' && card.slot === 'auto', 'fusion card');
let hand = placeFusion([c('weapon', 'a'), c('passive', 'b'), c('weapon', 'c')], card);
ok(hand.length === 3 && hand[0].kind === 'fusion' && hand.map((o) => o.id).join() === 'storm_drones,a,b', 'fusion leads and replaces the last card');
hand = placeFusion([c('evo', 'x'), c('evo', 'y'), c('weapon', 'c')], card);
ok(hand.map((o) => o.id).join() === 'x,y,storm_drones', 'evolution fork stays first');
hand = placeFusion([c('evo', 'x'), c('evo', 'y'), c('evolve', 'z')], card);
ok(!hand.some((o) => o.kind === 'fusion'), 'a full hand of evolutions is left alone');
ok(placeFusion([c('weapon', 'a')], card).length === 2, 'short hands just gain the card');
ok(placeFusion(hand, null) === hand, 'no card, no change');

// The fuse on a hero (minimal fake world, no-op canvas for textures).
const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 256 * 256) : k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
const world: any = { scene, level: 30, rng: new Rng(3), coop: false, makeCtx: () => ({}), fireRateBuff: 1, damageBuff: 1, dashCurse: 1, activeCurses: [] };
const h = new Hero(world, 0, 'P1', '#fff', Object.keys(WEAPONS));
h.startRun();
ok(!Array.from({ length: 30 }, () => h.buildOffers()).flat().some((o) => WEAPONS[o.id]?.fusion), 'fusion weapons are never offered as NEW');
const give = (id: string, evolve: boolean) => {
  const w = createWeapon(id, scene);
  while (!w.maxed) w.levelUp();
  if (evolve) w.evolve();
  h.weapons.push(w);
  return w;
};
const missiles = give('missiles', false);
give('discs', false);
ok(!h.buildOffers().some((o) => o.kind === 'fusion'), 'no card without a pair');
const fire = give('fire', true);
const offers = h.buildOffers();
const fo = offers.find((o) => o.kind === 'fusion');
ok(!!fo && fo.id === 'napalm_rockets' && offers.length === 3, 'maxed + evolved pair offers its fusion: ' + offers.map((o) => o.name).join(', '));
const autoBefore = h.weapons.filter((w) => !w.def.slot).length;
const slotOfMissiles = h.weapons.indexOf(missiles);
h.applyOffer(fo!);
const fused = h.weapons.find((w) => w.def.id === 'napalm_rockets');
ok(!!fused && fused instanceof FusionWeapon, 'picking it adds the hybrid');
ok(!h.weapons.includes(missiles) && !h.weapons.includes(fire), 'both parts are gone');
ok(h.weapons.filter((w) => !w.def.slot).length === autoBefore - 1, 'fusing frees an auto-weapon slot');
ok(h.weapons.indexOf(fused!) === slotOfMissiles, 'the hybrid takes the first part’s slot');
ok(fused!.maxed && fused!.evolved && fused!.name === 'Napalm Rockets' && fused!.iconId === 'napalm_rockets', 'hybrid reads as maxed and named');
ok(h.tagsOf('napalm_rockets')?.includes('fire') === true, 'hybrid tags count for Mods');
ok(!h.buildOffers().some((o) => o.kind === 'fusion'), 'no repeat card');
ok(h.loadout().some((i) => i.name === 'Napalm Rockets' && i.id === 'napalm_rockets'), 'HUD loadout shows the fusion');
ok(fuseWeapons(h.weapons, 'napalm_rockets', scene) === null, 'cannot fuse without the parts');
for (let i = 0; i < 20; i++) h.chestItem();
ok(h.weapons.includes(fused!), 'chests leave the fusion alone');

// Every fusion builds and its net state round-trips into a fresh (client) copy.
for (const f of FUSIONS) {
  const w = createWeapon(f.id, scene) as FusionWeapon;
  ok(w.parts.length === f.children.length && w.parts.every((p) => p.partnerEvolved && p.color === f.color), `${f.id} builds its parts in its colour`);
  const copy = createWeapon(f.id, scene);
  const a = w.net();
  copy.setNet(a);
  ok(JSON.stringify(copy.net()) === JSON.stringify(a), `${f.id} net round-trips (${a.length} numbers)`);
  w.dispose();
  copy.dispose();
}
