/**
 * Coopplay lane, co-op: a host Game and a client Game wired together in-process
 * (jsdom, no WebGL). The co-op objectives (vault, escort, zones, bomb), carrying
 * a downed teammate (host- and client-initiated), the buddy tether and its bonus,
 * banter cues, and that the client mirrors all of it through the snapshot (`cy`).
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window as unknown as Record<string, unknown>;
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
(globalThis as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'smoke';
(dom.window as any).Path2D = (globalThis as any).Path2D;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});
const errors: string[] = [];
process.on('uncaughtException', (e) => errors.push('uncaught ' + e.stack));

const { Input } = await import('../src/core/input');
const { Game, cheats, REVIVE_TIME } = await import('../src/game/game');
const { unlockedWeapons } = await import('../src/game/save');
const { ENEMIES } = await import('../src/data/enemies');
const { PickupType } = await import('../src/game/pickups');
const CP = await import('../src/game/systems/coopplay');
const { coopObjTuning, tetherTuning } = await import('../src/game/coopplay');
const { playVoiceCue } = await import('../src/audio/voices');
cheats.god = true;
// Seeded randomness so the run (and the arena) is the same every time.
let seed = 12345;
Math.random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);

const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const A = mk();
const B = mk();
const q: [any, any][] = [];
(A as any).role = 'host';
(A as any).host = { send: (_id: string, m: any) => q.push([B, m]), broadcast: (m: any) => q.push([B, m]), close() {} };
(B as any).role = 'client';
(B as any).client = { send: (m: any) => q.push([A, m]), close() {} };
const flush = () => { while (q.length) { const [g, m] = q.shift()!; if (g === A) A.onHostMessage('peerB', structuredClone(m)); else B.onClientMessage(structuredClone(m)); } };
A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons()), A.makeHero(1, 'Guest', [], 'peerB')]);
A.startRun();
flush();
if (A.mode === 'shop') A.closeShop();
flush();
A.xpNext = 1e12; // no level-up menus
/** Calm: no enemies (the director keeps spawning), so the objective tests are about the objective. */
let calm = true;
const step = (n: number) => {
  for (let i = 0; i < n; i++) {
    A.xpNext = 1e12;
    if (calm) clearEnemies();
    // Objective chests open level-up cards: pick the first for everyone so the world keeps going.
    if (A.mode === 'levelup') for (const h of A.heroes) if (h.needsPick) A.heroAction(h, 'pick', 0, 1);
    A.update(1 / 60);
    flush();
    B.update(1 / 60);
    flush();
  }
};
step(20);
console.log('modes', A.mode, B.mode, 'objective', A.toys.objective.kind, B.toys.objective.kind);
const SA = CP.coopPlayState(A);
const SB = CP.coopPlayState(B);
const hA = A.heroes[0];
const gA = A.heroes[1]; // the guest's hero on the host
const gB = B.hero; // the guest's own hero
const hB = B.heroes[0];
const sounds: string[] = [];
const sound = A.vfx.sound.bind(A.vfx);
A.vfx.sound = (name: string, x: number, z: number, p = 1) => { sounds.push(name); sound(name, x, z, p); };
function clearEnemies(): void {
  for (const e of A.enemies.list) if (e.active && !e.def.boss) A.enemies.kill(e);
}
const guestTo = (x: number, z: number) => gB.player.teleport(x, z);
const hostTo = (x: number, z: number) => hA.player.teleport(x, z);

// ---------------------------------------------------------------- the roll in co-op
{
  // Whatever this stage rolled, the client agrees on the kind.
  ok(A.toys.objective.kind === B.toys.objective.kind, `client agrees on the stage objective (${A.toys.objective.kind})`);
}

// ---------------------------------------------------------------- two-switch vault
{
  clearEnemies();
  ok(CP.forceCoopObjective(A, 'door'), 'host places a two-switch vault');
  step(10);
  const L = SA.lay!;
  ok(B.toys.objective.kind === 'door' && !!SB.lay && Math.abs(SB.lay.v.x - L.v.x) < 0.11 && Math.abs(SB.lay.a.z - L.a.z) < 0.11, 'client builds the same vault and switches');
  ok(!!SB.box && B.arena.colliders.includes(SB.box) && A.arena.colliders.includes(SA.box!), 'the vault is solid on both machines');
  ok(B.walls.hitCircle(L.v.x, L.v.z, 0.3), 'client collision sees the vault');
  hostTo(L.a.x, L.a.z);
  step(90);
  ok(A.toys.objective.cur === 1 && A.toys.objective.active && SA.held[0] && !SA.held[1], 'one hero on one switch: 1/2, stays shut');
  ok(B.toys.objective.cur === 1 && SB.held[0], 'client sees 1/2');
  guestTo(L.b.x, L.b.z);
  const chestsBefore = countChests(A);
  step(30);
  ok(A.toys.objective.charging && A.toys.objective.active, 'both switches held: charging');
  step(70);
  ok(A.toys.objective.state === 'done' && SA.open, 'held 1.2 s together: the vault opens');
  ok(countChests(A) - chestsBefore >= 2, `a chest per hero (+${countChests(A) - chestsBefore})`);
  step(10);
  ok(B.toys.objective.state === 'done' && SB.open, 'client sees the vault open');
}

