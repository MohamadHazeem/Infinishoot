/** Family mechanics and network state: no renderer, browser or audio required. */
import * as THREE from 'three';
import { Bullets, Team } from '../src/game/bullets';
import { ok } from './check';
import { ENEMIES, familyTuning, VETERAN_OF } from '../src/data/enemies';
import { ENEMY_TIPS } from '../src/data/bestiary';
import { Enemy, BOSS_ACTIONS, type EnemyCtx } from '../src/game/enemies';
import { updateFamily, familyCanHit, copyDamage, copyKind, copyFan, COPY_IDS, beamReach } from '../src/game/systems/enemyFamilies';
import { Director } from '../src/game/director';
import { gaitOf } from '../src/game/animMath';
import { Rng } from '../src/core/rng';
import { packEnemies, unpackEnemies, packBullets, unpackBullets } from '../src/net/codec';
import { SpatialHash, StaticBoxGrid } from '../src/core/spatialHash';

for (const id of ['burrower', 'v_burrower', 'burrower_big', 'mirror', 'v_mirror', 'mirror_prism', 'swarmqueen', 'swarm_egg', 'swarm_wall']) {
  const d = ENEMIES[id];
  ok(!!d && !!ENEMY_TIPS[id] && !!gaitOf(d.model), `${id}: definition, bestiary and gait`);
}
ok(!!VETERAN_OF.burrower && !!VETERAN_OF.mirror, 'diggers and mirrors have veterans');
ok(Object.keys(ENEMIES).length <= 256 && BOSS_ACTIONS.length === 8, 'kinds fit a byte; boss actions unchanged');
for (let i = 0; i < COPY_IDS.length; i++) ok(copyKind(COPY_IDS[i]) === i, `copies ${COPY_IDS[i]}`);
ok(copyKind('unknown') === 0, 'unknown future primary uses safe buster fallback');
ok(copyDamage(10) === 3.5 && copyDamage(9999) === familyTuning.mirrorMaxDamage, 'copied damage is reduced and capped');
ok(copyFan(0, 1, 1) === 0 && copyFan(0, 5, 1) === -0.5 && copyFan(4, 5, 1) === 0.5, 'fan spread is centred and safe for single shots');
const wall = [{ minX: 3, maxX: 4, minZ: -1, maxZ: 1 }];
ok(beamReach(0, 0, 1, 0, 10, wall) === 3, 'mirror beams stop at cover');
ok(beamReach(0, 3, 1, 0, 10, wall) === 10, 'parallel beam beside cover keeps range');
ok(beamReach(0, 0, -1, 0, 10, wall) === 10, 'cover behind a beam cannot clip it');

