/**
 * Modes lane: pure rules (beat clock, on-beat window, step pulse, rhythm roll, pacifist rewards,
 * mini-games, ghost recording and codes) and a real solo Game (jsdom, no WebGL): rhythm stages
 * whose attacks land on beats and on-beat kill bonuses, the Pacifist road (no damage, no special,
 * no boss, rewards and forfeits, the legendary card), the three mini-games paying gold, the route
 * map's hidden node, and a weekly ghost kept at the end of the run.
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
const errors: string[] = [];
process.on('uncaughtException', (e) => errors.push('uncaught ' + e.stack));
process.on('exit', () => {
  if (errors.length) console.error('FAIL runtime errors:\n' + errors.slice(0, 3).join('\n'));
});

const R = await import('../src/game/modes/rhythm');
const P = await import('../src/game/modes/pacifist');
const MG = await import('../src/game/modes/minigames');
const GH = await import('../src/game/modes/ghost');
const { ghostStore } = await import('../src/game/modes/ghostStore');

// ------------------------------------------------------------------ beat clock
{
  const c = R.newClock(120);
  ok(Math.abs(R.beatAt(c, 1.5) - 3) < 1e-9, 'beat clock: 120 BPM, 1.5 s = 3 beats');
  R.setTempo(c, 150, 2);
  ok(Math.abs(R.beatAt(c, 2) - 4) < 1e-9 && Math.abs(R.beatAt(c, 3) - 6.5) < 1e-9, 'tempo change keeps the beat position continuous (150 BPM from beat 4)');
  ok(R.onBeat(8.05, 120) && R.onBeat(7.9, 120) && !R.onBeat(8.5, 120) && !R.onBeat(8.4, 120), 'on-beat window: 0.025 s after and 0.05 s before count, half a beat off does not');
  ok(R.crossed(3.98, 4.01) && !R.crossed(4.01, 4.3), 'crossed() catches the step a beat falls in');
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum += R.stepPulse((i + 0.5) / 1000);
  ok(Math.abs(sum / 1000 - 1) < 0.01 && R.stepPulse(0) > 2 && R.stepPulse(0.6) < 0.7, `step pulse averages x1 (${(sum / 1000).toFixed(3)}), peaks on the beat (x${R.stepPulse(0).toFixed(2)}), dips between`);
  let n = 0;
  for (let s = 1; s <= 4000; s++) if (R.rhythmRoll(s * 7919, 3)) n++;
  ok(Math.abs(n / 4000 - R.rhythmTuning.chance) < 0.02 && R.rhythmRoll(12345, 4) === R.rhythmRoll(12345, 4) && !R.rhythmRoll(1, 1), `rhythm roll: seeded, ~${Math.round(R.rhythmTuning.chance * 100)}% of stages (${((n / 40)).toFixed(1)}%), never stage 1`);
  ok(R.stageBpm(1, 1, false) === 128 && R.stageBpm(2, 2, true) === 160, 'stage tempo follows the music: meadow 128, Rex 160');
}

// ------------------------------------------------------------------ pacifist rules
{
  const r = P.pacifistReward(0, 3);
  ok(!!r && r.gold === P.pacifistTuning.gold + P.pacifistTuning.goldPerStage * 3 && r.relic && r.legendary, 'pacifist reward: gold, relic and a legendary card for zero kills');
  ok(P.pacifistReward(1, 3) === null, 'pacifist reward: one kill forfeits it');
  ok(P.pacifistLeft(100) === 20 && P.pacifistLeft(130) === 0, 'pacifist timer counts down from 2:00');
}

// ------------------------------------------------------------------ mini-games (pure)
{
  const T = MG.miniTuning;
  const hero = (x: number, z: number, aimX = 1, aimZ = 0, firing = false): any => ({ x, z, radius: 0.5, aimX, aimZ, firing, alive: true });
  // Shooting gallery: run past the intro, then aim at the first target.
  const g = MG.newMiniGame('gallery', 7, 2, 0, 0, 1);
  const ev: any[] = [];
  let t = 0;
  while (g.phase === 0) MG.miniStep(g, 1 / 60, [hero(0, 0)], undefined, ev), (t += 1 / 60);
  ok(g.phase === 1 && Math.abs(t - T.intro) < 0.05, `gallery: ${T.intro} s countdown`);
  for (let i = 0; i < 60; i++) MG.miniStep(g, 1 / 60, [hero(0, 0)], undefined, ev);
  const tgt = g.items.find((it) => it.by === -1 && it.kind !== 2)!;
  ok(!!tgt, `gallery: targets pop up (${g.items.length})`);
  MG.miniStep(g, 1 / 60, [hero(0, 0, tgt.x, tgt.z, true)], undefined, ev);
  const hit = ev.find((e) => e.type === 'hit');
  ok(!!hit && tgt.by === 0 && g.gold[0] === hit.gold && hit.gold >= 1, `gallery: an aimed shot hits for ${hit?.gold} gold`);
  MG.miniStep(g, 1 / 60, [hero(0, 0, tgt.x, tgt.z, true)], undefined, ev);
  ok(!ev.some((e) => e.type === 'hit' || e.type === 'shot'), 'gallery: one shot every 0.28 s');
  // Same inputs, same game.
  const a = MG.newMiniGame('coins', 99, 3, 2, 2, 2);
  const b = MG.newMiniGame('coins', 99, 3, 2, 2, 2);
  for (let i = 0; i < 400; i++) {
    MG.miniStep(a, 1 / 60, [hero(2, 2), hero(4, 1)]);
    MG.miniStep(b, 1 / 60, [hero(2, 2), hero(4, 1)]);
  }
  ok(JSON.stringify(MG.miniNet(a)) === JSON.stringify(MG.miniNet(b)), 'mini-games are deterministic (same seed, same inputs)');
  // Coin dash: walking onto a coin takes it, for that hero only.
  const coin = a.items.find((it) => it.by === -1)!;
  const before = a.gold.slice();
  const evs = MG.miniStep(a, 1 / 60, [hero(coin.x, coin.z), hero(-50, -50)]);
  ok(evs.some((e) => e.type === 'grab' && e.hero === 0) && a.gold[0] > before[0] && a.gold[1] === before[1], 'coin dash: the hero who touches a coin gets its gold');
  // Whack-a-bot: nine holes; stomping a bot pays, a bomb bot costs (never below zero).
  const w = MG.newMiniGame('whack', 5, 1, 0, 0, 1);
  ok(w.holes.length === 9, 'whack-a-bot: nine holes');
  for (let i = 0; i < 200; i++) MG.miniStep(w, 1 / 60, [hero(100, 100)]);
  let paid = 0;
  let bombs = 0;
  for (let i = 0; i < 1200 && w.phase === 1; i++) {
    const up = w.items.find((it) => it.by === -1 && it.age > T.whackRise);
    const e2 = MG.miniStep(w, 1 / 60, [up ? hero(up.x, up.z) : hero(100, 100)]);
    for (const e of e2) if (e.type === 'whack') paid++;
    else if (e.type === 'bomb') bombs++;
  }
  ok(paid > 5 && w.gold[0] >= 0 && w.hits[0] === paid, `whack-a-bot: ${paid} bots whacked, ${bombs} bombs, ${w.gold[0]} gold`);
  // Net round trip draws the same pieces.
  const back = MG.miniFromNet(JSON.parse(JSON.stringify(MG.miniNet(w))), null)!;
  ok(back.kind === 'whack' && back.items.length === w.items.length && back.holes.length === 9 && back.gold[0] === w.gold[0], 'mini-game snapshot round trip');
  while (w.phase !== 2 || w.t < T.outro) MG.miniStep(w, 1 / 60, [hero(100, 100)]);
  ok(MG.miniOver(w), 'mini-game ends after its play time and results');
  ok(MG.miniKindFor(1234, 3) === MG.miniKindFor(1234, 3) && new Set([1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) => MG.miniKindFor(s * 31, 2))).size === 3, 'mini-game kind is seeded and all three come up');
}

// ------------------------------------------------------------------ ghosts (pure)
const mkGhost = (week: string, name: string, rate: number, secs = 90) => {
  const rec = new GH.GhostRecorder(week, name, 'ace');
  rec.event(0, GH.GhostEv.StageStart, 1);
  for (let t = 0; t <= secs; t += 1 / 60) rec.step(t, Math.cos(t) * 8 - 3.33, Math.sin(t * 0.7) * 5 + 1.27, t * 1.3, t * rate, 1);
  rec.event(40, GH.GhostEv.Level, 5);
  rec.event(secs, GH.GhostEv.Death, 1);
  return rec.finish(secs * rate, 1, secs);
};
{
  const g = mkGhost('2026-W42', 'Mansour', 50);
  ok(g.xs.length >= 900 && g.xs.length <= 901 && g.scores.length >= 90, `recording: 10 Hz positions (${g.xs.length}) and score once a second (${g.scores.length})`);
  const bytes = GH.encodeGhost(g);
  const d = GH.decodeGhost(bytes);
  let maxPos = 0;
  let maxF = 0;
  for (let i = 0; i < g.xs.length; i++) {
    maxPos = Math.max(maxPos, Math.abs(d.xs[i] - g.xs[i]), Math.abs(d.zs[i] - g.zs[i]));
    const df = Math.abs(Math.atan2(Math.sin(d.fs[i] - g.fs[i]), Math.cos(d.fs[i] - g.fs[i])));
    maxF = Math.max(maxF, df);
  }
  ok(d.week === g.week && d.name === 'Mansour' && d.hero === 'ace' && d.score === g.score && d.stage === 1 && Math.abs(d.length - 90) < 0.06, 'ghost decode: header round trip');
  ok(maxPos < 0.051 && maxF < (Math.PI * 2) / 256 + 1e-6, `ghost decode: positions within 5 cm (${maxPos.toFixed(3)}), facing within one step (${maxF.toFixed(4)} rad)`);
  ok(JSON.stringify(d.scores) === JSON.stringify(g.scores) && d.events.length === 3 && d.events[1].type === GH.GhostEv.Level && d.events[1].value === 5 && Math.abs(d.events[1].t - 40) < 0.06, 'ghost decode: scores and events round trip');
  ok(bytes.length < g.xs.length * 4, `compact: ${bytes.length} bytes for 90 s (${(bytes.length / 90).toFixed(0)} B/s)`);
  const code = GH.ghostCode(g);
  const back = GH.readGhostCodeSync(`  here's my ghost:\n${code}\n`);
  ok(!!back && back.score === g.score && back.xs.length === g.xs.length, 'share code: plain round trip, surrounding text ignored');
  const small = await GH.ghostCodeSmall(g);
  const back2 = await GH.readGhostCode(small);
  ok(small.startsWith('ISG1z.') && small.length < code.length && back2.xs.length === g.xs.length && back2.score === g.score, `packed code: ${small.length} vs ${code.length} characters, round trip`);
  let threw = '';
  try {
    await GH.readGhostCode('hello');
  } catch (e) {
    threw = (e as Error).message;
  }
  ok(threw.includes('ISG1'), 'a bad code says what a ghost code looks like');
  // Pose and delta.
  const pose = GH.ghostPose(g, 10.05);
  ok(Math.abs(pose.x - (Math.cos(10.05) * 8 - 3.33)) < 0.1 && pose.visible && pose.stage === 1, 'ghost pose interpolates between samples');
  ok(!GH.ghostPose(g, 91).visible, 'ghost vanishes after its death');
  const ahead = GH.ghostDelta(g, 30, 2000); // ghost had 1500 at 30 s, reached 2000 at 40 s
  ok(ahead.score === 500 && ahead.seconds !== null && Math.abs(ahead.seconds - 10) < 0.15, `delta: +500 pts, ${ahead.seconds} s ahead`);
  const behind = GH.ghostDelta(g, 30, 1000); // ghost reached 1000 at 20 s
  ok(behind.score === -500 && behind.seconds !== null && Math.abs(behind.seconds + 10) < 0.15, `delta: -500 pts, ${behind.seconds} s behind`);
  ok(GH.betterGhost(g, mkGhost('2026-W42', 'B', 60)).name === 'B' && GH.betterGhost(null, g) === g, 'better ghost: higher score wins');
  // Store: best per week, rival.
  ok(ghostStore.keepMine(g) && !ghostStore.keepMine(mkGhost('2026-W42', 'Mansour', 20)) && ghostStore.mine('2026-W42')?.score === g.score, 'store keeps only the week\'s best run');
  ghostStore.setRival(mkGhost('2026-W42', 'Friend', 70));
  ok(ghostStore.rivalFor('2026-W42')?.name === 'Friend' && ghostStore.rivalFor('2026-W43') === null, 'rival shows on its own week only');
  ghostStore.setRival(null);
}

// ------------------------------------------------------------------ a real solo Game
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { settings } = await import('../src/game/settings');
const { ENEMIES } = await import('../src/data/enemies');
const { modesForce } = await import('../src/game/systems/modes');
const { ROUTE_NODES, ROLLABLE } = await import('../src/data/routeNodes');
const { routeLayer } = await import('../src/game/route');

settings.autoFire = false;
cheats.god = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
type G = InstanceType<typeof Game>;
const solo = (seed: number): G => {
  const g = mk();
  g.startRun({ seed, difficulty: 'normal' });
  if (g.mode === 'shop') g.closeShop();
  return g;
};
const run = (g: G, n: number, f?: () => void) => {
  for (let i = 0; i < n; i++) {
    g.xp = 0;
    g.xpNext = 1e9;
    g.update(1 / 60);
    f?.();
    if (i % 10 === 0) g.render(1, 1 / 6);
  }
};

// Rhythm: wind-ups end on beat steps only; enemies pulse.
{
  modesForce.rhythm = true;
  const g = solo(31);
  run(g, 2);
  ok(g.modes.rhythm && g.modes.clock.bpm === 128, `rhythm stage on (${g.modes.clock.bpm} BPM)`);
  const p = g.hero.player;
  for (let i = 0; i < 12; i++) g.enemies.spawn(ENEMIES[i % 2 ? 'bopper' : 'shooter'], p.x + Math.cos(i) * 5, p.z + Math.sin(i) * 5, g.spawnOpts({ instant: true }));
  const prev = new Map<unknown, string>();
  let ends = 0;
  let offBeat = 0;
  run(g, 600, () => {
    const crossedNow = !g.enemyCtx.beatHold;
    for (const e of g.enemies.list) {
      if (!e.active) continue;
      const was = prev.get(e);
      if (was === 'windup' && e.state !== 'windup' && e.def.behavior !== 'exploder') {
        ends++;
        if (!crossedNow) offBeat++;
      }
      prev.set(e, e.state);
    }
  });
  ok(ends >= 5 && offBeat === 0, `attacks land on the beat: ${ends} wind-ups ended, ${offBeat} between beats`);
  ok(Math.abs(g.modes.beat - (g.modes.rt * 128) / 60) < 1e-6, 'beat = stage rhythm time x tempo');
  // On-beat kill: x3 score.
  const killAt = (beat: number) => {
    g.modes.beat = beat;
    const e = g.enemies.spawn(ENEMIES.swarmer, p.x + 3, p.z, g.spawnOpts({ instant: true }));
    const s0 = g.score;
    g.killEnemy(e, 'buster', g.hero);
    return g.score - s0;
  };
  const off = killAt(10.5);
  const on = killAt(11.02);
  ok(on > off * 2.5 && g.modes.onBeat[0] >= 1, `on-beat kill scores x${(on / off).toFixed(1)} (${on} vs ${off})`);
  modesForce.rhythm = false;
  g.loadStage(2);
  run(g, 2);
  ok(!g.modes.rhythm && g.enemyCtx.beatHold === undefined, 'next stage (forced off): back to normal');
  modesForce.rhythm = null;
}

// Pacifist road.
{
  const g = solo(77);
  g.route.force = 'pacifist';
  g.loadStage(2);
  run(g, 2);
  const M = g.modes;
  ok(M.pacifist && g.director.duration === P.pacifistTuning.seconds && g.bossField.miniStage === 2, `pacifist road: ${g.director.duration} s stage, no mini-boss`);
  const p = g.hero.player;
  const e = g.enemies.spawn(ENEMIES.chonk, p.x + 3, p.z, g.spawnOpts({ instant: true }));
  const hp = e.hp;
  ok(g.damage(e, 500, { source: 'buster' }, g.hero) === 0 && e.hp === hp, 'pacifist: hero damage is blocked');
  ok(g.nearestEnemy(p.x, p.z, 20) === null, 'pacifist: auto weapons find no target');
  g.hero.bombCharge = 1;
  g.tryBomb(g.hero);
  ok(g.hero.bombCharge === 1 && g.hero.bombT < 0, 'pacifist: the special stays holstered');
  run(g, 120);
  ok((g.hero.damageBy.buster ?? 0) === 0, 'pacifist: weapons dealt nothing in 2 s of fighting');
  const gold = g.hero.gold;
  const relics = g.hero.relics.length;
  g.director.time = g.director.duration - 0.05;
  run(g, 4); // the timer runs out, the stage clears, the next step pays
  ok((g.mode === 'cleared' || g.mode === 'levelup') && !g.boss && g.director.bossSpawned && g.stage === 2, 'pacifist: no boss, the stage clears when the timer runs out');
  ok(g.hero.gold >= gold + P.pacifistTuning.gold && g.hero.relics.length === relics + 1, `pacifist reward: +${g.hero.gold - gold} gold, a relic`);
  run(g, 1);
  const offers = g.hero.offers;
  ok(g.mode === 'levelup' && offers.length > 0 && offers.filter((o) => o.rarity === 'legendary').length >= 1, `pacifist reward: a legendary level-up card (${offers.map((o) => `${o.name}:${o.rarity}`).join(', ')})`);
  // A kill forfeits.
  const h = solo(78);
  h.route.force = 'pacifist';
  h.loadStage(3);
  run(h, 2);
  const pe = h.player;
  h.killEnemy(h.enemies.spawn(ENEMIES.swarmer, pe.x + 3, pe.z, h.spawnOpts({ instant: true })), 'nuke', h.hero);
  const gold2 = h.hero.gold;
  h.director.time = h.director.duration - 0.05;
  run(h, 4);
  ok((h.mode === 'cleared' || h.mode === 'levelup') && h.hero.gold - gold2 < P.pacifistTuning.gold && h.modes.pacKills[0] === 1, 'pacifist: a kill forfeits the reward');
  h.route.force = null;
}

// Mini-games: the Bonus Arcade plays, pays and opens the portal.
for (const kind of MG.MINI_KINDS) {
  const g = solo(500 + kind.length);
  run(g, 5);
  g.startMiniGame(kind);
  const gold0 = g.hero.gold;
  const p = g.hero.player;
  let steps = 0;
  while (g.modes.mg && steps < 60 * 30) {
    const mg = g.modes.mg;
    const it = mg.items.find((x) => x.by === -1 && x.kind !== 2 && x.age > 0.3);
    if (it && kind !== 'gallery') {
      p.pos.x = p.prev.x = it.x;
      p.pos.z = p.prev.z = it.z;
    }
    // Gallery: aim the mouse at the target and hold the left button.
    (g.input as any).device = 'kbm';
    (g.input as any).mouseButtons = it && kind === 'gallery' ? 1 : 0;
    if (it) g.mouseAimPoint = () => g.aimHit.set(it.x, 1, it.z);
    g.update(1 / 60);
    steps++;
    if (steps % 10 === 0) g.render(1, 1 / 6);
  }
  ok(!g.modes.mg && g.mode === 'portal' && g.portal.active && g.hero.gold > gold0, `${kind}: ${g.hero.gold - gold0} gold in ${(steps / 60).toFixed(1)} s, then the portal`);
}

// Route map: the new roads roll, the hidden one reads ??? until picked.
{
  ok(ROLLABLE.includes('rhythm') && ROLLABLE.includes('arcade') && ROLLABLE.includes('pacifist') && !ROLLABLE.includes('secret'), 'route: rhythm, arcade and (rarely) pacifist roads roll; ??? is only a look');
  let seed = 1;
  let stage = 2;
  let idx = -1;
  find: for (seed = 1; seed < 3000; seed++) for (stage = 2; stage < 9; stage++) {
    idx = routeLayer(seed, stage).nodes.findIndex((n) => n.kind === 'pacifist');
    if (idx >= 0) break find;
  }
  const g = solo(seed);
  const v = g.routeViewFrom({ phase: 'map', stage: stage - 1, seed, path: [0, 0], options: [], votes: [], tl: -1, ev: 0 }, -1);
  const layer = v.layers.find((l) => l.stage === stage)!;
  ok(idx >= 0 && layer.nodes[idx].kind === 'secret' && ROUTE_NODES.secret.name === '???', `route: the pacifist road on stage ${stage} (seed ${seed}) shows as ???`);
  const path = [0, 0];
  path[stage] = idx;
  const v2 = g.routeViewFrom({ phase: 'map', stage, seed, path, options: [], votes: [], tl: -1, ev: 0 }, -1);
  ok(v2.layers.find((l) => l.stage === stage)!.nodes[idx].kind === 'pacifist', 'route: once taken it shows its name');
}

// Weekly ghost: recorded and kept at the end of the run.
{
  modesForce.ghostAnyMode = true;
  const g = solo(9);
  run(g, 2);
  ok(!!g.modes.rec, 'ghost run: recording');
  g.score = 1234;
  run(g, 60 * 12);
  g.modesRunEnd();
  const mine = ghostStore.mine('test');
  ok(!!mine && mine.score >= 1234 && mine.xs.length >= 100 && mine.events.some((e) => e.type === GH.GhostEv.StageStart), `ghost kept: ${mine?.xs.length} samples, score ${mine?.score}`);
  // Next run races it.
  const g2 = solo(10);
  run(g2, 2);
  ok(g2.modes.rival?.score === mine?.score && g2.modes.rivalOwn, 'next weekly run races your best ghost');
  modesForce.ghostAnyMode = false;
}

ok(errors.length === 0, 'no runtime errors' + (errors.length ? ':\n' + errors.slice(0, 3).join('\n') : ''));
process.exit(process.exitCode ?? 0);