// ---------------------------------------------------------------- escort the core
{
  clearEnemies();
  ok(CP.forceCoopObjective(A, 'escort'), 'host places an escort');
  step(5);
  const L = SA.lay!;
  // Nobody near: it waits.
  hostTo(L.a.x + 15, L.a.z + 15);
  guestTo(L.a.x + 16, L.a.z + 15);
  step(60);
  ok(Math.hypot(SA.core.x - L.a.x, SA.core.z - L.a.z) < 0.01 && !A.toys.objective.charging, 'no hero near: the core waits');
  hostTo(SA.core.x + 2, SA.core.z);
  step(120);
  const moved = Math.hypot(SA.core.x - L.a.x, SA.core.z - L.a.z);
  ok(moved > 2 && moved < coopObjTuning.escortSpeed * 2.4, `a hero near: it rolls at walking pace (${moved.toFixed(2)} m in 2 s)`);
  step(6);
  ok(Math.hypot(SB.core.x - SA.core.x, SB.core.z - SA.core.z) < 0.3 && B.toys.objective.cur > 0, 'client mirrors the core and the progress');
  // Enemies go for it and chew on it.
  ok(A.targets.some((t) => t.radius === 0.9 && Math.hypot(t.x - SA.core.x, t.z - SA.core.z) < 0.2), 'the core is an enemy target');
  calm = false;
  for (let i = 0; i < 4; i++) A.enemies.spawn(ENEMIES.swarmer, SA.core.x + Math.cos(i) * 1.1, SA.core.z + Math.sin(i) * 1.1, A.spawnOpts());
  const hp0 = SA.core.hp;
  step(60);
  calm = true;
  ok(SA.core.hp < hp0 - 3 && A.toys.objective.attacked, `enemies on it drain it (${hp0} -> ${SA.core.hp.toFixed(1)})`);
  ok(Math.abs(B.toys.objective.hp - SA.core.hp) < 3, 'client sees the core life');
  clearEnemies();
  // Roll it to the beacon.
  SA.core.x = L.b.x + 1;
  SA.core.z = L.b.z;
  hostTo(L.b.x + 2, L.b.z);
  step(30);
  ok(A.toys.objective.state === 'done', 'the core reached the beacon: done');
  step(5);
  ok(B.toys.objective.state === 'done', 'client sees it done');
  // Failure: destroyed.
  CP.forceCoopObjective(A, 'escort');
  step(3);
  SA.core.hp = 0.5;
  calm = false;
  for (let i = 0; i < 3; i++) A.enemies.spawn(ENEMIES.swarmer, SA.core.x + 0.5, SA.core.z + i * 0.3, A.spawnOpts());
  step(150);
  calm = true;
  ok(A.toys.objective.state === 'failed', 'the core can be destroyed: failed');
  clearEnemies();
}

// ---------------------------------------------------------------- hold two zones
{
  ok(CP.forceCoopObjective(A, 'zones'), 'host places two zones');
  step(3);
  const L = SA.lay!;
  hostTo(L.a.x, L.a.z);
  guestTo(L.a.x + 1, L.a.z);
  step(120);
  ok(A.toys.objective.cur === 0 && !A.toys.objective.charging, 'both heroes in one zone: no progress');
  guestTo(L.b.x, L.b.z);
  step(180);
  const c = A.toys.objective.cur;
  ok(c > 2.5 && c < 3.5 && A.toys.objective.charging, `one in each: charging (${c.toFixed(2)} s after 3 s)`);
  ok(Math.abs(B.toys.objective.cur - c) < 0.5 && SB.held[0] && SB.held[1], 'client mirrors the zones');
  A.toys.objective.cur = coopObjTuning.zoneTime - 0.2;
  step(30);
  ok(A.toys.objective.state === 'done', 'zones held long enough: done');
}

