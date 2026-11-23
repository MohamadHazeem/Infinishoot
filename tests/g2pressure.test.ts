import { dom, seedRandom } from './jsdomEnv';
import { ok } from './check';

if (process.env.G2_PRESSURE_BOT) {
  const { Game } = await import('../src/game/game');
  const { Input } = await import('../src/core/input');
  const { installBot } = await import('../src/dev/bot');
  const { settings } = await import('../src/game/settings');
  const seed = Number(process.env.G2_PRESSURE_BOT);
  seedRandom(seed);
  const input = new Input(document.querySelector<HTMLCanvasElement>('#game')!);
  const g = new Game(input, 16 / 9, document.querySelector<HTMLElement>('#hud')!, document.querySelector<HTMLElement>('#reticle')!);
  Object.assign(settings, { hero: 'rookie', pet: 'none', cinematics: 'off', bossIntros: false, finishers: false, tips: false });
  g.startRun({ seed, difficulty: 'normal' });
  if (g.mode === 'shop') g.closeShop();
  installBot(g, input);
  const rows = Array.from({ length: 4 }, () => ({ alive: 0, samples: 0, elites: 0, power: 0, intensity: 0 }));
  const spawn = g.enemies.spawn.bind(g.enemies);
  g.enemies.spawn = (def, x, z, opts) => {
    if (opts?.elite && g.stage <= rows.length) rows[g.stage - 1].elites++;
    return spawn(def, x, z, opts);
  };
  let bosses: string[] = [];
  for (let sec = 0; sec < 2400 && g.stage <= rows.length && !g.victories; sec++) {
    const result = (dom.window as any).botRun(1, true);
    bosses = result.bosses;
    if (g.stage <= rows.length && g.mode === 'fight' && !g.director.bossSpawned) {
      const row = rows[g.stage - 1];
      row.alive += g.enemies.activeCount;
      row.power += g.director.adaptive.power.score;
      row.intensity += g.director.adaptive.intensity;
      row.samples++;
    }
  }
  console.log('G2_PRESSURE_BOT', seed, rows.map(row => ({ meanAlive: +(row.alive / row.samples).toFixed(1), elites: row.elites, power: +(row.power / row.samples).toFixed(2), intensity: +(row.intensity / row.samples).toFixed(2) })), bosses);
  ok(g.victories > 0, 'god bot clears the measured loop');
}

const { AdaptivePace, PowerWindow, Director, adaptiveTuning, directorTuning } = await import('../src/game/director');
const { pressureChampion } = await import('../src/game/systems/spawning');
const { elites2Tuning } = await import('../src/data/eliteMods');
const { enrageTarget, enrageLevel, enrageDamage, enrageSpeed } = await import('../src/game/bossRules');
const { updateEnrage, enragedEnemyStep, applyBossNet, bossNet, bossHud } = await import('../src/game/systems/bossFight');
const { ENEMIES } = await import('../src/data/enemies');
const { Rng } = await import('../src/core/rng');
const { Game } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { setLanguage } = await import('../src/i18n');

function fight(kills = 2, spawns = 2, damage = 0, full = 1, idle = 1, ttk = 2) {
  const w = new PowerWindow();
  for (let s = 0; s < 45; s++) {
    for (let n = 0; n < spawns; n++) w.spawn();
    w.hurt(damage / 60);
    if (s === 15 || s === 30) w.elite(ttk);
    w.step(1, kills, full, idle);
  }
  return w;
}
const strong = fight();
ok(strong.score > 0.95 && strong.score <= 1, 'clearing arrivals at full life with quick elite kills yields high power');
ok(fight(2, 4).score < strong.score * 0.51, 'twice the successful arrivals at the same kill rate lowers power');
ok(fight(2, 2, 1).score < strong.score && fight(2, 2, 0, 0).score < strong.score, 'landed damage and time at full life each affect the window');
ok(fight(2, 2, 0, 1, 0).score < strong.score && fight(2, 2, 0, 1, 1, 30).score < strong.score, 'idle survival and average elite kill time each affect the window');
ok(fight(0).score === 0, 'standing safely in an empty or uncleared arena cannot earn power');
for (let s = 0; s < 45; s++) strong.step(1, 0, 0, 0);
ok(strong.score === 0, 'observations age out after 45 seconds');
const warmup = new PowerWindow();
for (let s = 0; s < 44; s++) { warmup.spawn(); warmup.step(1, 1, 1, 1); }
ok(!warmup.ready, 'part of the first window cannot change the wave mix');
warmup.step(1, 0, 1, 1);
ok(warmup.ready, 'the full 45-second window enables pressure');

