/**
 * Skill layer in the real game (jsdom, no WebGL): parry reflects and stuns,
 * perfect dashes refund the dash, every hero's ultimate runs to the end, and
 * the co-op snapshot part round-trips to a client.
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

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { Team } = await import('../src/game/bullets');
const { ENEMIES } = await import('../src/data/enemies');
const { HEROES } = await import('../src/data/heroes');
const { settings } = await import('../src/game/settings');
const { ultOf } = await import('../src/game/ultimates');

const input = new Input(document.getElementById('game') as HTMLCanvasElement);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
cheats.unlockAll = true;
const step = (n: number) => {
  for (let i = 0; i < n; i++) {
    game.update(1 / 60);
    if (game.mode === 'levelup') (game as unknown as { ui(a: string, i: number): void }).ui('pick', 0);
  }
};
const fresh = (hero = 'rookie') => {
  settings.hero = hero;
  game.applyLocalSkin();
  game.startSolo();
  if (game.mode === 'shop') game.closeShop();
  game.enemies.clear();
  game.bullets.clear();
  game.director.time = 0;
  step(1);
};
const enemyBullet = (x: number, z: number, dx: number, dz: number) =>
  game.bullets.spawn({ x, z, dirX: dx, dirZ: dz, speed: 20, life: 4, radius: 0.26, damage: 10, knockback: 6, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5 });

// Parry: a bullet about to land gets reflected as the hero's own shot.
fresh();
const h = game.hero;
const p = h.player;
p.invuln = 0;
enemyBullet(p.x + 1.1, p.z, -1, 0);
const before = h.skill.style.points;
game.tryParry(h);
const i = game.bullets.count - 1;
ok(game.bullets.team[i] === Team.Player && game.bullets.kind[i] === 13, 'parry turns the bullet into a player shot (kind 13)');
ok(game.bullets.vx[i] > 0, 'the reflected shot flies back out');
ok(h.skill.style.points > before && h.skill.buffT > 0 && p.invuln > 0, 'a parry earns style, the buff and i-frames');
ok(h.skill.parryCd < 0.2, 'a clean parry gives the button straight back');

// Parry whiff: nothing in reach keeps the full cooldown.
step(60);
game.tryParry(h);
step(20);
ok(h.skill.parryCd > 0.2 && h.skill.parried === 0, 'a whiffed parry costs the cooldown');

// Parry stuns a lunging melee enemy.
step(60);
const e = game.enemies.spawn(ENEMIES.bopper, p.x + 1, p.z, game.spawnOpts({ instant: true }));
step(2); // done spawning and into the spatial hash
e.x = p.x + 1;
e.z = p.z;
e.state = 'attack';
game.tryParry(h);
ok(e.frozen > 0, 'a parried melee attacker is stunned');

// Perfect dash: a bullet that would hit within the lead time.
fresh();
p.invuln = 0;
p.dashStock = 0;
p.dashCd = 1;
enemyBullet(p.x + 2.5, p.z, -1, 0);
game.onDash(h);
ok(h.skill.dashPerfect && h.skill.buffT > 0, 'dashing just before a bullet lands is a perfect dash');
ok(p.dashStock === 1, 'a perfect dash refunds the dash');
ok(game.slowMoT > 0, 'solo perfect dashes slow time briefly');
// ...but a dash with nothing around is just a dash.
fresh();
game.onDash(h);
step(20);
ok(!h.skill.dashPerfect, 'an ordinary dash is not perfect');

// Every hero's ultimate runs and ends cleanly.
for (const d of HEROES) {
  fresh(d.id);
  const hh = game.hero;
  ok(hh.heroDef.id === d.id, `playing ${d.id}`);
  for (let k = 0; k < 12; k++) game.enemies.spawn(ENEMIES.swarmer, hh.player.x + Math.cos(k) * 5, hh.player.z + Math.sin(k) * 5, game.spawnOpts({ instant: true }));
  const kills = game.kills;
  game.tryUlt(hh);
  ok(hh.skill.ultT === 0, `${d.id}: no ultimate without charge`);
  hh.skill.ult = 1;
  game.tryUlt(hh);
  ok(hh.skill.ultT > 0 && hh.skill.ult === 0, `${d.id}: ${ultOf(hh).name} starts and spends the charge`);
  step(Math.ceil(ultOf(hh).duration * 60) + 120); // slow-mo and hit-stops stretch it a little
  ok(hh.skill.ultT === 0 && hh.player.ultSpeed === 1, `${d.id}: the ultimate ends and resets`);
  ok(game.kills > kills, `${d.id}: the ultimate kills (${game.kills - kills})`);
}

// Score multiplier follows the killer's style rank.
fresh();
h.skill.style.add(2000);
ok(game.styleScoreMul(game.hero) > 2 && game.styleXpMul(game.hero) > 1, 'SS multiplies score and slightly XP');
ok(game.summary(game.hero).style === 'SS', 'the game-over summary carries the best rank');

// Co-op: the snapshot part round-trips to a client.
fresh();
const hero = game.hero;
hero.skill.ult = 0.5;
hero.skill.style.add(300, 'PARRY!');
hero.skill.buffT = 2;
const net = JSON.parse(JSON.stringify(game.skillNet(hero)));
hero.skill.ult = 0;
hero.skill.style.points = 0;
hero.skill.style.notes.length = 0;
hero.skill.buffT = 0;
game.applySkillNet(net);
ok(hero.skill.ult === 0.5 && hero.skill.style.points === 300 && hero.skill.buffT > 0, 'client mirrors ultimate charge, style and buff');
ok(hero.skill.style.notes.some((n) => n.text === 'PARRY!'), 'client gets its style notes');
ok(JSON.stringify(game.skillNet(hero)).length < 400, 'the snapshot part stays small');
process.exit(process.exitCode ?? 0);
