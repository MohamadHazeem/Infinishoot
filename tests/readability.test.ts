/** Readability lane: crowd spacing around the hero, scar lifetimes, rig outline merging. */
import * as THREE from 'three';
import { ok } from './check';
import { ENEMIES } from '../src/data/enemies';
import { Enemies, Enemy, type EnemyCtx } from '../src/game/enemies';
import { crowdTuning, keepOffHeroes } from '../src/game/crowd';
import { mergeRigParts, RigOverlay, MAX_RIG_PARTS } from '../src/render/rigOverlay';
import { createHero } from '../src/game/heroModel';
import { SCAR_COLORS, scarFade, scarLook, scarTuning } from '../src/game/scars';
import { SpatialHash, StaticBoxGrid } from '../src/core/spatialHash';

// Minimal canvas stub: the ground decals paint a blob texture on creation.
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : noop),
  apply: () => noop,
  set: () => true,
});
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };

// ---------------------------------------------------------------- crowd spacing
function crowd(n: number, seconds: number) {
  const scene = new THREE.Scene();
  const en = new Enemies(scene);
  const t = { x: 0, z: 0, radius: 0.5, alive: true };
  const ctx: EnemyCtx = {
    targets: [t],
    target: t,
    targetAlive: true,
    hash: new SpatialHash<Enemy>(2),
    colliders: [],
    walls: new StaticBoxGrid([]),
    onWindup: () => {},
    onEnrage: () => {},
    fireBullet: () => {},
    spawnChild: () => {},
    detonate: () => {},
    slam: () => {},
    strike: () => {},
    land: () => {},
    heal: () => {},
    rally: () => {},
    sparkle: () => {},
    escape: () => {},
    bounds: () => 55,
  };
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 9 + (i % 5);
    en.spawn(ENEMIES.swarmer, Math.cos(a) * r, Math.sin(a) * r, { instant: true });
  }
  for (let i = 0; i < seconds * 60; i++) {
    ctx.hash.clear();
    for (const e of en.list) if (e.alive) ctx.hash.insert(e, e.x, e.z, e.radius);
    en.update(1 / 60, ctx);
  }
  const live = en.list.filter((e) => e.alive);
  // Enemies drawn on top of the hero (centre well inside the hero's circle).
  const onHero = live.filter((e) => Math.hypot(e.x, e.z) < t.radius).length;
  // Contact still possible: nearest enemies within touching distance.
  const touching = live.filter((e) => Math.hypot(e.x, e.z) < e.radius + t.radius).length;
  // Overlapping pairs and how deep they overlap (fraction of the two radii).
  let pairs = 0;
  let over = 0;
  let deep = 0;
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      const min = a.radius + b.radius;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d >= min) continue;
      pairs++;
      over += 1 - d / min;
      if (1 - d / min > 0.4) deep++;
    }
  }
  return { onHero, touching, pairs, meanOverlap: pairs ? over / pairs : 0, deep };
}

{
  const tuned = { ...crowdTuning };
  // The old crowd: separation 7 m/s per overlap, no hard limit, no jam, no hero gap.
  Object.assign(crowdTuning, { push: 7, hardGap: 0, jam: 0, heroGap: 0 });
  const t0 = performance.now();
  const before = crowd(120, 8);
  const t1 = performance.now();
  Object.assign(crowdTuning, tuned);
  const after = crowd(120, 8);
  const t2 = performance.now();
  console.log('crowd before', JSON.stringify(before), (t1 - t0).toFixed(0) + ' ms');
  console.log('crowd after ', JSON.stringify(after), (t2 - t1).toFixed(0) + ' ms');
  ok(before.onHero > 0, 'old crowd stood on the hero (' + before.onHero + ')');
  ok(after.onHero === 0, 'no enemy stands on the hero');
  ok(after.touching >= 3, 'enemies still reach contact range (' + after.touching + ')');
  ok(after.meanOverlap < before.meanOverlap * 0.7, 'overlaps are shallower (' + before.meanOverlap.toFixed(2) + ' -> ' + after.meanOverlap.toFixed(2) + ')');
  ok(after.deep * 5 < before.deep, 'deep overlaps mostly gone (' + before.deep + ' -> ' + after.deep + ')');
}

