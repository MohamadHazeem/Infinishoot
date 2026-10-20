// balance2 lane: the bullet ultimates respect the ultimate boss multiplier, and the tuning
// relationships the final balance pass relies on stay in place (notes/lanes/balance2.md).
import './jsdomEnv';
import { ok } from './check';

const { Input } = await import('../src/core/input');
const { Game, cheats, BULLET_KINDS } = await import('../src/game/game');
const { ultTuning } = await import('../src/game/ultimates');
const { ENEMIES } = await import('../src/data/enemies');
const { Team } = await import('../src/game/bullets');
const { settings } = await import('../src/game/settings');

// ---------------------------------------------------------------- bullet ultimates on bosses
ok(BULLET_KINDS[14]?.source === 'ult', 'bullet kind 14 is the ultimate (Mega Barrage, Mirror Storm)');

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
settings.mode = 'standard';
settings.hero = 'rookie';
cheats.god = true;
game.startSolo();
if (game.mode === 'shop') game.closeShop();
game.update(1 / 60);
const rnd = Math.random;
Math.random = () => 0.999;
(game.rng as unknown as { chance: () => boolean }).chance = () => false; // no crits (Game.damage rolls crits on the game RNG)

/** Life a boss loses to one bullet of `kind` with `dmg` damage that spawns on it. */
function hitWith(def: (typeof ENEMIES)[string], kind: number, dmg: number): number {
  game.enemies.clear();
  game.bullets.clear();
  const p = game.hero.player;
  const e = game.enemies.spawn(def, p.x + 6, p.z, { instant: true });
  e.roarT = 0;
  game.update(1 / 60);
  const hp0 = e.hp;
  game.bullets.spawn({ x: e.x - 0.2, z: e.z, dirX: 1, dirZ: 0, speed: 1, life: 0.5, radius: 0.4, damage: dmg, knockback: 0, team: Team.Player, color: '#ffd23f', width: 0.4, length: 0.8, pierce: 0, owner: 0, kind });
  for (let i = 0; i < 3; i++) game.update(1 / 60);
  return hp0 - e.hp;
}
const boss = ENEMIES.king;
const plain = hitWith(boss, 0, 100);
const ult = hitWith(boss, 14, 100);
ok(plain > 0 && ult > 0, `both bullets hurt the boss (buster ${plain.toFixed(1)}, ultimate ${ult.toFixed(1)})`);
ok(Math.abs(ult / plain - ultTuning.bossMul) < 0.02, `an ultimate bullet deals ultTuning.bossMul (${ultTuning.bossMul}) to a boss: ${(ult / plain).toFixed(3)}`);
const mob = ENEMIES.chonk ?? ENEMIES.bopper;
const plainMob = hitWith({ ...mob, hp: 1e6 }, 0, 100);
const ultMob = hitWith({ ...mob, hp: 1e6 }, 14, 100);
ok(plainMob > 0 && Math.abs(ultMob / plainMob - 1) < 0.02, `ordinary enemies still take full ultimate bullet damage (${(ultMob / plainMob).toFixed(3)})`);
Math.random = rnd;

process.exit(process.exitCode ?? 0);
