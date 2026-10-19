/** Graphics lane: destruction physics, customisation codes and weapon skins, camera framing, puddles, accessories, the bullet owner on the wire. */
import * as THREE from 'three';
import { ok } from './check';
import { fracture, maxPiece, stepChunk, PileMap, Shatter, shatterTuning } from '../src/render/shatter';
import { ACCESSORIES, cleanLook, colorDistance2, decodeLook, DEFAULT_LOOK_CODE, encodeLook, ENEMY_MAGENTA, lookColors, PRISM_CYCLE, skinShotColor, snapToPalette, SWEETIE16, WEAPON_SKINS } from '../src/data/customise';
import { cineTarget, cinePose, easeCine, cineTuning } from '../src/game/cineCam';
import { puddleSpots } from '../src/render/reflections';
import { createHero } from '../src/game/heroModel';
import { dressHero, setOwnerSkin, shotColor, clearOwnerSkins, customSkin } from '../src/game/heroLooks';
import { MAX_RIG_PARTS, RigOverlay } from '../src/render/rigOverlay';
import { SKINS } from '../src/data/skins';
import { Bullets, Team } from '../src/game/bullets';
import { packBullets, unpackBullets } from '../src/net/codec';

// Minimal canvas stub: textures (crate, faces) paint on creation.
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : noop),
  apply: () => noop,
  set: () => true,
});
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------- fracture
{
  const rand = seeded(7);
  const crate = fracture(1.2, 1.2, 1.2, 8, rand);
  ok(crate.length >= 6 && crate.length <= 12, `a crate breaks into about 8 pieces (${crate.length})`);
  const wall = fracture(5, 2.5, 0.8, 20, rand);
  let inside = true;
  let small = true;
  for (const p of wall) {
    if (Math.abs(p.ox) + p.sx / 2 > 2.5 + 0.2 || Math.abs(p.oz) + p.sz / 2 > 0.4 + 0.1 || p.oy - p.sy / 2 < -1e-6 || p.oy + p.sy / 2 > 2.5 + 1e-6) inside = false;
    if (Math.max(p.sx, p.sy, p.sz) > maxPiece) small = false;
  }
  ok(inside, 'pieces stay inside the box they were cut from');
  ok(small, `no piece is longer than ${maxPiece} m (outlines treat big instances as elites)`);
  const pillar = fracture(1.15, 1.15, 4.8, 12, rand);
  ok(pillar.length >= 5, `a fallen pillar breaks into drums along its length (${pillar.length})`);
}

// ---------------------------------------------------------------- chunk physics
{
  const s = { y: 3, vx: 4, vy: 2, vz: -1, spin: 10, floor: 0.2 };
  let steps = 0;
  let below = false;
  let bounces = 0;
  let lastVy = s.vy;
  while (!stepChunk(s, 1 / 60) && steps < 2000) {
    steps++;
    if (s.y < s.floor - 1e-6) below = true;
    if (lastVy < 0 && s.vy > 0) bounces++;
    lastVy = s.vy;
  }
  ok(steps < 600, `a dropped chunk settles within 10 s (${(steps / 60).toFixed(2)} s)`);
  ok(!below, 'a chunk never sinks into its floor while moving');
  ok(bounces >= 1 && bounces <= 6, `it bounces a few times (${bounces}) before settling`);
  ok(Math.abs(s.vx) + Math.abs(s.vz) < shatterTuning.rest, 'friction stops the slide');
}

// ---------------------------------------------------------------- piles
{
  const pile = new PileMap(0.5);
  pile.add(1.1, 1.1, 0, 0.4);
  pile.add(1.2, 1.2, pile.height(1.2, 1.2), 0.4);
  ok(pile.height(1.15, 1.15) > 0.6, `settled chunks stack (${pile.height(1.15, 1.15).toFixed(2)} m)`);
  ok(pile.height(3, 3) === 0, 'other cells stay on the ground');
  for (let i = 0; i < 20; i++) pile.add(1.1, 1.1, pile.height(1.1, 1.1), 0.5);
  ok(pile.height(1.1, 1.1) <= shatterTuning.pileMax + 1e-6, 'piles are capped');
  pile.clear();
  ok(pile.size === 0, 'piles clear');
}

