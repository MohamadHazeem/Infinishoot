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
