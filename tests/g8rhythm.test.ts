import assert from 'node:assert/strict';
import { dom, seedRandom, simTimers, jsdomErrors } from './jsdomEnv';

dom.reconfigure({ url: 'http://localhost/?season=off' });
seedRandom(14);
simTimers.install();
const { Game } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { inCombatWindow, beatCombatTuning } = await import('../src/game/beatCombat');
const { maestroRoute } = await import('../src/game/bossesMaestro');
const { ENEMIES } = await import('../src/data/enemies');
const { settings } = await import('../src/game/settings');
const { music } = await import('../src/audio/music');
const { packEnemies, unpackEnemies } = await import('../src/net/codec');
const { setLanguage } = await import('../src/i18n');
const { installBot } = await import('../src/dev/bot');
const input = new Input(document.querySelector('#game')!);
const g = new Game(input, 16 / 9, document.querySelector('#hud')!, document.querySelector('#reticle')!);
installBot(g, input);
settings.cinematics = 'off';
settings.pet = 'none';
settings.musicVolume = 0;
const dt = 1 / 60;
const update = g.update;
g.update = function (step) { simTimers.advance(step * 1000); update.call(this, step); };
Object.defineProperty(window.performance, 'now', { configurable: true, value: performance.now.bind(performance) });
Object.defineProperty(performance, 'now', { configurable: true, value: () => simTimers.now });

for (const bpm of [108, 126, 144]) {
  assert(inCombatWindow(18 + 0.044 * bpm / 60, bpm));
  assert(inCombatWindow(18 - 0.044 * bpm / 60, bpm));
  assert(!inCombatWindow(18 + 0.046 * bpm / 60, bpm));
  assert(!inCombatWindow(18 - 0.046 * bpm / 60, bpm));
}
const routes = Array.from({ length: 512 }, (_, i) => maestroRoute(i, 2, 'rhythm')).filter(Boolean).length;
assert(routes > 90 && routes < 165);
assert(!maestroRoute(42, 4, 'rhythm') && !maestroRoute(42, 2, 'pacifist'));

g.startRun({ seed: 14, difficulty: 'normal' });
g.closeShop();
g.loadStage(2);
g.director.hold = true;
g.director.bossSpawned = true;
g.enemies.clear();
g.beatCombat.forceMaestro = true;
g.spawnBoss(ENEMIES.rex);
const maestro = g.boss!;
assert.equal(maestro.def.id, 'maestro');
assert.equal(maestro.contactDamage, 0);
unpackEnemies(packEnemies([maestro]), r => assert.equal(r.def.id, 'maestro'));
const b = g.beatCombat, h = g.hero;
b.tick(g, dt);
assert.equal(b.bpm, 108);
assert.equal(music.playing, null);
b.beat = 1;
h.ctx.firing = true;
const weapon = h.weapons.find(w => w.def.id === 'buster')!;
const first = g.bullets.count;
weapon.update(dt, h.ctx);
const base = g.bullets.damage[first];
b.release(g, h, weapon, first);
assert(Math.abs(g.bullets.damage[first] - base * (1 + beatCombatTuning.damage)) < 0.0001);
assert.equal(h.beatBonusBase, base * beatCombatTuning.damage);
b.beat = 1.5;
b.volley(g, h, first);
assert(Math.abs(g.bullets.damage[first] - base * (1 + beatCombatTuning.damage)) < 0.0001);
h.player.spendDash();
const cd = h.player.dashCd;
b.refund(g, h, 0.22);
assert.equal(h.player.dashCd, cd);
b.beat = 2;
b.refund(g, h, 0.22);
assert.equal(h.player.dashCd, cd - 0.22);
settings.beatCombat = false;
b.refund(g, h, 0.45);
assert.equal(h.player.dashCd, cd - 0.22);
settings.beatCombat = true;