const pace = new AdaptivePace();
pace.assist = false;
pace.power.score = 1;
pace.power.ready = true;
for (let i = 0; i < 2400; i++) {
  const before = pace.pressure;
  pace.step(1 / 60, 1, 1, 4);
  if (pace.pressure - before > adaptiveTuning.rise / 60 + 1e-9) throw Error('pressure rose too quickly');
}
ok(pace.pressure === adaptiveTuning.max, 'sustained team power reaches the ceiling smoothly');
pace.hurt(0.45, 0.1, false, 4);
for (let i = 0; i < 3600; i++) pace.step(1 / 60, 0.1, 4, 4);
ok(pace.pressure === 1, 'one injured teammate removes the surplus even while the other three keep killing');
pace.assist = true;
pace.hurt(0.1, 0.1, false);
for (let i = 0; i < 180; i++) pace.step(1 / 60, 0.1, 0);
ok(pace.pressure === adaptiveTuning.min, 'Assist retains its below-baseline near-death breather');

for (const [stage, share] of [[1, adaptiveTuning.openingMix], [2, adaptiveTuning.secondStageMix]]) {
  const opening = new AdaptivePace();
  opening.assist = false;
  opening.power.score = 1;
  for (let s = 0; s < 45; s++) opening.step(1, 1, 2, 1, stage);
  ok(opening.pressure === 1, 'healthy early kills alone cannot raise pressure before the window is ready');
  opening.power.ready = true;
  for (let s = 0; s < 60; s++) opening.step(1, 1, 2, 1, stage);
  ok(opening.intensity === share && Math.abs(opening.pressure - (1 + share * (adaptiveTuning.max - 1))) < 1e-9, 'early crowd and refill share the measured stage cap');
}

function scheduled(pressure: number, intensity = pressure > 1 ? 1 : 0) {
  const d = new Director();
  d.start(3);
  d.adaptive.assist = false;
  d.adaptive.pressure = pressure;
  d.adaptive.intensity = intensity;
  const rng = new Rng(812);
  rng.range = (lo, hi) => (lo + hi) / 2; // Compare the cadence with identical ring jitter.
  let elites = 0, shooters = 0, enemies = 0;
  for (let i = 0; i < 14400; i++) {
    for (const req of d.update(1 / 60, 0, () => 0, rng)) {
      if (req.kind !== 'enemy') continue;
      enemies++;
      if (req.elite) elites++;
      if (req.def.behavior === 'shooter') shooters++;
    }
  }
  return { target: d.targetAlive, rings: d.ringsSent, elites, enemies, shooters: shooters / enemies };
}
const baseline = scheduled(1), pushed = scheduled(adaptiveTuning.max);
ok(pushed.target > baseline.target && pushed.target <= directorTuning.aliveCap, 'pressure raises the alive target within the original cap');
ok(pushed.rings > baseline.rings && pushed.elites > baseline.elites && pushed.shooters > baseline.shooters, 'a strong team receives more rings, elites and a higher shooter share');
const cruising = scheduled(1.18, 0);
ok(cruising.target > baseline.target && cruising.enemies === baseline.enemies, 'a cruising team keeps its larger crowd target without doubling the refill bonus');
const capped = new Director();
capped.start(4);
capped.players = 8;
capped.time = 210;
const hp = capped.hpMul;
capped.adaptive.pressure = adaptiveTuning.max;
ok(capped.targetAlive === directorTuning.aliveCap && capped.hpMul === hp, 'pushing an eight-player field against its cap never converts surplus into health');

const roll = 1.5 * elites2Tuning.championChance;
ok(!pressureChampion(2, 0, 1) && !pressureChampion(3, roll, 0) && pressureChampion(3, roll, 1), 'pressure boosts champion odds only after their existing unlock');
ok(!pressureChampion(3, 2 * elites2Tuning.championChance, 1), 'champion chance tops out at twice baseline');

const target = enrageTarget(1, 'normal');
ok(enrageTarget(4, 'normal') > target && enrageTarget(5, 'normal') === target, 'target follows the stage slot each loop');
ok(enrageTarget(1, 'easy') === target + 90 && enrageTarget(1, 'assist') === target + 90, 'Assist uses the delayed target, including the legacy difficulty ID');
ok(enrageLevel(target - 0.01, target) === 0 && enrageLevel(target, target) === 1 && enrageLevel(target + 19.99, target) === 1 && enrageLevel(target + 20, target) === 2, 'enrage switches exactly at the target and subsequent 20-second boundaries');
ok(enrageDamage(3) === 1.3 && enrageSpeed(100) === 1.4, 'damage steps add ten percent of base and speed remains capped');

