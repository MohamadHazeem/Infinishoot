// Optional matched-seed encounter benchmark. Every sample runs the mortal Gate 2 pilot.
import { dom, jsdomErrors, seedRandom, simTimers } from './jsdomEnv';
import assert from 'node:assert/strict';

import type { Game } from '../src/game/game';
import type { Input } from '../src/core/input';
import type { Autopilot } from '../src/game/autopilot';

// Coach only the virtual controller. Observe at the stock 10 Hz and deliver the cached
// observation eleven frames later, even when the mark or hero has moved since then.
function practiceControls(g: Game, input: Input, nav: Autopilot, bossId: string, practice: number) {
  const knowledge = {
    bossId, readsOpening: practice >= 2, knowsSafeGround: practice >= 3,
    aimsAtSocket: practice >= 4, knowsFollowUp: practice >= 5,
  };
  const poll = input.poll.bind(input);
  const pad = input.virtual;
  let frame = 0;
  type Advice = { mx?: number; mz?: number; ax?: number; az?: number };
  const queue = new Array<Advice | undefined>(12);
  let held: Advice = {};
  const see = (x: number, z: number) => {
    const v = g.cam.camera;
    sight.set(x, 0.6, z).project(v);
    return Math.abs(sight.x) <= 1 && Math.abs(sight.y) <= 1 && Math.abs(sight.z) <= 1;
  };
  const sight = g.playerPos.clone();
  function observe(): Advice {
    const b = g.boss, p = g.player;
    if (!b?.active || b.def.id !== knowledge.bossId || g.mode !== 'fight') return {};
    const a: Advice = {};
    function go(x: number, z: number) {
      const [dx, dz] = knowledge.knowsSafeGround ? nav.steer(g, p.x, p.z, x, z) : [x - p.x, z - p.z];
      const d = Math.hypot(dx, dz);
      a.mx = d > 0.42 ? dx / d : 0;
      a.mz = d > 0.42 ? dz / d : 0;
    }
    const duel = g.bossDuel;
    if (knowledge.knowsSafeGround && duel && Math.hypot(p.x - duel.x, p.z - duel.z) > duel.r - 2) go(duel.x, duel.z);
    if (knowledge.knowsFollowUp && b.def.id === 'king' && (b.action === 'slam' || b.action === 'ring') && b.state === 'windup') {
      const dx = p.x - b.x, dz = p.z - b.z;
      go(p.x + dx - dz * 0.5, p.z + dz + dx * 0.5);
    }
    if (knowledge.aimsAtSocket && see(b.x, b.z)) {
      // The gold shoulder socket is visible on the facing side. Aim near its centre with the stock aim error.
      const x = b.x + Math.cos(b.facing) * b.radius * 0.7, z = b.z - Math.sin(b.facing) * b.radius * 0.7;
      const aim = Math.atan2(z - p.z, x - p.x) + (4 * Math.PI / 180) * Math.sin(frame * 0.137);
      a.ax = Math.cos(aim); a.az = Math.sin(aim);
    }
    // The scan leaves time to make space before its final beat, especially after a triple slam.
    if (knowledge.knowsFollowUp && b.move === 'scan' && b.t >= 1.2 && see(b.x, b.z)) {
      const dx = p.x - b.x, dz = p.z - b.z;
      if (Math.hypot(dx, dz) < b.radius + 5) go(p.x + dx, p.z + dz);
    }
    if (knowledge.knowsFollowUp && b.move === 'brakeRush' && b.state === 'windup') go(p.x - b.lungeZ * 3, p.z + b.lungeX * 3);
    if (knowledge.knowsFollowUp && b.move === 'breath' && see(b.x, b.z)) go(p.x + p.x - b.x, p.z + p.z - b.z);
    if (knowledge.knowsFollowUp && b.move === 'eight' && see(b.x, b.z)) go(p.x - b.lungeZ * 3, p.z + b.lungeX * 3);
    // First practice recalls the late tell. Second practice recognizes its opening pose.
    if (knowledge.knowsSafeGround) {
      // Route out of visible fire before attempting a counter, especially Omega's motion test.
      for (const f of [...g.arena.hazards, ...g.bossField.fires]) {
        if ('kind' in f && f.kind !== 'lava') continue;
        const dx = p.x - f.x, dz = p.z - f.z;
        const distance = Math.hypot(dx, dz);
        const near = b.def.id === 'omega' ? 3 : 0.8;
        if (distance < f.r + near) {
          if (b.move === 'scan' && distance > f.r + 1.4) a.mx = a.mz = 0;
          else go(p.x + dx, p.z + dz);
          return a;
        }
      }
    }
    if (b.state !== 'windup' || (!knowledge.readsOpening && b.t > 1.1)) return a;
    if (b.move === 'scan' && b.t < 1.2) { a.mx = a.mz = 0; }
    if (!see(b.targetX, b.targetZ)) return a;
    if (b.move === 'crown') go(b.targetX, b.targetZ);
    if (b.move === 'brake') {
      const lead = knowledge.readsOpening ? 0.32 : 0;
      go(b.targetX + (b.targetX - b.x) * lead, b.targetZ + (b.targetZ - b.z) * lead);
    }
    if (b.move === 'brood') go(b.x * 0.45 + b.targetX * 0.55, b.z * 0.45 + b.targetZ * 0.55);
    return a;
  }
  input.poll = () => {
    if (pad.active) {
      queue[frame % 12] = frame % 6 === 0 ? observe() : undefined;
      const delayed = queue[(frame + 1) % 12];
      if (delayed) held = delayed;
      if (held.mx !== undefined) { pad.move.x = held.mx; pad.move.y = held.mz!; }
      if (held.ax !== undefined) { pad.aim.x = held.ax; pad.aim.y = held.az!; }
      frame++;
    }
    poll();
  };
}

