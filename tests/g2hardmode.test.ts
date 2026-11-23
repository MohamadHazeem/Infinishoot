import assert from 'node:assert/strict';
import './jsdomEnv';

// Exercise the settings loader against a pre-Gate-2 store, before importing the game.
localStorage.setItem('infinishoot.settings.v1', JSON.stringify({ difficulty: 'easy' }));
const { settings } = await import('../src/game/settings');
const { DIFFICULTIES, savedDifficulty } = await import('../src/data/modes');
const { Game, cheats, dropTuning } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { coopState } = await import('../src/game/systems/coop2');
const { buildMig, restoreRun } = await import('../src/game/systems/hostmig');
const { timeState } = await import('../src/game/systems/time');
const { timeTuning, rewindBlock } = await import('../src/game/timeRules');
const { ENEMIES } = await import('../src/data/enemies');
const { RELIC_BY_ID } = await import('../src/data/relics');
const { MOD_BY_ID } = await import('../src/data/mods');
const { setLanguage, localize } = await import('../src/i18n');

assert.equal(settings.difficulty, 'easy');
for (const value of ['normal', 'assist', 'hard', 'nightmare', 'legend']) assert.equal(savedDifficulty(value), value);
for (const value of [null, {}, '__proto__', 'constructor', 'unknown']) assert.equal(savedDifficulty(value), 'normal');