// ---------------------------------------------------------------- shatter pool lifecycle
{
  const scene = new THREE.Scene();
  const sh = new Shatter(scene);
  const rand = seeded(3);
  sh.burst({ x: 0, z: 0, w: 1.2, h: 1.2, d: 1.2, color: '#c8803f', crate: true, pieces: 8, power: 1.2 }, rand);
  sh.burst({ x: 3, z: 0, w: 0.9, h: 1.1, d: 0.9, color: '#ff4d5e', color2: '#ffd23f', pieces: 9, power: 2.4 }, rand);
  const n0 = sh.live;
  ok(n0 >= 12, `pieces fly (${n0})`);
  for (let i = 0; i < 60 * 4; i++) sh.update(1 / 60);
  sh.render();
  ok(sh.live === n0 && sh.pile.size > 0, `after 4 s they lie in piles (${sh.pile.size} cells)`);
  for (let i = 0; i < 60 * (shatterTuning.life + shatterTuning.lifeRand + shatterTuning.sink + 1); i++) sh.update(1 / 60);
  sh.render();
  ok(sh.live === 0 && sh.pile.size === 0, 'then they sink away and the piles go');
  // Ring buffer: never more than the pool.
  for (let i = 0; i < 80; i++) sh.burst({ x: 0, z: 0, w: 1, h: 1, d: 1, color: '#ffffff', pieces: 8 }, rand);
  ok(sh.live <= shatterTuning.max + Math.round(shatterTuning.max / 2), 'the pools stay bounded (oldest pieces are reused)');
  sh.density = shatterTuning.lowScale;
  sh.clear();
  sh.burst({ x: 0, z: 0, w: 1.2, h: 1.2, d: 1.2, color: '#ffffff', pieces: 8 }, rand);
  ok(sh.live <= 6, `LOW quality halves the pieces (${sh.live})`);
}

// ---------------------------------------------------------------- customisation codes
{
  ok(encodeLook(decodeLook(DEFAULT_LOOK_CODE)) === DEFAULT_LOOK_CODE, 'the default code round-trips');
  const c = { armor: 11, body: 3, accent: 12, accessory: 3, weapon: 5 };
  ok(encodeLook(c) === 'b3c35' && JSON.stringify(decodeLook('b3c35')) === JSON.stringify(c), 'a full look round-trips through its 5-character code');
  ok(cleanLook('zz') === '---00' && cleanLook(42) === '---00' && cleanLook(undefined) === '---00', 'garbage from the network becomes the plain look');
  ok(cleanLook('b3c99') === 'b3c00', 'out-of-range accessory or skin falls back to none/stock');
  ok(cleanLook('B3C31') === 'b3c31', 'codes are case-insensitive');
  ok(snapToPalette('#ff0000') === SWEETIE16.indexOf('#b13e53'), 'colours snap to the nearest Sweetie 16 entry');
  ok(SWEETIE16.every((h, i) => snapToPalette(h) === i), 'every palette colour snaps to itself');
  const skin = SKINS[0];
  const dressed = lookColors(skin, decodeLook('9--00'));
  ok(dressed.armor === SWEETIE16[9] && dressed.suit === skin.suit && dressed.accent === skin.accent, '- keeps the skin colour, a digit picks the palette');
  ok(customSkin(skin, '---00').armor === skin.armor, 'portraits keep the skin when nothing is customised');
  ok(ACCESSORIES.length >= 3 && ACCESSORIES.length <= 10 && WEAPON_SKINS.length <= 10, 'accessory and weapon skin indices fit one digit');
}

