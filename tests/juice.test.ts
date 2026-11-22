import './jsdomEnv';
import { ok } from './check';
import { LifePulse } from '../src/game/juiceVitals';
import { streakTier } from '../src/data/juice';

const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { ENEMIES } = await import('../src/data/enemies');
const { access, settings } = await import('../src/game/settings');
const { Vfx } = await import('../src/game/vfx');
const { FxEncoder, decodeFx } = await import('../src/net/fxCodec');

const pulse = new LifePulse();
const attack = pulse.update(0.016, 8, 100, true, false);
pulse.update(0.1, 8, 100, true, false);
const trough = pulse.update(0.06, 8, 100, true, false);
const echo = pulse.update(0.03, 8, 100, true, false);
ok(attack > echo && echo > trough && attack < 0.36, 'the low-life double beat leaves a clear trough');
ok(pulse.update(0.05, 4, 100, true, true) === 0.14 && pulse.update(0.05, 90, 100, false, false) === 0, 'steady calm mode and immediate recovery');
ok([11,12,24,25,26,50,99,100,150,200].map(streakTier).join() === '0,1,0,2,0,3,0,4,5,5', 'exact streak milestones and capped intensity');

const game = new Game(new Input(document.querySelector('#game')!), 16 / 9, document.querySelector('#hud')!, document.querySelector('#reticle')!);
game.startSolo();
if (game.mode === 'shop') game.closeShop();
game.enemies.clear();
const h = game.hero;
const e = game.enemies.spawn(ENEMIES.swarmer, 0.1, 4.1, { instant: true });
e.maxHp = e.hp = 1000;
e.state = 'move';
game.vfx.recording = true;
game.damage(e, 70, { source: 'charge', fixed: true, loud: true, dirX: 1, noStatus: true }, h);
const events = game.vfx.drain();
ok(e.hp === 930 && e.sq < 0 && !game.vfx.contact && !game.vfx.contactPending, 'damage preserves health arithmetic and applies a transient flinch');
const stars = events.filter(v => v[0] === 's');
ok(stars.length === 2 && stars.every(v => v[5] === '#3dffb0') && stars[0][1] > stars[1][1], 'charge strikes mark entry and exit on the shot axis');
game.vfx.num(0.1, 2, 4.1, '30!', 'crit', 0);
game.vfx.num(0.1, 2, 4.1, '18 FIRE', 'hit', 0);
const labels = game.vfx.drain();
ok(labels[0][0] === 'n' && labels[0][2] === 2.75 && labels[1][0] === 'n' && labels[1][2] === 2.32, 'numeric crit and elemental labels separate above normal hits');

// A real compact packet replays final geometry once, without re-running damage or moving the anchor again.
const seen: number[][] = [];
const client = new Vfx({ fx: { star: (x: number, _y: number, z: number) => seen.push([x, z]) },
  dmg: { spawn: (x: number, y: number) => seen.push([x, y]) } } as unknown as ConstructorParameters<typeof Vfx>[0]);
decodeFx(new FxEncoder().encode([...stars, ...labels]), event => client.apply(event));
ok(seen.length === 4 && Math.abs(seen[0][0] - stars[0][1]) < 0.011 && seen[2][1] === 2.75, 'client receives both charge glints and the elevated crit');

settings.slowMo = true;
access.reduceFlash = false;
game.gainXp(game.xpNext);
ok(game.slowMoT === 0.2, 'level-up primes the return to combat');
game.evolveFx(h, 'Flare Buster', '#ff7a2f');
ok(game.slowMoT === 0.38, 'the longer evolution beat wins');
game.slowMoT = 0;
game.role = 'host';
game.evolveFx(h, 'Flare Buster', '#ff7a2f');
ok(game.slowMoT === 0 && game.vfx.drain().some(v => v[0] === 'b' && v[4].flourish === 'evolution'), 'co-op shares the reward glint at normal simulation speed');
game.role = 'solo';
access.reduceFlash = true;
game.evolveFx(h, 'Flare Buster', '#ff7a2f');
ok(game.slowMoT === 0, 'reduced effects skip the reward slowdown');

game.startMiniGame('coins');
game.modes.holster = true;
game.startSolo();
ok(!game.modes.mg && !game.modes.holster, 'a fresh run can shoot immediately after an abandoned arcade round');
