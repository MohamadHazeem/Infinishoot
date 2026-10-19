import * as THREE from 'three';
import { ok } from './check';
import { HEROES } from '../src/data/heroes';
import { ENEMIES } from '../src/data/enemies';
import { allBiomeKeys } from '../src/data/biomes';
import { SKINS } from '../src/data/skins';
import { animateHero, applySkin, createHero, newPose, setExpression, setHeroModel } from '../src/game/heroModel';
import { attachHeroGear, detachHeroGear } from '../src/game/heroMechs';
import { dressHero } from '../src/game/heroLooks';
import { Enemies, enemyGeometry } from '../src/game/enemies';
import { BIOME_SKINS, biomePaint, biomeSkinKey, hasBiomeSkin, hasBossDamage } from '../src/render/biomeSkins';
import { MAX_RIG_PARTS, RigOverlay } from '../src/render/rigOverlay';
import { outlineInstanced } from '../src/render/outlines';
import { retroGlobals } from '../src/render/retroMaterial';

const noop: any = new Proxy(function () {}, {
  get: (_t, k) => k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : noop,
  apply: () => noop, set: () => true,
});
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
THREE.ColorManagement.enabled = false;
const meshes = (root: THREE.Object3D) => { const out: THREE.Mesh[] = []; root.traverse(o => { if (o instanceof THREE.Mesh && !o.userData.rigOverlay) out.push(o); }); return out; };

// All identities retain skin uniforms, expressions and the complete animation rig, even with wardrobe gear.
for (const hero of HEROES) {
  const rig = createHero();
  setHeroModel(rig, hero.id);
  const gear = attachHeroGear(rig, hero.mech);
  dressHero(rig, '---30', true); // creates all five wardrobe meshes, even hidden ones
  const parts = meshes(rig.root);
  ok(parts.length <= MAX_RIG_PARTS, `${hero.id}: ${parts.length} parts including mechanic + wardrobe fit the overlay`);
  ok(parts.every(m => m.geometry.getAttribute('position').array.every(Number.isFinite)), `${hero.id}: finite geometry`);
  const rev = rig.root.userData.modelRevision;
  setHeroModel(rig, hero.id);
  ok(rig.root.userData.modelRevision === rev, `${hero.id}: repeated identity assignment does not rebuild`);
  applySkin(rig, '#41a6f6', SKINS[1]);
  ok(rig.mats.armor.uniforms.uColor.value.getHexString() === '41a6f6', `${hero.id}: co-op armour remains recolourable`);
  ok(rig.materials.every(m => m.uniforms.uTime === retroGlobals.uTime), `${hero.id}: materials retain shared retro uniforms`);
  setExpression(rig, 'hurt');
  ok(rig.expression === 'hurt' && !!rig.mats.face.uniforms.uMap.value, `${hero.id}: facial expressions survive`);
  const p = newPose(); p.dt = 1 / 60; p.vx = 1; p.bw = hero.build[0]; p.bh = hero.build[1];
  for (let i = 0; i < 60; i++) animateHero(rig, p);
  ok(Math.abs(rig.legL.rotation.x) > 0 && Number.isFinite(rig.armR.rotation.x), `${hero.id}: locomotion still animates joints`);
  p.dead = true; for (let i = 0; i < 60; i++) animateHero(rig, p);
  ok(Number.isFinite(rig.body.rotation.x), `${hero.id}: death pose stays finite`);
  detachHeroGear(rig, gear);
}
{
  const rig = createHero();
  setHeroModel(rig, 'dash');
  const overlay = new RigOverlay(rig.root);
  overlay.update('#ffffff', true);
  const oldHull = (overlay as any).hull;
  setHeroModel(rig, 'ace'); overlay.update('#ffffff', true);
  ok((overlay as any).hull !== oldHull, 'identity switch refreshes the outline immediately, including equal part counts');
  setHeroModel(rig, 'twin');
  ok(meshes(rig.legL).some(m => m.material === rig.mats.accent), 'Twin uses opposing limb colours');
  setHeroModel(rig, 'rookie');
  ok(meshes(rig.legL).some(m => m.material === rig.mats.armor), 'switching from Twin restores armour material');
  ok(!meshes(rig.body).some(m => !m.geometry.getAttribute('position')), 'repeated switches leave no invalid geometry');
}

