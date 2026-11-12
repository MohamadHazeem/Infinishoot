/**
 * Coopsync lane: host and client agree on the stage's objective pieces from the first frame.
 * - normal and custom (arena editor) co-op runs over many seeds: the client's arena colliders, solo objective
 *   (totems, shards, beacon) and co-op objective (kind and layout) equal the host's right after the start
 *   message, before any snapshot, and still after the first snapshots
 * - the next stage (the client loads it from the `stage` message) agrees the same way
 * - a client that predicted a co-op objective follows the host when the host's layout differs (forced objective)
 * - a turret the client hero stands on during a host level-up switches on for the client once it closes
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
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent']) {
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

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { save } = await import('../src/game/save');
const { settings } = await import('../src/game/settings');
const { sampleArena } = await import('../src/editor/samples');
const { pickLobbyArena } = await import('../src/game/systems/editor');
const { coopPlayState, forceCoopObjective } = await import('../src/game/systems/coopplay');
const { pickCoopObjective } = await import('../src/game/coopplay');

save.training.offered = true;
settings.autoFire = false;
cheats.god = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
type G = InstanceType<typeof Game>;
const A: G = new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const B: G = new Game(new Input(canvas), 16 / 9, document.createElement('div'), document.createElement('div'));
const q: any[] = [];
const toA: any[] = [];
/** A host and a client wired to each other (leaving to the title closes a session, so each run wires them again). */
function connect(): void {
  (A as any).host = { code: 'TESTA', clientIds: ['peerB'], send: (_id: string, m: any) => q.push(m), broadcast: (m: any) => q.push(m), close() {}, kick() {} };
  (A as any).role = 'host';
  (B as any).role = 'client';
  (B as any).client = { send: (m: any) => toA.push(m), close() {} };
  A.lobbyKind = 'coop';
}
/** Deliver messages; `snaps: false` holds snapshots back (the state "at the start message", before any snapshot). */
const flush = (snaps = true) => {
  const held: any[] = [];
  while (q.length) {
    const m = q.shift();
    if (!snaps && m.t === 's') held.push(m);
    else B.onClientMessage(structuredClone(m));
  }
  q.push(...held);
  while (toA.length) A.onHostMessage('peerB', structuredClone(toA.shift()));
};

const box = (b: { minX: number; maxX: number; minZ: number; maxZ: number }) => [b.minX, b.maxX, b.minZ, b.maxZ].map((v) => v.toFixed(3)).join(',');
/** Everything about the objective that each machine builds itself (positions, colliders, kinds). */
function objectiveView(g: G) {
  const s = coopPlayState(g);
  return {
    stage: g.arenaStage,
    seed: g.arena.seed,
    colliders: g.arena.colliders.map(box).sort().join(';'),
    kind: g.toys.objective.kind,
    max: g.toys.objective.max,
    totems: g.toys.totems.map((t) => [t.x, t.z, t.alive]),
    shards: g.toys.shards.map((t) => [t.x, t.z]),
    beacon: g.toys.beacon,
    coop: s.kind,
    lay: s.lay,
    vault: s.box && box(s.box),
  };
}
function diff(a: Record<string, unknown>, b: Record<string, unknown>): string {
  return Object.keys(a)
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => `${k}: host ${JSON.stringify(a[k]).slice(0, 120)} vs client ${JSON.stringify(b[k]).slice(0, 120)}`)
    .join(' | ');
}
const steps = (n: number) => {
  for (let i = 0; i < n; i++) {
    A.update(1 / 60);
    flush();
    B.update(1 / 60);
  }
};
function start(seed: number, custom: boolean): void {
  if (A.mode !== 'title') A.leaveToTitle();
  if (B.mode !== 'title') B.goTitle();
  q.length = toA.length = 0;
  connect();
  A.setHeroes([A.hero, A.makeHero(1, 'Guest', [], 'peerB')]);
  pickLobbyArena(A, custom ? { id: 'pit1', arena: sampleArena(seeds.indexOf(seed) % 2 ? 'fortress' : 'pit') } : null);
  flush();
  A.startRun({ seed, difficulty: 'normal' });
  flush(false);
}

// Seeds with every interesting combination: co-op objective on stage 1 or not, solo objective totems (colliders) or not.
const seeds: number[] = [];
const coopSeeds: number[] = [];
for (let s = 1; seeds.length < 14 && s < 4000; s += 37) {
  const coop = !!pickCoopObjective((s ^ Math.imul(1, 0x9e3779b1)) >>> 0, 1);
  if (coop && coopSeeds.length < 7) coopSeeds.push(s), seeds.push(s);
  else if (!coop && seeds.length - coopSeeds.length < 7) seeds.push(s);
}