// ---------------------------------------------------------------- carry the bomb
{
  clearEnemies();
  ok(CP.forceCoopObjective(A, 'bomb'), 'host places a bomb and a bunker');
  const L = SA.lay!;
  // Step the host off the bomb before the world ticks: layouts are seeded per arena and
  // stage (layoutCoop takes the first fitting spawn spot), so the bomb can land on the
  // zones' first zone, where the host is still standing from the block above, and the
  // host would pick it up on the first tick. Which spots coincide depends on the arena
  // the seeded run rolls, so it changed when other lanes' arena/RNG changes merged.
  hostTo(L.a.x + 12, L.a.z + 12);
  guestTo(L.a.x - 12, L.a.z - 12);
  step(3);
  ok(SA.bomb.by < 0, 'nobody holds the bomb yet');
  guestTo(SA.bomb.x, SA.bomb.z);
  step(20);
  ok(SA.bomb.by === 1 && SB.bomb.by === 1, 'the guest walks over the bomb and picks it up (both machines)');
  // The carrier is slow (the client moves its own hero).
  const p = gB.player;
  p.prev.x = p.pos.x;
  p.prev.z = p.pos.z;
  p.pos.x += 1;
  CP.coopPlayLocal(B);
  ok(Math.abs(p.pos.x - p.prev.x - coopObjTuning.bombSpeed) < 1e-6, `bomb carrier moves at ${coopObjTuning.bombSpeed * 100}%`);
  const hasBox = B.arena.colliders.includes(SB.box!);
  guestTo(L.v.x, L.v.z + 2.4);
  step(20);
  ok(SA.bomb.fuse > 0 && SA.bomb.by < 0, 'at the bunker the bomb is planted');
  step(Math.ceil(coopObjTuning.bombFuse * 60) + 10);
  ok(A.toys.objective.state === 'done' && SA.open && !A.arena.colliders.includes(SA.box!), 'the fuse runs out: the bunker blows open');
  step(5);
  ok(hasBox && !B.arena.colliders.includes(SB.box!) && B.toys.objective.state === 'done', 'client: bunker collider gone, objective done');
  ok(sounds.some((n) => n === 'v:s:carry_lift'), 'picking it up plays carry_lift');
  clearEnemies();
}

// ---------------------------------------------------------------- carrying a downed teammate
{
  clearEnemies();
  const down = (h: any) => {
    h.revivesLeft = 0;
    h.phoenixUsed = true;
    h.petState.reviveUsed = true;
    h.player.hp = 0;
    h.player.dead = true;
    A.onHeroDown(h);
  };
  hostTo(0, 0);
  guestTo(1, 0);
  step(5);
  down(gA);
  step(5);
  ok(gA.player.dead && gB.player.dead, 'guest is down on both machines');
  hostTo(gA.player.x + 1, gA.player.z);
  step(2);
  ok(CP.toggleCarry(A, SA, hA) && SA.carriedBy[1] === 0, 'host picks the downed guest up');
  step(5);
  ok(SB.carriedBy[1] === 0, 'client knows it is being carried');
  const t0 = gA.reviveT;
  // Walk away with them: they ride along and nobody revives them on the way.
  for (let i = 0; i < 90; i++) {
    hA.player.teleport(hA.player.x + 0.1, hA.player.z);
    step(1);
  }
  ok(Math.hypot(gA.player.x - hA.player.x, gA.player.z - hA.player.z) < 0.01, 'the carried hero rides on the carrier (host)');
  ok(Math.hypot(gB.player.x - hB.player.x, gB.player.z - hB.player.z) < 1.2, `...and on the client (${Math.hypot(gB.player.x - hB.player.x, gB.player.z - hB.player.z).toFixed(2)} m)`);
  ok(gA.reviveT <= t0 + 1e-6, 'no revive while carried');
  // The carrier is slowed (host moves its own hero).
  const p = hA.player;
  p.prev.x = p.pos.x;
  p.pos.x += 1;
  CP.coopPlayStep(A, 1 / 60);
  ok(Math.abs(p.pos.x - p.prev.x - 0.6) < 1e-6, 'carrier moves at 60%');
  // Put down, then the usual revive.
  ok(CP.toggleCarry(A, SA, hA) && SA.carriedBy[1] === -1, 'put down');
  sounds.length = 0;
  step(Math.ceil(REVIVE_TIME * 60) + 30);
  ok(!gA.player.dead && !gB.player.dead, 'revived after being put down');
  ok(sounds.includes('v:t:rookie:thanks') || sounds.some((n) => n.startsWith('v:t:') && n.endsWith(':thanks')), 'the revived hero says thanks (banter cue)');
  // Client-initiated: the guest carries the downed host.
  down(hA);
  guestTo(hA.player.x + 1, hA.player.z);
  step(4);
  B.client!.send({ t: 'carry' });
  step(4);
  ok(SA.carriedBy[0] === 1 && SB.carriedBy[0] === 1, 'the guest presses INTERACT next to the downed host: carried');
  for (let i = 0; i < 40; i++) {
    gB.player.teleport(gB.player.x + 0.1, gB.player.z);
    step(1);
  }
  step(10);
  const dHost = Math.hypot(hA.player.x - gA.player.x, hA.player.z - gA.player.z);
  const dClient = Math.hypot(hB.player.x - gB.player.x, hB.player.z - gB.player.z);
  ok(dHost < 0.6 && dClient < 1.2, `the carried host rides with the guest (host ${dHost.toFixed(2)} m, client ${dClient.toFixed(2)} m)`);
  // The carrier drops out (disconnect): the downed host is put down where they were.
  gA.left = true;
  step(30); // past the hit-stop of the host going down
  ok(SA.carriedBy[0] === -1 && hA.player.dead, 'a carrier who drops out puts their teammate down');
  gA.left = false;
  A.reviveHero(hA, 1);
  A.reviveHero(gA, 1);
  step(10);
}

