/** Enemy lane: new enemy types, crowd AI helpers, squads, the Goldbug and the co-op record. */
import * as THREE from 'three';
import { ok } from './check';
import { ENEMIES, VETERAN_OF, squadOf, squadSize } from '../src/data/enemies';
import { ENEMY_TIPS } from '../src/data/bestiary';
import { Enemies, Enemy, aiTuning, flankBend, guardFactor, segmentHitsBox, type EnemyCtx } from '../src/game/enemies';
import { Director, directorTuning, goldenTime } from '../src/game/director';
import { packEnemies, unpackEnemies } from '../src/net/codec';
import { SpatialHash } from '../src/core/spatialHash';
import { Rng } from '../src/core/rng';
import type { AABB } from '../src/world/collision';

// ---------------------------------------------------------------- data
for (const id of ['shielder', 'medic', 'leaper', 'mortar', 'golden']) {
  ok(!!ENEMIES[id], id + ' defined');
  ok(!!ENEMY_TIPS[id], id + ' has a bestiary tip');
}
for (const id of ['shielder', 'medic', 'leaper', 'mortar']) {
  const v = ENEMIES[VETERAN_OF[id]];
  ok(!!v && v.hp > ENEMIES[id].hp, id + ' has a tougher veteran');
}
ok(ENEMIES.v_leaper.leap!.damage > ENEMIES.leaper.leap!.damage, 'veteran leaper hits harder');
ok(ENEMIES.golden.weight === 0 && ENEMIES.golden.minMinute < 0, 'Goldbug never spawns from the regular pool');
ok(squadOf(ENEMIES.shooter) === 'bopper' && squadOf(ENEMIES.v_shooter) === 'v_bopper', 'squad picks (veterans bring veterans)');
ok(!!ENEMIES[squadOf(ENEMIES.reaper)], 'unknown elites still get a valid squad');
ok(squadSize(1) === 3 && squadSize(3) === 4 && squadSize(99) === 6, 'squad size grows with stage, capped');

// ---------------------------------------------------------------- pure helpers
const sh = new Enemy(ENEMIES.shielder);
sh.reset(0, 0, {});
sh.facing = 0; // facing +Z
ok(guardFactor(sh, 0, 5) === ENEMIES.shielder.guard!.frontMul, 'shield blocks hits from the front');
ok(guardFactor(sh, 5, 0) === 1, 'flank hits get through');
ok(guardFactor(sh, 0, -5) === 1, 'hits from behind get through');
const ally = new Enemy(ENEMIES.bopper);
ally.reset(0, -2, {});
ok(guardFactor(ally, 0, 5) === 1, 'unguarded ally takes full damage');
ally.guardT = 0.3;
ally.guardAng = 0;
ok(guardFactor(ally, 0, 5) === ENEMIES.shielder.guard!.behindMul, 'ally behind a shield takes reduced damage from the front');
ok(guardFactor(ally, 0, -5) === 1, 'ally behind a shield is open from behind');

const box: AABB = { minX: 4, maxX: 6, minZ: -1, maxZ: 1 };
ok(segmentHitsBox(0, 0, 1, 0, 10, 0, box), 'segment through a box hits');
ok(!segmentHitsBox(0, 0, 1, 0, 3, 0, box), 'segment stopping short misses');
ok(!segmentHitsBox(0, 3, 1, 0, 10, 0.5, box), 'segment passing beside misses');
ok(segmentHitsBox(0, 1.3, 1, 0, 10, 0.5, box), 'padding catches a close pass');
ok(!segmentHitsBox(0, 0, -1, 0, 10, 0, box), 'segment pointing away misses');

ok(flankBend(1, 1) === 0 && flankBend(1, 100) === 1 && Math.abs(flankBend(-1, (aiTuning.flankNear + aiTuning.flankFar) / 2) + 0.5) < 1e-9, 'flank bend fades in with distance');
let wide = 0;
for (let i = 0; i < 400; i++) {
  const e = new Enemy(ENEMIES.swarmer);
  e.reset(0, 0, {});
  if (Math.abs(e.flank) > aiTuning.flankMax) wide++;
  if (Math.abs(e.flank) > aiTuning.wideMax) ok(false, 'flank out of range ' + e.flank);
}
ok(wide > 40 && wide < 180, 'about a quarter of chasers circle wide (' + wide + '/400)');