const log: string[] = [];
let spawned = 0;
const target = { x: 4, z: 0, radius: 0.5, alive: true };
const ctx: EnemyCtx = {
  targets: [target], target, targetAlive: true, hash: new SpatialHash<Enemy>(2), colliders: [], walls: new StaticBoxGrid([]),
  onWindup() {}, onEnrage() {}, fireBullet() {}, spawnChild() { spawned++; }, detonate() {}, slam() {}, strike() {},
  land(e) { log.push('land'); ok(!e.underground, 'eruption exposes the burrower before damage'); },
  heal() {}, rally() {}, sparkle() {}, escape() {}, bounds: () => 55,
  family: {
    cue(_e, name) { log.push(name); }, scan(e) { e.copyKind = 1; log.push('scan'); },
    fire() { log.push('copy'); }, wall() { log.push('wall'); }, eggs() { log.push('eggs'); },
    retire(e) { e.active = false; log.push('hatch'); },
  },
};
function enemy(id: string): Enemy {
  const e = new Enemy(ENEMIES[id]); e.reset(0, 0, {}); e.state = 'move'; e.timerA = 0;
  return e;
}
function step(e: Enemy, seconds: number): void {
  for (let t = 0; t < seconds && e.active; t += 1 / 60) {
    const dt = 1 / 60, dx = target.x - e.x, dz = target.z - e.z, dist = Math.hypot(dx, dz) || 1;
    e.t -= dt;
    updateFamily(e, dt, ctx, dx / dist, dz / dist, dist, e.def.speed);
    e.x += e.vx * dt; e.z += e.vz * dt;
  }
}
{
  const e = enemy('burrower');
  step(e, 0.02);
  ok(e.underground && e.alive && !e.targetable, 'buried enemy remains alive for blast queries but cannot be targeted');
  ok(!familyCanHit(e, false) && familyCanHit(e, true), 'only explosions reach underground enemies');
  step(e, 0.8);
  ok(e.familyState === 2 && e.state === 'windup', 'mound reaches its target and warns before erupting');
  const x = e.targetX, z = e.targetZ;
  target.x = 12;
  e.x += 2; e.kx = 15; // an explosion hits during the ring warning
  step(e, 0.4);
  ok(e.x === x && e.z === z && e.kx === 0, 'explosive knockback cannot move an eruption off its ring');
  ok(e.targetX === x && e.targetZ === z && e.underground, 'ring locks and does not follow a dodging hero');
  step(e, 0.8);
  ok(e.targetable && log.includes('land'), 'burrower erupts, attacks and becomes targetable');
  step(e, 3.5);
  ok(e.underground, 'burrower digs again after its punish window');
  e.reset(0, 0, {});
  ok(e.familyState === 0 && !e.familyFled && e.copyFlash === 0, 'pooled enemy clears family state');
}
{
  log.length = 0;
  target.x = 8;
  const e = enemy('mirror');
  step(e, 0.02);
  ok(e.state === 'windup' && log.includes('scan') && !log.includes('copy'), 'mirror scans before attacking');
  step(e, 0.95);
  const aim = e.lungeX;
  target.x = -8;
  step(e, 0.5);
  ok(e.state === 'attack' && e.lungeX === aim && log.includes('copy'), 'copy uses the committed aim and has a reward window');
  const n = log.filter(x => x === 'copy').length;
  step(e, 3);
  ok(e.state === 'move' && log.filter(x => x === 'copy').length >= n, 'mirror ends copying and returns to cooldown');
}
{
  log.length = 0; spawned = 0;
  const e = enemy('swarm_egg'); e.timerA = familyTuning.eggHatch;
  step(e, familyTuning.eggHatch - 0.1);
  ok(e.active && spawned === 0, 'eggs allow a full warning window');
  step(e, 0.2);
  ok(!e.active && spawned === familyTuning.hatchCount && log.filter(x => x === 'hatch').length === 1, 'egg hatches once and retires without a kill reward');
  step(e, 10);
  ok(spawned === familyTuning.hatchCount, 'retired eggs cannot keep hatching');
  const killed = enemy('swarm_egg'); killed.active = false; step(killed, 10);
  ok(spawned === familyTuning.hatchCount, 'destroyed eggs never hatch');
}
{
  const e = enemy('swarm_wall'); e.timerA = familyTuning.wallLife;
  step(e, 1);
  ok(e.x === 0 && e.z === 0, 'wall swarmers hold a cuttable line');
  step(e, familyTuning.wallLife);
  ok(Math.hypot(e.x, e.z) > 0, 'wall expires into normal pursuers');
}
{
  log.length = 0;
  const e = enemy('swarmqueen');
  step(e, 0.02);
  ok(e.state === 'windup' && e.familyState === 1 && !log.includes('wall'), 'queen warns before splitting the arena');
  step(e, 12);
  ok(log.includes('wall') && log.includes('eggs'), 'queen alternates swarm walls and eggs');
  e.hp = e.maxHp * 0.4;
  step(e, 0.02);
  ok(e.familyFled && e.familyState === 3, 'queen flees once below half health');
  step(e, familyTuning.queenFleeTime + familyTuning.queenReturnTime + 0.2);
  ok(e.familyState !== 3 && e.familyState !== 4, 'queen returns to fighting');
  step(e, 8);
  ok(log.filter(x => x === 'return').length === 1, 'queen cannot repeatedly flee at low health');
}
{
  const d = new Director();
  for (const stage of [1, 2, 3]) {
    d.start(stage); const rng = new Rng(81); let queens = 0;
    for (let t = 0; t < d.duration + 10; t++) for (const r of d.update(1, 9999, () => 0, rng)) if (r.def.special) queens++;
    ok(queens === (stage === 1 ? 0 : 1), `director stage ${stage}: exactly the intended special count`);
  }
  d.start(1); const rng = new Rng(90); let early = false;
  for (let t = 0; t < d.duration; t++) for (const r of d.update(1, 0, () => 0, rng)) if (r.def.burrow || r.def.mirror) early = true;
  ok(!early, 'stage one stays free of new advanced enemies');
}
{
  const e = enemy('mirror_prism');
  e.aiBits = 7; e.familyState = 2; e.copyKind = 4; e.copyFlash = 0.1; e.copyShots = 5;
  e.copyRange = 18; e.copyArc = 0.7; e.copyWidth = 0.8;
  const b = enemy('burrower_big'); b.familyState = 1;
  const out: any[] = [];
  unpackEnemies(packEnemies([e, b]), r => out.push({ ...r }));
  ok(out.length === 2 && out[0].ai === 7 && out[0].familyState === 2 && out[1].familyState === 1, 'family bits coexist with squad bits in adjacent records');
  ok(out[0].copyKind === 4 && out[0].copyFlash && out[0].copyShots === 5 && out[0].copyRange === 18 && Math.abs(out[0].copyArc - 0.7) < 0.02 && out[0].copyWidth === 0.8, 'copied beam shape round-trips for clients');
  e.def = ENEMIES.bopper; e.reset(0, 0, {});
  ok(e.copyKind === 0 && e.copyShots === 1 && e.copyFlash === 0, 'recycled mirror cannot leak a beam into a bopper');
}

{
  const bullets = new Bullets(new THREE.Scene());
  for (const color of ['#b13eec', '#ffffff']) bullets.spawn({ x: 0, z: 0, dirX: 1, dirZ: 0, speed: 5,
    life: 2, radius: 0.4, damage: 5, knockback: 0, team: Team.Enemy, color, width: 0.8, length: 1.2 });
  const bytes = packBullets(bullets, [0, 1]);
  unpackBullets(bytes, bullets);
  ok(bullets.colorOf(0) === '#b13eec' && bullets.colorOf(1) === '#ffffff', 'mirror projectile and colorblind colours survive snapshots');
}