const createGame = () => new Game(new Input(document.querySelector<HTMLCanvasElement>('#game')!), 16 / 9, document.querySelector<HTMLElement>('#hud')!, document.querySelector<HTMLElement>('#reticle')!);
const g = createGame();
g.startRun({ seed: 42, difficulty: 'normal' });
if (g.mode === 'shop') g.closeShop();
const director = g.director;
const rng = new Rng(42);
director.adaptive.intensity = 1;
director.update(48, directorTuning.aliveCap, () => 0, rng);
const warningsSeen: string[] = [];
const toast = g.vfx.toast;
g.vfx.toast = (message) => warningsSeen.push(message);
director.adaptive.intensity = 0;
director.time = director.nextRingAt - 3;
g.updateDirector2(1 / 60);
g.updateDirector2(1 / 60);
director.time = director.nextEliteAt - 3;
g.updateDirector2(1 / 60);
g.updateDirector2(1 / 60);
director.adaptive.assist = true;
director.adaptive.breather = 2;
director.update(1.2, directorTuning.aliveCap, () => 0, rng);
g.updateDirector2(1 / 60);
g.vfx.toast = toast;
ok(warningsSeen.some(s => s.includes('SWARM')) && warningsSeen.some(s => s.includes('ELITE')) && warningsSeen.length === 2, 'accelerated waves each warn once even after an Assist breather moves the deadline');
director.start(1);
g.spawnBoss(ENEMIES.king);
const boss = g.boss!, d = g.director;
const baseSpeed = boss.speedMul, baseDamage = boss.dmgMul;
updateEnrage(g, 1);
ok(d.bossAge === 0, 'entrance does not consume combat time');
boss.roarT = 0;
boss.state = 'windup';
boss.t = 0.75;
updateEnrage(g, target);
ok(Math.abs(boss.dmgMul - baseDamage * 1.1) < 1e-9 && boss.speedMul > baseSpeed && boss.t === 0.75, 'first enrage speeds up the boss and scales damage without shortening a live tell');
updateEnrage(g, 20);
ok(d.enrageStep === 2 && d.bonusPattern && boss.state === 'windup', 'the next pattern waits behind the active attack');
boss.state = 'move';
boss.timerA = 2;
updateEnrage(g, 1 / 60);
ok(boss.timerA === 0 && !d.bonusPattern && d.resumePatternAt > d.bossAge, 'bonus arms the native attack selector and preserves its regular deadline');
const warnings = d.enrageStep;
updateEnrage(g, 1 / 60);
ok(d.enrageStep === warnings && Math.abs(boss.dmgMul - baseDamage * 1.2) < 1e-9, 'subsequent ticks do not apply the damage step twice');
boss.twistT = 0;
const mortar = g.enemies.spawn(ENEMIES.mortar, 7, 0, { instant: true });
mortar.state = 'windup';
mortar.t = 0;
g.enemyCtx.targets.push({ x: 0, z: 0, radius: 1, alive: true });
enragedEnemyStep(g, 1 / 60);
const shells = ENEMIES.mortar.mortar!;
ok(g.strikes.some(s => s.r === 1.7 && s.t >= 1.3 && Math.abs(s.dmg - 14 * d.dmgMul * 1.2) < 1e-6), 'the King queues a fully warned tremor with the enraged damage');
ok(g.strikes.some(s => s.r === shells.radius && s.dmg === shells.damage * d.dmgMul), 'a mortar in the same step queues its ordinary shell damage');
const { SnapDecoder } = await import('../src/net/snapCodec');
const decoded = new SnapDecoder().decode(g.buildSnapshot(g.hero, []));
const net = decoded!.bx as ReturnType<typeof bossNet>;
ok(net.rage?.[0] === 2 && net.rage[1] === 20, 'the host boss clock survives the binary snapshot codec');
g.role = 'client';
const before = d.bossAge;
updateEnrage(g, 80);
ok(d.bossAge === before, 'client cannot advance enrage or queue attacks');
d.enrageStep = d.enrageIn = 0;
applyBossNet.call(g, net);
await setLanguage('ar');
const mirrored = bossHud.call(g, { name: 'King Bopper', hp01: 1 });
ok(d.enrageStep === 2 && !!mirrored?.enrage && /[\u0600-\u06ff]/.test(mirrored.enrage) && mirrored.enrage.includes('0:20'), 'late snapshot restores the localized Arabic countdown');
applyBossNet.call(g, { ...net, rage: undefined });
ok(d.enrageStep === 0 && d.enrageIn === 0, 'older snapshots clear the previous clock');
await setLanguage('en');
g.role = 'solo';
d.enrageStep = 2;
d.bossAge = target + 20.5;
d.lastBossTime = 100;
d.time = 98;
updateEnrage(g, 1 / 60);
ok(d.enrageStep === 1 && Math.abs(boss.dmgMul - baseDamage * 1.1) < 1e-6 && !d.bonusPattern, 'rewinding across a threshold reconciles the timer, damage and queued pattern');

const { startArchitect, architectState } = await import('../src/game/systems/architect');
const { enragedArchitectStep } = await import('../src/game/systems/bossFight');
const { architectTuning } = await import('../src/game/architect/model');
g.role = 'solo';
startArchitect(g, true);
const state = architectState(g), difficulty = g.difficulty;
state.pause = state.pulse = 0;
state.cycleTime = 4;
g.boss!.dmgMul = difficulty.enemyDmg * enrageDamage(2);
enragedArchitectStep(g, 1 / 60);
ok(g.bullets.count > 0 && Math.abs(g.bullets.damage[0] - architectTuning.bulletDamage * g.boss!.dmgMul) < 1e-4 && g.difficulty === difficulty, 'the Architect scales its own projectiles without changing the run difficulty');
