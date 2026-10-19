/** Boss phases, mini-boss picks, new boss moves and the boss net state. */
import * as THREE from 'three';
import { ok } from './check';
import { BOSS_ORDER, ENEMIES, MINI_BOSSES, bossForStage, miniBossForStage } from '../src/data/enemies';
import { Enemy, type EnemyCtx } from '../src/game/enemies';
import { bossMoveTuning, bossTuning, breathAngle, eightPoint, phaseFor, phaseGate, startIntro, startPhase, updateBoss, type BossApi } from '../src/game/bosses';
import { BossField } from '../src/game/bossField';
import { introEnvelope, introTuning } from '../src/game/bossIntro';

// --- phases
ok(phaseFor([0.66, 0.33], 1) === 1 && phaseFor([0.66, 0.33], 0.5) === 2 && phaseFor([0.66, 0.33], 0.1) === 3, 'phaseFor counts crossed thresholds');
for (const id of [...BOSS_ORDER, ...MINI_BOSSES.map((m) => m.id)]) {
  const d = ENEMIES[id];
  ok(!!d.phases?.length && d.phases.every((t, i, a) => t > 0 && t < 1 && (i === 0 || t < a[i - 1])), `${id} has descending phase thresholds`);
  ok(!!d.title, `${id} has an entrance subtitle`);
}
ok(ENEMIES.king.phases!.length === 2 && ENEMIES.rex.phases!.length === 2 && ENEMIES.queen.phases!.length === 2, 'regular bosses have 3 phases');
ok(MINI_BOSSES.every((m) => ENEMIES[m.id].phases!.length === 1 && ENEMIES[m.id].miniboss && !ENEMIES[m.id].boss), 'mini-bosses have 2 phases and are not stage bosses');

{
  // A huge hit can't skip a phase or kill the boss early.
  const e = new Enemy(ENEMIES.king);
  e.reset(0, 0, { hpMul: 1 });
  e.hp = -500;
  const p = phaseGate(e);
  ok(p === 2 && e.hp === Math.round(0.66 * e.maxHp), `overkill stops at the phase 2 threshold (hp ${e.hp})`);
  startPhase(e, p);
  ok(e.phase === 2 && e.roarT === bossTuning.roar && e.enraged, 'phase change starts a roar');
  ok(phaseGate(e) === 0, 'no second phase change at the same HP');
  e.hp = 0.2 * e.maxHp;
  ok(phaseGate(e) === 3 && e.hp === Math.round(0.33 * e.maxHp), 'phase 3 at its threshold');
  e.phase = 3;
  e.hp = 0;
  ok(phaseGate(e) === 0 && e.hp === 0, 'the last phase can die');
}

// --- mini-bosses
for (let s = 1; s <= 12; s++) {
  const m = miniBossForStage(s);
  const of = MINI_BOSSES.find((x) => x.id === m.id)!.of;
  ok(of !== bossForStage(s).id, `stage ${s}: mini-boss ${m.id} isn't a copy of the ${bossForStage(s).id}`);
}

// --- move geometry
{
  const p = { x: 0, z: 0 };
  eightPoint(0, 8, 3, 4, 1, 0, p);
  const start = Math.hypot(p.x - 3, p.z - 4);
  eightPoint(Math.PI * 2, 8, 3, 4, 1, 0, p);
  const end = Math.hypot(p.x - 3, p.z - 4);
  eightPoint(Math.PI / 2, 8, 0, 0, 0, 1, p);
  ok(start < 1e-9 && end < 1e-6, 'figure-eight starts and ends where Rex stands');
  ok(Math.abs(p.z - 8) < 1e-9 && Math.abs(p.x) < 1e-9, 'figure-eight reaches its lobe along the heading');
  const a0 = breathAngle(1, bossMoveTuning.breathTime);
  const a1 = breathAngle(1, 0);
  ok(Math.abs(a0 - (1 - bossMoveTuning.breathArc)) < 1e-9 && Math.abs(a1 - (1 + bossMoveTuning.breathArc)) < 1e-9, 'fire breath sweeps across its telegraphed cone');
  ok(introEnvelope(0) === 0 && introEnvelope(introTuning.length) === 0 && introEnvelope(introTuning.length / 2) === 1, 'intro camera pans in and back out');
}

// --- brains: run each boss through its phases with a fake world
function fakeCtx(calls: Record<string, number>): EnemyCtx {
  const hero = { x: 6, z: 2, radius: 0.5, alive: true };
  const count = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  const api: BossApi = {
    shockwave: () => count('shockwave'),
    rampage: (_e, fire) => (count('rampage'), fire && count('fire')),
    firePatch: () => count('fire'),
    shot: () => count('shot'),
    plantHive: () => (count('hive'), true),
    hiveCount: () => 0,
    swarmWall: () => count('wall'),
    open: () => true,
  };
  return {
    targets: [hero],
    target: hero,
    targetAlive: true,
    hash: null as never,
    colliders: [],
    onWindup: () => count('windup'),
    onEnrage: () => {},
    fireBullet: () => count('bullet'),
    spawnChild: () => count('child'),
    detonate: () => {},
    slam: () => count('slam'),
    strike: () => count('strike'),
    boss: api,
  };
}