// ---------------------------------------------------------------- Goldbug timing
const dur = directorTuning.stageSeconds;
ok(goldenTime(1, dur, 0) >= 60, 'stage 1 Goldbug never in the first minute');
ok(goldenTime(2, dur, 0) === dur * directorTuning.goldenFrom, 'later stages use the window start');
ok(goldenTime(3, dur, 1) === dur * directorTuning.goldenTo, 'window end');
{
  const d = new Director();
  d.start(1);
  const rng = new Rng(7);
  let goldens = 0;
  let firstAt = -1;
  for (let t = 0; t < dur - 1; t += 1 / 30) {
    for (const r of d.update(1 / 30, 9999, () => 0, rng)) {
      if (r.def.id === 'golden') {
        goldens++;
        if (firstAt < 0) firstAt = d.time;
      }
    }
  }
  ok(goldens === 1, 'director sends exactly one Goldbug per stage (' + goldens + ')');
  ok(firstAt >= 60, 'stage 1 Goldbug after a minute (' + firstAt.toFixed(1) + ' s)');
}
{
  const d = new Director();
  const rng = new Rng(3);
  const seen = new Set<string>();
  for (const stage of [1, 2, 3]) {
    d.start(stage);
    for (let t = 0; t < dur - 1; t += 1 / 30) for (const r of d.update(1 / 30, 0, () => 0, rng)) seen.add(r.def.id.replace(/^v_/, ''));
  }
  for (const id of ['shielder', 'medic', 'leaper', 'mortar']) ok(seen.has(id), id + ' joins via the director by stage 3');
  d.start(1);
  const s1 = new Set<string>();
  for (let t = 0; t < dur - 1; t += 1 / 30) for (const r of d.update(1 / 30, 0, () => 0, rng)) s1.add(r.def.id);
  ok(!s1.has('leaper') && !s1.has('mortar'), 'leapers and mortars wait for stage 2');
}

// ---------------------------------------------------------------- codec
{
  const e = new Enemy(ENEMIES.bopper);
  e.reset(1, 2, { elite: true, eliteMod: 'shielded' });
  e.uid = 9;
  for (const bits of [0, 1, 2, 4, 7]) {
    e.aiBits = bits;
    let got: any = null;
    unpackEnemies(packEnemies([e]), (r) => (got = { ...r }));
    ok(got.ai === bits && got.eliteMod === 'shielded' && got.shield === e.shield > 0, 'codec ai bits ' + bits + ' with elite mod and shield');
  }
}