const makeGame = () => new Game(new Input(document.querySelector('canvas')!), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const g = makeGame();
const client = makeGame();
const h = g.hero;
const p = h.player;
assert.equal(g.pickDifficulty().id, 'easy');
const rows = [
  ['easy', .7, .6, .8, .6], ['assist', 1, 1, 1, 1], ['normal', 1.4, 1.3, 1.15, 1.5],
  ['hard', 2, 1.6, 1.3, 2.2], ['nightmare', 2.86, 1.97, 1.47, 3.23], ['legend', 3.71, 2.34, 1.64, 4.4],
];
assert.deepEqual(DIFFICULTIES.map(d => [d.id, d.enemyHp, d.enemyDmg, d.enemyCount, d.score]), rows);

cheats.god = false;
for (const d of DIFFICULTIES) {
  const assisted = d.id === 'assist' || d.id === 'easy';
  // A different local preference must never weaken the host's run.
  settings.difficulty = assisted ? 'hard' : 'easy';
  g.startRun({ seed: 42, difficulty: d.id });
  g.closeShop();
  const s = timeState(g);
  assert.equal(s.rewindsUsed, 0);
  assert.equal(h.phoenixUsed, false);
  p.invuln = 0;
  g.hurtHero(h, 9999, p.x + 1, p.z);
  assert.equal(p.hp, p.maxHp - Math.round(p.maxHp * (assisted ? .35 : .50)), d.id + ' hit cap');

  const before = p.hp;
  g.gainXp(g.xpNext);
  assert.equal(p.hp, before + (assisted ? 10 : 0), d.id + ' level-up heal');
  h.revivesLeft = 0;
  p.hp = 1;
  g.updateGameplay(0);
  assert.equal(h.comeback, assisted, d.id + ' comeback');
  s.lastCombo = timeTuning.standCombo;
  assert.equal(g.lastStand(h), assisted, d.id + ' last stand');

  // Observe the actual RNG weight used by an ordinary enemy's drop roll.
  const enemy = g.enemies.spawn(ENEMIES.swarmer, 4, 4, g.spawnOpts({ instant: true }));
  const weights: number[] = [];
  const chance = g.rng.chance;
  g.rng.chance = prob => { weights.push(prob); return false; };
  g.killEnemy(enemy, 'buster', h);
  g.rng.chance = chance;
  const thinning = Math.min(1, dropTuning.dropRef / Math.max(1, g.director.targetAlive));
  assert.ok(weights.includes(thinning * (assisted ? .004 : .002)), d.id + ' heart drops');

  // Record real frames at two world times and consume the charge through the playback.
  g.timeStep(0);
  s.tl.clear();
  g.runTime = 2;
  s.tl.record(g);
  g.runTime = 4;
  s.tl.record(g);
  g.requestRewind(h);
  assert.equal(s.hold?.kind, 'rewind');
  assert.equal((g.timeNet(h).m as number[])[0], 1, d.id + ' charge spent before playback can migrate');
  g.timeStep(timeTuning.rewindPlay + .01);
  assert.equal(s.rewindsUsed, 1);
  g.runTime = 1;
  g.timeStep(0);
  assert.equal(s.rewindsUsed, 1, 'only a run or stage boundary may replenish rewind');
  assert.ok(s.tl.span < timeTuning.rewindMin, 'future frames are discarded after a clock correction');
  const request = { used: 1, history: 5, pvp: false, fighting: true, dead: false };
  assert.equal(rewindBlock(request, d.id), assisted ? 'REWIND USED THIS STAGE' : 'REWIND USED THIS RUN');
  h.relics.push('r_phoenix');
  p.invuln = 0;
  p.hp = 2;
  g.hurtHero(h, 999, p.x + 1, p.z);
  assert.equal(h.phoenixUsed, true, d.id + ' lethal hit spends Frost Totem');
  assert.ok(p.hp > 0 && !p.dead);
  h.synergy.add(MOD_BY_ID.phoenix);
  assert.equal(h.synergy.readout(0), assisted ? 'READY' : 'SPENT', d.id + ' overlapping Phoenix saves');
  g.loadStage(2);
  g.timeStep(0);
  assert.equal(s.rewindsUsed, assisted ? 0 : 1, d.id + ' cross-stage rewind');
  assert.equal(h.phoenixUsed, !assisted, d.id + ' cross-stage Frost Totem');

  const afterStage = g.timeNet(h).m;

  // Run the Mod hook separately, including a sale and repurchase after activation.
  h.startRun(); // applyBuild also rebuilds a returning co-op hero
  assert.equal(h.phoenixUsed, !assisted, d.id + ' build restoration cannot refund the run charge');
  g.startRun({ seed: 42, difficulty: d.id });
  g.closeShop();
  h.synergy.add(MOD_BY_ID.echo);
  h.synergy.add(MOD_BY_ID.phoenix);
  p.hp = 1;
  p.invuln = 0;
  g.hurtHero(h, 999, p.x + 1, p.z);
  assert.equal(p.dead, false);
  assert.equal(p.hp, p.maxHp);
  h.synergy.stageClear();
  assert.equal(h.synergy.readout(1), assisted ? 'READY' : 'SPENT');
  h.synergy.remove(1);
  h.synergy.add(MOD_BY_ID.phoenix);
  assert.equal(h.synergy.readout(1), assisted ? 'READY' : 'SPENT', d.id + ' repurchased plume');
  assert.equal(h.phoenixUsed, !assisted, d.id + ' plume also governs a later Frost Totem');

  h.openShop();
  h.gold = 3;
  assert.equal(h.shopView(g.stage).healCost, 3);
  assert.equal(h.heal(), 'ALREADY HEALED');
  assert.equal(h.gold, 3, 'full health costs nothing');
  g.stage = 4;
  h.openShop();
  p.hp = 1;
  h.gold = 5;
  assert.equal(h.shopView(g.stage).healCost, 6);
  assert.equal(h.heal(), 'NOT ENOUGH GOLD');
  h.gold++;
  assert.equal(h.heal(), '');
  assert.equal(h.gold, 0);
  assert.equal(p.hp, 1 + .4 * p.maxHp);
  assert.equal(h.heal(), 'ALREADY HEALED');

  client.role = 'client';
  client.onClientMessage({ t: 'start', mods: 'vanilla', seed: 42, difficulty: d.id, you: 0, players: [{ name: 'Guest' }] });
  assert.equal(client.difficulty.id, d.id);
  assert.equal(timeState(client).net.used, false, d.id + ' new client run clears the previous meter');
  client.applyTimeNet({ m: afterStage });
  assert.equal(timeState(client).net.used, !assisted);
  assert.equal(timeState(client).rewindsUsed, assisted ? 0 : 1, 'promotion keeps the mirrored charge');
}

// After the grace period a returning player can get a new object AND a different seat.
g.startRun({ seed: 42, difficulty: 'normal' });
g.role = 'host';
const roster = coopState(g);
const first = g.makeHero(1, 'Guest', [], 'peer-one');
roster.pids[1] = 'returning';
first.phoenixUsed = true;
const replacement = g.makeHero(1, 'Guest', [], 'peer-two');
roster.pids[1] = 'new-player';
assert.equal(replacement.phoenixUsed, false, 'same seat and name, different player');
const returning = g.makeHero(2, 'Guest', [], 'peer-three');
roster.pids[2] = 'returning';
assert.equal(returning.phoenixUsed, true, 'reconnect retains the shared run charge');
// Older guests matched by name can spend a charge while the disconnect autopilot is in control.
const legacy = g.makeHero(3, 'Legacy', []);
legacy.phoenixUsed = true;
const legacyReturn = g.makeHero(4, 'Legacy', [], 'new-peer');
assert.equal(legacyReturn.phoenixUsed, true);
for (const guest of [first, replacement, returning, legacy, legacyReturn]) guest.dispose();

// Start through the host transport, buy healing from the guest's shop and promote the mirror.
const guest = g.makeHero(1, 'Guest', [], 'peerB');
g.setHeroes([h, guest]);
const deliver = (packet: unknown) => client.onClientMessage(structuredClone(packet) as Record<string, unknown>);
g.host = { send: (_peer: string, packet: unknown) => deliver(packet), broadcast: deliver } as typeof g.host;
settings.difficulty = 'easy';
g.startRun({ seed: 42, difficulty: 'normal' });
assert.equal(client.local, 1);
assert.equal(client.difficulty.id, 'normal');
g.closeShop();
g.loadStage(4);
g.openShop();
guest.gold = 6;
guest.player.hp = 1;
g.onHostMessage('peerB', { t: 'ui', a: 'heal', i: 0 });
assert.equal(guest.gold, 0);
assert.equal(guest.player.hp, 1 + .4 * guest.player.maxHp);
g.closeShop();
roster.pids[1] = 'returning';
guest.phoenixUsed = true;
const checkpoint = buildMig(g);
deliver(checkpoint);
restoreRun(client, checkpoint);
client.role = 'host';
coopState(client).pids = checkpoint.heroes.map(hero => hero.pid);
client.hero.startRun(); // rebuild from a stash after migration
assert.equal(client.hero.phoenixUsed, true, 'promoted host retains the rescue under the returning player ID');

await setLanguage('ar');
for (const d of DIFFICULTIES) {
  assert.doesNotMatch(localize(d.name), /[a-z]/i);
  assert.doesNotMatch(localize(d.desc), /[a-z]/i);
}
for (const copy of [RELIC_BY_ID.r_phoenix.desc, String(MOD_BY_ID.phoenix.desc), 'REWIND USED THIS RUN']) assert.doesNotMatch(localize(copy), /[a-z]/i);
console.log('PASS Gate 2 difficulty, save compatibility, host rules, recovery, shop and Arabic labels');