// ---------------------------------------------------------------- weapon skins
{
  const far = (hex: string) => colorDistance2(hex, ENEMY_MAGENTA) > 90 * 90;
  ok(WEAPON_SKINS.every((w) => !w.main || (far(w.main) && far(w.hot))) && PRISM_CYCLE.every(far), 'no weapon skin uses (or comes close to) the enemy-bullet magenta');
  ok(skinShotColor(WEAPON_SKINS[0], 1, 1, 0.4, 0) === '', 'the stock skin keeps shot colours');
  const ember = WEAPON_SKINS.find((w) => w.id === 'ember')!;
  ok(skinShotColor(ember, 1, 0.95, 0.42, 0) === ember.main, 'coloured shots take the skin colour');
  ok(skinShotColor(ember, 1, 1, 1, 0) === ember.hot, 'white cores take the bright colour');
  clearOwnerSkins();
  const base = new THREE.Color('#fff36b');
  ok(shotColor(1, base, 0) === base, 'heroes without a weapon skin draw their shots as they are');
  setOwnerSkin(1, '---02'); // toxic
  ok(shotColor(1, base, 0).getHexString() === WEAPON_SKINS[2].main.slice(1), "a hero's weapon skin recolours its shots");
  ok(shotColor(0, base, 0) === base, "other heroes' shots are untouched");
  clearOwnerSkins();
}

// ---------------------------------------------------------------- crowd framing
{
  ok(cineTarget(0, false, 1, false) === 1, 'an empty screen tilts all the way');
  ok(cineTarget(40, false, 1, false) === 0, 'a big fight pulls back up');
  const mid = cineTarget((cineTuning.calm + cineTuning.busy) / 2, false, 1, false);
  ok(mid > 0 && mid < 1, 'in between it eases');
  ok(cineTarget(0, true, 1, false) === 0, 'bosses keep the high view');
  ok(cineTarget(0, false, 2, false) === 0, 'a zoomed-out wheel wants the overview');
  ok(cineTarget(0, false, 1, true) <= cineTuning.coopMax, 'co-op caps the tilt');
  const lo = cinePose(58, 1);
  ok(lo.pitch === 58 - cineTuning.pitchDrop && lo.pitch >= 40 && lo.dist < 1 && lo.dist > 0.8, `full tilt: ${lo.pitch} deg, x${lo.dist} distance (never disorienting)`);
  ok(cinePose(58, 0).pitch === 58 && cinePose(58, 0).dist === 1, 'no tilt = the usual camera');
  let t = 0;
  for (let i = 0; i < 60; i++) t = easeCine(t, 1, 1 / 60);
  let u = 1;
  for (let i = 0; i < 60; i++) u = easeCine(u, 0, 1 / 60);
  ok(t < 0.4 && u < 0.2, `settles in slowly (${t.toFixed(2)} after 1 s), pulls up fast (${u.toFixed(2)} left after 1 s)`);
  // Aim stays exact with the tilted camera: the cursor ray still hits the ground point it points at.
  const cam = new THREE.PerspectiveCamera(34, 16 / 9, 0.5, 120);
  const pose = cinePose(58, 1);
  const pitch = THREE.MathUtils.degToRad(pose.pitch);
  const dist = 25 * pose.dist;
  cam.position.set(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const target = new THREE.Vector3(3, 0, -2);
  const ndc = target.clone().project(cam);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
  const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())!;
  ok(hit.distanceTo(target) < 1e-3, 'mouse aim projects onto the ground correctly at full tilt');
}

// ---------------------------------------------------------------- puddles
{
  const blocked = (x: number, z: number, r: number) => Math.abs(x) < 10 + r && Math.abs(z) < 10 + r;
  const a = puddleSpots(123, 30, 55, blocked);
  const b = puddleSpots(123, 30, 55, blocked);
  ok(a.length === b.length && a.every((v, i) => v === b[i]), 'puddles are the same for a seed on every machine');
  let clear = true;
  for (let i = 0; i < a.length; i += 3) if (blocked(a[i], a[i + 1], a[i + 2])) clear = false;
  ok(clear && a.length / 3 <= 30 && a.length / 3 >= 20, `puddles avoid walls and pools (${a.length / 3})`);
}