// ---------------------------------------------------------------- behaviour sim
// Minimal canvas stub: the ground decals paint a blob texture on creation.
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : noop),
  apply: () => noop,
  set: () => true,
});
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
const scene = new THREE.Scene();
function makeCtx(target: { x: number; z: number }, colliders: AABB[] = []) {
  const log: string[] = [];
  const t = { x: target.x, z: target.z, radius: 0.5, alive: true };
  const ctx: EnemyCtx = {
    targets: [t],
    target: t,
    targetAlive: true,
    hash: new SpatialHash<Enemy>(2),
    colliders,
    onWindup: () => log.push('windup'),
    onEnrage: () => {},
    fireBullet: () => log.push('bullet'),
    spawnChild: () => {},
    detonate: () => {},
    slam: () => {},
    strike: () => log.push('strike'),
    land: () => log.push('land'),
    heal: () => log.push('heal'),
    rally: () => log.push('rally'),
    sparkle: () => {},
    escape: (e) => {
      log.push('escape');
      en.kill(e);
    },
    bounds: () => 55,
  };
  return { ctx, log };
}
let en = new Enemies(scene);
function run(ctx: EnemyCtx, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) {
    ctx.hash.clear();
    for (const e of en.list) if (e.alive) ctx.hash.insert(e, e.x, e.z, e.radius);
    en.update(1 / 60, ctx);
  }
}
{
  en = new Enemies(scene);
  const { ctx, log } = makeCtx({ x: 0, z: 0 }, [{ minX: 2, maxX: 3, minZ: -3, maxZ: 3 }]);
  const lp = en.spawn(ENEMIES.leaper, 7, 0, { instant: true });
  let maxY = 0;
  for (let i = 0; i < 240; i++) {
    ctx.hash.clear();
    en.update(1 / 60, ctx);
    maxY = Math.max(maxY, lp.hopY);
  }
  ok(log.includes('land') && maxY > 2, 'leaper hops (peak ' + maxY.toFixed(1) + ' m) and lands');
  ok(lp.x < 2, 'leaper cleared the wall between it and you (x=' + lp.x.toFixed(1) + ')');
}
{
  en = new Enemies(scene);
  const { ctx, log } = makeCtx({ x: 0, z: 0 });
  const g = en.spawn(ENEMIES.golden, 3, 0, { instant: true });
  run(ctx, 4);
  ok(Math.hypot(g.x, g.z) > 12, 'Goldbug runs away (' + Math.hypot(g.x, g.z).toFixed(1) + ' m)');
  run(ctx, 10);
  ok(log.includes('escape') && !g.active, 'Goldbug escapes when its time is up');
}
{
  en = new Enemies(scene);
  // A wall right between the charger and you.
  const { ctx, log } = makeCtx({ x: 0, z: 0 }, [{ minX: 3, maxX: 4, minZ: -1.5, maxZ: 1.5 }]);
  const c = en.spawn(ENEMIES.charger, 7, 0, { instant: true });
  run(ctx, 0.2);
  ok(c.state === 'move' && c.reroute > 0 && !log.includes('windup'), 'charger refuses a walled charge and sidesteps');
  run(ctx, 3);
  ok(log.includes('windup'), 'charger finds a clear line and charges');
}
{
  en = new Enemies(scene);
  const { ctx } = makeCtx({ x: 0, z: 0 });
  const s = en.spawn(ENEMIES.shielder, 0, 8, { instant: true });
  s.facing = Math.PI; // facing -Z, toward you
  const b = en.spawn(ENEMIES.bopper, 0, 9.5, { instant: true });
  run(ctx, 0.3);
  ok(b.guardT > 0 && (b.aiBits & 4) !== 0, 'ally behind a Shield Bot is guarded');
}
{
  en = new Enemies(scene);
  const { ctx, log } = makeCtx({ x: 0, z: 0 });
  en.spawn(ENEMIES.medic, 10, 0, { instant: true });
  run(ctx, 6);
  ok(log.includes('heal'), 'medic pulses heals');
  en = new Enemies(scene);
  const m = makeCtx({ x: 0, z: 0 });
  en.spawn(ENEMIES.mortar, 12, 0, { instant: true });
  run(m.ctx, 6);
  ok(m.log.filter((x) => x === 'strike').length >= 3, 'mortar lobs telegraphed shells');
}
{
  en = new Enemies(scene);
  const { ctx, log } = makeCtx({ x: 0, z: 0 });
  const leader = en.spawn(ENEMIES.shooter, 30, 0, { instant: true, elite: true });
  const ms: Enemy[] = [];
  for (let i = 0; i < 3; i++) {
    const m = en.spawn(ENEMIES.bopper, 32 + i, 2, { instant: true });
    m.leader = leader;
    m.leaderUid = leader.uid;
    m.slot = i;
    ms.push(m);
  }
  run(ctx, 2);
  const spread = Math.max(...ms.map((m) => Math.hypot(m.x - leader.x, m.z - leader.z)));
  ok(spread < 6, 'escorts keep formation near their elite (' + spread.toFixed(1) + ' m)');
  ok(ms.every((m) => m.aiBits & 1), 'escorts flagged as squad');
  run(ctx, 6);
  ok(log.includes('rally'), 'elite rallies its squad');
  en.kill(leader);
  run(ctx, 0.1);
  ok(ms.every((m) => m.leader === null && m.scatterT > 0), 'squad scatters when the elite dies');
}