maestro.state = 'move';
maestro.roarT = 0;
for (const phase of [1, 2, 3]) {
  maestro.phase = phase;
  b.tick(g, dt);
  assert.equal(b.bpm, [108, 126, 144][phase - 1]);
  b.beat = 0;
  b.score.step(g, dt);
  b.beat = 4;
  b.score.step(g, dt);
  assert.equal(g.strikes.length, phase, 'one, two or three marked drumheads');
  assert.equal(g.enemies.zones.length, phase, 'every damaging disc has its footprint');
  assert(g.strikes.every(s => s.t >= 0.8));
  const x = g.strikes[0].x;
  h.player.pos.x += 2;
  b.beat = 5.7;
  b.score.step(g, dt);
  g.updateStrikes(dt);
  assert.equal(g.strikes[0].x, x, 'warnings stay where they were aimed');
  const marks = b.score.snapshot();
  b.score.mirror(g, marks);
  assert.equal(g.enemies.zones.length, phase);
  b.beat = 6;
  b.score.step(g, dt);
  g.updateStrikes(dt);
  assert.equal(g.strikes.length, phase - 1, 'first accent lands on beat three');
  b.beat = 7;
  b.score.step(g, dt);
  g.updateStrikes(dt);
  assert.equal(g.strikes.length, 0, 'response lands on beat four');
}
const snap = b.snapshot(h);
g.role = 'client';
b.mirror(g, snap);
b.clientTick(dt);
assert(Math.abs(b.beat - (7 + 144 / 3600)) < 0.0001);
const stamina = h.player.dashCd;
b.refund(g, h, 0.45);
assert.equal(stamina, h.player.dashCd);
g.role = 'solo';
await setLanguage('ar');
b.present(g);
assert.equal(g.reticle.querySelector('.beat-accuracy')?.getAttribute('aria-label'), 'توقيت النبضة');
settings.beatCombat = false;
b.present(g);
assert(g.reticle.querySelector<HTMLElement>('.beat-accuracy')!.hidden);
await setLanguage('en');

if (!process.env.G8_PILOT) {
  const guest = g.makeHero(1, 'Guest', h.unlocked, 'guest');
  g.setHeroes([h, guest]);
  g.role = 'host';
  b.beat = 8;
  assert(b.accurate(g, guest) && !b.accurate(g, h), 'a guest can opt in while the host opts out');
  g.onHostMessage('guest', { t: 'beatPref', enabled: false });
  assert(!b.accurate(g, guest) && !(b.snapshot(guest)[3] & 2));
  g.onHostMessage('unknown', { t: 'beatPref', enabled: true });
  assert(!b.accurate(g, guest), 'an unrecognized sender cannot change another preference');
}

if (process.env.G8_PILOT) {
  // Matched mortal encounters; the optional coach only holds an already-full charged shot
  // until the next visible pulse. Aiming, dodging, parrying and all damage remain in skillRun.
  const scenario = process.env.G8_PILOT;
  const run = (window as unknown as { skillRun: ReturnType<typeof import('../src/dev/skillBot').createSkillRun> }).skillRun;
  seedRandom(14);
  settings.beatCombat = false;
  b.forceMaestro = false;
  g.startRun({ seed: 14, difficulty: 'normal' });
  let approach = run(1);
  for (let n = 0; n < 750 && !approach.died && !(g.stage === 2 && g.director.remaining < 4); n++)
    approach = run(1);
  assert.equal(g.stage, 2, 'earned the stage-two kit and reached the encounter');
  assert(!approach.died);
  const id = scenario === 'rex' ? 'rex' : 'maestro';
  b.forceMaestro = id === 'maestro';
  let fightKit = '';
  const encounterUpdate = g.update;
  g.update = function (step) {
    const active = this.boss?.active && this.boss.def.id === id;
    if (active && !fightKit) fightKit = this.hero.weapons.map(w => w.def.id + w.level).join(' ');
    settings.beatCombat = !!active && scenario !== 'off';
    encounterUpdate.call(this, step);
  };
  let charges = 0, timedCharges = 0, chargeBonus = 0;
  const volley = b.volley;
  b.volley = function (world, hero, first) {
    const base = hero.beatBonusBase;
    volley.call(this, world, hero, first);
    if (world.boss?.def.id === id && hero.ctx.soundSource?.def.id === 'charge') {
      charges++;
      if (hero.beatBonusBase > base) timedCharges++;
      chargeBonus += hero.beatBonusBase - base;
    }
  };
  if (scenario === 'timed') {
    const charge = g.hero.weapons.find(w => w.def.id === 'charge') as import('../src/game/weapons/charge').ChargeShot;
    const poll = input.poll.bind(input);
    input.poll = () => {
      if (g.boss?.def.id === id && input.virtual.active && charge.charge >= 1 && !input.virtual.buttons[2] &&
          !inCombatWindow(b.beat + b.bpm * dt / 60, b.bpm)) input.virtual.buttons[2] = true;
      poll();
    };
  }
  let report = run(1);
  for (let n = 1; n < 140 && !report.died && !report.bosses.some(e => e.id === id && e.killed); n++) report = run(1);
  const fight = report.bosses.find(e => e.id === id);
  console.log('G8 PILOT', JSON.stringify({ scenario, fight, fightKit, charges, timedCharges, chargeBonus,
    bonusBase: g.hero.beatBonusBase, hp: report.hp, died: report.died, finalKit: report.weapons }));
  assert(fight?.killed, 'mortal pilot beats the encounter');
}
assert.deepEqual(jsdomErrors, []);
console.log('ok   beat windows, fixed warnings, three tempos, volley timing, personal settings and host clock');