ok(allBiomeKeys().every(k => Object.hasOwn(BIOME_SKINS, k)), 'every biome and remix has a palette');
ok(biomeSkinKey('peaks:future') === 'peaks' && biomeSkinKey('missing') === 'meadow', 'unknown variants fall back safely');
for (const key of allBiomeKeys()) {
  const skin = biomeSkinKey(key), def = ENEMIES.bopper;
  ok(biomePaint('#ffffff', def, skin) === '#ffffff', `${key}: white eyes retain the night-glow mask`);
  const geo = enemyGeometry(def, skin);
  ok(geo === enemyGeometry(def, skin), `${key}: model geometry is cached`);
  ok(geo.index !== null && geo.groups.length === 0, `${key}: one indexed body draw`);
  ok(geo.getAttribute('position').array.every(Number.isFinite), `${key}: finite skin geometry`);
  ok(geo.getAttribute('position').count < 1100, `${key}: regular enemy geometry stays bounded`);
}
ok(enemyGeometry(ENEMIES.bopper, 'peaks') !== enemyGeometry(ENEMIES.bopper, 'neon'), 'biome cache entries are isolated');
for (const def of Object.values(ENEMIES)) {
  if (def.boss || def.miniboss || def.biomes || def.treasure || def.hidden) ok(!hasBiomeSkin(def), `${def.id}: authored special identity preserved`);
  if (!hasBossDamage(def)) continue;
  const geo = enemyGeometry(def), detail = geo.getAttribute('modelDetail');
  let early = 0, late = 0, glow = 0;
  for (let i = 0; i < detail.count; i++) {
    const gate = detail.getX(i);
    if (gate > 0.4) early++;
    else if (gate > 0) late++;
    if (detail.getY(i) > 0) glow++;
  }
  if (def.model === 'cake') {
    let tiers = 0;
    for (let i = 0; i < detail.count; i++) if (detail.getX(i) < 0) tiers++;
    ok(tiers > 0, `${def.id}: breakable tiers carry HP thresholds`);
  } else ok(early > 0 && late > 0 && glow > 0, `${def.id}: core and both HP damage states are present`);
  ok(geo.userData.modelOutlineCount < geo.index!.count, `${def.id}: hidden cracks and sparks do not leak into the outline`);
}
{
  const scene = new THREE.Scene(), enemies = new Enemies(scene);
  enemies.spawn(ENEMIES.bopper, 0, 0, { instant: true });
  const regular = (enemies as any).batches.get('bopper');
  outlineInstanced(regular.mesh);
  const before = regular.mesh.geometry;
  enemies.setBiome('peaks');
  ok(before !== regular.mesh.geometry && regular.mesh.geometry.groups.length === 2, 'arena swap preserves the existing outline pass');
  ok(regular.mesh.geometry.getAttribute('instanceFlash') === regular.flash, 'arena swap keeps the hit-flash buffer');
  const bossDef = Object.values(ENEMIES).find(d => d.model === 'king' && d.boss)!;
  const boss = enemies.spawn(bossDef, 0, 0, { instant: true });
  const batch = (enemies as any).batches.get(bossDef.id);
  boss.hp = boss.maxHp * 0.25;
  enemies.render(1, 0);
  ok(Math.abs(batch.health.getX(0) - 0.25) < 1e-6, 'render derives damage from authoritative HP');
  const geometry = batch.mesh.geometry;
  enemies.setBiome('factory');
  ok(batch.mesh.geometry === geometry, 'biome swaps never alter boss identity or damage attributes');
  boss.hp = boss.maxHp; enemies.render(1, 1);
  ok(batch.health.getX(0) === 1, 'reused/healed boss slots clear old damage states');
  ok(!regular.health, 'regular crowds incur no damage-state upload');
  ok(batch.material.vertexShader.includes('modelHealth') && batch.material.fragmentShader.includes('vModelHealth'), 'boss material consumes the per-instance HP buffer');
}
