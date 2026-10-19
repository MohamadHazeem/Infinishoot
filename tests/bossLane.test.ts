/**
 * Bosses lane (wave 1): boss rematches, the Titan and the boss duel.
 * Pure rotation/geometry/ring math, remixed brains with a fake world, then a
 * host Game and a client Game wired together in-process (jsdom, no WebGL):
 * the Titan's walls, weak points and phases on both, and the duel ring.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop),
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, { get: (_t, k) => (k === 'createImageData' || k === 'getImageData' ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) }) : k === 'canvas' ? this : noop[k as never]) });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent']) {
  try { (globalThis as any)[k] = (dom.window as any)[k]; } catch { Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true }); }
}
(globalThis as any).Path2D = (dom.window as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'test';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});

const { ENEMIES, BOSS_ORDER, bossForStage } = await import('../src/data/enemies');
const R = await import('../src/data/bossRemix');
const TI = await import('../src/game/titan');
const DU = await import('../src/game/bossDuel');
const { Enemy } = await import('../src/game/enemies');
const { StaticBoxGrid } = await import('../src/core/spatialHash');
const { startPhase, updateBoss } = await import('../src/game/bosses');
const { bossLike } = await import('../src/game/bossRules');

// ---------------------------------------------------------------- rotation
{
  const none = new Set<string>();
  const all = new Set(['king', 'rex', 'queen']);
  const at = (s: number, beaten = all) => R.stageBossId(s, bossForStage(s).id, beaten);
  ok([1, 2, 3, 4].map((s) => at(s)).join() === 'king,rex,queen,omega', 'loop 1 is the regular rotation, even after beating them');
  ok(at(5) === 'glitch' && at(6) === 'boxer' && at(7) === 'gale' && at(8) === 'omega', `loop 2: the biome bosses keep their stages, then Omega (${[5, 6, 7, 8].map((s) => at(s))})`); // bosses3 lane
  ok(at(9) === 'king_ex' && at(10) === 'rex_inferno' && at(11) === 'titan' && at(12) === 'omega', 'loop 3: the Titan moves to the Queen slot, Rex comes back as Inferno');
  ok(at(13) === 'glitch' && at(16) === 'omega', 'loop 4: Neon City keeps its DJ over the Titan; Omega always ends the loop'); // bosses3 lane
  ok(at(9, none) === 'king' && at(10, none) === 'rex', 'a boss you never beat this run comes back as itself');
  ok(R.stageBossId(1, 'king', none, { remix: true }) === 'king_ex' && R.stageBossId(2, 'rex', none, { titan: true }) === 'titan' && R.stageBossId(4, 'omega', none, { titan: true }) === 'omega', 'test-link forcing (never over Omega)');
  ok(R.remixBase('rex_inferno') === 'rex' && R.remixBase('king') === 'king', 'remix base ids');
}

// ---------------------------------------------------------------- remix defs
for (const r of R.BOSS_REMIXES) {
  const d = ENEMIES[r.id];
  const o = ENEMIES[r.of];
  ok(!!d && d.boss === true && d.remixOf === r.of && d.behavior === o.behavior && d.model === o.model, `${r.id} is a boss on ${r.of}'s brain and model`);
  ok(d.bodyColor !== o.bodyColor && d.name !== o.name && !!d.title && d.hp > o.hp && JSON.stringify(d.phases) === JSON.stringify(o.phases), `${r.id}: new palette, name and title, tougher, same phases`);
  ok(d.material === o.material, `${r.id} sounds like ${r.of} when hit`);
}
ok(BOSS_ORDER.every((id) => !ENEMIES[id].remix), 'originals carry no remix flags');
ok(Object.keys(ENEMIES).length <= 256, `enemy kinds still fit a byte (${Object.keys(ENEMIES).length})`);

// Remixed brains with a fake world.
function run(id: string, phase: number, seconds: number): Record<string, number> {
  const calls: Record<string, number> = {};
  const count = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  const hero = { x: 6, z: 2, radius: 0.5, alive: true };
  const ctx: any = {
    targets: [hero],
    target: hero,
    targetAlive: true,
    hash: null,
    colliders: [],
    walls: new StaticBoxGrid([]),
    onWindup: () => count('windup'),
    onEnrage: () => {},
    fireBullet: () => count('bullet'),
    spawnChild: (cid: string) => count('child:' + cid),
    detonate: () => {},
    slam: () => count('slam'),
    strike: () => count('strike'),
    boss: { shockwave: () => count('shockwave'), rampage: () => count('rampage'), firePatch: () => count('fire'), shot: () => count('shot'), plantHive: () => (count('hive'), true), hiveCount: () => 0, swarmWall: () => count('wall'), open: () => true },
  };
  const e = new Enemy(ENEMIES[id]);
  e.reset(0, 0, { instant: true });
  e.state = 'move';
  if (phase > 1) startPhase(e, phase);
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    const dx = hero.x - e.x;
    const dz = hero.z - e.z;
    const d = Math.hypot(dx, dz) || 1;
    e.t -= dt;
    updateBoss(e, dt, ctx, dx / d, dz / d, d, e.def.speed);
    e.x += e.vx * dt;
    e.z += e.vz * dt;
  }
  return calls;
}
{
  const ex = run('king_ex', 1, 25);
  const k = run('king', 1, 25);
  ok((ex.shockwave ?? 0) > 0 && (k.shockwave ?? 0) === 0, `King EX sends shockwaves from phase 1 (${ex.shockwave})`);
  ok((ex.bullet ?? 0) > (k.bullet ?? 0), `King EX landings fire bullet rings (${ex.bullet} vs ${k.bullet} bullets)`);
  const ex3 = run('king_ex', 3, 30);
  ok((ex3['child:v_bopper'] ?? 0) > 0 && !ex3['child:bopper'], 'King EX summons veteran guards');
  const inf = run('rex_inferno', 2, 25);
  const rex = run('rex', 2, 25);
  ok((inf.shot ?? 0) > 20 && (rex.shot ?? 0) === 0, `Rex: Inferno breathes fire from phase 2 (${inf.shot} flames)`);
  const night = run('queen_night', 2, 25);
  const q = run('queen', 2, 25);
  ok((night.wall ?? 0) > 0 && (q.wall ?? 0) === 0, `Nightshade sends swarm walls from phase 2 (${night.wall})`);
  ok((night['child:v_zippy'] ?? 0) > 0 && !night['child:zippy'], 'Nightshade summons veteran Zippies');
}

// ---------------------------------------------------------------- Titan geometry
{
  const ticks = R.titanTicks();
  ok(JSON.stringify(ticks) === JSON.stringify(ENEMIES.titan.phases) && ticks.length === 3 && ticks.every((t, i) => i === 0 || t < ticks[i - 1]), `boss-bar ticks follow the weak points (${ticks})`);
  ok(Math.abs(R.TITAN_PARTS.reduce((a, p) => a + p.share, 0) + R.TITAN_CORE_SHARE - 1) < 1e-9 && R.TITAN_PARTS.length === 5, 'five weak points plus the core share the Titan’s life');
  ok(['titan', 'titan_plate', 'titan_hand', 'titan_eye'].every((id) => ENEMIES[id].hidden), 'the Titan draws itself (hidden from the instancer)');
  const part = new Enemy(ENEMIES.titan_eye);
  ok(bossLike(part), 'weak points follow boss rules (Nuke, recycling, freezes)');
  ok(TI.titanPhaseOf([true, true, true, true, true]) === 1 && TI.titanPhaseOf([false, true, true, true, true]) === 1 && TI.titanPhaseOf([false, false, true, false, true]) === 2 && TI.titanPhaseOf([false, false, false, false, true]) === 3 && TI.titanPhaseOf([false, false, false, false, false]) === 4, 'phases open group by group');
  const boxes = TI.titanBoxes(10, -20, true);
  ok(boxes.length === 2 && TI.titanBoxes(10, -20, false).length === 1, 'torso and head are walls; the head goes in phase 4');
  const P = { x: 0, z: 0 };
  TI.partPos(2, 0, 0, [TI.restAngle(-1), TI.restAngle(1)], P);
  ok(Math.abs(Math.hypot(P.x + TI.titanLayout.shoulder.x, P.z - TI.titanLayout.shoulder.z) - TI.titanLayout.arm) < 1e-9 && P.x < -15 && P.z > 4, `the left hand core lies at the end of its arm (${P.x.toFixed(1)}, ${P.z.toFixed(1)})`);
  const g = new StaticBoxGrid(boxes);
  let reachable = true;
  for (let i = 0; i < 5; i++) {
    TI.partPos(i, 10, -20, [TI.restAngle(-1), TI.restAngle(1)], P);
    const r = ENEMIES[['titan_plate', 'titan_plate', 'titan_hand', 'titan_hand', 'titan_eye'][i]].radius;
    // Each weak point sticks out of the walls toward the camera side, so shots reach it.
    if (g.hitCircle(P.x, P.z + r * 0.75, 0.2)) reachable = false;
  }
  ok(reachable, 'every weak point sticks out of the body walls');
  ok(Math.abs(TI.sweepEnd(1) - TI.restAngle(1) - TI.titanTuning.sweepArc) < 1e-9 && TI.sweepEnd(-1) < TI.restAngle(-1), 'arms sweep inward across the front');
  // Sweep pose: winds up, hurts only while swinging low, comes back raised.
  const pose = { k: 0, lift: 0, hurt: false, tele: 0 };
  let hurtEarly = false;
  let hurtAny = false;
  let maxK = 0;
  let doneAt = -1;
  for (let t = 0; t < 8; t += 1 / 60) {
    const done = TI.sweepPose(t, pose);
    if (pose.hurt && t < TI.titanTuning.sweepTele) hurtEarly = true;
    if (pose.hurt) hurtAny = true;
    if (pose.hurt && pose.lift > 0.5) hurtEarly = true;
    maxK = Math.max(maxK, pose.k);
    if (done && doneAt < 0) doneAt = t;
  }
  ok(!hurtEarly && hurtAny && Math.abs(maxK - 1) < 1e-6, 'a sweep only hurts while the arm swings low');
  ok(Math.abs(doneAt - TI.sweepLength()) < 0.05, `a sweep ends after ${TI.sweepLength().toFixed(2)} s`);
  ok(Math.abs(TI.segDist(0, 1, -1, 0, 1, 0) - 1) < 1e-9 && Math.abs(TI.segDist(3, 0, -1, 0, 1, 0) - 2) < 1e-9, 'segment distance');
  // Net round trip.
  const s = new TI.TitanState();
  s.uid = 7;
  s.cx = 3.3;
  s.phase = 3;
  s.arm[1] = 1.2345;
  s.sweepT[0] = 0.5;
  s.partHp = [0, 0, 0.5, 0, 1];
  const m = new TI.TitanState();
  TI.unpackTitan(JSON.parse(JSON.stringify(TI.packTitan(s))), m);
  ok(m.uid === 7 && m.cx === 3.3 && m.phase === 3 && Math.abs(m.arm[1] - 1.2345) < 1e-3 && m.sweepT[0] === 0.5 && m.partHp[2] === 0.5 && TI.sweeping(m.sweepT[0]) && !TI.sweeping(m.sweepT[1]), 'Titan net state round trip');
}

// ---------------------------------------------------------------- duel ring
{
  const T = DU.duelTuning;
  ok(DU.duelRadius(25, 9, 0) === 25 && DU.duelRadius(25, 9, T.delay) === 25 && Math.abs(DU.duelRadius(25, 9, T.delay + T.shrink) - 9) < 1e-9 && DU.duelRadius(25, 9, 999) === 9, 'the ring waits, closes, then holds');
  const st = DU.duelStart({ x: 10, z: 0, radius: 2 }, [{ x: -10, z: 0 }, { x: 0, z: 14 }], 55);
  ok(Math.hypot(-10 - st.x, 0 - st.z) < st.r0 && Math.hypot(0 - st.x, 14 - st.z) < st.r0 && Math.hypot(10 - st.x, -st.z) + 2 < st.r0, `the ring starts around everyone (r0 ${st.r0.toFixed(1)})`);
  ok(st.r1 >= T.rMin && st.r0 <= T.rMax, 'ring sizes are bounded');
  const edge = DU.duelStart({ x: 54, z: 54, radius: 2 }, [{ x: 54, z: 50 }], 55);
  ok(edge.x + edge.r1 <= 55 && edge.z + edge.r1 <= 55, 'the final ring stays inside the arena');
  const p = { x: 30, z: 0 };
  ok(DU.keepInside(p, 2, 0, 0, 10) && Math.abs(p.x - 8) < 1e-9, 'the boss is held inside the ring');
  ok(!DU.keepInside({ x: 1, z: 1 }, 2, 0, 0, 10), 'inside stays put');
  const d = DU.unpackDuel(JSON.parse(JSON.stringify(DU.packDuel({ uid: 3, x: 1.234, z: -2, r: 20, r0: 25, r1: 9, t: 1.5 }))));
  ok(d.uid === 3 && d.x === 1.23 && d.r0 === 25 && d.t === 1.5, 'duel net round trip');
}

// ---------------------------------------------------------------- in a real game: host + client
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { unlockedWeapons } = await import('../src/game/save');
const { settings } = await import('../src/game/settings');
const L = await import('../src/game/systems/bossLane');

cheats.god = true;
settings.bossIntros = false;
settings.finishers = false;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const A = mk();
const B = mk();
const q: [any, any][] = [];
(A as any).role = 'host';
(A as any).host = { send: (_id: string, m: any) => q.push([B, m]), broadcast: (m: any) => q.push([B, m]), close() {} };
(B as any).role = 'client';
(B as any).client = { send: (m: any) => q.push([A, m]), close() {} };
const flush = () => {
  while (q.length) {
    const [g, m] = q.shift()!;
    if (g === A) A.onHostMessage('peerB', structuredClone(m));
    else B.onClientMessage(structuredClone(m));
  }
};
A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons()), A.makeHero(1, 'Guest', [], 'peerB')]);
A.startRun();
flush();
if (A.mode === 'shop') A.closeShop();
flush();
A.xpNext = B.xpNext = 1e12; // no level-up menus in the way
const step = (n: number) => {
  for (let i = 0; i < n; i++) {
    A.update(1 / 60);
    flush();
    B.update(1 / 60);
    flush();
    if (A.mode === 'levelup') for (const h of A.heroes) if (h.offers.length) A.heroAction(h, 'pick', 0, 1);
  }
};

L.bossLaneForce.titan = true;
A.debugBoss({ now: true });
step(10);
L.bossLaneForce.titan = false;
const dA = () => L.titanDebug.call(A);
const dB = () => L.titanDebug.call(B);
ok(A.boss?.def.id === 'titan' && !!dA().titan && dA().parts.length === 5, 'the Titan spawns as the stage boss with five weak points');
const before = A.arena.colliders.length;
step(Math.ceil(TI.titanTuning.rise * 60) + 30);
ok(dA().titan!.rise === 1 && dA().walls === 2 && A.arena.colliders.length >= before + 2, 'once risen its torso and head are walls on the host');
ok(dB().titan?.uid === dA().titan!.uid && dB().walls === 2, 'the client mirrors the Titan and blocks its own movement with the same walls');
const parts = dA().parts;
ok(parts[0]!.alive && parts[1]!.alive && !parts[2]!.alive && !parts[4]!.alive && !A.boss!.alive, 'only the armour plates can be hit at first (the rest is sealed)');
const hp0 = A.boss!.hp;
const kill = (e: any) => A.damage(e, 1e9, { source: 'buster' }, A.heroes[0]);
kill(parts[0]);
step(15);
ok(A.boss!.hp < hp0 && dA().titan!.phase === 1 && dA().titan!.partHp[0] === 0, 'a broken plate takes its share off the boss bar');
kill(parts[1]);
step(15);
ok(dA().titan!.phase === 2 && parts[2]!.alive && parts[3]!.alive && !parts[4]!.alive, 'both plates down: phase 2, the hand cores open');
step(30);
ok(dB().titan?.phase === 2, 'the client sees phase 2');
// Hands ride the arms: they move when an arm sweeps.
L.bossLaneForce.move = 'sweep2';
let moved = false;
const hx = [parts[2]!.x, parts[3]!.x];
for (let i = 0; i < 400 && !moved; i++) {
  step(1);
  moved = Math.abs(parts[2]!.x - hx[0]) > 1 || Math.abs(parts[3]!.x - hx[1]) > 1;
}
L.bossLaneForce.move = '';
ok(moved, 'hand cores ride along when the arms sweep');
kill(parts[2]);
kill(parts[3]);
step(15);
ok(dA().titan!.phase === 3 && parts[4]!.alive && !A.boss!.alive, 'hands down: phase 3, the eye opens');
kill(parts[4]);
step(15);
ok(dA().titan!.phase === 4 && A.boss!.alive && dA().walls === 1, 'eye down: the head opens (its wall goes) and the core can be hit');
const core = A.boss!;
ok(core.hp / core.maxHp <= R.TITAN_CORE_SHARE + 1e-3 && core.hp / core.maxHp > R.TITAN_CORE_SHARE - 0.05, `the core holds the last ${Math.round(R.TITAN_CORE_SHARE * 100)}% of the bar (${(core.hp / core.maxHp).toFixed(3)})`);
step(30);
ok(dB().walls === 1 && dB().titan?.phase === 4, 'the client drops the head wall too');
// Mid-fight the bar shows weak points.
const bar = A.bossHud({ name: 'Titan Goliath', hp01: 0.3 });
ok(!!bar && bar.phase === 4 && /CORE EXPOSED/.test(bar.name) && bar.ticks?.length === 3, `the boss bar says what's left (${bar?.name})`);
kill(core);
step(20);
ok(A.mode === 'cleared' && !dA().titan && dA().walls === 0, 'the core falls: the stage clears and the body stops blocking');
step(30);
ok(!dB().titan && dB().walls === 0, 'the client drops the Titan too');
ok(L.bossesBeaten.call(A).has('king'), 'the stage boss counts as beaten this run');

// ---------------------------------------------------------------- the duel (host + client)
A.loadStage(2);
flush();
step(5);
A.debugBoss({ now: true });
step(10);
const boss = A.boss!;
ok(boss?.def.id === 'rex', `stage 2 has its rotation boss (${boss?.def.id})`);
for (let i = 0; i < 30; i++) A.enemies.spawn(ENEMIES.swarmer, boss.x + 8 + (i % 6), boss.z + Math.floor(i / 6), A.spawnOpts());
A.bossField.debugPhase = 3; // its last phase
let started = false;
for (let i = 0; i < 600 && !started; i++) {
  step(1);
  started = !!A.bossDuel;
}
ok(started && boss.phase === 3, 'the boss’s last phase starts the duel');
const others = A.enemies.list.filter((e) => e.active && e !== boss && !bossLike(e) && e.def.id !== 'hive').length;
ok(others === 0 && A.director.hold, `the horde clears out and the director holds (${others} left)`);
step(30);
ok(!!B.bossDuel && B.bossDuel.uid === boss.uid && Math.abs(B.bossDuel.r - A.bossDuel!.r) < 1.5, 'the client gets game.bossDuel');
const r0 = A.bossDuel!.r0;
step(Math.ceil((DU.duelTuning.delay + DU.duelTuning.shrink) * 60) + 30);
ok(!!A.bossDuel && Math.abs(A.bossDuel.r - A.bossDuel.r1) < 1e-6 && A.bossDuel.r < r0, 'the ring closes to its final size');
const d = A.bossDuel!;
ok(Math.hypot(boss.x - d.x, boss.z - d.z) <= d.r - boss.radius + 0.5, 'the boss stays inside the ring');
A.spawnEnemy(ENEMIES.bopper, true); // a stage event's elite (Elite Parade) can't join either
A.spawnRing(ENEMIES.swarmer, 20);
const late = A.enemies.list.filter((e) => e.active && e !== boss && !bossLike(e));
ok(late.length === 0, `no new horde spawns during the duel (${late.map((e) => e.def.id)})`);
// Outside the ring you burn.
cheats.god = false;
const h = A.heroes[0];
h.player.invuln = 0;
h.player.pos.x = h.player.prev.x = d.x + d.r + 6;
h.player.pos.z = h.player.prev.z = d.z;
const life = h.player.hp;
for (let i = 0; i < 40; i++) {
  h.player.pos.x = d.x + d.r + 6;
  h.player.pos.z = d.z;
  A.update(1 / 60);
  flush();
}
ok(h.player.hp < life, `standing outside the ring burns (${life} -> ${Math.round(h.player.hp)})`);
cheats.god = true;
A.damage(boss, 1e9, { source: 'buster' }, A.heroes[0]);
step(20);
ok(!A.bossDuel && !A.director.hold, 'the duel ends with the boss');
step(30);
ok(!B.bossDuel, 'and on the client');