// ---------------------------------------------------------------- accessories on the rig
{
  const rig = createHero('#2f7bff', SKINS[0]);
  const base = countMeshes(rig.root);
  dressHero(rig, '---30', true); // scarf
  const dressed = countMeshes(rig.root);
  ok(dressed - base === 5 && dressed <= MAX_RIG_PARTS, `accessories add 5 rig parts and stay within the overlay budget (${dressed}/${MAX_RIG_PARTS})`);
  const shown = (name: string) => rig.root.getObjectByName(name)!.visible;
  ok(shown('accScarf') && shown('accScarfTail') && !shown('accCap'), 'only the worn accessory shows');
  dressHero(rig, '---20', true);
  ok(shown('accCap') && !shown('accScarf'), 'switching accessories toggles visibility');
  dressHero(rig, '---00', true);
  ok(!shown('accCap'), 'none hides them all');
  dressHero(rig, '5-a10', true);
  ok(rig.mats.armor.uniforms.uColor.value.getHexString() === SWEETIE16[5].slice(1) && rig.mats.accent.uniforms.uColor.value.getHexString() === SWEETIE16[10].slice(1), 'custom armour and accent paint the rig');
  const ant = rig.root.getObjectByName('accAntenna') as THREE.Mesh;
  const col = ant.geometry.getAttribute('color') as THREE.BufferAttribute;
  const role = ant.geometry.getAttribute('role') as THREE.BufferAttribute;
  let main = -1;
  for (let i = 0; i < role.count; i++) if (role.getX(i) === 0) main = i;
  ok(main >= 0 && Math.abs(col.getX(main) - new THREE.Color(SWEETIE16[10]).r) < 1e-6, 'accessories take the accent colour');
  const coop = createHero('#e8364f', SKINS[0]);
  dressHero(coop, '5--00', false);
  ok(coop.mats.armor.uniforms.uColor.value.getHexString() === 'e8364f', 'co-op armour keeps the player colour');
  const o = new RigOverlay(rig.root);
  o.update('#2f7bff', true);
  ok(true, 'the merged outline builds with accessories');
  o.dispose();
}

// ---------------------------------------------------------------- the bullet owner on the wire (weapon skins on clients)
{
  const scene = new THREE.Scene();
  const a = new Bullets(scene);
  const base = { x: 1, z: 2, dirX: 1, dirZ: 0, speed: 10, life: 1, radius: 0.2, damage: 5, knockback: 1, color: '#fff36b', width: 0.3, length: 0.8, team: Team.Player };
  for (let o = 0; o < 4; o++) a.spawn({ ...base, owner: o, kind: 0 });
  const b = new Bullets(scene);
  unpackBullets(packBullets(a, [0, 1, 2, 3]), b);
  ok([0, 1, 2, 3].every((i) => b.owner[i] === a.owner[i] && b.team[i] === Team.Player && b.shape[i] === a.shape[i]), 'bullet owners (0-3) survive the bullet record alongside team and shape');
  setOwnerSkin(2, '---01');
  b.render(1);
  const ic = b.mesh.instanceColor!;
  ok(new THREE.Color(ic.getX(2), ic.getY(2), ic.getZ(2)).getHexString() === WEAPON_SKINS[1].main.slice(1), "clients draw a teammate's shots in its weapon skin");
  ok(b.colorOf(2) === '#fff36b', 'the real colour stays for gameplay looks and the codec');
  clearOwnerSkins();
}

function countMeshes(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((x) => {
    if ((x as THREE.Mesh).isMesh) n++;
  });
  return n;
}