async function encounter(id: string, seed: number, practice: number) {
  dom.reconfigure({ url: 'http://localhost/?season=off' });
  seedRandom(seed);
  simTimers.install();
  const { Input } = await import('../src/core/input');
  const { Game } = await import('../src/game/game');
  const { installBot } = await import('../src/dev/bot');
  const { BOSS_ORDER, ENEMIES } = await import('../src/data/enemies');
  const { settings } = await import('../src/game/settings');
  const { HudDock } = await import('../src/ui/hudLayout');
  const { MoreCue } = await import('../src/ui/menuFit');
  settings.hero = 'rookie';
  settings.pet = 'none';
  settings.cinematics = 'off';
  HudDock.prototype.tick = () => {};
  MoreCue.prototype.watch = () => {};
  const input = new Input(document.getElementById('game') as HTMLCanvasElement);
  const g = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
  installBot(g, input);
  const run = (window as unknown as { skillRun: ReturnType<typeof import('../src/dev/skillBot').createSkillRun> }).skillRun;
  Object.defineProperty(window.performance, 'now', { configurable: true, value: performance.now.bind(performance) });
  Object.defineProperty(performance, 'now', { configurable: true, value: () => simTimers.now });
  const update = g.update;
  g.update = function (dt) {
    simTimers.advance(dt * 1000);
    update.call(this, dt);
  };
  g.startRun({ seed, difficulty: 'normal' });
  g.closeShop();
  const stage = BOSS_ORDER.indexOf(id) + 1;
  assert(stage > 0);
  if (stage > 1) g.loadStage(stage);
  g.director.hold = true;
  g.director.bossSpawned = true;
  g.enemies.clear();
  g.xpNext = 1e12;
  for (let n = 0; n < stage + 2; n++) g.debugGiveWeapon('drones');
  g.spawnBoss(ENEMIES[id]);
  assert.equal(g.boss!.def.id, id);
  g.render(1, 1 / 60);
  if (practice) {
    const { Autopilot } = await import('../src/game/autopilot');
    practiceControls(g, input, new Autopilot(), id, practice);
  }
  let report;
  for (let s = 0; s < 180; s++) {
    report = run(1);
    if (report.died || report.bosses.some(b => b.killed)) break;
  }
  assert.deepEqual(jsdomErrors, []);
  console.log('G4', JSON.stringify({ id, seed, practice, won: report!.bosses.some(b => b.killed),
    died: report!.died, hp: report!.hp, bossHp: g.boss?.hp, time: report!.runSeconds, cause: report!.causeOfDeath }));
}

if (process.env.G4_BOSS) await encounter(process.env.G4_BOSS, Number(process.env.G4_SEED ?? 1), Number(process.env.G4_PRACTICE ?? 0));