{
  // Contact range survives the hero gap; downed heroes don't push.
  const e = { x: 0.1, z: 0, radius: 0.36 };
  const targets = [{ x: 0, z: 0, radius: 0.5, alive: true }];
  ok(keepOffHeroes(e, targets) && Math.abs(Math.hypot(e.x, e.z) - 0.86 * crowdTuning.heroGap) < 1e-6, 'enemy pushed out to the hero gap');
  ok(Math.hypot(e.x, e.z) < 0.86, 'still inside contact distance');
  const f = { x: 0.1, z: 0, radius: 0.36 };
  ok(!keepOffHeroes(f, [{ ...targets[0], alive: false }]) && f.x === 0.1, 'downed heroes are not avoided');
}

// ---------------------------------------------------------------- scars
{
  const [scorchLife, scorchAlpha] = scarLook(SCAR_COLORS.scorch);
  const [craterLife, craterAlpha] = scarLook(SCAR_COLORS.crater);
  ok(scorchLife <= 0.6 && scorchAlpha <= 0.6, 'scorch lives about half as long, fainter (x' + scorchLife + ', ' + scorchAlpha + ')');
  ok(craterLife > scorchLife && craterAlpha > scorchAlpha, 'craters outlast and outshine scorch');
  ok(scarFade(0, 10) === 0 && scarFade(1, 10) === 1, 'scars pop in, then hold');
  const late = 10 * (1 - scarTuning.fade / 2);
  ok(scarFade(late, 10) > 0.4 && scarFade(late, 10) < 0.6, 'scars fade over the end of life');
  ok(scarFade(10, 10) === 0 && scarFade(12, 10) === 0, 'gone at the end');
}

// ---------------------------------------------------------------- merged hero outline
{
  const a = new THREE.BoxGeometry(1, 1, 1);
  const b = new THREE.SphereGeometry(0.5, 6, 4);
  const m = mergeRigParts([
    { geometry: a, index: 0 },
    { geometry: b, index: 3 },
  ]);
  const P = m.attributes.position.count;
  ok(P === a.attributes.position.count + b.attributes.position.count, 'merged vertex count');
  ok(m.index!.count === a.index!.count + b.index!.count, 'merged index count');
  const part = m.attributes.partIndex;
  ok(part.getX(0) === 0 && part.getX(P - 1) === 3, 'every vertex knows its part');
  let maxIdx = 0;
  for (let i = 0; i < m.index!.count; i++) maxIdx = Math.max(maxIdx, m.index!.getX(i));
  ok(maxIdx === P - 1, 'indices offset into the merged buffer');

  const rig = createHero();
  const before = countMeshes(rig.root);
  const o = new RigOverlay(rig.root);
  const after = countMeshes(rig.root);
  ok(before <= MAX_RIG_PARTS, 'hero rig fits the part uniform array (' + before + ' meshes)');
  ok(after - before === 4, 'one hero adds 4 overlay draws (outline, x-ray rim, x-ray, ring), was ~26 hulls (' + (after - before) + ')');
  o.update('#2f7bff', true);
  ok(rig.root.getObjectByName('heroRing')!.visible, 'ground ring shows');
  o.update('#2f7bff', false);
  ok(!rig.root.getObjectByName('heroRing')!.visible, 'ground ring hides when downed');
  let order = true;
  rig.root.traverse((x) => {
    const mesh = x as THREE.Mesh;
    if (mesh.isMesh && !mesh.userData.rigOverlay && mesh.renderOrder !== 51) order = false;
  });
  ok(order, 'hero parts draw after the x-ray');
  o.dispose();
}

function countMeshes(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((x) => {
    if ((x as THREE.Mesh).isMesh) n++;
  });
  return n;
}