let atStart = 0;
let coopRuns = 0;
for (const custom of [false, true]) {
  for (const seed of seeds) {
    start(seed, custom);
    const label = `${custom ? 'custom' : 'normal'} arena, seed ${seed}`;
    const h0 = objectiveView(A);
    const c0 = objectiveView(B);
    if (h0.coop) coopRuns++;
    const d0 = diff(h0, c0);
    if (!d0) atStart++;
    ok(!d0 && h0.stage === 1 && h0.seed === c0.seed, `${label}: the client builds the host's objective props from the start message, before any snapshot${d0 ? ` (${d0})` : ''}`);
    // Through the starting shop and the first snapshots: still the same (the snapshot changes nothing).
    if (A.mode === 'shop') for (const h of A.heroes) A.heroAction(h, 'done', 0, 1);
    flush();
    steps(3);
    const d1 = diff(objectiveView(A), objectiveView(B));
    ok(!d1, `${label}: and after the first snapshots${d1 ? ` (${d1})` : ''}`);
  }
}
ok(coopRuns >= 6 && atStart === seeds.length * 2, `objective props match at the start in every run (${atStart}/${seeds.length * 2}, ${coopRuns} with a co-op objective)`);

// The next stage: the client loads it itself from the `stage` message.
{
  start(coopSeeds[0], false);
  if (A.mode === 'shop') for (const h of A.heroes) A.heroAction(h, 'done', 0, 1);
  flush();
  steps(2);
  let found = 0;
  for (let stage = 2; stage <= 6; stage++) {
    const seed = A.seed;
    A.stage = stage;
    A.loadArena((seed ^ Math.imul(stage, 0x9e3779b1)) >>> 0, stage);
    B.clientStage(stage, seed);
    const d = diff(objectiveView(A), objectiveView(B));
    if (coopPlayState(A).kind) found++;
    ok(!d, `stage ${stage}: the client's own stage load builds the host's objective props${d ? ` (${d})` : ''}`);
  }
  ok(found >= 1, `later stages exercised a co-op objective too (${found}/5)`);
}

// A host-forced co-op objective (trials, debug) the client could not predict: the first snapshot moves it there.
{
  start(coopSeeds[1], false);
  if (A.mode === 'shop') for (const h of A.heroes) A.heroAction(h, 'done', 0, 1);
  flush();
  steps(2);
  const had = coopPlayState(B).kind;
  const kind = had === 'zones' ? 'door' : 'zones';
  ok(forceCoopObjective(A, kind), `the host forces ${kind} (client predicted ${had})`);
  steps(12);
  const d = diff(objectiveView(A), objectiveView(B));
  ok(!d && coopPlayState(B).kind === kind, `the client follows the host's forced objective${d ? ` (${d})` : ''}`);
  // Same kind, other place: the client moves its pieces to the host's layout too.
  const sA = coopPlayState(A);
  const sB = coopPlayState(B);
  sA.lay = { a: { x: sA.lay!.a.x + 2, z: sA.lay!.a.z }, b: sA.lay!.b, v: sA.lay!.v };
  steps(12);
  ok(JSON.stringify(sA.lay) === JSON.stringify(sB.lay), `the client follows a moved layout of the same kind (${JSON.stringify(sB.lay?.a)})`);
}

// Turrets (the coop script's flaky "client switches on a turret"): a client standing on an idle pad while the host
// holds the world for a level-up gets the turret as soon as the level-up closes; the client sees the timer.
{
  start(seeds[2], false);
  if (A.mode === 'shop') for (const h of A.heroes) A.heroAction(h, 'done', 0, 1);
  flush();
  steps(2);
  const me = A.hero.player;
  const tu = [...A.toys.turrets].filter((t) => t.t <= 0 && t.cd <= 0).sort((p, q) => Math.hypot(q.x - me.x, q.z - me.z) - Math.hypot(p.x - me.x, p.z - me.z))[0];
  ok(!!tu && A.mode === 'fight', `an idle turret away from the host hero (${tu && Math.hypot(tu.x - me.x, tu.z - me.z).toFixed(1)} m, host ${A.mode})`);
  const i = A.toys.turrets.indexOf(tu);
  const stand = (n: number) => {
    for (let k = 0; k < n; k++) {
      B.hero.player.teleport(tu.x, tu.z);
      A.update(1 / 60);
      flush();
      B.update(1 / 60);
    }
  };
  A.mode = 'levelup'; // the team level-up: the host holds the world until everyone picked
  stand(40);
  ok(A.toys.turrets[i].t <= 0, `during the level-up the turret waits (${A.toys.turrets[i].t.toFixed(1)} s, client hero on the host ${Math.hypot(A.heroes[1].player.x - tu.x, A.heroes[1].player.z - tu.z).toFixed(1)} m from it)`);
  A.mode = 'fight';
  stand(12);
  ok(A.toys.turrets[i].owner === 1 && A.toys.turrets[i].t > 0, `after it the turret switches on for the client (owner ${A.toys.turrets[i].owner}, ${A.toys.turrets[i].t.toFixed(1)} s)`);
  ok(B.toys.turrets[i].t > 0 && B.toys.turrets[i].owner === 1, `and the client sees it running (${B.toys.turrets[i].t.toFixed(1)} s)`);
}

cheats.god = false;
console.log('coopsync: objective props on host and client match from the start');
process.exit(process.exitCode ?? 0);