if (!process.env.G4_BOSS) {
  const { Game } = await import('../src/game/game');
  const { Input } = await import('../src/core/input');
  const { ENEMIES } = await import('../src/data/enemies');
  const { Enemy } = await import('../src/game/enemies');
  const { updateBoss, startPhase, BOSS_MOVES } = await import('../src/game/bosses');
  const { actTuning } = await import('../src/game/bossesActs');
  const { packEnemies, unpackEnemies } = await import('../src/net/codec');
  const { setLanguage } = await import('../src/i18n');
  const { BossField } = await import('../src/game/bossField');
  const { Scene } = await import('three');
  const g = new Game(new Input(document.querySelector('#game')!), 16 / 9, document.querySelector('#hud')!, document.querySelector('#reticle')!);
  g.startRun({ seed: 8, difficulty: 'normal' });
  g.closeShop();
  g.director.hold = true;
  g.arena.hazards.length = 0;
  g.walls.segmentClear = () => true;
  g.bossApi.open = () => true;
  const sys = g.bossApi.acts!, ctx = g.enemyCtx, p = g.player;
  const mate = g.makeHero(1, 'Test', [], 'test');
  g.setHeroes([g.hero, mate]);
  const m = mate.player;
  ctx.target = p;
  ctx.targetAlive = true;
  const setup = (id: string) => {
    g.enemies.clear();
    g.bossField.clear();
    p.teleport(7, 0); m.teleport(-7, 0);
    const e = g.enemies.spawn(ENEMIES[id], 0, 0, { instant: true });
    e.state = 'move'; e.timerA = 0;
    return e;
  };
  const mirror = new BossField(new Scene());
  const openings: Record<string, string[][]> = {
    king: [['ring', 'slam'], ['slam', 'ring'], ['slam', 'ring']],
    rex: [['charge', 'spiral'], ['eight', 'spiral'], ['breath', 'waves']],
    queen: [['volley', 'rain'], ['hive', 'volley'], ['wall', 'volley']],
    omega: [['ring', 'charge'], ['spiral', 'waves'], ['spiral', 'slam']],
  };
  const phrases = new Set<string>();
  for (const [id, move] of [['king','crown'], ['rex','brake'], ['queen','brood'], ['omega','scan']]) {
    for (let phase = 1; phase <= 3; phase++) {
      const e = setup(id);
      if (phase > 1) { startPhase(e, phase); e.roarT = 0; e.state = 'move'; }
      updateBoss(e, 1 / 60, ctx, 1, 0, 7, e.def.speed);
      assert.equal(e.move, move, id + ' phase opening');
      assert(e.t >= 2.8);
      // Same two records the client consumes. A late snapshot must establish a complete tell by itself.
      const other = new Enemy(e.def);
      const net = g.bossField.pack([e], () => 0);
      unpackEnemies(packEnemies([e]), r => { other.targetX = r.targetX; other.targetZ = r.targetZ; other.t = r.t; });
      mirror.unpack(net, () => other);
      assert.equal(other.move, move);
      assert.equal(other.phase, phase);
      assert(Math.abs(other.t - e.t) < 0.021 && Math.hypot(other.targetX - e.targetX, other.targetZ - e.targetZ) < 0.015);
      for (const expected of openings[id][phase - 1]) {
        e.state = 'move'; e.move = ''; e.timerA = 0;
        updateBoss(e, 1 / 60, ctx, 1, 0, 25, e.def.speed);
        assert.equal(e.move || e.action, expected, id + ' keeps its phrase at long range');
      }
    }
    const e = setup(id);
    startPhase(e, 3);
    g.vfx.recording = true;
    g.vfx.drain();
    while (e.roarT > 0) updateBoss(e, 1 / 60, ctx, 1, 0, 7, e.def.speed);
    const fx = g.vfx.drain();
    const notes = fx.filter(event => event[0] === 'a' && event[3] === 'droneRevive');
    assert.equal(notes.length, 3);
    assert.equal(fx.filter(event => event[0] === 'h' && event[1] === 'banner').length, 1);
    phrases.add(notes.map(note => note[4]).join(','));
    g.vfx.recording = false;
  }
  assert.equal(phrases.size, 4, 'each desperation act has its own three-beat phrase');
  const crown = setup('king');
  sys.begin(crown, 'crown', ctx, 1, 0);
  m.teleport(crown.targetX, crown.targetZ);
  const hp = crown.hp;
  sys.step(crown, ctx, 1, 0);
  assert.equal(crown.hp, hp - Math.round(hp * actTuning.recoil));
  assert.equal(mate.damageBy.arena, hp - crown.hp);
  assert.equal(crown.state, 'recover');
  assert(crown.exposeT > 2);
  crown.hp = Math.round(crown.maxHp * 0.7);
  sys.begin(crown, 'crown', ctx, 1, 0);
  m.teleport(crown.targetX, crown.targetZ);
  sys.step(crown, ctx, 1, 0);
  assert.equal(crown.phase, 2); assert(crown.roarT > 0 && crown.move === '', 'counter recoil respects phase gate');

  const rex = setup('rex');
  sys.begin(rex, 'brake', ctx, 1, 0);
  const len = Math.hypot(rex.targetX, rex.targetZ);
  rex.t = 0;
  sys.step(rex, ctx, rex.targetX / len, rex.targetZ / len);
  assert.equal(rex.move, 'brakeRush'); assert(rex.t >= 0.8);
  const before = rex.hp;
  sys.step(rex, ctx, -1, 0);
  assert.equal(rex.hp, before); assert.equal(rex.vx, 0);
  rex.x = rex.targetX; rex.z = rex.targetZ; rex.t = 0;
  sys.step(rex, ctx, -1, 0);
  assert.equal(rex.state, 'recover'); assert(rex.hp < before);

  const queen = setup('queen');
  sys.begin(queen, 'brood', ctx, 1, 0);
  sys.step(queen, ctx, 1, 0);
  assert.equal(queen.hp, queen.maxHp, 'incoming hive cannot count as destroyed');
  const hive = g.enemies.spawn(ENEMIES.hive, queen.targetX, queen.targetZ, { instant: true });
  m.teleport(hive.x * 0.55, hive.z * 0.55);
  sys.step(queen, ctx, 1, 0);
  assert(!hive.active && queen.hp < queen.maxHp, 'teammate severs brood link without a weapon');

  const omega = setup('omega');
  sys.begin(omega, 'scan', ctx, 1, 0);
  omega.t = 0.3; p.vel.x = 4; m.vel.x = 4;
  sys.step(omega, ctx, 1, 0);
  p.vel.x = m.vel.x = 0; omega.t = 0;
  const pending = g.strikes.length;
  sys.step(omega, ctx, 1, 0);
  assert.equal(omega.hp, omega.maxHp, 'stopping only at the deadline misses the motion scan');
  assert(g.strikes.length > pending && g.strikes.slice(pending).every(s => s.t >= 1.1), 'failed scan announces every impact');
  sys.begin(omega, 'scan', ctx, 1, 0);
  p.vel.x = 4; omega.t = 0;
  sys.step(omega, ctx, 1, 0);
  assert(omega.hp < omega.maxHp && mate.damageBy.arena > 0, 'one stationary teammate can disrupt the scan');

  for (const [id, first] of [['prince', 'skipFork'], ['rexling', 'switchback'], ['princess', 'petals']]) {
    const e = setup(id);
    updateBoss(e, 1 / 60, ctx, 1, 0, 7, 2);
    assert.equal(e.move, first); assert(e.t >= 0.8 && e.state === 'windup');
    assert(BOSS_MOVES.includes(e.move as never));
  }
  const fork: number[] = [], petals: number[] = [];
  const miniCtx: typeof ctx = { ...ctx, fireBullet: (_e, x, z) => { fork.push(Math.atan2(z, x)); },
    strike: (_x, _z, _r, delay) => { petals.push(delay); } };
  const tickMini = (e: InstanceType<typeof Enemy>) => updateBoss(e, 1 / 60, miniCtx, 1, 0, 7, 2);
  const prince = setup('prince');
  prince.phase = 2;
  tickMini(prince); prince.t = 0; tickMini(prince);
  assert.equal(fork.length, 4, 'two fork shots with a slower echo in each marked lane');
  assert(fork[0] < -0.2 && fork[0] === fork[1] && fork[2] > 0.2 && fork[2] === fork[3]);
  prince.state = 'move'; prince.timerA = 0;
  tickMini(prince); prince.t = 0; tickMini(prince);
  assert.deepEqual(fork.slice(4), [0, 0], 'the next fork turn warns and fires down the centre');
  const rexling = setup('rexling');
  rexling.phase = 2;
  tickMini(rexling); rexling.t = 0; tickMini(rexling);
  const firstX = rexling.lungeX;
  rexling.t = 0; tickMini(rexling);
  assert(rexling.state === 'windup' && rexling.t >= 0.85 && rexling.lungeX === -firstX,
    'the return rush reverses along the original lane after a second full warning');
  const princess = setup('princess');
  princess.phase = 2;
  tickMini(princess); princess.t = 0; tickMini(princess);
  assert.equal(petals.length, 4);
  assert(petals[0] >= 1 && petals.every((t, i) => !i || t > petals[i - 1]) && petals[3] === 2,
    'all three petals land in sequence before the separately warned centre bloom');
  const e = setup('king');
  sys.begin(e, 'crown', ctx, 1, 0);
  await setLanguage('ar');
  sys.render();
  assert.match(document.querySelector('.boss-act-hint')!.textContent!, /[\u0600-\u06ff]/);
  e.move = ''; sys.render();
  assert(document.querySelector<HTMLElement>('.boss-act-hint')!.hidden);
  assert.deepEqual(jsdomErrors, []);
}
