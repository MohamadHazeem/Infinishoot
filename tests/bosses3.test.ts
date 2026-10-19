/**
 * Biome bosses (bosses3 lane): Glitch DJ, Boxer Jack, Admiral Gale.
 * Data and rotation, pure geometry (grids, punch lines, pinball paths), the
 * brains with a fake world, the arena's net round trip, music/voice/portrait
 * hooks, then a host Game and a client Game wired together in-process (jsdom,
 * no WebGL): each boss spawns in its biome and its hazards reach the client.
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

const THREE = await import('three');
const { ENEMIES, MINI_BOSSES, bossForStage, miniBossForStage } = await import('../src/data/enemies');
const D = await import('../src/data/bosses3');
const R = await import('../src/data/bossRemix');
const { biomeForce } = await import('../src/data/biomes');
const B3 = await import('../src/game/bosses3');
const { Bosses3Field } = await import('../src/game/bosses3Field');
const { Enemy } = await import('../src/game/enemies');
const { StaticBoxGrid } = await import('../src/core/spatialHash');
const { startPhase, updateBoss, PHASE_LINES } = await import('../src/game/bosses');
const { bossLike } = await import('../src/game/bossRules');
const { TRACK_BY_ID, bossTrack } = await import('../src/audio/music/composition');
const { bossVoiceCue, bossVoiceId } = await import('../src/audio/voices');
const { VOICE_TEXT } = await import('../src/audio/voiceText');
const { paintPortrait, EXPRESSIONS } = await import('../src/ui/portraitArt');
const { BOSS_LINES } = await import('../src/game/systems/characters');
const { CODEX } = await import('../src/data/codex');
const { ENEMY_TIPS } = await import('../src/data/bestiary');

const BOSSES = ['glitch', 'boxer', 'gale'] as const;

// ---------------------------------------------------------------- data and rotation
for (const id of BOSSES) {
  const d = ENEMIES[id];
  ok(!!d && d.boss === true && d.phases?.length === 2 && !!d.title && d.material === 'metal', `${id}: a stage boss with 3 phases, a title card and a hit sound`);
  ok(PHASE_LINES[d.behavior]?.length === 3, `${id}: phase-change subtitles`);
  ok(!!BOSS_LINES[d.model] && !!ENEMY_TIPS[id] && CODEX.some((c) => c.id === `enemy:${id}` && c.kind === 'BOSS'), `${id}: pop-in lines, Enemy Guide tip and codex entry`);
}
for (const m of D.BIOME_MINIS) {
  const d = ENEMIES[m.id];
  ok(d.miniboss === true && !d.boss && d.phases?.length === 1 && d.behavior === ENEMIES[m.of].behavior && d.model === ENEMIES[m.of].model && d.minStage === (m.of === 'cake' || m.of === 'kraken' ? 9 : 5), `${m.id}: a 2-phase mini-boss on ${m.of}'s brain, from its biome's loop`);
  ok(MINI_BOSSES.some((x) => x.id === m.id) && bossLike(new Enemy(d)), `${m.id}: in the mini-boss pool and follows boss rules`);
}
ok(!!ENEMIES.dancer && !!ENEMIES.deckhand && ENEMIES.dancer.weight === 0 && ENEMIES.deckhand.minMinute === -1, 'minions exist and are never sent by the director');
ok(Object.keys(ENEMIES).length <= 256, `enemy kinds still fit a byte (${Object.keys(ENEMIES).length})`);
ok([5, 6, 7, 8].map((s) => bossForStage(s).id).join() === 'glitch,boxer,gale,omega', 'loop 2: Neon City, Toy Factory and Sky Fortress get their own bosses; Omega still ends the loop');
ok([1, 2, 3, 4, 9, 10].map((s) => bossForStage(s).id).join() === 'king,rex,queen,omega,cake,kraken', 'other biomes keep the rotation');
ok(bossForStage(1, 'neon').id === 'glitch' && bossForStage(2, 'factory').id === 'boxer' && bossForStage(3, 'sky').id === 'gale' && bossForStage(4, 'sky').id === 'omega', 'the biome picks (any stage; never over Omega)');
biomeForce.key = 'sky';
ok(bossForStage(1).id === 'gale', 'a pinned biome (&biome=sky) brings its boss');
biomeForce.key = null;
{
  const all = new Set(['king', 'rex', 'queen']);
  ok(R.stageBossId(6, 'boxer', all) === 'boxer' && R.stageBossId(5, 'glitch', all) === 'glitch', 'biome bosses keep their stage (no Titan, no remix over them)');
  ok(R.stageBossId(6, 'boxer', all, { titan: true }) === 'titan', 'the Titan test link still wins');
  ok(R.stageBossId(11, 'queen', all) === 'titan', 'the Titan still comes in loop 3');
}
for (let s = 1; s <= 16; s++) {
  const m = miniBossForStage(s);
  const of = MINI_BOSSES.find((x) => x.id === m.id)!.of;
  ok(of !== bossForStage(s).id && (s >= 5) === D.BIOME_MINIS.some((b) => b.id === m.id), `stage ${s}: mini-boss ${m.id} (${s >= 5 ? 'loop 2+: a biome mini' : 'loop 1: a classic'})`);
}

// ---------------------------------------------------------------- music, voices, portraits
ok(bossTrack(5) === 'glitch' && bossTrack(6) === 'boxer' && bossTrack(7) === 'gale' && bossTrack(8) === 'omega' && bossTrack(1) === 'boss', 'each biome boss has its own boss theme');
ok(TRACK_BY_ID.glitch.style.bpm === D.DJ_BPM && TRACK_BY_ID.glitch.boss === true, `the DJ's theme plays at its beat clock's tempo (${D.DJ_BPM} BPM)`);
for (const id of BOSSES) {
  const v = bossVoiceId(ENEMIES[id]);
  ok(v === id && bossVoiceCue(ENEMIES[id], 'intro') === `v:b:${id}:intro`, `${id}: recorded roar and lines (${v})`);
  ok(['intro', 'phase', 'defeat'].every((l) => !!VOICE_TEXT[`boss_${id}_${l}`]), `${id}: captions for its lines`);
}
ok(bossVoiceCue(ENEMIES.jack_jr, 'phase') === 'v:m:boxer:phase', "mini-bosses borrow their parent's roar");
{
  const blob = Array.from(paintPortrait({ kind: 'boss', model: 'blob', colors: { body: '#3b5dc9', accent: '#73eff7' } }, 'neutral'));
  for (const id of BOSSES) {
    const d = ENEMIES[id];
    const faces = EXPRESSIONS.map((x) => paintPortrait({ kind: 'boss', model: d.model, colors: { body: d.bodyColor, accent: d.accentColor } }, x));
    const filled = faces.every((f) => f.filter((_, i) => i % 4 === 3 && f[i] > 0).length > 300);
    const distinct = new Set(faces.map((f) => Array.from(f).join(','))).size === EXPRESSIONS.length;
    ok(filled && distinct && Array.from(faces[0]).join() !== blob.join(), `${id}: its own portrait in all ${EXPRESSIONS.length} expressions`);
  }
}

// ---------------------------------------------------------------- pure geometry
{
  const sp = 4;
  ok(B3.gridShift(10, 10, sp, false) === 0 && B3.gridShift(11, 10, sp, false) === 1 && B3.gridShift(14, 10, sp, false) === 4, 'grid lines step a quarter gap per beat');
  ok([0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => B3.gridShift(k, 0, sp, true)).join() === '0,1,2,3,4,3,2,1,0', 'the REMIX grid steps back and forth by the bar');
  ok(B3.gridDist(0, 0, 0, 0, 0, 9, sp, 40, 0) === 0 && Math.abs(B3.gridDist(2, 0, 0, 0, 0, 9, sp, 40, 0) - 2) < 1e-9, 'standing on a line vs between lines');
  ok(Math.abs(B3.gridDist(2, 0, 0, 0, 0, 9, sp, 40, 1) - 1) < 1e-9 && B3.gridDist(0, 30, 0, 0, 0, 9, sp, 40, 0) === Infinity, 'grid distance follows the step; nothing past the line ends');
  // Midway between two consecutive positions is always safe.
  const safe = B3.bosses3Tuning.gridHalf + 0.25 < sp / 8 + 0.5 && B3.bosses3Tuning.gridHalf + 0.25 < 1;
  ok(safe, 'a hero can stand between a line and its next position');
  ok(Math.abs(B3.segDist3(5, 1, 0, 0, 0, 10) - 1) < 1e-9 && Math.abs(B3.segDist3(-3, 4, 0, 0, 0, 10) - 5) < 1e-9, 'punch line distance');
  const pts = B3.pinballPath(0, 0, Math.SQRT1_2, Math.SQRT1_2, 16, 4, 20);
  let len = 0;
  let inside = true;
  for (let i = 0; i + 3 < pts.length; i += 2) len += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  for (let i = 0; i < pts.length; i++) inside &&= Math.abs(pts[i]) <= 20 + 1e-6;
  ok(inside && Math.abs(len - 64) < 0.5 && pts.length >= 6, `the pinball path bounces inside the arena (${pts.length / 2 - 2} bounces, ${len.toFixed(1)} m)`);
  // In the duel's ring of fire it bounces off the ring instead.
  const ring = { x: 2, z: -1, r: 9 };
  const rp = B3.pinballPath(2, -1, 1, 0, 16, 4, 40, 40, ring, 2);
  let inRing = true;
  for (let i = 0; i < rp.length; i += 2) inRing &&= Math.hypot(rp[i] - ring.x, rp[i + 1] - ring.z) <= ring.r - 2 + 0.3;
  ok(inRing && rp.length >= 8, `in the ring of fire the pinball stays inside the ring (${rp.length / 2 - 2} bounces)`);
  // The brain's step and the shown path agree.
  const pin = { x: 0, z: 0, dx: Math.SQRT1_2, dz: Math.SQRT1_2 };
  for (let k = 0; k < 240; k++) B3.pinStep(pin, 16 / 60, 20, null, 0);
  ok(Math.hypot(pin.x - pts[pts.length - 2], pin.z - pts[pts.length - 1]) < 1e-6, 'the run ends where its telegraphed path ends');
  const b = { n: 0, f: 0 };
  B3.beatAt(B3.beatLen() * 3.25, b);
  ok(b.n === 3 && Math.abs(b.f - 0.25) < 1e-9, 'beat clock');
}

// ---------------------------------------------------------------- brains with a fake world
function run(id: string, phase: number, seconds: number, move = ''): { calls: Record<string, number>; beats: number[] } {
  const calls: Record<string, number> = {};
  const beats: number[] = [];
  const count = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  const hero = { x: 6, z: 2, radius: 0.5, alive: true };
  let clock = 0;
  const b3: any = {
    clock: () => clock,
    grid: (_e: any, _x: number, _z: number, _a: number, beats: number, flip: boolean) => {
      count('grid');
      if (flip) count('flip');
      beats > 0 && (calls.gridBeats = beats);
      const b = { n: 0, f: 0 };
      B3.beatAt(clock, b);
      calls.gridFrac = Math.max(calls.gridFrac ?? 0, b.f);
    },
    beam: () => count('beam'),
    path: (_e: any, pts: number[]) => (count('path'), (calls.pathPts = pts.length)),
    gust: () => count('gust'),
    board: () => count('board'),
    bolt: () => count('bolt'),
    mark: () => count('mark'),
    ring: () => null,
    cue: (_e: any, k: string) => count('cue:' + k),
  };
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
    spawnChild: (id: string) => count('child:' + id),
    detonate: () => {},
    slam: () => count('slam'),
    strike: () => count('strike'),
    bounds: () => 40,
    boss: {
      shockwave: () => count('shockwave'),
      rampage: () => count('rampage'),
      firePatch: () => count('fire'),
      shot: () => count('shot'),
      plantHive: () => true,
      hiveCount: () => 0,
      swarmWall: () => {},
      open: () => true,
      b3,
    },
  };
  B3.bosses3Force.move = move;
  const e = new Enemy(ENEMIES[id]);
  e.reset(0, 0, { instant: true });
  e.state = 'move';
  if (phase > 1) startPhase(e, phase);
  const dt = 1 / 60;
  let lastBullets = 0;
  for (let t = 0; t < seconds; t += dt) {
    clock += dt;
    const dx = hero.x - e.x;
    const dz = hero.z - e.z;
    const d = Math.hypot(dx, dz) || 1;
    e.t -= dt;
    updateBoss(e, dt, ctx, dx / d, dz / d, d, e.def.speed);
    e.x += e.vx * dt;
    e.z += e.vz * dt;
    if (id === 'glitch' && (calls.bullet ?? 0) > lastBullets && e.action === 'ring') beats.push(clock);
    lastBullets = calls.bullet ?? 0;
    if (!Number.isFinite(e.x) || !Number.isFinite(e.z) || Math.abs(e.x) > 41 || Math.abs(e.z) > 41) {
      calls.bad = 1;
      break;
    }
  }
  B3.bosses3Force.move = '';
  return { calls, beats };
}

{
  const g1 = run('glitch', 1, 30).calls;
  ok((g1.grid ?? 0) > 0 && (g1.shockwave ?? 0) > 0 && (g1['child:dancer'] ?? 0) > 0 && (g1.bullet ?? 0) > 20 && !g1.bad, `DJ phase 1: grids ${g1.grid}, drops ${g1.shockwave}, dancers ${g1['child:dancer']}, pulse bullets ${g1.bullet}`);
  ok(!g1.flip, 'no REMIX before phase 3');
  ok((g1.gridFrac ?? 1) < 0.1, `grids start on a beat (at ${((g1.gridFrac ?? 0) * 100).toFixed(0)}% of it)`);
  const pulses = run('glitch', 1, 30, 'ring').beats;
  const L = B3.beatLen();
  const offBeat = pulses.filter((t) => {
    const f = t / L - Math.floor(t / L);
    return f > 0.1 && f < 0.9;
  }).length;
  ok(pulses.length > 8 && offBeat === 0, `pulse rings land on the beat (${pulses.length} rings, ${offBeat} off it)`);
  const g2 = run('glitch', 2, 30).calls;
  ok((g2.grid ?? 0) >= 2 && (g2.grid ?? 0) % 2 === 0 && (g2.shockwave ?? 0) >= 2, `DJ phase 2: grids cross in pairs (${g2.grid}), double drops (${g2.shockwave})`);
  const g3 = run('glitch', 3, 30).calls;
  ok((g3.flip ?? 0) > 0 && (g3.shockwave ?? 0) >= 3 && (g3.mark ?? 0) > 0 && !g3.bad, `DJ phase 3 REMIX: back-and-forth grids (${g3.flip}), mirrored drops (${g3.shockwave} waves, ${g3.mark} echo marks)`);
  const mini = run('mc_static', 2, 30).calls;
  ok((mini.grid ?? 0) % 2 === (mini.grid ?? 0) % 2 && !mini.bad && (mini.bullet ?? 0) > 0, 'MC Static fights on the same brain');

  const j1 = run('boxer', 1, 30).calls;
  ok((j1.beam ?? 0) > 0 && (j1.slam ?? 0) > 0 && (j1['child:soldier'] ?? 0) > 0 && (j1['cue:crank'] ?? 0) > 0 && !j1.bad, `Jack phase 1: punches ${j1.beam}, springs ${j1.slam}, toy soldiers ${j1['child:soldier']}, crank tells ${j1['cue:crank']}`);
  ok(!j1.path, 'no pinball before phase 3');
  const j2 = run('boxer', 2, 30, 'punch').calls;
  const j1p = run('boxer', 1, 30, 'punch').calls;
  ok((j2.beam ?? 0) > (j1p.beam ?? 0), `phase 2 punches come as one-twos (${j1p.beam} -> ${j2.beam} lines)`);
  const j3 = run('boxer', 3, 30).calls;
  ok((j3.path ?? 0) > 0 && (j3.rampage ?? 0) > 0 && (j3['cue:bounce'] ?? 0) > 0 && !j3.bad, `Jack phase 3: pinball runs (${j3.path} paths, ${j3['cue:bounce']} bounces), smashing cover`);

  const s1 = run('gale', 1, 30).calls;
  ok((s1.gust ?? 0) > 0 && (s1.board ?? 0) > 0 && (s1.shot ?? 0) > 10 && (s1.strike ?? 0) > 0 && !s1.bolt && !s1.bad, `Gale phase 1: gusts ${s1.gust}, boarding parties ${s1.board}, cannonballs ${s1.shot}, barrage ${s1.strike}`);
  const s2 = run('gale', 2, 30, 'volley').calls;
  const s1v = run('gale', 1, 30, 'volley').calls;
  ok((s2.shot ?? 0) > (s1v.shot ?? 0) * 1.5, `phase 2 broadsides (${s1v.shot} -> ${s2.shot} balls)`);
  const s3 = run('gale', 3, 30).calls;
  ok((s3.bolt ?? 0) > 10 && !s3.bad, `Gale phase 3: the storm strikes (${s3.bolt} bolts)`);
}

// ---------------------------------------------------------------- arena net round trip
{
  const F = new Bosses3Field(new THREE.Scene());
  F.clockOn = true;
  F.clock = B3.beatLen() * 5.05;
  F.grids.push({ cx: 1, cz: 2, ang: 0.5, n: 9, sp: 4, len: 44, b0: 3, beats: 10, flip: true, dmg: 14, hit: 0, hitBeat: -1 });
  F.beams.push({ x: 1.234, z: 2, ang: 1, len: 17, half: 0.85, tele: 0.3, life: 0.22, dmg: 22, hit: 0, kind: 0 });
  F.gust = { dx: 1, dz: 0, tele: 0.5, life: 2.8, pulse: 0 };
  F.bolts.push({ x: 3, z: 4, t: 0.5, shown: 0, dmg: 18 });
  const net = JSON.parse(JSON.stringify(F.pack()));
  const C = new Bosses3Field(new THREE.Scene());
  C.unpack(net);
  ok(C.clockOn && Math.abs(C.clock - F.clock) < 0.01 && C.grids.length === 1 && C.grids[0].flip && C.beams[0].x === 1.23, 'client mirrors the beat clock, grids and punch lines');
  ok(!Number.isNaN(C.hotShift(C.grids[0])) && Number.isNaN(C.hotShift({ ...C.grids[0], b0: 10 })), 'the grid is hot right after its beat, and not before its first one');
  C.advance(0.4);
  ok(C.beams[0].tele < 0 && C.gust!.tele < 0.2 && C.bolts[0].t < 0.2, 'telegraph clocks run on between snapshots');
  C.render([], 1, 0, 0, false);
  C.unpack(undefined);
  ok(!C.clockOn && C.grids.length === 0 && !C.gust, 'no boss: the arena clears');
}

// ---------------------------------------------------------------- in a real game: host + client
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { unlockedWeapons } = await import('../src/game/save');
const { settings } = await import('../src/game/settings');
const S3 = await import('../src/game/systems/bosses3');

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
A.xpNext = B.xpNext = 1e12;
const step = (n: number, until?: () => boolean) => {
  for (let i = 0; i < n; i++) {
    A.update(1 / 60);
    flush();
    B.update(1 / 60);
    flush();
    if (A.mode === 'levelup') for (const h of A.heroes) if (h.offers.length) A.heroAction(h, 'pick', 0, 1);
    if (until?.()) return true;
  }
  return false;
};
const fA = () => S3.bosses3Field(A);
const fB = () => S3.bosses3Field(B);
const kill = (e: any) => A.damage(e, 1e9, { source: 'buster' }, A.heroes[0]);

const fight = (stage: number, id: string, move: string, check: () => boolean, what: string) => {
  A.loadStage(stage);
  flush();
  step(5);
  B3.bosses3Force.move = move;
  A.debugBoss({ now: true });
  step(10);
  ok(A.boss?.def.id === id, `stage ${stage}: the stage boss is ${A.boss?.def.id}`);
  ok(step(60 * 14, check), `${what} reaches the client`);
  B3.bosses3Force.move = '';
  kill(A.boss);
  step(1);
  if (A.boss?.active) kill(A.boss); // a phase gate may have held it
  for (let i = 0; i < 4 && A.boss?.active; i++) {
    step(100);
    kill(A.boss);
  }
  step(60);
  ok(A.mode === 'cleared' || A.mode === 'portal', `${id} dies and the stage clears (${A.mode})`);
};

fight(5, 'glitch', 'grid', () => fB().clockOn && fB().grids.length > 0 && Math.abs(fB().clock - fA().clock) < 0.3, 'Glitch DJ: the beat clock and laser grid');
step(30);
ok(!fA().clockOn && fA().grids.length === 0 && fB().grids.length === 0, 'the DJ gone: no beat, no grid on either machine');
fight(6, 'boxer', 'punch', () => fB().beams.some((b) => b.kind === 0), 'Boxer Jack: a punch line');
fight(7, 'gale', 'gust', () => !!fB().gust, 'Admiral Gale: a gust');
{
  // A gust pushes bullets on the host.
  A.loadStage(7);
  flush();
  step(5);
  A.enemies.spawn(ENEMIES.gale, 20, 20, A.spawnOpts());
  const F = fA();
  F.gust = { dx: 1, dz: 0, tele: 0, life: 1, pulse: 1 };
  A.bullets.spawn({ x: 0, z: 0, dirX: 0, dirZ: 1, speed: 5, life: 3, radius: 0.3, damage: 1, knockback: 0, team: 1 as any, color: '#ffffff', width: 0.5, length: 0.5 });
  const i = A.bullets.count - 1;
  const vx0 = A.bullets.vx[i];
  (A as any).updateBossFight(0.5);
  ok(A.bullets.vx[i] > vx0 + 1, `gust pushes bullets (vx ${vx0.toFixed(2)} -> ${A.bullets.vx[i].toFixed(2)})`);
}