function run(id: string, phase: number, seconds: number): Record<string, number> {
  const calls: Record<string, number> = {};
  const ctx = fakeCtx(calls);
  const e = new Enemy(ENEMIES[id]);
  e.reset(0, 0, { instant: true });
  e.state = 'move';
  if (phase > 1) startPhase(e, phase);
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    const dx = ctx.target.x - e.x;
    const dz = ctx.target.z - e.z;
    const d = Math.hypot(dx, dz) || 1;
    e.t -= dt; // Enemies.update ticks this before the brain runs
    updateBoss(e, dt, ctx, dx / d, dz / d, d, e.def.speed);
    e.x += e.vx * dt;
    e.z += e.vz * dt;
    if (!Number.isFinite(e.x) || !Number.isFinite(e.z)) {
      calls.nan = 1;
      break;
    }
  }
  return calls;
}

const king2 = run('king', 2, 20);
ok((king2.shockwave ?? 0) > 0 && !king2.nan, `King phase 2 slams send shockwaves (${king2.shockwave})`);
const king1s = run('king', 1, 20);
ok((king1s.shockwave ?? 0) === 0 && (king1s.slam ?? 0) > 0, 'King phase 1 slams without shockwaves');
const rex2 = run('rex', 2, 20);
ok((rex2.rampage ?? 0) > 0 && (rex2.fire ?? 0) > 0 && !rex2.nan, `Rex phase 2 rampages and leaves fire (${rex2.rampage} steps, ${rex2.fire} patches)`);
const rex3 = run('rex', 3, 20);
ok((rex3.shot ?? 0) > 20, `Rex phase 3 breathes fire (${rex3.shot} flames)`);
ok((run('rexling', 2, 20).fire ?? 0) === 0, 'Rex Jr. leaves no fire');
const q2 = run('queen', 2, 20);
ok((q2.hive ?? 0) >= 2, `Queen phase 2 plants hives (${q2.hive})`);
const q3 = run('queen', 3, 20);
ok((q3.wall ?? 0) > 0, `Queen phase 3 sends swarm walls (${q3.wall})`);
const om = run('omega', 3, 25);
ok((om.bullet ?? 0) > 0 && (om.strike ?? 0) > 0 && !om.nan, 'Omega phase 3 still fights');
const king1 = run('king', 1, 30);
ok((king1.strike ?? 0) > 0, 'King tremors drop rubble (arena twist)');
ok((run('prince', 2, 30).strike ?? 0) === 0, 'mini-bosses have no arena twist');
{
  const calls: Record<string, number> = {};
  const ctx = fakeCtx(calls);
  const e = new Enemy(ENEMIES.king);
  e.reset(0, 0, { instant: true });
  startIntro(e, 1);
  for (let i = 0; i < 50; i++) {
    e.t -= 1 / 60;
    updateBoss(e, 1 / 60, ctx, 1, 0, 6, 2);
  }
  ok(!calls.windup && e.roarT > 0 && e.vx === 0, 'idle during the entrance');
}

// --- net state round trip
{
  const field = new BossField(new THREE.Scene());
  const e = new Enemy(ENEMIES.rex);
  e.reset(0, 0, {});
  e.uid = 42;
  e.phase = 3;
  e.move = 'breath';
  e.roarT = 0.5;
  field.waves.push({ x: 1, z: 2, r: 3.333, delay: 0, dmg: 10, hit: 0, cause: '' });
  field.fires.push({ x: 4, z: 5, r: 1.4, t: 2, dmg: 5, tick: 0.5 });
  const mini = new Enemy(ENEMIES.prince);
  mini.reset(0, 0, {});
  mini.hp = mini.maxHp / 2;
  field.mini = mini;
  const net = JSON.parse(JSON.stringify(field.pack([e], () => 1.5)));
  const other = new BossField(new THREE.Scene());
  const mirror = new Enemy(ENEMIES.rex);
  mirror.reset(0, 0, {});
  other.unpack(net, (uid) => (uid === 42 ? mirror : undefined));
  ok(mirror.phase === 3 && mirror.move === 'breath' && mirror.roarT > 0, 'client mirrors boss phase, move and roar');
  ok(other.waves.length === 1 && Math.abs(other.waves[0].r - 3.33) < 1e-9 && other.fires.length === 1, 'client mirrors shockwaves and fire');
  ok(other.netMini?.[0] === 'Prince Bopper' && other.netMini[1] === 0.5, 'client gets the mini-boss bar');
  ok(net.b[0][4] === 1.5, 'entrance time reaches clients');
  other.advance(1);
  ok(Math.abs(other.waves[0].r - (3.33 + bossMoveTuning.shockSpeed)) < 1e-6, 'client shockwaves keep expanding between snapshots');
}
