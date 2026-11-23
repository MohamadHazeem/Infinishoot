import { seedRandom } from './jsdomEnv';
import { ok } from './check';
seedRandom(123);
const { Game, cheats } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { installBot } = await import('../src/dev/bot');
const { ENEMIES } = await import('../src/data/enemies');
const input = new Input(document.getElementById('game') as HTMLCanvasElement);
const g = new Game(
  input,
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
installBot(g, input);
type Run = ReturnType<typeof import('../src/dev/skillBot').createSkillRun>;
const run = (window as unknown as { skillRun: Run }).skillRun;

function duel() {
  g.startRun({ seed: 14, difficulty: 'normal' });
  g.closeShop();
  g.director.hold = true;
  g.enemies.clear();
  g.hero.weapons.length = 0;
  g.player.teleport(0, 0);
  g.player.invuln = 0;
  const e = g.enemies.spawn(ENEMIES.charger, -4, 0, g.spawnOpts({ instant: true }));
  e.state = 'windup';
  e.t = 0.45;
  e.lungeX = 1;
  e.lungeZ = 0;
  g.render(1, 1);
}
duel();
cheats.god = true;
// Withhold the first command for the whole fixture: same simulation, idle controls.
const idle = run(0.95, { reactionMs: 1500 });
ok(
  idle.lastHits.some((h) => h.source === 'charger') && idle.damageByStage[1] > 0,
  'idle hero takes the telegraphed charge, even from a god test link',
);
ok(cheats.god, 'restores caller god setting');
duel();
const r = run(0.95);
ok(
  r.damageByStage[1] === 0 && Math.abs(g.player.z) > 1,
  'skilled hero steps across the charge line before impact',
);
ok(input.virtual.active === false, 'returns the controls after the simulation');
for (const key of [
  'log',
  'mode',
  'stage',
  't',
  'level',
  'kills',
  'alive',
  'maxAlive',
  'hp',
  'weapons',
  'passives',
  'avgMs',
  'worstMs',
  'ranks',
  'stages',
  'bosses',
  'firstEvo',
  'died',
  'stageReached',
  'seed',
  'difficulty',
  'tuning',
  'causeOfDeath',
  'lastHits',
  'damageByStage',
  'dashes',
  'parries',
  'clearedStages',
  'loopCleared',
  'runSeconds',
  'simulatedSeconds',
]) {
  ok(key in r, 'skillRun report contains ' + key);
}
duel();
g.player.hp = 1;
const fatal = run(2, { reactionMs: 2000 });
ok(
  fatal.died && fatal.causeOfDeath === 'charger' && fatal.lastHits.at(-1)?.hp === 0,
  'the accepted lethal hit names its source',
);

// Drive several genuine accepted hits through the normal damage pipeline. The
// blocked duplicate must not inflate damage or evict the previous real hit.
duel();
g.enemies.clear();
const update = g.update;
let landed = 0;
g.update = function (dt) {
  g.player.invuln = 0;
  const source = 'Hazard ' + ++landed;
  g.hurtHero(g.hero, 2, 0, 1, null, source);
  g.hurtHero(g.hero, 30, 0, 1, null, 'Blocked');
  update.call(g, dt);
};
const history = run(7 / 60);
g.update = update;
ok(
  history.lastHits.map((h) => h.source).join(',') ===
    'hazard_3,hazard_4,hazard_5,hazard_6,hazard_7',
  'keeps the five latest accepted hits in order',
);
ok(
  history.damageByStage[1] === 14,
  'stage damage includes accepted hits older than the hit history',
);

duel();
g.enemies.clear();
const shooter = g.enemies.spawn(ENEMIES.shooter, -1.2, 0, g.spawnOpts({ instant: true }));
let fired = false;
g.update = function (dt) {
  if (!fired) {
    g.enemyCtx.fireBullet(shooter, 1, 0, 8, 15);
    fired = true;
  }
  update.call(g, dt);
};
const shot = run(0.25, { reactionMs: 1000 });
g.update = update;
ok(
  shot.lastHits.some((hit) => hit.source === 'shooter'),
  'incoming projectile retains its firing enemy ID',
);

duel();
g.enemies.clear();
const mirror = g.enemies.spawn(ENEMIES.mirror, -1.4, 0, g.spawnOpts({ instant: true }));
mirror.lungeX = 1;
mirror.lungeZ = 0;
fired = false;
g.update = function (dt) {
  if (!fired) {
    g.enemyCtx.family!.fire(mirror);
    g.enemies.clear();
    fired = true;
  }
  update.call(g, dt);
};
const copied = run(0.3, { reactionMs: 1000 });
g.update = update;
ok(
  copied.lastHits.some((hit) => hit.source === 'mirror'),
  'attributes a copied shot after its owner leaves',
);

duel();
g.enemies.clear();
g.bossField.pendingWalls.push({
  cx: -2,
  cz: 0,
  dx: 1,
  dz: 0,
  gap: 10,
  t: 0.01,
  dmg: 10,
  src: g.enemies.spawn(ENEMIES.queen, -10, 0, g.spawnOpts({ instant: true })),
});
const wall = run(0.5, { reactionMs: 1000 });
ok(
  wall.lastHits.some((hit) => hit.source === 'queen'),
  'attributes a delayed swarm wall to its boss',
);

duel();
const initial = run(0.1);
for (let i = 0; i < 8; i++) run(0.1);
const sliced = run(0.05);
ok(
  initial.simulatedSeconds === 0.1 && sliced.simulatedSeconds === 0.95,
  'adjacent slices resume the same measurement',
);
ok(
  sliced.damageByStage[1] === 0 && Math.abs(g.player.z) > 1,
  'short slices preserve queued reactions across calls',
);

// Read the first observed input. A boss standing due west would normally
// make the bot orbit; its locked charge line calls for a perpendicular step.
duel();
g.enemies.clear();
const rex = g.enemies.spawn(ENEMIES.rex, -11, 0, g.spawnOpts({ instant: true }));
rex.state = 'windup';
rex.action = 'charge';
rex.t = 0.3;
rex.lungeX = 1;
rex.lungeZ = 0;
let moveX = 0,
  moveZ = 0;
g.update = function (dt) {
  moveX = input.move.x;
  moveZ = input.move.y;
  update.call(g, dt);
};
run(1 / 60, { reactionMs: 0 });
g.update = update;
ok(Math.abs(moveX) < 0.01 && Math.abs(moveZ) > 0.99, 'reads the full Rex charge line');

const { MOD_BY_ID } = await import('../src/data/mods');
g.startRun({ seed: 14, difficulty: 'normal' });
g.hero.gold = 100;
g.hero.shopOffers = [MOD_BY_ID.cold_snap, MOD_BY_ID.hair_trigger];
run(1 / 60);
ok(
  g.hero.synergy.owns('hair_trigger') && !g.hero.synergy.owns('cold_snap'),
  'the starter projectile kit buys the matching Mod first',
);
g.closeShop();
g.mode = 'levelup';
g.hero.pendingLevels = 1;
const { WEAPONS } = await import('../src/data/weapons');
g.hero.offers = [WEAPONS.tesla, WEAPONS.crosswind].map(
  ({ id, name, icon, color, tags, levels }) => ({
    kind: 'weapon',
    slot: 'auto',
    tag: 'NEW!',
    id,
    name,
    icon,
    color,
    tags,
    text: levels[0].text,
  }),
);
run(1 / 60);
ok(
  g.hero.weapons.some((w) => w.def.id === 'crosswind'),
  'card choice uses the owned projectile tag',
);

function incomingShot(direction: number) {
  duel();
  g.enemies.clear();
  const shooter = g.enemies.spawn(ENEMIES.shooter, -3.7, 0, g.spawnOpts({ instant: true }));
  g.enemyCtx.fireBullet(shooter, direction, 0, 9, 15);
  g.enemies.clear();
  return run(0.28);
}
const incoming = incomingShot(1);
ok(
  incoming.parries === 1 && g.hero.skill.parried > 0 && incoming.damageByStage[1] === 0,
  'reflects a visible shot after the reaction delay',
);
const outgoing = incomingShot(-1);
ok(outgoing.parries === 0 && outgoing.dashes === 0, 'saves both cooldowns for a collision course');

duel();
g.loadStage(4);
g.director.hold = true;
g.director.bossSpawned = true;
g.boss = g.enemies.spawn(ENEMIES.omega, 4, 0, g.spawnOpts({ instant: true }));
let remaining = 0.5;
g.update = function (dt) {
  remaining -= dt;
  if (remaining <= 0 && g.boss?.active) g.killEnemy(g.boss, 'buster', g.hero);
  update.call(g, dt);
};
const victory = run(3);
g.update = update;
ok(
  victory.loopCleared &&
    !victory.died &&
    victory.clearedStages.includes(4) &&
    victory.bosses.some((b) => b.id === 'omega' && b.killed && b.seconds > 0),
  'credits the stage-four boss kill and records its fight duration',
);
ok(run(1).simulatedSeconds === victory.simulatedSeconds, 'successive slices stop at loop victory');