// ---------------------------------------------------------------- buddy tether
{
  clearEnemies();
  hostTo(0, 0);
  guestTo(4, 0);
  step(10);
  const base = (() => {
    const t = SA.link[0];
    SA.link[0] = 0;
    hA.refreshLive();
    const v = hA.stats.damageMul;
    SA.link[0] = t;
    return v;
  })();
  step(Math.ceil(tetherTuning.ramp * 60));
  ok(SA.pairs === 1 && SA.link[0] >= tetherTuning.ramp - 0.5 && SA.link[1] >= tetherTuning.ramp - 0.5, `heroes 4 m apart are linked (${SA.link[0].toFixed(1)} s)`);
  ok(Math.abs(hA.stats.damageMul - base - tetherTuning.damage) < 0.005, `full link: +${(tetherTuning.damage * 100).toFixed(0)}% damage (${base.toFixed(3)} -> ${hA.stats.damageMul.toFixed(3)})`);
  ok(hA.stats.regen >= tetherTuning.regen, 'full link: regen bonus');
  ok(SB.pairs === 1 && Math.abs(SB.link[1] - SA.link[1]) < 1.2, 'client sees the link (whole seconds)');
  sounds.length = 0;
  guestTo(20, 0);
  step(10);
  ok(SA.pairs === 0 && sounds.includes('shieldBreak'), 'pulling apart snaps the link (snap effect)');
  step(Math.ceil((tetherTuning.ramp * 2) / tetherTuning.decay * 60) + 10);
  ok(SA.link[0] === 0 && SA.link[1] === 0, 'link time drains when apart');
}

// ---------------------------------------------------------------- banter on kills
{
  sounds.length = 0;
  hostTo(0, 0);
  guestTo(3, 0);
  step(400); // let earlier banter cool down
  const e = A.enemies.spawn(ENEMIES.bopper, 1.5, 6, A.spawnOpts());
  e.elite = true;
  A.killEnemy(e, 'buster', hA);
  ok(sounds.some((n) => /^v:t:[a-z]+:greatshot$/.test(n)), 'an elite kill: a teammate shouts "Great shot!"');
  ok(playVoiceCue('v:t:ace:thanks', 1, 0, 1) && playVoiceCue('v:s:carry_lift', 1, 0, 1) && !playVoiceCue('v:s:nope', 1, 0, 1), 'voice module handles banter and co-op samples');
}

// ---------------------------------------------------------------- the bomb on a boss (last: the boss stays up)
{
  // On a boss instead.
  CP.forceCoopObjective(A, 'bomb');
  step(3);
  A.debugBoss({ now: true });
  step(10);
  const boss = A.boss!;
  ok(!!boss, 'a boss is up');
  if (boss) {
    for (let k = 0; k < 900 && boss.roarT > 0; k++) step(1); // its entrance (invulnerable) first
    boss.shield = 50;
    SA.bomb.by = 0;
    hostTo(boss.x + boss.radius + 1, boss.z);
    const hp = boss.hp;
    step(4);
    ok(SA.bomb.fuse > 0 && A.toys.objective.boss, 'carried next to the boss: planted on it');
    for (let k = 0; k < 900 && SA.bomb.fuse >= 0; k++) step(1);
    ok(boss.shield === 0 && boss.hp < hp - boss.maxHp * coopObjTuning.bombBossFrac * 0.9, `the blast strips its shield and takes ${(coopObjTuning.bombBossFrac * 100).toFixed(0)}% of its life`);
    ok(A.toys.objective.state === 'done', 'boss bombed: done');
  }
}

// ---------------------------------------------------------------- HUD smoke: render a few frames on both
{
  for (const g of [A, B]) {
    CP.renderCoopPlay(g, 1 / 60);
  }
  ok(!!document.getElementById('cp-marks'), 'HUD mounts');
}

function countChests(g: any): number {
  let n = 0;
  for (let i = 0; i < g.pickups.count; i++) if (g.pickups.type[i] === PickupType.Chest) n++;
  return n;
}

ok(errors.length === 0, 'no runtime errors' + (errors.length ? ':\n' + errors.slice(0, 3).join('\n') : ''));
process.exit(process.exitCode ?? 0);
